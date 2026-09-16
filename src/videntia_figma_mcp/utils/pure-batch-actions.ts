/**
 * Server-side-only actions inside `batch_actions`.
 *
 * WHY THIS EXISTS (#16)
 * ---------------------
 * A handful of MCP tools never touch Figma: they are pure maths (colour compositing,
 * scale generation, format conversion, WCAG contrast) computed entirely in the MCP
 * server. They have no plugin handler and are absent from the plugin's
 * ALLOWED_COMMANDS, so putting one inside `batch_actions` used to fail with a bare
 * "Unknown command: calculate_composite_color" — structurally impossible, with an
 * error that told the caller nothing about why.
 *
 * Two kinds of server-side-only action are handled here:
 *
 *  1. PURE COMPUTATION (`isPureAction`) — evaluated HERE, before dispatch, and its
 *     result injected into the batch result list so `$result[N]` chaining works:
 *     compute a composite colour, then feed `$result[0].hex` straight into a later
 *     `set_fill_color`. Because the value is known before anything is sent to the
 *     plugin, the reference can be substituted textually — the plugin never needs
 *     to know the action existed.
 *
 *  2. NOT BATCHABLE (`nonBatchableReason`) — session/transport/read tools (browser
 *     control, channel management, icon catalogue lookups, schema/capability
 *     introspection, cross-surface diffs). These are standalone-only, and the batch
 *     now says so by name instead of emitting "Unknown command".
 */

import {
  RGBAColor,
  calculateColorScale,
  calculateCompositeColor,
  calculateContrastRatio,
  convertColorFormat,
  getContrastRecommendation,
  getWCAGCompliance,
  hexToRgba,
  rgbaToHex,
} from "./color-calculations";

/** Commands computed entirely server-side; usable in a batch and chainable. */
export const PURE_BATCH_ACTIONS = new Set([
  "calculate_composite_color",
  "calculate_color_scale",
  "calculate_contrast_ratio",
  "calculate_contrast_ratios",
  "convert_color_format",
]);

/**
 * Commands that exist only in the MCP server and are NOT meaningful inside a batch,
 * mapped to the reason a caller needs to hear.
 */
const NON_BATCHABLE_REASONS: Record<string, string> = {
  figma_connect: "channel/session management — run it standalone before the batch",
  join_channel: "channel/session management — run it standalone before the batch",
  get_open_channels: "channel/session management — run it standalone before the batch",
  get_schema_definition: "server-side documentation lookup — call it standalone",
  get_capabilities: "server-side capability introspection — call it standalone",
  list_icons: "server-side icon catalogue lookup — call it standalone",
  search_icon: "server-side icon catalogue lookup — call it standalone",
  get_icon: "server-side icon catalogue lookup — call it standalone",
  list_connected_browsers: "browser-session tool — runs over the browser channel, not the Figma plugin",
  diff_figma_to_browser: "cross-surface analysis tool — call it standalone",
  diff_figma_frame_to_page: "cross-surface analysis tool — call it standalone",
  compare_figma_to_component: "cross-surface analysis tool — call it standalone",
  overlay_figma_selection_in_browser: "browser-session tool — runs over the browser channel, not the Figma plugin",
  clear_browser_overlay: "browser-session tool — runs over the browser channel, not the Figma plugin",
  create_complete_design_system: "server-side orchestrator that already issues its own batches — call it standalone",
  setup_design_system: "server-side orchestrator that issues several dependent commands — call it standalone",
  batch_actions: "a batch cannot contain another batch — list the inner actions directly in this one",
};

/** True when `action` is computed server-side and can be evaluated inside a batch. */
export function isPureAction(action: string): boolean {
  return PURE_BATCH_ACTIONS.has(action);
}

/**
 * Why `action` cannot run inside a batch, or `undefined` when it can.
 * Returns a full sentence ready to be used as the action's error.
 */
export function nonBatchableReason(action: string): string | undefined {
  const reason =
    NON_BATCHABLE_REASONS[action] ??
    (action.startsWith("browser_")
      ? "browser-control tool — runs over the browser channel, not the Figma plugin"
      : undefined);
  if (!reason) return undefined;
  return (
    `'${action}' is a server-side-only tool and cannot run inside batch_actions: ${reason}. ` +
    `It has no Figma plugin command, so batching it can never work. ` +
    `Pure-computation tools (${[...PURE_BATCH_ACTIONS].sort().join(", ")}) ARE batchable and chainable via $result[N].`
  );
}

