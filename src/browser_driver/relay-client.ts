import { createWebSocket } from "./cdp-connection.js";

export const BROWSER_CHANNEL = "browser";

export type RelayStatus = "connecting" | "connected" | "disconnected";

export interface RelayClientOptions {
  relayUrl: string;
  browserId: string;
  browserLabel: string;
  onCommand(command: string, params: Record<string, unknown>): Promise<unknown>;
  onStatus?(status: RelayStatus): void;
  /** Called once reconnecting has failed `maxAttempts` times in a row. */
  onGiveUp?(error: Error): void;
  maxAttempts?: number;
  backoffMs?: number[];
  connectTimeoutMs?: number;
}

export interface RelayClient {
  /** Connects and joins; rejects if the relay refuses the join or every attempt fails. */
  start(): Promise<void>;
  stop(): void;
  readonly status: RelayStatus;
}

export class JoinRefusedError extends Error {}

/** Close reason the relay sends when a newer socket joins with the same browserId. */
const REPLACED_REASON = "Replaced by new connection";
const DEFAULT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000, 30000];

/** Same envelope background.js `respond()` sends back to the relay. */
export function responseEnvelope(id: string, payload: { result?: unknown } | { error: string }) {
  return { id, type: "message", channel: BROWSER_CHANNEL, message: { id, ...payload } };
}

export function isJoinConfirmation(data: any): boolean {
  return data?.type === "system" && typeof data.message === "object" && data.message !== null && !!data.message.result;
}

export function extractCommand(data: any): { id: string; command: string; params: Record<string, unknown> } | null {
  if (data?.type !== "message" && data?.type !== "broadcast") return null;
  const msg = data.message;
  if (!msg || typeof msg.command !== "string" || msg.id === undefined) return null;
  return { id: msg.id, command: msg.command, params: msg.params ?? {} };
}

export function createRelayClient(options: RelayClientOptions): RelayClient {
  const maxAttempts = options.maxAttempts ?? 10;
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? 10000;
  let ws: Awaited<ReturnType<typeof createWebSocket>> | null = null;
  let status: RelayStatus = "disconnected";
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const setStatus = (s: RelayStatus) => {
    if (status === s) return;
    status = s;
    options.onStatus?.(s);
  };

  function send(payload: unknown) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
  }

  async function runCommand(id: string, command: string, params: Record<string, unknown>) {
    try {
      const result = await options.onCommand(command, params);
      send(responseEnvelope(id, { result }));
    } catch (e) {
      send(responseEnvelope(id, { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  /** Resolves once joined; afterwards `onClosed` fires when that connection drops. */
  async function connectOnce(onClosed: () => void): Promise<void> {
    const socket = await createWebSocket(options.relayUrl);
    ws = socket;
    return new Promise<void>((resolve, reject) => {
      let joined = false;
      let settled = false;
      const fail = (e: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {}
        reject(e);
      };
      const timer = setTimeout(
        () => fail(new Error(`Timed out joining relay at ${options.relayUrl}`)),
        connectTimeoutMs,
      );

      socket.addEventListener("open", () => {
        socket.send(
          JSON.stringify({
            type: "join",
            channel: BROWSER_CHANNEL,
            clientType: "driver",
            browserId: options.browserId,
            browserLabel: options.browserLabel,
          }),
        );
      });
      socket.addEventListener("message", (event: any) => {
        let data: any;
        try {
          data = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
        } catch {
          return;
        }
        if (!joined) {
          if (data?.type === "error") {
            fail(new JoinRefusedError(`Relay refused the join: ${data.message}`));
            return;
          }
          if (isJoinConfirmation(data)) {
            joined = true;
            settled = true;
            clearTimeout(timer);
            resolve();
          }
          return;
        }
        const cmd = extractCommand(data);
        if (cmd) void runCommand(cmd.id, cmd.command, cmd.params);
      });
      socket.addEventListener("error", () => {
        if (!joined) fail(new Error(`Could not connect to relay at ${options.relayUrl}`));
      });
      socket.addEventListener("close", (event: any) => {
        const wasCurrent = ws === socket;
        if (wasCurrent) ws = null;
        if (!joined) {
          fail(new Error(`Relay at ${options.relayUrl} closed the connection before the join completed`));
          return;
        }
        // A superseded socket (we already reconnected on a newer one) must not start a second reconnect loop.
        if (!wasCurrent || stopped) return;
        // The relay evicts an older socket when another process joins with the same browserId. Reconnecting
        // would evict that process in turn and the two drivers would flip-flop, mis-routing commands.
        if (event?.reason === REPLACED_REASON) {
          stopped = true;
          setStatus("disconnected");
          options.onGiveUp?.(new Error(`Another driver joined the relay as "${options.browserId}"`));
          return;
        }
        onClosed();
      });
    });
  }

  async function connectWithRetry(): Promise<void> {
    let lastError: Error = new Error("not attempted");
    for (let attempt = 0; attempt < maxAttempts && !stopped; attempt++) {
      if (attempt > 0) {
        const delay = backoff[Math.min(attempt - 1, backoff.length - 1)]!;
        await new Promise<void>((r) => {
          reconnectTimer = setTimeout(r, delay);
        });
        if (stopped) break;
      }
      setStatus("connecting");
      try {
        await connectOnce(onConnectionLost);
        setStatus("connected");
        return;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (lastError instanceof JoinRefusedError) throw lastError;
        console.error(`[relay] attempt ${attempt + 1}/${maxAttempts} failed: ${lastError.message}`);
      }
    }
    setStatus("disconnected");
    throw stopped ? new Error("Relay client stopped") : lastError;
  }

  function onConnectionLost() {
    if (stopped) return;
    setStatus("connecting");
    console.error("[relay] connection lost, reconnecting");
    connectWithRetry().catch((e) => {
      if (!stopped) options.onGiveUp?.(e);
    });
  }

  return {
    start: () => connectWithRetry(),
    stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const socket = ws;
      ws = null;
      try {
        socket?.close();
      } catch {}
      setStatus("disconnected");
    },
    get status() {
      return status;
    },
  };
}
