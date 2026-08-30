import { findCollection } from "./variables";

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

export async function setLayoutMode(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params["nodeId"] as string;
  const layoutMode = params["layoutMode"] as string;
  const layoutWrap = params["layoutWrap"] as string | undefined;

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
    const gridRowCount = params["gridRowCount"] as number | undefined;
    const gridColumnCount = params["gridColumnCount"] as number | undefined;
    if (gridRowCount !== undefined) frame.gridRowCount = gridRowCount;
    if (gridColumnCount !== undefined) frame.gridColumnCount = gridColumnCount;

    return {
      nodeId: node.id,
      name: node.name,
      layoutMode: frame.layoutMode,
      gridRowCount: frame.gridRowCount,
      gridColumnCount: frame.gridColumnCount,
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

export async function setPadding(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params["nodeId"] as string;
  const paddingTop = params["paddingTop"] as number | undefined;
  const paddingRight = params["paddingRight"] as number | undefined;
  const paddingBottom = params["paddingBottom"] as number | undefined;
  const paddingLeft = params["paddingLeft"] as number | undefined;

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
  const itemSpacing = params["itemSpacing"] as number | undefined;
  const counterAxisSpacing = params["counterAxisSpacing"] as number | undefined;

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  if (!isAutoLayoutNode(node)) {
    throw new Error(`Node "${node.name}" does not support item spacing (type: ${node.type})`);
  }

  const frame = node as FrameNode;
  const gridRowGap = params["gridRowGap"] as number | undefined;
  const gridColumnGap = params["gridColumnGap"] as number | undefined;
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
  const layoutSizingHorizontal = params["layoutSizingHorizontal"] as string | undefined;
  const layoutSizingVertical = params["layoutSizingVertical"] as string | undefined;

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

  const sizingNode = node as FrameNode | TextNode;

  // TEXT nodes drive their HUG behavior off `textAutoResize`, not layoutSizing*
  // directly — setting layoutSizingHorizontal/Vertical to HUG without also
  // updating textAutoResize is silently ignored by the Figma runtime. Resolve
  // the effective horizontal/vertical intent (falling back to the node's
  // current sizing for whichever axis wasn't passed) and derive the matching
  // textAutoResize value before touching layoutSizing*.
  if (node.type === "TEXT") {
    const textNode = node as TextNode;
    const effectiveHorizontal = layoutSizingHorizontal ?? textNode.layoutSizingHorizontal;
    const effectiveVertical = layoutSizingVertical ?? textNode.layoutSizingVertical;
    const hugH = effectiveHorizontal === "HUG";
    const hugV = effectiveVertical === "HUG";

    // Figma's TextAutoResize enum has no "WIDTH"-only value, so a horizontal-only
    // hug still requires WIDTH_AND_HEIGHT (the vertical axis rides along with it).
    if (hugH || hugV) {
      textNode.textAutoResize = hugV && !hugH ? "HEIGHT" : "WIDTH_AND_HEIGHT";
    } else {
      textNode.textAutoResize = "NONE";
    }
  }

  if (layoutSizingHorizontal !== undefined) {
    sizingNode.layoutSizingHorizontal = layoutSizingHorizontal as "FIXED" | "HUG" | "FILL";
  }
  if (layoutSizingVertical !== undefined) {
    sizingNode.layoutSizingVertical = layoutSizingVertical as "FIXED" | "HUG" | "FILL";
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
