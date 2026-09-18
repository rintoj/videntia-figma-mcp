import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerModificationTools } from "../../src/videntia_figma_mcp/tools/modification-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("set_visible tool integration", () => {
  let mockSendCommand: jest.Mock;
  let toolHandler: Function;
  let toolSchema: z.ZodObject<any>;
  let toolDescription: string;

  beforeEach(() => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockReset();

    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args[0] === "set_visible") {
        toolDescription = args[1];
        toolSchema = z.object(args[2]);
        toolHandler = args[3];
      }
      return (originalTool as any)(...args);
    });
    registerModificationTools(server);
  });

  async function call(args: Record<string, unknown>) {
    return toolHandler(toolSchema.parse(args), { meta: {} });
  }

  it("hides a single node and returns per-node results", async () => {
    const payload = { visible: false, updated: 1, failed: 0, results: [{ id: "1:2", name: "Icon", visible: false }] };
    mockSendCommand.mockResolvedValue(payload);
    const response = await call({ nodeId: "1-2", visible: false });
    expect(mockSendCommand).toHaveBeenCalledWith("set_visible", { nodeId: "1:2", visible: false });
    expect(JSON.parse(response.content[0].text)).toEqual(payload);
  });

  it("coerces string booleans and array strings for multiple nodes", async () => {
    mockSendCommand.mockResolvedValue({ visible: true, updated: 2, failed: 0, results: [] });
    await call({ nodeIds: '["1-2","3-4"]', visible: "true" });
    expect(mockSendCommand).toHaveBeenCalledWith("set_visible", { nodeIds: ["1:2", "3:4"], visible: true });
  });

  it("rejects an invalid visible value at the schema", () => {
    expect(() => toolSchema.parse({ nodeId: "1:2", visible: "maybe" })).toThrow();
  });

  it("returns an error without calling Figma when no node is given", async () => {
    const response = await call({ visible: false });
    expect(mockSendCommand).not.toHaveBeenCalled();
    expect(response.content[0].text).toContain("set_visible requires nodeId or nodeIds");
  });

  it("reports plugin errors", async () => {
    mockSendCommand.mockRejectedValue(new Error("Node not found with ID: 9:9"));
    const response = await call({ nodeId: "9:9", visible: true });
    expect(response.content[0].text).toBe("Error setting visibility: Node not found with ID: 9:9");
  });

  it("points instance toggles at component properties", () => {
    expect(toolDescription).toContain("INSTANCE");
    expect(toolDescription).toContain("set_component_property_references");
  });
});
