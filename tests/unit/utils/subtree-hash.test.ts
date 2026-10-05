import { computeSubtreeHash, paintsSignature } from "../../../src/videntia_figma_plugin/utils/subtree-hash";

const MIXED = Symbol("figma.mixed");

beforeAll(() => {
  (globalThis as any).figma = { mixed: MIXED };
});

function frame(id: string, extra: Record<string, unknown> = {}, children: any[] = []): any {
  return {
    id,
    type: "FRAME",
    name: "Frame " + id,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    opacity: 1,
    visible: true,
    fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    children,
    ...extra,
  };
}

describe("computeSubtreeHash", () => {
  it("is stable for an unchanged subtree", () => {
    const a = frame("1:1", {}, [frame("1:2")]);
    const b = frame("1:1", {}, [frame("1:2")]);
    expect(computeSubtreeHash(a)).toBe(computeSubtreeHash(b));
    expect(computeSubtreeHash(a)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changes when geometry changes", () => {
    const before = computeSubtreeHash(frame("1:1"));
    const after = computeSubtreeHash(frame("1:1", { width: 101 }));
    expect(after).not.toBe(before);
  });

  it("changes when a fill changes", () => {
    const before = computeSubtreeHash(frame("1:1"));
    const after = computeSubtreeHash(frame("1:1", { fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }] }));
    expect(after).not.toBe(before);
  });

  describe("image paints", () => {
    const image = (extra: Record<string, unknown> = {}) => ({
      type: "IMAGE",
      imageHash: "h1",
      scaleMode: "TILE",
      scalingFactor: 1,
      ...extra,
    });
    const hashOf = (paint: Record<string, unknown>) => computeSubtreeHash(frame("1:1", { fills: [paint] }));

    it.each([
      ["imageHash", { imageHash: "h2" }],
      ["scalingFactor", { scalingFactor: 0.5 }],
      ["scaleMode", { scaleMode: "FIT", scalingFactor: undefined }],
      ["rotation", { rotation: 90 }],
      [
        "imageTransform",
        {
          scaleMode: "CROP",
          imageTransform: [
            [0.5, 0, 0],
            [0, 0.5, 0],
          ],
        },
      ],
      ["filters", { filters: { exposure: 0.4 } }],
    ])("changes when %s changes", (_label, change) => {
      expect(hashOf(image(change))).not.toBe(hashOf(image()));
    });

    it("covers image fields even when the paint's fields are not enumerable", () => {
      const hidden = (factor: number) => {
        const p: Record<string, unknown> = {};
        Object.defineProperty(p, "type", { value: "IMAGE", enumerable: false });
        Object.defineProperty(p, "imageHash", { value: "h1", enumerable: false });
        Object.defineProperty(p, "scaleMode", { value: "TILE", enumerable: false });
        Object.defineProperty(p, "scalingFactor", { value: factor, enumerable: false });
        return p;
      };
      expect(JSON.stringify([hidden(1)])).toBe(JSON.stringify([hidden(0.5)]));
      expect(hashOf(hidden(0.5))).not.toBe(hashOf(hidden(1)));
    });

    it("changes when a stroke image changes", () => {
      const a = computeSubtreeHash(frame("1:1", { strokes: [image()] }));
      const b = computeSubtreeHash(frame("1:1", { strokes: [image({ scalingFactor: 2 })] }));
      expect(a).not.toBe(b);
    });

    it("paintsSignature names every image identity field", () => {
      const sig = paintsSignature([
        image({
          rotation: 90,
          filters: { contrast: 0.2 },
          imageTransform: [
            [1, 0, 0],
            [0, 1, 0],
          ],
        }),
      ]);
      for (const key of ["imageHash", "scaleMode", "scalingFactor", "rotation", "filters", "imageTransform"]) {
        expect(sig).toContain(key + ":");
      }
    });
  });

  it("changes when a mixed-style text range changes", () => {
    const text = (secondSize: number) => ({
      id: "2:1",
      type: "TEXT",
      name: "t",
      characters: "Hello",
      fontSize: MIXED,
      fontName: { family: "Inter", style: "Regular" },
      lineHeight: { unit: "AUTO" },
      letterSpacing: { unit: "PIXELS", value: 0 },
      textAlignHorizontal: "LEFT",
      textCase: "ORIGINAL",
      getStyledTextSegments: () => [
        { start: 0, end: 2, fontSize: 12, fontName: { family: "Inter", style: "Regular" }, fills: [] },
        { start: 2, end: 5, fontSize: secondSize, fontName: { family: "Inter", style: "Regular" }, fills: [] },
      ],
    });
    expect(computeSubtreeHash(text(14) as any)).not.toBe(computeSubtreeHash(text(16) as any));
  });

  it("changes when a child is added, removed or reordered", () => {
    const one = computeSubtreeHash(frame("1:1", {}, [frame("1:2")]));
    const two = computeSubtreeHash(frame("1:1", {}, [frame("1:2"), frame("1:3")]));
    const reordered = computeSubtreeHash(frame("1:1", {}, [frame("1:3"), frame("1:2")]));
    expect(two).not.toBe(one);
    expect(reordered).not.toBe(two);
  });

  it("changes when text content changes", () => {
    const text = (chars: string) => ({
      id: "2:1",
      type: "TEXT",
      name: "t",
      characters: chars,
      fontSize: 12,
      fontName: { family: "Inter", style: "Regular" },
      lineHeight: { unit: "AUTO" },
      letterSpacing: { unit: "PIXELS", value: 0 },
      textAlignHorizontal: "LEFT",
      textCase: "ORIGINAL",
    });
    expect(computeSubtreeHash(text("Hello") as any)).not.toBe(computeSubtreeHash(text("Goodbye") as any));
  });

  it("ignores figma.mixed paint values rather than throwing", () => {
    expect(computeSubtreeHash(frame("1:1", { fills: MIXED }) as any)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("returns null for an oversized subtree so the server misses the cache", () => {
    const children = Array.from({ length: 5000 }, (_, i) => frame("c:" + i));
    expect(computeSubtreeHash(frame("1:1", {}, children))).toBeNull();
  });

  it("returns null instead of throwing when the node cannot be walked", () => {
    const hostile = {
      id: "1:1",
      type: "FRAME",
      get name(): string {
        throw new Error("boom");
      },
    };
    expect(computeSubtreeHash(hostile as any)).toBeNull();
  });
});
