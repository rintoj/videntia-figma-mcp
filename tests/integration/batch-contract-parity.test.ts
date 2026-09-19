import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../src/videntia_figma_mcp/tools";
import { BATCH_CHUNK_SIZE } from "../../src/videntia_figma_mcp/tools/batch-tools";
import {
  clearToolRegistry,
  getRegisteredTool,
  listCapturedToolNames,
} from "../../src/videntia_figma_mcp/utils/tool-registry";
import { PARAM_ALIASES } from "../../src/videntia_figma_mcp/utils/param-aliases";
import { nonBatchableReason, isPureAction } from "../../src/videntia_figma_mcp/utils/pure-batch-actions";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => {
  // `require`, not jest.requireActual — this suite runs under `bun test`, which has no
  // requireActual.
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

/**
 * These tests assert on the ACTUAL payload `batch_actions` puts on the wire, and that
 * a batched action accepts EXACTLY what its standalone tool accepts.
 *
 * Since the unification (utils/tool-registry.ts + utils/tool-capture.ts) a batched
 * action IS the standalone tool — same zod schema, same handler, run in capture mode —
 * so parity is structural. What still has to be tested is that nothing quietly opts
 * out of that: every document-acting tool must be reachable from a batch, and every
 * alias spelling must name a parameter its tool's schema actually has. That second
 * assertion is the exact bug that shipped twice from the old hand-maintained map.
 */
describe("batch_actions ↔ standalone parameter parity", () => {
  let mockSend: jest.Mock;

  beforeEach(() => {
    clearToolRegistry();
    const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSend = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSend.mockClear();
    mockSend.mockResolvedValue({ totalActions: 1, succeeded: 1, failed: 0, results: [] });
    registerTools(server);
  });

  /** Invoke a tool exactly as the MCP server would: its own schema, its own handler. */
  const call = async (tool: string, args: any) => {
    const entry = getRegisteredTool(tool)!;
    return (await entry.handler(entry.schema.parse(args) as Record<string, unknown>, { meta: {} })) as any;
  };

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

  // --- B0: structural guarantees, driven off the live tool registry --------------
  //
  // These are the tests that make "every tool is batchable with identical params" a
  // property of the system rather than a promise. They enumerate the REGISTRY, so a
  // tool added tomorrow is covered automatically and fails here if it opts out
  // silently.

  /** Tools that legitimately never reach the Figma plugin from inside a batch. */
  const isExcluded = (name: string) => isPureAction(name) || nonBatchableReason(name) !== undefined;

  it("every registered tool is either batchable or rejected BY NAME with a reason", async () => {
    const unexplained: string[] = [];
    for (const name of listCapturedToolNames()) {
      if (isExcluded(name)) continue;
      // A batchable tool must be resolvable from the registry the batch dispatcher uses.
      if (!getRegisteredTool(name)) unexplained.push(name);
    }
    expect(unexplained).toEqual([]);
  });

  it("every excluded tool explains itself instead of failing as 'Unknown command'", () => {
    for (const name of listCapturedToolNames()) {
      if (!isExcluded(name)) continue;
      if (isPureAction(name)) continue;
      const reason = nonBatchableReason(name)!;
      expect(reason).toContain(name);
      expect(reason.length).toBeGreaterThan(40);
    }
  });

  it("every browser_* tool and session tool is rejected by name, never silently attempted", () => {
    const sessionTools = ["figma_connect", "join_channel", "get_open_channels", "batch_actions"];
    const names = listCapturedToolNames().filter((n) => n.startsWith("browser_") || sessionTools.includes(n));
    expect(names.length).toBeGreaterThan(28);
    for (const name of names) {
      expect(nonBatchableReason(name)).toBeDefined();
    }
  });

  it("every alias spelling names a parameter its tool's schema actually has", () => {
    // THE regression that shipped twice: the old map aliased set_effect_style_id onto
    // `styleId` while the handler read `effectStyleId`, and it silently missed
    // `aspect_correct` when set_gradient_fill gained it. An alias target that is not a
    // real schema key can no longer be written without this failing.
    const bad: string[] = [];
    for (const [command, aliases] of Object.entries(PARAM_ALIASES)) {
      const entry = getRegisteredTool(command);
      if (!entry) {
        bad.push(`${command}: not a registered tool`);
        continue;
      }
      const keys = new Set(Object.keys(entry.schema.shape));
      for (const [from, to] of Object.entries(aliases)) {
        if (!keys.has(to)) bad.push(`${command}.${from} -> ${to} (no such parameter)`);
        // An alias whose OWN spelling is also a real parameter would shadow it.
        if (Object.keys(entry.schema.shape as object).includes(from) && from !== to) {
          const declared = (entry.schema.shape as Record<string, { _def?: { typeName?: string } }>)[from];
          // The wrapper itself declares alias keys as z.unknown(); a REAL parameter of
          // the same name is the conflict we care about.
          if (declared?._def?.typeName !== "ZodOptional") bad.push(`${command}.${from} shadows a real parameter`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * Standalone vs batch, byte for byte, over a fixture per representative tool.
   * The fixtures deliberately use the SLOPPIEST spelling each tool accepts, because
   * that is where the two paths used to diverge.
   */
  const PARITY_FIXTURES: [string, Record<string, unknown>][] = [
    ["rename_node", { nodeId: "65-7554", newName: "Card" }],
    ["set_fill_color", { nodeId: "1:2", fill: "#ff0000" }],
    ["set_stroke_color", { nodeId: "1:2", stroke: "#00ff00", weight: 2 }],
    ["set_opacity", { node: "1:9", alpha: 0.2 }],
    ["set_corner_radius", { nodeId: "1:2", radius: 8 }],
    ["set_layout_mode", { nodeId: "1:2", mode: "vertical" }],
    ["set_axis_align", { nodeId: "1:2", primary: "center", counter: "center" }],
    ["set_layout_sizing", { nodeId: "1:2", horizontal: "fill", vertical: "hug", allowSideEffects: true }],
    ["set_auto_layout", { nodeId: "1:2", mode: "vertical", expectSideEffects: ["parentResize"] }],
    ["set_strict_mode", { enabled: true, allowSideEffects: true }],
    ["set_item_spacing", { nodeId: "1:2", gap: 12 }],
    ["set_padding", { nodeId: "1:2", padding: 16 }],
    ["create_autolayout_frame", { name: "Panel", layoutMode: "vertical", padding: [8, 16], gap: 12 }],
    ["create_card", { name: "Card", padding: 16, gap: 8 }],
    ["create_slot", { componentId: "1:2", layoutMode: "VERTICAL", padding: 16, gap: 8 }],
    ["set_text_content", { nodeId: "1:2", characters: "Hello" }],
    ["set_font_size", { nodeId: "1:2", size: 14 }],
    ["set_line_height", { nodeId: "1:2", height: 24 }],
    ["set_letter_spacing", { nodeId: "1:2", spacing: 1 }],
    ["set_paragraph_spacing", { nodeId: "1:2", spacing: 8 }],
    ["set_text_case", { nodeId: "1:2", case: "upper" }],
    ["set_text_decoration", { nodeId: "1:2", decoration: "underline" }],
    ["set_text_wrap_style", { nodeId: "1:2", wrap: "balance" }],
    ["set_font_weight", { nodeId: "1:2", fontWeight: 600 }],
    ["set_font_name", { nodeId: "1:2", fontFamily: "Inter", fontStyle: "Bold" }],
    ["apply_text_style", { nodeId: "1:2", styleName: "body/md" }],
    ["set_color_style_id", { nodeId: "1:2", styleName: "color/primary" }],
    ["set_effect_style_id", { nodeId: "1:2", styleName: "shadow/md" }],
    ["bind_variable", { nodeId: "1:2", variableName: "bg/primary", field: "fills/0" }],
    ["unbind_variable", { nodeId: "1:2", property: "fills/0" }],
    ["move_node", { nodeId: "1:2", x: 10, y: 20 }],
    ["resize_node", { nodeId: "1:2", width: 100, height: 50 }],
    ["clone_node", { nodeId: "1:2" }],
    ["delete_node", { nodeId: "1:2" }],
    ["insert_child", { parentId: "1-2", childId: "3-4", index: 0 }],
    ["create_rectangle", { x: 0, y: 0, width: 10, height: 10, fill: "#ff0000" }],
    ["create_text", { x: 0, y: 0, characters: "Hi" }],
    ["create_frame", { x: 0, y: 0, width: 10, height: 10, fill: "#ffffff" }],
    ["delete_variable", { id: "text/primary" }],
    ["delete_variables_batch", { variableIds: ["text/primary", "text/secondary"] }],
    ["update_variable_value", { id: "text/primary", value: "#000000" }],
    ["rename_variable", { id: "brand/500", name: "brand/600" }],
    ["add_mode_to_collection", { id: "c1", name: "Dark" }],
    ["rename_mode", { id: "c1", oldName: "Light", newName: "Day" }],
    ["rename_page", { pageId: "0:1", newName: "Home" }],
    ["delete_variable_collection", { collection: "c1" }],
    ["set_image_fill", { nodeId: "1:2", url: "https://example.com/a.png" }],
    [
      "set_gradient_fill",
      {
        nodeId: "1:2",
        type: "LINEAR",
        stops: [
          { color: "#ffffff", position: 0 },
          { color: "#000000", position: 1 },
        ],
      },
    ],
  ];

  it.each(PARITY_FIXTURES)("%s: batched and standalone put the IDENTICAL payload on the wire", async (tool, args) => {
    mockSend.mockClear();
    mockSend.mockResolvedValue({ name: "N", id: "1:1" });
    await call(tool, args);
    const standalone = mockSend.mock.calls.filter((c) => c[0] !== "commit_undo");
    expect(standalone.length).toBeGreaterThan(0);

    mockSend.mockClear();
    mockSend.mockResolvedValue({ totalActions: 1, succeeded: 1, failed: 0, results: [] });
    await call("batch_actions", { actions: [{ action: tool, params: args }], checkpoint: false });

    const dispatch = mockSend.mock.calls.find((c) => c[0] === "batch_actions");
    expect(dispatch).toBeDefined();
    // Compared after a JSON round trip: that is literally what goes over the socket,
    // and it is where an `undefined`-valued optional key stops existing.
    const onTheWire = (v: unknown) => JSON.parse(JSON.stringify(v));
    const batched = dispatch![1].actions.map((a: any) => [a.action, onTheWire(a.params)]);
    expect(batched).toEqual(standalone.map((c) => [c[0], onTheWire(c[1])]));
  });

  it("the parity fixtures cover every tool that declares a param alias", () => {
    // A new alias without a fixture is a new untested divergence surface.
    const covered = new Set(PARITY_FIXTURES.map(([t]) => t));
    const missing = Object.keys(PARAM_ALIASES).filter((t) => !covered.has(t));
    expect(missing).toEqual([]);
  });

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

  it("rejects a stringified `undefined` node id instead of dispatching it", async () => {
    // "undefined" is a marshalling accident upstream, not an id. It is dropped before
    // the tool's handler, which then fails to build a payload — so the action is
    // reported as a per-action failure rather than sent to Figma to hunt for a node
    // called "undefined".
    const res = await call("batch_actions", {
      actions: [{ action: "rename_node", params: { nodeId: "undefined", name: "X" } }],
    });
    expect(mockSend.mock.calls.find((c) => c[0] === "batch_actions")).toBeUndefined();
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("rename_node");
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
    expect(mockSend.mock.calls).toHaveLength(0);
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
