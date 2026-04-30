import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

export interface DiffOptions {
  tolerance: number;
}

export interface DiffResult {
  mismatchedPixels: number;
  totalPixels: number;
  deviationPercent: number;
  diffPng: Buffer;
  diffImagePath: string;
}

export async function diffImages(
  referenceBuffer: Buffer,
  actualBuffer: Buffer,
  options: DiffOptions
): Promise<DiffResult> {
  const ref = PNG.sync.read(referenceBuffer);
  const act = PNG.sync.read(actualBuffer);

  const width = Math.min(ref.width, act.width);
  const height = Math.min(ref.height, act.height);

  const refData = resizeImageData(ref, width, height);
  const actData = resizeImageData(act, width, height);

  const diffPng = new PNG({ width, height });
  const mismatchedPixels = pixelmatch(
    refData,
    actData,
    diffPng.data,
    width,
    height,
    { threshold: options.tolerance }
  );

  const totalPixels = width * height;
  const diffBuffer = PNG.sync.write(diffPng);
  const diffImagePath = path.join(os.tmpdir(), `figma-diff-${Date.now()}.png`);
  fs.writeFileSync(diffImagePath, diffBuffer);

  return {
    mismatchedPixels,
    totalPixels,
    deviationPercent: parseFloat(((mismatchedPixels / totalPixels) * 100).toFixed(2)),
    diffPng: diffBuffer,
    diffImagePath,
  };
}

function resizeImageData(png: PNG, width: number, height: number): Buffer {
  if (png.width === width && png.height === height) {
    return png.data as unknown as Buffer;
  }
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * png.width + x) * 4;
      const dstIdx = (y * width + x) * 4;
      data[dstIdx] = png.data[srcIdx];
      data[dstIdx + 1] = png.data[srcIdx + 1];
      data[dstIdx + 2] = png.data[srcIdx + 2];
      data[dstIdx + 3] = png.data[srcIdx + 3];
    }
  }
  return data;
}
