/**
 * Image-paint sampling for contrast_check_frame.
 *
 * The plugin ships the raw bytes of every image paint that sits behind (or
 * fills) a text node. `decodeBackdropImages` decodes them once with sharp,
 * downscaled to ≤ 1024px on the longest edge. Everything after that is pure:
 * `imageUvAt` maps a canvas point to normalised image coordinates following
 * the paint's scaleMode, and `sampleImagePaint` averages a small neighbourhood
 * of the decoded raster there. Unit-testable with synthetic buffers.
 */

import type { Bounds } from "./verification-math.js";

export const IMAGE_SAMPLE_MAX_EDGE = 1024;

/** A decoded RGBA8 raster plus the ORIGINAL image size (TILE maps in original pixels). */
export interface ImageRaster {
  width: number;
  height: number;
  /** RGBA8, row-major, width*height*4 bytes. */
  data: Uint8Array;
  originalWidth: number;
  originalHeight: number;
}

/** hash → decoded raster, or the reason the image cannot be sampled. */
export type ImageRasterMap = Map<string, ImageRaster | string>;

export interface ImagePaintFields {
  scaleMode?: string;
  scalingFactor?: number;
  /** CROP only: 2×3 affine, node-normalised (0..1) → image-normalised (0..1). */
  imageTransform?: number[][];
  /** FILL / FIT / TILE: clockwise degrees, multiples of 90. */
  rotation?: number;
}

export interface ImageUv {
  u: number;
  v: number;
  /** Set when the mapping is only approximate (non-90° rotation, …). */
  approx?: string;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * Where on the image (u, v ∈ 0..1) the paint shows at canvas `point`, or null
 * when the paint leaves that spot transparent (outside a FIT/CROP image).
 *
 *  - FILL: scaled to cover the node, centred.
 *  - FIT:  scaled to fit inside the node, centred; transparent outside.
 *  - CROP: `imageTransform` maps node-normalised → image-normalised coords.
 *  - TILE: natural size × scalingFactor, repeated from the node's top-left.
 *
 * FILL/FIT/TILE honour `rotation` in 90° steps (clockwise).
 */
export function imageUvAt(
  paint: ImagePaintFields,
  bounds: Bounds,
  point: { x: number; y: number },
  imageWidth: number,
  imageHeight: number,
): ImageUv | null {
  const W = bounds.width || 1;
  const H = bounds.height || 1;
  const lx = point.x - bounds.x;
  const ly = point.y - bounds.y;
  const iw = Math.max(1, imageWidth);
  const ih = Math.max(1, imageHeight);
  const mode = (paint.scaleMode || "FILL").toUpperCase();

  if (mode === "CROP" || mode === "STRETCH") {
    const t = paint.imageTransform;
    const nx = lx / W;
    const ny = ly / H;
    let u = nx;
    let v = ny;
    if (t && t.length >= 2 && t[0].length >= 3 && t[1].length >= 3) {
      u = t[0][0] * nx + t[0][1] * ny + t[0][2];
      v = t[1][0] * nx + t[1][1] * ny + t[1][2];
    }
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    return { u, v };
  }

  const rotation = paint.rotation || 0;
  const quarter = Math.round(rotation / 90);
  const approx =
    Math.abs(rotation - quarter * 90) > 0.01 ? `image rotation ${rotation}° snapped to 90° steps` : undefined;
  const rot = mod(quarter, 4);
  // Size of the image AFTER rotation.
  const rw = rot % 2 === 1 ? ih : iw;
  const rh = rot % 2 === 1 ? iw : ih;

  let px: number;
  let py: number;
  if (mode === "TILE") {
    const s = paint.scalingFactor && paint.scalingFactor > 0 ? paint.scalingFactor : 1;
    px = mod(lx / s, rw);
    py = mod(ly / s, rh);
  } else {
    const fit = mode === "FIT";
    const s = fit ? Math.min(W / rw, H / rh) : Math.max(W / rw, H / rh);
    const ox = (W - rw * s) / 2;
    const oy = (H - rh * s) / 2;
    px = (lx - ox) / s;
    py = (ly - oy) / s;
    if (fit && (px < 0 || px > rw || py < 0 || py > rh)) return null;
    px = Math.max(0, Math.min(rw, px));
    py = Math.max(0, Math.min(rh, py));
  }

  // Undo the clockwise rotation: rotated (px, py) → original (ox, oy).
  let ox: number;
  let oy: number;
  if (rot === 1) {
    ox = py;
    oy = ih - px;
  } else if (rot === 2) {
    ox = iw - px;
    oy = ih - py;
  } else if (rot === 3) {
    ox = iw - py;
    oy = px;
  } else {
    ox = px;
    oy = py;
  }
  const out: ImageUv = { u: ox / iw, v: oy / ih };
  if (approx) out.approx = approx;
  return out;
}

/**
 * Average colour of the raster in a (2r+1)² pixel neighbourhood around (u, v).
 * Averaged premultiplied, returned straight (0..1). Null when fully transparent.
 */
export function sampleRaster(
  raster: ImageRaster,
  u: number,
  v: number,
  radius = 1,
): { r: number; g: number; b: number; a: number } | null {
  const cx = Math.min(raster.width - 1, Math.max(0, Math.floor(u * raster.width)));
  const cy = Math.min(raster.height - 1, Math.max(0, Math.floor(v * raster.height)));
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let n = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= raster.height) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= raster.width) continue;
      const i = (y * raster.width + x) * 4;
      const pa = raster.data[i + 3] / 255;
      r += (raster.data[i] / 255) * pa;
      g += (raster.data[i + 1] / 255) * pa;
      b += (raster.data[i + 2] / 255) * pa;
      a += pa;
      n++;
    }
  }
  if (n === 0 || a <= 0) return null;
  return { r: r / a, g: g / a, b: b / a, a: a / n };
}

