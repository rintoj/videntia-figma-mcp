import { setGridChild, setLayoutMode } from "../../../src/videntia_figma_plugin/handlers/layout";
import { setAutoLayout } from "../../../src/videntia_figma_plugin/handlers/text";
import { serializeNodes } from "../../../src/videntia_figma_plugin/handlers/node-serializer";
import { batchActions } from "../../../src/videntia_figma_plugin/handlers/batch";

type MockNode = Record<string, any>;

let nodes: Map<string, MockNode>;
let page: MockNode;
let writes: string[];

function tracks(count: number): MockNode[] {
  return Array.from({ length: count }, () => ({ type: "FLEX", value: 1 }));
}

/** GRID frame whose track arrays follow gridRowCount/gridColumnCount like Figma's. */
function grid(id: string, rows: number, columns: number, overrides: MockNode = {}): MockNode {
  const state: MockNode = {
    id,
    type: "FRAME",
    name: id,
    parent: page,
    visible: true,
    layoutMode: "GRID",
    layoutSizingHorizontal: "FIXED",
    layoutSizingVertical: "FIXED",
    gridItemsPositioning: "MANUAL",
    gridAutoTracks: "NONE",
    gridRowGap: 0,
    gridColumnGap: 0,
    children: [] as MockNode[],
    gridRowSizes: tracks(rows),
    gridColumnSizes: tracks(columns),
    ...overrides,
  };
  Object.defineProperty(state, "gridRowCount", {
    get: () => state.gridRowSizes.length,
    set: (n: number) => {
      state.gridRowSizes = tracks(n);
    },
    enumerable: true,
  });
  Object.defineProperty(state, "gridColumnCount", {
    get: () => state.gridColumnSizes.length,
    set: (n: number) => {
      state.gridColumnSizes = tracks(n);
    },
    enumerable: true,
  });
  nodes.set(id, state);
  return state;
}

/** Grid child that records every write, in order. */
function cell(id: string, parent: MockNode, row: number, column: number, overrides: MockNode = {}): MockNode {
  const state: MockNode = {
    id,
    type: "FRAME",
    name: id,
    parent,
    visible: true,
    layoutPositioning: "AUTO",
    gridRowAnchorIndex: row,
    gridColumnAnchorIndex: column,
    ...overrides,
  };
  const values: MockNode = {
    gridRowSpan: overrides.gridRowSpan ?? 1,
    gridColumnSpan: overrides.gridColumnSpan ?? 1,
    gridChildHorizontalAlign: overrides.gridChildHorizontalAlign ?? "AUTO",
    gridChildVerticalAlign: overrides.gridChildVerticalAlign ?? "AUTO",
  };
  for (const key of Object.keys(values)) {
    Object.defineProperty(state, key, {
      get: () => values[key],
      set: (v: unknown) => {
        writes.push(`${id}.${key}=${v}`);
        values[key] = v;
      },
      enumerable: true,
      configurable: true,
    });
  }
  state.setGridChildPosition = jest.fn((r: number, c: number) => {
    writes.push(`${id}.position=${r},${c}`);
    state.gridRowAnchorIndex = r;
    state.gridColumnAnchorIndex = c;
  });
  parent.children.push(state);
  nodes.set(id, state);
  return state;
}

beforeEach(() => {
  nodes = new Map();
  writes = [];
  page = { id: "0:1", type: "PAGE", name: "Page" };
  (globalThis as any).figma = {
    mixed: Symbol("mixed"),
    getNodeByIdAsync: jest.fn(async (id: string) => nodes.get(id) ?? null),
    variables: { getLocalVariablesAsync: jest.fn(async () => []) },
    getLocalTextStylesAsync: jest.fn(async () => []),
    getLocalEffectStylesAsync: jest.fn(async () => []),
  };
});

afterEach(() => {
  delete (globalThis as any).figma;
});

