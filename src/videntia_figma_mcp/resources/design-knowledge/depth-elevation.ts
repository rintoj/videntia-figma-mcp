import type { DesignKnowledgeModule } from "./types.js";

export const DEPTH_ELEVATION: DesignKnowledgeModule = {
  id: "depth-elevation",
  name: "Depth & Elevation System",
  description:
    "Multi-layer shadow recipes, shadow-as-border, brand-colored shadows, and elevation hierarchy — sourced from real brand DESIGN.md files (Notion, Stripe, Vercel, Cal, Figma).",
  content: `# Depth & Elevation System

## The Multi-Layer Shadow Rule

**Every industry-leading brand uses multi-layer shadow stacks. Single-layer shadows look amateur.**

A real object casts multiple shadow types simultaneously — a sharp contact shadow close-in, a soft diffused shadow at medium distance, and a large ambient shadow far out. Single-layer shadows are a flat lie that trained eyes catch immediately.

| Brand | Shadow Philosophy | Layers |
|-------|-------------------|--------|
| Notion | "Depth felt rather than seen" — sub-0.05 opacity each layer | 4 layers |
| Cal.com | 11 shadow definitions with ring borders + diffuse + inset highlights | 3+ per level |
| Stripe | Blue-tinted layers tied to brand palette | 2 layers |
| Vercel | Shadow-as-border replaces CSS borders entirely | 2–3 layers |

## Elevation Scale — 4 Levels

### Level 0 — Flat
No shadow. Page backgrounds, static text, most elements live here.

### Level 1 — Raised (cards, list items, hover states)
\`\`\`
box-shadow:
  rgba(0,0,0,0.04) 0px 4px 18px,
  rgba(0,0,0,0.02) 0px 1px 4px;
\`\`\`
Notion's philosophy: "felt, not seen." Cumulative opacity: 0.06. The card lifts without announcing itself.

### Level 2 — Floating (dropdowns, tooltips, date pickers, popovers)
\`\`\`
box-shadow:
  rgba(0,0,0,0.08) 0px 8px 32px,
  rgba(0,0,0,0.05) 0px 2px 8px,
  rgba(0,0,0,0.03) 0px 1px 2px;
\`\`\`
Cumulative opacity: 0.16. Noticeably elevated but not dramatic.

### Level 3 — Modal / Overlay (dialogs, sheets, command palettes)
\`\`\`
box-shadow:
  rgba(0,0,0,0.12) 0px 20px 60px,
  rgba(0,0,0,0.08) 0px 8px 24px,
  rgba(0,0,0,0.05) 0px 2px 6px;
\`\`\`
Cumulative opacity: 0.25. Maximum depth for product UI.

## Opacity Rules

- **Per layer**: ≤ 0.15 — individual shadow layers must stay transparent
- **Cumulative**: ≤ 0.25 for product UI, ≤ 0.35 for marketing/landing pages
- **Never**: a single layer at opacity 0.3+ — this is the amateur tell

## Shadow-as-Border Technique (Vercel Pattern)

Replace CSS borders with zero-offset, zero-blur, 1px-spread shadow:

\`\`\`
box-shadow: 0px 0px 0px 1px rgba(0,0,0,0.08);
\`\`\`

**Why Vercel uses this instead of borders:**
- Doesn't affect box model — no layout shift when added or removed
- Smoother rendering on rounded corners (no corner clipping)
- Subtler visual weight than a solid border
- Combines cleanly with elevation shadows in one declaration

**Combined (border ring + elevation):**
\`\`\`
box-shadow:
  0px 0px 0px 1px rgba(0,0,0,0.08),    /* border ring */
  rgba(0,0,0,0.06) 0px 4px 16px,       /* main elevation */
  rgba(0,0,0,0.03) 0px 1px 4px;        /* contact shadow */
\`\`\`

## Brand-Colored Shadows (Stripe Pattern)

Stripe's signature: tint the primary shadow with the brand hue. Their shadow color \`rgba(50,50,93,0.25)\` is a cool blue-violet matching their purple palette. Elevation feels on-brand, not generic.

\`\`\`
/* Stripe-style brand-colored shadow */
box-shadow:
  rgba(50,50,93,0.25) 0px 6px 12px -2px,
  rgba(0,0,0,0.1) 0px 3px 7px -3px;
\`\`\`

**How to apply this to any brand:** Sample the brand's primary color RGB, reduce to 15–25% opacity, use as the larger (outer) shadow layer. Add a neutral black shadow at lower opacity for the sharper contact shadow.

## Inset Highlights (Glass / Premium Surface)

For glass morphism or premium cards, add an inset top-edge highlight:

\`\`\`
box-shadow:
  inset 0 1px 0 rgba(255,255,255,0.12),   /* top edge highlight */
  rgba(0,0,0,0.08) 0px 8px 32px,
  rgba(0,0,0,0.04) 0px 2px 8px;
\`\`\`

Use sparingly — only on explicitly glass or premium surfaces. Cal.com uses inset highlights across their full 11-definition shadow system for a premium crafted feel.

## Notion Card Shadow (Verbatim — Production-Tested)

\`\`\`
/* Notion Card */
box-shadow:
  rgba(0,0,0,0.04) 0px 4px 18px,
  rgba(0,0,0,0.027) 0px 2px 7.8px,
  rgba(0,0,0,0.02) 0px 0.8px 2.9px,
  rgba(0,0,0,0.01) 0px 0.175px 1.04px;

/* Notion Deep Shadow (modals, featured) */
box-shadow:
  rgba(0,0,0,0.01) 0px 1px 3px,
  rgba(0,0,0,0.02) 0px 3px 7px,
  rgba(0,0,0,0.02) 0px 7px 15px,
  rgba(0,0,0,0.04) 0px 14px 28px,
  rgba(0,0,0,0.05) 0px 23px 52px;
\`\`\`

## Figma Implementation Guide

Use \`create_effect_style\` to create elevation tokens as named styles:

**elevation/1-card:**
\`\`\`json
{ "name": "elevation/1-card", "effects": [
  { "type": "DROP_SHADOW", "color": {"r":0,"g":0,"b":0,"a":0.04}, "offset": {"x":0,"y":4}, "radius": 18, "spread": 0 },
  { "type": "DROP_SHADOW", "color": {"r":0,"g":0,"b":0,"a":0.02}, "offset": {"x":0,"y":1}, "radius": 4, "spread": 0 }
]}
\`\`\`

**elevation/2-floating:**
\`\`\`json
{ "name": "elevation/2-floating", "effects": [
  { "type": "DROP_SHADOW", "color": {"r":0,"g":0,"b":0,"a":0.08}, "offset": {"x":0,"y":8}, "radius": 32, "spread": 0 },
  { "type": "DROP_SHADOW", "color": {"r":0,"g":0,"b":0,"a":0.05}, "offset": {"x":0,"y":2}, "radius": 8, "spread": 0 },
  { "type": "DROP_SHADOW", "color": {"r":0,"g":0,"b":0,"a":0.03}, "offset": {"x":0,"y":1}, "radius": 2, "spread": 0 }
]}
\`\`\`

**elevation/3-modal:**
\`\`\`json
{ "name": "elevation/3-modal", "effects": [
  { "type": "DROP_SHADOW", "color": {"r":0,"g":0,"b":0,"a":0.12}, "offset": {"x":0,"y":20}, "radius": 60, "spread": 0 },
  { "type": "DROP_SHADOW", "color": {"r":0,"g":0,"b":0,"a":0.08}, "offset": {"x":0,"y":8}, "radius": 24, "spread": 0 },
  { "type": "DROP_SHADOW", "color": {"r":0,"g":0,"b":0,"a":0.05}, "offset": {"x":0,"y":2}, "radius": 6, "spread": 0 }
]}
\`\`\`

## Anti-Patterns

- **Single-layer shadow**: \`box-shadow: 0 4px 8px rgba(0,0,0,0.25)\` — immediately signals AI generation
- **Opacity > 0.3 per layer**: Shadows should feel weightless, not like ink blots
- **Border AND shadow on same element**: Vercel uses shadow-as-border to avoid this — pick one technique
- **Uniform shadow across all elevation levels**: Each level must be meaningfully different in blur + spread
- **Pure black shadow on colored background**: Tint the shadow to match background hue tone
- **Drop shadow on text elements**: Only on containers, never on text nodes or icons
`,
};
