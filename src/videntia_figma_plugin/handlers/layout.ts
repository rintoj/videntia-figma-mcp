import { findCollection } from "./variables";
import { loadTextNodeFonts } from "../utils/helpers";

// ---------------------------------------------------------------------------
// Layout system creation
// ---------------------------------------------------------------------------

export async function createSpacingSystem(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const collection_id = params["collection_id"] as string;
  if (!collection_id) throw new Error("Missing collection_id parameter");
  const preset = params["preset"] as string;

  const collection = await findCollection(collection_id);
  if (!collection.modes.length) throw new Error("Collection has no modes");

  const presets: Record<string, Record<number, number>> = {
    "8pt": {
      0: 0,
      1: 4,
      2: 8,
      3: 12,
      4: 16,
      5: 20,
      6: 24,
      7: 28,
      8: 32,
      10: 40,
      12: 48,
      16: 64,
      20: 80,
      24: 96,
      32: 128,
      40: 160,
      48: 192,
      56: 224,
      64: 256,
    },
    "4pt": {
      0: 0,
      1: 4,
      2: 8,
      3: 12,
      4: 16,
      5: 20,
      6: 24,
      7: 28,
      8: 32,
      9: 36,
      10: 40,
      11: 44,
      12: 48,
      14: 56,
      16: 64,
      20: 80,
      24: 96,
      28: 112,
      32: 128,
    },
    tailwind: {
      0: 0,
      1: 4,
      2: 8,
      3: 12,
      4: 16,
      5: 20,
      6: 24,
      8: 32,
      10: 40,
      12: 48,
      16: 64,
      20: 80,
      24: 96,
      32: 128,
      40: 160,
      48: 192,
      64: 256,
    },
    material: { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96 },
  };

  const spacingValues = preset !== null && preset !== undefined && presets[preset] ? presets[preset] : presets["8pt"];
  const variables: string[] = [];

  for (const [key, value] of Object.entries(spacingValues)) {
    const variable = figma.variables.createVariable(`spacing/${key}`, collection, "FLOAT");
    const mode = collection.modes[0];
    variable.setValueForMode(mode.modeId, value);
    variables.push(`spacing/${key}`);
  }

  return {
    success: true,
    primitiveCount: variables.length,
    primitiveVariables: variables,
    preset: preset,
  };
}

export async function createTypographySystem(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const collection_id = params["collection_id"] as string;
  if (!collection_id) throw new Error("Missing collection_id parameter");
  const scale_preset = params["scale_preset"] as string;
  const base_size = params["base_size"] as number | undefined;
  const include_weights = params["include_weights"] as boolean | undefined;
  const include_line_heights = params["include_line_heights"] as boolean | undefined;

  const collection = await findCollection(collection_id);
  if (!collection.modes.length) throw new Error("Collection has no modes");

  const ratios: Record<string, number> = {
    "minor-third": 1.2,
    "major-third": 1.25,
    "perfect-fourth": 1.333,
  };

  const ratio =
    scale_preset !== null && scale_preset !== undefined && ratios[scale_preset] ? ratios[scale_preset] : 1.25;
  const base = base_size !== null && base_size !== undefined ? base_size : 16;
  const variables: string[] = [];

  const sizes: Record<string, number> = {
    xs: base / (ratio * ratio),
    sm: base / ratio,
    base: base,
    lg: base * ratio,
    xl: base * ratio * ratio,
    "2xl": base * ratio * ratio * ratio,
    "3xl": base * ratio * ratio * ratio * ratio,
    "4xl": base * ratio * ratio * ratio * ratio * ratio,
    "5xl": base * ratio * ratio * ratio * ratio * ratio * ratio,
  };

  const mode = collection.modes[0];

  for (const [key, value] of Object.entries(sizes)) {
    const variable = figma.variables.createVariable(`font.size.${key}`, collection, "FLOAT");
    variable.setValueForMode(mode.modeId, Math.round(value));
    variables.push(`font.size.${key}`);
  }

  if (include_weights) {
    const weights: Record<string, number> = {
      thin: 100,
      extralight: 200,
      light: 300,
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      extrabold: 800,
      black: 900,
    };
    for (const [key, value] of Object.entries(weights)) {
      const variable = figma.variables.createVariable(`font.weight.${key}`, collection, "FLOAT");
      variable.setValueForMode(mode.modeId, value);
      variables.push(`font.weight.${key}`);
    }
  }

  if (include_line_heights) {
    const lineHeights: Record<string, number> = {
      none: 1,
      tight: 1.25,
      snug: 1.375,
      normal: 1.5,
      relaxed: 1.625,
      loose: 2,
    };
    for (const [key, value] of Object.entries(lineHeights)) {
      const variable = figma.variables.createVariable(`font.lineHeight.${key}`, collection, "FLOAT");
      variable.setValueForMode(mode.modeId, value);
      variables.push(`font.lineHeight.${key}`);
    }
  }

  return {
    success: true,
    totalVariables: variables.length,
    variables: variables,
    preset: scale_preset,
  };
}

