// Headless "Copy Selected Node IDs" menu command.
//
// Figma has no API for a custom global keyboard shortcut. The native fast path
// is a manifest `menu` command, invoked once through Quick Actions and then
// repeated with "run last plugin again" (Option+Cmd+P on macOS, Ctrl+Alt+P on
// Windows). A menu command starts a FRESH sandbox with no socket and no UI, so
// the channel is read back from clientStorage and the clipboard write is done
// in a hidden iframe (the main thread has no DOM).

import { copiedIdsToast, formatCopiedIds } from "./shared/copy-ids";

export var COPY_SELECTED_IDS_COMMAND = "copy-selected-ids";

/** clientStorage key holding the channel the panel last joined, per file. */
export function lastChannelStorageKey(fileName: string): string {
  return "last-channel:" + fileName;
}

// execCommand("copy") wants a trusted user gesture within a few seconds. A
// Quick Actions launch has none, so the silent attempt may fail; when it does
// the plugin falls back to a visible pane where a real click completes it.
var SILENT_COPY_TIMEOUT_MS = 1500;

var SILENT_COPY_HTML =
  "<script>" +
  "onmessage = function (e) {" +
  "  var msg = e.data.pluginMessage;" +
  "  if (!msg || msg.type !== 'copy') return;" +
  "  var ok = false;" +
  "  try {" +
  "    var t = document.createElement('textarea');" +
  "    t.value = msg.text;" +
  "    document.body.appendChild(t);" +
  "    t.select();" +
  "    ok = document.execCommand('copy');" +
  "    document.body.removeChild(t);" +
  "  } catch (err) {" +
  "    ok = false;" +
  "  }" +
  "  parent.postMessage({ pluginMessage: { type: 'copy-result', ok: ok } }, '*');" +
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

function copyThroughUi(html: string, text: string, timeoutMs: number, uiOptions: ShowUIOptions): Promise<boolean> {
  return new Promise(function (resolve) {
    var settled = false;
    var timer: number | undefined;
    function finish(ok: boolean) {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(ok);
    }
    figma.ui.onmessage = function (msg: Record<string, unknown>) {
      if (msg && msg["type"] === "copy-result") finish(!!msg["ok"]);
    };
    figma.showUI(html, uiOptions);
    figma.ui.postMessage({ type: "copy", text: text });
    if (timeoutMs > 0) {
      timer = setTimeout(function () {
        finish(false);
      }, timeoutMs) as unknown as number;
    }
  });
}

export async function runCopySelectedIds(): Promise<void> {
  try {
    var selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.closePlugin("No nodes selected");
      return;
    }

    var ids = selection.map(function (node) {
      return node.id;
    });
    var storedChannel = (await figma.clientStorage.getAsync(lastChannelStorageKey(figma.root.name))) as
      | string
      | undefined;
    var text = formatCopiedIds(ids.length === 1 ? ids[0] : ids, storedChannel);

    var copied = await copyThroughUi(SILENT_COPY_HTML, text, SILENT_COPY_TIMEOUT_MS, { visible: false });
    if (copied) {
      figma.closePlugin(copiedIdsToast(ids.length));
      return;
    }

    // No gesture was available, so show a small pane where a real click can
    // complete the copy. No timeout here: the user drives it.
    var confirmed = await copyThroughUi(FALLBACK_COPY_HTML, text, 0, { visible: true, width: 320, height: 170 });
    figma.closePlugin(confirmed ? copiedIdsToast(ids.length) : "Copy cancelled");
  } catch (error) {
    var message = error instanceof Error ? error.message : String(error);
    figma.closePlugin("Copy failed: " + message);
  }
}
