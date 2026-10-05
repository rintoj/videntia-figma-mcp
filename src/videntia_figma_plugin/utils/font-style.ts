import { describeError } from "./helpers";

// Font face resolution shared by every command that turns a weight or a style
// name into a loadable Figma FontName. Families disagree on spelling ("Semi Bold",
// "SemiBold", "Semibold", "DemiBold"), so the family's real style list is the
// source of truth and the requested name is matched against it by meaning.

const WEIGHT_WORDS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  normal: 400,
  book: 400,
  roman: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

const CANONICAL_STYLE: Record<number, string> = {
  100: "Thin",
  200: "Extra Light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semi Bold",
  700: "Bold",
  800: "Extra Bold",
  900: "Black",
};

export interface ParsedFontStyle {
  weight: number;
  italic: boolean;
}

/** Lowercase with whitespace, hyphens and underscores removed: "Semi Bold" -> "semibold". */
export function normalizeFontStyleKey(style: string): string {
  return String(style)
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

/**
 * Reads a style name as a weight + italic flag. Returns undefined for names that
 * carry anything besides a weight word and italic/oblique (e.g. "Condensed Bold").
 */
export function parseFontStyle(style: string): ParsedFontStyle | undefined {
  let key = normalizeFontStyleKey(style);
  let italic = false;
  const slant = key.match(/(italic|oblique)/);
  if (slant) {
    italic = true;
    key = key.replace(slant[0], "");
  }
  if (key === "") return { weight: 400, italic };
  const weight = WEIGHT_WORDS[key];
  return weight !== undefined ? { weight, italic } : undefined;
}

/** Nearest CSS weight bucket (100..900) for any numeric weight. */
export function normalizeFontWeight(weight: number): number {
  const n = Number(weight);
  if (!isFinite(n)) return 400;
  return Math.min(900, Math.max(100, Math.round(n / 100) * 100));
}

/** Canonical Figma spelling for a weight, e.g. 600 -> "Semi Bold", 600 italic -> "Semi Bold Italic". */
export function styleNameForWeight(weight: number, italic = false): string {
  const base = CANONICAL_STYLE[normalizeFontWeight(weight)];
  if (!italic) return base;
  return base === "Regular" ? "Italic" : `${base} Italic`;
}

/**
 * Picks the style from `available` that means the same as `requested`:
 * exact name, then a case/space-insensitive match, then the same weight + slant
 * under any synonym ("Semibold" for "Semi Bold", "Heavy" for "Black", "Book" for
 * "Regular"). Returns undefined when the family has no such face.
 */
export function matchFontStyle(requested: string, available: string[]): string | undefined {
  const raw = String(requested).trim();
  if (available.indexOf(raw) !== -1) return raw;
  const key = normalizeFontStyleKey(raw);
  for (let i = 0; i < available.length; i++) {
    if (normalizeFontStyleKey(available[i]) === key) return available[i];
  }
  const wanted = parseFontStyle(raw);
  if (wanted === undefined) return undefined;
  const canonicalKey = normalizeFontStyleKey(styleNameForWeight(wanted.weight, wanted.italic));
  let fallback: string | undefined;
  for (let i = 0; i < available.length; i++) {
    const parsed = parseFontStyle(available[i]);
    if (parsed === undefined || parsed.weight !== wanted.weight || parsed.italic !== wanted.italic) continue;
    if (normalizeFontStyleKey(available[i]) === canonicalKey) return available[i];
    if (fallback === undefined) fallback = available[i];
  }
  return fallback;
}

/** Same as matchFontStyle, starting from a numeric weight. */
export function matchFontWeight(weight: number, available: string[], italic = false): string | undefined {
  return matchFontStyle(styleNameForWeight(weight, italic), available);
}

// ---------------------------------------------------------------------------
// Figma-backed resolution
// ---------------------------------------------------------------------------

const STYLE_SPELLINGS: Record<string, string> = {
  extralight: "Extra Light",
  ultralight: "Extra Light",
  normal: "Regular",
  semibold: "Semi Bold",
  demibold: "Semi Bold",
  extrabold: "Extra Bold",
  ultrabold: "Extra Bold",
  heavy: "Black",
};

/**
 * Spellings to try with loadFontAsync when the family's style list is unavailable,
 * most-likely first. e.g. "SemiBold" -> ["SemiBold", "Semi Bold", "Semibold"].
 */
export function fontStyleCandidates(requested: string): string[] {
  const out: string[] = [];
  const push = (value: string | undefined): void => {
    if (value !== undefined && value !== null && value !== "" && out.indexOf(value) === -1) out.push(value);
  };
  const raw = String(requested).trim();
  push(raw);
  const compact = raw.replace(/\s+/g, "");
  const parsed = parseFontStyle(raw);
  const mapped =
    STYLE_SPELLINGS[normalizeFontStyleKey(raw)] ??
    (parsed !== undefined ? styleNameForWeight(parsed.weight, parsed.italic) : undefined);
  push(mapped);
  push(raw.replace(/([a-z])([A-Z])/g, "$1 $2"));
  push(compact);
  if (mapped !== undefined) {
    const mappedCompact = mapped.replace(/\s+/g, "");
    push(mappedCompact);
    push(mappedCompact.charAt(0) + mappedCompact.slice(1).toLowerCase());
  }
  return out;
}

let fontCache: { owner: unknown; families: Promise<Map<string, string[]>> } | undefined;

/** Drops the cached font list (the next lookup re-reads listAvailableFontsAsync). */
export function clearFontStyleCache(): void {
  fontCache = undefined;
}

async function readFamilies(): Promise<Map<string, string[]>> {
  const families = new Map<string, string[]>();
  if (typeof figma === "undefined" || typeof figma.listAvailableFontsAsync !== "function") return families;
  try {
    const fonts = await figma.listAvailableFontsAsync();
    for (let i = 0; i < fonts.length; i++) {
      const name = fonts[i] && fonts[i].fontName;
      if (!name) continue;
      const styles = families.get(name.family) ?? [];
      if (styles.indexOf(name.style) === -1) styles.push(name.style);
      families.set(name.family, styles);
    }
  } catch (_e) {
    // best effort: an empty map sends callers down the spelling-candidate path
  }
  return families;
}

/** Style names Figma reports for `family` (cached per plugin session). Empty when unknown. */
export async function listFontStylesForFamily(family: string): Promise<string[]> {
  const owner = typeof figma === "undefined" ? undefined : figma;
  if (fontCache === undefined || fontCache.owner !== owner) {
    fontCache = { owner, families: readFamilies() };
  }
  const families = await fontCache.families;
  return families.get(family) ?? [];
}

/**
 * Loads the face of `family` that matches `requested` (by meaning, against the
 * family's real style list) and returns the style name that loaded. Throws naming
 * the styles that do exist.
 */
export async function resolveAndLoadFontStyle(family: string, requested: string, context: string): Promise<string> {
  const available = await listFontStylesForFamily(family);
  const tried: string[] = [];
  let lastError: unknown;
  const matched = matchFontStyle(requested, available);
  const candidates = fontStyleCandidates(requested);
  const order = matched !== undefined ? [matched].concat(candidates.filter((c) => c !== matched)) : candidates;
  for (let i = 0; i < order.length; i++) {
    tried.push(order[i]);
    try {
      await figma.loadFontAsync({ family, style: order[i] });
      return order[i];
    } catch (error) {
      lastError = error;
    }
  }
  const reason = lastError !== undefined ? describeError(lastError) : "";
  throw new Error(
    `${context}: font "${family}" has no style matching "${requested}" (tried ${tried.join(", ")}). ` +
      (available.length > 0
        ? `Available styles for "${family}": ${available.join(", ")}.`
        : `No styles could be listed for "${family}" — check the family name.`) +
      (reason !== "" && reason !== "Unknown error" ? ` (Figma said: ${reason})` : ""),
  );
}

/** resolveAndLoadFontStyle for a numeric weight (e.g. 600 -> whatever the family calls its 600 face). */
export async function resolveAndLoadFontWeight(
  family: string,
  weight: number,
  context: string,
  italic = false,
): Promise<string> {
  return resolveAndLoadFontStyle(family, styleNameForWeight(weight, italic), context);
}
