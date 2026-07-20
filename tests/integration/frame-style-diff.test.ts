import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerComparisonTools } from "../../src/videntia_figma_mcp/tools/comparison-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  sendCommandToChannel: jest.fn(),
}));
jest.mock("../../src/videntia_figma_mcp/utils/find-node-in-page", () => ({
  findNodeInPage: jest.fn(),
}));

// Hero-like frame: root (auto-layout) with a pill child and a text child.
const FIGMA_TREE = {
  id: "1:1",
  name: "Hero",
  type: "FRAME",
  layoutMode: "VERTICAL",
  primaryAxisAlignItems: "MIN",
  counterAxisAlignItems: "CENTER",
  itemSpacing: 24,
  absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 400 },
  children: [
    {
      id: "1:2",
      name: "Pill",
      type: "INSTANCE",
      strokeWeight: 1,
      strokes: [{ type: "SOLID", color: { r: 0.816, g: 0.8, b: 0.769 } }], // #d0ccc4
      cornerRadius: 999,
      absoluteBoundingBox: { x: 283, y: 20, width: 234, height: 32 },
      children: [
        {
          id: "1:3",
          name: "Label",
          type: "TEXT",
          characters: "500+ certified",
          fontSize: 12,
          fontWeight: 400,
          fontFamily: "Aspekta",
          lineHeight: 24,
          textAlignHorizontal: "CENTER",
          fills: [{ type: "SOLID", color: { r: 0.137, g: 0.149, b: 0.149 } }],
          absoluteBoundingBox: { x: 295, y: 24, width: 210, height: 24 },
        },
      ],
    },
    {
      id: "1:4",
      name: "Heading",
      type: "TEXT",
      characters: "A trusted appraiser",
      fontSize: 48,
      fontWeight: 400,
      fontFamily: "Aspekta",
      lineHeight: 56,
      textAlignHorizontal: "CENTER",
      fills: [{ type: "SOLID", color: { r: 0.031, g: 0.231, b: 0.22 } }], // #083b38
      absoluteBoundingBox: { x: 100, y: 80, width: 600, height: 112 },
    },
  ],
};

const DOM_RECTS = {
  nodes: [
    {
      idx: 0,
      parent: -1,
      tag: "section",
      id: null,
      testId: null,
      depth: 0,
      rect: { x: 0, y: 0, w: 800, h: 400 },
      selector: "section",
      text: null,
    },
    {
      idx: 1,
      parent: 0,
      tag: "span",
      id: null,
      testId: null,
      depth: 1,
      rect: { x: 283, y: 20, w: 234, h: 32 },
      selector: "section > span",
      text: "500+ certified",
    },
    {
      idx: 2,
      parent: 0,
      tag: "h1",
      id: null,
      testId: null,
      depth: 1,
      rect: { x: 100, y: 80, w: 600, h: 112 },
      selector: "section > h1",
      text: "A trusted appraiser",
    },
  ],
  truncated: false,
  dpr: 2,
};

const BATCH_RESPONSE = {
  dpr: 2,
  truncated: false,
  results: [
    {
      selector: "section",
      found: true,
      rect: { x: 0, y: 0, width: 800, height: 400 },
      // Wrong gap (32 vs Figma 24) — a real layout mismatch to surface.
      styles: { display: "flex", "flex-direction": "column", "align-items": "center", gap: "32px" },
      parentStyles: { display: "block" },
      className: "flex flex-col items-center gap-8",
    },
    {
      selector: "section > span",
      found: true,
      rect: { x: 283, y: 20, width: 228, height: 32 },
      // Wrong border color (#e2e1df vs Figma #d0ccc4).
      styles: {
        "border-color": "rgb(226, 225, 223)",
        "border-width": "1px",
        "border-radius": "999px",
        "font-size": "12px",
        "line-height": "24px",
        color: "rgb(35, 38, 38)",
        "text-align": "center",
      },
      parentStyles: { display: "flex", "flex-direction": "column", "align-items": "center", gap: "32px" },
      className: "inline-flex rounded-full",
    },
    {
      selector: "section > h1",
      found: true,
      rect: { x: 100, y: 80, width: 600, height: 112 },
      // Fully matching.
      styles: {
        "font-size": "48px",
        "line-height": "56px",
        "font-weight": "400",
        "font-family": "Aspekta, sans-serif",
        color: "rgb(8, 59, 56)",
        "text-align": "center",
      },
      parentStyles: { display: "flex", "flex-direction": "column", "align-items": "center", gap: "32px" },
      className: "font-sans",
    },
  ],
};

