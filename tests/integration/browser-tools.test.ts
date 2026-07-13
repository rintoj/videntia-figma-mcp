import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBrowserTools } from "../../src/videntia_figma_mcp/tools/browser-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  sendCommandToChannel: jest.fn(),
  joinChannel: jest.fn(),
  getOpenChannels: jest.fn().mockResolvedValue([]),
}));

describe("overlay_figma_selection_in_browser tool", () => {
  let server: McpServer;
  let mockSendToFigma: jest.Mock;
  let mockSendToChannel: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });

    const ws = require("../../src/videntia_figma_mcp/utils/websocket");
    mockSendToFigma = ws.sendCommandToFigma;
    mockSendToChannel = ws.sendCommandToChannel;
    mockSendToFigma.mockClear();
    mockSendToChannel.mockClear();

    toolHandlers = new Map();
    toolSchemas = new Map();

    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, , schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });

    registerBrowserTools(server);
  });

  async function callTool(toolName: string, args: any = {}) {
    const schema = toolSchemas.get(toolName);
    const handler = toolHandlers.get(toolName);
    if (!schema || !handler) throw new Error(`Tool ${toolName} not found`);
    const validatedArgs = schema.parse(args);
    return await handler(validatedArgs, { meta: {} });
  }

  it("registers overlay_figma_selection_in_browser and clear_browser_overlay", () => {
    expect(toolHandlers.has("overlay_figma_selection_in_browser")).toBe(true);
    expect(toolHandlers.has("clear_browser_overlay")).toBe(true);
  });

  it("uses the exported node name in the status text", async () => {
    mockSendToFigma.mockResolvedValueOnce({
      imageData: "abc",
      mimeType: "image/png",
      originalWidth: 1440,
      originalHeight: 900,
      name: "Pricing / Desktop",
    });
    // First channel call: inject_figma_overlay → return ok; second: get_page_info.
    mockSendToChannel
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ url: "https://example.com/pricing", title: "Pricing" });

    const result = await callTool("overlay_figma_selection_in_browser", {});
    const text: string = result.content[0].text;

    expect(text).toContain('Overlay injected: "Pricing / Desktop"');
    expect(text).toContain("1440×900px");
  });

  it('falls back to "selection" when the export result has no name', async () => {
    // This guards the TS2339 regression: previously the code used
    // `exported.nodeId` which doesn't exist on the result type.
    mockSendToFigma.mockResolvedValueOnce({
      imageData: "abc",
      mimeType: "image/png",
      originalWidth: 800,
      originalHeight: 600,
      // no name
    });
    mockSendToChannel.mockResolvedValueOnce({}).mockResolvedValueOnce({ url: "https://example.com", title: "Example" });

    const result = await callTool("overlay_figma_selection_in_browser", {});
    const text: string = result.content[0].text;

    expect(text).toContain('Overlay injected: "selection"');
  });

  it("passes opacity, blend mode, and offsets through to the inject command", async () => {
    mockSendToFigma.mockResolvedValueOnce({
      imageData: "abc",
      mimeType: "image/png",
      originalWidth: 100,
      originalHeight: 100,
      name: "frame",
    });
    mockSendToChannel.mockResolvedValueOnce({}).mockResolvedValueOnce({ url: "https://example.com", title: "" });

    await callTool("overlay_figma_selection_in_browser", {
      opacity: 0.3,
      blendMode: true,
      offsetX: 12,
      offsetY: -4,
      cropTop: 20,
    });

    const injectCall = mockSendToChannel.mock.calls[0];
    expect(injectCall[0]).toBe("browser");
    expect(injectCall[1]).toBe("inject_figma_overlay");
    expect(injectCall[2]).toMatchObject({
      width: 100,
      height: 100,
      opacity: 0.3,
      blendMode: true,
      offsetX: 12,
      offsetY: -4,
      cropTop: 20,
    });
  });
});

describe("set_browser_viewport / reset_browser_viewport tools", () => {
  let server: McpServer;
  let mockSendToChannel: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    const ws = require("../../src/videntia_figma_mcp/utils/websocket");
    mockSendToChannel = ws.sendCommandToChannel;
    mockSendToChannel.mockClear();

    toolHandlers = new Map();
    toolSchemas = new Map();
    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, , schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });

    registerBrowserTools(server);
  });

  async function callTool(toolName: string, args: any = {}) {
    const schema = toolSchemas.get(toolName);
    const handler = toolHandlers.get(toolName);
    if (!schema || !handler) throw new Error(`Tool ${toolName} not found`);
    return await handler(schema.parse(args), { meta: {} });
  }

  it("registers both viewport tools", () => {
    expect(toolHandlers.has("set_browser_viewport")).toBe(true);
    expect(toolHandlers.has("reset_browser_viewport")).toBe(true);
  });

  it("sends set_viewport with camelCase params and reports CDP emulation", async () => {
    mockSendToChannel.mockResolvedValueOnce({ emulated: true, windowWidth: 500, windowHeight: 900, tabId: 42 });

    const result = await callTool("set_browser_viewport", {
      width: 390,
      height: 844,
      device_scale_factor: 3,
      tab_id: 42,
    });

    expect(mockSendToChannel).toHaveBeenCalledWith("browser", "set_viewport", {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      forceEmulation: false,
      tabId: 42,
    });
    const text = result.content[0].text;
    expect(text).toMatch(/emulated at 390×844 via CDP/);
    expect(text).toMatch(/resets on navigation/);
  });

  it("reports a plain window resize for desktop widths", async () => {
    mockSendToChannel.mockResolvedValueOnce({ emulated: false, windowWidth: 1440, windowHeight: 900, tabId: 7 });

    const result = await callTool("set_browser_viewport", { width: 1440, height: 900 });
    expect(result.content[0].text).toMatch(/Window resized to 1440×900/);
  });

  it("passes force_emulation through", async () => {
    mockSendToChannel.mockResolvedValueOnce({ emulated: true, windowWidth: 768, windowHeight: 1024, tabId: 7 });

    await callTool("set_browser_viewport", { width: 768, height: 1024, force_emulation: true });
    expect(mockSendToChannel.mock.calls[0][2]).toMatchObject({ forceEmulation: true });
  });

  it("rejects non-positive dimensions at the schema layer", async () => {
    await expect(callTool("set_browser_viewport", { width: 0, height: 844 })).rejects.toThrow();
  });

  it("reset_browser_viewport sends reset_viewport", async () => {
    mockSendToChannel.mockResolvedValueOnce({ success: true, tabId: 42 });

    const result = await callTool("reset_browser_viewport", { tab_id: 42 });
    expect(mockSendToChannel).toHaveBeenCalledWith("browser", "reset_viewport", { tabId: 42 });
    expect(result.content[0].text).toMatch(/cleared/);
  });
});
