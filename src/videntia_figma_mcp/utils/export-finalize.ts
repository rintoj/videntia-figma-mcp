/**
 * Server-side half of `export_node_as_image`: everything that happens AFTER the plugin
 * hands back its base64 render — destination resolution, the session render cache,
 * crop/downscale/re-encode and the file write.
 *
 * Shared by the standalone tool and `batch_actions` (which only captures the plugin
 * command, so without this the batch reported OK while writing no file).
 */

import { postProcessExport, writeExportToPath, resolveExportDestination } from "./export-image-post.js";
import { exportCacheKey, getCachedExport, setCachedExport, approximateImageTokens } from "./export-cache.js";

export const VIDEO_EXPORT_FORMATS = new Set(["MP4", "GIF", "WEBM"]);

export interface NodeExportOptions {
  nodeId: string;
  format?: string;
  scale?: number;
  save_to_path?: string;
  output_directory?: string;
  filename?: string;
  max_width?: number;
  max_height?: number;
  allow_full_resolution?: boolean;
  region?: { x: number; y: number; width: number; height: number };
  jpeg_quality?: number;
  inline?: boolean;
  force_refresh?: boolean;
}

export type NodeExportOutcome =
  /** Written to (or served from) a file; `payload` is the JSON digest the tool returns. */
  | { kind: "file"; payload: Record<string, unknown> }
  | { kind: "inline-image"; text: string; data: string; mimeType: string }
  | { kind: "inline-video"; text: string; uri: string; mimeType: string; blob: string };

interface PluginImageExport {
  nodeId?: string;
  imageData: string;
  mimeType: string;
  requestedScale: number;
  actualScale: number;
  originalWidth: number;
  originalHeight: number;
  exportedWidth: number;
  exportedHeight: number;
  subtreeHash?: string | null;
  name?: string;
}

interface PluginVideoExport {
  nodeId?: string;
  videoData: string;
  mimeType: string;
  format: string;
  byteLength: number;
  name?: string;
}

/** Write an `export_image_fill` plugin result to `exportPath`. */
export async function writeImageFillExport(
  exportPath: string,
  pluginResult: unknown,
): Promise<{ path: string; bytes: number; width: number; height: number; scaleMode: string }> {
  const fill = pluginResult as { imageData: string; width: number; height: number; scaleMode: string };
  const written = await writeExportToPath(exportPath, fill.imageData);
  return {
    path: written.path,
    bytes: written.bytes,
    width: fill.width,
    height: fill.height,
    scaleMode: fill.scaleMode,
  };
}

/** Whether a render may be served from / recorded into the session export cache. */
export interface ExportCachePolicy {
  read: boolean;
  write: boolean;
}

/**
 * Turn the plugin's raw export result into what the caller asked for.
 * `forceFile` writes a file even when neither a destination nor `inline` was given for
 * a video (batch rows cannot carry an inline payload).
 */
