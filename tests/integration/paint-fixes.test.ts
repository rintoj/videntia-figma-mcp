import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../src/videntia_figma_mcp/tools";
import { clearToolRegistry, getRegisteredTool } from "../../src/videntia_figma_mcp/utils/tool-registry";
import { resolveColorWithAlpha } from "../../src/videntia_figma_mcp/utils/color-input";

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

describe("paint fixes", () => {
  let mockSend: jest.Mock;

  beforeEach(() => {
    clearToolRegistry();
    const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSend = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSend.mockClear();
    mockSend.mockResolvedValue({ name: "N", id: "1:1" });
    registerTools(server);
  });

  const call = async (tool: string, args: any) => {
    const entry = getRegisteredTool(tool)!;
    return (await entry.handler(entry.schema.parse(args) as Record<string, unknown>, { meta: {} })) as any;
  };
  const wire = (command: string) => mockSend.mock.calls.find((c) => c[0] === command)?.[1];
  const batchWire = () => mockSend.mock.calls.find((c) => c[0] === "batch_actions")![1].actions[0].params;

  describe("top-level alpha overrides the colour's alpha", () => {
    it("resolveColorWithAlpha", () => {
      expect(resolveColorWithAlpha("#ffffff", 0.1)).toEqual({ r: 1, g: 1, b: 1, a: 0.1 });
      expect(resolveColorWithAlpha("#ffffff80", 1)).toEqual({ r: 1, g: 1, b: 1, a: 1 });
      expect(resolveColorWithAlpha("#ffffff")).toBe("#ffffff");
      expect(resolveColorWithAlpha({ r: 0, g: 0, b: 0 }, 128)).toEqual({ r: 0, g: 0, b: 0, a: 128 / 255 });
    });

    it.each([
      ["set_fill_color", { a: 0.1 }],
      ["set_fill_color", { alpha: 0.1 }],
      ["set_fill_color", { opacity: 0.1 }],
      ["set_stroke_color", { a: 0.1 }],
      ["set_stroke_color", { opacity: 0.1 }],
    ])("%s %j with color '#fff' renders at 10%%", async (tool, extra) => {
      await call(tool, { nodeId: "1:2", color: "#fff", ...extra });
      expect(wire(tool).color).toEqual({ r: 1, g: 1, b: 1, a: 0.1 });
    });

    it("works inside batch_actions too", async () => {
      await call("batch_actions", {
        actions: [{ action: "set_fill_color", params: { nodeId: "1:2", color: "#fff", opacity: 0.1 } }],
        checkpoint: false,
      });
      expect(batchWire().color).toEqual({ r: 1, g: 1, b: 1, a: 0.1 });
    });

    it("set_page_background honours a top-level alpha", async () => {
      await call("set_page_background", { color: "#000000", a: 0.5 });
      expect(wire("set_page_background").color).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    });

    it("without a top-level alpha the hex string still goes through verbatim", async () => {
      await call("set_fill_color", { nodeId: "1:2", color: "#ff000080" });
      expect(wire("set_fill_color").color).toBe("#ff000080");
    });
  });

  describe("set_gradient_fill", () => {
    const stops = [
      { color: "#000", position: 1 },
      { color: "#fff", position: 0 },
    ];

    it("sends a direction keyword instead of an angle", async () => {
      await call("set_gradient_fill", { nodeId: "1:2", stops, direction: "to bottom right" });
      const p = wire("set_gradient_fill");
      expect(p.direction).toBe("to bottom right");
      expect(p.angle).toBeUndefined();
    });

    it("sorts stops by position on the wire", async () => {
      await call("set_gradient_fill", { nodeId: "1:2", stops, angle: 90 });
      expect(wire("set_gradient_fill").stops.map((s: any) => s.position)).toEqual([0, 1]);
    });

    it("rejects an unknown direction at the schema", () => {
      const entry = getRegisteredTool("set_gradient_fill")!;
      expect(() => entry.schema.parse({ nodeId: "1:2", stops, direction: "diagonal" })).toThrow();
    });
  });

  describe("color styles accept {r,g,b,a} gradient stops", () => {
    it.each(["create_color_style", "update_color_style"])("%s normalises stops to RGBA", async (tool) => {
      await call(tool, {
        name: "g/brand",
        styleId: "S:1",
        gradient: {
          type: "LINEAR",
          direction: "r",
          stops: [
            { color: "#0000ff", position: 1 },
            { color: { r: 1, g: 0, b: 0, a: 0.5 }, position: 0 },
          ],
        },
      });
      const g = wire(tool).gradient;
      expect(g.direction).toBe("r");
      expect(g.stops).toEqual([
        { color: { r: 1, g: 0, b: 0, a: 0.5 }, position: 0 },
        { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
      ]);
    });
  });

  describe("image fill scalingFactor", () => {
    it("implies TILE when scaleMode is omitted", async () => {
      await call("set_image_fill", { nodeId: "1:2", imageUrl: "https://example.com/a.png", scalingFactor: 0.5 });
      expect(wire("set_image_fill")).toMatchObject({ scaleMode: "TILE", scalingFactor: 0.5 });
    });

    it("accepts the tileScale alias", async () => {
      await call("set_image_fill", {
        nodeId: "1:2",
        imageUrl: "https://example.com/a.png",
        scaleMode: "TILE",
        tileScale: 2,
      });
      expect(wire("set_image_fill")).toMatchObject({ scaleMode: "TILE", scalingFactor: 2 });
    });

    it("errors with a non-TILE scaleMode", async () => {
      const res = await call("set_image_fill", {
        nodeId: "1:2",
        imageUrl: "https://example.com/a.png",
        scaleMode: "FILL",
        scalingFactor: 2,
      });
      expect(res.content[0].text).toMatch(/only applies to scaleMode TILE/);
      expect(wire("set_image_fill")).toBeUndefined();
    });
  });

  describe("get_text_opentype_features", () => {
    it("formats node-wide and per-range features and states the platform limit", async () => {
      mockSend.mockResolvedValue({
        id: "1:3",
        name: "Price",
        features: "mixed",
        ranges: [
          { start: 0, end: 3, characters: "abc", features: { LIGA: false } },
          { start: 3, end: 6, characters: "123", features: { TNUM: true } },
        ],
        note: "read-only",
      });
      const res = await call("get_text_opentype_features", { nodeId: "1-3" });
      expect(wire("get_text_opentype_features")).toEqual({ nodeId: "1:3" });
      const text = res.content[0].text;
      expect(text).toContain("mixed across ranges");
      expect(text).toContain("[0-3) LIGA=off");
      expect(text).toContain("[3-6) TNUM=on");
    });

    it("its description says features cannot be set", () => {
      expect(getRegisteredTool("get_text_opentype_features")!.description).toMatch(/READ-ONLY/);
    });
  });
});
