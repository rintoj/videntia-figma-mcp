import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDocumentTools } from '../../src/talk_to_figma_mcp/tools/document-tools';

jest.mock('../../src/talk_to_figma_mcp/utils/websocket', () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn()
}));

describe("new document tools integration", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    mockSendCommand = require('../../src/talk_to_figma_mcp/utils/websocket').sendCommandToFigma;
    mockSendCommand.mockClear();

    toolHandlers = new Map();
    toolSchemas = new Map();

    const originalTool = server.tool.bind(server);
    jest.spyOn(server, 'tool').mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, description, schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });

    registerDocumentTools(server);
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

  describe("read_my_design", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        nodes: [{ id: "node-1", name: "Frame 1", type: "FRAME" }],
        count: 1
      });
    });

    it("successfully reads design information", async () => {
      const response = await callTool("read_my_design", {});

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("read_my_design", {});
      expect(response.content[0].text).toContain("node-1");
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("No selection"));

      const response = await callTool("read_my_design", {});

      expect(response.content[0].text).toContain("Error reading design");
      expect(response.content[0].text).toContain("No selection");
    });
  });

  describe("set_focus", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        name: "Target Frame",
        id: "frame-123"
      });
    });

    it("successfully sets focus on a node", async () => {
      const response = await callTool("set_focus", {
        nodeId: "frame-123"
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_focus", {
        nodeId: "frame-123"
      });
      expect(response.content[0].text).toContain("Focused on node");
      expect(response.content[0].text).toContain("Target Frame");
    });

    it("requires nodeId parameter", async () => {
      await expect(callTool("set_focus", {})).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node not found"));

      const response = await callTool("set_focus", {
        nodeId: "invalid-id"
      });

      expect(response.content[0].text).toContain("Error setting focus");
      expect(response.content[0].text).toContain("Node not found");
    });
  });

  describe("set_selections", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        selectedNodes: [
          { name: "Frame 1", id: "frame-1" },
          { name: "Frame 2", id: "frame-2" }
        ],
        count: 2
      });
    });

    it("successfully sets multiple selections", async () => {
      const response = await callTool("set_selections", {
        nodeIds: ["frame-1", "frame-2"]
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_selections", {
        nodeIds: ["frame-1", "frame-2"]
      });
      expect(response.content[0].text).toContain("Selected 2 nodes");
      expect(response.content[0].text).toContain("Frame 1");
      expect(response.content[0].text).toContain("Frame 2");
    });

    it("requires nodeIds parameter", async () => {
      await expect(callTool("set_selections", {})).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("requires nodeIds to be an array", async () => {
      await expect(callTool("set_selections", {
        nodeIds: "frame-1"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Some nodes not found"));

      const response = await callTool("set_selections", {
        nodeIds: ["invalid-1", "invalid-2"]
      });

      expect(response.content[0].text).toContain("Error setting selections");
      expect(response.content[0].text).toContain("Some nodes not found");
    });
  });

  describe("get_annotations", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        annotations: [
          { id: "ann-1", label: "Annotation 1" }
        ],
        categories: []
      });
    });

    it("successfully gets annotations for a node", async () => {
      const response = await callTool("get_annotations", {
        nodeId: "frame-123"
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("get_annotations", {
        nodeId: "frame-123",
        includeCategories: true
      });
      expect(response.content[0].text).toContain("ann-1");
    });

    it("accepts includeCategories parameter", async () => {
      await callTool("get_annotations", {
        nodeId: "frame-123",
        includeCategories: false
      });

      expect(mockSendCommand).toHaveBeenCalledWith("get_annotations", {
        nodeId: "frame-123",
        includeCategories: false
      });
    });

    it("requires nodeId parameter", async () => {
      await expect(callTool("get_annotations", {})).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Annotations not available"));

      const response = await callTool("get_annotations", {
        nodeId: "frame-123"
      });

      expect(response.content[0].text).toContain("Error getting annotations");
    });
  });

  describe("set_annotation", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        id: "ann-123",
        nodeId: "frame-123",
        label: "Test annotation"
      });
    });

    it("successfully creates an annotation", async () => {
      const response = await callTool("set_annotation", {
        nodeId: "frame-123",
        labelMarkdown: "Test annotation"
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_annotation", {
        nodeId: "frame-123",
        annotationId: undefined,
        labelMarkdown: "Test annotation",
        categoryId: undefined,
        properties: undefined
      });
    });

    it("accepts optional parameters", async () => {
      await callTool("set_annotation", {
        nodeId: "frame-123",
        annotationId: "ann-existing",
        labelMarkdown: "Updated annotation",
        categoryId: "cat-1",
        properties: [{ type: "status" }]
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_annotation", {
        nodeId: "frame-123",
        annotationId: "ann-existing",
        labelMarkdown: "Updated annotation",
        categoryId: "cat-1",
        properties: [{ type: "status" }]
      });
    });

    it("requires nodeId and labelMarkdown parameters", async () => {
      await expect(callTool("set_annotation", {
        nodeId: "frame-123"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Cannot create annotation"));

      const response = await callTool("set_annotation", {
        nodeId: "frame-123",
        labelMarkdown: "Test"
      });

      expect(response.content[0].text).toContain("Error setting annotation");
    });
  });

  describe("set_multiple_annotations", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        success: true,
        annotationsApplied: 2,
        annotationsFailed: 0,
        completedInChunks: 1,
        results: [
          { success: true, nodeId: "node-1" },
          { success: true, nodeId: "node-2" }
        ]
      });
    });

    it("successfully sets multiple annotations", async () => {
      const response = await callTool("set_multiple_annotations", {
        nodeId: "parent-frame",
        annotations: [
          { nodeId: "node-1", labelMarkdown: "Ann 1" },
          { nodeId: "node-2", labelMarkdown: "Ann 2" }
        ]
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(response.content[0].text).toContain("2 successfully applied");
      expect(response.content[0].text).toContain("0 failed");
    });

    it("returns early if no annotations provided", async () => {
      const response = await callTool("set_multiple_annotations", {
        nodeId: "parent-frame",
        annotations: []
      });

      expect(mockSendCommand).not.toHaveBeenCalled();
      expect(response.content[0].text).toContain("No annotations provided");
    });

    it("reports failed annotations", async () => {
      mockSendCommand.mockResolvedValue({
        success: true,
        annotationsApplied: 1,
        annotationsFailed: 1,
        completedInChunks: 1,
        results: [
          { success: true, nodeId: "node-1" },
          { success: false, nodeId: "node-2", error: "Node not found" }
        ]
      });

      const response = await callTool("set_multiple_annotations", {
        nodeId: "parent-frame",
        annotations: [
          { nodeId: "node-1", labelMarkdown: "Ann 1" },
          { nodeId: "node-2", labelMarkdown: "Ann 2" }
        ]
      });

      expect(response.content[0].text).toContain("1 failed");
      expect(response.content[0].text).toContain("node-2");
      expect(response.content[0].text).toContain("Node not found");
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Batch failed"));

      const response = await callTool("set_multiple_annotations", {
        nodeId: "parent-frame",
        annotations: [
          { nodeId: "node-1", labelMarkdown: "Ann 1" }
        ]
      });

      expect(response.content[0].text).toContain("Error setting multiple annotations");
    });
  });

  describe("scan_nodes_by_types", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        success: true,
        count: 3,
        matchingNodes: [
          { id: "frame-1", type: "FRAME" },
          { id: "frame-2", type: "FRAME" },
          { id: "comp-1", type: "COMPONENT" }
        ],
        searchedTypes: ["FRAME", "COMPONENT"]
      });
    });

    it("successfully scans for nodes by types", async () => {
      const response = await callTool("scan_nodes_by_types", {
        nodeId: "parent-123",
        types: ["FRAME", "COMPONENT"]
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("scan_nodes_by_types", {
        nodeId: "parent-123",
        types: ["FRAME", "COMPONENT"]
      });
      expect(response.content[0].text).toContain("Found 3 nodes");
      expect(response.content[0].text).toContain("FRAME");
      expect(response.content[0].text).toContain("COMPONENT");
    });

    it("requires nodeId and types parameters", async () => {
      await expect(callTool("scan_nodes_by_types", {
        nodeId: "parent-123"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("requires types to be an array", async () => {
      await expect(callTool("scan_nodes_by_types", {
        nodeId: "parent-123",
        types: "FRAME"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles non-standard result format", async () => {
      mockSendCommand.mockResolvedValue({
        nodes: [{ id: "node-1" }]
      });

      const response = await callTool("scan_nodes_by_types", {
        nodeId: "parent-123",
        types: ["FRAME"]
      });

      expect(response.content[0].text).toContain("node-1");
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Invalid node"));

      const response = await callTool("scan_nodes_by_types", {
        nodeId: "invalid-123",
        types: ["FRAME"]
      });

      expect(response.content[0].text).toContain("Error scanning nodes by types");
      expect(response.content[0].text).toContain("Invalid node");
    });
  });
});
