import { setConstraints, parseConstraintsParam } from "../../../src/videntia_figma_plugin/handlers/layout";
import { createSvg } from "../../../src/videntia_figma_plugin/handlers/shapes";
import { serializeNodes } from "../../../src/videntia_figma_plugin/handlers/node-serializer";

type MockNode = Record<string, any>;

let nodes: Map<string, MockNode>;
let page: MockNode;

function register(node: MockNode): MockNode {
  nodes.set(node.id, node);
  return node;
}

function frame(id: string, overrides: MockNode = {}): MockNode {
  return register({
    id,
    type: "FRAME",
    name: `Frame ${id}`,
    visible: true,
    parent: page,
    layoutMode: "NONE",
    layoutPositioning: "AUTO",
    constraints: { horizontal: "MIN", vertical: "MIN" },
    children: [],
    ...overrides,
  });
}

function vector(id: string, overrides: MockNode = {}): MockNode {
  return register({
    id,
    type: "VECTOR",
    name: `Vector ${id}`,
    visible: true,
    constraints: { horizontal: "SCALE", vertical: "SCALE" },
    ...overrides,
  });
}

beforeEach(() => {
  nodes = new Map();
  page = { id: "0:1", type: "PAGE", name: "Page" };
  (globalThis as any).figma = {
    mixed: Symbol("mixed"),
    getNodeByIdAsync: jest.fn(async (id: string) => nodes.get(id) ?? null),
    currentPage: {
      id: "0:1",
      selection: [],
      appendChild: (child: any) => {
        child.parent = page;
      },
    },
    variables: { getLocalVariablesAsync: jest.fn(async () => []) },
    getLocalTextStylesAsync: jest.fn(async () => []),
    getLocalEffectStylesAsync: jest.fn(async () => []),
  };
});

afterEach(() => {
  delete (globalThis as any).figma;
});

