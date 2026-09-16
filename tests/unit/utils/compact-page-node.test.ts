/**
 * `get_node_info` with `format: "compact"` on a PAGE returned a plausible-looking EMPTY
 * shell: a page has no x/y/width/height and no `fills` (its canvas paint lives on
 * `backgrounds`), so the compact line rendered as `Page 1 [PAGE] 0:1 -,- -x-` with no
 * style tokens at all. A silently-empty result that LOOKS valid is the worst outcome a
 * read can produce.
 *
 * These tests pin real PAGE data through all three renderers (compact, summary,
 * geometry) and through the plugin-side backgrounds extraction.
 */

const MIXED = Symbol("figma.mixed");
(globalThis as any).figma = { mixed: MIXED };

import {
  formatCompact,
  formatSummary,
  extractGeometry,
  hasGeometry,
} from "../../../src/videntia_figma_mcp/utils/compact-node";
import { extractBackgrounds } from "../../../src/videntia_figma_plugin/handlers/node-serializer";

const page = (extra: Record<string, unknown> = {}) =>
  ({
    id: "0:1",
    name: "Home",
    type: "PAGE",
    backgrounds: [{ type: "SOLID", color: "#f5f5f5" }],
    _childCount: 3,
    ...extra,
  }) as any;

describe("PAGE nodes in the compact renderers", () => {
  it("does not claim a page has geometry", () => {
    expect(hasGeometry(page())).toBe(false);
    expect(hasGeometry({ id: "1:2", type: "FRAME", x: 0, y: 0, width: 10, height: 10 })).toBe(true);
  });

  it("renders name, type, id, child count and background — never an all-dashes shell", () => {
    const line = formatCompact([page()]);
    expect(line).toContain("Home [PAGE] 0:1");
    expect(line).toContain("children=3");
    expect(line).toContain("background=#f5f5f5");
    expect(line).not.toContain("-,-");
    expect(line).not.toContain("-x-");
  });

  it("reports an explicitly empty background list rather than saying nothing", () => {
    expect(formatCompact([page({ backgrounds: [] })])).toContain("background=none");
  });

  it("renders a direct-children summary beneath the page", () => {
    const line = formatCompact([
      page({
        _childCount: undefined,
        children: [
          { id: "1:2", name: "Hero", type: "FRAME", x: 0, y: 0, width: 390, height: 200 },
          { id: "1:3", name: "Footer", type: "FRAME", x: 0, y: 200, width: 390, height: 80 },
        ],
      }),
    ]);
    expect(line).toContain("children=2");
    expect(line).toContain("Hero [FRAME] 1:2 0,0 390x200");
    expect(line).toContain("Footer [FRAME] 1:3");
  });

  it("formatSummary reports the page background too", () => {
    const line = formatSummary([page()]);
    expect(line).toBe("Home [PAGE] 0:1 children=3 · background=#f5f5f5");
  });

  it("extractGeometry returns child count and backgrounds instead of an empty object", () => {
    const geo = extractGeometry(page(), false, 0);
    expect(geo).toMatchObject({ id: "0:1", name: "Home", type: "PAGE", childCount: 3 });
    expect(geo.backgrounds).toEqual([{ type: "SOLID", color: "#f5f5f5" }]);
    // No fabricated zeroes for coordinates a page does not have.
    expect(geo.x).toBeUndefined();
    expect(geo.width).toBeUndefined();
  });

  it("keeps the child count on a page whose children are expanded", () => {
    const geo = extractGeometry(
      page({ _childCount: undefined, children: [{ id: "1:2", name: "Hero", type: "FRAME", x: 0, y: 0 }] }),
      true,
      1,
    );
    expect(geo.childCount).toBe(1);
    expect(Array.isArray(geo.children)).toBe(true);
  });

  it("leaves ordinary geometry nodes untouched", () => {
    const line = formatCompact([{ id: "1:2", name: "Card", type: "FRAME", x: 4, y: 8, width: 100, height: 50 }]);
    expect(line).toBe("Card [FRAME] 1:2 4,8 100x50");
  });
});

describe("plugin-side background extraction", () => {
  it("serializes a page's backgrounds with the same shape as fills", () => {
    const bg = extractBackgrounds({ backgrounds: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }] } as any);
    expect(bg).toEqual([{ type: "SOLID", color: "#ffffff" }]);
  });

  it("returns undefined for a node that has no backgrounds at all", () => {
    expect(extractBackgrounds({ fills: [] } as any)).toBeUndefined();
  });
});