/** Colour an image paint shows at `point` on a node with `bounds` (paint opacity not applied). */
export function sampleImagePaint(
  paint: ImagePaintFields,
  raster: ImageRaster,
  bounds: Bounds,
  point: { x: number; y: number },
): { color: { r: number; g: number; b: number; a: number } | null; approx?: string } {
  const uv = imageUvAt(paint, bounds, point, raster.originalWidth, raster.originalHeight);
  if (!uv) return { color: null };
  return { color: sampleRaster(raster, uv.u, uv.v), approx: uv.approx };
}

/**
 * Decode the plugin's base64 image payloads into downscaled RGBA rasters.
 * Failures become a reason string so the caller can report them precisely.
 */
export async function decodeBackdropImages(
  images: Record<string, { base64?: string; error?: string }> | undefined,
  maxEdge = IMAGE_SAMPLE_MAX_EDGE,
  loadSharp: () => Promise<unknown> = () => import("sharp"),
): Promise<ImageRasterMap> {
  const out: ImageRasterMap = new Map();
  if (!images) return out;
  const hashes = Object.keys(images);
  if (hashes.length === 0) return out;

  let sharp: typeof import("sharp");
  try {
    const sharpModule = (await loadSharp()) as typeof import("sharp");
    sharp = (sharpModule as unknown as { default: typeof import("sharp") }).default ?? sharpModule;
  } catch (e) {
    // A missing/broken native sharp must degrade to indeterminate, not fail the whole sweep.
    const reason = `image decoder unavailable: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160);
    for (const hash of hashes) out.set(hash, images[hash]?.error || reason);
    return out;
  }

  for (const hash of hashes) {
    const entry = images[hash] || {};
    if (entry.error || !entry.base64) {
      out.set(hash, entry.error || "image bytes missing");
      continue;
    }
    try {
      const input = Buffer.from(entry.base64, "base64");
      const meta = await sharp(input).metadata();
      const ow = meta.width ?? 0;
      const oh = meta.height ?? 0;
      if (!ow || !oh) throw new Error("unknown image dimensions");
      let pipeline = sharp(input).rotate().ensureAlpha();
      // EXIF orientation 5-8 swaps the axes Figma displays.
      const swapped = (meta.orientation ?? 1) >= 5;
      const dw = swapped ? oh : ow;
      const dh = swapped ? ow : oh;
      if (Math.max(dw, dh) > maxEdge) {
        pipeline = pipeline.resize({ width: maxEdge, height: maxEdge, fit: "inside" });
      }
      const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
      out.set(hash, {
        width: info.width,
        height: info.height,
        data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        originalWidth: dw,
        originalHeight: dh,
      });
    } catch (e) {
      out.set(hash, `image decode failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160));
    }
  }
  return out;
}
