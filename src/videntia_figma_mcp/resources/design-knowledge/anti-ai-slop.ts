import type { DesignKnowledgeModule } from "./types.js";

export const ANTI_AI_SLOP: DesignKnowledgeModule = {
  id: "anti-ai-slop",
  name: "Anti-AI-Slop Manifesto",
  description: "Rules to avoid generic AI-generated design patterns. Banned colors, typography/color/layout/visual tells, and a checklist.",
  content: `# Anti-AI-Slop Manifesto

Avoid the universal fingerprints of AI-generated design. These rules distinguish intentional craft from generic output.

## Banned Colors

These colors appear in AI-generated designs due to Tailwind's default training data. **Never use as primary accent:**

- \`#6366f1\` — Tailwind Indigo 500
- \`#8b5cf6\` — Tailwind Violet 500
- \`#7c3aed\` — Tailwind Violet 700

**Safe alternatives that signal intentionality:**
- Blue: \`#2563eb\` (Tailwind Blue 600)
- Teal: \`#0d9488\` (Tailwind Teal 600)
- Green: \`#16a34a\` (Tailwind Green 600)
- Orange: \`#ea580c\` (Tailwind Orange 600)

## Typography Tells

Signs that typography was not intentionally designed:

- Same font everywhere (no display/body distinction)
- Same weight throughout (no hierarchy)
- ALL CAPS text with no letter-spacing (mandatory: 0.06–0.10em)
- No optical size variation between headings and body

## Color Tells

Signs that color was not intentionally chosen:

- Default indigo or violet as primary accent
- Decorative gradients without functional purpose
- Perfectly even color distribution (no 60/30/10 weighting)
- Pure black (#000000) or pure white (#ffffff) for text/bg

## Layout Tells

Signs that layout follows a template rather than a design decision:

- Perfect bilateral symmetry in every section
- Cookie-cutter card grids with identical aspect ratios
- Hero section: left-aligned text + right-aligned image (always)
- No variation in rhythm or density across sections

## Visual Tells

Signs that visuals were auto-generated without craft:

- Abstract blob backgrounds (the AI's default "modern" move)
- Generic 3D illustrations (floating isometrics, clay renders)
- Decorative effects (gradients, glows, blurs) without purpose
- Stock photo aesthetic without creative direction

## Shadow Tells

Signs that shadows were not designed:

- **Single-layer shadow**: \`box-shadow: 0 4px 8px rgba(0,0,0,0.25)\` — the most common AI output. Real brands use 2–5 layer stacks
- **Opacity > 0.15 per shadow layer**: Shadows should be transparent whispers, not ink. If you can clearly see the shadow color, it's too heavy
- **Border AND shadow on the same element**: Pick one depth signal — Vercel uses shadow-as-border (\`0 0 0 1px rgba(0,0,0,0.08)\`) specifically to avoid this conflict
- **Uniform shadow at all elevations**: Cards, dropdowns, and modals must have meaningfully different shadow values, not the same shadow scaled up

## Radius & Spacing Tells

Signs that spacing and radius were not intentionally designed:

- **Arbitrary spacing values**: 13px margins, 22px padding, 37px gaps — signal no grid system
- **Mixing radius archetypes**: 4px enterprise cards with pill developer-tool buttons in the same product
- **Pill inputs**: Text inputs at 9999px radius always look broken — inputs max at 10–12px
- **Uniform radius everywhere**: Every element at 8px, including tiny 20px badges — radius should be proportional
- **Zero radius**: Even the most enterprise product uses 4px minimum — 0px reads as unfinished/broken
- **Pure #000000 for body text**: Every major brand uses a warm near-black: Vercel \`#171717\`, Cal \`#242424\`, Cursor \`#26251e\`, Expo \`#1c2024\`. Pure black on white creates harsh contrast that fatigues eyes.

## Checklist Before Shipping

1. Is the primary accent color NOT indigo (#6366f1) or violet (#8b5cf6)?
2. Does ALL CAPS text have letter-spacing of at least 0.06em?
3. Would it pass a screenshot test next to curated references?
4. Are all visual choices intentional — not just Tailwind defaults?
5. Is there typographic hierarchy (at least 2 distinct font weights)?
6. Are gradients and effects functional, not decorative?
7. Is layout asymmetry used at least once to break predictability?
8. Do shadows use at least 2 layers with cumulative opacity ≤ 0.25?
9. Is body text a warm near-black (not #000000)?
10. Does border radius reflect a single archetype consistently?
`,
};
