import { parseHexColor, resolveColor } from "../../../src/claude_mcp_plugin/handlers/fills";

describe("parseHexColor", () => {
  it("parses 6-digit hex", () => {
    expect(parseHexColor("#ff0000")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it("parses 6-digit hex without #", () => {
    expect(parseHexColor("00ff00")).toEqual({ r: 0, g: 1, b: 0, a: 1 });
  });

  it("parses 3-digit hex shorthand", () => {
    expect(parseHexColor("#f00")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it("parses 8-digit hex with alpha", () => {
    const result = parseHexColor("#ff000080");
    expect(result).not.toBeNull();
    expect(result!.r).toBeCloseTo(1);
    expect(result!.g).toBeCloseTo(0);
    expect(result!.b).toBeCloseTo(0);
    expect(result!.a).toBeCloseTo(128 / 255);
  });

  it("parses 4-digit hex shorthand with alpha", () => {
    const result = parseHexColor("#f008");
    expect(result).not.toBeNull();
    expect(result!.r).toBeCloseTo(1);
    expect(result!.g).toBeCloseTo(0);
    expect(result!.b).toBeCloseTo(0);
    expect(result!.a).toBeCloseTo(0x88 / 255);
  });

  it("returns null for empty string", () => {
    expect(parseHexColor("")).toBeNull();
  });

  it("returns null for invalid characters", () => {
    expect(parseHexColor("#xyz123")).toBeNull();
  });

  it("returns null for 5-char hex", () => {
    expect(parseHexColor("#12345")).toBeNull();
  });

  it("returns null for 7-char hex", () => {
    expect(parseHexColor("#1234567")).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(parseHexColor(123 as any)).toBeNull();
  });

  it("parses black correctly", () => {
    expect(parseHexColor("#000000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it("parses white correctly", () => {
    expect(parseHexColor("#ffffff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
  });

  it("parses fully transparent", () => {
    expect(parseHexColor("#00000000")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});

describe("resolveColor", () => {
  it("resolves hex string from color param", () => {
    const result = resolveColor({ color: "#ff0000" });
    expect(result).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it("resolves wrapped object { color: { r, g, b, a } }", () => {
    const result = resolveColor({ color: { r: 0.5, g: 0.3, b: 0.1, a: 0.8 } });
    expect(result).toEqual({ r: 0.5, g: 0.3, b: 0.1, a: 0.8 });
  });

  it("resolves flat { r, g, b, a }", () => {
    const result = resolveColor({ r: 0.2, g: 0.4, b: 0.6, a: 0.9 });
    expect(result).toEqual({ r: 0.2, g: 0.4, b: 0.6, a: 0.9 });
  });

  it("defaults alpha to 1 for flat params without a", () => {
    const result = resolveColor({ r: 0.2, g: 0.4, b: 0.6 });
    expect(result).toEqual({ r: 0.2, g: 0.4, b: 0.6, a: 1 });
  });

  it("throws for invalid hex string", () => {
    expect(() => resolveColor({ color: "#xyz" })).toThrow("Invalid hex color");
  });

  it("throws when no color and no r,g,b", () => {
    expect(() => resolveColor({})).toThrow();
  });

  it("throws when r,g,b partially missing", () => {
    expect(() => resolveColor({ r: 0.5, g: 0.5 })).toThrow();
  });
});
