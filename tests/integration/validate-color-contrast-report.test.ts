import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerVariableTools } from "../../src/videntia_figma_mcp/tools/variable-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

/** Bug #44: a 0-pair sweep must render as an actionable failure, not a pass. */
describe("validate_color_contrast reporting (#44)", () => {
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
        toolHandlers.set(args[0], args[3]);
        toolSchemas.set(args[0], z.object(args[2]));
      } else if (args.length === 3) {
        toolHandlers.set(args[0], args[2]);
        toolSchemas.set(args[0], z.object({}));
      }
      return (originalTool as any)(...args);
    });
    registerVariableTools(server);
  });

  async function callTool(name: string, args: any = {}) {
    const schema = toolSchemas.get(name)!;
    const handler = toolHandlers.get(name)!;
    return await handler(Object.keys(args).length > 0 ? schema.parse(args) : {}, { meta: {} });
  }

  it("renders a 0-pair result as NO PAIRS FOUND with what was searched and why", async () => {
    mockSendCommand.mockResolvedValue({
      totalPairs: 0,
      passed: 0,
      failed: 0,
      pairs: [],
      noPairsFound: true,
      reason: 'None of the 12 COLOR variable(s) in mode "dark" name a foreground or a background role.',
      sampleVariableNames: ["brand/500", "brand/600"],
      searched: {
        collectionId: "col-1",
        collectionName: "Theme",
        mode: "dark",
        totalVariables: 14,
        colorVariables: 12,
        resolvedColorVariables: 12,
        unresolvableColorVariables: 0,
        foregroundCandidates: 0,
        backgroundCandidates: 0,
        strategiesTried: ["sibling-suffix", "role-group", "cross-product"],
        strategiesUsed: [],
      },
    });

    const text = (await callTool("validate_color_contrast", { collectionId: "Theme" })).content[0].text as string;

    expect(text).toContain("NO PAIRS FOUND");
    expect(text).toContain("This is NOT a pass");
    expect(text).toContain("Theme");
    expect(text).toContain("Mode: dark");
    expect(text).toContain("COLOR variables: 12");
    expect(text).toContain("sibling-suffix");
    expect(text).toContain("brand/500");
    expect(text).toContain("contrast_check_frame");
    expect(text).not.toMatch(/0\/0 pairs pass/);
  });

  it("renders found pairs with the strategies used", async () => {
    mockSendCommand.mockResolvedValue({
      totalPairs: 1,
      passed: 1,
      failed: 0,
      pairs: [{ foreground: "text/primary", background: "surface/primary", ratio: 21, pass: true }],
      searched: { collectionName: "Theme", mode: "dark", colorVariables: 12, strategiesUsed: ["role-group"] },
    });

    const text = (await callTool("validate_color_contrast", { collectionId: "Theme" })).content[0].text as string;
    expect(text).toContain("1/1 pairs pass");
    expect(text).toContain("role-group");
    expect(text).toContain("| text/primary | surface/primary | 21.00:1 | Yes |");
  });
});
