/**
 * Server-side post-processing for `export_node_as_image` raster exports.
 *
 * Keeps token usage down by letting callers crop/downscale/save images without
 * ever inlining a multi-megapixel base64 blob into the conversation.
 */

export const DEFAULT_MAX_EDGE = 1200;

export interface PostProcessOptions {
  /** Base64 payload returned by the Figma plugin. */
  base64: string;
  /** Export format, uppercase (PNG/JPG/SVG/PDF). */
  format: string;
  maxWidth?: number;
  maxHeight?: number;
  /** Bypass the default 1200px longest-edge ceiling. */
  allowFullResolution?: boolean;
  /** True when the caller explicitly constrained the size some other way. */
  explicitlyConstrained?: boolean;
  /** Crop region in exported-image pixel coordinates. */
  region?: { x: number; y: number; width: number; height: number };
  /** JPEG quality 0-100 (JPG output only). */
  jpegQuality?: number;
  /**
   * Hard ceiling on the longest edge, applied on BOTH the inline and
   * save-to-disk paths. Used to guarantee that a fractional `scale` actually
   * shrinks the returned pixels even if the export itself came back larger
   * than the requested scale implies.
   */
  hardMaxEdge?: number;
}

export interface PostProcessResult {
  base64: string;
  width?: number;
  height?: number;
  bytes: number;
  /** Human-readable notes about what was applied. */
  notes: string[];
}

/** Raster formats sharp can decode/encode. Vector/PDF passes through untouched. */
export function isRasterFormat(format: string): boolean {
  const f = format.toUpperCase();
  return f === "PNG" || f === "JPG" || f === "JPEG";
}

/**
 * Crop / downscale / re-encode a base64 raster export.
 * Non-raster formats are returned untouched (byte size still reported).
 */
