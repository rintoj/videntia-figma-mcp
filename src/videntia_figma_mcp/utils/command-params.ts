import { normalizeNodeId } from "./figma-helpers.js";
import { applyColorDefaults, FIGMA_DEFAULTS } from "./defaults.js";
import { normalizeVariableValueByType } from "./variable-values.js";

/**
 * Public MCP tool params → Figma plugin command params.
 *
 * Each MCP tool exposes friendly param names (e.g. `set_layout_sizing { horizontal }`)
 * while the plugin handler reads internal names (`layoutSizingHorizontal`). The direct
 * tools and `batch_actions` both route through `normalizeCommandParams` so the two
 * paths send identical payloads. Internal names already present are kept, so callers
 * that pass plugin names keep working.
 */

export type CommandParams = Record<string, unknown>;

export class CommandParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandParamsError";
  }
}

const RESULT_REF_PATTERN = /^\$result\[\d+\]/;

export function isResultReference(value: unknown): boolean {
  return typeof value === "string" && RESULT_REF_PATTERN.test(value);
}

const ID_KEYS = [
  "nodeId",
  "nodeIds",
  "parentId",
  "childId",
  "destinationId",
  "replaceNodeId",
  "sourceInstanceId",
  "targetNodeIds",
  "instanceNodeId",
  "ignoreNodeIds",
];

const ARRAY_KEYS = new Set([
  "nodeIds",
  "ignoreNodeIds",
  "ignoreRules",
  "targetNodeIds",
  "fromIndices",
  "corners",
  "effects",
  "stops",
  "types",
  "leadingTrim",
  "variables",
  "ids",
  "annotations",
  "connections",
  "preferredValues",
  "pages",
  "dashPattern",
]);

const NUMBER_KEYS = new Set([
  "x",
  "y",
  "width",
  "height",
  "index",
  "r",
  "g",
  "b",
  "a",
  "radius",
  "cornerRadius",
  "strokeWeight",
  "weight",
  "size",
  "fontSize",
  "fontWeight",
  "rows",
  "columns",
  "gap",
  "rowGap",
  "columnGap",
  "counterAxisSpacing",
  "top",
  "right",
  "bottom",
  "left",
  "scale",
  "angle",
  "opacity",
  "rotation",
  "limit",
  "fillIndex",
  "insertionIndex",
  "spacing",
  "paragraphSpacing",
  "paragraphIndent",
  "fps",
  "quality",
  "loopCount",
  "constraintValue",
]);

const BOOLEAN_KEYS = new Set([
  "clipsContent",
  "flatten",
  "strokesIncludedInLayout",
  "includeCategories",
  "includeResolved",
  "fix",
  "clear",
  "overwrite",
  "overwriteExisting",
  "regenerateScales",
  "includeMetadata",
  "preserveCustom",
  "addChartColors",
  "dryRun",
  "defaults",
  "topLevelOnly",
  "includeComponents",
  "includeImages",
  "includeWeights",
  "includeLineHeights",
  "includeSemantic",
]);

const TRUE_STRINGS = new Set(["true", "1", "yes", "on"]);
const FALSE_STRINGS = new Set(["false", "0", "no", "off"]);

function coerceArrayValue(value: unknown): unknown {
  if (typeof value !== "string" || isResultReference(value)) return value;
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* fall through */
    }
  }
  if (trimmed.includes(",")) {
    return trimmed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return trimmed.length > 0 ? [trimmed] : value;
}

