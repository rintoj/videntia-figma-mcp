import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { logger } from "../../../src/videntia_figma_mcp/utils/logger";

/**
 * A connection that drops mid-command is ambiguous: the peer may already have applied
 * the command. Resending is only safe for reads, or when the relay refused the command
 * before forwarding it ("You must join the channel first"). A write must never be
 * replayed — that is how a batch ends up applied twice (#150).
 */

type Listener = (...args: unknown[]) => void;
type Fault = "close" | "join-first" | "hold";

/** Faults to inject, consumed in order, per command name. */
let faults: Record<string, Fault[]> = {};

class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = 1;
  private listeners: Record<string, Listener[]> = {};

  constructor(public url?: string) {}

  on(event: string, fn: Listener) {
    (this.listeners[event] ||= []).push(fn);
    if (event === "open") queueMicrotask(() => fn());
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

  emit(event: string, ...args: unknown[]) {
    for (const fn of [...(this.listeners[event] ?? [])]) fn(...args);
  }

  send(raw: string) {
    const msg = JSON.parse(raw);
    queueMicrotask(() => {
      if (msg.type === "join") {
        this.emit(
          "message",
          JSON.stringify({ type: "system", channel: msg.channel, message: { id: msg.id, result: "joined" } }),
        );
        return;
      }
      const command: string = msg.message?.command;
      if (command === "get_file_key") {
        this.emit("message", JSON.stringify({ id: msg.id, message: { id: msg.id, result: { fileKey: "KEY-A" } } }));
        return;
      }
      sends.push(command);
      const fault = faults[command]?.shift();
      if (fault === "close") {
        this.readyState = 3;
        this.emit("close", 1006, Buffer.from("abnormal"));
        return;
      }
      if (fault === "hold") return; // in flight, never answered: only a close settles it
      if (fault === "join-first") {
        this.emit("message", JSON.stringify({ type: "error", message: "You must join the channel first" }));
        return;
      }
      this.emit("message", JSON.stringify({ id: msg.id, message: { id: msg.id, result: { ok: command } } }));
    });
  }
}

/** Every non-handshake command that reached the (fake) peer, in order. */
let sends: string[] = [];

mock.module("ws", () => ({ default: FakeSocket, WebSocket: FakeSocket }));

type WsModule = typeof import("../../../src/videntia_figma_mcp/utils/websocket");

const realFetch = globalThis.fetch;
const realWarn = logger.warn;
let instance = 0;

/** Connection state is module-level, so each test gets its own module instance. */
async function freshWebsocketModule(): Promise<WsModule> {
  instance += 1;
  return (await import(
    `../../../src/videntia_figma_mcp/utils/websocket.ts?real=1&retry=${instance}`
  )) as unknown as WsModule;
}

async function joinedFigma(): Promise<WsModule> {
  const ws = await freshWebsocketModule();
  await ws.joinChannel("chan-a");
  return ws;
}

beforeEach(() => {
  faults = {};
  sends = [];
  logger.warn = (() => true) as any;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => [
      {
        channel: "chan-a",
        clients: 2,
        pluginClients: 1,
        hasPlugin: true,
        extensionClients: 0,
        hasExtension: false,
        fileName: "File A",
        fileKey: "KEY-A",
        joinedAt: Date.now(),
      },
    ],
  })) as any;
});

afterEach(() => {
  logger.warn = realWarn;
  globalThis.fetch = realFetch;
});

