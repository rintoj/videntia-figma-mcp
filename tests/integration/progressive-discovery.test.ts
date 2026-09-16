import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools, getActiveToolModeLabel } from "../../src/videntia_figma_mcp/tools";
import {
  clearToolRegistry,
  getRegisteredTool,
  isSdkRegistered,
  listDeferredToolNames,
  listRegistryEntries,
} from "../../src/videntia_figma_mcp/utils/tool-registry";
import { listRegisteredToolNames } from "../../src/videntia_figma_mcp/tools/capability-tools";
import {
  ENTRY_SURFACE_TOOLS,
  TOOL_MODE_ENV_VAR,
  resolveToolMode,
  TOOL_CATEGORIES,
} from "../../src/videntia_figma_mcp/utils/tool-modes";
import { searchTools, resetToolIndex } from "../../src/videntia_figma_mcp/utils/tool-search";
import { TOOL_SYNONYMS } from "../../src/videntia_figma_mcp/utils/tool-taxonomy";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => {
  const { createCaptureAwareSend } = require("../helpers/capture-aware-websocket");
  return {
    sendCommandToFigma: createCaptureAwareSend(),
    sendCommandToChannel: jest.fn(),
    connectToFigma: jest.fn(),
    joinChannel: jest.fn(),
    getOpenChannels: jest.fn(async () => []),
    getCurrentChannel: jest.fn(() => "test-channel"),
  };
});

const originalEnv = process.env[TOOL_MODE_ENV_VAR];

/** Build a fresh server in the given mode and return it. */
function build(mode?: string): McpServer {
  clearToolRegistry();
  resetToolIndex();
  if (mode === undefined) delete process.env[TOOL_MODE_ENV_VAR];
  else process.env[TOOL_MODE_ENV_VAR] = mode;
  const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
  registerTools(server);
  return server;
}

const call = async (tool: string, args: any) => {
  const entry = getRegisteredTool(tool)!;
  return (await entry.handler(entry.schema.parse(args) as Record<string, unknown>, { meta: {} })) as any;
};
const text = (res: any) => res.content.map((c: any) => c.text).join("\n");

afterAll(() => {
  if (originalEnv === undefined) delete process.env[TOOL_MODE_ENV_VAR];
  else process.env[TOOL_MODE_ENV_VAR] = originalEnv;
});

describe("mode resolution", () => {
  it("defaults to progressive when the env var is unset or empty", () => {
    expect(resolveToolMode(undefined).mode).toEqual({ kind: "progressive" });
    expect(resolveToolMode("  ").mode).toEqual({ kind: "progressive" });
  });

  it("accepts all / progressive / a category list, with aliases", () => {
    expect(resolveToolMode("all").mode).toEqual({ kind: "all" });
    expect(resolveToolMode("progressive").mode).toEqual({ kind: "progressive" });
    expect(resolveToolMode("text,tokens").mode).toEqual({ kind: "categories", categories: ["text", "variable"] });
  });

  it("falls back to all with a warning on an invalid value, never throwing", () => {
    const resolved = resolveToolMode("nonsense-category");
    expect(resolved.mode).toEqual({ kind: "all" });
    expect(resolved.warning).toContain("Falling back");
  });
});

describe("progressive mode (default)", () => {
  let server: McpServer;
  beforeAll(() => {
    server = build(undefined);
  });

  it("is the default mode", () => {
    expect(getActiveToolModeLabel()).toBe("progressive");
  });

  it("registers every entry-surface tool with the SDK", () => {
    const advertised = listRegisteredToolNames(server);
    for (const name of ENTRY_SURFACE_TOOLS) {
      expect(advertised).toContain(name);
    }
    expect(advertised.length).toBe(ENTRY_SURFACE_TOOLS.length);
  });

  it("does NOT advertise a non-entry tool, but keeps it fully in the registry", () => {
    expect(listRegisteredToolNames(server)).not.toContain("set_corner_radius");
    expect(isSdkRegistered("set_corner_radius")).toBe(false);
    expect(getRegisteredTool("set_corner_radius")).toBeDefined();
    expect(listDeferredToolNames()).toContain("set_corner_radius");
  });

  it("hides the large majority of the surface", () => {
    expect(listRegistryEntries().length).toBeGreaterThan(200);
    expect(listDeferredToolNames().length).toBeGreaterThan(200);
  });
});

describe("VIDENTIA_FIGMA_TOOLS=all (back-compat)", () => {
  it("advertises every registered tool", () => {
    const server = build("all");
    expect(listDeferredToolNames()).toEqual([]);
    expect(listRegisteredToolNames(server).length).toBe(listRegistryEntries().length);
    expect(listRegistryEntries().length).toBeGreaterThan(200);
  });

  it("an invalid env value behaves exactly like all", () => {
    const server = build("wat,nope");
    expect(listDeferredToolNames()).toEqual([]);
    expect(listRegisteredToolNames(server).length).toBe(listRegistryEntries().length);
  });
});

