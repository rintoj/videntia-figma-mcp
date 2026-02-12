/**
 * Design Token Presets for Spacing, Typography, and Border Radius
 *
 * This file contains standard token presets that can be applied to design systems.
 * Based on industry standards like Tailwind CSS, Material Design, and Bootstrap.
 */

// ========================================
// SPACING PRESETS
// ========================================

/**
 * 8-Point Grid System
 * Every value is a multiple of 8px (or 4px for half-steps)
 * Used by: Material Design, many modern design systems
 */
export const SPACING_8PT = {
  0: 0,
  1: 4,   // 0.5 units
  2: 8,   // 1 unit
  3: 12,  // 1.5 units
  4: 16,  // 2 units
  5: 20,  // 2.5 units
  6: 24,  // 3 units
  7: 28,  // 3.5 units
  8: 32,  // 4 units
  10: 40, // 5 units
  12: 48, // 6 units
  16: 64, // 8 units
  20: 80, // 10 units
  24: 96, // 12 units
  32: 128, // 16 units
  40: 160, // 20 units
  48: 192, // 24 units
  56: 224, // 28 units
  64: 256  // 32 units
} as const;

/**
 * 4-Point Grid System
 * Finer granularity for detailed spacing control
 * Used by: Tailwind CSS
 */
export const SPACING_4PT = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  9: 36,
  10: 40,
  11: 44,
  12: 48,
  14: 56,
  16: 64,
  20: 80,
  24: 96,
  28: 112,
  32: 128,
  36: 144,
  40: 160,
  44: 176,
  48: 192,
  52: 208,
  56: 224,
  60: 240,
  64: 256,
  72: 288,
  80: 320,
  96: 384
} as const;

export type SpacingScale = typeof SPACING_8PT | typeof SPACING_4PT;

// ========================================
// TYPOGRAPHY PRESETS
// ========================================

/**
 * Type Scale Ratios
 * Defines the multiplier between type sizes
 */
export const TYPE_SCALE_RATIOS = {
  "minor-second": 1.067,
  "major-second": 1.125,
  "minor-third": 1.200,
  "major-third": 1.250,
  "perfect-fourth": 1.333,
  "augmented-fourth": 1.414,
  "perfect-fifth": 1.500,
  "golden-ratio": 1.618
} as const;

export type TypeScaleRatio = keyof typeof TYPE_SCALE_RATIOS;

/**
 * Generate type scale based on ratio and base size
 */
export function generateTypeScale(baseSize: number, ratio: number, steps: number = 7): number[] {
  const scale: number[] = [];

  // Generate smaller sizes (below base)
  for (let i = 2; i > 0; i--) {
    scale.push(parseFloat((baseSize / Math.pow(ratio, i)).toFixed(2)));
  }

  // Add base size
  scale.push(baseSize);

  // Generate larger sizes (above base)
  for (let i = 1; i <= steps - 3; i++) {
    scale.push(parseFloat((baseSize * Math.pow(ratio, i)).toFixed(2)));
  }

  return scale;
}

/**
 * Major Third Scale (1.25 ratio)
 * Most common, balanced scale
 * Used by: Many design systems
 */
export const TYPE_SCALE_MAJOR_THIRD = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 20,
  xl: 25,
  "2xl": 31,
  "3xl": 39,
  "4xl": 49,
  "5xl": 61
} as const;

/**
 * Perfect Fourth Scale (1.333 ratio)
 * Larger contrast between sizes
 * Used by: Headings-heavy designs
 */
export const TYPE_SCALE_PERFECT_FOURTH = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 21,
  xl: 28,
  "2xl": 37,
  "3xl": 50,
  "4xl": 66,
  "5xl": 88
} as const;

/**
 * Minor Third Scale (1.2 ratio)
 * Subtle, refined scale
 * Used by: Text-heavy applications
 */
export const TYPE_SCALE_MINOR_THIRD = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 19,
  xl: 23,
  "2xl": 28,
  "3xl": 33,
  "4xl": 40,
  "5xl": 48
} as const;

/**
 * Font Weights
 * Standard weight values
 */
export const FONT_WEIGHTS = {
  thin: 100,
  extralight: 200,
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900
} as const;

/**
 * Line Heights
 * Relative line height values
 */
export const LINE_HEIGHTS = {
  none: 1,
  tight: 1.25,
  snug: 1.375,
  normal: 1.5,
  relaxed: 1.625,
  loose: 2
} as const;

/**
 * Letter Spacing
 * Tracking values in em
 */
export const LETTER_SPACING = {
  tighter: -0.05,
  tight: -0.025,
  normal: 0,
  wide: 0.025,
  wider: 0.05,
  widest: 0.1
} as const;

// ========================================
// BORDER RADIUS PRESETS
// ========================================

/**
 * Standard Border Radius Scale
 * Used by: Tailwind CSS, Bootstrap, many others
 */
export const BORDER_RADIUS_STANDARD = {
  none: 0,
  sm: 4,
  DEFAULT: 8,
  md: 8,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
  full: 9999
} as const;

/**
 * Subtle Border Radius Scale
 * Smaller, more refined corners
 */
export const BORDER_RADIUS_SUBTLE = {
  none: 0,
  sm: 2,
  DEFAULT: 4,
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  full: 9999
} as const;

