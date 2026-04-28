import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerModificationTools } from "../../src/hgraph_figma_mcp/tools/modification-tools";

jest.mock("../../src/hgraph_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("new modification tools integration", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });

    mockSendCommand = require("../../src/hgraph_figma_mcp/utils/websocket").sendCommandToFigma;
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

  describe("delete_multiple_nodes", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        deleted: 3,
        nodeIds: ["node-1", "node-2", "node-3"],
      });
    });

    it("successfully deletes multiple nodes", async () => {
      const response = await callTool("delete_multiple_nodes", {
        nodeIds: ["node-1", "node-2", "node-3"],
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("delete_multiple_nodes", {
        nodeIds: ["node-1", "node-2", "node-3"],
      });
      expect(response.content[0].text).toContain("Deleted 3 node(s)");
    });

    it("requires nodeIds parameter", async () => {
      await expect(callTool("delete_multiple_nodes", {})).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("coerces string nodeIds into an array", async () => {
      mockSendCommand.mockResolvedValue({ deleted: ["node-1"] });
      const response = await callTool("delete_multiple_nodes", {
        nodeIds: "node-1",
      });
      expect(mockSendCommand).toHaveBeenCalledWith("delete_multiple_nodes", { nodeIds: ["node-1"] });
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Some nodes not found"));

      const response = await callTool("delete_multiple_nodes", {
        nodeIds: ["invalid-1", "invalid-2"],
      });

      expect(response.content[0].text).toContain("Error deleting multiple nodes");
      expect(response.content[0].text).toContain("Some nodes not found");
    });
  });

  describe("set_layout_mode", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        name: "Auto Layout Frame",
      });
    });

    it("successfully sets layout mode to HORIZONTAL", async () => {
      const response = await callTool("set_layout_mode", {
        nodeId: "frame-123",
        mode: "HORIZONTAL",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_mode", {
        nodeId: "frame-123",
        layoutMode: "HORIZONTAL",
        layoutWrap: "NO_WRAP",
      });
      expect(response.content[0].text).toContain("Set layout mode");
      expect(response.content[0].text).toContain("Auto Layout Frame");
      expect(response.content[0].text).toContain("HORIZONTAL");
    });

    it("successfully sets layout mode to VERTICAL", async () => {
      const response = await callTool("set_layout_mode", {
        nodeId: "frame-123",
        mode: "VERTICAL",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_mode", {
        nodeId: "frame-123",
        layoutMode: "VERTICAL",
        layoutWrap: "NO_WRAP",
      });
    });

    it("successfully sets layout mode to NONE", async () => {
      const response = await callTool("set_layout_mode", {
        nodeId: "frame-123",
        mode: "NONE",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_mode", {
        nodeId: "frame-123",
        layoutMode: "NONE",
        layoutWrap: "NO_WRAP",
      });
    });

    it("accepts layoutWrap parameter", async () => {
      await callTool("set_layout_mode", {
        nodeId: "frame-123",
        mode: "HORIZONTAL",
        wrap: "WRAP",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_mode", {
        nodeId: "frame-123",
        layoutMode: "HORIZONTAL",
        layoutWrap: "WRAP",
      });
    });

    it("requires nodeId and layoutMode parameters", async () => {
      await expect(
        callTool("set_layout_mode", {
          nodeId: "frame-123",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects invalid layoutMode values", async () => {
      await expect(
        callTool("set_layout_mode", {
          nodeId: "frame-123",
          mode: "INVALID",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node is not a frame"));

      const response = await callTool("set_layout_mode", {
        nodeId: "text-123",
        mode: "HORIZONTAL",
      });

      expect(response.content[0].text).toContain("Error setting layout mode");
      expect(response.content[0].text).toContain("Node is not a frame");
    });
  });

  describe("set_padding", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        name: "Padded Frame",
      });
    });

    it("successfully sets all padding values", async () => {
      const response = await callTool("set_padding", {
        nodeId: "frame-123",
        top: 10,
        right: 20,
        bottom: 10,
        left: 20,
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_padding", {
        nodeId: "frame-123",
        paddingTop: 10,
        paddingRight: 20,
        paddingBottom: 10,
        paddingLeft: 20,
      });
      expect(response.content[0].text).toContain("padding");
      expect(response.content[0].text).toContain("Padded Frame");
      expect(response.content[0].text).toContain("top: 10");
      expect(response.content[0].text).toContain("right: 20");
    });

    it("successfully sets individual padding values", async () => {
      const response = await callTool("set_padding", {
        nodeId: "frame-123",
        top: 15,
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_padding", {
        nodeId: "frame-123",
        paddingTop: 15,
        paddingRight: undefined,
        paddingBottom: undefined,
        paddingLeft: undefined,
      });
      expect(response.content[0].text).toContain("top: 15");
    });

    it("requires nodeId parameter", async () => {
      await expect(
        callTool("set_padding", {
          top: 10,
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Not an auto-layout frame"));

      const response = await callTool("set_padding", {
        nodeId: "frame-123",
        top: 10,
      });

      expect(response.content[0].text).toContain("Error setting padding");
      expect(response.content[0].text).toContain("Not an auto-layout frame");
    });
  });

  describe("set_axis_align", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        name: "Aligned Frame",
      });
    });

    it("successfully sets primary axis alignment", async () => {
      const response = await callTool("set_axis_align", {
        nodeId: "frame-123",
        primaryAxisAlignItems: "CENTER",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_axis_align", {
        nodeId: "frame-123",
        primaryAxisAlignItems: "CENTER",
        counterAxisAlignItems: undefined,
      });
      expect(response.content[0].text).toContain("axis alignment");
      expect(response.content[0].text).toContain("primary: CENTER");
    });

    it("successfully sets counter axis alignment", async () => {
      const response = await callTool("set_axis_align", {
        nodeId: "frame-123",
        counterAxisAlignItems: "MAX",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_axis_align", {
        nodeId: "frame-123",
        primaryAxisAlignItems: undefined,
        counterAxisAlignItems: "MAX",
      });
      expect(response.content[0].text).toContain("counter: MAX");
    });

    it("successfully sets both axis alignments", async () => {
      const response = await callTool("set_axis_align", {
        nodeId: "frame-123",
        primaryAxisAlignItems: "SPACE_BETWEEN",
        counterAxisAlignItems: "BASELINE",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_axis_align", {
        nodeId: "frame-123",
        primaryAxisAlignItems: "SPACE_BETWEEN",
        counterAxisAlignItems: "BASELINE",
      });
      expect(response.content[0].text).toContain("primary: SPACE_BETWEEN");
      expect(response.content[0].text).toContain("counter: BASELINE");
    });

    it("requires nodeId parameter", async () => {
      await expect(
        callTool("set_axis_align", {
          primaryAxisAlignItems: "CENTER",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects invalid alignment values", async () => {
      await expect(
        callTool("set_axis_align", {
          nodeId: "frame-123",
          primaryAxisAlignItems: "INVALID",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Not an auto-layout frame"));

      const response = await callTool("set_axis_align", {
        nodeId: "frame-123",
        primaryAxisAlignItems: "CENTER",
      });

      expect(response.content[0].text).toContain("Error setting axis alignment");
    });
  });

  describe("set_layout_sizing", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        name: "Sized Frame",
      });
    });

    it("successfully sets horizontal sizing", async () => {
      const response = await callTool("set_layout_sizing", {
        nodeId: "frame-123",
        horizontal: "HUG",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_sizing", {
        nodeId: "frame-123",
        layoutSizingHorizontal: "HUG",
        layoutSizingVertical: undefined,
      });
      expect(response.content[0].text).toContain("layout sizing");
      expect(response.content[0].text).toContain("horizontal: HUG");
    });

    it("successfully sets vertical sizing", async () => {
      const response = await callTool("set_layout_sizing", {
        nodeId: "frame-123",
        vertical: "FILL",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_sizing", {
        nodeId: "frame-123",
        layoutSizingHorizontal: undefined,
        layoutSizingVertical: "FILL",
      });
      expect(response.content[0].text).toContain("vertical: FILL");
    });

    it("successfully sets both sizing modes", async () => {
      const response = await callTool("set_layout_sizing", {
        nodeId: "frame-123",
        horizontal: "FIXED",
        vertical: "HUG",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_sizing", {
        nodeId: "frame-123",
        layoutSizingHorizontal: "FIXED",
        layoutSizingVertical: "HUG",
      });
      expect(response.content[0].text).toContain("horizontal: FIXED");
      expect(response.content[0].text).toContain("vertical: HUG");
    });

    it("requires nodeId parameter", async () => {
      await expect(
        callTool("set_layout_sizing", {
          horizontal: "HUG",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects invalid sizing values", async () => {
      await expect(
        callTool("set_layout_sizing", {
          nodeId: "frame-123",
          horizontal: "INVALID",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Cannot set sizing"));

      const response = await callTool("set_layout_sizing", {
        nodeId: "frame-123",
        horizontal: "HUG",
      });

      expect(response.content[0].text).toContain("Error setting layout sizing");
    });
  });

  describe("set_item_spacing", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        name: "Spaced Frame",
        gap: 10,
        counterAxisSpacing: 20,
      });
    });

    it("successfully sets item spacing", async () => {
      const response = await callTool("set_item_spacing", {
        nodeId: "frame-123",
        gap: 10,
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_item_spacing", {
        nodeId: "frame-123",
        itemSpacing: 10,
      });
      expect(response.content[0].text).toContain("Updated spacing");
      expect(response.content[0].text).toContain("Spaced Frame");
      expect(response.content[0].text).toContain("gap=10");
    });

    it("successfully sets counter axis spacing", async () => {
      const response = await callTool("set_item_spacing", {
        nodeId: "frame-123",
        counterAxisSpacing: 20,
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_item_spacing", {
        nodeId: "frame-123",
        counterAxisSpacing: 20,
      });
      expect(response.content[0].text).toContain("counterAxisSpacing=20");
    });

    it("successfully sets both spacing values", async () => {
      const response = await callTool("set_item_spacing", {
        nodeId: "frame-123",
        gap: 10,
        counterAxisSpacing: 20,
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_item_spacing", {
        nodeId: "frame-123",
        itemSpacing: 10,
        counterAxisSpacing: 20,
      });
      expect(response.content[0].text).toContain("gap=10");
      expect(response.content[0].text).toContain("counterAxisSpacing=20");
    });

    it("requires nodeId parameter", async () => {
      await expect(
        callTool("set_item_spacing", {
          gap: 10,
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Not an auto-layout frame"));

      const response = await callTool("set_item_spacing", {
        nodeId: "frame-123",
        gap: 10,
      });

      expect(response.content[0].text).toContain("Error setting item spacing");
      expect(response.content[0].text).toContain("Not an auto-layout frame");
    });
  });

  describe("set_image_fill", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        id: "rect-123",
        name: "Image Rectangle",
        imageHash: "abc123def456",
        imageSize: { width: 800, height: 600 },
        scaleMode: "FILL",
      });
    });

    it("successfully sets image fill from URL", async () => {
      const response = await callTool("set_image_fill", {
        nodeId: "rect-123",
        imageUrl: "https://picsum.photos/800/600",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_image_fill", {
        nodeId: "rect-123",
        imageUrl: "https://picsum.photos/800/600",
        scaleMode: "FILL",
        rotation: undefined,
        exposure: undefined,
        contrast: undefined,
        saturation: undefined,
        temperature: undefined,
        tint: undefined,
        highlights: undefined,
        shadows: undefined,
      });
      expect(response.content[0].text).toContain("Set image fill");
      expect(response.content[0].text).toContain("Image Rectangle");
      expect(response.content[0].text).toContain("800x600");
      expect(response.content[0].text).toContain("FILL");
    });

    it("successfully sets image fill with FIT scale mode", async () => {
      mockSendCommand.mockResolvedValue({
        id: "rect-123",
        name: "Image Rectangle",
        imageHash: "abc123def456",
        imageSize: { width: 800, height: 600 },
        scaleMode: "FIT",
      });

      const response = await callTool("set_image_fill", {
        nodeId: "rect-123",
        imageUrl: "https://picsum.photos/800/600",
        scaleMode: "FIT",
      });

      expect(mockSendCommand).toHaveBeenCalledWith(
        "set_image_fill",
        expect.objectContaining({
          nodeId: "rect-123",
          imageUrl: "https://picsum.photos/800/600",
          scaleMode: "FIT",
        }),
      );
      expect(response.content[0].text).toContain("FIT");
    });

    it("successfully sets image fill with CROP scale mode", async () => {
      mockSendCommand.mockResolvedValue({
        id: "rect-123",
        name: "Image Rectangle",
        imageHash: "abc123def456",
        imageSize: { width: 800, height: 600 },
        scaleMode: "CROP",
      });

      const response = await callTool("set_image_fill", {
        nodeId: "rect-123",
        imageUrl: "https://picsum.photos/800/600",
        scaleMode: "CROP",
      });

      expect(mockSendCommand).toHaveBeenCalledWith(
        "set_image_fill",
        expect.objectContaining({
          scaleMode: "CROP",
        }),
      );
    });

    it("successfully sets image fill with TILE scale mode", async () => {
      mockSendCommand.mockResolvedValue({
        id: "rect-123",
        name: "Image Rectangle",
        imageHash: "abc123def456",
        imageSize: { width: 800, height: 600 },
        scaleMode: "TILE",
      });

      const response = await callTool("set_image_fill", {
        nodeId: "rect-123",
        imageUrl: "https://picsum.photos/800/600",
        scaleMode: "TILE",
      });

      expect(mockSendCommand).toHaveBeenCalledWith(
        "set_image_fill",
        expect.objectContaining({
          scaleMode: "TILE",
        }),
      );
    });

    it("successfully sets image fill with filters", async () => {
      const response = await callTool("set_image_fill", {
        nodeId: "rect-123",
        imageUrl: "https://picsum.photos/800/600",
        exposure: 0.2,
        contrast: 0.1,
        saturation: -0.3,
      });

      expect(mockSendCommand).toHaveBeenCalledWith(
        "set_image_fill",
        expect.objectContaining({
          nodeId: "rect-123",
          imageUrl: "https://picsum.photos/800/600",
          exposure: 0.2,
          contrast: 0.1,
          saturation: -0.3,
        }),
      );
    });

    it("requires nodeId parameter", async () => {
      await expect(
        callTool("set_image_fill", {
          imageUrl: "https://picsum.photos/800/600",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("requires imageUrl parameter", async () => {
      await expect(
        callTool("set_image_fill", {
          nodeId: "rect-123",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("requires valid URL for imageUrl", async () => {
      await expect(
        callTool("set_image_fill", {
          nodeId: "rect-123",
          imageUrl: "not-a-valid-url",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects invalid scaleMode values", async () => {
      await expect(
        callTool("set_image_fill", {
          nodeId: "rect-123",
          imageUrl: "https://picsum.photos/800/600",
          scaleMode: "INVALID",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects filter values outside valid range", async () => {
      await expect(
        callTool("set_image_fill", {
          nodeId: "rect-123",
          imageUrl: "https://picsum.photos/800/600",
          exposure: 2.0, // Must be between -1 and 1
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles CORS/network errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(
        new Error("Failed to fetch image from URL. This may be due to CORS restrictions"),
      );

      const response = await callTool("set_image_fill", {
        nodeId: "rect-123",
        imageUrl: "https://blocked-domain.com/image.png",
      });

      expect(response.content[0].text).toContain("Error setting image fill");
      expect(response.content[0].text).toContain("CORS");
    });

    it("handles node not found errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node not found with ID: invalid-123"));

      const response = await callTool("set_image_fill", {
        nodeId: "invalid-123",
        imageUrl: "https://picsum.photos/800/600",
      });

      expect(response.content[0].text).toContain("Error setting image fill");
      expect(response.content[0].text).toContain("Node not found");
    });

    it("handles unsupported node type errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node does not support fills"));

      const response = await callTool("set_image_fill", {
        nodeId: "text-123",
        imageUrl: "https://picsum.photos/800/600",
      });

      expect(response.content[0].text).toContain("Error setting image fill");
      expect(response.content[0].text).toContain("does not support fills");
    });
  });
});
