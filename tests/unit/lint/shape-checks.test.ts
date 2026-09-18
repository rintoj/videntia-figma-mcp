import { scanNode } from "../../../src/videntia_figma_plugin/handlers/lint/checks";
import type { ActiveChecks, LintCategories, Violation } from "../../../src/videntia_figma_plugin/handlers/lint/types";

// Each describe block enables exactly one of the new checks; every other check
// is off so unrelated violations cannot pollute the assertions.
function makeChecks(enabled: Partial<ActiveChecks>): ActiveChecks {
  return {
    rootFrame: false,
    colors: false,
    spacing: false,
    radius: false,
    textStyles: false,
    effectStyles: false,
    autoLayout: false,
    overflow: false,
    clippedContent: false,
    screenNaming: false,
    clippedCorners: false,
    radiusProportion: false,
    crossAxisAlign: false,
    iconColorConsistency: false,
    fixedWidthSlack: false,
    ...enabled,
  };
}

function emptyStats() {
  return { total: 0, bound: 0, unbound: 0 };
}

function makeCategories(): LintCategories {
  return {
    rootFrame: emptyStats(),
    typography: emptyStats(),
    spacing: emptyStats(),
    borderRadius: emptyStats(),
    iconColors: emptyStats(),
    strokesBorders: emptyStats(),
    backgroundFills: emptyStats(),
    effectStyles: emptyStats(),
    overflow: emptyStats(),
    autoLayout: emptyStats(),
    screenNaming: emptyStats(),
  } as LintCategories;
}

function scan(
  node: Record<string, unknown>,
  enabled: Partial<ActiveChecks>,
  parent: Record<string, unknown> | null = null,
) {
  const categories = makeCategories();
  const violations: Violation[] = [];
  scanNode(
    node as any,
    1,
    parent as any,
    null,
    makeChecks(enabled),
    categories,
    violations,
    { value: false },
    { value: 0 },
    true, // insideScreen — every content check is gated on this
  );
  return { categories, violations };
}

const SOLID_FILL = { type: "SOLID", color: { r: 1, g: 1, b: 1 } };

describe("lint — clipping child over a rounded parent", () => {
  const roundedParent = { id: "1:0", name: "Card", type: "FRAME", width: 320, height: 200, cornerRadius: 16 };
  const clippingChild = (overrides: Record<string, unknown> = {}) => ({
    id: "1:1",
    name: "Header",
    type: "FRAME",
    visible: true,
    clipsContent: true,
    cornerRadius: 0,
    fills: [SOLID_FILL],
    x: 0,
    y: 0,
    width: 320,
    height: 64,
    ...overrides,
  });

  it("flags a square clipping child flush with the parent's rounded corners", () => {
    const { violations } = scan(clippingChild(), { clippedCorners: true }, roundedParent);
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("HIGH");
    expect(violations[0].category).toBe("borderRadius");
    expect(violations[0].message).toContain("16");
  });

  it("does not flag a child that already carries the parent's radius", () => {
    const { violations } = scan(clippingChild({ cornerRadius: 16 }), { clippedCorners: true }, roundedParent);
    expect(violations).toHaveLength(0);
  });

  it("does not flag a child inset from the parent's edges", () => {
    const { violations } = scan(clippingChild({ x: 12, y: 12, width: 296 }), { clippedCorners: true }, roundedParent);
    expect(violations).toHaveLength(0);
  });

  it("does not flag a child with no background fill", () => {
    const { violations } = scan(clippingChild({ fills: [] }), { clippedCorners: true }, roundedParent);
    expect(violations).toHaveLength(0);
  });
});

describe("lint — radius disproportionate to height", () => {
  const box = (overrides: Record<string, unknown> = {}) => ({
    id: "2:1",
    name: "Tag",
    type: "FRAME",
    visible: true,
    width: 200,
    height: 100,
    cornerRadius: 45,
    ...overrides,
  });

  it("flags a radius that is most of the half-height", () => {
    const { violations } = scan(box(), { radiusProportion: true });
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("MEDIUM");
    expect(violations[0].message).toContain("45% of height 100");
    expect(violations[0].message).toContain("lens");
  });

  it("exempts a deliberate capsule pill", () => {
    const { violations } = scan(box({ cornerRadius: 50 }), { radiusProportion: true });
    expect(violations).toHaveLength(0);
  });

  it("ignores an ordinary rounded rectangle", () => {
    const { violations } = scan(box({ cornerRadius: 12 }), { radiusProportion: true });
    expect(violations).toHaveLength(0);
  });

  it("ignores ellipses", () => {
    const { violations } = scan(box({ type: "ELLIPSE" }), { radiusProportion: true });
    expect(violations).toHaveLength(0);
  });
});

