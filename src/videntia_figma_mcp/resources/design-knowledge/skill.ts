import type { DesignKnowledgeModule } from "./types.js";

export const SKILL: DesignKnowledgeModule = {
  id: "skill",
  name: "Research-First Design Methodology",
  description: "5-phase workflow (Discover→Research→Analyze→Design→Implement), discovery questions, and a quality gate checklist.",
  content: `# Research-First Design Methodology

A structured 5-phase workflow that produces intentional design rather than template-filling.

## The 5 Phases

### Phase 1: Discover
Define the problem before touching any design tool.

**Discovery questions to answer:**
1. **What** — What is this product/feature? What does it do?
2. **Who** — Who is the primary user? What's their context?
3. **Goal** — What is the single most important action we want users to take?
4. **Feeling** — What should users feel? (confident, delighted, relieved, impressed?)
5. **Job-to-be-done** — "When [situation], I want to [motivation], so I can [outcome]"
6. **Objections** — What hesitations will users have? What might stop them?
7. **Memorable hook** — What one thing will make this unforgettable?
8. **Constraints** — Platform, brand, tech, time, accessibility requirements?

**Output:** A one-paragraph design brief that anyone on the team could act on.

### Phase 2: Research
Gather 50–100 visual references before designing anything.

**Where to look:**
- Dribbble, Behance, Mobbin (UI patterns)
- Real products in the same category (competitor UX)
- Adjacent industries (banking patterns in health, game UI in productivity)
- Screenshot your own experiences when you notice something that works

**What to capture:** Screenshots organized by: layout patterns, color palettes, typography choices, interaction patterns, onboarding flows.

**Anti-pattern:** Starting design with zero references → guaranteed generic output.

### Phase 3: Analyze
Extract the specific techniques from your references.

**Create a "steal list" — minimum 5 items:**
- Specific technique: "Clay's hero uses oversized number + tight caption underneath"
- Specific detail: "ElevenLabs uses 11px all-caps with 0.08em tracking in nav labels"
- Specific pattern: "BoldVoice's onboarding uses 1 question per screen, large type, minimal chrome"

**Not:** "I like this design" — that's inspiration, not analysis.
**Yes:** "This design uses [specific technique] to achieve [specific effect]" — that's a steal list item.

### Phase 4: Design
Execute with craft and soul using the research.

**Principles:**
- Start with the most critical screen (usually the value moment or first impression)
- Apply steal list items explicitly — name them as you use them
- Challenge every default decision: Is this Inter because it's right, or because it's the default?
- Apply anti-AI-slop checklist before any presentation

**Craft standards:**
- Typography: 2+ distinct weights, correct letter-spacing at every size
- Color: 60/30/10 distribution, no banned colors, semantic token naming
- Spacing: 4px or 8px grid, consistent rhythm
- Motion: Defined timing for all interactive states (even if not implemented yet)

### Phase 5: Implement
Quality gate before shipping.

## Quality Gate

Four dimensions, each with a go/no-go check:

### Functional
- [ ] Is the primary action visually obvious without reading any text?
- [ ] Can a new user complete the core flow in under 3 taps/clicks?
- [ ] Are error states and empty states designed (not just happy path)?

### Visual
- [ ] Does it pass the squint test? (Step back, blur eyes — hierarchy still clear?)
- [ ] Would it pass a screenshot test next to 3 curated references?
- [ ] Is there no banned color in the accent role?

### Persuasion
- [ ] Is the value proposition clear within 3 seconds of landing?
- [ ] Does the visual hierarchy lead the eye to the desired action?
- [ ] Are friction points (forms, confirmations) minimized?

### Polish
- [ ] No orphaned words (single word on last line of a paragraph)?
- [ ] All interactive states designed (default, hover, focus, active, disabled)?
- [ ] Consistent spacing (every gap is a multiple of 4px or 8px)?
- [ ] All copy in active voice, with correct Title Case on headings and buttons?

**Ship when:** All 4 dimensions have no blockers. One blocker = iterate. Multiple blockers = redesign.
`,
};