describe("setGridChild", () => {
  it("moves a child to a cell and returns the applied state", async () => {
    const g = grid("1:1", 3, 3);
    cell("2:1", g, 0, 0);

    const result = await setGridChild({ nodeId: "2:1", row: 2, column: 1 });

    expect(result).toEqual({
      nodeId: "2:1",
      name: "2:1",
      parentId: "1:1",
      row: 2,
      column: 1,
      rowSpan: 1,
      columnSpan: 1,
      horizontalAlign: "AUTO",
      verticalAlign: "AUTO",
      success: true,
    });
    expect(writes).toEqual(["2:1.position=2,1"]);
  });

  it("keeps the unspecified axis when only row or column is given", async () => {
    const g = grid("1:1", 3, 3);
    cell("2:1", g, 0, 2);
    const result = await setGridChild({ nodeId: "2:1", row: 1 });
    expect(result).toMatchObject({ row: 1, column: 2 });
  });

  it("collapses spans, moves, then grows to the requested spans", async () => {
    const g = grid("1:1", 3, 4);
    cell("2:1", g, 0, 0, { gridColumnSpan: 2 });

    const result = await setGridChild({ nodeId: "2:1", row: 1, column: 1, rowSpan: 2, columnSpan: 3 });

    expect(result).toMatchObject({ row: 1, column: 1, rowSpan: 2, columnSpan: 3 });
    expect(writes).toEqual(["2:1.gridColumnSpan=1", "2:1.position=1,1", "2:1.gridRowSpan=2", "2:1.gridColumnSpan=3"]);
  });

  it("sets spans in place without repositioning", async () => {
    const g = grid("1:1", 2, 2);
    const child = cell("2:1", g, 0, 0);
    await setGridChild({ nodeId: "2:1", columnSpan: 2 });
    expect(child.setGridChildPosition).not.toHaveBeenCalled();
    expect(writes).toEqual(["2:1.gridColumnSpan=2"]);
  });

  it("sets in-cell alignment", async () => {
    const g = grid("1:1", 2, 2, { type: "COMPONENT_SET" });
    cell("2:1", g, 1, 1);
    const result = await setGridChild({ nodeId: "2:1", horizontalAlign: "CENTER", verticalAlign: "MAX" });
    expect(result).toMatchObject({ horizontalAlign: "CENTER", verticalAlign: "MAX" });
    expect(writes).toEqual(["2:1.gridChildHorizontalAlign=CENTER", "2:1.gridChildVerticalAlign=MAX"]);
  });

  it.each([
    [{ row: 3 }, "Row 3 with rowSpan 1 does not fit"],
    [{ column: 2, columnSpan: 2 }, "Column 2 with columnSpan 2 does not fit"],
    [{ rowSpan: 4 }, "rowSpan 4 does not fit"],
  ])("rejects out-of-range %j without mutating", async (params, message) => {
    const g = grid("1:1", 3, 3);
    cell("2:1", g, 0, 0);
    await expect(setGridChild({ nodeId: "2:1", ...params })).rejects.toThrow(message);
    expect(writes).toEqual([]);
  });

  it("rejects an area overlapping a visible sibling without mutating", async () => {
    const g = grid("1:1", 2, 3);
    cell("2:1", g, 0, 0);
    cell("2:2", g, 0, 2);
    cell("2:3", g, 1, 1, { visible: false });
    await expect(setGridChild({ nodeId: "2:1", columnSpan: 3 })).rejects.toThrow('overlaps "2:2" (2:2)');
    expect(writes).toEqual([]);
    // Hidden siblings do not block.
    await expect(setGridChild({ nodeId: "2:1", row: 1, columnSpan: 2 })).resolves.toMatchObject({ row: 1 });
  });

  it("rejects a child whose parent is not a GRID frame without mutating", async () => {
    const g = grid("1:1", 2, 2, { layoutMode: "VERTICAL" });
    cell("2:1", g, 0, 0);
    await expect(setGridChild({ nodeId: "2:1", row: 1 })).rejects.toThrow(
      "is not a child of a GRID auto-layout frame (parent: FRAME layoutMode VERTICAL)",
    );
    expect(writes).toEqual([]);
  });

  it("rejects a GRID parent of an unsupported type", async () => {
    const g = grid("1:1", 2, 2, { type: "INSTANCE" });
    cell("2:1", g, 0, 0);
    await expect(setGridChild({ nodeId: "2:1", row: 1 })).rejects.toThrow("is not a child of a GRID");
  });

  it("rejects explicit cells in ROW_AUTO_FLOW but still allows spans", async () => {
    const g = grid("1:1", 2, 2, { gridItemsPositioning: "ROW_AUTO_FLOW" });
    cell("2:1", g, 0, 0);
    cell("2:2", g, 0, 1);
    await expect(setGridChild({ nodeId: "2:1", column: 1 })).rejects.toThrow("ROW_AUTO_FLOW");
    expect(writes).toEqual([]);
    await expect(setGridChild({ nodeId: "2:1", columnSpan: 2 })).resolves.toMatchObject({ columnSpan: 2 });
  });

  it("rejects absolutely positioned children", async () => {
    const g = grid("1:1", 2, 2);
    cell("2:1", g, 0, 0, { layoutPositioning: "ABSOLUTE" });
    await expect(setGridChild({ nodeId: "2:1", row: 1 })).rejects.toThrow("absolutely positioned");
  });

  it.each([
    [{ row: -1 }, "row must be an integer ≥ 0"],
    [{ rowSpan: 0 }, "rowSpan must be an integer ≥ 1"],
    [{ column: 1.5 }, "column must be an integer ≥ 0"],
    [{ horizontalAlign: "STRETCH" }, "horizontalAlign must be MIN, CENTER, MAX or AUTO"],
    [{}, "Nothing to set"],
  ])("validates params %j before looking up the node", async (params, message) => {
    await expect(setGridChild({ nodeId: "9:9", ...params })).rejects.toThrow(message);
    expect((globalThis as any).figma.getNodeByIdAsync).not.toHaveBeenCalled();
  });

  it("rolls back when Figma rejects part of the change", async () => {
    const g = grid("1:1", 3, 3);
    const child = cell("2:1", g, 0, 0, { gridRowSpan: 2 });
    const original = Object.getOwnPropertyDescriptor(child, "gridColumnSpan")!;
    let failNext = true;
    Object.defineProperty(child, "gridColumnSpan", {
      get: original.get,
      set: (v: number) => {
        if (v === 3 && failNext) {
          failNext = false;
          throw new Error("overlaps a node");
        }
        original.set!(v);
      },
    });

    await expect(setGridChild({ nodeId: "2:1", row: 1, column: 0, columnSpan: 3 })).rejects.toThrow(
      "Changes were rolled back",
    );
    expect(child.gridRowAnchorIndex).toBe(0);
    expect(child.gridColumnAnchorIndex).toBe(0);
    expect(child.gridRowSpan).toBe(2);
    expect(child.gridColumnSpan).toBe(1);
  });

  it("works through batch_actions", async () => {
    const g = grid("1:1", 2, 2);
    cell("2:1", g, 0, 0);
    const handle = async (command: string, params: Record<string, unknown>) =>
      command === "set_grid_child" ? setGridChild(params) : Promise.reject(new Error(command));
    const result = (await batchActions(
      { actions: [{ action: "set_grid_child", params: { nodeId: "2:1", row: 1, column: 1 } }] },
      handle as any,
    )) as any;
    expect(result.results[0]).toMatchObject({ success: true });
    expect(nodes.get("2:1")!.gridRowAnchorIndex).toBe(1);
  });
});

