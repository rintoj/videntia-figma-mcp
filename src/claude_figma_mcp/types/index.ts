// Define TypeScript interfaces for Figma responses
export interface FigmaResponse {
  id: string;
  result?: any;
  error?: string;
}

// Define interface for command progress updates
export interface CommandProgressUpdate {
  type: "command_progress";
  commandId: string;
  commandType: string;
  status: "started" | "in_progress" | "completed" | "error";
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
  | "create_svg"
  | "create_line"
  | "set_fill_color"
  | "set_stroke_color"
  | "set_image_fill"
  | "set_gradient_fill"
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
  | "create_effect_style"
  | "update_effect_style"
  | "delete_effect_style"
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
  | "create_page"
  | "rename_page"
  | "delete_page"
  | "create_from_data"
  | "batch_actions"
  | "lint_frame"
  | "get_design_system"
  | "setup_design_system"
  | "update_icon";

// Batch actions types
export interface BatchActionResult {
  index: number;
  action: string;
  success: boolean;
  result?: any;
  error?: string;
}

export interface BatchActionsResult {
  success: boolean;
  totalActions: number;
  succeeded: number;
  failed: number;
  results: BatchActionResult[];
}

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

// Figma node data returned by the enriched read_my_design plugin handler
export interface FigmaNodeFill {
  type: string;
  color?: string;
  opacity?: number;
  gradient?: {
    type: string;
    stops: Array<{ color: string; position: number }>;
    direction?: string;
  };
  isImage?: boolean;
  imageRef?: string;
}

export interface FigmaNodeStroke {
  type: string;
  color?: string;
  opacity?: number;
}

export interface FigmaNodeEffect {
  type: string;
  color?: string;
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
}

export interface FigmaNodeData {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  // Layout
  layoutMode?: "HORIZONTAL" | "VERTICAL" | "NONE";
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
  itemSpacing?: number;
  counterAxisSpacing?: number;
  layoutWrap?: "NO_WRAP" | "WRAP";
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  clipsContent?: boolean;
  layoutPositioning?: "AUTO" | "ABSOLUTE";
  // Fills
  fills?: FigmaNodeFill[];
  // Strokes
  strokes?: FigmaNodeStroke[];
  strokeWeight?: number;
  strokeTopWeight?: number;
  strokeBottomWeight?: number;
  strokeLeftWeight?: number;
  strokeRightWeight?: number;
  // Corners
  cornerRadius?: number;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomRightRadius?: number;
  bottomLeftRadius?: number;
  // Effects
  effects?: FigmaNodeEffect[];
  // Text
  characters?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  lineHeightUnit?: "percent";
  letterSpacing?: number;
  letterSpacingUnit?: "percent";
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";
  textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  textStyleName?: string;
  effectStyleName?: string;
  // Appearance
  opacity?: number;
  rotation?: number;
  // Variable bindings (resolved to names)
  bindings?: Record<string, string>;
  // Component metadata
  componentPropertyDefinitions?: Record<string, any>;
  variantProperties?: Record<string, string>;
  componentSetName?: string;
  componentProperties?: Record<string, any>;
  mainComponentName?: string;
  // SVG
  svgString?: string;
  // Children
  children?: FigmaNodeData[];
}

export interface ReadMyDesignResult {
  selectionCount: number;
  selection: FigmaNodeData[];
}

// ── Result interfaces for sendCommandToFigma<T> typed calls ──

// Document tools
export interface DocumentInfoResult {
  id?: string;
  name?: string;
  currentPage?: string;
  pages?: Array<{ id: string; name: string; childCount?: number }>;
  selection?: Array<{ id: string; name: string; type: string }>;
}

export interface AnnotationsResult {
  annotations?: Array<{ id?: string; label?: string; description?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface SetAnnotationResult {
  success?: boolean;
  nodeId?: string;
  label?: string;
  [key: string]: unknown;
}

export interface AnnotationCategoriesResult {
  categories?: Array<{ id?: string; name?: string; color?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface CreateAnnotationCategoryResult {
  id?: string;
  name?: string;
  color?: string;
  [key: string]: unknown;
}

export interface UpdateAnnotationCategoryResult {
  id?: string;
  name?: string;
  color?: string;
  [key: string]: unknown;
}

export interface StylesResult {
  styles?: Array<{ id?: string; name?: string; type?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface RemoteComponentsResult {
  components?: Array<{ key?: string; name?: string; description?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface BoundVariablesResult {
  nodeId?: string;
  nodeName?: string;
  bindings?: VariableBinding[];
  [key: string]: unknown;
}

// Variable tools
export interface CreateVariableCollectionResult {
  collectionId?: string;
  id?: string;
  name?: string;
  defaultMode?: string;
}

export interface GetCollectionInfoResult {
  id?: string;
  name?: string;
  modes?: Array<{ modeId: string; name: string }>;
  variableIds?: string[];
  variableCount?: number;
  [key: string]: unknown;
}

export interface RenameVariableCollectionResult {
  success?: boolean;
  collectionId?: string;
  newName?: string;
}

export interface DeleteVariableCollectionResult {
  success?: boolean;
  collectionId?: string;
}

export interface CreateVariableResult {
  id?: string;
  name?: string;
  type?: string;
  collectionId?: string;
}

export interface CreateVariablesBatchResult {
  created?: number;
  variables?: Array<{ id?: string; name?: string; type?: string }>;
  errors?: Array<{ name?: string; error?: string }>;
}

export interface UpdateVariableValueResult {
  success?: boolean;
  variableId?: string;
  modeId?: string;
}

export interface RenameVariableResult {
  success?: boolean;
  variableId?: string;
  newName?: string;
}

export interface DeleteVariableResult {
  success?: boolean;
  variableId?: string;
}

export interface DeleteVariablesBatchResult {
  deleted?: number;
  errors?: Array<{ id?: string; error?: string }>;
}

export interface AuditCollectionResult {
  collectionName?: string;
  totalVariables?: number;
  missing?: Array<string | { name: string }>;
  extra?: Array<string | { name: string }>;
  typeMismatches?: Array<{ name?: string; expected?: string; actual?: string }>;
  compliant?: boolean;
  [key: string]: unknown;
}

export interface ValidateColorContrastResult {
  pairs?: Array<{
    foreground?: string;
    background?: string;
    ratio?: number;
    aa?: boolean;
    aaa?: boolean;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface SuggestMissingVariablesResult {
  suggestions?: Array<{ name?: string; type?: string; description?: string }>;
  [key: string]: unknown;
}

export interface ApplyDefaultThemeResult {
  created?: number;
  skipped?: number;
  errors?: Array<{ name?: string; error?: string }>;
  collectionId?: string;
  [key: string]: unknown;
}

export interface CreateColorScaleSetResult {
  created?: number;
  variables?: Array<{ name?: string; id?: string }>;
  [key: string]: unknown;
}

export interface ReorderVariablesResult {
  success?: boolean;
  reordered?: number;
  [key: string]: unknown;
}

export interface GenerateAuditReportResult {
  report?: string;
  [key: string]: unknown;
}

export interface ExportCollectionSchemaResult {
  schema?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ImportCollectionSchemaResult {
  created?: number;
  updated?: number;
  skipped?: number;
  errors?: Array<{ name?: string; error?: string }>;
  [key: string]: unknown;
}

export interface CreateAllScalesResult {
  created?: number;
  totalVariables?: number;
  scales?: Array<{ color?: string; count?: number }>;
  [key: string]: unknown;
}

export interface FixCollectionToStandardResult {
  added?: number;
  removed?: number;
  fixed?: number;
  [key: string]: unknown;
}

export interface AddChartColorsResult {
  created?: number;
  colors?: Array<{ name?: string; id?: string }>;
  [key: string]: unknown;
}

export interface AddModeResult {
  success?: boolean;
  modeId?: string;
  modeName?: string;
  collectionId?: string;
  [key: string]: unknown;
}

export interface RenameModeResult {
  success?: boolean;
  modeId?: string;
  newName?: string;
  [key: string]: unknown;
}

export interface DeleteModeResult {
  success?: boolean;
  modeId?: string;
  [key: string]: unknown;
}

export interface DuplicateModeValuesResult {
  success?: boolean;
  copied?: number;
  [key: string]: unknown;
}

export interface DesignSystemSubResult {
  collectionId?: string;
  created?: number;
  primitiveCount?: number;
  totalVariables?: number;
  [key: string]: unknown;
}

export interface DesignSystemCollectionResult {
  collectionId?: string;
  created?: number;
  [key: string]: unknown;
}

// Component tools
export interface CreateComponentInstanceResult {
  id?: string;
  name?: string;
  componentKey?: string;
  [key: string]: unknown;
}

export interface ReactionNode {
  nodeId: string;
  nodeName?: string;
  reactions: Array<{
    trigger?: { type?: string; [key: string]: unknown };
    action?: { type?: string; destinationId?: string; [key: string]: unknown };
    [key: string]: unknown;
  }>;
}

export interface GetReactionsResult {
  nodes?: ReactionNode[];
  reactions?: Array<{ trigger?: string; action?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface GetComponentPropertiesResult {
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

// Design system aggregation result
export interface DesignSystemVariable {
  id: string;
  name: string;
  description: string;
  resolvedType: string;
  collectionName: string;
  values: Array<{ modeId: string; modeName: string; value: unknown }>;
}

export interface DesignSystemTextStyle {
  id: string;
  name: string;
  fontSize: number;
  fontName: { family: string; style: string };
  lineHeight: unknown;
}

export interface DesignSystemEffect {
  type: string;
  visible: boolean;
  color?: { r: number; g: number; b: number; a: number };
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
}

export interface DesignSystemEffectStyle {
  id: string;
  name: string;
  description: string;
  effects: DesignSystemEffect[];
}

export interface DesignSystemPage {
  id: string;
  name: string;
}

export interface GetDesignSystemResult {
  pages: DesignSystemPage[];
  variables: DesignSystemVariable[];
  textStyles: DesignSystemTextStyle[];
  effectStyles: DesignSystemEffectStyle[];
}

// Setup design system result
export interface SetupDesignSystemCounters {
  created: number;
  updated: number;
  failed: number;
  errors?: Array<{ name: string; error: string }>;
}

export interface SetupDesignSystemResult {
  collections: Array<{ id: string; name: string }>;
  pages: DesignSystemPage[];
  variables: SetupDesignSystemCounters;
  textStyles: SetupDesignSystemCounters;
  effectStyles: SetupDesignSystemCounters;
}

// Modification tools
export interface DeleteMultipleNodesResult {
  deleted?: number;
  errors?: Array<{ id?: string; error?: string }>;
  [key: string]: unknown;
}

export interface CreateEffectStyleResult {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface UpdateEffectStyleResult {
  success?: boolean;
  id?: string;
  [key: string]: unknown;
}

// Lint frame result
export interface LintViolation {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  depth: number;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category: string;
  property: string;
  message: string;
  details?: Record<string, unknown>;
  /** Present when lint_frame was called with fix=true. True = auto-fixed, false = could not be auto-fixed. */
  fixed?: boolean;
}

export interface LintCategoryResult {
  total: number;
  bound: number;
  unbound: number;
  compliance: number;
}

export interface LintFrameResult {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  totalNodes: number;
  categories: {
    rootFrame: LintCategoryResult;
    typography: LintCategoryResult;
    spacing: LintCategoryResult;
    borderRadius: LintCategoryResult;
    iconColors: LintCategoryResult;
    strokesBorders: LintCategoryResult;
    backgroundFills: LintCategoryResult;
    effectStyles: LintCategoryResult;
    overflow: LintCategoryResult;
  };
  violations: LintViolation[];
  violationsCapped?: boolean;
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    compliance: number;
    /** Number of violations auto-fixed (only present when fix=true was passed). */
    fixed?: number;
  };
}