describe("diff_figma_frame_to_page — include_style_diff", () => {
  let server: McpServer;
  let mockSendToFigma: jest.Mock;
  let mockSendToChannel: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" }, { capabilities: { tools: {} } });
    const ws = require("../../src/videntia_figma_mcp/utils/websocket");
    mockSendToFigma = ws.sendCommandToFigma;
    mockSendToChannel = ws.sendCommandToChannel;
    mockSendToFigma.mockReset();
    mockSendToChannel.mockReset();

    toolHandlers = new Map();
    toolSchemas = new Map();
    const original = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, , schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (original as any)(...args);
    });

    registerComparisonTools(server);
  });

  async function callTool(name: string, args: any = {}) {
    const schema = toolSchemas.get(name);
    const handler = toolHandlers.get(name);
    if (!schema || !handler) throw new Error(`Tool ${name} not found`);
    return await handler(schema.parse(args), { meta: {} });
  }

  function mockHappyPath() {
    mockSendToFigma.mockResolvedValueOnce({ nodes: [FIGMA_TREE] }); // get_node_info
    mockSendToChannel.mockImplementation(async (_channel: string, command: string) => {
      if (command === "collect_all_element_rects") return DOM_RECTS;
      if (command === "get_computed_styles_batch") return BATCH_RESPONSE;
      throw new Error(`unexpected channel command ${command}`);
    });
  }

  it("returns geometry-only output when include_style_diff is false", async () => {
    mockHappyPath();
    const result = await callTool("diff_figma_frame_to_page", {
      frame_node_id: "1:1",
      root_selector: "section",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.styleDiff).toBeUndefined();
    expect(parsed.summary.matched).toBeGreaterThan(0);
    const commands = mockSendToChannel.mock.calls.map((c) => c[1]);
    expect(commands).not.toContain("get_computed_styles_batch");
  });

  it("emits mismatch-only style rows for matched pairs", async () => {
    mockHappyPath();
    const result = await callTool("diff_figma_frame_to_page", {
      frame_node_id: "1:1",
      root_selector: "section",
      include_style_diff: true,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.styleDiff).toBeDefined();
    const { summary, mismatches } = parsed.styleDiff;
    expect(summary.pairsWithStyleData).toBeGreaterThan(0);

    // The fully-matching h1 must NOT appear.
    expect(mismatches.find((m: any) => m.selector === "section > h1")).toBeUndefined();

    // The root frame's own layout mismatch (gap 24 vs 32) must surface.
    const root = mismatches.find((m: any) => m.selector === "section");
    expect(root).toBeDefined();
    expect(root.rows.find((r: any) => r.property === "gap")).toMatchObject({
      figma: "24px",
      browser: "32px",
      severity: "error",
    });

    // The pill's real border-color mismatch must surface.
    const pill = mismatches.find((m: any) => m.selector === "section > span");
    expect(pill).toBeDefined();
    const borderRow = pill.rows.find((r: any) => r.property === "border-color");
    expect(borderRow).toMatchObject({ figma: "#d0ccc4", browser: "#e2e1df", severity: "error" });

    // Every emitted row is a mismatch (no ✓ rows leak through).
    for (const m of mismatches) {
      for (const r of m.rows) {
        expect(["error", "warn"]).toContain(r.severity);
      }
    }
  });

  it("batches one computed-styles call for all pairs", async () => {
    mockHappyPath();
    await callTool("diff_figma_frame_to_page", {
      frame_node_id: "1:1",
      root_selector: "section",
      include_style_diff: true,
    });
    const batchCalls = mockSendToChannel.mock.calls.filter((c) => c[1] === "get_computed_styles_batch");
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0][2].includeParent).toBe(true);
    expect(batchCalls[0][2].includeClass).toBe(true);
    expect(Array.isArray(batchCalls[0][2].selectors)).toBe(true);
  });

  it("respects max_style_nodes cap", async () => {
    mockHappyPath();
    await callTool("diff_figma_frame_to_page", {
      frame_node_id: "1:1",
      root_selector: "section",
      include_style_diff: true,
      max_style_nodes: 1,
    });
    const batchCalls = mockSendToChannel.mock.calls.filter((c) => c[1] === "get_computed_styles_batch");
    expect(batchCalls[0][2].selectors).toHaveLength(1);
  });

  it("flags stale selectors whose fresh rect diverges from the audit rect", async () => {
    mockSendToFigma.mockResolvedValueOnce({ nodes: [FIGMA_TREE] });
    const staleBatch = JSON.parse(JSON.stringify(BATCH_RESPONSE));
    // Pill moved far away between rect collection and style fetch.
    staleBatch.results[1].rect = { x: 0, y: 2000, width: 228, height: 32 };
    mockSendToChannel.mockImplementation(async (_channel: string, command: string) => {
      if (command === "collect_all_element_rects") return DOM_RECTS;
      if (command === "get_computed_styles_batch") return staleBatch;
      throw new Error(`unexpected channel command ${command}`);
    });

    const result = await callTool("diff_figma_frame_to_page", {
      frame_node_id: "1:1",
      root_selector: "section",
      include_style_diff: true,
    });
    const parsed = JSON.parse(result.content[0].text);
    const pill = parsed.styleDiff.mismatches.find((m: any) => m.selector === "section > span");
    expect(pill.stale).toBe(true);
  });

  it("degrades gracefully when the batch command errors", async () => {
    mockSendToFigma.mockResolvedValueOnce({ nodes: [FIGMA_TREE] });
    mockSendToChannel.mockImplementation(async (_channel: string, command: string) => {
      if (command === "collect_all_element_rects") return DOM_RECTS;
      if (command === "get_computed_styles_batch") return { error: "extension not connected" };
      throw new Error(`unexpected channel command ${command}`);
    });

    const result = await callTool("diff_figma_frame_to_page", {
      frame_node_id: "1:1",
      root_selector: "section",
      include_style_diff: true,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.styleDiff).toBeUndefined();
    expect(parsed.warnings.join(" ")).toMatch(/style diff skipped/);
    // Geometry output still intact.
    expect(parsed.summary.matched).toBeGreaterThan(0);
  });
});

