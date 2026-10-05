// This suite asserts on the FULL standalone tool surface (it captures handlers by
// spying on `server.tool`), so it opts out of progressive tool discovery — see
// src/videntia_figma_mcp/utils/tool-modes.ts.
process.env.VIDENTIA_FIGMA_TOOLS = "all";

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../src/videntia_figma_mcp/tools";
import { clearToolRegistry } from "../../src/videntia_figma_mcp/utils/tool-registry";
import { fontStyleCandidates } from "../../src/videntia_figma_plugin/handlers/text";
import { isStrictModeEnabled, resolveStrict } from "../../src/videntia_figma_plugin/utils/write-verify";

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
    clearToolRegistry();
    registerTools(server);
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
      expect(wire().angle).toBe(180);
      expect(wire().opacity).toBe(1);
    });

    it("accepts a lowercase type and defaults angle/opacity/aspect_correct", async () => {
      await callTool("set_gradient_fill", {
        nodeId: "1-1",
        type: "linear",
        stops: [
          { color: "#ff0000", position: 0 },
          { color: "#0000ff", position: 1 },
        ],
      });
      expect(wire()).toMatchObject({
        nodeId: "1:1",
        gradientType: "LINEAR",
        angle: 180,
        opacity: 1,
        aspect_correct: true,
      });
    });

    it("accepts the colors shorthand and bare colour stops", async () => {
      // These loose spellings used to be accepted ONLY inside a batch (the old
      // normaliser widened them there). They now live on the schema, so standalone and
      // batch take the same input.
      await callTool("set_gradient_fill", { nodeId: "1:1", colors: ["#ffffff", "#000000"] });
      expect(wire().stops).toEqual([
        { color: { r: 1, g: 1, b: 1, a: 1 }, position: 0 },
        { color: { r: 0, g: 0, b: 0, a: 1 }, position: 1 },
      ]);

      mockSendCommand.mockClear();
      await callTool("set_gradient_fill", { nodeId: "1:1", stops: ["#ffffff", "#000000"] });
      expect(wire().stops.map((s: any) => s.position)).toEqual([0, 1]);
    });

    it("parses a JSON-string stops array and flat rgba stops", async () => {
      await callTool("set_gradient_fill", {
        nodeId: "1:1",
        stops: '[{"color":"#ffffff","position":0},{"color":"#000000","position":1}]',
      });
      expect(wire().stops).toHaveLength(2);

      mockSendCommand.mockClear();
      await callTool("set_gradient_fill", {
        nodeId: "1:1",
        stops: [
          { r: 1, g: 0, b: 0, position: 0 },
          { r: 0, g: 0, b: 1, position: 1 },
        ],
      });
      expect(wire().stops[0].color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
      expect(wire().stops[1].color).toEqual({ r: 0, g: 0, b: 1, a: 1 });
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
