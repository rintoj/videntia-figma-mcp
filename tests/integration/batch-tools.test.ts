import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../src/videntia_figma_mcp/tools";
import { clearToolRegistry } from "../../src/videntia_figma_mcp/utils/tool-registry";

// A batched action is built by running the standalone handler with sendCommandToFigma
// intercepted, so the mock has to honour capture mode or every batch comes out empty.
jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => {
  // `require`, not jest.requireActual — this suite runs under `bun test`, which has no
  // requireActual.
  const { createCaptureAwareSend } = require("../helpers/capture-aware-websocket");
  return {
    sendCommandToFigma: createCaptureAwareSend(),
    sendCommandToChannel: jest.fn(),
    connectToFigma: jest.fn(),
    joinChannel: jest.fn(),
    getOpenChannels: jest.fn(async () => []),
    getCurrentChannel: jest.fn(() => "test-channel"),
  };
});

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

    clearToolRegistry();
    registerTools(server);
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
          { action: "set_fill_color", params: { nodeId: "$result[0].id", color: { r: 1, g: 0, b: 0, a: 1 } } },
          { action: "rename_node", params: { nodeId: "$result[0].id", name: "MyRect" } },
        ],
        // Opt out of the default pre-batch undo checkpoint so this case asserts
        // on the batch call alone (checkpoint behaviour is covered separately in
        // batch-checkpoint.test.ts).
        checkpoint: false,
      });

      expect(mockSendCommand.mock.calls).toHaveLength(1);
      expect(mockSendCommand.mock.calls).toContainEqual([
        "batch_actions",
        {
          actions: [
            { action: "create_rectangle", params: { x: 0, y: 0, width: 100, height: 50, name: "Rectangle" } },
            { action: "set_fill_color", params: { nodeId: "$result[0].id", color: { r: 1, g: 0, b: 0, a: 1 } } },
            { action: "rename_node", params: { nodeId: "$result[0].id", name: "MyRect" } },
          ],
          stopOnError: false,
        },
        expect.any(Number),
      ]);
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
      expect(mockSendCommand.mock.calls).toHaveLength(0);
    });

    it("accepts large batch without limit", async () => {
      const count = 50;
      // Batches longer than BATCH_CHUNK_SIZE are auto-chunked, so the mock must answer
      // per dispatch — echoing the chunk it was actually given.
      mockSendCommand.mockImplementation(async (command: string, params: any) => {
        if (command !== "batch_actions") return {};
        const results = params.actions.map((a: any, i: number) => ({
          index: i,
          action: a.action,
          success: true,
          result: { id: `node-${i}` },
        }));
        return { success: true, totalActions: results.length, succeeded: results.length, failed: 0, results };
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
      expect(mockSendCommand.mock.calls).toContainEqual(["batch_actions", expect.any(Object), 50000]);
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
      expect(mockSendCommand.mock.calls).toContainEqual(["batch_actions", expect.any(Object), 80000]);
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

      // The payload is the STANDALONE tool's — get_node_info sends nodeIds + depth.
      expect(mockSendCommand.mock.calls).toContainEqual([
        "batch_actions",
        {
          actions: [{ action: "get_node_info", params: { nodeIds: ["1:2"], depth: 1 } }],
          stopOnError: false,
        },
        expect.any(Number),
      ]);
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

      expect(mockSendCommand.mock.calls).toContainEqual([
        "batch_actions",
        expect.objectContaining({ stopOnError: true }),
        expect.any(Number),
      ]);
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

      expect(mockSendCommand.mock.calls).toContainEqual([
        "batch_actions",
        { actions: [{ action: "get_selection", params: { depth: 1 } }], stopOnError: false },
        expect.any(Number),
      ]);
      expect(response.content[0].text).toContain("1/1 succeeded");
    });
  });

  describe("param normalisation (batch params match standalone tools)", () => {
    // Other commands (e.g. the pre-batch undo checkpoint) may also be sent — pick the
    // batch_actions call itself.
    function dispatched() {
      const call = mockSendCommand.mock.calls.filter((c: any[]) => c[0] === "batch_actions").pop();
      return call[1].actions;
    }

    beforeEach(() => {
      mockSendCommand.mockResolvedValue({ success: true, totalActions: 1, succeeded: 1, failed: 0, results: [] });
    });

    it("maps set_layout_mode 'mode' to 'layoutMode'", async () => {
      await callTool("batch_actions", {
        actions: [{ action: "set_layout_mode", params: { nodeId: "1:2", mode: "vertical" } }],
      });
      expect(dispatched()[0].params).toEqual({ nodeId: "1:2", layoutMode: "VERTICAL" });
    });

    it("maps set_line_height 'height' to 'lineHeight' and defaults the unit", async () => {
      await callTool("batch_actions", {
        actions: [{ action: "set_line_height", params: { nodeId: "1:2", height: 24 } }],
      });
      expect(dispatched()[0].params).toEqual({ nodeId: "1:2", lineHeight: 24, unit: "PIXELS" });
    });

    it("maps rename_node 'newName' to 'name'", async () => {
      await callTool("batch_actions", {
        actions: [{ action: "rename_node", params: { nodeId: "1-2", newName: "Card" } }],
      });
      expect(dispatched()[0].params).toEqual({ nodeId: "1:2", name: "Card" });
    });

    it("maps bind_variable 'variableName' to 'variableId'", async () => {
      await callTool("batch_actions", {
        actions: [
          { action: "bind_variable", params: { nodeId: "1:2", variableName: "background/primary", field: "fills/0" } },
        ],
      });
      expect(dispatched()[0].params.variableId).toBe("background/primary");
    });

    it("maps apply_text_style 'styleName' to 'styleId'", async () => {
      await callTool("batch_actions", {
        actions: [{ action: "apply_text_style", params: { nodeId: "1:2", styleName: "body/md" } }],
      });
      expect(dispatched()[0].params).toEqual({ nodeId: "1:2", styleId: "body/md" });
    });

    it("supplies set_gradient_fill 'gradientType' from 'type' (was: Missing gradientType)", async () => {
      await callTool("batch_actions", {
        actions: [
          {
            action: "set_gradient_fill",
            params: {
              nodeId: "1:2",
              type: "LINEAR",
              stops: [
                { color: { r: 0, g: 0, b: 0 }, position: 0 },
                { color: { r: 1, g: 1, b: 1 }, position: 1 },
              ],
            },
          },
        ],
      });
      const params = dispatched()[0].params;
      expect(params.gradientType).toBe("LINEAR");
      expect(params.angle).toBe(0);
      expect(params.opacity).toBe(1);
      expect(params.type).toBeUndefined();
    });

    it("defaults set_corner_radius corners and accepts the object form", async () => {
      await callTool("batch_actions", {
        actions: [
          { action: "set_corner_radius", params: { nodeId: "1:2", radius: 8 } },
          {
            action: "set_corner_radius",
            params: {
              nodeId: "1:3",
              radius: 8,
              corners: { topLeft: true, topRight: true, bottomRight: false, bottomLeft: false },
            },
          },
        ],
      });
      expect(dispatched()[0].params.corners).toEqual([true, true, true, true]);
      expect(dispatched()[1].params.corners).toEqual([true, true, false, false]);
    });

    it("applies create_text defaults so the plugin returns a resolvable node", async () => {
      await callTool("batch_actions", {
        actions: [{ action: "create_text", params: { x: 0, y: 0, text: "Hi" } }],
      });
      expect(dispatched()[0].params).toMatchObject({ text: "Hi", fontSize: 14, fontFamily: "Inter" });
    });

    it("forwards create_rectangle fillColor", async () => {
      await callTool("batch_actions", {
        actions: [{ action: "create_rectangle", params: { x: 0, y: 0, width: 10, height: 10, fillColor: "#ff0000" } }],
      });
      // The standalone tool parses hex into normalised RGBA before dispatch, and the
      // batch now produces the identical payload.
      expect(dispatched()[0].params.fillColor).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    });

    it("does not normalise away $result references", async () => {
      await callTool("batch_actions", {
        actions: [
          { action: "create_text", params: { x: 0, y: 0, text: "Hi" } },
          { action: "rename_node", params: { nodeId: "$result[0].id", newName: "Label" } },
        ],
      });
      expect(dispatched()[1].params).toEqual({ nodeId: "$result[0].id", name: "Label" });
    });
  });

  describe("update_icon expansion", () => {
    function dispatchedActions() {
      const call = mockSendCommand.mock.calls.filter((c: any[]) => c[0] === "batch_actions").pop();
      return call[1].actions;
    }

    beforeEach(() => {
      mockSendCommand.mockResolvedValue({ success: true, totalActions: 1, succeeded: 1, failed: 0, results: [] });
    });

    it("resolves the Lucide icon server-side into svgString (was: Missing svgString)", async () => {
      await callTool("batch_actions", {
        actions: [{ action: "update_icon", params: { nodeId: "1-2", name: "bell", size: 24 } }],
      });
      const action = dispatchedActions()[0];
      expect(action.action).toBe("update_icon");
      expect(action.params.nodeId).toBe("1:2");
      expect(typeof action.params.svgString).toBe("string");
      expect(action.params.svgString).toContain("<svg");
      expect(action.params.name).toBe("bell");
    });

    it("surfaces an unknown icon as a clear per-action error", async () => {
      // The standalone handler refuses to build a payload for an unknown icon, so the
      // action is reported as a per-action failure instead of being sent to Figma with
      // an `_error` sentinel in its params.
      const res = await callTool("batch_actions", {
        actions: [{ action: "update_icon", params: { nodeId: "1:2", name: "definitely-not-an-icon", size: 24 } }],
      });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("update_icon");
      expect(mockSendCommand.mock.calls.filter((c: any[]) => c[0] === "batch_actions")).toHaveLength(0);
    });

    it("does NOT accept a pre-baked svgString, because the standalone tool does not", async () => {
      // `update_icon` standalone takes a Lucide `name` and resolves the SVG itself; it has
      // no `svgString` parameter. Batch used to let one through, which is precisely the
      // standalone/batch divergence this contract removes. An unknown icon name now fails
      // the same way in both places.
      const res = await callTool("batch_actions", {
        actions: [{ action: "update_icon", params: { nodeId: "1:2", svgString: "<svg/>", name: "x" } }],
      });
      expect(res.isError).toBe(true);
      expect(mockSendCommand.mock.calls.filter((c: any[]) => c[0] === "batch_actions")).toHaveLength(0);
    });
  });

  describe("failure reporting", () => {
    it("names the first failing action index and commit status", async () => {
      mockSendCommand.mockResolvedValue({
        success: false,
        totalActions: 3,
        succeeded: 1,
        failed: 2,
        results: [
          { index: 0, action: "create_rectangle", success: true, result: { id: "r1" } },
          { index: 1, action: "set_fill_color", success: false, error: "boom" },
          { index: 2, action: "rename_node", success: false, error: "bang" },
        ],
      });
      const res = await callTool("batch_actions", {
        actions: [
          { action: "create_rectangle", params: { x: 0, y: 0, width: 10, height: 10 } },
          { action: "set_fill_color", params: { nodeId: "1:2", color: "#ff0000" } },
          { action: "rename_node", params: { nodeId: "1:3", name: "X" } },
        ],
      });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("First failure: action #1 (set_fill_color)");
      expect(res.content[0].text).toContain("committed");
    });

    it("explains a transport-level failure (e.g. Cannot unwrap symbol)", async () => {
      mockSendCommand.mockRejectedValue(new Error("Cannot unwrap symbol"));
      const res = await callTool("batch_actions", {
        actions: [
          { action: "create_rectangle", params: { x: 0, y: 0, width: 10, height: 10 } },
          { action: "create_text", params: { x: 0, y: 0, text: "a" } },
        ],
      });
      expect(res.isError).toBe(true);
      const text = res.content[0].text;
      expect(text).toContain("Cannot unwrap symbol");
      expect(text).toContain("dispatched as 2 action(s)");
      expect(text).toContain("ARE committed");
      expect(text).toContain("stopOnError: true");
    });
  });

  describe("failure footer accuracy", () => {
    it("says nothing was committed when action #0 failed", async () => {
      mockSendCommand.mockResolvedValue({
        success: false,
        totalActions: 3,
        succeeded: 0,
        failed: 3,
        results: [
          { index: 0, action: "create_text", success: false, error: "Parent node not found with ID: 0:1" },
          { index: 1, action: "set_font_size", success: false, error: "$result[0] references a failed action" },
          { index: 2, action: "rename_node", success: false, error: "$result[0] references a failed action" },
        ],
      });

      const response = await callTool("batch_actions", {
        actions: [
          { action: "create_text", params: {} },
          { action: "set_font_size", params: {} },
          { action: "rename_node", params: {} },
        ],
      });

      const text = response.content[0].text as string;
      expect(text).toContain("No actions were committed to the document.");
      expect(text).not.toContain("Actions before it are committed");
    });

    it("reports only the succeeded earlier actions as committed", async () => {
      mockSendCommand.mockResolvedValue({
        success: false,
        totalActions: 3,
        succeeded: 1,
        failed: 2,
        results: [
          { index: 0, action: "create_frame", success: true, result: { id: "1:1" } },
          { index: 1, action: "rename_node", success: false, error: "boom" },
          { index: 2, action: "resize_node", success: false, error: "boom" },
        ],
      });

      const response = await callTool("batch_actions", {
        actions: [
          { action: "create_frame", params: {} },
          { action: "rename_node", params: {} },
          { action: "resize_node", params: {} },
        ],
      });

      const text = response.content[0].text as string;
      expect(text).toContain("1 earlier action(s) succeeded and ARE committed in the document (#0)");
    });
  });
});
