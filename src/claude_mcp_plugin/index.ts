// Claude Figma MCP Plugin — Entry Point
// All handler modules are imported and wired to the handleCommand dispatch.

// Utils
import { debugLog } from './utils/helpers';

// Handlers — document & navigation
import { getFileKey, getDocumentInfo, searchNodes, saveVersionHistory, triggerUndo, commitUndoAction } from './handlers/document';
import { serializeNodes } from './handlers/node-serializer';
import { createPage, renamePage, deletePage } from './handlers/pages';
import { getReactions, setDefaultConnector, createConnections } from './handlers/prototyping';

// Handlers — node creation & modification
import {
  createRectangle,
  createFrame,
  moveNode,
  resizeNode,
  deleteNode,
  deleteMultipleNodes,
  exportNodeAsImage,
  setCornerRadius,
  cloneNode,
  groupNodes,
  ungroupNodes,
  flattenNode,
  renameNode,
  insertChild,
} from './handlers/nodes';

// Handlers — fills, strokes, shapes
import { setFillColor, setStrokeColor, setImageFill, setGradientFill } from './handlers/fills';
import { createEllipse, createPolygon, createStar, createSvg, createVector, createLine } from './handlers/shapes';
import { updateIcon } from './handlers/icons';

// Handlers — text
import {
  createText,
  setTextContent,
  setMultipleTextContents,
  setAutoLayout,
  setFontName,
  setFontSize,
  setFontWeight,
  setLetterSpacing,
  setLineHeight,
  setParagraphSpacing,
  setTextCase,
  setTextDecoration,
  getStyledTextSegments,
  loadFontAsyncWrapper,
  createTextStyle,
  createTextStyleFromProperties,
  applyTextStyle,
  getTextStyles,
  deleteTextStyle,
  updateTextStyle,
} from './handlers/text';

// Handlers — effects
import {
  setEffects,
  setEffectStyleId,
  createEffectStyle,
  updateEffectStyle,
  deleteEffectStyle,
} from './handlers/effects';

// Handlers — components & styles
import {
  getStyles,
  getLocalComponents,
  createComponentInstance,
  detachInstance,
  createComponent,
  createComponentSet,
  addComponentProperty,
  editComponentProperty,
  deleteComponentProperty,
  setComponentPropertyReferences,
  getComponentProperties,
  getInstanceOverrides,
  setInstanceOverrides,
} from './handlers/components';

// Handlers — variables
import {
  getVariables,
  getBoundVariables,
  bindVariable,
  unbindVariable,
  getVariableCollections,
  createVariableCollection,
  getCollectionInfo,
  renameVariableCollection,
  deleteVariableCollection,
  createVariable,
  createVariablesBatch,
  updateVariableValue,
  renameVariable,
  deleteVariable,
  deleteVariablesBatch,
  auditCollection,
  validateColorContrast,
  suggestMissingVariables,
  applyDefaultTheme,
  createColorScaleSet,
  applyCustomPalette,
  reorderVariables,
  generateAuditReport,
  exportCollectionSchema,
  importCollectionSchema,
  createAllScales,
  fixCollectionToStandard,
  addChartColors,
  addModeToCollection,
  renameMode,
  deleteMode,
  duplicateModeValues,
} from './handlers/variables';

// Handlers — layout
import {
  createSpacingSystem,
  createTypographySystem,
  createRadiusSystem,
  setLayoutMode,
  setPadding,
  setItemSpacing,
  setAxisAlign,
  setLayoutSizing,
} from './handlers/layout';

// Handlers — selection & focus
import { setFocus, setSelections, scanNodesByTypes, focusNode, softFocusNode } from './handlers/selection';

// Handlers — annotations
import {
  getAnnotations,
  setAnnotation,
  setMultipleAnnotations,
  getAnnotationCategories,
  createAnnotationCategory,
  updateAnnotationCategory,
  deleteAnnotationCategory,
} from './handlers/annotations';

// Handlers — design system
import { createFromData, getDesignSystem, setupDesignSystem } from './handlers/design-system';

// Handlers — lint
import { lintFrame } from './handlers/lint/index';

// Handlers — batch (injected with handleCommand to avoid circular import)
import { batchActions } from './handlers/batch';

// ---------------------------------------------------------------------------
// Plugin state
// ---------------------------------------------------------------------------

const state = {
  serverPort: 3055,
  readonlyMode: false,
  autoFocus: false,
  prefsExpanded: true,
  actionsExpanded: true,
};

// ---------------------------------------------------------------------------
// Readonly commands — these don't modify design data
// ---------------------------------------------------------------------------

