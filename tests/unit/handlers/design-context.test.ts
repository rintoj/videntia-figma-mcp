import {
  collectBindings,
  collectStyleIds,
  extractNodeContext,
  getDesignContext,
  getVariablesUsed,
  walkBounded,
  withTimeout,
} from "../../../src/videntia_figma_plugin/handlers/design-context";

const MIXED = Symbol("mixed");
const alias = (id: string) => ({ type: "VARIABLE_ALIAS", id });

const variables: Record<string, any> = {
  "V:bg": {
    name: "surface/card",
    resolvedType: "COLOR",
    variableCollectionId: "C:1",
    valuesByMode: { m1: { r: 1, g: 1, b: 1, a: 1 }, m2: alias("V:dark") },
  },
  "V:dark": {
    name: "base/black",
    resolvedType: "COLOR",
    variableCollectionId: "C:1",
    valuesByMode: { m1: { r: 0, g: 0, b: 0, a: 1 } },
  },
  "V:gap": { name: "space/md", resolvedType: "FLOAT", variableCollectionId: "C:1", valuesByMode: { m1: 12, m2: 12 } },
};

function install(nodes: Record<string, any>) {
  (global as any).figma = {
    mixed: MIXED,
    getNodeByIdAsync: jest.fn(async (id: string) => nodes[id] ?? null),
    getStyleByIdAsync: jest.fn(async (id: string) => (id === "S:text" ? { name: "Body/MD", remote: false } : null)),
    variables: {
      getVariableByIdAsync: jest.fn(async (id: string) => (variables[id] ? { id, ...variables[id] } : null)),
      getVariableCollectionByIdAsync: jest.fn(async () => ({
        name: "Theme",
        modes: [
          { modeId: "m1", name: "Light" },
          { modeId: "m2", name: "Dark" },
        ],
      })),
    },
  };
}

const solid = (r: number, g: number, b: number, bound?: string) => ({
  type: "SOLID",
  visible: true,
  opacity: 1,
  color: { r, g, b },
  ...(bound ? { boundVariables: { color: alias(bound) } } : {}),
});

function tree() {
  const text = {
    id: "1:3",
    name: "Title",
    type: "TEXT",
    width: 100,
    height: 20,
    characters: "Hello",
    fontName: { family: "Inter", style: "Semi Bold" },
    fontSize: 16,
    fontWeight: 600,
    lineHeight: { unit: "PIXELS", value: 24 },
    letterSpacing: { unit: "PIXELS", value: 0 },
    textAlignHorizontal: "LEFT",
    fills: [solid(0, 0, 0)],
    textStyleId: "S:text",
    fillStyleId: "",
    getStyledTextSegments: () => [{ start: 0, end: 5, boundVariables: {}, fills: [solid(0, 0, 0, "V:dark")] }],
  };
  const inst = {
    id: "1:4",
    name: "Btn",
    type: "INSTANCE",
    width: 80,
    height: 32,
    fills: [],
    componentProperties: { "Size#1:2": { value: "sm" } },
    getMainComponentAsync: async () => ({
      id: "9:1",
      name: "Size=sm",
      remote: true,
      parent: { type: "COMPONENT_SET", name: "Button" },
    }),
  };
  const root: any = {
    id: "1:2",
    name: "Card",
    type: "FRAME",
    width: 320,
    height: 200,
    layoutMode: "VERTICAL",
    primaryAxisAlignItems: "MIN",
    counterAxisAlignItems: "CENTER",
    itemSpacing: 12,
    paddingTop: 16,
    paddingRight: 16,
    paddingBottom: 16,
    paddingLeft: 16,
    cornerRadius: 8,
    fills: [solid(1, 1, 1, "V:bg")],
    strokes: [],
    effects: [
      {
        type: "DROP_SHADOW",
        visible: true,
        offset: { x: 0, y: 2 },
        radius: 4,
        spread: 0,
        color: { r: 0, g: 0, b: 0, a: 0.25 },
      },
    ],
    boundVariables: { itemSpacing: alias("V:gap"), fills: [alias("V:bg")] },
    children: [text, inst],
    getCSSAsync: async () => ({ display: "flex" }),
  };
  return { root, text, inst };
}

describe("collectBindings / collectStyleIds", () => {
  it("collects field, paint and text-range bindings without duplicates", () => {
    const { root, text } = tree();
    expect(collectBindings(root)).toEqual([
      { field: "itemSpacing", id: "V:gap" },
      { field: "fills[0].color", id: "V:bg" },
    ]);
    expect(collectBindings(text)).toEqual([{ field: "text[0-5].fills[0].color", id: "V:dark" }]);
  });
  it("skips empty style ids", () => {
    expect(collectStyleIds(tree().text)).toEqual([{ field: "textStyleId", id: "S:text", kind: "TEXT" }]);
  });
});