export async function finalizeNodeExport(
  pluginResult: unknown,
  options: NodeExportOptions,
  forceFile = false,
  cachePolicy: ExportCachePolicy = { read: true, write: true },
): Promise<NodeExportOutcome> {
  const { nodeId, save_to_path, output_directory, filename, max_width, max_height, region, jpeg_quality } = options;
  const format = (options.format || "PNG").toUpperCase();

  if (VIDEO_EXPORT_FORMATS.has(format)) {
    const video = pluginResult as PluginVideoExport;
    if (forceFile || save_to_path || output_directory || filename) {
      const destination = await resolveExportDestination({
        saveToPath: save_to_path,
        outputDirectory: output_directory,
        filename,
        nodeId,
        nodeName: video.name,
        scale: options.scale || 1,
        format: video.format,
      });
      const written = await writeExportToPath(destination.path, video.videoData);
      return {
        kind: "file",
        payload: {
          path: written.path,
          bytes: written.bytes,
          format: video.format,
          ...(destination.warnings.length ? { warnings: destination.warnings } : {}),
        },
      };
    }
    return {
      kind: "inline-video",
      text: `Exported "${nodeId}" as ${video.format} (${(video.byteLength / 1024).toFixed(0)} KB).`,
      uri: `figma-export://${nodeId}.${video.format.toLowerCase()}`,
      mimeType: video.mimeType,
      blob: video.videoData,
    };
  }

  const image = pluginResult as PluginImageExport;
  const resolvedScale = options.scale || 1;
  const wantsInline = options.inline === true;

  // Resolved even for inline renders so an explicit destination still participates
  // in the cache key.
  const destination = wantsInline
    ? { path: "", warnings: [] as string[] }
    : await resolveExportDestination({
        saveToPath: save_to_path,
        outputDirectory: output_directory,
        filename,
        nodeId,
        nodeName: image.name,
        scale: resolvedScale,
        format,
      });

  // Keyed on the plugin-computed subtree version hash — when that is missing we never
  // cache (a false miss costs one render; a false hit silently shows a stale design).
  const cacheKey = exportCacheKey({
    nodeId,
    scale: resolvedScale,
    format,
    subtreeHash: image.subtreeHash,
    region,
    maxWidth: max_width,
    maxHeight: max_height,
    jpegQuality: jpeg_quality,
    allowFullResolution: options.allow_full_resolution === true,
    inline: wantsInline,
    destination: destination.path || null,
  });
  const cached = options.force_refresh === true || !cachePolicy.read ? undefined : getCachedExport(cacheKey);
  const writeKey = cachePolicy.write ? cacheKey : null;

  if (cached) {
    const savedNote =
      `Cache HIT — "${nodeId}" is unchanged since the last export at this scale (subtree hash ${image.subtreeHash}); ` +
      `reusing that render and skipping ~${cached.approxTokens} result tokens. Pass force_refresh: true to re-render.`;
    if (cached.path) {
      return {
        kind: "file",
        payload: {
          path: cached.path,
          width: cached.width,
          height: cached.height,
          bytes: cached.bytes,
          format: cached.format,
          cached: true,
          note: savedNote,
        },
      };
    }
    return {
      kind: "inline-image",
      text: savedNote,
      data: cached.base64 as string,
      mimeType: cached.mimeType || "image/png",
    };
  }

  // Saving to disk keeps full resolution — the 1200px cap only guards inline
  // (token-costly) returns — but a fractional `scale` is enforced on BOTH paths.
  const longestSourceEdge = Math.max(image.originalWidth || 0, image.originalHeight || 0);
  const hardMaxEdge =
    resolvedScale < 1 && longestSourceEdge > 0 ? Math.max(1, Math.round(longestSourceEdge * resolvedScale)) : undefined;

  const processed = await postProcessExport({
    base64: image.imageData,
    format,
    maxWidth: max_width,
    maxHeight: max_height,
    allowFullResolution: options.allow_full_resolution === true || !wantsInline,
    region,
    jpegQuality: jpeg_quality,
    hardMaxEdge,
  });

  const width = processed.width ?? image.exportedWidth;
  const height = processed.height ?? image.exportedHeight;
  const approxTokens = approximateImageTokens(width, height);

  if (!wantsInline) {
    const written = await writeExportToPath(destination.path, processed.base64);
    setCachedExport(writeKey, {
      path: written.path,
      contentHash: written.sha256,
      width,
      height,
      bytes: written.bytes,
      format,
      approxTokens,
    });
    return {
      kind: "file",
      payload: {
        path: written.path,
        width,
        height,
        bytes: written.bytes,
        format,
        cached: false,
        ...(destination.warnings.length ? { warnings: destination.warnings } : {}),
        note: [
          ...processed.notes,
          ...destination.warnings,
          "Pass inline: true if you need to see the pixels in the conversation.",
        ].join(" "),
      },
    };
  }

  const wasScaleReduced = image.actualScale < image.requestedScale;
  const text = [
    `Exported "${nodeId}" as ${format} — ${width}x${height}px, ${(processed.bytes / 1024).toFixed(0)} KB (original node ${image.originalWidth}x${image.originalHeight}px).`,
    wasScaleReduced
      ? `⚠️ Scale auto-reduced from ${image.requestedScale}x to ${image.actualScale.toFixed(2)}x to fit Figma export limits.`
      : "",
    ...processed.notes,
    `Cache MISS (~${approxTokens} result tokens). Omit inline to get a file path instead of an inline image (far cheaper).`,
  ]
    .filter(Boolean)
    .join(" ");

  setCachedExport(writeKey, {
    base64: processed.base64,
    mimeType: image.mimeType || "image/png",
    width,
    height,
    bytes: processed.bytes,
    format,
    approxTokens,
  });

  return { kind: "inline-image", text, data: processed.base64, mimeType: image.mimeType || "image/png" };
}
