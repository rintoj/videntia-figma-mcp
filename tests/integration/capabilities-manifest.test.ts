import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCapabilityTools } from "../../src/videntia_figma_mcp/tools/capability-tools";
import { readFileSync } from "fs";
import { join } from "path";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  getCurrentChannel: jest.fn(() => "test-channel"),
}));

describe("get_capabilities (#45)", () => {
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

    registerCapabilityTools(server);
  });

  async function callTool(name: string, args: any = {}) {
    const schema = toolSchemas.get(name);
    const handler = toolHandlers.get(name);
    if (!schema || !handler) throw new Error(`Tool ${name} not found`);
    return await handler(Object.keys(args).length > 0 ? schema.parse(args) : {}, { meta: {} });
  }

  it("is wired into the global tool registrar (MCP registrar only - no plugin roundtrip)", () => {
    // tools/index.ts pulls in ESM-only deps, so assert on its source instead of
    // importing it here.
    const index = readFileSync(join(__dirname, "../../src/videntia_figma_mcp/tools/index.ts"), "utf8");
    expect(index).toContain('import { registerCapabilityTools } from "./capability-tools.js"');
    expect(index).toMatch(/registerCapabilityTools\(server\);/);

    // Pure server-side: no FigmaCommand / ALLOWED_COMMANDS / plugin switch entry.
    const types = readFileSync(join(__dirname, "../../src/videntia_figma_mcp/types/index.ts"), "utf8");
    expect(types).not.toContain('"get_capabilities"');
  });

  it("derives the tool list from the live registry rather than a hardcoded list", async () => {
    // A tool registered after get_capabilities must still show up.
    server.tool("zz_probe_tool", "probe", {}, async () => ({ content: [] }) as any);
    mockSendCommand.mockResolvedValue({ strict: true, returnState: false });

    const res = await callTool("get_capabilities");
    const text = res.content[0].text as string;
    expect(text).toContain("zz_probe_tool");
    expect(text).toContain("get_capabilities");
    expect(text).toMatch(/Registered tools \(\d+, derived from the live registry\)/);
  });

  it("reflects LIVE session modes - flipping strict mode changes the manifest", async () => {
    mockSendCommand.mockResolvedValue({ strict: true, returnState: false });
    const on = (await callTool("get_capabilities")).content[0].text as string;
    expect(on).toContain("strict mode: true");
    expect(on).toContain("return_state default: false");

    mockSendCommand.mockResolvedValue({ strict: false, returnState: true });
    const off = (await callTool("get_capabilities")).content[0].text as string;
    expect(off).toContain("strict mode: false");
    expect(off).toContain("return_state default: true");
    expect(off).not.toEqual(on);
  });

  it("reads modes read-only: set_strict_mode is called with no arguments", async () => {
    mockSendCommand.mockResolvedValue({ strict: true, returnState: false });
    await callTool("get_capabilities");
    expect(mockSendCommand).toHaveBeenCalledWith("set_strict_mode", {});
  });

  it("degrades to unknown (never guesses) when the plugin is unreachable", async () => {
    mockSendCommand.mockRejectedValue(new Error("not connected"));
    const text = (await callTool("get_capabilities")).content[0].text as string;
    expect(text).toContain("strict mode: unknown");
    expect(text).toContain("Figma plugin connected: no");
    expect(text).toContain("DEFAULTS ON");
  });

  it("states the gradient/variable platform limit and the capabilities agents assume are missing", async () => {
    mockSendCommand.mockResolvedValue({ strict: true, returnState: false });
    const text = (await callTool("get_capabilities")).content[0].text as string;
    // Contract change (bug #16): gradient STOPS gained author-time variable binding via
    // set_gradient_fill's per-stop `colorVariable`, so the manifest no longer claims they
    // cannot be bound - only that an EXISTING gradient paint cannot be bound after the fact.
    expect(text).toMatch(/cannot bind a GRADIENT paint/i);
    expect(text).toMatch(/gradient STOPS can be bound at author time/i);
    expect(text).toContain("export_node_as_image");
    expect(text).toContain("set_image_fill_from_path");
    expect(text).toContain("set_auto_layout");
    expect(text).toContain("create_effect_style");
    expect(text).toContain("bind_many");
    expect(text).toContain("batch_actions");
    // Preconditions
    expect(text).toMatch(/layoutMode != NONE/);
    expect(text).toMatch(/HUG sizing is invalid on a page-level/i);
    expect(text).toMatch(/SPACE_BETWEEN/);
  });

  it("can return a single section", async () => {
    mockSendCommand.mockResolvedValue({ strict: true, returnState: false });
    const text = (await callTool("get_capabilities", { section: "platformLimits" })).content[0].text as string;
    expect(text).toMatch(/cannot bind a GRADIENT paint/i);
    expect(text).not.toContain("Preconditions that silently discard");
    expect(text).not.toContain("Registered tools (");
  });
});
