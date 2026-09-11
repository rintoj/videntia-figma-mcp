import type { DesignKnowledgeModule } from "./types.js";

export const TYPOGRAPHY: DesignKnowledgeModule = {
  id: "typography",
  name: "Typography System",
  description:
    "Minor Third scale (1.2x from 16px), font pairings, weights, letter-spacing rules, and text color system for light and dark mode.",
  content: `# Typography System

## Type Scale — Minor Third (1.2x ratio from 16px base)

| Step | Size | Usage |
|------|------|-------|
| Caption | 11px | Labels, timestamps, micro-copy |
| Small | 13px | Secondary text, table cells, helper text |
| Body | 16px | Default body text, paragraphs |
| Large | 19px | Emphasized body, lead copy |
| H4 | 23px | Section subheadings |
| H3 | 28px | Component/card headings |
| H2 | 33px | Page section headings |
| H1 | 40px | Page title |
| Display | 48px | Hero subtitle, marketing headings |
| Hero | 57px | Hero title, max impact statements |

**Rule:** Use at most 3–4 steps per screen. Bigger contrast = more clarity.

## Text Colors — Light Mode

| Role | Value | Usage |
|------|-------|-------|
| Primary | \`#0B0B0B\` | Headings, important body |
| Secondary | \`rgba(0,0,0,0.65)\` | Body text, descriptions |
| Tertiary | \`rgba(0,0,0,0.55)\` | Captions, helper text |
| Disabled | \`rgba(0,0,0,0.3)\` | Disabled states |

## Text Colors — Dark Mode

| Role | Value | Usage |
|------|-------|-------|
| Primary | \`#F5F5F5\` | Headings, important body |
| Secondary | \`rgba(255,255,255,0.7)\` | Body text, descriptions |
| Tertiary | \`rgba(255,255,255,0.5)\` | Captions, helper text |
| Disabled | \`rgba(255,255,255,0.3)\` | Disabled states |

## Letter-Spacing Rules

| Context | Value | Notes |
|---------|-------|-------|
| Body (16px+) | 0em | No tracking on body text |
| Small (11–13px) | 0.01–0.02em | **Required** for readability |
| ALL CAPS | 0.06–0.10em | **Mandatory** — never omit |
| Large headings (32px+) | -0.01 to -0.02em | Optical tightening |
| Display/Hero (48px+) | -0.015 to -0.04em | Tight for impact; tighter as size grows |

**Converting em to Figma:** \`set_letter_spacing\` with \`unit: "PERCENT"\` takes em × 100 — -0.02em → \`spacing: -2\`, 0.08em → \`spacing: 8\`. Percent scales with font size, so it survives size changes; use \`unit: "PIXELS"\` only when matching an absolute reference value.

## Choosing the Font Family

Pick the family in this order — stop at the first that applies:

1. **Brand or user choice.** If the brief, brand guide, or user names a typeface, use it.
2. **What the file already uses.** Call \`get_text_styles\` to list local text styles (each carries its \`fontName\` family and style). If there are none, sample existing text: \`get_node_info\` reports a text node's \`fontFamily\`, and \`get_styled_text_segments\` with \`property: "fontName"\` returns the exact family + style per run. Match the dominant family rather than introducing a new one.
3. **Neutral fallback.** Only when the file is empty and no brand exists, choose from the pairing table below (Inter is a safe default for product UI).

Fallback body defaults: weights 400 / 500 / 600, line height ~150–160% (\`{ value: 155, unit: "PERCENT" }\`), and text boxes wide enough for roughly 60–75 characters per line.

### Font style names are file-specific

Figma addresses a font as family + **style string**, and those strings differ between families and font sources: one file has \`"Semi Bold"\`, another \`"SemiBold"\`; some families have \`"Medium"\`, others don't. Copy the style string exactly as reported by \`get_text_styles\` or \`get_styled_text_segments\` — never guess it from a numeric weight.

- Call \`load_font_async\` with \`family\` and \`style\` before creating or editing text in a font that may not be loaded yet; a load error means that exact family/style pair is unavailable.
- When creating styles, \`create_text_style_from_properties\` accepts \`fontStyle\` (exact string, takes priority) or \`fontWeight\` (resolved to a style) — prefer \`fontStyle\` when you know the name.

### Verify the font actually applied

Unavailable fonts are a common silent failure: text ends up in a different family or a default style. After building, spot-check headings, body, and labels with \`get_styled_text_segments\` (\`property: "fontName"\`) and confirm the family and style match what you intended. Fix mismatches before moving on.

## Text Styles in Figma

Define the type scale once as local text styles and apply them, instead of setting font, size, and line height node by node.

- **Naming:** group with slashes so the style picker nests them — e.g. \`Display/Hero\`, \`Heading/1\`, \`Heading/2\`, \`Body/Large\`, \`Body/Medium\`, \`Label/Small\`. Keep one naming scheme per file; if styles already exist, follow their convention.
- **Create:** \`create_text_style_from_properties\` (name, \`fontFamily\`, \`fontSize\`, \`fontStyle\`, \`lineHeight\`, \`letterSpacing\`, \`textCase\`) or \`create_text_style\` to capture an existing, already-tuned text node. \`update_text_style\` edits one later.
- **Apply:** \`apply_text_style\` with \`styleName\` (e.g. \`"Body/Medium"\`) or \`styleId\`. Per-node \`set_font_name\` / \`set_font_size\` overrides break the link to the system — reserve them for true one-offs.
- **Tokens:** if the file has typography variables, bind them to style fields with \`bind_variable\` — pass the text style name or id as \`nodeId\` and a \`field\` such as \`fontFamily\`, \`fontSize\`, \`fontWeight\`, \`lineHeight\`, or \`letterSpacing\`. Both creation tools also take a \`bindings\` map for the same fields.

## Font Pairing Guidance (Fallback Options)

Use these only when neither the brand nor the file already defines a typeface.

| Context | Primary | Secondary |
|---------|---------|-----------|
| SaaS/Tech | Inter | SF Pro, Geist |
| Finance | Inter | IBM Plex Sans |
| Startup | Inter | DM Sans, Plus Jakarta Sans |
| Editorial | Playfair Display | Georgia |
| Developer | Geist | Geist Mono |

**Rule:** Max 2 typefaces per product. One for headings/display, one for body/UI. Never mix more than 2 — the only exception is a monospace companion for code and technical labels (see Mono Companion Voice).

## Weight System

- **400** — Body, descriptions, captions
- **500** — Emphasized body, navigation labels, secondary headings
- **600** — Headings, buttons, strong emphasis
- **700+** — Use sparingly: hero titles, maximum-impact statements only

**Rule:** At least 2 distinct weights per screen. A design with only one weight has no hierarchy.

## Display Letter-Spacing — Brand-Validated Scale

All 7 brands analyzed (Vercel, Cursor, Figma, Expo, Stripe, Cal, Linear) apply aggressive negative letter-spacing at large sizes. The existing Letter-Spacing Rules above cover the ratios; these are the absolute pixel values confirmed in production:

| Size Range | Letter-Spacing | Brand Reference |
|-----------|---------------|-----------------|
| 72px+ | -2.0px to -2.88px | Vercel Geist: -2.4px to -2.88px; Cursor/Figma: -2.16px |
| 56–64px | -1.4px to -2.0px | Expo: -1.6px to -3px; Stripe sohne-var: -1.4px at 56px |
| 48px | -0.72px to -1.0px | Stripe: -0.96px; Cal Sans: 0px (geometric font exception) |
| 36px | -0.4px to -0.75px | Cursor: -0.72px at 36px |
| 24–32px | -0.1px to -0.4px | Cursor: -0.325px at 26px |
| ≤16px | 0px (normal) | Never tighten body text |

**Rule for Figma:** Use \`set_letter_spacing\` with \`unit: "PIXELS"\` for these values. (To apply the em rules above, use \`unit: "PERCENT"\` with em × 100, e.g. 0.06em → 6.) At 72px, start at -2.0px and adjust by feel. If it looks like a logotype, it's right.

## Light-Weight Display (The "Whispered Authority" Pattern)

Stripe's most distinctive typography choice: weight **300** at 48px+ hero text. *"An extraordinarily light weight for headlines that creates an ethereal, almost whispered authority — the opposite of the bold hero headline convention."*

When to use weight 300 for display:
- Premium / luxury brands
- Financial / trust-driven products
- Any product that wants to feel confident without shouting
- Works best with tight negative letter-spacing (-0.8px to -1.4px at 48px)

When NOT to use it: consumer apps, developer tools, anything that needs energy or urgency. Bold heroes (600–700) remain correct for those contexts.

## Mono Companion Voice

Developer-facing and technical products consistently use a **three-voice typography system**: display sans + body sans + monospace. Brands using this pattern: Vercel (Geist + Geist Mono), Cursor (CursorGothic + berkeleyMono), Figma (figmaSans + figmaMono).

**The mono voice is used for:**
- Code blocks and inline code
- Terminal output, CLI commands
- Technical labels, version numbers, API values
- Section labels in uppercase with positive letter-spacing

**Section label treatment (technical credibility signal):**

| Property | Value | Figma |
|----------|-------|-------|
| Family | Monospace (Geist Mono, berkeleyMono, JetBrains Mono) | \`set_font_name\` or a \`Label/Mono\` text style |
| Size | 11–13px | \`set_font_size\` |
| Weight | 400–500 | Style string from the file, e.g. \`"Regular"\` / \`"Medium"\` |
| Case | Uppercase | \`set_text_case\` with \`UPPER\` |
| Letter-spacing | +6 to +10% (≈0.7–1.3px at 11–13px), the opposite of display headings | \`set_letter_spacing\` with \`unit: "PERCENT"\` |

Figma applies \`0.54px\` letter-spacing to its monospace section labels at 18px. The combination of mono + uppercase + positive tracking reads as "technical precision" regardless of brand.
`,
};
