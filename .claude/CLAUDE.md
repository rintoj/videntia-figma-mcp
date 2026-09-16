# Figma MCP - Project Guide

## Overview

This project provides a Model Context Protocol (MCP) server that enables Claude to interact with Figma through a comprehensive set of tools. It includes 80+ Figma commands covering node manipulation, components, text, variables, and theme management.

## Technology Stack

- **Runtime**: Bun (TypeScript runtime)
- **Language**: TypeScript 5.8+
- **Build Tool**: tsup
- **Testing**: Jest
- **MCP SDK**: @modelcontextprotocol/sdk v1.9.0

## Build Commands

Use **Bun** for all development commands:

```bash
# Development
bun run dev              # Watch mode with auto-rebuild
bun run build            # Production build
bun run build:watch      # Build in watch mode

# Testing
bun test                 # Run all tests
bun test --watch         # Watch mode
bun run test:coverage    # Generate coverage report

# Linting & Formatting
bun run lint             # Type-check + format check
bun run format           # Auto-fix formatting

# Running
bun run start            # Start MCP server
bun run socket           # Start WebSocket server
```

## Project Structure

```
src/
├── videntia_figma_mcp/
│   ├── server.ts                    # MCP server entry point
│   ├── tools/
│   │   ├── variable-tools.ts        # Variable management (24 tools)
│   │   ├── document-tools.ts        # Document operations
│   │   ├── creation-tools.ts        # Node creation
│   │   ├── modification-tools.ts    # Node modification
│   │   ├── text-tools.ts            # Text operations
│   │   ├── component-tools.ts       # Component operations
│   │   ├── composite-tools.ts       # One-round-trip composites
│   │   └── verification-tools.ts    # Contrast/overlap/assert/token checks
│   ├── utils/
│   │   ├── color-calculations.ts    # Color math & WCAG
│   │   ├── theme-schema.ts          # Theme schema definitions
│   │   ├── websocket.ts             # Figma plugin communication
│   │   ├── figma-helpers.ts         # Helper functions
│   │   ├── compact-node.ts          # Compact/summary/geometry formatting
│   │   ├── export-image-post.ts     # Crop/downscale/save-to-disk exports
│   │   ├── normalize-batch-params.ts# Batch ↔ standalone param aliasing
│   │   └── verification-math.ts     # Contrast/overlap/diff math
│   └── types/
│       └── index.ts                 # TypeScript definitions
├── videntia_figma_plugin/
│   ├── index.ts                     # Command dispatch + READONLY_COMMANDS
│   ├── handlers/                    # Per-domain command handlers
│   │   ├── composites.ts
│   │   ├── verification.ts
│   │   ├── sections.ts
│   │   └── lint/suppress.ts         # ignore_rules + per-node roles
│   ├── utils/
│   │   ├── write-verify.ts          # Strict mode / silent no-op detection
│   │   └── document-guard.ts        # __expectedFile cross-file guard
│   └── code.js                      # Generated plugin bundle (bun run build)
├── socket-channel-guard.ts          # Stale-channel hard fail
└── socket.ts                        # WebSocket server

tests/
├── integration/                     # Integration tests
│   └── variable-tools.test.ts       # Variable tools tests
└── unit/                            # Unit tests
    └── utils/                       # Utility tests
        ├── color-calculations.test.ts
        └── theme-schema.test.ts
```

## Variable Management Tools (New)

### Theme Variables System

The project implements a comprehensive theme variable management system with 106 standard variables:
- **36 base semantic colors** (surfaces, brand, states, interactive, feedback, utility)
- **70 color scale variants** (7 colors × 10 levels each)
- **8 optional chart colors**

### Tool Categories

**Collection Management (3 tools)**
- `get_variable_collections` - List all collections
- `create_variable_collection` - Create new collection
- `get_collection_info` - Get collection metadata

