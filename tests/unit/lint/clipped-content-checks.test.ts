import { scanNode } from "../../../src/videntia_figma_plugin/handlers/lint/checks";
import type { ActiveChecks, LintCategories, Violation } from "../../../src/videntia_figma_plugin/handlers/lint/types";

function makeChecks(clippedContent = true): ActiveChecks {
  return {
    rootFrame: false,
    colors: false,
    spacing: false,
    radius: false,
    textStyles: false,
    effectStyles: false,
    autoLayout: false,
    overflow: false,
    clippedContent,
    screenNaming: false,
  };
}

function makeCategories(): LintCategories {
  const s = () => ({ total: 0, bound: 0, unbound: 0, compliance: 100 });
  return {
    rootFrame: s(),
    typography: s(),
    spacing: s(),
    borderRadius: s(),
    iconColors: s(),
    strokesBorders: s(),
    backgroundFills: s(),
    effectStyles: s(),
    overflow: s(),
    clippedContent: s(),
    autoLayout: s(),
    screenNaming: s(),
  };
}

// Scans `root` as the linted root (parent = null, depth 0).
function scan(root: Record<string, unknown>, clippedContent = true) {
  const categories = makeCategories();
  const violations: Violation[] = [];
  scanNode(
    root as any,
    0,
    null,
    null,
    makeChecks(clippedContent),
    categories,
    violations,
    { value: false },
    { value: 0 },
    true,
  );
  return { categories, violations };
}

type Box = { x: number; y: number; width: number; height: number };

function node(id: string, name: string, box: Box, extra: Record<string, unknown> = {}) {
  return { id, name, type: "FRAME", visible: true, absoluteBoundingBox: box, ...extra };
}

function screen(children: unknown[], extra: Record<string, unknown> = {}) {
  return node("1:1", "Screen", { x: 0, y: 0, width: 375, height: 812 }, { clipsContent: false, children, ...extra });
}

const shadow = (x: number, y: number, radius: number, spread = 0) => ({
  type: "DROP_SHADOW",
  visible: true,
  offset: { x, y },
  radius,
  spread,
});

