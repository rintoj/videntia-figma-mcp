import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCreationTools } from "../../src/claude_figma_mcp/tools/creation-tools";
import { registerModificationTools } from "../../src/claude_figma_mcp/tools/modification-tools";

jest.mock("../../src/claude_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("MCP capability gap fixes", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer(
      { name: "test-server", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );

    mockSendCommand =
      require("../../src/claude_figma_mcp/utils/websocket").sendCommandToFigma;
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

  describe("Fix 1: set_layout_sizing on TEXT nodes", () => {
    it("accepts layoutSizingHorizontal FILL on a text node", async () => {
      mockSendCommand.mockResolvedValue({
        nodeId: "text-001",
        nodeName: "Label",
        layoutSizingHorizontal: "FILL",
        layoutSizingVertical: "HUG",
        success: true,
      });

      const response = await callTool("set_layout_sizing", {
        nodeId: "text-001",
        layoutSizingHorizontal: "FILL",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_sizing", {
        nodeId: "text-001",
        layoutSizingHorizontal: "FILL",
        layoutSizingVertical: undefined,
      });
      expect(response.content[0].text).toContain("horizontal: FILL");
    });

    it("accepts layoutSizingVertical FIXED on a text node", async () => {
      mockSendCommand.mockResolvedValue({
        nodeId: "text-002",
        nodeName: "Paragraph",
        layoutSizingHorizontal: "FILL",
        layoutSizingVertical: "FIXED",
        success: true,
      });

      const response = await callTool("set_layout_sizing", {
        nodeId: "text-002",
        layoutSizingHorizontal: "FILL",
        layoutSizingVertical: "FIXED",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_sizing", {
        nodeId: "text-002",
        layoutSizingHorizontal: "FILL",
        layoutSizingVertical: "FIXED",
      });
      expect(response.content[0].text).toContain("horizontal: FILL");
      expect(response.content[0].text).toContain("vertical: FIXED");
    });
  });

  describe("Fix 2: clipsContent support", () => {
    it("passes clipsContent to create_frame", async () => {
      mockSendCommand.mockResolvedValue({
        id: "frame-001",
        name: "Carousel",
        clipsContent: true,
      });

      const response = await callTool("create_frame", {
        x: 0,
        y: 0,
        width: 390,
        height: 200,
        name: "Carousel",
        clipsContent: true,
      });

      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("create_frame");
      expect(params.clipsContent).toBe(true);
      expect(response.content[0].text).toContain("Carousel");
    });

    it("omits clipsContent from create_frame when not provided", async () => {
      mockSendCommand.mockResolvedValue({
        id: "frame-002",
        name: "Frame",
      });

      await callTool("create_frame", {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      });

      const [, params] = mockSendCommand.mock.calls[0];
      expect(params.clipsContent).toBeUndefined();
    });

    it("passes clipsContent to set_auto_layout", async () => {
      mockSendCommand.mockResolvedValue({
        name: "Carousel",
        layoutMode: "HORIZONTAL",
        clipsContent: true,
      });

      const response = await callTool("set_auto_layout", {
        nodeId: "frame-001",
        layoutMode: "HORIZONTAL",
        clipsContent: true,
      });

      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("set_auto_layout");
      expect(params.clipsContent).toBe(true);
      expect(response.content[0].text).toContain("HORIZONTAL");
    });

    it("omits clipsContent from set_auto_layout when not provided", async () => {
      mockSendCommand.mockResolvedValue({
        name: "Frame",
        layoutMode: "VERTICAL",
      });

      await callTool("set_auto_layout", {
        nodeId: "frame-002",
        layoutMode: "VERTICAL",
      });

      const [, params] = mockSendCommand.mock.calls[0];
      expect(params.clipsContent).toBeUndefined();
    });
  });

  describe("Fix 3: layoutPositioning support", () => {
    it("passes layoutPositioning ABSOLUTE to create_frame", async () => {
      mockSendCommand.mockResolvedValue({
        id: "child-frame-001",
        name: "Overlay",
      });

      await callTool("create_frame", {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        name: "Overlay",
        parentId: "parent-001",
        layoutPositioning: "ABSOLUTE",
      });

      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("create_frame");
      expect(params.layoutPositioning).toBe("ABSOLUTE");
    });

    it("passes layoutPositioning ABSOLUTE to create_rectangle", async () => {
      mockSendCommand.mockResolvedValue({
        id: "rect-001",
        name: "Background",
      });

      await callTool("create_rectangle", {
        x: 0,
        y: 0,
        width: 200,
        height: 200,
        name: "Background",
        parentId: "parent-001",
        layoutPositioning: "ABSOLUTE",
      });

      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("create_rectangle");
      expect(params.layoutPositioning).toBe("ABSOLUTE");
    });

    it("passes layoutPositioning ABSOLUTE to create_ellipse", async () => {
      mockSendCommand.mockResolvedValue({
        id: "ellipse-001",
        name: "Blob",
      });

      await callTool("create_ellipse", {
        x: 50,
        y: 50,
        width: 300,
        height: 300,
        name: "Blob",
        parentId: "parent-001",
        layoutPositioning: "ABSOLUTE",
      });

      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("create_ellipse");
      expect(params.layoutPositioning).toBe("ABSOLUTE");
    });

    it("defaults layoutPositioning to undefined when not provided", async () => {
      mockSendCommand.mockResolvedValue({ id: "rect-002", name: "Rect" });

      await callTool("create_rectangle", {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      });

      const [, params] = mockSendCommand.mock.calls[0];
      expect(params.layoutPositioning).toBeUndefined();
    });

    it("rejects invalid layoutPositioning values", async () => {
      await expect(
        callTool("create_frame", {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          layoutPositioning: "INVALID",
        }),
      ).rejects.toThrow();
    });
  });

  describe("Fix: set_corner_radius coerces string to number", () => {
    it("accepts a string radius and coerces to number", async () => {
      mockSendCommand.mockResolvedValue({ name: "RoundedRect" });

      const response = await callTool("set_corner_radius", {
        nodeId: "rect-001",
        radius: "16" as any,
      });

      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("set_corner_radius");
      expect(params.radius).toBe(16);
      expect(response.content[0].text).toContain("16");
    });

    it("still accepts numeric radius", async () => {
      mockSendCommand.mockResolvedValue({ name: "RoundedRect" });

      await callTool("set_corner_radius", {
        nodeId: "rect-001",
        radius: 8,
      });

      const [, params] = mockSendCommand.mock.calls[0];
      expect(params.radius).toBe(8);
    });

    it("rejects non-numeric string", async () => {
      await expect(
        callTool("set_corner_radius", {
          nodeId: "rect-001",
          radius: "abc" as any,
        }),
      ).rejects.toThrow();
    });
  });
});
