import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTextTools } from "../../src/videntia_figma_mcp/tools/text-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("set_text_range_style tool", () => {
  let mockSendCommand: jest.Mock;
  let handler: Function;
  let schema: z.ZodObject<any>;

  beforeAll(() => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args[0] === "set_text_range_style") {
        schema = z.object(args[2]);
        handler = args[3];
      }
      return (originalTool as any)(...args);
    });
    registerTextTools(server);
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
  });

  beforeEach(() => {
    mockSendCommand.mockReset();
  });

  async function callTool(args: unknown) {
    return handler(schema.parse(args), { meta: {} });
  }

  it("forwards normalized ranges to the plugin", async () => {
    mockSendCommand.mockResolvedValue({
      name: "Sentence",
      ranges: [{ start: 0, end: 5, characters: "Hello", applied: { fontName: { family: "Inter", style: "Bold" } } }],
    });

    const response = await callTool({
      nodeId: "1-2",
      ranges: [
        { start: "0", end: "5", fontWeight: "700", color: "#ff0000" },
        { start: 6, end: 11, colorVariable: "text/link", textDecoration: "UNDERLINE", lineHeight: "AUTO" },
        { start: 1, end: 2, color: { r: 1, g: 0, b: 0 }, letterSpacing: { value: 2, unit: "PERCENT" } },
      ],
    });

    expect(mockSendCommand).toHaveBeenCalledWith("set_text_range_style", {
      nodeId: "1:2",
      ranges: [
        { start: 0, end: 5, fontWeight: 700, color: "#ff0000" },
        { start: 6, end: 11, colorVariable: "text/link", textDecoration: "UNDERLINE", lineHeight: "AUTO" },
        { start: 1, end: 2, color: { r: 1, g: 0, b: 0 }, letterSpacing: { value: 2, unit: "PERCENT" } },
      ],
    });
    expect(response.content[0].text).toContain('Styled 1 range(s) in text node "Sentence"');
    expect(response.content[0].text).toContain('"style": "Bold"');
  });

  it("accepts ranges as a JSON string", async () => {
    mockSendCommand.mockResolvedValue({ name: "Sentence", ranges: [] });
    await callTool({ nodeId: "1:2", ranges: '[{"start":0,"end":3,"textStyle":"Body/Strong"}]' });
    expect(mockSendCommand).toHaveBeenCalledWith("set_text_range_style", {
      nodeId: "1:2",
      ranges: [{ start: 0, end: 3, textStyle: "Body/Strong" }],
    });
  });

  it.each([
    ["empty ranges", { nodeId: "1:2", ranges: [] }],
    ["negative start", { nodeId: "1:2", ranges: [{ start: -1, end: 3, color: "#000" }] }],
    ["unknown decoration", { nodeId: "1:2", ranges: [{ start: 0, end: 3, textDecoration: "OVERLINE" }] }],
    ["weight out of range", { nodeId: "1:2", ranges: [{ start: 0, end: 3, fontWeight: 950 }] }],
    ["bad line height unit", { nodeId: "1:2", ranges: [{ start: 0, end: 3, lineHeight: { value: 1, unit: "EM" } }] }],
  ])("rejects %s at the schema", async (_label, args) => {
    await expect(callTool(args)).rejects.toThrow();
    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  it("reports plugin errors", async () => {
    mockSendCommand.mockRejectedValue(new Error("ranges[0]: invalid range [0, 99)"));
    const response = await callTool({ nodeId: "1:2", ranges: [{ start: 0, end: 99, color: "#000" }] });
    expect(response.content[0].text).toBe("Error setting text range style: ranges[0]: invalid range [0, 99)");
  });
});
