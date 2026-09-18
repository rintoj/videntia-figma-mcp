/**
 * Capture mode: run a standalone MCP tool handler WITHOUT letting it talk to Figma,
 * and record the exact wire payload it would have sent.
 *
 * WHY THIS EXISTS
 * ---------------
 * `batch_actions` used to forward each action's params RAW to the plugin, bypassing
 * the standalone tool's zod schema and every bit of massaging the handler does
 * between parse and dispatch. A hand-maintained `command -> normalize(params)` alias
 * map (`normalize-batch-params.ts`) tried to re-derive that massaging as a SECOND
 * source of truth, and drifted from the handlers twice.
 *
 * Capture mode removes the second source of truth entirely: a batched action is the
 * standalone handler, parsed by the standalone schema, run to the point where it
 * would call `sendCommandToFigma` — so the batch payload is byte-identical to the
 * standalone payload BY CONSTRUCTION, not by a promise a map has to keep.
 *
 * Mechanics: an AsyncLocalStorage-scoped context that `sendCommandToFigma` consults
 * before touching the socket. In capture mode it records `{command, params}` and
 * hands the handler a permissive placeholder, so the handler's post-dispatch result
 * formatting runs harmlessly. That formatted text is discarded — only the recorded
 * commands matter.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** One command a handler tried to put on the wire. */
export interface CapturedCommand {
  command: string;
  params: Record<string, unknown>;
}

interface CaptureContext {
  captured: CapturedCommand[];
}

const captureStorage = new AsyncLocalStorage<CaptureContext>();

/**
 * A stand-in for a Figma response that survives arbitrary post-dispatch formatting:
 * every property read yields another placeholder, it stringifies to "", iterates as
 * empty, and is deliberately NOT thenable so `await` on it resolves immediately.
 * Handlers format it into text nobody reads; what matters is that they do not throw
 * before any LATER `sendCommandToFigma` call they still have to make.
 */
function makePlaceholder(): unknown {
  const target = function placeholder() {} as unknown as object;
  return new Proxy(target, {
    get(_target, prop) {
      // `then` MUST be undefined: a thenable would hang or re-enter `await`.
      if (prop === "then" || prop === "catch" || prop === "finally") return undefined;
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === Symbol.toStringTag) return "Object";
      if (prop === Symbol.iterator) return function* () {};
      if (prop === "toJSON") return () => null;
      if (prop === "toString") return () => "";
      if (prop === "valueOf") return () => "";
      if (prop === "length" || prop === "size") return 0;
      if (prop === "constructor") return Object;
      return makePlaceholder();
    },
    has() {
      return true;
    },
    apply() {
      return makePlaceholder();
    },
    ownKeys() {
      return [];
    },
  });
}

/**
 * Consulted by `sendCommandToFigma`. Returns `undefined` when not capturing (normal
 * dispatch); otherwise records the command and returns the placeholder to hand back.
 */
export function interceptForCapture(command: string, params: unknown): { value: unknown } | undefined {
  const ctx = captureStorage.getStore();
  if (!ctx) return undefined;
  ctx.captured.push({ command, params: dropUndefined(params) });
  return { value: makePlaceholder() };
}

/**
 * Handlers routinely build their payload with explicit `undefined` values for omitted
 * optional params. On the standalone path those never reach Figma — JSON serialisation
 * drops them. A batch payload is nested inside another object, so they would survive
 * and the two paths would differ by keys that mean nothing. Drop them here, so what is
 * captured is what the wire would actually have carried.
 */
function dropUndefined(params: unknown): Record<string, unknown> {
  if (params === null || typeof params !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** True while a tool handler is being run for its wire payload rather than its effect. */
export function isCapturing(): boolean {
  return captureStorage.getStore() !== undefined;
}

/**
 * Run `fn` (a standalone tool handler) in capture mode and return the commands it
 * tried to send, in order. A throw from `fn` is reported rather than propagated:
 * commands recorded BEFORE the throw are still returned, because the throw is
 * usually the handler's result-formatting code choking on the placeholder, long
 * after the payload we actually want was recorded.
 */
export async function captureWireCommands(
  fn: () => Promise<unknown>,
): Promise<{ captured: CapturedCommand[]; error?: string }> {
  const ctx: CaptureContext = { captured: [] };
  try {
    await captureStorage.run(ctx, fn);
    return { captured: ctx.captured };
  } catch (error) {
    return {
      captured: ctx.captured,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
