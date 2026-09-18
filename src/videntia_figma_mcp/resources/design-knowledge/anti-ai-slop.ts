import type { DesignKnowledgeModule } from "./types.js";

export const ANTI_AI_SLOP: DesignKnowledgeModule = {
  id: "anti-ai-slop",
  name: "Anti-AI-Slop Manifesto",
  description:
    "Rules to avoid generic AI-generated design patterns. Precedence of brand/file tokens, banned colors, typography/color/layout/composition/visual tells, and a checklist.",
  content: `# Anti-AI-Slop Manifesto

Avoid the universal fingerprints of AI-generated design. These rules distinguish intentional craft from generic output.

## Precedence

These rules are defaults for when nothing else has been decided. They yield to, in order:

1. What the user or brand guidelines explicitly say for this design
2. What the Figma file already defines: variables, styles, components and the look of existing screens (inspect with \`get_design_system\` or \`get_variable_collections\`)

If the brand accent is on the banned list, use it anyway — the ban targets unexamined defaults, not deliberate brand decisions. See the \`design-system-usage\` module for how to work within an existing system.

## Banned Colors

These colors appear in AI-generated designs due to Tailwind's default training data. **Never use as primary accent:**

- \`#6366f1\` — Tailwind Indigo 500
- \`#8b5cf6\` — Tailwind Violet 500
- \`#7c3aed\` — Tailwind Violet 600

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
- Pure black (#000000) text on pure white (#ffffff), or pure white text on pure black

## Layout Tells

Signs that layout follows a template rather than a design decision:

- Perfect bilateral symmetry in every section
- Cookie-cutter card grids with identical aspect ratios
- Hero section: left-aligned text + right-aligned image (always)
- No variation in rhythm or density across sections

## Composition Tells

Signs that a frame was assembled from one reflex instead of composed:

- **One container for everything**: every group of content sits in the same card with the same fill, stroke, and radius, whether it is a stat, a form, or a quote
- **A rule under every heading**: divider lines added by habit rather than to separate genuinely distinct regions
- **Everything equidistant**: one gap value between all elements, so related items don't cluster and unrelated ones don't separate — proximity carries no meaning
- **Same anchor on every screen**: content always centered, or always pinned top-left, regardless of what each screen needs to emphasize
- **Ghost decoration**: background shapes or blobs at such low opacity they barely register — either commit to them or delete them
- **Flat type scale**: sizes clustered within a few pixels of each other (e.g. 14/16/18), so nothing reads as a headline
- **Grey body text for mood**: long-form copy set in a light grey to look refined, at the cost of contrast and legibility
- **Palette-swap variety**: sections or screens that share one identical layout and differ only in their colors
- **Default 50/50 splits**: two equal columns where an uneven split (60/40, 70/30) would give one side clear priority

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
- **Pure #000000 for body text**: Every major brand uses a near-black: Vercel \`#171717\`, Cal \`#242424\`, Cursor \`#26251e\`, Expo \`#1c2024\`. Pure black on white creates harsh contrast that fatigues eyes.

## Checklist Before Shipping

1. Is the primary accent color NOT Indigo 500 (#6366f1), Violet 500 (#8b5cf6), or Violet 600 (#7c3aed) — unless it is the established brand color?
2. Does ALL CAPS text have letter-spacing of at least 0.06em?
3. Would it pass a screenshot test next to curated references?
4. Are all visual choices intentional — not just Tailwind defaults?
5. Is there typographic hierarchy (at least 2 distinct font weights)?
6. Are gradients and effects functional, not decorative?
7. Is layout asymmetry used at least once to break predictability?
8. Do shadows use at least 2 layers with cumulative opacity ≤ 0.25?
9. Is body text a near-black (not #000000)?
10. Does border radius reflect a single archetype consistently?
11. Does spacing group related elements, with containers and dividers used only where they separate real regions?
`,
};
