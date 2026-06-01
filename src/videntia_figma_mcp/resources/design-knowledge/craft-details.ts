import type { DesignKnowledgeModule } from "./types.js";

export const CRAFT_DETAILS: DesignKnowledgeModule = {
  id: "craft-details",
  name: "Craft Details",
  description: "Focus states, form best practices, touch targets, mobile interaction patterns, and content copy rules.",
  content: `# Craft Details

The 10% of work that separates good design from great. These are the details that users feel but rarely articulate.

## Focus States

- **Always use \`:focus-visible\`**, not \`:focus\` — \`:focus\` fires on mouse click too, creating visible rings during mouse interactions
- **NEVER remove focus without a replacement.** \`outline: none\` with no substitute is an accessibility failure
- Recommended focus ring: \`box-shadow: 0 0 0 2px {background}, 0 0 0 4px {ring-color}\`
- The 2px background gap creates visual separation from the element border
- Focus ring color: Use primary color at 40–60% opacity or a dedicated \`--ring\` token

## Forms

### Input Types
Use correct input types for proper mobile keyboards:

| Content | Input type | Mobile keyboard |
|---------|------------|-----------------|
| Email | \`type="email"\` | Shows @ and .com |
| Phone | \`type="tel"\` | Numeric dial pad |
| Number | \`type="number"\` | Numeric with decimals |
| URL | \`type="url"\` | Shows .com and / |
| Search | \`type="search"\` | Shows search/go key |
| Password | \`type="password"\` | Hidden characters |

### Non-negotiable Rules
- **NEVER block paste** in password fields. It breaks password managers and alienates security-conscious users
- **Placeholders with ellipsis** for truncated hints: \`"Enter your email address…"\`
- Show passwords on demand with an eye toggle — never force retyping
- Never auto-capitalize in \`<input type="email">\` or \`type="url"\`
- Auto-complete attributes (\`autocomplete="email"\`, etc.) — always include

### Validation
- Validate on blur (not on keystroke) for initial entry — validate on keystroke after first error
- Inline error messages below the field, not in a toast
- Error messages describe the fix, not the mistake: "Must be at least 8 characters" not "Password too short"

## Touch Targets

| Context | Minimum hit area | Notes |
|---------|-----------------|-------|
| Mobile / touch | 44×44px | iOS HIG requirement |
| Desktop / mouse | 32×32px | Fitts' Law minimum for comfort |
| Critical actions | 48×48px | Delete, confirm, purchase |

**Pattern:** Visually small element with a larger invisible tap region:
\`\`\`css
.small-icon-button {
  position: relative;
  /* Visual size */
  width: 20px; height: 20px;
}
.small-icon-button::before {
  content: '';
  position: absolute;
  inset: -12px; /* Expands hit area to 44px */
}
\`\`\`

### Remove 300ms Tap Delay
\`\`\`css
* { touch-action: manipulation; }
\`\`\`
This eliminates the 300ms double-tap detection delay on mobile browsers.

## Content Copy Rules

| Rule | Example (wrong) | Example (right) |
|------|-----------------|-----------------|
| Active voice | "Your order was placed" | "We placed your order" |
| Title Case for headings/buttons | "create new project" | "Create New Project" |
| Numerals for counts | "five items" | "5 items" |
| Specific action labels | "Submit" | "Save Changes" / "Send Message" |
| No ellipsis in buttons | "Loading…" button | "Loading" + spinner |
| Avoid "click here" | "Click here to learn more" | "Learn more about pricing" |

## Spacing & Density

- **Text line-height:** 1.5–1.6 for body, 1.2–1.3 for headings
- **Paragraph spacing:** 0.75–1em (slightly less than line-height)
- **Section spacing:** 2–4× the component internal spacing
- **Consistent base unit:** 4px or 8px grid. Every spacing value = multiple of base unit

## Accessibility Checklist

- [ ] All images have meaningful alt text (or \`alt=""\` if decorative)
- [ ] Color is never the only indicator of meaning
- [ ] Interactive elements have visible focus states
- [ ] Minimum contrast 4.5:1 for body text, 3:1 for large text
- [ ] Touch targets ≥44×44px on mobile
- [ ] Forms have visible labels (not just placeholders)
- [ ] Error messages are announced to screen readers (\`aria-live\`)
`,
};
