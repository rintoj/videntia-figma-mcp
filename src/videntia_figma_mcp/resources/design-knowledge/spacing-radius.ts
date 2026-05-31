import type { DesignKnowledgeModule } from "./types.js";

export const SPACING_RADIUS: DesignKnowledgeModule = {
  id: "spacing-radius",
  name: "Spacing & Border Radius System",
  description:
    "8px base grid, spacing scale, button padding conventions, and border radius archetypes — sourced from real brand DESIGN.md files (Notion, Stripe, Vercel, Figma, Expo, Cal, Cursor).",
  content: `# Spacing & Border Radius System

## The 8px Base Grid

**Near-universal across industry-leading design teams.** Confirmed in: Notion ("8px base spacing unit"), Figma, Cal.com, Expo, Stripe, and Vercel. Everything snaps to multiples of 4px at the micro level and 8px at the component level.

**Why 8px:** Most screen densities (1x, 2x, 3x) divide evenly into 8. Layouts using the 8pt grid scale without rounding artifacts across device types.

## Standard Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, tight internal element spacing |
| sm | 8px | Component internal padding (tight), horizontal input padding |
| md | 12px | Default gap in compact layouts, button vertical padding |
| base | 16px | Standard component padding, default flex gap |
| lg | 20px | Comfortable component padding |
| xl | 24px | Card padding, section element gap |
| 2xl | 32px | Generous card padding, between-card gap in grids |
| 3xl | 40px | Section sub-element gap |
| 4xl | 48px | Between-section spacing (dense layouts) |
| 5xl | 64px | Between-section spacing (standard) |
| 6xl | 80px | Between major sections |
| 7xl | 96px | Page-level breathing room |

**Rule:** Use the scale. Never use arbitrary values like 13px, 22px, or 37px. If you need to go between two scale steps, question whether the component needs redesigning instead.

## Button Padding Conventions

From real brand DESIGN.md analysis (Cursor, Figma, Cal, Expo, Stripe, Notion, Vercel):

| Size | Vertical | Horizontal | Notes |
|------|---------|-----------|-------|
| Small | 6px | 12px | Compact UI, dense tables, inline actions |
| Default | 8–10px | 16–20px | Standard CTAs |
| Large | 12–14px | 24–28px | Hero CTAs, primary page actions |
| XL | 16px | 32px | Marketing hero sections only |

**Asymmetric padding:** Cursor and Figma both use \`8px 18px 10px\` (top 8px, horizontal 18px, bottom 10px). The 2px optical compensation on the bottom makes text appear vertically centered despite being technically off-center. Apply this whenever buttons feel top-heavy.

## Component Spacing Reference

| Component | Internal Padding | Notes |
|-----------|-----------------|-------|
| Card (compact) | 16px | Dense data layouts, list views |
| Card (standard) | 20–24px | Default product cards |
| Card (premium) | 28–32px | Marketing, feature highlights |
| Input | 8–12px vertical, 12–16px horizontal | Never less than 8px vertical |
| Modal / Sheet | 24–32px | Generous internal padding |
| Nav item | 8–12px vertical, 12–16px horizontal | |
| Section within page | 48–64px top/bottom | |
| Between major sections | 80–96px | |
| Page horizontal margins | 16–24px mobile, 40–80px desktop | |

## Border Radius — Brand Archetypes

**Border radius is one of the most expressive single decisions in a design system.** It communicates brand personality before the user reads a word. Pick an archetype and be consistent.

### Archetype 1: Enterprise / Finance
**Brands:** Stripe (4px), Notion (4px), IBM
\`\`\`
Cards:   4px
Buttons: 4px
Inputs:  4–6px
Badges:  6px or 9999px (pill only for badges)
Modals:  6px
\`\`\`
Signal: serious, trustworthy, financial-grade. Stripe documented this explicitly: *"Conservative border-radius (4–8px) — nothing pill-shaped, nothing harsh."*

### Archetype 2: Modern SaaS / Neutral
**Brands:** Vercel (6px), Cal.com (6–8px), Linear (6px), GitHub
\`\`\`
Cards:   6–8px
Buttons: 6–8px default, pill for primary CTA only
Inputs:  6px
Badges:  9999px (pill)
Modals:  8–10px
\`\`\`
Signal: professional, approachable, functional. One pill element (usually the primary CTA or badge) adds contrast against the otherwise rectangular system.

### Archetype 3: Developer Tool / Playful
**Brands:** Figma (pill + circle icons), Cursor (50px pill), Expo (24px–9999px)
\`\`\`
Cards:        8–12px
Buttons:      9999px (pill)
Icon buttons: 50% (perfect circle)
Inputs:       8px
Badges:       9999px (pill)
Modals:       12px
\`\`\`
Signal: modern, tool-palette energy. Figma's pill buttons directly echo the selection handles inside the Figma editor — product UI referencing itself. Expo uses pill geometry on buttons, tabs, video containers, and images: *"organic, approachable feel that contradicts the typical sharp-edged developer tool aesthetic."*

### Archetype 4: Consumer / Friendly
**Brands:** Airbnb, consumer apps
\`\`\`
Cards:   12–16px
Buttons: 12px or pill
Inputs:  10–12px
Modals:  16–20px
\`\`\`
Signal: warm, human-centered, approachable.

## Radius Scale

| Token | Value | Archetype fit |
|-------|-------|--------------|
| none | 0px | Dividers, full-bleed images |
| xs | 2px | Minimal — rarely used outside of chips in dense UI |
| sm | 4px | Enterprise / Finance archetype |
| md | 6px | Modern SaaS (Vercel, Linear) |
| lg | 8px | Modern SaaS rounded / Developer tool cards |
| xl | 12px | Developer tool / Consumer |
| 2xl | 16px | Consumer cards, featured containers |
| 3xl | 24px | Large featured containers |
| full | 9999px | Pills, badges, circular avatars |

## Radius Consistency Rules

1. **One archetype per product** — do not mix 4px buttons with 16px cards.
2. **Badge exception** — badges and status chips can always be pill (9999px) regardless of archetype. It's a recognized UI convention.
3. **Scale with component size** — larger containers can have slightly more radius within the same archetype (e.g., 4px card / 6px modal in an enterprise system).
4. **Inputs never pill** — text inputs at 9999px radius look broken and clip text. Max for inputs is 10–12px.
5. **Buttons match inputs** — if buttons are 4px, inputs are 4–6px. Don't contrast them against each other.

## Anti-Patterns

- **Arbitrary radius values**: 7px, 11px, 15px, 13px — always use the scale
- **Mixing archetypes**: 4px enterprise cards with pill developer-tool buttons in the same product — conflicted personality
- **Pill inputs**: Text inputs are never full-pill — clips content and looks broken
- **Over-rounding small components**: radius > 50% of component height distorts the shape (a 20px tall badge with 16px radius creates an oval, not a rounded rect)
- **Zero radius everywhere**: Even enterprise products use at minimum 4px — 0px reads as unfinished
- **Arbitrary spacing**: 13px margin here, 22px padding there — use the scale even when approximating
`,
};
