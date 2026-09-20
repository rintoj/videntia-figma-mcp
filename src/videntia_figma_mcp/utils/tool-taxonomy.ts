/**
 * Tool taxonomy: categories, tool -> category map, and a recall-oriented synonym map.
 *
 * Pure data + pure functions. MUST NOT import from any tool module (would create an
 * import cycle with the registry). The unit test at
 * `tests/unit/utils/tool-taxonomy.test.ts` scans `src/videntia_figma_mcp/tools/*.ts`
 * for `server.tool("<name>"` and asserts every registered tool is categorised here,
 * and every synonym target is a real tool — so this file fails loudly instead of
 * silently rotting when a tool is added.
 *
 * Intended consumption by `find_figma_tools`:
 *
 *   import { matchTools, TOOL_CATEGORY_MAP, TOOL_SYNONYMS } from "../utils/tool-taxonomy.js";
 *
 *   const ranked = matchTools(query, {
 *     categoryMap: TOOL_CATEGORY_MAP,
 *     synonyms: TOOL_SYNONYMS,
 *     toolNames: allRegisteredToolNames,      // string[]
 *     descriptions: toolNameToDescription,    // Record<string, string> (optional)
 *     limit: 15,                              // optional, default 15
 *   });
 *   // => [{ name, score, category, reasons }, ...] ranked best-first
 */

export type ToolCategory =
  | "session"
  | "discovery"
  | "read"
  | "create"
  | "modify"
  | "layout"
  | "text"
  | "tokens"
  | "components"
  | "icons"
  | "effects"
  | "export"
  | "lint"
  | "verify"
  | "prototype"
  | "motion"
  | "document"
  | "browser"
  | "compute"
  | "composite";

export interface CategoryInfo {
  id: ToolCategory;
  description: string;
}

/** The category list. Derived from the actual registered tool surface. */
export const TOOL_CATEGORIES: readonly CategoryInfo[] = [
  { id: "discovery", description: "Meta-tools for finding, describing and loading the rest of the tool surface." },
  { id: "session", description: "Connect to Figma, channels, capabilities, undo/version history." },
  { id: "read", description: "Inspect the document: selection, node info, search, scans, summaries." },
  { id: "create", description: "Create new nodes: frames, rectangles, text, SVGs, groups, sections." },
  { id: "modify", description: "Change existing nodes: fills, strokes, position, size, rename, delete, opacity." },
  { id: "layout", description: "Auto layout, padding, gap, alignment, sizing, grid tracks, clipping." },
  { id: "text", description: "Text content and typography: font, size, weight, spacing, align, case, decoration." },
  { id: "tokens", description: "Design tokens: variables, collections, modes, color/text styles, theme systems." },
  { id: "components", description: "Components, component sets, instances, overrides and component properties." },
  { id: "icons", description: "Icon search, retrieval, creation and updating." },
  { id: "effects", description: "Shadows, blurs and effect styles." },
  { id: "export", description: "Render/export nodes, frames and image fills to files." },
  { id: "lint", description: "Automated design-quality linting of frames." },
  { id: "verify", description: "Assertions and checks: overlaps, contrast, unbound values, token collisions, diffs." },
  { id: "prototype", description: "Prototype links, reactions, flows, transitions and connectors." },
  {
    id: "motion",
    description:
      "Figma Motion: timelines, keyframe tracks and animation styles. A separate system from prototyping — Motion animates a node's properties along a timeline, prototyping navigates between frames.",
  },
  { id: "document", description: "Pages, sections, annotations, comments and frame documentation." },
  {
    id: "browser",
    description: "Chrome control over the browser transport (navigation, input, DOM, network). Not batchable.",
  },
  { id: "compute", description: "Pure server-side computation: color math, scales, conversions, contrast ratios." },
  { id: "composite", description: "One-call composites that replace multi-call sequences. Prefer these first." },
] as const;

export interface ToolCategoryEntry {
  category: ToolCategory;
  secondary?: ToolCategory[];
}

