/**
 * Font weight from a Figma `fontName.style` string, and the WCAG 1.4.3
 * large-text rule. Dependency-free so the plugin bundle can import it too.
 */

const WEIGHT_WORDS: Array<[RegExp, number]> = [
  [/\b(?:extra|ultra)\s*-?\s*black\b|\bextrablack\b|\bultrablack\b/, 950],
  [/\b(?:extra|ultra)\s*-?\s*bold\b|\bextrabold\b|\bultrabold\b/, 800],
  [/\b(?:semi|demi)\s*-?\s*bold\b|\bsemibold\b|\bdemibold\b/, 600],
  [/\b(?:extra|ultra)\s*-?\s*light\b|\bextralight\b|\bultralight\b/, 200],
  [/\b(?:semi|demi)\s*-?\s*light\b|\bsemilight\b|\bdemilight\b/, 350],
  [/\bhairline\b|\bthin\b/, 100],
  [/\bblack\b|\bheavy\b/, 900],
  [/\bbold\b/, 700],
  [/\bmedium\b/, 500],
  [/\blight\b/, 300],
  [/\bregular\b|\bnormal\b|\bbook\b|\broman\b|\bplain\b/, 400],
];

/**
 * Numeric weight named by a font style, e.g. "Bold Italic" → 700,
 * "SemiBold" / "Semi Bold" → 600, "Condensed Black" → 900. A style that names
 * no weight ("Italic", "Condensed") is the family's regular cut → 400.
 * Returns undefined only for an empty/missing style.
 */
export function fontWeightFromStyle(style: string | undefined | null): number | undefined {
  if (!style || typeof style !== "string") return undefined;
  const s = style
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_-]/g, " ");
  const joined = s.replace(/\s+/g, "");
  for (const [re, weight] of WEIGHT_WORDS) {
    if (re.test(s) || re.test(joined)) return weight;
  }
  const numeric = /\b([1-9]00)\b/.exec(s);
  if (numeric) return Number(numeric[1]);
  return 400;
}

/** 18pt and 14pt expressed in CSS/Figma pixels (1pt = 4/3 px). */
export const LARGE_TEXT_MIN_PX = 24;
export const LARGE_BOLD_TEXT_MIN_PX = 14 * (4 / 3);
/** WCAG "bold" is weight 700 or heavier; SemiBold (600) is not bold. */
export const WCAG_BOLD_MIN_WEIGHT = 700;

/**
 * WCAG 1.4.3 large text: ≥ 18pt (24px) at any weight, or ≥ 14pt (≈18.67px)
 * when bold (weight ≥ 700). Figma font sizes are pixels. An explicit numeric
 * weight wins; otherwise it is derived from the style name. Unknown weight is
 * treated as NOT bold, so it can only make the check stricter.
 */
export function isLargeText(fontSize: number, fontWeight?: number, fontStyle?: string): boolean {
  if (typeof fontSize !== "number" || !isFinite(fontSize)) return false;
  // Allow a hair of float noise (e.g. 23.999 from a scaled instance).
  if (fontSize >= LARGE_TEXT_MIN_PX - 0.01) return true;
  const weight = typeof fontWeight === "number" && isFinite(fontWeight) ? fontWeight : fontWeightFromStyle(fontStyle);
  const bold = weight !== undefined && weight >= WCAG_BOLD_MIN_WEIGHT;
  return bold && fontSize >= LARGE_BOLD_TEXT_MIN_PX - 0.01;
}
