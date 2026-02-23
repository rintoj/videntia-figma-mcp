// General-purpose helper utilities for the Claude Figma MCP plugin.

import type { CommandProgressMessage, ProgressPayload } from '../types';

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
    type: 'command_progress',
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
    if (
      payload.currentChunk !== undefined &&
      payload.totalChunks !== undefined
    ) {
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

export function uniqBy<T>(
  arr: T[],
  predicate: ((item: T) => unknown) | keyof T,
): T[] {
  const cb =
    typeof predicate === 'function'
      ? predicate
      : (o: T) => o[predicate as keyof T];

  return [
    ...arr
      .reduce((map, item) => {
        const key =
          item === null || item === undefined ? item : (cb(item) as unknown);

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
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Command-ID generator
// ---------------------------------------------------------------------------

export function generateCommandId(): string {
  return (
    'cmd_' +
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

// ---------------------------------------------------------------------------
// Font weight → Figma font style name mapping
// ---------------------------------------------------------------------------

export function getFontStyle(weight: number): string {
  switch (weight) {
    case 100: return 'Thin';
    case 200: return 'Extra Light';
    case 300: return 'Light';
    case 400: return 'Regular';
    case 500: return 'Medium';
    case 600: return 'Semi Bold';
    case 700: return 'Bold';
    case 800: return 'Extra Bold';
    case 900: return 'Black';
    default: return 'Regular';
  }
}
