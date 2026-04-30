import sharp from "sharp";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface MatchResult {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number; // 0–1, higher = better match
}

/**
 * Slides the reference image across the full page screenshot to find the
 * best-matching region. Uses a two-pass approach: coarse step first, then
 * fine-grained search around the best candidate.
 */
export async function findNodeInPage(
  referenceBuffer: Buffer,
  fullPageBuffer: Buffer
): Promise<MatchResult | null> {
  const ref = await sharp(referenceBuffer).raw().toBuffer({ resolveWithObject: true });
  const page = await sharp(fullPageBuffer).raw().toBuffer({ resolveWithObject: true });

  const refW = ref.info.width;
  const refH = ref.info.height;
  const pageW = page.info.width;
  const pageH = page.info.height;

  if (refW > pageW || refH > pageH) return null;

  // Pass 1: coarse scan (step = 40px)
  const coarse = await scanWindow(ref, page, refW, refH, pageW, pageH, 40);
  if (!coarse) return null;

  // Pass 2: fine scan around the best candidate (±80px, step = 4px)
  const fineY0 = Math.max(0, coarse.y - 80);
  const fineY1 = Math.min(pageH - refH, coarse.y + 80);
  const fine = await scanWindow(ref, page, refW, refH, pageW, pageH, 4, fineY0, fineY1);
  const best = fine ?? coarse;

  return {
    x: best.x,
    y: best.y,
    width: refW,
    height: refH,
    confidence: 1 - best.score,
  };
}

async function scanWindow(
  ref: { data: Buffer; info: sharp.OutputInfo },
  page: { data: Buffer; info: sharp.OutputInfo },
  refW: number,
  refH: number,
  pageW: number,
  pageH: number,
  step: number,
  yStart = 0,
  yEnd = pageH - refH
): Promise<{ x: number; y: number; score: number } | null> {
  let bestScore = Infinity;
  let bestX = 0;
  let bestY = yStart;

  const diffData = Buffer.alloc(refW * refH * 4);

  for (let y = yStart; y <= yEnd; y += step) {
    // Extract a refW × refH crop from the page at (0, y)
    // We work directly on raw pixel data for speed
    const cropData = extractCrop(page.data, pageW, pageH, 0, y, refW, refH, page.info.channels);

    const mismatch = pixelmatch(
      ref.data,
      cropData,
      diffData,
      refW,
      refH,
      { threshold: 0.15 }
    );

    const score = mismatch / (refW * refH);
    if (score < bestScore) {
      bestScore = score;
      bestX = 0;
      bestY = y;
    }

    // Early exit if near-perfect match
    if (bestScore < 0.02) break;
  }

  if (bestScore > 0.8) return null;
  return { x: bestX, y: bestY, score: bestScore };
}

function extractCrop(
  data: Buffer,
  srcW: number,
  srcH: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
  channels: number
): Buffer {
  const out = Buffer.alloc(cropW * cropH * 4);
  for (let row = 0; row < cropH && cropY + row < srcH; row++) {
    for (let col = 0; col < cropW && cropX + col < srcW; col++) {
      const srcIdx = ((cropY + row) * srcW + (cropX + col)) * channels;
      const dstIdx = (row * cropW + col) * 4;
      out[dstIdx] = data[srcIdx];         // R
      out[dstIdx + 1] = data[srcIdx + 1]; // G
      out[dstIdx + 2] = data[srcIdx + 2]; // B
      out[dstIdx + 3] = channels === 4 ? data[srcIdx + 3] : 255; // A
    }
  }
  return out;
}
