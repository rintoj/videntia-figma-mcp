# Tool Reference

Complete reference for all 184 MCP tools provided by Videntia Figma MCP.

---

## Table of Contents

- [Document & Selection](#document--selection)
- [Pages](#pages)
- [Annotations](#annotations)
- [Creation](#creation)
- [Modification](#modification)
- [Auto Layout](#auto-layout)
- [Styles](#styles)
- [Text](#text)
- [Components & Instances](#components--instances)
- [Prototyping](#prototyping)
- [Variables — Collections](#variables--collections)
- [Variables — CRUD](#variables--crud)
- [Variables — Modes](#variables--modes)
- [Variables — Color Calculations](#variables--color-calculations)
- [Variables — Schema & Audit](#variables--schema--audit)
- [Variables — Templates & Presets](#variables--templates--presets)
- [Variables — Token Systems](#variables--token-systems)
- [Variables — Bulk Operations](#variables--bulk-operations)
- [Icons](#icons)
- [Documentation](#documentation)
- [Comparison](#comparison)
- [Browser Inspection & Overlay](#browser-inspection--overlay)
- [Browser Control](#browser-control)
- [Batch](#batch)
- [Channels](#channels)
- [History](#history)

---

## Document & Selection

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_document_info` | Get information about the current Figma document (name, pages, selection) | — |
| `get_selection` | Get info on the currently selected node(s) | `fields`, `depth`, `output_format` |
| `get_node_info` | Get detailed info for a single node by ID | `nodeId`, `fields`, `depth`, `output_format` |
| `get_nodes_info` | Get detailed info for multiple nodes by ID | `nodeIds`, `fields`, `depth`, `output_format` |
| `search_nodes` | Search document or subtree for nodes by name or ID | `query`, `types`, `nodeId`, `limit`, `depth`, `fields`, `output_format` |
| `scan_nodes_by_types` | Find descendant nodes matching one or more types | `nodeId`, `types`, `limit`, `fields`, `depth`, `output_format` |
| `set_focus` | Scroll viewport to focus on a node | `nodeId` |
| `set_selections` | Set the current selection to multiple nodes | `nodeIds` |
| `get_styles` | Get all styles (text, color, effect) in the document | — |
| `get_design_system` | Aggregate all design system tokens (colors, text, effects, variables) | — |
| `export_node_as_image` | Export a node as a base64-encoded image | `nodeId`, `format` (`png`/`jpg`/`svg`/`pdf`), `scale` |
| `export_image_fill` | Export raw image data from an image fill on a node | `nodeId`, `exportPath`, `fillIndex` |
| `get_variables` | Get all variables and collections in the document | — |
| `get_bound_variables` | Get variable bindings for a specific node | `nodeId` |
| `scan_bound_variables` | Scan a node and all its children for variable bindings | `nodeId` |

**`output_format` values:** `"default"` (JSON tree) · `"jsx"` (JSX + Tailwind — see [jsx-syntax-reference.md](jsx-syntax-reference.md))

---

## Pages

| Tool | Description | Parameters |
|------|-------------|------------|
| `create_page` | Create a new page | `name` |
| `rename_page` | Rename an existing page | `pageId`, `name` |
| `delete_page` | Delete a page from the document | `pageId` |

---

## Annotations

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_annotations` | Get annotations on a node or the whole document | `nodeId`, `includeCategories` |
| `set_annotation` | Create or update an annotation on a node | `nodeId`, `annotationId`, `labelMarkdown`, `categoryId`, `properties` |
| `set_multiple_annotations` | Set multiple annotations on a node in parallel | `nodeId`, `annotations` |
| `get_annotation_categories` | Get all annotation categories | — |
| `create_annotation_category` | Create a new annotation category | `label`, `color` |
| `update_annotation_category` | Update a category's label or color | `categoryId`, `label`, `color` |
| `delete_annotation_category` | Delete a custom annotation category | `categoryId` |
| `get_comments` | Get all comments in the file — text, author, replies, canvas position (unresolved by default) | `includeResolved` |

---

## Creation

| Tool | Description | Parameters |
|------|-------------|------------|
| `create_frame` | Create a new frame | `x`, `y`, `width`, `height`, `name`, `parentId`, `fillColor`, `strokeColor`, `strokeWeight`, `clipsContent`, `layoutPositioning` |
| `create_rectangle` | Create a new rectangle | `x`, `y`, `width`, `height`, `name`, `parentId`, `layoutPositioning` |
| `create_text` | Create a new text element | `x`, `y`, `text`, `fontSize`, `fontFamily`, `fontWeight`, `fontColor`, `name`, `parentId` |
| `create_svg` | Create a node from an SVG string | `svgString`, `x`, `y`, `name`, `parentId`, `flatten` |
| `group_nodes` | Group nodes together | `nodeIds`, `name` |
| `ungroup_nodes` | Ungroup a group node | `nodeId` |
| `clone_node` | Clone an existing node | `nodeId`, `x`, `y`, `parentId`, `index` |
| `insert_child` | Insert a child node inside a parent at a given index | `parentId`, `childId`, `index` |
| `flatten_node` | Flatten a node (boolean operations / path conversion) | `nodeId` |

---

## Modification

| Tool | Description | Parameters |
|------|-------------|------------|
| `rename_node` | Rename a node | `nodeId`, `name` |
| `move_node` | Move a node to a new position (optionally reparent) | `nodeId`, `x`, `y`, `parentId`, `index` |
| `resize_node` | Resize a node | `nodeId`, `width`, `height` |
| `delete_node` | Delete a node | `nodeId` |
| `delete_multiple_nodes` | Delete multiple nodes at once | `nodeIds` |
| `set_fill_color` | Set the fill color of a node | `nodeId`, `color` (hex) or `r`, `g`, `b`, `a` (0–1) |
| `set_stroke_color` | Set the stroke color and weight | `nodeId`, `color` or `r`, `g`, `b`, `a`, `weight` |
| `remove_fill` | Remove all fills from a node | `nodeId` |
| `remove_stroke` | Remove all strokes from a node | `nodeId` |
| `set_corner_radius` | Set corner radius (uniform or per-corner) | `nodeId`, `radius`, `corners` |
| `set_effects` | Set visual effects (shadows, blurs) | `nodeId`, `effects` |
| `set_image_fill` | Set an image fill from a URL | `nodeId`, `imageUrl`, `scaleMode`, `rotation`, `exposure`, `contrast`, `saturation`, `temperature`, `tint`, `highlights`, `shadows` |
| `set_gradient_fill` | Set a gradient fill | `nodeId`, `type`, `stops`, `angle`, `opacity` |
| `bind_variable` | Bind a variable to a node property | `nodeId`, `variableId`, `field` |
| `unbind_variable` | Remove a variable binding from a node property | `nodeId`, `field` |

**Color input:** `"#rrggbb"` · `"#rrggbbaa"` · `"#rgb"` · `{ r, g, b, a }` (0–1 each)

**Allowed image domains (default):** `images.unsplash.com`, `picsum.photos`. Add others in `src/videntia_figma_plugin/manifest.json → networkAccess.allowedDomains`.

---

## Auto Layout

| Tool | Description | Parameters |
|------|-------------|------------|
| `set_auto_layout` | Configure auto layout comprehensively | `nodeId`, `mode` (`HORIZONTAL`/`VERTICAL`/`NONE`), `top`, `bottom`, `left`, `right`, `gap`, `primaryAxisAlignItems`, `counterAxisAlignItems`, `wrap`, `strokesIncludedInLayout`, `clipsContent`, `horizontal`, `vertical` |
| `set_layout_mode` | Set layout direction and wrap | `nodeId`, `mode`, `wrap` |
| `set_padding` | Set padding for an auto-layout frame | `nodeId`, `top`, `right`, `bottom`, `left` |
| `set_axis_align` | Set primary and counter axis alignment | `nodeId`, `primaryAxisAlignItems`, `counterAxisAlignItems` |
| `set_layout_sizing` | Set horizontal/vertical sizing mode | `nodeId`, `horizontal`, `vertical` |
| `set_item_spacing` | Set gap between children | `nodeId`, `gap`, `counterAxisSpacing` |

---

## Styles

### Effect Styles

| Tool | Description | Parameters |
|------|-------------|------------|
| `create_effect_style` | Create a new effect style | `name`, `effects`, `description` |
| `update_effect_style` | Update an effect style | `styleId`, `name`, `effects`, `description` |
| `delete_effect_style` | Delete an effect style | `styleId` |
| `set_effect_style_id` | Apply an effect style to a node | `nodeId`, `effectStyleId`, `styleName` |

### Color (Paint) Styles

| Tool | Description | Parameters |
|------|-------------|------------|
| `create_color_style` | Create a new paint style | `name`, `color`, `gradient`, `description` |
| `get_color_styles` | List all paint styles | — |
| `get_color_style` | Get a paint style by ID or name | `styleId` |
| `update_color_style` | Update a paint style | `styleId`, `name`, `color`, `gradient`, `description` |
| `delete_color_style` | Delete a paint style | `styleId` |
| `set_color_style_id` | Apply a paint style to a node's fill | `nodeId`, `styleId`, `styleName` |

---

## Text

| Tool | Description | Parameters |
|------|-------------|------------|
| `set_text_content` | Set text content of a text node | `nodeId`, `text` |
| `set_multiple_text_contents` | Set text content on multiple nodes in parallel | `nodeId`, `text[]` |
| `set_font_name` | Set font family and style | `nodeId`, `family`, `style` |
| `set_font_size` | Set font size | `nodeId`, `size` |
| `set_font_weight` | Set font weight | `nodeId`, `weight` |
| `set_letter_spacing` | Set letter spacing | `nodeId`, `spacing`, `unit` |
| `set_line_height` | Set line height | `nodeId`, `height`, `unit` |
| `set_paragraph_spacing` | Set paragraph spacing | `nodeId`, `spacing` |
| `set_text_case` | Set text case transform (`UPPER`, `LOWER`, `TITLE`, `ORIGINAL`) | `nodeId`, `textCase` |
| `set_text_decoration` | Set text decoration (`NONE`, `UNDERLINE`, `STRIKETHROUGH`) | `nodeId`, `decoration` |
| `get_styled_text_segments` | Get text segments with a specific styling property | `nodeId`, `property` |
| `load_font_async` | Load a font asynchronously (required before setting fonts) | `family`, `style` |
| `create_text_style` | Create a text style from an existing text node | `nodeId`, `name`, `description` |
| `create_text_style_from_properties` | Create a text style from explicit properties | `name`, `fontSize`, `fontFamily`, `fontStyle`, `fontWeight`, `lineHeight`, `letterSpacing`, `textCase`, `textDecoration`, `description` |
| `apply_text_style` | Apply a text style to a text node | `nodeId`, `styleId`, `styleName` |
| `get_text_styles` | Get all local text styles | — |
| `update_text_style` | Update a text style's properties | `styleId`, `name`, `description`, `fontSize`, `fontFamily`, `fontStyle`, `fontWeight`, `lineHeight`, `letterSpacing`, `textCase`, `textDecoration`, `paragraphSpacing`, `paragraphIndent` |
| `delete_text_style` | Delete a text style | `styleId` |

---

## Components & Instances

| Tool | Description | Parameters |
|------|-------------|------------|
| `create_component` | Convert a frame or group into a component | `nodeId` |
| `create_component_set` | Combine components into a component set (variants) | `nodeIds`, `name` |
| `create_component_instance` | Create an instance of a component | `componentKey`, `x`, `y`, `parentId`, `index`, `replaceNodeId`, `contentOverrides`, `instanceProperties`, `fields`, `depth`, `output_format` |
| `detach_instance` | Detach an instance from its main component | `nodeId` |
| `swap_instance` | Swap an instance to a different component | `nodeId`, `componentKeyOrId`, `contentOverrides`, `instanceProperties`, `fields`, `depth`, `output_format` |
| `get_local_components` | Get all local components | `depth`, `output_format` |
| `get_component_properties` | Get component property definitions | `nodeId` |
| `add_component_property` | Add a property to a component | `nodeId`, `propertyName`, `type`, `defaultValue` |
| `edit_component_property` | Edit a component property | `nodeId`, `propertyName`, `newName`, `newDefaultValue`, `preferredValues` |
| `delete_component_property` | Delete a component property | `nodeId`, `propertyName` |
| `set_component_property_references` | Link a property to a child node | `nodeId`, `references` |
| `set_component_property` | Set a property value on an instance | `nodeId`, `propertyName`, `value` |
| `get_instance_overrides` | Get override properties from an instance | `nodeId` |
| `set_instance_overrides` | Apply overrides from one instance to others | `sourceInstanceId`, `targetNodeIds` |

---

## Prototyping

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_reactions` | Get prototyping reactions from nodes | `nodeIds` |
| `add_prototype_link` | Add a prototype navigation link | `nodeId`, `destinationId`, `trigger`, `navigation`, `transitionType`, `transitionDuration`, `transitionEasing`, `preserveScrollPosition`, `triggerTimeout` |
| `remove_prototype_link` | Remove prototype link(s) from a node | `nodeId`, `destinationId` |
| `create_connections` | Create connections between multiple nodes | `connections[]` |
| `set_default_connector` | Set a copied connector as the default | `connectorId` |

---

## Variables — Collections

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_variable_collections` | List all variable collections | — |
| `create_variable_collection` | Create a new variable collection | `name`, `default_mode` |
| `get_collection_info` | Get collection metadata and variables | `id` |
| `rename_variable_collection` | Rename a collection | `id`, `name` |
| `delete_variable_collection` | Delete a collection and all its variables | `id` |

---

## Variables — CRUD

| Tool | Description | Parameters |
|------|-------------|------------|
| `create_variable` | Create a single variable | `collection_id`, `name`, `type`, `value`, `mode` |
| `create_variables_batch` | Create multiple variables at once | `collection_id`, `variables[]`, `mode` |
| `update_variable_value` | Update a variable's value | `id`, `collection_id`, `value`, `mode` |
| `rename_variable` | Rename a variable | `id`, `collection_id`, `name` |
| `delete_variable` | Delete a variable | `id`, `collection_id` |
| `delete_variables_batch` | Delete multiple variables at once | `ids[]`, `collection_id` |

---

## Variables — Modes

| Tool | Description | Parameters |
|------|-------------|------------|
| `add_mode_to_collection` | Add a new mode to a collection (e.g. Dark) | `id`, `name` |
| `rename_mode` | Rename a mode | `id`, `old_name`, `new_name` |
| `delete_mode` | Delete a mode from a collection | `id`, `name` |
| `duplicate_mode_values` | Copy values from one mode to another | `id`, `from`, `to`, `transform_colors` |

---

## Variables — Color Calculations

These tools run server-side and require no Figma connection.

| Tool | Description | Parameters |
|------|-------------|------------|
| `calculate_color_scale` | Generate a 10-level scale (50–900) from a base color | `base`, `background`, `input_format` |
| `calculate_composite_color` | Calculate the result of compositing two colors at a mix% | `base`, `background`, `mix_percentage`, `input_format` |
| `convert_color_format` | Convert a color between hex, rgba, hsl, and figma formats | `color`, `from_format`, `to_format` |
| `calculate_contrast_ratio` | Calculate the WCAG contrast ratio between two colors | `foreground`, `background`, `input_format` |

**Scale algorithm:** `result = (base × mix%) + (background × (1 − mix%))` with mix percentages 5 % (50) → 90 % (900).

**WCAG thresholds:** AA Normal ≥ 4.5 : 1 · AA Large ≥ 3 : 1 · AAA Normal ≥ 7 : 1 · AAA Large ≥ 4.5 : 1

---

## Variables — Schema & Audit

| Tool | Description | Parameters |
|------|-------------|------------|
| `audit_collection` | Compare a collection against the standard 106-variable schema | `collection_id`, `chartColors`, `custom_schema` |
| `validate_color_contrast` | Validate color pairs in a collection for WCAG compliance | `collection_id`, `mode`, `standard` |
| `get_schema_definition` | Return the standard schema definition | `chartColors`, `format` |
| `suggest_missing_variables` | List missing variables with suggested values | `collection_id`, `defaults` |
| `generate_audit_report` | Generate a full audit report | `collection_id`, `chartColors`, `format` |

---

## Variables — Templates & Presets

| Tool | Description | Parameters |
|------|-------------|------------|
| `apply_default_theme` | Apply the default dark theme (106 variables) to a collection | `collection_id`, `overwrite`, `chartColors` |
| `create_color_scale_set` | Create a complete 10-level scale for one named color | `collection_id`, `color_name`, `base`, `foreground`, `background`, `mode` |
| `apply_custom_palette` | Apply custom brand colors and regenerate derived scales | `collection_id`, `palette`, `background`, `regenerate_scales` |
| `export_collection_schema` | Export a collection as a JSON schema | `collection_id`, `mode`, `include_metadata` |
| `import_collection_schema` | Import variables from a JSON schema | `collection_id`, `schema`, `mode`, `overwrite_existing` |
| `reorder_variables` | Reorder variables to match standard organization | `collection_id`, `order` |

---

## Variables — Token Systems

| Tool | Description | Parameters |
|------|-------------|------------|
| `create_spacing_system` | Create a spacing token system | `collection_id`, `preset`, `include_semantic` |
| `create_typography_system` | Create a typography scale system | `collection_id`, `scale_preset`, `base_size`, `include_weights`, `include_line_heights`, `include_semantic` |
| `create_radius_system` | Create a border radius token system | `collection_id`, `preset` |
| `setup_design_system` | Create or update an entire design system (pages, collections, text styles, effect styles) | `pages`, `collections`, `text_styles`, `effect_styles` |
| `create_complete_design_system` | Initialize a complete design system in one call | `collection_name`, `modes`, `color_preset`, `custom_colors`, `spacing_preset`, `typography_preset`, `radius_preset`, `include_semantic_tokens` |

---

## Variables — Bulk Operations

| Tool | Description | Parameters |
|------|-------------|------------|
| `create_all_scales` | Create all 7 color scales (neutral, brand, red, green, blue, yellow, purple) at once | `collection_id`, `colors`, `background` |
| `fix_collection_to_standard` | Auto-fix a collection to match the 102-variable standard | `collection_id`, `preserve_custom`, `add_chart_colors`, `defaults`, `dry_run` |
| `add_chart_colors` | Add 8 chart colors to a collection | `id`, `chart_colors` |

---

## Icons

Uses the [Lucide](https://lucide.dev) icon library (5 000+ icons).

| Tool | Description | Parameters |
|------|-------------|------------|
| `search_icon` | Fuzzy-search for icons by keyword | `query`, `limit` |
| `get_icon` | Get an icon's SVG by exact name | `name` |
| `list_icons` | Paginated listing of icon names | `prefix`, `offset`, `limit` |
| `create_icon` | Create an icon node in Figma | `parentId`, `index`, `name`, `color`, `colorVariable`, `size` |
| `update_icon` | Replace an existing icon node with a new one | `nodeId`, `name`, `color`, `colorVariable`, `size` |

---

## Documentation

Tools for generating design documentation from a Figma file.

| Tool | Description | Parameters |
|------|-------------|------------|
| `enumerate_all_frames` | List all frames across all pages (or one page) with metadata — name, size, position, prototype links, annotations, child count. Starting point for documentation workflows | `pageId`, `topLevelOnly`, `includeComponents` |
| `map_prototype_flows` | Build a complete flow graph from prototype reactions — nodes, edges (from→to with trigger/action), and computed entry points | `pageId` |
| `bulk_export_frames` | Export multiple frames as base64 images in one call; defaults to all top-level frames on the page | `nodeIds`, `format`, `scale`, `pageId` |
| `get_content_tree` | Extract the full content tree — text with inferred semantic roles (heading, body, cta, …), component types, layout containers | `nodeId`, `pageId`, `maxDepth`, `includeImages` |
| `get_frame_documentation` | Complete documentation packet for frame(s): metadata, all annotations, anchored comments, prototype links | `nodeId`, `nodeIds`, `includeResolved` |

---

## Comparison

Design-vs-implementation diffing. See [figma-browser-diff.md](figma-browser-diff.md) for the full guide (data-fig-id convention, style audit, fix hints, annotation maps).

| Tool | Description | Parameters |
|------|-------------|------------|
| `compare_figma_to_component` | Compare a Figma node to an inline React component (file map served locally, npm via esm.sh) | `nodeId`, `files`, `entry`, `selector`, `tolerance` |
| `diff_figma_to_browser` | Diff a Figma node's visual properties against a DOM element's computed CSS (✓ / ❌ / — rows). Resolves the element via `css_selector`, `[data-fig-id]` annotation, or image-template matching | `figma_node_id`, `css_selector`, `min_confidence`, `properties`, `tolerance_overrides` |
| `diff_figma_frame_to_page` | Audit an entire Figma frame against the live DOM via hierarchical Hungarian bounding-box matching; optional batched style audit and annotation plan | `frame_node_id`, `root_selector`, `max_cost`, `min_iou`, `max_nodes`, `crop_top`, `crop_bottom`, `include_zero_rect`, `include_style_diff`, `max_style_nodes`, `properties`, `annotation_map`, `include_token_suggestions` |

---

## Browser Inspection & Overlay

Requires the Videntia Browser Connect Chrome extension. Tools target the pinned/active tab by default; pass `tab_id` for a specific (even non-focused) tab.

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_browser_page_info` | Get URL, title, and tab ID of the target tab | `tab_id` |
| `get_browser_page_screenshot` | Screenshot a tab (PNG); `full_page` captures the entire scrollable page beyond the viewport | `full_page`, `tab_id` |
| `get_browser_dom_nodes` | Serialized DOM — tags, attributes, text, bounding rects, children | `selector`, `depth`, `include_text`, `include_attributes`, `tab_id` |
| `get_browser_computed_styles` | Computed CSS for a DOM element | `selector`, `properties`, `tab_id` |
| `overlay_figma_selection_in_browser` | Inject the selected Figma frame as a semi-transparent overlay on the page | `opacity`, `scale`, `cropTop`, `cropBottom`, `offsetX`, `offsetY`, `blendMode`, `tab_id` |
| `clear_browser_overlay` | Remove the Figma overlay | `tab_id` |
| `set_browser_viewport` | Set viewport size — resizes the OS window, or uses CDP device emulation (with touch) below Chrome's ~500 px window minimum or with `force_emulation` | `width`, `height`, `device_scale_factor`, `force_emulation`, `tab_id` |
| `reset_browser_viewport` | Clear CDP viewport emulation and detach the debugger | `tab_id` |

---

## Browser Control

Full Chrome control via CDP — trusted input events, navigation, tab management, and console/network observability. See [browser-control-tools.md](browser-control-tools.md) for architecture and behavior details.

| Tool | Description | Parameters |
|------|-------------|------------|
| `browser_click` | Click an element or point (real trusted click) | `selector` or `x`+`y`, `button`, `click_count`, `tab_id` |
| `browser_hover` | Hover an element or point — triggers `:hover`, tooltips, menus | `selector` or `x`+`y`, `tab_id` |
| `browser_type` | Type text (works with React/Vue controlled inputs); `clear_first` replaces existing value | `text`, `selector`, `clear_first`, `tab_id` |
| `browser_press_key` | Press a key with optional modifiers (Enter, Tab, arrows, `ctrl+a`, …) | `key`, `modifiers`, `tab_id` |
| `browser_scroll` | Scroll by pixel delta via wheel event; optionally over an element for inner containers | `delta_y`, `delta_x`, `selector`, `x`, `y`, `tab_id` |
| `browser_evaluate_js` | Evaluate a JS expression in page context (awaits promises, 100 KB result cap) | `expression`, `timeout_ms`, `tab_id` |
| `browser_navigate` | Navigate to a URL and wait for load (http/https/about:blank only); re-applies viewport emulation | `url`, `tab_id` |
| `browser_back` | Go back one history entry | `tab_id` |
| `browser_forward` | Go forward one history entry | `tab_id` |
| `browser_list_tabs` | List all tabs — ID, URL, title, active/pinned/agent-group state | — |
| `browser_create_tab` | Open a new tab in the purple "Videntia" agent tab group, or a dedicated window (`new_window`) to isolate viewport resizes; returns tab ID and window ID | `url`, `active`, `grouped`, `new_window` |
| `browser_close_tab` | Close a tab (explicit `tab_id` required) | `tab_id` |
| `browser_close_group` | Close the entire "Videntia" agent tab group | — |
| `browser_read_console` | Read buffered console messages/exceptions/dialogs (500-entry ring buffer, resets on navigation) | `pattern`, `level`, `limit`, `clear`, `tab_id` |
| `browser_read_network` | Read buffered network requests (300-request ring buffer, persists across navigations) | `url_filter`, `limit`, `clear`, `tab_id` |

---

## Batch

| Tool | Description | Parameters |
|------|-------------|------------|
| `batch_actions` | Execute multiple commands in a single batch | `actions[]`, `stopOnError` |

Use `batch_actions` to reduce round-trips when applying many operations at once. Each action in the array is a `{ command, params }` object matching any tool above.

---

## Channels

| Tool | Description | Parameters |
|------|-------------|------------|
| `join_channel` | Join a specific channel to communicate with a Figma file | `channelId` |
| `get_open_channels` | List all open Figma channels | — |

---

## History

| Tool | Description | Parameters |
|------|-------------|------------|
| `undo` | Undo the last action in Figma | — |
| `commit_undo` | Commit an undo checkpoint | — |
| `save_version_history` | Save a named version to Figma version history | `title`, `description` |
| `lint_frame` | Run a compliance audit on a frame or node | `node_id`, `fix`, `checks` |
