import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBatchTools } from "../../src/videntia_figma_mcp/tools/batch-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("batch_actions tool", () => {
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
            { action: "create_rectangle", params: { x: 0, y: 0, width: 100, height: 50, name: "Rectangle" } },
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
          actions: [{ action: "get_node_info", params: { nodeIds: ["1:2"], depth: 1 } }],
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
        { actions: [{ action: "get_selection", params: { depth: 1 } }], stopOnError: false },
        expect.any(Number),
      );
      expect(response.content[0].text).toContain("1/1 succeeded");
    });
  });

  describe("param normalization (same names as the individual tools)", () => {
    const okResult = (count: number) => ({
      success: true,
      totalActions: count,
      succeeded: count,
      failed: 0,
      results: [],
    });

    function sentActions(): Array<{ action: string; params: Record<string, unknown> }> {
      return mockSendCommand.mock.calls[0][1].actions;
    }

    it("maps set_layout_sizing horizontal/vertical to the plugin's layoutSizing* names", async () => {
      mockSendCommand.mockResolvedValue(okResult(1));
      await callTool("batch_actions", {
        actions: [{ action: "set_layout_sizing", params: { nodeId: "1:2", horizontal: "FILL", vertical: "HUG" } }],
      });
      expect(sentActions()[0]).toEqual({
        action: "set_layout_sizing",
        params: { nodeId: "1:2", layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" },
      });
    });

    it("maps set_layout_mode mode/rows/columns to layoutMode/gridRowCount/gridColumnCount", async () => {
      mockSendCommand.mockResolvedValue(okResult(1));
      await callTool("batch_actions", {
        actions: [{ action: "set_layout_mode", params: { nodeId: "1:2", mode: "GRID", rows: 2, columns: 3 } }],
      });
      expect(sentActions()[0].params).toEqual({
        nodeId: "1:2",
        layoutMode: "GRID",
        gridRowCount: 2,
        gridColumnCount: 3,
      });
    });

    it("normalizes URL-style node ids in literal params", async () => {
      mockSendCommand.mockResolvedValue(okResult(2));
      await callTool("batch_actions", {
        actions: [
          { action: "move_node", params: { nodeId: "12-34", parentId: "5-6", index: 0 } },
          { action: "delete_multiple_nodes", params: { nodeIds: ["7-8", "9:10"] } },
        ],
      });
      expect(sentActions()[0].params).toEqual({ nodeId: "12:34", parentId: "5:6", index: 0 });
      expect(sentActions()[1].params).toEqual({ nodeIds: ["7:8", "9:10"] });
    });

    it("preserves $result references while renaming keys", async () => {
      mockSendCommand.mockResolvedValue(okResult(3));
      await callTool("batch_actions", {
        actions: [
          { action: "clone_node", params: { nodeId: "1-2" } },
          { action: "set_layout_sizing", params: { nodeId: "$result[0].id", horizontal: "FILL" } },
          { action: "set_padding", params: { nodeId: "$result[0].children[0].id", top: "$result[0].y" } },
        ],
      });
      const sent = sentActions();
      expect(sent[0].params).toEqual({ nodeId: "1:2" });
      expect(sent[1].params).toEqual({ nodeId: "$result[0].id", layoutSizingHorizontal: "FILL" });
      expect(sent[2].params).toEqual({ nodeId: "$result[0].children[0].id", paddingTop: "$result[0].y" });
    });

    it("keeps accepting the plugin's internal param names", async () => {
      mockSendCommand.mockResolvedValue(okResult(1));
      await callTool("batch_actions", {
        actions: [
          {
            action: "set_layout_sizing",
            params: { nodeId: "1:2", layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FILL" },
          },
        ],
      });
      expect(sentActions()[0].params).toEqual({
        nodeId: "1:2",
        layoutSizingHorizontal: "FIXED",
        layoutSizingVertical: "FILL",
      });
    });

    it("fails invalid actions with the direct tool's validation message instead of sending them raw", async () => {
      mockSendCommand.mockResolvedValue({
        success: false,
        totalActions: 1,
        succeeded: 0,
        failed: 1,
        results: [{ index: 0, action: "set_layout_mode", success: false, error: "plugin error" }],
      });
      const response = await callTool("batch_actions", {
        actions: [{ action: "set_layout_mode", params: { nodeId: "1:2", mode: "HORIZONTAL", rows: 2 } }],
      });
      expect(sentActions()[0].params).toEqual({
        __batchError: "rows/columns apply to GRID mode only (mode is HORIZONTAL)",
      });
      expect(response.content[0].text).toContain("rows/columns apply to GRID mode only");
      expect(response.isError).toBe(true);
    });

    it("rejects server-only tools with a clear message", async () => {
      mockSendCommand.mockResolvedValue(okResult(0));
      await callTool("batch_actions", {
        actions: [{ action: "export_image_fill", params: { nodeId: "1:2", exportPath: "/tmp/a.png" } }],
      });
      expect(String(sentActions()[0].params.__batchError)).toContain("cannot be used inside batch_actions");
    });
  });

  describe("per-action results", () => {
    it("lists every action with a compact result so no-ops are visible", async () => {
      mockSendCommand.mockResolvedValue({
        success: true,
        totalActions: 2,
        succeeded: 2,
        failed: 0,
        results: [
          {
            index: 0,
            action: "set_layout_sizing",
            success: true,
            result: { nodeId: "1:2", name: "Card", layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" },
          },
          { index: 1, action: "rename_node", success: true, result: { id: "1:2", name: "A|B" } },
        ],
      });
      const response = await callTool("batch_actions", {
        actions: [
          { action: "set_layout_sizing", params: { nodeId: "1:2", horizontal: "FILL" } },
          { action: "rename_node", params: { nodeId: "1:2", name: "A|B" } },
        ],
      });
      const text = response.content[0].text;
      expect(text).toContain("| 0 | set_layout_sizing | OK |");
      expect(text).toContain('"layoutSizingHorizontal":"FILL"');
      expect(text).toContain("| 1 | rename_node | OK |");
      expect(text).toContain("A\\|B");
    });

    it("reports caller indices for expanded create_icon actions", async () => {
      mockSendCommand.mockResolvedValue({
        success: true,
        totalActions: 3,
        succeeded: 3,
        failed: 0,
        results: [
          { index: 0, action: "create_svg", success: true, result: { id: "9:1" } },
          { index: 1, action: "insert_child", success: true, result: { id: "9:1" } },
          { index: 2, action: "rename_node", success: true, result: { id: "9:1" } },
        ],
      });
      const response = await callTool("batch_actions", {
        actions: [
          { action: "create_icon", params: { parentId: "1:2", name: "bell", size: 16, index: 0 } },
          { action: "rename_node", params: { nodeId: "$result[0].id", name: "Bell" } },
        ],
      });
      const text = response.content[0].text;
      expect(text).toContain("| 0 | create_svg | OK |");
      expect(text).toContain("| 0 | insert_child | OK |");
      expect(text).toContain("| 1 | rename_node | OK |");
      expect(mockSendCommand.mock.calls[0][1].actions[2].params).toEqual({ nodeId: "$result[0].id", name: "Bell" });
    });
  });
});
