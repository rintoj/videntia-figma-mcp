# Figsor Competitive Analysis

**Repo:** https://github.com/AsifKabirAntu/figsor  
**Date:** 2026-04-23 (deep analysis update: 2026-04-23)  
**Summary:** Figsor is a Figma ↔ Cursor MCP bridge with ~45 tools. This document compares it against our codebase and identifies gaps, adoptable ideas, and our advantages.

**Source attribution:** Design knowledge modules are based on [Refero Design Skill](https://github.com/referodesign/refero_skill) (MIT licensed), bundled directly into the MCP server.

---

## Architecture Overview

| Aspect | Figsor | Ours |
|--------|--------|-------|
| Runtime | Node.js + tsc | Bun + tsup |
| Language | TypeScript (ES module) | TypeScript |
| MCP SDK | `@modelcontextprotocol/sdk` v1.12.1 | v1.9.0 |
| Server structure | Single `server.ts` (64KB, ~1700 lines) | Modular files per tool category |
| Plugin code | Single `code.js` (60KB, plain JS) | `code.ts` compiled from TS modules |
| Connection model | Direct 1:1 WebSocket (no channels) | Channel-based multi-client |
| Tools count | ~45 | 80+ |
| Port | 3055 (env: `FIGSOR_PORT`) | 3000 |
| Auth | HMAC-SHA256 handshake | None |
| Tests | None | 242 passing |
| Dependencies | `ws`, `zod`, `@modelcontextprotocol/sdk` (3 deps) | Same + Bun ecosystem |
| Plugin manifest | `documentAccess: "dynamic-page"` | Similar |
| Network domains | `localhost:3055`, `*.figma.com`, `*.quiver.ai` | `localhost:3000`, `*.figma.com` |
| npm distribution | `npx -y figsor` (published to npm) | Local build |

---

## What Figsor Has That We Don't

### 1. HMAC Handshake Authentication (Security Gap)

Figsor implements a nonce-challenge handshake on every WebSocket connection:

1. Server generates a 32-byte random nonce via `crypto.randomBytes(32).toString("hex")`
2. Server sends `{ type: "handshake_challenge", nonce }` to the connecting client
3. Plugin responds with `{ type: "handshake_response", hash: HMAC-SHA256(nonce, HANDSHAKE_KEY) }`
4. Server computes `createHmac("sha256", HANDSHAKE_KEY).update(nonce).digest("hex")` and compares
5. 5-second handshake timeout, then `ws.close(4001, "Handshake timeout")`
6. Unauthenticated messages are rejected with `{ type: "error", error: "Handshake required" }`

**Shared key obfuscation:** The key is split into 8 fragments (`_a` through `_h`) and reassembled at runtime: `const HANDSHAKE_KEY = [_a, _b, _c, _d, _e, _f, _g, _h].join("")` yielding `"fgsr7x9KmQ3pWv2RnL8jHt5YcD4sbA6e"`. This deters casual inspection of the source but is not true security (the key is in the published npm package).

**We have zero auth.** Any process that can reach port 3000 can issue commands. This is worth adding, especially as the tool is used in more contexts.

---

### 2. Peer Design / Multi-Agent Cursors

Their most visually impressive feature. Simulates multiple AI "designers" working simultaneously as Figma-native colored cursor labels.

**Tools:**
- `spawn_design_agent` — creates a named, colored cursor on the canvas (like a real collaborator joining)
- `dismiss_design_agent` — removes one agent
- `dismiss_all_agents` — clears all agents when done
- Every creation/modification tool accepts an optional `agentId` parameter — the cursor animates to each element as it's built

**How it works in practice:**  
The LLM is instructed (via tool descriptions) to spawn 3 named agents (Nic, Deniz, Jaffa), then batch all 3 agents' tool calls in a single response. The result is a visual "3 designers working simultaneously" effect on the Figma canvas.

**Cursor rendering implementation (plugin-side):**
- The cursor arrow is an SVG path created via `figma.createNodeFromSvg()`: `M0.5 0.5L0.5 18.5L5.5 14L8.5 21L11 19.5L8 12.5H14L0.5 0.5Z` (a classic pointer arrow shape, filled with the agent's color, white 1.2px stroke)
- The name label is a Figma FRAME with auto-layout (`HORIZONTAL`, 8px horizontal padding, 3px vertical padding, `cornerRadius: 5`), filled with the agent's color, containing an Inter Semi Bold 11px white text node
- Arrow + label are grouped via `figma.group()`, named `"Agent: {name}"`, and `locked = true`
- On startup, the plugin cleans up stale cursors from previous sessions: `figma.currentPage.findAll(n => n.name.startsWith('Agent: '))`

**Movement personality system:**
Each agent gets a distinct movement personality assigned round-robin:
- `_fast`: `speedScale: 0.7`, `wanderRadius: 40`, pause 60-140ms
- `_moderate`: `speedScale: 1.0`, `wanderRadius: 55`, pause 80-200ms  
- `_deliberate`: `speedScale: 1.35`, `wanderRadius: 35`, pause 120-280ms

**Idle wander behavior:**
- 65% of ticks: sit still (simulates a real designer's resting hand)
- 35% of ticks: small drift from current position (not home position, for organic feel)
- Uses `setTimeout` (not async) so other agents tick during pauses

**Targeted movement (when building):**
- Uses minimum-jerk interpolation to move smoothly to target elements
- Duration scales with distance: `min(max(dist * 2.2, 200), 600) * personality.speedScale`
- Wander pauses during targeted work, resumes after

**Peer Design rules (embedded in tool description):**
1. BE CONSISTENT: Pick a cohesive style and apply everywhere
2. USE AUTO-LAYOUT: Every container must use `set_auto_layout`
3. TRULY SIMULTANEOUS: All 3 agents in the SAME tool call batch (never sequential)
4. COMPLETE EACH PIECE: Each element gets frame + auto-layout + stroke + content in one burst

**Effort:** Medium (plugin-side cursor rendering required). High visual/demo impact.

---

### 3. Design Knowledge as Runtime MCP Resource

Figsor bundles a `design-knowledge/` directory with professional design guidance exposed as a queryable MCP tool (`get_design_craft_guide`). Claude can fetch these during a design session — not just at prompt time.

**Modules:**

| File | Content |
|------|---------|
| `anti-ai-slop.ts` | Rules against generic AI design (no default indigo/violet, no blob backgrounds) |
| `typography.ts` | Type scale, font pairing, weight, line-height, letter-spacing rules |
| `color.ts` | 60/30/10 rule, dark theme, contrast, token structure |
| `motion.ts` | Micro-interactions, timing (90–500ms), easing curves |
| `icons.ts` | Sizing, optical corrections, style consistency |
| `craft-details.ts` | Focus states, forms, touch/mobile, accessibility |
| `example-workflow.ts` | Full worked example of the Research-First methodology |

**Notable: Anti-AI-Slop Manifesto (exact rules)**  
- **BANNED colors:** `#6366f1` (indigo), `#8b5cf6` (violet), `#7c3aed` (purple) — the "universal fingerprint of AI-generated design" from Tailwind training data
- **Safe alternatives:** Blue `#2563eb`, Teal `#0d9488`, Green `#16a34a`, Orange `#ea580c`
- **Typography tells:** Same font everywhere, same weight throughout, no letter-spacing on ALL CAPS, missing display/body distinction
- **Color tells:** Default indigo/violet, gradients without function, perfectly even color distribution
- **Layout tells:** Perfect symmetry, cookie-cutter card grids, hero with left text + right image
- **Visual tells:** Abstract blob backgrounds, generic 3D illustrations, effects without purpose
- **Checklist:** Is accent NOT indigo? Does ALL CAPS have letter-spacing? Would it pass screenshot test next to references? Are choices intentional?

**Typography guide (exact type scale):**
- Minor Third scale (1.2x) from 16px base: 11px caption, 13px small, 16px body, 19px large, 23px H4, 28px H3, 33px H2, 40px H1, 48px display, 57px hero
- Text colors: Primary `#0B0B0B`, Secondary `rgba(0,0,0,0.65)`, Tertiary `rgba(0,0,0,0.45)`, Disabled `rgba(0,0,0,0.3)`
- Dark mode: Primary `#F5F5F5`, Secondary `rgba(255,255,255,0.7)`, Tertiary `rgba(255,255,255,0.5)`
- Letter-spacing rules: Body 0, Small text (11-13px) 0.01-0.02em REQUIRED, ALL CAPS 0.06-0.10em MANDATORY, Large headings (32px+) -0.01 to -0.02em, Display (48px+) -0.02 to -0.03em
- Safe SaaS font preset: Inter, system-ui, sans-serif; weights 400/500/600; line-height 1.55; max-width 65ch
- Font pairing guidance: SaaS/Tech: Inter, SF Pro, Geist | Finance: Inter, IBM Plex Sans | Startup: Inter, DM Sans, Plus Jakarta

**Color guide (exact palette structure):**
- Neutrals (70-90% of UI): 10-12 steps from `#fafafa` (50) to `#0a0a0a` (950). Never pure `#000` on white.
- Primary accent: One brand color with 50-950 scale. 500-600 default, 600-700 hover, 700-800 active, 50-100 for tints.
- Semantic: Success (green), Warning (amber), Danger (red), Info (blue optional). Each needs base, bg tint, border, on-color.
- 60/30/10 rule: 60-80% neutrals, 10-20% text hierarchy, 5-10% accents. Max 2 colors per component.
- Dark theme: NOT inverted. Background `#0f0f0f` (not `#000`), text `#f0f0f0` (not `#fff`), elevated surface `#242424`.
- Token naming: By purpose not color (`--primary` not `--blue`).

**Motion guide (exact timing):**
- Instant (90-150ms): hover, press, toggle, focus
- State change (160-240ms): accordion, tabs, small panels
- Page/large (240-360ms): modal, drawer, route transition
- Complex (360-500ms): large layout reflow (rare)
- Easing: Enter = ease-out, Exit = ease-in, State change = ease-in-out. NEVER linear.
- Button hover: bg shift 120ms. Button press: scale(0.98) 90-120ms. Modal: fade+scale 200ms.

**Icons guide (exact sizing):**
- Small 16px: inline with body, table cells. Medium 20-24px: buttons, nav, forms. Large 28-32px: feature cards, empty states.
- Optical corrections: Play triangles shift right 0.5-1px. Aim for equal visual mass.
- One icon style per product, no mixing libraries (Lucide + Heroicons = collage).
- Libraries ranked: Lucide (SaaS default), Heroicons (Tailwind), Phosphor (6 weights), Material Symbols, SF Symbols.

**Craft details guide:**
- Focus states: Use `:focus-visible` not `:focus`. NEVER remove without replacement.
- Forms: Correct input types for mobile keyboards. NEVER block paste. Placeholders with ellipsis.
- Touch: 44x44px hit area on touch, 32x32px desktop. `touch-action: manipulation` to remove 300ms delay.
- Content copy: Active voice, Title Case for headings/buttons, numerals for counts, specific labels.

**Research-First methodology (skill.ts):**
- 5-phase workflow: Discover (design brief) -> Research (50-100 references) -> Analyze (steal list, min 5 items) -> Design (craft + soul) -> Implement (quality gate)
- Discovery questions: What, Who, Goal, Feeling, Job-to-be-done, Objections, Memorable hook, Constraints
- Quality gate: Functional (primary action obvious?), Visual (squint test?), Persuasion (hook in 3 sec?), Polish (orphaned words?)
- Example workflow: SaaS churn reduction for TaskFlow, 6-screen cancellation flow, specific references from Clay, ElevenLabs, BoldVoice

**How guides are exposed:**  
Delivered as an MCP tool `get_design_craft_guide` that accepts a guide name ("skill", "typography", "color", "anti-ai-slop", etc.) and returns the full markdown content. The `DESIGN_GUIDES` constant maps each key to a name and description, so the LLM can discover available guides.

**We only have design guidance in `CLAUDE.md`** — not accessible at runtime by the model during active Figma sessions.

---

### 4. `list_available_fonts` Tool

Returns fonts available in the Figma environment grouped by family + styles. Also returns `projectFonts` — fonts already used in the file's text styles (i.e. the design system's typography choices).

Useful before creating text nodes to avoid font loading failures and stay consistent with the file's existing type system.

---

### 5. `export_as_svg` with Batch Mode

Exports a node as SVG markup string. Batch mode (`exportChildren: true`) exports all direct children as individual SVGs in one call — ideal for icon sets.

Our `export_node_as_image` exports raster formats only (PNG/JPG). SVG export gives the model actual editable vector markup it can analyze or transform.

---

### 6. `set_constraints` Tool

Sets responsive constraints on nodes: `MIN / CENTER / MAX / STRETCH / SCALE` on both axes. Controls how a node behaves when its parent frame is resized. Works on children of non-auto-layout frames.

We currently lack a dedicated constraints tool.

---

### 7. `find_nodes` with Text Content Search

Searches by name, type, AND text content simultaneously. Useful for finding all instances of a specific label or copy string across a page.

Our `search_nodes` covers name/type — worth verifying text content search parity.

---

### 8. `read_node_properties` with Depth Parameter

Dedicated inspection tool with configurable tree traversal depth (default 2). Simpler, more predictable API than our `get_node_info` for inspection use cases.

---

### 9. `move_to_parent` Tool

Moves a node into a different parent frame at a specific child index. Enables layer hierarchy restructuring.

Our `move_node` handles position — need to verify re-parenting support.

---

### 10. `boolean_operation` Tool

Performs boolean operations (union, subtract, intersect, exclude) on multiple selected nodes. Essential for constructing custom shapes, icon design, and complex vector work without relying on SVG import.

We have no equivalent — any custom shape work currently requires importing pre-built SVGs.

---

### 11. `create_vector` Tool

Creates arbitrary vector paths with defined vertices and segments (pen-tool equivalent). Enables programmatic construction of custom shapes, curves, and paths directly on the canvas.

Combined with `boolean_operation`, this gives Figsor a basic vector drawing pipeline we lack entirely.

---

### 12. `create_line` Tool

Simple line creation tool. Trivial gap but worth noting for completeness.

---

### 13. `style_text_range` Tool

Applies different styles to character ranges within a single text node — e.g., bold the first word, color a substring, italicize a phrase. Useful for rich text formatting without splitting into multiple text nodes.

We have `get_styled_text_segments` but it is **read-only** (returns existing segment info). We have no tool to **apply** different styles to character ranges within a single text node. Our per-property tools (`set_font_size`, `set_font_weight`, etc.) apply to the entire node. This is a confirmed gap.

---

### 14. Quiver AI Integration

Two tools calling the external Quiver AI API from the MCP server (not the plugin, bypassing Figma iframe network restrictions):

- `quiver_generate_svg` — generate SVG from text prompt, with optional reference images
- `quiver_vectorize_svg` — convert raster image to clean SVG

Also supports `use_plugin_image: true` — the plugin has an image upload section, and the MCP server retrieves the uploaded image via a special `get_quiver_context` command before calling the API.

The MCP server calls Quiver directly from Node.js (not the Figma iframe) to bypass Figma's network restrictions. The plugin provides the API key and optional uploaded image via a `get_quiver_context` command. The plugin UI has a dedicated image upload section and API key settings panel.

The `generate_svg` return format includes a `tip` field: `"Use create_svg_node with the svg field to place this in Figma."` — guiding the LLM to the next tool call.

Less relevant for us to adopt unless we integrate an external AI service, but the pattern of calling external APIs from the MCP server (not the plugin) is worth noting.

---

## MCP Server Instructions (System Prompt)

Figsor embeds a detailed system prompt via the `instructions` field of `McpServer`:

```
You are a professional UI/UX designer working through Figsor — a Figma design tool.

BEFORE creating any design, you MUST:
1. Call get_design_craft_guide("skill") to load the Research-First design methodology
2. For specific craft areas, also call get_design_craft_guide with "typography", "color", "anti-ai-slop", etc.

CRITICAL RULES (always follow):
- NEVER use indigo/violet (#6366f1, #8b5cf6) as accent color unless explicitly asked
- ALWAYS use frames + auto-layout for every container. Use padding/spacing, never hardcoded x/y
- ALWAYS set letter-spacing on ALL CAPS text (3-5px) and tighten large headings 32px+ (-0.3 to -0.5px)
- NEVER use pure #000000 for text — use #0B0B0B or #111111
- Omit fillColor on layout-only container frames (they should be transparent)
- Follow a 4px or 8px spacing grid
- Max 2 font families. Max 6-8 font sizes. Max 3-4 text color levels
- Color palette: 70-90% neutrals, 5-10% primary accent, semantic colors for status only
```

This is notable because:
1. It tells the LLM to actively fetch design guides at runtime (not just rely on context)
2. It embeds hard rules against common AI design mistakes directly in the MCP protocol layer
3. It prescribes a specific workflow (discover -> research -> design) rather than just providing tools

---

## Tool Schema Deep Dive (Exact Parameters)

Key differences in how Figsor defines tool schemas vs our approach:

**Every creation/modification tool has an `agentId` parameter:**
```typescript
agentId: z.string().optional().describe("Design agent ID — agent cursor animates to this element")
```
This is on `create_frame`, `create_text`, `create_rectangle`, `create_ellipse`, `create_line`, `create_svg_node`, `set_auto_layout`, `modify_node`, `set_stroke`, `set_effects`, `set_fill`, `set_image_fill`, `create_component`, `create_component_instance`, etc. It threads the multi-agent cursor system through the entire tool surface.

**Tool descriptions include explicit LLM usage hints:**
- `create_vector`: "This is the most powerful drawing tool — use it for complex custom shapes, organic forms, character illustrations, logos"
- `set_fill`: "Use this for advanced fill configurations that modify_node's simple fillColor can't handle"
- `find_nodes`: "Use this to find existing elements before editing them"
- `export_as_svg`: "Use this to extract icon SVGs before applying animations"
- Return values include actionable tips: `{ tip: "Use create_svg_node with the svg field to place this in Figma." }`

**`modify_node` is a Swiss-army-knife tool (not in our model):**
Accepts x, y, width, height, name, fillColor, opacity, cornerRadius, visible, rotation, characters (text), fontSize, textAlignHorizontal, layoutSizingHorizontal, layoutSizingVertical. This single tool covers what we split across `resize_node`, `set_fill_color`, `set_corner_radius`, `set_text_content`, `set_font_size`, `set_layout_sizing`, etc. Trade-off: convenience vs explicit tool names for the LLM.

**`set_auto_layout` includes `clipsContent` parameter:**
```typescript
clipsContent: z.boolean().optional().describe("Whether to clip content that overflows the frame bounds")
```
Plus `wrap` mode: `z.enum(["NO_WRAP", "WRAP"]).optional().describe("Wrapping behavior — WRAP flows children to next line")`.

**`create_vector` has dual input modes:**
1. `vectorNetwork` — structured vertices + segments with bezier tangents, stroke caps/joins, corner radii, handle mirroring
2. `vectorPaths` — array of SVG path data strings with winding rules

**`set_fill` supports 5 gradient types:**
`SOLID`, `GRADIENT_LINEAR`, `GRADIENT_RADIAL`, `GRADIENT_ANGULAR`, `GRADIENT_DIAMOND` — with gradient stops (color hex + position 0-1) and optional 2x3 transform matrix.

---

## Architectural Decisions to Consider Adopting

### Priority 1 — HMAC Handshake Auth
**Effort:** Low | **Impact:** Security  
Simple to add to our WebSocket server. Prevents unauthorized local connections. The shared key can be embedded in both the plugin and server (obfuscated at runtime as Figsor does, or stored in config).

### Priority 2 — Design Knowledge at Runtime
**Effort:** Low-Medium | **Impact:** Output quality  
Bundle typography/color/spacing/anti-slop rules as TypeScript constants, expose as an MCP tool or resource. Claude would call this before starting a design session. The anti-AI-slop guidance is especially high-value — it actively shapes output quality toward more intentional design decisions.

### Priority 3 — `list_available_fonts`
**Effort:** Low | **Impact:** Reliability  
Prevents font loading failures. Surfaces project fonts (already in the design system) to help Claude stay typographically consistent.

### Priority 4 — `export_as_svg` with batch mode
**Effort:** Low-Medium | **Impact:** Completeness  
Adds SVG export alongside our existing raster export. Batch children mode is useful for icon libraries.

### Priority 5 — `set_constraints`
**Effort:** Low | **Impact:** Completeness  
Responsive layout support is a gap. Small plugin handler + one MCP tool.

### Priority 6 — `style_text_range` (Range-Based Text Styling)
**Effort:** Low-Medium | **Impact:** Design quality  
We can read styled segments but not write them. Adding a tool to apply font/color/weight to character ranges within a single text node would enable rich text (bold labels, colored substrings) without splitting into multiple nodes.

### Priority 7 — `boolean_operation` + `create_vector`
**Effort:** Medium | **Impact:** Completeness  
Vector drawing pipeline for custom shapes, icons, logos. `boolean_operation` (union/subtract/intersect/exclude) + `create_vector` (pen-tool paths). Currently we rely entirely on SVG import for custom shapes.

### Priority 8 — `import_component_by_key` / `import_style_by_key`
**Effort:** Low | **Impact:** Design system integration  
Allows importing components and styles from team libraries by key. Enables the LLM to use shared design system assets, not just local components.

### Priority 9 — Parallel Batching Hints in Tool Descriptions
**Effort:** Zero | **Impact:** Speed  
Figsor's tool descriptions and peer design rules explicitly instruct the LLM to batch 3+ tool calls per response. Adding similar hints to our tool descriptions is a free speed win.

### Priority 10 — Agent Cursor Animation
**Effort:** Medium-High | **Impact:** Visual/Demo  
High wow factor, useful for showcasing multi-step design generation. Requires plugin-side multiplayer cursor rendering. Nice-to-have.

---

## Our Advantages Over Figsor

| Area | Our Advantage |
|------|--------------|
| **Variable/token system** | 24 dedicated tools vs their 3 basic variable tools |
| **Color scales** | `calculate_color_scale`, `create_all_scales`, composite blending algorithm |
| **WCAG validation** | `validate_color_contrast`, AA/AAA checking — entirely absent in Figsor |
| **Batch operations** | `batch_actions` reduces round-trips for multi-property ops |
| **Multi-client** | Channel system supports multiple simultaneous Figma files |
| **Lint & audit** | `lint_frame`, `generate_audit_report`, `scan_nodes_by_types` |
| **Variable binding** | `scan_bound_variables`, `bind_variable`, `unbind_variable` |
| **Rich text styling** | Letter spacing, line height, text case, paragraph spacing, text decoration (but no range-based styling — whole-node only) |
| **Progress updates** | Long-operation timeout resets on activity (vs flat 30s) |
| **Test coverage** | 242 passing tests vs zero |
| **Schema system** | `export_collection_schema`, `import_collection_schema`, `audit_collection` |

---

## Plugin Handler Map (Complete)

The Figma plugin dispatches commands to these handlers:

```
create_frame, create_rectangle, create_ellipse, create_text, create_line, create_svg_node,
set_auto_layout, modify_node, set_stroke, set_effects,
delete_node, move_to_parent,
get_selection, get_page_structure, read_node_properties,
list_components, create_component_instance, detach_instance, get_local_styles,
import_component_by_key, import_style_by_key,
find_nodes, set_selection,
create_vector, boolean_operation, flatten_nodes, set_fill,
set_image_fill, style_text_range, set_constraints,
create_component, create_component_set,
create_variable_collection, create_variable, bind_variable, get_variables,
list_available_fonts, export_as_svg,
spawn_agent, dismiss_agent, dismiss_all_agents
```

Notable: `import_component_by_key` and `import_style_by_key` — these let the LLM import components/styles from team libraries by key, which we don't support.

**Plugin defaults vs ours:**
- `create_frame` defaults to opaque white fill if `fillColor` is omitted (same issue we documented)
- `create_text` defaults to Inter Regular 14px if no font specified
- `create_rectangle`/`create_ellipse` default to 100x100
- `handleCreateText` loads fonts via `figma.loadFontAsync()` before setting characters (same pattern)

---

## Performance Notes

- Figsor's 1:1 direct connection has marginally less per-message overhead (no channel routing), but the difference is negligible in practice.
- Figsor uses a flat `COMMAND_TIMEOUT_MS = 30_000` (30s). Our progress-update timeout reset is **superior** for long operations.
- When WebSocket disconnects, Figsor rejects all pending requests immediately (`"Figma plugin disconnected"`) and clears the map. Clean error handling.
- The `run()` helper pattern is clean: `async (params) => run("command_name", params)` — a single dispatch function wraps all tool calls with error handling and `ok()`/`err()` response formatting.
- The main speed win in Figsor is prompt-level batching: tool descriptions explicitly instruct the LLM to issue multiple parallel tool calls per response, especially in peer design mode ("Every response should contain 3+ tool calls at once"). We should reinforce this pattern more strongly in our own tool descriptions.
- Figsor's `sendCommand` uses `randomUUID()` for request IDs with a pending request map pattern identical to ours.

---

## Tool Parity Checklist

| Figsor Tool | Our Equivalent | Gap? |
|-------------|---------------|------|
| `create_frame` | `create_frame` | No |
| `create_rectangle` | `create_rectangle` | No |
| `create_text` | `create_text` | No |
| `create_ellipse` | — | Yes (minor) |
| `set_auto_layout` | `set_auto_layout` | No |
| `set_constraints` | — | **Yes** |
| `find_nodes` | `search_nodes` | Partial (text content search?) |
| `read_node_properties` | `get_node_info` | No |
| `move_to_parent` | `move_node` | Partial (re-parenting?) |
| `get_page_structure` | `get_document_info` | No |
| `get_selection` | `get_selection` | No |
| `set_selection` | `set_selections` | No |
| `export_as_svg` | — | **Yes** |
| `list_available_fonts` | — | **Yes** |
| `list_components` | `get_local_components` | No |
| `create_component_instance` | `create_component_instance` | No |
| `create_line` | — | **Yes (trivial)** |
| `create_vector` | — | **Yes** |
| `boolean_operation` | — | **Yes** |
| `style_text_range` | — | **Yes** (we only have read-only `get_styled_text_segments`) |
| `get_local_styles` | `get_styles` | No |
| `get_design_craft_guide` | — | **Yes** |
| `spawn_design_agent` | — | **Yes (optional)** |
| `flatten_nodes` | `flatten_node` | No |
| `set_fill` (multi/gradient) | `set_fill_color` / `set_gradient_fill` | Partial (we split into 2 tools) |
| `set_stroke` | `set_stroke_color` | Partial (they include dashPattern) |
| `set_effects` | `set_effects` | No |
| `modify_node` (Swiss-army) | Multiple specific tools | Different approach (theirs is 1 tool, ours is many) |
| `set_image_fill` | `set_image_fill` | No |
| `create_component` | `create_component` | No |
| `create_component_set` | `create_component_set` | No |
| `create_variable_collection` | `create_variable_collection` | No |
| `create_variable` | `create_variable` | No |
| `bind_variable` | `bind_variable` | No |
| `get_variables` | `get_variable_collections` | No |
| `detach_instance` | `detach_instance` | No |
| `import_component_by_key` | — | **Yes** |
| `import_style_by_key` | — | **Yes** |
| `delete_node` | `delete_node` | No |
| `quiver_generate_svg` | — | Out of scope |
| `show_animation_preview` | — | Out of scope |
