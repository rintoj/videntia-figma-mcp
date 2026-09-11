import { describe, it, expect, mock, beforeEach } from "bun:test";

/**
 * Envelope-shape tests for browser-channel sends: the routing target must ride
 * at envelope level (sibling of `channel`) and must never leak into
 * `message.params`, and an untargeted send must be byte-identical to today's
 * (no `target` key at all) so Figma-plugin traffic is unaffected.
 */

type Listener = (data: unknown) => void;

class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = 1;
  sent: any[] = [];
  private listeners: Record<string, Listener[]> = {};

  constructor(public url?: string) {
    lastSocket = this;
  }

  on(event: string, fn: Listener) {
    (this.listeners[event] ||= []).push(fn);
    return this;
  }

  off(event: string, fn: Listener) {
    this.listeners[event] = (this.listeners[event] ?? []).filter((f) => f !== fn);
    return this;
  }

  removeAllListeners() {
    this.listeners = {};
  }

  ping() {}
  terminate() {}
  close() {}

  emit(event: string, data: unknown) {
    for (const fn of [...(this.listeners[event] ?? [])]) fn(data);
  }

  send(raw: string) {
    const msg = JSON.parse(raw);
    this.sent.push(msg);
    queueMicrotask(() => {
      if (msg.type === "join") {
        this.emit("message", JSON.stringify({ type: "system", channel: msg.channel, message: { result: true } }));
      } else {
        this.emit("message", JSON.stringify({ id: msg.id, message: { id: msg.id, result: { ok: true } } }));
      }
    });
  }
}

let lastSocket: FakeSocket | null = null;

mock.module("ws", () => ({ default: FakeSocket, WebSocket: FakeSocket }));

// The query string forces a fresh module instance: integration suites in the same
// `bun test` process register a global mock.module for this path, and that mock
// would otherwise replace the real transport under test.
const realWebsocketModule = "../../../src/videntia_figma_mcp/utils/websocket.ts?real=1";
const { sendCommandToChannel } = (await import(
  realWebsocketModule
)) as typeof import("../../../src/videntia_figma_mcp/utils/websocket");

function browserSends() {
  return (lastSocket?.sent ?? []).filter((m) => m.type === "message");
}

describe("browser command envelope", () => {
  beforeEach(() => {
    if (lastSocket) lastSocket.sent = [];
  });

  it("omits `target` entirely when no browserId is given", async () => {
    await sendCommandToChannel("browser", "click" as any, { selector: "#a", tabId: 7 });
    const envelope = browserSends().at(-1)!;
    expect("target" in envelope).toBe(false);
    expect(envelope.channel).toBe("browser");
    expect(envelope.message.params).toEqual({ selector: "#a", tabId: 7, commandId: envelope.id });
    expect(Object.keys(envelope).sort()).toEqual(["channel", "id", "message", "type"]);
  });

  it("emits `target` at envelope level when browserId is passed as an argument", async () => {
    await sendCommandToChannel("browser", "click" as any, { selector: "#a" }, 30000, "browser-abc");
    const envelope = browserSends().at(-1)!;
    expect(envelope.target).toBe("browser-abc");
    expect(envelope.channel).toBe("browser");
    expect(envelope.message.params.browserId).toBeUndefined();
    expect("browserId" in envelope.message.params).toBe(false);
  });

  it("lifts browserId out of params into the envelope target", async () => {
    await sendCommandToChannel("browser", "hover" as any, { selector: "#b", browserId: "browser-xyz" });
    const envelope = browserSends().at(-1)!;
    expect(envelope.target).toBe("browser-xyz");
    expect("browserId" in envelope.message.params).toBe(false);
    expect(envelope.message.params).toEqual({ selector: "#b", commandId: envelope.id });
  });

  it("keeps the envelope untargeted when browserId is undefined in params", async () => {
    await sendCommandToChannel("browser", "hover" as any, { selector: "#c", browserId: undefined });
    const envelope = browserSends().at(-1)!;
    expect("target" in envelope).toBe(false);
    expect("browserId" in envelope.message.params).toBe(false);
  });
});