export async function createRadiusSystem(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const collection_id = params["collection_id"] as string;
  if (!collection_id) throw new Error("Missing collection_id parameter");
  const preset = params["preset"] as string;

  const collection = await findCollection(collection_id);
  if (!collection.modes.length) throw new Error("Collection has no modes");

  const presets: Record<string, Record<string, number>> = {
    standard: { none: 0, sm: 4, md: 8, lg: 12, xl: 16, "2xl": 24, "3xl": 32, full: 9999 },
    subtle: { none: 0, sm: 2, md: 4, lg: 6, xl: 8, "2xl": 12, "3xl": 16, full: 9999 },
    bold: { none: 0, sm: 8, md: 16, lg: 24, xl: 32, "2xl": 48, "3xl": 64, full: 9999 },
  };

  const radiusValues =
    preset !== null && preset !== undefined && presets[preset] ? presets[preset] : presets["standard"];
  const variables: string[] = [];
  const mode = collection.modes[0];

  for (const [key, value] of Object.entries(radiusValues)) {
    const variable = figma.variables.createVariable(`radius/${key}`, collection, "FLOAT");
    variable.setValueForMode(mode.modeId, value);
    variables.push(`radius/${key}`);
  }

  return {
    success: true,
    totalVariables: variables.length,
    variables: variables,
    preset: preset,
  };
}

// ---------------------------------------------------------------------------
// Auto-layout individual commands
// ---------------------------------------------------------------------------

type AutoLayoutNode = FrameNode | ComponentNode | InstanceNode | ComponentSetNode;

function isAutoLayoutNode(node: BaseNode): node is AutoLayoutNode {
  return (
    node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE" || node.type === "COMPONENT_SET"
  );
}

const CLIPPABLE_NODE_TYPES = new Set(["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"]);

export async function setClipsContent(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params ? (params["nodeId"] as string | undefined) : undefined;
  const clipsContent = params ? params["clipsContent"] : undefined;

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (typeof clipsContent !== "boolean") {
    throw new Error("Missing clipsContent parameter (must be a boolean)");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }
  if (!CLIPPABLE_NODE_TYPES.has(node.type)) {
    throw new Error(
      `Node "${node.name}" does not support clipsContent (type: ${node.type}); supported types: FRAME, COMPONENT, COMPONENT_SET, INSTANCE`,
    );
  }

  const frame = node as FrameNode;
  frame.clipsContent = clipsContent;

  return { id: frame.id, name: frame.name, clipsContent: frame.clipsContent };
}

// Layout handlers read their internal param names but also accept the public MCP
// tool names, so a raw batch action can't silently no-op on a naming mismatch.
function paramAlias(params: Record<string, unknown>, internalName: string, publicName: string): unknown {
  return params[internalName] !== undefined ? params[internalName] : params[publicName];
}

