import type { DesignKnowledgeModule } from "./types.js";

export const TYPOGRAPHY: DesignKnowledgeModule = {
  id: "typography",
  name: "Typography System",
  description: "Minor Third scale (1.2x from 16px), font pairings, weights, letter-spacing rules, and text color system for light and dark mode.",
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
| Tertiary | \`rgba(0,0,0,0.45)\` | Captions, helper text |
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
| Display/Hero (48px+) | -0.02 to -0.03em | Tight for impact |

## Safe SaaS Font Preset

\`\`\`css
font-family: Inter, system-ui, sans-serif;
font-weight: 400 / 500 / 600;
line-height: 1.55;
max-width: 65ch; /* Optimal reading line length */
\`\`\`

## Font Pairing Guidance

| Context | Primary | Secondary |
|---------|---------|-----------|
| SaaS/Tech | Inter | SF Pro, Geist |
| Finance | Inter | IBM Plex Sans |
| Startup | Inter | DM Sans, Plus Jakarta Sans |
| Editorial | Playfair Display | Georgia |
| Developer | Geist | Geist Mono |

**Rule:** Max 2 typefaces per product. One for headings/display, one for body/UI. Never mix more than 2.

## Weight System

- **400** — Body, descriptions, captions
- **500** — Emphasized body, navigation labels, secondary headings
- **600** — Headings, buttons, strong emphasis
- **700+** — Use sparingly: hero titles, maximum-impact statements only

**Rule:** At least 2 distinct weights per screen. A design with only 400 and 600 has no rhythm.

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

**Rule for Figma:** Use \`letter_spacing\` in PIXELS (not em). At 72px, start at -2.0px and adjust by feel. If it looks like a logotype, it's right.

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
\`\`\`
font-family: monospace (Geist Mono, berkeleyMono, JetBrains Mono)
font-size: 11–13px
font-weight: 400–500
text-transform: uppercase
letter-spacing: 0.5–1px positive  ← opposite of display headings
\`\`\`
Figma applies \`0.54px\` letter-spacing to its monospace section labels at 18px. The combination of mono + uppercase + positive tracking reads as "technical precision" regardless of brand.
`,
};
