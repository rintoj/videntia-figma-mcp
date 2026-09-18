import { setLayoutSizing } from "../../../src/videntia_figma_plugin/handlers/layout";

/**
 * Bug #9: setting a CHILD to FILL silently collapses a hugging PARENT.
 * Reproduced size: a fixed 343px bar became 339px (a 4px padding delta).
 *
 * These tests assert the parent's ACTUAL width, never just "returned success".
 */

let nodes: Map<string, any>;

/**
 * Mock parent whose width recomputes like Figma's hug: when a child flips to
 * FILL the child stops contributing its fixed width, so the hug width drops by
 * the 4px delta observed in production.
 */
function makeTree(opts: { counterAxisSizingMode: string; primaryAxisSizingMode?: string }) {
  const parent: any = {
    id: "0:1",
    name: "Bar",
    type: "FRAME",
    layoutMode: "VERTICAL",
    primaryAxisSizingMode: opts.primaryAxisSizingMode ?? "FIXED",
    counterAxisSizingMode: opts.counterAxisSizingMode,
    width: 343,
    height: 56,
    resize(w: number, h: number) {
      this.width = w;
      this.height = h;
    },
  };
  const child: any = {
    id: "1:1",
    name: "Row",
    type: "FRAME",
    layoutMode: "HORIZONTAL",
    width: 343,
    height: 24,
    parent,
    _h: "FIXED",
    _v: "FIXED",
  };
  Object.defineProperty(child, "layoutSizingHorizontal", {
    configurable: true,
    get() {
      return child._h;
    },
    set(v: string) {
      child._h = v;
      // Figma's hug recompute: only a hugging parent re-derives its size.
      if (v === "FILL" && (parent.counterAxisSizingMode === "AUTO" || child._forceDrift)) parent.width = 339;
    },
  });
  Object.defineProperty(child, "layoutSizingVertical", {
    get() {
      return child._v;
    },
    set(v: string) {
      child._v = v;
    },
  });
  parent.children = [child];
  nodes.set(parent.id, parent);
  nodes.set(child.id, child);
  return { parent, child };
}

beforeEach(() => {
  nodes = new Map();
  (globalThis as any).figma = {
    getNodeByIdAsync: jest.fn(async (id: string) => nodes.get(id) ?? null),
  };
});

describe("bug #9 — parent collapse guard", () => {
  it("throws a precise error when a hugging parent shrinks 343 -> 339", async () => {
    const { parent, child } = makeTree({ counterAxisSizingMode: "AUTO" });

    await expect(setLayoutSizing({ nodeId: "1:1", layoutSizingHorizontal: "FILL" })).rejects.toThrow(
      /parent "Bar" \(0:1\) width from 343 to 339/,
    );
    expect(child.layoutSizingHorizontal).toBe("FILL");
    expect(parent.width).toBe(339); // reported honestly, not silently "fine"

    // Same failure, and it names the actionable fix, on a fresh tree.
    nodes.clear();
    makeTree({ counterAxisSizingMode: "AUTO" });
    await expect(setLayoutSizing({ nodeId: "1:1", layoutSizingHorizontal: "FILL" })).rejects.toThrow(
      /set the parent to FIXED on this axis first/,
    );
  });

  it("reports the collapse as a no-op (not success) with strict:false", async () => {
    const { parent } = makeTree({ counterAxisSizingMode: "AUTO" });

    const result: any = await setLayoutSizing({ nodeId: "1:1", layoutSizingHorizontal: "FILL", strict: false });

    expect(result.success).toBe(false);
    expect(result.noops).toEqual([{ property: "parent.width", requested: 343, actual: 339 }]);
    expect(result.warnings.join(" ")).toContain("Bar");
    expect(parent.width).toBe(339);
  });

  it("restores the parent's width when the parent is FIXED on that axis", async () => {
    const { parent, child } = makeTree({ counterAxisSizingMode: "FIXED" });
    // Simulate Figma drifting a FIXED parent anyway.
    child._forceDrift = true;

    const result: any = await setLayoutSizing({ nodeId: "1:1", layoutSizingHorizontal: "FILL" });

    expect(parent.width).toBe(343); // ACTUALLY restored
    expect(parent.height).toBe(56);
    expect(result.success).toBe(true);
    expect(result.parentWidth).toBe(343);
    expect(result.parentSizeRestored[0]).toContain("restored to 343");
  });

  it("leaves the parent alone when nothing drifted", async () => {
    const { parent } = makeTree({ counterAxisSizingMode: "FIXED" });
    const result: any = await setLayoutSizing({ nodeId: "1:1", layoutSizingHorizontal: "FILL" });
    expect(parent.width).toBe(343);
    expect(result.success).toBe(true);
    expect(result.parentSizeRestored).toBeUndefined();
  });
});
