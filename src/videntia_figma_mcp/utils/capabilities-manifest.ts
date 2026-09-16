/**
 * Capabilities / limitations manifest (bug #45).
 *
 * Every agent session used to rediscover the same platform limits and the same
 * "does this exist?" questions by trial and error. `get_capabilities` answers
 * them in one read-only call.
 *
 * MAINTENANCE: this file is the ONLY place the prose lives. When a platform
 * limit is lifted, a precondition changes, or a capability that agents assume
 * missing is added, update the matching entry here. The tool itself derives
 * everything it can (registered tool names, live session modes) from the code,
 * so it cannot rot the way a hand-written tool list would.
 */

export interface ManifestEntry {
  /** Short stable id, e.g. "gradient-variable-binding". */
  id: string;
  /** One-line statement of the limit / capability / precondition. */
  summary: string;
  /** Why it is true, or what to do instead. */
  detail: string;
  /** Tools this entry is about; used to cross-check against the live registry. */
  tools?: string[];
}

/**
 * Hard platform limits. These CANNOT be fixed here - they are Figma Plugin API
 * constraints. Do not open a bug for these; design around them.
 */
export const PLATFORM_LIMITS: ManifestEntry[] = [
  {
    id: "gradient-paints-cannot-be-bound-via-bind-variable",
    summary:
      "bind_variable/setBoundVariableForPaint cannot bind a GRADIENT paint - but gradient STOPS can be bound at author time.",
    detail:
      "figma.variables.setBoundVariableForPaint is typed SolidPaint in and SolidPaint out (@figma/plugin-typings 1.136.0, plugin-api.d.ts:2186) with no GradientPaint overload, so there is no way to bind an EXISTING gradient after the fact. The data model does support it: ColorStop.boundVariables.color (plugin-api.d.ts:4506, VariableBindableColorStopField = 'color') - so re-author the gradient with set_gradient_fill and a per-stop `colorVariable`, which writes that alias directly. lint_frame treats a fully bound gradient as compliant and only nudges (LOW) on unbound ones.",
    tools: ["set_gradient_fill", "bind_variable", "lint_frame"],
  },
  {
    id: "mixed-property-symbol",
    summary: "Figma returns the `mixed` symbol for properties that differ across children/segments.",
    detail:
      'Reads surface this as the string "MIXED". Set the property explicitly per node or per text range instead of trying to read a single value back.',
  },
  {
    id: "fonts-must-be-loaded",
    summary: "Text writes fail unless the font is loaded first.",
    detail: "Use load_font_async, or let create_text / set_text_content load it; a missing font rejects the write.",
    tools: ["load_font_async", "create_text", "set_text_content"],
  },
];

/**
 * Capabilities agents commonly assume are MISSING but which exist. This is the
 * highest-value section of the manifest: it replaces failed attempts and
 * hand-rolled workarounds.
 */
