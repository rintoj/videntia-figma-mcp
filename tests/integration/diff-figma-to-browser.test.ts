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

describe("diff_figma_to_browser tool", () => {
  let server: McpServer;
  let mockSendToFigma: jest.Mock;
  let mockSendToChannel: jest.Mock;
  let mockFindNodeInPage: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" }, { capabilities: { tools: {} } });
    const ws = require("../../src/videntia_figma_mcp/utils/websocket");
    mockSendToFigma = ws.sendCommandToFigma;
    mockSendToChannel = ws.sendCommandToChannel;
    mockSendToFigma.mockReset();
    mockSendToChannel.mockReset();
    mockFindNodeInPage = require("../../src/videntia_figma_mcp/utils/find-node-in-page").findNodeInPage;
    mockFindNodeInPage.mockReset();

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

  it("registers diff_figma_to_browser", () => {
    expect(toolHandlers.has("diff_figma_to_browser")).toBe(true);
  });

  it("flags a line-height mismatch and confirms font-size match on a pricing-card title", async () => {
    mockSendToFigma.mockResolvedValueOnce({
      nodes: [
        {
          id: "123:456",
          name: "Title",
          type: "TEXT",
          characters: "Pro plan",
          fontSize: 14,
          fontWeight: 600,
          fontFamily: "Inter",
          lineHeight: 18,
          textAlignHorizontal: "LEFT",
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 24 },
        },
      ],
    });
    // get_computed_styles_batch (unavailable — exercises legacy fallback)
    mockSendToChannel.mockResolvedValueOnce({ results: [] });
    // get_computed_styles
    mockSendToChannel.mockResolvedValueOnce({
      styles: {
        "font-size": "14px",
        "line-height": "16px",
        "font-weight": "600",
        "font-family": "Inter, sans-serif",
        color: "rgb(0, 0, 0)",
        "text-align": "left",
      },
    });
    // get_dom_nodes
    mockSendToChannel.mockResolvedValueOnce({
      nodes: [{ rect: { width: 200, height: 24 } }],
    });

    const result = await callTool("diff_figma_to_browser", {
      figma_node_id: "123:456",
      css_selector: ".pricing-card__title",
      properties: ["font-size", "line-height", "color"],
    });

    const text: string = result.content[0].text;
    const parsed = JSON.parse(text);
    const byProp = new Map(parsed.rows.map((r: any) => [r.property, r]));

    expect(byProp.get("font-size")).toMatchObject({ status: "✓", figma: "14px", browser: "14px" });
    expect(byProp.get("line-height")).toMatchObject({ status: "❌", figma: "18px", browser: "16px" });
    expect(byProp.get("color")).toMatchObject({ status: "✓" });
    expect(parsed.matchedVia).toBe("explicit");
  });

  it("warns when selector matches multiple elements", async () => {
    mockSendToFigma.mockResolvedValueOnce({
      nodes: [{ id: "1:1", type: "TEXT", fontSize: 14 }],
    });
    mockSendToChannel.mockResolvedValueOnce({ results: [] }); // batch unavailable
    mockSendToChannel.mockResolvedValueOnce({
      styles: { "font-size": "14px" },
      count: 3,
    });
    mockSendToChannel.mockResolvedValueOnce({ nodes: [] });

    const result = await callTool("diff_figma_to_browser", {
      figma_node_id: "1:1",
      css_selector: ".item",
      properties: ["font-size"],
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/matched 3 elements/)]));
  });

  it("finds the first TEXT descendant when target is a container", async () => {
    mockSendToFigma.mockResolvedValueOnce({
      nodes: [
        {
          id: "10:1",
          type: "FRAME",
          name: "Card",
          children: [
            {
              id: "10:2",
              type: "TEXT",
              name: "Heading",
              fontSize: 20,
              fontWeight: 700,
              fontFamily: "Inter",
              fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
            },
          ],
          absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 180 },
          fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
        },
      ],
    });
    mockSendToChannel.mockResolvedValueOnce({ results: [] }); // batch unavailable
    mockSendToChannel.mockResolvedValueOnce({
      styles: {
        "font-size": "20px",
        "background-color": "rgb(255, 255, 255)",
      },
    });
    mockSendToChannel.mockResolvedValueOnce({ nodes: [{ rect: { width: 320, height: 180 } }] });

    const result = await callTool("diff_figma_to_browser", {
      figma_node_id: "10:1",
      css_selector: ".card",
      properties: ["font-size", "background-color", "width"],
    });
    const parsed = JSON.parse(result.content[0].text);
    const byProp = new Map(parsed.rows.map((r: any) => [r.property, r]));
    expect(byProp.get("font-size")).toMatchObject({ status: "✓", figma: "20px" });
    expect(byProp.get("background-color")).toMatchObject({ status: "✓" });
    expect(byProp.get("width")).toMatchObject({ status: "✓", figma: "320px" });
    expect(parsed.textNodeId).toBe("10:2");
  });

  it("auto-locates the selector via image template when css_selector is omitted", async () => {
    mockSendToFigma
      // get_node_info
      .mockResolvedValueOnce({
        nodes: [
          {
            id: "5:5",
            type: "TEXT",
            fontSize: 14,
            fontWeight: 600,
            fontFamily: "Inter",
            fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
            absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 24 },
          },
        ],
      })
      // export_node_as_image
      .mockResolvedValueOnce({ imageData: Buffer.from("ref").toString("base64") });

    mockSendToChannel
      // get_computed_styles_batch fig-id probe (no annotation on the page)
      .mockResolvedValueOnce({ results: [{ found: false }] })
      // get_page_screenshot
      .mockResolvedValueOnce({ imageData: Buffer.from("page").toString("base64") })
      // resolve_selector_at_point
      .mockResolvedValueOnce({ selector: '[data-testid="title"]', tag: "h2" })
      // get_computed_styles_batch (unavailable — legacy fallback)
      .mockResolvedValueOnce({ results: [] })
      // get_computed_styles
      .mockResolvedValueOnce({ styles: { "font-size": "14px" } })
      // get_dom_nodes
      .mockResolvedValueOnce({ nodes: [{ rect: { width: 100, height: 24 } }] });

    mockFindNodeInPage.mockResolvedValueOnce({ x: 200, y: 480, width: 200, height: 48, confidence: 0.92 });

    const result = await callTool("diff_figma_to_browser", {
      figma_node_id: "5:5",
      properties: ["font-size"],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.selector).toBe('[data-testid="title"]');
    expect(parsed.matchedVia).toBe("image-template");
    expect(parsed.matchRegion).toMatchObject({ x: 200, y: 480, w: 200, h: 48, confidence: 0.92 });
    // Verify resolve_selector_at_point was called with the screenshot-center coordinates.
    const resolveCall = mockSendToChannel.mock.calls.find((c) => c[1] === "resolve_selector_at_point");
    expect(resolveCall?.[2]).toMatchObject({ x: 300, y: 504, imagePixels: true });
  });

  it("warns when image-template confidence is below threshold", async () => {
    mockSendToFigma
      .mockResolvedValueOnce({ nodes: [{ id: "5:5", type: "TEXT", fontSize: 14 }] })
      .mockResolvedValueOnce({ imageData: Buffer.from("ref").toString("base64") });
    mockSendToChannel
      .mockResolvedValueOnce({ results: [{ found: false }] }) // fig-id probe miss
      .mockResolvedValueOnce({ imageData: Buffer.from("page").toString("base64") })
      .mockResolvedValueOnce({ selector: ".x", tag: "div" })
      .mockResolvedValueOnce({ results: [] }) // batch unavailable
      .mockResolvedValueOnce({ styles: { "font-size": "14px" } })
      .mockResolvedValueOnce({ nodes: [] });
    mockFindNodeInPage.mockResolvedValueOnce({ x: 0, y: 0, width: 50, height: 50, confidence: 0.5 });

    const result = await callTool("diff_figma_to_browser", {
      figma_node_id: "5:5",
      properties: ["font-size"],
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/confidence 0\.5 below threshold/)]));
  });

  it("errors when auto-locate finds nothing in the viewport", async () => {
    mockSendToFigma
      .mockResolvedValueOnce({ nodes: [{ id: "5:5", type: "TEXT", fontSize: 14 }] })
      .mockResolvedValueOnce({ imageData: Buffer.from("ref").toString("base64") });
    mockSendToChannel.mockResolvedValueOnce({ results: [{ found: false }] }); // fig-id probe miss
    mockSendToChannel.mockResolvedValueOnce({ imageData: Buffer.from("page").toString("base64") });
    mockFindNodeInPage.mockResolvedValueOnce(null);

    const result = await callTool("diff_figma_to_browser", { figma_node_id: "5:5" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toMatch(/Could not locate/);
  });

  it("returns an error when the node lookup yields nothing", async () => {
    mockSendToFigma.mockResolvedValueOnce({ nodes: [] });
    const result = await callTool("diff_figma_to_browser", {
      figma_node_id: "999:999",
      css_selector: ".nope",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toMatch(/No Figma node/);
  });
});

describe("diff_figma_frame_to_page tool", () => {
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

    require("../../src/videntia_figma_mcp/tools/comparison-tools").registerComparisonTools(server);
  });

  async function callTool(name: string, args: any = {}) {
    const schema = toolSchemas.get(name);
    const handler = toolHandlers.get(name);
    if (!schema || !handler) throw new Error(`Tool ${name} not found`);
    return await handler(schema.parse(args), { meta: {} });
  }

  it("audits a frame against a DOM tree and returns matched + unmatched buckets", async () => {
    mockSendToFigma.mockResolvedValueOnce({
      nodes: [
        {
          id: "F",
          type: "FRAME",
          name: "Frame",
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
          children: [
            { id: "title", type: "TEXT", name: "Title", absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 24 } },
            {
              id: "card",
              type: "FRAME",
              name: "Card",
              absoluteBoundingBox: { x: 10, y: 50, width: 180, height: 40 },
              children: [
                {
                  id: "body",
                  type: "TEXT",
                  name: "Body",
                  absoluteBoundingBox: { x: 20, y: 60, width: 100, height: 20 },
                },
              ],
            },
            {
              id: "ghost",
              type: "TEXT",
              name: "Ghost",
              absoluteBoundingBox: { x: 1000, y: 1000, width: 100, height: 24 },
            },
          ],
        },
      ],
    });
    mockSendToChannel.mockResolvedValueOnce({
      nodes: [
        {
          idx: 0,
          parent: -1,
          tag: "section",
          id: null,
          testId: null,
          depth: 0,
          rect: { x: 0, y: 0, w: 400, h: 200 },
          selector: ".root",
          text: null,
        },
        {
          idx: 1,
          parent: 0,
          tag: "h2",
          id: null,
          testId: null,
          depth: 1,
          rect: { x: 20, y: 20, w: 200, h: 48 },
          selector: ".root > h2",
          text: "Title",
        },
        {
          idx: 2,
          parent: 0,
          tag: "div",
          id: null,
          testId: null,
          depth: 1,
          rect: { x: 20, y: 100, w: 360, h: 80 },
          selector: ".root > div",
          text: null,
        },
        {
          idx: 3,
          parent: 2,
          tag: "p",
          id: null,
          testId: null,
          depth: 2,
          rect: { x: 40, y: 120, w: 200, h: 40 },
          selector: ".root > div > p",
          text: "Body",
        },
        {
          idx: 4,
          parent: 0,
          tag: "div",
          id: null,
          testId: null,
          depth: 1,
          rect: { x: 300, y: 20, w: 50, h: 50 },
          selector: ".root > .extra",
          text: null,
        },
      ],
    });

    const result = await callTool("diff_figma_frame_to_page", {
      frame_node_id: "F",
      root_selector: ".root",
    });
    const parsed = JSON.parse(result.content[0].text);
    const ids = parsed.matched.map((m: any) => m.figmaId).sort();
    expect(ids).toEqual(["body", "card", "title"]);
    expect(parsed.unmatchedFigma.map((f: any) => f.id)).toEqual(["ghost"]);
    expect(parsed.unmatchedDom.map((d: any) => d.selector)).toContain(".root > .extra");
    expect(parsed.matchedVia).toBe("explicit");
    expect(parsed.summary.matched).toBe(3);
  });

  it("falls back to body when auto-locate finds nothing", async () => {
    // get_node_info, export_node_as_image
    mockSendToFigma
      .mockResolvedValueOnce({
        nodes: [{ id: "F", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 } }],
      })
      .mockResolvedValueOnce({ imageData: Buffer.from("r").toString("base64") });
    // get_page_screenshot then collect_all_element_rects
    mockSendToChannel.mockResolvedValueOnce({ imageData: Buffer.from("p").toString("base64") }).mockResolvedValueOnce({
      nodes: [
        {
          idx: 0,
          parent: -1,
          tag: "body",
          id: null,
          testId: null,
          depth: 0,
          rect: { x: 0, y: 0, w: 100, h: 100 },
          selector: "body",
          text: null,
        },
      ],
    });

    const findMod = require("../../src/videntia_figma_mcp/utils/find-node-in-page");
    findMod.findNodeInPage.mockResolvedValueOnce(null);

    const result = await callTool("diff_figma_frame_to_page", { frame_node_id: "F" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.matchedVia).toBe("fallback-body");
    expect(parsed.rootSelector).toBe("body");
  });
});

