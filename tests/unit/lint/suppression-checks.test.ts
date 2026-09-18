import { scanNode } from "../../../src/videntia_figma_plugin/handlers/lint/checks";
import { lintFrame } from "../../../src/videntia_figma_plugin/handlers/lint/index";
import { normalizeLintNodeId, parseIgnoreValue } from "../../../src/videntia_figma_plugin/handlers/lint/helpers";
import type {
  ActiveChecks,
  LintCategories,
  LintScope,
  Violation,
} from "../../../src/videntia_figma_plugin/handlers/lint/types";

const NONE: ActiveChecks = {
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
};

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

function makeScope(opts: { ignoreNodeIds?: string[]; ignoreRules?: string[] } = {}): LintScope {
  const ids: Record<string, true> = {};
  (opts.ignoreNodeIds || []).forEach((id) => (ids[id] = true));
  return { ignoreNodeIds: ids, ignoreRules: opts.ignoreRules || [], suppressed: { total: 0, byRule: {} } };
}

function scan(root: Record<string, unknown>, checks: Partial<ActiveChecks>, scope: LintScope = makeScope()) {
  const categories = makeCategories();
  const violations: Violation[] = [];
  scanNode(
    root as any,
    0,
    null,
    null,
    { ...NONE, ...checks },
    categories,
    violations,
    { value: false },
    { value: 0 },
    true,
    scope,
  );
  return { categories, violations, suppressed: scope.suppressed };
}

type Box = { x: number; y: number; width: number; height: number };

function node(id: string, name: string, box: Box, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    type: "FRAME",
    visible: true,
    absoluteBoundingBox: box,
    width: box.width,
    height: box.height,
    ...extra,
  };
}

function screen(children: unknown[], extra: Record<string, unknown> = {}) {
  return node("1:1", "Screen", { x: 0, y: 0, width: 375, height: 812 }, { clipsContent: false, children, ...extra });
}

const solid = { type: "SOLID", visible: true, opacity: 1, color: { r: 1, g: 0, b: 0 } };
const gradient = { type: "GRADIENT_LINEAR", visible: true, opacity: 1 };
const rect = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  node(id, name, { x: 0, y: 0, width: 100, height: 100 }, { type: "RECTANGLE", ...extra });
// A TEXT child keeps a frame from being classified as an icon container (vector-only children).
const label = (id: string) => node(id, "Label", { x: 0, y: 0, width: 50, height: 20 }, { type: "TEXT" });

beforeAll(() => {
  (globalThis as any).figma = { mixed: Symbol("mixed") };
});

describe("lint overflow / clipped-content dedup", () => {
  const carousel = (extra: Record<string, unknown> = {}) =>
    node(
      "1:2",
      "Carousel",
      { x: 0, y: 100, width: 375, height: 200 },
      {
        clipsContent: true,
        layoutSizingVertical: "FIXED",
        children: [
          node("1:3", "Slide 1", { x: 0, y: 100, width: 300, height: 200 }),
          node("1:4", "Slide 2", { x: 316, y: 100, width: 300, height: 200 }),
        ],
        ...extra,
      },
    );

  it("reports a carousel slide once, as clipped-content", () => {
    const { violations, categories } = scan(screen([carousel()]), { overflow: true, clippedContent: true });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ nodeId: "1:4", rule: "clipped-content", category: "clippedContent" });
    expect(categories.overflow.unbound).toBe(0);
  });

  it("falls back to overflow when clippedContent is disabled", () => {
    const { violations } = scan(screen([carousel()]), { overflow: true, clippedContent: false });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ nodeId: "1:4", rule: "overflow", severity: "CRITICAL" });
  });

  it("keeps overflow for children of a screen-level clip, which clipped-content does not own", () => {
    const wide = node("1:2", "Wide", { x: 0, y: 0, width: 400, height: 100 });
    const { violations } = scan(screen([wide], { clipsContent: true }), { overflow: true, clippedContent: true });

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("overflow");
  });

  it("exempts IMAGE-filled nodes from overflow, like Image/ names", () => {
    const card = node(
      "1:2",
      "Card",
      { x: 0, y: 0, width: 200, height: 100 },
      {
        children: [
          node("1:3", "Photo", { x: 0, y: 0, width: 260, height: 100 }, { fills: [{ type: "IMAGE", visible: true }] }),
          node("1:4", "Image/Hero", { x: 0, y: 0, width: 260, height: 100 }),
          node("1:5", "Row", { x: 0, y: 0, width: 260, height: 100 }),
        ],
      },
    );
    const { violations } = scan(screen([card]), { overflow: true });

    expect(violations.map((v) => v.nodeId)).toEqual(["1:5"]);
  });
});

