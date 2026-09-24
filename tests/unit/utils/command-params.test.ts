import {
  normalizeCommandParams,
  NORMALIZED_COMMANDS,
  CommandParamsError,
} from "../../../src/videntia_figma_mcp/utils/command-params";

const RGB = { r: 0.1, g: 0.2, b: 0.3 };
const RGB2 = { r: 0.9, g: 0.8, b: 0.7 };

type Case = [command: string, input: Record<string, unknown>, expected: Record<string, unknown>];

const CASES: Case[] = [
  [
    "create_rectangle",
    { x: 0, y: 0, width: 10, height: 10, parentId: "1-2" },
    { x: 0, y: 0, width: 10, height: 10, parentId: "1:2", name: "Rectangle" },
  ],
  [
    "create_frame",
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 0, y: 0, width: 10, height: 10, name: "Frame", fillColor: { r: 1, g: 1, b: 1, a: 1 } },
  ],
  [
    "create_text",
    { x: 0, y: 0, text: "Hi" },
    {
      x: 0,
      y: 0,
      text: "Hi",
      fontSize: 14,
      fontFamily: "Inter",
      fontWeight: 400,
      fontColor: { r: 0, g: 0, b: 0, a: 1 },
      name: "Text",
    },
  ],
  ["create_svg", { svgString: "<svg/>" }, { svgString: "<svg/>", x: 0, y: 0, flatten: false }],
  [
    "create_component_instance",
    { componentKey: "k", x: "5", y: 0, parentId: "1-2", index: "2" },
    { componentKey: "k", x: 5, y: 0, parentId: "1:2", index: 2 },
  ],
  [
    "add_component_property",
    { nodeId: "1-2", propertyName: "Label", type: "TEXT", defaultValue: "Hi" },
    { nodeId: "1:2", propertyName: "Label", type: "TEXT", defaultValue: "Hi" },
  ],
  ["get_instance_overrides", { nodeId: "1-2" }, { instanceNodeId: "1:2" }],
  ["set_instance_overrides", { sourceInstanceId: "1-2" }, { sourceInstanceId: "1:2", targetNodeIds: [] }],
  // An empty destinationId is NOT erased: erasing it meant "clear every reaction",
  // so a destination that resolved to "" silently wiped the node. It now reaches
  // the tool, which rejects it.
  ["remove_prototype_link", { nodeId: "1-2", destinationId: "" }, { nodeId: "1:2", destinationId: "" }],
  ["get_selection", {}, { depth: 1 }],
  ["get_node_info", { nodeId: "1-2" }, { nodeIds: ["1:2"], depth: 1 }],
  ["get_nodes_info", { nodeIds: '["1-2","3-4"]', depth: "2" }, { nodeIds: ["1:2", "3:4"], depth: 2 }],
  [
    "scan_nodes_by_types",
    { nodeId: "1-2", types: "FRAME,TEXT" },
    { nodeId: "1:2", types: ["FRAME", "TEXT"], depth: 1 },
  ],
  ["search_nodes", { query: "Button", depth: "all" }, { query: "Button", depth: undefined }],
  ["export_node_as_image", { nodeId: "1-2", format: "svg" }, { nodeId: "1:2", format: "SVG", scale: 1 }],
  ["export_image_fill", { nodeId: "1-2" }, { nodeId: "1:2", fillIndex: 0 }],
  ["lint_frame", { nodeId: "1-2" }, { nodeId: "1:2", fix: false }],
  [
    "lint_frame",
    { nodeId: "1-2", fix: "true", ignoreNodeIds: '["3-4"]', ignoreRules: "overflow, clipped-content" },
    { nodeId: "1:2", fix: true, ignoreNodeIds: ["3:4"], ignoreRules: ["overflow", "clipped-content"] },
  ],
  ["lint_frame", { nodeId: "1:2", ignoreNodeIds: [], ignoreRules: [] }, { nodeId: "1:2", fix: false }],
  ["set_lint_ignore", { nodeId: "1-2" }, { nodeId: "1:2", rules: "*", clear: false }],
  [
    "set_lint_ignore",
    { nodeId: "1-2", rules: "overflow,hardcoded-color", clear: "false" },
    { nodeId: "1:2", rules: ["overflow", "hardcoded-color"], clear: false },
  ],
  ["get_frame_documentation", { nodeId: "1:2" }, { nodeIds: ["1:2"], includeResolved: false }],
  ["get_annotations", { nodeId: "1-2" }, { nodeId: "1:2", includeCategories: true }],
  ["create_annotation_category", { label: "Spec" }, { label: "Spec", color: "blue" }],
  ["get_comments", {}, { includeResolved: false }],
  ["enumerate_all_frames", {}, { topLevelOnly: true, includeComponents: false }],
  ["bulk_export_frames", { nodeIds: ["1:2"] }, { nodeIds: ["1:2"], format: "PNG", scale: 1 }],
  ["get_content_tree", { nodeId: "1:2" }, { nodeId: "1:2", maxDepth: 5, includeImages: false }],
  [
    "setup_design_system",
    {
      text_styles: [{ name: "Body", font_family: "Inter", font_style: "Regular", font_size: 16 }],
      effect_styles: [{ name: "s" }],
    },
    {
      textStyles: [{ name: "Body", fontFamily: "Inter", fontStyle: "Regular", fontSize: 16 }],
      effectStyles: [{ name: "s" }],
    },
  ],
  ["set_fill_color", { nodeId: "1-2", r: "1", g: 0, b: 0 }, { nodeId: "1:2", color: { r: 1, g: 0, b: 0, a: 1 } }],
  ["set_stroke_color", { nodeId: "1-2", color: "#fff", weight: 2 }, { nodeId: "1:2", color: "#fff", strokeWeight: 2 }],
  ["set_corner_radius", { nodeId: "1-2", radius: 4 }, { nodeId: "1:2", radius: 4, corners: [true, true, true, true] }],
  [
    "set_image_fill",
    { nodeId: "1-2", imageUrl: "https://x.test/a.png" },
    { nodeId: "1:2", imageUrl: "https://x.test/a.png", scaleMode: "FILL" },
  ],
  [
    "set_gradient_fill",
    { nodeId: "1-2", type: "LINEAR", stops: [] },
    { nodeId: "1:2", gradientType: "LINEAR", stops: [], angle: 0, opacity: 1 },
  ],
  [
    "set_gradient_fill",
    { nodeId: "1-2", type: "LINEAR", stops: '[{"colorVariable":"brand/primary","position":0}]' },
    {
      nodeId: "1:2",
      gradientType: "LINEAR",
      stops: [{ colorVariable: "brand/primary", position: 0 }],
      angle: 0,
      opacity: 1,
    },
  ],
  ["set_effect_style_id", { nodeId: "1-2", styleName: "shadow/md" }, { nodeId: "1:2", effectStyleId: "shadow/md" }],
  ["set_color_style_id", { nodeId: "1-2", styleName: "color/primary" }, { nodeId: "1:2", styleId: "color/primary" }],
  ["move_node", { nodeId: "1-2", x: "10" }, { nodeId: "1:2", x: 10 }],
  ["set_constraints", { nodeIds: "1-2,3-4", horizontal: "CENTER" }, { nodeIds: ["1:2", "3:4"], horizontal: "CENTER" }],
  ["set_constraints", { nodeId: "1-2", vertical: "STRETCH" }, { nodeId: "1:2", vertical: "STRETCH" }],
  [
    "set_layout_mode",
    { nodeId: "1-2", mode: "GRID", rows: 2, columns: 3 },
    { nodeId: "1:2", layoutMode: "GRID", gridRowCount: 2, gridColumnCount: 3 },
  ],
  [
    "set_grid_child",
    { nodeId: "1-2", row: "1", column: 0, rowSpan: "2", horizontalAlign: "CENTER" },
    { nodeId: "1:2", row: 1, column: 0, rowSpan: 2, horizontalAlign: "CENTER" },
  ],
  ["set_padding", { nodeId: "1-2", top: 8, left: "4" }, { nodeId: "1:2", paddingTop: 8, paddingLeft: 4 }],
  [
    "set_layout_sizing",
    { nodeId: "1-2", horizontal: "FILL", vertical: "HUG" },
    { nodeId: "1:2", layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" },
  ],
  [
    "set_item_spacing",
    { nodeId: "1-2", gap: 8, rowGap: 4, columnGap: 2 },
    { nodeId: "1:2", itemSpacing: 8, gridRowGap: 4, gridColumnGap: 2 },
  ],
  [
    "set_auto_layout",
    {
      nodeId: "1-2",
      mode: "GRID",
      rows: 2,
      columns: 3,
      rowGap: 8,
      columnGap: 6,
      top: 1,
      bottom: 2,
      left: 3,
      right: 4,
      gap: 5,
      horizontal: "HUG",
      vertical: "FIXED",
    },
    {
      nodeId: "1:2",
      layoutMode: "GRID",
      gridRowCount: 2,
      gridColumnCount: 3,
      gridRowGap: 8,
      gridColumnGap: 6,
      paddingTop: 1,
      paddingBottom: 2,
      paddingLeft: 3,
      paddingRight: 4,
      itemSpacing: 5,
      layoutSizingHorizontal: "HUG",
      layoutSizingVertical: "FIXED",
    },
  ],
  [
    "set_multiple_text_contents",
    { nodeId: "1-2", text: [{ nodeId: "3-4", text: "a" }] },
    { nodeId: "1:2", text: [{ nodeId: "3:4", text: "a" }] },
  ],
  ["set_font_size", { nodeId: "1-2", size: 16 }, { nodeId: "1:2", fontSize: 16 }],
  ["set_letter_spacing", { nodeId: "1-2", spacing: 1 }, { nodeId: "1:2", letterSpacing: 1, unit: "PIXELS" }],
  [
    "set_line_height",
    { nodeId: "1-2", height: 150, unit: "PERCENT" },
    { nodeId: "1:2", lineHeight: 150, unit: "PERCENT" },
  ],
  ["set_paragraph_spacing", { nodeId: "1-2", spacing: 4 }, { nodeId: "1:2", paragraphSpacing: 4 }],
  ["set_text_decoration", { nodeId: "1-2", decoration: "UNDERLINE" }, { nodeId: "1:2", textDecoration: "UNDERLINE" }],
  [
    "set_text_range_style",
    {
      nodeId: "1-2",
      ranges: '[{"start":"0","end":"5","fontWeight":"600","color":"#f00"},{"start":6,"end":11,"lineHeight":"AUTO"}]',
    },
    {
      nodeId: "1:2",
      ranges: [
        { start: 0, end: 5, fontWeight: 600, color: "#f00" },
        { start: 6, end: 11, lineHeight: "AUTO" },
      ],
    },
  ],
  [
    "set_text_align",
    { nodeIds: '["1-2","3-4"]', horizontal: "CENTER", vertical: "BOTTOM" },
    { nodeIds: ["1:2", "3:4"], textAlignHorizontal: "CENTER", textAlignVertical: "BOTTOM" },
  ],
  ["load_font_async", { family: "Inter" }, { family: "Inter", style: "Regular" }],
  ["apply_text_style", { nodeId: "1-2", styleName: "Body" }, { nodeId: "1:2", styleId: "Body" }],
  ["create_variable_collection", { name: "Theme" }, { name: "Theme", defaultMode: "dark" }],
  ["get_collection_info", { id: "c1" }, { collectionId: "c1" }],
  ["rename_variable_collection", { id: "c1", name: "New" }, { collectionId: "c1", newName: "New" }],
  ["delete_variable_collection", { id: "c1" }, { collectionId: "c1" }],
  [
    "create_variable",
    { collectionId: "c1", name: "brand", type: "COLOR", value: "#ff0000" },
    { collectionId: "c1", name: "brand", type: "COLOR", value: { r: 1, g: 0, b: 0, a: 1 } },
  ],
  [
    "create_variables_batch",
    { collectionId: "c1", variables: [{ name: "s", type: "FLOAT", value: "4" }] },
    { collectionId: "c1", variables: [{ name: "s", type: "FLOAT", value: 4 }] },
  ],
  ["rename_variable", { id: "v1", name: "b" }, { variableId: "v1", newName: "b" }],
  ["delete_variable", { id: "v1" }, { variableId: "v1" }],
  ["delete_variables_batch", { ids: "v1,v2" }, { variableIds: ["v1", "v2"] }],
  ["audit_collection", { collectionId: "c1", chartColors: "true" }, { collectionId: "c1", includeChartColors: true }],
  ["validate_color_contrast", { collectionId: "c1" }, { collectionId: "c1", standard: "AA" }],
  ["suggest_missing_variables", { collectionId: "c1", defaults: false }, { collectionId: "c1", useDefaults: false }],
  [
    "apply_default_theme",
    { collectionId: "c1", overwrite: true },
    { collectionId: "c1", overwriteExisting: true, includeChartColors: false },
  ],
  [
    "create_color_scale_set",
    { collectionId: "c1", colorName: "brand", base: RGB, foreground: RGB2, background: RGB },
    { collectionId: "c1", colorName: "brand", baseColor: RGB, foregroundColor: RGB2, backgroundColor: RGB },
  ],
  [
    "apply_custom_palette",
    { collectionId: "c1", palette: {}, background: RGB },
    { collectionId: "c1", palette: {}, backgroundColor: RGB, regenerateScales: true },
  ],
  ["reorder_variables", { collectionId: "c1" }, { collectionId: "c1", order: "standard" }],
  [
    "generate_audit_report",
    { collectionId: "c1" },
    { collectionId: "c1", includeChartColors: false, format: "markdown" },
  ],
  ["export_collection_schema", { collectionId: "c1" }, { collectionId: "c1", includeMetadata: true }],
  [
    "import_collection_schema",
    { collectionId: "c1", schema: {} },
    { collectionId: "c1", schema: {}, overwriteExisting: false },
  ],
  [
    "create_all_scales",
    { collectionId: "c1", colors: { brand: RGB }, background: RGB2 },
    { collectionId: "c1", baseColors: { brand: RGB }, backgroundColor: RGB2 },
  ],
  [
    "fix_collection_to_standard",
    { collectionId: "c1" },
    { collectionId: "c1", preserveCustom: false, addChartColors: false, useDefaultValues: true, dryRun: false },
  ],
  ["add_chart_colors", { id: "c1", chartColors: [RGB] }, { collectionId: "c1", chartColors: [RGB] }],
  ["add_mode_to_collection", { id: "c1", name: "Dark" }, { collectionId: "c1", modeName: "Dark" }],
  [
    "rename_mode",
    { id: "c1", oldName: "Light", newName: "Day" },
    { collectionId: "c1", oldModeName: "Light", newModeName: "Day" },
  ],
  ["delete_mode", { id: "c1", name: "Dark" }, { collectionId: "c1", modeName: "Dark" }],
  [
    "duplicate_mode_values",
    { id: "c1", from: "Light", to: "Dark" },
    { collectionId: "c1", sourceMode: "Light", targetMode: "Dark" },
  ],
  ["create_spacing_system", { collectionId: "c1", preset: "8pt" }, { collection_id: "c1", preset: "8pt" }],
  [
    "create_typography_system",
    { collectionId: "c1", scalePreset: "major-third", baseSize: 16, includeWeights: true, includeLineHeights: false },
    {
      collection_id: "c1",
      scale_preset: "major-third",
      base_size: 16,
      include_weights: true,
      include_line_heights: false,
    },
  ],
  [
    "create_typography_system",
    { collectionId: "c1", scalePreset: "major-third" },
    {
      collection_id: "c1",
      scale_preset: "major-third",
      base_size: 16,
      include_weights: true,
      include_line_heights: true,
    },
  ],
  ["create_radius_system", { collectionId: "c1", preset: "standard" }, { collection_id: "c1", preset: "standard" }],
  ["set_visible", { nodeId: "1-2", visible: "false" }, { nodeId: "1:2", visible: false }],
  ["set_visible", { nodeIds: '["1-2","3-4"]', visible: "TRUE" }, { nodeIds: ["1:2", "3:4"], visible: true }],
  ["set_visible", { nodeId: "$result[0].id", nodeIds: [], visible: 0 }, { nodeId: "$result[0].id", visible: false }],
];

