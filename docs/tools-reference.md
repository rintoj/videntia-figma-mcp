# Claude Figma MCP — Tools Reference

---

## Agent Prompt: Full Tool Test Run

> Use the following prompt to instruct an agent to execute and validate every tool in this reference:

```
You are a Figma MCP test agent. Your job is to execute every tool listed in docs/tools-reference.md
one by one, in order, using the "Draft" page of the connected Figma channel.

## Rules

1. **Resolve the channel first** using get_open_channels → join_channel before any other tool.
2. **Execute each tool exactly as documented**, substituting real node IDs from earlier responses
   wherever placeholder IDs (e.g. "123:456") appear.
3. **After each tool call**, check for errors. If an error occurs:
   - Stop immediately. Do not continue to the next tool.
   - Diagnose the root cause (bad parameter? wrong type? missing field? API mismatch?).
   - Determine the correct fix: either a code change in the MCP server/plugin, or a documentation
     correction in the code itself, or a documentation correction in this file.
   - Present your diagnosis and proposed fix to the user clearly, then **ask for permission** before
     making any changes.
   - Once permission is granted, apply the fix (edit source files and/or docs as needed), then run:
     `bun run build && launchctl stop com.claude-figma-mcp.socket && launchctl start com.claude-figma-mcp.socket`
   - Wait a moment for the server to restart, then **retry the same tool**. If it passes, continue to
     the next tool. If it fails again, stop and re-diagnose.
4. **Track state**: store node IDs, collection IDs, variable IDs, and style IDs returned by
   creation tools so they can be reused by subsequent calls.
5. **Clean up**: after completing all tests, delete nodes and variables created during the run
   so the Draft page is left in a clean state.
6. **On success**, report a summary table: tool name | status (✅ / ❌) | notes.

## Starting point

Work on the "Draft" page. Create a parent frame at the start to contain all test nodes.
```

---

> **Purpose:** A structured reference for agents to execute tools one by one and validate correctness.
> **Order:** Logical execution order — inspect first, create next, modify, then delete.
> **Node IDs:** Replace placeholder IDs (e.g. `"123:456"`) with real IDs obtained from earlier calls.

---

## Table of Contents

