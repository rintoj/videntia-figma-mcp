import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCreationTools } from "../../src/videntia_figma_mcp/tools/creation-tools";
import { registerModificationTools } from "../../src/videntia_figma_mcp/tools/modification-tools";
import { registerDocumentTools } from "../../src/videntia_figma_mcp/tools/document-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  getOpenChannels: jest.fn().mockResolvedValue([]),
}));

describe("text wrapping MCP tools", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockReset();

    toolHandlers = new Map();
    toolSchemas = new Map();
    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, _description, schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });

    registerCreationTools(server);
    registerModificationTools(server);
    registerDocumentTools(server);
  });

  async function callTool(toolName: string, args: any) {
    const schema = toolSchemas.get(toolName);
    const handler = toolHandlers.get(toolName);
    if (!schema || !handler) throw new Error(`Tool ${toolName} not found`);
    return await handler(schema.parse(args), { meta: {} });
  }

  describe("create_text", () => {
    it("forwards width and textAutoResize and reports the resulting sizing", async () => {
      mockSendCommand.mockResolvedValue({ id: "t1", name: "Body", width: 320, textAutoResize: "HEIGHT" });

      const response = await callTool("create_text", { x: 0, y: 0, text: "Long paragraph", width: "320" });

      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("create_text");
      expect(params.width).toBe(320);
      expect(params.textAutoResize).toBeUndefined();
      expect(response.content[0].text).toContain("textAutoResize: HEIGHT");
      expect(response.content[0].text).toContain("width: 320");
    });

    it("accepts an explicit textAutoResize", async () => {
      mockSendCommand.mockResolvedValue({ id: "t2", name: "Box", textAutoResize: "NONE" });
      await callTool("create_text", { x: 0, y: 0, text: "Fixed", width: 100, textAutoResize: "NONE" });
      expect(mockSendCommand.mock.calls[0][1].textAutoResize).toBe("NONE");
    });

    it("rejects invalid textAutoResize and non-positive width", () => {
      const schema = toolSchemas.get("create_text")!;
      expect(() => schema.parse({ x: 0, y: 0, text: "x", textAutoResize: "TRUNCATE" })).toThrow();
      expect(() => schema.parse({ x: 0, y: 0, text: "x", width: 0 })).toThrow();
    });
  });

  describe("resize_node", () => {
    it("reports textAutoResize and actual size for text nodes", async () => {
      mockSendCommand.mockResolvedValue({ id: "t1", name: "Body", width: 200, height: 57, textAutoResize: "HEIGHT" });
      const response = await callTool("resize_node", { nodeId: "t1", width: 200, height: 20 });
      expect(response.content[0].text).toContain("textAutoResize: HEIGHT");
      expect(response.content[0].text).toContain("height 57");
    });

    it("keeps the plain message for non-text nodes", async () => {
      mockSendCommand.mockResolvedValue({ id: "f1", name: "Card", width: 200, height: 100 });
      const response = await callTool("resize_node", { nodeId: "f1", width: 200, height: 100 });
      expect(response.content[0].text).toBe('Resized node "Card" to width 200 and height 100');
    });
  });

  describe("set_layout_sizing", () => {
    it("includes resulting sizing and textAutoResize in the response", async () => {
      mockSendCommand.mockResolvedValue({
        nodeId: "t1",
        name: "Body",
        layoutSizingHorizontal: "FILL",
        layoutSizingVertical: "HUG",
        textAutoResize: "HEIGHT",
        success: true,
      });

      const response = await callTool("set_layout_sizing", { nodeId: "t1", horizontal: "FILL" });

      const text = response.content[0].text;
      expect(text).toContain("horizontal: FILL");
      expect(text).toContain("layoutSizingVertical: HUG");
      expect(text).toContain("textAutoResize: HEIGHT");
    });

    it("surfaces the plugin's FILL-outside-auto-layout error", async () => {
      mockSendCommand.mockRejectedValue(new Error('Cannot set horizontal sizing to FILL on "Body"'));
      const response = await callTool("set_layout_sizing", { nodeId: "t1", horizontal: "FILL" });
      expect(response.content[0].text).toContain("Error setting layout sizing");
      expect(response.content[0].text).toContain("FILL");
    });
  });

  describe("get_node_info", () => {
    const textNode = {
      id: "t1",
      name: "Body",
      type: "TEXT",
      visible: true,
      characters: "Hello world",
      fontSize: 14,
      textAutoResize: "HEIGHT",
      textTruncation: "ENDING",
      maxLines: 2,
    };

    it("includes textAutoResize in JSON output", async () => {
      mockSendCommand.mockResolvedValue({ count: 1, nodes: [textNode] });
      const response = await callTool("get_node_info", { nodeId: "t1", output_format: "json" });
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed[0].textAutoResize).toBe("HEIGHT");
      expect(parsed[0].maxLines).toBe(2);
    });

    it("keeps textAutoResize when filtering to the characters field", async () => {
      mockSendCommand.mockResolvedValue({ count: 1, nodes: [{ ...textNode, fills: [] }] });
      const response = await callTool("get_node_info", {
        nodeId: "t1",
        output_format: "json",
        fields: ["characters"],
      });
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed[0].textAutoResize).toBe("HEIGHT");
      expect(parsed[0].textTruncation).toBe("ENDING");
      expect(parsed[0].fills).toBeUndefined();
    });

    it("emits textAutoResize in JSX output", async () => {
      mockSendCommand.mockResolvedValue({ count: 1, nodes: [textNode] });
      const response = await callTool("get_node_info", { nodeId: "t1" });
      expect(response.content[0].text).toContain('textAutoResize="HEIGHT"');
      expect(response.content[0].text).toContain('maxLines="2"');
    });
  });
});
