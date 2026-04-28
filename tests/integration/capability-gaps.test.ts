import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCreationTools } from "../../src/videntia_figma_mcp/tools/creation-tools";
import { registerModificationTools } from "../../src/videntia_figma_mcp/tools/modification-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("MCP capability gap fixes", () => {
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
        horizontal: "FILL",
        vertical: "HUG",
        success: true,
      });

      const response = await callTool("set_layout_sizing", {
        nodeId: "text-001",
        horizontal: "FILL",
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
        horizontal: "FILL",
        vertical: "FIXED",
        success: true,
      });

      const response = await callTool("set_layout_sizing", {
        nodeId: "text-002",
        horizontal: "FILL",
        vertical: "FIXED",
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
        mode: "HORIZONTAL",
        clipsContent: true,
      });

      const response = await callTool("set_auto_layout", {
        nodeId: "frame-001",
        mode: "HORIZONTAL",
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
        mode: "VERTICAL",
      });

      await callTool("set_auto_layout", {
        nodeId: "frame-002",
        mode: "VERTICAL",
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

    it.skip("passes layoutPositioning ABSOLUTE to create_ellipse", async () => {
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

    it("accepts corners array as JSON string via coercion", async () => {
      mockSendCommand.mockResolvedValue({ name: "TopRounded" });

      const response = await callTool("set_corner_radius", {
        nodeId: "rect-001",
        radius: 12,
        corners: "[true, true, false, false]" as any,
      });

      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("set_corner_radius");
      expect(params.corners).toEqual([true, true, false, false]);
      expect(response.content[0].text).toContain("12");
    });

    it("accepts corners as native boolean array", async () => {
      mockSendCommand.mockResolvedValue({ name: "BottomRounded" });

      await callTool("set_corner_radius", {
        nodeId: "rect-001",
        radius: 8,
        corners: [false, false, true, true],
      });

      const [, params] = mockSendCommand.mock.calls[0];
      expect(params.corners).toEqual([false, false, true, true]);
    });
  });

  describe("Fix: layoutPositioning re-applies x/y coordinates", () => {
    it("passes x, y, and layoutPositioning together to create_frame", async () => {
      mockSendCommand.mockResolvedValue({
        id: "abs-frame-001",
        name: "AbsoluteChild",
      });

      await callTool("create_frame", {
        x: 50,
        y: 75,
        width: 100,
        height: 100,
        name: "AbsoluteChild",
        parentId: "parent-001",
        layoutPositioning: "ABSOLUTE",
      });

      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("create_frame");
      expect(params.x).toBe(50);
      expect(params.y).toBe(75);
      expect(params.layoutPositioning).toBe("ABSOLUTE");
    });

    it.skip("passes x, y, and layoutPositioning together to create_ellipse", async () => {
      mockSendCommand.mockResolvedValue({
        id: "abs-ellipse-001",
        name: "Blob",
      });

      await callTool("create_ellipse", {
        x: 100,
        y: 200,
        width: 300,
        height: 300,
        name: "Blob",
        parentId: "parent-001",
        layoutPositioning: "ABSOLUTE",
      });

      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("create_ellipse");
      expect(params.x).toBe(100);
      expect(params.y).toBe(200);
      expect(params.layoutPositioning).toBe("ABSOLUTE");
    });
  });

  describe("Fix: numeric coercion across creation tools", () => {
    it("coerces string x/y/width/height in create_rectangle", async () => {
      mockSendCommand.mockResolvedValue({ id: "rect-c1", name: "Rect" });

      await callTool("create_rectangle", {
        x: "10" as any,
        y: "20" as any,
        width: "200" as any,
        height: "100" as any,
      });

      const [, params] = mockSendCommand.mock.calls[0];
      expect(params.x).toBe(10);
      expect(params.y).toBe(20);
      expect(params.width).toBe(200);
      expect(params.height).toBe(100);
    });

    it("coerces string fontSize and fontWeight in create_text", async () => {
      mockSendCommand.mockResolvedValue({ id: "text-c1", name: "Label" });

      await callTool("create_text", {
        x: 0,
        y: 0,
        text: "Hello",
        fontSize: "18" as any,
        fontWeight: "700" as any,
      });

      const [, params] = mockSendCommand.mock.calls[0];
      expect(params.fontSize).toBe(18);
      expect(params.fontWeight).toBe(700);
    });

    it("passes fontFamily to create_text", async () => {
      mockSendCommand.mockResolvedValue({ id: "text-f1", name: "Roboto Text" });

      await callTool("create_text", {
        x: 0,
        y: 0,
        text: "Custom Font",
        fontFamily: "Roboto",
        fontWeight: 700,
      });

      const [, params] = mockSendCommand.mock.calls[0];
      expect(params.fontFamily).toBe("Roboto");
      expect(params.fontWeight).toBe(700);
    });

    it("defaults fontFamily to Inter when not provided", async () => {
      mockSendCommand.mockResolvedValue({ id: "text-f2", name: "Default Text" });

      await callTool("create_text", {
        x: 0,
        y: 0,
        text: "Default Font",
      });

      const [, params] = mockSendCommand.mock.calls[0];
      expect(params.fontFamily).toBe("Inter");
    });
  });

  describe("Fix: numeric coercion across modification tools", () => {
    it("coerces string x/y in move_node", async () => {
      mockSendCommand.mockResolvedValue({ name: "MovedNode" });

      await callTool("move_node", {
        nodeId: "node-001",
        x: "50" as any,
        y: "75" as any,
      });

      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("move_node");
      expect(params.x).toBe(50);
      expect(params.y).toBe(75);
    });

    it("coerces string width/height in resize_node", async () => {
      mockSendCommand.mockResolvedValue({ name: "ResizedNode" });

      await callTool("resize_node", {
        nodeId: "node-001",
        width: "300" as any,
        height: "150" as any,
      });

      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("resize_node");
      expect(params.width).toBe(300);
      expect(params.height).toBe(150);
    });

    it("coerces string padding values in set_padding", async () => {
      mockSendCommand.mockResolvedValue({ name: "PaddedFrame" });

      await callTool("set_padding", {
        nodeId: "frame-001",
        top: "16" as any,
        right: "12" as any,
        bottom: "16" as any,
        left: "12" as any,
      });

      const [, params] = mockSendCommand.mock.calls[0];
      expect(params.paddingTop).toBe(16);
      expect(params.paddingRight).toBe(12);
      expect(params.paddingBottom).toBe(16);
      expect(params.paddingLeft).toBe(12);
    });

    it("coerces string itemSpacing in set_item_spacing", async () => {
      mockSendCommand.mockResolvedValue({ name: "SpacedFrame", itemSpacing: 8 });

      await callTool("set_item_spacing", {
        nodeId: "frame-001",
        gap: "8" as any,
      });

      const [, params] = mockSendCommand.mock.calls[0];
      expect(params.itemSpacing).toBe(8);
    });

    it("coerces string strokeWeight in set_stroke_color", async () => {
      mockSendCommand.mockResolvedValue({ name: "StrokedNode" });

      await callTool("set_stroke_color", {
        nodeId: "node-001",
        r: 0,
        g: 0,
        b: 0,
        weight: "2" as any,
      });

      const [, params] = mockSendCommand.mock.calls[0];
      expect(params.strokeWeight).toBe(2);
    });
  });
});