export async function setLayoutMode(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params["nodeId"] as string;
  const layoutMode = paramAlias(params, "layoutMode", "mode") as string | undefined;
  const layoutWrap = paramAlias(params, "layoutWrap", "wrap") as string | undefined;

  if (layoutMode === undefined) {
    throw new Error("Missing layout mode — pass mode (NONE, HORIZONTAL, VERTICAL or GRID). No changes were made.");
  }

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  if (!isAutoLayoutNode(node)) {
    throw new Error(`Node "${node.name}" does not support auto layout (type: ${node.type})`);
  }

  const frame = node as FrameNode;
  // Mode must be assigned before the grid track counts — they are only writable
  // once the frame is actually a grid. But only write it when it's actually
  // changing: reassigning layoutMode — even to its current value — resets the
  // frame's layoutSizingHorizontal/Vertical (and thus item spacing/padding
  // rendering) back to their defaults as a side effect, silently clobbering
  // whatever set_layout_sizing/set_item_spacing already set.
  if (frame.layoutMode !== layoutMode) {
    frame.layoutMode = layoutMode as "NONE" | "HORIZONTAL" | "VERTICAL" | "GRID";
  }

  if (layoutMode === "GRID") {
    // layoutWrap is a flex-wrap concept and does not apply to grids.
    const gridRowCount = paramAlias(params, "gridRowCount", "rows") as number | undefined;
    const gridColumnCount = paramAlias(params, "gridColumnCount", "columns") as number | undefined;
    const gridAutoTracks = params["gridAutoTracks"] as string | undefined;
    const gridItemsPositioning = params["gridItemsPositioning"] as string | undefined;

    // gridAutoTracks must be set before gridRowCount/gridColumnCount when set to
    // "ROWS": Figma throws if you try to write gridRowCount while auto-tracking
    // rows, since the count becomes automatically managed.
    if (gridAutoTracks !== undefined) frame.gridAutoTracks = gridAutoTracks as "NONE" | "ROWS";
    if (gridItemsPositioning !== undefined)
      frame.gridItemsPositioning = gridItemsPositioning as "MANUAL" | "ROW_AUTO_FLOW";
    if (gridRowCount !== undefined) frame.gridRowCount = gridRowCount;
    if (gridColumnCount !== undefined) frame.gridColumnCount = gridColumnCount;

    return {
      nodeId: node.id,
      name: node.name,
      layoutMode: frame.layoutMode,
      gridRowCount: frame.gridRowCount,
      gridColumnCount: frame.gridColumnCount,
      gridAutoTracks: frame.gridAutoTracks,
      gridItemsPositioning: frame.gridItemsPositioning,
      success: true,
    };
  }

  if (layoutWrap !== undefined) {
    frame.layoutWrap = layoutWrap as "NO_WRAP" | "WRAP";
  }

  return {
    nodeId: node.id,
    name: node.name,
    layoutMode: frame.layoutMode,
    layoutWrap: frame.layoutWrap,
    success: true,
  };
}

export async function reorderGridTracks(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params["nodeId"] as string;
  const axis = params["axis"] as string;
  const fromIndices = params["fromIndices"] as number[];
  const insertionIndex = params["insertionIndex"] as number;

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }
  if (!isAutoLayoutNode(node)) {
    throw new Error(`Node "${node.name}" does not support grid track reordering (type: ${node.type})`);
  }

  const frame = node as FrameNode;
  if (frame.layoutMode !== "GRID") {
    throw new Error(`Node "${node.name}" is not a GRID frame (layoutMode: ${frame.layoutMode})`);
  }
  if (axis !== "ROW" && axis !== "COLUMN") {
    throw new Error(`Invalid axis: ${axis}. Must be "ROW" or "COLUMN"`);
  }
  if (!Array.isArray(fromIndices) || fromIndices.length === 0) {
    throw new Error("fromIndices must be a non-empty array of track indices");
  }
  if (typeof insertionIndex !== "number") {
    throw new Error("Missing insertionIndex parameter");
  }

  const options = { fromIndices, insertionIndex };
  const moves = axis === "ROW" ? frame.reorderRows(options) : frame.reorderColumns(options);

  return {
    nodeId: node.id,
    name: node.name,
    axis,
    moves: moves.map((m) => ({ from: m.from, to: m.to })),
    success: true,
  };
}