describe("category mode", () => {
  it("advertises exactly the requested category plus the entry surface", () => {
    const server = build("text");
    const advertised = new Set(listRegisteredToolNames(server));
    const textTools = listRegistryEntries().filter((e) => e.category === "text");
    expect(textTools.length).toBeGreaterThan(3);
    for (const t of textTools) expect(advertised.has(t.name)).toBe(true);
    for (const name of ENTRY_SURFACE_TOOLS) expect(advertised.has(name)).toBe(true);
    for (const entry of listRegistryEntries()) {
      if (entry.category === "text" || ENTRY_SURFACE_TOOLS.includes(entry.name)) continue;
      expect(advertised.has(entry.name)).toBe(false);
    }
  });
});

describe("find_figma_tools", () => {
  beforeAll(() => build(undefined));

  const cases: [string, string][] = [
    ["center text", "set_text_align"],
    ["set a shadow", "set_effects"],
    ["create a design token", "create_variable"],
    ["export a screenshot", "export_node_as_image"],
    ["check contrast", "validate_color_contrast"],
    ["rename a layer", "rename_node"],
    ["auto layout padding", "set_padding"],
  ];

  it.each(cases)("finds a relevant tool for %p", async (query, expected) => {
    const res = await call("find_figma_tools", { query });
    expect(text(res)).toContain(expected);
  });

  it("stays cheap — a typical result is well under 2KB", async () => {
    for (const [query] of cases) {
      const bytes = Buffer.byteLength(text(await call("find_figma_tools", { query })), "utf8");
      expect(bytes).toBeLessThan(2048);
    }
  });

  it("returns names and one-liners, never full schemas", async () => {
    const body = text(await call("find_figma_tools", { query: "create a frame" }));
    expect(body).not.toContain('"type": "object"');
    expect(body).not.toContain("$schema");
  });

  it("honours the category filter", async () => {
    const hits = searchTools("color", { category: "variable" });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.category).toBe("variable");
  });

  it("tells the caller how to act immediately", async () => {
    const body = text(await call("find_figma_tools", { query: "set corner radius" }));
    expect(body).toContain("figma_call");
    expect(body).toContain("batch_actions");
  });
});

describe("describe_figma_tools", () => {
  let server: McpServer;
  beforeEach(() => {
    server = build(undefined);
  });

  it("returns a parseable JSON schema matching the registry entry", async () => {
    const body = text(await call("describe_figma_tools", { names: ["set_corner_radius"] }));
    const json = JSON.parse(body.slice(body.indexOf("```json") + 7, body.lastIndexOf("```")).trim());
    expect(json.type).toBe("object");
    const entry = getRegisteredTool("set_corner_radius")!;
    for (const key of Object.keys(entry.schema.shape)) {
      expect(Object.keys(json.properties)).toContain(key);
    }
  });

  it("promotes the described tool into the MCP tool list", async () => {
    expect(listRegisteredToolNames(server)).not.toContain("set_corner_radius");
    await call("describe_figma_tools", { names: ["set_corner_radius"] });
    expect(listRegisteredToolNames(server)).toContain("set_corner_radius");
    expect(isSdkRegistered("set_corner_radius")).toBe(true);
  });

  it("register:false describes without advertising", async () => {
    await call("describe_figma_tools", { names: ["set_padding"], register: false });
    expect(listRegisteredToolNames(server)).not.toContain("set_padding");
  });

  it("caps the number of names per call", () => {
    const entry = getRegisteredTool("describe_figma_tools")!;
    expect(() => entry.schema.parse({ names: new Array(13).fill("get_node_info") })).toThrow();
  });

  it("points an unknown name at discovery", async () => {
    const body = text(await call("describe_figma_tools", { names: ["set_drop_shadow"] }));
    expect(body).toContain("find_figma_tools");
  });
});

describe("load_figma_tools", () => {
  it("advertises without printing schemas", async () => {
    const server = build(undefined);
    const body = text(await call("load_figma_tools", { names: ["set_padding", "not_a_tool"] }));
    expect(listRegisteredToolNames(server)).toContain("set_padding");
    expect(body).not.toContain('"type": "object"');
    expect(body).toContain("not_a_tool");
  });
});

