import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { logger } from "../../../src/videntia_figma_mcp/utils/logger";
import { runWithChannel } from "../../../src/videntia_figma_mcp/utils/channel-context";

/**
 * A channel advertises which Figma file it belongs to; the plugin that actually
 * answers on it reports its own identity. When those two disagree, every command
 * lands in the WRONG document — node ids are unique only within a file, so nothing
 * errors and the damage is silent. These tests pin the verified-join contract:
 * mismatch => no join at all, indeterminate => join but stay loud, failure of the
 * identity round trip => join unpinned (historical behaviour).
 */

type Listener = (data: unknown) => void;

type FileKeyBehaviour =
  | { kind: "identity"; value: { fileKey?: string | null; rootId?: string | null; fileName?: string | null } }
  | { kind: "error"; message: string };

let fileKeyBehaviour: FileKeyBehaviour = { kind: "identity", value: { fileKey: "KEY-A", fileName: "File A" } };
/** Per-channel identities, for the multi-channel routing tests. Wins over `fileKeyBehaviour`. */
let identityByChannel: Record<string, { fileKey?: string | null; rootId?: string | null; fileName?: string | null }> =
  {};

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
    allSockets.push(this);
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
        this.emit(
          "message",
          JSON.stringify({
            type: "system",
            channel: msg.channel,
            message: { id: msg.id, result: `Connected to channel: ${msg.channel}` },
          }),
        );
        return;
      }
      const command = msg.message?.command;
      if (command === "get_file_key") {
        const perChannel = identityByChannel[msg.channel];
        if (perChannel) {
          this.emit("message", JSON.stringify({ id: msg.id, message: { id: msg.id, result: perChannel } }));
          return;
        }
        if (fileKeyBehaviour.kind === "error") {
          this.emit(
            "message",
            JSON.stringify({ id: msg.id, message: { id: msg.id, error: fileKeyBehaviour.message } }),
          );
        } else {
          this.emit("message", JSON.stringify({ id: msg.id, message: { id: msg.id, result: fileKeyBehaviour.value } }));
        }
        return;
      }
      this.emit("message", JSON.stringify({ id: msg.id, message: { id: msg.id, result: { ok: true } } }));
    });
  }
}

let lastSocket: FakeSocket | null = null;
const allSockets: FakeSocket[] = [];

mock.module("ws", () => ({ default: FakeSocket, WebSocket: FakeSocket }));

type WsModule = typeof import("../../../src/videntia_figma_mcp/utils/websocket");

let advertisedChannels: any[] = [];
const realFetch = globalThis.fetch;
let instance = 0;

/**
 * Module-level connection/channel state is a singleton, so every test gets its own
 * copy of the module (a unique query string defeats the import cache). The `?real`
 * marker also keeps integration suites' global mock of this path from replacing the
 * transport under test.
 */
async function freshWebsocketModule(): Promise<WsModule> {
  instance += 1;
  return (await import(
    `../../../src/videntia_figma_mcp/utils/websocket.ts?real=1&identity=${instance}`
  )) as unknown as WsModule;
}

function advertise(entries: Array<{ channel: string; fileName?: string | null; fileKey?: string | null }>) {
  advertisedChannels = entries.map((e) => ({
    channel: e.channel,
    clients: 2,
    pluginClients: 1,
    hasPlugin: true,
    extensionClients: 0,
    hasExtension: false,
    fileName: e.fileName ?? null,
    fileKey: e.fileKey ?? null,
    joinedAt: Date.now(),
  }));
}

let warnings: string[] = [];
const realWarn = logger.warn;

beforeEach(() => {
  identityByChannel = {};
  allSockets.length = 0;
  warnings = [];
  logger.warn = (m: string) => {
    warnings.push(m);
    return true;
  };
  globalThis.fetch = (async () => ({ ok: true, json: async () => advertisedChannels })) as any;
});

afterEach(() => {
  logger.warn = realWarn;
  globalThis.fetch = realFetch;
});

