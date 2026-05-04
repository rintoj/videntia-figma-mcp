import sharp from "sharp";

export interface MatchResult {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number; // 0–1, higher = better match
}

const SCALE = 0.2; // downscale factor for coarse pass

/**
 * Finds where the reference image appears within a full-page screenshot.
 * Uses grayscale + edge histogram matching — robust to color/theme differences.
 *
 * Two-pass:
 *   1. Coarse: 20% scale, step=15px — fast scan for approximate position
 *   2. Fine: full scale in ±100px band — accurate crop
 */
export async function findNodeInPage(referenceBuffer: Buffer, fullPageBuffer: Buffer): Promise<MatchResult | null> {
  const refMeta = await sharp(referenceBuffer).metadata();
  const pageMeta = await sharp(fullPageBuffer).metadata();
  const refW = refMeta.width!;
  const refH = refMeta.height!;
  const pageW = pageMeta.width!;
  const pageH = pageMeta.height!;

  if (refW > pageW || refH > pageH) return null;

  const sRefW = Math.max(1, Math.round(refW * SCALE));
  const sRefH = Math.max(1, Math.round(refH * SCALE));
  const sPageW = Math.max(1, Math.round(pageW * SCALE));
  const sPageH = Math.max(1, Math.round(pageH * SCALE));

  // Convert both to grayscale at reduced scale
  const [sRefGray, sPageGray] = await Promise.all([
    sharp(referenceBuffer).resize(sRefW, sRefH, { fit: "fill" }).grayscale().raw().toBuffer(),
    sharp(fullPageBuffer).resize(sPageW, sPageH, { fit: "fill" }).grayscale().raw().toBuffer(),
  ]);

  // Compute edge map of reference (horizontal + vertical gradients)
  const refEdge = edgeMap(sRefGray, sRefW, sRefH);
  const refHist = histogram(refEdge, sRefW * sRefH);

  // Pass 1: 2D coarse scan with edge-histogram score
  let bestScore = Infinity;
  let bestX = 0;
  let bestY = 0;
  const step = 8;
  const maxX = sPageW - sRefW;
  const maxY = sPageH - sRefH;

  for (let y = 0; y <= maxY; y += step) {
    for (let x = 0; x <= maxX; x += step) {
      const tile = extractTile(sPageGray, sPageW, x, y, sRefW, sRefH);
      const tileEdge = edgeMap(tile, sRefW, sRefH);
      const tileHist = histogram(tileEdge, sRefW * sRefH);
      const score = histDist(refHist, tileHist);
      if (score < bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }
    if (bestScore < 0.01) break;
  }

  // Map coarse coords back to full-scale, expand a ±100px search box
  const fullX0 = Math.max(0, Math.round(bestX / SCALE) - 100);
  const fullY0 = Math.max(0, Math.round(bestY / SCALE) - 100);
  const fullX1 = Math.min(pageW - refW, Math.round(bestX / SCALE) + 100);
  const fullY1 = Math.min(pageH - refH, Math.round(bestY / SCALE) + 100);

  const bandW = fullX1 - fullX0 + refW;
  const bandH = fullY1 - fullY0 + refH;

  // Pass 2: 2D fine scan at full scale using grayscale SAD
  const [refGrayFull, bandGrayFull] = await Promise.all([
    sharp(referenceBuffer).grayscale().raw().toBuffer(),
    sharp(fullPageBuffer)
      .extract({ left: fullX0, top: fullY0, width: bandW, height: bandH })
      .grayscale()
      .raw()
      .toBuffer(),
  ]);

  let fineBest = Infinity;
  let fineBestX = 0;
  let fineBestY = 0;
  const fineStep = 2;

  for (let y = 0; y <= bandH - refH; y += fineStep) {
    for (let x = 0; x <= bandW - refW; x += fineStep) {
      const score = sadNorm(refGrayFull, bandGrayFull, refW, refH, bandW, x, y);
      if (score < fineBest) {
        fineBest = score;
        fineBestX = x;
        fineBestY = y;
      }
    }
    if (fineBest < 0.01) break;
  }

  const finalX = fullX0 + fineBestX;
  const finalY = fullY0 + fineBestY;
  const confidence = parseFloat((1 - fineBest).toFixed(3));

  if (fineBest > 0.85) return null;

  return { x: finalX, y: finalY, width: refW, height: refH, confidence };
}

/** Extract a w×h grayscale tile from a full grayscale buffer at (x, y) */
function extractTile(data: Buffer, srcW: number, x: number, y: number, w: number, h: number): Buffer {
  const out = Buffer.alloc(w * h);
  for (let row = 0; row < h; row++) {
    const srcStart = (y + row) * srcW + x;
    data.copy(out, row * w, srcStart, srcStart + w);
  }
  return out;
}

/** Simple Sobel-like edge magnitude map (grayscale → grayscale) */
function edgeMap(gray: Buffer, w: number, h: number): Buffer {
  const out = Buffer.alloc(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -gray[(y - 1) * w + (x - 1)] -
        2 * gray[y * w + (x - 1)] -
        gray[(y + 1) * w + (x - 1)] +
        gray[(y - 1) * w + (x + 1)] +
        2 * gray[y * w + (x + 1)] +
        gray[(y + 1) * w + (x + 1)];
      const gy =
        -gray[(y - 1) * w + (x - 1)] -
        2 * gray[(y - 1) * w + x] -
        gray[(y - 1) * w + (x + 1)] +
        gray[(y + 1) * w + (x - 1)] +
        2 * gray[(y + 1) * w + x] +
        gray[(y + 1) * w + (x + 1)];
      out[y * w + x] = Math.min(255, Math.round(Math.sqrt(gx * gx + gy * gy)));
    }
  }
  return out;
}

/** Normalised 16-bin histogram of edge magnitudes */
function histogram(edge: Buffer, n: number): number[] {
  const bins = new Array(16).fill(0);
  for (let i = 0; i < n; i++) bins[Math.min(15, edge[i] >> 4)]++;
  return bins.map((b) => b / n);
}

/** L1 distance between two histograms */
function histDist(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d;
}

/** Normalised SAD between grayscale reference and a tile at (tileX, tileY) inside band */
function sadNorm(
  ref: Buffer,
  band: Buffer,
  refW: number,
  refH: number,
  bandW: number,
  tileX: number,
  tileY: number,
): number {
  const sampleStep = Math.max(1, Math.round(Math.min(refW, refH) / 30));
  let sad = 0;
  let count = 0;
  for (let y = 0; y < refH; y += sampleStep) {
    for (let x = 0; x < refW; x += sampleStep) {
      sad += Math.abs(ref[y * refW + x] - (band[(tileY + y) * bandW + (tileX + x)] ?? 128));
      count++;
    }
  }
  return sad / (count * 255);
}
