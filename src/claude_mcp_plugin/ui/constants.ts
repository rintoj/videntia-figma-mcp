export const ALLOWED_COMMANDS = new Set([
  "get_document_info","get_file_key","get_selection","get_node_info","get_nodes_info","search_nodes",
  "create_rectangle","create_frame","create_text","set_fill_color","set_stroke_color",
  "set_image_fill","set_gradient_fill","move_node","resize_node","delete_node",
  "delete_multiple_nodes","clone_node","rename_node","insert_child","group_nodes",
  "ungroup_nodes","flatten_node","export_node_as_image","set_corner_radius",
  "get_styles","get_local_components","get_remote_components","create_component_instance",
  "detach_instance","create_component","create_component_set","add_component_property",
  "edit_component_property","delete_component_property","set_component_property_references",
  "get_component_properties","set_text_content","set_multiple_text_contents",
  "set_auto_layout","set_font_name","set_font_size","set_font_weight","set_letter_spacing",
  "set_line_height","set_paragraph_spacing","set_text_case","set_text_decoration",
  "get_styled_text_segments","load_font_async","create_text_style","create_text_style_from_properties",
  "apply_text_style","get_text_styles","delete_text_style","update_text_style",
  "set_effects","set_effect_style_id","create_effect_style","update_effect_style",
  "delete_effect_style","create_ellipse","create_polygon","create_star","create_svg",
  "update_icon","create_vector","create_line","get_variables","get_bound_variables","scan_bound_variables",
  "bind_variable","unbind_variable","get_variable_collections","create_variable_collection",
  "get_collection_info","rename_variable_collection","delete_variable_collection",
  "create_variable","create_variables_batch","update_variable_value","rename_variable",
  "delete_variable","delete_variables_batch","audit_collection","validate_color_contrast",
  "suggest_missing_variables","apply_default_theme","create_color_scale_set",
  "apply_custom_palette","reorder_variables","generate_audit_report","export_collection_schema",
  "import_collection_schema","create_all_scales","fix_collection_to_standard","add_chart_colors",
  "add_mode_to_collection","rename_mode","delete_mode","duplicate_mode_values",
  "create_spacing_system","create_typography_system","create_radius_system","set_layout_mode",
  "set_padding","set_item_spacing","set_axis_align","set_layout_sizing","set_focus",
  "set_selections","scan_nodes_by_types","get_annotations","set_annotation",
  "set_multiple_annotations","get_annotation_categories","create_annotation_category",
  "update_annotation_category","delete_annotation_category","get_reactions",
  "set_default_connector","create_connections","create_page","rename_page","delete_page",
  "create_from_data","get_design_system","setup_design_system","batch_actions","lint_frame",
  "get_instance_overrides","set_instance_overrides","save_version_history",
  "undo","commit_undo",
  "create_color_style","get_color_styles","get_color_style",
  "update_color_style","delete_color_style","set_color_style_id",
  "set_component_property","swap_instance","export_image_fill"
])

export const MIN_PROGRESS_DISPLAY_MS = 600
export const RECONNECT_BASE_DELAY = 1000
export const RECONNECT_MAX_DELAY = 30000

export interface ServerOption {
  label: string
  host: string
  defaultSecure: boolean
  showPort: boolean
}

export const SERVER_OPTIONS: ServerOption[] = [
  { label: 'localhost', host: 'localhost', defaultSecure: false, showPort: true },
  { label: 'figma-mcp.videntia.dev', host: 'figma-mcp.videntia.dev', defaultSecure: true, showPort: false },
]