describe("lint instance paint inheritance", () => {
  const vector = (id: string) =>
    node(id, "Mark", { x: 0, y: 0, width: 80, height: 40 }, { type: "VECTOR", fills: [solid] });
  const instance = (id: string, overrides: unknown[], extra: Record<string, unknown> = {}) =>
    node(
      id,
      "Logo",
      { x: 0, y: 0, width: 120, height: 60 },
      { type: "INSTANCE", overrides, children: [vector("I" + id + ";1:11")], ...extra },
    );

  it("does not report paints inherited from the main component", () => {
    const { violations, categories } = scan(screen([instance("1:20", [], { fills: [solid] })]), { colors: true });

    expect(violations).toHaveLength(0);
    expect(categories.iconColors.total + categories.backgroundFills.total).toBe(0);
  });

  it("reports overridden fills inside an instance", () => {
    const inst = instance("1:20", [{ id: "I1:20;1:11", overriddenFields: ["fills"] }]);
    const { violations } = scan(screen([inst]), { colors: true });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ nodeId: "I1:20;1:11", rule: "hardcoded-color" });
  });

  it("reports an unbound logo paint once, on the main component", () => {
    const main = node(
      "1:10",
      "Logo",
      { x: 0, y: 0, width: 120, height: 60 },
      { type: "COMPONENT", children: [vector("1:11")] },
    );
    const { violations } = scan(screen([main, instance("1:20", []), instance("1:30", [])]), { colors: true });

    expect(violations).toHaveLength(1);
    expect(violations[0].nodeId).toBe("1:11");
  });
});

describe("lint rule ids", () => {
  it("tags every violation with a stable rule id", () => {
    const loose = node(
      "1:2",
      "Loose",
      { x: 0, y: 0, width: 200, height: 200 },
      { layoutMode: "NONE", fills: [gradient], children: [rect("1:3", "Box", { fills: [solid] }), label("1:9")] },
    );
    const { violations } = scan(screen([loose]), { colors: true, autoLayout: true });
    const rules = violations.map((v) => v.nodeId + " " + v.rule).sort();

    expect(rules).toContain("1:2 gradient-without-style");
    expect(rules).toContain("1:2 no-auto-layout");
    expect(rules).toContain("1:3 hardcoded-color");
    expect(violations.every((v) => typeof v.rule === "string" && /^[a-z-]+$/.test(v.rule))).toBe(true);
  });
});

