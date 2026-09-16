/**
 * Shared param-normalisation layer for Figma commands.
 *
 * WHY THIS EXISTS
 * ---------------
 * Standalone MCP tools (e.g. `set_layout_mode`) declare a *caller-facing* zod schema
 * and then massage those params into the *plugin-facing* wire shape before calling
 * `sendCommandToFigma` (e.g. `mode` → `layoutMode`). `batch_actions` forwards each
 * action's `params` RAW to the plugin — bypassing every one of those schemas — so the
 * same call that works standalone fails inside a batch ("Missing gradientType", …).
 *
 * This module centralises that massaging as `command -> normalize(params)` so batch
 * actions accept the SAME param names and value formats as the standalone tools.
 *
 * Rules:
 *  - ALIAS, never break: both spellings are accepted; the canonical (plugin-facing)
 *    name always wins when both are present.
 *  - IDEMPOTENT: normalising already-canonical params is a no-op, so this can safely
 *    be applied on top of a standalone tool's output too.
 *  - Never throws — unknown commands pass through untouched.
 */

import { normalizeNodeId } from "./figma-helpers";

type Params = Record<string, unknown>;

/** Keys whose values are Figma node ids and therefore accept the URL "12-34" form. */
const NODE_ID_KEYS = ["nodeId", "parentId", "childId", "targetId", "sourceId", "instanceId", "componentId", "frameId"];

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/**
 * Moves `from` to `to` when `to` is absent. Returns whether anything moved.
 * The canonical key (`to`) always wins if the caller supplied both.
 */
function alias(params: Params, from: string, to: string): void {
  if (!isPresent(params[to]) && isPresent(params[from])) {
    params[to] = params[from];
    delete params[from];
  } else if (from !== to && from in params && isPresent(params[to])) {
    delete params[from];
  }
}

function upper(params: Params, key: string): void {
  if (typeof params[key] === "string") params[key] = (params[key] as string).toUpperCase();
}

function defaultTo(params: Params, key: string, value: unknown): void {
  if (params[key] === undefined || params[key] === null) params[key] = value;
}

function num(params: Params, key: string): void {
  const v = params[key];
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) params[key] = Number(v);
}

/**
 * Per-command normalisers. Each mutates (a copy of) the params in place.
 * Add a new entry whenever a standalone tool massages params before dispatch.
 */
