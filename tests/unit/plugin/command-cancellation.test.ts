import { CommandScheduler } from "../../../src/videntia_figma_plugin/utils/command-scheduler";
import { createYielder } from "../../../src/videntia_figma_plugin/utils/walk-budget";
import { isCancelledError, type CancelSignal } from "../../../src/videntia_figma_plugin/utils/cancellation";
import { READONLY_COMMANDS } from "../../../src/videntia_figma_mcp/utils/readonly-commands";

const tick0 = () => new Promise<void>((r) => setTimeout(r, 0));

/** A fake long walk: yields every 100 "nodes" via the real yielder, honouring the signal. */
function longWalk(progress: { visited: number; error?: unknown }, nodes = 1_000_000) {
  return async (signal: CancelSignal) => {
    const tick = createYielder(100, tick0, signal);
    try {
      for (let i = 0; i < nodes; i++) {
        progress.visited++;
        await tick();
      }
      return "done";
    } catch (e) {
      progress.error = e;
      throw e;
    }
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("cooperative cancellation", () => {
  it("watchdog aborts a long read walk mid-way and counts it as cancelled", async () => {
    const s = new CommandScheduler({ watchdogMs: 30, maxQueueDepth: 10 });
    const progress = { visited: 0 } as { visited: number; error?: unknown };
    await expect(s.schedule("get_content_tree", longWalk(progress), { kind: "heavy" })).rejects.toThrow(/watchdog/);
    await wait(20);
    expect(isCancelledError(progress.error)).toBe(true);
    expect(progress.visited).toBeLessThan(1_000_000);
    const st = s.getStatus();
    expect(st.cancelled).toBe(1);
    expect(st.abandonedStillRunning).toBe(0);
  });

  it("server cancel aborts a running read and frees the slot immediately", async () => {
    const s = new CommandScheduler({ watchdogMs: 60000, maxQueueDepth: 10 });
    const progress = { visited: 0 } as { visited: number; error?: unknown };
    const p = s.schedule("scan_nodes_by_types", longWalk(progress), { kind: "heavy", id: "r1" });
    const next = s.schedule("get_selection", async () => "next", { kind: "read" });
    await wait(5);
    expect(s.cancel("r1")).toBe("aborted");
    await expect(p).rejects.toThrow(/cancelled/);
    await expect(next).resolves.toBe("next");
    await wait(10);
    expect(isCancelledError(progress.error)).toBe(true);
    expect(s.getStatus().cancelled).toBe(1);
    expect(s.getStatus().abandonedStillRunning).toBe(0);
  });

  it("cancel of a queued, not-started command removes it so it never runs", async () => {
    const s = new CommandScheduler({ watchdogMs: 60000, maxQueueDepth: 10 });
    let release!: () => void;
    const blocker = s.schedule("set_fill_color", () => new Promise<void>((r) => (release = r)), { id: "w0" });
    let ran = false;
    const queued = s.schedule(
      "get_node_info",
      async () => {
        ran = true;
      },
      { kind: "read", id: "q1" },
    );
    expect(s.cancel("q1")).toBe("dropped");
    await expect(queued).rejects.toThrow(/before it started/);
    release();
    await blocker;
    expect(ran).toBe(false);
  });

  it("never aborts a started write: it runs to completion", async () => {
    const s = new CommandScheduler({ watchdogMs: 60000, maxQueueDepth: 10 });
    let signalSeen: CancelSignal | undefined;
    const p = s.schedule(
      "set_fill_color",
      async (signal) => {
        signalSeen = signal;
        await wait(20);
        return "written";
      },
      { id: "w1" },
    );
    await wait(2);
    expect(s.cancel("w1")).toBe("write-running");
    await expect(p).resolves.toBe("written");
    expect(signalSeen!.aborted).toBe(false);
  });

  it("a watchdog never aborts a write's token", async () => {
    const s = new CommandScheduler({ watchdogMs: 10, maxQueueDepth: 10 });
    let signalSeen: CancelSignal | undefined;
    const p = s.schedule("set_fill_color", async (signal) => {
      signalSeen = signal;
      await wait(30);
    });
    await expect(p).rejects.toThrow(/watchdog/);
    expect(signalSeen!.aborted).toBe(false);
  });
});

describe("cancel on disconnect", () => {
  it("plugin socket closes: queued reads and writes dropped, running read aborted", async () => {
    const s = new CommandScheduler({ watchdogMs: 60000, maxQueueDepth: 10 });
    const progress = { visited: 0 } as { visited: number; error?: unknown };
    const running = s.schedule("get_content_tree", longWalk(progress), { kind: "heavy", clientId: "a" });
    let ranQueued = 0;
    const qr = s.schedule("get_node_info", async () => ranQueued++, { kind: "read", clientId: "a" });
    const qw = s.schedule("set_fill_color", async () => ranQueued++, { clientId: "b" });
    await wait(5);
    const out = s.cancelForDisconnect(undefined, "relay closed");
    expect(out).toEqual({ dropped: 2, aborted: 1, orphanedWrite: false });
    await expect(running).rejects.toThrow(/cancelled/);
    await expect(qr).rejects.toThrow(/dropped unstarted/);
    await expect(qw).rejects.toThrow(/dropped unstarted/);
    await wait(10);
    expect(ranQueued).toBe(0);
    expect(isCancelledError(progress.error)).toBe(true);
    const st = s.getStatus();
    expect(st.droppedOnDisconnect).toBe(2);
    expect(st.cancelledOnDisconnect).toBe(1);
  });

  it("plugin socket closes: a running write completes, its result ignored", async () => {
    const s = new CommandScheduler({ watchdogMs: 60000, maxQueueDepth: 10 });
    let finished = false;
    let settled = false;
    const p = s.schedule("set_fill_color", async () => {
      await wait(20);
      finished = true;
      return "ok";
    });
    p.then(
      () => (settled = true),
      () => (settled = true),
    );
    await wait(2);
    expect(s.cancelForDisconnect().orphanedWrite).toBe(true);
    await wait(40);
    expect(finished).toBe(true);
    expect(settled).toBe(false); // nobody receives the result
    // The slot is released after the write finishes, so later work runs.
    await expect(s.schedule("get_selection", async () => 1, { kind: "read" })).resolves.toBe(1);
  });

  it("one client goes away: only its commands are cancelled", async () => {
    const s = new CommandScheduler({ watchdogMs: 60000, maxQueueDepth: 10 });
    const progress = { visited: 0 } as { visited: number; error?: unknown };
    const running = s.schedule("get_content_tree", longWalk(progress), { kind: "heavy", clientId: "gone" });
    const mine = s.schedule("set_fill_color", async () => "mine", { clientId: "gone" });
    const other = s.schedule("set_fill_color", async () => "other", { clientId: "stays" });
    await wait(5);
    expect(s.cancelForDisconnect("gone")).toEqual({ dropped: 1, aborted: 1, orphanedWrite: false });
    await expect(running).rejects.toThrow(/cancelled/);
    await expect(mine).rejects.toThrow(/dropped unstarted/);
    await expect(other).resolves.toBe("other");
  });

  it("another client's running command is untouched", async () => {
    const s = new CommandScheduler({ watchdogMs: 60000, maxQueueDepth: 10 });
    const p = s.schedule(
      "get_node_info",
      async (signal) => {
        await wait(10);
        return signal.aborted;
      },
      { kind: "read", clientId: "stays" },
    );
    expect(s.cancelForDisconnect("gone")).toEqual({ dropped: 0, aborted: 0, orphanedWrite: false });
    await expect(p).resolves.toBe(false);
  });
});

describe("READONLY_COMMANDS additions", () => {
  it("lists the server-side read tools", () => {
    expect(READONLY_COMMANDS.has("get_node_summary")).toBe(true);
    expect(READONLY_COMMANDS.has("measure_node")).toBe(true);
  });
});
