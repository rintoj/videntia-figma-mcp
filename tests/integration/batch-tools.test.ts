import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBatchTools } from "../../src/hgraph_figma_mcp/tools/batch-tools";

jest.mock("../../src/hgraph_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("batch_actions tool", () => {
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
        const [name, _description, schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });

    registerBatchTools(server);
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

  describe("happy path - all actions succeed", () => {
    it("executes a batch of actions and returns results", async () => {
      mockSendCommand.mockResolvedValue({
        success: true,
        totalActions: 3,
        succeeded: 3,
        failed: 0,
        results: [
          { index: 0, action: "create_rectangle", success: true, result: { id: "rect-1", name: "Rectangle" } },
          { index: 1, action: "set_fill_color", success: true, result: { name: "Rectangle" } },
          { index: 2, action: "rename_node", success: true, result: { id: "rect-1", name: "MyRect" } },
        ],
      });

      const response = await callTool("batch_actions", {
        actions: [
          { action: "create_rectangle", params: { x: 0, y: 0, width: 100, height: 50 } },
          { action: "set_fill_color", params: { nodeId: "$result[0].id", color: { r: 1, g: 0, b: 0 } } },
          { action: "rename_node", params: { nodeId: "$result[0].id", name: "MyRect" } },
        ],
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith(
        "batch_actions",
        {
          actions: [
            { action: "create_rectangle", params: { x: 0, y: 0, width: 100, height: 50 } },
            { action: "set_fill_color", params: { nodeId: "$result[0].id", color: { r: 1, g: 0, b: 0 } } },
            { action: "rename_node", params: { nodeId: "$result[0].id", name: "MyRect" } },
          ],
          stopOnError: false,
        },
        expect.any(Number),
      );
      expect(response.content[0].text).toContain("3/3 succeeded");
    });
  });

  describe("partial failure", () => {
    it("reports partial success when some actions fail", async () => {
      mockSendCommand.mockResolvedValue({
        success: false,
        totalActions: 3,
        succeeded: 2,
        failed: 1,
        results: [
          { index: 0, action: "clone_node", success: true, result: { id: "new-1" } },
          { index: 1, action: "rename_node", success: false, error: "Node not found" },
          { index: 2, action: "resize_node", success: true, result: { id: "new-1" } },
        ],
      });

      const response = await callTool("batch_actions", {
        actions: [
          { action: "clone_node", params: { nodeId: "25:212" } },
          { action: "rename_node", params: { nodeId: "invalid", name: "New Name" } },
          { action: "resize_node", params: { nodeId: "$result[0].id", width: 100, height: 50 } },
        ],
      });

      expect(response.content[0].text).toContain("2/3 succeeded");
      expect(response.content[0].text).toContain("1 failed");
    });
  });

  describe("all actions fail", () => {
    it("reports all failures", async () => {
      mockSendCommand.mockResolvedValue({
        success: false,
        totalActions: 2,
        succeeded: 0,
        failed: 2,
        results: [
          { index: 0, action: "delete_node", success: false, error: "Node not found" },
          { index: 1, action: "delete_node", success: false, error: "Node not found" },
        ],
      });

      const response = await callTool("batch_actions", {
        actions: [
          { action: "delete_node", params: { nodeId: "invalid-1" } },
          { action: "delete_node", params: { nodeId: "invalid-2" } },
        ],
      });

      expect(response.content[0].text).toContain("0/2 succeeded");
      expect(response.content[0].text).toContain("2 failed");
    });
  });

  describe("validation", () => {
    it("rejects empty actions array", async () => {
      await expect(callTool("batch_actions", { actions: [] })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("accepts large batch without limit", async () => {
      const count = 50;
      mockSendCommand.mockResolvedValue({
        success: true,
        totalActions: count,
        succeeded: count,
        failed: 0,
        results: Array.from({ length: count }, (_, i) => ({
          index: i,
          action: "get_node_info",
          success: true,
          result: { id: `node-${i}` },
        })),
      });

      const manyActions = Array.from({ length: count }, (_, i) => ({
        action: "get_node_info",
        params: { nodeId: `node-${i}` },
      }));

      const response = await callTool("batch_actions", {
        actions: manyActions,
      });

      expect(response.content[0].text).toContain(`${count}/${count} succeeded`);
    });
  });

  describe("dynamic timeout", () => {
    it("calculates timeout as 30s base + 2s per action", async () => {
      mockSendCommand.mockResolvedValue({
        success: true,
        totalActions: 10,
        succeeded: 10,
        failed: 0,
        results: [],
      });

      const actions = Array.from({ length: 10 }, () => ({
        action: "get_node_info",
        params: { nodeId: "node-1" },
      }));

      await callTool("batch_actions", { actions });

      // 30000 + 10 * 2000 = 50000
      expect(mockSendCommand).toHaveBeenCalledWith("batch_actions", expect.any(Object), 50000);
    });

    it("uses higher timeout for larger batches", async () => {
      mockSendCommand.mockResolvedValue({
        success: true,
        totalActions: 25,
        succeeded: 25,
        failed: 0,
        results: [],
      });

      const actions = Array.from({ length: 25 }, () => ({
        action: "get_node_info",
        params: { nodeId: "node-1" },
      }));

      await callTool("batch_actions", { actions });

      // 30000 + 25 * 2000 = 80000
      expect(mockSendCommand).toHaveBeenCalledWith("batch_actions", expect.any(Object), 80000);
    });
  });

  describe("WebSocket error handling", () => {
    it("handles WebSocket connection failure", async () => {
      mockSendCommand.mockRejectedValue(new Error("Not connected to Figma. Attempting to connect..."));

      const response = await callTool("batch_actions", {
        actions: [{ action: "get_node_info", params: { nodeId: "1:2" } }],
      });

      expect(response.content[0].text).toContain("Error executing batch actions");
      expect(response.content[0].text).toContain("Not connected to Figma");
    });

    it("handles WebSocket timeout", async () => {
      mockSendCommand.mockRejectedValue(new Error("Request to Figma timed out"));

      const response = await callTool("batch_actions", {
        actions: [{ action: "get_node_info", params: { nodeId: "1:2" } }],
      });

      expect(response.content[0].text).toContain("Error executing batch actions");
      expect(response.content[0].text).toContain("timed out");
    });
  });

  describe("stopOnError parameter", () => {
    it("defaults stopOnError to false", async () => {
      mockSendCommand.mockResolvedValue({
        success: true,
        totalActions: 1,
        succeeded: 1,
        failed: 0,
        results: [],
      });

      await callTool("batch_actions", {
        actions: [{ action: "get_node_info", params: { nodeId: "1:2" } }],
      });

      expect(mockSendCommand).toHaveBeenCalledWith(
        "batch_actions",
        {
          actions: [{ action: "get_node_info", params: { nodeId: "1:2" } }],
          stopOnError: false,
        },
        expect.any(Number),
      );
    });

    it("passes stopOnError true to Figma", async () => {
      mockSendCommand.mockResolvedValue({
        success: false,
        totalActions: 3,
        succeeded: 1,
        failed: 1,
        results: [
          { index: 0, action: "clone_node", success: true, result: { id: "new-1" } },
          { index: 1, action: "rename_node", success: false, error: "Node not found" },
        ],
      });

      await callTool("batch_actions", {
        actions: [
          { action: "clone_node", params: { nodeId: "25:212" } },
          { action: "rename_node", params: { nodeId: "invalid", name: "X" } },
          { action: "resize_node", params: { nodeId: "$result[0].id", width: 100, height: 50 } },
        ],
        stopOnError: true,
      });

      expect(mockSendCommand).toHaveBeenCalledWith(
        "batch_actions",
        expect.objectContaining({ stopOnError: true }),
        expect.any(Number),
      );
    });
  });

  describe("params defaults", () => {
    it("defaults params to empty object when not provided", async () => {
      mockSendCommand.mockResolvedValue({
        success: true,
        totalActions: 1,
        succeeded: 1,
        failed: 0,
        results: [{ index: 0, action: "get_selection", success: true, result: { nodes: [] } }],
      });

      const response = await callTool("batch_actions", {
        actions: [{ action: "get_selection" }],
      });

      expect(mockSendCommand).toHaveBeenCalledWith(
        "batch_actions",
        { actions: [{ action: "get_selection", params: {} }], stopOnError: false },
        expect.any(Number),
      );
      expect(response.content[0].text).toContain("1/1 succeeded");
    });
  });
});