describe("diff_figma_to_browser — batch styles path", () => {
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

  it("uses one batch call and applies parent flex-centering equivalence", async () => {
    mockSendToFigma.mockResolvedValueOnce({
      nodes: [
        {
          id: "9:1",
          type: "TEXT",
          fontSize: 12,
          textAlignHorizontal: "CENTER",
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 24 },
        },
      ],
    });
    mockSendToChannel.mockResolvedValueOnce({
      dpr: 2,
      truncated: false,
      results: [
        {
          selector: ".badge",
          found: true,
          rect: { x: 0, y: 0, width: 200, height: 24 },
          styles: { "font-size": "12px", "text-align": "left", display: "block", color: "rgb(0, 0, 0)" },
          parentStyles: { display: "flex", "flex-direction": "column", "align-items": "center" },
          className: "text-xs",
        },
      ],
    });

    const result = await callTool("diff_figma_to_browser", {
      figma_node_id: "9:1",
      css_selector: ".badge",
      properties: ["font-size", "text-align", "color"],
    });
    const parsed = JSON.parse(result.content[0].text);
    const byProp = new Map(parsed.rows.map((r: any) => [r.property, r]));

    // Flex-centered parent → text-align left is equivalent to Figma CENTER.
    expect(byProp.get("text-align")).toMatchObject({ status: "✓" });
    expect(byProp.get("font-size")).toMatchObject({ status: "✓" });

    // Exactly one channel call (the batch) — no legacy get_computed_styles/get_dom_nodes.
    const commands = mockSendToChannel.mock.calls.map((c) => c[1]);
    expect(commands).toEqual(["get_computed_styles_batch"]);
  });
});

