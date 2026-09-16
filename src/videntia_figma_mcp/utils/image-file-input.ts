/**
 * Server-side reader for local image files used as image-fill sources.
 *
 * The whole point is that the image bytes NEVER travel through the model's
 * context: the agent passes an absolute path (~80 tokens), the MCP server reads
 * the file off disk and base64-encodes it before handing it to the Figma plugin.
 * Inlining the same image as `imageBytes` costs ~176,000 tokens for a 705KB file,
 * which no single model response can emit.
 */

/**
 * Decoded-byte ceiling for a local image file.
 *
 * Matched to the plugin-side `MAX_IMAGE_BYTES` cap in
 * `src/videntia_figma_plugin/handlers/fills.ts` so the failure happens here,
 * fast and with a clear message, instead of as an opaque relay/decode error
 * after a multi-megabyte payload has already crossed the WebSocket.
 */
export const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024;

/** Extensions Figma accepts as image-fill sources, mapped to their MIME types. */
const SUPPORTED_EXTENSIONS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export interface ReadImageFileResult {
  /** Base64-encoded file contents (no data: prefix). */
  base64: string;
  /** Decoded size in bytes. */
  bytes: number;
  /** MIME type inferred from the magic bytes. */
  mimeType: string;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes} bytes`;
}

/**
 * Sniff the image type from the file's magic bytes. Returns undefined when the
 * content is not one of the formats Figma accepts.
 */
export function sniffImageMimeType(buffer: Buffer): string | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (
    buffer.length >= 6 &&
    buffer
      .subarray(0, 6)
      .toString("ascii")
      .match(/^GIF8[79]a$/)
  )
    return "image/gif";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return undefined;
}

/**
 * Validate and read a local image file, returning its base64 payload.
 *
 * Throws with an actionable message when the path is not absolute, missing, a
 * directory, not a supported image type, empty, or over {@link MAX_IMAGE_FILE_BYTES}.
 */
export async function readImageFileAsBase64(
  imagePath: string,
  maxBytes: number = MAX_IMAGE_FILE_BYTES,
): Promise<ReadImageFileResult> {
  const path = await import("path");
  const fs = await import("fs");

  if (!imagePath || typeof imagePath !== "string") {
    throw new Error("path is required and must be a string");
  }
  if (!path.isAbsolute(imagePath)) {
    throw new Error(`path must be an absolute file path, got: ${imagePath}`);
  }
  if (!fs.existsSync(imagePath)) {
    throw new Error(`File does not exist: ${imagePath}`);
  }

  const stat = fs.statSync(imagePath);
  if (stat.isDirectory()) {
    throw new Error(`path is a directory, not a file: ${imagePath}`);
  }
  if (stat.size === 0) {
    throw new Error(`File is empty: ${imagePath}`);
  }
  if (stat.size > maxBytes) {
    throw new Error(
      `Image file is too large: ${formatBytes(stat.size)} (limit ${formatBytes(maxBytes)}). ` +
        `Downscale or re-encode the image (e.g. to JPEG) before setting it as a fill: ${imagePath}`,
    );
  }

  const extension = path.extname(imagePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS[extension]) {
    throw new Error(
      `Unsupported image type "${extension || "(no extension)"}" for ${imagePath}. ` +
        `Figma image fills accept: ${Object.keys(SUPPORTED_EXTENSIONS).join(", ")}`,
    );
  }

  const buffer = fs.readFileSync(imagePath);
  const mimeType = sniffImageMimeType(buffer);
  if (!mimeType) {
    throw new Error(
      `File is not a readable image (contents do not match PNG/JPG/GIF/WEBP despite the "${extension}" extension): ${imagePath}`,
    );
  }

  return { base64: buffer.toString("base64"), bytes: buffer.length, mimeType };
}
