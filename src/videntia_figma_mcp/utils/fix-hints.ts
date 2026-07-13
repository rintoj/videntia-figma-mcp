// Heuristic fix hints for style mismatch rows. When the element's class list is
// known and contains a recognizable Tailwind utility, the hint names the exact
// class swap; otherwise it falls back to a plain CSS instruction.

import { CompareRow } from "./normalize-style.js";
import { FigmaNodeLike } from "./figma-to-css-rows.js";

export interface FixHintContext {
  className?: string;
  figmaNode?: FigmaNodeLike;
}

// Tailwind default font-size scale (px → suffix).
const FONT_SIZE_SCALE: Record<number, string> = {
  12: "xs",
  14: "sm",
  16: "base",
  18: "lg",
  20: "xl",
  24: "2xl",
  30: "3xl",
  36: "4xl",
  48: "5xl",
  60: "6xl",
  72: "7xl",
  96: "8xl",
  128: "9xl",
};

// Tailwind default border-radius scale (px → suffix).
const RADIUS_SCALE: Record<number, string> = {
  0: "none",
  2: "sm",
  4: "",
  6: "md",
  8: "lg",
  12: "xl",
  16: "2xl",
  24: "3xl",
};

const SPACING_PREFIX: Record<string, string> = {
  gap: "gap",
  "padding-top": "pt",
  "padding-right": "pr",
  "padding-bottom": "pb",
  "padding-left": "pl",
};

// px value → Tailwind spacing suffix (4px grid; half steps exist only up to 3.5).
// Returns null for off-scale values so we fall back to an arbitrary-value class.
function spacingSuffix(pxValue: number): string | null {
  if (pxValue === 1) return "px";
  const steps = pxValue / 4;
  if (steps < 0) return null;
  if (Number.isInteger(steps)) return `${steps}`;
  if (Number.isInteger(steps * 2) && steps <= 3.5) return `${steps}`;
  return null;
}

function parsePx(v: string): number | null {
  const m = v.match(/^-?\d*\.?\d+/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

// "gold-200 (#d0ccc4)" → { token: "gold-200", value: "#d0ccc4" }; plain values pass through.
function splitTokenValue(figma: string): { token: string | null; value: string } {
  const m = figma.match(/^(.+?) \((#[0-9a-fA-F]{3,8})\)$/);
  if (m) return { token: m[1], value: m[2] };
  return { token: null, value: figma };
}

function findClass(className: string | undefined, pattern: RegExp): string | null {
  if (!className) return null;
  for (const cls of className.split(/\s+/)) {
    if (pattern.test(cls)) return cls;
  }
  return null;
}

function spacingHint(row: CompareRow, ctx: FixHintContext, prefix: string): string | undefined {
  const target = parsePx(row.figma);
  if (target === null) return undefined;
  const suffix = spacingSuffix(target);
  const targetClass = suffix !== null ? `${prefix}-${suffix}` : `${prefix}-[${target}px]`;
  const current = findClass(ctx.className, new RegExp(`^${prefix}-`));
  if (current) return `change ${current} → ${targetClass} (Figma ${row.figma})`;
  return `set ${row.property} to ${row.figma} (e.g. ${targetClass})`;
}

/**
 * Suggest a code fix for a mismatch row. Purely heuristic — hints name Tailwind
 * classes when the element's class list makes the mapping unambiguous.
 */
export function suggestFix(row: CompareRow, ctx: FixHintContext = {}): string | undefined {
  if (row.status !== "❌") return undefined;

  switch (row.property) {
    case "gap":
    case "padding-top":
    case "padding-right":
    case "padding-bottom":
    case "padding-left":
      return spacingHint(row, ctx, SPACING_PREFIX[row.property]);

    case "font-size": {
      const target = parsePx(row.figma);
      if (target === null) return undefined;
      const suffix = FONT_SIZE_SCALE[target];
      const targetClass = suffix ? `text-${suffix}` : `text-[${target}px]`;
      const current = findClass(ctx.className, /^text-(xs|sm|base|lg|\d?xl|\[)/);
      if (current) return `change ${current} → ${targetClass} (Figma ${row.figma})`;
      return `set font-size to ${row.figma} (e.g. ${targetClass})`;
    }

    case "border-radius": {
      const target = parsePx(row.figma);
      if (target === null) return undefined;
      const suffix = target >= 999 ? "full" : RADIUS_SCALE[target];
      const targetClass =
        suffix !== undefined ? (suffix === "" ? "rounded" : `rounded-${suffix}`) : `rounded-[${target}px]`;
      const current = findClass(ctx.className, /^rounded(-|$)/);
      if (current) return `change ${current} → ${targetClass} (Figma ${row.figma})`;
      return `set border-radius to ${row.figma} (e.g. ${targetClass})`;
    }

    case "border-width": {
      const target = parsePx(row.figma);
      if (target === null) return undefined;
      const targetClass = target === 1 ? "border" : `border-${target}`;
      return `set border-width to ${row.figma} (e.g. ${targetClass})`;
    }

    case "color":
    case "background-color":
    case "border-color": {
      const { token, value } = splitTokenValue(row.figma);
      const kind = row.property === "color" ? "text" : row.property === "background-color" ? "bg" : "border";
      if (token) return `set ${row.property} to ${value} (e.g. ${kind}-${token})`;
      return `set ${row.property} to ${value}`;
    }

    case "layout-mode": {
      const direction = row.figma.includes("column") ? "flex-col" : "flex-row";
      return `use flex ${row.figma.replace("flex ", "")} (e.g. flex ${direction})`;
    }

    case "justify-content": {
      const map: Record<string, string> = {
        "flex-start": "justify-start",
        center: "justify-center",
        "flex-end": "justify-end",
        "space-between": "justify-between",
      };
      const cls = map[row.figma];
      return cls ? `set justify-content to ${row.figma} (e.g. ${cls})` : undefined;
    }

    case "align-items": {
      const map: Record<string, string> = {
        "flex-start": "items-start",
        center: "items-center",
        "flex-end": "items-end",
        baseline: "items-baseline",
      };
      const cls = map[row.figma];
      return cls ? `set align-items to ${row.figma} (e.g. ${cls})` : undefined;
    }

    case "flex-wrap":
      return row.figma === "wrap" ? "add flex-wrap (e.g. flex-wrap)" : "remove wrapping (e.g. flex-nowrap)";

    case "line-height": {
      const target = parsePx(row.figma);
      if (target === null) return undefined;
      return `set line-height to ${row.figma} (e.g. leading-[${target}px])`;
    }

    default:
      return undefined;
  }
}
