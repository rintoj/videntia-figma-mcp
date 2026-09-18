import { toRgba, toHex, ColorInputSchema } from "../../../src/videntia_figma_mcp/utils/color-input";

describe("toRgba — accepted forms", () => {
  it("parses 6-digit hex", () => {
    expect(toRgba("#ff0000")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it("parses 3-digit shorthand hex", () => {
    expect(toRgba("#f00")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it("parses 8-digit hex with alpha", () => {
    const c = toRgba("#ff000080");
    expect(c.r).toBe(1);
    expect(c.a).toBeCloseTo(128 / 255);
  });

  it("parses 4-digit shorthand hex with alpha", () => {
    const c = toRgba("#f008");
    expect(c.r).toBe(1);
    expect(c.a).toBeCloseTo(136 / 255);
  });

  it("parses hex without a leading #", () => {
    expect(toRgba("00ff00")).toEqual({ r: 0, g: 1, b: 0, a: 1 });
  });

  it("accepts a 0-1 object", () => {
    expect(toRgba({ r: 0.2, g: 0.4, b: 0.6, a: 0.5 })).toEqual({ r: 0.2, g: 0.4, b: 0.6, a: 0.5 });
  });

  it("accepts a 0-1 object with no alpha (defaults opaque)", () => {
    expect(toRgba({ r: 0, g: 0, b: 0 })).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it("accepts a 0-255 object", () => {
    expect(toRgba({ r: 255, g: 128, b: 0 })).toEqual({ r: 1, g: 128 / 255, b: 0, a: 1 });
  });

  it("accepts a 0-255 object with a 0-255 alpha", () => {
    const c = toRgba({ r: 255, g: 0, b: 0, a: 128 });
    expect(c.a).toBeCloseTo(128 / 255);
  });

  it("keeps a: 1 opaque inside a 0-255 color", () => {
    expect(toRgba({ r: 255, g: 255, b: 255, a: 1 })).toEqual({ r: 1, g: 1, b: 1, a: 1 });
  });

  it("accepts long-form channel names", () => {
    expect(toRgba({ red: 255, green: 0, blue: 0, alpha: 1 })).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it("accepts numeric strings inside an object", () => {
    expect(toRgba({ r: "255", g: "0", b: "0" })).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it("accepts a 3-entry array", () => {
    expect(toRgba([1, 0, 0])).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it("accepts a 4-entry array", () => {
    expect(toRgba([0, 0, 0, 0])).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("accepts a 0-255 array", () => {
    expect(toRgba([0, 255, 0])).toEqual({ r: 0, g: 1, b: 0, a: 1 });
  });
});

describe("toRgba — 0-1 vs 0-255 disambiguation", () => {
  it("treats any channel > 1 as 0-255", () => {
    expect(toRgba({ r: 2, g: 0, b: 0 })).toEqual({ r: 2 / 255, g: 0, b: 0, a: 1 });
  });

  it("treats all-channels <= 1 as already normalized — {r:1,g:1,b:1} is WHITE", () => {
    expect(toRgba({ r: 1, g: 1, b: 1 })).toEqual({ r: 1, g: 1, b: 1, a: 1 });
  });

  it("black is black under either reading", () => {
    expect(toRgba({ r: 0, g: 0, b: 0 })).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it("{r:1,g:0,b:0} is full red, not rgb(1,0,0)", () => {
    expect(toRgba({ r: 1, g: 0, b: 0 })).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it("the ambiguous 0-255 triple (1,1,1) must be given as hex", () => {
    const c = toRgba("#010101");
    expect(c.r).toBeCloseTo(1 / 255);
  });
});

describe("toRgba — error path (never NaN)", () => {
  const bad: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
    ["non-hex string", "red"],
    ["bad hex length", "#ff00f"],
    ["non-hex characters", "#gggggg"],
    ["object missing b", { r: 1, g: 1 }],
    ["object with NaN channel", { r: "abc", g: 0, b: 0 }],
    ["negative channel", { r: -1, g: 0, b: 0 }],
    ["channel above 255", { r: 300, g: 0, b: 0 }],
    ["2-entry array", [1, 0]],
    ["5-entry array", [1, 0, 0, 1, 1]],
    ["array with a non-number", ["x", 0, 0]],
    ["a number", 42],
    ["a boolean", true],
  ];

  it.each(bad)("throws for %s instead of returning NaN", (_label, value) => {
    expect(() => toRgba(value)).toThrow(/Invalid color/);
  });

  it("names what it received and lists the accepted forms", () => {
    let message = "";
    try {
      toRgba("nope");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('"nope"');
    expect(message).toContain("hex string");
    expect(message).toContain("0–255");
    expect(message).not.toContain("NaN");
  });

  it("never produces NaN for any accepted form", () => {
    const inputs: unknown[] = ["#fff", "#ff000080", { r: 1, g: 1, b: 1 }, { r: 255, g: 0, b: 0 }, [0.5, 0.5, 0.5]];
    for (const input of inputs) {
      const c = toRgba(input);
      expect(Number.isNaN(c.r + c.g + c.b + c.a)).toBe(false);
    }
  });
});

describe("toHex", () => {
  it("round-trips an opaque color", () => {
    expect(toHex({ r: 255, g: 0, b: 0 })).toBe("#ff0000");
  });

  it("appends alpha when translucent", () => {
    expect(toHex({ r: 0, g: 0, b: 0, a: 0 })).toBe("#00000000");
  });
});

describe("ColorInputSchema declares every accepted form", () => {
  // Zod silently strips undeclared keys — every runtime form MUST be in the union.
  it.each([
    ["hex string", "#ff0000"],
    ["0-1 object", { r: 1, g: 0, b: 0, a: 1 }],
    ["0-255 object", { r: 255, g: 0, b: 0 }],
    ["array", [1, 0, 0]],
  ])("parses a %s without stripping it", (_label, value) => {
    const parsed = ColorInputSchema.parse(value);
    expect(parsed).toBeDefined();
    expect(() => toRgba(parsed)).not.toThrow();
  });

  it("keeps all object channels (no silent key stripping)", () => {
    const parsed = ColorInputSchema.parse({ r: 255, g: 128, b: 64, a: 255 }) as Record<string, number>;
    expect(parsed).toEqual({ r: 255, g: 128, b: 64, a: 255 });
  });
});
