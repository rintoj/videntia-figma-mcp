import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerModificationTools } from "../../src/videntia_figma_mcp/tools/modification-tools";
import { registerCreationTools } from "../../src/videntia_figma_mcp/tools/creation-tools";

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