describe("setConstraints", () => {
  it("sets both axes on a single node", async () => {
    const parent = frame("1:0");
    frame("1:1", { parent });
    const result = await setConstraints({ nodeId: "1:1", horizontal: "STRETCH", vertical: "CENTER" });
    expect(result).toMatchObject({
      success: true,
      updated: 1,
      failed: 0,
      results: [{ nodeId: "1:1", success: true, constraints: { horizontal: "STRETCH", vertical: "CENTER" } }],
    });
    expect(nodes.get("1:1")!.constraints).toEqual({ horizontal: "STRETCH", vertical: "CENTER" });
    expect((result.results as MockNode[])[0]).not.toHaveProperty("warning");
  });

  it("keeps the current value of the omitted axis", async () => {
    const parent = frame("2:0");
    frame("2:1", { parent, constraints: { horizontal: "MAX", vertical: "SCALE" } });
    await setConstraints({ nodeId: "2:1", vertical: "MIN" });
    expect(nodes.get("2:1")!.constraints).toEqual({ horizontal: "MAX", vertical: "MIN" });
  });

  it("updates multiple nodes and merges nodeId with nodeIds", async () => {
    const parent = frame("3:0");
    frame("3:1", { parent });
    frame("3:2", { parent });
    frame("3:3", { parent });
    const result = await setConstraints({ nodeId: "3:1", nodeIds: ["3:2", "3:3", "3:1"], horizontal: "CENTER" });
    expect(result).toMatchObject({ success: true, updated: 3, failed: 0 });
    for (const id of ["3:1", "3:2", "3:3"]) {
      expect(nodes.get(id)!.constraints).toEqual({ horizontal: "CENTER", vertical: "MIN" });
    }
  });

  it("reports unsupported and missing nodes per node without failing the rest", async () => {
    const parent = frame("4:0");
    frame("4:1", { parent });
    register({ id: "4:2", type: "GROUP", name: "Group", parent, children: [] });
    const result = await setConstraints({ nodeIds: ["4:1", "4:2", "4:9"], horizontal: "MAX" });
    expect(result).toMatchObject({
      success: false,
      updated: 1,
      failed: 2,
      results: [
        { nodeId: "4:1", success: true },
        { nodeId: "4:2", success: false, error: 'Node "Group" does not support constraints (type: GROUP)' },
        { nodeId: "4:9", success: false, error: "Node with ID 4:9 not found" },
      ],
    });
  });

  it("throws when every node fails", async () => {
    register({ id: "5:1", type: "GROUP", name: "Group", parent: page, children: [] });
    await expect(setConstraints({ nodeId: "5:1", horizontal: "MIN" })).rejects.toThrow(
      "does not support constraints (type: GROUP)",
    );
  });

  it("warns for an auto-layout child in the flow but not for an absolute child", async () => {
    const parent = frame("6:0", { layoutMode: "VERTICAL" });
    frame("6:1", { parent });
    frame("6:2", { parent, layoutPositioning: "ABSOLUTE" });
    const result = await setConstraints({ nodeIds: ["6:1", "6:2"], horizontal: "STRETCH" });
    const [flow, absolute] = result.results as MockNode[];
    expect(flow.warning).toContain("auto-layout child");
    expect(flow.warning).toContain("layoutPositioning AUTO");
    expect(absolute).not.toHaveProperty("warning");
    expect(nodes.get("6:1")!.constraints.horizontal).toBe("STRETCH");
  });

  it("warns for a top-level node on the page", async () => {
    frame("7:1");
    const result = await setConstraints({ nodeId: "7:1", vertical: "MAX" });
    expect((result.results as MockNode[])[0].warning).toContain("directly on the page");
  });

  it("validates params before touching any node", async () => {
    frame("8:1");
    await expect(setConstraints({ nodeId: "8:1" })).rejects.toThrow("No constraint values provided");
    await expect(setConstraints({ horizontal: "MIN" })).rejects.toThrow("Missing nodeId or nodeIds");
    await expect(setConstraints({ nodeId: "8:1", horizontal: "LEFT" })).rejects.toThrow(
      "Invalid horizontal constraint: LEFT",
    );
    expect(nodes.get("8:1")!.constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
  });
});

describe("parseConstraintsParam", () => {
  it("returns undefined when absent and rejects empty or invalid objects", () => {
    expect(parseConstraintsParam(undefined)).toBeUndefined();
    expect(parseConstraintsParam({ vertical: "CENTER" })).toEqual({ horizontal: undefined, vertical: "CENTER" });
    expect(() => parseConstraintsParam({})).toThrow("constraints needs horizontal and/or vertical");
    expect(() => parseConstraintsParam("CENTER")).toThrow("constraints must be an object");
    expect(() => parseConstraintsParam({ vertical: "TOP" })).toThrow("Invalid vertical constraint: TOP");
  });
});

describe("createSvg constraints", () => {
  const svg = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';

  function mockSvgImport(): MockNode {
    const group = register({
      id: "9:2",
      type: "GROUP",
      name: "g",
      children: [] as MockNode[],
    });
    const nested = vector("9:3");
    group.children.push(nested);
    const top = vector("9:4");
    const wrapper = frame("9:1", {
      parent: null,
      width: 24,
      height: 24,
      x: 0,
      y: 0,
      strokes: [],
      children: [group, top],
      constraints: { horizontal: "MIN", vertical: "MIN" },
    });
    (globalThis as any).figma.createNodeFromSvg = jest.fn(() => wrapper);
    return wrapper;
  }

  it("keeps Figma's default constraints when none are passed", async () => {
    mockSvgImport();
    const result = (await createSvg({ svgString: svg })) as MockNode;
    expect(nodes.get("9:4")!.constraints).toEqual({ horizontal: "SCALE", vertical: "SCALE" });
    expect(result).not.toHaveProperty("constraints");
  });

  it("applies constraints to every vector descendant, not the wrapper", async () => {
    mockSvgImport();
    const result = (await createSvg({
      svgString: svg,
      constraints: { horizontal: "CENTER", vertical: "CENTER" },
    })) as MockNode;
    expect(nodes.get("9:3")!.constraints).toEqual({ horizontal: "CENTER", vertical: "CENTER" });
    expect(nodes.get("9:4")!.constraints).toEqual({ horizontal: "CENTER", vertical: "CENTER" });
    expect(nodes.get("9:1")!.constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
    expect(result).toMatchObject({
      constraints: { horizontal: "CENTER", vertical: "CENTER" },
      constraintsAppliedTo: 2,
    });
  });

  it("applies constraints to the node itself when the import has no children", async () => {
    const single = vector("10:1", { parent: null, x: 0, y: 0, width: 24, height: 24 });
    (globalThis as any).figma.createNodeFromSvg = jest.fn(() => single);
    const result = (await createSvg({ svgString: svg, constraints: { vertical: "STRETCH" } })) as MockNode;
    expect(single.constraints).toEqual({ horizontal: "SCALE", vertical: "STRETCH" });
    expect(result.constraintsAppliedTo).toBe(1);
  });

  it("rejects invalid constraints before creating anything", async () => {
    const wrapper = mockSvgImport();
    await expect(createSvg({ svgString: svg, constraints: { horizontal: "LEFT" } })).rejects.toThrow(
      "Invalid horizontal constraint: LEFT",
    );
    expect((globalThis as any).figma.createNodeFromSvg).not.toHaveBeenCalled();
    expect(wrapper.parent).toBeNull();
  });
});

describe("serializeNodes constraints", () => {
  it("emits constraints for nodes that support them", async () => {
    const parent = frame("11:0");
    const child = frame("11:1", { parent, constraints: { horizontal: "STRETCH", vertical: "CENTER" } });
    parent.children.push(child);
    const result = (await serializeNodes({ nodeIds: ["11:0"], depth: 1 })) as { nodes: MockNode[] };
    expect(result.nodes[0].constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
    expect(result.nodes[0].children[0].constraints).toEqual({ horizontal: "STRETCH", vertical: "CENTER" });
  });

  it("omits constraints for nodes without them", async () => {
    register({ id: "12:1", type: "GROUP", name: "Group", visible: true, parent: page, children: [] });
    const result = (await serializeNodes({ nodeIds: ["12:1"] })) as { nodes: MockNode[] };
    expect(result.nodes[0]).not.toHaveProperty("constraints");
  });
});
