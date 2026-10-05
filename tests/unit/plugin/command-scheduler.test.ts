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
