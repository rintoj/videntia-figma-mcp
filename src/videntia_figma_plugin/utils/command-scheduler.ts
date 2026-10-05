/**
 * Serial command scheduler for the plugin main thread.
 *
 * Commands run one at a time (handlers share module-level state and race on
 * read-modify-write of the document), but unlike the bare promise chain this
 * replaces, a command can no longer wedge the queue forever:
 *
 * - every command runs under a watchdog; when it fires the caller gets an
 *   error and the slot is released, so the commands behind it proceed;
 * - a command whose caller has already given up (its `deadlineMs` elapsed
 *   while it sat in the queue) is dropped instead of executed;
 * - the queue depth is bounded, so a flood fails fast with a clear error
 *   instead of piling up behind a slow command;
 * - `getStatus()` reports the running command and its age, which the
 *   `get_plugin_health` command exposes without going through the queue.
 *
 * Ordering: commands carry a `kind`. Writes keep strict FIFO order. A light
 * read may jump ahead of queued heavy commands (page-wide scans, exports) but
 * never ahead of a queued write, so a read issued after a write still sees it.
 * Execution stays serial, so at most one heavy command ever runs at a time.
 * Every job records `queuedMs` (enqueue to start), reported via `onStart`.
 *
 * Cancellation (utils/cancellation.ts): every job gets a CancelToken passed to
 * `run`. The watchdog, a server `cancel {id}`, or a disconnect aborts it, and
 * only for READS: a started write always runs to completion (its result is
 * ignored if nobody is left to receive it). A job cancelled before it starts
 * (deadline drop, queue-cap rejection, cancel while queued) never runs at all.
 * A read that honours the token throws CancelledError at its next yield point;
 * it is counted as `cancelled` and its slot is freed immediately.
 *
 * JavaScript cannot cancel a pending await (getMainComponentAsync, exportAsync,
 * ...). Such a promise is abandoned: it settles whenever Figma finishes and its
 * result is ignored. A job still stuck in one after the watchdog is counted in
 * `abandonedStillRunning` until it settles.
 */

import { CancelToken, isCancelledError, type CancelSignal } from "./cancellation";

export interface SchedulerOptions {
  /** Max time a single command may hold the slot. */
  watchdogMs: number;
  /** Max commands waiting (not counting the running one). */
  maxQueueDepth: number;
  now?: () => number;
}

export interface ScheduleOptions {
  /** Per-command watchdog override (ms). */
  watchdogMs?: number;
  /** Caller's own timeout (ms): drop the command if it waited this long. */
  deadlineMs?: number;
  /**
   * "write" (default): FIFO, nothing jumps it. "heavy": a heavy read.
   * "read": a light read, may run before queued heavy commands.
   */
  kind?: CommandKind;
  /** Called when the command leaves the queue and starts, with its wait. */
  onStart?: (queuedMs: number) => void;
  /** Request id, so a server `cancel {id}` can find the job. */
  id?: string;
  /** Which MCP client sent it, so a per-client disconnect can cancel only its jobs. */
  clientId?: string;
}

export type CommandKind = "write" | "read" | "heavy";

export interface SchedulerStatus {
  running: { command: string; ageMs: number } | null;
  queueDepth: number;
  queued: string[];
  completed: number;
  watchdogTimeouts: number;
  expiredInQueue: number;
  rejectedQueueFull: number;
  /** Commands abandoned by the watchdog that have not settled yet. */
  abandonedStillRunning: number;
  /** Reads that stopped cooperatively after their token was aborted. */
  cancelled: number;
  /** Running commands aborted (reads) or orphaned (writes) by a disconnect. */
  cancelledOnDisconnect: number;
  /** Queued commands dropped, never started, because their caller disconnected. */
  droppedOnDisconnect: number;
  lastWatchdog: { command: string; atMs: number } | null;
  /** When the most recent command settled normally (not via the watchdog). */
  lastCompletedAtMs: number | null;
}

