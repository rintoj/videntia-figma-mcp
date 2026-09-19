// The "Copy Selected Node IDs" menu command.
//
// Figma has no API for a custom global keyboard shortcut. The native fast path
// is a manifest `menu` command, invoked once through Quick Actions and then
// repeated with "run last plugin again" (Option+Cmd+P on macOS, Ctrl+Alt+P on
// Windows). A menu command starts a FRESH sandbox with no socket and no UI, so
// the channel is read back from clientStorage.
//
// Figma has no clipboard API either, and a browser clipboard write inside the
// plugin iframe needs a trusted user gesture, which a menu launch does not
// have. So the clipboard is written on the HOST instead: the text is relayed to
// the local socket server, which pipes it to pbcopy / clip / xclip. The main
// thread has no WebSocket, so a hidden, never-visible iframe is used purely as
// the network transport. Nothing is shown and no gesture is needed.
//
// The copy NEVER closes the plugin. Every outcome is reported with a native
// figma.notify toast and the caller then boots the normal panel, which
// re-establishes the MCP WebSocket channel the run restarted.

import { copiedIdsToast, formatCopiedIds } from "./shared/copy-ids";
import { socketUrlFrom, type SocketSettings } from "./shared/socket-url";

export var COPY_SELECTED_IDS_COMMAND = "copy-selected-ids";

/** clientStorage key holding the channel the panel last joined, per file. */
export function lastChannelStorageKey(fileName: string): string {
  return "last-channel:" + fileName;
}

/** clientStorage key holding the panel's saved preferences, per file. */
export function settingsStorageKey(fileName: string): string {
  return "settings:" + fileName;
}

// Long enough for a connect plus a round trip on loopback, short enough that a
// dead server drops through to the manual pane without feeling stuck.
var SOCKET_COPY_TIMEOUT_MS = 2000;

var SOCKET_COPY_HTML =
  "<script>" +
  "onmessage = function (e) {" +
  "  var msg = e.data.pluginMessage;" +
  "  if (!msg || msg.type !== 'socket-copy') return;" +
  "  var ws = null;" +
  "  var done = false;" +
  "  function finish(ok, error) {" +
  "    if (done) return;" +
  "    done = true;" +
  "    try { if (ws) ws.close(); } catch (err) {}" +
  "    parent.postMessage({ pluginMessage: { type: 'socket-copy-result', ok: ok, error: error || '' } }, '*');" +
  "  }" +
  "  try {" +
  "    ws = new WebSocket(msg.url);" +
  "  } catch (err) {" +
  "    finish(false, String(err));" +
  "    return;" +
  "  }" +
  "  ws.onopen = function () {" +
  "    ws.send(JSON.stringify({ type: 'system_clipboard_write', id: msg.id, text: msg.text }));" +
  "  };" +
  "  ws.onmessage = function (event) {" +
  "    var data = null;" +
  "    try { data = JSON.parse(event.data); } catch (err) { return; }" +
  "    if (!data || data.type !== 'system_clipboard_result' || data.id !== msg.id) return;" +
  "    finish(!!data.success, data.error);" +
  "  };" +
  "  ws.onerror = function () { finish(false, 'The socket server is not reachable'); };" +
  "  ws.onclose = function () { finish(false, 'The socket server closed before confirming the copy'); };" +
  "};" +
  "</script>";

var FALLBACK_COPY_HTML =
  "<style>" +
  "body{margin:0;padding:12px;font:11px/16px Inter,sans-serif;color:#333;}" +
  "textarea{width:100%;box-sizing:border-box;height:64px;font:11px/16px monospace;resize:none;}" +
  "button{margin-top:8px;padding:6px 12px;font:11px/16px Inter,sans-serif;cursor:pointer;}" +
  "p{margin:0 0 6px;}" +
  "</style>" +
  "<p>Press Copy to put the node IDs on your clipboard.</p>" +
  "<textarea id='out' readonly></textarea>" +
  "<button id='go'>Copy</button>" +
  "<script>" +
  "var out = document.getElementById('out');" +
  "var text = '';" +
  "onmessage = function (e) {" +
  "  var msg = e.data.pluginMessage;" +
  "  if (!msg || msg.type !== 'copy') return;" +
  "  text = msg.text;" +
  "  out.value = text;" +
  "  out.focus();" +
  "  out.select();" +
  "};" +
  "document.getElementById('go').onclick = function () {" +
  "  var ok = false;" +
  "  try {" +
  "    out.focus();" +
  "    out.select();" +
  "    ok = document.execCommand('copy');" +
  "  } catch (err) {" +
  "    ok = false;" +
  "  }" +
  "  parent.postMessage({ pluginMessage: { type: 'copy-result', ok: ok } }, '*');" +
  "};" +
  "</script>";