describe("normalizeCommandParams", () => {
  it.each(CASES)("%s maps public params to the plugin payload", (command, input, expected) => {
    expect(normalizeCommandParams(command, input)).toEqual(expected);
  });

  it("has a case for every command with a custom mapping", () => {
    const covered = new Set(CASES.map(([command]) => command));
    expect(NORMALIZED_COMMANDS.filter((command) => !covered.has(command))).toEqual([]);
  });

  it("does not mutate the caller's params", () => {
    const input = { nodeId: "1-2", horizontal: "FILL" };
    normalizeCommandParams("set_layout_sizing", input);
    expect(input).toEqual({ nodeId: "1-2", horizontal: "FILL" });
  });

  it("normalizes node ids for commands without a custom mapping", () => {
    expect(normalizeCommandParams("rename_node", { nodeId: "12-34", name: "A" })).toEqual({
      nodeId: "12:34",
      name: "A",
    });
    expect(normalizeCommandParams("insert_child", { parentId: "1-2", childId: "I1:2;3:4", index: 0 })).toEqual({
      parentId: "1:2",
      childId: "I1:2;3:4",
      index: 0,
    });
  });

  describe("backward compatibility with internal names", () => {
    it("keeps internal names unchanged", () => {
      const params = { nodeId: "1:2", layoutMode: "GRID", gridRowCount: 2, gridColumnCount: 2 };
      expect(normalizeCommandParams("set_layout_mode", params)).toEqual(params);
      expect(normalizeCommandParams("set_padding", { nodeId: "1:2", paddingTop: 4 })).toEqual({
        nodeId: "1:2",
        paddingTop: 4,
      });
    });

    it("prefers the internal name when both are given", () => {
      expect(
        normalizeCommandParams("set_layout_sizing", {
          nodeId: "1:2",
          horizontal: "HUG",
          layoutSizingHorizontal: "FILL",
        }),
      ).toEqual({ nodeId: "1:2", layoutSizingHorizontal: "FILL" });
    });

    it("set_auto_layout validates the internal layoutMode it sends when both names are given", () => {
      expect(
        normalizeCommandParams("set_auto_layout", { nodeId: "1:2", mode: "HORIZONTAL", layoutMode: "GRID", rows: 2 }),
      ).toEqual({ nodeId: "1:2", layoutMode: "GRID", gridRowCount: 2 });
      expect(() =>
        normalizeCommandParams("set_auto_layout", { nodeId: "1:2", mode: "GRID", layoutMode: "HORIZONTAL", rows: 2 }),
      ).toThrow("apply to GRID mode only");
    });
  });

  describe("$result references", () => {
    it("never rewrites reference strings", () => {
      expect(normalizeCommandParams("set_padding", { nodeId: "$result[0].id", top: "$result[1].paddingTop" })).toEqual({
        nodeId: "$result[0].id",
        paddingTop: "$result[1].paddingTop",
      });
      expect(normalizeCommandParams("delete_multiple_nodes", { nodeIds: "$result[0].ids" })).toEqual({
        nodeIds: "$result[0].ids",
      });
      expect(normalizeCommandParams("set_fill_color", { nodeId: "$result[2].id", color: "$result[0].hex" })).toEqual({
        nodeId: "$result[2].id",
        color: "$result[0].hex",
      });
    });

    it("skips mode validation when the mode is a reference", () => {
      expect(
        normalizeCommandParams("set_layout_mode", { nodeId: "1:2", mode: "$result[0].layoutMode", rows: 2 }),
      ).toEqual({
        nodeId: "1:2",
        layoutMode: "$result[0].layoutMode",
        gridRowCount: 2,
      });
    });
  });

  describe("validation mirrors the direct tools", () => {
    it.each<[string, Record<string, unknown>, string]>([
      ["set_layout_mode", { nodeId: "1:2", mode: "HORIZONTAL", rows: 2 }, "rows/columns apply to GRID mode only"],
      [
        "set_layout_mode",
        { nodeId: "1:2", mode: "VERTICAL", gridAutoTracks: "ROWS" },
        "gridAutoTracks/gridItemsPositioning apply to GRID mode only",
      ],
      ["set_layout_mode", { nodeId: "1:2", mode: "GRID", wrap: "WRAP" }, "wrap does not apply to GRID mode"],
      ["set_layout_mode", { nodeId: "1:2" }, "set_layout_mode requires mode"],
      ["set_auto_layout", { nodeId: "1:2", mode: "HORIZONTAL", columns: 2 }, "apply to GRID mode only"],
      ["set_auto_layout", { nodeId: "1:2", mode: "GRID", wrap: "WRAP" }, "wrap do not apply to GRID mode"],
      ["set_auto_layout", { nodeId: "1:2" }, "set_auto_layout requires mode"],
      ["set_fill_color", { nodeId: "1:2", r: 1 }, "Provide either 'color'"],
      ["set_stroke_color", { nodeId: "1:2" }, "Provide either 'color'"],
      ["apply_text_style", { nodeId: "1:2" }, "either styleId or styleName is required"],
      ["set_text_range_style", { nodeId: "1:2", ranges: [] }, "requires a non-empty ranges array"],
      ["set_text_range_style", { nodeId: "1:2" }, "requires a non-empty ranges array"],
      ["set_text_align", { horizontal: "CENTER" }, "set_text_align requires nodeId or nodeIds"],
      ["set_text_align", { nodeIds: [], horizontal: "CENTER" }, "set_text_align requires nodeId or nodeIds"],
      ["set_text_align", { nodeId: "1:2" }, "set_text_align requires horizontal and/or vertical"],
      ["set_effect_style_id", { nodeId: "1:2" }, "provide either effectStyleId or styleName"],
      ["set_color_style_id", { nodeId: "1:2" }, "provide either styleId or styleName"],
      ["move_node", { nodeId: "1:2" }, "provide x/y for repositioning or parentId for reparenting"],
      ["set_constraints", { horizontal: "MIN" }, "set_constraints requires nodeId or nodeIds"],
      ["set_constraints", { nodeIds: [], horizontal: "MIN" }, "set_constraints requires nodeId or nodeIds"],
      ["set_constraints", { nodeId: "1:2" }, "set_constraints requires horizontal and/or vertical"],
      ["set_image_fill", { nodeId: "1:2" }, "Provide either imageUrl or imageBytes"],
      [
        "set_image_fill",
        { nodeId: "1:2", imageUrl: "u", imageBytes: "b" },
        "Provide only one of imageUrl or imageBytes",
      ],
      ["get_frame_documentation", {}, "Provide nodeId or nodeIds"],
      [
        "set_gradient_fill",
        { nodeId: "1:2", type: "LINEAR", stops: [{ position: 0 }, { color: RGB, position: 1 }] },
        "stops[0] needs a color or a colorVariable",
      ],
      ["create_component_instance", { componentKey: "k", parentId: "1:2", replaceNodeId: "3:4" }, "mutually exclusive"],
      [
        "create_component_instance",
        { componentKey: "k", index: 1 },
        "index can only be used when parentId is provided",
      ],
      [
        "add_component_property",
        { nodeId: "1:2", propertyName: "P", type: "TEXT", slotSettings: {} },
        "slotSettings only applies to SLOT-type properties",
      ],
    ])("%s rejects %j", (command, input, message) => {
      expect(() => normalizeCommandParams(command, input)).toThrow(message);
    });

    it("throws CommandParamsError for invalid combinations", () => {
      expect(() => normalizeCommandParams("move_node", { nodeId: "1:2" })).toThrow(CommandParamsError);
    });

    it("rejects invalid variable values", () => {
      expect(() => normalizeCommandParams("create_variable", { type: "FLOAT", value: "abc" })).toThrow(
        "Invalid FLOAT value",
      );
    });
  });
});