describe("lint — items-start on a fixed cross-axis container", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: "3:1",
    name: "Row",
    type: "FRAME",
    visible: true,
    layoutMode: "HORIZONTAL",
    counterAxisAlignItems: "MIN",
    layoutSizingHorizontal: "HUG",
    layoutSizingVertical: "FIXED",
    children: [{ id: "3:2", name: "Label", type: "TEXT", visible: true }],
    ...overrides,
  });

  it("flags MIN alignment when the cross axis is fixed", () => {
    const { violations } = scan(row(), { crossAxisAlign: true });
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("LOW");
    expect(violations[0].category).toBe("autoLayout");
    expect(violations[0].property).toBe("counterAxisAlignItems");
    expect(violations[0].message).toContain("height");
  });

  it("checks the horizontal axis for a vertical layout", () => {
    const { violations } = scan(
      row({ layoutMode: "VERTICAL", layoutSizingHorizontal: "FIXED", layoutSizingVertical: "HUG" }),
      { crossAxisAlign: true },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("width");
  });

  it("does not flag when the cross axis hugs its content", () => {
    const { violations } = scan(row({ layoutSizingVertical: "HUG" }), { crossAxisAlign: true });
    expect(violations).toHaveLength(0);
  });

  it("does not flag centered content in a fixed box", () => {
    const { violations } = scan(row({ counterAxisAlignItems: "CENTER" }), { crossAxisAlign: true });
    expect(violations).toHaveLength(0);
  });
});

describe("lint — partially bound icon colours", () => {
  const vector = (id: string, bound: boolean) => ({
    id,
    name: "Path",
    type: "VECTOR",
    visible: true,
    fills: [SOLID_FILL],
    boundVariables: bound ? { fills: [{ id: "VariableID:1:1" }] } : undefined,
  });

  const icon = (children: unknown[]) => ({
    id: "4:1",
    name: "Icon/Bell",
    type: "FRAME",
    visible: true,
    width: 24,
    height: 24,
    children,
  });

  it("flags an icon where only some vectors are bound", () => {
    const { violations } = scan(icon([vector("4:2", true), vector("4:3", false), vector("4:4", false)]), {
      iconColorConsistency: true,
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("MEDIUM");
    expect(violations[0].category).toBe("iconColors");
    expect(violations[0].message).toContain("1 of 3");
  });

  it("does not flag a fully bound icon", () => {
    const { violations } = scan(icon([vector("4:2", true), vector("4:3", true)]), { iconColorConsistency: true });
    expect(violations).toHaveLength(0);
  });

  it("does not flag a fully unbound icon (the colour check covers that)", () => {
    const { violations } = scan(icon([vector("4:2", false), vector("4:3", false)]), { iconColorConsistency: true });
    expect(violations).toHaveLength(0);
  });

  it("sees through nested SVG groups", () => {
    const { violations } = scan(
      icon([
        { id: "4:5", name: "g", type: "GROUP", visible: true, children: [vector("4:6", true), vector("4:7", false)] },
      ]),
      { iconColorConsistency: true },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("1 of 2");
  });
});

describe("lint — fixed-width slack", () => {
  const pill = (overrides: Record<string, unknown> = {}) => ({
    id: "5:1",
    name: "Badge",
    type: "FRAME",
    visible: true,
    layoutMode: "HORIZONTAL",
    layoutSizingHorizontal: "FIXED",
    primaryAxisAlignItems: "MIN",
    width: 160,
    paddingLeft: 8,
    paddingRight: 8,
    itemSpacing: 4,
    children: [
      { id: "5:2", name: "Icon", type: "FRAME", visible: true, width: 16, layoutSizingHorizontal: "FIXED" },
      { id: "5:3", name: "Label", type: "TEXT", visible: true, width: 60, layoutSizingHorizontal: "HUG" },
    ],
    ...overrides,
  });

  it("flags dead space after packed content", () => {
    const { violations } = scan(pill(), { fixedWidthSlack: true });
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("MEDIUM");
    expect(violations[0].message).toContain("64px of dead space");
  });

  it("does not flag when a child fills the remaining width", () => {
    const { violations } = scan(
      pill({
        children: [
          { id: "5:2", name: "Icon", type: "FRAME", visible: true, width: 16, layoutSizingHorizontal: "FIXED" },
          { id: "5:3", name: "Label", type: "TEXT", visible: true, width: 60, layoutSizingHorizontal: "FILL" },
        ],
      }),
      { fixedWidthSlack: true },
    );
    expect(violations).toHaveLength(0);
  });

  it("does not flag centered content", () => {
    const { violations } = scan(pill({ primaryAxisAlignItems: "CENTER" }), { fixedWidthSlack: true });
    expect(violations).toHaveLength(0);
  });

  it("does not flag a snugly fitting row", () => {
    const { violations } = scan(pill({ width: 92 }), { fixedWidthSlack: true });
    expect(violations).toHaveLength(0);
  });

  it("does not flag wide layout scaffolding", () => {
    const { violations } = scan(pill({ width: 900 }), { fixedWidthSlack: true });
    expect(violations).toHaveLength(0);
  });
});