**Variable CRUD (6 tools)**
- `create_variable` - Create single variable
- `create_variables_batch` - Bulk creation
- `update_variable_value` - Update values
- `rename_variable` - Rename variables
- `delete_variable` - Delete single variable
- `delete_variables_batch` - Bulk deletion

**Color Calculations (4 tools - server-side)**
- `calculate_color_scale` - Generate 10-level scales
- `calculate_composite_color` - Color compositing
- `convert_color_format` - Format conversions
- `calculate_contrast_ratio` - WCAG validation

**Schema Validation (4 tools)**
- `audit_collection` - Compare against standard
- `validate_color_contrast` - WCAG AA/AAA checks
- `get_schema_definition` - Get schema
- `suggest_missing_variables` - Get recommendations

**Templates & Presets (3 tools)**
- `apply_default_theme` - Apply reference theme
- `create_color_scale_set` - Create color families
- `apply_custom_palette` - Apply brand colors

**Organization (4 tools)**
- `reorder_variables` - Organize variables
- `generate_audit_report` - Generate reports
- `export_collection_schema` - Export JSON
- `import_collection_schema` - Import JSON

**Bulk Operations (3 tools)**
- `create_all_scales` - Create all 7 scales
- `fix_collection_to_standard` - Auto-fix compliance
- `add_chart_colors` - Add chart colors

## Color Input Formats

All color tools (`set_fill_color`, `set_stroke_color`) accept colors in two formats:

1. **Hex string** (preferred for batch operations):
   - `"#ff0000"` — 6-digit hex
   - `"#f00"` — 3-digit shorthand
   - `"#ff000080"` — 8-digit hex with alpha
   - `"#f008"` — 4-digit shorthand with alpha

2. **RGBA components** (0–1 normalized):
   - `{ r: 1, g: 0, b: 0, a: 1 }`

Both formats work with `batch_actions` — pass `{ color: "#ff0000" }` or `{ r: 1, g: 0, b: 0, a: 1 }`.

The `export_node_as_image` format parameter accepts both lowercase and uppercase (e.g. `"png"` or `"PNG"`).

## Color Scale Algorithm

The project uses a **composite blending** approach for color scales:

```
Formula: resultant RGB = (base × mix%) + (background × (1 - mix%))

Mix percentages:
  50:  5%    (closest to background)
  100: 10%
  200: 20%
  300: 30%
  400: 40%
  500: 50%   (halfway blend)
  600: 60%
  700: 70%
  800: 80%
  900: 90%   (closest to base)
```

## WCAG Contrast Standards

Built-in accessibility validation:
- **AA Normal**: 4.5:1 minimum
- **AA Large**: 3:1 minimum
- **AAA Normal**: 7:1 minimum
- **AAA Large**: 4.5:1 minimum

## Figma ↔ Browser Diff Tooling

### The `data-fig-id` convention

To pair implemented DOM elements with their Figma design nodes deterministically (no
computer vision, no geometry heuristics), annotate app markup with the Figma node id:

```html
<section data-fig-id="3082:47270">…</section>
```

In React apps, prefer a small dev-only helper so annotations never ship to production
(reference implementation: `apps/web/src/lib/fig-id.ts` in HomeVault):

```tsx
export function figId(id: string): { 'data-fig-id'?: string } {
  if (process.env.NODE_ENV === 'production') return {}
  return { 'data-fig-id': id }
}

<section {...figId('3082:47270')}>…</section>
```

- `diff_figma_to_browser` (no `css_selector`) resolves `[data-fig-id="<node_id>"]` first,
  falling back to image-template matching only when the annotation is absent.
- `diff_figma_frame_to_page` pairs annotated elements at cost 0 before running the
  Hungarian geometry matcher; duplicate annotations are ignored (geometry fallback).
