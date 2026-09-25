import {
  directionToCssAngle,
  distributeStopPositions,
  gradientTransformToCssAngle,
  linearGradientTransform,
  parseCssGradient,
  sortGradientStops,
} from "../../../src/videntia_figma_mcp/utils/gradient-geometry";
import { parseJsx } from "../../../src/videntia_figma_mcp/utils/jsx-to-figma";
import { convertToJsx } from "../../../src/videntia_figma_mcp/utils/figma-to-jsx";

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("directionToCssAngle", () => {
  it.each([
    ["to top", 0],
    ["to right", 90],
    ["to bottom", 180],
    ["to left", 270],
    ["t", 0],
    ["r", 90],
    ["b", 180],
    ["l", 270],
    ["bg-gradient-to-b", 180],
  ])("%s → %d", (dir, angle) => {
    expect(directionToCssAngle(dir as string)).toBe(angle);
  });

  it("corners are 45deg multiples on a square", () => {
    close(directionToCssAngle("to top right")!, 45);
    close(directionToCssAngle("br")!, 135);
    close(directionToCssAngle("to bottom left")!, 225);
    close(directionToCssAngle("tl")!, 315);
    close(directionToCssAngle("to right top")!, 45);
  });

  it("corners depend on aspect ratio (CSS spec)", () => {
    const a = (Math.atan2(100, 400) * 180) / Math.PI;
    close(directionToCssAngle("to top right", 400, 100)!, a);
    close(directionToCssAngle("to bottom right", 400, 100)!, 180 - a);
  });

  it("returns null for junk", () => {
    expect(directionToCssAngle("sideways")).toBeNull();
    expect(directionToCssAngle("to top bottom")).toBeNull();
  });
});

describe("linearGradientTransform / gradientTransformToCssAngle", () => {
  it("round-trips the angle for several sizes", () => {
    for (const angle of [0, 30, 90, 135, 180, 222.5, 270, 315]) {
      for (const [w, h] of [
        [100, 100],
        [300, 80],
        [40, 200],
      ]) {
        expect(gradientTransformToCssAngle(linearGradientTransform(angle, w, h), w, h)).toBeCloseTo(angle, 1);
      }
    }
  });

  it("unit-square transform is centred", () => {
    const t = linearGradientTransform(90);
    close(t[0][0] * 0.5 + t[0][1] * 0.5 + t[0][2], 0.5);
  });

  it("identity reads back as 90deg (Figma's default left → right)", () => {
    expect(
      gradientTransformToCssAngle(
        [
          [1, 0, 0],
          [0, 1, 0],
        ],
        100,
        100,
      ),
    ).toBe(90);
  });
});

describe("stops", () => {
  it("sortGradientStops is stable and by position", () => {
    const sorted = sortGradientStops([
      { id: "a", position: 0.5 },
      { id: "b", position: 0 },
      { id: "c", position: 0.5 },
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["b", "a", "c"]);
  });

  it("distributeStopPositions spreads positionless stops per CSS", () => {
    expect(
      distributeStopPositions([{ position: null }, { position: null }, { position: null }]).map((s) => s.position),
    ).toEqual([0, 0.5, 1]);
    expect(
      distributeStopPositions([{ position: null }, { position: null }, { position: 0.8 }, { position: null }]).map(
        (s) => s.position,
      ),
    ).toEqual([0, 0.4, 0.8, 1]);
    // Positions never go backwards.
    expect(distributeStopPositions([{ position: 0.6 }, { position: 0.2 }]).map((s) => s.position)).toEqual([0.6, 0.6]);
  });
});

describe("parseCssGradient", () => {
  it("parses angles, positionless stops and fractional percentages", () => {
    expect(parseCssGradient("linear-gradient(45deg, #fff, #000)")).toEqual({
      type: "GRADIENT_LINEAR",
      angle: 45,
      stops: [
        { color: "#fff", position: 0 },
        { color: "#000", position: 1 },
      ],
    });
    const p = parseCssGradient("linear-gradient(0.25turn, red 33.3%, rgba(0, 0, 255, 0.5) 66.6%)")!;
    expect(p.angle).toBe(90);
    expect(p.stops).toEqual([
      { color: "red", position: 0.333 },
      { color: "rgba(0, 0, 255, 0.5)", position: 0.666 },
    ]);
  });

  it("parses a `to …` keyword", () => {
    expect(parseCssGradient("linear-gradient(to bottom right, #fff 0%, #000 100%)")!.direction).toBe("to bottom right");
  });

  it("expands two-position stops and skips a radial prelude", () => {
    expect(parseCssGradient("linear-gradient(red 10% 20%, blue)")!.stops).toEqual([
      { color: "red", position: 0.1 },
      { color: "red", position: 0.2 },
      { color: "blue", position: 1 },
    ]);
    expect(parseCssGradient("radial-gradient(circle at center, #fff, #000)")!.stops).toHaveLength(2);
  });
});

describe("JSX round-trip", () => {
  it("parseJsx keeps the angle and positionless stops", () => {
    const nodes = parseJsx('<div id="1:1" name="T" style={{ background: "linear-gradient(90deg, #fff, #000)" }} />');
    expect(nodes[0].fills![0].gradient).toEqual({
      type: "GRADIENT_LINEAR",
      angle: 90,
      stops: [
        { color: "#fff", position: 0 },
        { color: "#000", position: 1 },
      ],
    });
  });

  it("parseJsx accepts Tailwind v4 bg-linear-to-*", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-linear-to-br from-[#FF0000] to-[#0000FF]" />');
    expect(nodes[0].fills![0].gradient?.direction).toBe("br");
  });

  it("figma-to-jsx emits a non-default CSS angle and it survives the round trip", () => {
    const jsx = convertToJsx([
      {
        id: "1:1",
        name: "G",
        type: "FRAME",
        fills: [
          {
            type: "GRADIENT_LINEAR",
            gradient: {
              type: "GRADIENT_LINEAR",
              angle: 45,
              stops: [
                { color: "#ff0000", position: 0 },
                { color: "#0000ff", position: 1 },
              ],
            },
          },
        ],
      } as any,
    ]);
    expect(jsx).toContain("linear-gradient(45deg, #ff0000 0%, #0000ff 100%)");
    expect(parseJsx(jsx)[0].fills![0].gradient?.angle).toBe(45);
  });
});