var READONLY_COMMANDS = new Set([
  'get_document_info', 'get_file_key', 'get_selection', 'get_node_info', 'get_nodes_info', 'search_nodes',
  'get_styles', 'get_local_components', 'get_remote_components', 'get_component_properties',
  'get_instance_overrides', 'get_styled_text_segments', 'get_text_styles',
  'get_variables', 'get_bound_variables', 'get_variable_collections', 'get_collection_info',
  'audit_collection', 'validate_color_contrast', 'suggest_missing_variables',
  'generate_audit_report', 'export_collection_schema', 'get_schema_definition',
  'scan_nodes_by_types', 'get_annotations', 'get_annotation_categories',
  'get_reactions', 'get_design_system', 'lint_frame', 'set_focus', 'set_selections',
  'export_node_as_image', 'load_font_async', 'read_my_design',
]);

// ---------------------------------------------------------------------------
// Auto-focus command sets
// ---------------------------------------------------------------------------

var FOCUS_BEFORE_COMMANDS = new Set([
  // Read commands with nodeId
  'get_node_info', 'get_nodes_info', 'get_bound_variables', 'get_component_properties',
  'get_instance_overrides', 'get_styled_text_segments', 'get_annotations', 'get_reactions',
  'export_node_as_image', 'lint_frame',
  // Modify commands with nodeId
  'set_fill_color', 'set_stroke_color', 'set_image_fill', 'set_gradient_fill',
  'move_node', 'resize_node', 'delete_node', 'clone_node', 'rename_node',
  'insert_child', 'flatten_node', 'set_corner_radius',
  'set_text_content', 'set_multiple_text_contents', 'set_auto_layout',
  'set_font_name', 'set_font_size', 'set_font_weight',
  'set_letter_spacing', 'set_line_height', 'set_paragraph_spacing',
  'set_text_case', 'set_text_decoration', 'apply_text_style',
  'set_effects', 'set_effect_style_id',
  'bind_variable', 'unbind_variable',
  'set_layout_mode', 'set_padding', 'set_item_spacing', 'set_axis_align', 'set_layout_sizing',
  'set_annotation', 'set_multiple_annotations',
  'detach_instance', 'set_instance_overrides', 'set_component_property_references',
  'update_icon',
]);

var FOCUS_AFTER_COMMANDS = new Set([
  'create_rectangle', 'create_frame', 'create_text',
  'create_ellipse', 'create_polygon', 'create_star',
  'create_svg', 'create_vector', 'create_line',
  'create_component', 'create_component_set', 'create_component_instance',
  'create_from_data',
]);

// ---------------------------------------------------------------------------
// Plugin UI
// ---------------------------------------------------------------------------

figma.showUI(__html__, { width: 315, height: 430 });

// Send file name to UI immediately on startup so it's available before WebSocket connects
figma.ui.postMessage({ type: 'file-name', fileName: figma.root.name });

