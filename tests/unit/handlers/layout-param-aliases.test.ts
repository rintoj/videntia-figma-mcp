import {
  setLayoutMode,
  setLayoutSizing,
  setPadding,
  setItemSpacing,
  setAxisAlign,
} from "../../../src/videntia_figma_plugin/handlers/layout";
import { batchActions } from "../../../src/videntia_figma_plugin/handlers/batch";

type MockNode = Record<string, any>;

let nodes: Map<string, MockNode>;
let page: MockNode;

function frame(id: string, overrides: MockNode = {}): MockNode {
  const node: MockNode = {
    id,
    type: "FRAME",
    name: id,
    parent: page,
    layoutMode: "NONE",
    layoutWrap: "NO_WRAP",
    layoutSizingHorizontal: "FIXED",
    layoutSizingVertical: "FIXED",
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    itemSpacing: 0,
    counterAxisSpacing: 0,
    gridRowCount: 1,
    gridColumnCount: 1,
    gridRowGap: 0,
    gridColumnGap: 0,
    primaryAxisAlignItems: "MIN",
    counterAxisAlignItems: "MIN",
    ...overrides,
  };
  nodes.set(id, node);
  return node;
}

beforeEach(() => {
  nodes = new Map();
  page = { id: "0:1", type: "PAGE", name: "Page" };
  (globalThis as any).figma = {
    getNodeByIdAsync: jest.fn(async (id: string) => nodes.get(id) ?? null),
  };
});

afterEach(() => {
  delete (globalThis as any).figma;
});

describe("setLayoutMode", () => {
  it("accepts public mode/rows/columns names", async () => {
    frame("1:1");
    const result = await setLayoutMode({ nodeId: "1:1", mode: "GRID", rows: 2, columns: 3 });
    expect(result).toMatchObject({ layoutMode: "GRID", gridRowCount: 2, gridColumnCount: 3 });
  });

  it("applies GRID to component sets", async () => {
    frame("1:2", { type: "COMPONENT_SET" });
    const result = await setLayoutMode({ nodeId: "1:2", mode: "GRID", columns: 4 });
    expect(result).toMatchObject({ layoutMode: "GRID", gridColumnCount: 4 });
  });

  it("accepts public wrap name", async () => {
    frame("1:3");
    const result = await setLayoutMode({ nodeId: "1:3", mode: "HORIZONTAL", wrap: "WRAP" });
    expect(result).toMatchObject({ layoutMode: "HORIZONTAL", layoutWrap: "WRAP" });
  });

  it("still accepts internal names", async () => {
    frame("1:4");
    const result = await setLayoutMode({ nodeId: "1:4", layoutMode: "GRID", gridRowCount: 5 });
    expect(result).toMatchObject({ layoutMode: "GRID", gridRowCount: 5 });
  });

  it("throws instead of silently succeeding when no mode is given", async () => {
    frame("1:5");
    await expect(setLayoutMode({ nodeId: "1:5", rows: 2 })).rejects.toThrow("Missing layout mode");
    expect(nodes.get("1:5")!.layoutMode).toBe("NONE");
  });
});

describe("setLayoutSizing", () => {
  it("accepts public horizontal/vertical names", async () => {
    const parent = frame("2:0", { layoutMode: "VERTICAL" });
    frame("2:1", { parent, layoutMode: "VERTICAL" });
    const result = await setLayoutSizing({ nodeId: "2:1", horizontal: "FILL", vertical: "HUG" });
    expect(result).toMatchObject({ layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" });
  });

  it("throws when no sizing param is recognized", async () => {
    frame("2:2");
    await expect(setLayoutSizing({ nodeId: "2:2", width: "FILL" })).rejects.toThrow("No sizing values provided");
  });
});

describe("setPadding", () => {
  it("accepts public top/right/bottom/left names", async () => {
    frame("3:1", { layoutMode: "VERTICAL" });
    const result = await setPadding({ nodeId: "3:1", top: 8, left: 4 });
    expect(result).toMatchObject({ paddingTop: 8, paddingLeft: 4, paddingRight: 0 });
  });

  it("treats `padding` as a shorthand for all four sides", async () => {
    frame("3:2", { layoutMode: "VERTICAL" });
    const result = await setPadding({ nodeId: "3:2", padding: 8 });
    expect(result).toMatchObject({ paddingTop: 8, paddingRight: 8, paddingBottom: 8, paddingLeft: 8 });
  });

  it("throws when no padding param is recognized", async () => {
    frame("3:3", { layoutMode: "VERTICAL" });
    await expect(setPadding({ nodeId: "3:3", gap: 8 })).rejects.toThrow("was given no padding values");
  });
});

describe("setItemSpacing", () => {
  it("accepts public gap name", async () => {
    frame("4:1", { layoutMode: "HORIZONTAL" });
    const result = await setItemSpacing({ nodeId: "4:1", gap: 12 });
    expect(result).toMatchObject({ itemSpacing: 12 });
  });

  it("accepts public rowGap/columnGap names on grids", async () => {
    frame("4:2", { layoutMode: "GRID" });
    const result = await setItemSpacing({ nodeId: "4:2", rowGap: 6, columnGap: 10 });
    expect(result).toMatchObject({ gridRowGap: 6, gridColumnGap: 10 });
  });

  it("throws when no spacing param is recognized", async () => {
    frame("4:3", { layoutMode: "HORIZONTAL" });
    await expect(setItemSpacing({ nodeId: "4:3", spacing: 8 })).rejects.toThrow("No spacing values provided");
  });
});

describe("setAxisAlign", () => {
  it("throws when no alignment param is given", async () => {
    frame("5:1", { layoutMode: "HORIZONTAL" });
    await expect(setAxisAlign({ nodeId: "5:1" })).rejects.toThrow("No alignment values provided");
  });
});

describe("batchActions preflight errors", () => {
  it("fails an action carrying __batchError without dispatching it", async () => {
    const handleCommand = jest.fn(async () => ({ ok: true }));
    const result = await batchActions(
      { actions: [{ action: "set_layout_mode", params: { __batchError: "rows/columns apply to GRID mode only" } }] },
      handleCommand,
    );
    expect(handleCommand).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      failed: 1,
      results: [
        {
          index: 0,
          action: "set_layout_mode",
          success: false,
          error: expect.stringContaining("rows/columns apply to GRID mode only"),
        },
      ],
    });
  });
});
