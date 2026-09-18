import * as fs from "fs";

/**
 * In-process, per-session cache for `export_node_as_image` renders.
 *
 * Measured motivation: in one production session 61% of ALL MCP result tokens
 * were re-exports of a node that had not changed since the previous export at
 * the same scale.
 *
 * Correctness rule: a stale hit is far worse than a miss. The key includes a
 * plugin-computed subtree version hash; when that hash is absent (the plugin
 * could not compute one) the entry is neither read nor written.
 */

export interface ExportCacheKeyInput {
  nodeId: string;
  scale: number;
  format: string;
  /** Plugin-computed subtree version hash. Missing/null ⇒ never cache. */
  subtreeHash?: string | null;
  region?: { x: number; y: number; width: number; height: number };
  maxWidth?: number;
  maxHeight?: number;
  jpegQuality?: number;
  allowFullResolution?: boolean;
  inline: boolean;
  /** Resolved destination path — a render aimed at a different file is a miss. */
  destination?: string | null;
}

export interface ExportCacheEntry {
  /** Absolute path of the written file, when the render went to disk. */
  path?: string;
  /** Base64 payload, only retained for inline renders. */
  base64?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  bytes: number;
  format: string;
  /** Rough token cost of the original result, for "tokens saved" reporting. */
  approxTokens: number;
}

const cache = new Map<string, ExportCacheEntry>();

/** Returns null when the render is not cacheable (no subtree hash). */
export function exportCacheKey(input: ExportCacheKeyInput): string | null {
  if (!input.subtreeHash) return null;
  return JSON.stringify([
    input.nodeId,
    input.scale,
    input.format.toUpperCase(),
    input.subtreeHash,
    input.region ? [input.region.x, input.region.y, input.region.width, input.region.height] : null,
    input.maxWidth ?? null,
    input.maxHeight ?? null,
    input.jpegQuality ?? null,
    input.allowFullResolution === true,
    input.inline,
    input.destination ?? null,
  ]);
}

/**
 * Approximate the token cost of an inline image result. Claude bills images at
 * roughly (width x height) / 750 tokens; metadata-only results are negligible.
 */
export function approximateImageTokens(width?: number, height?: number): number {
  if (!width || !height) return 0;
  return Math.round((width * height) / 750);
}

export function getCachedExport(key: string | null): ExportCacheEntry | undefined {
  if (!key) return undefined;
  const entry = cache.get(key);
  if (!entry) return undefined;
  // A path entry is only valid while the file is still there.
  if (entry.path) {
    if (!fs.existsSync(entry.path)) {
      cache.delete(key);
      return undefined;
    }
  } else if (!entry.base64) {
    cache.delete(key);
    return undefined;
  }
  return entry;
}

export function setCachedExport(key: string | null, entry: ExportCacheEntry): void {
  if (!key) return;
  cache.set(key, entry);
}

/** Test helper — drops every cached render. */
export function clearExportCache(): void {
  cache.clear();
}
