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
      // get_page_screenshot
      .mockResolvedValueOnce({ imageData: Buffer.from("page").toString("base64") })
      // resolve_selector_at_point
      .mockResolvedValueOnce({ selector: '[data-testid="title"]', tag: "h2" })
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
      .mockResolvedValueOnce({ imageData: Buffer.from("page").toString("base64") })
      .mockResolvedValueOnce({ selector: ".x", tag: "div" })
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
