/**
 * Cooperative cancellation for plugin commands.
 *
 * The scheduler gives every command a CancelToken. It is aborted when the
 * watchdog fires or the server sends `cancel {id}` after its own timeout. Long
 * walks capture the token when they START (`getCommandSignal()`), because a
 * later command replaces the module-level slot, and check it at each yield
 * point and between awaited Figma calls via `throwIfCancelled`.
 *
 * Limits: a pending Figma API promise (getMainComponentAsync, exportAsync,
 * loadFontAsync, ...) cannot be cancelled. When a command is cancelled while
 * one is in flight, that promise is abandoned: it settles whenever Figma
 * finishes and its result is ignored. The walk stops at the next check.
 *
 * Writes are never aborted mid-flight: the scheduler only aborts tokens of
 * read commands, so a started write always runs to completion.
 */

export class CancelledError extends Error {
  readonly cancelled = true;
  constructor(reason: string) {
    super(reason);
    this.name = "CancelledError";
  }
}

export interface CancelSignal {
  readonly aborted: boolean;
  readonly reason: string | undefined;
}

export class CancelToken implements CancelSignal {
  private _aborted = false;
  private _reason: string | undefined;
  get aborted(): boolean {
    return this._aborted;
  }
  get reason(): string | undefined {
    return this._reason;
  }
  abort(reason: string): void {
    if (this._aborted) return;
    this._aborted = true;
    this._reason = reason;
  }
}

/** A signal that never aborts: the default outside a scheduled command. */
export const NEVER_CANCELLED: CancelSignal = { aborted: false, reason: undefined };

let currentSignal: CancelSignal = NEVER_CANCELLED;

/** Set by the scheduler wrapper immediately before a command's handler runs. */
export function setCommandSignal(signal: CancelSignal | undefined): void {
  currentSignal = signal ?? NEVER_CANCELLED;
}

/** The running command's signal. Capture it at the start of a walk. */
export function getCommandSignal(): CancelSignal {
  return currentSignal;
}

export function throwIfCancelled(signal: CancelSignal | undefined): void {
  if (signal && signal.aborted) throw new CancelledError(signal.reason ?? "Command cancelled");
}

export function isCancelledError(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { cancelled?: unknown }).cancelled === true;
}
