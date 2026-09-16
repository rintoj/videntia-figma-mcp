import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCreationTools } from "../../src/videntia_figma_mcp/tools/creation-tools";
import { registerModificationTools } from "../../src/videntia_figma_mcp/tools/modification-tools";
import { registerDocumentTools } from "../../src/videntia_figma_mcp/tools/document-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("missing primitives (§5)", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });

    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();

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
    if (!schema || !handler) {
      throw new Error(`Tool ${toolName} not found`);
    }
    return await handler(schema.parse(args), { meta: {} });
  }

  describe("set_page_background", () => {
    it("is registered", () => {
      expect(toolHandlers.has("set_page_background")).toBe(true);
    });

    it("forwards a hex color and defaults to the current page", async () => {
      mockSendCommand.mockResolvedValue({ id: "0:1", name: "Page 1" });
      const res = await callTool("set_page_background", { color: "#1e1e1e" });
      expect(mockSendCommand).toHaveBeenCalledWith("set_page_background", { color: "#1e1e1e" });
      expect(res.content[0].text).toContain("Page 1");
    });

    it("forwards rgba channels with a default alpha", async () => {
      mockSendCommand.mockResolvedValue({ id: "0:1", name: "Page 1" });
      await callTool("set_page_background", { pageId: "0:1", r: 1, g: 0, b: 0 });
      expect(mockSendCommand).toHaveBeenCalledWith("set_page_background", {
        pageId: "0:1",
        r: 1,
        g: 0,
        b: 0,
        a: 1,
      });
    });

    it("reports errors from the plugin", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node 1:2 is not a page"));
      const res = await callTool("set_page_background", { pageId: "1:2", color: "#fff" });
      expect(res.content[0].text).toContain("Error setting page background");
    });
  });

  describe("set_clips_content", () => {
    it("forwards nodeId and boolean", async () => {
      mockSendCommand.mockResolvedValue({ name: "Card", clipsContent: true });
      const res = await callTool("set_clips_content", { nodeId: "1:2", clipsContent: true });
      expect(mockSendCommand).toHaveBeenCalledWith("set_clips_content", { nodeId: "1:2", clipsContent: true });
      expect(res.content[0].text).toContain("true");
    });

    it("coerces a string boolean", async () => {
      mockSendCommand.mockResolvedValue({ name: "Card", clipsContent: false });
      await callTool("set_clips_content", { nodeId: "1:2", clipsContent: "false" });
      expect(mockSendCommand.mock.calls[0][1].clipsContent).toBe(false);
    });
  });

  describe("set_opacity", () => {
    it("forwards opacity", async () => {
      mockSendCommand.mockResolvedValue({ name: "Overlay", opacity: 0.5, blendMode: "NORMAL" });
      const res = await callTool("set_opacity", { nodeId: "1:2", opacity: 0.5 });
      expect(mockSendCommand).toHaveBeenCalledWith("set_opacity", {
        nodeId: "1:2",
        opacity: 0.5,
        blendMode: undefined,
      });
      expect(res.content[0].text).toContain("0.5");
    });

    it("accepts a blend mode", async () => {
      mockSendCommand.mockResolvedValue({ name: "Overlay", opacity: 1, blendMode: "MULTIPLY" });
      await callTool("set_opacity", { nodeId: "1:2", blendMode: "MULTIPLY" });
      expect(mockSendCommand.mock.calls[0][1].blendMode).toBe("MULTIPLY");
    });

    it("rejects opacity outside 0–1", async () => {
      await expect(callTool("set_opacity", { nodeId: "1:2", opacity: 2 })).rejects.toThrow();
    });
  });

  describe("create_section", () => {
    it("forwards name, geometry and parent", async () => {
      mockSendCommand.mockResolvedValue({ id: "5:1", name: "Foundations", width: 800, height: 600 });
      const res = await callTool("create_section", {
        name: "Foundations",
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        color: "#f5f5f5",
        parentId: "0:1",
      });
      expect(mockSendCommand).toHaveBeenCalledWith("create_section", {
        name: "Foundations",
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        color: "#f5f5f5",
        parentId: "0:1",
      });
      expect(res.content[0].text).toContain("Foundations");
      expect(res.content[0].text).toContain("5:1");
    });
  });

  describe("set_section_status", () => {
    it("sets READY_FOR_DEV", async () => {
      mockSendCommand.mockResolvedValue({ name: "Foundations", devStatus: { type: "READY_FOR_DEV" } });
      const res = await callTool("set_section_status", { nodeId: "5:1", status: "READY_FOR_DEV" });
      expect(res.content[0].text).toContain("READY_FOR_DEV");
    });

    it("clears with NONE", async () => {
      mockSendCommand.mockResolvedValue({ name: "Foundations", devStatus: null });
      const res = await callTool("set_section_status", { nodeId: "5:1", status: "NONE" });
      expect(res.content[0].text).toContain("NONE");
    });

    it("rejects an unknown status", async () => {
      await expect(callTool("set_section_status", { nodeId: "5:1", status: "SHIPPED" })).rejects.toThrow();
    });
  });
});
