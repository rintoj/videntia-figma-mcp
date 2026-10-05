import { serializeNodes, resetLookupMapsCache } from "../../../src/videntia_figma_plugin/handlers/node-serializer";

type Listener = () => void;

function setup() {
  const listeners: Listener[] = [];
  const mainComp = { id: "c1", name: "Button", parent: null };
  const getMain = jest.fn(async () => mainComp);
  const inst = (id: string) => ({ id, name: id, type: "INSTANCE", visible: true, getMainComponentAsync: getMain });
  const frame = { id: "f1", name: "Frame", type: "FRAME", visible: true, children: [inst("i1"), inst("i2")] };
  const nodes: Record<string, unknown> = { f1: frame, i1: frame.children[0], i2: frame.children[1] };
  const g = {
    on: jest.fn((evt: string, cb: Listener) => {
      if (evt === "documentchange") listeners.push(cb);
    }),
    variables: { getLocalVariablesAsync: jest.fn(async () => []) },
    getLocalTextStylesAsync: jest.fn(async () => []),
    getLocalEffectStylesAsync: jest.fn(async () => []),
    getNodeByIdAsync: jest.fn(async (id: string) => nodes[id] ?? null),
    currentPage: { selection: [] },
  };
  (globalThis as unknown as { figma: unknown }).figma = g;
  return { g, getMain, listeners };
}

describe("node-serializer caching", () => {
  beforeEach(() => resetLookupMapsCache());

  it("reuses lookup maps across calls and invalidates on documentchange", async () => {
    const { g, listeners } = setup();
    await serializeNodes({ nodeId: "f1" });
    await serializeNodes({ nodeId: "f1" });
    expect(g.variables.getLocalVariablesAsync).toHaveBeenCalledTimes(1);
    expect(g.on).toHaveBeenCalledTimes(1);
    listeners.forEach((l) => l());
    await serializeNodes({ nodeId: "f1" });
    expect(g.variables.getLocalVariablesAsync).toHaveBeenCalledTimes(2);
  });

  it("expires lookup maps after the TTL", async () => {
    const { g } = setup();
    const now = jest.spyOn(Date, "now").mockReturnValue(1000);
    await serializeNodes({ nodeId: "f1" });
    now.mockReturnValue(4000);
    await serializeNodes({ nodeId: "f1" });
    expect(g.variables.getLocalVariablesAsync).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it("works when figma.on is unavailable", async () => {
    const { g } = setup();
    (g as { on?: unknown }).on = undefined;
    await expect(serializeNodes({ nodeId: "f1" })).resolves.toHaveProperty("count", 1);
  });

  it("memoizes getMainComponentAsync per instance id within a call", async () => {
    const { getMain } = setup();
    const res = await serializeNodes({ nodeIds: ["i1", "i1", "i2"] });
    expect(res.count).toBe(3);
    expect(getMain).toHaveBeenCalledTimes(2);
    expect((res.nodes as Record<string, unknown>[])[0].mainComponentId).toBe("c1");
  });

  it("preserves nodeIds order and skips missing ids", async () => {
    setup();
    const res = await serializeNodes({ nodeIds: ["i2", "nope", "i1"] });
    expect((res.nodes as { id: string }[]).map((n) => n.id)).toEqual(["i2", "i1"]);
  });
});
