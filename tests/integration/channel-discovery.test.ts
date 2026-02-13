import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDocumentTools } from '../../src/claude_figma_mcp/tools/document-tools';

jest.mock('../../src/claude_figma_mcp/utils/websocket', () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn()
}));

const originalFetch = global.fetch;

describe("list_channels", () => {
  let server: McpServer;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    toolHandlers = new Map();
    toolSchemas = new Map();

    const originalTool = server.tool.bind(server);
    jest.spyOn(server, 'tool').mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, _description, schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });

    registerDocumentTools(server);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function callTool(toolName: string, args: any = {}) {
    const schema = toolSchemas.get(toolName);
    const handler = toolHandlers.get(toolName);
    if (!schema || !handler) {
      throw new Error(`Tool ${toolName} not found`);
    }
    const validatedArgs = schema.parse(args);
    return await handler(validatedArgs, { meta: {} });
  }

  const jsonHeaders = { get: (key: string) => key === "content-type" ? "application/json" : null };

  it("returns active channels with file names", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: jsonHeaders,
      json: async () => ({
        channels: [
          { name: "abc12345", clientCount: 2, fileNames: ["MyDesign.fig"] },
          { name: "xyz98765", clientCount: 1, fileNames: ["Landing Page"] },
        ],
      }),
    });

    const response = await callTool("list_channels");
    const text = response.content[0].text;

    expect(text).toContain("Active channels:");
    expect(text).toContain("abc12345");
    expect(text).toContain("MyDesign.fig");
    expect(text).toContain("2 clients");
    expect(text).toContain("xyz98765");
    expect(text).toContain("Landing Page");
    expect(text).toContain("1 client");
  });

  it("returns message when no channels are active", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: jsonHeaders,
      json: async () => ({ channels: [] }),
    });

    const response = await callTool("list_channels");
    const text = response.content[0].text;

    expect(text).toContain("No active channels found");
  });

  it("handles HTTP errors", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const response = await callTool("list_channels");
    const text = response.content[0].text;

    expect(text).toContain("Error fetching channels");
    expect(text).toContain("500");
  });

  it("handles network errors (server not running)", async () => {
    global.fetch = jest.fn().mockRejectedValue(
      new Error("fetch failed: ECONNREFUSED")
    );

    const response = await callTool("list_channels");
    const text = response.content[0].text;

    expect(text).toContain("Cannot connect to WebSocket server");
  });

  it("handles outdated server without /channels endpoint", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => "text/plain" },
    });

    const response = await callTool("list_channels");
    const text = response.content[0].text;

    expect(text).toContain("does not support channel discovery");
    expect(text).toContain("rebuild and restart");
  });

  it("handles channels with no file names", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: jsonHeaders,
      json: async () => ({
        channels: [
          { name: "test1234", clientCount: 1, fileNames: [] },
        ],
      }),
    });

    const response = await callTool("list_channels");
    const text = response.content[0].text;

    expect(text).toContain("test1234");
    expect(text).toContain("Unknown file");
  });
});
