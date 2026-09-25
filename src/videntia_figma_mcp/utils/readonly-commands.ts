/**
 * Commands that never modify design data (Figma) or page state (browser).
 * Dependency-free so the plugin bundle can import it too.
 *
 * The plugin uses READONLY_COMMANDS to gate readonly mode; the server uses both sets
 * to decide which commands are safe to resend after a mid-flight connection drop.
 */
import type { BrowserCommand } from "../types";

// Plain strings: the plugin dispatches commands the FigmaCommand union does not list.
export const READONLY_COMMANDS: ReadonlySet<string> = new Set<string>([
  // Session-level toggle, not a design-data write.
  "set_strict_mode",
  "get_document_info",
  "get_file_key",
  "get_selection",
  "get_node_info",
  "get_nodes_info",
  "search_nodes",
  "get_color_style",
  "get_color_styles",
  "get_styles",
  "get_local_components",
  "get_remote_components",
  "get_component_properties",
  "get_slot_info",
  "get_instance_overrides",
  "get_styled_text_segments",
  "get_text_opentype_features",
  "get_text_styles",
  "get_variables",
  "get_bound_variables",
  "scan_bound_variables",
  "get_variable_collections",
  "get_collection_info",
  "audit_collection",
  "validate_color_contrast",
  "suggest_missing_variables",
  "generate_audit_report",
  "export_collection_schema",
  "scan_nodes_by_types",
  "get_annotations",
  "get_annotation_categories",
  "get_reactions",
  "get_frame_animations",
  "get_motion_info",
  "list_animation_styles",
  "get_design_system",
  "lint_frame",
  "contrast_check_frame",
  "find_overlaps",
  "assert_node_state",
  "find_unbound",
  "check_token_collisions",
  "set_focus",
  "set_selections",
  "export_node_as_image",
  "export_selection_as_image",
  "export_image_fill",
  "load_font_async",
  "enumerate_all_frames",
  "map_prototype_flows",
  "bulk_export_frames",
  "get_content_tree",
  "get_frame_documentation",
  "get_comments",
]);

export const BROWSER_READONLY_COMMANDS: ReadonlySet<BrowserCommand> = new Set<BrowserCommand>([
  "get_dom_nodes",
  "get_computed_styles",
  "get_computed_styles_batch",
  "get_page_screenshot",
  "get_page_info",
  "resolve_selector_at_point",
  "collect_all_element_rects",
  "list_tabs",
  "read_console",
  "read_network",
  "get_ax_tree",
  "list_pending_requests",
  "capture_mhtml",
]);
