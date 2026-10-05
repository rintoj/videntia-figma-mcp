import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerVerificationTools } from "../../src/videntia_figma_mcp/tools/verification-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
  getOpenChannels: jest.fn().mockResolvedValue([]),
}));

const WHITE = { type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1 };
const solid = (r: number, g: number, b: number) => ({ type: "SOLID", color: { r, g, b, a: 1 }, opacity: 1 });

describe("verification tools", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  const toolHandlers = new Map<string, Function>();
  const toolSchemas = new Map<string, z.ZodObject<any>>();

  beforeEach(() => {
    toolHandlers.clear();
    toolSchemas.clear();
    server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();

    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, , schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });

    registerVerificationTools(server);
  });

  async function callTool(name: string, args: any) {
    const schema = toolSchemas.get(name);
    const handler = toolHandlers.get(name);
    if (!schema || !handler) throw new Error(`Tool ${name} not found`);
    return await handler(schema.parse(args), { meta: {} });
  }

  it("registers all five verification tools", () => {
    expect([...toolHandlers.keys()].sort()).toEqual([
      "assert_node_state",
      "check_token_collisions",
      "contrast_check_frame",
      "find_overlaps",
      "find_unbound",
    ]);
  });

  // ── contrast_check_frame ───────────────────────────────────────────────────
  describe("contrast_check_frame", () => {
    const payload = (fills: any[]) => ({
      nodeId: "1:1",
      nodeName: "Checkout",
      nodesScanned: 12,
      truncated: false,
      samples: [
        {
          nodeId: "2:2",
          nodeName: "Disclaimer",
          characters: "Do not drive while dosed",
          fontSize: 14,
          bounds: { x: 0, y: 0, width: 200, height: 20 },
          fills,
          backdrop: [
            { nodeId: "1:1", nodeName: "Screen", bounds: { x: 0, y: 0, width: 400, height: 800 }, fills: [WHITE] },
          ],
        },
      ],
    });

    it("reports a PASS verdict for high-contrast text", async () => {
      mockSendCommand.mockResolvedValue(payload([solid(0, 0, 0)]));
      const res = await callTool("contrast_check_frame", { nodeId: "1:1" });
      expect(res.content[0].text).toContain("**Verdict:** PASS");
      expect(res.content[0].text).toContain("21:1");
    });

    it("fails a safety-critical string at 4.35:1", async () => {
      mockSendCommand.mockResolvedValue(payload([solid(0.58, 0.58, 0.58)]));
      const res = await callTool("contrast_check_frame", { nodeId: "1:1" });
      const text = res.content[0].text;
      expect(text).toContain("**Verdict:** FAIL");
      expect(text).toContain("**FAIL**");
      expect(text).toContain("Do not drive while dosed");
    });

    it("honours failures_only and the AAA standard", async () => {
      mockSendCommand.mockResolvedValue(payload([solid(0, 0, 0)]));
      const res = await callTool("contrast_check_frame", { nodeId: "1:1", failures_only: true, standard: "AAA" });
      expect(res.content[0].text).toContain("Failing AAA:** 0");
      expect(res.content[0].text).toContain("_No text nodes to report._");
    });

    it("normalizes the node id before sending", async () => {
      mockSendCommand.mockResolvedValue(payload([solid(0, 0, 0)]));
      await callTool("contrast_check_frame", { nodeId: "1-1" });
      expect(mockSendCommand).toHaveBeenCalledWith(
        "contrast_check_frame",
        expect.objectContaining({ nodeId: "1:1" }),
        60000,
      );
    });

    const onImage = {
      nodeId: "3:3",
      nodeName: "HeroTitle",
      characters: "Welcome",
      fontSize: 32,
      bounds: { x: 10, y: 10, width: 100, height: 40 },
      fills: [solid(1, 1, 1)],
      stack: {
        nodeId: "0:1",
        nodeName: "Page",
        fills: [WHITE],
        children: [
          {
            nodeId: "4:4",
            nodeName: "Photo",
            bounds: { x: 0, y: 0, width: 400, height: 400 },
            fills: [{ type: "IMAGE", imageHash: "img1", scaleMode: "FILL" }],
          },
          { nodeId: "3:3", nodeName: "HeroTitle", bounds: { x: 10, y: 10, width: 100, height: 40 }, target: true },
        ],
      },
    };

    it("reports text over an unfetchable image as indeterminate with the reason, not as a failure", async () => {
      const base = payload([solid(0, 0, 0)]);
      mockSendCommand.mockResolvedValue({
        ...base,
        samples: [...base.samples, onImage],
        images: { img1: { error: "image not found in this file" } },
      });
      const text = (await callTool("contrast_check_frame", { nodeId: "1:1" })).content[0].text;
      expect(text).toContain("**Indeterminate:** 1");
      expect(text).toContain("**Images sampled:** 0/1");
      expect(text).toContain("**Verdict:** PASS (1 indeterminate — verify visually)");
      expect(text).toContain("## Indeterminate (1) — verify with export_node_as_image");
      expect(text).toContain(
        'HeroTitle (3:3): IMAGE paint on "Photo" (4:4) (image not found in this file) sits behind the text',
      );
      expect(text).not.toMatch(/\| HeroTitle/);
    });

    it("samples the image pixels behind text when the plugin ships the bytes", async () => {
      const sharp = (await import("sharp")).default;
      const png = await sharp({
        create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
      })
        .png()
        .toBuffer();
      const base = payload([solid(0, 0, 0)]);
      mockSendCommand.mockResolvedValue({
        ...base,
        samples: [...base.samples, onImage],
        images: { img1: { base64: png.toString("base64"), bytes: png.length } },
      });
      const text = (await callTool("contrast_check_frame", { nodeId: "1:1" })).content[0].text;
      expect(text).toContain("**Indeterminate:** 0");
      expect(text).toContain("**Images sampled:** 1/1");
      expect(text).toMatch(/\| HeroTitle \(3:3\) \| Welcome \| 32 lg \| #FFFFFF \| #000000 \| 21:1 \| 3:1 \| PASS \|/i);
      expect(text).toContain('backdrop includes image on "Photo" (4:4) (sampled)');
    });

    it("keeps listing indeterminate nodes under failures_only", async () => {
      const base = payload([solid(0.58, 0.58, 0.58)]);
      mockSendCommand.mockResolvedValue({ ...base, samples: [...base.samples, onImage] });
      const text = (await callTool("contrast_check_frame", { nodeId: "1:1", failures_only: true })).content[0].text;
      expect(text).toContain("**Verdict:** FAIL (1 indeterminate");
      expect(text).toContain("Do not drive while dosed");
      expect(text).toContain("## Indeterminate (1)");
    });

    it("lists failing segments of mixed-style text compactly", async () => {
      const base = payload([]);
      const mixed = {
        ...base.samples[0],
        characters: "Price $10",
        segments: [
          { start: 0, end: 6, characters: "Price ", fontSize: 14, fills: [solid(0, 0, 0)] },
          { start: 6, end: 9, characters: "$10", fontSize: 14, fills: [solid(0.8, 0.8, 0.8)] },
        ],
      };
      mockSendCommand.mockResolvedValue({ ...base, samples: [mixed] });
      const text = (await callTool("contrast_check_frame", { nodeId: "1:1" })).content[0].text;
      expect(text).toContain("**Verdict:** FAIL");
      expect(text).toContain("[2 segs]");
      expect(text).toContain("## Segments");
      expect(text).toMatch(/0-6 #000000\/#ffffff 21:1 ok · 6-9 #cccccc\/#ffffff [\d.]+:1 FAIL/i);
    });

    it("surfaces transport errors", async () => {
      mockSendCommand.mockRejectedValue(new Error("no channel"));
      const res = await callTool("contrast_check_frame", { nodeId: "1:1" });
      expect(res.content[0].text).toContain("Error running contrast sweep: no channel");
    });
  });

  // ── find_overlaps ──────────────────────────────────────────────────────────
  describe("find_overlaps", () => {
    const nodes = [
      {
        nodeId: "a",
        nodeName: "Caption",
        nodeType: "TEXT",
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        parentId: "p",
        parentName: "Row",
      },
      {
        nodeId: "b",
        nodeName: "Screenshot",
        nodeType: "RECTANGLE",
        bounds: { x: 20, y: 10, width: 100, height: 40 },
        parentId: "p",
        parentName: "Row",
      },
    ];

    it("reports the overlapping pair", async () => {
      mockSendCommand.mockResolvedValue({ nodeId: "p", nodeName: "Row", nodesScanned: 3, nodes });
      const res = await callTool("find_overlaps", { frameId: "p" });
      expect(res.content[0].text).toContain("Caption");
      expect(res.content[0].text).toContain("Screenshot");
      expect(res.content[0].text).toContain("Overlapping pairs:** 1");
    });

    it("reports nothing when a min_overlap_ratio excludes it", async () => {
      mockSendCommand.mockResolvedValue({ nodeId: "p", nodeName: "Row", nodesScanned: 3, nodes });
      const res = await callTool("find_overlaps", { frameId: "p", min_overlap_ratio: 0.9 });
      expect(res.content[0].text).toContain("No sibling overlaps detected.");
    });

    it("passes ignore_hidden through to the plugin", async () => {
      mockSendCommand.mockResolvedValue({ nodeId: "p", nodeName: "Row", nodesScanned: 0, nodes: [] });
      await callTool("find_overlaps", { frameId: "p", ignore_hidden: false });
      expect(mockSendCommand).toHaveBeenCalledWith(
        "find_overlaps",
        expect.objectContaining({ ignore_hidden: false }),
        60000,
      );
    });
  });

  // ── assert_node_state ──────────────────────────────────────────────────────
  describe("assert_node_state", () => {
    it("passes when the write landed", async () => {
      mockSendCommand.mockResolvedValue({
        nodeId: "3:3",
        nodeName: "Card",
        nodeType: "FRAME",
        expected: {},
        actual: { cornerRadius: 24, fill: { r: 1, g: 0, b: 0, a: 1 } },
      });
      const res = await callTool("assert_node_state", {
        nodeId: "3:3",
        expected: { cornerRadius: 24, fill: "#ff0000" },
      });
      expect(res.content[0].text).toContain("PASS — all assertions hold");
    });

    it("fails and shows the diff when the write silently no-oped", async () => {
      mockSendCommand.mockResolvedValue({
        nodeId: "3:3",
        nodeName: "Card",
        nodeType: "FRAME",
        expected: {},
        actual: { cornerRadius: 0 },
      });
      const res = await callTool("assert_node_state", { nodeId: "3:3", expected: { cornerRadius: 24 } });
      const text = res.content[0].text;
      expect(text).toContain("FAIL — the write did not land");
      expect(text).toContain("**MISMATCH**");
    });

    it("marks an absent property clearly", async () => {
      mockSendCommand.mockResolvedValue({
        nodeId: "3:3",
        nodeName: "Card",
        nodeType: "FRAME",
        expected: {},
        actual: {},
      });
      const res = await callTool("assert_node_state", { nodeId: "3:3", expected: { itemSpacing: 8 } });
      expect(res.content[0].text).toContain("_(absent)_");
    });
  });

  // ── find_unbound ───────────────────────────────────────────────────────────
  describe("find_unbound", () => {
    it("groups unbound values by role", async () => {
      mockSendCommand.mockResolvedValue({
        nodeId: "1:1",
        nodeName: "Screen",
        totalNodes: 40,
        totalUnbound: 2,
        suppressed: 3,
        capped: false,
        groups: {
          fill: [
            {
              nodeId: "a",
              nodeName: "Badge",
              nodeType: "FRAME",
              property: "fills[0]",
              severity: "HIGH",
              message: "raw hex",
            },
          ],
          radius: [
            {
              nodeId: "b",
              nodeName: "Card",
              nodeType: "FRAME",
              property: "cornerRadius",
              severity: "MEDIUM",
              message: "raw 12",
            },
          ],
        },
      });
      const res = await callTool("find_unbound", { frameId: "1:1" });
      const text = res.content[0].text;
      expect(text).toContain("## fill (1)");
      expect(text).toContain("## radius (1)");
      expect(text).toContain("Suppressed:** 3");
    });

    it("says so when everything is bound", async () => {
      mockSendCommand.mockResolvedValue({
        nodeId: "1:1",
        nodeName: "Screen",
        totalNodes: 5,
        totalUnbound: 0,
        suppressed: 0,
        capped: false,
        groups: {},
      });
      const res = await callTool("find_unbound", { frameId: "1:1" });
      expect(res.content[0].text).toContain("Everything is bound to a token.");
    });

    it("forwards ignore_rules", async () => {
      mockSendCommand.mockResolvedValue({
        nodeId: "1:1",
        nodeName: "S",
        totalNodes: 1,
        totalUnbound: 0,
        suppressed: 0,
        capped: false,
        groups: {},
      });
      await callTool("find_unbound", { frameId: "1:1", ignore_rules: ["backgroundFills"] });
      expect(mockSendCommand).toHaveBeenCalledWith(
        "find_unbound",
        expect.objectContaining({ ignore_rules: ["backgroundFills"] }),
        60000,
      );
    });
  });

  // ── check_token_collisions ─────────────────────────────────────────────────
  describe("check_token_collisions", () => {
    const records = [
      {
        collectionId: "c1",
        collectionName: "theme",
        variableId: "V:1",
        name: "theme/radius/3xl",
        resolvedType: "FLOAT",
        valuesByMode: { Default: 28 },
      },
      {
        collectionId: "c2",
        collectionName: "Radius",
        variableId: "V:2",
        name: "Radius/radius/3xl",
        resolvedType: "FLOAT",
        valuesByMode: { Default: 24 },
      },
    ];

    it("reports the 28-vs-24 collision as a FAIL", async () => {
      mockSendCommand.mockResolvedValue({ collections: 2, variables: 2, records });
      const res = await callTool("check_token_collisions", {});
      const text = res.content[0].text;
      expect(text).toContain("**Verdict:** FAIL");
      expect(text).toContain("`radius/3xl`");
      expect(text).toContain("| theme | theme/radius/3xl (V:1) | 28 |");
      expect(text).toContain("| Radius | Radius/radius/3xl (V:2) | 24 |");
    });

    it("passes when there is no conflict", async () => {
      mockSendCommand.mockResolvedValue({ collections: 1, variables: 1, records: [records[0]] });
      const res = await callTool("check_token_collisions", {});
      expect(res.content[0].text).toContain("**Verdict:** PASS");
    });

    it("applies name_filter", async () => {
      mockSendCommand.mockResolvedValue({ collections: 2, variables: 2, records });
      const res = await callTool("check_token_collisions", { name_filter: "spacing" });
      expect(res.content[0].text).toContain("**Verdict:** PASS");
    });
  });
});