export async function setPadding(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params["nodeId"] as string;
  const paddingTop = paramAlias(params, "paddingTop", "top") as number | undefined;
  const paddingRight = paramAlias(params, "paddingRight", "right") as number | undefined;
  const paddingBottom = paramAlias(params, "paddingBottom", "bottom") as number | undefined;
  const paddingLeft = paramAlias(params, "paddingLeft", "left") as number | undefined;

  if (
    paddingTop === undefined &&
    paddingRight === undefined &&
    paddingBottom === undefined &&
    paddingLeft === undefined
  ) {
    throw new Error("No padding values provided — pass top, right, bottom and/or left. No changes were made.");
  }

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  if (!isAutoLayoutNode(node)) {
    throw new Error(`Node "${node.name}" does not support padding (type: ${node.type})`);
  }

  const frame = node as FrameNode;
  if (paddingTop !== undefined) frame.paddingTop = paddingTop;
  if (paddingRight !== undefined) frame.paddingRight = paddingRight;
  if (paddingBottom !== undefined) frame.paddingBottom = paddingBottom;
  if (paddingLeft !== undefined) frame.paddingLeft = paddingLeft;

  return {
    nodeId: node.id,
    name: node.name,
    paddingTop: frame.paddingTop,
    paddingRight: frame.paddingRight,
    paddingBottom: frame.paddingBottom,
    paddingLeft: frame.paddingLeft,
    success: true,
  };
}

export async function setItemSpacing(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params["nodeId"] as string;
  const itemSpacing = paramAlias(params, "itemSpacing", "gap") as number | undefined;
  const counterAxisSpacing = params["counterAxisSpacing"] as number | undefined;
  const gridRowGap = paramAlias(params, "gridRowGap", "rowGap") as number | undefined;
  const gridColumnGap = paramAlias(params, "gridColumnGap", "columnGap") as number | undefined;

  if (
    itemSpacing === undefined &&
    counterAxisSpacing === undefined &&
    gridRowGap === undefined &&
    gridColumnGap === undefined
  ) {
    throw new Error(
      "No spacing values provided — pass gap, counterAxisSpacing, rowGap and/or columnGap. No changes were made.",
    );
  }

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  if (!isAutoLayoutNode(node)) {
    throw new Error(`Node "${node.name}" does not support item spacing (type: ${node.type})`);
  }

  const frame = node as FrameNode;
  const isGrid = frame.layoutMode === "GRID";

  // itemSpacing is inert on GRID frames and the grid gaps are inert everywhere
  // else. Fail loudly naming the right parameter rather than writing a property
  // that will never render.
  if (isGrid && counterAxisSpacing !== undefined) {
    throw new Error(
      `Frame "${node.name}" has GRID layout — counterAxisSpacing does not apply. Use rowGap/columnGap instead.`,
    );
  }
  if (!isGrid && (gridRowGap !== undefined || gridColumnGap !== undefined)) {
    throw new Error(
      `Frame "${node.name}" has ${frame.layoutMode} layout — rowGap/columnGap apply to GRID frames only. Use gap${
        frame.layoutWrap === "WRAP" ? "/counterAxisSpacing" : ""
      } instead.`,
    );
  }

  if (isGrid) {
    // `gap` is the CSS shorthand: it sets both axes unless a per-axis value wins.
    if (itemSpacing !== undefined) {
      frame.gridRowGap = itemSpacing;
      frame.gridColumnGap = itemSpacing;
    }
    if (gridRowGap !== undefined) frame.gridRowGap = gridRowGap;
    if (gridColumnGap !== undefined) frame.gridColumnGap = gridColumnGap;

    return {
      nodeId: node.id,
      name: node.name,
      layoutMode: frame.layoutMode,
      gridRowGap: frame.gridRowGap,
      gridColumnGap: frame.gridColumnGap,
      success: true,
    };
  }

  if (itemSpacing !== undefined) frame.itemSpacing = itemSpacing;
  if (counterAxisSpacing !== undefined) frame.counterAxisSpacing = counterAxisSpacing;

  return {
    nodeId: node.id,
    name: node.name,
    itemSpacing: frame.itemSpacing,
    counterAxisSpacing: frame.counterAxisSpacing,
    success: true,
  };
}

