import {
  calculateColorScale,
  calculateCompositeColor,
  calculateContrastRatio,
  convertColorFormat,
  normalizedToRgb255,
  rgb255ToNormalized,
  rgbaToHex,
  hexToRgba,
  getWCAGCompliance,
  getContrastRecommendation
} from '../../../src/talk_to_figma_mcp/utils/color-calculations';

describe('Color Calculations', () => {
  describe('calculateCompositeColor', () => {
    it('should correctly composite colors at 50% mix', () => {
      const base = { r: 1.0, g: 0.0, b: 0.0, a: 1.0 };
      const background = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };

      const result = calculateCompositeColor(base, background, 0.5);

      expect(result.r).toBeCloseTo(0.5);
      expect(result.g).toBeCloseTo(0.0);
      expect(result.b).toBeCloseTo(0.0);
      expect(result.a).toBe(1.0);
    });

    it('should correctly composite colors at 100% mix', () => {
      const base = { r: 1.0, g: 0.5, b: 0.3, a: 1.0 };
      const background = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };

      const result = calculateCompositeColor(base, background, 1.0);

      expect(result.r).toBeCloseTo(1.0);
      expect(result.g).toBeCloseTo(0.5);
      expect(result.b).toBeCloseTo(0.3);
    });

    it('should correctly composite colors at 0% mix', () => {
      const base = { r: 1.0, g: 0.5, b: 0.3, a: 1.0 };
      const background = { r: 0.2, g: 0.3, b: 0.4, a: 1.0 };

      const result = calculateCompositeColor(base, background, 0.0);

      expect(result.r).toBeCloseTo(0.2);
      expect(result.g).toBeCloseTo(0.3);
      expect(result.b).toBeCloseTo(0.4);
    });
  });

  describe('calculateColorScale', () => {
    it('should generate all 10 scale levels', () => {
      const base = { r: 0.639, g: 0.902, b: 0.208, a: 1.0 };
      const background = { r: 0.059, g: 0.063, b: 0.067, a: 1.0 };

      const scale = calculateColorScale(base, background);

      expect(Object.keys(scale)).toHaveLength(10);
      expect(scale['50']).toBeDefined();
      expect(scale['100']).toBeDefined();
      expect(scale['900']).toBeDefined();
    });

    it('should have correct values for scale levels', () => {
      const base = { r: 1.0, g: 0.0, b: 0.0, a: 1.0 };
      const background = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };

      const scale = calculateColorScale(base, background);

      // At 50% (0.05 mix), should be very close to background
      expect(scale['50'].r).toBeCloseTo(0.05);

      // At 500 (0.5 mix), should be halfway
      expect(scale['500'].r).toBeCloseTo(0.5);

      // At 900 (0.9 mix), should be very close to base
      expect(scale['900'].r).toBeCloseTo(0.9);
    });
  });

  describe('Color Format Conversions', () => {
    describe('normalizedToRgb255', () => {
      it('should convert normalized to RGB255', () => {
        const color = { r: 0.5, g: 0.75, b: 1.0, a: 1.0 };
        const result = normalizedToRgb255(color);

        expect(result.r).toBe(128);
        expect(result.g).toBe(191);
        expect(result.b).toBe(255);
      });
    });

    describe('rgb255ToNormalized', () => {
      it('should convert RGB255 to normalized', () => {
        const color = { r: 128, g: 191, b: 255 };
        const result = rgb255ToNormalized(color);

        expect(result.r).toBeCloseTo(0.5019, 3);
        expect(result.g).toBeCloseTo(0.749, 2);
        expect(result.b).toBeCloseTo(1.0);
      });
    });

    describe('rgbaToHex', () => {
      it('should convert RGBA to hex', () => {
        const color = { r: 1.0, g: 0.0, b: 0.0, a: 1.0 };
        const hex = rgbaToHex(color);

        expect(hex).toBe('#FF0000');
      });

      it('should handle mid-range values', () => {
        const color = { r: 0.639, g: 0.902, b: 0.208, a: 1.0 };
        const hex = rgbaToHex(color);

        expect(hex).toBe('#A3E635');
      });
    });

    describe('hexToRgba', () => {
      it('should convert hex to RGBA', () => {
        const result = hexToRgba('#FF0000');

        expect(result.r).toBeCloseTo(1.0);
        expect(result.g).toBeCloseTo(0.0);
        expect(result.b).toBeCloseTo(0.0);
        expect(result.a).toBe(1);
      });

      it('should handle hex without #', () => {
        const result = hexToRgba('FF0000');

        expect(result.r).toBeCloseTo(1.0);
        expect(result.g).toBeCloseTo(0.0);
        expect(result.b).toBeCloseTo(0.0);
      });
    });

    describe('convertColorFormat', () => {
      it('should convert normalized to hex', () => {
        const color = { r: 1.0, g: 0.0, b: 0.0, a: 1.0 };
        const result = convertColorFormat(color, 'normalized', 'hex');

        expect(result).toBe('#FF0000');
      });

      it('should convert hex to normalized', () => {
        const result = convertColorFormat('#FF0000', 'hex', 'normalized') as any;

        expect(result.r).toBeCloseTo(1.0);
        expect(result.g).toBeCloseTo(0.0);
        expect(result.b).toBeCloseTo(0.0);
      });
    });
  });

  describe('Contrast Ratio Calculations', () => {
    describe('calculateContrastRatio', () => {
      it('should calculate maximum contrast (white on black)', () => {
        const white = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
        const black = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };

        const ratio = calculateContrastRatio(white, black);

        expect(ratio).toBeCloseTo(21, 0);
      });

      it('should calculate minimum contrast (same color)', () => {
        const color = { r: 0.5, g: 0.5, b: 0.5, a: 1.0 };

        const ratio = calculateContrastRatio(color, color);

        expect(ratio).toBeCloseTo(1, 0);
      });

      it('should calculate moderate contrast', () => {
        const fg = { r: 0.2, g: 0.2, b: 0.2, a: 1.0 };
        const bg = { r: 0.8, g: 0.8, b: 0.8, a: 1.0 };

        const ratio = calculateContrastRatio(fg, bg);

        expect(ratio).toBeGreaterThan(1);
        expect(ratio).toBeLessThan(21);
      });
    });

    describe('getWCAGCompliance', () => {
      it('should pass all levels for 21:1 ratio', () => {
        const compliance = getWCAGCompliance(21);

        expect(compliance.aa_normal).toBe(true);
        expect(compliance.aa_large).toBe(true);
        expect(compliance.aaa_normal).toBe(true);
        expect(compliance.aaa_large).toBe(true);
      });

      it('should pass AA but not AAA for 4.5:1 ratio', () => {
        const compliance = getWCAGCompliance(4.5);

        expect(compliance.aa_normal).toBe(true);
        expect(compliance.aa_large).toBe(true);
        expect(compliance.aaa_normal).toBe(false);
        expect(compliance.aaa_large).toBe(true);
      });

      it('should fail all normal text for 3:1 ratio', () => {
        const compliance = getWCAGCompliance(3);

        expect(compliance.aa_normal).toBe(false);
        expect(compliance.aa_large).toBe(true);
        expect(compliance.aaa_normal).toBe(false);
        expect(compliance.aaa_large).toBe(false);
      });

      it('should fail all levels for 2:1 ratio', () => {
        const compliance = getWCAGCompliance(2);

        expect(compliance.aa_normal).toBe(false);
        expect(compliance.aa_large).toBe(false);
        expect(compliance.aaa_normal).toBe(false);
        expect(compliance.aaa_large).toBe(false);
      });
    });

    describe('getContrastRecommendation', () => {
      it('should pass AA for sufficient contrast', () => {
        const recommendation = getContrastRecommendation(4.5, 'AA');

        expect(recommendation).toContain('Pass WCAG AA');
      });

      it('should fail AA for insufficient contrast', () => {
        const recommendation = getContrastRecommendation(2, 'AA');

        expect(recommendation).toContain('Fail WCAG AA');
      });

      it('should pass AAA for high contrast', () => {
        const recommendation = getContrastRecommendation(7, 'AAA');

        expect(recommendation).toContain('Pass WCAG AAA');
      });

      it('should suggest large text only for borderline contrast', () => {
        const recommendation = getContrastRecommendation(3.5, 'AA');

        expect(recommendation).toContain('large text only');
      });
    });
  });
});
