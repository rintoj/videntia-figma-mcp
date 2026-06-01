import type { DesignKnowledgeModule } from "./types.js";

export const ICONS: DesignKnowledgeModule = {
  id: "icons",
  name: "Icon System",
  description: "Icon sizing guide, optical corrections, one-style rule, and ranked library recommendations.",
  content: `# Icon System

## Sizing Guide

| Size | Pixels | Use Cases |
|------|--------|-----------|
| Small | 16px | Inline with body text, table cells, status indicators, badges |
| Medium | 20–24px | Buttons, navigation, form fields, list items, toolbar items |
| Large | 28–32px | Feature cards, section icons, empty states, illustrations |
| XL | 40–48px | Hero sections, onboarding, modal headers (rare) |

**Rule:** Match icon size to the surrounding text size. A 16px icon next to 13px text, a 24px icon next to 16px text.

## Touch Target Sizing

Even if the icon is 20px, its touch target must be at least 44×44px (iOS HIG) on mobile:

\`\`\`css
.icon-button {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}
\`\`\`

## Optical Corrections

Icons are not mathematically centered — they need optical adjustments:

| Shape | Correction |
|-------|------------|
| Play / triangle | Shift right 0.5–1px (visual center ≠ geometric center) |
| Circle-heavy icons | May need 1px upward shift |
| Arrows pointing right | Appear heavier on left; shift right 0.5px |

**Goal:** Equal visual mass across the icon's bounding box. Trust your eye over the math.

## One Style Per Product

**Never mix icon libraries.** Lucide outlines + Heroicons outlines = visual collage, even if both are "outline style." Each library has distinct:
- Stroke width (1.5px vs 2px)
- Corner radius (sharp vs rounded terminals)
- Stroke cap (butt vs round)
- Overall visual weight

Pick one library. Use it everywhere. Only exception: a deliberately different style for a special illustration/decorative context.

## Icon Library Rankings

| Library | Style | Best For | Notes |
|---------|-------|----------|-------|
| **Lucide** | Outline, 1.5px stroke | SaaS default | Cleanest, most neutral, largest set |
| **Heroicons** | Outline + Solid | Tailwind projects | Two weights, well-maintained |
| **Phosphor** | 6 weights | Design systems needing flexibility | Most versatile |
| **Material Symbols** | Variable weight | Google-adjacent products | Very large set, distinct style |
| **SF Symbols** | Variable | iOS/macOS only | Apple-exclusive, not for web |

## Color Usage

- **Monochrome default:** Use \`currentColor\` — icon inherits surrounding text color
- **Semantic icons:** Match to semantic color (success = green, error = red)
- **Decorative icons:** Can use accent color sparingly (1–2 icons max per section)
- **Never:** Multi-color icons in UI contexts (only in illustrations/marketing)

## Icon + Label Spacing

| Icon size | Gap to label |
|-----------|--------------|
| 16px | 4–6px |
| 20–24px | 6–8px |
| 28–32px | 8–12px |

**Rule:** Icon and label baseline-align or center-align. Never top-align.
`,
};