// Auto-connect on plugin load
figma.on('run', function () {
  figma.ui.postMessage({ type: 'auto-connect' });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function updateSettings(settings: Record<string, unknown>): void {
  if (settings['serverPort'] !== undefined && settings['serverPort'] !== null) {
    state.serverPort = settings['serverPort'] as number;
  }
  if (settings['readonlyMode'] !== undefined && settings['readonlyMode'] !== null) {
    state.readonlyMode = settings['readonlyMode'] as boolean;
  }
  if (settings['autoFocus'] !== undefined && settings['autoFocus'] !== null) {
    state.autoFocus = settings['autoFocus'] as boolean;
  }
  if (settings['prefsExpanded'] !== undefined && settings['prefsExpanded'] !== null) {
    state.prefsExpanded = settings['prefsExpanded'] as boolean;
  }
  if (settings['actionsExpanded'] !== undefined && settings['actionsExpanded'] !== null) {
    state.actionsExpanded = settings['actionsExpanded'] as boolean;
  }
  figma.clientStorage.setAsync('settings', {
    serverPort: state.serverPort,
    readonlyMode: state.readonlyMode,
    autoFocus: state.autoFocus,
    prefsExpanded: state.prefsExpanded,
    actionsExpanded: state.actionsExpanded,
  });
}

// Initialize settings from clientStorage on plugin load
(async function initializePlugin() {
  try {
    const savedSettings = await figma.clientStorage.getAsync('settings') as Record<string, unknown> | undefined;
    if (savedSettings) {
      if (savedSettings['serverPort'] !== undefined && savedSettings['serverPort'] !== null) {
        state.serverPort = savedSettings['serverPort'] as number;
      }
      if (savedSettings['readonlyMode'] !== undefined && savedSettings['readonlyMode'] !== null) {
        state.readonlyMode = savedSettings['readonlyMode'] as boolean;
      }
      if (savedSettings['autoFocus'] !== undefined && savedSettings['autoFocus'] !== null) {
        state.autoFocus = savedSettings['autoFocus'] as boolean;
      }
      if (savedSettings['prefsExpanded'] !== undefined && savedSettings['prefsExpanded'] !== null) {
        state.prefsExpanded = savedSettings['prefsExpanded'] as boolean;
      }
      if (savedSettings['actionsExpanded'] !== undefined && savedSettings['actionsExpanded'] !== null) {
        state.actionsExpanded = savedSettings['actionsExpanded'] as boolean;
      }
    }

    // Send initial settings to UI
    figma.ui.postMessage({
      type: 'init-settings',
      settings: {
        serverPort: state.serverPort,
        readonlyMode: state.readonlyMode,
        autoFocus: state.autoFocus,
        prefsExpanded: state.prefsExpanded,
        actionsExpanded: state.actionsExpanded,
      },
    });
  } catch (error) {
    console.error('Error loading settings:', error);
  }
})();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a depth value from plugin params. Returns undefined for unlimited, or a valid integer. */
function parseDepth(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  var n = Number(value);
  if (isNaN(n)) return undefined; // e.g. "all" passed through → treat as unlimited
  return n;
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

async function handleCommand(
  command: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  debugLog(`handleCommand: ${command}`);

  // Readonly guard
  if (state.readonlyMode && !READONLY_COMMANDS.has(command)) {
    throw new Error("Readonly mode is active. Command '" + command + "' is not allowed.");
  }

  // Auto-focus before command
  if (state.autoFocus && FOCUS_BEFORE_COMMANDS.has(command) && params) {
    var focusId = params['nodeId'] as string;
    if (focusId) {
      try { await softFocusNode(focusId); } catch (_e) { /* silent */ }
    }
  }

  var result = await _executeCommand(command, params);

  // Auto-focus after create commands
  if (state.autoFocus && FOCUS_AFTER_COMMANDS.has(command) && result && typeof result === 'object') {
    var created = result as Record<string, unknown>;
    var createdId = (created['nodeId'] || created['id']) as string;
    if (createdId) {
      try { await softFocusNode(createdId); } catch (_e) { /* silent */ }
    }
  }

  return result;
}

async function _executeCommand(
  command: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (command) {
    // Document
    case 'get_document_info':
      return await getDocumentInfo();
    case 'get_file_key':
      return await getFileKey();
    case 'get_selection':
      return await serializeNodes({
        depth: parseDepth(params && params['depth']),
      });
    case 'get_node_info':
      if (!params || (!params['nodeIds'] && !params['nodeId'])) {
        throw new Error('Missing nodeId or nodeIds parameter');
      }
      return await serializeNodes({
        nodeIds: params['nodeIds'] && Array.isArray(params['nodeIds'])
          ? params['nodeIds'] as string[]
          : [params['nodeId'] as string],
        depth: parseDepth(params['depth']),
      });
    case 'get_nodes_info':
      if (!params || !params['nodeIds'] || !Array.isArray(params['nodeIds'])) {
        throw new Error('Missing or invalid nodeIds parameter');
      }
      return await serializeNodes({
        nodeIds: params['nodeIds'] as string[],
        depth: parseDepth(params['depth']),
      });
    case 'search_nodes':
      if (!params || !params['query']) {
        throw new Error('Missing query parameter');
      }
      return await searchNodes({
        query: String(params['query']),
        types: Array.isArray(params['types']) ? params['types'] as string[] : undefined,
        nodeId: params['nodeId'] !== undefined ? String(params['nodeId']) : undefined,
        limit: params['limit'] !== undefined ? Number(params['limit']) : undefined,
        depth: parseDepth(params['depth']),
      });

    // Node creation
    case 'create_rectangle':
      return await createRectangle(params);
    case 'create_frame':
      return await createFrame(params);
    case 'create_text':
      return await createText(params);

    // Fills & strokes
    case 'set_fill_color':
      return await setFillColor(params);
    case 'set_stroke_color':
      return await setStrokeColor(params);
    case 'set_image_fill':
      return await setImageFill(params);
    case 'set_gradient_fill':
      return await setGradientFill(params);

    // Node operations
    case 'move_node':
      return await moveNode(params);
    case 'resize_node':
      return await resizeNode(params);
    case 'delete_node':
      return await deleteNode(params);
    case 'delete_multiple_nodes':
      return await deleteMultipleNodes(params);
    case 'clone_node':
      return await cloneNode(params);
    case 'rename_node':
      return await renameNode(params);
    case 'insert_child':
      return await insertChild(params);
    case 'group_nodes':
      return await groupNodes(params);
    case 'ungroup_nodes':
      return await ungroupNodes(params);
    case 'flatten_node':
      return await flattenNode(params);
    case 'export_node_as_image':
      return await exportNodeAsImage(params);
    case 'set_corner_radius':
      return await setCornerRadius(params);

    // Styles & components
    case 'get_styles':
      return await getStyles();
    case 'get_local_components':
      return await getLocalComponents();
    case 'get_remote_components':
      // Deprecated: remote component loading is no longer supported.
      // Returns an empty list to avoid breaking existing callers.
      return { components: [], deprecated: true, message: 'get_remote_components is deprecated; use get_local_components instead.' };
    case 'create_component_instance':
      return await createComponentInstance(params);
    case 'detach_instance':
      return await detachInstance(params);
    case 'create_component':
      return await createComponent(params);
    case 'create_component_set':
      return await createComponentSet(params);
    case 'add_component_property':
      return await addComponentProperty(params);
    case 'edit_component_property':
      return await editComponentProperty(params);
    case 'delete_component_property':
      return await deleteComponentProperty(params);
    case 'set_component_property_references':
      return await setComponentPropertyReferences(params);
    case 'get_component_properties':
      return await getComponentProperties(params);

    // Text
    case 'set_text_content':
      return await setTextContent(params);
    case 'set_multiple_text_contents':
      return await setMultipleTextContents(params);
    case 'set_auto_layout':
      return await setAutoLayout(params);
    case 'set_font_name':
      return await setFontName(params);
    case 'set_font_size':
      return await setFontSize(params);
    case 'set_font_weight':
      return await setFontWeight(params);
    case 'set_letter_spacing':
      return await setLetterSpacing(params);
    case 'set_line_height':
      return await setLineHeight(params);
    case 'set_paragraph_spacing':
      return await setParagraphSpacing(params);
    case 'set_text_case':
      return await setTextCase(params);
    case 'set_text_decoration':
      return await setTextDecoration(params);
    case 'get_styled_text_segments':
      return await getStyledTextSegments(params);
    case 'load_font_async':
      return await loadFontAsyncWrapper(params);
    case 'create_text_style':
      return await createTextStyle(params);
    case 'create_text_style_from_properties':
      return await createTextStyleFromProperties(params);
    case 'apply_text_style':
      return await applyTextStyle(params);
    case 'get_text_styles':
      return await getTextStyles();
    case 'delete_text_style':
      return await deleteTextStyle(params);
    case 'update_text_style':
      return await updateTextStyle(params);

    // Effects
    case 'set_effects':
      return await setEffects(params);
    case 'set_effect_style_id':
      return await setEffectStyleId(params);
    case 'create_effect_style':
      return await createEffectStyle(params);
    case 'update_effect_style':
      return await updateEffectStyle(params);
    case 'delete_effect_style':
      return await deleteEffectStyle(params);

    // Shapes
    case 'create_ellipse':
      return await createEllipse(params);
    case 'create_polygon':
      return await createPolygon(params);
    case 'create_star':
      return await createStar(params);
    case 'create_svg':
      return await createSvg(params);
    case 'update_icon':
      return await updateIcon(params);
    case 'create_vector':
      return await createVector(params);
    case 'create_line':
      return await createLine(params);

    // Variables
    case 'get_variables':
      return await getVariables();
    case 'get_bound_variables':
      return await getBoundVariables(params);
    case 'bind_variable':
      return await bindVariable(params);
    case 'unbind_variable':
      return await unbindVariable(params);
    case 'get_variable_collections':
      return await getVariableCollections();
    case 'create_variable_collection':
      return await createVariableCollection(params);
    case 'get_collection_info':
      return await getCollectionInfo(params);
    case 'rename_variable_collection':
      return await renameVariableCollection(params);
    case 'delete_variable_collection':
      return await deleteVariableCollection(params);
    case 'create_variable':
      return await createVariable(params);
    case 'create_variables_batch':
      return await createVariablesBatch(params);
    case 'update_variable_value':
      return await updateVariableValue(params);
    case 'rename_variable':
      return await renameVariable(params);
    case 'delete_variable':
      return await deleteVariable(params);
    case 'delete_variables_batch':
      return await deleteVariablesBatch(params);
    case 'audit_collection':
      return await auditCollection(params);
    case 'validate_color_contrast':
      return await validateColorContrast(params);
    case 'suggest_missing_variables':
      return await suggestMissingVariables(params);
    case 'apply_default_theme':
      return await applyDefaultTheme(params);
    case 'create_color_scale_set':
      return await createColorScaleSet(params);
    case 'apply_custom_palette':
      return await applyCustomPalette(params);
    case 'reorder_variables':
      return await reorderVariables(params);
    case 'generate_audit_report':
      return await generateAuditReport(params);
    case 'export_collection_schema':
      return await exportCollectionSchema(params);
    case 'import_collection_schema':
      return await importCollectionSchema(params);
    case 'create_all_scales':
      return await createAllScales(params);
    case 'fix_collection_to_standard':
      return await fixCollectionToStandard(params);
    case 'add_chart_colors':
      return await addChartColors(params);
    case 'add_mode_to_collection':
      return await addModeToCollection(params);
    case 'rename_mode':
      return await renameMode(params);
    case 'delete_mode':
      return await deleteMode(params);
    case 'duplicate_mode_values':
      return await duplicateModeValues(params);

    // Layout
    case 'create_spacing_system':
      return await createSpacingSystem(params);
    case 'create_typography_system':
      return await createTypographySystem(params);
    case 'create_radius_system':
      return await createRadiusSystem(params);
    case 'set_layout_mode':
      return await setLayoutMode(params);
    case 'set_padding':
      return await setPadding(params);
    case 'set_item_spacing':
      return await setItemSpacing(params);
    case 'set_axis_align':
      return await setAxisAlign(params);
    case 'set_layout_sizing':
      return await setLayoutSizing(params);

    // Selection & focus
    case 'set_focus':
      return await setFocus(params);
    case 'set_selections':
      return await setSelections(params);
    case 'scan_nodes_by_types':
      return await scanNodesByTypes(params);

    // Annotations
    case 'get_annotations':
      return await getAnnotations(params);
    case 'set_annotation':
      return await setAnnotation(params);
    case 'set_multiple_annotations':
      return await setMultipleAnnotations(params);
    case 'get_annotation_categories':
      return await getAnnotationCategories();
    case 'create_annotation_category':
      return await createAnnotationCategory(params);
    case 'update_annotation_category':
      return await updateAnnotationCategory(params);
    case 'delete_annotation_category':
      return await deleteAnnotationCategory(params);

    // Prototyping
    case 'get_reactions':
      return await getReactions(params);
    case 'set_default_connector':
      return await setDefaultConnector(params);
    case 'create_connections':
      return await createConnections(params);

    // Pages
    case 'create_page':
      return await createPage(params);
    case 'rename_page':
      return await renamePage(params);
    case 'delete_page':
      return await deletePage(params);

    // Design system
    case 'create_from_data':
      return await createFromData(params);
    case 'get_design_system':
      return await getDesignSystem();
    case 'setup_design_system':
      return await setupDesignSystem(params);

    // Batch
    case 'batch_actions':
      return await batchActions(params, handleCommand);

    // Lint
    case 'lint_frame':
      return await lintFrame(params);

    case 'get_instance_overrides':
      return await getInstanceOverrides(params);
    case 'set_instance_overrides':
      return await setInstanceOverrides(params);

    // Version History
    case 'save_version_history':
      return await saveVersionHistory(params);

    // Undo/Redo
    case 'undo':
      return triggerUndo();
    case 'commit_undo':
      return commitUndoAction();

    default:
      throw new Error('Unknown command');
  }
}

// ---------------------------------------------------------------------------
// UI message handler
// ---------------------------------------------------------------------------

figma.ui.onmessage = async (msg: Record<string, unknown>) => {
  switch (msg['type']) {
    case 'update-settings':
      updateSettings(msg);
      break;
    case 'notify':
      figma.notify(msg['message'] as string);
      break;
    case 'close-plugin':
      figma.closePlugin();
      break;
    case 'get-file-name':
      figma.ui.postMessage({ type: 'file-name', fileName: figma.root.name });
      break;
    case 'execute-command':
      try {
        const result = await handleCommand(
          msg['command'] as string,
          (msg['params'] as Record<string, unknown>) || {},
        );
        figma.ui.postMessage({
          type: 'command-result',
          id: msg['id'],
          command: msg['command'],
          result,
        });
      } catch (error) {
        figma.ui.postMessage({
          type: 'command-error',
          id: msg['id'],
          command: msg['command'],
          error:
            error instanceof Error ? error.message : 'Error executing command',
        });
      }
      break;
    default:
      break;
  }
};
