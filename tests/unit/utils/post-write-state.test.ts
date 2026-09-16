import {
  attachPostWriteState,
  buildNodeState,
  collectNodeIds,
  isReturnStateDefault,
  resolveReturnState,
  setReturnStateDefault,
  touchedProps,
} from "../../../src/videntia_figma_plugin/utils/post-write-state";
import { formatState } from "../../../src/videntia_figma_mcp/utils/return-state";

/**
 * Stand-in for a live Figma node. `readonlyProps` models the silent-no-op
 * behaviour: the assignment is accepted but the stored value never changes.
 */
function makeNode(props: Record<string, unknown>, readonlyProps: string[] = []): any {
  const store: Record<string, unknown> = {
    id: "1:1",
    name: "Card",
    type: "FRAME",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    ...props,
  };
  return new Proxy(
    {},
    {
      has: (_t, key: string) => key in store,
      get: (_t, key: string) => store[key],
      set: (_t, key: string, value: unknown) => {
        if (readonlyProps.indexOf(key) === -1) store[key] = value;
        return true;
      },
      ownKeys: () => Object.keys(store),
      getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }),
    },
  );
}

afterEach(() => setReturnStateDefault(false));

describe("resolveReturnState", () => {
  it("defaults to off and honours the session default", () => {
    expect(resolveReturnState({})).toBe(false);
    setReturnStateDefault(true);
    expect(isReturnStateDefault()).toBe(true);
    expect(resolveReturnState({})).toBe(true);
  });

  it("lets an explicit param override the session default", () => {
    setReturnStateDefault(true);
    expect(resolveReturnState({ return_state: false })).toBe(false);
    setReturnStateDefault(false);
    expect(resolveReturnState({ return_state: "true" })).toBe(true);
    expect(resolveReturnState({ returnState: true })).toBe(true);
  });
});

describe("touchedProps", () => {
  it("maps request params to the node properties they write, skipping control params", () => {
    expect(touchedProps({ nodeId: "1:1", strict: true, return_state: true, gap: 8 })).toEqual(["itemSpacing"]);
    expect(touchedProps({ padding: 4 })).toEqual(["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]);
    expect(touchedProps({ paddingTop: 4 })).toEqual(["paddingTop"]);
    expect(touchedProps({ nodeId: "1:1" })).toEqual([]);
  });
});

describe("buildNodeState", () => {
  it("reports values read off the node, not the requested ones", () => {
    const node = makeNode({ paddingTop: 16, itemSpacing: 8, layoutMode: "VERTICAL" });
    const state = buildNodeState(node, ["paddingTop", "itemSpacing"]);

    expect(state.props).toEqual({ paddingTop: 16, itemSpacing: 8 });
    expect(state.summary).toContain("Card [FRAME] 1:1 0,0 100x40");
    expect(state.summary).toContain("layout=VERTICAL");
    expect(state.noops).toBeUndefined();
  });

  it("stays compact — one summary line and only the touched properties", () => {
    const node = makeNode({ paddingTop: 16, paddingLeft: 2, itemSpacing: 8, effects: [{}, {}] });
    const state = buildNodeState(node, ["paddingTop"]);

    expect(state.summary.split("\n").length).toBe(1);
    expect(Object.keys(state.props)).toEqual(["paddingTop"]);
    expect(JSON.stringify(state).length).toBeLessThan(300);
  });

  it("summarises a fill as a hex token rather than dumping the paint array", () => {
    const node = makeNode({ fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }] });
    const state = buildNodeState(node, ["fills"]);
    expect(state.props.fills).toBe("#ff0000");
    expect(state.summary).toContain("#ff0000");
  });
});

describe("attachPostWriteState", () => {
  const resolver = (node: any) => async (id: string) => (id === node.id ? node : null);

  it("attaches the post-write state for the node the command touched", async () => {
    const node = makeNode({ paddingTop: 16 });
    const result = await attachPostWriteState({ nodeId: "1:1", paddingTop: 16 }, { nodeId: "1:1" }, resolver(node));

    expect((result as any).state.props).toEqual({ paddingTop: 16 });
  });

  it("makes a write that DID NOT APPLY visible in the returned state", async () => {
    // itemSpacing is discarded by the runtime: node still reports 0.
    const node = makeNode({ itemSpacing: 0 }, ["itemSpacing"]);
    const handlerResult = {
      nodeId: "1:1",
      success: false,
      noops: [{ property: "itemSpacing", requested: 24, actual: 0 }],
    };
    const result: any = await attachPostWriteState({ nodeId: "1:1", gap: 24 }, handlerResult, resolver(node));

    // The read-back value contradicts the request…
    expect(result.state.props).toEqual({ itemSpacing: 0 });
    // …and the detected no-op is surfaced, not swallowed.
    expect(result.state.noops).toEqual([{ property: "itemSpacing", requested: 24, actual: 0 }]);
    expect(formatState(result)).toContain("NOT APPLIED: itemSpacing");
  });

  it("flags a node that vanished after the write", async () => {
    const result: any = await attachPostWriteState({ nodeId: "9:9" }, { nodeId: "9:9" }, async () => null);
    expect(result.state.summary).toContain("MISSING");
  });

  it("never throws when state capture fails — the write still succeeded", async () => {
    const result = await attachPostWriteState({ nodeId: "1:1" }, { nodeId: "1:1" }, async () => {
      throw new Error("boom");
    });
    expect(result).toEqual({ nodeId: "1:1" });
  });

  it("is a no-op when no node can be identified", async () => {
    const result = await attachPostWriteState({ foo: 1 }, { ok: true }, async () => makeNode({}));
    expect((result as any).state).toBeUndefined();
  });

  it("collects ids from the result first, then the params", () => {
    expect(collectNodeIds({ nodeId: "1:1" }, { id: "2:2" })).toEqual(["2:2"]);
    expect(collectNodeIds({ nodeId: "1:1" }, { ok: true })).toEqual(["1:1"]);
    expect(collectNodeIds({ nodeIds: ["1:1", "2:2"] }, null)).toEqual(["1:1", "2:2"]);
  });
});

describe("formatState", () => {
  it("returns an empty string when the command returned no state", () => {
    expect(formatState({ nodeId: "1:1" })).toBe("");
    expect(formatState(undefined)).toBe("");
  });

  it("renders a multi-node state", () => {
    const text = formatState({
      state: [
        { summary: "A [FRAME] 1:1 0,0 10x10", props: { paddingTop: 4 } },
        { summary: "B [FRAME] 2:2 0,0 10x10", props: {} },
      ],
    });
    expect(text).toContain("A [FRAME]");
    expect(text).toContain("B [FRAME]");
    expect(text).toContain("paddingTop=4");
  });
});
