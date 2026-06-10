import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocumentationTools } from "../../src/videntia_figma_mcp/tools/documentation-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
}));

describe("documentation tools integration", () => {
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
        const [name, , schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });

    registerDocumentationTools(server);
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

  describe("enumerate_all_frames", () => {
    it("sends command with defaults applied", async () => {
      mockSendCommand.mockResolvedValue({ frames: [] });

      await callTool("enumerate_all_frames", {});

      expect(mockSendCommand).toHaveBeenCalledWith("enumerate_all_frames", {
        pageId: undefined,
        topLevelOnly: true,
        includeComponents: false,
      });
    });

    it("forwards explicit parameters", async () => {
      mockSendCommand.mockResolvedValue({ frames: [{ id: "1" }] });

      await callTool("enumerate_all_frames", {
        pageId: "page-1",
        topLevelOnly: false,
        includeComponents: true,
      });

      expect(mockSendCommand).toHaveBeenCalledWith("enumerate_all_frames", {
        pageId: "page-1",
        topLevelOnly: false,
        includeComponents: true,
      });
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Page not found"));

      const response = await callTool("enumerate_all_frames", { pageId: "bad" });

      expect(response.content[0].text).toContain("Error enumerating frames");
      expect(response.content[0].text).toContain("Page not found");
    });
  });

  describe("map_prototype_flows", () => {
    it("forwards optional pageId", async () => {
      mockSendCommand.mockResolvedValue({ nodes: [], edges: [], entryPoints: [] });

      await callTool("map_prototype_flows", { pageId: "page-1" });

      expect(mockSendCommand).toHaveBeenCalledWith("map_prototype_flows", { pageId: "page-1" });
    });

    it("works without pageId", async () => {
      mockSendCommand.mockResolvedValue({ nodes: [], edges: [], entryPoints: [] });

      await callTool("map_prototype_flows", {});

      expect(mockSendCommand).toHaveBeenCalledWith("map_prototype_flows", { pageId: undefined });
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("boom"));

      const response = await callTool("map_prototype_flows", {});

      expect(response.content[0].text).toContain("Error mapping prototype flows");
    });
  });

  describe("bulk_export_frames", () => {
    it("applies default format and scale", async () => {
      mockSendCommand.mockResolvedValue({ exports: [] });

      await callTool("bulk_export_frames", { nodeIds: ["a", "b"] });

      expect(mockSendCommand).toHaveBeenCalledWith("bulk_export_frames", {
        nodeIds: ["a", "b"],
        format: "PNG",
        scale: 1,
        pageId: undefined,
      });
    });

    it("accepts custom format, scale, and pageId", async () => {
      mockSendCommand.mockResolvedValue({ exports: [] });

      await callTool("bulk_export_frames", {
        format: "SVG",
        scale: 2,
        pageId: "page-1",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("bulk_export_frames", {
        nodeIds: undefined,
        format: "SVG",
        scale: 2,
        pageId: "page-1",
      });
    });

    it("rejects scale out of range", async () => {
      await expect(callTool("bulk_export_frames", { scale: 10 })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects invalid format", async () => {
      await expect(callTool("bulk_export_frames", { format: "WEBP" })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });
  });

  describe("get_content_tree", () => {
    it("applies maxDepth default", async () => {
      mockSendCommand.mockResolvedValue({ tree: {} });

      await callTool("get_content_tree", { nodeId: "frame-1" });

      expect(mockSendCommand).toHaveBeenCalledWith("get_content_tree", {
        nodeId: "frame-1",
        pageId: undefined,
        maxDepth: 5,
        includeImages: false,
      });
    });

    it("forwards includeImages and pageId", async () => {
      mockSendCommand.mockResolvedValue({ tree: {} });

      await callTool("get_content_tree", {
        pageId: "page-1",
        maxDepth: 10,
        includeImages: true,
      });

      expect(mockSendCommand).toHaveBeenCalledWith("get_content_tree", {
        nodeId: undefined,
        pageId: "page-1",
        maxDepth: 10,
        includeImages: true,
      });
    });

    it("rejects maxDepth out of range", async () => {
      await expect(callTool("get_content_tree", { maxDepth: 100 })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });
  });

  describe("get_frame_documentation", () => {
    it("wraps a single nodeId into an array", async () => {
      mockSendCommand.mockResolvedValue({ docs: [] });

      await callTool("get_frame_documentation", { nodeId: "frame-1" });

      expect(mockSendCommand).toHaveBeenCalledWith("get_frame_documentation", {
        nodeIds: ["frame-1"],
        includeResolved: false,
      });
    });

    it("passes nodeIds through directly", async () => {
      mockSendCommand.mockResolvedValue({ docs: [] });

      await callTool("get_frame_documentation", {
        nodeIds: ["a", "b", "c"],
        includeResolved: true,
      });

      expect(mockSendCommand).toHaveBeenCalledWith("get_frame_documentation", {
        nodeIds: ["a", "b", "c"],
        includeResolved: true,
      });
    });

    it("prefers nodeIds over nodeId when both provided", async () => {
      mockSendCommand.mockResolvedValue({ docs: [] });

      await callTool("get_frame_documentation", {
        nodeId: "ignored",
        nodeIds: ["a", "b"],
      });

      expect(mockSendCommand).toHaveBeenCalledWith("get_frame_documentation", {
        nodeIds: ["a", "b"],
        includeResolved: false,
      });
    });

    it("returns guidance when neither nodeId nor nodeIds is provided", async () => {
      const response = await callTool("get_frame_documentation", {});

      expect(mockSendCommand).not.toHaveBeenCalled();
      expect(response.content[0].text).toContain("Provide nodeId or nodeIds");
    });

    it("returns guidance when nodeIds is an empty array", async () => {
      const response = await callTool("get_frame_documentation", { nodeIds: [] });

      expect(mockSendCommand).not.toHaveBeenCalled();
      expect(response.content[0].text).toContain("Provide nodeId or nodeIds");
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node not found"));

      const response = await callTool("get_frame_documentation", { nodeId: "bad" });

      expect(response.content[0].text).toContain("Error getting frame documentation");
      expect(response.content[0].text).toContain("Node not found");
    });
  });
});