describe("diff_figma_frame_to_page — token suggestions", () => {
  let server: McpServer;
  let mockSendToFigma: jest.Mock;
  let mockSendToChannel: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" }, { capabilities: { tools: {} } });
    const ws = require("../../src/videntia_figma_mcp/utils/websocket");
    mockSendToFigma = ws.sendCommandToFigma;
    mockSendToChannel = ws.sendCommandToChannel;
    mockSendToFigma.mockReset();
    mockSendToChannel.mockReset();

    toolHandlers = new Map();
    toolSchemas = new Map();
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, , schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return server as any;
    });

    registerComparisonTools(server);
  });

  async function callTool(name: string, args: any = {}) {
    const schema = toolSchemas.get(name);
    const handler = toolHandlers.get(name);
    if (!schema || !handler) throw new Error(`Tool ${name} not found`);
    return await handler(schema.parse(args), { meta: {} });
  }

  it("names the browser-side color when it matches a Figma variable", async () => {
    mockSendToFigma.mockImplementation(async (command: string) => {
      if (command === "get_node_info") return { nodes: [FIGMA_TREE] };
      if (command === "get_variables") {
        return {
          variables: [
            {
              id: "V:1",
              name: "neutral-300",
              type: "COLOR",
              values: [{ modeId: "m1", value: { r: 226 / 255, g: 225 / 255, b: 223 / 255, a: 1 } }],
            },
            {
              id: "V:2",
              name: "gold-200",
              type: "COLOR",
              values: [{ modeId: "m1", value: { r: 208 / 255, g: 204 / 255, b: 196 / 255, a: 1 } }],
            },
          ],
        };
      }
      throw new Error(`unexpected figma command ${command}`);
    });
    mockSendToChannel.mockImplementation(async (_c: string, command: string) => {
      if (command === "collect_all_element_rects") return DOM_RECTS;
      if (command === "get_computed_styles_batch") return BATCH_RESPONSE;
      throw new Error(`unexpected channel command ${command}`);
    });

    const result = await callTool("diff_figma_frame_to_page", {
      frame_node_id: "1:1",
      root_selector: "section",
      include_style_diff: true,
      include_token_suggestions: true,
    });
    const parsed = JSON.parse(result.content[0].text);
    const pill = parsed.styleDiff.mismatches.find((m: any) => m.selector === "section > span");
    const borderRow = pill.rows.find((r: any) => r.property === "border-color");
    expect(borderRow.note).toMatch(/browser ≈ neutral-300/);
  });
});

