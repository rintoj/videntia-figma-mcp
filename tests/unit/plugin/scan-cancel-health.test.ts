import { chunkedFindByTypes } from "../../../src/videntia_figma_plugin/utils/chunked-find";
import { CancelToken, isCancelledError } from "../../../src/videntia_figma_plugin/utils/cancellation";
import {
  CommandScheduler,
  classifyHealth,
  type SchedulerStatus,
} from "../../../src/videntia_figma_plugin/utils/command-scheduler";
import { scanNodesByTypes } from "../../../src/videntia_figma_plugin/handlers/selection";
import { resetLookupMapsCache } from "../../../src/videntia_figma_plugin/handlers/node-serializer";
import { setCommandDeadline } from "../../../src/videntia_figma_plugin/utils/with-timeout";
import { setCommandSignal } from "../../../src/videntia_figma_plugin/utils/cancellation";

type FakeNode = {
  id: string;
  type: string;
  name: string;
  visible: boolean;
  children?: FakeNode[];
  findAllWithCriteria?: (c: { types: string[] }) => FakeNode[];
};

/** A fake tree whose findAllWithCriteria records how many nodes each native call touched. */
function makeTree(nativeSizes: number[]) {
  const all: Record<string, FakeNode> = {};
  let seq = 0;
  const mk = (type: string, children?: FakeNode[]): FakeNode => {
    const n: FakeNode = { id: `n${seq++}`, type, name: type, visible: true };
    if (children) {
      n.children = children;
      n.findAllWithCriteria = (c) => {
        const out: FakeNode[] = [];
        let touched = 0;
        const rec = (x: FakeNode) => {
          for (const k of x.children ?? []) {
            touched++;
            if (c.types.includes(k.type)) out.push(k);
            rec(k);
          }
        };
        rec(n);
        nativeSizes.push(touched);
        return out;
      };
    }
    all[n.id] = n;
    return n;
  };
  return { mk, all };
}

/** One small child plus one giant child (50 rows x 400 texts = 20k+ nodes). */
function giantTree(nativeSizes: number[]) {
  const { mk, all } = makeTree(nativeSizes);
  const small = mk("FRAME", [mk("TEXT"), mk("TEXT")]);
  const rows = Array.from({ length: 50 }, () =>
    mk(
      "FRAME",
      Array.from({ length: 400 }, () => mk("TEXT")),
    ),
  );
  const giant = mk("FRAME", rows);
  const root = mk("SECTION", [small, giant]);
  return { root, all };
}

/** Reference pre-order of matches. */
function preorder(roots: FakeNode[], types: string[]): string[] {
  const out: string[] = [];
  const rec = (n: FakeNode) => {
    if (types.includes(n.type)) out.push(n.id);
    for (const k of n.children ?? []) rec(k);
  };
  roots.forEach(rec);
  return out;
}

/**
 * A tree that charges for every JS `.children` access and for every node a
 * native findAllWithCriteria call touches, on a fake clock. Models the real
 * cost: crossing from plugin JS into Figma's node tree per node is what's slow.
 */
const JS_ACCESS_MS = 0.05;
const NATIVE_NODE_MS = 0.002;
function costedTree(shape: number[][]) {
  const meter = { clock: 0, jsAccesses: 0, nativeCalls: 0, nativeNodes: 0 };
  let seq = 0;
  type CN = { id: string; type: string; name: string; visible: boolean; kids?: CN[] } & Record<string, unknown>;
  const mk = (type: string, kids?: CN[]): CN => {
    const n: CN = { id: `c${seq++}`, type, name: type, visible: true };
    if (kids) {
      n.kids = kids;
      Object.defineProperty(n, "children", {
        get() {
          meter.jsAccesses++;
          meter.clock += JS_ACCESS_MS;
          return kids;
        },
      });
      n.findAllWithCriteria = (c: { types: string[] }) => {
        meter.nativeCalls++;
        const out: CN[] = [];
        const rec = (x: CN) => {
          for (const k of x.kids ?? []) {
            meter.nativeNodes++;
            meter.clock += NATIVE_NODE_MS;
            if (c.types.includes(k.type)) out.push(k);
            rec(k);
          }
        };
        rec(n);
        return out;
      };
    }
    return n;
  };
  // shape: one entry per top-level child, [rows, textsPerRow]
  const top = shape.map(([rows, per]) =>
    mk(
      "FRAME",
      Array.from({ length: rows }, () =>
        mk(
          "FRAME",
          Array.from({ length: per }, () => mk("TEXT")),
        ),
      ),
    ),
  );
  return { top: top as unknown as SceneNode[], meter, total: shape.reduce((t, [r, p]) => t + r * (p + 1), 0) };
}