/** tool name -> primary category (+ optional secondary categories). */
export const TOOL_CATEGORY_MAP: Record<string, ToolCategoryEntry> = {
  // --- discovery (progressive tool disclosure meta-tools) ---
  find_figma_tools: { category: "discovery" },
  describe_figma_tools: { category: "discovery" },
  load_figma_tools: { category: "discovery" },
  figma_call: { category: "discovery" },

  // --- session ---
  figma_connect: { category: "session" },
  join_channel: { category: "session" },
  get_open_channels: { category: "session" },
  get_capabilities: { category: "session" },
  set_strict_mode: { category: "session" },
  undo: { category: "session" },
  commit_undo: { category: "session" },
  save_version_history: { category: "session" },

  // --- composite (highly discoverable: replace multi-call sequences) ---
  batch_actions: { category: "composite" },
  create_autolayout_frame: { category: "composite", secondary: ["create", "layout"] },
  create_styled_text: { category: "composite", secondary: ["create", "text"] },
  set_gap: { category: "composite", secondary: ["layout"] },
  create_card: { category: "composite", secondary: ["create", "layout"] },
  bulk_bind_variables: { category: "composite", secondary: ["tokens"] },
  clone_and_place: { category: "composite", secondary: ["create", "modify"] },
  apply_role_preset: { category: "composite", secondary: ["tokens", "modify"] },
  bind_many: { category: "composite", secondary: ["tokens"] },
  create_texts: { category: "composite", secondary: ["create", "text"] },
  create_svgs: { category: "composite", secondary: ["create"] },
  insert_children: { category: "composite", secondary: ["layout", "modify"] },
  move_nodes: { category: "composite", secondary: ["modify", "layout"] },

  // --- read ---
  get_document_info: { category: "read" },
  get_selection: { category: "read" },
  set_focus: { category: "read", secondary: ["modify"] },
  set_selections: { category: "read", secondary: ["modify"] },
  get_node_info: { category: "read" },
  get_nodes_info: { category: "read" },
  get_node_summary: { category: "read" },
  measure_node: { category: "read", secondary: ["layout"] },
  search_nodes: { category: "read" },
  scan_nodes_by_types: { category: "read" },
  get_styles: { category: "read", secondary: ["tokens"] },
  get_local_components: { category: "read", secondary: ["components"] },
  get_design_system: { category: "read", secondary: ["tokens"] },
  get_design_knowledge: { category: "read" },
  get_content_tree: { category: "read", secondary: ["document"] },

  // --- create ---
  create_rectangle: { category: "create" },
  create_frame: { category: "create", secondary: ["layout"] },
  create_text: { category: "create", secondary: ["text"] },
  create_svg: { category: "create" },
  create_section: { category: "create", secondary: ["document"] },
  group_nodes: { category: "create", secondary: ["layout"] },
  ungroup_nodes: { category: "create", secondary: ["layout"] },
  clone_node: { category: "create", secondary: ["modify"] },
  flatten_node: { category: "create", secondary: ["modify"] },
  insert_child: { category: "create", secondary: ["layout", "modify"] },

  // --- modify ---
  set_fill_color: { category: "modify" },
  set_stroke_color: { category: "modify" },
  remove_fill: { category: "modify" },
  remove_stroke: { category: "modify" },
  set_gradient_fill: { category: "modify" },
  set_image_fill: { category: "modify" },
  set_image_fill_from_path: { category: "modify" },
  set_opacity: { category: "modify" },
  set_corner_radius: { category: "modify" },
  move_node: { category: "modify", secondary: ["layout"] },
  move_node_absolute: { category: "modify", secondary: ["layout"] },
  resize_node: { category: "modify", secondary: ["layout"] },
  rename_node: { category: "modify" },
  delete_node: { category: "modify" },
  delete_multiple_nodes: { category: "modify" },

  // --- layout ---
  set_layout_mode: { category: "layout" },
  set_auto_layout: { category: "layout" },
  set_padding: { category: "layout" },
  set_item_spacing: { category: "layout" },
  set_axis_align: { category: "layout" },
  set_layout_sizing: { category: "layout" },
  reorder_grid_tracks: { category: "layout" },
  set_clips_content: { category: "layout", secondary: ["modify"] },
  set_grid_child: { category: "layout" },
  set_constraints: { category: "layout", secondary: ["modify"] },
  set_visible: { category: "modify" },

  // --- text ---
  set_text_content: { category: "text" },
  set_multiple_text_contents: { category: "text" },
  set_font_name: { category: "text" },
  set_font_size: { category: "text" },
  set_font_weight: { category: "text" },
  set_letter_spacing: { category: "text" },
  set_line_height: { category: "text" },
  set_paragraph_spacing: { category: "text" },
  set_text_case: { category: "text" },
  set_text_align: { category: "text", secondary: ["layout"] },
  set_text_range_style: { category: "text" },
  set_text_wrap_style: { category: "text" },
  set_text_decoration: { category: "text" },
  get_styled_text_segments: { category: "text", secondary: ["read"] },
  load_font_async: { category: "text" },
  create_text_style: { category: "text", secondary: ["tokens"] },
  create_text_style_from_properties: { category: "text", secondary: ["tokens"] },
  apply_text_style: { category: "text", secondary: ["tokens"] },
  get_text_styles: { category: "text", secondary: ["tokens", "read"] },
  update_text_style: { category: "text", secondary: ["tokens"] },
  delete_text_style: { category: "text", secondary: ["tokens"] },

  // --- tokens ---
  get_variable_collections: { category: "tokens", secondary: ["read"] },
  create_variable_collection: { category: "tokens" },
  create_variable_collection_extension: { category: "tokens" },
  get_collection_info: { category: "tokens", secondary: ["read"] },
  rename_variable_collection: { category: "tokens" },
  delete_variable_collection: { category: "tokens" },
  create_variable: { category: "tokens" },
  create_variables_batch: { category: "tokens" },
  update_variable_value: { category: "tokens" },
  rename_variable: { category: "tokens" },
  delete_variable: { category: "tokens" },
  delete_variables_batch: { category: "tokens" },
  get_variables: { category: "tokens", secondary: ["read"] },
  get_bound_variables: { category: "tokens", secondary: ["read"] },
  scan_bound_variables: { category: "tokens", secondary: ["read"] },
  bind_variable: { category: "tokens", secondary: ["modify"] },
  unbind_variable: { category: "tokens", secondary: ["modify"] },
  audit_collection: { category: "tokens", secondary: ["verify"] },
  validate_color_contrast: { category: "tokens", secondary: ["verify"] },
  get_schema_definition: { category: "tokens", secondary: ["read"] },
  suggest_missing_variables: { category: "tokens" },
  apply_default_theme: { category: "tokens" },
  create_color_scale_set: { category: "tokens" },
  apply_custom_palette: { category: "tokens" },
  reorder_variables: { category: "tokens" },
  generate_audit_report: { category: "tokens", secondary: ["verify"] },
  export_collection_schema: { category: "tokens", secondary: ["export"] },
  import_collection_schema: { category: "tokens" },
  create_all_scales: { category: "tokens" },
  fix_collection_to_standard: { category: "tokens" },
  add_chart_colors: { category: "tokens" },
  add_mode_to_collection: { category: "tokens" },
  rename_mode: { category: "tokens" },
  delete_mode: { category: "tokens" },
  duplicate_mode_values: { category: "tokens" },
  create_spacing_system: { category: "tokens" },
  create_typography_system: { category: "tokens", secondary: ["text"] },
  create_radius_system: { category: "tokens" },
  create_complete_design_system: { category: "tokens", secondary: ["composite"] },
  setup_design_system: { category: "tokens", secondary: ["composite"] },
  create_color_style: { category: "tokens" },
  get_color_styles: { category: "tokens", secondary: ["read"] },
  get_color_style: { category: "tokens", secondary: ["read"] },
  update_color_style: { category: "tokens" },
  delete_color_style: { category: "tokens" },
  set_color_style_id: { category: "tokens", secondary: ["modify"] },

  // --- components ---
  create_component: { category: "components", secondary: ["create"] },
  create_component_set: { category: "components", secondary: ["create"] },
  create_component_instance: { category: "components", secondary: ["create"] },
  detach_instance: { category: "components" },
  swap_instance: { category: "components" },
  get_instance_overrides: { category: "components", secondary: ["read"] },
  set_instance_overrides: { category: "components" },
  add_component_property: { category: "components" },
  create_slot: { category: "components", secondary: ["create"] },
  reset_slot: { category: "components" },
  get_slot_info: { category: "components", secondary: ["read"] },
  edit_component_property: { category: "components" },
  delete_component_property: { category: "components" },
  set_component_property: { category: "components" },
  set_component_property_references: { category: "components" },
  get_component_properties: { category: "components", secondary: ["read"] },

  // --- icons ---
  search_icon: { category: "icons" },
  get_icon: { category: "icons" },
  list_icons: { category: "icons" },
  create_icon: { category: "icons", secondary: ["create"] },
  update_icon: { category: "icons" },

  // --- effects ---
  set_effects: { category: "effects", secondary: ["modify"] },
  set_effect_style_id: { category: "effects", secondary: ["tokens"] },
  create_effect_style: { category: "effects", secondary: ["tokens"] },
  update_effect_style: { category: "effects", secondary: ["tokens"] },
  delete_effect_style: { category: "effects", secondary: ["tokens"] },

  // --- export ---
  export_node_as_image: { category: "export" },
  export_image_fill: { category: "export" },
  bulk_export_frames: { category: "export", secondary: ["document"] },

  // --- lint ---
  lint_frame: { category: "lint", secondary: ["verify"] },
  set_lint_ignore: { category: "lint" },

  // --- verify ---
  contrast_check_frame: { category: "verify" },
  find_overlaps: { category: "verify" },
  assert_node_state: { category: "verify" },
  find_unbound: { category: "verify", secondary: ["tokens"] },
  check_token_collisions: { category: "verify", secondary: ["tokens"] },
  compare_figma_to_component: { category: "verify", secondary: ["browser"] },
  diff_figma_to_browser: { category: "verify", secondary: ["browser"] },
  diff_figma_frame_to_page: { category: "verify", secondary: ["browser"] },

  // --- prototype ---
  get_reactions: { category: "prototype", secondary: ["read"] },
  set_default_connector: { category: "prototype" },
  add_prototype_link: { category: "prototype" },
  remove_prototype_link: { category: "prototype" },
  set_reactions: { category: "prototype" },

  // --- motion (Figma Motion timelines / keyframes) ---
  get_motion_info: { category: "motion", secondary: ["read"] },
  list_animation_styles: { category: "motion", secondary: ["read"] },
  apply_animation_style: { category: "motion" },
  remove_animation_style: { category: "motion" },
  set_keyframe_track: { category: "motion" },
  remove_keyframe_track: { category: "motion" },
  set_timeline_duration: { category: "motion" },
  animate_node: { category: "motion", secondary: ["composite"] },
  create_connections: { category: "prototype" },
  map_prototype_flows: { category: "prototype", secondary: ["document"] },
  get_frame_animations: { category: "prototype", secondary: ["document"] },

  // --- document ---
  create_page: { category: "document" },
  rename_page: { category: "document" },
  delete_page: { category: "document" },
  set_page_background: { category: "document", secondary: ["modify"] },
  set_section_status: { category: "document" },
  get_annotations: { category: "document" },
  set_annotation: { category: "document" },
  set_multiple_annotations: { category: "document" },
  get_annotation_categories: { category: "document" },
  create_annotation_category: { category: "document" },
  update_annotation_category: { category: "document" },
  delete_annotation_category: { category: "document" },
  get_comments: { category: "document" },
  enumerate_all_frames: { category: "document", secondary: ["read"] },
  get_frame_documentation: { category: "document", secondary: ["read"] },

  // --- compute (pure server-side, no Figma round trip) ---
  calculate_color_scale: { category: "compute", secondary: ["tokens"] },
  calculate_composite_color: { category: "compute", secondary: ["tokens"] },
  convert_color_format: { category: "compute" },
  calculate_contrast_ratio: { category: "compute", secondary: ["verify"] },
  calculate_contrast_ratios: { category: "compute", secondary: ["verify"] },

  // --- browser (separate transport; NOT batchable) ---
  list_connected_browsers: { category: "browser" },
  browser_click: { category: "browser" },
  browser_hover: { category: "browser" },
  browser_type: { category: "browser" },
  browser_press_key: { category: "browser" },
  browser_scroll: { category: "browser" },
  browser_navigate: { category: "browser" },
  browser_back: { category: "browser" },
  browser_forward: { category: "browser" },
  browser_list_tabs: { category: "browser" },
  browser_create_tab: { category: "browser" },
  browser_close_group: { category: "browser" },
  browser_close_tab: { category: "browser" },
  browser_evaluate_js: { category: "browser" },
  browser_read_console: { category: "browser" },
  browser_read_network: { category: "browser" },
  browser_snapshot: { category: "browser" },
  browser_highlight_node: { category: "browser" },
  browser_clear_highlight: { category: "browser" },
  browser_intercept_start: { category: "browser" },
  browser_intercept_stop: { category: "browser" },
  browser_list_pending_requests: { category: "browser" },
  browser_fulfill_request: { category: "browser" },
  browser_fail_request: { category: "browser" },
  browser_continue_request: { category: "browser" },
  browser_clear_storage: { category: "browser" },
  browser_capture_mhtml: { category: "browser" },
  browser_emulate: { category: "browser" },
  browser_clear_emulation: { category: "browser" },
  get_browser_page_info: { category: "browser" },
  get_browser_page_screenshot: { category: "browser", secondary: ["export"] },
  get_browser_dom_nodes: { category: "browser" },
  get_browser_computed_styles: { category: "browser" },
  overlay_figma_selection_in_browser: { category: "browser" },
  set_browser_viewport: { category: "browser" },
  reset_browser_viewport: { category: "browser" },
  clear_browser_overlay: { category: "browser" },
};

