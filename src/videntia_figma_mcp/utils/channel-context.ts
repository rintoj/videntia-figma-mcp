/**
 * Per-REQUEST Figma channel binding.
 *
 * WHY THIS EXISTS
 * ---------------
 * One MCP process serves every agent that shares a client session (Claude Code
 * subagents all speak over the SAME stdio transport). The channel used to live in a
 * module-level `currentChannel`, so two agents working in two different Figma files
 * clobbered each other: agent B's `join_channel` re-pointed the single global, and
 * agent A's very next command was delivered to B's document. Node ids are unique only
 * within a file, so that silently read — and wrote — the wrong Figma file.
 *
 * The channel is therefore carried per tool invocation in an AsyncLocalStorage store,
 * established by the tool-registry wrapper from the call's own `channel` parameter (see
 * `tool-registry.ts`). Anything the handler awaits inherits the store, so the transport
 * can resolve "which channel is THIS command for" without consulting shared state.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface ChannelContext {
  /** The channel this tool invocation is bound to, if the caller named one. */
  channel?: string;
  /**
   * The MCP session this invocation arrived on. The socket server serves every Claude
   * session from ONE process over SSE/streamable HTTP, so "which channel did the caller
   * join" is per session, not per process.
   */
  sessionId?: string;
  /**
   * Out-of-band warnings for this tool invocation (e.g. a slow plugin queue). Shared by
   * reference with nested scopes so `batch_actions` / `figma_call` collect their inner
   * calls' warnings; only the outermost scope appends them to the MCP response.
   */
  warnings?: string[];
}

const storage = new AsyncLocalStorage<ChannelContext>();

/**
 * Run `fn` with `channel` bound to the current async context.
 *
 * Nesting inherits: `figma_call` and `batch_actions` invoke other tools' wrapped
 * handlers, which open a scope of their own. An inner scope that named no channel must
 * keep the outer binding rather than blanking it, or the dispatcher tools would lose the
 * channel their caller addressed them to.
 */
export function runWithChannel<T>(channel: string | undefined, sessionId: string | undefined, fn: () => T): T {
  const outer = storage.getStore();
  return storage.run(
    { channel: channel ?? outer?.channel, sessionId: sessionId ?? outer?.sessionId, warnings: outer?.warnings ?? [] },
    fn,
  );
}

/** True when the current async context is inside a tool invocation scope. */
export function hasRequestScope(): boolean {
  return storage.getStore() !== undefined;
}

/** Record a warning against the current tool invocation. No-op outside one. */
export function addRequestWarning(warning: string): void {
  const store = storage.getStore();
  if (!store) return;
  if (!store.warnings) store.warnings = [];
  if (!store.warnings.includes(warning)) store.warnings.push(warning);
}

/** The warnings recorded so far for the current tool invocation. */
export function getRequestWarnings(): string[] {
  return storage.getStore()?.warnings ?? [];
}

/**
 * Pure: append warnings to an MCP tool response as one extra text content block.
 * Works for every result shape because it never touches the tool's own payload.
 * Non-MCP-shaped values are returned untouched.
 */
export function appendWarningsToResponse<T>(response: T, warnings: string[]): T {
  if (warnings.length === 0) return response;
  const r = response as unknown as { content?: unknown } | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.content)) return response;
  const text = warnings.map((w) => `Warning: ${w}`).join("\n");
  return { ...(r as object), content: [...r.content, { type: "text", text }] } as T;
}

/** The MCP session this tool invocation arrived on, if the transport reported one. */
export function getRequestSessionId(): string | undefined {
  return storage.getStore()?.sessionId;
}

/** The channel bound to the current tool invocation, if any. */
export function getRequestChannel(): string | undefined {
  const store = storage.getStore();
  return store?.channel;
}

/**
 * Bind the current invocation to `channel` from inside the handler.
 *
 * `join_channel` uses this so that the rest of the same tool call (and any command it
 * issues) talks to the channel it just joined, even though the caller passed no
 * `channel` parameter. A no-op outside a tool invocation.
 */
export function setRequestChannel(channel: string): void {
  const store = storage.getStore();
  if (store) store.channel = channel;
}