describe("walkBounded", () => {
  it("caps nodes, flags truncation and respects depth", async () => {
    const { root } = tree();
    const seen: string[] = [];
    const r = await walkBounded(root, { maxNodes: 2 }, (n) => {
      seen.push(n.id);
    });
    expect(r).toEqual({ visited: 2, truncated: true });
    const d = await walkBounded(root, { maxNodes: 100, maxDepth: 0 }, () => undefined);
    expect(d).toEqual({ visited: 1, truncated: false });
  });
  it("yields on large trees", async () => {
    const kids = Array.from({ length: 2500 }, (_, i) => ({ id: `k${i}`, type: "RECTANGLE" }));
    const r = await walkBounded({ id: "r", children: kids }, { maxNodes: 10000 }, () => undefined);
    expect(r.visited).toBe(2501);
  });
});

describe("withTimeout", () => {
  it("resolves undefined on timeout or rejection", async () => {
    await expect(withTimeout(new Promise(() => undefined), 5)).resolves.toBeUndefined();
    await expect(withTimeout(Promise.reject(new Error("x")), 5)).resolves.toBeUndefined();
    await expect(withTimeout(Promise.resolve(1), 5)).resolves.toBe(1);
  });
});

describe("extractNodeContext", () => {
  it("maps auto layout to flexbox and inlines tokens", () => {
    install({});
    const tokens = new Map([
      ["itemSpacing", "space/md = 12"],
      ["fills[0].color", "surface/card = #ffffff"],
    ]);
    const c: any = extractNodeContext(tree().root, tokens);
    expect(c.layout).toEqual({
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-start",
      alignItems: "center",
      gap: "12 {space/md = 12}",
      padding: [16, 16, 16, 16],
    });
    expect(c.fills).toEqual(["#ffffff {surface/card = #ffffff}"]);
    expect(c.radius).toBe(8);
    expect(c.effects).toEqual(["0px 2px 4px 0px #00000040"]);
    expect(c.tokens).toBeUndefined();
  });
  it("reads typography and tolerates mixed values", () => {
    install({});
    const t: any = { ...tree().text, fontSize: MIXED };
    const c: any = extractNodeContext(t, new Map());
    expect(c.typography).toMatchObject({
      fontFamily: "Inter",
      fontStyle: "Semi Bold",
      fontSize: "mixed",
      fontWeight: 600,
      lineHeight: 24,
      color: "#000000",
    });
  });
});

describe("getDesignContext", () => {
  it("returns a tree with component info, resolved tokens and css", async () => {
    const { root } = tree();
    install({ "1:2": root });
    const r: any = await getDesignContext({ nodeId: "1-2" });
    expect(r.truncated).toBe(false);
    expect(r.nodesVisited).toBe(3);
    expect(r.root.layout.gap).toBe("12 {space/md = 12}");
    expect(r.root.css).toEqual({ display: "flex" });
    expect(r.root.children.map((c: any) => c.id)).toEqual(["1:3", "1:4"]);
    expect(r.root.children[1].component).toMatchObject({
      kind: "instance",
      mainComponent: "Size=sm",
      componentSet: "Button",
      props: { Size: "sm" },
    });
  });
  it("marks depth truncation", async () => {
    const { root } = tree();
    install({ "1:2": root });
    const r: any = await getDesignContext({ nodeId: "1:2", depth: 0, includeCss: false });
    expect(r.depthTruncated).toBe(true);
    expect(r.root.childCount).toBe(2);
    expect(r.root.children).toBeUndefined();
  });
  it("throws for a missing node", async () => {
    install({});
    await expect(getDesignContext({ nodeId: "9:9" })).rejects.toThrow("Node not found");
  });
});

describe("getVariablesUsed", () => {
  it("dedupes variables, resolves per-mode values and lists styles", async () => {
    const { root } = tree();
    install({ "1:2": root });
    const r: any = await getVariablesUsed({ nodeId: "1:2" });
    expect(r.truncated).toBe(false);
    expect(r.nodesVisited).toBe(3);
    const bg = r.variables.find((v: any) => v.id === "V:bg");
    expect(bg).toMatchObject({
      name: "surface/card",
      collection: "Theme",
      usageCount: 1,
      valuesByMode: { Light: "#ffffff", Dark: "→ base/black" },
    });
    expect(r.variables.map((v: any) => v.name).sort()).toEqual(["base/black", "space/md", "surface/card"]);
    expect(r.styles).toEqual([
      {
        id: "S:text",
        kind: "TEXT",
        name: "Body/MD",
        remote: false,
        missing: false,
        usageCount: 1,
        exampleNodeIds: ["1:3"],
      },
    ]);
  });
  it("honours includeChildren=false and the node cap", async () => {
    const { root } = tree();
    install({ "1:2": root });
    const r: any = await getVariablesUsed({ nodeId: "1:2", includeChildren: false });
    expect(r.nodesVisited).toBe(1);
    const c: any = await getVariablesUsed({ nodeId: "1:2", maxNodes: 2 });
    expect(c.truncated).toBe(true);
  });
});