/**
 * Recall map: natural task phrasing -> tools that satisfy it.
 * Keys are lowercase phrases (single words or multi-word). This is the layer that
 * makes `find_figma_tools("center text")` work when the tool name shares no token
 * with the query.
 */
export const TOOL_SYNONYMS: Record<string, string[]> = {
  // component slots
  slot: ["create_slot", "get_slot_info", "reset_slot", "add_component_property"],
  slots: ["create_slot", "get_slot_info", "reset_slot"],
  // text alignment / typography
  center: ["set_text_align", "set_axis_align"],
  "center text": ["set_text_align"],
  align: ["set_text_align", "set_axis_align"],
  "align text": ["set_text_align"],
  justify: ["set_text_align"],
  "text alignment": ["set_text_align"],
  font: ["set_font_name", "set_font_size", "load_font_async"],
  typeface: ["set_font_name"],
  "font family": ["set_font_name"],
  weight: ["set_font_weight"],
  bold: ["set_font_weight"],
  "font size": ["set_font_size"],
  "text size": ["set_font_size"],
  leading: ["set_line_height"],
  "line height": ["set_line_height"],
  tracking: ["set_letter_spacing"],
  "letter spacing": ["set_letter_spacing"],
  kerning: ["set_letter_spacing"],
  uppercase: ["set_text_case"],
  lowercase: ["set_text_case"],
  capitalize: ["set_text_case"],
  underline: ["set_text_decoration"],
  strikethrough: ["set_text_decoration"],
  truncate: ["set_text_wrap_style"],
  wrap: ["set_text_wrap_style"],
  label: ["set_text_content", "create_text"],
  copy: ["set_text_content", "set_multiple_text_contents"],
  "change text": ["set_text_content", "set_multiple_text_contents"],
  typography: ["create_typography_system", "create_text_style", "apply_text_style"],

  // effects
  shadow: ["set_effects", "create_effect_style", "set_effect_style_id"],
  "drop shadow": ["set_effects", "create_effect_style", "set_effect_style_id"],
  "box shadow": ["set_effects", "create_effect_style"],
  elevation: ["set_effects", "create_effect_style", "set_effect_style_id"],
  blur: ["set_effects", "create_effect_style"],
  glow: ["set_effects"],
  effect: ["set_effects", "create_effect_style", "set_effect_style_id"],

  // tokens / variables
  token: ["create_variable", "bind_variable", "bind_many", "get_variables"],
  "design token": ["create_variable", "bind_variable", "get_variable_collections"],
  "color token": ["create_variable", "create_color_scale_set", "bind_variable"],
  variable: ["create_variable", "get_variables", "bind_variable", "update_variable_value"],
  bind: ["bind_variable", "bind_many", "bulk_bind_variables"],
  unbind: ["unbind_variable"],
  theme: ["apply_default_theme", "create_complete_design_system", "get_design_system"],
  "dark mode": ["add_mode_to_collection", "duplicate_mode_values", "rename_mode"],
  mode: ["add_mode_to_collection", "rename_mode", "delete_mode", "duplicate_mode_values"],
  palette: ["apply_custom_palette", "create_color_scale_set", "create_all_scales"],
  "color scale": ["calculate_color_scale", "create_color_scale_set", "create_all_scales"],
  "design system": ["get_design_system", "setup_design_system", "create_complete_design_system"],
  style: ["create_color_style", "create_text_style", "create_effect_style", "get_styles"],
  hardcoded: ["find_unbound", "check_token_collisions"],

  // layout
  gap: ["set_gap", "set_item_spacing", "set_auto_layout"],
  spacing: ["set_gap", "set_item_spacing", "set_padding", "create_spacing_system"],
  padding: ["set_padding", "set_auto_layout"],
  "layout padding": ["set_padding", "set_auto_layout"],
  "inner spacing": ["set_padding", "set_item_spacing"],
  margin: ["set_padding", "set_item_spacing"],
  "auto layout": ["create_autolayout_frame", "set_auto_layout", "set_layout_mode"],
  autolayout: ["create_autolayout_frame", "set_auto_layout", "set_layout_mode"],
  flex: ["set_auto_layout", "set_layout_mode", "create_autolayout_frame"],
  stack: ["set_layout_mode", "create_autolayout_frame"],
  "hug contents": ["set_layout_sizing"],
  fill: ["set_fill_color", "set_layout_sizing"],
  "fill container": ["set_layout_sizing"],
  resize: ["resize_node", "set_layout_sizing"],
  grid: ["reorder_grid_tracks", "set_layout_mode"],
  position: ["move_node", "move_node_absolute", "move_nodes"],
  reparent: ["insert_child", "insert_children"],

  // shape / appearance
  rounded: ["set_corner_radius", "create_radius_system"],
  round: ["set_corner_radius", "create_radius_system"],
  corner: ["set_corner_radius", "create_radius_system"],
  radius: ["set_corner_radius", "create_radius_system"],
  "border radius": ["set_corner_radius"],
  border: ["set_stroke_color", "remove_stroke"],
  stroke: ["set_stroke_color", "remove_stroke"],
  outline: ["set_stroke_color"],
  background: ["set_fill_color", "set_page_background"],
  color: ["set_fill_color", "set_stroke_color", "convert_color_format"],
  gradient: ["set_gradient_fill"],
  image: ["set_image_fill", "set_image_fill_from_path", "export_image_fill"],
  opacity: ["set_opacity"],
  transparency: ["set_opacity"],
  hex: ["convert_color_format"],
  rgb: ["convert_color_format"],

  // export / screenshot
  screenshot: ["export_node_as_image", "get_browser_page_screenshot"],
  render: ["export_node_as_image", "bulk_export_frames"],
  preview: ["export_node_as_image", "get_browser_page_screenshot"],
  png: ["export_node_as_image"],
  export: ["export_node_as_image", "bulk_export_frames", "export_image_fill"],
  "look at": ["export_node_as_image", "get_node_summary"],

  // accessibility / verification
  contrast: ["calculate_contrast_ratio", "validate_color_contrast", "contrast_check_frame"],
  a11y: ["contrast_check_frame", "validate_color_contrast", "lint_frame"],
  accessibility: ["contrast_check_frame", "validate_color_contrast"],
  wcag: ["calculate_contrast_ratio", "validate_color_contrast", "contrast_check_frame"],
  readable: ["contrast_check_frame", "validate_color_contrast"],
  lint: ["lint_frame", "find_overlaps", "find_unbound"],
  audit: ["audit_collection", "generate_audit_report", "lint_frame"],
  overlap: ["find_overlaps"],
  assert: ["assert_node_state"],
  diff: ["diff_figma_to_browser", "diff_figma_frame_to_page", "compare_figma_to_component"],
  compare: ["compare_figma_to_component", "diff_figma_frame_to_page"],

  // structure / discovery
  find: ["search_nodes", "scan_nodes_by_types", "get_content_tree"],
  search: ["search_nodes", "search_icon", "scan_nodes_by_types"],
  inspect: ["get_node_info", "get_node_summary", "get_nodes_info"],
  tree: ["get_content_tree", "get_node_summary"],
  selection: ["get_selection", "set_selections", "set_focus"],
  measure: ["measure_node"],
  duplicate: ["clone_node", "clone_and_place"],
  delete: ["delete_node", "delete_multiple_nodes"],
  rename: ["rename_node", "rename_variable", "rename_page"],
  group: ["group_nodes", "ungroup_nodes"],
  card: ["create_card"],
  button: ["create_card", "apply_role_preset", "create_component"],
  page: ["create_page", "rename_page", "delete_page"],
  section: ["create_section", "set_section_status"],
  comment: ["get_comments"],
  annotation: ["set_annotation", "get_annotations", "set_multiple_annotations"],

  // components
  component: ["create_component", "create_component_set", "get_local_components"],
  instance: ["create_component_instance", "swap_instance", "detach_instance"],
  variant: ["create_component_set", "set_component_property"],
  override: ["get_instance_overrides", "set_instance_overrides"],
  prop: ["add_component_property", "set_component_property", "get_component_properties"],

  // icons
  icon: ["search_icon", "create_icon", "list_icons", "get_icon"],
  svg: ["create_svg", "create_svgs", "create_icon"],
  glyph: ["search_icon", "get_icon"],

  // prototype
  prototype: ["add_prototype_link", "map_prototype_flows", "get_reactions"],
  interaction: ["add_prototype_link", "get_reactions", "set_reactions"],
  animation: ["animate_node", "get_motion_info", "get_frame_animations"],
  motion: ["animate_node", "get_motion_info", "set_keyframe_track"],
  keyframe: ["set_keyframe_track", "get_motion_info", "remove_keyframe_track"],
  timeline: ["set_timeline_duration", "get_motion_info"],
  connector: ["set_default_connector", "create_connections"],
  transition: ["add_prototype_link", "get_frame_animations", "set_reactions"],
  easing: ["get_frame_animations", "add_prototype_link"],

  // browser
  browser: ["browser_navigate", "browser_click", "get_browser_page_info"],
  click: ["browser_click"],
  navigate: ["browser_navigate"],
  console: ["browser_read_console"],
  network: ["browser_read_network", "browser_intercept_start"],
  dom: ["get_browser_dom_nodes", "browser_snapshot"],
  "computed style": ["get_browser_computed_styles"],
  viewport: ["set_browser_viewport", "browser_emulate", "reset_browser_viewport"],
  responsive: ["browser_emulate", "set_browser_viewport"],

  // session
  connect: ["figma_connect", "join_channel", "get_open_channels"],
  channel: ["get_open_channels", "join_channel"],
  undo: ["undo", "commit_undo"],
  batch: ["batch_actions"],
  "what tools": ["find_figma_tools", "describe_figma_tools"],
  "tool search": ["find_figma_tools"],
  bulk: ["batch_actions", "create_texts", "bulk_bind_variables", "bulk_export_frames"],
};

