/**
 * Race `p` against a timer. Resolves/rejects with `p` when it settles first,
 * otherwise rejects with a TimeoutError. The timer is always cleared.
 *
 * JavaScript cannot cancel `p`; a Figma async API that never settles keeps its
 * promise pending, but the caller is released and can degrade.
 */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} did not settle within ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Deadline (epoch ms) of the command currently executing on the plugin thread,
 * or undefined. Commands run serially, so one slot suffices; a long walk reads
 * it once at its start and stops before the caller gives up.
 */
let currentDeadlineAt: number | undefined;
export function setCommandDeadline(at: number | undefined): void {
  currentDeadlineAt = at;
}
export function getCommandDeadline(): number | undefined {
  return currentDeadlineAt;
}