/** The pre-#161 approach: one native call per top-level child. */
function oldPerTopLevel(top: SceneNode[], types: string[]): number {
  let found = 0;
  for (const c of top) {
    if (types.includes(c.type)) found++;
    if ((c as unknown as { children?: unknown }).children) {
      found += (c as unknown as ChildrenMixin).findAllWithCriteria({ types } as never).length;
    }
  }
  return found;
}

describe("chunkedFindByTypes", () => {
  it("finds every match in pre-order with exact counts", async () => {
    const sizes: number[] = [];
    const { root } = giantTree(sizes);
    const ids: string[] = [];
    const res = await chunkedFindByTypes(root.children as unknown as SceneNode[], {
      types: ["TEXT"],
      onMatch: (n) => {
        ids.push(n.id);
      },
      sleep: async () => {},
    });
    expect(ids).toEqual(preorder(root.children!, ["TEXT"]));
    expect(ids.length).toBe(20002);
    expect(res.stopReason).toBeUndefined();
  });

  it("descends wide nodes and keeps pre-order", async () => {
    const { mk } = makeTree([]);
    const wide = mk(
      "FRAME",
      Array.from({ length: 300 }, () => mk("FRAME", [mk("TEXT"), mk("TEXT")])),
    );
    const ids: string[] = [];
    const res = await chunkedFindByTypes([wide] as unknown as SceneNode[], {
      types: ["TEXT"],
      onMatch: (n) => {
        ids.push(n.id);
      },
      sleep: async () => {},
      descendAbove: 64,
    });
    expect(ids).toEqual(preorder([wide], ["TEXT"]));
    expect(res.nativeCalls).toBe(300);
  });

  it("stops early when onMatch returns false", async () => {
    const { root } = giantTree([]);
    let n = 0;
    const res = await chunkedFindByTypes(root.children as unknown as SceneNode[], {
      types: ["TEXT"],
      onMatch: () => ++n <= 50,
      sleep: async () => {},
    });
    expect(res.stopReason).toBe("limit");
    expect(n).toBe(51);
  });

  it("honours cancel between native calls", async () => {
    const { top } = costedTree(Array.from({ length: 40 }, () => [10, 50] as number[]));
    const token = new CancelToken();
    let sleeps = 0;
    const err = await chunkedFindByTypes(top, {
      types: ["TEXT"],
      signal: token,
      onMatch: () => {},
      sleep: async () => {
        if (++sleeps === 3) token.abort("cancelled by test");
      },
    }).catch((e) => e);
    expect(isCancelledError(err)).toBe(true);
  });

  it("stops at the deadline between chunks", async () => {
    const { top } = costedTree(Array.from({ length: 40 }, () => [10, 50] as number[]));
    let t = 0;
    const res = await chunkedFindByTypes(top, {
      types: ["TEXT"],
      stopAt: 3,
      now: () => t,
      sleep: async () => {
        t++;
      },
      onMatch: () => {},
    });
    expect(res.stopReason).toBe("deadline");
  });

  it("adaptive budget: a slow native call makes its siblings descend a level", async () => {
    const { top, meter } = costedTree(Array.from({ length: 10 }, () => [40, 400] as number[]));
    const res = await chunkedFindByTypes(top, {
      types: ["TEXT"],
      onMatch: () => {},
      sleep: async () => {},
      now: () => meter.clock,
      nativeBudgetMs: 20,
    });
    // First top-level child went native whole (~32ms > 20ms); the other 9 were descended.
    expect(res.nativeCalls).toBe(1 + 9 * 40);
  });
});

