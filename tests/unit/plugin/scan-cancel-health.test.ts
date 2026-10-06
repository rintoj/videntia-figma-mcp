import {
  chunkedFindByTypes,
  countDescendants,
  DEFAULT_CHUNK_WORK,
  DEFAULT_SMALL_SUBTREE,
} from "../../../src/videntia_figma_plugin/utils/chunked-find";
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

describe("chunkedFindByTypes", () => {
  it("countDescendants stops at the cap", () => {
    const { root } = giantTree([]);
    expect(countDescendants(root, 100)).toBe(100);
    expect(countDescendants(root.children![0], 100)).toBe(2);
  });

  it("finds every match in pre-order, never handing a giant subtree to one native call", async () => {
    const sizes: number[] = [];
    const chunks: number[] = [];
    const { root } = giantTree(sizes);
    const ids: string[] = [];
    const res = await chunkedFindByTypes(root.children as unknown as SceneNode[], {
      types: ["TEXT"],
      onMatch: (n) => {
        ids.push(n.id);
      },
      onChunk: (w) => chunks.push(w),
      sleep: async () => {},
    });
    expect(ids).toEqual(preorder(root.children!, ["TEXT"]));
    expect(ids.length).toBe(20002);
    expect(res.stopReason).toBeUndefined();
    expect(res.yields).toBeGreaterThan(5);
    expect(Math.max(...sizes)).toBeLessThan(DEFAULT_SMALL_SUBTREE);
    expect(Math.max(...chunks)).toBeLessThanOrEqual(DEFAULT_CHUNK_WORK + 2 * DEFAULT_SMALL_SUBTREE);
  });

  it("honours cancel mid-way through the giant child", async () => {
    const { root } = giantTree([]);
    const token = new CancelToken();
    let matched = 0;
    let sleeps = 0;
    const p = chunkedFindByTypes(root.children as unknown as SceneNode[], {
      types: ["TEXT"],
      signal: token,
      onMatch: () => {
        matched++;
      },
      sleep: async () => {
        if (++sleeps === 3) token.abort("cancelled by test");
      },
    });
    const err = await p.catch((e) => e);
    expect(isCancelledError(err)).toBe(true);
    expect(matched).toBeGreaterThan(0);
    expect(matched).toBeLessThan(20002);
  });

  it("stops at the deadline between chunks", async () => {
    const { root } = giantTree([]);
    let t = 0;
    const res = await chunkedFindByTypes(root.children as unknown as SceneNode[], {
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
    const err = await scanNodesByTypes({ nodeId: root.id, types: ["TEXT"], limit: 5 }).catch((e) => e);
    expect(isCancelledError(err)).toBe(true);
    expect(Math.max(0, ...sizes)).toBeLessThan(DEFAULT_SMALL_SUBTREE);
  });

  it("keeps the exact count contract when not cancelled", async () => {
    const { root, all } = giantTree([]);
    install(all);
    const res = await scanNodesByTypes({ nodeId: root.id, types: ["TEXT"], limit: 3 });
    expect(res.totalFound).toBe(20002);
    expect(res.totalExact).toBe(true);
    expect(res.truncated).toBe(true);
  });
});

describe("abandoned command accounting", () => {
  it("decrements exactly once when a cancelled read later throws CancelledError", async () => {
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
    expect(s.cancel("r1")).toBe("aborted");
    await expect(p).rejects.toThrow(/cancelled/);
    let st = s.getStatus();
    expect(st.abandonedStillRunning).toBe(1);
    expect(st.abandoned[0]).toMatchObject({ command: "get_design_context", reason: "cancel" });
    expect(st.abandonedOldestAgeMs).not.toBeNull();
    release();
    await new Promise((r) => setTimeout(r, 0));
    st = s.getStatus();
    expect(st.abandonedStillRunning).toBe(0);
    expect(st.abandonedOldestAgeMs).toBeNull();
    expect(st.abandoned).toEqual([]);
  });

  it("decrements when a cancelled command resolves normally after cancellation", async () => {
    const s = new CommandScheduler({ watchdogMs: 1000, maxQueueDepth: 10 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p = s.schedule("get_variables_used", () => gate.then(() => 7), { kind: "read", id: "x" });
    s.cancel("x");
    await p.catch(() => undefined);
    expect(s.getStatus().abandonedStillRunning).toBe(1);
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