describe("grid track sizes", () => {
  it("setLayoutMode applies sizes after the track counts", async () => {
    const g = grid("1:1", 1, 1, { layoutMode: "NONE" });
    const result = await setLayoutMode({
      nodeId: "1:1",
      layoutMode: "GRID",
      gridColumnCount: 3,
      gridColumnSizes: [{ type: "FIXED", value: 240 }, { type: "FLEX", value: 2 }, { type: "HUG" }],
    });
    expect(g.gridColumnSizes).toEqual([
      { type: "FIXED", value: 240 },
      { type: "FLEX", value: 2 },
      { type: "HUG", value: 1 },
    ]);
    expect(result.gridColumnSizes).toEqual([
      { type: "FIXED", value: 240 },
      { type: "FLEX", value: 2 },
      { type: "HUG" },
    ]);
    expect(result).not.toHaveProperty("gridRowSizes");
  });

  it("setLayoutMode accepts public rowSizes and rejects a length mismatch before mutating", async () => {
    const g = grid("1:1", 2, 2);
    await setLayoutMode({ nodeId: "1:1", mode: "GRID", rowSizes: [{ type: "HUG" }, { type: "FIXED", value: 10 }] });
    expect(g.gridRowSizes.map((t: MockNode) => t.type)).toEqual(["HUG", "FIXED"]);

    const h = grid("1:2", 2, 2, { layoutMode: "VERTICAL" });
    await expect(
      setLayoutMode({ nodeId: "1:2", layoutMode: "GRID", gridRowCount: 3, gridRowSizes: [{ type: "FLEX" }] }),
    ).rejects.toThrow("rowSizes has 1 entries but the grid has 3");
    expect(h.layoutMode).toBe("VERTICAL");
  });

  it.each([
    [[{ type: "FIXED" }], "is FIXED and needs a value"],
    [[{ type: "HUG", value: 4 }], "is HUG — omit value"],
    [[{ type: "AUTO" }], "type must be FIXED, FLEX or HUG"],
    [[{ type: "FLEX", value: -1 }], "value must be a positive number"],
    [[], "must be a non-empty array"],
  ])("rejects invalid track %j", async (sizes, message) => {
    const g = grid("1:1", 1, 1, { layoutMode: "HORIZONTAL" });
    await expect(setLayoutMode({ nodeId: "1:1", layoutMode: "GRID", gridRowSizes: sizes })).rejects.toThrow(message);
    expect(g.layoutMode).toBe("HORIZONTAL");
  });

  it("rejects sizes without a count when converting to GRID, before mutating", async () => {
    const g = grid("1:1", 2, 2, { layoutMode: "VERTICAL" });
    await expect(
      setLayoutMode({ nodeId: "1:1", layoutMode: "GRID", gridColumnSizes: [{ type: "FLEX" }, { type: "FLEX" }] }),
    ).rejects.toThrow("columnSizes needs columns when converting a VERTICAL frame to GRID");
    expect(g.layoutMode).toBe("VERTICAL");

    const h = grid("1:2", 2, 2, { layoutMode: "NONE", paddingTop: 0 });
    await expect(
      setAutoLayout({ nodeId: "1:2", mode: "GRID", top: 12, rowSizes: [{ type: "HUG" }, { type: "HUG" }] }),
    ).rejects.toThrow("rowSizes needs rows");
    expect(h.layoutMode).toBe("NONE");
    expect(h.paddingTop).toBe(0);
  });

  it("rejects sizes outside GRID mode", async () => {
    grid("1:1", 1, 1);
    await expect(
      setLayoutMode({ nodeId: "1:1", layoutMode: "VERTICAL", gridRowSizes: [{ type: "HUG" }] }),
    ).rejects.toThrow("apply to GRID mode only");
  });

  it("setAutoLayout applies sizes after counts on the GRID path", async () => {
    const g = grid("1:1", 1, 1, {
      layoutMode: "NONE",
      paddingTop: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      paddingRight: 0,
      itemSpacing: 0,
    });
    const result = await setAutoLayout({
      nodeId: "1:1",
      mode: "GRID",
      rows: 2,
      rowSizes: [{ type: "FIXED", value: 48 }, { type: "FLEX" }],
    });
    expect(g.gridRowSizes[0]).toEqual({ type: "FIXED", value: 48 });
    expect(g.gridRowSizes[1].type).toBe("FLEX");
    expect(result.gridRowSizes).toEqual([
      { type: "FIXED", value: 48 },
      { type: "FLEX", value: 1 },
    ]);
  });

  it("setAutoLayout rejects a size-count mismatch before mutating", async () => {
    const g = grid("1:1", 2, 2);
    await expect(
      setAutoLayout({ nodeId: "1:1", mode: "GRID", gap: 8, columnSizes: [{ type: "HUG" }] }),
    ).rejects.toThrow("columnSizes has 1 entries but the grid has 2");
    expect(g.gridRowGap).toBe(0);
  });
});