describe("lint clipped-content check", () => {
  const cardBox = { x: 16, y: 16, width: 200, height: 100 };

  it("reports a drop shadow clipped by a clipping card with sides and px", () => {
    const button = node("1:3", "Button", { x: 32, y: 86, width: 100, height: 30 }, { effects: [shadow(0, 4, 8)] });
    const card = node("1:2", "Card", cardBox, { clipsContent: true, children: [button] });

    const { violations, categories } = scan(screen([card]));

    expect(violations).toHaveLength(1);
    const v = violations[0];
    expect(v.nodeId).toBe("1:3");
    expect(v.severity).toBe("HIGH");
    expect(v.category).toBe("clippedContent");
    expect(v.property).toBe("clipsContent");
    expect(v.details).toMatchObject({
      clippingNodeId: "1:2",
      clippingNodeName: "Card",
      clippedSides: { bottom: 12 },
      cause: "effect",
      effectSources: ["DROP_SHADOW"],
      overflowAmount: 12,
    });
    expect(v.message).toContain("bottom 12px");
    expect(v.message).toContain("set_clips_content");
    expect(v.message).toContain('"1:2"');
    expect(categories.clippedContent.unbound).toBe(1);
  });

  it("does not report when the ancestor does not clip", () => {
    const button = node("1:3", "Button", { x: 32, y: 86, width: 100, height: 30 }, { effects: [shadow(0, 4, 8)] });
    const card = node("1:2", "Card", cardBox, { clipsContent: false, children: [button] });

    expect(scan(screen([card])).violations).toHaveLength(0);
  });

  it("does not report when the check is toggled off", () => {
    const button = node("1:3", "Button", { x: 32, y: 86, width: 100, height: 30 }, { effects: [shadow(0, 4, 8)] });
    const card = node("1:2", "Card", cardBox, { clipsContent: true, children: [button] });

    expect(scan(screen([card]), false).violations).toHaveLength(0);
  });

  it("reports a large glow on every side, including ABSOLUTE-positioned layers", () => {
    const glow = node(
      "1:3",
      "Glow",
      { x: 40, y: 40, width: 152, height: 52 },
      { layoutPositioning: "ABSOLUTE", effects: [shadow(0, 0, 24, 8)] },
    );
    const card = node("1:2", "Card", cardBox, { clipsContent: true, children: [glow] });

    const { violations } = scan(screen([card]));

    expect(violations).toHaveLength(1);
    expect(violations[0].details!.clippedSides).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
    expect(violations[0].details!.cause).toBe("effect");
  });

  it("reports a layer blur but ignores inner shadows and background blur", () => {
    const blurred = node(
      "1:3",
      "Blurred",
      { x: 20, y: 40, width: 100, height: 20 },
      { effects: [{ type: "LAYER_BLUR", visible: true, radius: 10 }] },
    );
    const inset = node(
      "1:4",
      "Inset",
      { x: 16, y: 16, width: 200, height: 100 },
      {
        effects: [
          { type: "INNER_SHADOW", visible: true, offset: { x: 0, y: 8 }, radius: 40, spread: 10 },
          { type: "BACKGROUND_BLUR", visible: true, radius: 40 },
        ],
      },
    );
    const card = node("1:2", "Card", cardBox, { clipsContent: true, children: [blurred, inset] });

    const { violations } = scan(screen([card]));

    expect(violations).toHaveLength(1);
    expect(violations[0].nodeId).toBe("1:3");
    expect(violations[0].details!.clippedSides).toEqual({ left: 6 });
    expect(violations[0].details!.effectSources).toEqual(["LAYER_BLUR"]);
  });

  it("reports an OUTSIDE stroke (focus ring) flush against the clip edge", () => {
    const input = node(
      "1:3",
      "Input",
      { x: 16, y: 16, width: 120, height: 40 },
      { strokes: [{ type: "SOLID", visible: true }], strokeAlign: "OUTSIDE", strokeWeight: 2 },
    );
    const card = node("1:2", "Card", cardBox, { clipsContent: true, children: [input] });

    const { violations } = scan(screen([card]));

    expect(violations).toHaveLength(1);
    expect(violations[0].details!.clippedSides).toEqual({ top: 2, left: 2 });
    expect(violations[0].details!.effectSources).toEqual(["OUTSIDE stroke"]);
  });

  it("reports child bounds overflowing a nested clipping card", () => {
    const row = node("1:4", "Row", { x: 32, y: 32, width: 360, height: 40 });
    const card = node(
      "1:3",
      "Card",
      { x: 16, y: 16, width: 343, height: 200 },
      { clipsContent: true, children: [row] },
    );
    const root = screen([card], { clipsContent: true });

    const { violations } = scan(root);

    expect(violations).toHaveLength(1);
    expect(violations[0].nodeId).toBe("1:4");
    expect(violations[0].details).toMatchObject({
      clippingNodeId: "1:3",
      clippedSides: { right: 33 },
      cause: "bounds",
    });
    expect(violations[0].message).toContain("Node bounds");
  });

  it("does not report scrolled content overflowing the root screen's bounds", () => {
    const section = node(
      "1:2",
      "Feed",
      { x: 0, y: 700, width: 375, height: 600 },
      {
        children: [node("1:3", "Item", { x: 0, y: 1200, width: 375, height: 100 })],
      },
    );

    expect(scan(screen([section], { clipsContent: true })).violations).toHaveLength(0);
  });

  it("still reports effect clipping on the root screen", () => {
    const banner = node("1:2", "Banner", { x: 0, y: 100, width: 375, height: 80 }, { effects: [shadow(0, 0, 8)] });

    const { violations } = scan(screen([banner], { clipsContent: true }));

    expect(violations).toHaveLength(1);
    expect(violations[0].details!.clippedSides).toEqual({ left: 8, right: 8 });
    expect(violations[0].details!.clippingNodeId).toBe("1:1");
  });

  it("does not report intentional image crops", () => {
    const named = node("1:3", "Image/Hero", { x: 0, y: 0, width: 260, height: 160 }, { type: "RECTANGLE" });
    const filled = node(
      "1:4",
      "Photo",
      { x: -20, y: 0, width: 260, height: 160 },
      { type: "RECTANGLE", fills: [{ type: "IMAGE", visible: true }] },
    );
    const card = node("1:2", "Card", cardBox, { clipsContent: true, children: [named, filled] });

    expect(scan(screen([card])).violations).toHaveLength(0);
  });
});
