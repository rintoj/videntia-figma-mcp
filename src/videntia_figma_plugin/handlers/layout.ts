import {
  applyWrites,
  guardParentSize,
  resolveSideEffectAllowance,
  mergeWriteResults,
  resolveStrict,
  snapshotParentSize,
  withWriteReport,
} from "../utils/write-verify";
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
  const rowSizes = validateGridTrackSizes(paramAlias(params, "gridRowSizes", "rowSizes"), "rowSizes");
  const columnSizes = validateGridTrackSizes(paramAlias(params, "gridColumnSizes", "columnSizes"), "columnSizes");
  if (layoutMode !== "GRID" && (rowSizes || columnSizes)) {
    throw new Error(`rowSizes/columnSizes apply to GRID mode only (mode is ${layoutMode}). No changes were made.`);
  }
  const gridRowCount = paramAlias(params, "gridRowCount", "rows") as number | undefined;
  const gridColumnCount = paramAlias(params, "gridColumnCount", "columns") as number | undefined;
  assertTrackSizesFit(frame, rowSizes, gridRowCount, "rowSizes");
  assertTrackSizesFit(frame, columnSizes, gridColumnCount, "columnSizes");

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
    // Track sizes index into the tracks, so they go after the counts.
    applyGridTrackSizes(frame, rowSizes, columnSizes);

    return {
      nodeId: node.id,
      name: node.name,
      layoutMode: frame.layoutMode,
      gridRowCount: frame.gridRowCount,
      gridColumnCount: frame.gridColumnCount,
      gridAutoTracks: frame.gridAutoTracks,
      gridItemsPositioning: frame.gridItemsPositioning,
      ...(rowSizes ? { gridRowSizes: serializeGridTrackSizes(frame.gridRowSizes) } : {}),
      ...(columnSizes ? { gridColumnSizes: serializeGridTrackSizes(frame.gridColumnSizes) } : {}),
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

// ---------------------------------------------------------------------------
// Grid track sizes
// ---------------------------------------------------------------------------

const GRID_TRACK_TYPES = new Set(["FIXED", "FLEX", "HUG"]);

export interface GridTrackSizeInput {
  type: "FIXED" | "FLEX" | "HUG";
  value?: number;
}

/** Shape-checks a rowSizes/columnSizes array. Throws before any node is touched. */
export function validateGridTrackSizes(sizes: unknown, label: string): GridTrackSizeInput[] | undefined {
  if (sizes === undefined || sizes === null) return undefined;
  if (!Array.isArray(sizes) || sizes.length === 0) {
    throw new Error(`${label} must be a non-empty array of { type: "FIXED" | "FLEX" | "HUG", value? }`);
  }
  return sizes.map((entry, i) => {
    const track = entry as Record<string, unknown> | null;
    if (!track || typeof track !== "object" || !GRID_TRACK_TYPES.has(track.type as string)) {
      throw new Error(`${label}[${i}].type must be FIXED, FLEX or HUG`);
    }
    const type = track.type as GridTrackSizeInput["type"];
    const value = track.value;
    if (value !== undefined && value !== null && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
      throw new Error(`${label}[${i}].value must be a positive number`);
    }
    if (type === "FIXED" && (value === undefined || value === null)) {
      throw new Error(`${label}[${i}] is FIXED and needs a value in pixels`);
    }
    if (type === "HUG" && value !== undefined && value !== null) {
      throw new Error(`${label}[${i}] is HUG — omit value (HUG tracks size to their content)`);
    }
    return value === undefined || value === null ? { type } : { type, value: value as number };
  });
}

export function assertTrackSizeCount(sizes: GridTrackSizeInput[] | undefined, count: number, label: string): void {
  if (sizes && sizes.length !== count) {
    throw new Error(`${label} has ${sizes.length} entries but the grid has ${count} — pass one entry per track`);
  }
}

/**
 * Pre-mutation length check. The resulting track count is known only from the count param
 * or an existing GRID frame, so converting to GRID with sizes but no count is rejected here
 * instead of failing after layoutMode has already changed.
 */
export function assertTrackSizesFit(
  frame: FrameNode,
  sizes: GridTrackSizeInput[] | undefined,
  count: number | undefined,
  label: "rowSizes" | "columnSizes",
): void {
  if (!sizes) return;
  if (count !== undefined) return assertTrackSizeCount(sizes, count, label);
  if (frame.layoutMode === "GRID") {
    return assertTrackSizeCount(sizes, label === "rowSizes" ? frame.gridRowCount : frame.gridColumnCount, label);
  }
  const countParam = label === "rowSizes" ? "rows" : "columns";
  throw new Error(
    `${label} needs ${countParam} when converting a ${frame.layoutMode} frame to GRID, so the track count is known up front. No changes were made.`,
  );
}

/** Writes validated track sizes through the GridTrackSize setters. Counts must already be applied. */
export function applyGridTrackSizes(
  frame: FrameNode,
  rowSizes: GridTrackSizeInput[] | undefined,
  columnSizes: GridTrackSizeInput[] | undefined,
): void {
  assertTrackSizeCount(rowSizes, frame.gridRowCount, "rowSizes");
  assertTrackSizeCount(columnSizes, frame.gridColumnCount, "columnSizes");
  const write = (tracks: GridTrackSize[], sizes: GridTrackSizeInput[]) => {
    sizes.forEach((size, i) => {
      tracks[i].type = size.type;
      if (size.value !== undefined) tracks[i].value = size.value;
    });
  };
  if (rowSizes) write(frame.gridRowSizes, rowSizes);
  if (columnSizes) write(frame.gridColumnSizes, columnSizes);
}

export function serializeGridTrackSizes(tracks: ReadonlyArray<GridTrackSize> | undefined): GridTrackSizeInput[] {
  return (tracks || []).map((t) =>
    t.type === "HUG" || t.value === undefined ? { type: t.type } : { type: t.type, value: t.value },
  );
}

// ---------------------------------------------------------------------------
// Grid children
// ---------------------------------------------------------------------------

const GRID_PARENT_TYPES = new Set(["FRAME", "COMPONENT", "COMPONENT_SET"]);
const GRID_CHILD_ALIGNS = new Set(["MIN", "CENTER", "MAX", "AUTO"]);

type GridChild = SceneNode & GridChildrenMixin;

function readNonNegativeInt(params: Record<string, unknown>, key: string, min: number): number | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new Error(`${key} must be an integer ≥ ${min}. No changes were made.`);
  }
  return value;
}

