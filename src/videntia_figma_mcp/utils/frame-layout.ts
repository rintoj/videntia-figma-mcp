/**
 * Frame layout resolution.
 *
 * `create_frame` accepts two spellings for the same thing: the historic flat
 * params (`layoutMode`, `padding`, `gap`, `horizontal`, `width`, ...) and the
 * one-call nested form (`layout: { mode, sizing, padding, gap, align, wrap }`,
 * `size: { width, height }`). Both funnel through here into the single flat
 * shape the plugin handler expects, so the ordering guarantees (layoutMode
 * before padding/gap, parenting before FILL sizing) live in exactly one place.
 *
 * The nested form wins wherever it speaks; the flat params fill in the rest.
 */

import { z } from "zod";

export type SizingMode = "FIXED" | "HUG" | "FILL";

export interface FrameLayoutInput {
  size?: { width?: number; height?: number };
  layout?: {
    mode?: string;
    sizing?: SizingMode | { horizontal?: SizingMode; vertical?: SizingMode };
    padding?: PaddingShorthand;
    gap?: number;
    align?: { primary?: string; counter?: string };
    wrap?: "NO_WRAP" | "WRAP" | boolean;
  };
  width?: number;
  height?: number;
  layoutMode?: string;
  layoutWrap?: string;
  gap?: number;
  itemSpacing?: number;
  padding?: PaddingShorthand;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  horizontal?: SizingMode;
  vertical?: SizingMode;
  layoutSizingHorizontal?: SizingMode;
  layoutSizingVertical?: SizingMode;
}

export interface ResolvedFrameLayout {
  width: number;
  height: number;
  layoutMode?: string;
  layoutWrap?: string;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  layoutSizingHorizontal?: SizingMode;
  layoutSizingVertical?: SizingMode;
}

/**
 * The ONE padding shorthand dialect this codebase speaks, for every tool that takes a
 * `padding` parameter (`create_frame`, `create_autolayout_frame`, `create_card`,
 * `set_padding`, `set_auto_layout`):
 *
 *   - a number                       -> all four sides
 *   - `[all]` / `[v, h]` / `[t, r, b, l]` / `[t, h, b]` -> CSS shorthand order
 *   - `{ top, right, bottom, left }` and/or `{ vertical, horizontal }`
 *
 * Declaring it in one place is the point: a second dialect is how `padding: 20` came to
 * be accepted by one tool and silently dropped by its sibling.
 */
export const PADDING_SHORTHAND_DESCRIPTION =
  "Padding shorthand: a number (all sides), a CSS-style array ([all] / [vertical, horizontal] / " +
  "[top, horizontal, bottom] / [top, right, bottom, left]), or { top, right, bottom, left } / " +
  "{ vertical, horizontal }. Explicit per-side params override it.";

export type PaddingShorthand = number | Array<number> | Record<string, number | undefined>;

/** Expand a padding shorthand (number, CSS-style array, or object) into four sides. */
export function expandPadding(
  value: PaddingShorthand | undefined,
): { top?: number; right?: number; bottom?: number; left?: number } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return { top: value, right: value, bottom: value, left: value };
  if (Array.isArray(value)) {
    const n = value.map((entry) => (typeof entry === "number" ? entry : Number(entry)));
    // CSS shorthand order, exactly as `padding:` in a stylesheet.
    const [a, b, c, d] = n;
    if (n.length === 0) return undefined;
    if (n.length === 1) return { top: a, right: a, bottom: a, left: a };
    if (n.length === 2) return { top: a, right: b, bottom: a, left: b };
    if (n.length === 3) return { top: a, right: b, bottom: c, left: b };
    return { top: a, right: b, bottom: c, left: d };
  }
  const v = value as Record<string, number | undefined>;
  return {
    top: v.top ?? v.vertical,
    right: v.right ?? v.horizontal,
    bottom: v.bottom ?? v.vertical,
    left: v.left ?? v.horizontal,
  };
}

/** The zod contract for that dialect. Shared by every tool with a `padding` parameter. */
export const paddingShorthandSchema = z.union([
  z.coerce.number().describe("Uniform padding in pixels"),
  z.array(z.coerce.number()).min(1).max(4).describe("CSS-style [all] / [v,h] / [t,h,b] / [t,r,b,l]"),
  z.object({
    top: z.coerce.number().optional(),
    right: z.coerce.number().optional(),
    bottom: z.coerce.number().optional(),
    left: z.coerce.number().optional(),
    vertical: z.coerce.number().optional(),
    horizontal: z.coerce.number().optional(),
  }),
]);

export function resolveFrameLayout(input: FrameLayoutInput): ResolvedFrameLayout {
  const layout = input.layout ?? {};

  const width = input.size?.width ?? input.width ?? 100;
  const height = input.size?.height ?? input.height ?? 100;

  const layoutMode = layout.mode ?? input.layoutMode;

  const wrapRaw = layout.wrap;
  const layoutWrap =
    typeof wrapRaw === "boolean" ? (wrapRaw ? "WRAP" : "NO_WRAP") : (wrapRaw ?? input.layoutWrap ?? undefined);

  const itemSpacing = layout.gap ?? input.gap ?? input.itemSpacing;

  // Nested padding, else the flat per-side params, else the flat uniform `padding`.
  const nested = expandPadding(layout.padding);
  const flat = expandPadding(input.padding);
  const paddingTop = nested?.top ?? input.top ?? input.paddingTop ?? flat?.top;
  const paddingRight = nested?.right ?? input.right ?? input.paddingRight ?? flat?.right;
  const paddingBottom = nested?.bottom ?? input.bottom ?? input.paddingBottom ?? flat?.bottom;
  const paddingLeft = nested?.left ?? input.left ?? input.paddingLeft ?? flat?.left;

  const sizing = layout.sizing;
  const sizingH = typeof sizing === "string" ? sizing : sizing?.horizontal;
  const sizingV = typeof sizing === "string" ? sizing : sizing?.vertical;

  return {
    width,
    height,
    layoutMode,
    layoutWrap,
    itemSpacing,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    primaryAxisAlignItems: layout.align?.primary ?? input.primaryAxisAlignItems,
    counterAxisAlignItems: layout.align?.counter ?? input.counterAxisAlignItems,
    layoutSizingHorizontal: sizingH ?? input.horizontal ?? input.layoutSizingHorizontal,
    layoutSizingVertical: sizingV ?? input.vertical ?? input.layoutSizingVertical,
  };
}