export async function setAxisAlign(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params["nodeId"] as string;
  const primaryAxisAlignItems = params["primaryAxisAlignItems"] as string | undefined;
  const counterAxisAlignItems = params["counterAxisAlignItems"] as string | undefined;

  if (primaryAxisAlignItems === undefined && counterAxisAlignItems === undefined) {
    throw new Error(
      "No alignment values provided — pass primaryAxisAlignItems and/or counterAxisAlignItems. No changes were made.",
    );
  }

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  if (!isAutoLayoutNode(node)) {
    throw new Error(`Node "${node.name}" does not support axis alignment (type: ${node.type})`);
  }

  const frame = node as FrameNode;
  if (primaryAxisAlignItems !== undefined) {
    frame.primaryAxisAlignItems = primaryAxisAlignItems as "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  }
  if (counterAxisAlignItems !== undefined) {
    frame.counterAxisAlignItems = counterAxisAlignItems as "MIN" | "CENTER" | "MAX" | "BASELINE";
  }

  return {
    nodeId: node.id,
    name: node.name,
    primaryAxisAlignItems: frame.primaryAxisAlignItems,
    counterAxisAlignItems: frame.counterAxisAlignItems,
    success: true,
  };
}

export async function setLayoutSizing(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params["nodeId"] as string;
  const layoutSizingHorizontal = paramAlias(params, "layoutSizingHorizontal", "horizontal") as string | undefined;
  const layoutSizingVertical = paramAlias(params, "layoutSizingVertical", "vertical") as string | undefined;

  if (layoutSizingHorizontal === undefined && layoutSizingVertical === undefined) {
    throw new Error(
      "No sizing values provided — pass horizontal and/or vertical (FIXED, HUG or FILL). No changes were made.",
    );
  }

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "INSTANCE" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "TEXT"
  ) {
    throw new Error(`Node "${node.name}" does not support layout sizing (type: ${node.type})`);
  }

  type Sizing = "FIXED" | "HUG" | "FILL";
  const sizingNode = node as FrameNode | TextNode;
  const isText = node.type === "TEXT";

  // Validate FILL before touching the node so a rejected call leaves no partial change.
  const parent = node.parent;
  const parentLayoutMode =
    parent && "layoutMode" in parent ? (parent as unknown as { layoutMode: string }).layoutMode : undefined;
  const parentIsAutoLayout = parentLayoutMode !== undefined && parentLayoutMode !== "NONE";
  const fillAxes: string[] = [];
  if (layoutSizingHorizontal === "FILL") fillAxes.push("horizontal");
  if (layoutSizingVertical === "FILL") fillAxes.push("vertical");
  if (fillAxes.length > 0) {
    if (!parentIsAutoLayout) {
      const parentDesc = parent
        ? `its parent "${parent.name}" (${parent.type}) has no auto layout`
        : "it has no parent";
      throw new Error(
        `Cannot set ${fillAxes.join(" and ")} sizing to FILL on "${node.name}": FILL only works on children of an auto-layout frame, and ${parentDesc}. Add auto layout to the parent (set_auto_layout) or use FIXED/HUG. No changes were made.`,
      );
    }
    if ("layoutPositioning" in node && (node as FrameNode).layoutPositioning === "ABSOLUTE") {
      throw new Error(
        `Cannot set ${fillAxes.join(" and ")} sizing to FILL on "${node.name}": the node is absolutely positioned inside its auto-layout parent. No changes were made.`,
      );
    }
  }

  // TEXT: a fixed or filled width with no vertical intent means "wrap" — height hugs.
  let verticalToApply = layoutSizingVertical as Sizing | undefined;
  if (
    isText &&
    verticalToApply === undefined &&
    (layoutSizingHorizontal === "FIXED" || layoutSizingHorizontal === "FILL")
  ) {
    verticalToApply = "HUG";
  }

  // TEXT nodes drive HUG off `textAutoResize`; writing layoutSizing* HUG without it is
  // silently ignored. Mapping: HUG width → WIDTH_AND_HEIGHT; FIXED/FILL width + HUG
  // height → HEIGHT (wraps); no HUG on either axis → NONE (fixed box).
  let targetAutoResize: "NONE" | "HEIGHT" | "WIDTH_AND_HEIGHT" | undefined;
  if (isText) {
    const textNode = node as TextNode;
    const effectiveHorizontal = layoutSizingHorizontal ?? textNode.layoutSizingHorizontal;
    const effectiveVertical = verticalToApply ?? textNode.layoutSizingVertical;
    const hugH = effectiveHorizontal === "HUG";
    const hugV = effectiveVertical === "HUG";
    targetAutoResize = hugH ? "WIDTH_AND_HEIGHT" : hugV ? "HEIGHT" : "NONE";
  }

  const previous = {
    horizontal: sizingNode.layoutSizingHorizontal,
    vertical: sizingNode.layoutSizingVertical,
    textAutoResize: isText ? (node as TextNode).textAutoResize : undefined,
  };

  // Writing textAutoResize (and rolling it back) requires the node's fonts to be loaded.
  if (isText && targetAutoResize !== undefined) {
    await loadTextNodeFonts(node as TextNode);
  }

  try {
    if (isText && targetAutoResize !== undefined) {
      (node as TextNode).textAutoResize = targetAutoResize;
    }
    if (layoutSizingHorizontal !== undefined) {
      sizingNode.layoutSizingHorizontal = layoutSizingHorizontal as Sizing;
    }
    if (verticalToApply !== undefined) {
      sizingNode.layoutSizingVertical = verticalToApply;
    }
    // Writing layoutSizing* can nudge textAutoResize; the derived value is authoritative.
    if (isText && targetAutoResize !== undefined && (node as TextNode).textAutoResize !== targetAutoResize) {
      (node as TextNode).textAutoResize = targetAutoResize;
    }
  } catch (error) {
    try {
      if (isText && previous.textAutoResize !== undefined) {
        (node as TextNode).textAutoResize = previous.textAutoResize;
      }
      if (sizingNode.layoutSizingHorizontal !== previous.horizontal) {
        sizingNode.layoutSizingHorizontal = previous.horizontal;
      }
      if (sizingNode.layoutSizingVertical !== previous.vertical) {
        sizingNode.layoutSizingVertical = previous.vertical;
      }
    } catch (_restoreError) {
      // Best-effort rollback; surface the original failure.
    }
    throw error;
  }

  return {
    nodeId: node.id,
    name: node.name,
    layoutSizingHorizontal: sizingNode.layoutSizingHorizontal,
    layoutSizingVertical: sizingNode.layoutSizingVertical,
    textAutoResize: node.type === "TEXT" ? (node as TextNode).textAutoResize : undefined,
    success: true,
  };
}

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

