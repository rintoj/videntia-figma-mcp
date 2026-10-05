import { CommandScheduler } from "../../../src/videntia_figma_plugin/utils/command-scheduler";

const never = () => new Promise<never>(() => {});
const later =
  (v: unknown, ms = 5) =>
  () =>
    new Promise((r) => setTimeout(() => r(v), ms));

/** The pre-fix dispatcher: a bare promise chain with no timeout. */
function legacyQueue() {
  let q: Promise<unknown> = Promise.resolve();
  return (run: () => Promise<unknown>) => {
    const tail = q.then(run, run);
    q = tail.catch(() => undefined);
    return tail;
  };
}

const settlesWithin = (p: Promise<unknown>, ms: number) =>
  Promise.race([
    p.then(
      () => true,
      () => true,
    ),
    new Promise((r) => setTimeout(() => r(false), ms)),
  ]);

describe("plugin command queue wedge", () => {
  it("reproduces the freeze: the legacy chain never runs a read queued behind a hung command", async () => {
    const enqueue = legacyQueue();
    void enqueue(never);
    const read = enqueue(later("node"));
    expect(await settlesWithin(read, 200)).toBe(false);
  });

  it("the scheduler abandons a hung command and runs the next one", async () => {
    const s = new CommandScheduler({ watchdogMs: 50, maxQueueDepth: 10 });
    const hung = s.schedule("set_reactions", never);
    const read = s.schedule("get_node_info", later("node"));
    await expect(hung).rejects.toThrow(/watchdog/);
    await expect(read).resolves.toBe("node");
    const st = s.getStatus();
    expect(st.watchdogTimeouts).toBe(1);
    expect(st.abandonedStillRunning).toBe(1);
    expect(st.lastWatchdog?.command).toBe("set_reactions");
    expect(st.running).toBeNull();
  });

  it("still serializes commands", async () => {
    const s = new CommandScheduler({ watchdogMs: 1000, maxQueueDepth: 10 });
    const log: string[] = [];
    const job = (n: string) => async () => {
      log.push(`start ${n}`);
      await new Promise((r) => setTimeout(r, 5));
      log.push(`end ${n}`);
    };
    await Promise.all([s.schedule("a", job("a")), s.schedule("b", job("b"))]);
    expect(log).toEqual(["start a", "end a", "start b", "end b"]);
  });

  it("a failing command does not poison the queue", async () => {
    const s = new CommandScheduler({ watchdogMs: 1000, maxQueueDepth: 10 });
    const bad = s.schedule("x", () => Promise.reject(new Error("boom")));
    const sync = s.schedule("y", () => {
      throw new Error("sync boom");
    });
    const [b, y] = await Promise.allSettled([bad, sync]);
    expect((b as PromiseRejectedResult).reason.message).toBe("boom");
    expect((y as PromiseRejectedResult).reason.message).toBe("sync boom");
    await expect(s.schedule("z", later(1))).resolves.toBe(1);
  });

  it("drops a command whose caller already timed out while it waited", async () => {
    const s = new CommandScheduler({ watchdogMs: 60, maxQueueDepth: 10 });
    let ran = false;
    void s.schedule("slow", never).catch(() => undefined);
    const stale = s.schedule(
      "create_frame",
      async () => {
        ran = true;
      },
      { deadlineMs: 20 },
    );
    await expect(stale).rejects.toThrow(/dropped/);
    expect(ran).toBe(false);
    expect(s.getStatus().expiredInQueue).toBe(1);
  });

  it("rejects fast when the queue is full", async () => {
    const s = new CommandScheduler({ watchdogMs: 10000, maxQueueDepth: 2 });
    void s.schedule("hung", never).catch(() => undefined);
    void s.schedule("q1", later(1)).catch(() => undefined);
    void s.schedule("q2", later(1)).catch(() => undefined);
    await expect(s.schedule("q3", later(1))).rejects.toThrow(/Plugin busy.*hung/);
    const st = s.getStatus();
    expect(st.running?.command).toBe("hung");
    expect(st.queued).toEqual(["q1", "q2"]);
  });

  it("decrements abandoned count when a hung command finally settles", async () => {
    const s = new CommandScheduler({ watchdogMs: 20, maxQueueDepth: 10 });
    await expect(s.schedule("late", later("x", 60))).rejects.toThrow(/watchdog/);
    expect(s.getStatus().abandonedStillRunning).toBe(1);
    await new Promise((r) => setTimeout(r, 80));
    expect(s.getStatus().abandonedStillRunning).toBe(0);
  });
});