function coerceNumberValue(value: unknown): unknown {
  if (typeof value !== "string" || isResultReference(value) || value.trim() === "") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

function coerceBooleanValue(value: unknown): unknown {
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : value;
  if (typeof value !== "string" || isResultReference(value)) return value;
  const normalized = value.trim().toLowerCase();
  if (TRUE_STRINGS.has(normalized)) return true;
  if (FALSE_STRINGS.has(normalized)) return false;
  return value;
}

/** Mirrors the zod coercions (coerceArray, z.coerce.number, mcpBooleanSchema) the direct tools apply. */
function coerceTransportValues(p: CommandParams): void {
  for (const key of Object.keys(p)) {
    if (ARRAY_KEYS.has(key)) p[key] = coerceArrayValue(p[key]);
    else if (NUMBER_KEYS.has(key)) p[key] = coerceNumberValue(p[key]);
    else if (BOOLEAN_KEYS.has(key)) p[key] = coerceBooleanValue(p[key]);
  }
}

function normalizeIdValue(value: unknown): unknown {
  if (typeof value === "string") return normalizeNodeId(value);
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? normalizeNodeId(v) : v));
  return value;
}

function normalizeIds(p: CommandParams): void {
  for (const key of ID_KEYS) {
    if (p[key] !== undefined) p[key] = normalizeIdValue(p[key]);
  }
}

/** Moves `from` to `to` unless the internal name is already set; always drops `from`. */
function rename(p: CommandParams, from: string, to: string): void {
  if (!(from in p)) return;
  if (p[to] === undefined) p[to] = p[from];
  delete p[from];
}

function renameAll(p: CommandParams, pairs: Array<[string, string]>): void {
  for (const [from, to] of pairs) rename(p, from, to);
}

function first(p: CommandParams, ...keys: string[]): unknown {
  for (const key of keys) if (p[key] !== undefined) return p[key];
  return undefined;
}

function resolveDepthParam(p: CommandParams): void {
  const depth = coerceNumberValue(p.depth);
  if (depth === "all") p.depth = undefined;
  else if (depth === undefined) p.depth = 1;
  else p.depth = depth;
}

function colorFromChannels(p: CommandParams): void {
  if (p.color === undefined) {
    if (p.r === undefined || p.g === undefined || p.b === undefined) {
      throw new CommandParamsError("Provide either 'color' (hex string) or r, g, b components");
    }
    p.color = applyColorDefaults({
      r: p.r as number,
      g: p.g as number,
      b: p.b as number,
      a: p.a as number | undefined,
    });
  }
  delete p.r;
  delete p.g;
  delete p.b;
  delete p.a;
}

function normalizeVariableValue(type: unknown, value: unknown): unknown {
  if (isResultReference(value) || isResultReference(type) || typeof type !== "string") return value;
  return normalizeVariableValueByType(type as Parameters<typeof normalizeVariableValueByType>[0], value);
}

type Normalizer = (p: CommandParams) => void;

