// Figma MCP plugin.

import type { CommandProgressMessage, ProgressPayload } from "../types";

// Figma plugin sandbox exposes the Web Crypto API (not in lib.es2017 — declare minimally)
declare const crypto: { getRandomValues: <T extends ArrayBufferView>(array: T) => T };

// ---------------------------------------------------------------------------
// Debug logging
// ---------------------------------------------------------------------------

const DEBUG = false;

export function debugLog(...args: unknown[]): void {
  if (DEBUG) console.log(...args);
}

// ---------------------------------------------------------------------------
// Progress updates
// ---------------------------------------------------------------------------

export function sendProgressUpdate(
  commandId: string,
  commandType: string,
  status: string,
  progress: number,
  totalItems: number,
  processedItems: number,
  message: string,
  payload: ProgressPayload | null = null,
): CommandProgressMessage {
  const update: CommandProgressMessage = {
    type: "command_progress",
    commandId,
    commandType,
    status,
    progress,
    totalItems,
    processedItems,
    message,
    timestamp: Date.now(),
  };

  // Add optional chunk information if present
  if (payload !== null) {
    if (payload.currentChunk !== undefined && payload.totalChunks !== undefined) {
      update.currentChunk = payload.currentChunk;
      update.totalChunks = payload.totalChunks;
      update.chunkSize = payload.chunkSize;
    }
    update.payload = payload;
  }

  // Send to UI
  figma.ui.postMessage(update);
  debugLog(`Progress update: ${status} - ${progress}% - ${message}`);

  return update;
}

// ---------------------------------------------------------------------------
// Unique-by helper
// ---------------------------------------------------------------------------

export function uniqBy<T>(arr: T[], predicate: ((item: T) => unknown) | keyof T): T[] {
  const cb = typeof predicate === "function" ? predicate : (o: T) => o[predicate as keyof T];

  return [
    ...arr
      .reduce((map, item) => {
        const key = item === null || item === undefined ? item : (cb(item) as unknown);

        if (!map.has(key)) {
          map.set(key, item);
        }

        return map;
      }, new Map<unknown, T>())
      .values(),
  ];
}

// ---------------------------------------------------------------------------
// Delay (returns a promise that resolves after `ms` milliseconds)
// ---------------------------------------------------------------------------

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Command-ID generator
// ---------------------------------------------------------------------------

export function generateCommandId(): string {
  const buf = new Uint32Array(3);
  crypto.getRandomValues(buf);
  return "cmd_" + buf[0].toString(36) + buf[1].toString(36) + buf[2].toString(36);
}

// ---------------------------------------------------------------------------
// Safe numeric parser — avoids the `parseFloat(x) || fallback` pitfall where
// a legitimate value of `0` is falsy and gets replaced by the fallback.
// ---------------------------------------------------------------------------

export function parseNum(x: unknown, fallback: number): number {
  const v = parseFloat(x as string);
  return isNaN(v) ? fallback : v;
}

// ---------------------------------------------------------------------------
// Load every font used by a text node — required before writing layout-affecting
// text properties such as textAutoResize.
// ---------------------------------------------------------------------------

export async function loadTextNodeFonts(node: TextNode): Promise<void> {
  const length = node.characters.length;
  const fonts: FontName[] =
    length > 0
      ? node.getRangeAllFontNames(0, length)
      : node.fontName !== figma.mixed
        ? [node.fontName as FontName]
        : [];
  await Promise.all(fonts.map((font) => figma.loadFontAsync(font)));
}

// ---------------------------------------------------------------------------
// Font weight → Figma font style name mapping
// ---------------------------------------------------------------------------

export function getFontStyle(weight: number): string {
  switch (weight) {
    case 100:
      return "Thin";
    case 200:
      return "Extra Light";
    case 300:
      return "Light";
    case 400:
      return "Regular";
    case 500:
      return "Medium";
    case 600:
      return "Semi Bold";
    case 700:
      return "Bold";
    case 800:
      return "Extra Bold";
    case 900:
      return "Black";
    default:
      return "Regular";
  }
}

/**
 * Extracts a human-readable reason from an unknown thrown value.
 *
 * WHY: Figma's async APIs can reject with a plain object or a bare string, where
 * `(error as Error).message` is `undefined` — which then lands in the caller's
 * message literally (e.g. "Error setting font weight: undefined"), telling an
 * agent nothing it can act on. Always route thrown values through this.
 */
export function describeError(error: unknown): string {
  if (error === null || error === undefined) return "Unknown error";
  if (error instanceof Error) return error.message || String(error);
  if (typeof error === "string") return error.length > 0 ? error : "Unknown error";
  const maybe = error as { message?: unknown };
  if (typeof maybe.message === "string" && maybe.message.length > 0) return maybe.message;
  try {
    const json = JSON.stringify(error);
    return json !== undefined && json !== "{}" ? json : String(error);
  } catch (_e) {
    return String(error);
  }
}