- `buildStableSelector` in the Chrome extension prefers `data-fig-id` over `data-testid`.
- Pass `annotation_map: true` to `diff_figma_frame_to_page` to get an annotation plan:
  `suggested` (geometry-matched pairs as ready-to-apply instructions — figmaId, selector,
  tag, confidence, and an `apply` string) plus `unmatched` (figmaId → name/type/text
  needing manual mapping).

> ⚠️ Figma node ids are stable within a file but change when nodes are copied to another
> file. Re-run with `annotation_map: true` after such moves to refresh annotations.

### Frame-level style audit

`diff_figma_frame_to_page` with `include_style_diff: true` fetches computed styles for all
matched pairs in ONE batched round trip (`get_computed_styles_batch`) and returns
mismatch-only rows per node (`styleDiff.mismatches`), including auto-layout ↔ flexbox
rows (layout-mode, justify-content, align-items, flex-wrap, gap). Rows carry
`severity: "error" | "warn"` — warns cover hug-content sizing drift and grid-for-flex
implementations. Semantic equivalences are normalized away (border-as-inset-ring,
flex-centered `text-align: left`).

## Browser Control Tools

The Videntia Browser Connect extension (`src/chrome_extension/`) exposes full Chrome
control to MCP, driven over the WebSocket relay (`"browser"` channel) and executed via
`chrome.debugger` (CDP 1.3). The CDP session manager lives in
`src/chrome_extension/cdp.js`; MCP tool definitions in
`src/videntia_figma_mcp/tools/browser-control-tools.ts`.

**Interaction** — `browser_click`, `browser_hover`, `browser_scroll`, `browser_type`,
`browser_press_key`, `browser_evaluate_js`. Click/hover/type target elements by CSS
selector (auto scroll-into-view, prefers `data-fig-id`/`data-testid`) or viewport x/y.
Input is dispatched with CDP `Input.*` events — real trusted events that work with
React/Vue controlled inputs.

**Navigation & tabs** — `browser_navigate` (http/https/about:blank only, waits for
load, re-applies viewport emulation), `browser_back`, `browser_forward`,
`browser_list_tabs`, `browser_create_tab`, `browser_close_tab` (requires explicit
`tab_id` — no implicit fallback). Agent-created tabs are collected into a purple
"Videntia" Chrome tab group (opt out with `grouped: false`); `browser_close_group`
closes the whole group for end-of-session cleanup.

**Observability** — `browser_read_console` and `browser_read_network` read per-tab
ring buffers (500 console entries / 300 requests) captured via `Runtime`/`Log`/
`Network` CDP domains. The first call on a tab starts monitoring; console buffers
reset on navigation, network buffers persist across navigations. JavaScript dialogs
are auto-handled (beforeunload accepted, alerts/confirms dismissed) and logged to the
console buffer.

`get_browser_page_screenshot` also accepts `full_page: true` for beyond-viewport
capture. The debugger session is shared: screenshots detach afterwards only when no
emulation or monitoring needs the attachment to persist.

## Token-Efficient Exports

`export_node_as_image` no longer has to return a wall of base64:

- `save_to_path` — absolute path; writes the file and returns only
  `{path,width,height,bytes,format}`. **Prefer this for every "does this look right"
  visual check** — it costs a few tokens instead of tens of thousands. Parent dir must
  exist; overwrites. Also works for video formats.
- `max_width` / `max_height` — server-side downscale (image formats only).
- `region` `{x,y,width,height}` — crop, in exported-image pixels (i.e. after `scale`),
  origin at the node's top-left. PNG/JPG only.
- `jpeg_quality` (1–100, `format: "JPG"` only) — cheap review screenshots. Unrelated to
  the video `quality` preset.
- **Inline returns are capped at 1200px on the longest edge**, unless
  `allow_full_resolution`, `max_width` or `max_height` is set. `save_to_path` always
  keeps full resolution — the cap only guards token-costly inline returns.

Post-processing lives in `src/videntia_figma_mcp/utils/export-image-post.ts`.

## Token-Efficient Reads

