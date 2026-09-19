// Host-side system clipboard writes for the Figma plugin.
//
// Figma has no clipboard API, and a browser clipboard write inside the plugin
// iframe needs a trusted user gesture, which a menu command launched from a
// global shortcut never has. The socket server, however, runs as a normal node
// process on the host and can drive the OS clipboard directly, so the plugin
// relays the text here over the WebSocket it already trusts.

import { spawn } from "node:child_process";

/** Largest clipboard payload the relay accepts, in UTF-8 bytes. */
export const CLIPBOARD_TEXT_MAX_BYTES = 1_000_000;

/** Message the plugin sends to ask the host to write the system clipboard. */
export const CLIPBOARD_WRITE_TYPE = "system_clipboard_write";

/** Message the host sends back with the outcome of that write. */
export const CLIPBOARD_RESULT_TYPE = "system_clipboard_result";

export interface ClipboardCommand {
  command: string;
  args: string[];
}

export interface ClipboardRequest {
  id: string;
  text: string;
}

export type ClipboardRequestCheck = { ok: true; request: ClipboardRequest } | { ok: false; error: string };

export interface ClipboardWriteResult {
  success: boolean;
  error?: string;
}

/**
 * The clipboard binary for a platform, or null when the platform has none we
 * know how to drive. Wayland sessions expose wl-copy; X11 sessions use xclip.
 */
export function clipboardCommandFor(
  platform: string,
  env: Record<string, string | undefined> = {},
): ClipboardCommand | null {
  if (platform === "darwin") return { command: "pbcopy", args: [] };
  if (platform === "win32") return { command: "clip", args: [] };
  if (platform === "linux") {
    if (env["WAYLAND_DISPLAY"]) return { command: "wl-copy", args: [] };
    return { command: "xclip", args: ["-selection", "clipboard"] };
  }
  return null;
}

/**
 * Validate a clipboard frame off the wire. Everything here is caller supplied,
 * so the shape is checked before a byte reaches a child process.
 */
export function validateClipboardRequest(data: unknown): ClipboardRequestCheck {
  const frame = (data ?? {}) as Record<string, unknown>;
  const id = frame["id"];
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, error: "Clipboard request is missing an id" };
  }
  const text = frame["text"];
  if (typeof text !== "string") {
    return { ok: false, error: "Clipboard request is missing text" };
  }
  if (text.length === 0) {
    return { ok: false, error: "Clipboard text is empty" };
  }
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > CLIPBOARD_TEXT_MAX_BYTES) {
    return { ok: false, error: `Clipboard text is too large: ${bytes} bytes, max ${CLIPBOARD_TEXT_MAX_BYTES}` };
  }
  return { ok: true, request: { id: id, text: text } };
}

/**
 * Write text to the host clipboard. The text is piped to the binary's stdin and
 * is never interpolated into a shell command line.
 */
export function writeSystemClipboard(
  text: string,
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
): Promise<ClipboardWriteResult> {
  const clipboard = clipboardCommandFor(platform, env);
  if (!clipboard) {
    return Promise.resolve({ success: false, error: `No clipboard command is known for platform "${platform}"` });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ClipboardWriteResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    try {
      child = spawn(clipboard.command, clipboard.args, { stdio: ["pipe", "ignore", "pipe"] });
    } catch (err) {
      finish({ success: false, error: `Could not run ${clipboard.command}: ${describeError(err)}` });
      return;
    }

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      finish({ success: false, error: `Could not run ${clipboard.command}: ${describeError(err)}` });
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish({ success: true });
        return;
      }
      const detail = stderr.trim();
      finish({
        success: false,
        error: `${clipboard.command} exited with code ${code}${detail ? ": " + detail : ""}`,
      });
    });
    child.stdin?.on("error", (err) => {
      finish({ success: false, error: `Could not write to ${clipboard.command}: ${describeError(err)}` });
    });
    child.stdin?.end(text);
  });
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
