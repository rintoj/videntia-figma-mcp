// Figma MCP plugin.

import type { RgbColor, RgbaColor, VariableResolvedType, VariableValue } from "../types";

// ---------------------------------------------------------------------------
// SVG color string → Figma RGB object
// ---------------------------------------------------------------------------

/**
 * Convert an SVG color string (hex / rgb / rgba / named) to a Figma
 * `{r, g, b}` object where each component is in the 0–1 range.
 */
export function svgColorToFigmaRgb(colorStr: string): RgbColor {
  if (!colorStr) return { r: 0, g: 0, b: 0 };
  const s = colorStr.trim().toLowerCase();

  if (s.charAt(0) === "#") {
    let hex = s.slice(1);
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    return {
      r: parseInt(hex.substring(0, 2), 16) / 255,
      g: parseInt(hex.substring(2, 4), 16) / 255,
      b: parseInt(hex.substring(4, 6), 16) / 255,
    };
  }

  const rgbMatch = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1]) / 255,
      g: parseInt(rgbMatch[2]) / 255,
      b: parseInt(rgbMatch[3]) / 255,
    };
  }

  const named: Record<string, RgbColor> = {
    black: { r: 0, g: 0, b: 0 },
    white: { r: 1, g: 1, b: 1 },
    red: { r: 1, g: 0, b: 0 },
    green: { r: 0, g: 0.5, b: 0 },
    blue: { r: 0, g: 0, b: 1 },
    gray: { r: 0.5, g: 0.5, b: 0.5 },
    grey: { r: 0.5, g: 0.5, b: 0.5 },
  };

  return named[s] !== undefined ? named[s] : { r: 0, g: 0, b: 0 };
}

// ---------------------------------------------------------------------------
// Euclidean distance between two RGB colours (0–1 range)
// ---------------------------------------------------------------------------

/**
 * Returns the Euclidean distance between two RGB colour objects.
 * Components are expected to be in the 0–1 range.
 */
export function colorDist(c1: RgbColor, c2: RgbColor): number {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// ---------------------------------------------------------------------------
// Variable value formatter
// ---------------------------------------------------------------------------

/**
 * Normalise a raw Figma variable value for transport / display.
 * For COLOR variables the alpha channel defaults to 1 when absent.
 */
export function formatVariableValue(value: VariableValue, type: VariableResolvedType): VariableValue {
  if (
    type === "COLOR" &&
    value !== null &&
    value !== undefined &&
    typeof value === "object" &&
    "r" in (value as object)
  ) {
    const colorValue = value as RgbaColor;
    return {
      r: colorValue.r,
      g: colorValue.g,
      b: colorValue.b,
      a: colorValue.a !== undefined ? colorValue.a : 1,
    };
  }
  return value;
}
