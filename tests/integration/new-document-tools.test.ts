import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDocumentTools } from '../../src/claude_figma_mcp/tools/document-tools';

jest.mock('../../src/claude_figma_mcp/utils/websocket', () => ({
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

    mockSendCommand = require('../../src/claude_figma_mcp/utils/websocket').sendCommandToFigma;
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
        selectionCount: 1,
        selection: [{ id: "node-1", name: "Frame 1", type: "FRAME", visible: true }]
      });
    });

    it("successfully reads design as JSX", async () => {
      const response = await callTool("read_my_design", {});

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("read_my_design", { nodeId: undefined, depth: undefined });
      expect(response.content[0].text).toContain('id="node-1"');
      expect(response.content[0].text).toContain('name="Frame 1"');
    });

    it("passes nodeId and depth params to plugin", async () => {
      await callTool("read_my_design", { nodeId: "1:23", depth: 2 });

      expect(mockSendCommand).toHaveBeenCalledWith("read_my_design", { nodeId: "1:23", depth: 2 });
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

    it("coerces string nodeIds into an array", async () => {
      mockSendCommand.mockResolvedValue({
        selectedNodes: [{ name: "Frame 1", id: "frame-1" }],
        count: 1
      });
      const response = await callTool("set_selections", {
        nodeIds: "frame-1"
      });
      expect(mockSendCommand).toHaveBeenCalledWith("set_selections", { nodeIds: ["frame-1"] });
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
        success: true,
        nodeId: "frame-123",
        nodeName: "Test Frame",
        nodeType: "FRAME",
        annotationCount: 1,
        annotations: [
          { index: 0, label: "Annotation 1", labelMarkdown: "Annotation 1" }
        ]
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
      expect(response.content[0].text).toContain("Annotation 1");
      expect(response.content[0].text).toContain('"annotationCount":1');
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
        success: true,
        nodeId: "frame-123",
        nodeName: "Test Frame",
        annotationIndex: 0,
        totalAnnotations: 1,
        annotation: { labelMarkdown: "Test annotation" }
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
      expect(response.content[0].text).toContain('"success":true');
    });

    it("accepts optional parameters", async () => {
      await callTool("set_annotation", {
        nodeId: "frame-123",
        annotationId: "0",
        labelMarkdown: "Updated annotation",
        categoryId: "cat-1",
        properties: [{ type: "status" }]
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_annotation", {
        nodeId: "frame-123",
        annotationId: "0",
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

  describe("get_annotation_categories", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        success: true,
        count: 2,
        categories: [
          { id: "cat-1", label: "Development", color: "blue", isPreset: true },
          { id: "cat-2", label: "Custom", color: "green", isPreset: false }
        ]
      });
    });

    it("successfully gets annotation categories", async () => {
      const response = await callTool("get_annotation_categories", {});

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("get_annotation_categories");
      expect(response.content[0].text).toContain("Development");
      expect(response.content[0].text).toContain("Custom");
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("API error"));

      const response = await callTool("get_annotation_categories", {});

      expect(response.content[0].text).toContain("Error getting annotation categories");
    });
  });

  describe("create_annotation_category", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        success: true,
        category: { id: "cat-new", label: "Review", color: "green", isPreset: false }
      });
    });

    it("successfully creates an annotation category", async () => {
      const response = await callTool("create_annotation_category", {
        label: "Review",
        color: "green"
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("create_annotation_category", {
        label: "Review",
        color: "green"
      });
      expect(response.content[0].text).toContain("Review");
    });

    it("uses default color when not specified", async () => {
      await callTool("create_annotation_category", {
        label: "Review"
      });

      expect(mockSendCommand).toHaveBeenCalledWith("create_annotation_category", {
        label: "Review",
        color: "blue"
      });
    });

    it("requires label parameter", async () => {
      await expect(callTool("create_annotation_category", {})).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Invalid color"));

      const response = await callTool("create_annotation_category", {
        label: "Test"
      });

      expect(response.content[0].text).toContain("Error creating annotation category");
    });
  });

  describe("update_annotation_category", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        success: true,
        category: { id: "cat-1", label: "Updated", color: "red", isPreset: false }
      });
    });

    it("successfully updates an annotation category", async () => {
      const response = await callTool("update_annotation_category", {
        categoryId: "cat-1",
        label: "Updated",
        color: "red"
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("update_annotation_category", {
        categoryId: "cat-1",
        label: "Updated",
        color: "red"
      });
      expect(response.content[0].text).toContain("Updated");
    });

    it("allows updating only label", async () => {
      await callTool("update_annotation_category", {
        categoryId: "cat-1",
        label: "New Label"
      });

      expect(mockSendCommand).toHaveBeenCalledWith("update_annotation_category", {
        categoryId: "cat-1",
        label: "New Label",
        color: undefined
      });
    });

    it("requires categoryId parameter", async () => {
      await expect(callTool("update_annotation_category", {
        label: "Test"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors for preset categories", async () => {
      mockSendCommand.mockRejectedValue(new Error("Cannot modify a preset annotation category"));

      const response = await callTool("update_annotation_category", {
        categoryId: "preset-1",
        label: "Can't change"
      });

      expect(response.content[0].text).toContain("Error updating annotation category");
      expect(response.content[0].text).toContain("preset");
    });
  });

  describe("delete_annotation_category", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        success: true,
        deletedCategoryId: "cat-1"
      });
    });

    it("successfully deletes an annotation category", async () => {
      const response = await callTool("delete_annotation_category", {
        categoryId: "cat-1"
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("delete_annotation_category", {
        categoryId: "cat-1"
      });
      expect(response.content[0].text).toContain("cat-1");
    });

    it("requires categoryId parameter", async () => {
      await expect(callTool("delete_annotation_category", {})).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors for preset categories", async () => {
      mockSendCommand.mockRejectedValue(new Error("Cannot delete a preset annotation category"));

      const response = await callTool("delete_annotation_category", {
        categoryId: "preset-1"
      });

      expect(response.content[0].text).toContain("Error deleting annotation category");
      expect(response.content[0].text).toContain("preset");
    });
  });

  describe("scan_nodes_by_types", () => {
    beforeEach(() => {
      mockSendCommand.mockImplementation((command: string) => {
        if (command === "read_my_design") {
          return Promise.resolve({ selectionCount: 0, selection: [] });
        }
        return Promise.resolve({
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
    });

    it("successfully scans for nodes by types", async () => {
      const response = await callTool("scan_nodes_by_types", {
        nodeId: "parent-123",
        types: ["FRAME", "COMPONENT"]
      });

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

    it("coerces string types into an array", async () => {
      mockSendCommand.mockImplementation((command: string) => {
        if (command === "read_my_design") {
          return Promise.resolve({ selectionCount: 0, selection: [] });
        }
        return Promise.resolve({
          success: true,
          count: 1,
          matchingNodes: [{ id: "node-1" }],
          searchedTypes: ["FRAME"]
        });
      });
      const response = await callTool("scan_nodes_by_types", {
        nodeId: "parent-123",
        types: "FRAME"
      });
      expect(mockSendCommand).toHaveBeenCalledWith("scan_nodes_by_types", { nodeId: "parent-123", types: ["FRAME"] });
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

  describe("create_page", () => {
    it("creates a new page with the given name", async () => {
      mockSendCommand.mockResolvedValue({
        id: "page-123",
        name: "Components",
      });

      const response = await callTool("create_page", { name: "Components" });

      expect(mockSendCommand).toHaveBeenCalledWith("create_page", {
        name: "Components",
      });
      expect(response.content[0].text).toContain('Created page "Components"');
      expect(response.content[0].text).toContain("page-123");
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Plugin error"));

      const response = await callTool("create_page", { name: "Test" });

      expect(response.content[0].text).toContain("Error creating page");
      expect(response.content[0].text).toContain("Plugin error");
    });
  });

  describe("rename_page", () => {
    it("renames an existing page", async () => {
      mockSendCommand.mockResolvedValue({
        id: "page-123",
        oldName: "Page 1",
        newName: "Design",
      });

      const response = await callTool("rename_page", {
        pageId: "page-123",
        name: "Design",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("rename_page", {
        pageId: "page-123",
        name: "Design",
      });
      expect(response.content[0].text).toContain('Renamed page from "Page 1" to "Design"');
      expect(response.content[0].text).toContain("page-123");
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Page not found"));

      const response = await callTool("rename_page", {
        pageId: "invalid",
        name: "New Name",
      });

      expect(response.content[0].text).toContain("Error renaming page");
      expect(response.content[0].text).toContain("Page not found");
    });
  });

  describe("delete_page", () => {
    it("deletes a page", async () => {
      mockSendCommand.mockResolvedValue({
        id: "page-456",
        name: "Draft",
      });

      const response = await callTool("delete_page", { pageId: "page-456" });

      expect(mockSendCommand).toHaveBeenCalledWith("delete_page", {
        pageId: "page-456",
      });
      expect(response.content[0].text).toContain('Deleted page "Draft"');
      expect(response.content[0].text).toContain("page-456");
    });

    it("handles errors when deleting last page", async () => {
      mockSendCommand.mockRejectedValue(
        new Error("Cannot delete the last remaining page")
      );

      const response = await callTool("delete_page", { pageId: "page-1" });

      expect(response.content[0].text).toContain("Error deleting page");
      expect(response.content[0].text).toContain("Cannot delete the last remaining page");
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Page not found"));

      const response = await callTool("delete_page", { pageId: "invalid" });

      expect(response.content[0].text).toContain("Error deleting page");
      expect(response.content[0].text).toContain("Page not found");
    });
  });

  describe("jsx_to_figma", () => {
    it("successfully creates nodes from JSX", async () => {
      mockSendCommand.mockResolvedValue({
        createdNodes: [
          { id: "node-1", name: "Card", type: "FRAME" },
        ],
      });

      const response = await callTool("jsx_to_figma", {
        jsx: '<div id="1:1" name="Card" className="flex flex-col w-[320px] p-[16px]" />',
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("create_from_data", expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            id: "1:1",
            name: "Card",
            type: "FRAME",
            layoutMode: "VERTICAL",
            width: 320,
            paddingTop: 16,
          }),
        ]),
      }));
      expect(response.content[0].text).toContain('Created 1 node(s)');
      expect(response.content[0].text).toContain('"Card"');
    });

    it("passes optional parentId, x, y params", async () => {
      mockSendCommand.mockResolvedValue({
        createdNodes: [{ id: "node-1", name: "Test", type: "FRAME" }],
      });

      await callTool("jsx_to_figma", {
        jsx: '<div id="1:1" name="Test" />',
        parentId: "parent-123",
        x: 100,
        y: 200,
      });

      expect(mockSendCommand).toHaveBeenCalledWith("create_from_data", expect.objectContaining({
        parentId: "parent-123",
        x: 100,
        y: 200,
      }));
    });

    it("handles parse errors gracefully", async () => {
      const response = await callTool("jsx_to_figma", {
        jsx: "<div malformed",
      });

      expect(response.content[0].text).toContain("Error creating from JSX");
    });

    it("handles Figma plugin errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Plugin error"));

      const response = await callTool("jsx_to_figma", {
        jsx: '<div id="1:1" name="Test" />',
      });

      expect(response.content[0].text).toContain("Error creating from JSX");
      expect(response.content[0].text).toContain("Plugin error");
    });

    it("requires jsx parameter", async () => {
      await expect(callTool("jsx_to_figma", {})).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });
  });
});
