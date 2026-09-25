/**
 * ONE colour coercion helper for every colour-accepting MCP parameter.
 *
 * Before this existed each tool invented its own contract: `set_fill_color`
 * took a hex string but rejected an `{r,g,b,a}` object, `set_gradient_fill`
 * took an object but rejected hex, `calculate_contrast_ratio` demanded 0–1
 * objects and silently produced `NaN` for anything else. `toRgba()` accepts
 * every form and NEVER returns NaN — it throws naming what it received.
 *
 * Accepted forms
 *  - hex string: "#f00", "#f008", "#ff0000", "#ff000080", with or without "#"
 *  - object: `{ r, g, b, a? }` — channels 0–1 OR 0–255
 *  - array: `[r, g, b]` or `[r, g, b, a]` — 0–1 OR 0–255
 *  - numeric strings inside objects/arrays ("255", "0.5") are coerced
 *
 * 0–1 vs 0–255 disambiguation
 *  If ANY of r/g/b is > 1 the value is read as 0–255 and divided by 255.
 *  If ALL of r/g/b are <= 1 the value is read as already-normalised 0–1.
 *
 *  This is genuinely ambiguous at the corners and the rule is deliberate:
 *  `{r:1, g:1, b:1}` means WHITE (0–1), not near-black `rgb(1,1,1)`. Likewise
 *  `{r:0, g:0, b:0}` is black under either reading, and `{r:1, g:0, b:0}` is
 *  full red, not `rgb(1,0,0)`. Callers who really want the 0–255 triple
 *  `(1,1,1)` must say so unambiguously with hex ("#010101"). Normalised 0–1
 *  is by far the more common caller intent and is what Figma itself uses, so
 *  it wins the tie.
 *
 *  Alpha follows the channels: in a 0–255 colour an `a` > 1 is divided by 255,
 *  while `a: 1` stays fully opaque (never 1/255).
 */

import { z } from "zod";

export interface NormalizedRgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const ACCEPTED =
  'Accepted forms: hex string ("#ff0000", "#f00", "#ff000080"), ' +
  "{r,g,b,a} object with channels 0–1 or 0–255, or [r,g,b] / [r,g,b,a] array.";

function describeReceived(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  try {
    return `${typeof value} ${JSON.stringify(value)}`;
  } catch {
    return String(value);
  }
}

function fail(value: unknown, why?: string): never {
  throw new Error(`Invalid color: ${describeReceived(value)}${why ? ` — ${why}` : ""}. ${ACCEPTED}`);
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseHexInput(hex: string): NormalizedRgba | null {
  let h = hex.trim();
  if (h.charAt(0) === "#") h = h.substring(1);
  if (!/^[0-9a-fA-F]+$/.test(h)) return null;
  if (h.length === 3 || h.length === 4) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (h.length !== 6 && h.length !== 8) return null;
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.substring(6, 8), 16) : 255;
  if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
  return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function fromChannels(value: unknown, r: number, g: number, b: number, a: number | null): NormalizedRgba {
  if ([r, g, b].some((n) => n < 0) || (a !== null && a < 0)) fail(value, "channels must be >= 0");
  if ([r, g, b].some((n) => n > 255) || (a !== null && a > 255)) fail(value, "channels must be <= 255");

  const is255 = r > 1 || g > 1 || b > 1;
  const div = is255 ? 255 : 1;
  // Alpha is only rescaled when it is itself out of 0–1 range, so `a: 1`
  // stays fully opaque even inside a 0–255 colour.
  const alpha = a === null ? 1 : a > 1 ? a / 255 : a;

  return {
    r: clamp01(r / div),
    g: clamp01(g / div),
    b: clamp01(b / div),
    a: clamp01(alpha),
  };
}

/**
 * Normalise ANY accepted colour input to `{r,g,b,a}` with 0–1 channels.
 * Throws a descriptive error rather than ever producing NaN.
 */
export function toRgba(value: unknown): NormalizedRgba {
  if (value === null || value === undefined) fail(value, "no color given");

  if (typeof value === "string") {
    const parsed = parseHexInput(value);
    if (!parsed) fail(value, "not a valid hex color");
    return parsed;
  }

  if (Array.isArray(value)) {
    if (value.length < 3 || value.length > 4) fail(value, "array must have 3 or 4 entries");
    const nums = value.map(toFiniteNumber);
    if (nums.some((n) => n === null)) fail(value, "array entries must be finite numbers");
    return fromChannels(value, nums[0]!, nums[1]!, nums[2]!, nums.length === 4 ? nums[3]! : null);
  }

  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    // Tolerate the long-form channel names some callers use.
    const rRaw = o.r !== undefined ? o.r : o.red;
    const gRaw = o.g !== undefined ? o.g : o.green;
    const bRaw = o.b !== undefined ? o.b : o.blue;
    const aRaw = o.a !== undefined ? o.a : o.alpha !== undefined ? o.alpha : o.opacity;
    if (rRaw === undefined || gRaw === undefined || bRaw === undefined) {
      fail(value, "object must have r, g and b");
    }
    const r = toFiniteNumber(rRaw);
    const g = toFiniteNumber(gRaw);
    const b = toFiniteNumber(bRaw);
    if (r === null || g === null || b === null) fail(value, "r, g and b must be finite numbers");
    const a = aRaw === undefined || aRaw === null ? null : toFiniteNumber(aRaw);
    if (aRaw !== undefined && aRaw !== null && a === null) fail(value, "a must be a finite number");
    return fromChannels(value, r, g, b, a);
  }

  return fail(value, `unsupported type ${typeof value}`);
}

