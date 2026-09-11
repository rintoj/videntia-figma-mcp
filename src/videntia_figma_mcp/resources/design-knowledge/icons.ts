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

**Rule:** Match icon size to the surrounding text size. A 16px icon next to 13–14px text, a 20px icon next to 16px text.

## Touch Target Sizing

Even if the icon is 20px, its touch target must be at least 44×44px (iOS HIG) on mobile. In Figma, wrap the icon in a fixed 44×44 auto-layout frame with centre alignment rather than enlarging the glyph.

## Placing Icons in Figma

1. **Reuse first.** Before importing anything, look for icon components already in the file (\`get_local_components\`, \`search_nodes\`). Instance an existing icon component instead of importing a duplicate.
2. **Import, never draw.** Don't assemble icons from rectangles, lines, or rotated primitives — they misalign and are painful to edit. Use \`search_icon\` to find a Lucide name, then \`create_icon\` (\`parentId\`, \`name\`, \`size\`, optional \`color\`); swap an existing one with \`update_icon\`. For a custom glyph, paste its SVG with \`create_svg\`.
3. **Fixed-size container.** Place each icon inside a square frame at the target size (16/20/24px) so replacing the glyph never shifts surrounding layout.
4. **Check strokes after resizing.** Scaling imported vectors may not keep the stroke weight you expect — inspect the result (\`get_node_info\`) rather than assuming it still matches the set's 2px/24px ratio.

### SVG import hygiene (\`create_svg\`)

- Give the root \`<svg>\` a \`viewBox\` **and** explicit \`width\`/\`height\`. Markup missing the size attributes imports at whatever the viewBox implies, which is rarely the icon size you want.
- Figma layers don't inherit colour, so \`currentColor\` in raw markup won't follow the parent. Put a literal colour in the markup, then recolour with \`set_stroke_color\` / \`set_fill_color\` or bind a colour variable with \`bind_variable\` (\`strokes/0/color\` or \`fills/0/color\` on the vector layers).
- \`create_icon\` handles this for Lucide icons: \`color\` accepts a CSS colour or a token name (token names are bound as a variable); omitting it yields black.

### Icons inside components

- \`create_icon\` and \`create_svg\` produce plain layers, not components. Convert each icon you will reuse into a component once (\`create_component\`) so it can be instanced and swapped.
- Expose the icon as **one \`INSTANCE_SWAP\` property** (\`add_component_property\`, linked to the nested icon instance via \`set_component_property_references\` with \`mainComponent\`) — never one variant per icon. Pair it with a \`BOOLEAN\` property if the icon is optional. See the \`components\` module for property strategy.
- Keep the swappable instance inside the fixed-size container frame so every swapped icon occupies the same box.

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
| **Lucide** | Outline, 2px stroke | SaaS default | Cleanest, most neutral; the library behind this server's \`search_icon\` / \`create_icon\` |
| **Heroicons** | Outline + Solid | Tailwind projects | Two weights, well-maintained |
| **Phosphor** | 6 weights | Design systems needing flexibility | Most versatile |
| **Material Symbols** | Variable weight | Google-adjacent products | Very large set, distinct style |
| **SF Symbols** | Variable | iOS/macOS only | Apple-exclusive, not for web |

## Color Usage

- **Monochrome default:** Bind the icon to the same colour variable as its adjacent text/label so they stay in sync across modes
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
