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

export type SizingMode = "FIXED" | "HUG" | "FILL";

export interface FrameLayoutInput {
  size?: { width?: number; height?: number };
  layout?: {
    mode?: string;
    sizing?: SizingMode | { horizontal?: SizingMode; vertical?: SizingMode };
    padding?: number | Record<string, number | undefined>;
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
  padding?: number;
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

/** Expand a padding value (number, or an object with any of the six keys) into four sides. */
export function expandPadding(
  value: number | Record<string, number | undefined> | undefined,
): { top?: number; right?: number; bottom?: number; left?: number } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return { top: value, right: value, bottom: value, left: value };
  const v = value as Record<string, number | undefined>;
  return {
    top: v.top ?? v.vertical,
    right: v.right ?? v.horizontal,
    bottom: v.bottom ?? v.vertical,
    left: v.left ?? v.horizontal,
  };
}

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
