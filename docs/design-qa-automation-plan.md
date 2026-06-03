# Design-vs-Implementation QA Automation — Product Plan

**Date:** 2026-05-29
**Status:** Planning

## Thesis

Every overlay tool on the market (PerfectPixel, Pixelay, Over.fig, VisBug, Uiprobe) is built for a **human to eyeball and hand-fix**. They show you *that* something is off; they never *fix* it. Even the most advanced (Uiprobe) stops at an offline diff report.

We hold both ends of the loop at once: **live Figma nodes** (100+ MCP tools) **and** **live DOM/CSS** (Chrome extension). So our product is not an overlay tool — it's an **agentic QA loop**: Claude reads the design spec and the rendered page, surfaces every mismatch, and **fixes it in code or in design**, with the human only approving.

The human's job shrinks to: point at a page + a frame, then review proposed fixes. Everything else is automated.

## Design principle: minimize human effort

For every capability, ask "can Claude do this instead of the human?" The overlay/slider/ruler UX that competitors sell is a crutch for human eyeballing. We need it only as a fallback. The real deliverables are **primitives that let Claude do the comparison and remediation autonomously.**

| Old (human-driven) | New (agent-driven) |
|---|---|
| Human drags overlay, squints, spots a 2px gap | Claude diffs node spec vs computed CSS, lists exact deltas |
| Human eyedrops a color, guesses the token | Claude resolves rendered color → named Figma variable |
| Human edits CSS by hand | Claude patches the source file, re-checks |
| Human files a "design is wrong" Slack message | Claude writes a Figma comment / fixes the node |
| Human re-checks after every change | Claude loops until delta count = 0 |

---

## The agentic loop

```
1. PAIR    map each DOM element ↔ its Figma node
2. READ    pull design spec (node + bound tokens) and rendered spec (computed CSS)
3. DIFF    compute structured per-element, per-property deltas (server-side)
4. DECIDE  for each delta: is the code wrong, or is the design wrong?
5. FIX     patch source code  OR  mutate Figma node / add comment
6. VERIFY  re-read, re-diff, repeat until deltas resolved
7. REPORT  summarize what changed, what needs human judgment
```

Steps 2, 4, 5 are largely covered by tools that already exist. The missing infrastructure is **1 (pairing)**, **3 (a real diff engine)**, and **richer READ primitives**.

---

## Competitive context (summary)

Full research lives in conversation history; condensed:

