import { applyDefault, applyColorDefaults, FIGMA_DEFAULTS } from "../../../src/videntia_figma_mcp/utils/defaults";
import { testColors, expectedColorWithDefaults } from "../../fixtures/test-data";

describe("defaults utilities", () => {
  describe("applyDefault", () => {
    it("should return the original value when defined", () => {
      expect(applyDefault(0, 1)).toBe(0);
      expect(applyDefault(false, true)).toBe(false);
      expect(applyDefault("", "default")).toBe("");
      expect(applyDefault(null, "default")).toBe(null);
    });

    it("should return the default value when undefined", () => {
      expect(applyDefault(undefined, 1)).toBe(1);
      expect(applyDefault(undefined, "default")).toBe("default");
      expect(applyDefault(undefined, false)).toBe(false);
    });

    it("should preserve falsy values (the critical fix)", () => {
      expect(applyDefault(0, 999)).toBe(0);
      expect(applyDefault(false, true)).toBe(false);
      expect(applyDefault("", "fallback")).toBe("");
    });

    it("should work with different types", () => {
      expect(applyDefault(42, 0)).toBe(42);
      expect(applyDefault("hello", "world")).toBe("hello");
      expect(applyDefault({ a: 1 }, { b: 2 })).toEqual({ a: 1 });
    });
  });

  describe("applyColorDefaults", () => {
    it("should preserve opacity 0 (transparency)", () => {
      const result = applyColorDefaults(testColors.fullyTransparent);
      expect(result).toEqual(expectedColorWithDefaults.fullyTransparent);
      expect(result.a).toBe(0); // Critical: should be 0, not 1
    });

    it("should preserve opacity 1 (opaque)", () => {
      const result = applyColorDefaults(testColors.fullyOpaque);
      expect(result).toEqual(expectedColorWithDefaults.fullyOpaque);
      expect(result.a).toBe(1);
    });

    it("should preserve semi-transparent values", () => {
      const result = applyColorDefaults(testColors.semiTransparent);
      expect(result).toEqual(expectedColorWithDefaults.semiTransparent);
      expect(result.a).toBe(0.5);
    });

    it("should default undefined opacity to 1", () => {
      const result = applyColorDefaults(testColors.undefinedOpacity);
      expect(result).toEqual(expectedColorWithDefaults.undefinedOpacity);
      expect(result.a).toBe(1);
    });

    it("should preserve RGB values exactly", () => {
      const result = applyColorDefaults(testColors.pureBlack);
      expect(result.r).toBe(0);
      expect(result.g).toBe(0);
      expect(result.b).toBe(0);
    });

    it("should handle all RGB edge cases", () => {
      Object.keys(testColors).forEach((colorKey) => {
        const input = testColors[colorKey];
        const expected = expectedColorWithDefaults[colorKey];
        const result = applyColorDefaults(input);

        expect(result).toEqual(expected);

        expect(result.r).toBe(input.r);
        expect(result.g).toBe(input.g);
        expect(result.b).toBe(input.b);

        // Ensure alpha is either preserved or defaulted correctly
        if (input.a !== undefined) {
          expect(result.a).toBe(input.a);
        } else {
          expect(result.a).toBe(FIGMA_DEFAULTS.color.opacity);
        }
      });
    });

    it("should work with zero RGB components", () => {
      const colors = [testColors.noRed, testColors.noGreen, testColors.noBlue];

      colors.forEach((color) => {
        const result = applyColorDefaults(color);
        expect(result.r).toBe(color.r);
        expect(result.g).toBe(color.g);
        expect(result.b).toBe(color.b);
        expect(result.a).toBe(color.a);
      });
    });
  });

  describe("FIGMA_DEFAULTS", () => {
    it("should be a const object with expected structure", () => {
      expect(FIGMA_DEFAULTS).toHaveProperty("color");
      expect(FIGMA_DEFAULTS.color).toHaveProperty("opacity");
      expect(typeof FIGMA_DEFAULTS.color.opacity).toBe("number");

      expect(FIGMA_DEFAULTS).toHaveProperty("stroke");
      expect(FIGMA_DEFAULTS.stroke).toHaveProperty("weight");
      expect(typeof FIGMA_DEFAULTS.stroke.weight).toBe("number");
    });
  });

  describe("applyDefault with stroke weight scenarios", () => {
    it("should preserve strokeWeight 0.5 (thin stroke)", () => {
      const result = applyDefault(0.5, FIGMA_DEFAULTS.stroke.weight);
      expect(result).toBe(0.5);
    });

    it("should preserve strokeWeight 10 (thick stroke)", () => {
      const result = applyDefault(10, FIGMA_DEFAULTS.stroke.weight);
      expect(result).toBe(10);
    });

    it("should default undefined strokeWeight to 1", () => {
      const result = applyDefault(undefined, FIGMA_DEFAULTS.stroke.weight);
      expect(result).toBe(1);
    });

    it("should preserve strokeWeight with decimal precision", () => {
      const result = applyDefault(2.75, FIGMA_DEFAULTS.stroke.weight);
      expect(result).toBe(2.75);
    });
  });
});
