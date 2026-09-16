import { moveNodeAbsolute } from "../../../src/videntia_figma_plugin/handlers/nodes";

type MockNode = {
  id: string;
  name: string;
  x: number;
  y: number;
  absoluteTransform?: number[][];
  absoluteBoundingBox?: { x: number; y: number } | null;
  parent?: { id: string; layoutMode?: string } | null;
};

let nodes: Map<string, MockNode>;

/** Keeps absoluteTransform/absoluteBoundingBox in sync with x/y, offset by the parent origin. */
function makeNode(partial: Partial<MockNode> & { id: string }, parentOrigin = { x: 0, y: 0 }): MockNode {
  const node: any = { name: "Node", x: 0, y: 0, parent: null, ...partial };
  Object.defineProperty(node, "absoluteTransform", {
    get: () => [
      [1, 0, parentOrigin.x + node.x],
      [0, 1, parentOrigin.y + node.y],
    ],
  });
  Object.defineProperty(node, "absoluteBoundingBox", {
    get: () => ({ x: parentOrigin.x + node.x, y: parentOrigin.y + node.y }),
  });
  nodes.set(node.id, node);
  return node;
}

beforeEach(() => {
  nodes = new Map();
  (globalThis as any).figma = {
    getNodeByIdAsync: jest.fn(async (id: string) => nodes.get(id) ?? null),
  };
});

describe("move_node_absolute", () => {
  it("converts absolute coordinates to parent-relative for a nested node", async () => {
    // Parent frame sits at absolute (100, 200); child is at (10, 20) inside it → absolute (110, 220).
    const node = makeNode({ id: "1:1", x: 10, y: 20, parent: { id: "0:1" } }, { x: 100, y: 200 });

    const result = await moveNodeAbsolute({ nodeId: "1:1", x: 400, y: 500 });

    // Absolute 400 with parent origin 100 → parent-relative 300.
    expect(node.x).toBe(300);
    expect(node.y).toBe(300);
    expect(result.absoluteX).toBe(400);
    expect(result.absoluteY).toBe(500);
    expect(result.applied).toBe(true);
  });

  it("is a no-op in coordinates the node already occupies", async () => {
    const node = makeNode({ id: "1:2", x: 5, y: 5, parent: { id: "0:1" } }, { x: 50, y: 50 });
    await moveNodeAbsolute({ nodeId: "1:2", x: 55, y: 55 });
    expect(node.x).toBe(5);
    expect(node.y).toBe(5);
  });

  it("moves only the requested axis", async () => {
    const node = makeNode({ id: "1:3", x: 10, y: 20, parent: { id: "0:1" } }, { x: 0, y: 0 });
    await moveNodeAbsolute({ nodeId: "1:3", x: 99 });
    expect(node.x).toBe(99);
    expect(node.y).toBe(20);
  });

  it("throws by default, and warns with strict:false, when an auto-layout parent ignores the move", async () => {
    const node: any = { id: "1:4", name: "Child", x: 0, y: 0, parent: { id: "0:1", layoutMode: "VERTICAL" } };
    // Auto layout parents reject direct x/y writes.
    Object.defineProperty(node, "x", { get: () => 0, set: () => {} });
    Object.defineProperty(node, "y", { get: () => 0, set: () => {} });
    Object.defineProperty(node, "absoluteTransform", {
      get: () => [
        [1, 0, 0],
        [0, 1, 0],
      ],
    });
    Object.defineProperty(node, "absoluteBoundingBox", { get: () => ({ x: 0, y: 0 }) });
    nodes.set(node.id, node);

    // Strict mode is now default-on: a discarded write throws rather than
    // returning a soft `warning` the caller can miss.
    await expect(moveNodeAbsolute({ nodeId: "1:4", x: 300, y: 300 })).rejects.toThrow("auto layout");

    const result = await moveNodeAbsolute({ nodeId: "1:4", x: 300, y: 300, strict: false });
    expect(result.applied).toBe(false);
    expect(String(result.warning)).toContain("auto layout");
  });

  it("rejects a missing node and a call with no coordinates", async () => {
    makeNode({ id: "1:5", parent: { id: "0:1" } });
    await expect(moveNodeAbsolute({ nodeId: "nope", x: 1 })).rejects.toThrow("Node not found");
    await expect(moveNodeAbsolute({ nodeId: "1:5" })).rejects.toThrow("at least one of x or y");
  });
});
