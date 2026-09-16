# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`set_text_align` Tool (#29)**: Set `textAlignHorizontal` (LEFT/CENTER/RIGHT/JUSTIFIED) and/or `textAlignVertical` (TOP/CENTER/BOTTOM) on an **existing** text node. Previously alignment could only be set at creation time via `create_text_with_style`, so centring text required wrapping it in an auto-layout frame. Accepts the aliases `align` / `textAlignHorizontal` for horizontal and `textAlignVertical` for vertical, and is case-insensitive.
- **`get_capabilities` Tool (#45)**: one read-only, no-write call that replaces a session's worth of trial-and-error rediscovery. It reports (a) hard Figma platform limits that cannot be worked around — notably that `bind_variable`/`setBoundVariableForPaint` is SolidPaint-only and so can never bind an EXISTING gradient — gradient stops must be bound at author time via `set_gradient_fill`'s per-stop `colorVariable` (#30); (b) capabilities agents routinely assume are missing but which exist (`export_node_as_image` writes to disk by default, `set_image_fill_from_path` reads from disk, `set_auto_layout` sets gap AND padding in one call, `create_frame` takes nested `layout`/`size`, blur is lint-compliant via `create_effect_style`, the plural forms `bind_many` / `create_texts` / `create_svgs` / `insert_children` / `move_nodes` / `bulk_bind_variables`, `batch_actions` `return_state: true`); (c) preconditions that cause a write to be accepted and discarded (padding/itemSpacing/layoutSizing need `layoutMode != NONE`, HUG is invalid on a page-level frame, FILL needs an auto-layout parent track, `SPACE_BETWEEN` overrides itemSpacing); and (d) the LIVE session modes (strict — default ON — and the `return_state` default). The tool list and the session modes are derived at call time (from the MCP tool registry and the plugin's own state) so they cannot rot; only the prose lives in one maintained constant, `utils/capabilities-manifest.ts`. Pure server-side: registered with the MCP registrar only, no plugin command.
- **Progressive tool discovery (`find_figma_tools`, `describe_figma_tools`, `load_figma_tools`, `figma_call`)**: this server registers 237 tools, and every one of them was serialised as a JSON-Schema into `tools/list` at the start of every session — ~314KB / ~80k tokens of context spent before a single call, for a session that typically uses fewer than ten tools. The default mode is now `progressive`: a 10-tool ENTRY SURFACE (`figma_connect`, the four discovery tools, `get_capabilities`, `batch_actions`, `get_node_info`, `get_content_tree`, `export_node_as_image`) is advertised up front at ~16KB / ~4.1k tokens — a **94.8% reduction** — and everything else stays fully present in the internal tool registry. A tool missing from the tool list is NOT missing from the server: `find_figma_tools({query})` searches the whole catalogue by task and returns names plus one-liners (no schemas, ~200 tokens), `describe_figma_tools({names})` returns the real JSON-Schema for up to 12 named tools AND promotes them into `tools/list` with `notifications/tools/list_changed`, `load_figma_tools({names})` promotes without printing, and `figma_call({tool,params})` invokes any registered tool immediately — parsed with that tool's own schema and run through its own handler — for clients that ignore `list_changed`. `batch_actions` needs no promotion at all and already dispatches every deferred document tool by name with identical params, so batch/standalone wire parity is unaffected by the registration gate (asserted by tests). The registration gate lives in the registry wrapper, so no per-tool edits were needed and a tool added tomorrow is discoverable the moment it registers. Search ranking, categories and the recall synonym map have a SINGLE source of truth in `utils/tool-taxonomy.ts` (`matchTools`); `utils/tool-search.ts` only builds the index from the live registry and delegates — a staleness test fails the build if a synonym names a tool that does not exist or a new tool goes uncategorised. Opt out with `VIDENTIA_FIGMA_TOOLS=all` for exact pre-0.8 behaviour, or narrow to specific categories (`VIDENTIA_FIGMA_TOOLS=text,tokens`); an unrecognised value warns on stderr and falls back to `all` rather than taking the server down. Pure server-side: no `FigmaCommand`, `ALLOWED_COMMANDS` or plugin-switch entries.

### Fixed

- **`set_item_spacing` / `set_padding` silent no-op (#1, #2)**: both now throw with the one-call `set_auto_layout` fix when the target frame has `layoutMode: NONE`, instead of letting Figma accept and discard the write.
- **`set_layout_sizing` accepted-and-discarded (#3)**: FILL on a non-auto-layout parent, HUG on a `layoutMode: NONE` node, and HUG on a page-level frame now throw with the specific reason; TEXT nodes also get `textAutoResize` derived so HUG actually applies.
- **`set_stroke_color` resetting stroke weight (#4)**: omitting `weight` no longer sends a synthetic `1` — the node's existing `strokeWeight` is preserved, and the reported weight comes from the plugin, not a local assumption.
- **`set_font_weight` resetting the font family (#5)**: the node's current family is read (including `figma.mixed` via `getRangeFontName`) and reused; only the style changes.
- **`create_text` losing weight and size (#6)**: the face is resolved and loaded _before_ the node is created, so a missing 600/700 face throws instead of silently producing Regular text and dropping the requested `fontSize`.
- **`update_icon` dropping the stroke colour variable (#7)**: the existing `strokes[0].color` variable binding is discovered and re-bound after the SVG swap when no `colorVariable` is passed.
- **`set_auto_layout` collapsing existing children (#8)**: child `layoutSizing*` and dimensions are snapshotted before the `layoutMode` write and restored afterwards (opt out with `preserveChildSizing: false`); same-value `layoutMode` writes are skipped.
- **Setting a child to FILL silently collapsed its parent (#9)**: `set_layout_sizing` and `set_auto_layout` now snapshot the auto-layout parent's width/height and sizing modes before the write; an unrequested drift is resized back when the parent is FIXED on that axis, and when the parent hugs (sizing mode AUTO) it throws in strict mode (warns as a `parent.width`/`parent.height` no-op otherwise) naming the parent, the before/after size and the fix — instead of silently shipping a 343 → 339px bar.
- **`create_frame` ignoring `layoutMode` (#10)**: auto-layout arguments (`layoutMode`, gap/itemSpacing, padding, axis alignment, wrap, sizing) are now applied at creation, and passing them without a `layoutMode` throws instead of being discarded.
- **`create_rectangle` ignoring `fillColor` (#11)**: the fill is applied (hex or RGBA, via the shared colour resolver).
- **`scan_nodes_by_types` `topLevelOnly` (#12)**: honoured in the plugin (direct children only, no recursion), and results are cursor-paginated rather than hard-truncated at 50.
- **`get_node_info` paint data was unverifiable (#13)**: the node serializer dropped every hidden paint and returned `undefined` when a node's paints were `figma.mixed` or its fill list was empty, so a node could come back with NO `fills` key at all — including from a `fields: ["fills"]` projection — and the only way to confirm a fill was to export an image (the most expensive operation in the server). Fills are now always emitted when the node supports them: hidden paints are kept and flagged `visible: false`, mixed paints come back as a `[{type:"MIXED"}]` marker, an explicitly empty fill list comes back as `[]`, and IMAGE paints carry `scaleMode` and `imageHash` (alongside the legacy `imageRef`) instead of only a bare `isImage` flag. `strokes` and `effects` had the same hidden-paint loss and gained the same treatment plus `blendMode`; `strokeWeight` no longer requires a non-empty stroke list to be reported. The JSX renderer skips hidden paints and effects so its output is unchanged, and the compact projection stays terse — `fill=#ffffff`, `fill=IMAGE(FILL)`, `fill=#ff0000+1`, `fill=none`, `fill=hidden`, `fill=MIXED` — never a paint-object dump.
- **Standalone vs batch parameter contract (#14)**: a shared `normalize-batch-params` layer applies the same aliasing/coercion to batched actions that each standalone tool's zod schema applies, so identical params work in both paths.
- **"Node with ID undefined not found" (#15)**: node-id keys are normalized (URL `12-34` form included) and absent ids are dropped so the error names the missing parameter instead.
- **Unknown command in batch for `create_icon` / `set_opacity` / pure-computation tools (#16)**: `create_icon`/`update_icon` are resolved server-side and expanded into Figma-native actions inside `batch_actions`; `set_opacity` is allowlisted and dispatched by the plugin. The remaining class was structural: the pure server-side maths tools (`calculate_composite_color`, `calculate_color_scale`, `calculate_contrast_ratio`, `calculate_contrast_ratios`, `convert_color_format`) have no plugin command at all and are absent from `ALLOWED_COMMANDS`, so batching one could only ever fail. `batch_actions` now EVALUATES them server-side before dispatch and splices their results back into the per-action list at the caller's own index, so `$result[N]` chaining works end to end — compute a composite colour, then apply it with `set_fill_color` using `color: "$result[0].hex"`, in one batch. Results expose `hex`, `color` and `rgb255` (and `scale.<level>.hex` for scales) and `$result` field paths now accept numeric keys. Every OTHER server-side-only tool (`browser_*`, `figma_connect`, `join_channel`, `get_open_channels`, `get_schema_definition`, `get_capabilities`, the icon-catalogue lookups, `diff_*`/`compare_*`, `create_complete_design_system`) is rejected by name with the actual reason and the batchable alternatives, instead of the generic "Unknown command".
- **Tools that worked in exactly one mode (#17)**: `remove_fill` / `remove_stroke` (allowlisted for standalone dispatch) and `set_gradient_fill` (normalised for batch, including hex stops, the `type` alias, the bare-colour `stops` shorthand and the `aspect_correct` default) now behave identically standalone and inside `batch_actions`. A systematic parity suite asserts the two paths put equivalent params on the wire for `remove_fill`, `remove_stroke`, `set_gradient_fill`, `set_image_fill`, `apply_text_style`, `bind_variable`, `set_effect_style_id` and `update_icon`.
- **Partially-committed batches are recoverable without a re-read (#18)**: a failed batch now returns a machine-readable per-action manifest (`index`, `action`, `success`, `committed`, `nodeId`, `error`) alongside the human summary. Figma's plugin API exposes no transaction and undo is a user-level stack a plugin cannot replay selectively, so true rollback is not possible — the report now says so explicitly and points at the pre-batch undo checkpoint (one undo reverts exactly this batch) instead of implying the document was restored.
- **"Cannot unwrap symbol" on long batches (#19)**: batches are auto-chunked at 40 actions, with `$result[N]` references rewritten across chunk boundaries.
- **Batch `actions[]` schema is discoverable (#20)**: `get_schema_definition` accepts `target: "batch_actions"` and returns the envelope, aliases, `$result[N]` rules and a worked example.
- **`export_node_as_image` returns a path by default (#21)**: `save_to_path` is declared in the schema; with no `inline: true` the render is written to a file (explicit path or a session temp path) and only `{path,width,height,bytes,format}` is returned.
- **`set_effects` / `create_effect_style` GLASS ranges (#22)**: `refraction` and `dispersion` were documented as `0–50` / `0–20` but Figma rejects anything outside `0–1` (`GlassEffect` in `@figma/plugin-typings`: "Must be between 0 and 1"). Descriptions now state the real 0–1 normalised range, the zod schemas enforce `.min(0).max(1)` for `refraction`, `dispersion` and `lightIntensity`, and the plugin handler rejects out-of-range values with a message naming the correct range instead of letting Figma throw an opaque error.
- **`set_gradient_fill` aspect correction (#23)**: LINEAR `gradientTransform` is now computed in pixel space, so `angle: 0` means top-to-bottom, `angle: 90` left-to-right, and the full `0..1` stop range spans the node's actual extent on any aspect ratio. Previously a tall node compressed the ramp into a sub-window (e.g. ~`[0.66, 1.0]`), forcing callers to hand-remap stop positions. Pass `aspect_correct: false` to keep the legacy un-corrected behaviour so existing callers with pre-distorted stops are not silently broken.
- **`set_image_fill` rejected a local file path (#24)**: `image_path` (aliases `path`, `load_from_path`) is now declared on `set_image_fill` itself — the server reads and base64-encodes the file, so the bytes never enter the conversation. Previously the only route was the separate `set_image_fill_from_path` tool, and an agent that reached for `set_image_fill` hit "Provide either imageUrl or imageBytes" and fell back to inlining a ~50,000-char base64 string (measured: 0 of 6 agents ever completed that call; one reported success without making it). The no-source error now names every accepted source, a path combined with another source is rejected rather than silently resolved, and batched `set_image_fill` actions read the file server-side too.
- **`clipsContent` (#25), node opacity (#26), page background (#27) and Sections (#28)** are reachable: `set_clips_content`, `set_opacity`, `set_page_background`, `create_section` and section dev-status.
- **Gradient stops could not use design tokens (#30)**: every gradient was a permanent, unsatisfiable raw-value lint violation, because `figma.variables.setBoundVariableForPaint` is typed `(paint: SolidPaint, …): SolidPaint` (@figma/plugin-typings 1.136.0, `plugin-api.d.ts:2186`) with no `GradientPaint` overload. Re-verified against the typings: the DATA MODEL does support it — `ColorStop.boundVariables` exists (`plugin-api.d.ts:4506`) with `VariableBindableColorStopField = 'color'` (`:6742`) — the helper is the limit, not the format. `set_gradient_fill` now takes a per-stop `colorVariable` (COLOR variable name or id, dash-spellings normalised) and writes the `VARIABLE_ALIAS` into the stop directly; the stop's literal colour defaults to the variable's own value so a token-only stop can never produce a NaN paint, and an unresolvable name is a hard error naming the token rather than a silent raw-colour fallback. `lint_frame` now counts a fully bound gradient as compliant and keeps only a LOW nudge for unbound ones (pointing at `set_gradient_fill` + `colorVariable` or `create_color_style`), and `get_capabilities` records the exact scope of the limit.
- **Blur effects in effect styles (#31)**: `LAYER_BLUR` / `BACKGROUND_BLUR` (plus NOISE/TEXTURE/GLASS) are accepted by both `set_effects` and `create_effect_style`.
- **`set_corner_radius` `corners` array (#32)**: declared as exactly 4 booleans `[TL, TR, BR, BL]` and forwarded to the plugin.
- **`resize_node` stroke scaling (#33)**: New `scale_strokes: true` option multiplies `strokeWeight` on the resized node and every descendant by the resize scale factor. Figma's `resize()` deliberately preserves absolute stroke weights, so downscaled SVG/vector icons rendered too heavy and upscaled ones too thin; icons no longer need to be re-emitted as fresh SVG at every size. Non-uniform resizes use the average of the X and Y factors (stroke weight is a single scalar in Figma). Default behaviour is unchanged.
- **Colour coercion (#34, #35)**: a single `toRgba` accepts hex (3/4/6/8-digit), 0-1 and 0-255 channels and array forms across fill/stroke tools, validated server-side before the wire.
- **`set_font_name` "SemiBold" vs "Semi Bold" (#36)**: every compound spelling is tried against the family's real style list, with an error naming the available styles if none match.
- **`load_font_async` diagnostics (#37)**: the handler reported `Error loading font: undefined` when Figma rejected with a bare object. It now resolves alternate face spellings ("SemiBold" vs "Semi Bold") and, on failure, names the family, the requested style, the spellings tried and the styles that are actually available.
- **Export cache and scale (#38, #39)**: identical re-exports of an unchanged node are served from a session cache (`force_refresh: true` bypasses), and `scale` is forwarded to Figma and reflected in the default output path.
- **Pagination on large reads (#40)**: `scan_nodes_by_types`, `get_nodes_info` and `search_nodes` take `limit`/`cursor` and return a continuation cursor. `bulk_export_frames` was missed in that pass and was the worst offender of the group — it returned inline base64 for EVERY frame, multiplying the single most expensive operation in the server by N, and had no way to bound the work (measured: oversized responses spilled to disk, and whole-board exports hit "Request to Figma timed out"). It now resolves the frame list FIRST (so `limit`/`cursor` bound the render work, not just the response), WRITES EACH FRAME TO DISK by default — returning `{nodeId,name,path,width,height,bytes}` and no pixels — with `out_dir` for the location and `inline: true` as the explicit opt-in, and reuses `export_node_as_image`'s post-processing (max-dimension clamp, `max_width`/`max_height`, `jpeg_quality`, fractional-`scale` guarantee) and its subtree-hash-keyed session render cache, so re-exporting a mostly-unchanged board re-renders nothing.
- **Read projection defaults (#41)**: node reads default to a shallow depth with a JSX projection and support `fields`, plus a lean `get_node_geometry` for coordinates only.
- **Stale channels half-applying commands (#42)**: a connection evicted from its Figma channel (e.g. by a browser command) transparently rejoins before dispatch.
- **Node IDs are not unique across files (#43)**: the document identity is captured at `join_channel` and stamped on every command as `__expectedFile`; the plugin refuses commands addressed to a different document.
- **`validate_color_contrast` found 0 pairs on every real collection (#44)**: it only ever paired a variable literally named `<x>-foreground` with a sibling `<x>`, so collections using `text/primary` + `surface/primary`, `on-surface`, or `foreground/default` produced "0/0 pairs" — which read as a PASS — and agents fell back to computing WCAG ratios by hand. It now pairs by three strategies (sibling suffix `-foreground`/`-fg`/`-text`/`-content` and `on-x`; role groups matching foreground-ish segments against background-ish ones; a capped cross-product last resort), resolves `VARIABLE_ALIAS` values (previously an aliased token produced a NaN ratio), and validates the requested mode name instead of silently falling back to the first mode. Critically, a 0-pair sweep is now an explicit, actionable failure: the report says which collection and mode were searched, how many COLOR variables were seen and how many resolved, how many foreground/background candidates were found, which strategies were tried, a sample of the variable names, and why nothing paired — and points at `contrast_check_frame` for contrast measured on rendered nodes against resolved backdrops.

## [0.6.1] - 2025-08-02

### Fixed

- **`set_stroke_color` Tool**: Corrected a validation rule that incorrectly rejected a `strokeWeight` of `0`. This change allows for the creation of invisible strokes, aligning the tool's behavior with Figma's capabilities.

## [0.6.0] - 2025-07-15

### Added

- **🚀 DXT Package Support**: Complete implementation of Anthropic's Desktop Extensions format for Claude Desktop
- **📦 Automated CI/CD Pipeline**: GitHub Actions workflow for automatic DXT package generation and release distribution
- **🔧 DXT Build Scripts**: New npm scripts for DXT packaging (`pack`, `build:dxt`, `sync-version`)
- **📋 .dxtignore Configuration**: Optimized package exclusions for minimal DXT file size (11.6MB compressed)
- **🎯 Dual Distribution Strategy**: NPM registry for developers + DXT packages for end users

### Changed

- **⚡ Installation Experience**: Reduced setup time from 15-30 minutes to 2-5 minutes via one-click DXT installation
- **📖 Documentation**: Enhanced README with comprehensive DXT installation instructions and troubleshooting
- **🏗️ Build Process**: Improved version synchronization between package.json and manifest.json
- **🔄 Release Workflow**: Automated DXT package attachment to GitHub releases

### Technical Details

- Added `@anthropic-ai/dxt@^0.2.0` development dependency for DXT packaging
- Implemented robust error handling and validation in CI/CD pipeline
- Enhanced build artifacts with 90-day retention for testing and rollback capabilities
- Established quality gates ensuring DXT packages only build after successful test suites

## [0.5.3] - 2025-06-20

### Added

- Added Windows-specific build command (`build:win`: `tsup`) for improved cross-platform compatibility
- Enhanced build process to support development on Windows systems without chmod dependency

### Fixed

- Resolved Windows build compatibility issues where `chmod` command would fail on Windows systems
- Improved developer experience for Windows users by providing dedicated build script

### Changed

- Separated Unix/Linux build process (with executable permissions) from Windows build process
- Updated installation documentation to reflect platform-specific build commands

## [0.5.2] - 2025-06-19

### Fixed

- Fixed critical opacity handling bug in `set_stroke_color` where `a: 0` (transparent) was incorrectly converted to `a: 1` (opaque)
- Fixed stroke weight handling where `strokeWeight: 0` (no border) was incorrectly converted to `strokeWeight: 1`
- Resolved problematic `||` operator usage that affected falsy values in color and stroke operations

### Added

- Extended `applyDefault()` utility function to handle stroke weight defaults safely
- Added `FIGMA_DEFAULTS.stroke.weight` constant for centralized stroke configuration
- Comprehensive test suite for `set_stroke_color` covering edge cases and integration scenarios
- Enhanced validation for RGB components in stroke operations

### Changed

- Improved architectural consistency by applying the same safe defaults pattern from `set_fill_color` to `set_stroke_color`
- Enhanced separation of concerns between MCP layer (business logic) and Figma plugin (pure translator)
- Renamed `weight` parameter to `strokeWeight` for better clarity and consistency
- Updated Figma plugin to expect complete data from MCP layer instead of handling defaults internally

### Technical Details

- Replaced `strokeWeight: strokeWeight || 1` with `applyDefault(strokeWeight, FIGMA_DEFAULTS.stroke.weight)`
- Enhanced type safety with proper `Color` and `ColorWithDefaults` interface usage
- Improved error messages and validation for better debugging experience

## [0.5.1] - 2025-06-15

### Fixed

- Fixed opacity handling in `set_fill_color` to properly respect alpha values
- Added `applyColorDefaults` function to ensure appropriate default values for colors

### Added

- Added automated tests for color functions and node manipulation

### Changed

- Improved TypeScript typing for colors and related properties
- General code cleanup and better utility organization

## [0.5.0] - 2025-05-28

### Changed

- Implemented modular tool structure for better maintainability
- Enhanced handling of complex operations with timeouts and chunking
- Improved error handling and recovery for all tools
- Improved TypeScript typing and standardized error handling

### Fixed

- Fixed channel connection issues with improved state management
- Resolved timeout problems in `flatten_node`, `create_component_instance`, and `set_effect_style_id`
- Enhanced remote component access with better error handling

### Added

- Comprehensive documentation of tool categories and capabilities

## [0.4.0] - 2025-04-15

### Added

- New tools for creating advanced shapes:
  - `create_ellipse`: Creation of ellipses and circles
  - `create_polygon`: Creation of polygons with customizable sides
  - `create_star`: Creation of stars with customizable points and inner radius
  - `create_vector`: Creation of complex vector shapes
  - `create_line`: Creation of straight lines
- Advanced text and font manipulation capabilities
- New commands for controlling typography: font styles, spacing, text case, and more
- Support for accessing team library components
- Improved error handling and timeout management
- Enhanced text scanning capabilities

### Changed

- Improvements in documentation and usage examples

## [0.3.0] - 2025-03-10

### Added

- Added `set_auto_layout` command to configure auto layout properties for frames and groups
- Support for settings for layout direction, padding, item spacing, alignment and more

## [0.2.0] - 2025-02-01

### Added

- Initial public release with Claude Desktop support
