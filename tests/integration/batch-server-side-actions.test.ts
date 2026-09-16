import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBatchTools } from "../../src/videntia_figma_mcp/tools/batch-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

/**
 * #16 — pure server-side computation tools inside batch_actions.
 * Asserts REAL behaviour: what the plugin actually received, and the resolved value.
 */
describe("batch_actions with server-side-only actions (#16)", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  const handlers = new Map<string, Function>();
  const schemas = new Map<string, z.ZodObject<any>>();

  beforeEach(() => {
    handlers.clear();
    schemas.clear();
    server = new McpServer({ name: "test", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockReset();

    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        handlers.set(args[0], args[3]);
        schemas.set(args[0], z.object(args[2]));
      }
      return (originalTool as any)(...args);
    });
    registerBatchTools(server);
  });

  async function callBatch(args: any) {
    return await handlers.get("batch_actions")!(schemas.get("batch_actions")!.parse(args), { meta: {} });
  }

  /** The `batch_actions` payload the plugin was asked to run (ignoring commit_undo). */
  function dispatchedActions() {
    const call = mockSendCommand.mock.calls.find((c) => c[0] === "batch_actions");
    return call ? (call[1].actions as Array<{ action: string; params: any }>) : [];
  }

  it("computes a composite colour and feeds it into a later action via $result", async () => {
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "commit_undo") return {};
      return {
        totalActions: 1,
        succeeded: 1,
        failed: 0,
        results: [{ index: 0, action: "set_fill_color", success: true, result: { id: "1:2" } }],
      };
    });

    const res = await callBatch({
      actions: [
        {
          action: "calculate_composite_color",
          params: { base: "#000000", background: "#ffffff", mixPercentage: 0.5 },
        },
        { action: "set_fill_color", params: { nodeId: "1:2", color: "$result[0].hex" } },
      ],
    });

    const dispatched = dispatchedActions();
    // The pure action never reaches the plugin...
    expect(dispatched.map((a) => a.action)).toEqual(["set_fill_color"]);
    // ...and the reference was resolved to the ACTUAL computed value, not left as text.
    expect(String(dispatched[0].params.color).toLowerCase()).toBe("#808080");

    // The caller still sees one row per action, in their order.
    expect(res.isError).toBe(false);
    expect(res.content[0].text).toContain("2/2 succeeded");
  });

  it("chains a colour-scale level into a fill", async () => {
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "commit_undo") return {};
      return {
        totalActions: 1,
        succeeded: 1,
        failed: 0,
        results: [{ index: 0, action: "set_fill_color", success: true, result: { id: "1:2" } }],
      };
    });

    await callBatch({
      actions: [
        { action: "calculate_color_scale", params: { baseColor: "#000000", backgroundColor: "#ffffff" } },
        { action: "set_fill_color", params: { nodeId: "1:2", color: "$result[0].scale.500.hex" } },
      ],
    });

    expect(String(dispatchedActions()[0].params.color).toLowerCase()).toBe("#808080");
  });

  it("reports a bad pure-action input as that action's failure instead of dispatching it", async () => {
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "commit_undo") return {};
      return { totalActions: 0, succeeded: 0, failed: 0, results: [] };
    });

    const res = await callBatch({
      actions: [
        { action: "calculate_composite_color", params: { base: "#000", background: "#fff", mixPercentage: 9 } },
      ],
    });

    expect(dispatchedActions()).toEqual([]);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("mixPercentage");
  });

  it("rejects a non-batchable server-side tool BY NAME, never as 'Unknown command'", async () => {
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "commit_undo") return {};
      return {
        totalActions: 1,
        succeeded: 1,
        failed: 0,
        results: [{ index: 0, action: "rename_node", success: true, result: { id: "1:2" } }],
      };
    });

    const res = await callBatch({
      actions: [
        { action: "browser_click", params: { selector: ".x" } },
        { action: "rename_node", params: { nodeId: "1:2", name: "A" } },
      ],
    });

    // Never sent to the plugin — so it cannot come back as "Unknown command".
    expect(dispatchedActions().map((a) => a.action)).toEqual(["rename_node"]);
    const text = res.content[0].text as string;
    expect(text).toContain("browser_click");
    expect(text).toContain("server-side-only tool");
    expect(text).not.toContain("Unknown command");
    // The legitimate action still ran, and the failure row is at the caller's index 0.
    expect(text).toContain("1/2 succeeded");
  });
});
