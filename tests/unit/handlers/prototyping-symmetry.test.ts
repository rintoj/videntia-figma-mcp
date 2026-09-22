import {
  getReactions,
  removePrototypeLink,
  setReactions,
} from "../../../src/videntia_figma_plugin/handlers/prototyping";

type MockNode = {
  id: string;
  name: string;
  type: string;
  reactions: any[];
  setReactionsAsync?: jest.Mock;
};

let nodes: Map<string, MockNode>;

function reactiveNode(overrides: Partial<MockNode> = {}): MockNode {
  const node: MockNode = {
    id: "1:2",
    name: "CTA",
    type: "FRAME",
    reactions: [],
    ...overrides,
  };
  node.setReactionsAsync = jest.fn(async (next: any[]) => {
    node.reactions = next;
  });
  return node;
}

beforeEach(() => {
  nodes = new Map();
  (globalThis as any).figma = {
    getNodeByIdAsync: jest.fn(async (id: string) => nodes.get(id) ?? null),
  };
});

/**
 * The whole point of the ms convention is that a value written is the value
 * read back. Several fields were converted on write but never reported on
 * read, so a get -> edit -> set round trip silently reset them to defaults.
 */
describe("read/write symmetry", () => {
  it("round-trips ON_MEDIA_HIT mediaHitTime in milliseconds", async () => {
    const node = reactiveNode();
    nodes.set("1:2", node);
    nodes.set("dest", { id: "dest", name: "Dest", type: "FRAME", reactions: [] });

    await setReactions({
      nodeId: "1:2",
      reactions: [{ trigger: { type: "ON_MEDIA_HIT", mediaHitTime: 5000 }, actions: [{ type: "BACK" }] }],
    });

    // Persisted to Figma in seconds...
    expect(node.reactions[0].trigger.mediaHitTime).toBe(5);

    // ...and reported back in ms.
    const read = await getReactions({ nodeIds: ["1:2"] });
    expect(read.reactions[0].reactions[0].trigger?.mediaHitTime).toBe(5000);
  });

  it("round-trips UPDATE_MEDIA_RUNTIME skip offsets in milliseconds", async () => {
    const node = reactiveNode();
    nodes.set("1:2", node);

    await setReactions({
      nodeId: "1:2",
      reactions: [
        {
          trigger: { type: "ON_CLICK" },
          actions: [{ type: "UPDATE_MEDIA_RUNTIME", mediaAction: "SKIP_TO", newTimestamp: 1500 }],
        },
      ],
    });

    expect(node.reactions[0].actions[0].newTimestamp).toBe(1.5);

    const read = await getReactions({ nodeIds: ["1:2"] });
    const action = read.reactions[0].reactions[0].actions[0];
    expect(action.newTimestamp).toBe(1500);
    expect(action.mediaAction).toBe("SKIP_TO");
  });

  it("reports SET_VARIABLE's variableId and value", async () => {
    const node = reactiveNode();
    nodes.set("1:2", node);

    await setReactions({
      nodeId: "1:2",
      reactions: [
        {
          trigger: { type: "ON_CLICK" },
          actions: [{ type: "SET_VARIABLE", variableId: "var-1", variableValue: { resolvedType: "FLOAT", value: 1 } }],
        },
      ],
    });

    // variableValue used to be dropped, so SET_VARIABLE could only ever write a
    // valueless action.
    expect(node.reactions[0].actions[0].variableValue).toEqual({ resolvedType: "FLOAT", value: 1 });

    const read = await getReactions({ nodeIds: ["1:2"] });
    expect(read.reactions[0].reactions[0].actions[0].variableId).toBe("var-1");
  });
});

