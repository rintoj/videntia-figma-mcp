import { setGradientFill, setImageFill } from "../../../src/videntia_figma_plugin/handlers/fills";
import { buildGradientPaint } from "../../../src/videntia_figma_plugin/handlers/paint-styles";
import { buildFigmaPaint } from "../../../src/videntia_figma_plugin/handlers/design-system";
import { getTextOpenTypeFeatures } from "../../../src/videntia_figma_plugin/handlers/opentype";

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);
const sampler = (t: number[][]) => (x: number, y: number) => t[0][0] * x + t[0][1] * y + t[0][2];

describe("setGradientFill — CSS angle, direction keywords, stop sorting", () => {
  let node: any;
  beforeEach(() => {
    node = { id: "1:2", name: "Rect", fills: [], width: 200, height: 100 };
    (globalThis as any).figma = {
      getNodeByIdAsync: jest.fn(async () => node),
      variables: { getLocalVariablesAsync: jest.fn(async () => []) },
    };
  });
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  const stops = [
    { color: "#000000", position: 1 },
    { color: "#ffffff", position: 0 },
  ];

  it("defaults to 180 (to bottom) when neither angle nor direction is given", async () => {
    const result: any = await setGradientFill({ nodeId: "1:2", gradientType: "LINEAR", stops });
    expect(result.angle).toBe(180);
    const at = sampler(node.fills[0].gradientTransform);
    close(at(0.5, 0), 0);
    close(at(0.5, 1), 1);
  });

  it("sorts stops by position", async () => {
    await setGradientFill({ nodeId: "1:2", gradientType: "LINEAR", stops, angle: 90 });
    expect(node.fills[0].gradientStops.map((s: any) => s.position)).toEqual([0, 1]);
    expect(node.fills[0].gradientStops[0].color.r).toBe(1);
  });

  it("'to right' = 90deg, 'r' too", async () => {
    await setGradientFill({ nodeId: "1:2", gradientType: "LINEAR", stops, direction: "to right" });
    const at = sampler(node.fills[0].gradientTransform);
    close(at(0, 0.5), 0);
    close(at(1, 0.5), 1);
    const result: any = await setGradientFill({ nodeId: "1:2", gradientType: "LINEAR", stops, direction: "r" });
    expect(result.angle).toBe(90);
  });

  it("'to top right' on a 200x100 node runs bottom-left corner → top-right corner (CSS spec)", async () => {
    const result: any = await setGradientFill({
      nodeId: "1:2",
      gradientType: "LINEAR",
      stops,
      direction: "to top right",
    });
    close(result.angle, (Math.atan2(100, 200) * 180) / Math.PI);
    const at = sampler(node.fills[0].gradientTransform);
    close(at(0, 1), 0);
    close(at(1, 0), 1);
    // The other diagonal is the 50% line.
    close(at(0, 0), 0.5);
    close(at(1, 1), 0.5);
  });

  it("an explicit angle wins over direction", async () => {
    const result: any = await setGradientFill({
      nodeId: "1:2",
      gradientType: "LINEAR",
      stops,
      angle: 270,
      direction: "to right",
    });
    expect(result.angle).toBe(270);
  });

  it("rejects an unknown direction keyword", async () => {
    await expect(
      setGradientFill({ nodeId: "1:2", gradientType: "LINEAR", stops, direction: "sideways" }),
    ).rejects.toThrow(/Unrecognised gradient direction/);
  });
});

describe("buildGradientPaint (paint styles)", () => {
  it("accepts {r,g,b,a} stop colours as well as hex", () => {
    const paint = buildGradientPaint({
      type: "LINEAR",
      stops: [
        { color: { r: 1, g: 0, b: 0, a: 0.5 }, position: 0 },
        { color: "#0000ff", position: 1 },
      ],
    });
    expect(paint.gradientStops[0].color).toEqual({ r: 1, g: 0, b: 0, a: 0.5 });
    expect(paint.gradientStops[1].color).toEqual({ r: 0, g: 0, b: 1, a: 1 });
  });

  it("uses a centred transform: 90deg is left-centre 0 → right-centre 1 (no hard edge at the middle)", () => {
    const paint = buildGradientPaint({
      type: "LINEAR",
      angle: 90,
      stops: [
        { color: "#000", position: 0 },
        { color: "#fff", position: 1 },
      ],
    });
    const at = sampler(paint.gradientTransform as unknown as number[][]);
    close(at(0, 0.5), 0);
    close(at(1, 0.5), 1);
    close(at(0.5, 0.5), 0.5);
  });

  it("defaults to 180 and sorts stops", () => {
    const paint = buildGradientPaint({
      type: "LINEAR",
      stops: [
        { color: "#000", position: 1 },
        { color: "#fff", position: 0 },
      ],
    });
    expect(paint.gradientStops.map((s) => s.position)).toEqual([0, 1]);
    const at = sampler(paint.gradientTransform as unknown as number[][]);
    close(at(0.5, 0), 0);
    close(at(0.5, 1), 1);
  });

  it("accepts a direction keyword", () => {
    const paint = buildGradientPaint({
      type: "LINEAR",
      direction: "to left",
      stops: [
        { color: "#000", position: 0 },
        { color: "#fff", position: 1 },
      ],
    });
    const at = sampler(paint.gradientTransform as unknown as number[][]);
    close(at(1, 0.5), 0);
    close(at(0, 0.5), 1);
  });
});

