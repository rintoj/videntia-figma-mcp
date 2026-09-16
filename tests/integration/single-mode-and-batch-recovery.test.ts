import { z } from "zod";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBatchTools } from "../../src/videntia_figma_mcp/tools/batch-tools";
import { registerModificationTools } from "../../src/videntia_figma_mcp/tools/modification-tools";
import { registerTextTools } from "../../src/videntia_figma_mcp/tools/text-tools";
import { registerVariableTools } from "../../src/videntia_figma_mcp/tools/variable-tools";
import { registerIconTools } from "../../src/videntia_figma_mcp/tools/icon-tools";
import { ALLOWED_COMMANDS } from "../../src/videntia_figma_plugin/ui/constants";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

/**
 * Regression cover for three production-session bugs:
 *
 *  #24 — `set_image_fill` rejected a local file path, forcing agents to inline a
 *        ~50,000-char base64 blob (measured: 0 of 6 agents ever succeeded).
 *  #17 — tools that worked in EXACTLY ONE mode: standalone-only or batch-only.
 *  #18 — a partially-failed batch left the file half-mutated with no machine-readable
 *        account of what had committed.
 *
 * Every assertion is on the ACTUAL payload put on the wire or the actual returned
 * text — never on a "success" string.
 */
describe("single-mode tools, image paths, and batch recovery", () => {
  let mockSend: jest.Mock;
  let handlers: Map<string, Function>;
  let schemas: Map<string, z.ZodObject<any>>;
  let tmpDir: string;
  let pngPath: string;

  /** Smallest valid 1x1 PNG — real magic bytes, so the server-side sniffer accepts it. */
  const PNG_1X1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "figma-image-fill-"));
    pngPath = path.join(tmpDir, "hero.png");
    fs.writeFileSync(pngPath, PNG_1X1);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

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
    registerIconTools(server);
  });

  const call = async (tool: string, args: any) =>
    await handlers.get(tool)!(schemas.get(tool)!.parse(args), { meta: {} });

  /** Params of the Nth action in the batch payload actually sent to the plugin. */
  const batchParams = (n = 0) => {
    const dispatch = mockSend.mock.calls.find((c) => c[0] === "batch_actions")!;
    return dispatch[1].actions[n].params;
  };

  /** Params the STANDALONE tool put on the wire for `command`. */
  const standaloneParams = async (tool: string, args: any, command = tool) => {
    mockSend.mockClear();
    mockSend.mockResolvedValue({
      id: "1:2",
      name: "N",
      imageHash: "h",
      imageSize: { width: 1, height: 1 },
      scaleMode: "FILL",
    });
    await call(tool, args);
    const c = mockSend.mock.calls.find((x) => x[0] === command);
    return c ? c[1] : undefined;
  };

  const textOf = (res: any) => res.content[0].text as string;

  // --- #24: set_image_fill accepts a local file path ---------------------------

  describe("#24 set_image_fill accepts a local file path", () => {
    it.each(["image_path", "path", "load_from_path"])(
      "declares `%s` in its schema (zod silently strips undeclared keys)",
      (key) => {
        const shape = (schemas.get("set_image_fill") as any).shape;
        expect(Object.keys(shape)).toContain(key);
      },
    );

    it.each(["image_path", "path", "load_from_path"])(
      "reads the file server-side for `%s` and puts base64 bytes on the wire",
      async (key) => {
        mockSend.mockResolvedValue({
          id: "1:2",
          name: "Hero",
          imageHash: "h",
          imageSize: { width: 1, height: 1 },
          scaleMode: "FILL",
        });
        const res = await call("set_image_fill", { nodeId: "1:2", [key]: pngPath });

        const wire = mockSend.mock.calls.find((c) => c[0] === "set_image_fill")![1];
        expect(wire.imageBytes).toBe(PNG_1X1.toString("base64"));
        expect(wire.imageUrl).toBeUndefined();
        // The path itself must never reach the plugin — it cannot read the disk.
        expect(wire).not.toHaveProperty("image_path");
        expect(wire).not.toHaveProperty("path");
        expect(wire).not.toHaveProperty("load_from_path");
        expect(textOf(res)).toContain(pngPath);
      },
    );

    it("produces the SAME wire payload as set_image_fill_from_path", async () => {
      const viaAlias = await standaloneParams("set_image_fill", { nodeId: "1:2", image_path: pngPath });
      const viaDedicated = await standaloneParams(
        "set_image_fill_from_path",
        { nodeId: "1:2", path: pngPath },
        "set_image_fill",
      );
      expect(viaAlias).toEqual(viaDedicated);
    });

    it("names the path parameter when no source is given at all", async () => {
      const res = await call("set_image_fill", { nodeId: "1:2" });
      const text = textOf(res);
      expect(text).toContain("image_path");
      expect(text).toContain("load_from_path");
      expect(text).toContain("imageUrl");
      expect(text).toContain("imageBytes");
      expect(mockSend).not.toHaveBeenCalledWith("set_image_fill", expect.anything(), expect.anything());
    });

    it("rejects a path combined with another source instead of silently picking one", async () => {
      const res = await call("set_image_fill", {
        nodeId: "1:2",
        image_path: pngPath,
        imageUrl: "https://example.com/a.png",
      });
      expect(textOf(res)).toMatch(/only ONE image source/i);
    });

    it("surfaces a missing file as an actionable error, not a plugin round trip", async () => {
      const res = await call("set_image_fill", { nodeId: "1:2", image_path: path.join(tmpDir, "nope.png") });
      expect(textOf(res)).toContain("File does not exist");
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("reads the file server-side inside a batch too", async () => {
      await call("batch_actions", {
        actions: [{ action: "set_image_fill", params: { nodeId: "1:2", path: pngPath } }],
      });
      expect(batchParams().imageBytes).toBe(PNG_1X1.toString("base64"));
      expect(batchParams()).not.toHaveProperty("path");
      expect(batchParams()).not.toHaveProperty("image_path");
    });
  });

  // --- #17: tools that used to work in exactly ONE mode -------------------------

  describe("#17 standalone ↔ batch parity for previously single-mode tools", () => {
    it.each(["remove_fill", "remove_stroke", "set_gradient_fill", "set_image_fill"])(
      "%s is in the plugin UI ALLOWED_COMMANDS allowlist (standalone was 'Command not permitted')",
      (command) => {
        expect(ALLOWED_COMMANDS.has(command)).toBe(true);
      },
    );

    it.each(["remove_fill", "remove_stroke"])("%s is registered as a standalone MCP tool", (command) => {
      expect(handlers.has(command)).toBe(true);
    });

    /**
     * For each command: the DOCUMENTED standalone call must produce the same wire
     * params when the very same object is handed to batch_actions.
     */
    const PARITY_CASES: [string, any][] = [
      ["remove_fill", { nodeId: "1:2" }],
      ["remove_stroke", { nodeId: "1:2" }],
      [
        "set_gradient_fill",
        {
          nodeId: "1:2",
          type: "LINEAR",
          stops: [
            { color: "#ff0000", position: 0 },
            { color: "#0000ff", position: 1 },
          ],
        },
      ],
      ["apply_text_style", { nodeId: "1:2", styleName: "body/md" }],
      ["bind_variable", { nodeId: "1:2", variableId: "bg/primary", field: "fills/0" }],
      ["set_effect_style_id", { nodeId: "1:2", styleName: "shadow/md" }],
    ];

    it.each(PARITY_CASES)("%s: batch accepts exactly what standalone accepts", async (command, args) => {
      const standalone = await standaloneParams(command, args);
      expect(standalone).toBeDefined();

      mockSend.mockClear();
      mockSend.mockResolvedValue({ totalActions: 1, succeeded: 1, failed: 0, results: [] });
      await call("batch_actions", { actions: [{ action: command, params: args }] });

      // Compare only the keys the standalone tool actually put on the wire: the batch
      // path may add defaults, but must never LOSE or RENAME a param.
      for (const [key, value] of Object.entries(standalone as object)) {
        if (value === undefined) continue;
        expect(batchParams()).toHaveProperty(key);
        // `stops` colors are compared structurally rather than deeply: standalone
        // pre-converts hex to {r,g,b,a} while batch forwards the hex string, and the
        // plugin accepts BOTH (see utils/color-input.ts). Positions must still match.
        if (key === "stops") {
          const batchStops = batchParams().stops as any[];
          expect(batchStops.map((s) => s.position)).toEqual((value as any[]).map((s) => s.position));
          for (const stop of batchStops) expect(stop.color).toBeDefined();
          continue;
        }
        expect(batchParams()[key]).toEqual(value);
      }
    });

    it("set_gradient_fill in a batch keeps hex stops and never loses gradientType", async () => {
      await call("batch_actions", {
        actions: [
          {
            action: "set_gradient_fill",
            params: { nodeId: "1:2", type: "radial", stops: ["#ff0000", "#0000ff"] },
          },
        ],
      });
      expect(batchParams().gradientType).toBe("RADIAL");
      expect(batchParams().stops).toEqual([
        { color: "#ff0000", position: 0 },
        { color: "#0000ff", position: 1 },
      ]);
    });

    it("update_icon resolves its SVG server-side in BOTH modes", async () => {
      const standalone = await standaloneParams("update_icon", { nodeId: "1:2", name: "check", size: 16 });
      expect(typeof (standalone as any).svgString).toBe("string");

      mockSend.mockClear();
      mockSend.mockResolvedValue({ totalActions: 1, succeeded: 1, failed: 0, results: [] });
      await call("batch_actions", {
        actions: [{ action: "update_icon", params: { nodeId: "1:2", name: "check", size: 16 } }],
      });
      expect(batchParams().svgString).toBe((standalone as any).svgString);
    });
  });

  // --- #18: partial-batch recovery without a document re-read ------------------

  describe("#18 partially-committed batch reports a machine-readable recovery manifest", () => {
    const partialResult = {
      totalActions: 3,
      succeeded: 2,
      failed: 1,
      results: [
        { index: 0, action: "create_frame", success: true, result: { id: "10:1", name: "Card" } },
        { index: 1, action: "set_fill_color", success: true, result: { id: "10:1" } },
        { index: 2, action: "apply_text_style", success: false, error: "Style not found: body/xl" },
      ],
    };

    const runPartialBatch = async () => {
      mockSend.mockClear();
      mockSend.mockImplementation((command: string) =>
        command === "batch_actions" ? Promise.resolve(partialResult) : Promise.resolve({}),
      );
      return await call("batch_actions", {
        actions: [
          { action: "create_frame", params: { x: 0, y: 0, width: 10, height: 10 } },
          { action: "set_fill_color", params: { nodeId: "$result[0].id", color: "#fff" } },
          { action: "apply_text_style", params: { nodeId: "10:2", styleName: "body/xl" } },
        ],
      });
    };

    it("emits one parseable row per action with index, command, outcome, node id and committed flag", async () => {
      const text = textOf(await runPartialBatch());
      const json = text.match(/```json\n([\s\S]*?)\n```/);
      expect(json).not.toBeNull();

      const manifest = JSON.parse(json![1]);
      expect(manifest).toHaveLength(3);
      expect(manifest[0]).toEqual({
        index: 0,
        action: "create_frame",
        success: true,
        committed: true,
        nodeId: "10:1",
      });
      expect(manifest[1]).toMatchObject({ index: 1, success: true, committed: true, nodeId: "10:1" });
      expect(manifest[2]).toEqual({
        index: 2,
        action: "apply_text_style",
        success: false,
        committed: false,
        nodeId: undefined,
        error: "Style not found: body/xl",
      });
    });

    it("states plainly that the committed prefix is NOT rolled back, and how to undo it", async () => {
      const text = textOf(await runPartialBatch());
      expect(text).toMatch(/NOT rolled back automatically/);
      expect(text).toMatch(/no transaction/i);
      expect(text).toMatch(/undo/i);
      expect(text).toContain("2 earlier action(s) succeeded and ARE committed");
    });

    it("commits an undo checkpoint before the batch so that single undo is scoped to it", async () => {
      await runPartialBatch();
      const order = mockSend.mock.calls.map((c) => c[0]);
      expect(order.indexOf("commit_undo")).toBe(0);
      expect(order.indexOf("batch_actions")).toBeGreaterThan(0);
    });

    it("omits the manifest when nothing failed (no recovery needed)", async () => {
      mockSend.mockClear();
      mockSend.mockResolvedValue({
        totalActions: 1,
        succeeded: 1,
        failed: 0,
        results: [{ index: 0, action: "rename_node", success: true, result: { id: "1:2" } }],
      });
      const text = textOf(
        await call("batch_actions", { actions: [{ action: "rename_node", nodeId: "1:2", name: "X" }] as any }),
      );
      expect(text).not.toContain("```json");
    });
  });
});