// ---------------------------------------------------------------------------
// matchTools
// ---------------------------------------------------------------------------

export interface MatchToolsOptions {
  /** tool name -> category entry. Defaults to TOOL_CATEGORY_MAP. */
  categoryMap?: Record<string, ToolCategoryEntry>;
  /** synonym phrase -> tool names. Defaults to TOOL_SYNONYMS. */
  synonyms?: Record<string, string[]>;
  /** The authoritative list of registered tool names to rank. */
  toolNames: string[];
  /** Optional tool name -> description text. */
  descriptions?: Record<string, string>;
  /** Max results (default 15). */
  limit?: number;
}

export interface ToolMatch {
  name: string;
  score: number;
  category?: ToolCategory;
  reasons: string[];
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "this",
  "that",
  "to",
  "of",
  "on",
  "in",
  "for",
  "with",
  "and",
  "or",
  "my",
  "me",
  "it",
  "is",
  "are",
  "be",
  "how",
  "do",
  "i",
  "can",
  "please",
  "some",
  "all",
  "at",
  "by",
  "from",
  "into",
]);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\-/]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Crude singularizer so "corners" matches the "corner" synonym key. */
function stem(t: string): string {
  if (t.length > 3 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith("es") && /(s|x|z|ch|sh)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

/**
 * Score a free-text query against tool names, descriptions, categories and synonyms.
 * Pure — no I/O. Returns ranked matches, best first.
 */
export function matchTools(query: string, options: MatchToolsOptions): ToolMatch[] {
  const categoryMap = options.categoryMap ?? TOOL_CATEGORY_MAP;
  const synonyms = options.synonyms ?? TOOL_SYNONYMS;
  const descriptions = options.descriptions ?? {};
  const limit = options.limit ?? 15;
  const known = new Set(options.toolNames);

  const normQuery = normalize(query);
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  const queryTokenSet = new Set(queryTokens);
  const queryStems = new Set(queryTokens.map(stem));

  const scores = new Map<string, number>();
  const reasons = new Map<string, string[]>();
  const bump = (name: string, amount: number, reason: string) => {
    if (!known.has(name)) return;
    scores.set(name, (scores.get(name) ?? 0) + amount);
    const list = reasons.get(name) ?? [];
    if (!list.includes(reason)) list.push(reason);
    reasons.set(name, list);
  };

  // 1. Synonym hits — the main recall driver.
  for (const [phrase, targets] of Object.entries(synonyms)) {
    const phraseTokens = phrase.split(" ");
    let hit = 0;
    if (phraseTokens.length > 1) {
      if (normQuery.includes(phrase)) hit = 30 + phraseTokens.length * 6;
    } else if (queryTokenSet.has(phrase)) {
      hit = 20;
    } else if (queryStems.has(stem(phrase))) {
      hit = 16;
    }
    if (!hit) continue;
    targets.forEach((t, i) => bump(t, hit - i * 3, `synonym:${phrase}`));
  }

  // 2. Name matching.
  for (const name of options.toolNames) {
    const nameNorm = normalize(name);
    const nameTokens = new Set(tokenize(name));
    if (nameNorm === normQuery) {
      bump(name, 100, "exact name");
      continue;
    }
    if (normQuery.includes(nameNorm)) bump(name, 55, "name in query");
    let overlap = 0;
    for (const t of queryTokenSet) if (nameTokens.has(t)) overlap++;
    if (overlap > 0) {
      const coverage = overlap / nameTokens.size;
      bump(name, overlap * 10 + coverage * 12, `name tokens (${overlap})`);
    }
  }

  // 3. Category name mentioned directly.
  for (const cat of TOOL_CATEGORIES) {
    if (!queryTokenSet.has(cat.id)) continue;
    for (const name of options.toolNames) {
      const entry = categoryMap[name];
      if (!entry) continue;
      if (entry.category === cat.id) bump(name, 6, `category:${cat.id}`);
      else if (entry.secondary?.includes(cat.id)) bump(name, 3, `category:${cat.id}`);
    }
  }

  // 4. Description tokens (weak signal, breaks ties).
  for (const name of options.toolNames) {
    const desc = descriptions[name];
    if (!desc) continue;
    const descTokens = new Set(tokenize(desc));
    let overlap = 0;
    for (const t of queryTokenSet) if (descTokens.has(t)) overlap++;
    if (overlap > 0) bump(name, Math.min(overlap * 2.5, 12), `description (${overlap})`);
  }

  // 5. Composites are preferred when they are already in play.
  for (const [name, score] of scores) {
    if (score > 0 && categoryMap[name]?.category === "composite") {
      scores.set(name, score + 4);
    }
  }

  return [...scores.entries()]
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, score]) => ({
      name,
      score: Math.round(score * 100) / 100,
      category: categoryMap[name]?.category,
      reasons: reasons.get(name) ?? [],
    }));
}

/** All tool names known to the taxonomy. */
export function taxonomyToolNames(): string[] {
  return Object.keys(TOOL_CATEGORY_MAP);
}

/** Tools in a category (primary, plus secondary when `includeSecondary`). */
export function toolsInCategory(category: ToolCategory, includeSecondary = false): string[] {
  return Object.entries(TOOL_CATEGORY_MAP)
    .filter(([, e]) => e.category === category || (includeSecondary && e.secondary?.includes(category)))
    .map(([name]) => name)
    .sort();
}
