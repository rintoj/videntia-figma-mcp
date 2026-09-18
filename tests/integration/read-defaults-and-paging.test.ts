import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocumentTools } from "../../src/videntia_figma_mcp/tools/document-tools";
import { registerDocumentationTools } from "../../src/videntia_figma_mcp/tools/documentation-tools";
import { clearLintRuns } from "../../src/videntia_figma_mcp/utils/lint-runs";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
  getOpenChannels: jest.fn(),
}));

/**
 * Rank-8 token-economy guards.
 *
 * Two invariants are under test:
 *  1. The CHEAP shape is the DEFAULT (measured: projections were passed 0-40%
 *     of the time, so an opt-in projection is effectively dead code).
 *  2. A reduced response is NEVER mistakable for a complete one — every
 *     projection/page/cap must say what is missing and how to get it.
 *
 * Wire payloads are asserted directly, because zod silently strips undeclared
 * keys and that mechanism has already caused five bugs on this branch.
 */
describe("read-tool defaults, paging and lint delta", () => {
  let mockSend: jest.Mock;
  let handlers: Map<string, Function>;
  let schemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    clearLintRuns();
    const server = new McpServer({ name: "t", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSend = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSend.mockReset();
    handlers = new Map();
    schemas = new Map();
    const original = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        handlers.set(args[0], args[3]);
        schemas.set(args[0], z.object(args[2]));
      }
      return (original as any)(...args);
    });
    registerDocumentTools(server);
    registerDocumentationTools(server);
  });

  const call = async (name: string, args: any) => {
    const schema = schemas.get(name)!;
    expect(schema).toBeDefined();
    return await handlers.get(name)!(schema.parse(args), { meta: {} });
  };
  const text = (r: any) => r.content[0].text as string;
  const wire = (i = 0) => mockSend.mock.calls[i][1];
  /** Strip the leading notice/banner lines so size comparisons measure payload, not prose. */
  const body = (out: string) =>
    out
      .split("\n")
      .filter((l) => !/^(get_nodes_info|search_nodes|scan_nodes_by_types)[:| ]|^Output is the COMPACT/.test(l))
      .join("\n");

  const node = (id: string, extra: any = {}) => ({
    id,
    name: `N${id}`,
    type: "FRAME",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    fills: [{ type: "SOLID", color: "#fff" }],
    ...extra,
  });

  // ---- declared-param guards (zod strips undeclared keys) ------------------

  it("declares every new param in the zod schemas", () => {
    expect(Object.keys(schemas.get("get_nodes_info")!.shape)).toEqual(
      expect.arrayContaining(["limit", "cursor", "output_format", "format"]),
    );
    expect(Object.keys(schemas.get("search_nodes")!.shape)).toEqual(
      expect.arrayContaining(["cursor", "output_format", "format"]),
    );
    expect(Object.keys(schemas.get("scan_nodes_by_types")!.shape)).toEqual(expect.arrayContaining(["cursor"]));
    expect(Object.keys(schemas.get("lint_frame")!.shape)).toEqual(
      expect.arrayContaining(["max_violations", "since_run", "summary_only"]),
    );
    expect(Object.keys(schemas.get("get_content_tree")!.shape)).toEqual(
      expect.arrayContaining(["view", "text_limit", "cursor", "maxDepth"]),
    );
  });

  // ---- E1: compact is the default -----------------------------------------

  it("get_nodes_info defaults to the compact projection and says so", async () => {
    mockSend.mockResolvedValue({ nodes: [node("1:1"), node("1:2")] });
    const out = text(await call("get_nodes_info", { nodeIds: ["1:1", "1:2"] }));
    expect(out).toContain("COMPACT projection");
    expect(out).toContain("OMITTED");
    expect(out).toContain('output_format:"jsx"');
    // the compact body itself carries no markup
    expect(body(out)).not.toContain("className");
    expect(body(out)).not.toContain("<div");
    expect(out).toContain("N1:1 [FRAME] 1:1");
  });

  it("get_nodes_info still returns full JSX when asked", async () => {
    mockSend.mockResolvedValue({ nodes: [node("1:1")] });
    const out = text(await call("get_nodes_info", { nodeIds: ["1:1"], output_format: "jsx" }));
    expect(out).not.toContain("COMPACT projection");
    expect(out).toContain("<");
  });

  it("search_nodes defaults to compact and accepts the format alias", async () => {
    mockSend.mockResolvedValue({ nodes: [node("2:1")] });
    expect(text(await call("search_nodes", { query: "Card" }))).toContain("COMPACT projection");
    mockSend.mockClear();
    mockSend.mockResolvedValue({ nodes: [node("2:1")] });
    const json = text(await call("search_nodes", { query: "Card", format: "json" }));
    expect(json).not.toContain("COMPACT projection");
    expect(json).toContain('"id":"2:1"');
  });

  it("measures the reduction: compact is a small fraction of JSX", async () => {
    // A realistically styled node — this is where the JSX path's className
    // strings (the thing the token report flagged) actually come from.
    const many = Array.from({ length: 10 }, (_, i) =>
      node(`3:${i}`, {
        characters: "Hello there, this is body copy",
        style: { fontSize: 14, fontWeight: 600, lineHeightPx: 20, letterSpacing: 0.2, fontFamily: "Inter" },
        layoutMode: "HORIZONTAL",
        itemSpacing: 12,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 8,
        paddingBottom: 8,
        cornerRadius: 8,
        opacity: 0.9,
        constraints: { vertical: "TOP", horizontal: "LEFT" },
        strokes: [{ type: "SOLID", color: "#e5e7eb" }],
        strokeWeight: 1,
        effects: [{ type: "DROP_SHADOW", radius: 4, offset: { x: 0, y: 2 }, color: "#0000001a" }],
      }),
    );
    mockSend.mockResolvedValue({ nodes: many });
    const compact = text(await call("get_nodes_info", { nodeIds: many.map((n) => n.id) }));
    mockSend.mockResolvedValue({ nodes: many });
    const jsx = text(await call("get_nodes_info", { nodeIds: many.map((n) => n.id), output_format: "jsx" }));
    mockSend.mockResolvedValue({ nodes: many });
    const json = text(await call("get_nodes_info", { nodeIds: many.map((n) => n.id), output_format: "json" }));

    // The compact body carries no markup and no raw property dump.
    expect(body(compact)).not.toContain("className");
    expect(body(compact)).not.toContain("paddingLeft");
    expect(body(jsx)).toContain("className");
    // Raw JSON is the heavy representation; compact must be a small fraction of it.
    expect(body(compact).length).toBeLessThan(body(json).length * 0.3);
  });

  // ---- E5: pagination ------------------------------------------------------

  it("get_nodes_info pages node ids and never requests more than one page", async () => {
    mockSend.mockResolvedValue({ nodes: [node("4:1")] });
    const ids = Array.from({ length: 60 }, (_, i) => `4:${i}`);
    const out = text(await call("get_nodes_info", { nodeIds: ids, limit: 25 }));
    expect(wire().nodeIds).toHaveLength(25);
    expect(wire().nodeIds[0]).toBe("4:0");
    expect(out).toContain("PARTIAL page");
    expect(out).toContain("next_cursor: 25");
  });

  it("get_nodes_info honours a cursor for the next page", async () => {
    mockSend.mockResolvedValue({ nodes: [node("4:25")] });
    const ids = Array.from({ length: 60 }, (_, i) => `4:${i}`);
    const out = text(await call("get_nodes_info", { nodeIds: ids, limit: 25, cursor: "25" }));
    expect(wire().nodeIds[0]).toBe("4:25");
    expect(out).toContain("showing 26-50 of 60");
    expect(out).toContain("next_cursor: 50");
  });

  it("marks a complete result as complete", async () => {
    mockSend.mockResolvedValue({ nodes: [node("5:1")] });
    const out = text(await call("get_nodes_info", { nodeIds: ["5:1"] }));
    expect(out).toContain("complete — no further pages");
    expect(out).not.toContain("PARTIAL page");
  });

  it("search_nodes pages its result set", async () => {
    mockSend.mockResolvedValue({ nodes: Array.from({ length: 30 }, (_, i) => node(`6:${i}`)) });
    const out = text(await call("search_nodes", { query: "x", limit: 10 }));
    expect(out).toContain("showing 1-10 of 30");
    expect(out).toContain("next_cursor: 10");
    expect(out.split("\n").filter((l) => l.includes("[FRAME]"))).toHaveLength(10);
  });

  it("scan_nodes_by_types keeps its truncation warning and adds a page banner", async () => {
    mockSend.mockResolvedValue({
      nodes: Array.from({ length: 5 }, (_, i) => node(`7:${i}`)),
      totalFound: 80,
      limit: 5,
    });
    const out = text(await call("scan_nodes_by_types", { nodeId: "7:0", types: ["FRAME"], limit: 5 }));
    expect(out).toContain("results are INCOMPLETE");
    expect(out).toContain("scan_nodes_by_types page");
  });

  // ---- E1/E5: get_content_tree --------------------------------------------

  const treeResult = {
    nodeCount: 1,
    tree: [
      {
        id: "8:0",
        name: "Root",
        type: "FRAME",
        role: "container",
        width: 375,
        height: 812,
        children: [
          { id: "8:1", name: "Title", type: "TEXT", role: "heading", text: "Hi", fontSize: 24, fontWeight: "700" },
          { id: "8:2", name: "Body", type: "FRAME", role: "container", width: 100, height: 40 },
        ],
      },
    ],
    textInventory: Array.from({ length: 250 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, role: "body", text: `x${i}` })),
  };

  it("get_content_tree defaults to maxDepth 2 on the wire", async () => {
    mockSend.mockResolvedValue(treeResult);
    await call("get_content_tree", { nodeId: "8:0" });
    expect(wire().maxDepth).toBe(2);
  });

  it("get_content_tree defaults to the outline projection and shrinks the payload", async () => {
    mockSend.mockResolvedValue(treeResult);
    const outline = text(await call("get_content_tree", { nodeId: "8:0" }));
    mockSend.mockResolvedValue(treeResult);
    const full = text(await call("get_content_tree", { nodeId: "8:0", view: "full", text_limit: 100 }));

    expect(outline).toContain("OUTLINE projection");
    expect(outline).not.toContain('"fontSize"');
    expect(outline).not.toContain('"height"');
    expect(outline).toContain('"role": "heading"');
    expect(outline).toContain('"truncatedChildren": true');
    expect(full).toContain('"fontSize"');
    expect(JSON.stringify(JSON.parse(outline).tree).length).toBeLessThan(JSON.stringify(JSON.parse(full).tree).length);
  });

  it("get_content_tree pages the text inventory", async () => {
    mockSend.mockResolvedValue(treeResult);
    const out = text(await call("get_content_tree", { nodeId: "8:0" }));
    const parsed = JSON.parse(out);
    expect(parsed.textInventory).toHaveLength(100);
    expect(parsed.textInventoryTotal).toBe(250);
    expect(parsed.next_cursor).toBe("100");
    expect(JSON.stringify(parsed._notice)).toContain("PARTIAL page");

    mockSend.mockResolvedValue(treeResult);
    const p3 = JSON.parse(text(await call("get_content_tree", { nodeId: "8:0", cursor: "200" })));
    expect(p3.textInventory).toHaveLength(50);
    expect(p3.next_cursor).toBeUndefined();
  });

  // ---- E1/E4: lint_frame ---------------------------------------------------

  const lintResult = (n: number) => ({
    nodeId: "9:0",
    nodeName: "Frame",
    nodeType: "FRAME",
    totalNodes: 40,
    violations: Array.from({ length: n }, (_, i) => ({
      nodeId: `9:${i}`,
      nodeName: `V${i}`,
      nodeType: "RECTANGLE",
      category: "backgroundFills",
      property: `fills[${i}]`,
      severity: "HIGH",
      message: "raw color",
    })),
    summary: { compliance: 50 },
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
        "screenNaming",
      ].map((k) => [k, { total: 1, bound: 1, unbound: 0, compliance: 100 }]),
    ),
  });

  it("lint_frame caps violation rows at 25 by default and flags the omission", async () => {
    mockSend.mockResolvedValue(lintResult(60));
    const out = text(await call("lint_frame", { nodeId: "9:0" }));
    const rows = out.split("\n").filter((l) => l.startsWith("| V-"));
    expect(rows).toHaveLength(25);
    expect(out).toContain("35 further violation row(s) OMITTED");
    expect(out).toContain("max_violations:0");
    expect(out).toContain("Pending violations: 60");
  });

  it("lint_frame max_violations:0 prints every row", async () => {
    mockSend.mockResolvedValue(lintResult(60));
    const out = text(await call("lint_frame", { nodeId: "9:0", max_violations: 0 }));
    expect(out.split("\n").filter((l) => l.startsWith("| V-"))).toHaveLength(60);
    expect(out).not.toContain("OMITTED by the default cap");
  });

  it("lint_frame delta mode lists only new violations and counts the rest", async () => {
    mockSend.mockResolvedValue(lintResult(18));
    const first = text(await call("lint_frame", { nodeId: "9:0" }));
    expect(first).toContain("**run_id:**");

    mockSend.mockResolvedValue(lintResult(20));
    const second = text(await call("lint_frame", { nodeId: "9:0", since_run: "last" }));
    expect(second).toContain("2 new, 18 unchanged, 0 resolved");
    expect(second.split("\n").filter((l) => l.startsWith("| V-"))).toHaveLength(2);
    expect(second).toContain("are NOT shown");
  });

  it("lint_frame delta reports resolved violations as a number", async () => {
    mockSend.mockResolvedValue(lintResult(20));
    await call("lint_frame", { nodeId: "9:0" });
    mockSend.mockResolvedValue(lintResult(12));
    const out = text(await call("lint_frame", { nodeId: "9:0", since_run: "last" }));
    expect(out).toContain("0 new, 12 unchanged, 8 resolved");
  });

  it("lint_frame falls back to the full report when the since_run is unknown", async () => {
    mockSend.mockResolvedValue(lintResult(3));
    const out = text(await call("lint_frame", { nodeId: "9:0", since_run: "R999" }));
    expect(out).toContain("Delta unavailable");
    expect(out).toContain("showing the FULL report instead");
    expect(out.split("\n").filter((l) => l.startsWith("| V-"))).toHaveLength(3);
  });
});
