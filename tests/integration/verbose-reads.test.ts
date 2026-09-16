import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocumentTools } from "../../src/videntia_figma_mcp/tools/document-tools";
import { violationId } from "../../src/videntia_figma_mcp/utils/compact-node";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
  getOpenChannels: jest.fn(),
}));

const NODE = {
  id: "1:2",
  name: "Card",
  type: "FRAME",
  visible: true,
  x: 10,
  y: 20,
  width: 300,
  height: 120,
  rotation: 0,
  absoluteBoundingBox: { x: 10, y: 20, width: 300, height: 120 },
  layoutMode: "VERTICAL",
  itemSpacing: 8,
  cornerRadius: 12,
  fills: [{ type: "SOLID", color: "#ffffff" }],
  bindings: { "fills/0": { id: "V1", name: "background/primary" } },
  children: [
    {
      id: "1:3",
      name: "Title",
      type: "TEXT",
      visible: true,
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      characters: "Hello",
      textStyleName: "heading/md",
      _childCount: 0,
    },
  ],
};

describe("verbose read reductions", () => {
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
        const [name, _description, schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });

    registerDocumentTools(server);
  });

  async function callTool(toolName: string, args: any) {
    const schema = toolSchemas.get(toolName);
    const handler = toolHandlers.get(toolName);
    if (!schema || !handler) throw new Error(`Tool ${toolName} not found`);
    return await handler(schema.parse(args), { meta: {} });
  }

  describe("get_node_info compact format", () => {
    it("returns one terse line per node with no className strings", async () => {
      mockSendCommand.mockResolvedValue({ nodes: [NODE] });
      const res = await callTool("get_node_info", { nodeId: "1:2", format: "compact" });
      const text = res.content[0].text;
      expect(text).toContain("Card [FRAME] 1:2 10,20 300x120");
      expect(text).toContain("layout=VERTICAL gap=8");
      expect(text).toContain("fill=background/primary");
      expect(text).toContain("Title [TEXT]");
      expect(text).not.toContain("className");
    });

    it("compact output is much smaller than the default jsx output", async () => {
      mockSendCommand.mockResolvedValue({ nodes: [NODE] });
      const jsx = (await callTool("get_node_info", { nodeId: "1:2" })).content[0].text;
      const compact = (await callTool("get_node_info", { nodeId: "1:2", format: "compact" })).content[0].text;
      expect(compact.length).toBeLessThan(jsx.length);
    });

    it("fields actually filters the output", async () => {
      mockSendCommand.mockResolvedValue({ nodes: [NODE] });
      const res = await callTool("get_node_info", {
        nodeId: "1:2",
        format: "json",
        fields: ["absoluteBoundingBox"],
      });
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed[0].x).toBe(10);
      // absoluteBoundingBox itself must survive when that field is requested
      expect(parsed[0].absoluteBoundingBox).toEqual({ x: 10, y: 20, width: 300, height: 120 });
      // Unrequested properties are dropped
      expect(parsed[0].fills).toBeUndefined();
      expect(parsed[0].layoutMode).toBeUndefined();
      expect(parsed[0].cornerRadius).toBeUndefined();
    });
  });

  describe("measure_node", () => {
    it("returns geometry only", async () => {
      mockSendCommand.mockResolvedValue({ nodes: [NODE] });
      const res = await callTool("measure_node", { nodeId: "1:2" });
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed[0]).toEqual({
        id: "1:2",
        name: "Card",
        type: "FRAME",
        x: 10,
        y: 20,
        width: 300,
        height: 120,
        rotation: 0,
        absoluteBoundingBox: { x: 10, y: 20, width: 300, height: 120 },
        childCount: 1,
      });
      expect(mockSendCommand).toHaveBeenCalledWith("get_node_info", { nodeIds: ["1:2"], depth: 0 });
    });

    it("includes child geometry when asked", async () => {
      mockSendCommand.mockResolvedValue({ nodes: [NODE] });
      const res = await callTool("measure_node", { nodeId: "1:2", include_children: true, depth: 1 });
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed[0].children).toHaveLength(1);
      expect(parsed[0].children[0].id).toBe("1:3");
      expect(parsed[0].children[0].fills).toBeUndefined();
    });

    it("accepts multiple ids and a compact format", async () => {
      mockSendCommand.mockResolvedValue({ nodes: [NODE] });
      const res = await callTool("measure_node", { nodeId: ["1:2"], output_format: "compact" });
      expect(res.content[0].text).toBe("Card [FRAME] 1:2 10,20 300x120");
    });
  });

  describe("get_node_summary", () => {
    it("returns one line per node with child count and key styles", async () => {
      mockSendCommand.mockResolvedValue({ nodes: [NODE] });
      const res = await callTool("get_node_summary", { nodeId: "1:2" });
      const text = res.content[0].text;
      expect(text.split("\n")).toHaveLength(1);
      expect(text).toContain("Card [FRAME] 1:2 children=1");
      expect(text).toContain("radius=12");
    });

    it("can include direct children", async () => {
      mockSendCommand.mockResolvedValue({ nodes: [NODE] });
      const res = await callTool("get_node_summary", { nodeId: "1:2", include_children: true });
      const lines = res.content[0].text.split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain("Title [TEXT] 1:3 children=0");
      expect(lines[1]).toContain("textStyle=heading/md");
    });
  });

  describe("scan_nodes_by_types", () => {
    it("forwards topLevelOnly to the plugin", async () => {
      mockSendCommand.mockResolvedValue({ nodes: [], count: 0, totalFound: 0, truncated: false });
      await callTool("scan_nodes_by_types", { nodeId: "1:2", types: ["TEXT"], topLevelOnly: true });
      expect(mockSendCommand).toHaveBeenCalledWith(
        "scan_nodes_by_types",
        expect.objectContaining({ topLevelOnly: true, nodeId: "1:2" }),
      );
    });

    it("makes truncation explicit so it cannot read as a complete sweep", async () => {
      mockSendCommand.mockResolvedValue({ nodes: [NODE], totalFound: 120, truncated: true, limit: 50 });
      const res = await callTool("scan_nodes_by_types", { nodeId: "1:2", types: ["FRAME"], limit: 50 });
      const text = res.content[0].text;
      expect(text).toContain("1 of 120 matching node(s) returned");
      expect(text).toContain("truncated: true");
      expect(text).toContain("INCOMPLETE");
    });

    it("reports a complete sweep when nothing was truncated", async () => {
      mockSendCommand.mockResolvedValue({ nodes: [NODE], totalFound: 1, truncated: false, limit: 50 });
      const res = await callTool("scan_nodes_by_types", { nodeId: "1:2", types: ["FRAME"] });
      expect(res.content[0].text).toContain("truncated: false");
      expect(res.content[0].text).not.toContain("INCOMPLETE");
    });
  });

  describe("lint_frame", () => {
    const lintResult = {
      nodeId: "1:2",
      nodeName: "Card",
      nodeType: "FRAME",
      totalNodes: 5,
      categories: Object.fromEntries(
        [
          "rootFrame",
          "typography",
          "backgroundFills",
          "iconColors",
          "strokesBorders",
          "spacing",
          "borderRadius",
          "effectStyles",
          "overflow",
          "autoLayout",
          "screenNaming",
        ].map((k) => [k, { total: 2, bound: 1, unbound: 1, compliance: 50 }]),
      ),
      violations: [
        {
          nodeId: "1:3",
          nodeName: "Title",
          nodeType: "TEXT",
          depth: 1,
          severity: "HIGH",
          category: "typography",
          property: "textStyleId",
          message: "No text style applied",
        },
      ],
      violationsCapped: false,
      summary: { total: 1, critical: 0, high: 1, medium: 0, low: 0, compliance: 50, fixed: 0 },
    };

    it("summary_only omits violation rows but keeps category scores", async () => {
      mockSendCommand.mockResolvedValue(JSON.parse(JSON.stringify(lintResult)));
      const res = await callTool("lint_frame", { nodeId: "1:2", summary_only: true });
      const text = res.content[0].text;
      expect(text).toContain("## Compliance by Category");
      expect(text).toContain("Overall Compliance: 50%");
      expect(text).toContain("Violation rows omitted (summary_only)");
      expect(text).not.toContain("No text style applied");
      expect(text).not.toContain("## Violations");
    });

    it("attaches a stable violation id that repeats across runs", async () => {
      mockSendCommand.mockResolvedValue(JSON.parse(JSON.stringify(lintResult)));
      const first = (await callTool("lint_frame", { nodeId: "1:2" })).content[0].text;
      mockSendCommand.mockResolvedValue(JSON.parse(JSON.stringify(lintResult)));
      const second = (await callTool("lint_frame", { nodeId: "1:2" })).content[0].text;

      const expected = violationId(["1:3", "typography", "textStyleId", "HIGH"]);
      expect(expected).toMatch(/^V-[0-9a-f]{8}$/);
      expect(first).toContain(expected);
      expect(second).toContain(expected);
    });

    it("gives different ids to different violations", () => {
      expect(violationId(["1:3", "typography", "textStyleId", "HIGH"])).not.toBe(
        violationId(["1:4", "typography", "textStyleId", "HIGH"]),
      );
    });
  });
});
