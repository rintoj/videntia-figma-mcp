import { getFrameAnimations } from "../../../src/videntia_figma_plugin/handlers/prototyping";

type Transition = {
  type: string;
  direction?: string;
  matchLayers?: boolean;
  duration?: number;
  easing?: { type: string; easingFunctionCubicBezier?: { x1: number; y1: number; x2: number; y2: number } };
};

type Action = {
  type: string;
  destinationId?: string;
  navigation?: string;
  transition?: Transition | null;
  preserveScrollPosition?: boolean;
};

type Reaction = { trigger: { type: string; timeout?: number } | null; actions?: Action[] };

type MockNode = {
  id: string;
  name: string;
  type: string;
  reactions?: Reaction[];
  children?: MockNode[];
};

let nodes: Map<string, MockNode>;

function register(node: MockNode): MockNode {
  nodes.set(node.id, node);
  for (const child of node.children ?? []) register(child);
  return node;
}

beforeEach(() => {
  nodes = new Map();
  (globalThis as any).figma = {
    getNodeByIdAsync: jest.fn(async (id: string) => nodes.get(id) ?? null),
  };
});

describe("getFrameAnimations", () => {
  it("throws when nodeId is missing", async () => {
    await expect(getFrameAnimations({})).rejects.toThrow("nodeId is required");
  });

  it("throws when node not found", async () => {
    await expect(getFrameAnimations({ nodeId: "nope" })).rejects.toThrow("Node not found: nope");
  });

  it("collects SMART_ANIMATE transition detail from a nested child", async () => {
    const dest = register({ id: "dest", name: "Screen 2", type: "FRAME" });
    const frame = register({
      id: "frame",
      name: "Screen 1",
      type: "FRAME",
      children: [
        {
          id: "btn",
          name: "CTA",
          type: "INSTANCE",
          reactions: [
            {
              trigger: { type: "ON_CLICK" },
              actions: [
                {
                  type: "NODE",
                  destinationId: "dest",
                  navigation: "NAVIGATE",
                  preserveScrollPosition: true,
                  transition: {
                    type: "SMART_ANIMATE",
                    matchLayers: true,
                    duration: 0.3,
                    easing: { type: "EASE_OUT" },
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    nodes.set(dest.id, dest);
    void frame;

    const result = await getFrameAnimations({ nodeId: "frame" });

    expect(result.animationCount).toBe(1);
    expect(result.nodesScanned).toBe(2); // frame + btn
    const anim = result.animations[0];
    expect(anim).toMatchObject({
      sourceId: "btn",
      sourceName: "CTA",
      trigger: "ON_CLICK",
      transitionType: "SMART_ANIMATE",
      matchLayers: true,
      duration: 0.3,
      destinationId: "dest",
      destinationName: "Screen 2",
      preserveScrollPosition: true,
      easing: { type: "EASE_OUT" },
    });
  });

  it("captures AFTER_TIMEOUT timeout and custom cubic-bezier easing", async () => {
    register({
      id: "frame",
      name: "Splash",
      type: "FRAME",
      reactions: [
        {
          trigger: { type: "AFTER_TIMEOUT", timeout: 2 },
          actions: [
            {
              type: "NODE",
              transition: {
                type: "DISSOLVE",
                duration: 0.5,
                easing: {
                  type: "CUSTOM_CUBIC_BEZIER",
                  easingFunctionCubicBezier: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 },
                },
              },
            },
          ],
        },
      ],
    });

    const result = await getFrameAnimations({ nodeId: "frame" });
    const anim = result.animations[0];
    expect(anim.trigger).toBe("AFTER_TIMEOUT");
    expect(anim.triggerTimeout).toBe(2);
    expect(anim.transitionType).toBe("DISSOLVE");
    expect(anim.easing?.cubicBezier).toEqual({ x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 });
  });

  it("ignores reactions without a transition", async () => {
    register({
      id: "frame",
      name: "Screen",
      type: "FRAME",
      reactions: [{ trigger: { type: "ON_CLICK" }, actions: [{ type: "NODE", destinationId: "x", transition: null }] }],
    });

    const result = await getFrameAnimations({ nodeId: "frame" });
    expect(result.animationCount).toBe(0);
  });
});
