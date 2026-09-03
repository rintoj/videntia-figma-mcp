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

  it("registers compare_figma_to_component tool", () => {
    const tools = (server as any)._registeredTools;
    expect(tools["compare_figma_to_component"]).toBeDefined();
  });

  it("exposes an optional browser_id on both browser-backed diff tools", () => {
    const tools = (server as any)._registeredTools;
    for (const name of ["diff_figma_to_browser", "diff_figma_frame_to_page"]) {
      const shape = tools[name].inputSchema.shape;
      expect(shape.browser_id).toBeDefined();
      expect(shape.browser_id.isOptional()).toBe(true);
    }
  });

  it("does not add browser_id to the sandpack-only comparison tool", () => {
    const tools = (server as any)._registeredTools;
    expect(tools["compare_figma_to_component"].inputSchema.shape.browser_id).toBeUndefined();
  });
});