describe("solo scan benchmark (fake costed tree)", () => {
  // Typical big section: 30 top-level frames, ~20k nodes, plus one very wide frame.
  const shape: number[][] = [...Array.from({ length: 30 }, () => [20, 30]), [500, 2]];

  it("JS accesses are O(native calls), not O(nodes), and total cost matches pre-#161", async () => {
    const old = costedTree(shape);
    const oldFound = oldPerTopLevel(old.top, ["TEXT"]);
    const neu = costedTree(shape);
    let found = 0;
    const res = await chunkedFindByTypes(neu.top, {
      types: ["TEXT"],
      onMatch: () => {
        found++;
      },
      sleep: async () => {},
      now: () => neu.meter.clock,
    });
    expect(found).toBe(oldFound);
    // eslint-disable-next-line no-console
    console.log(
      `nodes=${neu.total} old: js=${old.meter.jsAccesses} native=${old.meter.nativeCalls} cost=${old.meter.clock.toFixed(1)}ms | ` +
        `new: js=${neu.meter.jsAccesses} native=${neu.meter.nativeCalls} cost=${neu.meter.clock.toFixed(1)}ms`,
    );
    expect(neu.meter.jsAccesses).toBeLessThanOrEqual(2 * res.nativeCalls + shape.length + 1);
    expect(neu.meter.jsAccesses).toBeLessThan(neu.total / 10);
    expect(neu.meter.clock).toBeLessThanOrEqual(old.meter.clock * 1.25);
  });

  it("limit 50 touches a tiny fraction of the tree", async () => {
    const t = costedTree(shape);
    let found = 0;
    const res = await chunkedFindByTypes(t.top, {
      types: ["TEXT"],
      onMatch: () => ++found <= 50,
      sleep: async () => {},
      now: () => t.meter.clock,
    });
    expect(res.stopReason).toBe("limit");
    expect(t.meter.nativeNodes + t.meter.jsAccesses).toBeLessThan(t.total / 20);
  });
});

describe("scanNodesByTypes over a giant child", () => {
  beforeEach(() => {
    resetLookupMapsCache();
    setCommandDeadline(undefined);
  });
  afterEach(() => setCommandSignal(undefined));

  function install(all: Record<string, FakeNode>) {
    (globalThis as unknown as { figma: unknown }).figma = {
      on: jest.fn(),
      variables: { getLocalVariablesAsync: async () => [] },
      getLocalTextStylesAsync: async () => [],
      getLocalEffectStylesAsync: async () => [],
      getNodeByIdAsync: async (id: string) => all[id] ?? null,
      currentPage: { selection: [] },
    };
  }

  it("yields and honours a cancel issued while the scan is running", async () => {
    const sizes: number[] = [];
    const { root, all } = giantTree(sizes);
    install(all);
    const token = new CancelToken();
    setCommandSignal(token);
    // Abort from a macrotask: it can only land if the scan yields to the event loop.
    setTimeout(() => token.abort("server cancel"), 0);
    const err = await scanNodesByTypes({ nodeId: root.id, types: ["TEXT"], limit: 5, exactTotal: true }).catch(
      (e) => e,
    );
    expect(isCancelledError(err)).toBe(true);
  });

  it("keeps the exact count contract when not cancelled", async () => {
    const { root, all } = giantTree([]);
    install(all);
    const res = await scanNodesByTypes({ nodeId: root.id, types: ["TEXT"], limit: 3, exactTotal: true });
    expect(res.totalFound).toBe(20002);
    expect(res.totalExact).toBe(true);
    expect(res.truncated).toBe(true);
  });

  it("stops at limit by default and reports a lower bound", async () => {
    const { root, all } = giantTree([]);
    install(all);
    const res = await scanNodesByTypes({ nodeId: root.id, types: ["TEXT"], limit: 3 });
    expect(res.count).toBe(3);
    expect(res.totalExact).toBe(false);
    expect(res.stopReason).toBe("limit");
    expect(res.truncated).toBe(true);
    expect(res.totalFound as number).toBeGreaterThan(3);
  });

  it("a cancelled scan stops serializing", async () => {
    const { root, all } = giantTree([]);
    install(all);
    const token = new CancelToken();
    setCommandSignal(token);
    let lookups = 0;
    const g = (globalThis as unknown as { figma: { getNodeByIdAsync: (id: string) => Promise<unknown> } }).figma;
    const orig = g.getNodeByIdAsync;
    g.getNodeByIdAsync = async (id: string) => {
      if (++lookups === 20) token.abort("server cancel");
      return orig(id);
    };
    const err = await scanNodesByTypes({ nodeId: root.id, types: ["TEXT"], limit: 5000 }).catch((e) => e);
    expect(isCancelledError(err)).toBe(true);
    expect(lookups).toBeLessThan(200);
  });
});

