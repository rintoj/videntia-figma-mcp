import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocumentTools } from "../../src/videntia_figma_mcp/tools/document-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket.js", () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
  getOpenChannels: jest.fn(),
}));

const ws = require("../../src/videntia_figma_mcp/utils/websocket.js");

describe("figma_connect", () => {
  let handlers: Map<string, Function>;
  let schemas: Map<string, z.ZodObject<any>>;
  let descriptions: Map<string, string>;

  beforeEach(() => {
    const server = new McpServer({ name: "t", version: "1.0.0" }, { capabilities: { tools: {} } });
    ws.joinChannel.mockClear();
    ws.getOpenChannels.mockClear();
    ws.joinChannel.mockResolvedValue(undefined);

    handlers = new Map();
    schemas = new Map();
    descriptions = new Map();
    const original = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        handlers.set(args[0], args[3]);
        schemas.set(args[0], z.object(args[2]));
        descriptions.set(args[0], args[1]);
      }
      return (original as any)(...args);
    });
    registerDocumentTools(server);
  });

  async function call(args: any = {}) {
    const res: any = await handlers.get("figma_connect")!(schemas.get("figma_connect")!.parse(args), { meta: {} });
    return res.content[0].text as string;
  }

  it("is registered and points agents at itself first", () => {
    expect(handlers.has("figma_connect")).toBe(true);
    const d = descriptions.get("figma_connect")!;
    expect(d).toMatch(/START HERE/);
    expect(d).toMatch(/ALWAYS PREFER this over calling get_open_channels and then join_channel/);
  });

  it("auto-joins when exactly one live channel exists", async () => {
    ws.getOpenChannels.mockResolvedValue([{ channel: "abc", fileName: "Design", hasPlugin: true }]);
    const text = await call();
    expect(ws.joinChannel).toHaveBeenCalledWith("abc");
    expect(text).toContain("Connected to Figma channel: abc (Design)");
  });

  it("ignores the browser channel and stale plugin-less channels", async () => {
    ws.getOpenChannels.mockResolvedValue([
      { channel: "browser", hasExtension: true },
      { channel: "stale", fileName: "Old", hasPlugin: false },
      { channel: "live", fileName: "New", hasPlugin: true },
    ]);
    const text = await call();
    expect(ws.joinChannel).toHaveBeenCalledWith("live");
    expect(text).toContain("live (New)");
  });

  it("lists and asks when several channels are live", async () => {
    ws.getOpenChannels.mockResolvedValue([
      { channel: "a", fileName: "One", hasPlugin: true },
      { channel: "b", fileName: "Two", hasPlugin: true },
    ]);
    const text = await call();
    expect(ws.joinChannel).not.toHaveBeenCalled();
    expect(text).toContain("2 live Figma channels");
    expect(text).toContain("a (One)");
    expect(text).toContain("b (Two)");
  });

  it("explains how to fix a dead connection", async () => {
    ws.getOpenChannels.mockResolvedValue([]);
    const text = await call();
    expect(text).toContain("No live Figma channels found");
    expect(text).toContain("Claude MCP Plugin");
  });

  it("joins an explicit channelId without discovery", async () => {
    const text = await call({ channelId: "given" });
    expect(ws.getOpenChannels).not.toHaveBeenCalled();
    expect(ws.joinChannel).toHaveBeenCalledWith("given");
    expect(text).toContain("Connected to Figma channel: given");
  });

  it("reports connection errors with troubleshooting", async () => {
    ws.getOpenChannels.mockRejectedValue(new Error("socket down"));
    const text = await call();
    expect(text).toContain("Error connecting to Figma: socket down");
  });
});