describe("diff_figma_frame_to_page — annotation map", () => {
  let server: McpServer;
  let mockSendToFigma: jest.Mock;
  let mockSendToChannel: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" }, { capabilities: { tools: {} } });
    const ws = require("../../src/videntia_figma_mcp/utils/websocket");
    mockSendToFigma = ws.sendCommandToFigma;
    mockSendToChannel = ws.sendCommandToChannel;
    mockSendToFigma.mockReset();
    mockSendToChannel.mockReset();

    toolHandlers = new Map();
    toolSchemas = new Map();
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, , schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return server as any;
    });

    registerComparisonTools(server);
  });

  async function callTool(name: string, args: any = {}) {
    const schema = toolSchemas.get(name);
    const handler = toolHandlers.get(name);
    if (!schema || !handler) throw new Error(`Tool ${name} not found`);
    return await handler(schema.parse(args), { meta: {} });
  }

  it("suggests annotations for geometry-matched pairs and lists unmatched nodes", async () => {
    mockSendToFigma.mockResolvedValueOnce({ nodes: [FIGMA_TREE] });
    mockSendToChannel.mockImplementation(async (_c: string, command: string) => {
      if (command === "collect_all_element_rects") return DOM_RECTS;
      throw new Error(`unexpected channel command ${command}`);
    });

    const result = await callTool("diff_figma_frame_to_page", {
      frame_node_id: "1:1",
      root_selector: "section",
      annotation_map: true,
    });
    const parsed = JSON.parse(result.content[0].text);
    const { suggested, unmatched } = parsed.annotationMap;

    // Geometry-matched pill and heading become ready-to-apply suggestions.
    const pill = suggested.find((s: any) => s.figmaId === "1:2");
    expect(pill).toMatchObject({ selector: "section > span", tag: "span" });
    expect(pill.apply).toBe('add data-fig-id="1:2" to <span> at section > span');
    const heading = suggested.find((s: any) => s.figmaId === "1:4");
    expect(heading).toMatchObject({ selector: "section > h1" });
    expect(heading.text).toMatch(/trusted appraiser/);

    // The pill's inner label had no DOM mate — listed for manual mapping.
    expect(unmatched["1:3"]).toMatchObject({ name: "Label" });
  });

  it("excludes fig-id-matched pairs from suggestions", async () => {
    mockSendToFigma.mockResolvedValueOnce({ nodes: [FIGMA_TREE] });
    const annotatedRects = JSON.parse(JSON.stringify(DOM_RECTS));
    annotatedRects.nodes[1].figId = "1:2"; // pill already annotated
    mockSendToChannel.mockImplementation(async (_c: string, command: string) => {
      if (command === "collect_all_element_rects") return annotatedRects;
      throw new Error(`unexpected channel command ${command}`);
    });

    const result = await callTool("diff_figma_frame_to_page", {
      frame_node_id: "1:1",
      root_selector: "section",
      annotation_map: true,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.annotationMap.suggested.find((s: any) => s.figmaId === "1:2")).toBeUndefined();
  });
});
