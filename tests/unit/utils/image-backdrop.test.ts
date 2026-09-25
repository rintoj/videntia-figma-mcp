import sharp from "sharp";
import {
  imageUvAt,
  sampleRaster,
  decodeBackdropImages,
  type ImageRaster,
} from "../../../src/videntia_figma_mcp/utils/image-backdrop";
import {
  evaluateTextSample,
  sweepContrast,
  type StackNode,
  type TextSample,
  type PaintLike,
} from "../../../src/videntia_figma_mcp/utils/verification-math";

const node = { x: 0, y: 0, width: 200, height: 100 };

/** Left half black, right half white. */
async function halfAndHalfPng(width = 100, height = 50): Promise<string> {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = x < width / 2 ? 0 : 255;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const png = await sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  return png.toString("base64");
}

async function solidPng(rgb: [number, number, number], width = 20, height = 20): Promise<string> {
  const png = await sharp({
    create: { width, height, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 1 } },
  })
    .png()
    .toBuffer();
  return png.toString("base64");
}

describe("imageUvAt", () => {
  it("FILL covers the node, centred (crops the overflow)", () => {
    // 100×100 image on a 200×100 node → scaled ×2, 50px cropped top and bottom.
    expect(imageUvAt({ scaleMode: "FILL" }, node, { x: 100, y: 50 }, 100, 100)).toEqual({ u: 0.5, v: 0.5 });
    expect(imageUvAt({ scaleMode: "FILL" }, node, { x: 0, y: 0 }, 100, 100)).toEqual({ u: 0, v: 0.25 });
  });

  it("FIT contains the image, centred, transparent outside", () => {
    expect(imageUvAt({ scaleMode: "FIT" }, node, { x: 10, y: 50 }, 100, 100)).toBeNull();
    expect(imageUvAt({ scaleMode: "FIT" }, node, { x: 100, y: 50 }, 100, 100)).toEqual({ u: 0.5, v: 0.5 });
    expect(imageUvAt({ scaleMode: "FIT" }, node, { x: 60, y: 0 }, 100, 100)).toEqual({ u: 0.1, v: 0 });
  });

  it("CROP maps node-normalised coordinates through imageTransform", () => {
    const t = [
      [0.5, 0, 0.5],
      [0, 1, 0],
    ];
    expect(imageUvAt({ scaleMode: "CROP", imageTransform: t }, node, { x: 0, y: 50 }, 100, 100)).toEqual({
      u: 0.5,
      v: 0.5,
    });
    expect(imageUvAt({ scaleMode: "CROP", imageTransform: t }, node, { x: 200, y: 0 }, 100, 100)).toEqual({
      u: 1,
      v: 0,
    });
  });

  it("TILE repeats the natural size × scalingFactor from the top-left", () => {
    const sq = { x: 0, y: 0, width: 100, height: 100 };
    expect(imageUvAt({ scaleMode: "TILE" }, sq, { x: 15, y: 5 }, 10, 10)).toEqual({ u: 0.5, v: 0.5 });
    expect(imageUvAt({ scaleMode: "TILE", scalingFactor: 2 }, sq, { x: 15, y: 5 }, 10, 10)).toEqual({
      u: 0.75,
      v: 0.25,
    });
  });

  it("honours a 90° clockwise paint rotation", () => {
    const sq = { x: 0, y: 0, width: 100, height: 100 };
    // After a clockwise quarter turn the image's bottom row forms the left edge.
    const uv = imageUvAt({ scaleMode: "FILL", rotation: 90 }, sq, { x: 0, y: 50 }, 100, 50)!;
    expect(uv.u).toBeCloseTo(0.5);
    expect(uv.v).toBeCloseTo(1);
    expect(uv.approx).toBeUndefined();
    const half = imageUvAt({ scaleMode: "FILL", rotation: 180 }, sq, { x: 0, y: 0 }, 100, 100)!;
    expect(half).toEqual({ u: 1, v: 1 });
  });

  it("flags a rotation that is not a multiple of 90°", () => {
    const uv = imageUvAt({ scaleMode: "FILL", rotation: 30 }, node, { x: 100, y: 50 }, 100, 100)!;
    expect(uv.approx).toContain("30");
  });
});

describe("sampleRaster", () => {
  const raster: ImageRaster = {
    width: 2,
    height: 1,
    originalWidth: 2,
    originalHeight: 1,
    data: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]),
  };
  it("averages a neighbourhood", () => {
    const c = sampleRaster(raster, 0.1, 0.5, 1)!;
    expect(c.r).toBeCloseTo(0.5);
    expect(c.a).toBeCloseTo(1);
  });
  it("reads a single pixel with radius 0", () => {
    expect(sampleRaster(raster, 0.9, 0.5, 0)!.r).toBeCloseTo(1);
  });
  it("returns null for a fully transparent spot", () => {
    const clear: ImageRaster = { ...raster, data: new Uint8Array(8) };
    expect(sampleRaster(clear, 0.5, 0.5)).toBeNull();
  });
});

