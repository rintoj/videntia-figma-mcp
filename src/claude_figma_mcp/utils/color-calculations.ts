/**
 * Color calculation utilities for Figma theme variables
 * Handles color compositing, contrast ratios, and format conversions
 */

export interface RGBAColor {
  r: number; // 0-1
  g: number; // 0-1
  b: number; // 0-1
  a?: number; // 0-1, optional (defaults to 1)
}

export interface ColorScale {
  50: RGBAColor;
  100: RGBAColor;
  200: RGBAColor;
  300: RGBAColor;
  400: RGBAColor;
  500: RGBAColor;
  600: RGBAColor;
  700: RGBAColor;
  800: RGBAColor;
  900: RGBAColor;
}

export const SCALE_MIX_PERCENTAGES = {
  50: 0.05,
  100: 0.1,
  200: 0.2,
  300: 0.3,
  400: 0.4,
  500: 0.5,
  600: 0.6,
  700: 0.7,
  800: 0.8,
  900: 0.9,
};

/**
 * Calculate a single composited color at a specific mix percentage
 * Formula: resultant RGB = (base × mix%) + (background × (1 - mix%))
 */
export function calculateCompositeColor(
  baseColor: RGBAColor,
  backgroundColor: RGBAColor,
  mixPercentage: number,
): RGBAColor {
  const mix = Math.max(0, Math.min(1, mixPercentage));
  const invMix = 1 - mix;

  return {
    r: baseColor.r * mix + backgroundColor.r * invMix,
    g: baseColor.g * mix + backgroundColor.g * invMix,
    b: baseColor.b * mix + backgroundColor.b * invMix,
    a: 1.0,
  };
}

/**
 * Calculate all 10 scale variants (-50 to -900) for a base color
 */
export function calculateColorScale(baseColor: RGBAColor, backgroundColor: RGBAColor): ColorScale {
  const scale: any = {};

  for (const [level, mixPercentage] of Object.entries(SCALE_MIX_PERCENTAGES)) {
    scale[level] = calculateCompositeColor(baseColor, backgroundColor, mixPercentage);
  }

  return scale as ColorScale;
}

/**
 * Convert normalized RGB (0-1) to RGB255 (0-255)
 */
export function normalizedToRgb255(color: RGBAColor): { r: number; g: number; b: number; a: number } {
  return {
    r: Math.round(color.r * 255),
    g: Math.round(color.g * 255),
    b: Math.round(color.b * 255),
    a: color.a ?? 1,
  };
}

/**
 * Convert RGB255 (0-255) to normalized RGB (0-1)
 */
export function rgb255ToNormalized(color: { r: number; g: number; b: number; a?: number }): RGBAColor {
  return {
    r: color.r / 255,
    g: color.g / 255,
    b: color.b / 255,
    a: color.a ?? 1,
  };
}

/**
 * Convert RGBA to hex color string
 */
export function rgbaToHex(color: RGBAColor): string {
  const rgb255 = normalizedToRgb255(color);
  const toHex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(rgb255.r)}${toHex(rgb255.g)}${toHex(rgb255.b)}`;
}

/**
 * Convert hex color string to RGBA
 */
export function hexToRgba(hex: string): RGBAColor {
  const cleanHex = hex.replace("#", "");
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);

  return {
    r: r / 255,
    g: g / 255,
    b: b / 255,
    a: 1,
  };
}

/**
 * Calculate relative luminance for a color (WCAG formula)
 */
function getRelativeLuminance(color: RGBAColor): number {
  const linearize = (val: number) => {
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
  };

  const r = linearize(color.r);
  const g = linearize(color.g);
  const b = linearize(color.b);

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculate WCAG contrast ratio between two colors
 */
export function calculateContrastRatio(foreground: RGBAColor, background: RGBAColor): number {
  const lum1 = getRelativeLuminance(foreground);
  const lum2 = getRelativeLuminance(background);

  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Get WCAG compliance levels for a contrast ratio
 */
export interface WCAGCompliance {
  aa_normal: boolean; // 4.5:1
  aa_large: boolean; // 3:1
  aaa_normal: boolean; // 7:1
  aaa_large: boolean; // 4.5:1
}

export function getWCAGCompliance(ratio: number): WCAGCompliance {
  return {
    aa_normal: ratio >= 4.5,
    aa_large: ratio >= 3.0,
    aaa_normal: ratio >= 7.0,
    aaa_large: ratio >= 4.5,
  };
}

/**
 * Get recommendation text for a contrast ratio
 */
export function getContrastRecommendation(ratio: number, standard: "AA" | "AAA" = "AA"): string {
  const compliance = getWCAGCompliance(ratio);

  if (standard === "AA") {
    if (compliance.aa_normal) {
      return "Pass WCAG AA for normal text";
    } else if (compliance.aa_large) {
      return "Pass WCAG AA for large text only";
    } else {
      return `Fail WCAG AA - needs ${(4.5 / ratio).toFixed(2)}× more contrast (4.5:1 required)`;
    }
  } else {
    if (compliance.aaa_normal) {
      return "Pass WCAG AAA for normal text";
    } else if (compliance.aaa_large) {
      return "Pass WCAG AAA for large text only";
    } else {
      return `Fail WCAG AAA - needs ${(7.0 / ratio).toFixed(2)}× more contrast (7:1 required)`;
    }
  }
}

/**
 * Convert color format
 */
export function convertColorFormat(
  color: RGBAColor | string,
  fromFormat: "normalized" | "rgb255" | "hex",
  toFormat: "normalized" | "rgb255" | "hex",
): RGBAColor | { r: number; g: number; b: number; a: number } | string {
  let normalized: RGBAColor;

  // Convert to normalized first
  if (fromFormat === "hex") {
    normalized = hexToRgba(color as string);
  } else if (fromFormat === "rgb255") {
    normalized = rgb255ToNormalized(color as any);
  } else {
    normalized = color as RGBAColor;
  }

  // Convert from normalized to target format
  if (toFormat === "hex") {
    return rgbaToHex(normalized);
  } else if (toFormat === "rgb255") {
    return normalizedToRgb255(normalized);
  } else {
    return normalized;
  }
}