function gridChildState(child: GridChild) {
  return {
    row: child.gridRowAnchorIndex,
    column: child.gridColumnAnchorIndex,
    rowSpan: child.gridRowSpan,
    columnSpan: child.gridColumnSpan,
    horizontalAlign: child.gridChildHorizontalAlign,
    verticalAlign: child.gridChildVerticalAlign,
  };
}

export async function setGridChild(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params["nodeId"] as string | undefined;
  if (!nodeId) throw new Error("Missing nodeId parameter");

  const row = readNonNegativeInt(params, "row", 0);
  const column = readNonNegativeInt(params, "column", 0);
  const rowSpan = readNonNegativeInt(params, "rowSpan", 1);
  const columnSpan = readNonNegativeInt(params, "columnSpan", 1);
  const horizontalAlign = params["horizontalAlign"] as string | undefined;
  const verticalAlign = params["verticalAlign"] as string | undefined;

  for (const [key, value] of [
    ["horizontalAlign", horizontalAlign],
    ["verticalAlign", verticalAlign],
  ] as const) {
    if (value !== undefined && !GRID_CHILD_ALIGNS.has(value)) {
      throw new Error(`${key} must be MIN, CENTER, MAX or AUTO. No changes were made.`);
    }
  }
  if ([row, column, rowSpan, columnSpan, horizontalAlign, verticalAlign].every((v) => v === undefined)) {
    throw new Error(
      "Nothing to set — pass row, column, rowSpan, columnSpan, horizontalAlign and/or verticalAlign. No changes were made.",
    );
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node with ID ${nodeId} not found`);

  const parent = node.parent as (BaseNode & { layoutMode?: string }) | null;
  if (!parent || !GRID_PARENT_TYPES.has(parent.type) || parent.layoutMode !== "GRID") {
    throw new Error(
      `Node "${node.name}" is not a child of a GRID auto-layout frame (parent: ${
        parent ? `${parent.type}${parent.layoutMode ? ` layoutMode ${parent.layoutMode}` : ""}` : "none"
      }). Set the parent to GRID with set_layout_mode first. No changes were made.`,
    );
  }
  if (!("gridRowSpan" in node) || typeof (node as GridChild).setGridChildPosition !== "function") {
    throw new Error(`Node "${node.name}" (type: ${node.type}) cannot be placed in a grid. No changes were made.`);
  }

  const child = node as GridChild;
  const grid = parent as unknown as FrameNode;
  if ((child as SceneNode & { layoutPositioning?: string }).layoutPositioning === "ABSOLUTE") {
    throw new Error(
      `Node "${node.name}" is absolutely positioned inside the grid and has no cell. No changes were made.`,
    );
  }

  const autoFlow = grid.gridItemsPositioning === "ROW_AUTO_FLOW";
  const positionRequested = row !== undefined || column !== undefined;
  if (autoFlow && positionRequested) {
    throw new Error(
      `Grid "${grid.name}" uses gridItemsPositioning ROW_AUTO_FLOW, so cell positions are automatic — reorder with insert_child, or set gridItemsPositioning to MANUAL first. No changes were made.`,
    );
  }

  const before = gridChildState(child);
  const target = {
    row: row !== undefined ? row : before.row,
    column: column !== undefined ? column : before.column,
    rowSpan: rowSpan !== undefined ? rowSpan : before.rowSpan,
    columnSpan: columnSpan !== undefined ? columnSpan : before.columnSpan,
  };

  // Rows are added on demand when gridAutoTracks is ROWS, so only columns are hard-bounded then.
  const rowsBounded = grid.gridAutoTracks !== "ROWS";
  if (rowsBounded && target.row + target.rowSpan > grid.gridRowCount) {
    throw new Error(
      `Row ${target.row} with rowSpan ${target.rowSpan} does not fit grid "${grid.name}" (${grid.gridRowCount} rows, indices 0-${
        grid.gridRowCount - 1
      }). No changes were made.`,
    );
  }
  if (target.column + target.columnSpan > grid.gridColumnCount) {
    throw new Error(
      `Column ${target.column} with columnSpan ${target.columnSpan} does not fit grid "${grid.name}" (${
        grid.gridColumnCount
      } columns, indices 0-${grid.gridColumnCount - 1}). No changes were made.`,
    );
  }

  if (!autoFlow) {
    const overlaps = (grid.children || []).filter((sibling) => {
      const s = sibling as GridChild & { layoutPositioning?: string };
      if (s === child || s.visible === false || s.layoutPositioning === "ABSOLUTE") return false;
      if (typeof s.gridRowAnchorIndex !== "number" || typeof s.gridColumnAnchorIndex !== "number") return false;
      const sRowSpan = s.gridRowSpan || 1;
      const sColSpan = s.gridColumnSpan || 1;
      return (
        target.row < s.gridRowAnchorIndex + sRowSpan &&
        s.gridRowAnchorIndex < target.row + target.rowSpan &&
        target.column < s.gridColumnAnchorIndex + sColSpan &&
        s.gridColumnAnchorIndex < target.column + target.columnSpan
      );
    });
    if (overlaps.length > 0) {
      throw new Error(
        `Cell area row ${target.row}-${target.row + target.rowSpan - 1}, column ${target.column}-${
          target.column + target.columnSpan - 1
        } overlaps ${overlaps.map((s) => `"${s.name}" (${s.id})`).join(", ")}. Move or shrink those first. No changes were made.`,
      );
    }
  }

  const spansChanging = target.rowSpan !== before.rowSpan || target.columnSpan !== before.columnSpan;
  const positionChanging = target.row !== before.row || target.column !== before.column;

  try {
    // Collapse to one cell before moving so the intermediate state never overlaps
    // a sibling, then grow to the requested spans at the new anchor.
    if (positionChanging && spansChanging) {
      if (child.gridRowSpan !== 1) child.gridRowSpan = 1;
      if (child.gridColumnSpan !== 1) child.gridColumnSpan = 1;
    }
    if (positionChanging) child.setGridChildPosition(target.row, target.column);
    if (child.gridRowSpan !== target.rowSpan) child.gridRowSpan = target.rowSpan;
    if (child.gridColumnSpan !== target.columnSpan) child.gridColumnSpan = target.columnSpan;
    if (horizontalAlign !== undefined) {
      child.gridChildHorizontalAlign = horizontalAlign as GridChildrenMixin["gridChildHorizontalAlign"];
    }
    if (verticalAlign !== undefined) {
      child.gridChildVerticalAlign = verticalAlign as GridChildrenMixin["gridChildVerticalAlign"];
    }
  } catch (error) {
    try {
      if (child.gridRowSpan !== 1) child.gridRowSpan = 1;
      if (child.gridColumnSpan !== 1) child.gridColumnSpan = 1;
      if (!autoFlow && (child.gridRowAnchorIndex !== before.row || child.gridColumnAnchorIndex !== before.column)) {
        child.setGridChildPosition(before.row, before.column);
      }
      child.gridRowSpan = before.rowSpan;
      child.gridColumnSpan = before.columnSpan;
      child.gridChildHorizontalAlign = before.horizontalAlign;
      child.gridChildVerticalAlign = before.verticalAlign;
    } catch {
      /* best-effort rollback; report the original failure */
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Figma rejected the grid placement for "${node.name}": ${message}. Changes were rolled back.`);
  }

  return {
    nodeId: child.id,
    name: child.name,
    parentId: grid.id,
    ...gridChildState(child),
    success: true,
  };
}

