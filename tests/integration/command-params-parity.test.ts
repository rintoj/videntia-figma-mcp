/**
 * Drift guard: for every command whose MCP tool reshapes its params, the payload the
 * direct tool sends to Figma must equal what batch_actions sends for the same public
 * params (normalizeCommandParams on the raw, un-parsed input).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerCreationTools } from "../../src/videntia_figma_mcp/tools/creation-tools";
import { registerModificationTools } from "../../src/videntia_figma_mcp/tools/modification-tools";
import { registerTextTools } from "../../src/videntia_figma_mcp/tools/text-tools";
import { registerComponentTools } from "../../src/videntia_figma_mcp/tools/component-tools";
import { registerVariableTools } from "../../src/videntia_figma_mcp/tools/variable-tools";
import { registerDocumentTools } from "../../src/videntia_figma_mcp/tools/document-tools";
import { registerDocumentationTools } from "../../src/videntia_figma_mcp/tools/documentation-tools";
import { registerIconTools, resolveUpdateIconParams } from "../../src/videntia_figma_mcp/tools/icon-tools";
import { normalizeCommandParams } from "../../src/videntia_figma_mcp/utils/command-params";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
  getOpenChannels: jest.fn(),
}));

const RGB = { r: 0.1, g: 0.2, b: 0.3 };
const RGB2 = { r: 0.9, g: 0.8, b: 0.7 };

interface ParityCase {
  tool: string;
  args: Record<string, unknown>;
  /** Figma command the direct tool sends, when it differs from the tool name. */
  command?: string;
}