/**
 * Bold Border Radius Scale
 * Larger, more prominent corners
 */
export const BORDER_RADIUS_BOLD = {
  none: 0,
  sm: 8,
  DEFAULT: 16,
  md: 20,
  lg: 24,
  xl: 32,
  "2xl": 48,
  full: 9999
} as const;

export type BorderRadiusScale = typeof BORDER_RADIUS_STANDARD | typeof BORDER_RADIUS_SUBTLE | typeof BORDER_RADIUS_BOLD;

// ========================================
// PRESET COMBINATIONS
// ========================================

/**
 * Tailwind-inspired Preset
 */
export const TAILWIND_PRESET = {
  spacing: SPACING_4PT,
  typography: TYPE_SCALE_MAJOR_THIRD,
  radius: BORDER_RADIUS_STANDARD,
  fonts: {
    sans: "Inter, system-ui, sans-serif",
    serif: "Georgia, serif",
    mono: "Menlo, monospace"
  }
} as const;

/**
 * Material Design-inspired Preset
 */
export const MATERIAL_PRESET = {
  spacing: SPACING_8PT,
  typography: TYPE_SCALE_MAJOR_THIRD,
  radius: BORDER_RADIUS_STANDARD,
  fonts: {
    sans: "Roboto, system-ui, sans-serif",
    mono: "Roboto Mono, monospace"
  }
} as const;

/**
 * Bootstrap-inspired Preset
 */
export const BOOTSTRAP_PRESET = {
  spacing: SPACING_4PT,
  typography: TYPE_SCALE_MINOR_THIRD,
  radius: BORDER_RADIUS_SUBTLE,
  fonts: {
    sans: "system-ui, -apple-system, sans-serif",
    mono: "SFMono-Regular, monospace"
  }
} as const;

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Get spacing preset by name
 */
export function getSpacingPreset(preset: "4pt" | "8pt" | "tailwind" | "material"): typeof SPACING_8PT | typeof SPACING_4PT {
  switch (preset) {
    case "4pt":
    case "tailwind":
      return SPACING_4PT;
    case "8pt":
    case "material":
      return SPACING_8PT;
    default:
      return SPACING_8PT;
  }
}

/**
 * Get typography preset by name
 */
export function getTypographyPreset(preset: "major-third" | "minor-third" | "perfect-fourth") {
  switch (preset) {
    case "major-third":
      return TYPE_SCALE_MAJOR_THIRD;
    case "minor-third":
      return TYPE_SCALE_MINOR_THIRD;
    case "perfect-fourth":
      return TYPE_SCALE_PERFECT_FOURTH;
    default:
      return TYPE_SCALE_MAJOR_THIRD;
  }
}

/**
 * Get border radius preset by name
 */
export function getRadiusPreset(preset: "standard" | "subtle" | "bold"): BorderRadiusScale {
  switch (preset) {
    case "subtle":
      return BORDER_RADIUS_SUBTLE;
    case "bold":
      return BORDER_RADIUS_BOLD;
    case "standard":
    default:
      return BORDER_RADIUS_STANDARD;
  }
}

/**
 * Generate semantic spacing tokens
 */
export function generateSemanticSpacing() {
  return {
    // Component internal spacing
    "component.gap.xs": "spacing.1",
    "component.gap.sm": "spacing.2",
    "component.gap.md": "spacing.4",
    "component.gap.lg": "spacing.6",
    "component.gap.xl": "spacing.8",

    "component.padding.xs": "spacing.2",
    "component.padding.sm": "spacing.3",
    "component.padding.md": "spacing.4",
    "component.padding.lg": "spacing.6",
    "component.padding.xl": "spacing.8",

    // Layout spacing
    "layout.gap.sm": "spacing.4",
    "layout.gap.md": "spacing.6",
    "layout.gap.lg": "spacing.8",
    "layout.gap.xl": "spacing.12",

    "layout.margin.sm": "spacing.4",
    "layout.margin.md": "spacing.8",
    "layout.margin.lg": "spacing.12",
    "layout.margin.xl": "spacing.16"
  };
}

/**
 * Generate semantic typography tokens
 */
export function generateSemanticTypography() {
  return {
    // Headings
    "heading.1.size": "font.size.5xl",
    "heading.2.size": "font.size.4xl",
    "heading.3.size": "font.size.3xl",
    "heading.4.size": "font.size.2xl",
    "heading.5.size": "font.size.xl",
    "heading.6.size": "font.size.lg",

    "heading.1.weight": "font.weight.bold",
    "heading.2.weight": "font.weight.bold",
    "heading.3.weight": "font.weight.semibold",
    "heading.4.weight": "font.weight.semibold",
    "heading.5.weight": "font.weight.medium",
    "heading.6.weight": "font.weight.medium",

    // Body text
    "body.large.size": "font.size.lg",
    "body.base.size": "font.size.base",
    "body.small.size": "font.size.sm",
    "body.tiny.size": "font.size.xs",

    // Line heights
    "heading.lineHeight": "font.lineHeight.tight",
    "body.lineHeight": "font.lineHeight.normal",
    "caption.lineHeight": "font.lineHeight.snug"
  };
}
