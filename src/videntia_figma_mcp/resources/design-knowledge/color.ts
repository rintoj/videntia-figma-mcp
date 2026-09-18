import type { DesignKnowledgeModule } from "./types.js";

export const COLOR: DesignKnowledgeModule = {
  id: "color",
  name: "Color System",
  description:
    "60/30/10 distribution rule, neutral scale, primary accent, semantic colors, dark theme principles, and token naming conventions.",
  content: `# Color System

## 60/30/10 Distribution Rule

Every screen should have intentional color distribution:

- **60–80%** — Neutrals (backgrounds, surfaces, dividers)
- **10–20%** — Text hierarchy (primary, secondary, tertiary text)
- **5–10%** — Accent/brand colors (CTAs, highlights, state indicators)
- **Max 2 distinct hues per component**

Breaking this rule creates visual chaos. When in doubt, add more neutral.

## Neutral Scale (60–80% of UI)

Use 10–12 steps covering the full range:

| Step | Light Mode | Dark Mode | Usage |
|------|-----------|-----------|-------|
| 50 | \`#fafafa\` | \`#0a0a0a\` | Page background |
| 100 | \`#f5f5f5\` | \`#141414\` | Subtle backgrounds |
| 200 | \`#e5e5e5\` | \`#1f1f1f\` | Cards, elevated surfaces |
| 300 | \`#d4d4d4\` | \`#2a2a2a\` | Borders |
| 400 | \`#a3a3a3\` | \`#404040\` | Disabled borders |
| 500 | \`#737373\` | \`#8a8a8a\` | Icons, tertiary text |
| 600 | \`#525252\` | \`#a3a3a3\` | Secondary text |
| 700 | \`#404040\` | \`#bababa\` | Body text |
| 800 | \`#262626\` | \`#d4d4d4\` | Primary text |
| 900 | \`#171717\` | \`#e5e5e5\` | Headings |
| 950 | \`#0a0a0a\` | \`#fafafa\` | Maximum contrast |

**Never use pure #000000 on white or pure #ffffff on black.**

## Primary Accent Scale

One brand color as the base \`primary\` token plus a 50–900 scale. In this server (\`calculate_color_scale\`, \`create_color_scale_set\`) each step is the base composited over the background: 50 = 5% base, 500 = 50% base, 900 = 90% base — so every step is lighter (on light backgrounds) than the base itself.

| State | Token | Notes |
|-------|-------|-------|
| Default | \`primary\` | The full-strength base color |
| Hover | \`primary-900\` | Subtle shift from base |
| Active/Pressed | \`primary-800\` | Clearly distinct from hover |
| Tints/Backgrounds | \`primary-50\`–\`primary-100\` | Subtle highlight areas |

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
| Foreground | \`#0B0B0B\` | \`#f5f5f5\` | Not pure white — easier on eyes |
| Card/Surface | \`#f5f5f5\` | \`#1a1a1a\` | Distinct from background |
| Elevated | \`#ffffff\` | \`#242424\` | Layering depth |
| Border | \`#e5e5e5\` | \`#2a2a2a\` | Subtle separation |

**Rule:** Each elevation level should differ by ~1 lightness step (not by opacity).

## Token Naming — By Purpose, Not Color

| Wrong | Right | Reason |
|-------|-------|--------|
| \`blue-600\` | \`primary\` | Blue may change; role doesn't |
| \`red-500\` | \`destructive\` | Semantic intent is stable |
| \`gray-100\` | \`surface\` | Gray may not always be surface |
| \`purple-400\` | \`accent\` | Accent color can evolve |

**Naming pattern:** \`{role}\`, \`{role}-foreground\`, \`{role}-{scale}\`

Examples: \`primary\`, \`primary-foreground\`, \`primary-100\`, \`destructive\`, \`destructive-foreground\`

## Figma Variables Setup

**Existing tokens win.** Inspect the file first (\`get_variable_collections\`, \`get_variables\`). If it already has brand tokens and a naming convention, use and extend those. The order is the same as in \`design-system-usage\`: the user's or brand's explicit choices, then what the file defines, then this module's default values, example hex codes and banned-color lists.

**Slash grouping.** Figma turns \`/\` in a variable name into folders in the variables panel, e.g. \`color/bg/primary\` or \`color/text/secondary\`. Slash names and the flat role names above carry the same meaning; only the grouping differs. Pick one style per file and stay consistent. This server's standard theme schema uses flat names (\`background\`, \`primary-foreground\`, \`primary-500\`). \`get_schema_definition\` returns that schema and \`audit_collection\` checks a collection against it, so keep those names when you want a clean audit. \`bind_variable\` accepts a variable's ID or name; it tries the exact name first, then the name with dashes read as slashes, so both styles resolve.

**Two token layers.**
1. **Primitives:** the raw palette (\`blue-500\`, \`neutral-900\`, or \`blue/500\` in a slash-grouped file) in its own collection with a single mode. They are never bound directly to design nodes.
2. **Semantic tokens:** role names (\`background\`, \`primary\`, \`border\`) that alias a primitive and never hold a raw hex value of their own. Fills, strokes and text on nodes bind only to semantic tokens (\`bind_variable\`), so a rebrand or theme change is just an edit to the aliases. The same goes for shadow and focus-ring colours (\`effects/N/color\`, or \`colorVariable\` in \`set_effects\` / \`create_effect_style\`) and gradient stops (\`fills/N/gradientStops/M/color\`, or \`colorVariable\` per stop in \`set_gradient_fill\`).

Create collections and variables with \`create_variable_collection\`, \`create_variable\` and \`create_variables_batch\`. Those tools (and \`update_variable_value\`) only write raw values. Link a semantic token to its primitive by hand in Figma's variables panel, and until that link exists, treat a semantic token holding a raw value as temporary.

**Light and dark are modes, not copies.** Put Light and Dark as modes on the semantic collection. Never create a separate "Dark" collection or duplicate variables such as \`background-dark\`.
- Add a mode with \`add_mode_to_collection\` and seed it with \`duplicate_mode_values\`, then change the values that should differ.
- \`create_variable_collection\` names its first mode \`dark\` unless you pass \`defaultMode\`. Rename any leftover default mode (e.g. "Mode 1") with \`rename_mode\`.
- How many modes a collection can have depends on the Figma plan (Starter/free = 1 mode per collection), so check your plan's mode limit before designing extra themes (e.g. high contrast). When the limit is hit, \`add_mode_to_collection\` returns a mode-limit error and \`create_complete_design_system\` skips the refused modes and lists them in its result. On a single-mode plan, put each theme in its own collection with \`create_variable_collection\` and \`defaultMode\`.

**Scopes.** Limit where each variable can be applied: background/surface tokens to fills, text tokens to text fills, border tokens to strokes. That keeps the picker free of irrelevant tokens. No tool in this server sets variable scopes, so set them manually in each variable's settings in Figma.

## Contrast Requirements (WCAG)

| Text size | Minimum ratio | Target ratio |
|-----------|---------------|--------------|
| Normal text (<18pt / 24px, or <14pt / ~18.66px bold) | 4.5:1 (AA) | 7:1 (AAA) |
| Large text (≥18pt / 24px, or ≥14pt / ~18.66px bold) | 3:1 (AA) | 4.5:1 (AAA) |
| UI components, icons | 3:1 (AA) | — |
`,
};
