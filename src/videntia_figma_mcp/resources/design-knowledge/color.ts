import type { DesignKnowledgeModule } from "./types.js";

export const COLOR: DesignKnowledgeModule = {
  id: "color",
  name: "Color System",
  description: "60/30/10 distribution rule, neutral scale, primary accent, semantic colors, dark theme principles, and token naming conventions.",
  content: `# Color System

## 60/30/10 Distribution Rule

Every screen should have intentional color distribution:

- **60–80%** — Neutrals (backgrounds, surfaces, dividers)
- **10–20%** — Text hierarchy (primary, secondary, tertiary text)
- **5–10%** — Accent/brand colors (CTAs, highlights, state indicators)
- **Max 2 distinct hues per component**

Breaking this rule creates visual chaos. When in doubt, add more neutral.

## Neutral Scale (70–90% of UI)

Use 10–12 steps covering the full range:

| Step | Light Mode | Dark Mode | Usage |
|------|-----------|-----------|-------|
| 50 | \`#fafafa\` | \`#0a0a0a\` | Page background |
| 100 | \`#f5f5f5\` | \`#141414\` | Subtle backgrounds |
| 200 | \`#e5e5e5\` | \`#1f1f1f\` | Cards, elevated surfaces |
| 300 | \`#d4d4d4\` | \`#2a2a2a\` | Borders |
| 400 | \`#a3a3a3\` | \`#404040\` | Disabled borders |
| 500 | \`#737373\` | \`#525252\` | Icons, secondary text |
| 600 | \`#525252\` | \`#737373\` | Tertiary text |
| 700 | \`#404040\` | \`#a3a3a3\` | Secondary text |
| 800 | \`#262626\` | \`#d4d4d4\` | Primary text |
| 900 | \`#171717\` | \`#e5e5e5\` | Headings |
| 950 | \`#0a0a0a\` | \`#fafafa\` | Maximum contrast |

**Never use pure #000000 on white or pure #ffffff on black.**

## Primary Accent Scale

One brand color, 50–950 scale:

| State | Scale Steps | Notes |
|-------|-------------|-------|
| Default | 500–600 | Standard interactive state |
| Hover | 600–700 | Darker = more intent |
| Active/Pressed | 700–800 | Darkest interactive |
| Tints/Backgrounds | 50–100 | Subtle highlight areas |

## Semantic Colors

Each semantic role needs 4 tokens:

| Role | Base | Background tint | Border | On-color |
|------|------|-----------------|--------|----------|
| Success | Green | Green-50 | Green-200 | White |
| Warning | Amber | Amber-50 | Amber-200 | Black |
| Danger/Error | Red | Red-50 | Red-200 | White |
| Info | Blue | Blue-50 | Blue-200 | White |

## Dark Theme Principles

Dark mode is **NOT** the inverted light palette. It's a separate, intentional design:

| Token | Light | Dark | Why |
|-------|-------|------|-----|
| Background | \`#ffffff\` | \`#0f0f0f\` | Not pure black — reduces glare |
| Foreground | \`#0B0B0B\` | \`#f0f0f0\` | Not pure white — easier on eyes |
| Card/Surface | \`#f5f5f5\` | \`#1a1a1a\` | Distinct from background |
| Elevated | \`#ffffff\` | \`#242424\` | Layering depth |
| Border | \`#e5e5e5\` | \`#2a2a2a\` | Subtle separation |

**Rule:** Each elevation level should differ by ~1 lightness step (not by opacity).

## Token Naming — By Purpose, Not Color

| Wrong | Right | Reason |
|-------|-------|--------|
| \`--blue-600\` | \`--primary\` | Blue may change; role doesn't |
| \`--red-500\` | \`--destructive\` | Semantic intent is stable |
| \`--gray-100\` | \`--surface\` | Gray may not always be surface |
| \`--purple-400\` | \`--accent\` | Accent color can evolve |

**Naming pattern:** \`{role}\`, \`{role}-foreground\`, \`{role}-{scale}\`

Examples: \`primary\`, \`primary-foreground\`, \`primary-100\`, \`destructive\`, \`destructive-foreground\`

## Contrast Requirements (WCAG)

| Text size | Minimum ratio | Target ratio |
|-----------|---------------|--------------|
| Normal text (<18px) | 4.5:1 (AA) | 7:1 (AAA) |
| Large text (18px+ or 14px bold) | 3:1 (AA) | 4.5:1 (AAA) |
| UI components, icons | 3:1 (AA) | — |
`,
};
