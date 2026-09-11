import type { DesignKnowledgeModule } from "./types.js";

export const MOTION: DesignKnowledgeModule = {
  id: "motion",
  name: "Motion & Animation",
  description:
    "Timing ranges (90–500ms), easing for enter/exit/state changes, micro-interaction patterns, and how to express them in Figma prototypes.",
  content: `# Motion & Animation

## Timing Ranges

| Category | Duration | Use Cases |
|----------|----------|-----------|
| Instant | 90–150ms | Tooltips, hover highlights, focus rings, button press feedback |
| State change | 160–240ms | Toggle switches, checkboxes, tab transitions, color changes |
| Page / Panel | 240–360ms | Drawers, modals, page transitions, expanding sections |
| Complex / Orchestrated | 360–500ms | Large surfaces, staggered element entrances, data reveals |

**Rule:** When in doubt, go shorter. Users notice slow animations; they don't notice fast ones.

**Upper bound: 500ms per UI transition.** No single element's transition should exceed 500ms. A staggered or entrance sequence (onboarding, empty-state celebration) may run longer in total, as long as each element's own transition stays within its range. Continuous loops (spinners, skeleton pulses) are not transitions and follow their own cycle length.

## Easing

| Direction | Intent | Figma easing | Bezier equivalent |
|-----------|--------|--------------|-------------------|
| Enter (appearing) | ease-out: starts fast, decelerates | \`EASE_OUT\` | (0, 0, 0.2, 1) |
| Exit (disappearing) | ease-in: starts slow, accelerates away | \`EASE_IN\` | (0.4, 0, 1, 1) |
| State change | ease-in-out: smooth at both ends | \`EASE_IN_AND_OUT\` | (0.4, 0, 0.2, 1) |
| Playful overshoot | spring | \`GENTLE\` / \`QUICK\` / \`BOUNCY\` / \`SLOW\`, or \`CUSTOM_SPRING\` | — |
| Continuous loop | constant speed | \`LINEAR\` | (0, 0, 1, 1) |

**Springs are not beziers.** A cubic bezier with overshooting control points only approximates a spring: it has a fixed duration and a single overshoot, with no settling. Where Figma offers a spring easing, use it instead of faking one with a custom curve.

**Rule:** Never use linear easing for UI transitions; it feels mechanical. Continuous loops (spinners) are the exception.

## Micro-Interaction Patterns

### Button Feedback
- Press: scale to 97% + slight darken, 90ms ease-in
- Release: scale back to 100%, 150ms ease-out
- Hover: background color shift, 150ms ease-in-out

### Form Fields
- Focus: border color change + focus ring appears, 150ms ease-out
- Error shake: horizontal nudge left 4px, right 4px, left 4px, back to rest, 240ms total
- Success checkmark: scale 0→100% + opacity 0→100%, 200ms ease-out

### Loading States
- Skeleton: opacity pulse 40%→80%, 1200ms cycle, ease-in-out, looping
- Spinner: full rotation, 700ms cycle, linear, looping
- Progress bar: width grows per increment, 240ms ease-out

### Navigation & Overlays
- Modal open: fade in + rise 8px, 240ms ease-out
- Modal close: fade out, 160ms ease-in (faster than open)
- Drawer: slide in from its edge, 280ms ease-out
- Tooltip: fade in, 90ms ease-out (very fast)

### List & Data
- Item add: fade in + rise 8px, 200ms ease-out
- Item remove: fade out + collapse height, 160ms ease-in
- Stagger: 30–50ms delay between consecutive items (max 6 staggered)

## In Figma

- **Prototype transitions:** \`add_prototype_link\` sets trigger (\`ON_CLICK\`, \`ON_HOVER\`, \`ON_PRESS\`, \`ON_DRAG\`, \`AFTER_TIMEOUT\`, \`MOUSE_ENTER\`, \`MOUSE_LEAVE\`), navigation (\`NAVIGATE\`, \`OVERLAY\`, \`SWAP\`, \`SCROLL_TO\`, \`CHANGE_TO\`), \`transitionType\` (e.g. \`SMART_ANIMATE\`, \`DISSOLVE\`, \`MOVE_IN\`, \`SLIDE_IN\`, \`PUSH\`), \`transitionDuration\`, and \`transitionEasing\` (\`EASE_IN\`, \`EASE_OUT\`, \`EASE_IN_AND_OUT\`, \`LINEAR\`). Use \`SMART_ANIMATE\` between component variants for state changes (hover, pressed, toggled).
- **Spring and custom curves on transitions:** the link tool only takes an easing name, so set spring presets, \`CUSTOM_SPRING\`, or custom bezier curves manually in Figma's prototype panel.
- **Motion tokens:** \`create_variable\` supports \`TIMING\` (duration in seconds, e.g. 0.24) and \`EASING\` variables. \`EASING\` accepts \`EASE_IN\`, \`EASE_OUT\`, \`EASE_IN_AND_OUT\`, \`LINEAR\`, the \`*_BACK\` variants, \`GENTLE\`, \`QUICK\`, \`BOUNCY\`, \`SLOW\`, \`HOLD\`, \`CUSTOM_CUBIC_BEZIER\` (with x1/y1/x2/y2), and \`CUSTOM_SPRING\` (with bounce 0–1).
- **Units:** Figma stores transition durations in seconds, and \`get_frame_animations\` reports them in seconds. Read back after \`add_prototype_link\` to confirm the stored duration matches the intended value.
- **Timeline keyframe animation** (animation styles, keyframes) is not authored by this server; set it manually in Figma.

## Verifying Motion

Screenshots and PNG exports show only the resting state, never the motion itself.
- **Prototype transitions:** audit with \`get_frame_animations\` (type, duration, easing, bezier points, trigger) or \`map_prototype_flows\` for the navigation graph, then play the prototype in Figma.
- **Timeline animation:** export the top-level animated frame with \`export_node_as_image\` using \`GIF\`, \`MP4\`, or \`WEBM\`. Video export rejects nested frames and individual keyframed layers. Keep \`fps\` low and \`quality\` \`LOW\` while iterating.

## Rules

1. **Enter slower than exit.** Entering should feel intentional; exiting should feel snappy.
2. **Reduce motion.** Design a reduced-motion alternative for users with \`prefers-reduced-motion\` enabled: instant or opacity-only, with no movement or scaling.
3. **One animation at a time.** Avoid simultaneous complex animations on the same element.
4. **Function over decoration.** Every animation should communicate a change of state, not just look cool.
`,
};
