// Composite handlers — one round trip for shapes that used to take 4-8 calls.
//
// These deliberately do every property write DIRECTLY on the node rather than
// chaining the individual command handlers, so a single failing sub-command
// cannot silently no-op part of the composite.

import { getFontStyle, parseNum } from "../utils/helpers";
import { selectAndFocusNode } from "../utils/plugin-state";
import { resolveColor } from "./fills";
import { createSvg } from "./shapes";

function getParam<T>(params: Record<string, unknown>, key: string, defaultVal: T): T {
  const p = params !== null && params !== undefined ? params[key] : undefined;
  return p !== null && p !== undefined ? (p as T) : defaultVal;
}

function getOptParam<T>(params: Record<string, unknown>, key: string): T | undefined {
  if (params === null || params === undefined) return undefined;
  const p = params[key];
  return p !== null && p !== undefined ? (p as T) : undefined;
}

// ---------------------------------------------------------------------------
// Role presets
//
// House values sourced from the project's own design-system defaults:
//   • fill tokens        → surfaces/utility groups in
//                          src/videntia_figma_mcp/utils/theme-schema.ts
//                          ("card", "popover", "background", "muted", "border")
//   • radius tokens      → the "standard" radius preset in
//                          handlers/layout.ts createRadiusSystem
//                          (sm 4, md 8, lg 12, xl 16, full 9999)
//   • shadow style names → TOKEN_PURPOSE_MAP in tools/document-tools.ts
//                          ("shadow/sm" cards, "shadow/lg" modals & sheets)
//   • padding tokens     → the space/* scale in the same TOKEN_PURPOSE_MAP
//
// Edit this single constant to retune the house style — every
// apply_role_preset / create_card call follows it.
// ---------------------------------------------------------------------------

export interface RolePreset {
  fillVariable?: string;
  fillFallback?: string;
  radiusVariable?: string;
  radiusFallback: number;
  effectStyle?: string;
  strokeVariable?: string;
  strokeWeight?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  itemSpacing?: number;
  minWidth?: number;
  minHeight?: number;
}

export const ROLE_PRESETS: Record<string, RolePreset> = {
  // Content card: surface fill, medium radius, resting card shadow.
  card: {
    fillVariable: "card",
    fillFallback: "#ffffff",
    radiusVariable: "radius/md",
    radiusFallback: 8,
    effectStyle: "shadow/sm",
    padding: { top: 16, right: 16, bottom: 16, left: 16 },
    itemSpacing: 8,
  },
  // Pill / chip / badge: fully rounded, muted fill, no elevation.
  pill: {
    fillVariable: "muted",
    fillFallback: "#f1f1f1",
    radiusVariable: "radius/full",
    radiusFallback: 9999,
    padding: { top: 4, right: 12, bottom: 4, left: 12 },
    itemSpacing: 4,
    minHeight: 24,
  },
  // Bottom sheet / modal surface: large radius, heaviest resting elevation.
  sheet: {
    fillVariable: "popover",
    fillFallback: "#ffffff",
    radiusVariable: "radius/xl",
    radiusFallback: 16,
    effectStyle: "shadow/lg",
    padding: { top: 24, right: 16, bottom: 24, left: 16 },
    itemSpacing: 16,
  },
  // Tap target: 44x44 minimum (WCAG 2.5.5 / platform HIG), small radius.
  "tap-target": {
    radiusVariable: "radius/sm",
    radiusFallback: 4,
    minWidth: 44,
    minHeight: 44,
  },
};

export const ROLE_NAMES = Object.keys(ROLE_PRESETS);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type LayoutNode = FrameNode | ComponentNode | InstanceNode;

/** Resolve a variable by id, then by exact name, then by dash→slash name. */
async function resolveVariable(nameOrId: string): Promise<Variable> {
  let variable: Variable | null = null;
  try {
    variable = await figma.variables.getVariableByIdAsync(nameOrId);
  } catch (_err) {
    variable = null;
  }
  if (variable) return variable;

  const all = await figma.variables.getLocalVariablesAsync();
  variable =
    all.find(function (v) {
      return v.name === nameOrId;
    }) || null;
  if (!variable) {
    const normalized = nameOrId.replace(/-/g, "/");
    if (normalized !== nameOrId) {
      variable =
        all.find(function (v) {
          return v.name === normalized;
        }) || null;
    }
  }
  if (!variable) {
    throw new Error(`Variable not found: "${nameOrId}". Pass a variable ID or name (e.g. "background/primary").`);
  }
  return variable;
}

/** Resolve an effect style by id, exact name, or dash→slash name. */
async function resolveEffectStyle(nameOrId: string): Promise<EffectStyle> {
  let style: BaseStyle | null = null;
  try {
    style = await figma.getStyleByIdAsync(nameOrId);
  } catch (_err) {
    style = null;
  }
  if (style && style.type === "EFFECT") return style as EffectStyle;

  const all = await figma.getLocalEffectStylesAsync();
  let found =
    all.find(function (s) {
      return s.name === nameOrId;
    }) || null;
  if (!found) {
    const normalized = nameOrId.replace(/-/g, "/");
    if (normalized !== nameOrId) {
      found =
        all.find(function (s) {
          return s.name === normalized;
        }) || null;
    }
  }
  if (!found) {
    throw new Error(`Effect style not found: "${nameOrId}". Pass an effect style ID or name (e.g. "shadow/md").`);
  }
  return found;
}