/**
 * Read a padding/spacing argument under any of its accepted spellings.
 *
 * The MCP tool layer maps its short argument names (`top`, `gap`, …) to the
 * plugin's long names, but `batch_actions` forwards action params verbatim —
 * so a batched `set_padding` arrived with `top`/`right`/… and every long-name
 * lookup returned `undefined`, producing a total no-op that still reported
 * success. Accept both spellings here so the two paths behave identically.
 */
function readAlias(params: Record<string, unknown>, ...names: string[]): number | undefined {
  for (let i = 0; i < names.length; i++) {
    const v = params[names[i]];
    if (v !== undefined && v !== null) {
      const n = typeof v === "number" ? v : parseFloat(v as string);
      if (isNaN(n)) {
        throw new Error(`Invalid value for "${names[i]}": expected a number, got ${JSON.stringify(v)}`);
      }
      return n;
    }
  }
  return undefined;
}

/**
 * Padding, item spacing and counter-axis spacing are only live on a frame that
 * currently has auto layout. On a `layoutMode === "NONE"` frame the Figma API
 * accepts the assignment and throws nothing, but the value never renders and is
 * not persisted — the classic silent no-op. Fail loudly with the fix instead.
 */
function assertAutoLayoutEnabled(node: BaseNode, command: string, property: string): FrameNode {
  if (!isAutoLayoutNode(node)) {
    throw new Error(`Node "${node.name}" does not support ${property} (type: ${node.type})`);
  }
  const frame = node as FrameNode;
  if (frame.layoutMode === "NONE") {
    throw new Error(
      `Frame "${node.name}" has layoutMode NONE, so ${property} is inert — Figma accepts the write and discards it. ` +
        `Fix it in ONE call with set_auto_layout — it sets layoutMode, padding and itemSpacing/gap together ` +
        `and applies them exactly (e.g. {mode:"VERTICAL", gap:37, left:21, top:13, right:21, bottom:13}). ` +
        `Otherwise call set_layout_mode with HORIZONTAL/VERTICAL/GRID on this frame first, then ${command}.`,
    );
  }
  return frame;
}