describe("serializeNodes grid fields", () => {
  it("emits track sizes on GRID frames and cell placement on their children", async () => {
    const g = grid("1:1", 2, 2, { fills: [], strokes: [], effects: [] });
    g.gridColumnSizes[0].type = "FIXED";
    g.gridColumnSizes[0].value = 120;
    g.gridRowSizes[1].type = "HUG";
    cell("2:1", g, 1, 0, {
      fills: [],
      strokes: [],
      effects: [],
      gridColumnSpan: 2,
      gridChildHorizontalAlign: "CENTER",
      children: [],
    });

    const result = (await serializeNodes({ nodeIds: ["1:1"], depth: 1 })) as { nodes: MockNode[] };
    const frame = result.nodes[0];

    expect(frame.gridRowSizes).toEqual([{ type: "FLEX", value: 1 }, { type: "HUG" }]);
    expect(frame.gridColumnSizes).toEqual([
      { type: "FIXED", value: 120 },
      { type: "FLEX", value: 1 },
    ]);
    expect(frame).not.toHaveProperty("gridRowAnchorIndex");
    expect(frame.children[0]).toMatchObject({
      gridRowAnchorIndex: 1,
      gridColumnAnchorIndex: 0,
      gridRowSpan: 1,
      gridColumnSpan: 2,
      gridChildHorizontalAlign: "CENTER",
      gridChildVerticalAlign: "AUTO",
    });
  });

  it("omits cell placement for children of non-grid frames", async () => {
    const g = grid("1:1", 1, 1, { layoutMode: "VERTICAL", fills: [], strokes: [], effects: [] });
    cell("2:1", g, 0, 0, { fills: [], strokes: [], effects: [], children: [] });
    const result = (await serializeNodes({ nodeIds: ["2:1"] })) as { nodes: MockNode[] };
    expect(result.nodes[0]).not.toHaveProperty("gridRowAnchorIndex");
    expect(result.nodes[0]).not.toHaveProperty("gridChildVerticalAlign");
  });
});