/**
 * Apply a solid fill, binding it to a colour variable when `fillVariable` is
 * given, otherwise using the raw colour. Returns what was actually applied.
 */
async function applyFill(
  node: SceneNode,
  fillVariable: string | undefined,
  rawColor: unknown,
): Promise<Record<string, unknown> | undefined> {
  if (!("fills" in node)) return undefined;

  if (fillVariable) {
    const variable = await resolveVariable(fillVariable);
    const base: SolidPaint = { type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 };
    const bound = figma.variables.setBoundVariableForPaint(base, "color", variable);
    (node as GeometryMixin).fills = [bound];
    return { boundTo: variable.name, variableId: variable.id };
  }

  if (rawColor !== undefined && rawColor !== null) {
    const rgba = resolveColor(
      typeof rawColor === "string" ? { color: rawColor } : (rawColor as Record<string, unknown>),
    );
    const paint: SolidPaint = {
      type: "SOLID",
      color: { r: rgba.r, g: rgba.g, b: rgba.b },
      opacity: rgba.a,
    };
    (node as GeometryMixin).fills = [paint];
    return { color: rgba };
  }
  return undefined;
}

const RADIUS_FIELDS = ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"] as const;

/** Apply a corner radius, binding all four corners when a token name is given. */
async function applyRadius(
  node: SceneNode,
  radiusVariable: string | undefined,
  rawRadius: number | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (radiusVariable) {
    const variable = await resolveVariable(radiusVariable);
    const bindable = node as unknown as {
      setBoundVariable: (field: string, variable: Variable | null) => void;
    };
    for (const field of RADIUS_FIELDS) {
      bindable.setBoundVariable(field, variable);
    }
    return { boundTo: variable.name, variableId: variable.id };
  }
  if (rawRadius !== undefined && "cornerRadius" in node) {
    (node as CornerMixin).cornerRadius = rawRadius;
    return { cornerRadius: rawRadius };
  }
  return undefined;
}

const PADDING_FIELDS: Record<string, string> = {
  top: "paddingTop",
  right: "paddingRight",
  bottom: "paddingBottom",
  left: "paddingLeft",
};

