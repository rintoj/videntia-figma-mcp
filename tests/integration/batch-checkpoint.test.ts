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

describe("batch_actions undo checkpoint", () => {
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  const okResult = { success: true, totalActions: 1, succeeded: 1, failed: 0, results: [] };
  const actions = [{ action: "delete_node", params: { nodeId: "1:1" } }];

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

  it("commits an undo checkpoint before the batch by default", async () => {
    mockSendCommand.mockResolvedValue(okResult);
    await callTool("batch_actions", { actions });

    const commands = mockSendCommand.mock.calls.map((c) => c[0]);
    expect(commands[0]).toBe("commit_undo");
    expect(commands[1]).toBe("batch_actions");
  });

  it("skips the checkpoint when explicitly opted out", async () => {
    mockSendCommand.mockResolvedValue(okResult);
    await callTool("batch_actions", { actions, checkpoint: false });

    expect(mockSendCommand.mock.calls.map((c) => c[0])).toEqual(["batch_actions"]);
  });

  it("still runs the batch when the checkpoint itself fails", async () => {
    mockSendCommand.mockImplementation((command: string) =>
      command === "commit_undo" ? Promise.reject(new Error("nothing to commit")) : Promise.resolve(okResult),
    );
    const response: any = await callTool("batch_actions", { actions });

    expect(mockSendCommand.mock.calls.map((c) => c[0])).toEqual(["commit_undo", "batch_actions"]);
    expect(response.content[0].text).toContain("Batch completed");
  });
});
