import { scanNode } from "../../../src/videntia_figma_plugin/handlers/lint/checks";
import type { ActiveChecks, LintCategories, Violation } from "../../../src/videntia_figma_plugin/handlers/lint/types";

// Only the spacing check is exercised here; everything else is switched off so
// unrelated violations cannot pollute the assertions.
function makeChecks(): ActiveChecks {
  return {
    rootFrame: false,
    colors: false,
    spacing: true,
    radius: false,
    textStyles: false,
    effectStyles: false,
    autoLayout: false,
    overflow: false,
    screenNaming: false,
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

function scan(node: Record<string, unknown>) {
  const categories = makeCategories();
  const violations: Violation[] = [];
  scanNode(
    node as any,
    1,
    null,
    null,
    makeChecks(),
    categories,
    violations,
    { value: false },
    { value: 0 },
    true, // insideScreen — the spacing checks only run within a screen
  );
  return { categories, violations };
}

describe("lint spacing checks — GRID frames", () => {
  // A GRID frame keeps a stale itemSpacing from before it became a grid. Only
  // gridRowGap/gridColumnGap render, and only those accept variable bindings.
  const gridFrame = (overrides: Record<string, unknown> = {}) => ({
    id: "20:1",
    name: "Perks",
    type: "FRAME",
    visible: true,
    layoutMode: "GRID",
    itemSpacing: 8,
    gridRowGap: 48,
    gridColumnGap: 48,
    ...overrides,
  });

  it("flags unbound grid gaps, not the vestigial itemSpacing", () => {
    const { violations } = scan(gridFrame());
    const props = violations.map((v) => v.property);

    expect(props).toContain("gridRowGap");
    expect(props).toContain("gridColumnGap");
    expect(props).not.toContain("itemSpacing");
  });

  it("describes the violation as a grid gap", () => {
    const { violations } = scan(gridFrame());
    expect(violations[0].message).toContain("Grid gap");
    expect(violations[0].message).toContain("48");
  });

  it("counts bound grid gaps as bound", () => {
    const { categories, violations } = scan(
      gridFrame({
        boundVariables: {
          gridRowGap: { id: "VariableID:1:1" },
          gridColumnGap: { id: "VariableID:1:1" },
        },
      }),
    );

    expect(categories.spacing.bound).toBe(2);
    expect(categories.spacing.unbound).toBe(0);
    expect(violations).toHaveLength(0);
  });

  it("ignores a zero grid gap", () => {
    const { categories } = scan(gridFrame({ gridRowGap: 0, gridColumnGap: 0 }));
    expect(categories.spacing.total).toBe(0);
  });

  it("still checks itemSpacing on non-grid auto-layout", () => {
    const { violations } = scan({
      id: "20:2",
      name: "Row",
      type: "FRAME",
      visible: true,
      layoutMode: "HORIZONTAL",
      itemSpacing: 8,
    });

    expect(violations.map((v) => v.property)).toContain("itemSpacing");
    expect(violations[0].message).toContain("Item spacing");
  });
});