- **Table stakes:** opacity overlay, toggle, per-URL persistence, multiple layers, difference/blend view, drag-reposition. We have overlay+opacity; missing blend mode + nudge.
- **Differentiators others charge for:** live Figma connection (we have it), HTML-not-bitmap reconstruction (Over.fig), CSS/Tailwind extraction (Over.fig/Uiprobe), localhost support (Pixelay; PerfectPixel can't), automated property diff (Uiprobe, batch-only).
- **Whitespace nobody occupies:** live inline property diff, **token-aware diffing** (resolve value → named variable — structurally impossible for image-based tools), auto-sync on design change, two-way edit/round-trip, per-element DOM↔node matching, contrast-vs-intent.

Our entire automation story sits in that whitespace.

---

## What Claude already has

- **Design read:** `get_node_info`, `get_nodes_info`, `get_styled_text_segments`, `get_bound_variables`, `scan_bound_variables`, `get_variables`, `get_variable_collections`, `get_styles`, `export_node_as_image`, `export_as_svg`.
- **Design write (remediation in Figma):** every mutation tool — `set_fill_color`, `set_font_size`, `set_padding`, `set_corner_radius`, `set_annotation`, `get_comments`, etc.
- **Browser read:** `get_browser_dom_nodes`, `get_browser_computed_styles`, `get_browser_page_screenshot`, `get_browser_page_info`.
- **Code write (remediation in code):** `Read` / `Edit` / `Write` / `Grep` over the project source.
- **Overlay:** `overlay_figma_selection_in_browser`, `clear_browser_overlay`.

The gap is not capability — it's **the connective tissue** that turns these into an autonomous loop without burning tokens on screenshot-eyeballing.

---

## New primitives to build

### P0 — `compare_node_to_element` (the diff engine)
**The single highest-leverage tool.** Server-side. Input: a Figma node id + a CSS selector (or paired tree). Output: structured deltas.

```jsonc
{
  "element": "button.cta",
  "node": "1:234 / Primary Button",
  "match": "matched",
  "deltas": [
    { "prop": "font-size", "design": "16px", "rendered": "14px", "severity": "high" },
    { "prop": "padding-left", "design": "24px", "rendered": "20px", "severity": "med" },
    { "prop": "background", "design": "#2563EB", "rendered": "#2B6CB0",
      "token": "color/primary", "note": "rendered value is not the bound token" }
  ]
}
```
- Normalizes units (rem↔px), color formats (hex/rgb/hsl), shorthand vs longhand.
- Pulls design side from node props + `get_bound_variables`; rendered side from computed styles.
- Returns **only deltas**, not full dumps — keeps Claude's context lean (matches the context-mode philosophy).
- Severity ranking so Claude/human triage fast.

### P0 — Element ↔ node pairing
The hardest problem; everything depends on it. Build in layers, cheapest first:
1. **Explicit map:** `data-figma-node="1:234"` attributes (or a config map) when the codebase can be annotated. Zero ambiguity.
2. **Name heuristic:** match Figma layer name ↔ DOM id/class/test-id/component name.
3. **Geometric match:** align bounding rects (node `absoluteBoundingBox` ↔ DOM `getBoundingClientRect`) after normalizing the frame origin. Good for unnamed structures.
4. **Claude-reasoned fallback:** hand Claude both trees (`get_node_info` tree + `get_browser_dom_nodes`) and let it propose pairings, cached for the session.

Ship #2+#3 first as a `pair_design_to_dom` tool returning candidate pairs with confidence; #1 as opt-in; #4 as the safety net.

### P1 — Richer browser READ primitives (extend the extension)
Current `content.js` returns a curated style subset. For autonomous diffing Claude needs more, on demand:
- **Full box model** per element (content/padding/border/margin resolved px) — like CSS Peeper.
- **Resolved fonts actually rendered** (not just declared family) — catches font-fallback bugs.
- **Asset URLs** (background-image, `<img src>`) so Claude can diff against exported node assets.
- **Full-page screenshot** (scroll-stitch), not just viewport — current `captureVisibleTab` misses below-the-fold.
- **Per-element screenshot/crop** for the rare cases visual diff beats property diff (gradients, shadows, AA).
- **Multi-viewport capture:** resize to design frame width(s), re-diff — automates responsive QA (Pixelay's manual feature).

### P1 — Source-location mapping (enables "fix in code")
To patch code, Claude must map a DOM element → the source that emits it.
- **React/Vue:** read `__source` / devtools fiber, or component `displayName`, to get file:line. Add an extension command that reads React DevTools hook data when present.
- **Fallback:** Claude greps the selector/class/text in the repo (already possible). Document the workflow so it's reliable, not ad-hoc.
- Output: candidate file + line for each element, fed to `Edit`.

### P2 — Auto-sync on design change
Plugin pushes a lightweight "node X changed" event over the existing WS channel → Claude re-diffs the affected element only. Closes the gap no competitor solves (everyone requires manual re-pull).

### P2 — Two-way remediation helpers
- **Fix in design:** already possible via mutation tools; add a thin `apply_design_fix` convenience that takes a delta and writes the node (e.g. set padding to match the agreed value).
- **Round-trip annotation:** when the *code* is correct and the *design* is stale, `set_annotation` / comment on the node with the rendered value + rationale.

### P3 — Overlay UX as fallback (table stakes parity)
Keep the human escape hatch competitive: add **difference blend mode** and **arrow-key nudge** to `content.js` overlay. Cheap, content-script-only. Useful when Claude flags "visual mismatch I can't quantify (gradient/shadow)."

---

## Remediation decision logic (step 4)

For each delta, Claude decides code-vs-design. Heuristics to encode in tool descriptions / a prompt:
- **Code wrong** (default): rendered value drifted from a clear design spec / bound token → patch source.
- **Design wrong:** the rendered value is intentional/newer (e.g. accessibility fix, content reality) → comment/annotate Figma, don't touch code.
- **Token violation:** rendered value ≈ design value but doesn't *use* the named token → fix code to reference the token.
- **Ambiguous:** surface to human with both options pre-drafted (one-click apply either side).

The product win: the human reviews *decisions and diffs*, never hunts for them.

---

## Phasing

| Phase | Ships | Outcome |
|---|---|---|
| **1** | `compare_node_to_element` + `pair_design_to_dom` (name+geometry) + box-model/font/asset reads | Claude produces a full structured mismatch report autonomously |
| **2** | Token-aware deltas + `apply_design_fix` + annotation round-trip + source-location mapping | Claude fixes in code or design, loops to zero deltas |
| **3** | Full-page + multi-viewport capture + auto-sync on design change | Responsive QA + live re-check, hands-off |
| **4** | Blend-mode/nudge overlay fallback + explicit `data-figma-node` pairing | Human escape hatch + zero-ambiguity pairing for instrumented codebases |

---

## Resolved decisions (2026-05-29)

1. **Pairing — geometry first, attribute opt-in.** Ship geometric bounding-rect matching + name heuristics as the default (works on any page, including third-party/legacy). Offer `data-figma-node="1:234"` as opt-in precision for instrumented codebases. `pair_design_to_dom` returns candidate pairs with confidence; exact attribute matches short-circuit to confidence 1.0.

2. **Diff engine — server-side.** `compare_node_to_element` runs in the MCP server, not the extension. Keeps Claude's context lean (returns only deltas) and matches the context-mode philosophy. The extension only supplies raw computed styles / box model.

3. **Code fixes — auto-edit + verify loop.** In phase 2 Claude patches the source file, re-diffs, and loops until deltas clear; the human reviews the final git diff, not each change. This is the core minimize-human-effort payoff. **Hard dependency on reliable source-location mapping** — if mapping confidence is low for an element, fall back to draft-patch for that element rather than guess-editing the wrong file.

4. **Token-awareness — bound mismatches + suggest binding.** Two checks: (a) rendered value ≠ the element's bound variable → FAIL; (b) rendered value is hardcoded but *equals* a known token → suggest binding it. The (b) case is noisier but is our most defensible differentiator (no image-based tool can do it). Group (b) suggestions separately from (a) failures so the human can triage.

5. **Visual diff — property + targeted image diff from the start.** Structured property diff is primary (~90%), but add per-element screenshot crop + pixel-compare against the exported node image in phase 1, to catch gradients, shadows, and anti-aliasing that properties miss. Requires the per-element crop read primitive (already in the P1 browser-read list).

## Implications for phasing

- Phase 1 now explicitly includes **per-element image diff** (moved up from "later") and the **crop screenshot** read primitive becomes P1, not P2.
- Phase 2's auto-edit loop is **gated by source-location mapping confidence** — low confidence ⇒ draft patch, not auto-edit. This makes source-location mapping a phase-2 critical path, not a nice-to-have.
- Token check (b) "suggest binding" needs the full variable set (`get_variables`) loaded once per session and matched by resolved value — add a value→token index to the diff engine.