interface Job {
  command: string;
  run: (signal: CancelSignal) => Promise<unknown>;
  token: CancelToken;
  id?: string;
  clientId?: string;
  /** Already counted in a cancel counter (server cancel or disconnect). */
  cancelCounted?: boolean;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  enqueuedAt: number;
  watchdogMs: number;
  deadlineMs?: number;
  kind: CommandKind;
  onStart?: (queuedMs: number) => void;
}

export class CommandScheduler {
  private queue: Job[] = [];
  private current: { job: Job; startedAt: number; finish: (how: "cancel", reason: string) => void } | null = null;
  private stats = {
    completed: 0,
    watchdogTimeouts: 0,
    expiredInQueue: 0,
    rejectedQueueFull: 0,
    abandonedStillRunning: 0,
    cancelled: 0,
    cancelledOnDisconnect: 0,
    droppedOnDisconnect: 0,
    lastWatchdog: null as { command: string; atMs: number } | null,
    lastCompletedAtMs: null as number | null,
  };
  private readonly now: () => number;

  constructor(private readonly opts: SchedulerOptions) {
    this.now = opts.now ?? (() => Date.now());
  }

  schedule<T>(command: string, run: (signal: CancelSignal) => Promise<T>, options: ScheduleOptions = {}): Promise<T> {
    if (this.queue.length >= this.opts.maxQueueDepth) {
      this.stats.rejectedQueueFull++;
      const running = this.current
        ? `"${this.current.job.command}" (running ${this.now() - this.current.startedAt}ms)`
        : "none";
      return Promise.reject(
        new Error(
          `Plugin busy: ${this.queue.length} commands already queued (limit ${this.opts.maxQueueDepth}); ` +
            `running: ${running}. Reduce parallel agents or batch size, then retry.`,
        ),
      );
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        command,
        run,
        token: new CancelToken(),
        id: options.id,
        clientId: options.clientId,
        resolve: resolve as (v: unknown) => void,
        reject,
        enqueuedAt: this.now(),
        watchdogMs: options.watchdogMs ?? this.opts.watchdogMs,
        deadlineMs: options.deadlineMs,
        kind: options.kind ?? "write",
        onStart: options.onStart,
      });
      this.pump();
    });
  }

  getStatus(): SchedulerStatus {
    return {
      running: this.current ? { command: this.current.job.command, ageMs: this.now() - this.current.startedAt } : null,
      queueDepth: this.queue.length,
      queued: this.queue.map((j) => j.command),
      completed: this.stats.completed,
      watchdogTimeouts: this.stats.watchdogTimeouts,
      expiredInQueue: this.stats.expiredInQueue,
      rejectedQueueFull: this.stats.rejectedQueueFull,
      abandonedStillRunning: this.stats.abandonedStillRunning,
      cancelled: this.stats.cancelled,
      cancelledOnDisconnect: this.stats.cancelledOnDisconnect,
      droppedOnDisconnect: this.stats.droppedOnDisconnect,
      lastWatchdog: this.stats.lastWatchdog,
      lastCompletedAtMs: this.stats.lastCompletedAtMs,
    };
  }

  /**
   * Server-side timeout: cancel one command by request id. A queued job is
   * removed and never runs. A running READ has its token aborted and its slot
   * freed now. A running WRITE is left to finish. Returns what happened.
   */
  cancel(
    id: string,
    reason = "Cancelled by the server after its timeout",
  ): "dropped" | "aborted" | "write-running" | "not-found" {
    const qi = this.queue.findIndex((j) => j.id === id);
    if (qi >= 0) {
      const [job] = this.queue.splice(qi, 1);
      job.token.abort(reason);
      this.stats.cancelled++;
      job.reject(new Error(`Command "${job.command}" cancelled before it started: ${reason}`));
      return "dropped";
    }
    const cur = this.current;
    if (cur && cur.job.id === id) {
      if (cur.job.kind === "write") return "write-running";
      this.stats.cancelled++;
      cur.job.cancelCounted = true;
      cur.finish("cancel", reason);
      return "aborted";
    }
    return "not-found";
  }

  /**
   * A caller went away (the plugin's relay socket closed, or one MCP client
   * dropped). For the matching jobs: queued ones are dropped unstarted (reads and
   * writes alike), a running read is aborted, a running write finishes and its
   * result is ignored. With no `clientId` every job matches.
   */
  cancelForDisconnect(
    clientId?: string,
    reason = "Caller disconnected",
  ): { dropped: number; aborted: number; orphanedWrite: boolean } {
    const matches = (j: Job) => clientId === undefined || j.clientId === clientId;
    let dropped = 0;
    this.queue = this.queue.filter((job) => {
      if (!matches(job)) return true;
      job.token.abort(reason);
      dropped++;
      job.reject(new Error(`Command "${job.command}" dropped unstarted: ${reason}`));
      return false;
    });
    this.stats.droppedOnDisconnect += dropped;
    let aborted = 0;
    let orphanedWrite = false;
    const cur = this.current;
    if (cur && matches(cur.job)) {
      this.stats.cancelledOnDisconnect++;
      if (cur.job.kind === "write") {
        orphanedWrite = true;
        // Let it finish; nobody can receive the result.
        cur.job.resolve = () => {};
        cur.job.reject = () => {};
      } else {
        aborted = 1;
        cur.job.cancelCounted = true;
        cur.finish("cancel", reason);
      }
    }
    return { dropped, aborted, orphanedWrite };
  }

  /**
   * Index of the next job: the first light read that sits before any queued
   * write, otherwise the head of the queue.
   */
  private pickNext(): number {
    for (let i = 0; i < this.queue.length; i++) {
      const k = this.queue[i].kind;
      if (k === "write") return 0;
      if (k === "read") return i;
    }
    return 0;
  }

  private pump(): void {
    if (this.current) return;
    if (this.queue.length === 0) return;
    const job = this.queue.splice(this.pickNext(), 1)[0];

    const waited = this.now() - job.enqueuedAt;
    if (job.deadlineMs !== undefined && job.deadlineMs > 0 && waited >= job.deadlineMs) {
      this.stats.expiredInQueue++;
      job.reject(
        new Error(
          `Command "${job.command}" dropped: it waited ${waited}ms in the plugin queue, past its caller's ${job.deadlineMs}ms timeout, so it was never executed.`,
        ),
      );
      this.pump();
      return;
    }

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (_how: "cancel", reason: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      job.token.abort(reason);
      // The run is still unwinding; it settles at its next check (or an abandoned await).
      this.stats.abandonedStillRunning++;
      job.reject(new Error(`Command "${job.command}" cancelled: ${reason}`));
      release();
    };
    this.current = { job, startedAt: this.now(), finish };
    if (job.onStart) {
      try {
        job.onStart(waited);
      } catch (_e) {
        /* reporting must never break the queue */
      }
    }
    const release = () => {
      this.current = null;
      this.pump();
    };

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      this.stats.watchdogTimeouts++;
      this.stats.abandonedStillRunning++;
      this.stats.lastWatchdog = { command: job.command, atMs: this.now() };
      // Reads stop at their next yield point; writes are never aborted mid-flight.
      if (job.kind !== "write") job.token.abort(`Watchdog (${job.watchdogMs}ms) fired`);
      job.reject(
        new Error(
          `Command "${job.command}" exceeded the plugin watchdog (${job.watchdogMs}ms) and was abandoned so the queue can continue. ` +
            `It may still complete in the background; verify its effect before retrying.`,
        ),
      );
      release();
    }, job.watchdogMs);

    let p: Promise<unknown>;
    try {
      p = Promise.resolve(job.run(job.token));
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      (v) => {
        if (settled) {
          this.stats.abandonedStillRunning--;
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.stats.completed++;
        this.stats.lastCompletedAtMs = this.now();
        job.resolve(v);
        release();
      },
      (e) => {
        if (settled) {
          this.stats.abandonedStillRunning--;
          // A watchdog-abandoned read that stopped cooperatively counts as cancelled.
          if (isCancelledError(e) && !job.cancelCounted) this.stats.cancelled++;
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.stats.completed++;
        this.stats.lastCompletedAtMs = this.now();
        job.reject(e);
        release();
      },
    );
  }
}