export const CONSTRAINT_TYPES = ["MIN", "CENTER", "MAX", "STRETCH", "SCALE"] as const;
export type ConstraintValue = (typeof CONSTRAINT_TYPES)[number];
export interface ConstraintsInput {
  horizontal?: ConstraintValue;
  vertical?: ConstraintValue;
}

function checkConstraintValue(axis: string, value: unknown): ConstraintValue | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || CONSTRAINT_TYPES.indexOf(value as ConstraintValue) === -1) {
    throw new Error(`Invalid ${axis} constraint: ${String(value)}. Must be one of ${CONSTRAINT_TYPES.join(", ")}.`);
  }
  return value as ConstraintValue;
}

/** Validates an optional `{ horizontal?, vertical? }` param; undefined when absent. */
export function parseConstraintsParam(value: unknown): ConstraintsInput | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("constraints must be an object: { horizontal?, vertical? }");
  }
  const obj = value as Record<string, unknown>;
  const horizontal = checkConstraintValue("horizontal", obj["horizontal"]);
  const vertical = checkConstraintValue("vertical", obj["vertical"]);
  if (horizontal === undefined && vertical === undefined) {
    throw new Error(`constraints needs horizontal and/or vertical (${CONSTRAINT_TYPES.join(", ")})`);
  }
  return { horizontal, vertical };
}