/** Normalise number | {top,right,bottom,left} | {vertical,horizontal} padding. */
function normalizePadding(padding: unknown): { top: number; right: number; bottom: number; left: number } | undefined {
  if (padding === undefined || padding === null) return undefined;
  if (typeof padding === "number") {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  const p = padding as Record<string, unknown>;
  const vertical = p["vertical"] !== undefined ? parseNum(p["vertical"], 0) : undefined;
  const horizontal = p["horizontal"] !== undefined ? parseNum(p["horizontal"], 0) : undefined;
  return {
    top: p["top"] !== undefined ? parseNum(p["top"], 0) : vertical !== undefined ? vertical : 0,
    right: p["right"] !== undefined ? parseNum(p["right"], 0) : horizontal !== undefined ? horizontal : 0,
    bottom: p["bottom"] !== undefined ? parseNum(p["bottom"], 0) : vertical !== undefined ? vertical : 0,
    left: p["left"] !== undefined ? parseNum(p["left"], 0) : horizontal !== undefined ? horizontal : 0,
  };
}

function isLayoutNode(node: BaseNode): node is LayoutNode {
  return node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE";
}

/**
 * Write itemSpacing directly. Figma silently ignores itemSpacing while
 * primaryAxisAlignItems is SPACE_BETWEEN, so that alignment is relaxed first —
 * this is the whole reason agents resorted to transparent spacer rectangles.
 */
function writeItemSpacing(node: LayoutNode, gap: number): { relaxedSpaceBetween: boolean } {
  let relaxed = false;
  if (node.primaryAxisAlignItems === "SPACE_BETWEEN") {
    node.primaryAxisAlignItems = "MIN";
    relaxed = true;
  }
  node.itemSpacing = gap;
  return { relaxedSpaceBetween: relaxed };
}

/** Apply layoutSizing, guarding the cases where Figma rejects the value. */
function writeLayoutSizing(node: LayoutNode, axis: "horizontal" | "vertical", value: string): string | undefined {
  const parent = node.parent;
  const parentIsAutoLayout =
    parent !== null && parent !== undefined && "layoutMode" in parent && (parent as FrameNode).layoutMode !== "NONE";

  if (value === "FILL" && !parentIsAutoLayout) {
    return "FILL requires the parent to use auto-layout — skipped";
  }
  if (value === "HUG" && node.layoutMode === "NONE") {
    return "HUG requires this node to use auto-layout — skipped";
  }
  if (axis === "horizontal") {
    node.layoutSizingHorizontal = value as "FIXED" | "HUG" | "FILL";
  } else {
    node.layoutSizingVertical = value as "FIXED" | "HUG" | "FILL";
  }
  return undefined;
}

async function requireNode(nodeId: string | undefined): Promise<BaseNode> {
  if (!nodeId) throw new Error("Missing nodeId parameter");
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node not found with ID: ${nodeId}`);
  return node;
}

// ---------------------------------------------------------------------------
// create_autolayout_frame
// ---------------------------------------------------------------------------

export async function createAutolayoutFrame(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safe = params !== null && params !== undefined ? params : {};
  const x = getParam<number>(safe, "x", 0);
  const y = getParam<number>(safe, "y", 0);
  const width = getParam<number>(safe, "width", 100);
  const height = getParam<number>(safe, "height", 100);
  const name = getParam<string>(safe, "name", "Frame");
  const parentId = getOptParam<string>(safe, "parentId");
  const layoutMode = getParam<string>(safe, "layoutMode", "VERTICAL");
  const itemSpacing = getOptParam<number>(safe, "itemSpacing");
  const itemSpacingVariable = getOptParam<string>(safe, "itemSpacingVariable");
  const padding = normalizePadding(safe["padding"]);
  const paddingVariable = getOptParam<string>(safe, "paddingVariable");
  const primaryAxisAlignItems = getOptParam<string>(safe, "primaryAxisAlignItems");
  const counterAxisAlignItems = getOptParam<string>(safe, "counterAxisAlignItems");
  const layoutWrap = getOptParam<string>(safe, "layoutWrap");
  const layoutSizingHorizontal = getOptParam<string>(safe, "layoutSizingHorizontal");
  const layoutSizingVertical = getOptParam<string>(safe, "layoutSizingVertical");
  const fillVariable = getOptParam<string>(safe, "fillVariable");
  const cornerRadius = getOptParam<number>(safe, "cornerRadius");
  const radiusVariable = getOptParam<string>(safe, "radiusVariable");
  const effectStyle = getOptParam<string>(safe, "effectStyle");
  const clipsContent = getOptParam<boolean>(safe, "clipsContent");

  const frame = figma.createFrame();
  frame.name = name;
  frame.x = x;
  frame.y = y;
  frame.resize(width, height);
  frame.fills = [];

  const applied: Record<string, unknown> = {};
  const warnings: string[] = [];

  // Parent BEFORE sizing so FILL can see the parent's auto-layout.
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) throw new Error(`Parent node not found with ID: ${parentId}`);
    if (!("appendChild" in parentNode)) throw new Error(`Parent node does not support children: ${parentId}`);
    (parentNode as ChildrenMixin).appendChild(frame);
  } else {
    figma.currentPage.appendChild(frame);
  }

  // Layout mode first — padding/spacing/sizing are all no-ops without it.
  if (layoutMode && layoutMode !== "NONE") {
    frame.layoutMode = layoutMode as "HORIZONTAL" | "VERTICAL";
    applied["layoutMode"] = frame.layoutMode;
  }

  if (layoutWrap && frame.layoutMode === "HORIZONTAL") {
    frame.layoutWrap = layoutWrap as "NO_WRAP" | "WRAP";
    applied["layoutWrap"] = frame.layoutWrap;
  }

  if (padding && frame.layoutMode !== "NONE") {
    frame.paddingTop = padding.top;
    frame.paddingRight = padding.right;
    frame.paddingBottom = padding.bottom;
    frame.paddingLeft = padding.left;
    applied["padding"] = padding;
  } else if (padding) {
    warnings.push("padding ignored — layoutMode is NONE");
  }

  if (paddingVariable && frame.layoutMode !== "NONE") {
    const variable = await resolveVariable(paddingVariable);
    const bindable = frame as unknown as { setBoundVariable: (f: string, v: Variable | null) => void };
    for (const field of Object.keys(PADDING_FIELDS)) {
      bindable.setBoundVariable(PADDING_FIELDS[field], variable);
    }
    applied["paddingVariable"] = variable.name;
  }

  if (itemSpacingVariable && frame.layoutMode !== "NONE") {
    const variable = await resolveVariable(itemSpacingVariable);
    if (frame.primaryAxisAlignItems === "SPACE_BETWEEN") frame.primaryAxisAlignItems = "MIN";
    (frame as unknown as { setBoundVariable: (f: string, v: Variable | null) => void }).setBoundVariable(
      "itemSpacing",
      variable,
    );
    applied["itemSpacingVariable"] = variable.name;
  } else if (itemSpacing !== undefined) {
    if (frame.layoutMode === "NONE") {
      warnings.push("itemSpacing ignored — layoutMode is NONE");
    } else {
      writeItemSpacing(frame, itemSpacing);
      applied["itemSpacing"] = itemSpacing;
    }
  }

  if (primaryAxisAlignItems && frame.layoutMode !== "NONE") {
    frame.primaryAxisAlignItems = primaryAxisAlignItems as "MIN" | "MAX" | "CENTER" | "SPACE_BETWEEN";
    applied["primaryAxisAlignItems"] = primaryAxisAlignItems;
  }
  if (counterAxisAlignItems && frame.layoutMode !== "NONE") {
    frame.counterAxisAlignItems = counterAxisAlignItems as "MIN" | "MAX" | "CENTER" | "BASELINE";
    applied["counterAxisAlignItems"] = counterAxisAlignItems;
  }

  const fillResult = await applyFill(
    frame,
    fillVariable,
    safe["fill"] !== undefined ? safe["fill"] : safe["fillColor"],
  );
  if (fillResult) applied["fill"] = fillResult;

  const radiusResult = await applyRadius(frame, radiusVariable, cornerRadius);
  if (radiusResult) applied["radius"] = radiusResult;

  if (effectStyle) {
    const style = await resolveEffectStyle(effectStyle);
    await frame.setEffectStyleIdAsync(style.id);
    applied["effectStyle"] = style.name;
  }

  if (clipsContent !== undefined) {
    frame.clipsContent = clipsContent;
    applied["clipsContent"] = clipsContent;
  }

  // Sizing last: HUG/FILL must be applied after layoutMode and parenting.
  if (layoutSizingHorizontal) {
    const warn = writeLayoutSizing(frame, "horizontal", layoutSizingHorizontal);
    if (warn) warnings.push(`layoutSizingHorizontal: ${warn}`);
    else applied["layoutSizingHorizontal"] = layoutSizingHorizontal;
  }
  if (layoutSizingVertical) {
    const warn = writeLayoutSizing(frame, "vertical", layoutSizingVertical);
    if (warn) warnings.push(`layoutSizingVertical: ${warn}`);
    else applied["layoutSizingVertical"] = layoutSizingVertical;
  }

  selectAndFocusNode(frame);

  return {
    id: frame.id,
    name: frame.name,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    parentId: frame.parent ? frame.parent.id : undefined,
    applied,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// create_styled_text
// ---------------------------------------------------------------------------

export async function createStyledText(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safe = params !== null && params !== undefined ? params : {};
  const x = getParam<number>(safe, "x", 0);
  const y = getParam<number>(safe, "y", 0);
  const text = getParam<string>(safe, "text", "Text");
  const name = getOptParam<string>(safe, "name");
  const parentId = getOptParam<string>(safe, "parentId");
  const textStyle = getOptParam<string>(safe, "textStyle");
  const fontFamily = getParam<string>(safe, "fontFamily", "Inter");
  const fontWeight = getParam<number>(safe, "fontWeight", 400);
  const fontSize = getOptParam<number>(safe, "fontSize");
  const fillVariable = getOptParam<string>(safe, "fillVariable");
  const textAlignHorizontal = getOptParam<string>(safe, "textAlignHorizontal");
  const layoutSizingHorizontal = getOptParam<string>(safe, "layoutSizingHorizontal");

  const applied: Record<string, unknown> = {};
  const warnings: string[] = [];

  // Resolve the text style up front so its font is loaded BEFORE any text is
  // written — the single most common trip-up when doing this in separate calls.
  let resolvedStyle: TextStyle | undefined;
  if (textStyle) {
    let style: BaseStyle | null = null;
    try {
      style = await figma.getStyleByIdAsync(textStyle);
    } catch (_err) {
      style = null;
    }
    if (!style || style.type !== "TEXT") {
      const all = await figma.getLocalTextStylesAsync();
      let found =
        all.find(function (s) {
          return s.name === textStyle;
        }) || null;
      if (!found) {
        const normalized = textStyle.replace(/-/g, "/");
        if (normalized !== textStyle) {
          found =
            all.find(function (s) {
              return s.name === normalized;
            }) || null;
        }
      }
      style = found;
    }
    if (!style || style.type !== "TEXT") {
      throw new Error(
        `Text style not found: "${textStyle}". Pass a style ID or name (e.g. "text/body/md") from get_text_styles.`,
      );
    }
    resolvedStyle = style as TextStyle;
    await figma.loadFontAsync(resolvedStyle.fontName);
  } else {
    await figma.loadFontAsync({ family: fontFamily, style: getFontStyle(fontWeight) });
  }

  const node = figma.createText();
  node.x = x;
  node.y = y;
  node.name = name !== undefined ? name : text.slice(0, 40) || "Text";

  if (!resolvedStyle) {
    node.fontName = { family: fontFamily, style: getFontStyle(fontWeight) };
    if (fontSize !== undefined) node.fontSize = fontSize;
    applied["fontName"] = node.fontName;
  }

  node.characters = text;

  if (resolvedStyle) {
    await node.setTextStyleIdAsync(resolvedStyle.id);
    applied["textStyle"] = resolvedStyle.name;
    if (fontSize !== undefined) {
      warnings.push("fontSize ignored — the text style controls font size");
    }
  }

  if (textAlignHorizontal) {
    node.textAlignHorizontal = textAlignHorizontal as "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
    applied["textAlignHorizontal"] = textAlignHorizontal;
  }

  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) throw new Error(`Parent node not found with ID: ${parentId}`);
    if (!("appendChild" in parentNode)) throw new Error(`Parent node does not support children: ${parentId}`);
    (parentNode as ChildrenMixin).appendChild(node);
  } else {
    figma.currentPage.appendChild(node);
  }

  const fillResult = await applyFill(node, fillVariable, safe["fill"] !== undefined ? safe["fill"] : safe["fontColor"]);
  if (fillResult) applied["fill"] = fillResult;

  if (layoutSizingHorizontal) {
    const parent = node.parent;
    const parentIsAutoLayout =
      parent !== null && parent !== undefined && "layoutMode" in parent && (parent as FrameNode).layoutMode !== "NONE";
    if (layoutSizingHorizontal === "FILL" && !parentIsAutoLayout) {
      warnings.push("layoutSizingHorizontal: FILL requires the parent to use auto-layout — skipped");
    } else {
      node.layoutSizingHorizontal = layoutSizingHorizontal as "FIXED" | "HUG" | "FILL";
      applied["layoutSizingHorizontal"] = layoutSizingHorizontal;
    }
  }

  selectAndFocusNode(node);

  return {
    id: node.id,
    name: node.name,
    characters: node.characters,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    parentId: node.parent ? node.parent.id : undefined,
    applied,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// set_gap
// ---------------------------------------------------------------------------

export async function setGap(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safe = params !== null && params !== undefined ? params : {};
  const nodeId = getOptParam<string>(safe, "nodeId");
  const gap = getOptParam<number>(safe, "gap");
  const gapVariable = getOptParam<string>(safe, "gapVariable");
  const counterAxisSpacing = getOptParam<number>(safe, "counterAxisSpacing");

  if (gap === undefined && gapVariable === undefined) {
    throw new Error('Provide either gap (pixels) or gapVariable (a spacing token name, e.g. "space/4")');
  }

  const node = await requireNode(nodeId);
  if (!isLayoutNode(node)) {
    throw new Error(`Node does not support auto-layout spacing: ${nodeId} (type ${node.type})`);
  }
  const layoutNode = node as LayoutNode;
  if (layoutNode.layoutMode === "NONE") {
    throw new Error(
      `Node "${layoutNode.name}" has no auto-layout, so there is no gap to set. Call set_layout_mode (or create the frame with create_autolayout_frame) first.`,
    );
  }

  const result: Record<string, unknown> = { id: layoutNode.id, name: layoutNode.name };

  if (gapVariable !== undefined) {
    const variable = await resolveVariable(gapVariable);
    if (layoutNode.primaryAxisAlignItems === "SPACE_BETWEEN") {
      layoutNode.primaryAxisAlignItems = "MIN";
      result["relaxedSpaceBetween"] = true;
    }
    (layoutNode as unknown as { setBoundVariable: (f: string, v: Variable | null) => void }).setBoundVariable(
      "itemSpacing",
      variable,
    );
    result["boundTo"] = variable.name;
  } else {
    const written = writeItemSpacing(layoutNode, gap as number);
    if (written.relaxedSpaceBetween) result["relaxedSpaceBetween"] = true;
  }

  if (counterAxisSpacing !== undefined && layoutNode.layoutWrap === "WRAP") {
    layoutNode.counterAxisSpacing = counterAxisSpacing;
    result["counterAxisSpacing"] = counterAxisSpacing;
  }

  result["itemSpacing"] = layoutNode.itemSpacing;
  return result;
}

// ---------------------------------------------------------------------------
// create_card
// ---------------------------------------------------------------------------

export async function createCard(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safe = params !== null && params !== undefined ? params : {};
  const preset = ROLE_PRESETS["card"];

  const merged: Record<string, unknown> = {
    x: getParam<number>(safe, "x", 0),
    y: getParam<number>(safe, "y", 0),
    width: getParam<number>(safe, "width", 320),
    height: getParam<number>(safe, "height", 160),
    name: getParam<string>(safe, "name", "Card"),
    parentId: getOptParam<string>(safe, "parentId"),
    layoutMode: getParam<string>(safe, "layoutMode", "VERTICAL"),
    padding: safe["padding"] !== undefined ? safe["padding"] : preset.padding,
    paddingVariable: getOptParam<string>(safe, "paddingVariable"),
    itemSpacing: getParam<number>(safe, "itemSpacing", preset.itemSpacing as number),
    itemSpacingVariable: getOptParam<string>(safe, "itemSpacingVariable"),
    layoutSizingHorizontal: getOptParam<string>(safe, "layoutSizingHorizontal"),
    layoutSizingVertical: getOptParam<string>(safe, "layoutSizingVertical"),
    clipsContent: getOptParam<boolean>(safe, "clipsContent"),
  };

  // Fill: explicit token → explicit raw colour → house token → house fallback.
  const fillVariable = getOptParam<string>(safe, "fillVariable");
  const rawFill = safe["fill"] !== undefined ? safe["fill"] : safe["fillColor"];
  if (fillVariable) merged["fillVariable"] = fillVariable;
  else if (rawFill !== undefined) merged["fill"] = rawFill;
  else merged["fillVariable"] = preset.fillVariable;

  const radiusVariable = getOptParam<string>(safe, "radiusVariable");
  const cornerRadius = getOptParam<number>(safe, "cornerRadius");
  if (radiusVariable) merged["radiusVariable"] = radiusVariable;
  else if (cornerRadius !== undefined) merged["cornerRadius"] = cornerRadius;
  else merged["radiusVariable"] = preset.radiusVariable;

  const effectStyle = safe["effectStyle"] !== undefined ? (safe["effectStyle"] as string | null) : preset.effectStyle;

  // Tokens may not exist in every file — fall back rather than failing the card.
  const warnings: string[] = [];
  let result: Record<string, unknown>;
  try {
    if (effectStyle) merged["effectStyle"] = effectStyle;
    result = await createAutolayoutFrame(merged);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`House token unavailable (${message}) — fell back to literal values`);
    delete merged["fillVariable"];
    delete merged["radiusVariable"];
    delete merged["effectStyle"];
    merged["fill"] = rawFill !== undefined ? rawFill : preset.fillFallback;
    merged["cornerRadius"] = cornerRadius !== undefined ? cornerRadius : preset.radiusFallback;
    result = await createAutolayoutFrame(merged);
  }

  const existingWarnings = Array.isArray(result["warnings"]) ? (result["warnings"] as string[]) : [];
  result["warnings"] = existingWarnings.concat(warnings);
  result["role"] = "card";
  return result;
}

// ---------------------------------------------------------------------------
// bulk_bind_variables
// ---------------------------------------------------------------------------

/**
 * Bind a variable to one node field. Mirrors bind_variable's resolution rules
 * (id, exact name, dash→slash name) but avoids a round trip per binding.
 */
async function bindOne(binding: Record<string, unknown>, index: number): Promise<Record<string, unknown>> {
  const nodeId = binding["nodeId"] as string | undefined;
  const field = binding["field"] as string | undefined;
  const variableRef = (binding["variable"] !== undefined ? binding["variable"] : binding["variableId"]) as
    | string
    | undefined;

  if (!nodeId || !field || !variableRef) {
    return { index, success: false, error: "Each binding needs nodeId, field and variable" };
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) throw new Error(`Node not found with ID: ${nodeId}`);
    const variable = await resolveVariable(variableRef);

    if (field === "fills" || field === "fill") {
      const geometry = node as unknown as GeometryMixin;
      if (!("fills" in node)) throw new Error(`Node does not support fills: ${nodeId}`);
      const currentFills = geometry.fills;
      const existing =
        Array.isArray(currentFills) && currentFills.length > 0 && currentFills[0].type === "SOLID"
          ? (currentFills[0] as SolidPaint)
          : ({ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 } as SolidPaint);
      geometry.fills = [figma.variables.setBoundVariableForPaint(existing, "color", variable)];
    } else if (field === "strokes" || field === "stroke") {
      const geometry = node as unknown as GeometryMixin;
      if (!("strokes" in node)) throw new Error(`Node does not support strokes: ${nodeId}`);
      const currentStrokes = geometry.strokes;
      const existing =
        Array.isArray(currentStrokes) && currentStrokes.length > 0 && currentStrokes[0].type === "SOLID"
          ? (currentStrokes[0] as SolidPaint)
          : ({ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 } as SolidPaint);
      geometry.strokes = [figma.variables.setBoundVariableForPaint(existing, "color", variable)];
    } else if (field === "cornerRadius") {
      const bindable = node as unknown as { setBoundVariable: (f: string, v: Variable | null) => void };
      for (const radiusField of RADIUS_FIELDS) {
        bindable.setBoundVariable(radiusField, variable);
      }
    } else {
      const bindable = node as unknown as { setBoundVariable: (f: string, v: Variable | null) => void };
      bindable.setBoundVariable(field, variable);
    }

    return {
      index,
      success: true,
      nodeId,
      nodeName: node.name,
      field,
      variableId: variable.id,
      variableName: variable.name,
    };
  } catch (err) {
    return {
      index,
      success: false,
      nodeId,
      field,
      variable: variableRef,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function bulkBindVariables(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safe = params !== null && params !== undefined ? params : {};
  const bindings = safe["bindings"];
  if (!Array.isArray(bindings) || bindings.length === 0) {
    throw new Error("Missing or empty bindings array — pass [{ nodeId, field, variable }, ...]");
  }

  const results: Record<string, unknown>[] = [];
  for (let i = 0; i < bindings.length; i++) {
    results.push(await bindOne(bindings[i] as Record<string, unknown>, i));
  }

  const succeeded = results.filter(function (r) {
    return r["success"] === true;
  }).length;

  return {
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  };
}

// ---------------------------------------------------------------------------
// clone_and_place
// ---------------------------------------------------------------------------

export async function cloneAndPlace(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safe = params !== null && params !== undefined ? params : {};
  const nodeId = getOptParam<string>(safe, "nodeId");
  const name = getOptParam<string>(safe, "name");
  const parentId = getOptParam<string>(safe, "parentId");
  const index = getOptParam<number>(safe, "index");
  const x = getOptParam<number>(safe, "x");
  const y = getOptParam<number>(safe, "y");

  const node = await requireNode(nodeId);
  const clone = (node as SceneNode).clone();

  if (name !== undefined) clone.name = name;

  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) throw new Error(`Parent node not found with ID: ${parentId}`);
    if (!("children" in parentNode)) throw new Error(`Parent node does not support children: ${parentId}`);
    const container = parentNode as FrameNode;
    if (index !== undefined) container.insertChild(index, clone);
    else container.appendChild(clone);
  } else if (!(node as SceneNode).parent) {
    figma.currentPage.appendChild(clone);
  }

  const warnings: string[] = [];
  if (x !== undefined || y !== undefined) {
    const cloneParent = clone.parent;
    const parentIsAutoLayout =
      cloneParent !== null &&
      cloneParent !== undefined &&
      "layoutMode" in cloneParent &&
      (cloneParent as FrameNode).layoutMode !== "NONE";
    if (parentIsAutoLayout && "layoutPositioning" in clone) {
      (clone as unknown as { layoutPositioning: string }).layoutPositioning = "ABSOLUTE";
      warnings.push("Parent uses auto-layout — the clone was set to ABSOLUTE positioning so x/y apply");
    }
    if (x !== undefined) (clone as FrameNode).x = x;
    if (y !== undefined) (clone as FrameNode).y = y;
  }

  selectAndFocusNode(clone);

  return {
    id: clone.id,
    name: clone.name,
    sourceId: node.id,
    x: "x" in clone ? (clone as FrameNode).x : undefined,
    y: "y" in clone ? (clone as FrameNode).y : undefined,
    width: "width" in clone ? (clone as FrameNode).width : undefined,
    height: "height" in clone ? (clone as FrameNode).height : undefined,
    parentId: clone.parent ? clone.parent.id : undefined,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// apply_role_preset
// ---------------------------------------------------------------------------

export async function applyRolePreset(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safe = params !== null && params !== undefined ? params : {};
  const nodeId = getOptParam<string>(safe, "nodeId");
  const role = getOptParam<string>(safe, "role");

  if (!role || !ROLE_PRESETS[role]) {
    throw new Error(`Unknown role "${role}". Supported roles: ${ROLE_NAMES.join(", ")}`);
  }
  const preset = ROLE_PRESETS[role];
  const node = (await requireNode(nodeId)) as SceneNode;

  const applied: Record<string, unknown> = {};
  const warnings: string[] = [];

  if (preset.fillVariable) {
    try {
      const fillResult = await applyFill(node, preset.fillVariable, undefined);
      if (fillResult) applied["fill"] = fillResult;
    } catch (err) {
      const fallback = await applyFill(node, undefined, preset.fillFallback);
      if (fallback) applied["fill"] = fallback;
      warnings.push(`Fill token "${preset.fillVariable}" not found — applied literal ${preset.fillFallback} instead`);
    }
  }

  if (preset.radiusVariable) {
    try {
      const radiusResult = await applyRadius(node, preset.radiusVariable, undefined);
      if (radiusResult) applied["radius"] = radiusResult;
    } catch (err) {
      const fallback = await applyRadius(node, undefined, preset.radiusFallback);
      if (fallback) applied["radius"] = fallback;
      warnings.push(
        `Radius token "${preset.radiusVariable}" not found — applied literal ${preset.radiusFallback}px instead`,
      );
    }
  }

  if (preset.effectStyle && "effectStyleId" in node) {
    try {
      const style = await resolveEffectStyle(preset.effectStyle);
      await (node as FrameNode).setEffectStyleIdAsync(style.id);
      applied["effectStyle"] = style.name;
    } catch (err) {
      warnings.push(`Effect style "${preset.effectStyle}" not found — no shadow applied`);
    }
  }

  if (isLayoutNode(node)) {
    const layoutNode = node as LayoutNode;
    if (layoutNode.layoutMode !== "NONE") {
      if (preset.padding) {
        layoutNode.paddingTop = preset.padding.top;
        layoutNode.paddingRight = preset.padding.right;
        layoutNode.paddingBottom = preset.padding.bottom;
        layoutNode.paddingLeft = preset.padding.left;
        applied["padding"] = preset.padding;
      }
      if (preset.itemSpacing !== undefined) {
        writeItemSpacing(layoutNode, preset.itemSpacing);
        applied["itemSpacing"] = preset.itemSpacing;
      }
    } else if (preset.padding || preset.itemSpacing !== undefined) {
      warnings.push("Padding/spacing skipped — the node has no auto-layout (set_layout_mode first)");
    }
    if (preset.minWidth !== undefined) {
      layoutNode.minWidth = preset.minWidth;
      applied["minWidth"] = preset.minWidth;
    }
    if (preset.minHeight !== undefined) {
      layoutNode.minHeight = preset.minHeight;
      applied["minHeight"] = preset.minHeight;
    }
  } else if (preset.minWidth !== undefined || preset.minHeight !== undefined) {
    // Non-layout nodes have no min sizing — enforce by resizing instead.
    if ("resize" in node) {
      const width = Math.max(node.width, preset.minWidth !== undefined ? preset.minWidth : 0);
      const height = Math.max(node.height, preset.minHeight !== undefined ? preset.minHeight : 0);
      if (width !== node.width || height !== node.height) {
        (node as unknown as { resize: (w: number, h: number) => void }).resize(width, height);
        applied["resizedTo"] = { width, height };
      }
    }
  }

  return {
    id: node.id,
    name: node.name,
    role,
    applied,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// bind_many — many fields on ONE node, in one round trip.
//
// Ergonomic sibling of bulk_bind_variables: the measured agent pattern is
// binding 2-4 fields on a single node (fills + cornerRadius + itemSpacing),
// not one field across many nodes. Both spellings funnel into `bindOne`.
// ---------------------------------------------------------------------------

export async function bindMany(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safe = params !== null && params !== undefined ? params : {};
  const defaultNodeId = getOptParam<string>(safe, "nodeId");
  const raw = safe["bindings"];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("Missing or empty bindings array — pass [{ field, variable }, ...] with a nodeId");
  }

  const normalized = raw.map(function (entry) {
    const b = entry as Record<string, unknown>;
    return {
      nodeId: b["nodeId"] !== undefined && b["nodeId"] !== null ? b["nodeId"] : defaultNodeId,
      field: b["field"],
      variable: b["variable"] !== undefined ? b["variable"] : b["variableId"],
    } as Record<string, unknown>;
  });

  return await bulkBindVariables({ bindings: normalized });
}

// ---------------------------------------------------------------------------
// create_texts — N styled text nodes into one parent, one round trip.
// ---------------------------------------------------------------------------

export async function createTexts(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safe = params !== null && params !== undefined ? params : {};
  const parentId = getOptParam<string>(safe, "parentId");
  const items = safe["items"] !== undefined ? safe["items"] : safe["texts"];
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Missing or empty items array — pass [{ text, ... }, ...]");
  }

  const ids: string[] = [];
  const results: Record<string, unknown>[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = Object.assign({}, items[i] as Record<string, unknown>);
    if (item["parentId"] === undefined || item["parentId"] === null) item["parentId"] = parentId;
    try {
      const created = await createStyledText(item);
      ids.push(created["id"] as string);
      results.push({ index: i, success: true, id: created["id"], name: created["name"] });
    } catch (err) {
      results.push({ index: i, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const succeeded = results.filter(function (r) {
    return r["success"] === true;
  }).length;
  return { total: results.length, succeeded, failed: results.length - succeeded, ids, results };
}

// ---------------------------------------------------------------------------
// create_svgs — N SVG nodes into one parent, one round trip.
// ---------------------------------------------------------------------------

export async function createSvgs(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safe = params !== null && params !== undefined ? params : {};
  const parentId = getOptParam<string>(safe, "parentId");
  const items = safe["items"] !== undefined ? safe["items"] : safe["svgs"];
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Missing or empty items array — pass [{ svgString, ... }, ...]");
  }

  const ids: string[] = [];
  const results: Record<string, unknown>[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = Object.assign({}, items[i] as Record<string, unknown>);
    if (item["parentId"] === undefined || item["parentId"] === null) item["parentId"] = parentId;
    try {
      const created = (await createSvg(item)) as Record<string, unknown>;
      ids.push(created["id"] as string);
      results.push({ index: i, success: true, id: created["id"], name: created["name"] });
    } catch (err) {
      results.push({ index: i, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const succeeded = results.filter(function (r) {
    return r["success"] === true;
  }).length;
  return { total: results.length, succeeded, failed: results.length - succeeded, ids, results };
}

// ---------------------------------------------------------------------------
// insert_children — reparent N nodes into one parent, one round trip.
// ---------------------------------------------------------------------------

export async function insertChildren(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safe = params !== null && params !== undefined ? params : {};
  const parentId = getOptParam<string>(safe, "parentId");
  if (!parentId) throw new Error("Missing parentId parameter");
  const raw = safe["childIds"] !== undefined ? safe["childIds"] : safe["ids"];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("Missing or empty childIds array");
  }
  const startIndex = getOptParam<number>(safe, "index");

  const parent = await figma.getNodeByIdAsync(parentId);
  if (!parent) throw new Error(`Parent node not found with ID: ${parentId}`);
  if (!("appendChild" in parent)) throw new Error(`Parent node does not support children: ${parentId}`);
  const container = parent as FrameNode;

  const results: Record<string, unknown>[] = [];
  const inserted: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const childId = String(raw[i]);
    try {
      const child = await figma.getNodeByIdAsync(childId);
      if (!child) throw new Error(`Child node not found with ID: ${childId}`);
      const scene = child as SceneNode;
      if (startIndex !== undefined && startIndex >= 0) {
        const at = Math.min(startIndex + i, container.children.length);
        container.insertChild(at, scene);
      } else {
        container.appendChild(scene);
      }
      inserted.push(childId);
      results.push({ index: i, success: true, childId, name: scene.name });
    } catch (err) {
      results.push({ index: i, success: false, childId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const succeeded = inserted.length;
  return {
    parentId,
    parentName: container.name,
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    inserted,
    results,
  };
}

// ---------------------------------------------------------------------------
// move_nodes — reposition / reparent N nodes, one round trip.
// ---------------------------------------------------------------------------

export async function moveNodes(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safe = params !== null && params !== undefined ? params : {};
  const moves = safe["moves"];
  if (!Array.isArray(moves) || moves.length === 0) {
    throw new Error("Missing or empty moves array — pass [{ nodeId, x, y, parentId?, index? }, ...]");
  }

  const results: Record<string, unknown>[] = [];
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i] as Record<string, unknown>;
    const nodeId = move["nodeId"] as string | undefined;
    try {
      if (!nodeId) throw new Error("Each move needs a nodeId");
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error(`Node not found with ID: ${nodeId}`);
      const scene = node as SceneNode;

      const newParentId = move["parentId"] as string | undefined;
      if (newParentId) {
        const parent = await figma.getNodeByIdAsync(newParentId);
        if (!parent) throw new Error(`Parent node not found with ID: ${newParentId}`);
        if (!("appendChild" in parent)) throw new Error(`Parent node does not support children: ${newParentId}`);
        const container = parent as FrameNode;
        const idx = move["index"] as number | undefined;
        if (idx !== undefined && idx !== null && idx >= 0 && idx <= container.children.length) {
          container.insertChild(idx, scene);
        } else {
          container.appendChild(scene);
        }
      }

      const x = move["x"];
      const y = move["y"];
      if (x !== undefined && x !== null) scene.x = parseNum(x, scene.x);
      if (y !== undefined && y !== null) scene.y = parseNum(y, scene.y);

      results.push({
        index: i,
        success: true,
        nodeId,
        name: scene.name,
        x: scene.x,
        y: scene.y,
        parentId: scene.parent ? scene.parent.id : undefined,
      });
    } catch (err) {
      results.push({ index: i, success: false, nodeId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const succeeded = results.filter(function (r) {
    return r["success"] === true;
  }).length;
  return { total: results.length, succeeded, failed: results.length - succeeded, results };
}
