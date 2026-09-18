import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerTextTools } from "../../src/videntia_figma_mcp/tools/text-tools";
import { ALLOWED_COMMANDS } from "../../src/videntia_figma_plugin/ui/constants";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("set_text_align MCP tool (#29)", () => {
  let mockSendCommand: jest.Mock;
  let handlers: Map<string, Function>;
  let schemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    const server = new McpServer({ name: "test", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();
    mockSendCommand.mockResolvedValue({
      success: true,
      updated: 1,
      failed: 0,
      results: [
        { nodeId: "1:1", name: "Label", success: true, textAlignHorizontal: "CENTER", textAlignVertical: "TOP" },
      ],
    });
    handlers = new Map();
    schemas = new Map();
    const original = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        handlers.set(args[0], args[3]);
        schemas.set(args[0], z.object(args[2]));
      }
      return (original as any)(...args);
    });
    registerTextTools(server);
  });

  async function callTool(name: string, args: any) {
    return await handlers.get(name)!(schemas.get(name)!.parse(args), { meta: {} });
  }

  it("is registered by registerTextTools", () => {
    expect(handlers.has("set_text_align")).toBe(true);
  });

  it("is present in the plugin ALLOWED_COMMANDS allowlist", () => {
    expect(ALLOWED_COMMANDS).toContain("set_text_align");
  });

  it("forwards the resolved alignment to the plugin", async () => {
    const response = await callTool("set_text_align", { nodeId: "1:1", horizontal: "CENTER" });
    expect(mockSendCommand).toHaveBeenCalledWith(
      "set_text_align",
      expect.objectContaining({ nodeId: "1:1", textAlignHorizontal: "CENTER" }),
    );
    expect(response.content[0].text).toContain("Aligned 1 of 1 text node(s)");
  });

  it("resolves the `align` alias", async () => {
    await callTool("set_text_align", { nodeId: "1:1", align: "RIGHT" });
    expect(mockSendCommand.mock.calls[0][1].textAlignHorizontal).toBe("RIGHT");
  });

  it("errors without calling the plugin when no axis is given", async () => {
    const response = await callTool("set_text_align", { nodeId: "1:1" });
    expect(mockSendCommand).not.toHaveBeenCalled();
    expect(response.content[0].text).toContain("Error setting text alignment");
  });
});
