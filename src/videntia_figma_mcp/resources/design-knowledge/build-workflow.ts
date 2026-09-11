import type { DesignKnowledgeModule } from "./types.js";

export const BUILD_WORKFLOW: DesignKnowledgeModule = {
  id: "build-workflow",
  name: "Figma Build Workflow & QA",
  description:
    "How to build in Figma step by step: choosing an edit mode, inspecting first, skeleton-then-sections build order, cheap frequent verification, a canvas QA checklist, and ID-based recovery.",
  content: `# Figma Build Workflow & QA

The mechanics of turning a design decision into correct layers on the canvas. This module assumes the thinking is done — for the brief and references, load \`skill\` first; its quality gate applies again to the finished design, alongside the QA checklist below. Everything here is about working inside the Figma file.

## 1. Decide the Mode Before Touching Anything

The amount of inspection and design judgment a task needs depends on what kind of change it is. Classify the request first:

| Mode | Typical requests | How much design latitude |
|------|------------------|--------------------------|
| **Edit in place** | Change copy, recolor, resize, fix alignment, swap an icon | None — match what already exists and change only what was asked |
| **Extend existing** | Add a section, a new state, a sibling screen; "restyle" or "improve" a frame | Low — the file is the style guide. Read its spacing, type, color and component habits and continue them |
| **Create new** | Blank page or a brand-new screen with no precedent | Full — run the \`skill\` methodology, then build |

A "redesign" of an existing frame is still *extend existing*: the output should look like it belongs to the same file.

## 2. Inspect Before You Build

Never create blind. A few read-only calls prevent duplicates, wrong parents and off-system styling.

- **Orient:** \`get_document_info\` for pages, \`enumerate_all_frames\` for the top-level frames on each page, \`get_selection\` when the user points at something.
- **Drill down:** \`get_node_info\` / \`get_nodes_info\` with a \`depth\` that fits the question. The default is 1 (direct children); use a larger number for a section, and \`"all"\` only on small subtrees since it can time out on deep documents.
- **Find:** \`search_nodes\` to look up nodes by name (optionally scoped to a parent and filtered by type); \`scan_nodes_by_types\` to collect every TEXT or INSTANCE inside a known parent.
- **Read the system:** \`get_design_system\` for variables, text styles and effect styles; \`get_local_components\` before drawing anything that could be an instance. See \`design-system-usage\` and \`components\`.
- **Read the copy:** \`get_content_tree\` gives a text inventory with inferred roles — useful for extending a screen with consistent tone and hierarchy.

**Check before you create.** If the frame, section or component you are about to make might already exist (a previous attempt, a user draft), search for it by name first and reuse or update it instead of adding a second copy.

## 3. Build Order: Skeleton → Sections → Content

Large builds fail in the middle. Structure the work so every step leaves the file in a sensible state.

1. **Wrapper first.** Create the outer frame for the screen or component with \`create_frame\`, placed in clear canvas space away from existing work, sized to the target device, and named properly from the start. Set its auto-layout immediately (see \`auto-layout\`).
2. **One section per step.** Create each major region (header, hero, list, footer) directly inside the wrapper using \`parentId\`. Building loose frames on the page and moving them in later invites wrong positions and stray leftovers.
   **Decide clipping as you create.** A top-level \`create_frame\` clips by default, which suits a screen root (so does one placed in a section); frames created inside another frame do not. Pass \`clipsContent: true\` only to a section that is genuinely a crop, mask or scroll area — clipping anywhere else cuts off shadows, glows and focus rings of the children (see \`auto-layout\`).
3. **Fill content last.** Once the sections exist, place instances, text and imagery inside them, then apply tokens and styles.

**Keep a ledger of IDs.** Every create call returns the new node's ID. Record it with a short note of what it is, and pass those IDs to later calls instead of re-searching by name. The ledger is also your cleanup list if something goes wrong.

**Batch the small stuff.** Many small edits (renames, fills, sizing, variable bindings across a dozen nodes) belong in one \`batch_actions\` call. Later actions can reference outputs of earlier ones with \`$result[N]\`, so a clone-then-rename sequence needs no round trip. Set \`stopOnError: true\` when later steps depend on earlier ones. For replacing many strings inside one container, \`set_multiple_text_contents\` is the direct route.

Keep each batch focused on one section: a failure then affects a small, known area.

## 4. Verify Cheaply and Often

Two kinds of checks, used at different moments:

- **Structural (cheap, every step):** \`get_node_info\` on the section you just built. Confirm child count, order, names, parent, sizing modes and that instances point at the intended component.
- **Visual (at milestones):** \`export_node_as_image\` on the section — not only the finished screen. A whole-screen export at small scale hides clipped descenders, placeholder strings and wrong variants. Export individual sections as you complete them, and use \`scale: 2\` when checking small text or icons.

Do not start the next section while the current one has a known problem. Defects compound: a wrong sizing mode in a parent will distort every child added later.

## 5. QA Checklist (Before Calling It Done)

Work through this on the finished frame. Most items take one read call each.

**Layout**
- [ ] No clipped or truncated text — line height and frame sizing leave room for ascenders, descenders and every line
- [ ] Text boxes wrap correctly: every multi-line text reports \`textAutoResize: "HEIGHT"\` in \`get_node_info\`, no paragraph runs off as one line or collapses to a character per line, nothing overflows a fixed box. \`lint_frame\` does not inspect wrapping — check it directly
- [ ] No clipped shadows, glows or focus rings: \`lint_frame\`'s \`clipped-content\` rule flags content cut by a \`clipsContent\` ancestor; also \`export_node_as_image\` at \`scale: 2\` on each elevated section, and fix with \`set_clips_content\` or padding
- [ ] No overlapping layers that should sit side by side; nothing spilling past its parent (\`lint_frame\` flags child overflow)
- [ ] Sizing modes are intentional: fixed vs hug vs fill on each container

**Content**
- [ ] No leftover placeholder copy ("Title", "Label", "Lorem ipsum", "Button") — scan with \`get_content_tree\`
- [ ] Each instance uses the correct variant and property values; check with \`get_instance_overrides\` and fix with \`swap_instance\` when the base component is wrong
- [ ] Font family and weight match the file's type system, not a fallback — confirm with \`get_styled_text_segments\` (\`fontName\`, \`fontWeight\`)

**System compliance**
- [ ] Run \`lint_frame\` on the root: it reports unbound colors, spacing and radius, missing text/effect styles, missing auto-layout, child overflow, content cut by clipping ancestors and screen naming by severity. It is a structural check, not a visual review. Resolve CRITICAL and HIGH items before handing off
- [ ] If the screen uses a color variable collection, \`validate_color_contrast\` checks its foreground/background pairs against WCAG AA or AAA (per mode)

**Hygiene**
- [ ] No hidden, empty or orphaned layers left over from experiments
- [ ] Layers and frames carry meaningful names — no "Frame 427" or "Rectangle 12"; fix with \`rename_node\` (batched)
- [ ] Nothing stray left on the page outside the wrapper

Use \`set_focus\` to bring a problem node into view when you want the user to look at it.

## 6. Fix in Place

When something is wrong, change the broken property on the existing node — resize it, change its sizing mode, swap the instance, rewrite the text. Deleting a section and rebuilding it throws away correct work, breaks the ID ledger, and often reintroduces the same bug. Rebuild only when the structure itself is wrong (wrong parent, wrong nesting) and a targeted edit cannot reach it.

## 7. Recovery

- **Clean up by ID, never by name pattern.** Removing "everything named Card…" will also hit the user's own layers and earlier approved work. Delete only the IDs in your ledger, using \`delete_multiple_nodes\`, then re-inspect the page to confirm nothing else moved.
- **Checkpoint before big changes.** Call \`save_version_history\` with a descriptive title before a large restructure, a bulk token rebinding or anything touching many screens. It gives the user a named restore point in the file history.
- **Undo deliberately.** \`undo\` reverts the most recent undo step. Write tools are committed as undo steps as they run; call \`commit_undo\` to close an explicit checkpoint so a subsequent \`undo\` only reverts work done after it. Prefer undo for the last change or two; for anything older, fix forward.
- **After an error mid-build,** re-read the affected section with \`get_node_info\` before retrying — a partly successful step may already have created nodes, and blindly repeating it produces duplicates.

## Related Modules

Load with \`get_design_knowledge\`:
- \`skill\` — research-first methodology before building, and the design quality gate to pass before shipping
- \`auto-layout\` — container structure and sizing modes for wrappers and sections
- \`components\` — when to instance, variant selection and overrides
- \`design-system-usage\` — binding variables and styles instead of hardcoding
`,
};
