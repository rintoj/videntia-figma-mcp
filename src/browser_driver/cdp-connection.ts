export type CdpEventListener = (method: string, params: any, sessionId: string | undefined) => void;

export interface CdpTransport {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<any>;
  onEvent(listener: CdpEventListener): () => void;
  close(): void;
}

type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: any) => void): void;
};

/**
 * The `ws` package's client handshake fails under Bun ("Unexpected server response: 101"),
 * so the platform WebSocket is preferred and `ws` is only the fallback for older Node.
 * Bun's client also fails to inflate some of Chrome's compressed frames (close 1002
 * "Invalid compressed data"), so permessage-deflate is turned off there.
 */
export async function createWebSocket(url: string): Promise<WebSocketLike> {
  const Native = (globalThis as any).WebSocket;
  if (typeof Native === "function") {
    return "Bun" in globalThis ? new Native(url, { perMessageDeflate: false }) : new Native(url);
  }
  const { WebSocket } = await import("ws");
  return new WebSocket(url) as unknown as WebSocketLike;
}

export async function connectCdp(browserWsUrl: string, timeoutMs = 10000): Promise<CdpTransport> {
  const ws = await createWebSocket(browserWsUrl);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out connecting to CDP at ${browserWsUrl}`)), timeoutMs);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`Could not connect to CDP at ${browserWsUrl}`));
    });
  });

  let nextId = 1;
  let closed = false;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; method: string }>();
  const listeners = new Set<CdpEventListener>();

  ws.addEventListener("message", (event: any) => {
    let msg: any;
    try {
      msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
    } catch {
      return;
    }
    if (typeof msg.id === "number") {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(`${entry.method}: ${msg.error.message || JSON.stringify(msg.error)}`));
      else entry.resolve(msg.result ?? {});
      return;
    }
    if (typeof msg.method === "string") {
      for (const listener of listeners) {
        try {
          listener(msg.method, msg.params ?? {}, msg.sessionId);
        } catch (e) {
          console.error("[cdp] event listener failed:", e);
        }
      }
    }
  });

  ws.addEventListener("close", () => {
    closed = true;
    for (const entry of pending.values()) entry.reject(new Error(`${entry.method}: CDP connection closed`));
    pending.clear();
    for (const listener of listeners) listener("Driver.connectionClosed", {}, undefined);
  });

  return {
    send(method, params = {}, sessionId) {
      if (closed) return Promise.reject(new Error(`${method}: CDP connection closed`));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      try {
        ws.close();
      } catch {}
    },
  };
}