describe("scheduler priority lanes", () => {
  function gate() {
    let open!: () => void;
    const p = new Promise<void>((r) => (open = r));
    return { p, open };
  }

  it("lets a light read jump queued heavy commands", async () => {
    const s = new CommandScheduler({ watchdogMs: 1000, maxQueueDepth: 10 });
    const order: string[] = [];
    const g = gate();
    const first = s.schedule("hold", () => g.p.then(() => order.push("hold")), { kind: "heavy" });
    const heavy = s.schedule("scan", async () => order.push("scan"), { kind: "heavy" });
    const light = s.schedule("get_node_info", async () => order.push("read"), { kind: "read" });
    g.open();
    await Promise.all([first, heavy, light]);
    expect(order).toEqual(["hold", "read", "scan"]);
  });

  it("never lets a light read jump a queued write, and writes stay FIFO", async () => {
    const s = new CommandScheduler({ watchdogMs: 1000, maxQueueDepth: 10 });
    const order: string[] = [];
    const g = gate();
    const hold = s.schedule("hold", () => g.p.then(() => order.push("hold")), { kind: "heavy" });
    const w1 = s.schedule("w1", async () => order.push("w1"));
    const heavy = s.schedule("scan", async () => order.push("scan"), { kind: "heavy" });
    const w2 = s.schedule("w2", async () => order.push("w2"), { kind: "write" });
    const r = s.schedule("read", async () => order.push("read"), { kind: "read" });
    g.open();
    await Promise.all([hold, w1, heavy, w2, r]);
    expect(order).toEqual(["hold", "w1", "scan", "w2", "read"]);
  });

  it("a light read ahead of the first write still jumps heavy work before it", async () => {
    const s = new CommandScheduler({ watchdogMs: 1000, maxQueueDepth: 10 });
    const order: string[] = [];
    const g = gate();
    const hold = s.schedule("hold", () => g.p.then(() => order.push("hold")), { kind: "write" });
    const heavy = s.schedule("scan", async () => order.push("scan"), { kind: "heavy" });
    const r = s.schedule("read", async () => order.push("read"), { kind: "read" });
    const w = s.schedule("w", async () => order.push("w"));
    g.open();
    await Promise.all([hold, heavy, r, w]);
    expect(order).toEqual(["hold", "read", "scan", "w"]);
  });

  it("runs at most one heavy command at a time", async () => {
    const s = new CommandScheduler({ watchdogMs: 1000, maxQueueDepth: 10 });
    let active = 0;
    let peak = 0;
    const job = () => async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    };
    await Promise.all([1, 2, 3, 4].map((i) => s.schedule(`h${i}`, job(), { kind: "heavy" })));
    expect(peak).toBe(1);
  });

  it("reports queuedMs through onStart", async () => {
    let t = 0;
    const s = new CommandScheduler({ watchdogMs: 1000, maxQueueDepth: 10, now: () => t });
    const g = gate();
    const seen: number[] = [];
    const a = s.schedule("a", () => g.p, { onStart: (ms) => seen.push(ms) });
    const b = s.schedule("b", async () => 1, { onStart: (ms) => seen.push(ms) });
    t = 250;
    g.open();
    await Promise.all([a, b]);
    expect(seen).toEqual([0, 250]);
  });

  it("still drops an expired read that jumped the queue", async () => {
    let t = 0;
    const s = new CommandScheduler({ watchdogMs: 1000, maxQueueDepth: 10, now: () => t });
    const g = gate();
    const hold = s.schedule("hold", () => g.p);
    const heavy = s.schedule("scan", async () => 1, { kind: "heavy" });
    const r = s.schedule("read", async () => 1, { kind: "read", deadlineMs: 100 });
    t = 500;
    g.open();
    await expect(r).rejects.toThrow(/dropped/);
    await Promise.all([hold, heavy]);
  });
});

describe("scheduler recovery after a watchdog", () => {
  it("an abandoned heavy command does not block later light reads, and lastCompletedAtMs moves past the watchdog", async () => {
    const s = new CommandScheduler({ watchdogMs: 30, maxQueueDepth: 10 });
    const hung = s.schedule("scan_nodes_by_types", never, { kind: "heavy" });
    await expect(hung).rejects.toThrow(/watchdog/);
    const wd = s.getStatus().lastWatchdog!.atMs;
    await new Promise((r) => setTimeout(r, 2));
    await expect(s.schedule("get_node_info", later("ok"), { kind: "read" })).resolves.toBe("ok");
    const st = s.getStatus();
    expect(st.abandonedStillRunning).toBe(1);
    expect(st.lastCompletedAtMs).not.toBeNull();
    expect(st.lastCompletedAtMs!).toBeGreaterThan(wd);
  });
});
