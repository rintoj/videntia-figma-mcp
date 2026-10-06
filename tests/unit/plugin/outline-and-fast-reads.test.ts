import { buildOutline, outlineLine } from "../../../src/videntia_figma_plugin/handlers/outline";
import { wantsSkipInvisible } from "../../../src/videntia_figma_plugin/utils/skip-invisible";
import { truncationHint } from "../../../src/videntia_figma_plugin/utils/walk-budget";
import { scanNodesByTypes } from "../../../src/videntia_figma_plugin/handlers/selection";
import { resetLookupMapsCache } from "../../../src/videntia_figma_plugin/handlers/node-serializer";
import { setCommandDeadline } from "../../../src/videntia_figma_plugin/utils/with-timeout";
import { READONLY_COMMANDS } from "../../../src/videntia_figma_mcp/utils/readonly-commands";
import { ENTRY_SURFACE_TOOLS } from "../../../src/videntia_figma_mcp/utils/tool-modes";
import { isHeavyCommand } from "../../../src/videntia_figma_mcp/utils/heavy-commands";
import { ALLOWED_COMMANDS } from "../../../src/videntia_figma_plugin/ui/constants";

function bigTree(frames: number, perFrame: number) {
  let n = 0;
  const leaf = () => ({
    id: `${n}:${n++}`,
    type: "TEXT",
    name: "Label text",
    x: 12.4,
    y: 340.6,
    width: 120,
    height: 20,
    visible: n % 7 !== 0,
  });
  return {
    id: "0:1",
    type: "FRAME",
    name: "Screen / Home",
    x: 0,
    y: 0,
    width: 390,
    height: 844,
    children: Array.from({ length: frames }, (_, i) => ({
      id: `9:${i}`,
      type: "FRAME",
      name: `Row ${i}`,
      x: 0,
      y: i * 40,
      width: 390,
      height: 40,
      children: Array.from({ length: perFrame }, leaf),
    })),
  };
}

describe("get_outline", () => {
  it("formats one compact line per node", () => {
    expect(
      outlineLine({
        id: "1:2",
        type: "FRAME",
        name: "Card",
        x: 0.4,
        y: 10,
        width: 320,
        height: 200,
        children: [{ id: "a", type: "TEXT", name: "t" }],
      }),
    ).toBe('1:2 FRAME "Card" 0,10 320x200 c=1');
    expect(outlineLine({ id: "1:3", type: "TEXT", name: "x", visible: false })).toContain("hidden");
  });

  it("indents by depth and stays under ~80 bytes per node", async () => {
    const res = await buildOutline(bigTree(50, 40));
    expect(res.nodes).toBe(1 + 50 + 2000);
    expect(res.truncated).toBe(false);
    const lines = res.outline.split("\n");
    expect(lines[1].startsWith(" 9:0 FRAME")).toBe(true);
    expect(lines[2].startsWith("  ")).toBe(true);
    const bytesPerNode = Buffer.byteLength(res.outline) / res.nodes;
    expect(bytesPerNode).toBeLessThan(80);
  });

  it("caps at maxNodes with an actionable hint, and cuts at maxDepth", async () => {
    const capped = await buildOutline(bigTree(10, 10), { maxNodes: 5 });
    expect(capped.nodes).toBe(5);
    expect(capped.truncated).toBe(true);
    expect(capped.hint).toContain("get_outline");
    const shallow = await buildOutline(bigTree(3, 3), { maxDepth: 1 });
    expect(shallow.nodes).toBe(4);
    expect(shallow.depthCut).toBe(3);
  });

  it("is registered everywhere", () => {
    expect(READONLY_COMMANDS.has("get_outline")).toBe(true);
    expect(ALLOWED_COMMANDS.has("get_outline")).toBe(true);
    expect(ENTRY_SURFACE_TOOLS).toContain("get_outline");
    expect(isHeavyCommand("get_outline", {})).toBe(false);
    expect(isHeavyCommand("get_outline", { maxNodes: 20000 })).toBe(true);
  });
});

describe("two-step truncation hint", () => {
  it("names get_outline and lists top-level child ids", () => {
    const h = truncationHint("maxNodes", 2000, 512000, ["1:1", "1:2"]);
    expect(h).toContain("get_outline");
    expect(h).toContain("1:1, 1:2");
    const many = truncationHint(
      "maxNodes",
      2000,
      512000,
      Array.from({ length: 40 }, (_, i) => `x:${i}`),
    );
    expect(many).toContain("(+10 more)");
  });
});

describe("skipInvisibleInstanceChildren policy", () => {
  it("on for read walks, off for writes, hidden-asking calls and get_content_tree", () => {
    expect(wantsSkipInvisible("scan_nodes_by_types", "heavy", {})).toBe(true);
    expect(wantsSkipInvisible("lint_frame", "read", {})).toBe(true);
    expect(wantsSkipInvisible("lint_frame", "write", { fix: true })).toBe(false);
    expect(wantsSkipInvisible("contrast_check_frame", "read", { include_hidden: true })).toBe(false);
    expect(wantsSkipInvisible("find_overlaps", "read", { ignore_hidden: false })).toBe(false);
    expect(wantsSkipInvisible("get_content_tree", "heavy", {})).toBe(false);
    expect(wantsSkipInvisible("set_fill_color", "write", {})).toBe(false);
  });
});

describe("scan_nodes_by_types native fast path", () => {
  beforeEach(() => {
    resetLookupMapsCache();
    setCommandDeadline(undefined);
  });

  function setup(chunks: number, perChunk: number) {
    const calls: unknown[] = [];
    const nodes: Record<string, unknown> = {};
    const kids = Array.from({ length: chunks }, (_, c) => {
      const found = Array.from({ length: perChunk }, (_, i) => ({
        id: `t${c}-${i}`,
        type: "TEXT",
        name: "t",
        visible: true,
      }));
      found.forEach((f) => (nodes[f.id] = f));
      const child = {
        id: `f${c}`,
        type: "FRAME",
        name: "f",
        visible: true,
        children: found,
        findAllWithCriteria: (crit: unknown) => {
          calls.push(crit);
          return found;
        },
      };
      nodes[child.id] = child;
      return child;
    });
    nodes.s1 = { id: "s1", type: "SECTION", name: "S", visible: true, children: kids };
    (globalThis as unknown as { figma: unknown }).figma = {
      on: jest.fn(),
      variables: { getLocalVariablesAsync: async () => [] },
      getLocalTextStylesAsync: async () => [],
      getLocalEffectStylesAsync: async () => [],
      getNodeByIdAsync: async (id: string) => nodes[id] ?? null,
      currentPage: { selection: [] },
    };
    return calls;
  }

  it("uses findAllWithCriteria per top-level child with the type filter", async () => {
    const calls = setup(3, 4);
    const res = await scanNodesByTypes({ nodeId: "s1", types: ["TEXT"], limit: 2, exactTotal: true });
    expect(calls).toEqual([{ types: ["TEXT"] }, { types: ["TEXT"] }, { types: ["TEXT"] }]);
    expect(res.totalFound).toBe(12);
    expect(res.totalExact).toBe(true);
  });

  it("checks the cap between chunks", async () => {
    const calls = setup(5, 4);
    const res = await scanNodesByTypes({ nodeId: "s1", types: ["TEXT"], limit: 2, maxVisited: 6, exactTotal: true });
    expect(calls.length).toBe(2);
    expect(res.stopReason).toBe("maxVisited");
    expect(res.totalExact).toBe(false);
  });
});
