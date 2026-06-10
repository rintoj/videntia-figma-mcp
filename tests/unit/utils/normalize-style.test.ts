import {
  compareNumeric,
  compareString,
  figmaLetterSpacingPx,
  figmaLineHeightPx,
  hex,
  isTransparent,
  lh,
  normalizeFontWeight,
  primaryFontFamily,
  px,
  within,
} from "../../../src/videntia_figma_mcp/utils/normalize-style";

describe("normalize-style", () => {
  describe("px", () => {
    it("strips px suffix", () => {
      expect(px("16px")).toBe(16);
      expect(px("0.5px")).toBe(0.5);
    });
    it("passes numbers through", () => {
      expect(px(14)).toBe(14);
    });
    it("returns null for unparseable values", () => {
      expect(px(null)).toBeNull();
      expect(px(undefined)).toBeNull();
      expect(px("normal")).toBeNull();
    });
  });

  describe("hex", () => {
    it("normalizes 3-digit hex", () => {
      expect(hex("#f00")).toBe("#ff0000");
    });
    it("keeps 6-digit hex", () => {
      expect(hex("#FF0000")).toBe("#ff0000");
    });
    it("drops alpha from 8-digit hex", () => {
      expect(hex("#ff000080")).toBe("#ff0000");
    });
    it("converts rgb()", () => {
      expect(hex("rgb(255, 0, 0)")).toBe("#ff0000");
    });
    it("converts rgba()", () => {
      expect(hex("rgba(255, 0, 0, 0.5)")).toBe("#ff0000");
    });
    it("converts Figma {r,g,b} colors", () => {
      expect(hex({ r: 1, g: 0, b: 0 })).toBe("#ff0000");
      expect(hex({ r: 0, g: 1, b: 0, a: 1 })).toBe("#00ff00");
    });
    it("returns null for garbage", () => {
      expect(hex("hotpink")).toBeNull();
      expect(hex(null)).toBeNull();
    });
  });

  describe("isTransparent", () => {
    it("detects rgba(...,0)", () => {
      expect(isTransparent("rgba(0, 0, 0, 0)")).toBe(true);
    });
    it("detects 'transparent'", () => {
      expect(isTransparent("transparent")).toBe(true);
    });
    it("rejects non-transparent", () => {
      expect(isTransparent("rgb(0,0,0)")).toBe(false);
      expect(isTransparent("rgba(0,0,0,1)")).toBe(false);
    });
  });

  describe("lh", () => {
    it("resolves 'normal' as fs * 1.2", () => {
      expect(lh("normal", 10)).toBeCloseTo(12);
    });
    it("strips px", () => {
      expect(lh("16px", 14)).toBe(16);
    });
    it("multiplies unitless by font size", () => {
      expect(lh("1.5", 16)).toBe(24);
      expect(lh(1.5, 16)).toBe(24);
    });
    it("handles percent", () => {
      expect(lh("150%", 16)).toBe(24);
    });
    it("returns null when 'normal' has no font size", () => {
      expect(lh("normal", null)).toBeNull();
    });
  });

  describe("figmaLineHeightPx", () => {
    it("returns pixels when unit absent", () => {
      expect(figmaLineHeightPx(18, undefined, 14)).toBe(18);
    });
    it("converts percent", () => {
      expect(figmaLineHeightPx(150, "percent", 16)).toBe(24);
    });
    it("returns null when value missing", () => {
      expect(figmaLineHeightPx(null, undefined, 14)).toBeNull();
    });
  });

  describe("figmaLetterSpacingPx", () => {
    it("returns pixel value", () => {
      expect(figmaLetterSpacingPx(0.5, undefined, 14)).toBe(0.5);
    });
    it("converts percent against font-size", () => {
      expect(figmaLetterSpacingPx(5, "percent", 16)).toBeCloseTo(0.8);
    });
  });

  describe("normalizeFontWeight", () => {
    it("passes numbers through", () => {
      expect(normalizeFontWeight(600)).toBe(600);
    });
    it("aliases bold → 700", () => {
      expect(normalizeFontWeight("bold")).toBe(700);
    });
    it("aliases normal → 400", () => {
      expect(normalizeFontWeight("normal")).toBe(400);
    });
    it("parses numeric strings", () => {
      expect(normalizeFontWeight("500")).toBe(500);
    });
  });

  describe("primaryFontFamily", () => {
    it("takes first family, strips quotes, lowercases", () => {
      expect(primaryFontFamily('"Inter", sans-serif')).toBe("inter");
      expect(primaryFontFamily("Inter, sans-serif")).toBe("inter");
    });
  });

  describe("within", () => {
    it("respects tolerance", () => {
      expect(within(16, 16.3, 0.5)).toBe(true);
      expect(within(16, 17, 0.5)).toBe(false);
    });
  });

  describe("compareNumeric", () => {
    it("✓ when within tolerance", () => {
      const r = compareNumeric("font-size", 14, 14, 0);
      expect(r.status).toBe("✓");
    });
    it("❌ when outside tolerance", () => {
      const r = compareNumeric("line-height", 18, 16, 0.5);
      expect(r.status).toBe("❌");
      expect(r.figma).toBe("18px");
      expect(r.browser).toBe("16px");
    });
    it("— when either is null", () => {
      expect(compareNumeric("x", null, 16, 0).status).toBe("—");
      expect(compareNumeric("x", 16, null, 0).status).toBe("—");
    });
  });

  describe("compareString", () => {
    it("✓ on equality", () => {
      expect(compareString("color", "#ff0000", "#ff0000").status).toBe("✓");
    });
    it("❌ on mismatch", () => {
      expect(compareString("color", "#ff0000", "#00ff00").status).toBe("❌");
    });
    it("— when missing", () => {
      expect(compareString("color", null, null).status).toBe("—");
    });
  });
});
