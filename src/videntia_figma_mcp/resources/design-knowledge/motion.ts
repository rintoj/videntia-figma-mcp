import type { DesignKnowledgeModule } from "./types.js";

export const MOTION: DesignKnowledgeModule = {
  id: "motion",
  name: "Motion & Animation",
  description: "Timing ranges (90–500ms), easing curves for enter/exit/state changes, and micro-interaction patterns.",
  content: `# Motion & Animation

## Timing Ranges

| Category | Duration | Use Cases |
|----------|----------|-----------|
| Instant | 90–150ms | Tooltips, hover highlights, focus rings, button press feedback |
| State change | 160–240ms | Toggle switches, checkboxes, tab transitions, color changes |
| Page / Panel | 240–360ms | Drawers, modals, page transitions, expanding sections |
| Complex / Orchestrated | 360–500ms | Multi-element staggered sequences, onboarding flows, data reveals |

**Rule:** When in doubt, go shorter. Users notice slow animations; they don't notice fast ones.

**Never exceed 500ms** for any standard UI interaction. Reserve 500ms+ for intentional "premium feel" moments (onboarding, empty state celebrations).

## Easing Curves

| Direction | CSS | Cubic Bezier | Notes |
|-----------|-----|--------------|-------|
| Enter (appearing) | ease-out | cubic-bezier(0, 0, 0.2, 1) | Starts fast, decelerates — feels natural |
| Exit (disappearing) | ease-in | cubic-bezier(0.4, 0, 1, 1) | Starts slow, accelerates — feels like leaving |
| State change | ease-in-out | cubic-bezier(0.4, 0, 0.2, 1) | Smooth in both directions |
| Bounce / Spring | — | cubic-bezier(0.34, 1.56, 0.64, 1) | Overshoot for playful feel |

**Rule:** Never use linear easing for UI animations — it feels mechanical and wrong.

## Micro-Interaction Patterns

### Button Feedback
- Press: scale(0.97) + 90ms ease-in + slight darken
- Release: scale(1.0) + 150ms ease-out
- Hover: background color shift + 160ms ease-in-out

### Form Fields
- Focus: border color change + ring expand + 160ms ease-out
- Error shake: translateX(-4px, 4px, -4px, 0) over 240ms (4 keyframes)
- Success checkmark: scale(0→1) + opacity(0→1) + 200ms ease-out

### Loading States
- Skeleton: opacity pulse 0.4→0.8 over 1200ms, ease-in-out, infinite
- Spinner: rotate 360deg over 700ms, linear, infinite
- Progress bar: width transition + 240ms ease-out per increment

### Navigation & Overlays
- Modal open: opacity(0→1) + translateY(8px→0) + 240ms ease-out
- Modal close: opacity(1→0) + 160ms ease-in (faster than open)
- Drawer: translateX(-100%→0) + 280ms ease-out
- Tooltip: opacity(0→1) + 90ms ease-out (very fast)

### List & Data
- Item add: opacity(0→1) + translateY(8px→0) + 200ms ease-out
- Item remove: opacity(1→0) + height(N→0) + 160ms ease-in
- Stagger: 30–50ms delay between consecutive items (max 6 staggered)

## Rules

1. **Enter slower than exit** — Entering needs to feel intentional; exiting needs to feel snappy
2. **Reduce motion** — Always respect \`prefers-reduced-motion\`; fallback to instant or opacity-only
3. **One animation at a time** — Avoid simultaneous complex animations on the same element
4. **Function over decoration** — Every animation should communicate state, not just look cool
`,
};
