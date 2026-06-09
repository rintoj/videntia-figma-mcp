// Normalizers + per-property comparators for diff_figma_to_browser.

export type CompareStatus = "✓" | "❌" | "—";

export interface CompareRow {
  property: string;
  figma: string;
  browser: string;
  status: CompareStatus;
  note?: string;
}

const FONT_WEIGHT_ALIASES: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  "ultra light": 200,
  light: 300,
  normal: 400,
  regular: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  "semi bold": 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  "ultra bold": 800,
  black: 900,
  heavy: 900,
};

export function px(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^-?\d*\.?\d+/);
    if (!match) return null;
    const n = parseFloat(match[0]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function toHex2(n: number): string {
  const v = Math.round(clamp01(n) * 255);
  return v.toString(16).padStart(2, "0");
}

// rgb / rgba / #rgb / #rgba / #rrggbb / #rrggbbaa → #rrggbb (sRGB only)
export function hex(c: unknown): string | null {
  if (c === null || c === undefined) return null;

  // Figma-style {r,g,b,a} with 0–1 channels.
  if (typeof c === "object" && c !== null) {
    const obj = c as { r?: number; g?: number; b?: number };
    if (typeof obj.r === "number" && typeof obj.g === "number" && typeof obj.b === "number") {
      return `#${toHex2(obj.r)}${toHex2(obj.g)}${toHex2(obj.b)}`;
    }
  }

  if (typeof c !== "string") return null;
  const s = c.trim().toLowerCase();
  if (!s) return null;

  if (s.startsWith("#")) {
    const hexPart = s.slice(1);
    if (/^[0-9a-f]{3}$/.test(hexPart)) {
      return `#${hexPart[0]}${hexPart[0]}${hexPart[1]}${hexPart[1]}${hexPart[2]}${hexPart[2]}`;
    }
    if (/^[0-9a-f]{4}$/.test(hexPart)) {
      return `#${hexPart[0]}${hexPart[0]}${hexPart[1]}${hexPart[1]}${hexPart[2]}${hexPart[2]}`;
    }
    if (/^[0-9a-f]{6}$/.test(hexPart)) return `#${hexPart}`;
    if (/^[0-9a-f]{8}$/.test(hexPart)) return `#${hexPart.slice(0, 6)}`;
    return null;
  }

  const rgbMatch = s.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(/[,/\s]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (raw: string): number | null => {
      const t = raw.trim();
      if (t.endsWith("%")) {
        const n = parseFloat(t.slice(0, -1));
        return Number.isFinite(n) ? clamp01(n / 100) : null;
      }
      const n = parseFloat(t);
      return Number.isFinite(n) ? clamp01(n / 255) : null;
    };
    const r = channel(parts[0]);
    const g = channel(parts[1]);
    const b = channel(parts[2]);
    if (r === null || g === null || b === null) return null;
    return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
  }

  if (s === "transparent") return "#00000000-transparent";
  return null;
}

// Is the parsed color fully transparent? CSS rgba(…, 0) or the literal "transparent".
export function isTransparent(c: unknown): boolean {
  if (typeof c === "object" && c !== null) {
    const obj = c as { a?: number };
    if (typeof obj.a === "number" && obj.a === 0) return true;
  }
  if (typeof c === "string") {
    const s = c.trim().toLowerCase();
    if (s === "transparent") return true;
    const m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const parts = m[1].split(/[,/\s]+/).filter(Boolean);
      if (parts.length === 4) {
        const a = parseFloat(parts[3]);
        if (Number.isFinite(a) && a === 0) return true;
      }
    }
  }
  return false;
}

// Resolve a browser line-height value to pixels.
// "normal" → fs × 1.2; unitless n → n × fs; "npx" → n.
export function lh(raw: unknown, fontSizePx: number | null): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    if (raw < 4 && fontSizePx !== null) return raw * fontSizePx;
    return raw;
  }
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s === "normal") return fontSizePx === null ? null : fontSizePx * 1.2;
  if (s.endsWith("px")) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }
  if (s.endsWith("%")) {
    const n = parseFloat(s.slice(0, -1));
    if (!Number.isFinite(n) || fontSizePx === null) return null;
    return (n / 100) * fontSizePx;
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  if (fontSizePx !== null) return n * fontSizePx;
  return null;
}

// Resolve a Figma line-height to pixels.
// Figma serializer emits `lineHeight` (number) and optional `lineHeightUnit: "percent"`.
export function figmaLineHeightPx(
  value: number | null | undefined,
  unit: string | undefined,
  fontSizePx: number | null,
): number | null {
  if (value === null || value === undefined) return null;
  if (unit === "percent") {
    if (fontSizePx === null) return null;
    return (value / 100) * fontSizePx;
  }
  return value;
}

// Resolve Figma letter-spacing to pixels.
export function figmaLetterSpacingPx(
  value: number | null | undefined,
  unit: string | undefined,
  fontSizePx: number | null,
): number | null {
  if (value === null || value === undefined) return null;
  if (unit === "percent") {
    if (fontSizePx === null) return null;
    return (value / 100) * fontSizePx;
  }
  return value;
}

export function normalizeFontWeight(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const trimmed = v.trim();
    const n = parseFloat(trimmed);
    if (Number.isFinite(n) && /^\d+$/.test(trimmed)) return n;
    const alias = FONT_WEIGHT_ALIASES[trimmed.toLowerCase()];
    return alias ?? null;
  }
  return null;
}

export function primaryFontFamily(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const first = v.split(",")[0];
  if (!first) return null;
  return first
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();
}

export function within(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

// Build a status row by comparing two numbers with a tolerance.
export function compareNumeric(
  property: string,
  figmaVal: number | null,
  browserVal: number | null,
  tol: number,
  format: (n: number) => string = (n) => `${n}px`,
): CompareRow {
  if (figmaVal === null && browserVal === null) {
    return { property, figma: "—", browser: "—", status: "—" };
  }
  if (figmaVal === null || browserVal === null) {
    return {
      property,
      figma: figmaVal === null ? "—" : format(figmaVal),
      browser: browserVal === null ? "—" : format(browserVal),
      status: "—",
    };
  }
  return {
    property,
    figma: format(figmaVal),
    browser: format(browserVal),
    status: within(figmaVal, browserVal, tol) ? "✓" : "❌",
  };
}

export function compareString(property: string, figmaVal: string | null, browserVal: string | null): CompareRow {
  if (figmaVal === null && browserVal === null) {
    return { property, figma: "—", browser: "—", status: "—" };
  }
  if (figmaVal === null || browserVal === null) {
    return {
      property,
      figma: figmaVal ?? "—",
      browser: browserVal ?? "—",
      status: "—",
    };
  }
  return {
    property,
    figma: figmaVal,
    browser: browserVal,
    status: figmaVal === browserVal ? "✓" : "❌",
  };
}