export async function setPadding(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params["nodeId"] as string;
  // `padding` is a CSS-style shorthand applying to all four sides.
  const paddingAll = readAlias(params, "padding");
  const paddingTop = readAlias(params, "paddingTop", "top");
  const paddingRight = readAlias(params, "paddingRight", "right");
  const paddingBottom = readAlias(params, "paddingBottom", "bottom");
  const paddingLeft = readAlias(params, "paddingLeft", "left");

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  const frame = assertAutoLayoutEnabled(node, "set_padding", "padding");

  const top = paddingTop !== undefined ? paddingTop : paddingAll;
  const right = paddingRight !== undefined ? paddingRight : paddingAll;
  const bottom = paddingBottom !== undefined ? paddingBottom : paddingAll;
  const left = paddingLeft !== undefined ? paddingLeft : paddingAll;

  if (top === undefined && right === undefined && bottom === undefined && left === undefined) {
    throw new Error(
      `set_padding on "${node.name}" was given no padding values. ` +
        `Pass at least one of padding/top/right/bottom/left (aliases: paddingTop/paddingRight/paddingBottom/paddingLeft).`,
    );
  }

  const report = applyWrites(
    frame,
    { paddingTop: top, paddingRight: right, paddingBottom: bottom, paddingLeft: left },
    { label: "set_padding", strict: resolveStrict(params) },
  );

  return withWriteReport(
    {
      nodeId: node.id,
      name: node.name,
      paddingTop: frame.paddingTop,
      paddingRight: frame.paddingRight,
      paddingBottom: frame.paddingBottom,
      paddingLeft: frame.paddingLeft,
    },
    report,
  );
}

