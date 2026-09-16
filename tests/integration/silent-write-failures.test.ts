import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerModificationTools } from "../../src/videntia_figma_mcp/tools/modification-tools";
import { normalizeCommandParams } from "../../src/videntia_figma_mcp/utils/normalize-batch-params";
import { fontStyleCandidates } from "../../src/videntia_figma_plugin/handlers/text";
import { isStrictModeEnabled, resolveStrict } from "../../src/videntia_figma_plugin/utils/write-verify";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

/**
 * Regression guards for the "tool reports success, nothing changed" class of bug
 * (47 measured set → read-back → re-apply loops in one production session).
 * Each test asserts the WIRE payload or the resolution logic, because a
 * plugin-side fix is routinely defeated by an MCP-side schema strip or default.
 */
describe("silent write failures", () => {
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();
    mockSendCommand.mockResolvedValue({ id: "1:1", name: "Node", gradientType: "LINEAR", stopsCount: 2 });

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
    registerModificationTools(server);
  });

  async function callTool(toolName: string, args: any) {
    const schema = toolSchemas.get(toolName)!;
    const handler = toolHandlers.get(toolName)!;
    return await handler(schema.parse(args), { meta: {} });
  }
  const wire = () => mockSendCommand.mock.calls[0][1];

  // ---- item 3 / item 1: font style spelling ------------------------------
  describe("font style candidates", () => {
    it("offers BOTH spellings for SemiBold, most-likely first", () => {
      expect(fontStyleCandidates("SemiBold")).toEqual(expect.arrayContaining(["SemiBold", "Semi Bold"]));
      expect(fontStyleCandidates("Semi Bold")).toEqual(expect.arrayContaining(["Semi Bold", "SemiBold"]));
    });

    it("covers ExtraBold / UltraLight variants", () => {
      expect(fontStyleCandidates("ExtraBold")).toEqual(expect.arrayContaining(["ExtraBold", "Extra Bold"]));
      expect(fontStyleCandidates("UltraLight")).toEqual(expect.arrayContaining(["Extra Light"]));
    });

    it("passes an unknown custom style through unchanged as the first candidate", () => {
      expect(fontStyleCandidates("Condensed Oblique")[0]).toBe("Condensed Oblique");
    });

    it("never yields duplicates or empties", () => {
      const out = fontStyleCandidates("Bold");
      expect(new Set(out).size).toBe(out.length);
      expect(out).not.toContain("");
    });
  });

  // ---- item 4: set_gradient_fill must work in batch as well as standalone --
  describe("set_gradient_fill", () => {
    it("accepts hex stops standalone and forwards them", async () => {
      await callTool("set_gradient_fill", {
        nodeId: "1:1",
        type: "LINEAR",
        stops: [
          { color: "#ff0000", position: 0 },
          { color: "#0000ff", position: 1 },
        ],
      });
      expect(wire().gradientType).toBe("LINEAR");
      // Hex stops are normalized to RGBA components server-side before dispatch
      // (unified colour contract), so the wire carries components, not the hex string.
      expect(wire().stops[0].color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    });

    it("still accepts rgba stops standalone", async () => {
      await callTool("set_gradient_fill", {
        nodeId: "1:1",
        type: "RADIAL",
        stops: [
          { color: { r: 1, g: 0, b: 0 }, position: 0 },
          { color: { r: 0, g: 0, b: 1, a: 0.5 }, position: 1 },
        ],
      });
      expect(wire().gradientType).toBe("RADIAL");
      expect(wire().angle).toBe(0);
      expect(wire().opacity).toBe(1);
    });

    it("normalises the batch form to the same wire shape as standalone", () => {
      const out = normalizeCommandParams("set_gradient_fill", {
        nodeId: "1-1",
        type: "linear",
        stops: [
          { color: "#ff0000", position: 0 },
          { color: "#0000ff", position: 1 },
        ],
      });
      expect(out).toEqual({
        nodeId: "1:1",
        gradientType: "LINEAR",
        angle: 0,
        opacity: 1,
        // Contract change (bug #30): aspect_correct defaults to true on the standalone
        // tool, so the batch normaliser emits it too - that IS the "same wire shape".
        aspect_correct: true,
        stops: [
          { color: "#ff0000", position: 0 },
          { color: "#0000ff", position: 1 },
        ],
      });
    });

    it("accepts the colors shorthand and bare colour stops in a batch", () => {
      expect(normalizeCommandParams("set_gradient_fill", { nodeId: "1:1", colors: ["#fff", "#000"] }).stops).toEqual([
        { color: "#fff", position: 0 },
        { color: "#000", position: 1 },
      ]);
      expect(normalizeCommandParams("set_gradient_fill", { nodeId: "1:1", stops: ["#fff", "#000"] }).stops).toEqual([
        { color: "#fff", position: 0 },
        { color: "#000", position: 1 },
      ]);
    });

    it("parses a JSON-string stops array and flat rgba stops", () => {
      expect(
        normalizeCommandParams("set_gradient_fill", {
          nodeId: "1:1",
          stops: '[{"color":"#fff","position":0},{"color":"#000","position":1}]',
        }).stops,
      ).toEqual([
        { color: "#fff", position: 0 },
        { color: "#000", position: 1 },
      ]);
      expect(
        normalizeCommandParams("set_gradient_fill", {
          nodeId: "1:1",
          stops: [
            { r: 1, g: 0, b: 0, position: 0 },
            { r: 0, g: 0, b: 1, position: 1 },
          ],
        }).stops,
      ).toEqual([
        { color: { r: 1, g: 0, b: 0 }, position: 0 },
        { color: { r: 0, g: 0, b: 1 }, position: 1 },
      ]);
    });

    it("is idempotent on already-canonical params", () => {
      const canonical = { nodeId: "1:1", gradientType: "ANGULAR", angle: 90, opacity: 0.5, stops: [] as unknown[] };
      expect(normalizeCommandParams("set_gradient_fill", canonical)).toEqual({ ...canonical, aspect_correct: true });
    });
  });

  // ---- item 2: set_auto_layout must not damage existing children ----------
  describe("set_auto_layout", () => {
    it("forwards preserveChildSizing:false verbatim when the caller opts out", async () => {
      mockSendCommand.mockResolvedValue({ id: "1:1", name: "F", layoutMode: "VERTICAL" });
      await callTool("set_auto_layout", { nodeId: "1:1", mode: "VERTICAL", preserveChildSizing: false } as any);
      expect(wire().preserveChildSizing).toBe(false);
    });

    it("forwards padding and gap in one call (the working alternative to set_padding)", async () => {
      mockSendCommand.mockResolvedValue({ id: "1:1", name: "F", layoutMode: "VERTICAL" });
      await callTool("set_auto_layout", {
        nodeId: "1:1",
        mode: "VERTICAL",
        gap: 37,
        left: 21,
        top: 13,
        right: 21,
        bottom: 13,
      } as any);
      const w = wire();
      expect(w.itemSpacing ?? w.gap).toBe(37);
      expect(w.paddingLeft ?? w.left).toBe(21);
      expect(w.paddingTop ?? w.top).toBe(13);
    });
  });

  // ---- D1: strict is the default ----------------------------------------
  describe("strict mode default", () => {
    it("is ON, so a discarded write throws rather than reporting success", () => {
      expect(isStrictModeEnabled()).toBe(true);
      expect(resolveStrict(undefined)).toBe(true);
    });

    it("still allows an explicit per-call opt-out", () => {
      expect(resolveStrict({ strict: false })).toBe(false);
    });
  });
});