/** The frame the hidden iframe relays to the socket server. */
export interface ClipboardWriteMessage {
  type: "system_clipboard_write";
  id: string;
  text: string;
}

export function clipboardWriteMessage(id: string, text: string): ClipboardWriteMessage {
  return { type: "system_clipboard_write", id: id, text: text };
}

/** A reply is only ours when it is the clipboard result for this request id. */
export function isClipboardResultFor(id: string, data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  var frame = data as Record<string, unknown>;
  return frame["type"] === "system_clipboard_result" && frame["id"] === id;
}

export function newRequestId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * Resolve the relay URL exactly the way the panel does, from the same saved
 * preferences, falling back to the same localhost default.
 */
export async function resolveSocketUrl(fileName: string): Promise<string> {
  var saved = (await figma.clientStorage.getAsync(settingsStorageKey(fileName))) as Record<string, unknown> | undefined;
  var settings: SocketSettings = {};
  if (saved) {
    if (typeof saved["serverPort"] === "number") settings.serverPort = saved["serverPort"] as number;
    if (typeof saved["serverUrl"] === "string") settings.serverUrl = saved["serverUrl"] as string;
    if (typeof saved["serverSecure"] === "boolean") settings.serverSecure = saved["serverSecure"] as boolean;
  }
  return socketUrlFrom(settings);
}

function runThroughUi(
  html: string,
  request: Record<string, unknown>,
  resultType: string,
  timeoutMs: number,
  uiOptions: ShowUIOptions,
): Promise<Record<string, unknown> | null> {
  return new Promise(function (resolve) {
    var settled = false;
    var timer: number | undefined;
    function finish(result: Record<string, unknown> | null) {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      // Drop the handler as soon as the step settles so nothing from this
      // throwaway iframe is still listening when the panel takes the UI over.
      figma.ui.onmessage = undefined;
      resolve(result);
    }
    figma.ui.onmessage = function (msg: Record<string, unknown>) {
      if (msg && msg["type"] === resultType) finish(msg);
    };
    figma.showUI(html, uiOptions);
    figma.ui.postMessage(request);
    if (timeoutMs > 0) {
      timer = setTimeout(function () {
        finish(null);
      }, timeoutMs) as unknown as number;
    }
  });
}

/**
 * Copy the selected node ids to the clipboard and report the outcome with a
 * toast. Always resolves; the caller boots the panel afterwards either way.
 */
export async function runCopySelectedIds(): Promise<void> {
  try {
    var selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.notify("No nodes selected", { error: true });
      return;
    }

    var ids = selection.map(function (node) {
      return node.id;
    });
    var fileName = figma.root.name;
    var storedChannel = (await figma.clientStorage.getAsync(lastChannelStorageKey(fileName))) as string | undefined;
    var text = formatCopiedIds(ids.length === 1 ? ids[0] : ids, storedChannel);

    // Primary path: the host writes the clipboard, so no user gesture and no
    // visible pane are needed.
    var url = await resolveSocketUrl(fileName);
    var requestId = newRequestId();
    var relayed = await runThroughUi(
      SOCKET_COPY_HTML,
      { type: "socket-copy", id: requestId, url: url, text: text },
      "socket-copy-result",
      SOCKET_COPY_TIMEOUT_MS,
      { visible: false },
    );
    if (relayed && relayed["ok"]) {
      figma.notify(copiedIdsToast(ids.length));
      return;
    }

    // The server is down, unreachable or has no clipboard binary. Show a small
    // pane where a real click can complete the copy. No timeout here: the user
    // drives it.
    var confirmed = await runThroughUi(FALLBACK_COPY_HTML, { type: "copy", text: text }, "copy-result", 0, {
      visible: true,
      width: 320,
      height: 170,
    });
    figma.notify(confirmed && confirmed["ok"] ? copiedIdsToast(ids.length) : "Copy cancelled");
  } catch (error) {
    var message = error instanceof Error ? error.message : String(error);
    figma.notify("Copy failed: " + message, { error: true });
  }
}
