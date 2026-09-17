import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerModificationTools } from "../../src/videntia_figma_mcp/tools/modification-tools";
import { registerCreationTools } from "../../src/videntia_figma_mcp/tools/creation-tools";
import {
  STRICT_PARAM_TOOLS,
  clearToolRegistry,
  getRegisteredTool,
  instrumentToolRegistry,
} from "../../src/videntia_figma_mcp/utils/tool-registry";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

/**
 * These tests assert on the ACTUAL payload put on the wire to the plugin.
 *
 * The bug they guard against: the MCP zod schema declared only the short param
 * name (`horizontal`), so a caller passing the Figma property name
 * (`layoutSizingHorizontal`) had it silently stripped by zod — the plugin
 * received `{nodeId}` alone, wrote nothing, and the tool reported success.
 * Testing the two sides in isolation never catches that.
 */
describe("MCP → plugin wire params (alias + no-op guards)", () => {
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();
    mockSendCommand.mockResolvedValue({ name: "Frame", id: "1:1" });

    toolHandlers = new Map();
    toolSchemas = new Map();
    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, , schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });
    registerModificationTools(server);
    registerCreationTools(server);
  });

  async function callTool(toolName: string, args: any) {
    const schema = toolSchemas.get(toolName)!;
    const handler = toolHandlers.get(toolName)!;
    return await handler(schema.parse(args), { meta: {} });
  }

  const wire = () => mockSendCommand.mock.calls[0][1];

  describe("set_layout_sizing", () => {
    it("forwards the layoutSizing* spelling instead of dropping it", async () => {
      mockSendCommand.mockResolvedValue({
        name: "SMOKE",
        layoutSizingHorizontal: "HUG",
        layoutSizingVertical: "FIXED",
      });
      await callTool("set_layout_sizing", { nodeId: "7:10269", layoutSizingHorizontal: "HUG" });
      expect(wire().layoutSizingHorizontal).toBe("HUG");
    });

    it("forwards the short spelling too", async () => {
      mockSendCommand.mockResolvedValue({ name: "SMOKE", layoutSizingHorizontal: "FILL" });
      await callTool("set_layout_sizing", { nodeId: "7:10269", horizontal: "FILL" });
      expect(wire().layoutSizingHorizontal).toBe("FILL");
    });

    it("refuses a call that would set nothing rather than reporting success", async () => {
      const response = await callTool("set_layout_sizing", { nodeId: "7:10269" });
      expect(mockSendCommand).not.toHaveBeenCalled();
      expect(response.content[0].text).toContain("Nothing to set");
    });

    it("echoes the sizing values read back from the node", async () => {
      mockSendCommand.mockResolvedValue({
        name: "SMOKE",
        layoutSizingHorizontal: "FIXED",
        layoutSizingVertical: "FIXED",
      });
      const response = await callTool("set_layout_sizing", { nodeId: "7:10269", horizontal: "HUG" });
      // Read-back wins over the request, so a discarded write is visible.
      expect(response.content[0].text).toContain("horizontal: FIXED");
      expect(response.content[0].text).toContain("vertical: FIXED");
    });
  });

  describe("set_padding", () => {
    it("accepts the padding* spelling", async () => {
      await callTool("set_padding", { nodeId: "1:1", paddingTop: 12, paddingLeft: 4 });
      expect(wire()).toMatchObject({ paddingTop: 12, paddingLeft: 4 });
    });

    it("expands the `padding` shorthand to all four sides", async () => {
      await callTool("set_padding", { nodeId: "1:1", padding: 8 });
      expect(wire()).toMatchObject({ paddingTop: 8, paddingRight: 8, paddingBottom: 8, paddingLeft: 8 });
    });

    it("accepts the array/object shorthand forms too", async () => {
      await callTool("set_padding", { nodeId: "1:1", padding: [4, 8] });
      expect(wire()).toMatchObject({ paddingTop: 4, paddingRight: 8, paddingBottom: 4, paddingLeft: 8 });
    });

    it("lets an explicit side win over the shorthand", async () => {
      await callTool("set_padding", { nodeId: "1:1", padding: 8, left: 0 });
      expect(wire()).toMatchObject({ paddingTop: 8, paddingRight: 8, paddingBottom: 8, paddingLeft: 0 });
    });

    it("refuses an empty call", async () => {
      const response = await callTool("set_padding", { nodeId: "1:1" });
      expect(mockSendCommand).not.toHaveBeenCalled();
      expect(response.content[0].text).toContain("Nothing to set");
    });
  });

  describe("set_item_spacing", () => {
    it("accepts itemSpacing as an alias for gap", async () => {
      await callTool("set_item_spacing", { nodeId: "1:1", itemSpacing: 16 });
      expect(wire()).toMatchObject({ itemSpacing: 16 });
    });

    it("refuses an empty call", async () => {
      const response = await callTool("set_item_spacing", { nodeId: "1:1" });
      expect(mockSendCommand).not.toHaveBeenCalled();
      expect(response.content[0].text).toContain("Nothing to set");
    });
  });

  describe("set_layout_mode / set_auto_layout", () => {
    it("set_layout_mode accepts layoutMode as an alias for mode", async () => {
      await callTool("set_layout_mode", { nodeId: "1:1", layoutMode: "VERTICAL" });
      expect(wire()).toMatchObject({ layoutMode: "VERTICAL" });
    });

    it("set_auto_layout accepts layoutMode/itemSpacing/padding*/layoutSizing* aliases", async () => {
      await callTool("set_auto_layout", {
        nodeId: "1:1",
        layoutMode: "HORIZONTAL",
        itemSpacing: 8,
        paddingTop: 4,
        layoutSizingHorizontal: "FILL",
      });
      expect(wire()).toMatchObject({
        layoutMode: "HORIZONTAL",
        itemSpacing: 8,
        paddingTop: 4,
        layoutSizingHorizontal: "FILL",
      });
    });

    it("set_auto_layout expands the `padding` shorthand to all four sides", async () => {
      // The bug: `padding` was not declared in the zod shape, so zod's strip mode
      // dropped it before the handler ran — accepted, reported as success, ignored.
      await callTool("set_auto_layout", { nodeId: "1:1", mode: "VERTICAL", padding: 20 });
      expect(wire()).toMatchObject({ paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20 });
    });

    it("set_auto_layout accepts the array and object padding forms", async () => {
      await callTool("set_auto_layout", { nodeId: "1:1", mode: "VERTICAL", padding: [4, 8] });
      expect(wire()).toMatchObject({ paddingTop: 4, paddingRight: 8, paddingBottom: 4, paddingLeft: 8 });
      mockSendCommand.mockClear();
      await callTool("set_auto_layout", { nodeId: "1:1", mode: "VERTICAL", padding: [1, 2, 3, 4] });
      expect(wire()).toMatchObject({ paddingTop: 1, paddingRight: 2, paddingBottom: 3, paddingLeft: 4 });
      mockSendCommand.mockClear();
      await callTool("set_auto_layout", { nodeId: "1:1", mode: "VERTICAL", padding: { vertical: 6, horizontal: 12 } });
      expect(wire()).toMatchObject({ paddingTop: 6, paddingRight: 12, paddingBottom: 6, paddingLeft: 12 });
    });

    it("set_auto_layout lets explicit per-side params override the shorthand", async () => {
      await callTool("set_auto_layout", { nodeId: "1:1", mode: "VERTICAL", padding: 20, top: 4, paddingRight: 6 });
      expect(wire()).toMatchObject({ paddingTop: 4, paddingRight: 6, paddingBottom: 20, paddingLeft: 20 });
    });

    it("set_auto_layout reports a missing mode instead of sending a modeless write", async () => {
      const response = await callTool("set_auto_layout", { nodeId: "1:1", gap: 8 });
      expect(mockSendCommand).not.toHaveBeenCalled();
      expect(response.content[0].text).toContain("missing `mode`");
    });
  });

  describe("create_frame", () => {
    it("accepts the Figma property spellings for layout args", async () => {
      await callTool("create_frame", {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        layoutMode: "VERTICAL",
        itemSpacing: 12,
        paddingTop: 6,
        layoutSizingVertical: "HUG",
      });
      expect(wire()).toMatchObject({
        layoutMode: "VERTICAL",
        itemSpacing: 12,
        paddingTop: 6,
        layoutSizingVertical: "HUG",
      });
    });
  });

  describe("set_axis_align / resize_node already use canonical names", () => {
    it("set_axis_align sends the Figma property names verbatim", async () => {
      await callTool("set_axis_align", { nodeId: "1:1", primaryAxisAlignItems: "CENTER" });
      expect(wire()).toMatchObject({ primaryAxisAlignItems: "CENTER" });
    });

    it("resize_node sends width/height", async () => {
      await callTool("resize_node", { nodeId: "1:1", width: 10, height: 20 });
      expect(wire()).toMatchObject({ width: 10, height: 20 });
    });
  });
});

