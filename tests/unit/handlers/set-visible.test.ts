import { setVisible } from "../../../src/videntia_figma_plugin/handlers/nodes";
import { normalizeCommandParams } from "../../../src/videntia_figma_mcp/utils/command-params";

type MockNode = Record<string, any>;

let nodes: Map<string, MockNode>;

function addNode(id: string, type: string, parent: MockNode | null = null): MockNode {
  const node: MockNode = { id, type, name: `${type} ${id}`, visible: true, parent };
  nodes.set(id, node);
  return node;
}

beforeEach(() => {
  nodes = new Map();
  (globalThis as any).figma = {
    getNodeByIdAsync: jest.fn(async (id: string) => nodes.get(id) ?? null),
  };
});

afterEach(() => {
  delete (globalThis as any).figma;
});

describe("setVisible", () => {
  it("hides a single node", async () => {
    const rect = addNode("1:1", "RECTANGLE");
    const result = await setVisible({ nodeId: "1:1", visible: false });
    expect(rect.visible).toBe(false);
    expect(result).toEqual({
      visible: false,
      updated: 1,
      failed: 0,
      results: [{ id: "1:1", name: "RECTANGLE 1:1", visible: false }],
    });
  });

  it("merges nodeId and nodeIds without duplicates", async () => {
    const a = addNode("1:1", "FRAME");
    const b = addNode("1:2", "TEXT");
    a.visible = false;
    b.visible = false;
    const result = await setVisible({ nodeId: "1:1", nodeIds: ["1:1", "1:2"], visible: true });
    expect(a.visible).toBe(true);
    expect(b.visible).toBe(true);
    expect(result["updated"]).toBe(2);
    expect((result["results"] as unknown[]).length).toBe(2);
  });

  it("reports a missing node per node and still applies the rest", async () => {
    const rect = addNode("1:1", "RECTANGLE");
    const result = await setVisible({ nodeIds: ["1:1", "9:9"], visible: false });
    expect(rect.visible).toBe(false);
    expect(result["updated"]).toBe(1);
    expect(result["failed"]).toBe(1);
    expect(result["results"]).toEqual([
      { id: "1:1", name: "RECTANGLE 1:1", visible: false },
      { id: "9:9", error: "Node not found with ID: 9:9" },
    ]);
  });

  it("throws when no node could be updated", async () => {
    await expect(setVisible({ nodeId: "9:9", visible: false })).rejects.toThrow("Node not found with ID: 9:9");
  });

  it("rejects nodes without visibility", async () => {
    const page = addNode("0:1", "PAGE");
    delete page.visible;
    await expect(setVisible({ nodeId: "0:1", visible: false })).rejects.toThrow("PAGE nodes have no visibility");
  });

  it("requires ids and a boolean visible", async () => {
    addNode("1:1", "RECTANGLE");
    await expect(setVisible({ visible: false })).rejects.toThrow("Missing nodeId or nodeIds");
    await expect(setVisible({ nodeId: "1:1", visible: "false" })).rejects.toThrow("visible must be true or false");
  });

  it("accepts string booleans once normalized", async () => {
    const rect = addNode("1:1", "RECTANGLE");
    const result = await setVisible(normalizeCommandParams("set_visible", { nodeId: "1-1", visible: "false" }));
    expect(rect.visible).toBe(false);
    expect(result["visible"]).toBe(false);
  });

  it("flags layers inside an instance as instance overrides", async () => {
    const instance = addNode("2:1", "INSTANCE");
    const frame = addNode("I2:1;3:1", "FRAME", instance);
    const icon = addNode("I2:1;3:2", "VECTOR", frame);
    const result = await setVisible({ nodeId: icon.id, visible: false });
    expect(icon.visible).toBe(false);
    expect(result["results"]).toEqual([
      { id: "I2:1;3:2", name: "VECTOR I2:1;3:2", visible: false, instanceOverride: true },
    ]);
  });

  it("surfaces per-node errors thrown by Figma", async () => {
    const ok = addNode("1:1", "RECTANGLE");
    const locked: MockNode = { id: "1:2", type: "FRAME", name: "Locked", parent: null };
    Object.defineProperty(locked, "visible", {
      get: () => true,
      set: () => {
        throw new Error("Cannot change visibility");
      },
    });
    nodes.set("1:2", locked);
    const result = await setVisible({ nodeIds: ["1:1", "1:2"], visible: false });
    expect(ok.visible).toBe(false);
    expect(result["results"]).toEqual([
      { id: "1:1", name: "RECTANGLE 1:1", visible: false },
      { id: "1:2", name: "Locked", error: "Cannot change visibility" },
    ]);
  });
});