/** Normalise to a "#RRGGBB" / "#RRGGBBAA" hex string (alpha omitted when opaque). */
export function toHex(value: unknown): string {
  const c = toRgba(value);
  const h = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, "0");
  const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  return c.a >= 1 ? base : `${base}${h(c.a)}`;
}

/**
 * Zod schema for a colour parameter. CRITICAL: every accepted runtime form
 * must be DECLARED here — zod silently strips undeclared keys, so an object
 * form missing from the union would be dropped on the floor before the
 * handler ever sees it. The union below mirrors `toRgba` exactly.
 */
const channelSchema = z.preprocess(
  (v) => (typeof v === "boolean" || v === null ? undefined : v),
  z.coerce.number().min(0).max(255),
);

export const ColorObjectSchema = z.object({
  r: channelSchema.describe("Red channel — 0–1 normalized, or 0–255"),
  g: channelSchema.describe("Green channel — 0–1 normalized, or 0–255"),
  b: channelSchema.describe("Blue channel — 0–1 normalized, or 0–255"),
  a: channelSchema.optional().describe("Alpha — 0–1 normalized, or 0–255 (default: opaque)"),
});

export const ColorInputSchema = z.union([z.string(), ColorObjectSchema, z.array(z.coerce.number()).min(3).max(4)]);

export const COLOR_INPUT_DESCRIPTION =
  'Color in any accepted form: hex string ("#ff0000", "#f00", "#ff000080"), ' +
  "{r,g,b,a} object (channels 0–1 or 0–255), or [r,g,b(,a)] array. " +
  "If any channel is > 1 the value is read as 0–255; otherwise as 0–1 " +
  "(so {r:1,g:1,b:1} is white).";

/** Schema + description in one, for use as a tool parameter. */
export function colorParam(extra?: string) {
  return ColorInputSchema.describe(extra ? `${extra} ${COLOR_INPUT_DESCRIPTION}` : COLOR_INPUT_DESCRIPTION);
}

/**
 * Resolve a colour plus an optional top-level alpha (`a` / `alpha` / `opacity`).
 *
 * An explicit top-level alpha OVERRIDES the colour's own alpha — `{color:"#fff", a:0.1}`
 * is white at 10%, not opaque white. Alpha > 1 is read as 0–255, matching `toRgba`.
 * With no override the colour is returned as-is (hex strings stay verbatim).
 */
export function resolveColorWithAlpha(color: unknown, alpha?: number | null): string | NormalizedRgba {
  const normalized = toRgba(color);
  if (alpha === undefined || alpha === null) return typeof color === "string" ? color : normalized;
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 255) fail(alpha, "alpha must be 0–1 (or 0–255)");
  return { ...normalized, a: clamp01(alpha > 1 ? alpha / 255 : alpha) };
}