describe("diff_figma_to_browser — data-fig-id resolution", () => {
  let server: McpServer;
  let mockSendToFigma: jest.Mock;
  let mockSendToChannel: jest.Mock;
  let mockFindNodeInPage: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" }, { capabilities: { tools: {} } });
    const ws = require("../../src/videntia_figma_mcp/utils/websocket");
    mockSendToFigma = ws.sendCommandToFigma;
    mockSendToChannel = ws.sendCommandToChannel;
    mockSendToFigma.mockReset();
    mockSendToChannel.mockReset();
    mockFindNodeInPage = require("../../src/videntia_figma_mcp/utils/find-node-in-page").findNodeInPage;
    mockFindNodeInPage.mockReset();

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

  it("resolves via data-fig-id without invoking computer vision", async () => {
    mockSendToFigma.mockResolvedValueOnce({
      nodes: [
        {
          id: "3082:47273",
          type: "TEXT",
          fontSize: 12,
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
          absoluteBoundingBox: { x: 0, y: 0, width: 234, height: 32 },
        },
      ],
    });
    const batchResult = {
      dpr: 2,
      truncated: false,
      results: [
        {
          selector: '[data-fig-id="3082:47273"]',
          found: true,
          rect: { x: 283, y: 20, width: 234, height: 32 },
          styles: { "font-size": "12px", color: "rgb(0, 0, 0)" },
        },
      ],
    };
    // Probe call, then the full styles fetch — both batch.
    mockSendToChannel.mockResolvedValue(batchResult);

    const result = await callTool("diff_figma_to_browser", {
      figma_node_id: "3082:47273",
      properties: ["font-size", "color"],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.matchedVia).toBe("fig-id");
    expect(parsed.selector).toBe('[data-fig-id="3082:47273"]');
    expect(parsed.rows.find((r: any) => r.property === "font-size")).toMatchObject({ status: "✓" });

    // CV path never touched: no export, no screenshot, no template match.
    expect(mockFindNodeInPage).not.toHaveBeenCalled();
    const figmaCommands = mockSendToFigma.mock.calls.map((c) => c[0]);
    expect(figmaCommands).not.toContain("export_node_as_image");
    const channelCommands = mockSendToChannel.mock.calls.map((c) => c[1]);
    expect(channelCommands).not.toContain("get_page_screenshot");
  });
});

describe("diff_figma_to_browser — mixed text styling (FM5)", () => {
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

  it("recovers dominant font-size from styled segments when serializer omitted it", async () => {
    // Hero h1: "A trusted real estate appraiser…" — 48px Aspekta with a 96px serif
    // italic span. Mixed styling → serializer emits no fontSize/fontFamily/fontWeight.
    mockSendToFigma.mockImplementation(async (command: string, params: any) => {
      if (command === "get_node_info") {
        return {
          nodes: [
            {
              id: "3082:47274",
              type: "TEXT",
              characters: "A trusted real estate appraiser for whatever comes next.",
              lineHeight: 56,
              textAlignHorizontal: "CENTER",
              fills: [{ type: "SOLID", color: { r: 0.031, g: 0.231, b: 0.22 } }],
              absoluteBoundingBox: { x: 373, y: 216, width: 695, height: 116 },
            },
          ],
        };
      }
      if (command === "get_styled_text_segments") {
        if (params.property === "fontSize") {
          return {
            segments: [
              { characters: "A ", start: 0, end: 2, fontSize: 48 },
              { characters: "trusted", start: 2, end: 9, fontSize: 96 },
              { characters: " real estate appraiser for whatever comes next.", start: 9, end: 57, fontSize: 48 },
            ],
          };
        }
        if (params.property === "fontName") {
          return {
            segments: [
              { characters: "A ", start: 0, end: 2, fontName: { family: "Aspekta", style: "Regular" } },
              { characters: "trusted", start: 2, end: 9, fontName: { family: "Lora", style: "Italic" } },
              {
                characters: " real estate appraiser for whatever comes next.",
                start: 9,
                end: 57,
                fontName: { family: "Aspekta", style: "Regular" },
              },
            ],
          };
        }
        if (params.property === "fontWeight") {
          return {
            segments: [
              {
                characters: "A trusted real estate appraiser for whatever comes next.",
                start: 0,
                end: 57,
                fontWeight: 400,
              },
            ],
          };
        }
      }
      throw new Error(`unexpected figma command ${command}`);
    });

    mockSendToChannel.mockResolvedValue({
      dpr: 2,
      truncated: false,
      results: [
        {
          selector: "h1",
          found: true,
          rect: { x: 373, y: 216, width: 695, height: 116 },
          styles: { "font-size": "48px", "font-family": "aspekta, sans-serif", "font-weight": "400" },
        },
      ],
    });

    const result = await callTool("diff_figma_to_browser", {
      figma_node_id: "3082:47274",
      css_selector: "h1",
      properties: ["font-size", "font-family", "font-weight"],
    });
    const parsed = JSON.parse(result.content[0].text);
    const byProp = new Map(parsed.rows.map((r: any) => [r.property, r]));

    // Previously "—" — now compares the dominant segment and carries the distribution.
    const fontSize = byProp.get("font-size") as any;
    expect(fontSize).toMatchObject({ status: "✓", figma: "48px", browser: "48px" });
    expect(fontSize.note).toMatch(/mixed: 48px \(88%\), 96px \(12%\)/);

    const fontFamily = byProp.get("font-family") as any;
    expect(fontFamily).toMatchObject({ status: "✓", figma: "aspekta" });
    expect(fontFamily.note).toMatch(/mixed/);

    // Uniform weight — dominant value used, no distribution note.
    const fontWeight = byProp.get("font-weight") as any;
    expect(fontWeight).toMatchObject({ status: "✓", figma: "400" });
    expect(fontWeight.note).toBeUndefined();
  });

  it("leaves '—' rows intact when segment lookup fails", async () => {
    mockSendToFigma.mockImplementation(async (command: string) => {
      if (command === "get_node_info") {
        return {
          nodes: [
            {
              id: "3082:47274",
              type: "TEXT",
              characters: "Mixed heading",
              absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 24 },
            },
          ],
        };
      }
      if (command === "get_styled_text_segments") throw new Error("plugin busy");
      throw new Error(`unexpected figma command ${command}`);
    });
    mockSendToChannel.mockResolvedValue({
      results: [
        { selector: "h1", found: true, rect: { x: 0, y: 0, width: 100, height: 24 }, styles: { "font-size": "48px" } },
      ],
    });

    const result = await callTool("diff_figma_to_browser", {
      figma_node_id: "3082:47274",
      css_selector: "h1",
      properties: ["font-size"],
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rows[0]).toMatchObject({ property: "font-size", status: "—" });
  });
});