describe("lint suppression", () => {
  const tree = (cardExtra: Record<string, unknown> = {}) =>
    screen([
      node(
        "1:2",
        "Card",
        { x: 0, y: 0, width: 200, height: 200 },
        { fills: [solid], children: [rect("1:3", "Scrim", { fills: [gradient] }), label("1:9")], ...cardExtra },
      ),
      rect("1:4", "Other", { fills: [solid] }),
    ]);

  it("ignoreNodeIds suppresses the node and its subtree, excluded from tallies", () => {
    const scope = makeScope({ ignoreNodeIds: ["1:2"] });
    const { violations, categories, suppressed } = scan(tree(), { colors: true }, scope);

    expect(violations.map((v) => v.nodeId)).toEqual(["1:4"]);
    expect(suppressed).toEqual({ total: 2, byRule: { "hardcoded-color": 1, "gradient-without-style": 1 } });
    expect(categories.backgroundFills).toMatchObject({ total: 1, unbound: 1 });
  });

  it("ignoreRules accepts rule ids", () => {
    const { violations, suppressed } = scan(tree(), { colors: true }, makeScope({ ignoreRules: ["hardcoded-color"] }));

    expect(violations.map((v) => v.rule)).toEqual(["gradient-without-style"]);
    expect(suppressed.total).toBe(2);
  });

  it("ignoreRules accepts category names", () => {
    const { violations, suppressed, categories } = scan(
      tree(),
      { colors: true },
      makeScope({ ignoreRules: ["backgroundFills"] }),
    );

    expect(violations).toHaveLength(0);
    expect(suppressed.byRule).toEqual({ "hardcoded-color": 2, "gradient-without-style": 1 });
    expect(categories.backgroundFills.total).toBe(0);
  });

  it("honors shared plugin data lint-ignore rules on a subtree", () => {
    const getSharedPluginData = jest.fn((ns: string, key: string) =>
      ns === "videntia" && key === "lint-ignore" ? "hardcoded-color" : "",
    );
    const { violations, suppressed } = scan(tree({ getSharedPluginData }), { colors: true });

    expect(violations.map((v) => v.nodeId + " " + v.rule).sort()).toEqual([
      "1:3 gradient-without-style",
      "1:4 hardcoded-color",
    ]);
    expect(suppressed.byRule).toEqual({ "hardcoded-color": 1 });
  });

  it("honors a [lint-ignore] name token for every rule", () => {
    const { violations } = scan(tree({ name: "Card [lint-ignore]" }), { colors: true });

    expect(violations.map((v) => v.nodeId)).toEqual(["1:4"]);
  });

  it("honors a rule-scoped name token on clipped-content", () => {
    const slide = node("1:4", "Slide [lint-ignore:clipped-content]", { x: 316, y: 100, width: 300, height: 200 });
    const carousel = node(
      "1:2",
      "Carousel",
      { x: 0, y: 100, width: 375, height: 200 },
      { clipsContent: true, children: [slide] },
    );
    const { violations, suppressed, categories } = scan(screen([carousel]), { clippedContent: true, overflow: true });

    expect(violations).toHaveLength(0);
    expect(suppressed).toEqual({ total: 1, byRule: { "clipped-content": 1 } });
    expect(categories.clippedContent.total).toBe(0);
  });

  it("parses ignore values and normalizes URL-style node ids", () => {
    expect(parseIgnoreValue("*")).toEqual({ all: true, rules: [] });
    expect(parseIgnoreValue(" overflow , clipped-content ")).toEqual({
      all: false,
      rules: ["overflow", "clipped-content"],
    });
    expect(parseIgnoreValue("")).toBeNull();
    expect(normalizeLintNodeId("12-34")).toBe("12:34");
    expect(normalizeLintNodeId("I1-2;3-4")).toBe("I1:2;3:4");
    expect(normalizeLintNodeId("1:2")).toBe("1:2");
  });
});

describe("lintFrame suppression result", () => {
  it("normalizes ignoreNodeIds, reports suppressed counts and computes compliance without them", async () => {
    const bound = rect("1:3", "Bound", { fills: [solid], boundVariables: { fills: [{ id: "VariableID:1" }] } });
    const raw = rect("1:2", "Raw", { fills: [solid] });
    const root = node("1:1", "Card", { x: 0, y: 0, width: 375, height: 812 }, { children: [raw, bound] });
    (root as any).parent = { type: "SECTION" };
    (globalThis as any).figma = {
      mixed: Symbol("mixed"),
      getNodeByIdAsync: jest.fn(async (id: string) => (id === "1:1" ? root : null)),
      variables: { getLocalVariablesAsync: jest.fn(async () => []) },
      getLocalTextStylesAsync: jest.fn(async () => []),
      getLocalEffectStylesAsync: jest.fn(async () => []),
      getLocalPaintStylesAsync: jest.fn(async () => []),
    };

    const result = await lintFrame({
      nodeId: "1:1",
      checks: { autoLayout: false, overflow: false, clippedContent: false, iconColorConsistency: false },
      ignoreNodeIds: ["1-2"],
    });

    expect(result.violations).toHaveLength(0);
    expect(result.suppressed).toEqual({ total: 1, byRule: { "hardcoded-color": 1 } });
    expect(result.summary.compliance).toBe(100);
    expect(result.categories.backgroundFills).toMatchObject({ total: 1, bound: 1, unbound: 0 });
  });
});