describe("set_reactions destination validation", () => {
  it("refuses a NODE action pointing at a node that does not exist", async () => {
    nodes.set("1:2", reactiveNode());

    await expect(
      setReactions({
        nodeId: "1:2",
        reactions: [
          {
            trigger: { type: "ON_CLICK" },
            actions: [{ type: "NODE", destinationId: "3082:47270", navigation: "NAVIGATE" }],
          },
        ],
      }),
    ).rejects.toThrow(/destination node not found/);
  });

  it("writes nothing when a destination is missing", async () => {
    const node = reactiveNode();
    nodes.set("1:2", node);

    await expect(
      setReactions({
        nodeId: "1:2",
        reactions: [
          { trigger: { type: "ON_CLICK" }, actions: [{ type: "NODE", destinationId: "nope", navigation: "NAVIGATE" }] },
        ],
      }),
    ).rejects.toThrow();
    expect(node.setReactionsAsync).not.toHaveBeenCalled();
  });

  it("accepts a destination that exists", async () => {
    const node = reactiveNode();
    nodes.set("1:2", node);
    nodes.set("dest", { id: "dest", name: "Checkout", type: "FRAME", reactions: [] });

    const result = await setReactions({
      nodeId: "1:2",
      reactions: [
        { trigger: { type: "ON_CLICK" }, actions: [{ type: "NODE", destinationId: "dest", navigation: "NAVIGATE" }] },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("mediaAction validation", () => {
  it("rejects a near-miss spelling instead of writing a malformed action", async () => {
    const node = reactiveNode();
    nodes.set("1:2", node);

    // "SKIP-FORWARD" used to pass through, miss the SKIP_FORWARD branch, and
    // write an action with no amountToSkip.
    await expect(
      setReactions({
        nodeId: "1:2",
        reactions: [
          {
            trigger: { type: "ON_CLICK" },
            actions: [{ type: "UPDATE_MEDIA_RUNTIME", mediaAction: "SKIP-FORWARD", amountToSkip: 1000 }],
          },
        ],
      }),
    ).rejects.toThrow(/Unknown mediaAction/);
  });
});

describe("MOUSE_ENTER / MOUSE_LEAVE", () => {
  it("never writes deprecatedVersion, which Figma's runtime rejects", async () => {
    const node = reactiveNode();
    nodes.set("1:2", node);
    nodes.set("dest", { id: "dest", name: "Dest", type: "FRAME", reactions: [] });

    await setReactions({
      nodeId: "1:2",
      reactions: [
        {
          trigger: { type: "MOUSE_ENTER", delay: 250, deprecatedVersion: false },
          actions: [{ type: "NODE", destinationId: "dest", navigation: "NAVIGATE" }],
        },
      ],
    });

    // The typings declare this key, but setReactionsAsync throws
    // "Unrecognized key(s) in object: 'deprecatedVersion'" if it is sent.
    const trigger = node.reactions[0].trigger;
    expect(trigger).not.toHaveProperty("deprecatedVersion");
    expect(trigger.delay).toBe(0.25);
  });
});

describe("multi-action guard", () => {
  it("refuses a reaction with more than one action", async () => {
    nodes.set("1:2", reactiveNode());
    await expect(
      setReactions({
        nodeId: "1:2",
        reactions: [{ trigger: { type: "ON_CLICK" }, actions: [{ type: "BACK" }, { type: "CLOSE" }] }],
      }),
    ).rejects.toThrow(/hangs/);
  });
});

describe("transition params that the transition type does not carry", () => {
  // DISSOLVE / SMART_ANIMATE / SCROLL_ANIMATE have neither direction nor
  // matchLayers. Previously only SMART_ANIMATE + matchLayers was refused; the
  // rest reported success for a value that was never written.
  it.each([
    ["DISSOLVE", { direction: "RIGHT" }],
    ["DISSOLVE", { matchLayers: true }],
    ["SCROLL_ANIMATE", { direction: "LEFT" }],
    ["SCROLL_ANIMATE", { matchLayers: false }],
    ["SMART_ANIMATE", { direction: "TOP" }],
    ["SMART_ANIMATE", { matchLayers: true }],
  ])("refuses %s with %j", async (type, extra) => {
    nodes.set("1:2", reactiveNode());
    nodes.set("dest", { id: "dest", name: "Dest", type: "FRAME", reactions: [] });

    await expect(
      setReactions({
        nodeId: "1:2",
        reactions: [
          {
            trigger: { type: "ON_CLICK" },
            actions: [{ type: "NODE", destinationId: "dest", navigation: "NAVIGATE", transition: { type, ...extra } }],
          },
        ],
      }),
    ).rejects.toThrow(/not valid on a/);
  });

  it("still accepts direction and matchLayers on a directional transition", async () => {
    nodes.set("1:2", reactiveNode());
    nodes.set("dest", { id: "dest", name: "Dest", type: "FRAME", reactions: [] });

    const result = await setReactions({
      nodeId: "1:2",
      reactions: [
        {
          trigger: { type: "ON_CLICK" },
          actions: [
            {
              type: "NODE",
              destinationId: "dest",
              navigation: "NAVIGATE",
              transition: { type: "PUSH", direction: "RIGHT", matchLayers: true },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("remove_prototype_link with an empty destinationId", () => {
  it("refuses instead of clearing every reaction", async () => {
    const node = reactiveNode({ reactions: [{ trigger: { type: "ON_CLICK" }, actions: [{ type: "BACK" }] }] });
    nodes.set("1:2", node);

    // An empty destination used to be coerced to "omitted", which means
    // "clear everything" — a destination that resolved to "" wiped the node.
    await expect(removePrototypeLink({ nodeId: "1:2", destinationId: "" })).rejects.toThrow(/destinationId is empty/);
    expect(node.setReactionsAsync).not.toHaveBeenCalled();
    expect(node.reactions).toHaveLength(1);
  });

  it("still clears everything when destinationId is omitted", async () => {
    const node = reactiveNode({ reactions: [{ trigger: { type: "ON_CLICK" }, actions: [{ type: "BACK" }] }] });
    nodes.set("1:2", node);

    const result = await removePrototypeLink({ nodeId: "1:2" });
    expect(result.removedCount).toBe(1);
    expect(result.remainingCount).toBe(0);
  });
});