- `format: "compact"` on `get_node_info` / `get_nodes_info` / `scan_nodes_by_types`
  (`format` is an alias for `output_format`, which now accepts `jsx | json | compact`).
- `measure_node` — geometry ONLY (x, y, width, height, rotation, absoluteBoundingBox).
  Use instead of `get_node_info` whenever you just need coordinates or sizes.
  `include_children` + `depth`, `output_format: json | compact`.
- `get_node_summary` — one line per node: name, type, id, child count, key styles.
  Use to orient inside a frame before drilling in. `include_children` for direct children.
- `lint_frame`:
  - `summary_only: true` — per-category scores and severity counts, no violation rows.
  - every violation now carries a **stable `id`** (derived from nodeId + category +
    property + severity, so repeat runs diff cleanly) and it is the first table column.
- `scan_nodes_by_types` contract is now explicit:
  - `topLevelOnly: true` — direct children only, no recursion (default `false` = full subtree).
  - the response is prefixed with `returned of totalFound … truncated: <bool>`, and a
    **WARNING line when truncated** — a truncated scan is NOT a full sweep; raise `limit`.

Formatting helpers: `src/videntia_figma_mcp/utils/compact-node.ts`.

## Composite Commands

`src/videntia_figma_mcp/tools/composite-tools.ts` (plugin side:
`handlers/composites.ts`). **Prefer these over multi-call sequences** — each is one
round trip and applies operations in the order Figma actually requires.

| Tool | Replaces |
|------|----------|
| `create_autolayout_frame` | create_frame + set_layout_mode + set_padding + set_item_spacing + set_layout_sizing + set_fill_color + set_corner_radius |
| `create_styled_text` | load_font_async + create_text + apply_text_style + set_fill_color/bind_variable (font loading is internal — never call `load_font_async` first) |
| `set_gap` | set_item_spacing; also auto-relaxes `SPACE_BETWEEN` (which silently overrides itemSpacing). Never fake gaps with spacer rectangles |
| `create_card` | frame + fill + radius + effect style + padding, using the house `card` preset |
| `bulk_bind_variables` | repeated `bind_variable` — many `{nodeId, field, variable}` triples in one call; bindings are independent |
| `clone_and_place` | clone_node + rename_node + move_node + insert_child (switches to ABSOLUTE positioning when x/y are given inside auto-layout) |
| `apply_role_preset` | hand-picking tokens per node. Roles: `card`, `pill`, `sheet`, `tap-target` (44x44 min per WCAG 2.5.5) |

Token-name params (`fillVariable`, `radiusVariable`, `paddingVariable`,
`itemSpacingVariable`, `colorVariable`) bind a variable; raw `fill` / `cornerRadius` /
`padding` set literal values. Missing tokens fall back to literal house values and are
reported in `warnings`.

## Verification Tools

`src/videntia_figma_mcp/tools/verification-tools.ts` (plugin: `handlers/verification.ts`,
math: `utils/verification-math.ts`). Use these instead of eyeballing dumps.

