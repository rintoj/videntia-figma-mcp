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
 * Note: JavaScript cannot cancel a pending await. A command abandoned by the
 * watchdog keeps running in the background and may still finish later; its
 * result is discarded. It is counted in `abandoned` so health shows it.
 */

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
  lastWatchdog: { command: string; atMs: number } | null;
  /** When the most recent command settled normally (not via the watchdog). */
  lastCompletedAtMs: number | null;
}

interface Job {
  command: string;
  run: () => Promise<unknown>;
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
  private current: { job: Job; startedAt: number } | null = null;
  private stats = {
    completed: 0,
    watchdogTimeouts: 0,
    expiredInQueue: 0,
    rejectedQueueFull: 0,
    abandonedStillRunning: 0,
    lastWatchdog: null as { command: string; atMs: number } | null,
    lastCompletedAtMs: null as number | null,
  };
  private readonly now: () => number;

  constructor(private readonly opts: SchedulerOptions) {
    this.now = opts.now ?? (() => Date.now());
  }

  schedule<T>(command: string, run: () => Promise<T>, options: ScheduleOptions = {}): Promise<T> {
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
      lastWatchdog: this.stats.lastWatchdog,
      lastCompletedAtMs: this.stats.lastCompletedAtMs,
    };
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

    this.current = { job, startedAt: this.now() };
    if (job.onStart) {
      try {
        job.onStart(waited);
      } catch (_e) {
        /* reporting must never break the queue */
      }
    }
    let settled = false;
    const release = () => {
      this.current = null;
      this.pump();
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      this.stats.watchdogTimeouts++;
      this.stats.abandonedStillRunning++;
      this.stats.lastWatchdog = { command: job.command, atMs: this.now() };
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
      p = Promise.resolve(job.run());
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