/** Coerce a hex string / {r,g,b,a} / [r,g,b] into normalized 0–1 RGBA. */
function toRgba(value: unknown, inputFormat?: string): RGBAColor {
  if (typeof value === "string") return hexToRgba(value);
  if (Array.isArray(value)) {
    const [r, g, b, a] = value.map(Number);
    return scaleRgba({ r, g, b, a: a === undefined ? 1 : a }, inputFormat);
  }
  if (value !== null && typeof value === "object") {
    const c = value as Record<string, unknown>;
    const r = Number(c.r);
    const g = Number(c.g);
    const b = Number(c.b);
    if (!isFinite(r) || !isFinite(g) || !isFinite(b)) {
      throw new Error(`Expected a hex string or {r,g,b,a}, got ${JSON.stringify(value)}`);
    }
    const a = c.a === undefined || c.a === null ? 1 : Number(c.a);
    return scaleRgba({ r, g, b, a: isFinite(a) ? a : 1 }, inputFormat);
  }
  throw new Error(`Expected a hex string or {r,g,b,a}, got ${JSON.stringify(value)}`);
}

/** rgb255 inputs (explicit, or any channel > 1) are normalized to 0–1. */
function scaleRgba(c: RGBAColor, inputFormat?: string): RGBAColor {
  const is255 = inputFormat === "rgb255" || c.r > 1 || c.g > 1 || c.b > 1;
  if (!is255) return c;
  return { r: c.r / 255, g: c.g / 255, b: c.b / 255, a: c.a };
}

/** A colour rendered every way a downstream action might want to consume it. */
function colorResult(color: RGBAColor) {
  return {
    hex: rgbaToHex(color),
    color: { r: color.r, g: color.g, b: color.b, a: color.a },
    rgb255: {
      r: Math.round(color.r * 255),
      g: Math.round(color.g * 255),
      b: Math.round(color.b * 255),
      a: color.a,
    },
  };
}

/**
 * Evaluate one pure action. Returns a plain JSON value whose fields are designed to
 * be referenced by a later action (`$result[N].hex`, `$result[N].scale.500.hex`, …).
 * Throws with a precise message on bad input — the caller records it as that
 * action's failure.
 */
export function computePureAction(action: string, params: Record<string, unknown>): unknown {
  const fmt = params.inputFormat as string | undefined;

  switch (action) {
    case "calculate_composite_color": {
      const mix = Number(params.mixPercentage);
      if (!isFinite(mix) || mix < 0 || mix > 1) {
        throw new Error(`calculate_composite_color: mixPercentage must be a number 0–1, got ${params.mixPercentage}`);
      }
      const result = calculateCompositeColor(toRgba(params.base, fmt), toRgba(params.background, fmt), mix);
      return { ...colorResult(result), mixPercentage: mix };
    }

    case "calculate_color_scale": {
      const base = toRgba(params.baseColor ?? params.base, fmt);
      const background = toRgba(params.backgroundColor ?? params.background ?? "#ffffff", fmt);
      const scale = calculateColorScale(base, background);
      const out: Record<string, unknown> = {};
      for (const level of Object.keys(scale)) {
        out[level] = colorResult((scale as unknown as Record<string, RGBAColor>)[level]);
      }
      return { scale: out };
    }

    case "convert_color_format": {
      const from = String(params.fromFormat ?? "normalized");
      const to = String(params.toFormat ?? "hex");
      const normalized = toRgba(params.color, from === "hex" ? undefined : from);
      const output = convertColorFormat(normalized, "normalized", to as never);
      return { ...colorResult(normalized), output, fromFormat: from, toFormat: to };
    }

    case "calculate_contrast_ratio": {
      const std = (params.standard as "AA" | "AAA") || "AA";
      const ratio = calculateContrastRatio(toRgba(params.foreground, fmt), toRgba(params.background, fmt));
      return {
        ratio: Math.round(ratio * 100) / 100,
        compliance: getWCAGCompliance(ratio),
        recommendation: getContrastRecommendation(ratio, std),
      };
    }

    case "calculate_contrast_ratios": {
      const std = (params.standard as "AA" | "AAA") || "AA";
      const pairs = params.pairs;
      if (!Array.isArray(pairs) || pairs.length === 0) {
        throw new Error("calculate_contrast_ratios: `pairs` must be a non-empty array");
      }
      const rows = pairs.map((raw, index) => {
        const pair = (raw ?? {}) as Record<string, unknown>;
        const ratio = calculateContrastRatio(toRgba(pair.foreground, fmt), toRgba(pair.background, fmt));
        return {
          index,
          label: pair.label === undefined ? undefined : String(pair.label),
          ratio: Math.round(ratio * 100) / 100,
          compliance: getWCAGCompliance(ratio),
          recommendation: getContrastRecommendation(ratio, std),
        };
      });
      return { standard: std, rows, failures: rows.filter((r) => !r.compliance.aa_normal).length };
    }

    default:
      throw new Error(`'${action}' is not a pure server-side action`);
  }
}