const COMMAND_NORMALIZERS: Record<string, Normalizer> = {
  // ── Creation ────────────────────────────────────────────────────────────
  create_rectangle: (p) => {
    p.name = p.name || "Rectangle";
  },
  create_frame: (p) => {
    p.name = p.name || "Frame";
    p.fillColor = p.fillColor || { r: 1, g: 1, b: 1, a: 1 };
  },
  create_text: (p) => {
    p.fontSize = p.fontSize || 14;
    p.fontFamily = p.fontFamily || "Inter";
    p.fontWeight = p.fontWeight || 400;
    p.fontColor = p.fontColor || { r: 0, g: 0, b: 0, a: 1 };
    p.name = p.name || "Text";
  },
  create_svg: (p) => {
    p.x = p.x ?? 0;
    p.y = p.y ?? 0;
    p.flatten = p.flatten ?? false;
  },

  // ── Components & prototyping ────────────────────────────────────────────
  create_component_instance: (p) => {
    if (p.parentId && p.replaceNodeId) {
      throw new CommandParamsError(
        "parentId and replaceNodeId are mutually exclusive. Provide one or the other, not both.",
      );
    }
    if (p.index !== undefined && !p.parentId) {
      throw new CommandParamsError("index can only be used when parentId is provided.");
    }
  },
  add_component_property: (p) => {
    if (p.type !== "SLOT" && !isResultReference(p.type) && p.slotSettings !== undefined) {
      throw new CommandParamsError("slotSettings only applies to SLOT-type properties");
    }
  },
  get_instance_overrides: (p) => {
    if (p.instanceNodeId === undefined) p.instanceNodeId = p.nodeId || null;
    delete p.nodeId;
  },
  set_instance_overrides: (p) => {
    p.targetNodeIds = p.targetNodeIds || [];
  },
  remove_prototype_link: (p) => {
    if (typeof p.destinationId === "string" && p.destinationId.length === 0) delete p.destinationId;
  },

  // ── Document & reading ──────────────────────────────────────────────────
  get_selection: resolveDepthParam,
  get_node_info: (p) => {
    if (p.nodeIds === undefined && p.nodeId !== undefined) {
      p.nodeIds = [p.nodeId];
      delete p.nodeId;
    }
    resolveDepthParam(p);
  },
  get_nodes_info: resolveDepthParam,
  scan_nodes_by_types: resolveDepthParam,
  search_nodes: resolveDepthParam,
  export_node_as_image: (p) => {
    if (typeof p.format === "string" && !isResultReference(p.format)) p.format = p.format.toUpperCase();
    p.format = p.format || "PNG";
    p.scale = p.scale || 1;
  },
  export_image_fill: (p) => {
    p.fillIndex = p.fillIndex ?? 0;
    delete p.exportPath;
  },
  lint_frame: (p) => {
    p.fix = p.fix ?? false;
    for (const key of ["ignoreNodeIds", "ignoreRules"]) {
      if (Array.isArray(p[key]) && (p[key] as unknown[]).length === 0) delete p[key];
    }
  },
  set_lint_ignore: (p) => {
    if (p.rules === undefined || p.rules === null) p.rules = "*";
    else if (typeof p.rules === "string" && p.rules.trim() !== "*") p.rules = coerceArrayValue(p.rules);
    p.clear = p.clear ?? false;
  },
  get_frame_documentation: (p) => {
    const ids = p.nodeIds ?? (p.nodeId ? [p.nodeId] : []);
    if (Array.isArray(ids) && ids.length === 0) throw new CommandParamsError("Provide nodeId or nodeIds");
    p.nodeIds = ids;
    delete p.nodeId;
    p.includeResolved = p.includeResolved ?? false;
  },
  get_annotations: (p) => {
    p.includeCategories = p.includeCategories ?? true;
  },
  create_annotation_category: (p) => {
    p.color = p.color ?? "blue";
  },
  get_comments: (p) => {
    p.includeResolved = p.includeResolved ?? false;
  },
  enumerate_all_frames: (p) => {
    p.topLevelOnly = p.topLevelOnly ?? true;
    p.includeComponents = p.includeComponents ?? false;
  },
  bulk_export_frames: (p) => {
    p.format = p.format ?? "PNG";
    p.scale = p.scale ?? 1;
  },
  get_content_tree: (p) => {
    p.maxDepth = coerceNumberValue(p.maxDepth) ?? 5;
    p.includeImages = p.includeImages ?? false;
  },
  setup_design_system: (p) => {
    if (!p.pages) delete p.pages;
    if (!p.collections) delete p.collections;
    if (Array.isArray(p.text_styles) && p.textStyles === undefined) {
      p.textStyles = (p.text_styles as Array<Record<string, unknown>>).map((ts) => ({
        name: ts.name,
        fontFamily: ts.font_family,
        fontStyle: ts.font_style,
        fontSize: ts.font_size,
        lineHeight: ts.line_height,
        letterSpacing: ts.letter_spacing,
        description: ts.description,
      }));
    }
    delete p.text_styles;
    if (p.effect_styles && p.effectStyles === undefined) p.effectStyles = p.effect_styles;
    delete p.effect_styles;
  },

  // ── Fills, strokes, styles ──────────────────────────────────────────────
  set_fill_color: colorFromChannels,
  set_stroke_color: (p) => {
    colorFromChannels(p);
    rename(p, "weight", "strokeWeight");
    p.strokeWeight = p.strokeWeight ?? FIGMA_DEFAULTS.stroke.weight;
  },
  set_corner_radius: (p) => {
    p.corners = p.corners || [true, true, true, true];
  },
  set_image_fill: (p) => {
    if (!p.imageUrl && !p.imageBytes) throw new CommandParamsError("Provide either imageUrl or imageBytes");
    if (p.imageUrl && p.imageBytes) {
      throw new CommandParamsError("Provide only one of imageUrl or imageBytes, not both");
    }
    p.scaleMode = p.scaleMode || "FILL";
  },
  set_gradient_fill: (p) => {
    rename(p, "type", "gradientType");
    p.angle = p.angle ?? 0;
    p.opacity = p.opacity ?? 1;
  },
  set_effect_style_id: (p) => {
    const resolved = p.effectStyleId || p.styleName;
    if (!resolved) throw new CommandParamsError("provide either effectStyleId or styleName");
    p.effectStyleId = resolved;
    delete p.styleName;
  },
  set_color_style_id: (p) => {
    const resolved = p.styleId || p.styleName;
    if (!resolved) throw new CommandParamsError("provide either styleId or styleName");
    p.styleId = resolved;
    delete p.styleName;
  },

  // ── Node operations ─────────────────────────────────────────────────────
  move_node: (p) => {
    if (p.x === undefined && p.y === undefined && p.parentId === undefined) {
      throw new CommandParamsError("provide x/y for repositioning or parentId for reparenting");
    }
  },

  // ── Layout ──────────────────────────────────────────────────────────────
  set_layout_mode: (p) => {
    renameAll(p, [
      ["mode", "layoutMode"],
      ["rows", "gridRowCount"],
      ["columns", "gridColumnCount"],
      ["wrap", "layoutWrap"],
    ]);
    const mode = p.layoutMode;
    if (mode === undefined) {
      throw new CommandParamsError("set_layout_mode requires mode (NONE, HORIZONTAL, VERTICAL or GRID)");
    }
    if (isResultReference(mode)) return;
    if (mode !== "GRID" && (p.gridRowCount !== undefined || p.gridColumnCount !== undefined)) {
      throw new CommandParamsError(`rows/columns apply to GRID mode only (mode is ${mode})`);
    }
    if (mode !== "GRID" && (p.gridAutoTracks !== undefined || p.gridItemsPositioning !== undefined)) {
      throw new CommandParamsError(`gridAutoTracks/gridItemsPositioning apply to GRID mode only (mode is ${mode})`);
    }
    if (mode === "GRID" && p.layoutWrap !== undefined) {
      throw new CommandParamsError(
        "wrap does not apply to GRID mode — grid children are placed on tracks, not wrapped",
      );
    }
    if (mode !== "GRID") p.layoutWrap = p.layoutWrap || "NO_WRAP";
  },
  set_padding: (p) => {
    renameAll(p, [
      ["top", "paddingTop"],
      ["right", "paddingRight"],
      ["bottom", "paddingBottom"],
      ["left", "paddingLeft"],
    ]);
  },
  set_layout_sizing: (p) => {
    renameAll(p, [
      ["horizontal", "layoutSizingHorizontal"],
      ["vertical", "layoutSizingVertical"],
    ]);
  },
  set_item_spacing: (p) => {
    renameAll(p, [
      ["gap", "itemSpacing"],
      ["rowGap", "gridRowGap"],
      ["columnGap", "gridColumnGap"],
    ]);
  },
  set_auto_layout: (p) => {
    const mode = first(p, "mode", "layoutMode");
    if (mode === undefined) {
      throw new CommandParamsError("set_auto_layout requires mode (HORIZONTAL, VERTICAL, GRID or NONE)");
    }
    if (!isResultReference(mode)) {
      const gridOnly = [
        first(p, "rows", "gridRowCount"),
        first(p, "columns", "gridColumnCount"),
        first(p, "rowGap", "gridRowGap"),
        first(p, "columnGap", "gridColumnGap"),
        p.gridAutoTracks,
        p.gridItemsPositioning,
      ];
      if (mode !== "GRID" && gridOnly.some((v) => v !== undefined)) {
        throw new CommandParamsError(
          `rows/columns/rowGap/columnGap/gridAutoTracks/gridItemsPositioning apply to GRID mode only (mode is ${mode})`,
        );
      }
      if (mode === "GRID") {
        const flexOnly: string[] = [];
        if (p.primaryAxisAlignItems !== undefined) flexOnly.push("primaryAxisAlignItems");
        if (p.counterAxisAlignItems !== undefined) flexOnly.push("counterAxisAlignItems");
        if (first(p, "wrap", "layoutWrap") !== undefined) flexOnly.push("wrap");
        if (flexOnly.length > 0) {
          throw new CommandParamsError(
            `${flexOnly.join("/")} do not apply to GRID mode — use rows/columns for placement and rowGap/columnGap for spacing`,
          );
        }
      }
    }
    renameAll(p, [
      ["mode", "layoutMode"],
      ["top", "paddingTop"],
      ["bottom", "paddingBottom"],
      ["left", "paddingLeft"],
      ["right", "paddingRight"],
      ["gap", "itemSpacing"],
      ["rows", "gridRowCount"],
      ["columns", "gridColumnCount"],
      ["rowGap", "gridRowGap"],
      ["columnGap", "gridColumnGap"],
      ["wrap", "layoutWrap"],
      ["horizontal", "layoutSizingHorizontal"],
      ["vertical", "layoutSizingVertical"],
    ]);
  },

  // ── Text ────────────────────────────────────────────────────────────────
  set_multiple_text_contents: (p) => {
    if (Array.isArray(p.text)) {
      p.text = (p.text as unknown[]).map((item) =>
        item && typeof item === "object" && typeof (item as CommandParams).nodeId === "string"
          ? { ...(item as CommandParams), nodeId: normalizeNodeId((item as CommandParams).nodeId as string) }
          : item,
      );
    }
  },
  set_font_size: (p) => rename(p, "size", "fontSize"),
  set_letter_spacing: (p) => {
    rename(p, "spacing", "letterSpacing");
    p.unit = p.unit || "PIXELS";
  },
  set_line_height: (p) => {
    rename(p, "height", "lineHeight");
    p.unit = p.unit || "PIXELS";
  },
  set_paragraph_spacing: (p) => rename(p, "spacing", "paragraphSpacing"),
  set_text_decoration: (p) => rename(p, "decoration", "textDecoration"),
  load_font_async: (p) => {
    p.style = p.style || "Regular";
  },
  apply_text_style: (p) => {
    const resolved = p.styleId || p.styleName;
    if (!resolved) throw new CommandParamsError("either styleId or styleName is required");
    p.styleId = resolved;
    delete p.styleName;
  },

  // ── Variables ───────────────────────────────────────────────────────────
  create_variable_collection: (p) => {
    p.defaultMode = p.defaultMode || "dark";
  },
  get_collection_info: (p) => rename(p, "id", "collectionId"),
  rename_variable_collection: (p) =>
    renameAll(p, [
      ["id", "collectionId"],
      ["name", "newName"],
    ]),
  delete_variable_collection: (p) => rename(p, "id", "collectionId"),
  create_variable: (p) => {
    p.value = normalizeVariableValue(p.type, p.value);
  },
  create_variables_batch: (p) => {
    if (Array.isArray(p.variables)) {
      p.variables = (p.variables as CommandParams[]).map((v) =>
        v && typeof v === "object" ? { ...v, value: normalizeVariableValue(v.type, v.value) } : v,
      );
    }
  },
  rename_variable: (p) =>
    renameAll(p, [
      ["id", "variableId"],
      ["name", "newName"],
    ]),
  delete_variable: (p) => rename(p, "id", "variableId"),
  delete_variables_batch: (p) => rename(p, "ids", "variableIds"),
  audit_collection: (p) => {
    rename(p, "chartColors", "includeChartColors");
    p.includeChartColors = coerceBooleanValue(p.includeChartColors) || false;
  },
  validate_color_contrast: (p) => {
    p.standard = p.standard || "AA";
  },
  suggest_missing_variables: (p) => {
    rename(p, "defaults", "useDefaults");
    p.useDefaults = p.useDefaults !== false;
  },
  apply_default_theme: (p) => {
    rename(p, "overwrite", "overwriteExisting");
    rename(p, "chartColors", "includeChartColors");
    p.overwriteExisting = p.overwriteExisting || false;
    p.includeChartColors = coerceBooleanValue(p.includeChartColors) || false;
  },
  create_color_scale_set: (p) =>
    renameAll(p, [
      ["base", "baseColor"],
      ["foreground", "foregroundColor"],
      ["background", "backgroundColor"],
    ]),
  apply_custom_palette: (p) => {
    rename(p, "background", "backgroundColor");
    p.regenerateScales = p.regenerateScales !== false;
  },
  reorder_variables: (p) => {
    p.order = p.order || "standard";
  },
  generate_audit_report: (p) => {
    rename(p, "chartColors", "includeChartColors");
    p.includeChartColors = coerceBooleanValue(p.includeChartColors) || false;
    p.format = p.format || "markdown";
  },
  export_collection_schema: (p) => {
    p.includeMetadata = p.includeMetadata !== false;
  },
  import_collection_schema: (p) => {
    p.overwriteExisting = p.overwriteExisting || false;
  },
  create_all_scales: (p) =>
    renameAll(p, [
      ["colors", "baseColors"],
      ["background", "backgroundColor"],
    ]),
  fix_collection_to_standard: (p) => {
    rename(p, "defaults", "useDefaultValues");
    p.preserveCustom = p.preserveCustom || false;
    p.addChartColors = p.addChartColors || false;
    p.useDefaultValues = p.useDefaultValues !== false;
    p.dryRun = p.dryRun || false;
  },
  add_chart_colors: (p) => rename(p, "id", "collectionId"),
  add_mode_to_collection: (p) =>
    renameAll(p, [
      ["id", "collectionId"],
      ["name", "modeName"],
    ]),
  rename_mode: (p) =>
    renameAll(p, [
      ["id", "collectionId"],
      ["oldName", "oldModeName"],
      ["newName", "newModeName"],
    ]),
  delete_mode: (p) =>
    renameAll(p, [
      ["id", "collectionId"],
      ["name", "modeName"],
    ]),
  duplicate_mode_values: (p) =>
    renameAll(p, [
      ["id", "collectionId"],
      ["from", "sourceMode"],
      ["to", "targetMode"],
    ]),
  // The plugin's token-system handlers read snake_case names.
  create_spacing_system: (p) => rename(p, "collectionId", "collection_id"),
  create_typography_system: (p) => {
    renameAll(p, [
      ["collectionId", "collection_id"],
      ["scalePreset", "scale_preset"],
      ["baseSize", "base_size"],
      ["includeWeights", "include_weights"],
      ["includeLineHeights", "include_line_heights"],
    ]);
    p.base_size = p.base_size ?? 16;
    p.include_weights = p.include_weights ?? true;
    p.include_line_heights = p.include_line_heights ?? true;
  },
  create_radius_system: (p) => rename(p, "collectionId", "collection_id"),
};

/** Commands whose public params differ from the plugin payload (beyond node-id normalization). */
export const NORMALIZED_COMMANDS: readonly string[] = Object.keys(COMMAND_NORMALIZERS);

/**
 * Convert a tool's public params into the payload its plugin handler expects:
 * transport coercion (JSON-string arrays, numeric/boolean strings), per-command
 * renames/defaults/validation, and node-id normalization (`1-2` → `1:2`).
 * `$result[N]` reference strings are never rewritten. Throws CommandParamsError
 * for invalid combinations the direct tool would reject.
 */
export function normalizeCommandParams(command: string, params?: CommandParams | null): CommandParams {
  const p: CommandParams = { ...(params ?? {}) };
  coerceTransportValues(p);
  const normalizer = COMMAND_NORMALIZERS[command];
  if (normalizer) normalizer(p);
  normalizeIds(p);
  return p;
}
