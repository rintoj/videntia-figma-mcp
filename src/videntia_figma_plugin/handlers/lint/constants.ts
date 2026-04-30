export const MAX_LINT_DEPTH = 50;
export const MAX_LINT_VIOLATIONS = 500;

export const COLOR_EXACT_THRESHOLD = 0.005; // ~1/255 per channel — treat as identical
export const COLOR_NEAR_THRESHOLD = 0.18; // ~46/255 across channels — reasonable match
export const COLOR_SEMANTIC_BONUS = 0.08; // effective distance reduction for semantic names

export const COLOR_SEMANTIC_KEYWORDS: Record<string, string[]> = {
  backgroundFills: [
    "surface",
    "background",
    "bg",
    "fill",
    "base",
    "canvas",
    "card",
    "overlay",
    "panel",
    "container",
    "layer",
    "level",
  ],
  iconColors: ["icon", "foreground", "fg", "on-", "content", "symbol", "glyph"],
  strokesBorders: ["stroke", "border", "outline", "divider", "separator", "line", "ring", "frame"],
};

export const FLOAT_SEMANTIC_KEYWORDS: Record<string, string[]> = {
  spacing: ["spacing", "space", "gap", "padding", "margin", "indent", "inset", "gutter"],
  borderRadius: ["radius", "round", "corner", "rounded", "curve"],
  typography: ["font-size", "fontsize", "font-scale", "text-size", "size", "scale", "type"],
};

export const DEVICE_SIZES = [
  { name: "desktop", width: 1440, minHeight: 900 },
  { name: "tablet", width: 768, minHeight: 1024 },
  { name: "mobile", width: 375, minHeight: 812 },
];

export const DIM_TOLERANCE = 2;

// Screen naming convention: Screen/{Feature}@{Breakpoint}/{View}[/{State}...]
// Each segment is PascalKebab (starts uppercase, kebab-case), breakpoint is @sm|@md|@lg
export const SCREEN_NAME_PATTERN =
  /^Screen\/[A-Z][A-Za-z0-9]*(-[A-Za-z0-9]+)*@(sm|md|lg)\/[A-Z][A-Za-z0-9]*(-[A-Za-z0-9]+)*(\/[A-Z][A-Za-z0-9]*(-[A-Za-z0-9]+)*)*$/;
export const VALID_BREAKPOINTS = ["sm", "md", "lg"];