describe("abandoned command accounting", () => {
  it("a cancelled read drains its slot until it stops, then the next command runs", async () => {
    const s = new CommandScheduler({ watchdogMs: 1000, maxQueueDepth: 10 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p = s.schedule(
      "get_design_context",
      async (signal) => {
        await gate;
        if (signal.aborted) {
          const { CancelledError } = await import("../../../src/videntia_figma_plugin/utils/cancellation");
          throw new CancelledError("stop");
        }
        return 1;
      },
      { kind: "read", id: "r1" },
    );
    let nextRan = false;
    const next = s.schedule("get_selection", async () => (nextRan = true), { kind: "read" });
    expect(s.cancel("r1")).toBe("aborted");
    // The caller hears back immediately.
    await expect(p).rejects.toThrow(/cancelled/);
    let st = s.getStatus();
    // Draining: still holds the slot, not abandoned, the next command waits.
    expect(st.running?.command).toBe("get_design_context");
    expect(st.abandonedStillRunning).toBe(0);
    expect(nextRan).toBe(false);
    release();
    await next;
    st = s.getStatus();
    expect(nextRan).toBe(true);
    expect(st.abandonedStillRunning).toBe(0);
    expect(st.abandoned).toEqual([]);
    expect(st.cancelled).toBe(1);
  });

  it("a cancelled read that does not stop is abandoned after the grace period", async () => {
    const s = new CommandScheduler({ watchdogMs: 1000, maxQueueDepth: 10, cancelGraceMs: 10 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p = s.schedule("get_variables_used", () => gate.then(() => 7), { kind: "read", id: "x" });
    const next = s.schedule("get_selection", async () => "next", { kind: "read" });
    s.cancel("x");
    await p.catch(() => undefined);
    await expect(next).resolves.toBe("next");
    expect(s.getStatus().abandonedStillRunning).toBe(1);
    expect(s.getStatus().abandoned[0]).toMatchObject({ command: "get_variables_used", reason: "cancel" });
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(s.getStatus().abandonedStillRunning).toBe(0);
  });

  it("reports the oldest age and names of commands that really hang", async () => {
    let t = 0;
    const s = new CommandScheduler({ watchdogMs: 10, maxQueueDepth: 10, now: () => t });
    void s.schedule("get_design_context", () => new Promise(() => {}), { kind: "read" }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 30));
    t = 400000;
    const st = s.getStatus();
    expect(st.abandonedStillRunning).toBe(1);
    expect(st.abandonedOldestAgeMs).toBe(400000);
    expect(st.abandoned.map((a) => a.command)).toEqual(["get_design_context"]);
    expect(classifyHealth(st, t).status).toBe("degraded");
  });
});

describe("classifyHealth", () => {
  const base: SchedulerStatus = {
    running: null,
    queueDepth: 0,
    queued: [],
    completed: 0,
    watchdogTimeouts: 0,
    expiredInQueue: 0,
    rejectedQueueFull: 0,
    abandonedStillRunning: 0,
    abandonedOldestAgeMs: null,
    abandoned: [],
    cancelled: 0,
    cancelledOnDisconnect: 0,
    droppedOnDisconnect: 0,
    lastWatchdog: null,
    lastCompletedAtMs: null,
    lastProgressAtMs: null,
  };
  const now = 100000;

  it("idle when nothing runs", () => {
    expect(classifyHealth(base, now)).toMatchObject({ healthy: true, status: "idle" });
  });

  it("a long command under its watchdog is busy, not unhealthy", () => {
    const st = { ...base, running: { command: "export", ageMs: 25000, watchdogMs: 60000 }, lastProgressAtMs: 75000 };
    expect(classifyHealth(st, now)).toMatchObject({ healthy: true, status: "busy" });
  });

  it("busy with a queue that keeps moving", () => {
    const st = {
      ...base,
      running: { command: "scan", ageMs: 2000, watchdogMs: 60000 },
      queueDepth: 4,
      lastProgressAtMs: now - 2000,
    };
    expect(classifyHealth(st, now)).toMatchObject({ healthy: true, status: "busy" });
  });

  it("stalled when queued work has seen no progress for 30s", () => {
    const st = {
      ...base,
      running: { command: "scan", ageMs: 31000, watchdogMs: 60000 },
      queueDepth: 2,
      lastProgressAtMs: now - 31000,
    };
    const h = classifyHealth(st, now);
    expect(h).toMatchObject({ healthy: false, status: "stalled" });
    expect(h.reason).toMatch(/no command started or finished/);
  });

  it("stalled when the running command is past its watchdog", () => {
    const st = { ...base, running: { command: "scan", ageMs: 61000, watchdogMs: 60000 }, lastProgressAtMs: 0 };
    expect(classifyHealth(st, now)).toMatchObject({ healthy: false, status: "stalled" });
  });

  it("recent abandoned commands do not make it unhealthy", () => {
    const st = {
      ...base,
      abandonedStillRunning: 1,
      abandonedOldestAgeMs: 60000,
      abandoned: [{ command: "x", ageMs: 60000, reason: "cancel" as const }],
    };
    expect(classifyHealth(st, now)).toMatchObject({ healthy: true, status: "idle" });
  });
});
