import { addPrototypeLink, removePrototypeLink } from "../../../src/videntia_figma_plugin/handlers/prototyping";

type MockNode = { id: string; name: string; type: string; reactions: any[]; setReactionsAsync?: jest.Mock };

let nodes: Map<string, MockNode>;

function reactiveNode(reactions: any[]): MockNode {
  const node: MockNode = { id: "1:2", name: "CTA", type: "FRAME", reactions };
  node.setReactionsAsync = jest.fn(async (next: any[]) => {
    node.reactions = next;
  });
  return node;
}

beforeEach(() => {
  nodes = new Map();
  nodes.set("dest", { id: "dest", name: "Dest", type: "FRAME", reactions: [] });
  (globalThis as any).figma = { getNodeByIdAsync: jest.fn(async (id: string) => nodes.get(id) ?? null) };
});

// add/remove re-write the node's EXISTING reactions, so the shape read back from
// Figma must be made writable and multi-action reactions must not reach
// setReactionsAsync (which hangs on them).
describe("rewriting existing reactions", () => {
  it("strips read-only keys (deprecatedVersion, singular action) before writing", async () => {
    const back = { type: "BACK" };
    const node = reactiveNode([
      { trigger: { type: "MOUSE_ENTER", delay: 0, deprecatedVersion: false }, action: back, actions: [back] },
    ]);
    nodes.set("1:2", node);

    await addPrototypeLink({ nodeId: "1:2", destinationId: "dest" });

    const written = node.setReactionsAsync!.mock.calls[0][0];
    expect(written).toHaveLength(2);
    expect(written[0]).toEqual({ trigger: { type: "MOUSE_ENTER", delay: 0 }, actions: [back] });
  });

  it("refuses rather than hangs when an existing reaction has several actions", async () => {
    const node = reactiveNode([{ trigger: { type: "ON_CLICK" }, actions: [{ type: "BACK" }, { type: "CLOSE" }] }]);
    nodes.set("1:2", node);

    await expect(addPrototypeLink({ nodeId: "1:2", destinationId: "dest" })).rejects.toThrow(/2 actions/);
    await expect(removePrototypeLink({ nodeId: "1:2", destinationId: "other" })).rejects.toThrow(/2 actions/);
    expect(node.setReactionsAsync).not.toHaveBeenCalled();
  });
});