1. [Channel Setup](#1-channel-setup)
2. [Document & Page Inspection](#2-document--page-inspection) — `get_document_info`, `get_variables`, `get_design_system`
3. [Node Inspection](#3-node-inspection)
4. [Selection & Focus](#4-selection--focus)
5. [Node Creation](#5-node-creation)
6. [Node Modification — Layout](#6-node-modification--layout)
7. [Node Modification — Appearance](#7-node-modification--appearance)
8. [Node Modification — Fill & Stroke](#8-node-modification--fill--stroke)
9. [Text Creation & Styling](#9-text-creation--styling)
10. [Text Style Management](#10-text-style-management)
11. [Component Tools](#11-component-tools)
12. [Icon Tools](#12-icon-tools)
13. [SVG & Structural Operations](#13-svg--structural-operations)
14. [Effects & Shadows](#14-effects--shadows)
15. [Variable Collections](#15-variable-collections)
16. [Variable CRUD](#16-variable-crud)
17. [Color Calculations (Server-side)](#17-color-calculations-server-side)
18. [Schema & Audit](#18-schema--audit)
19. [Theme Presets & Templates](#19-theme-presets--templates)
20. [Mode Management](#20-mode-management)
21. [Design System Operations](#21-design-system-operations)
22. [Annotations](#22-annotations)
23. [Prototyping & Connections](#23-prototyping--connections)
24. [Export & Image](#24-export--image)
25. [Batch Operations](#25-batch-operations)
26. [JSX Bridge](#26-jsx-bridge)

---

## 1. Channel Setup

### `get_open_channels`

List all open Figma channels. **Always call first** to discover available channel IDs.

```json
{}
```

---

### `join_channel`

Join a specific Figma channel before using any Figma-side tools.

```json
{
  "channelId": "abc123"
}
```

---

## 2. Document & Page Inspection

### `get_document_info`

Get name, pages, and metadata for the current Figma document. No parameters.

```json
{}
```

---

### `get_variables`

Get all variables and variable collections in the document.

```json
{}
```

---

### `get_design_system`

Aggregate all design tokens — variables, text styles, effect styles, spacing, radius.
Call this **after** styles and variables have been created to see a complete picture.

```json
{}
```

---

## 3. Node Inspection

### `get_selection`

Get info on currently selected node(s). Returns JSX+Tailwind markup.

```json
{}
```

---

### `get_node_info`

Get detailed info for a specific node by ID.

```json
{
  "nodeId": "123:456"
}
```

---

### `get_nodes_info`

Get info for multiple nodes at once.

```json
{
  "nodeIds": ["123:456", "123:789"]
}
```

---

### `scan_nodes_by_types`

Find all descendant nodes matching specific types inside a parent node.

```json
{
  "nodeId": "123:456",
  "types": ["TEXT", "RECTANGLE", "FRAME"]
}
```

---

### `scan_text_nodes`

Scan all text nodes inside a parent node.

```json
{
  "nodeId": "123:456"
}
```

---

### `lint_frame`

Run a full design compliance audit on a frame — checks token usage, spacing, naming, accessibility.

```json
{
  "nodeId": "123:456"
}
```

---

## 4. Selection & Focus

### `set_focus`

Select a node and scroll the Figma viewport to it.

```json
{
  "nodeId": "123:456"
}
```

---

### `set_selections`

Select multiple nodes at once.

```json
{
  "nodeIds": ["123:456", "123:789"]
}
```

---

## 5. Node Creation

### `create_frame`

Create a new frame. Returns `id` — use it as `parentId` for children.

```json
{
  "x": 100,
  "y": 100,
  "width": 375,
  "height": 812,
  "name": "Screen/Home",
  "fillColor": { "r": 1, "g": 1, "b": 1, "a": 1 }
}
```

---

### `create_rectangle`

Create a rectangle shape.

```json
{
  "x": 0,
  "y": 0,
  "width": 200,
  "height": 48,
  "name": "Button/Background",
  "parentId": "123:456"
}
```

---

### `create_text`

Create a text node.

```json
{
  "x": 16,
  "y": 24,
  "text": "Hello World",
  "fontSize": 16,
  "fontFamily": "Inter",
  "fontWeight": 600,
  "fontColor": { "r": 0.1, "g": 0.1, "b": 0.1, "a": 1 },
  "parentId": "123:456"
}
```

---

### `create_svg`

Create a node from an SVG string. Good for inserting icons inline.

```json
{
  "svgString": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\"><circle cx=\"12\" cy=\"12\" r=\"10\" fill=\"#000\"/></svg>",
  "x": 0,
  "y": 0,
  "name": "Icon/Circle",
  "parentId": "123:456",
  "flatten": false
}
```

---

### `clone_node`

Clone an existing node to a new position.

```json
{
  "nodeId": "123:456",
  "x": 400,
  "y": 100
}
```

---

### `insert_child`

Move a node inside another node at a specific index.

```json
{
  "parentId": "123:456",
  "childId": "123:789",
  "index": 0
}
```

---

### `group_nodes`

Group multiple nodes together.

```json
{
  "nodeIds": ["123:456", "123:789"],
  "name": "Card/Group"
}
```

---

### `ungroup_nodes`

Ungroup a group or frame, releasing its children to the parent.

```json
{
  "nodeId": "123:456"
}
```

---

### `flatten_node`

Flatten a node (vector/boolean merge).

```json
{
  "nodeId": "123:456"
}
```

---

## 6. Node Modification — Layout

### `set_auto_layout`

Configure auto-layout direction, padding, gap, and sizing on a frame.

```json
{
  "nodeId": "123:456",
  "mode": "VERTICAL",
  "top": 16,
  "bottom": 16,
  "left": 16,
  "right": 16,
  "gap": 8,
  "primaryAxisAlignItems": "MIN",
  "counterAxisAlignItems": "MIN",
  "horizontal": "FIXED",
  "vertical": "HUG"
}
```

---

### `set_layout_mode`

Set only the layout mode and wrap behavior.

```json
{
  "nodeId": "123:456",
  "mode": "HORIZONTAL",
  "wrap": "NO_WRAP"
}
```

---

### `set_padding`

Set padding values on an auto-layout frame.

```json
{
  "nodeId": "123:456",
  "top": 12,
  "right": 16,
  "bottom": 12,
  "left": 16
}
```

---

### `set_item_spacing`

Set gap between children in an auto-layout frame.

```json
{
  "nodeId": "123:456",
  "gap": 8,
  "counterAxisSpacing": 4
}
```

---

### `set_axis_align`

Set primary and counter axis alignment.

```json
{
  "nodeId": "123:456",
  "primaryAxisAlignItems": "CENTER",
  "counterAxisAlignItems": "CENTER"
}
```

---

### `set_layout_sizing`

Set horizontal and vertical sizing modes.

```json
{
  "nodeId": "123:456",
  "horizontal": "FILL",
  "vertical": "HUG"
}
```

---

### `move_node`

Move a node to a new (x, y) position.

```json
{
  "nodeId": "123:456",
  "x": 200,
  "y": 300
}
```

---

### `resize_node`

Resize a node to specific dimensions.

```json
{
  "nodeId": "123:456",
  "width": 320,
  "height": 56
}
```

---

### `rename_node`

Rename a node.

```json
{
  "nodeId": "123:456",
  "name": "Button/Primary/Large"
}
```

---

### `set_corner_radius`

Set corner radius on a node.

```json
{
  "nodeId": "123:456",
  "radius": 8,
  "corners": [true, true, true, true]
}
```

---

## 7. Node Modification — Appearance

### `bind_variable`

Bind a variable to a node property.

```json
{
  "nodeId": "123:456",
  "variableId": "VariableID:789/0",
  "field": "fills/0/color"
}
```

> Common `field` values: `"fills/0/color"`, `"strokes/0/color"`, `"opacity"`, `"width"`, `"height"`, `"cornerRadius"`, `"paddingLeft"`, `"itemSpacing"`

---

### `unbind_variable`

Remove a variable binding from a node property.

```json
{
  "nodeId": "123:456",
  "field": "fills/0/color"
}
```

---

### `get_bound_variables`

Get all variable bindings for a specific node. Call **after** `bind_variable` has been used.

```json
{
  "nodeId": "123:456"
}
```

---

## 8. Node Modification — Fill & Stroke

### `set_fill_color`

Set solid fill color (RGBA normalized 0–1).

```json
{
  "nodeId": "123:456",
  "r": 0.376,
  "g": 0.49,
  "b": 1.0,
  "a": 1
}
```

---

### `set_stroke_color`

Set stroke color and weight.

```json
{
  "nodeId": "123:456",
  "r": 0.8,
  "g": 0.8,
  "b": 0.8,
  "a": 1,
  "weight": 1
}
```

---

### `set_gradient_fill`

Set a gradient fill (LINEAR, RADIAL, ANGULAR, DIAMOND).

```json
{
  "nodeId": "123:456",
  "type": "LINEAR",
  "stops": [
    { "color": { "r": 0.4, "g": 0.6, "b": 1.0, "a": 1 }, "position": 0 },
    { "color": { "r": 0.1, "g": 0.2, "b": 0.8, "a": 1 }, "position": 1 }
  ],
  "angle": 135,
  "opacity": 1
}
```

---

### `set_image_fill`

Set an image fill on a node from a URL.

```json
{
  "nodeId": "123:456",
  "imageUrl": "https://images.unsplash.com/photo-xxxxx?w=400",
  "scaleMode": "FILL"
}
```

---

### `delete_node`

Delete a single node by ID.

```json
{
  "nodeId": "123:456"
}
```

---

### `delete_multiple_nodes`

Delete multiple nodes in a single call.

```json
{
  "nodeIds": ["123:456", "123:789", "123:012"]
}
```

---

## 9. Text Creation & Styling

### `set_text_content`

Replace the text content of an existing text node.

```json
{
  "nodeId": "123:456",
  "text": "Updated button label"
}
```

---

### `set_multiple_text_contents`

Update many text nodes in parallel (batched internally).

```json
{
  "nodeId": "123:000",
  "text": [
    { "nodeId": "123:456", "text": "Home" },
    { "nodeId": "123:789", "text": "Profile" }
  ]
}
```

---

### `set_font_name`

Set font family and style.

```json
{
  "nodeId": "123:456",
  "family": "Inter",
  "style": "Semi Bold"
}
```

---

### `set_font_size`

Set font size in pixels.

```json
{
  "nodeId": "123:456",
  "size": 14
}
```

---

### `set_font_weight`

Set font weight by numeric value.

```json
{
  "nodeId": "123:456",
  "weight": 600
}
```

---

### `set_letter_spacing`

Set letter spacing.

```json
{
  "nodeId": "123:456",
  "spacing": 0.5,
  "unit": "PIXELS"
}
```

---

### `set_line_height`

Set line height.

```json
{
  "nodeId": "123:456",
  "height": 24,
  "unit": "PIXELS"
}
```

---

### `set_paragraph_spacing`

Set paragraph spacing.

```json
{
  "nodeId": "123:456",
  "spacing": 8
}
```

---

### `set_text_case`

Set text case transformation.

```json
{
  "nodeId": "123:456",
  "textCase": "UPPER"
}
```

> Values: `ORIGINAL`, `UPPER`, `LOWER`, `TITLE`

---

### `set_text_decoration`

Set underline or strikethrough.

```json
{
  "nodeId": "123:456",
  "decoration": "UNDERLINE"
}
```

> Values: `NONE`, `UNDERLINE`, `STRIKETHROUGH`

---

### `get_styled_text_segments`

Inspect how a text node's characters are styled by property.

```json
{
  "nodeId": "123:456",
  "property": "fontSize"
}
```

> Values: `fontName`, `fontSize`, `fontWeight`, `textCase`, `textDecoration`, `textStyleId`, `fills`, `letterSpacing`, `lineHeight`, `fillStyleId`

---

### `load_font_async`

Pre-load a font family before using it.

```json
{
  "family": "Roboto",
  "style": "Bold"
}
```

---

## 10. Text Style Management

### `get_styles`

Get all local styles (text, fill, effect, grid). Call **after** styles have been created.

```json
{}
```

---

### `get_text_styles`

List all local text styles. Each style returns an `id` (use with `apply_text_style`).

```json
{}
```

---

### `create_text_style`

Create a text style from an existing text node.

```json
{
  "nodeId": "123:456",
  "name": "Heading/H2",
  "description": "Secondary heading — 24px SemiBold"
}
```

---

### `create_text_style_from_properties`

Create a text style without needing an existing node.

```json
{
  "name": "Body/MD",
  "fontSize": 14,
  "fontFamily": "Inter",
  "fontStyle": "Regular",
  "lineHeight": { "value": 22, "unit": "PIXELS" },
  "letterSpacing": { "value": 0, "unit": "PIXELS" }
}
```

---

### `apply_text_style`

Apply a text style to a text node.

```json
{
  "nodeId": "123:456",
  "styleId": "S:abc123,"
}
```

> Pass the `id` from `get_text_styles`, NOT the `key`.

---

### `update_text_style`

Update properties of an existing text style.

```json
{
  "styleId": "S:abc123,",
  "fontSize": 16,
  "lineHeight": { "value": 24, "unit": "PIXELS" }
}
```

---

### `delete_text_style`

Delete a text style.

```json
{
  "styleId": "S:abc123,"
}
```

---

## 11. Component Tools

### `get_local_components`

List all local components with their node IDs and keys. Call **after** components have been created.

```json
{}
```

---

### `get_component_properties`

Get all property definitions on a component or component set.

```json
{
  "nodeId": "123:456"
}
```

---

### `create_component`

Convert a frame or group into a reusable component.

```json
{
  "nodeId": "123:456"
}
```

---

### `create_component_set`

Combine multiple components into a variant set.

```json
{
  "nodeIds": ["123:456", "123:789"],
  "name": "Button"
}
```

---

### `create_component_instance`

Create an instance of a local or library component.

```json
{
  "componentKey": "123:456",
  "x": 100,
  "y": 200
}
```

---

### `detach_instance`

Detach a component instance, converting it to a plain frame.

```json
{
  "nodeId": "123:456"
}
```

---

### `add_component_property`

Add a new property (BOOLEAN, TEXT, INSTANCE_SWAP, VARIANT) to a component.

```json
{
  "nodeId": "123:456",
  "propertyName": "Show Icon",
  "type": "BOOLEAN",
  "defaultValue": true
}
```

---

### `edit_component_property`

Edit an existing component property's name or default.

```json
{
  "nodeId": "123:456",
  "propertyName": "Show Icon#123:456",
  "newName": "HasIcon",
  "newDefaultValue": false
}
```

---

### `delete_component_property`

Delete a component property (BOOLEAN, TEXT, INSTANCE_SWAP only).

```json
{
  "nodeId": "123:456",
  "propertyName": "Show Icon#123:456"
}
```

---

### `set_component_property_references`

Link a property to a child node's visibility, text content, or swap.

```json
{
  "nodeId": "123:789",
  "references": {
    "visible": "Show Icon#123:456"
  }
}
```

---

### `get_instance_overrides`

Get all overrides from a selected component instance.

```json
{
  "nodeId": "123:456"
}
```

---

### `set_instance_overrides`

Copy overrides from one instance and apply to others.

```json
{
  "sourceInstanceId": "123:456",
  "targetNodeIds": ["123:789", "123:012"]
}
```

---

## 12. Icon Tools

### `search_icon`

Fuzzy search Lucide icons by keyword. Use `|` for multiple patterns.

```json
{
  "query": "arrow|chevron",
  "limit": 5
}
```

---

### `get_icon`

Get a Lucide icon SVG by exact name.

```json
{
  "name": "bell"
}
```

---

### `list_icons`

Paginated list of available Lucide icon names.

```json
{
  "prefix": "arrow",
  "offset": 0,
  "limit": 50
}
```

---

### `create_icon`

Create a Lucide icon in Figma at a specific parent, with color and size.

```json
{
  "parentId": "123:456",
  "name": "bell",
  "color": "#6b7280",
  "size": 20,
  "index": 0
}
```

> `color` also accepts design token names like `"gray-500"` or `"semantic/icon/muted"` — auto-binds the variable.

---

### `update_icon`

Replace an existing icon node with a new Lucide icon, preserving position.

```json
{
  "nodeId": "123:456",
  "name": "bell-off",
  "color": "#ef4444",
  "size": 20
}
```

---

## 13. SVG & Structural Operations

> See [Node Creation](#5-node-creation) for `create_svg`, `group_nodes`, `ungroup_nodes`, `flatten_node`, `insert_child`, `clone_node`.

---

## 14. Effects & Shadows

### `set_effects`

Apply one or more visual effects to a node.

```json
{
  "nodeId": "123:456",
  "effects": [
    {
      "type": "DROP_SHADOW",
      "color": { "r": 0, "g": 0, "b": 0, "a": 0.15 },
      "offset": { "x": 0, "y": 4 },
      "radius": 8,
      "spread": 0,
      "visible": true
    }
  ]
}
```

> Types: `DROP_SHADOW`, `INNER_SHADOW`, `LAYER_BLUR`, `BACKGROUND_BLUR`, `NOISE`, `TEXTURE`, `GLASS`

---

### `set_effect_style_id`

Apply an existing effect style to a node.

```json
{
  "nodeId": "123:456",
  "effectStyleId": "S:effectId123,"
}
```

---

### `create_effect_style`

Create a reusable effect style in the document.

```json
{
  "name": "shadow/md",
  "effects": [
    {
      "type": "DROP_SHADOW",
      "color": { "r": 0, "g": 0, "b": 0, "a": 0.1 },
      "offset": { "x": 0, "y": 4 },
      "radius": 12
    }
  ],
  "description": "Card shadow — medium elevation"
}
```

---

### `update_effect_style`

Update an existing effect style.

```json
{
  "styleId": "S:effectId123,",
  "name": "shadow/lg",
  "effects": [
    {
      "type": "DROP_SHADOW",
      "color": { "r": 0, "g": 0, "b": 0, "a": 0.2 },
      "offset": { "x": 0, "y": 8 },
      "radius": 24
    }
  ]
}
```

---

### `delete_effect_style`

Delete an effect style.

```json
{
  "styleId": "S:effectId123,"
}
```

---

## 15. Variable Collections

### `get_variable_collections`

List all variable collections with their modes and variable counts.

```json
{}
```

---

### `get_collection_info`

Get detailed metadata for a specific collection.

```json
{
  "id": "VariableCollectionId:123/0"
}
```

---

### `create_variable_collection`

Create a new variable collection.

```json
{
  "name": "Theme",
  "default_mode": "dark"
}
```

---

### `rename_variable_collection`

Rename a variable collection.

```json
{
  "id": "VariableCollectionId:123/0",
  "name": "Brand Tokens"
}
```

---

### `delete_variable_collection`

Delete a collection and all its variables (irreversible).

```json
{
  "id": "VariableCollectionId:123/0"
}
```

---

## 16. Variable CRUD

### `create_variable`

Create a single variable in a collection.

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "name": "background/primary",
  "type": "COLOR",
  "value": { "r": 0.07, "g": 0.07, "b": 0.07, "a": 1 },
  "modeId": "123:0"
}
```

> Types: `COLOR`, `FLOAT`, `STRING`, `BOOLEAN`

---

### `create_variables_batch`

Create multiple variables at once (more efficient than individual calls).

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "variables": [
    { "name": "background/primary", "type": "COLOR", "value": { "r": 0.07, "g": 0.07, "b": 0.07, "a": 1 } },
    { "name": "background/secondary", "type": "COLOR", "value": { "r": 0.11, "g": 0.11, "b": 0.11, "a": 1 } }
  ]
}
```

---

### `update_variable_value`

Update a variable's value for a specific mode.

```json
{
  "variableId": "VariableID:789/0",
  "value": { "r": 0.9, "g": 0.9, "b": 0.9, "a": 1 },
  "modeId": "123:1"
}
```

---

### `rename_variable`

Rename a variable.

```json
{
  "variableId": "VariableID:789/0",
  "name": "surface/primary"
}
```

---

### `delete_variable`

Delete a single variable.

```json
{
  "variableId": "VariableID:789/0"
}
```

---

### `delete_variables_batch`

Delete multiple variables at once.

```json
{
  "variableIds": ["VariableID:789/0", "VariableID:790/0"]
}
```

---

## 17. Color Calculations (Server-side)

> These tools run **entirely server-side** — no Figma connection needed.

### `calculate_color_scale`

Generate all 10 scale variants (50–900) from a base color.

```json
{
  "baseColor": { "r": 0.376, "g": 0.49, "b": 1.0, "a": 1 },
  "backgroundColor": { "r": 0.07, "g": 0.07, "b": 0.07, "a": 1 }
}
```

---

### `calculate_composite_color`

Calculate a single composited color at a specific mix percentage.

```json
{
  "baseColor": { "r": 0.376, "g": 0.49, "b": 1.0, "a": 1 },
  "backgroundColor": { "r": 0.07, "g": 0.07, "b": 0.07, "a": 1 },
  "mixPercentage": 50
}
```

---

### `convert_color_format`

Convert between color formats (hex, rgba, hsl).

```json
{
  "color": "#6080FF",
  "fromFormat": "hex",
  "toFormat": "rgba"
}
```

---

### `calculate_contrast_ratio`

Calculate WCAG contrast ratio between two colors.

```json
{
  "foreground": { "r": 1, "g": 1, "b": 1, "a": 1 },
  "background": { "r": 0.07, "g": 0.07, "b": 0.07, "a": 1 }
}
```

---

## 18. Schema & Audit

### `audit_collection`

Compare a collection against the 102-variable standard schema.

```json
{
  "collectionId": "VariableCollectionId:123/0"
}
```

---

### `validate_color_contrast`

Validate all foreground/background pairs meet WCAG AA standards.

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "modeId": "123:0"
}
```

---

### `get_schema_definition`

Return the complete standard schema definition.

```json
{}
```

---

### `suggest_missing_variables`

Get a list of missing variables with suggested default values.

```json
{
  "collectionId": "VariableCollectionId:123/0"
}
```

---

### `generate_audit_report`

Generate a formatted audit report (markdown or JSON).

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "format": "markdown"
}
```

---

### `export_collection_schema`

Export a collection as a portable JSON schema.

```json
{
  "collectionId": "VariableCollectionId:123/0"
}
```

---

### `import_collection_schema`

Import variables from a JSON schema into a collection.

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "schema": {
    "variables": [
      { "name": "background/primary", "type": "COLOR", "value": { "r": 0.07, "g": 0.07, "b": 0.07, "a": 1 } }
    ]
  }
}
```

---

## 19. Theme Presets & Templates

### `apply_default_theme`

Apply the built-in default dark theme values to a collection.

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "modeId": "123:0"
}
```

---

### `apply_custom_palette`

Apply custom brand colors and regenerate all derivative scales.

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "modeId": "123:0",
  "palette": {
    "blue": { "r": 0.376, "g": 0.49, "b": 1.0, "a": 1 },
    "green": { "r": 0.22, "g": 0.8, "b": 0.46, "a": 1 }
  }
}
```

---

### `create_color_scale_set`

Create a complete scale for one color (base + foreground + 10 scale variants).

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "colorName": "blue",
  "baseColor": { "r": 0.376, "g": 0.49, "b": 1.0, "a": 1 },
  "backgroundColor": { "r": 0.07, "g": 0.07, "b": 0.07, "a": 1 }
}
```

---

### `create_all_scales`

Create all 7 color scales at once (70 scale variants total).

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "modeId": "123:0",
  "backgroundColor": { "r": 0.07, "g": 0.07, "b": 0.07, "a": 1 }
}
```

---

### `add_chart_colors`

Add 8 chart color variables to a collection.

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "modeId": "123:0"
}
```

---

### `fix_collection_to_standard`

Auto-fix a collection to match the 102-variable standard (adds missing, renames incorrect).

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "modeId": "123:0"
}
```

---

### `reorder_variables`

Reorder variables to match standard organization (by category and name).

```json
{
  "collectionId": "VariableCollectionId:123/0"
}
```

---

### `create_spacing_system`

Create a complete spacing token system (8pt or 4pt grid).

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "modeId": "123:0",
  "gridUnit": 8
}
```

---

### `create_typography_system`

Create a complete typography token system (font sizes, weights, line heights).

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "modeId": "123:0",
  "fontFamily": "Inter"
}
```

---

### `create_radius_system`

Create a border-radius token system.

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "modeId": "123:0"
}
```

---

### `create_complete_design_system`

Bootstrap a full design system (colors + spacing + typography + radius) in one call.

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "modeId": "123:0",
  "fontFamily": "Inter",
  "gridUnit": 8
}
```

---

## 20. Mode Management

### `add_mode_to_collection`

Add a new mode (e.g., Light, High Contrast) to a collection.

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "modeName": "light"
}
```

---

### `rename_mode`

Rename an existing mode.

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "modeId": "123:1",
  "newName": "Light Mode"
}
```

---

### `delete_mode`

Delete a mode from a collection (cannot delete the last mode).

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "modeId": "123:1"
}
```

---

### `duplicate_mode_values`

Copy all variable values from one mode to another.

```json
{
  "collectionId": "VariableCollectionId:123/0",
  "sourceModeId": "123:0",
  "targetModeId": "123:1"
}
```

---

## 21. Design System Operations

### `setup_design_system`

Create or fully update a design system in a single compound call. Accepts variable collections, text styles, and effect styles.

```json
{
  "collections": [
    {
      "name": "Theme",
      "modes": ["dark", "light"],
      "variables": [
        {
          "name": "background/primary",
          "type": "COLOR",
          "values": { "dark": { "r": 0.07, "g": 0.07, "b": 0.07, "a": 1 }, "light": { "r": 1, "g": 1, "b": 1, "a": 1 } }
        }
      ]
    }
  ]
}
```

---

## 22. Annotations

### `get_annotations`

Get all annotations on a node.

```json
{
  "nodeId": "123:456",
  "includeCategories": true
}
```

---

### `set_annotation`

Create or update a single annotation on a node.

```json
{
  "nodeId": "123:456",
  "label": "Primary CTA — tap triggers checkout flow",
  "categoryId": "interaction"
}
```

---

### `set_multiple_annotations`

Set many annotations at once.

```json
{
  "nodeId": "123:000",
  "annotations": [
    { "nodeId": "123:456", "label": "Header — sticky on scroll" },
    { "nodeId": "123:789", "label": "Tab bar — always visible" }
  ]
}
```

---

### `get_annotation_categories`

List all annotation categories in the document.

```json
{}
```

---

### `create_annotation_category`

Create a custom annotation category.

```json
{
  "label": "Accessibility",
  "color": { "r": 0.4, "g": 0.8, "b": 0.4, "a": 1 }
}
```

---

### `update_annotation_category`

Update an existing annotation category.

```json
{
  "categoryId": "custom-cat-123",
  "label": "A11y",
  "color": { "r": 0.2, "g": 0.7, "b": 0.3, "a": 1 }
}
```

---

### `delete_annotation_category`

Delete a custom annotation category (presets cannot be deleted).

```json
{
  "categoryId": "custom-cat-123"
}
```

---

## 23. Prototyping & Connections

### `get_reactions`

Get all Figma prototype reactions for a set of nodes.

```json
{
  "nodeIds": ["123:456", "123:789"]
}
```

---

### `set_default_connector`

Set a connector node as the default style for new connections.

```json
{
  "connectorId": "123:456"
}
```

---

### `create_connections`

Create flow connections between nodes using the default connector.

```json
{
  "connections": [
    { "startNodeId": "123:456", "endNodeId": "123:789", "text": "Tap" },
    { "startNodeId": "123:789", "endNodeId": "123:012" }
  ]
}
```

---

## 24. Export & Image

### `export_node_as_image`

Export a node as a base64-encoded image.

```json
{
  "nodeId": "123:456",
  "format": "PNG",
  "scale": 2
}
```

---

### `export_node_as_image_url`

Export a node via Figma REST API and return a CDN URL. Best for large nodes (>4000px).

```json
{
  "nodeId": "123:456",
  "format": "PNG",
  "scale": 1
}
```

---

## 25. Batch Operations

### `batch_actions`

Execute multiple Figma commands in a single round-trip.
Supports `$result[N].field` references to use outputs from earlier steps.

```json
{
  "actions": [
    {
      "action": "clone_node",
      "params": { "nodeId": "123:456", "x": 400, "y": 100 }
    },
    {
      "action": "rename_node",
      "params": { "nodeId": "$result[0].id", "name": "Button/Secondary" }
    },
    {
      "action": "set_fill_color",
      "params": { "nodeId": "$result[0].id", "r": 0.9, "g": 0.9, "b": 0.9, "a": 1 }
    }
  ],
  "stopOnError": true
}
```

> Supports up to 200 actions per call. Use `stopOnError: true` to abort on first failure.

---

## 26. JSX Bridge

### `read_my_design`

Read current selection (or a node) as compact JSX+Tailwind markup.

```json
{
  "nodeId": "123:456",
  "depth": 3
}
```

---

### `jsx_to_figma`

Create or update Figma nodes from JSX+Tailwind markup.
Nodes with `id="<existingNodeId>"` are updated in place.

```json
{
  "jsx": "<div className=\"flex flex-col gap-4 p-4 bg-gray-900 rounded-lg\"><h1 className=\"text-white text-2xl font-semibold\">Hello</h1></div>",
  "parentId": "123:456",
  "x": 100,
  "y": 100
}
```

> Batch multiple roots in one `jsx` string to avoid redundant round-trips.

---

## Page Management

### `create_page`

Create a new page in the document.

```json
{
  "name": "Components"
}
```

---

### `rename_page`

Rename an existing page.

```json
{
  "pageId": "0:1",
  "name": "Design System"
}
```

---

### `delete_page`

Delete a page (cannot delete the last remaining page).

```json
{
  "pageId": "0:2"
}
```

---

## Quick Dependency Map

```
get_open_channels → join_channel
  → get_document_info
  → get_selection / get_node_info     (need nodeId)
  → create_frame                      → returns id for parentId
      → create_text / create_rect     (use parentId)
      → set_auto_layout               (configure layout)
      → set_fill_color / bind_variable
  → get_variable_collections          → returns collectionId + modeId
      → create_variable / create_variables_batch
      → bind_variable                 (variableId + nodeId + field)
  → get_text_styles                   → returns styleId
      → apply_text_style              (nodeId + styleId)
  → batch_actions                     (combine any of the above)
```