describe("sendCommandToFigma retry policy", () => {
  it("resends a read once after a mid-flight drop", async () => {
    const ws = await joinedFigma();
    faults = { get_node_info: ["close"] };

    await expect(ws.sendCommandToFigma("get_node_info", { nodeId: "1:2" })).resolves.toEqual({ ok: "get_node_info" });
    expect(sends).toEqual(["get_node_info", "get_node_info"]);
  });

  it("never resends a write after a mid-flight drop", async () => {
    const ws = await joinedFigma();
    faults = { create_frame: ["close"] };

    await expect(ws.sendCommandToFigma("create_frame", {})).rejects.toThrow(
      /dropped during "create_frame"\. It may already have been applied/,
    );
    expect(sends).toEqual(["create_frame"]);
  });

  it("never resends batch_actions after a mid-flight drop", async () => {
    const ws = await joinedFigma();
    faults = { batch_actions: ["close"] };

    await expect(ws.sendCommandToFigma("batch_actions" as any, { actions: [] })).rejects.toThrow(
      /may already have been applied/,
    );
    expect(sends).toEqual(["batch_actions"]);
  });

  it("resends a write the relay refused before forwarding it", async () => {
    const ws = await joinedFigma();
    faults = { create_frame: ["join-first"] };

    await expect(ws.sendCommandToFigma("create_frame", {})).resolves.toEqual({ ok: "create_frame" });
    expect(sends).toEqual(["create_frame", "create_frame"]);
  });

  it("never resends lint_frame with fix:true, which writes", async () => {
    const ws = await joinedFigma();
    faults = { lint_frame: ["close"] };

    await expect(ws.sendCommandToFigma("lint_frame", { nodeId: "1:2", fix: true })).rejects.toThrow(
      /may already have been applied/,
    );
    expect(sends).toEqual(["lint_frame"]);
  });

  it("still resends a plain lint_frame read", async () => {
    const ws = await joinedFigma();
    faults = { lint_frame: ["close"] };

    await expect(ws.sendCommandToFigma("lint_frame", { nodeId: "1:2" })).resolves.toEqual({ ok: "lint_frame" });
    expect(sends).toEqual(["lint_frame", "lint_frame"]);
  });

  it("gives up after one retry when a read drops twice", async () => {
    const ws = await joinedFigma();
    faults = { get_node_info: ["close", "close"] };

    await expect(ws.sendCommandToFigma("get_node_info", {})).rejects.toThrow(/Connection closed/);
    expect(sends).toEqual(["get_node_info", "get_node_info"]);
  });

  it("reconnects on the next call after a write drop", async () => {
    const ws = await joinedFigma();
    faults = { create_frame: ["close"] };

    await expect(ws.sendCommandToFigma("create_frame", {})).rejects.toThrow(/may already have been applied/);
    await expect(ws.sendCommandToFigma("get_node_info", {})).resolves.toEqual({ ok: "get_node_info" });
    expect(sends).toEqual(["create_frame", "get_node_info"]);
  });
});

describe("concurrent commands on one dropped connection", () => {
  it("a write's drop does not tear down a concurrent read's reconnect", async () => {
    const ws = await joinedFigma();
    faults = { get_node_info: ["hold"], create_frame: ["close"] };

    // The read is pending first, so its catch reconnects first; the write's catch must
    // not then kill that fresh connection (and any command already sent on it).
    const read = ws.sendCommandToFigma("get_node_info", {});
    await new Promise((r) => setTimeout(r, 0));
    const write = ws.sendCommandToFigma("create_frame", {});

    await expect(write).rejects.toThrow(/may already have been applied/);
    await expect(read).resolves.toEqual({ ok: "get_node_info" });
    expect(sends).toEqual(["get_node_info", "create_frame", "get_node_info"]);
  });
});

describe("sendCommandToChannel (browser) retry policy", () => {
  it("resends a browser read once after a mid-flight drop", async () => {
    const ws = await freshWebsocketModule();
    faults = { read_console: ["close"] };

    await expect(ws.sendCommandToChannel("browser", "read_console", {})).resolves.toEqual({ ok: "read_console" });
    expect(sends).toEqual(["read_console", "read_console"]);
  });

  it("never resends read_console with clear:true, which empties the buffer", async () => {
    const ws = await freshWebsocketModule();
    faults = { read_console: ["close"] };

    await expect(ws.sendCommandToChannel("browser", "read_console", { clear: true })).rejects.toThrow(
      /Chrome extension dropped during browser command "read_console"/,
    );
    expect(sends).toEqual(["read_console"]);
  });

  it("never resends read_network with clear:true", async () => {
    const ws = await freshWebsocketModule();
    faults = { read_network: ["close"] };

    await expect(ws.sendCommandToChannel("browser", "read_network", { clear: true })).rejects.toThrow(
      /Chrome extension dropped during browser command "read_network"/,
    );
    expect(sends).toEqual(["read_network"]);
  });

  it("never resends a browser write after a mid-flight drop", async () => {
    const ws = await freshWebsocketModule();
    faults = { type_text: ["close"] };

    await expect(ws.sendCommandToChannel("browser", "type_text", { text: "hi" })).rejects.toThrow(
      /Chrome extension dropped during browser command "type_text"\. It may already have been applied/,
    );
    expect(sends).toEqual(["type_text"]);
  });
});
