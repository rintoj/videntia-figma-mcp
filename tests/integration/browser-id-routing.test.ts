import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBrowserControlTools } from "../../src/videntia_figma_mcp/tools/browser-control-tools";
import { registerBrowserTools } from "../../src/videntia_figma_mcp/tools/browser-tools";
import { registerComparisonTools } from "../../src/videntia_figma_mcp/tools/comparison-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  sendCommandToChannel: jest.fn(),
  joinChannel: jest.fn(),
  getOpenChannels: jest.fn(),
}));

const BROWSER_TOOLS_WITHOUT_BROWSER_ID = new Set(["list_connected_browsers", "compare_figma_to_component"]);

describe("browser_id routing", () => {
  let server: McpServer;
  let mockSendToChannel: jest.Mock;
  let mockGetOpenChannels: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, Record<string, z.ZodTypeAny>>;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" }, { capabilities: { tools: {} } });
    const ws = require("../../src/videntia_figma_mcp/utils/websocket");
    mockSendToChannel = ws.sendCommandToChannel;
    mockGetOpenChannels = ws.getOpenChannels;
    mockSendToChannel.mockReset();
    mockGetOpenChannels.mockReset();
    mockSendToChannel.mockResolvedValue({ ok: true });

    toolHandlers = new Map();
    toolSchemas = new Map();
    const original = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, , schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, schema);
      }
      return (original as any)(...args);
    });

    registerBrowserControlTools(server);
    registerBrowserTools(server);
    registerComparisonTools(server);
  });

  async function callTool(name: string, args: any = {}) {
    const schema = toolSchemas.get(name);
    const handler = toolHandlers.get(name);
    if (!schema || !handler) throw new Error(`Tool ${name} not found`);
    return await handler(z.object(schema).parse(args), { meta: {} });
  }

  function parsePayload(result: any) {
    return JSON.parse(result.content[0].text);
  }

  it("every registered browser tool accepts an optional browser_id", () => {
    const checked: string[] = [];
    for (const [name, schema] of toolSchemas) {
      if (BROWSER_TOOLS_WITHOUT_BROWSER_ID.has(name)) continue;
      expect(Object.keys(schema)).toContain("browser_id");
      // Always optional — never required on any tool.
      expect(z.object(schema).safeParse(baseArgsFor(name)).success).toBe(true);
      checked.push(name);
    }
    // Guard against the enumeration silently going empty.
    expect(checked.length).toBeGreaterThanOrEqual(35);
  });

  function baseArgsFor(name: string): Record<string, unknown> {
    const required: Record<string, Record<string, unknown>> = {
      browser_type: { text: "hi" },
      browser_press_key: { key: "Enter" },
      browser_scroll: { delta_y: 100 },
      browser_navigate: { url: "https://example.com" },
      browser_close_tab: { tab_id: 3 },
      browser_evaluate_js: { expression: "1+1" },
      browser_fulfill_request: { request_id: "r1" },
      browser_fail_request: { request_id: "r1" },
      browser_continue_request: { request_id: "r1" },
      browser_clear_storage: { origin: "https://example.com" },
      get_browser_computed_styles: { selector: "h1" },
      set_browser_viewport: { width: 390, height: 844 },
      diff_figma_to_browser: { figma_node_id: "1:2" },
      diff_figma_frame_to_page: { frame_node_id: "1:2" },
    };
    return required[name] ?? {};
  }

  it("passes browser_id to the transport as the routing target", async () => {
    await callTool("browser_click", { selector: "#go", browser_id: "browser-abc" });
    const [channel, command, params] = mockSendToChannel.mock.calls[0];
    expect(channel).toBe("browser");
    expect(command).toBe("click");
    expect(params.browserId).toBe("browser-abc");
  });

  it("omits browserId when browser_id is not passed", async () => {
    await callTool("browser_click", { selector: "#go" });
    const [, , params] = mockSendToChannel.mock.calls[0];
    expect(params.browserId).toBeUndefined();
  });

  it("threads browser_id through tab-less tools too", async () => {
    await callTool("browser_list_tabs", { browser_id: "browser-2" });
    await callTool("browser_close_group", { browser_id: "browser-2" });
    for (const call of mockSendToChannel.mock.calls) {
      expect(call[2].browserId).toBe("browser-2");
    }
  });

  it("surfaces the relay ambiguity error verbatim", async () => {
    const message = "Multiple browsers are connected: browser-a, browser-b. Pass browser_id to target one.";
    mockSendToChannel.mockRejectedValueOnce(new Error(message));
    await expect(callTool("browser_click", { selector: "#go" })).rejects.toThrow(message);
  });

  it("surfaces the relay unknown-target error verbatim", async () => {
    const message = 'No browser with id "stale" is connected. Connected: browser-a';
    mockSendToChannel.mockRejectedValueOnce(new Error(message));
    await expect(callTool("browser_hover", { selector: "#go", browser_id: "stale" })).rejects.toThrow(message);
  });

  describe("list_connected_browsers", () => {
    it("lists both connected browsers and hints to target one", async () => {
      mockGetOpenChannels.mockResolvedValue([
        { channel: "figma-file", clients: 1 },
        {
          channel: "browser",
          clients: 2,
          browsers: [
            { id: "browser-a", label: "Chrome-browse", joinedAt: 1 },
            { id: "browser-b", label: "Work", joinedAt: 2 },
          ],
        },
      ]);
      const payload = parsePayload(await callTool("list_connected_browsers"));
      expect(payload.count).toBe(2);
      expect(payload.browsers.map((b: any) => b.id)).toEqual(["browser-a", "browser-b"]);
      expect(payload.hint).toContain("browser_id");
    });

    it("returns an empty list with a hint when none are connected", async () => {
      mockGetOpenChannels.mockResolvedValue([]);
      const payload = parsePayload(await callTool("list_connected_browsers"));
      expect(payload.browsers).toEqual([]);
      expect(payload.count).toBe(0);
      expect(payload.hint).toContain("extension");
    });

    it("returns a hint instead of throwing when /channels is unreachable", async () => {
      mockGetOpenChannels.mockRejectedValue(new Error("Timed out fetching channels"));
      const payload = parsePayload(await callTool("list_connected_browsers"));
      expect(payload.browsers).toEqual([]);
      expect(payload.hint).toContain("Timed out fetching channels");
    });
  });
});
