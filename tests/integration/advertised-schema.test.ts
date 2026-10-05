import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../../src/videntia_figma_mcp/tools";
import { clearToolRegistry, getRegisteredTool } from "../../src/videntia_figma_mcp/utils/tool-registry";
import { resetToolIndex } from "../../src/videntia_figma_mcp/utils/tool-search";
import { TOOL_MODE_ENV_VAR } from "../../src/videntia_figma_mcp/utils/tool-modes";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(async () => ({ id: "1:1", name: "Frame" })),
  sendCommandToChannel: jest.fn(),
  connectToFigma: jest.fn(),
  joinChannel: jest.fn(),
  getOpenChannels: jest.fn(async () => []),
  getCurrentChannel: jest.fn(() => "test-channel"),
}));

/**
 * Alias spellings, the `id`/`node` salvage and `channel` on non-Figma tools are
 * accepted at runtime but left out of the advertised tools/list schema.
 */
describe("advertised tool schemas", () => {
  let client: Client;
  let tools: Map<string, any>;
  const send = () => require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma as jest.Mock;
  const original = process.env[TOOL_MODE_ENV_VAR];

  beforeAll(async () => {
    clearToolRegistry();
    resetToolIndex();
    process.env[TOOL_MODE_ENV_VAR] = "all";
    const server = new McpServer({ name: "t", version: "1" }, { capabilities: { tools: {} } });
    registerTools(server);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    client = new Client({ name: "c", version: "1" });
    await client.connect(b);
    tools = new Map((await client.listTools()).tools.map((t) => [t.name, t]));
  });
  afterAll(async () => {
    await client.close();
    if (original === undefined) delete process.env[TOOL_MODE_ENV_VAR];
    else process.env[TOOL_MODE_ENV_VAR] = original;
  });

  const props = (name: string) => Object.keys(tools.get(name).inputSchema.properties ?? {});

  it("does not advertise alias params or the id/node salvage", () => {
    expect(props("rename_node")).not.toContain("newName");
    expect(props("set_auto_layout")).not.toContain("allowSideEffects");
    expect(props("set_corner_radius")).toEqual(expect.arrayContaining(["nodeId"]));
    expect(props("set_corner_radius")).not.toContain("id");
    expect(props("set_corner_radius")).not.toContain("node");
  });

  it("advertises channel only on tools that reach Figma", () => {
    expect(props("set_fill_color")).toContain("channel");
    expect(props("figma_call")).toContain("channel");
    for (const name of ["calculate_contrast_ratio", "convert_color_format", "find_figma_tools", "browser_click"]) {
      expect(props(name)).not.toContain("channel");
    }
  });

  it("still accepts aliases and the salvaged id at runtime", async () => {
    send().mockClear();
    await client.callTool({ name: "rename_node", arguments: { nodeId: "1:1", newName: "X" } });
    expect(send().mock.calls[0][1]).toMatchObject({ nodeId: "1:1", name: "X" });
    send().mockClear();
    await client.callTool({ name: "set_corner_radius", arguments: { id: "1:1", radius: 4 } });
    expect(send().mock.calls[0][1]).toMatchObject({ nodeId: "1:1" });
  });

  it("strict tools still accept their aliases (standalone and via the registry schema used by batch)", async () => {
    expect(() =>
      getRegisteredTool("set_auto_layout")!.schema.parse({ nodeId: "1:1", allowSideEffects: true, channel: "c" }),
    ).not.toThrow();
    const res: any = await client.callTool({
      name: "set_auto_layout",
      arguments: { nodeId: "1:1", layoutMode: "VERTICAL", allowSideEffects: true },
    });
    expect(JSON.stringify(res.content)).not.toMatch(/Unrecognized key/);
  });

  it("strips channel on non-Figma tools instead of rejecting it", async () => {
    const res: any = await client.callTool({
      name: "calculate_contrast_ratio",
      arguments: { foreground: "#000", background: "#fff", channel: "abc" },
    });
    expect(res.isError).toBeFalsy();
    expect(JSON.stringify(res.content)).toMatch(/21/);
  });
});