- `contrast_check_frame` — sweeps EVERY text node in a frame for WCAG contrast against
  its *resolved* backdrop (walks ancestors, composites translucent paints, interpolates
  gradients at the text node's position). `failures_only`, `standard: AA | AAA`,
  `include_hidden`.
- `find_overlaps` — sibling bounding boxes that intersect. `tolerance`,
  `min_overlap_ratio`, `ignore_hidden`, `limit`.
- `assert_node_state` — reads a node back and diffs `expected` against actual, tolerating
  float rounding and accepting colours as hex or RGBA. Use after any mutation you need to
  be certain about.
- `find_unbound` — every fill/stroke/radius/spacing/typography/effect still on a raw
  value, grouped by role. Honours the same suppression rules as `lint_frame`.
  `ignore_rules`, `limit_per_role`.
- `check_token_collisions` — the same token name defined in more than one collection with
  DIFFERENT values (e.g. `theme/radius/3xl` = 28 vs `Radius/radius/3xl` = 24). Run before
  trusting any binding audit. `include_identical`, `name_filter`.

## Lint Ergonomics

Suppression logic: `src/videntia_figma_plugin/handlers/lint/suppress.ts`.

- `lint_frame` / `find_unbound` accept `ignore_rules` — category names
  (`"backgroundFills"`), check names (`"colors"`), `"category:property"` pairs
  (`"backgroundFills:fills[0]"`), or `"*"`.
- Per-node annotations, **inherited by descendants**, via plugin data or a name suffix:
  - `lint.ignore` / `lintIgnore` plugin data, or `[lint-ignore: backgroundFills, radius]`
    / `Lint/ignore: backgroundFills` in the layer name.
  - `lint.role` / `lintRole`, or `[role: artwork]` — `artwork` (also `art`,
    `illustration`, `logo`) exempts bespoke artwork from every token-binding rule.
- Suppressed violations are removed from the verdict but **reported separately**
  (`summary.suppressed` / `suppressedViolations`, with `suppressedBy`), so a stale
  exception stays visible.
- **Gradients are exempt** from variable binding: `setBoundVariableForPaint` only accepts
  `SolidPaint` and `ColorStop.color` carries no `boundVariables` — the rule is
  unsatisfiable. Counted as compliant with a LOW nudge toward
  `create_color_style` + `set_color_style_id`.
- **Blur must use an effect style**: `setBoundVariableForEffect` does not cover blur
  radius, but `createEffectStyle` accepts `BlurEffect` — the fix is
  `create_effect_style` + `set_effect_style_id`.

## Strict Mode

`src/videntia_figma_plugin/utils/write-verify.ts`. Writes that Figma silently discards
("silent no-ops") can now fail loudly.

- `set_strict_mode { enabled }` — global toggle. Off by default: no-ops are reported as
  warnings on the result. On: the first detected no-op throws.
- Any command may override the global toggle with a per-call `strict` param.
- `set_padding` / `set_item_spacing` / `set_layout_sizing` require `layoutMode != NONE`
  on the target (or, for FILL sizing, on the parent). On a `layoutMode: NONE` frame Figma
  accepts the assignment, throws nothing, and never persists it — these now throw with
  the fix in the message instead. `create_frame` likewise errors when gap/padding/
  alignment/sizing params are passed without a `layoutMode`.

## New Primitives

- `set_page_background` — pages use `backgrounds`, not `fills`, so `set_fill_color` fails
  on a PAGE node. Accepts `color` hex or `r,g,b,a`; `pageId` defaults to the current page.
  Do not fake the canvas with a full-bleed rectangle.
- `set_clips_content` — toggle `clipsContent` on FRAME/COMPONENT/COMPONENT_SET/INSTANCE.
  Required for rounded containers to actually clip children. Not supported on SECTION.
- `set_opacity` — node `opacity` (0–1) and/or `blendMode`. Prefer over baking alpha into
  8-digit hex fills.
- `create_section` / `set_section_status` — Figma Sections (parented only to a PAGE or
  another SECTION); dev status `READY_FOR_DEV | COMPLETED | NONE`.
  Handlers: `src/videntia_figma_plugin/handlers/sections.ts`.
- `move_node_absolute` — move to ABSOLUTE canvas coordinates (the frame of reference of
  `absoluteBoundingBox` and the Figma inspector). `move_node`'s x/y are PARENT-relative,
  so use this whenever you have canvas coordinates or have just reparented a node.

## Safety Guards

- **Stale channel hard-fail** (`src/socket-channel-guard.ts`): a command sent to a channel
  with no plugin (or extension) peer is rejected immediately with a reopen-the-plugin
  message, instead of being broadcast into a dead channel where it times out or, mid-batch,
  half-applies.
- **Cross-file node-id guard**: node ids are unique only *within* a file, so `join_channel`
  captures the document identity (`get_file_key` → fileKey/rootId/fileName) and every
  subsequent command carries it as `__expectedFile`. The plugin refuses commands addressed
  to a file it is not attached to (`assertExpectedDocument` in
  `src/videntia_figma_plugin/utils/document-guard.ts`). An older plugin that cannot report
  identity falls back to unpinned commands rather than blocking the session.
- **`batch_actions` `checkpoint`** (default `true`): commits an undo checkpoint *before*
  the batch, so one undo in Figma reverts exactly that batch. Set `false` only to
  deliberately merge into the preceding undo group.

## Batch Param Normalisation

`src/videntia_figma_mcp/utils/normalize-batch-params.ts`. `batch_actions` forwards params
raw to the plugin, bypassing each standalone tool's zod schema — so calls that worked
standalone used to fail inside a batch. Params are now normalised per command before
dispatch, so **a batched action accepts the same param names and value formats as the
equivalent standalone tool**. Aliases are accepted (e.g. `mode` → `layoutMode`); the
canonical plugin-facing name wins when both are present. Normalisation is idempotent and
never throws — unknown commands pass through untouched. Node-id keys accept the URL
`12-34` form. `create_icon` / `update_icon` are also expanded server-side inside batches.

## Development Guidelines

### Adding New MCP Tools

> ⚠️ **The registration lists are not tied together — nothing fails at compile time.**
> Both of these bit us during this work:
> - A tool missing from `ALLOWED_COMMANDS` (`src/videntia_figma_plugin/ui/constants.ts`)
>   fails **silently at runtime** with `"Command not permitted"` — the build is green and
>   the TypeScript is correct.
> - A registrar that is imported into `src/videntia_figma_mcp/tools/index.ts` but never
>   **called** in `registerAllTools` is silently dead — the tools simply never appear.
>
> After adding a tool, verify all of: the `server.tool` registration, the registrar call
> in `tools/index.ts`, the plugin `case`, `FigmaCommand` in `types/index.ts`,
> `ALLOWED_COMMANDS`, and `READONLY_COMMANDS` (read-only tools only).


1. **Define tool in appropriate file** (`src/videntia_figma_mcp/tools/*.ts`)
```typescript
server.tool(
  "tool_name",
  "Description",
  {
    param: z.string().describe("Parameter description")
  },
  async ({ param }) => {
    const result = await sendCommandToFigma("tool_name", { param });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);
```

2. **Add Figma plugin handler** (`src/videntia_figma_plugin/code.js`)
```javascript
case "tool_name":
  return await toolNameHandler(params);
```

3. **Update type definitions** (`src/videntia_figma_mcp/types/index.ts`)
```typescript
export type FigmaCommand =
  | "existing_command"
  | "tool_name";  // Add new command
```

4. **Add to `ALLOWED_COMMANDS`** (`src/videntia_figma_plugin/ui/constants.ts`) — the UI allowlist that gates which commands can be sent to the plugin. Without this, the command is blocked with "Command not permitted".

5. **Add to `READONLY_COMMANDS`** (`src/videntia_figma_plugin/index.ts`) — if the tool is read-only (does not modify design data). Without this, the command is blocked when readonly mode is active.

6. **Write tests** (`tests/integration/`)
```typescript
describe("tool_name", () => {
  it("successfully performs operation", async () => {
    const response = await callTool("tool_name", { param: "value" });
    expect(response.content[0].text).toContain("expected");
  });
});
```

### Testing Strategy

- **Integration tests**: Mock `sendCommandToFigma`, test MCP tool interface
- **Unit tests**: Test utility functions, color calculations, schema validation
- **Coverage target**: Aim for >80% coverage

### Code Style

- Use TypeScript strict mode
- Prefer async/await over promises
- Use Zod for parameter validation
- Include JSDoc comments for public APIs
- Follow existing naming conventions:
  - MCP tools: `snake_case`
  - TypeScript: `camelCase`
  - Types/Interfaces: `PascalCase`

## WebSocket Communication

The MCP server communicates with the Figma plugin via WebSocket:

```
MCP Server (port 3000) ←→ WebSocket ←→ Figma Plugin
```

**Message Format:**
```typescript
{
  id: string;           // Request ID
  command: string;      // Command name
  params: any;          // Command parameters
}
```

**Response Format:**
```typescript
{
  id: string;           // Matches request ID
  result?: any;         // Success result
  error?: string;       // Error message
}
```

## Documentation

- **API Spec**: `docs/figma-theme-variables-mcp-tools.md` - Complete tool specifications
- **Theme Guide**: `docs/figma-theme-variables-guide.md` - Theme system documentation
- **Instructions**: `docs/figma-theme-variables-instructions.md` - Implementation guide

## Common Tasks

### Build and Test
```bash
# Full build and test cycle
bun run build && bun test

# Watch mode for development
bun run dev    # Terminal 1
bun test --watch  # Terminal 2
```

### Deploy
```bash
# Build for production
bun run build

# Package for distribution
bun run build:dxt

# Publish to npm
bun run pub:release
```

### After Merging to Main

After every merge to `main`, **switch to main, pull the latest, build, and reload the launchd socket**:

```bash
git checkout main && git pull && bun run build && launchctl kickstart -k gui/$(id -u)/com.videntia.figma-socket
```

`bun run build` does two things:
1. **Regenerates `src/videntia_figma_plugin/code.js`** from the TypeScript source modules — this is what Figma loads.
2. **Rebuilds the MCP server** (`dist/`) — this is what Claude connects to.

`launchctl kickstart -k` restarts the local launchd socket agent (`com.videntia.figma-socket`, plist at `~/Library/LaunchAgents/com.videntia.figma-socket.plist`) so it picks up the new `dist/socket.js`. The agent autostarts on login via `RunAtLoad` + `KeepAlive`.

> **Reload in Figma:** After deploying, re-run the plugin in Figma (close and reopen from Plugins menu) to load the new `code.js`.

### Debug
```bash
# Run MCP server with logging
DEBUG=* bun run start

# Run socket server
bun run socket
```

## Troubleshooting

### Build Errors
- Ensure Bun is installed: `bun --version`
- Clear dist folder: `rm -rf dist && bun run build`
- Check TypeScript version: Should be 5.8+

### Test Failures
- Clear Jest cache: `bun test --clearCache`
- Run specific test: `bun test path/to/test.ts`
- Check mocks are properly configured

### WebSocket Issues
- Verify Figma plugin is loaded
- Check port 3000 is available
- Review WebSocket logs in browser console

## Performance Considerations

- **Batch operations**: Use `*_batch` tools for multiple items
- **Color calculations**: Performed server-side (no Figma API calls)
- **Schema validation**: Cached for performance
- **WebSocket**: Connection pooling and request deduplication

## Version History

### v0.7.0 (Current)
- ✨ Added 24 variable management tools
- ✨ Implemented color scale generation
- ✨ Added WCAG contrast validation
- ✨ Added schema validation and auditing
- ✨ 106-variable standard theme support
- ✅ 242 passing tests
- 📚 Comprehensive documentation

## Resources

- [MCP SDK Documentation](https://github.com/modelcontextprotocol/sdk)
- [Figma Plugin API](https://www.figma.com/plugin-docs/)
- [Bun Documentation](https://bun.sh/docs)
- [WCAG Contrast Guidelines](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)

## Contributing

When contributing new features:
1. Follow the existing code structure
2. Add comprehensive tests
3. Update type definitions
4. Document in CLAUDE.md
5. Use Bun for all commands
6. Ensure all tests pass: `bun test`
7. Build successfully: `bun run build`