describe("figma_call", () => {
  let mockSend: jest.Mock;
  beforeEach(() => {
    build(undefined);
    mockSend = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSend.mockClear();
    mockSend.mockResolvedValue({ name: "N", id: "1:1", nodeName: "N" });
  });

  /** Wire payload parity: figma_call must produce byte-identical params to standalone. */
  const wireFor = async (fn: () => Promise<unknown>, command: string) => {
    mockSend.mockClear();
    await fn();
    const hit = mockSend.mock.calls.find((c) => c[0] === command);
    return hit ? hit[1] : undefined;
  };

  it.each([
    ["set_corner_radius", { nodeId: "1:1", radius: 8 }],
    ["rename_node", { nodeId: "1:1", name: "Card" }],
    ["set_padding", { nodeId: "1:1", top: 4, bottom: 4 }],
  ])("produces the same wire payload as calling %s standalone", async (tool, params) => {
    const standalone = await wireFor(() => call(tool, params), tool);
    const viaCall = await wireFor(() => call("figma_call", { tool, params }), tool);
    expect(viaCall).toEqual(standalone);
    expect(standalone).toBeDefined();
  });

  it("names the tool and the invalid params on a schema failure", async () => {
    const res = await call("figma_call", { tool: "set_corner_radius", params: { radius: "huge" } });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("set_corner_radius");
    expect(text(res)).toContain("huge");
    expect(text(res)).toContain("describe_figma_tools");
  });

  it("an unknown tool name points at describe_figma_tools, not 'unknown tool'", async () => {
    const res = await call("figma_call", { tool: "set_drop_shadow", params: {} });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("describe_figma_tools");
    expect(text(res)).toContain("find_figma_tools");
  });
});

describe("batch_actions stays the zero-registration route", () => {
  it("tells an agent to use discovery when the action name is wrong", async () => {
    build(undefined);
    const mockSend = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma as jest.Mock;
    mockSend.mockClear();
    mockSend.mockResolvedValue({ totalActions: 0, succeeded: 0, failed: 0, results: [] });
    const res = await call("batch_actions", { actions: [{ action: "set_drop_shadow", params: {} }] });
    expect(text(res)).toContain("find_figma_tools");
  });

  it("runs a hidden tool by name with no registration at all", async () => {
    build(undefined);
    const mockSend = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma as jest.Mock;
    mockSend.mockClear();
    mockSend.mockResolvedValue({ totalActions: 1, succeeded: 1, failed: 0, results: [] });
    expect(isSdkRegistered("set_corner_radius")).toBe(false);
    await call("batch_actions", { actions: [{ action: "set_corner_radius", params: { nodeId: "1:1", radius: 8 } }] });
    const dispatch = mockSend.mock.calls.find((c) => c[0] === "batch_actions")!;
    expect(dispatch[1].actions[0].action).toBe("set_corner_radius");
  });
});

describe("the index cannot rot", () => {
  beforeAll(() => build("all"));

  it("every synonym target is a real registered tool", () => {
    const known = new Set(listRegistryEntries().map((e) => e.name));
    const bad: string[] = [];
    for (const [word, targets] of Object.entries(TOOL_SYNONYMS)) {
      for (const target of targets) if (!known.has(target)) bad.push(`${word} -> ${target}`);
    }
    expect(bad).toEqual([]);
  });

  it("every registered tool is on the entry surface or findable by its own name", () => {
    const unreachable: string[] = [];
    for (const entry of listRegistryEntries()) {
      if (ENTRY_SURFACE_TOOLS.includes(entry.name)) continue;
      const hits = searchTools(entry.name.replace(/_/g, " "), { limit: 25 }).map((h) => h.name);
      if (!hits.includes(entry.name)) unreachable.push(entry.name);
    }
    expect(unreachable).toEqual([]);
  });

  it("every tool carries a real category", () => {
    for (const entry of listRegistryEntries()) {
      expect(TOOL_CATEGORIES as readonly string[]).toContain(entry.category);
    }
  });
});

describe("startup token cost", () => {
  it("the entry surface costs a small fraction of the full surface", () => {
    build("all");
    const zodToJsonSchema = require("zod-to-json-schema").default ?? require("zod-to-json-schema");
    const bytesFor = (names: string[]) =>
      names.reduce((sum, name) => {
        const entry = getRegisteredTool(name)!;
        return (
          sum +
          Buffer.byteLength(
            JSON.stringify({
              name,
              description: entry.description,
              inputSchema: zodToJsonSchema(entry.schema, { $refStrategy: "none" }),
            }),
            "utf8",
          )
        );
      }, 0);

    const all = listRegistryEntries().map((e) => e.name);
    const allBytes = bytesFor(all);
    const entryBytes = bytesFor([...ENTRY_SURFACE_TOOLS]);
    // ~4 chars/token is the usual rule of thumb.
    // eslint-disable-next-line no-console
    console.log(
      `startup schema cost: all=${allBytes}B (~${Math.round(allBytes / 4)} tok, ${all.length} tools) ` +
        `entry=${entryBytes}B (~${Math.round(entryBytes / 4)} tok, ${ENTRY_SURFACE_TOOLS.length} tools) ` +
        `saving=${(100 - (entryBytes / allBytes) * 100).toFixed(1)}%`,
    );
    expect(entryBytes).toBeLessThan(allBytes * 0.1);
    expect(Math.round(entryBytes / 4)).toBeLessThan(12000);
  });
});

