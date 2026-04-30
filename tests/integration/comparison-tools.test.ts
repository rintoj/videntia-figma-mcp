import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerComparisonTools } from "../../src/videntia_figma_mcp/tools/comparison-tools.js";

jest.mock("../../src/videntia_figma_mcp/utils/websocket.js", () => ({
  sendCommandToFigma: jest.fn().mockResolvedValue({
    imageData: "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==",
    format: "PNG",
    nodeId: "1:1",
  }),
}));

describe("comparison tools registration", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerComparisonTools(server);
  });

  it("registers start_compare_figma_to_web tool", () => {
    const tools = (server as any)._registeredTools;
    expect(tools["start_compare_figma_to_web"]).toBeDefined();
  });

  it("registers plan_figma_comparison tool", () => {
    const tools = (server as any)._registeredTools;
    expect(tools["plan_figma_comparison"]).toBeDefined();
  });

  it("registers compare_figma_to_component tool", () => {
    const tools = (server as any)._registeredTools;
    expect(tools["compare_figma_to_component"]).toBeDefined();
  });
});