const NORMALIZERS: Record<string, (p: Params) => void> = {
  set_layout_mode: (p) => {
    alias(p, "mode", "layoutMode");
    alias(p, "direction", "layoutMode");
    upper(p, "layoutMode");
    upper(p, "wrap");
    upper(p, "gridAutoTracks");
    upper(p, "gridItemsPositioning");
    alias(p, "rows", "gridRowCount");
    alias(p, "columns", "gridColumnCount");
  },

  set_auto_layout: (p) => {
    alias(p, "mode", "layoutMode");
    upper(p, "layoutMode");
  },

  set_line_height: (p) => {
    alias(p, "height", "lineHeight");
    alias(p, "value", "lineHeight");
    num(p, "lineHeight");
    upper(p, "unit");
    defaultTo(p, "unit", "PIXELS");
  },

  set_letter_spacing: (p) => {
    alias(p, "spacing", "letterSpacing");
    alias(p, "value", "letterSpacing");
    num(p, "letterSpacing");
    upper(p, "unit");
    defaultTo(p, "unit", "PIXELS");
  },

  set_font_size: (p) => {
    alias(p, "size", "fontSize");
    num(p, "fontSize");
  },

  rename_node: (p) => {
    // Standalone takes `name`; callers coming from rename_variable habits send newName.
    alias(p, "newName", "name");
  },

  rename_variable: (p) => {
    alias(p, "id", "variableId");
    alias(p, "variable", "variableId");
    alias(p, "name", "newName");
  },

  rename_variable_collection: (p) => {
    alias(p, "id", "collectionId");
    alias(p, "name", "newName");
  },

  rename_page: (p) => {
    alias(p, "newName", "name");
  },

  bind_variable: (p) => {
    alias(p, "variable", "variableId");
    alias(p, "variableName", "variableId");
    alias(p, "property", "field");
  },

  unbind_variable: (p) => {
    alias(p, "property", "field");
  },

  apply_text_style: (p) => {
    // The plugin resolves an id OR a name from the single `styleId` param.
    alias(p, "styleName", "styleId");
    alias(p, "style", "styleId");
  },

  set_color_style_id: (p) => {
    alias(p, "styleName", "styleId");
  },

  set_effect_style_id: (p) => {
    alias(p, "styleName", "styleId");
  },

  set_gradient_fill: (p) => {
    alias(p, "type", "gradientType");
    upper(p, "gradientType");
    defaultTo(p, "angle", 0);
    defaultTo(p, "opacity", 1);
  },

  set_corner_radius: (p) => {
    num(p, "radius");
    // Accept the object form {topLeft, topRight, bottomRight, bottomLeft} as well as
    // the standalone [tl, tr, br, bl] boolean array.
    const corners = p.corners;
    if (corners !== null && typeof corners === "object" && !Array.isArray(corners)) {
      const c = corners as Record<string, unknown>;
      p.corners = [c.topLeft !== false, c.topRight !== false, c.bottomRight !== false, c.bottomLeft !== false];
    }
    defaultTo(p, "corners", [true, true, true, true]);
  },

  create_text: (p) => {
    alias(p, "characters", "text");
    alias(p, "content", "text");
    defaultTo(p, "fontSize", 14);
    defaultTo(p, "fontFamily", "Inter");
    defaultTo(p, "fontWeight", 400);
    defaultTo(p, "fontColor", { r: 0, g: 0, b: 0, a: 1 });
    defaultTo(p, "name", typeof p.text === "string" && p.text ? p.text : "Text");
  },

  create_rectangle: (p) => {
    alias(p, "fill", "fillColor");
    alias(p, "color", "fillColor");
    alias(p, "radius", "cornerRadius");
    defaultTo(p, "name", "Rectangle");
  },

  create_frame: (p) => {
    alias(p, "fill", "fillColor");
    alias(p, "mode", "layoutMode");
    upper(p, "layoutMode");
    defaultTo(p, "name", "Frame");
  },

  set_text_content: (p) => {
    alias(p, "characters", "text");
    alias(p, "content", "text");
  },

  set_fill_color: (p) => {
    alias(p, "fill", "color");
    alias(p, "hex", "color");
  },

  set_stroke_color: (p) => {
    alias(p, "stroke", "color");
    alias(p, "hex", "color");
  },

  resize_node: (p) => {
    num(p, "width");
    num(p, "height");
  },

  move_node: (p) => {
    num(p, "x");
    num(p, "y");
  },
};

/**
 * Normalise one batch action's params into the plugin-facing wire shape.
 *
 * Applied by `batch_actions` before dispatch so a batched action behaves exactly like
 * the equivalent standalone tool call. Safe to call on already-canonical params.
 */
export function normalizeCommandParams(command: string, params: Params | undefined | null): Params {
  const out: Params = { ...(params ?? {}) };

  // Universal: Figma URL-style node ids ("65-7554") → API form ("65:7554").
  for (const key of NODE_ID_KEYS) {
    const v = out[key];
    if (typeof v === "string" && !v.startsWith("$result[")) out[key] = normalizeNodeId(v);
  }
  if (Array.isArray(out.nodeIds)) {
    out.nodeIds = out.nodeIds.map((v) => (typeof v === "string" && !v.startsWith("$result[") ? normalizeNodeId(v) : v));
  }

  const normalizer = NORMALIZERS[command];
  if (normalizer) {
    try {
      normalizer(out);
    } catch {
      // Normalisation is best-effort — never block an action from reaching the plugin.
    }
  }
  return out;
}

/** Commands this layer knows how to normalise (exported for tests/introspection). */
export const NORMALIZED_COMMANDS = Object.keys(NORMALIZERS);