/** Writes the given axes, keeping the current value of an omitted axis. False when the node has no constraints. */
export function applyConstraints(node: BaseNode, input: ConstraintsInput): boolean {
  if (!("constraints" in node)) return false;
  const target = node as SceneNode & ConstraintMixin;
  const current = target.constraints;
  target.constraints = {
    horizontal: input.horizontal ?? current.horizontal,
    vertical: input.vertical ?? current.vertical,
  };
  return true;
}

function constraintsWarning(node: SceneNode): string | undefined {
  const parent = node.parent;
  if (!parent || parent.type === "PAGE" || parent.type === "DOCUMENT") {
    return `"${node.name}" sits directly on the page; constraints only take effect inside a frame, component or instance.`;
  }
  const parentLayoutMode =
    "layoutMode" in parent ? (parent as unknown as { layoutMode: string }).layoutMode : undefined;
  const positioning = "layoutPositioning" in node ? (node as FrameNode).layoutPositioning : undefined;
  if (parentLayoutMode !== undefined && parentLayoutMode !== "NONE" && positioning !== "ABSOLUTE") {
    return `"${node.name}" is an auto-layout child of "${parent.name}" (layoutPositioning AUTO): constraints are stored but ignored until the node is absolutely positioned or the parent's auto layout is removed. Use set_layout_sizing for children in the flow.`;
  }
  return undefined;
}

export async function setConstraints(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ids: string[] = [];
  const rawIds = params["nodeIds"];
  if (Array.isArray(rawIds)) {
    for (const id of rawIds) if (typeof id === "string" && ids.indexOf(id) === -1) ids.push(id);
  }
  const nodeId = params["nodeId"];
  if (typeof nodeId === "string" && ids.indexOf(nodeId) === -1) ids.unshift(nodeId);
  if (ids.length === 0) {
    throw new Error("Missing nodeId or nodeIds parameter");
  }

  const horizontal = checkConstraintValue("horizontal", params["horizontal"]);
  const vertical = checkConstraintValue("vertical", params["vertical"]);
  if (horizontal === undefined && vertical === undefined) {
    throw new Error(
      `No constraint values provided — pass horizontal and/or vertical (${CONSTRAINT_TYPES.join(", ")}). No changes were made.`,
    );
  }

  const results: Array<Record<string, unknown>> = [];
  for (const id of ids) {
    try {
      const node = await figma.getNodeByIdAsync(id);
      if (!node) throw new Error(`Node with ID ${id} not found`);
      if (!applyConstraints(node, { horizontal, vertical })) {
        throw new Error(`Node "${node.name}" does not support constraints (type: ${node.type})`);
      }
      const constraints = (node as SceneNode & ConstraintMixin).constraints;
      const entry: Record<string, unknown> = {
        nodeId: node.id,
        name: node.name,
        success: true,
        constraints: { horizontal: constraints.horizontal, vertical: constraints.vertical },
      };
      const warning = constraintsWarning(node as SceneNode);
      if (warning) entry["warning"] = warning;
      results.push(entry);
    } catch (error) {
      results.push({ nodeId: id, success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const failed = results.filter((r) => r["success"] !== true);
  if (failed.length === results.length) {
    throw new Error(failed.map((r) => r["error"]).join("; "));
  }

  return {
    success: failed.length === 0,
    updated: results.length - failed.length,
    failed: failed.length,
    results,
  };
}