export async function postProcessExport(options: PostProcessOptions): Promise<PostProcessResult> {
  const {
    base64,
    format,
    maxWidth,
    maxHeight,
    allowFullResolution,
    explicitlyConstrained,
    region,
    jpegQuality,
    hardMaxEdge,
  } = options;

  const inputBuffer = Buffer.from(base64, "base64");
  const notes: string[] = [];

  if (!isRasterFormat(format)) {
    return { base64, bytes: inputBuffer.length, notes };
  }

  const sharpModule = await import("sharp");
  const sharp = (sharpModule as unknown as { default: typeof import("sharp") }).default ?? sharpModule;

  let image = sharp(inputBuffer);
  let meta = await image.metadata();
  let width = meta.width ?? 0;
  let height = meta.height ?? 0;

  if (region) {
    const left = Math.max(0, Math.round(region.x));
    const top = Math.max(0, Math.round(region.y));
    const cropWidth = Math.max(1, Math.min(Math.round(region.width), width - left));
    const cropHeight = Math.max(1, Math.min(Math.round(region.height), height - top));
    if (left >= width || top >= height) {
      throw new Error(
        `region origin (${left},${top}) is outside the exported image (${width}x${height}). ` +
          `region is in exported-image pixels, after 'scale' is applied.`,
      );
    }
    image = sharp(await image.extract({ left, top, width: cropWidth, height: cropHeight }).toBuffer());
    meta = await image.metadata();
    width = meta.width ?? cropWidth;
    height = meta.height ?? cropHeight;
    notes.push(`Cropped to region ${cropWidth}x${cropHeight} at (${left},${top}).`);
  }

  // Resolve the target box.
  let targetWidth = maxWidth;
  let targetHeight = maxHeight;

  // Scale guarantee: never return more pixels than the requested `scale` asked
  // for, whatever the export path handed back.
  if (hardMaxEdge !== undefined && hardMaxEdge > 0 && Math.max(width, height) > hardMaxEdge) {
    if (width >= height) targetWidth = Math.min(targetWidth ?? hardMaxEdge, hardMaxEdge);
    else targetHeight = Math.min(targetHeight ?? hardMaxEdge, hardMaxEdge);
    notes.push(`Constrained to a ${hardMaxEdge}px longest edge to honour the requested scale.`);
  }
  if (targetWidth === undefined && targetHeight === undefined && !allowFullResolution && !explicitlyConstrained) {
    const longest = Math.max(width, height);
    if (longest > DEFAULT_MAX_EDGE) {
      if (width >= height) targetWidth = DEFAULT_MAX_EDGE;
      else targetHeight = DEFAULT_MAX_EDGE;
      notes.push(
        `Downscaled to a ${DEFAULT_MAX_EDGE}px longest edge (default cap). ` +
          `Pass allow_full_resolution: true, max_width/max_height, or save_to_path for full detail.`,
      );
    }
  }

  const needsResize =
    (targetWidth !== undefined && width > targetWidth) || (targetHeight !== undefined && height > targetHeight);

  if (needsResize) {
    image = image.resize({
      width: targetWidth,
      height: targetHeight,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  const isJpeg = format.toUpperCase() !== "PNG";
  if (isJpeg && jpegQuality !== undefined) {
    image = image.jpeg({ quality: Math.max(1, Math.min(100, Math.round(jpegQuality))) });
    notes.push(`Re-encoded JPEG at quality ${Math.round(jpegQuality)}.`);
  } else if (isJpeg) {
    image = image.jpeg();
  } else if (needsResize) {
    image = image.png();
  }

  if (!needsResize && !region && !(isJpeg && jpegQuality !== undefined)) {
    return { base64, width, height, bytes: inputBuffer.length, notes };
  }

  const outputBuffer = await image.toBuffer();
  const outMeta = await sharp(outputBuffer).metadata();

  return {
    base64: outputBuffer.toString("base64"),
    width: outMeta.width,
    height: outMeta.height,
    bytes: outputBuffer.length,
    notes,
  };
}

/**
 * Write a base64 export payload to an absolute path.
 * Parent directory must already exist; existing files are overwritten.
 */
export async function writeExportToPath(exportPath: string, base64: string): Promise<{ path: string; bytes: number }> {
  const path = await import("path");
  const fs = await import("fs");

  if (!path.isAbsolute(exportPath)) {
    throw new Error(`save_to_path must be an absolute path, got: ${exportPath}`);
  }
  const dir = path.dirname(exportPath);
  if (!fs.existsSync(dir)) {
    throw new Error(`Directory does not exist: ${dir}`);
  }
  const buffer = Buffer.from(base64, "base64");
  fs.writeFileSync(exportPath, buffer);
  return { path: exportPath, bytes: buffer.length };
}

/**
 * Directory used for renders when the caller did not choose a path.
 * One directory per server process, so a session's exports stay together and
 * are easy to clean up.
 */
export async function sessionExportDir(): Promise<string> {
  const os = await import("os");
  const path = await import("path");
  const fs = await import("fs");
  const dir = path.join(os.tmpdir(), `figma-exports-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Deterministic default file path for a render. */
export async function defaultExportPath(nodeId: string, scale: number, format: string): Promise<string> {
  const path = await import("path");
  const dir = await sessionExportDir();
  const safeId = nodeId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const ext = format.toLowerCase() === "jpg" ? "jpg" : format.toLowerCase();
  return path.join(dir, `${safeId}@${scale}x.${ext}`);
}

/** File extension implied by an export format (PNG/JPG/SVG/PDF/MP4/GIF/WEBM). */
export function exportExtension(format: string): string {
  const f = format.toLowerCase();
  return f === "jpeg" ? "jpg" : f;
}

/** `Name-nodeId@2x.png` — readable, collision-free, deterministic. */
export function defaultExportFilename(
  nodeId: string,
  nodeName: string | undefined,
  scale: number,
  format: string,
): string {
  const safeId = nodeId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const safeName = (nodeName ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const stem = safeName ? `${safeName}-${safeId}` : safeId;
  return `${stem}@${scale}x.${exportExtension(format)}`;
}

export interface ExportDestinationOptions {
  saveToPath?: string;
  outputDirectory?: string;
  filename?: string;
  nodeId: string;
  nodeName?: string;
  scale: number;
  format: string;
}

export interface ResolvedExportDestination {
  path: string;
  warnings: string[];
}

/**
 * Resolve where a render should be written.
 *
 * Precedence: `save_to_path` > `output_directory` (+ optional `filename`) >
 * the per-session temp directory. `output_directory` is created when missing;
 * `filename` gains the extension implied by `format` when it lacks one.
 */
export async function resolveExportDestination(options: ExportDestinationOptions): Promise<ResolvedExportDestination> {
  const path = await import("path");
  const fs = await import("fs");
  const { saveToPath, outputDirectory, filename, nodeId, nodeName, scale, format } = options;
  const warnings: string[] = [];

  if (saveToPath) {
    if (outputDirectory || filename) {
      warnings.push("save_to_path takes precedence — output_directory/filename were ignored for this export.");
    }
    return { path: saveToPath, warnings };
  }

  if (filename && (filename.includes("/") || filename.includes("\\"))) {
    throw new Error(`filename must be a bare file name without path separators, got: ${filename}`);
  }

  let dir: string;
  if (outputDirectory) {
    if (!path.isAbsolute(outputDirectory)) {
      throw new Error(`output_directory must be an absolute path, got: ${outputDirectory}`);
    }
    if (fs.existsSync(outputDirectory)) {
      if (!fs.statSync(outputDirectory).isDirectory()) {
        throw new Error(`output_directory is not a directory: ${outputDirectory}`);
      }
    } else {
      fs.mkdirSync(outputDirectory, { recursive: true });
      warnings.push(`Created output_directory ${outputDirectory}.`);
    }
    dir = outputDirectory;
  } else {
    dir = await sessionExportDir();
  }

  const ext = exportExtension(format);
  let name = filename?.trim() || defaultExportFilename(nodeId, nodeName, scale, format);
  if (name.toLowerCase().endsWith(`.${ext}`) === false) {
    name = `${name}.${ext}`;
  }
  return { path: path.join(dir, name), warnings };
}