describe("decodeBackdropImages", () => {
  it("decodes to RGBA and keeps the original size", async () => {
    const map = await decodeBackdropImages({ h: { base64: await halfAndHalfPng() } });
    const r = map.get("h") as ImageRaster;
    expect(r.width).toBe(100);
    expect(r.originalWidth).toBe(100);
    expect(r.data.length).toBe(100 * 50 * 4);
  });

  it("downscales large images but maps in original pixels", async () => {
    const map = await decodeBackdropImages({ big: { base64: await solidPng([10, 20, 30], 3000, 100) } }, 1024);
    const r = map.get("big") as ImageRaster;
    expect(r.width).toBe(1024);
    expect(r.originalWidth).toBe(3000);
    expect(r.originalHeight).toBe(100);
  });

  it("reports decode failures and plugin-side errors as reasons", async () => {
    const map = await decodeBackdropImages({
      junk: { base64: Buffer.from("not an image").toString("base64") },
      over: { error: "image budget exceeded (more than 24 distinct images)" },
    });
    expect(map.get("junk")).toMatch(/^image decode failed/);
    expect(map.get("over")).toContain("budget exceeded");
  });
});

// ── end to end through evaluateTextSample ──────────────────────────────────

const WHITE_TEXT: PaintLike = { type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1 };

function imageStack(
  paint: Partial<PaintLike>,
  text: { x: number; y: number; width: number; height: number },
): StackNode {
  return {
    nodeId: "0:1",
    nodeName: "Page",
    nodeType: "PAGE",
    fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
    children: [
      {
        nodeId: "hero",
        nodeName: "Hero",
        nodeType: "RECTANGLE",
        bounds: { x: 0, y: 0, width: 200, height: 100 },
        fills: [{ type: "IMAGE", imageHash: "h", scaleMode: "FILL", opacity: 1, ...paint }],
      },
      { nodeId: "t", nodeName: "Label", bounds: text, target: true },
    ],
  };
}

function textOver(
  paint: Partial<PaintLike>,
  text: { x: number; y: number; width: number; height: number },
): TextSample {
  return {
    nodeId: "t",
    nodeName: "Label",
    characters: "Caption",
    fontSize: 14,
    bounds: text,
    fills: [WHITE_TEXT],
    stack: imageStack(paint, text),
  };
}

// 200×100 node with a 100×50 image under FILL: scale ×2, no crop. Left half black.
const LEFT = { x: 20, y: 30, width: 60, height: 20 };
const RIGHT = { x: 120, y: 30, width: 60, height: 20 };
const STRADDLE = { x: 60, y: 30, width: 80, height: 20 };

describe("contrast over sampled images", () => {
  let images: Awaited<ReturnType<typeof decodeBackdropImages>>;
  beforeAll(async () => {
    images = await decodeBackdropImages({ h: { base64: await halfAndHalfPng() } });
  });

  it("white text over the dark half passes, and says the image was sampled", () => {
    const f = evaluateTextSample(textOver({}, LEFT), images);
    expect(f.indeterminate).toBeUndefined();
    expect(f.background.toLowerCase()).toBe("#000000");
    expect(f.severity).toBe("pass");
    expect(f.note).toContain("(sampled)");
  });

  it("white text over the light half fails", () => {
    const f = evaluateTextSample(textOver({}, RIGHT), images);
    expect(f.background.toLowerCase()).toBe("#ffffff");
    expect(f.severity).toBe("error");
  });

  it("text straddling both halves reports the worst point", () => {
    const f = evaluateTextSample(textOver({}, STRADDLE), images);
    expect(f.ratio).toBeLessThan(1.5);
    expect(f.severity).toBe("error");
  });

  it("composites the image paint's opacity over what is beneath", () => {
    const f = evaluateTextSample(textOver({ opacity: 0.5 }, LEFT), images);
    // 50% black over the white page ≈ #808080.
    expect(f.background.toLowerCase()).toMatch(/^#(7f|80)(7f|80)(7f|80)$/);
  });

  it("marks image filters as approximate instead of indeterminate", () => {
    const f = evaluateTextSample(textOver({ filters: { exposure: 0.4 } }, LEFT), images);
    expect(f.severity).toBe("pass");
    expect(f.note).toMatch(/filters \(exposure\).*approximate/);
  });

  it("stays indeterminate with the specific reason when the image could not be fetched", async () => {
    const failed = await decodeBackdropImages({
      h: { error: "image budget exceeded (8000KB would pass the 20MB cap)" },
    });
    const f = evaluateTextSample(textOver({}, LEFT), failed);
    expect(f.severity).toBe("indeterminate");
    expect(f.indeterminate).toContain("budget exceeded");
  });

  it("stays indeterminate without any image data", () => {
    const f = evaluateTextSample(textOver({}, LEFT));
    expect(f.severity).toBe("indeterminate");
    expect(f.indeterminate).toContain("image bytes unavailable");
  });

  it("keeps VIDEO paints indeterminate", () => {
    const f = evaluateTextSample(textOver({ type: "VIDEO" }, LEFT), images);
    expect(f.severity).toBe("indeterminate");
    expect(f.indeterminate).toContain("VIDEO");
  });

  it("samples an image text fill", async () => {
    const dark = await decodeBackdropImages({ d: { base64: await solidPng([0, 0, 0]) } });
    const sample: TextSample = {
      ...textOver({}, LEFT),
      fills: [{ type: "IMAGE", imageHash: "d", scaleMode: "FILL", opacity: 1 }],
      stack: {
        nodeId: "0:1",
        nodeName: "Page",
        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
        children: [{ nodeId: "t", nodeName: "Label", bounds: LEFT, target: true }],
      },
    };
    const f = evaluateTextSample(sample, dark);
    expect(f.indeterminate).toBeUndefined();
    expect(f.foreground.toLowerCase()).toBe("#000000");
    expect(f.severity).toBe("pass");
  });

  it("sweepContrast threads the rasters through", () => {
    const report = sweepContrast([textOver({}, LEFT), textOver({}, RIGHT)], images);
    expect(report.indeterminate).toBe(0);
    expect(report.failingAA).toBe(1);
  });
});
