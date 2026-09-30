/**
 * MCP session bookkeeping for the relay: which SSE / Streamable HTTP sessions
 * are open, when each was last used, and how each is torn down.
 *
 * Kept free of listen/interval side effects so it can be unit tested — the
 * relay in `src/socket.ts` owns the HTTP server, this module owns the sessions.
 *
 * Relies on @modelcontextprotocol/sdk 1.22 close semantics:
 * - `SSEServerTransport` fires `onclose` only on `res` "close", which Bun never
 *   emits for a disconnected SSE client — so we listen on `req` "close" too.
 * - `transport.close()` always fires `onclose`, and `McpServer.close()` just
 *   calls `transport.close()`. Calling both from `onclose` recurses forever, so
 *   sessions are only ever closed through `close(id)`, once.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export const DEFAULT_MCP_SESSION_IDLE_MS = 30 * 60_000;

/** `MCP_SESSION_IDLE_MS` override; anything but a positive number falls back to the default. */
export function parseIdleMs(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MCP_SESSION_IDLE_MS;
}

export interface ClosableTransport {
  close(): Promise<void>;
}

interface SessionEntry<T> {
  transport: T;
  lastSeen: number;
  inflight: number;
  closed: boolean;
}

export interface SessionRegistryOptions {
  now?: () => number;
  onCloseError?: (sessionId: string, err: unknown) => void;
}

export interface SessionRegistry<T extends ClosableTransport> {
  readonly size: number;
  add(sessionId: string, transport: T): void;
  get(sessionId: string): T | undefined;
  has(sessionId: string): boolean;
  /** Record activity without changing the in-flight count. */
  touch(sessionId: string): void;
  /** A request (or long-lived stream) started; the session is never idle while any are running. */
  begin(sessionId: string): void;
  end(sessionId: string): void;
  /** Forget a session without closing it — for transports that already closed themselves. */
  forget(sessionId: string): void;
  /** Remove and close the transport. A second call, or an unknown id, does nothing. */
  close(sessionId: string): Promise<void>;
  /** Close every session with nothing in flight that has been unused for longer than `idleMs`. */
  sweepIdle(idleMs: number): Promise<number>;
  closeAll(): Promise<void>;
}

export function createSessionRegistry<T extends ClosableTransport>(
  options: SessionRegistryOptions = {},
): SessionRegistry<T> {
  const now = options.now ?? Date.now;
  const sessions = new Map<string, SessionEntry<T>>();

  const close = async (sessionId: string) => {
    const entry = sessions.get(sessionId);
    if (!entry || entry.closed) return;
    // Flag + delete before closing: transport.close() fires onclose, which may call back in here.
    entry.closed = true;
    sessions.delete(sessionId);
    try {
      await entry.transport.close();
    } catch (err) {
      options.onCloseError?.(sessionId, err);
    }
  };

  return {
    get size() {
      return sessions.size;
    },
    add(sessionId, transport) {
      sessions.set(sessionId, { transport, lastSeen: now(), inflight: 0, closed: false });
    },
    get(sessionId) {
      return sessions.get(sessionId)?.transport;
    },
    has(sessionId) {
      return sessions.has(sessionId);
    },
    touch(sessionId) {
      const entry = sessions.get(sessionId);
      if (entry) entry.lastSeen = now();
    },
    begin(sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) return;
      entry.inflight++;
      entry.lastSeen = now();
    },
    end(sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) return;
      entry.inflight = Math.max(0, entry.inflight - 1);
      entry.lastSeen = now();
    },
    forget(sessionId) {
      sessions.delete(sessionId);
    },
    close,
    async sweepIdle(idleMs) {
      const cutoff = now() - idleMs;
      const idle = [...sessions].filter(([, e]) => e.inflight === 0 && e.lastSeen < cutoff).map(([id]) => id);
      await Promise.all(idle.map(close));
      return idle.length;
    },
    async closeAll() {
      await Promise.all([...sessions.keys()].map(close));
    },
  };
}

/**
 * Track a request against a session until its response is done. Ends on the
 * first of `res` finish/close or the socket closing — Bun skips `res` "close"
 * on disconnect, and a GET stream's `handleRequest` returns before it ends.
 */
export function trackRequest(
  registry: SessionRegistry<ClosableTransport>,
  sessionId: string,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  registry.begin(sessionId);
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    res.off("finish", end);
    res.off("close", end);
    req.socket?.off("close", end);
    registry.end(sessionId);
  };
  res.once("finish", end);
  res.once("close", end);
  req.socket?.once("close", end);
}

export interface McpServerLike {
  connect(transport: Transport): Promise<void>;
}

/** Open an SSE MCP session on `res` and close it when the client goes away. */
export async function openSseSession(
  req: IncomingMessage,
  res: ServerResponse,
  registry: SessionRegistry<SSEServerTransport>,
  createServer: () => McpServerLike,
  onClosed?: (sessionId: string) => void,
): Promise<SSEServerTransport> {
  const transport = new SSEServerTransport("/message", res);
  const sessionId = transport.sessionId;
  registry.add(sessionId, transport);
  let closed = false;
  transport.onclose = () => {
    if (closed) return;
    closed = true;
    registry.forget(sessionId);
    onClosed?.(sessionId);
  };
  req.once("close", () => void registry.close(sessionId));
  await createServer().connect(transport);
  return transport;
}
