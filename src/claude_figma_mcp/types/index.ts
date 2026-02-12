// Define TypeScript interfaces for Figma responses
export interface FigmaResponse {
  id: string;
  result?: any;
  error?: string;
}

// Define interface for command progress updates
export interface CommandProgressUpdate {
  type: 'command_progress';
  commandId: string;
  commandType: string;
  status: 'started' | 'in_progress' | 'completed' | 'error';
  progress: number;
  totalItems: number;
  processedItems: number;
  currentChunk?: number;
  totalChunks?: number;
  chunkSize?: number;
  message: string;
  payload?: any;
  timestamp: number;
}

// Define TypeScript interfaces for tracking WebSocket requests
export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
  lastActivity: number;
}

// Define WebSocket message structures
export interface ProgressMessage {
  message: FigmaResponse | any;
  type?: string;
  id?: string;
  [key: string]: any; // Allow any other properties
}

// Define possible command types for Figma
export type FigmaCommand =
  | "get_document_info"
  | "get_file_key"
  | "get_selection"
  | "get_node_info"
  | "read_my_design"
  | "set_focus"
  | "set_selections"
  | "create_rectangle"
  | "create_frame"
  | "create_text"
  | "create_ellipse"
  | "create_polygon"
  | "create_star"
  | "create_svg"
  | "create_vector"
  | "create_line"
  | "set_fill_color"
  | "set_stroke_color"
  | "set_image_fill"
  | "move_node"
  | "resize_node"
  | "delete_node"
  | "delete_multiple_nodes"
  | "get_styles"
  | "get_local_components"
  | "get_team_components"
  | "create_component_instance"
  | "export_node_as_image"
  | "join"
  | "set_corner_radius"
  | "clone_node"
  | "set_text_content"
  | "scan_text_nodes"
  | "set_multiple_text_contents"
  | "set_auto_layout"
  | "set_layout_mode"
  | "set_padding"
  | "set_axis_align"
  | "set_layout_sizing"
  | "set_item_spacing"
  | "set_font_name"
  | "set_font_size"
  | "set_font_weight"
  | "set_letter_spacing"
  | "set_line_height"
  | "set_paragraph_spacing"
  | "set_text_case"
  | "set_text_decoration"
  | "get_styled_text_segments"
  | "load_font_async"
  | "create_text_style"
  | "create_text_style_from_properties"
  | "apply_text_style"
  | "get_text_styles"
  | "delete_text_style"
  | "update_text_style"
  | "get_remote_components"
  | "set_effects"
  | "set_effect_style_id"
  | "group_nodes"
  | "ungroup_nodes"
  | "flatten_node"
  | "insert_child"
  | "get_variables"
  | "get_bound_variables"
  | "bind_variable"
  | "unbind_variable"
  | "detach_instance"
  | "create_component"
  | "create_component_set"
  | "add_component_property"
  | "edit_component_property"
  | "delete_component_property"
  | "set_component_property_references"
  | "get_component_properties"
  | "rename_node"
  | "get_annotations"
  | "set_annotation"
  | "set_multiple_annotations"
  | "get_annotation_categories"
  | "create_annotation_category"
  | "update_annotation_category"
  | "delete_annotation_category"
  | "scan_nodes_by_types"
  | "get_reactions"
  | "set_default_connector"
  | "create_connections"
  | "get_instance_overrides"
  | "set_instance_overrides"
  | "get_variable_collections"
  | "create_variable_collection"
  | "get_collection_info"
  | "rename_variable_collection"
  | "delete_variable_collection"
  | "create_variable"
  | "create_variables_batch"
  | "update_variable_value"
  | "rename_variable"
  | "delete_variable"
  | "delete_variables_batch"
  | "audit_collection"
  | "validate_color_contrast"
  | "suggest_missing_variables"
  | "apply_default_theme"
  | "create_color_scale_set"
  | "apply_custom_palette"
  | "reorder_variables"
  | "generate_audit_report"
  | "export_collection_schema"
  | "import_collection_schema"
  | "create_all_scales"
  | "fix_collection_to_standard"
  | "add_chart_colors"
  | "add_mode_to_collection"
  | "rename_mode"
  | "delete_mode"
  | "duplicate_mode_values"
  | "create_spacing_system"
  | "create_typography_system"
  | "create_radius_system"
  | "create_complete_design_system"
  | "batch_actions";

// Variable-related interfaces
export type VariableType = "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";

export interface VariableValue {
  modeId: string;
  value: any;
}

export interface Variable {
  id: string;
  name: string;
  key: string;
  type: VariableType;
  description?: string;
  collectionId?: string;
  values: VariableValue[];
}

export interface VariableCollection {
  id: string;
  name: string;
  variableIds: string[];
  modes: { id: string; name: string }[];
}

export interface VariableBinding {
  fieldName: string;
  variableId: string;
  variableName: string;
  variableType: VariableType;
}

export interface BoundVariablesResponse {
  nodeId: string;
  nodeName: string;
  bindings: VariableBinding[];
}

export interface VariablesResponse {
  variables: Variable[];
  collections: VariableCollection[];
}