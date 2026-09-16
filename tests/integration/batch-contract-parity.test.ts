import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBatchTools, BATCH_CHUNK_SIZE } from "../../src/videntia_figma_mcp/tools/batch-tools";
import { registerModificationTools } from "../../src/videntia_figma_mcp/tools/modification-tools";
import { registerTextTools } from "../../src/videntia_figma_mcp/tools/text-tools";
import { registerVariableTools } from "../../src/videntia_figma_mcp/tools/variable-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

/**
 * These tests assert on the ACTUAL payload `batch_actions` puts on the wire, and that
 * a batched action accepts EXACTLY what its standalone tool accepts.
 *
 * The bug class they guard against: `batch_actions` forwards each action's params
 * straight to the plugin, bypassing the standalone tool's zod schema and its
 * param-massaging — so the documented call (`styleName`, `variableName`, `spacing`, …)
 * was rejected inside a batch with "Missing <the OTHER name>".
 */
describe("batch_actions ↔ standalone parameter parity", () => {
  let mockSend: jest.Mock;
  let handlers: Map<string, Function>;
  let schemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSend = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSend.mockClear();
    mockSend.mockResolvedValue({ totalActions: 1, succeeded: 1, failed: 0, results: [] });

    handlers = new Map();
    schemas = new Map();
    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, , schema, handler] = args;
        handlers.set(name, handler);
        schemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });
    registerBatchTools(server);
    registerModificationTools(server);
    registerTextTools(server);
    registerVariableTools(server);
  });

  const call = async (tool: string, args: any) =>
    await handlers.get(tool)!(schemas.get(tool)!.parse(args), { meta: {} });

  /** The params of the Nth action in the batch payload actually sent to the plugin. */
  const batchParams = (n = 0) => {
    const dispatch = mockSend.mock.calls.find((c) => c[0] === "batch_actions")!;
    return dispatch[1].actions[n].params;
  };
  const batchAction = (n = 0) => {
    const dispatch = mockSend.mock.calls.find((c) => c[0] === "batch_actions")!;
    return dispatch[1].actions[n].action;
  };

  /** Params the STANDALONE tool put on the wire for the same command. */
  const standaloneParams = async (tool: string, args: any) => {
    mockSend.mockClear();
    mockSend.mockResolvedValue({ name: "N", id: "1:1", nodeName: "N", styleName: "s" });
    await call(tool, args);
    const c = mockSend.mock.calls.find((x) => x[0] === tool);
    return c ? c[1] : undefined;
  };

  // --- B1: name→ID parity, the 335 biggest measured failures -------------------

  it.each([
    // [command, caller args (the DOCUMENTED standalone spelling), key the plugin reads]
    ["apply_text_style", { nodeId: "1:2", styleName: "body/md" }, "styleId", "body/md"],
    ["set_color_style_id", { nodeId: "1:2", styleName: "color/primary" }, "styleId", "color/primary"],
    ["set_effect_style_id", { nodeId: "1:2", styleName: "shadow/md" }, "effectStyleId", "shadow/md"],
    ["bind_variable", { nodeId: "1:2", variableName: "bg/primary", field: "fills/0" }, "variableId", "bg/primary"],
    ["set_line_height", { nodeId: "1:2", height: 24 }, "lineHeight", 24],
    ["set_font_size", { nodeId: "1:2", size: 14 }, "fontSize", 14],
    ["set_paragraph_spacing", { nodeId: "1:2", spacing: 8 }, "paragraphSpacing", 8],
    ["set_text_decoration", { nodeId: "1:2", decoration: "UNDERLINE" }, "textDecoration", "UNDERLINE"],
    ["set_text_wrap_style", { nodeId: "1:2", wrap: "balance" }, "textWrapStyle", "BALANCE"],
    ["set_layout_mode", { nodeId: "1:2", mode: "vertical" }, "layoutMode", "VERTICAL"],
    ["rename_node", { nodeId: "1:2", newName: "Card" }, "name", "Card"],
    ["set_item_spacing", { nodeId: "1:2", gap: 12 }, "itemSpacing", 12],
    ["set_padding", { nodeId: "1:2", top: 4 }, "paddingTop", 4],
  ])("%s: a batched action resolves the documented spelling to %s", async (command, args, wireKey, expected) => {
    await call("batch_actions", { actions: [{ action: command, params: args }] });
    expect(batchParams()).toMatchObject({ [wireKey as string]: expected });
    // The alias spelling must NOT also be forwarded — a duplicate key is how a plugin
    // handler ends up choosing the stale one.
    const aliasKey = Object.keys(args as object).find((k) => k !== "nodeId" && k !== wireKey);
    if (aliasKey && aliasKey !== wireKey) expect(batchParams()).not.toHaveProperty(aliasKey);
  });

  it("set_padding shorthand expands to all four sides, as standalone does", async () => {
    await call("batch_actions", { actions: [{ action: "set_padding", params: { nodeId: "1:2", padding: 16 } }] });
    expect(batchParams()).toMatchObject({
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
    });
  });

  it("produces the SAME wire params as the standalone tool for apply_text_style", async () => {
    const standalone = await standaloneParams("apply_text_style", { nodeId: "1:2", styleName: "body/md" });
    mockSend.mockClear();
    mockSend.mockResolvedValue({ totalActions: 1, succeeded: 1, failed: 0, results: [] });
    await call("batch_actions", {
      actions: [{ action: "apply_text_style", params: { nodeId: "1:2", styleName: "body/md" } }],
    });
    expect(batchParams()).toEqual(standalone);
  });

  it("produces the SAME wire params as the standalone tool for set_effect_style_id", async () => {
    const standalone = await standaloneParams("set_effect_style_id", { nodeId: "1:2", styleName: "shadow/md" });
    mockSend.mockClear();
    mockSend.mockResolvedValue({ totalActions: 1, succeeded: 1, failed: 0, results: [] });
    await call("batch_actions", {
      actions: [{ action: "set_effect_style_id", params: { nodeId: "1:2", styleName: "shadow/md" } }],
    });
    expect(batchParams()).toEqual(standalone);
  });

  it("update_icon in a batch resolves a Lucide name to svgString server-side", async () => {
    await call("batch_actions", {
      actions: [{ action: "update_icon", params: { nodeId: "1:2", name: "check", size: 16 } }],
    });
    expect(batchAction()).toBe("update_icon");
    expect(typeof batchParams().svgString).toBe("string");
    expect(batchParams().svgString).toContain("<svg");
    expect(batchParams().nodeId).toBe("1:2");
  });

  it("create_icon in a batch expands to create_svg with a resolved SVG", async () => {
    await call("batch_actions", {
      actions: [{ action: "create_icon", params: { parentId: "1:2", name: "check", size: 16 } }],
    });
    expect(batchAction()).toBe("create_svg");
    expect(batchParams().svgString).toContain("<svg");
  });

  it("normalises Figma URL-style node ids inside batch params", async () => {
    await call("batch_actions", { actions: [{ action: "rename_node", params: { nodeId: "65-7554", name: "X" } }] });
    expect(batchParams().nodeId).toBe("65:7554");
  });

  it("never drops nodeId — it survives to the wire verbatim", async () => {
    await call("batch_actions", {
      actions: [
        { action: "set_fill_color", params: { nodeId: "1:2", color: "#ff0000" } },
        { action: "set_opacity", params: { nodeId: "1:3", opacity: 0.5 } },
      ],
    });
    expect(batchParams(0).nodeId).toBe("1:2");
    expect(batchParams(1).nodeId).toBe("1:3");
    expect(batchParams(1).opacity).toBe(0.5);
  });

  it("salvages a bare `id`/`node` into nodeId rather than dispatching an undefined id", async () => {
    await call("batch_actions", {
      actions: [
        { action: "rename_node", params: { id: "65-7554", name: "X" } },
        { action: "set_opacity", params: { node: "1:9", opacity: 0.2 } },
      ],
    });
    expect(batchParams(0).nodeId).toBe("65:7554");
    expect(batchParams(0)).not.toHaveProperty("id");
    expect(batchParams(1).nodeId).toBe("1:9");
  });

  it("does NOT hijack `id` for commands where it means a variable/collection", async () => {
    await call("batch_actions", {
      actions: [{ action: "delete_variable", params: { id: "text/primary" } }],
    });
    expect(batchParams()).toEqual({ variableId: "text/primary" });
    expect(batchParams()).not.toHaveProperty("nodeId");
  });

  it("drops a stringified `undefined` node id so the error names the missing param", async () => {
    await call("batch_actions", { actions: [{ action: "rename_node", params: { nodeId: "undefined", name: "X" } }] });
    expect(batchParams()).not.toHaveProperty("nodeId");
  });

  // --- B4: envelope tolerance --------------------------------------------------

  it("accepts `type` as an alias for `action`", async () => {
    await call("batch_actions", { actions: [{ type: "rename_node", params: { nodeId: "1:2", name: "X" } }] });
    expect(batchAction()).toBe("rename_node");
    expect(batchParams()).toMatchObject({ nodeId: "1:2", name: "X" });
  });

  it("folds flat params written next to `action` into params", async () => {
    await call("batch_actions", { actions: [{ action: "rename_node", nodeId: "1:2", name: "X" }] as any });
    expect(batchAction()).toBe("rename_node");
    expect(batchParams()).toMatchObject({ nodeId: "1:2", name: "X" });
  });

  it("get_schema_definition publishes the batch action schema", async () => {
    mockSend.mockClear();
    const res: any = await call("get_schema_definition", { target: "batch_actions" });
    const doc = JSON.parse(res.content[0].text);
    expect(doc.tool).toBe("batch_actions");
    expect(doc.action.action).toContain("command name");
    expect(doc.aliases.action).toContain("type");
    expect(doc.example.actions[0]).toHaveProperty("action");
    // It must NOT have gone to Figma — this is a server-side schema.
    expect(mockSend).not.toHaveBeenCalled();
  });

  // --- B5: auto-chunking -------------------------------------------------------

  describe("auto-chunking", () => {
    const makeActions = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ action: "rename_node", params: { nodeId: `1:${i}`, name: `N${i}` } }));

    const chunkedMock = () => {
      mockSend.mockImplementation(async (cmd: string, params: any) => {
        if (cmd !== "batch_actions") return {};
        const results = params.actions.map((a: any, i: number) => ({
          index: i,
          action: a.action,
          success: true,
          result: { id: `new:${i}` },
        }));
        return { totalActions: results.length, succeeded: results.length, failed: 0, results };
      });
    };

    it("sends a short batch in a single round trip", async () => {
      chunkedMock();
      await call("batch_actions", { actions: makeActions(BATCH_CHUNK_SIZE), checkpoint: false });
      expect(mockSend.mock.calls.filter((c) => c[0] === "batch_actions")).toHaveLength(1);
    });

    it("splits a long batch and reports ONE global result set", async () => {
      chunkedMock();
      const total = BATCH_CHUNK_SIZE * 2 + 5;
      const res: any = await call("batch_actions", { actions: makeActions(total), checkpoint: false });
      const dispatches = mockSend.mock.calls.filter((c) => c[0] === "batch_actions");
      expect(dispatches).toHaveLength(3);
      expect(dispatches[0][1].actions).toHaveLength(BATCH_CHUNK_SIZE);
      expect(dispatches[2][1].actions).toHaveLength(5);
      expect(res.content[0].text).toContain(`${total}/${total} succeeded`);
      expect(res.isError).toBe(false);
    });

    it("preserves $result[N] across a chunk boundary", async () => {
      chunkedMock();
      const actions = makeActions(BATCH_CHUNK_SIZE);
      // Action 0 is in chunk 1; this one lands in chunk 2 and references back.
      actions.push({ action: "rename_node", params: { nodeId: "$result[0].id", name: "late" } });
      await call("batch_actions", { actions, checkpoint: false });
      const dispatches = mockSend.mock.calls.filter((c) => c[0] === "batch_actions");
      expect(dispatches).toHaveLength(2);
      // The cross-chunk reference must have been resolved to its literal value —
      // the plugin's second chunk has no memory of the first.
      expect(dispatches[1][1].actions[0].params.nodeId).toBe("new:0");
    });

    it("rebases a within-chunk $result[N] to a chunk-local index", async () => {
      chunkedMock();
      const actions = makeActions(BATCH_CHUNK_SIZE + 2);
      actions[BATCH_CHUNK_SIZE + 1].params.nodeId = `$result[${BATCH_CHUNK_SIZE}].id` as any;
      await call("batch_actions", { actions, checkpoint: false });
      const dispatches = mockSend.mock.calls.filter((c) => c[0] === "batch_actions");
      expect(dispatches[1][1].actions[1].params.nodeId).toBe("$result[0].id");
    });

    it("honours stopOnError across chunks", async () => {
      mockSend.mockImplementation(async (cmd: string, params: any) => {
        if (cmd !== "batch_actions") return {};
        const results = params.actions.map((a: any, i: number) => ({
          index: i,
          action: a.action,
          success: i !== 0,
          error: i === 0 ? "boom" : undefined,
          result: { id: `new:${i}` },
        }));
        return {
          totalActions: results.length,
          succeeded: results.length - 1,
          failed: 1,
          results,
        };
      });
      await call("batch_actions", { actions: makeActions(BATCH_CHUNK_SIZE * 3), stopOnError: true, checkpoint: false });
      expect(mockSend.mock.calls.filter((c) => c[0] === "batch_actions")).toHaveLength(1);
    });
  });
});