export const EXISTING_CAPABILITIES: ManifestEntry[] = [
  {
    id: "export-to-disk",
    summary: "export_node_as_image writes the image to DISK by default.",
    detail:
      "Writing to disk is the default - you get a file path back, not a base64 payload. Pass inline: true only when you actually need the pixels in the conversation.",
    tools: ["export_node_as_image", "bulk_export_frames"],
  },
  {
    id: "image-from-disk",
    summary: "set_image_fill_from_path reads an image off disk and applies it as a fill.",
    detail: "No base64 round trip needed; give it a local file path.",
    tools: ["set_image_fill_from_path", "set_image_fill"],
  },
  {
    id: "auto-layout-one-call",
    summary: "set_auto_layout sets layout mode, gap AND padding in ONE call.",
    detail: "You do not need set_layout_mode + set_item_spacing + set_padding as three round trips.",
    tools: ["set_auto_layout", "set_layout_mode", "set_item_spacing", "set_padding"],
  },
  {
    id: "create-frame-nested-options",
    summary: "create_frame accepts nested `layout` and `size` objects in one call.",
    detail: "A frame can be created already auto-laid-out and sized; no follow-up modification calls required.",
    tools: ["create_frame"],
  },
  {
    id: "blur-can-be-lint-compliant",
    summary: "Blur CAN satisfy the effect-style lint rule.",
    detail:
      "Create the blur as a shared effect style with create_effect_style and apply it with set_effect_style_id; a raw set_effects blur is what the lint rule flags.",
    tools: ["create_effect_style", "set_effect_style_id", "set_effects", "lint_frame"],
  },
  {
    id: "plural-forms-exist",
    summary: "Plural / bulk forms exist for the common single-node tools.",
    detail:
      "bind_many, create_texts, create_svgs, insert_children, move_nodes, bulk_bind_variables, delete_multiple_nodes, set_multiple_text_contents, get_nodes_info. Prefer these over N single calls.",
    tools: [
      "bind_many",
      "create_texts",
      "create_svgs",
      "insert_children",
      "move_nodes",
      "bulk_bind_variables",
      "delete_multiple_nodes",
      "set_multiple_text_contents",
      "get_nodes_info",
    ],
  },
  {
    id: "batch-return-state",
    summary: "batch_actions supports return_state: true.",
    detail:
      "Every action answers with the node's actual post-write state, so a silently discarded write is visible without a follow-up get_node_info. $result[N] references let later actions consume earlier ids.",
    tools: ["batch_actions"],
  },
  {
    id: "contrast-on-rendered-nodes",
    summary: "contrast_check_frame measures real contrast against resolved backdrops.",
    detail:
      "Prefer it over validate_color_contrast, which can only reason about variable NAMES. validate_color_contrast is kept for token-collection audits and now fails loudly when it can pair nothing (bug #44).",
    tools: ["contrast_check_frame", "validate_color_contrast"],
  },
  {
    id: "name-based-lookups",
    summary: "Most id parameters also accept a NAME.",
    detail:
      "bind_variable, set_effect_style_id, set_color_style_id, apply_text_style and friends take a human-readable name (dashes are normalised to slashes), so no id lookup call is needed first.",
  },
  {
    id: "pure-computation-tools-in-batch",
    summary:
      "calculate_composite_color / calculate_color_scale / calculate_contrast_ratio / calculate_contrast_ratios / convert_color_format run INSIDE batch_actions and chain via $result[N].",
    detail:
      'These are pure MCP-server maths with no Figma plugin command. batch_actions evaluates them server-side before dispatch, so e.g. action 0 calculate_composite_color then action 1 set_fill_color with color: "$result[0].hex" works. Every OTHER server-side-only tool (browser_*, figma_connect, join_channel, get_open_channels, get_schema_definition, get_capabilities, icon catalogue lookups, diff_*/compare_*) is standalone-only and batch_actions rejects it by name with the reason.',
    tools: ["batch_actions", "calculate_composite_color", "convert_color_format"],
  },
];

/**
 * Preconditions that cause a write to be ACCEPTED and then DISCARDED. Strict
 * mode turns these into errors; without it they are silent no-ops.
 */
export const WRITE_PRECONDITIONS: ManifestEntry[] = [
  {
    id: "padding-requires-auto-layout",
    summary: "padding / itemSpacing / layoutSizing require layoutMode != NONE.",
    detail:
      "Set auto layout on the node first (set_auto_layout or create_frame's `layout`), otherwise the write is discarded.",
    tools: ["set_padding", "set_item_spacing", "set_layout_sizing", "set_auto_layout"],
  },
  {
    id: "hug-invalid-on-page-frame",
    summary: "HUG sizing is invalid on a page-level (top-level) frame.",
    detail: "Top-level frames must be FIXED. Use HUG only on nested auto-layout children.",
    tools: ["set_layout_sizing"],
  },
  {
    id: "fill-requires-auto-layout-parent",
    summary: "FILL sizing requires the parent to be an auto-layout frame on that axis.",
    detail: "Without an auto-layout parent track there is nothing to fill, so the write is discarded.",
    tools: ["set_layout_sizing"],
  },
  {
    id: "space-between-overrides-item-spacing",
    summary: "primaryAxisAlignItems = SPACE_BETWEEN overrides itemSpacing.",
    detail:
      "The gap you set is ignored while SPACE_BETWEEN is active. Switch the alignment to MIN/CENTER/MAX if you need an explicit gap.",
    tools: ["set_auto_layout", "set_item_spacing", "set_axis_align"],
  },
  {
    id: "corner-radius-needs-support",
    summary: "cornerRadius is ignored on node types that do not support corners.",
    detail: "Lines, vectors and some group types discard the write; wrap in a frame instead.",
    tools: ["set_corner_radius"],
  },
];

/** All hardcoded sections, in the order get_capabilities renders them. */
export const MANIFEST_SECTIONS = [
  { key: "platformLimits", title: "Platform limits (cannot be fixed)", entries: PLATFORM_LIMITS },
  {
    key: "existingCapabilities",
    title: "Capabilities that already exist (do not hand-roll these)",
    entries: EXISTING_CAPABILITIES,
  },
  { key: "writePreconditions", title: "Preconditions that silently discard a write", entries: WRITE_PRECONDITIONS },
] as const;