describe("join-time document identity verification", () => {
  it("joins and pins the file when the advertised fileKey matches the responding plugin", async () => {
    advertise([{ channel: "chan-a", fileName: "File A", fileKey: "KEY-A" }]);
    fileKeyBehaviour = { kind: "identity", value: { fileKey: "KEY-A", rootId: "0:0", fileName: "File A" } };

    const ws = await freshWebsocketModule();
    await ws.joinChannel("chan-a");

    expect(ws.getCurrentChannel()).toBe("chan-a");
    expect(ws.getExpectedFile()).toEqual({ fileKey: "KEY-A", rootId: "0:0", fileName: "File A" });
    expect(ws.getChannelVerification().state).toBe("verified");
  });

  it("refuses the join when the advertised fileKey differs from the responder's", async () => {
    advertise([{ channel: "claudefigmam", fileName: "Claude Figma MCP", fileKey: "KEY-CLAUDE" }]);
    fileKeyBehaviour = { kind: "identity", value: { fileKey: "KEY-HARNESS", rootId: "0:1", fileName: "Harnesshub" } };

    const ws = await freshWebsocketModule();
    await expect(ws.joinChannel("claudefigmam")).rejects.toThrow(/was NOT\s+joined|was NOT joined/);

    expect(ws.getCurrentChannel()).toBeNull();
    expect(ws.getExpectedFile()).toBeNull();
    expect(ws.getChannelVerification().state).toBe("failed");
  });

  it("names both files in the mismatch error", async () => {
    advertise([{ channel: "claudefigmam", fileName: "Claude Figma MCP", fileKey: "KEY-CLAUDE" }]);
    fileKeyBehaviour = { kind: "identity", value: { fileKey: "KEY-HARNESS", fileName: "Harnesshub" } };

    const ws = await freshWebsocketModule();
    const error = await ws.joinChannel("claudefigmam").then(
      () => null,
      (e) => e as Error,
    );

    expect(error).not.toBeNull();
    expect(error!.name).toBe("ChannelIdentityMismatchError");
    expect(error!.message).toContain('Channel "claudefigmam" is registered to "Claude Figma MCP"');
    expect(error!.message).toContain('the plugin answering on it is attached to "Harnesshub"');
    expect(error!.message).toContain("Node IDs are not unique across files");
  });

  it("refuses the join when fileNames differ and neither side has a fileKey", async () => {
    advertise([{ channel: "chan-b", fileName: "Design System" }]);
    fileKeyBehaviour = { kind: "identity", value: { fileName: "Marketing Site" } };

    const ws = await freshWebsocketModule();
    await expect(ws.joinChannel("chan-b")).rejects.toThrow(/Marketing Site/);
    expect(ws.getCurrentChannel()).toBeNull();
  });

  it("joins with a warning when neither side reports a discriminator", async () => {
    advertise([{ channel: "chan-c" }]);
    fileKeyBehaviour = { kind: "identity", value: { rootId: "0:0" } };

    const ws = await freshWebsocketModule();
    await ws.joinChannel("chan-c");

    expect(ws.getCurrentChannel()).toBe("chan-c");
    expect(ws.getChannelVerification().state).toBe("unverified");
    expect(warnings.some((w) => w.includes("Could not verify that channel"))).toBe(true);
  });

  it("joins unpinned when the get_file_key round trip fails", async () => {
    advertise([{ channel: "chan-d", fileName: "File D", fileKey: "KEY-D" }]);
    fileKeyBehaviour = { kind: "error", message: "Request to Figma timed out" };

    const ws = await freshWebsocketModule();
    await ws.joinChannel("chan-d");

    expect(ws.getCurrentChannel()).toBe("chan-d");
    expect(ws.getExpectedFile()).toBeNull();
    expect(ws.getChannelVerification().state).toBe("unverified");

    fileKeyBehaviour = { kind: "identity", value: { fileKey: "KEY-D", fileName: "File D" } };
    await ws.sendCommandToFigma("get_document_info" as any, {});
    const sentCommand = (lastSocket?.sent ?? []).filter((m) => m.message?.command === "get_document_info").at(-1)!;
    expect("__expectedFile" in sentCommand.message.params).toBe(false);
  });

  it("pins every subsequent command to the verified file", async () => {
    advertise([{ channel: "chan-e", fileName: "File E", fileKey: "KEY-E" }]);
    fileKeyBehaviour = { kind: "identity", value: { fileKey: "KEY-E", rootId: "0:0", fileName: "File E" } };

    const ws = await freshWebsocketModule();
    await ws.joinChannel("chan-e");
    await ws.sendCommandToFigma("get_document_info" as any, {});

    const sentCommand = (lastSocket?.sent ?? []).filter((m) => m.message?.command === "get_document_info").at(-1)!;
    expect(sentCommand.message.params.__expectedFile).toEqual({ fileKey: "KEY-E", rootId: "0:0", fileName: "File E" });
  });

  it("keeps the Figma channel intact across a browser command (no shared socket to evict)", async () => {
    advertise([{ channel: "chan-f", fileName: "File F", fileKey: "KEY-F" }]);
    identityByChannel = { "chan-f": { fileKey: "KEY-F", rootId: "0:0", fileName: "File F" } };

    const ws = await freshWebsocketModule();
    await ws.joinChannel("chan-f");
    expect(ws.getChannelVerification().state).toBe("verified");

    // Each channel owns its own socket now, so a browser command cannot evict the
    // Figma channel the way the old single shared socket did.
    await ws.sendCommandToChannel("browser", "browser_list_tabs" as any, {});
    expect(ws.getCurrentChannel()).toBe("chan-f");

    await ws.sendCommandToFigma("get_document_info" as any, {});
    const sent = (lastSocket?.sent ?? []).concat();
    expect(ws.getCurrentChannel()).toBe("chan-f");
    expect(sent.length).toBeGreaterThan(0);
  });

  it("refuses an unaddressed command while two channels are joined, and honours an addressed one", async () => {
    advertise([
      { channel: "chan-one", fileName: "File One", fileKey: "KEY-ONE" },
      { channel: "chan-two", fileName: "File Two", fileKey: "KEY-TWO" },
    ]);
    identityByChannel = {
      "chan-one": { fileKey: "KEY-ONE", rootId: "0:1", fileName: "File One" },
      "chan-two": { fileKey: "KEY-TWO", rootId: "0:2", fileName: "File Two" },
    };

    const ws = await freshWebsocketModule();
    await ws.joinChannel("chan-one");
    await ws.joinChannel("chan-two");
    expect(ws.getJoinedChannels().sort()).toEqual(["chan-one", "chan-two"]);

    // No channel on the request and two to choose from: refuse rather than guess.
    await expect(ws.sendCommandToFigma("get_document_info" as any, {})).rejects.toThrow(/Ambiguous Figma channel/);

    // Addressed explicitly, it goes to that channel — and carries that channel's file
    // identity, not the other one's.
    await runWithChannel("chan-one", undefined, () => ws.sendCommandToFigma("get_document_info" as any, {}));
    const sockets = allSockets.filter((sock) => sock.sent.some((m: any) => m.message?.command === "get_document_info"));
    expect(sockets.length).toBe(1);
    const envelope = sockets[0].sent.filter((m: any) => m.message?.command === "get_document_info").at(-1)!;
    expect(envelope.channel).toBe("chan-one");
    expect(envelope.message.params.__expectedChannel).toBe("chan-one");
    expect(envelope.message.params.__expectedFile.fileKey).toBe("KEY-ONE");
  });

  it("keeps each MCP session on its own channel when two sessions join different files", async () => {
    // The socket server hosts every Claude session in ONE process, so this is the case
    // that used to deliver session A's commands into session B's Figma file.
    advertise([
      { channel: "chan-a1", fileName: "File A1", fileKey: "KEY-A1" },
      { channel: "chan-b1", fileName: "File B1", fileKey: "KEY-B1" },
    ]);
    identityByChannel = {
      "chan-a1": { fileKey: "KEY-A1", rootId: "0:1", fileName: "File A1" },
      "chan-b1": { fileKey: "KEY-B1", rootId: "0:2", fileName: "File B1" },
    };

    const ws = await freshWebsocketModule();
    await runWithChannel(undefined, "session-a", () => ws.joinChannel("chan-a1"));
    await runWithChannel(undefined, "session-b", () => ws.joinChannel("chan-b1"));

    // Neither command names a channel; each still goes to its OWN session's channel.
    await runWithChannel(undefined, "session-a", () => ws.sendCommandToFigma("get_document_info" as any, {}));
    await runWithChannel(undefined, "session-b", () => ws.sendCommandToFigma("get_document_info" as any, {}));

    const envelopes = allSockets
      .flatMap((sock) => sock.sent)
      .filter((m: any) => m.message?.command === "get_document_info");
    expect(envelopes.map((e: any) => e.channel)).toEqual(["chan-a1", "chan-b1"]);
    expect(envelopes.map((e: any) => e.message.params.__expectedFile.fileKey)).toEqual(["KEY-A1", "KEY-B1"]);
  });

  it("refuses later commands outright once verification has failed", async () => {
    advertise([{ channel: "chan-g", fileName: "File G", fileKey: "KEY-G" }]);
    fileKeyBehaviour = { kind: "identity", value: { fileKey: "KEY-WRONG", fileName: "Wrong File" } };

    const ws = await freshWebsocketModule();
    await expect(ws.joinChannel("chan-g")).rejects.toThrow();

    // No lastChannelName survives a failed join, so nothing silently re-joins either.
    await expect(ws.sendCommandToFigma("get_document_info" as any, {})).rejects.toThrow(/Wrong File|No active Figma/);
  });
});
