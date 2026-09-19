import {
  COPY_SELECTED_IDS_COMMAND,
  clipboardWriteMessage,
  isClipboardResultFor,
  lastChannelStorageKey,
  newRequestId,
  settingsStorageKey,
} from "../../../src/videntia_figma_plugin/copy-selected-ids";
import {
  DEFAULT_SOCKET_HOST,
  DEFAULT_SOCKET_PORT,
  socketUrlFrom,
} from "../../../src/videntia_figma_plugin/shared/socket-url";

describe("copy-selected-ids menu command", () => {
  it("uses the command string declared in the plugin manifest menu", () => {
    expect(COPY_SELECTED_IDS_COMMAND).toBe("copy-selected-ids");
  });

  it("scopes the stored channel to the file, so ids are never qualified with another file's channel", () => {
    expect(lastChannelStorageKey("HomeVault Design")).toBe("last-channel:HomeVault Design");
    expect(lastChannelStorageKey("HomeVault Design")).not.toBe(lastChannelStorageKey("Marketing Site"));
  });

  it("reads the same per-file settings key the panel writes", () => {
    expect(settingsStorageKey("HomeVault Design")).toBe("settings:HomeVault Design");
  });
});

describe("clipboard relay frames", () => {
  it("builds the frame the socket server validates", () => {
    expect(clipboardWriteMessage("req-1", '["1:2"]')).toEqual({
      type: "system_clipboard_write",
      id: "req-1",
      text: '["1:2"]',
    });
  });

  it("only accepts the clipboard result carrying this request id", () => {
    expect(isClipboardResultFor("req-1", { type: "system_clipboard_result", id: "req-1", success: true })).toBe(true);
    expect(isClipboardResultFor("req-1", { type: "system_clipboard_result", id: "req-2", success: true })).toBe(false);
    expect(isClipboardResultFor("req-1", { type: "system", message: "Please join a channel" })).toBe(false);
    expect(isClipboardResultFor("req-1", null)).toBe(false);
    expect(isClipboardResultFor("req-1", "system_clipboard_result")).toBe(false);
  });

  it("mints distinct request ids", () => {
    const ids = new Set([newRequestId(), newRequestId(), newRequestId()]);
    expect(ids.size).toBe(3);
  });
});

describe("socketUrlFrom", () => {
  it("falls back to the panel's localhost default", () => {
    expect(socketUrlFrom({})).toBe("ws://" + DEFAULT_SOCKET_HOST + ":" + DEFAULT_SOCKET_PORT);
    expect(socketUrlFrom({})).toBe("ws://localhost:3055");
  });

  it("honours a custom port on localhost", () => {
    expect(socketUrlFrom({ serverPort: 4000 })).toBe("ws://localhost:4000");
    expect(socketUrlFrom({ serverPort: 4000, serverUrl: "127.0.0.1" })).toBe("ws://localhost:4000");
  });

  it("keeps localhost on ws even when the secure preference is set", () => {
    expect(socketUrlFrom({ serverUrl: "localhost", serverSecure: true })).toBe("ws://localhost:3055");
  });

  it("uses the secure preference for a remote host and drops the port", () => {
    expect(socketUrlFrom({ serverUrl: "figma-mcp.videntia.dev", serverSecure: true })).toBe(
      "wss://figma-mcp.videntia.dev",
    );
    expect(socketUrlFrom({ serverUrl: "figma-mcp.videntia.dev" })).toBe("ws://figma-mcp.videntia.dev");
  });

  it("treats blank or invalid settings as unset", () => {
    expect(socketUrlFrom({ serverUrl: "   ", serverPort: 0 })).toBe("ws://localhost:3055");
    expect(socketUrlFrom({ serverUrl: null, serverPort: null, serverSecure: null })).toBe("ws://localhost:3055");
  });
});