const CASES: ParityCase[] = [
  // Creation
  { tool: "create_rectangle", args: { x: 1, y: 2, width: 10, height: 20, parentId: "1-2" } },
  { tool: "create_frame", args: { x: 1, y: 2, width: 10, height: 20, parentId: "1-2", clipsContent: false } },
  { tool: "create_text", args: { x: 0, y: 0, text: "Hi", parentId: "1-2" } },
  { tool: "create_svg", args: { svgString: "<svg></svg>", parentId: "1-2" } },
  { tool: "clone_node", args: { nodeId: "1-2", parentId: "3-4", index: 0 } },
  { tool: "insert_child", args: { parentId: "1-2", childId: "3-4", index: 1 } },
  { tool: "group_nodes", args: { nodeIds: ["1-2", "3-4"], name: "G" } },
  { tool: "ungroup_nodes", args: { nodeId: "1-2" } },
  { tool: "flatten_node", args: { nodeId: "1-2" } },
  // Components
  { tool: "create_component", args: { nodeId: "1-2", name: "Button" } },
  { tool: "create_component_set", args: { nodeIds: ["1-2", "3-4"], name: "Button" } },
  { tool: "create_component_instance", args: { componentKey: "abc", x: 0, y: 0, parentId: "1-2", index: 1 } },
  { tool: "get_instance_overrides", args: { nodeId: "1-2" } },
  { tool: "set_instance_overrides", args: { sourceInstanceId: "1-2", targetNodeIds: ["3-4"] } },
  { tool: "remove_prototype_link", args: { nodeId: "1-2", destinationId: "" } },
  { tool: "add_component_property", args: { nodeId: "1-2", propertyName: "Label", type: "TEXT", defaultValue: "Hi" } },
  { tool: "get_component_properties", args: { nodeId: "1-2" } },
  { tool: "detach_instance", args: { nodeId: "1-2" } },
  // Document & reading
  { tool: "get_selection", args: {} },
  { tool: "get_node_info", args: { nodeId: "1-2" } },
  { tool: "get_nodes_info", args: { nodeIds: ["1-2", "3-4"] }, command: "get_node_info" },
  { tool: "search_nodes", args: { query: "Button", nodeId: "1-2" } },
  { tool: "scan_nodes_by_types", args: { nodeId: "1-2", types: ["FRAME"] } },
  { tool: "export_node_as_image", args: { nodeId: "1-2", format: "png" } },
  { tool: "set_focus", args: { nodeId: "1-2" } },
  { tool: "set_selections", args: { nodeIds: ["1-2"] } },
  { tool: "get_frame_documentation", args: { nodeId: "1:2" } },
  { tool: "lint_frame", args: { nodeId: "1-2" } },
  { tool: "lint_frame", args: { nodeId: "1-2", fix: true, ignoreNodeIds: ["3-4"], ignoreRules: ["overflow"] } },
  { tool: "set_lint_ignore", args: { nodeId: "1-2" } },
  { tool: "set_lint_ignore", args: { nodeId: "1-2", rules: ["overflow", "clipped-content"], clear: true } },
  { tool: "get_annotations", args: { nodeId: "1-2" } },
  { tool: "create_annotation_category", args: { label: "Spec" } },
  { tool: "get_comments", args: {} },
  { tool: "enumerate_all_frames", args: {} },
  { tool: "bulk_export_frames", args: { nodeIds: ["1:2"] } },
  { tool: "get_content_tree", args: { nodeId: "1:2" } },
  {
    tool: "setup_design_system",
    args: { text_styles: [{ name: "Body", font_family: "Inter", font_style: "Regular", font_size: 16 }] },
  },
  // Fills, strokes, styles, node ops
  { tool: "set_fill_color", args: { nodeId: "1-2", r: 1, g: 0, b: 0 } },
  { tool: "set_fill_color", args: { nodeId: "1-2", color: "#ff0000" } },
  { tool: "set_stroke_color", args: { nodeId: "1-2", color: "#ffffff" } },
  { tool: "set_stroke_color", args: { nodeId: "1-2", r: 0, g: 0, b: 1, a: 0.5, weight: 2, dashPattern: [4, 4] } },
  { tool: "set_corner_radius", args: { nodeId: "1-2", radius: 4 } },
  { tool: "set_image_fill", args: { nodeId: "1-2", imageUrl: "https://example.test/a.png" } },
  {
    tool: "set_gradient_fill",
    args: {
      nodeId: "1-2",
      type: "LINEAR",
      stops: [
        { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
        { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
      ],
    },
  },
  { tool: "set_effect_style_id", args: { nodeId: "1-2", styleName: "shadow/md" } },
  { tool: "set_color_style_id", args: { nodeId: "1-2", styleName: "color/primary" } },
  { tool: "move_node", args: { nodeId: "1-2", x: 5, parentId: "3-4" } },
  { tool: "resize_node", args: { nodeId: "1-2", width: 10, height: 20 } },
  { tool: "rename_node", args: { nodeId: "1-2", name: "A" } },
  { tool: "delete_multiple_nodes", args: { nodeIds: ["1-2", "3-4"] } },
  // Layout
  { tool: "set_layout_mode", args: { nodeId: "1-2", mode: "GRID", rows: 2, columns: 3 } },
  { tool: "set_layout_mode", args: { nodeId: "1-2", mode: "HORIZONTAL" } },
  { tool: "set_layout_mode", args: { nodeId: "1-2", mode: "VERTICAL", wrap: "WRAP" } },
  { tool: "set_padding", args: { nodeId: "1-2", top: 8, left: 4 } },
  { tool: "set_layout_sizing", args: { nodeId: "1-2", horizontal: "FILL", vertical: "HUG" } },
  { tool: "set_item_spacing", args: { nodeId: "1-2", gap: 8, rowGap: 4 } },
  { tool: "set_axis_align", args: { nodeId: "1-2", primaryAxisAlignItems: "CENTER" } },
  {
    tool: "set_auto_layout",
    args: { nodeId: "1-2", mode: "GRID", rows: 2, columns: 2, rowGap: 8, top: 4, horizontal: "HUG" },
  },
  {
    tool: "set_auto_layout",
    args: { nodeId: "1-2", mode: "HORIZONTAL", gap: 8, wrap: "WRAP", vertical: "FILL", clipsContent: false },
  },
  // Text
  { tool: "set_text_content", args: { nodeId: "1-2", text: "Hello" } },
  { tool: "set_multiple_text_contents", args: { nodeId: "1-2", text: [{ nodeId: "3-4", text: "a" }] } },
  { tool: "set_font_size", args: { nodeId: "1-2", size: 16 } },
  { tool: "set_letter_spacing", args: { nodeId: "1-2", spacing: 1 } },
  { tool: "set_line_height", args: { nodeId: "1-2", height: 20 } },
  { tool: "set_paragraph_spacing", args: { nodeId: "1-2", spacing: 4 } },
  { tool: "set_text_decoration", args: { nodeId: "1-2", decoration: "UNDERLINE" } },
  { tool: "load_font_async", args: { family: "Inter" } },
  { tool: "apply_text_style", args: { nodeId: "1-2", styleName: "Body" } },
  // Variables
  { tool: "create_variable_collection", args: { name: "Theme" } },
  { tool: "get_collection_info", args: { id: "c1" } },
  { tool: "rename_variable_collection", args: { id: "c1", name: "New" } },
  { tool: "delete_variable_collection", args: { id: "c1" } },
  { tool: "create_variable", args: { collectionId: "c1", name: "brand", type: "COLOR", value: "#ff0000" } },
  {
    tool: "create_variables_batch",
    args: { collectionId: "c1", variables: [{ name: "space/4", type: "FLOAT", value: "4" }] },
  },
  { tool: "rename_variable", args: { id: "v1", name: "b" } },
  { tool: "delete_variable", args: { id: "v1" } },
  { tool: "delete_variables_batch", args: { ids: ["v1", "v2"] } },
  { tool: "audit_collection", args: { collectionId: "c1", chartColors: true } },
  { tool: "suggest_missing_variables", args: { collectionId: "c1" } },
  { tool: "apply_default_theme", args: { collectionId: "c1", overwrite: true } },
  {
    tool: "create_color_scale_set",
    args: { collectionId: "c1", colorName: "brand", base: RGB, foreground: RGB2, background: RGB },
  },
  { tool: "reorder_variables", args: { collectionId: "c1" } },
  { tool: "generate_audit_report", args: { collectionId: "c1" } },
  { tool: "export_collection_schema", args: { collectionId: "c1" } },
  { tool: "import_collection_schema", args: { collectionId: "c1", schema: {} } },
  { tool: "create_all_scales", args: { collectionId: "c1", colors: { brand: RGB }, background: RGB2 } },
  { tool: "fix_collection_to_standard", args: { collectionId: "c1" } },
  { tool: "add_chart_colors", args: { id: "c1" } },
  { tool: "add_mode_to_collection", args: { id: "c1", name: "Dark" } },
  { tool: "rename_mode", args: { id: "c1", oldName: "Light", newName: "Day" } },
  { tool: "delete_mode", args: { id: "c1", name: "Dark" } },
  { tool: "duplicate_mode_values", args: { id: "c1", from: "Light", to: "Dark" } },
];

describe("direct tool ↔ batch_actions param parity", () => {
  let mockSendCommand: jest.Mock;
  const toolHandlers = new Map<string, Function>();
  const toolSchemas = new Map<string, z.ZodObject<any>>();

  beforeAll(() => {
    const server = new McpServer({ name: "parity", version: "1.0.0" }, { capabilities: { tools: {} } });
    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      const handler = args[args.length - 1];
      const schema = args.find((arg, i) => i > 0 && i < args.length - 1 && arg && typeof arg === "object");
      toolHandlers.set(args[0], handler);
      toolSchemas.set(args[0], z.object(schema ?? {}));
      return (originalTool as any)(...args);
    });
    registerDocumentTools(server);
    registerCreationTools(server);
    registerModificationTools(server);
    registerTextTools(server);
    registerComponentTools(server);
    registerVariableTools(server);
    registerIconTools(server);
    registerDocumentationTools(server);
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
  });

  beforeEach(() => {
    mockSendCommand.mockReset();
    mockSendCommand.mockResolvedValue({});
  });

  async function captureDirect(tool: string, args: Record<string, unknown>, command: string) {
    const schema = toolSchemas.get(tool);
    const handler = toolHandlers.get(tool);
    if (!schema || !handler) throw new Error(`Tool ${tool} not registered`);
    await handler(schema.parse(args), { meta: {} });
    const call = mockSendCommand.mock.calls.find(([sent]) => sent === command);
    if (!call) throw new Error(`${tool} did not send ${command}`);
    return call[1];
  }

  it.each(CASES.map((c) => [c.tool, JSON.stringify(c.args), c] as const))(
    "%s %s",
    async (_tool, _args, { tool, args, command }) => {
      const sent = await captureDirect(tool, args, command ?? tool);
      expect(sent).toEqual(normalizeCommandParams(tool, args));
    },
  );

  it("update_icon: batch resolution matches the direct tool", async () => {
    const args = { nodeId: "1-2", name: "bell", size: 24, color: "#111111" };
    const sent = await captureDirect("update_icon", args, "update_icon");
    expect(sent).toEqual(resolveUpdateIconParams(args));
  });
});