/**
 * `set_auto_layout` is in STRICT_PARAM_TOOLS: an undeclared parameter must be a loud
 * error, not the silent strip that hid `padding: 20` for as long as it did.
 */
describe("set_auto_layout strict param schema", () => {
  beforeEach(() => {
    clearToolRegistry();
  });
  afterEach(() => {
    clearToolRegistry();
  });

  function schemaFor(name: string) {
    const server = new McpServer({ name: "strict-test", version: "1.0.0" }, { capabilities: { tools: {} } });
    instrumentToolRegistry(server);
    registerModificationTools(server);
    return getRegisteredTool(name)!.schema;
  }

  it("is registered strict", () => {
    expect(STRICT_PARAM_TOOLS.has("set_auto_layout")).toBe(true);
  });

  it("accepts padding and the declared aliases but rejects a misspelling", () => {
    const schema = schemaFor("set_auto_layout");
    expect(schema.safeParse({ nodeId: "1:1", mode: "VERTICAL", padding: 20 }).success).toBe(true);
    expect(schema.safeParse({ nodeId: "1:1", mode: "VERTICAL", padding: [4, 8] }).success).toBe(true);
    expect(schema.safeParse({ nodeId: "1:1", layoutMode: "VERTICAL", allowSideEffects: true }).success).toBe(true);
    expect(schema.safeParse({ nodeId: "1:1", mode: "VERTICAL", paddign: 20 }).success).toBe(false);
  });
});
