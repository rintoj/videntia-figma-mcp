import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCreationTools } from "../../src/videntia_figma_mcp/tools/creation-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("create_svg tool", () => {
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
        const [name, description, schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });

    registerCreationTools(server);
  });

  async function callTool(toolName: string, args: any) {
    const schema = toolSchemas.get(toolName);
    const handler = toolHandlers.get(toolName);
    if (!schema || !handler) {
      throw new Error(`Tool ${toolName} not found`);
    }
    const validatedArgs = schema.parse(args);
    return await handler(validatedArgs, { meta: {} });
  }

  const sampleSvg = '<svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>';

  describe("successful creation", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        id: "svg-node-123",
        name: "Icon",
        type: "FRAME",
        x: 10,
        y: 20,
        width: 24,
        height: 24,
        childCount: 1,
        parentId: undefined,
      });
    });

    it("creates SVG with minimal parameters", async () => {
      const response = await callTool("create_svg", {
        svgString: sampleSvg,
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("create_svg", {
        svgString: sampleSvg,
        x: 0,
        y: 0,
        name: undefined,
        parentId: undefined,
        flatten: false,
      });
      expect(response.content[0].text).toContain("Created SVG node");
      expect(response.content[0].text).toContain("svg-node-123");
    });

    it("creates SVG with position", async () => {
      const response = await callTool("create_svg", {
        svgString: sampleSvg,
        x: 100,
        y: 200,
      });

      expect(mockSendCommand).toHaveBeenCalledWith("create_svg", {
        svgString: sampleSvg,
        x: 100,
        y: 200,
        name: undefined,
        parentId: undefined,
        flatten: false,
      });
    });

    it("creates SVG with custom name", async () => {
      const response = await callTool("create_svg", {
        svgString: sampleSvg,
        name: "My Icon",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("create_svg", {
        svgString: sampleSvg,
        x: 0,
        y: 0,
        name: "My Icon",
        parentId: undefined,
        flatten: false,
      });
    });

    it("creates SVG inside a parent frame", async () => {
      mockSendCommand.mockResolvedValue({
        id: "svg-node-456",
        name: "Icon",
        type: "FRAME",
        x: 10,
        y: 20,
        width: 24,
        height: 24,
        childCount: 1,
        parentId: "frame-123",
      });

      const response = await callTool("create_svg", {
        svgString: sampleSvg,
        parentId: "frame-123",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("create_svg", {
        svgString: sampleSvg,
        x: 0,
        y: 0,
        name: undefined,
        parentId: "frame-123",
        flatten: false,
      });
      expect(response.content[0].text).toContain("inside parent frame-123");
    });

    it("creates flattened SVG", async () => {
      mockSendCommand.mockResolvedValue({
        id: "svg-node-789",
        name: "Flattened Icon",
        type: "VECTOR",
        x: 0,
        y: 0,
        width: 24,
        height: 24,
        childCount: 0,
        parentId: undefined,
      });

      const response = await callTool("create_svg", {
        svgString: sampleSvg,
        flatten: true,
      });

      expect(mockSendCommand).toHaveBeenCalledWith("create_svg", {
        svgString: sampleSvg,
        x: 0,
        y: 0,
        name: undefined,
        parentId: undefined,
        flatten: true,
      });
      expect(response.content[0].text).toContain("0 children");
    });

    it("creates SVG with all parameters", async () => {
      const response = await callTool("create_svg", {
        svgString: sampleSvg,
        x: 50,
        y: 75,
        name: "Complete Icon",
        parentId: "frame-abc",
        flatten: true,
      });

      expect(mockSendCommand).toHaveBeenCalledWith("create_svg", {
        svgString: sampleSvg,
        x: 50,
        y: 75,
        name: "Complete Icon",
        parentId: "frame-abc",
        flatten: true,
      });
    });
  });

  describe("validation", () => {
    it("requires svgString parameter", async () => {
      await expect(callTool("create_svg", {})).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects non-string svgString", async () => {
      await expect(
        callTool("create_svg", {
          svgString: 123,
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("accepts SVG with XML declaration", async () => {
      const xmlSvg = '<?xml version="1.0"?><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>';
      mockSendCommand.mockResolvedValue({
        id: "svg-xml",
        name: "SVG",
        type: "FRAME",
        x: 0,
        y: 0,
        width: 24,
        height: 24,
        childCount: 1,
      });

      const response = await callTool("create_svg", {
        svgString: xmlSvg,
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling", () => {
    it("handles parse errors", async () => {
      mockSendCommand.mockRejectedValue(new Error("Failed to parse SVG: Invalid markup"));

      const response = await callTool("create_svg", {
        svgString: sampleSvg,
      });

      expect(response.content[0].text).toContain("Error creating SVG");
      expect(response.content[0].text).toContain("Invalid markup");
    });

    it("handles parent not found errors", async () => {
      mockSendCommand.mockRejectedValue(new Error("Parent node not found with ID: invalid-parent"));

      const response = await callTool("create_svg", {
        svgString: sampleSvg,
        parentId: "invalid-parent",
      });

      expect(response.content[0].text).toContain("Error creating SVG");
      expect(response.content[0].text).toContain("Parent node not found");
    });

    it("handles invalid SVG errors", async () => {
      mockSendCommand.mockRejectedValue(new Error("Invalid SVG: must start with <svg"));

      const response = await callTool("create_svg", {
        svgString: "<div>not an svg</div>",
      });

      expect(response.content[0].text).toContain("Error creating SVG");
    });
  });
});