export async function setItemSpacing(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params["nodeId"] as string;
  // `gap` is the MCP tool's name; batch_actions forwards it verbatim.
  const itemSpacing = readAlias(params, "itemSpacing", "gap");
  const counterAxisSpacing = readAlias(params, "counterAxisSpacing");

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  const frame = assertAutoLayoutEnabled(node, "set_item_spacing", "item spacing");
  const gridRowGap = readAlias(params, "gridRowGap", "rowGap");
  const gridColumnGap = readAlias(params, "gridColumnGap", "columnGap");

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

  const strict = resolveStrict(params);

  if (isGrid) {
    // `gap` is the CSS shorthand: it sets both axes unless a per-axis value wins.
    const rowValue = gridRowGap !== undefined ? gridRowGap : itemSpacing;
    const columnValue = gridColumnGap !== undefined ? gridColumnGap : itemSpacing;
    const gridReport = applyWrites(
      frame,
      { gridRowGap: rowValue, gridColumnGap: columnValue },
      { label: "set_item_spacing", strict },
    );

    return withWriteReport(
      {
        nodeId: node.id,
        name: node.name,
        layoutMode: frame.layoutMode,
        gridRowGap: frame.gridRowGap,
        gridColumnGap: frame.gridColumnGap,
      },
      gridReport,
    );
  }

  // itemSpacing is ignored by the layout engine when the primary axis is
  // distributing free space itself. Figma still stores the number (so a
  // read-back check cannot detect it), which is exactly why callers saw a
  // "successful" write with no visual change.
  if (itemSpacing !== undefined && frame.primaryAxisAlignItems === "SPACE_BETWEEN") {
    throw new Error(
      `Frame "${node.name}" has primaryAxisAlignItems SPACE_BETWEEN, which distributes the gap automatically — ` +
        `itemSpacing is stored but never rendered. Set primaryAxisAlignItems to MIN/CENTER/MAX ` +
        `(set_axis_align) before setting a gap.`,
    );
  }

  // counterAxisSpacing only exists on a wrapping frame; on a non-wrapping one
  // Figma keeps it at null and discards the write.
  if (counterAxisSpacing !== undefined && frame.layoutWrap !== "WRAP") {
    throw new Error(
      `Frame "${node.name}" has layoutWrap ${frame.layoutWrap} — counterAxisSpacing only applies to WRAP frames ` +
        `and is discarded here. Set wrap=WRAP (set_layout_mode) first, or use gap instead.`,
    );
  }

  const report = applyWrites(frame, { itemSpacing, counterAxisSpacing }, { label: "set_item_spacing", strict });

  return withWriteReport(
    {
      nodeId: node.id,
      name: node.name,
      itemSpacing: frame.itemSpacing,
      counterAxisSpacing: frame.counterAxisSpacing,
    },
    report,
  );
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
  const layoutSizingHorizontal = (
    params["layoutSizingHorizontal"] !== undefined ? params["layoutSizingHorizontal"] : params["horizontal"]
  ) as string | undefined;
  const layoutSizingVertical = (
    params["layoutSizingVertical"] !== undefined ? params["layoutSizingVertical"] : params["vertical"]
  ) as string | undefined;

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

  // ---- Preconditions that Figma silently swallows rather than reporting ----

  const parent = node.parent;
  const parentLayoutMode =
    parent !== null && parent !== undefined && "layoutMode" in parent ? (parent as FrameNode).layoutMode : "NONE";
  const isLayoutChild =
    parentLayoutMode === "HORIZONTAL" || parentLayoutMode === "VERTICAL" || parentLayoutMode === "GRID";

  // FILL means "stretch to my parent's auto-layout track". A node whose parent
  // is a page, a group, or a non-auto-layout frame has no track to fill, so the
  // assignment is discarded without error.
  if (layoutSizingHorizontal === "FILL" || layoutSizingVertical === "FILL") {
    if (!isLayoutChild) {
      const where =
        parent === null || parent === undefined
          ? "no parent"
          : parent.type === "PAGE"
            ? "the page (a top-level node)"
            : `a ${parent.type}${"layoutMode" in parent ? " with layoutMode NONE" : ""}`;
      throw new Error(
        `Cannot set layout sizing FILL on "${node.name}": its parent is ${where}, so there is no auto-layout ` +
          `track to fill and Figma discards the write. Put the node inside an auto-layout frame first ` +
          `(set_layout_mode on the parent), or use FIXED with resize_node.`,
      );
    }
  }

  // HUG means "shrink-wrap my children". Figma only permits it on a node that
  // is itself an auto-layout frame (or a TEXT node, handled below); a top-level
  // frame that is a page child can never hug.
  const wantsHug = layoutSizingHorizontal === "HUG" || layoutSizingVertical === "HUG";
  if (wantsHug && node.type !== "TEXT") {
    const ownLayoutMode = "layoutMode" in node ? (node as FrameNode).layoutMode : "NONE";
    if (ownLayoutMode === "NONE") {
      throw new Error(
        `Cannot set layout sizing HUG on "${node.name}": HUG shrink-wraps auto-layout children, but this ` +
          `${node.type} has layoutMode NONE. Enable auto layout on it first (set_layout_mode / set_auto_layout), ` +
          `then set HUG.`,
      );
    }
    if (parent !== null && parent !== undefined && parent.type === "PAGE") {
      throw new Error(
        `Cannot set layout sizing HUG on "${node.name}": it is a top-level frame (a direct child of the page). ` +
          `Figma does not allow page-level frames to hug their contents — the write is accepted and discarded. ` +
          `Either resize it explicitly (resize_node) or nest it inside an auto-layout parent frame.`,
      );
    }
  }

  // TEXT nodes drive their HUG behavior off `textAutoResize`, not layoutSizing*
  // directly — setting layoutSizingHorizontal/Vertical to HUG without also
  // updating textAutoResize is silently ignored by the Figma runtime. Resolve
  // the effective horizontal/vertical intent (falling back to the node's
  // current sizing for whichever axis wasn't passed) and derive the matching
  // textAutoResize value before touching layoutSizing*.
  // TEXT: a fixed or filled width with no vertical intent means "wrap" — height hugs.
  let verticalToApply = layoutSizingVertical as Sizing | undefined;
  if (
    isText &&
    verticalToApply === undefined &&
    (layoutSizingHorizontal === "FIXED" || layoutSizingHorizontal === "FILL")
  ) {
    verticalToApply = "HUG";
  }

  if (node.type === "TEXT") {
    const textNode = node as TextNode;
    // Writing textAutoResize requires the node's fonts to be loaded.
    await loadTextNodeFonts(textNode);
    const effectiveHorizontal = layoutSizingHorizontal ?? textNode.layoutSizingHorizontal;
    const effectiveVertical = verticalToApply ?? textNode.layoutSizingVertical;
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

  const strict = resolveStrict(params);

  // Bug #9: a FILL child makes a hugging parent recompute (and silently shrink)
  // its own size. Snapshot the parent BEFORE the child write so the drift can be
  // restored (parent FIXED) or reported loudly (parent hugs).
  const parentSnapshot = snapshotParentSize(parent);

  const report = applyWrites(
    sizingNode,
    { layoutSizingHorizontal, layoutSizingVertical: verticalToApply },
    {
      label: "set_layout_sizing",
      strict,
      hint: "Figma recomputed the sizing mode from the node's layout context.",
    },
  );

  const parentReport = guardParentSize(parentSnapshot, {
    label: "set_layout_sizing",
    strict,
    childName: node.name,
    allowSideEffects: resolveSideEffectAllowance(params),
  });

  const result: Record<string, unknown> = {
    nodeId: node.id,
    name: node.name,
    layoutSizingHorizontal: sizingNode.layoutSizingHorizontal,
    layoutSizingVertical: sizingNode.layoutSizingVertical,
    textAutoResize: node.type === "TEXT" ? (node as TextNode).textAutoResize : undefined,
  };
  if (parentSnapshot !== null) {
    result["parentWidth"] = (parentSnapshot.node as unknown as Record<string, unknown>)["width"];
    result["parentHeight"] = (parentSnapshot.node as unknown as Record<string, unknown>)["height"];
  }
  if (
    parentReport.warnings.length > 0 &&
    parentReport.noops.length === 0 &&
    (parentReport.acknowledged === undefined || parentReport.acknowledged.length === 0)
  ) {
    result["parentSizeRestored"] = parentReport.warnings;
  }

  return withWriteReport(result, mergeWriteResults(report, parentReport));
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