describe("buildFigmaPaint (JSX → Figma)", () => {
  const stops = [
    { color: "#ff0000", position: 1 },
    { color: "#0000ff", position: 0 },
  ];

  it("honours the CSS angle instead of writing an identity transform", () => {
    const paint = buildFigmaPaint({ gradient: { type: "GRADIENT_LINEAR", stops, angle: 90 } }, 300, 100) as any;
    const at = sampler(paint.gradientTransform);
    close(at(0, 0.5), 0);
    close(at(1, 0.5), 1);
    expect(paint.gradientStops.map((s: any) => s.position)).toEqual([0, 1]);
  });

  it("maps a Tailwind direction and defaults to 180 without one", () => {
    const withDir = buildFigmaPaint({ gradient: { type: "GRADIENT_LINEAR", stops, direction: "l" } }, 100, 100) as any;
    close(sampler(withDir.gradientTransform)(1, 0.5), 0);
    const plain = buildFigmaPaint({ gradient: { type: "GRADIENT_LINEAR", stops } }, 100, 100) as any;
    close(sampler(plain.gradientTransform)(0.5, 0), 0);
    close(sampler(plain.gradientTransform)(0.5, 1), 1);
  });
});

describe("setImageFill — TILE scalingFactor", () => {
  let node: any;
  beforeEach(() => {
    node = { id: "1:2", name: "Rect", fills: [] };
    (globalThis as any).figma = {
      getNodeByIdAsync: jest.fn(async () => node),
      createImage: jest.fn(() => ({ hash: "h1", getSizeAsync: async () => ({ width: 10, height: 10 }) })),
    };
  });
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("passes scalingFactor through to the ImagePaint", async () => {
    await setImageFill({ nodeId: "1:2", imageBytes: "iVBORw0KGgo=", scaleMode: "TILE", scalingFactor: 0.5 });
    expect(node.fills[0]).toMatchObject({ type: "IMAGE", scaleMode: "TILE", scalingFactor: 0.5 });
  });

  it("rejects scalingFactor with a non-TILE scaleMode", async () => {
    await expect(
      setImageFill({ nodeId: "1:2", imageBytes: "iVBORw0KGgo=", scaleMode: "FILL", scalingFactor: 2 }),
    ).rejects.toThrow(/TILE/);
  });
});

describe("getTextOpenTypeFeatures", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("returns node-wide and per-range features plus the read-only note", async () => {
    const mixed = Symbol("mixed");
    const text = {
      id: "1:3",
      name: "Price",
      type: "TEXT",
      openTypeFeatures: mixed,
      getStyledTextSegments: jest.fn(() => [
        { start: 0, end: 3, characters: "abc", openTypeFeatures: { LIGA: false } },
        { start: 3, end: 6, characters: "123", openTypeFeatures: { TNUM: true } },
      ]),
    };
    (globalThis as any).figma = { mixed, getNodeByIdAsync: jest.fn(async () => text) };
    const result = await getTextOpenTypeFeatures({ nodeId: "1:3" });
    expect(text.getStyledTextSegments).toHaveBeenCalledWith(["openTypeFeatures"]);
    expect(result.features).toBe("mixed");
    expect(result.ranges).toEqual([
      { start: 0, end: 3, characters: "abc", features: { LIGA: false } },
      { start: 3, end: 6, characters: "123", features: { TNUM: true } },
    ]);
    expect(result.note).toMatch(/read-only/);
  });

  it("refuses a non-TEXT node", async () => {
    (globalThis as any).figma = {
      mixed: Symbol("mixed"),
      getNodeByIdAsync: jest.fn(async () => ({ id: "1:1", type: "FRAME" })),
    };
    await expect(getTextOpenTypeFeatures({ nodeId: "1:1" })).rejects.toThrow(/not a TEXT node/);
  });
});
