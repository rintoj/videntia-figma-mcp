import {
  serializeNodes,
  resetLookupMapsCache,
  setSerializerTimeouts,
} from "../../../src/videntia_figma_plugin/handlers/node-serializer";
import { scanNodesByTypes } from "../../../src/videntia_figma_plugin/handlers/selection";
import { boundedMap } from "../../../src/videntia_figma_plugin/utils/bounded-map";
import { setCommandDeadline } from "../../../src/videntia_figma_plugin/utils/with-timeout";

const never = () => new Promise<never>(() => {});
const settlesWithin = (p: Promise<unknown>, ms: number) =>
  Promise.race([
    p.then(
      () => true,
      () => true,
    ),
    new Promise((r) => setTimeout(() => r(false), ms)),
  ]);

function setup(opts: { hangVars?: boolean; hangMain?: boolean; rejectVars?: boolean } = {}) {
  let hangVars = !!opts.hangVars;
  let rejectVars = !!opts.rejectVars;
  const mainComp = { id: "c1", name: "Button", parent: null };
  const getMain = jest.fn(() => (opts.hangMain ? never() : Promise.resolve(mainComp)));
  const inst = (id: string) => ({ id, name: id, type: "INSTANCE", visible: true, getMainComponentAsync: getMain });
  const frame = { id: "f1", name: "Frame", type: "FRAME", visible: true, children: [inst("i1"), inst("i2")] };
  const nodes: Record<string, unknown> = { f1: frame, i1: frame.children[0], i2: frame.children[1] };
  const getVars = jest.fn(() => {
    if (hangVars) return never();
    if (rejectVars) return Promise.reject(new Error("boom"));
    return Promise.resolve([{ id: "v1", name: "color/bg" }]);
  });
  const g = {
    on: jest.fn(),
    variables: { getLocalVariablesAsync: getVars },
    getLocalTextStylesAsync: jest.fn(async () => []),
    getLocalEffectStylesAsync: jest.fn(async () => []),
    getNodeByIdAsync: jest.fn(async (id: string) => nodes[id] ?? null),
    currentPage: { selection: [] },
  };
  (globalThis as unknown as { figma: unknown }).figma = g;
  return {
    g,
    getVars,
    getMain,
    recover: () => {
      hangVars = false;
      rejectVars = false;
    },
  };
}

describe("serializer hang poisoning", () => {
  beforeEach(() => {
    resetLookupMapsCache();
    setSerializerTimeouts(50, 50);
  });

  it("a hung lookup load does not hang serializeNodes: it degrades with a warning", async () => {
    setup({ hangVars: true });
    const p = serializeNodes({ nodeId: "f1" });
    expect(await settlesWithin(p, 500)).toBe(true);
    const res = await p;
    expect(res.count).toBe(1);
    expect(String((res.warnings as string[])[0])).toMatch(/did not settle/);
  });

  it("a hung load is not shared with later calls once Figma recovers (the poisoning repro)", async () => {
    const env = setup({ hangVars: true });
    await serializeNodes({ nodeId: "f1" });
    env.recover();
    // Still inside the 2s TTL: the old cache handed back the same hung promise forever.
    const p = serializeNodes({ nodeId: "f1" });
    expect(await settlesWithin(p, 500)).toBe(true);
    expect((await p).warnings).toBeUndefined();
    expect(env.getVars).toHaveBeenCalledTimes(2);
  });

  it("a rejected load is not cached", async () => {
    const env = setup({ rejectVars: true });
    await serializeNodes({ nodeId: "f1" });
    env.recover();
    await serializeNodes({ nodeId: "f1" });
    expect(env.getVars).toHaveBeenCalledTimes(2);
  });

  it("a hung getMainComponentAsync degrades to no main-component info with a warning", async () => {
    setup({ hangMain: true });
    const p = serializeNodes({ nodeIds: ["i1", "i2"] });
    expect(await settlesWithin(p, 500)).toBe(true);
    const res = await p;
    expect(res.count).toBe(2);
    expect((res.nodes as Record<string, unknown>[])[0].mainComponentId).toBeUndefined();
    expect((res.warnings as string[]).some((w) => /Main component of i1/.test(w))).toBe(true);
  });
});

describe("boundedMap nested recursion", () => {
  it("does not deadlock when recursive levels each use a bounded pool (limit 1, depth 6, fan-out 3)", async () => {
    let visits = 0;
    async function walk(depth: number): Promise<number> {
      visits++;
      if (depth === 0) return 1;
      const kids = await boundedMap([0, 1, 2], 1, () => walk(depth - 1));
      return kids.reduce((a, b) => a + b, 0);
    }
    const p = walk(6);
    expect(await settlesWithin(p, 2000)).toBe(true);
    expect(await p).toBe(729);
    expect(visits).toBe(1093);
  });
});

describe("scan_nodes_by_types walk caps", () => {
  function tree(width: number) {
    const leaves = Array.from({ length: width }, (_, i) => ({ id: `t${i}`, name: "t", type: "TEXT", visible: true }));
    const root = { id: "s1", name: "S", type: "SECTION", visible: true, children: leaves };
    const nodes: Record<string, unknown> = { s1: root };
    leaves.forEach((l) => (nodes[l.id] = l));
    (globalThis as unknown as { figma: unknown }).figma = {
      on: jest.fn(),
      variables: { getLocalVariablesAsync: async () => [] },
      getLocalTextStylesAsync: async () => [],
      getLocalEffectStylesAsync: async () => [],
      getNodeByIdAsync: async (id: string) => nodes[id] ?? null,
      currentPage: { selection: [] },
    };
  }
  beforeEach(() => {
    resetLookupMapsCache();
    setCommandDeadline(undefined);
  });

  it("returns an exact count when the walk completes", async () => {
    tree(30);
    const res = await scanNodesByTypes({ nodeId: "s1", types: ["TEXT"], limit: 1 });
    expect(res.totalFound).toBe(30);
    expect(res.totalExact).toBe(true);
    expect(res.count).toBe(1);
  });

  it("stops at the visit cap and reports totalFound as a lower bound", async () => {
    tree(30);
    const res = await scanNodesByTypes({ nodeId: "s1", types: ["TEXT"], limit: 1, maxVisited: 10 });
    expect(res.totalFound).toBe(10);
    expect(res.totalExact).toBe(false);
    expect(res.stopReason).toBe("maxVisited");
    expect(res.truncated).toBe(true);
  });

  it("stops on the command deadline", async () => {
    tree(30);
    setCommandDeadline(Date.now() - 1);
    const res = await scanNodesByTypes({ nodeId: "s1", types: ["TEXT"], limit: 1 });
    expect(res.totalExact).toBe(false);
    expect(res.stopReason).toBe("deadline");
    setCommandDeadline(undefined);
  });
});
