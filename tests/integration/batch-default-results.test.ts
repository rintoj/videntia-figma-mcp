import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../src/videntia_figma_mcp/tools";
import { clearToolRegistry } from "../../src/videntia_figma_mcp/utils/tool-registry";
import { summarizeActionResult, DIGEST_MAX_LENGTH } from "../../src/videntia_figma_mcp/utils/batch-result-digest";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => {
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

describe("batch_actions surfaces per-action outcomes by default", () => {
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockReset();

    toolHandlers = new Map();
    toolSchemas = new Map();
    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        toolHandlers.set(args[0], args[3]);
        toolSchemas.set(args[0], z.object(args[2]));
      }
      return (originalTool as any)(...args);
    });
    clearToolRegistry();
    registerTools(server);
  });

  async function callTool(name: string, args: any) {
    return toolHandlers.get(name)!(toolSchemas.get(name)!.parse(args), { meta: {} });
  }

  function mockBatch(results: any[]) {
    mockSendCommand.mockImplementation((command: string) =>
      command === "batch_actions"
        ? Promise.resolve({
            success: results.every((r) => r.success),
            totalActions: results.length,
            succeeded: results.filter((r) => r.success).length,
            failed: results.filter((r) => !r.success).length,
            results,
          })
        : Promise.resolve({}),
    );
  }

  it("reports every action's id without return_state", async () => {
    mockBatch([
      { index: 0, action: "create_frame", success: true, result: { id: "10:1", name: "Card", type: "FRAME" } },
      { index: 1, action: "rename_node", success: true, result: { id: "10:1", name: "Renamed" } },
    ]);

    const response: any = await callTool("batch_actions", {
      actions: [
        { action: "create_frame", params: { x: 0, y: 0, width: 10, height: 10 } },
        { action: "rename_node", params: { nodeId: "10:1", name: "Renamed" } },
      ],
    });

    const text = response.content[0].text as string;
    expect(text).toContain("Batch completed: 2/2 succeeded");
    expect(text).toContain("| 0 | create_frame | OK | id=10:1 name=Card type=FRAME |");
    expect(text).toContain("| 1 | rename_node | OK | id=10:1 name=Renamed |");
    expect(response.isError).toBe(false);
  });

  it("surfaces the natural return value of read-style actions", async () => {
    mockBatch([{ index: 0, action: "measure_node", success: true, result: { x: 12, y: 4, width: 100, height: 40 } }]);

    const response: any = await callTool("batch_actions", {
      actions: [{ action: "measure_node", params: { nodeId: "10:1" } }],
    });

    expect(response.content[0].text).toContain('| 0 | measure_node | OK | {"x":12,"y":4,"width":100,"height":40} |');
  });

  it("reports per-action errors alongside successes", async () => {
    mockBatch([
      { index: 0, action: "create_frame", success: true, result: { id: "10:1" } },
      { index: 1, action: "rename_node", success: false, error: "Node not found: 9:9" },
    ]);

    const response: any = await callTool("batch_actions", {
      actions: [
        { action: "create_frame", params: { x: 0, y: 0, width: 10, height: 10 } },
        { action: "rename_node", params: { nodeId: "9:9", name: "Nope" } },
      ],
    });

    const text = response.content[0].text as string;
    expect(text).toContain("| 0 | create_frame | OK | id=10:1 |");
    expect(text).toContain("| 1 | rename_node | FAIL | Node not found: 9:9 |");
    expect(text).toContain("First failure: action #1");
    expect(response.isError).toBe(true);
  });
});

describe("summarizeActionResult", () => {
  it("prefers identity keys", () => {
    expect(summarizeActionResult({ id: "1:2", name: "A", type: "TEXT", fills: [] })).toBe("id=1:2 name=A type=TEXT");
  });

  it("falls back to compact JSON and truncates", () => {
    const long = { note: "x".repeat(400) };
    const out = summarizeActionResult(long);
    expect(out.length).toBeLessThanOrEqual(DIGEST_MAX_LENGTH);
    expect(out.endsWith("…")).toBe(true);
  });

  it("renders empty and primitive results", () => {
    expect(summarizeActionResult(undefined)).toBe("ok");
    expect(summarizeActionResult({})).toBe("ok");
    expect(summarizeActionResult("done")).toBe("done");
    expect(summarizeActionResult([1, 2, 3])).toBe("[3] 1");
  });
});