describe("deferred tools keep the full call contract (progressive mode)", () => {
  let mockSend: jest.Mock;
  beforeEach(() => {
    build(undefined);
    mockSend = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSend.mockClear();
  });

  const wireFor = async (fn: () => Promise<unknown>, command: string) => {
    mockSend.mockClear();
    await fn();
    const hit = mockSend.mock.calls.find((c) => c[0] === command);
    return hit ? hit[1] : undefined;
  };

  /**
   * The registration gate must be invisible to the call paths. A tool that is NOT in
   * `tools/list` must still batch, and must put byte-identical params on the wire.
   */
  it.each([
    ["set_corner_radius", { nodeId: "1:1", radius: 8 }],
    ["set_padding", { nodeId: "1:1", top: 4, bottom: 4 }],
    ["rename_node", { nodeId: "1:1", name: "Card" }],
  ])("batch_actions sends the same payload as standalone for the DEFERRED %s", async (tool, params) => {
    expect(isSdkRegistered(tool)).toBe(false);
    mockSend.mockResolvedValue({ name: "N", id: "1:1" });
    const standalone = await wireFor(() => call(tool, params as any), tool);
    expect(standalone).toBeDefined();

    mockSend.mockResolvedValue({ totalActions: 1, succeeded: 1, failed: 0, results: [] });
    const dispatch = await wireFor(
      () => call("batch_actions", { actions: [{ action: tool, params }] }),
      "batch_actions",
    );
    expect(dispatch.actions[0].action).toBe(tool);
    expect(dispatch.actions[0].params).toEqual(standalone);
    // Batching must not have side-registered the tool.
    expect(isSdkRegistered(tool)).toBe(false);
  });

  it("figma_call runs a deferred tool without promoting it into the tool list", async () => {
    mockSend.mockResolvedValue({ name: "N", id: "1:1" });
    expect(isSdkRegistered("set_corner_radius")).toBe(false);
    await call("figma_call", { tool: "set_corner_radius", params: { nodeId: "1:1", radius: 8 } });
    expect(mockSend.mock.calls.some((c) => c[0] === "set_corner_radius")).toBe(true);
    expect(isSdkRegistered("set_corner_radius")).toBe(false);
  });

  it("find_figma_tools surfaces deferred tools and flags them as not yet listed", async () => {
    const body = text(await call("find_figma_tools", { query: "round the corners" }));
    expect(body).toContain("set_corner_radius");
    expect(body).toContain("[not in your tool list yet]");
  });
});

describe("tools/list_changed notification", () => {
  // NOTE: SDK 1.22's registerTool() already fires sendToolListChanged() itself on each
  // late registration, so a promotion of N tools emits N notifications plus the one
  // activateTools() sends explicitly. The contract that matters is "the client is told",
  // not the exact count, so assert on that.
  it("describe_figma_tools emits it when it promotes tools", async () => {
    const server = build(undefined);
    const spy = jest.spyOn(server, "sendToolListChanged");
    await call("describe_figma_tools", { names: ["set_corner_radius", "set_padding"] });
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    expect(isSdkRegistered("set_corner_radius")).toBe(true);
    spy.mockRestore();
  });

  it("load_figma_tools emits it, and stays silent when nothing was newly promoted", async () => {
    const server = build(undefined);
    const spy = jest.spyOn(server, "sendToolListChanged");
    await call("load_figma_tools", { names: ["set_padding"] });
    const afterFirst = spy.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    await call("load_figma_tools", { names: ["set_padding"] });
    expect(spy.mock.calls.length).toBe(afterFirst);
    spy.mockRestore();
  });

  it("describe_figma_tools with register:false emits nothing", async () => {
    const server = build(undefined);
    const spy = jest.spyOn(server, "sendToolListChanged");
    await call("describe_figma_tools", { names: ["set_padding"], register: false });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("is a safe no-op on a server that was never connected", async () => {
    build(undefined);
    await expect(call("load_figma_tools", { names: ["set_item_spacing"] })).resolves.toBeDefined();
  });
});

describe("one synonym source of truth", () => {
  it("tool-search delegates ranking and declares no synonym map of its own", () => {
    const src = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../src/videntia_figma_mcp/utils/tool-search.ts"),
      "utf8",
    );
    expect(src).toContain("matchTools");
    expect(src).not.toMatch(/^export const SYNONYMS/m);
  });
});
