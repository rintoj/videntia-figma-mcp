// This is the main code file for the Claude Figma MCP plugin
// It handles Figma API commands

// Plugin state
const state = {
  serverPort: 3055, // Default port
};

// Debug mode - set to true to enable verbose logging
const DEBUG = false;

// Debug logging helper - only logs when DEBUG is true
function debugLog(...args) {
  if (DEBUG) debugLog(...args);
}

// Helper function for progress updates
function sendProgressUpdate(commandId, commandType, status, progress, totalItems, processedItems, message, payload = null) {
  const update = {
    type: 'command_progress',
    commandId,
    commandType,
    status,
    progress,
    totalItems,
    processedItems,
    message,
    timestamp: Date.now()
  };
  
  // Add optional chunk information if present
  if (payload) {
    if (payload.currentChunk !== undefined && payload.totalChunks !== undefined) {
      update.currentChunk = payload.currentChunk;
      update.totalChunks = payload.totalChunks;
      update.chunkSize = payload.chunkSize;
    }
    update.payload = payload;
  }
  
  // Send to UI
  figma.ui.postMessage(update);
  debugLog(`Progress update: ${status} - ${progress}% - ${message}`);
  
  return update;
}

// Show UI
figma.showUI(__html__, { width: 220, height: 200 });

// Plugin commands from UI
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case "update-settings":
      updateSettings(msg);
      break;
    case "notify":
      figma.notify(msg.message);
      break;
    case "close-plugin":
      figma.closePlugin();
      break;
    case "execute-command":
      // Execute commands received from UI (which gets them from WebSocket)
      try {
        const result = await handleCommand(msg.command, msg.params);
        // Send result back to UI
        figma.ui.postMessage({
          type: "command-result",
          id: msg.id,
          command: msg.command,
          result,
        });
      } catch (error) {
        figma.ui.postMessage({
          type: "command-error",
          id: msg.id,
          command: msg.command,
          error: error.message || "Error executing command",
        });
      }
      break;
  }
};


// Update plugin settings
function updateSettings(settings) {
  if (settings.serverPort) {
    state.serverPort = settings.serverPort;
  }

  figma.clientStorage.setAsync("settings", {
    serverPort: state.serverPort,
  });
}

// Handle commands from UI
async function handleCommand(command, params) {
  switch (command) {
    case "get_document_info":
      return await getDocumentInfo();
    case "get_file_key":
      return await getFileKey();
    case "get_selection":
      return await getSelection();
    case "get_node_info":
      if (!params || !params.nodeId) {
        throw new Error("Missing nodeId parameter");
      }
      return await getNodeInfo(params.nodeId, {
        stripImages: params.stripImages !== false, // Default to true
      });
    case "get_nodes_info":
      if (!params || !params.nodeIds || !Array.isArray(params.nodeIds)) {
        throw new Error("Missing or invalid nodeIds parameter");
      }
      return await getNodesInfo(params.nodeIds, {
        stripImages: params.stripImages !== false, // Default to true
      });
    case "create_rectangle":
      return await createRectangle(params);
    case "create_frame":
      return await createFrame(params);
    case "create_text":
      return await createText(params);
    case "set_fill_color":
      return await setFillColor(params);
    case "set_stroke_color":
      return await setStrokeColor(params);
    case "set_image_fill":
      return await setImageFill(params);
    case "move_node":
      return await moveNode(params);
    case "resize_node":
      return await resizeNode(params);
    case "delete_node":
      return await deleteNode(params);
    case "delete_multiple_nodes":
      return await deleteMultipleNodes(params);
    case "get_styles":
      return await getStyles();
    case "get_local_components":
      return await getLocalComponents();
    // case "get_team_components":
    //   return await getTeamComponents();
    case "create_component_instance":
      return await createComponentInstance(params);
    case "export_node_as_image":
      return await exportNodeAsImage(params);
    case "set_corner_radius":
      return await setCornerRadius(params);
    case "set_text_content":
      return await setTextContent(params);
    case "clone_node":
      return await cloneNode(params);
    case "scan_text_nodes":
      return await scanTextNodes(params);
    case "set_multiple_text_contents":
      return await setMultipleTextContents(params);
    case "set_auto_layout":
      return await setAutoLayout(params);
    // Nuevos comandos para propiedades de texto
    case "set_font_name":
      return await setFontName(params);
    case "set_font_size":
      return await setFontSize(params);
    case "set_font_weight":
      return await setFontWeight(params);
    case "set_letter_spacing":
      return await setLetterSpacing(params);
    case "set_line_height":
      return await setLineHeight(params);
    case "set_paragraph_spacing":
      return await setParagraphSpacing(params);
    case "set_text_case":
      return await setTextCase(params);
    case "set_text_decoration":
      return await setTextDecoration(params);
    case "get_styled_text_segments":
      return await getStyledTextSegments(params);
    case "load_font_async":
      return await loadFontAsyncWrapper(params);
    case "create_text_style":
      return await createTextStyle(params);
    case "create_text_style_from_properties":
      return await createTextStyleFromProperties(params);
    case "apply_text_style":
      return await applyTextStyle(params);
    case "get_text_styles":
      return await getTextStyles();
    case "delete_text_style":
      return await deleteTextStyle(params);
    case "update_text_style":
      return await updateTextStyle(params);
    case "get_remote_components":
      return await getRemoteComponents(params);
    case "set_effects":
      return await setEffects(params);
    case "set_effect_style_id":
      return await setEffectStyleId(params);
    case "group_nodes":
      return await groupNodes(params);
    case "ungroup_nodes":
      return await ungroupNodes(params);
    case "flatten_node":
      return await flattenNode(params);
    case "detach_instance":
      return await detachInstance(params);
    case "create_component":
      return await createComponent(params);
    case "create_component_set":
      return await createComponentSet(params);
    case "add_component_property":
      return await addComponentProperty(params);
    case "edit_component_property":
      return await editComponentProperty(params);
    case "delete_component_property":
      return await deleteComponentProperty(params);
    case "set_component_property_references":
      return await setComponentPropertyReferences(params);
    case "get_component_properties":
      return await getComponentProperties(params);
    case "insert_child":
      return await insertChild(params);
    case "create_ellipse":
      return await createEllipse(params);
    case "create_polygon":
      return await createPolygon(params);
    case "create_star":
      return await createStar(params);
    case "create_svg":
      return await createSvg(params);
    case "create_vector":
      return await createVector(params);
    case "create_line":
      return await createLine(params);
    case "get_variables":
      return await getVariables();
    case "get_bound_variables":
      return await getBoundVariables(params);
    case "bind_variable":
      return await bindVariable(params);
    case "unbind_variable":
      return await unbindVariable(params);
    case "rename_node":
      return await renameNode(params);
    // New variable management tools
    case "get_variable_collections":
      return await getVariableCollections();
    case "create_variable_collection":
      return await createVariableCollection(params);
    case "get_collection_info":
      return await getCollectionInfo(params);
    case "rename_variable_collection":
      return await renameVariableCollection(params);
    case "delete_variable_collection":
      return await deleteVariableCollection(params);
    case "create_variable":
      return await createVariable(params);
    case "create_variables_batch":
      return await createVariablesBatch(params);
    case "update_variable_value":
      return await updateVariableValue(params);
    case "rename_variable":
      return await renameVariable(params);
    case "delete_variable":
      return await deleteVariable(params);
    case "delete_variables_batch":
      return await deleteVariablesBatch(params);
    case "audit_collection":
      return await auditCollection(params);
    case "validate_color_contrast":
      return await validateColorContrast(params);
    case "suggest_missing_variables":
      return await suggestMissingVariables(params);
    case "apply_default_theme":
      return await applyDefaultTheme(params);
    case "create_color_scale_set":
      return await createColorScaleSet(params);
    case "apply_custom_palette":
      return await applyCustomPalette(params);
    case "reorder_variables":
      return await reorderVariables(params);
    case "generate_audit_report":
      return await generateAuditReport(params);
    case "export_collection_schema":
      return await exportCollectionSchema(params);
    case "import_collection_schema":
      return await importCollectionSchema(params);
    case "create_all_scales":
      return await createAllScales(params);
    case "fix_collection_to_standard":
      return await fixCollectionToStandard(params);
    case "add_chart_colors":
      return await addChartColors(params);
    // Mode management tools
    case "add_mode_to_collection":
      return await addModeToCollection(params);
    case "rename_mode":
      return await renameMode(params);
    case "delete_mode":
      return await deleteMode(params);
    case "duplicate_mode_values":
      return await duplicateModeValues(params);
    // Design system preset commands
    case "create_spacing_system":
      return await createSpacingSystem(params);
    case "create_typography_system":
      return await createTypographySystem(params);
    case "create_radius_system":
      return await createRadiusSystem(params);
    // Auto layout individual commands
    case "set_layout_mode":
      return await setLayoutMode(params);
    case "set_padding":
      return await setPadding(params);
    case "set_item_spacing":
      return await setItemSpacing(params);
    case "set_axis_align":
      return await setAxisAlign(params);
    case "set_layout_sizing":
      return await setLayoutSizing(params);
    // Selection and focus commands
    case "set_focus":
      return await setFocus(params);
    case "set_selections":
      return await setSelections(params);
    case "read_my_design":
      return await readMyDesign();
    // Scan commands
    case "scan_nodes_by_types":
      return await scanNodesByTypes(params);
    // Annotation commands
    case "get_annotations":
      return await getAnnotations(params);
    case "set_annotation":
      return await setAnnotation(params);
    case "set_multiple_annotations":
      return await setMultipleAnnotations(params);
    // Annotation category commands
    case "get_annotation_categories":
      return await getAnnotationCategories();
    case "create_annotation_category":
      return await createAnnotationCategory(params);
    case "update_annotation_category":
      return await updateAnnotationCategory(params);
    case "delete_annotation_category":
      return await deleteAnnotationCategory(params);
    // Prototyping commands
    case "get_reactions":
      return await getReactions(params);
    case "set_default_connector":
      return await setDefaultConnector(params);
    case "create_connections":
      return await createConnections(params);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// Command implementations

async function getFileKey() {
  // figma.fileKey returns the key of the current file
  // This is needed for Figma REST API calls
  const fileKey = figma.fileKey;
  if (!fileKey) {
    throw new Error("File key not available. Make sure you're in a saved Figma file.");
  }
  return {
    fileKey,
    fileName: figma.root.name,
  };
}

async function getDocumentInfo() {
  await figma.currentPage.loadAsync();
  const page = figma.currentPage;
  return {
    name: page.name,
    id: page.id,
    type: page.type,
    children: page.children.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
    })),
    currentPage: {
      id: page.id,
      name: page.name,
      childCount: page.children.length,
    },
    pages: [
      {
        id: page.id,
        name: page.name,
        childCount: page.children.length,
      },
    ],
  };
}

async function getSelection() {
  return {
    selectionCount: figma.currentPage.selection.length,
    selection: figma.currentPage.selection.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      visible: node.visible,
    })),
  };
}

/**
 * Recursively strips image data (imageRef, imageBytes) from node data to reduce response size.
 * Replaces image data with metadata only.
 */
function stripImageData(obj) {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(stripImageData);
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip large binary/base64 image data
    if (key === "imageRef" || key === "imageBytes" || key === "gifRef") {
      // Keep a marker that there was image data, but don't include the actual data
      result[key] = "[IMAGE_DATA_STRIPPED]";
      continue;
    }

    // Recursively process nested objects
    result[key] = stripImageData(value);
  }
  return result;
}

async function getNodeInfo(nodeId, options = {}) {
  const { stripImages = true } = options;

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  const response = await node.exportAsync({
    format: "JSON_REST_V1",
  });

  let document = response.document;

  // Strip image data by default to prevent large responses
  if (stripImages) {
    document = stripImageData(document);
  }

  return document;
}

async function getNodesInfo(nodeIds, options = {}) {
  const { stripImages = true } = options;

  try {
    // Load all nodes in parallel
    const nodes = await Promise.all(
      nodeIds.map((id) => figma.getNodeByIdAsync(id))
    );

    // Filter out any null values (nodes that weren't found)
    const validNodes = nodes.filter((node) => node !== null);

    // Export all valid nodes in parallel
    const responses = await Promise.all(
      validNodes.map(async (node) => {
        const response = await node.exportAsync({
          format: "JSON_REST_V1",
        });
        let document = response.document;

        // Strip image data by default to prevent large responses
        if (stripImages) {
          document = stripImageData(document);
        }

        return {
          nodeId: node.id,
          document,
        };
      })
    );

    return responses;
  } catch (error) {
    throw new Error(`Error getting nodes info: ${error.message}`);
  }
}

async function createRectangle(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Rectangle",
    parentId,
  } = params || {};

  const rect = figma.createRectangle();
  rect.x = x;
  rect.y = y;
  rect.resize(width, height);
  rect.name = name;

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(rect);
  } else {
    figma.currentPage.appendChild(rect);
  }

  return {
    id: rect.id,
    name: rect.name,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    parentId: rect.parent ? rect.parent.id : undefined,
  };
}

async function createFrame(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Frame",
    parentId,
    fillColor,
    strokeColor,
    strokeWeight,
  } = params || {};

  const frame = figma.createFrame();
  frame.x = x;
  frame.y = y;
  frame.resize(width, height);
  frame.name = name;

  // Set fill color if provided
  if (fillColor) {
    const paintStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(fillColor.r) || 0,
        g: parseFloat(fillColor.g) || 0,
        b: parseFloat(fillColor.b) || 0,
      },
      opacity: parseFloat(fillColor.a) || 1,
    };
    frame.fills = [paintStyle];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    const strokeStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(strokeColor.r) || 0,
        g: parseFloat(strokeColor.g) || 0,
        b: parseFloat(strokeColor.b) || 0,
      },
      opacity: parseFloat(strokeColor.a) || 1,
    };
    frame.strokes = [strokeStyle];
  }

  // Set stroke weight if provided
  if (strokeWeight !== undefined) {
    frame.strokeWeight = strokeWeight;
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(frame);
  } else {
    figma.currentPage.appendChild(frame);
  }

  return {
    id: frame.id,
    name: frame.name,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    fills: frame.fills,
    strokes: frame.strokes,
    strokeWeight: frame.strokeWeight,
    parentId: frame.parent ? frame.parent.id : undefined,
  };
}

async function createText(params) {
  const {
    x = 0,
    y = 0,
    text = "Text",
    fontSize = 14,
    fontWeight = 400,
    fontColor = { r: 0, g: 0, b: 0, a: 1 }, // Default to black
    name = "Text",
    parentId,
  } = params || {};

  // Map common font weights to Figma font styles
  const getFontStyle = (weight) => {
    switch (weight) {
      case 100:
        return "Thin";
      case 200:
        return "Extra Light";
      case 300:
        return "Light";
      case 400:
        return "Regular";
      case 500:
        return "Medium";
      case 600:
        return "Semi Bold";
      case 700:
        return "Bold";
      case 800:
        return "Extra Bold";
      case 900:
        return "Black";
      default:
        return "Regular";
    }
  };

  const textNode = figma.createText();
  textNode.x = x;
  textNode.y = y;
  textNode.name = name;
  try {
    await figma.loadFontAsync({
      family: "Inter",
      style: getFontStyle(fontWeight),
    });
    textNode.fontName = { family: "Inter", style: getFontStyle(fontWeight) };
    textNode.fontSize = parseInt(fontSize);
  } catch (error) {
    console.error("Error setting font size", error);
  }
  setCharacters(textNode, text);

  // Set text color
  const paintStyle = {
    type: "SOLID",
    color: {
      r: parseFloat(fontColor.r) || 0,
      g: parseFloat(fontColor.g) || 0,
      b: parseFloat(fontColor.b) || 0,
    },
    opacity: parseFloat(fontColor.a) || 1,
  };
  textNode.fills = [paintStyle];

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(textNode);
  } else {
    figma.currentPage.appendChild(textNode);
  }

  return {
    id: textNode.id,
    name: textNode.name,
    x: textNode.x,
    y: textNode.y,
    width: textNode.width,
    height: textNode.height,
    characters: textNode.characters,
    fontSize: textNode.fontSize,
    fontWeight: fontWeight,
    fontColor: fontColor,
    fontName: textNode.fontName,
    fills: textNode.fills,
    parentId: textNode.parent ? textNode.parent.id : undefined,
  };
}

async function setFillColor(params) {
  debugLog("setFillColor", params);
  const {
    nodeId,
    color: { r, g, b, a },
  } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("fills" in node)) {
    throw new Error(`Node does not support fills: ${nodeId}`);
  }

  // Validate that MCP layer provided complete data
  if (r === undefined || g === undefined || b === undefined || a === undefined) {
    throw new Error("Incomplete color data received from MCP layer. All RGBA components must be provided.");
  }

  // Parse values - no defaults, just format conversion
  const rgbColor = {
    r: parseFloat(r),
    g: parseFloat(g), 
    b: parseFloat(b),
    a: parseFloat(a)
  };

  // Validate parsing succeeded
  if (isNaN(rgbColor.r) || isNaN(rgbColor.g) || isNaN(rgbColor.b) || isNaN(rgbColor.a)) {
    throw new Error("Invalid color values received - all components must be valid numbers");
  }

  // Set fill - pure translation to Figma API format
  const paintStyle = {
    type: "SOLID",
    color: {
      r: rgbColor.r,
      g: rgbColor.g,
      b: rgbColor.b,
    },
    opacity: rgbColor.a,
  };

  debugLog("paintStyle", paintStyle);

  node.fills = [paintStyle];

  return {
    id: node.id,
    name: node.name,
    fills: [paintStyle],
  };
}

async function setStrokeColor(params) {
  const {
    nodeId,
    color: { r, g, b, a },
    strokeWeight,
  } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("strokes" in node)) {
    throw new Error(`Node does not support strokes: ${nodeId}`);
  }

  if (r === undefined || g === undefined || b === undefined || a === undefined) {
    throw new Error("Incomplete color data received from MCP layer. All RGBA components must be provided.");
  }
  
  if (strokeWeight === undefined) {
    throw new Error("Stroke weight must be provided by MCP layer.");
  }

  const rgbColor = {
    r: parseFloat(r),
    g: parseFloat(g),
    b: parseFloat(b),
    a: parseFloat(a)
  };
  const strokeWeightParsed = parseFloat(strokeWeight);

  if (isNaN(rgbColor.r) || isNaN(rgbColor.g) || isNaN(rgbColor.b) || isNaN(rgbColor.a)) {
    throw new Error("Invalid color values received - all components must be valid numbers");
  }
  
  if (isNaN(strokeWeightParsed)) {
    throw new Error("Invalid stroke weight - must be a valid number");
  }

  const paintStyle = {
    type: "SOLID",
    color: {
      r: rgbColor.r,
      g: rgbColor.g,
      b: rgbColor.b,
    },
    opacity: rgbColor.a,
  };

  node.strokes = [paintStyle];

  // Set stroke weight if available
  if ("strokeWeight" in node) {
    node.strokeWeight = strokeWeightParsed;
  }

  return {
    id: node.id,
    name: node.name,
    strokes: node.strokes,
    strokeWeight: "strokeWeight" in node ? node.strokeWeight : undefined,
  };
}

async function setImageFill(params) {
  const { nodeId, imageUrl, scaleMode = "FILL", rotation, exposure, contrast, saturation, temperature, tint, highlights, shadows } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (!imageUrl) {
    throw new Error("Missing imageUrl parameter");
  }

  const validScaleModes = ["FILL", "FIT", "CROP", "TILE"];
  if (!validScaleModes.includes(scaleMode)) {
    throw new Error(`Invalid scaleMode: ${scaleMode}. Must be one of: ${validScaleModes.join(", ")}`);
  }

  debugLog(`setImageFill: Starting with nodeId=${nodeId}, imageUrl=${imageUrl}`);

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("fills" in node)) {
    throw new Error(`Node does not support fills: ${nodeId}`);
  }

  debugLog(`setImageFill: Found node "${node.name}", fetching image...`);

  // Create image from URL - this can fail due to CORS, invalid URL, or unsupported format
  let image;
  try {
    image = await figma.createImageAsync(imageUrl);
  } catch (fetchError) {
    const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    console.error(`setImageFill: Failed to fetch image: ${errorMsg}`);
    throw new Error(`Failed to fetch image from URL. This may be due to CORS restrictions, invalid URL, or unsupported image format. URL: ${imageUrl}. Error: ${errorMsg}`);
  }

  debugLog(`setImageFill: Image fetched, hash=${image.hash}`);

  let width, height;
  try {
    const size = await image.getSizeAsync();
    width = size.width;
    height = size.height;
  } catch (sizeError) {
    console.error(`setImageFill: Failed to get image size: ${sizeError}`);
    // Continue without size info
    width = 0;
    height = 0;
  }

  debugLog(`setImageFill: Image size ${width}x${height}`);

  // Build the image paint object
  const imagePaint = {
    type: "IMAGE",
    imageHash: image.hash,
    scaleMode: scaleMode,
  };

  // Add optional rotation (only for TILE, FILL, FIT)
  if (rotation !== undefined && ["TILE", "FILL", "FIT"].includes(scaleMode)) {
    imagePaint.rotation = rotation;
  }

  // Add image filters if provided (all range from -1.0 to 1.0, default 0)
  if (exposure !== undefined) imagePaint.exposure = exposure;
  if (contrast !== undefined) imagePaint.contrast = contrast;
  if (saturation !== undefined) imagePaint.saturation = saturation;
  if (temperature !== undefined) imagePaint.temperature = temperature;
  if (tint !== undefined) imagePaint.tint = tint;
  if (highlights !== undefined) imagePaint.highlights = highlights;
  if (shadows !== undefined) imagePaint.shadows = shadows;

  // Apply the image fill
  try {
    node.fills = [imagePaint];
  } catch (fillError) {
    const errorMsg = fillError instanceof Error ? fillError.message : String(fillError);
    console.error(`setImageFill: Failed to apply fill: ${errorMsg}`);
    throw new Error(`Failed to apply image fill to node: ${errorMsg}`);
  }

  debugLog(`setImageFill: Successfully applied image fill`);

  return {
    id: node.id,
    name: node.name,
    imageHash: image.hash,
    imageSize: { width, height },
    scaleMode: scaleMode,
    fills: [imagePaint]
  };
}

async function moveNode(params) {
  const { nodeId, x, y } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (x === undefined || y === undefined) {
    throw new Error("Missing x or y parameters");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("x" in node) || !("y" in node)) {
    throw new Error(`Node does not support position: ${nodeId}`);
  }

  node.x = x;
  node.y = y;

  return {
    id: node.id,
    name: node.name,
    x: node.x,
    y: node.y,
  };
}

async function resizeNode(params) {
  const { nodeId, width, height } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (width === undefined || height === undefined) {
    throw new Error("Missing width or height parameters");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("resize" in node)) {
    throw new Error(`Node does not support resizing: ${nodeId}`);
  }

  node.resize(width, height);

  return {
    id: node.id,
    name: node.name,
    width: node.width,
    height: node.height,
  };
}

async function deleteNode(params) {
  const { nodeId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Save node info before deleting
  const nodeInfo = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  node.remove();

  return nodeInfo;
}

async function deleteMultipleNodes(params) {
  const { nodeIds } = params || {};

  if (!nodeIds || !Array.isArray(nodeIds)) {
    throw new Error("Missing or invalid nodeIds parameter - must be an array");
  }

  if (nodeIds.length === 0) {
    throw new Error("nodeIds array is empty");
  }

  const deletedNodes = [];
  const errors = [];

  for (const nodeId of nodeIds) {
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        errors.push({ nodeId, error: `Node not found with ID: ${nodeId}` });
        continue;
      }

      // Save node info before deleting
      const nodeInfo = {
        id: node.id,
        name: node.name,
        type: node.type,
      };

      node.remove();
      deletedNodes.push(nodeInfo);
    } catch (error) {
      errors.push({ nodeId, error: error.message });
    }
  }

  return {
    deletedNodes,
    deletedCount: deletedNodes.length,
    errors: errors.length > 0 ? errors : undefined,
    totalRequested: nodeIds.length,
  };
}

async function getStyles() {
  const styles = {
    colors: await figma.getLocalPaintStylesAsync(),
    texts: await figma.getLocalTextStylesAsync(),
    effects: await figma.getLocalEffectStylesAsync(),
    grids: await figma.getLocalGridStylesAsync(),
  };

  return {
    colors: styles.colors.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      paint: style.paints[0],
    })),
    texts: styles.texts.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      fontSize: style.fontSize,
      fontName: style.fontName,
    })),
    effects: styles.effects.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
    })),
    grids: styles.grids.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
    })),
  };
}

async function getLocalComponents() {
  await figma.loadAllPagesAsync();

  const components = figma.root.findAllWithCriteria({
    types: ["COMPONENT"],
  });

  return {
    count: components.length,
    components: components.map((component) => ({
      id: component.id,
      name: component.name,
      key: "key" in component ? component.key : null,
    })),
  };
}

// async function getTeamComponents() {
//   try {
//     const teamComponents =
//       await figma.teamLibrary.getAvailableComponentsAsync();

//     return {
//       count: teamComponents.length,
//       components: teamComponents.map((component) => ({
//         key: component.key,
//         name: component.name,
//         description: component.description,
//         libraryName: component.libraryName,
//       })),
//     };
//   } catch (error) {
//     throw new Error(`Error getting team components: ${error.message}`);
//   }
// }

async function createComponentInstance(params) {
  const { componentKey, x = 0, y = 0, parentId } = params || {};

  if (!componentKey) {
    throw new Error("Missing componentKey parameter");
  }

  try {
    let component = null;

    // First, try to find as a local component by ID (format like "123:456")
    if (componentKey.includes(":")) {
      debugLog(`Trying to find local component with ID: ${componentKey}...`);
      const localNode = await figma.getNodeByIdAsync(componentKey);
      if (localNode && localNode.type === "COMPONENT") {
        component = localNode;
        debugLog(`Found local component "${component.name}"`);
      }
    }

    // If not found locally, try to import as remote component by key
    if (!component) {
      debugLog(`Trying to import remote component with key: ${componentKey}...`);
      try {
        component = await figma.importComponentByKeyAsync(componentKey);
        if (component) {
          debugLog(`Imported remote component "${component.name}"`);
        }
      } catch (importError) {
        const errMsg = importError instanceof Error ? importError.message : String(importError);
        console.error(`Failed to import remote component: ${errMsg}`);
        // Don't throw yet - provide helpful error message below
      }
    }

    if (!component) {
      throw new Error(`Component not found. For local components, use the component's node ID (e.g., "123:456"). For library components, use the component key. Key provided: "${componentKey}"`);
    }

    // Create instance and set properties
    debugLog(`Creating instance of "${component.name}"...`);
    const instance = component.createInstance();
    instance.x = x;
    instance.y = y;

    // Add to parent or current page
    if (parentId) {
      const parent = await figma.getNodeByIdAsync(parentId);
      if (!parent) {
        throw new Error(`Parent node with ID ${parentId} not found`);
      }
      if ('appendChild' in parent) {
        parent.appendChild(instance);
      } else {
        throw new Error(`Parent node "${parent.name}" cannot contain children (type: ${parent.type})`);
      }
    } else {
      figma.currentPage.appendChild(instance);
    }

    debugLog(`Component instance "${instance.name}" created successfully at (${x}, ${y})`);

    return {
      id: instance.id,
      name: instance.name,
      x: instance.x,
      y: instance.y,
      width: instance.width,
      height: instance.height,
      componentId: instance.componentId,
      parentId: parentId || figma.currentPage.id
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error in createComponentInstance: ${errorMessage}`);
    throw new Error(errorMessage || `Failed to create component instance for "${componentKey}"`);
  }
}

async function exportNodeAsImage(params) {
  const { nodeId, scale = 1 } = params || {};

  const format = "PNG";
  const MAX_DIMENSION = 7680; // Stay under Claude's 8000px limit with some margin

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("exportAsync" in node)) {
    throw new Error(`Node does not support exporting: ${nodeId}`);
  }

  try {
    // Get node dimensions
    const nodeWidth = node.width || 0;
    const nodeHeight = node.height || 0;

    // Calculate scaled dimensions
    let finalScale = scale;
    const scaledWidth = nodeWidth * scale;
    const scaledHeight = nodeHeight * scale;

    // Auto-reduce scale if dimensions would exceed max
    if (scaledWidth > MAX_DIMENSION || scaledHeight > MAX_DIMENSION) {
      const maxDimension = Math.max(scaledWidth, scaledHeight);
      finalScale = (MAX_DIMENSION / maxDimension) * scale;
      debugLog(`exportNodeAsImage: Auto-reducing scale from ${scale} to ${finalScale.toFixed(3)} to fit within ${MAX_DIMENSION}px limit`);
    }

    const settings = {
      format: format,
      constraint: { type: "SCALE", value: finalScale },
    };

    const bytes = await node.exportAsync(settings);

    let mimeType;
    switch (format) {
      case "PNG":
        mimeType = "image/png";
        break;
      case "JPG":
        mimeType = "image/jpeg";
        break;
      case "SVG":
        mimeType = "image/svg+xml";
        break;
      case "PDF":
        mimeType = "application/pdf";
        break;
      default:
        mimeType = "application/octet-stream";
    }

    // Proper way to convert Uint8Array to base64
    const base64 = customBase64Encode(bytes);

    return {
      nodeId,
      format,
      requestedScale: scale,
      actualScale: finalScale,
      originalWidth: nodeWidth,
      originalHeight: nodeHeight,
      exportedWidth: Math.round(nodeWidth * finalScale),
      exportedHeight: Math.round(nodeHeight * finalScale),
      mimeType,
      imageData: base64,
    };
  } catch (error) {
    throw new Error(`Error exporting node as image: ${error.message}`);
  }
}
function customBase64Encode(bytes) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let base64 = "";

  const byteLength = bytes.byteLength;
  const byteRemainder = byteLength % 3;
  const mainLength = byteLength - byteRemainder;

  let a, b, c, d;
  let chunk;

  // Main loop deals with bytes in chunks of 3
  for (let i = 0; i < mainLength; i = i + 3) {
    // Combine the three bytes into a single integer
    chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];

    // Use bitmasks to extract 6-bit segments from the triplet
    a = (chunk & 16515072) >> 18; // 16515072 = (2^6 - 1) << 18
    b = (chunk & 258048) >> 12; // 258048 = (2^6 - 1) << 12
    c = (chunk & 4032) >> 6; // 4032 = (2^6 - 1) << 6
    d = chunk & 63; // 63 = 2^6 - 1

    // Convert the raw binary segments to the appropriate ASCII encoding
    base64 += chars[a] + chars[b] + chars[c] + chars[d];
  }

  // Deal with the remaining bytes and padding
  if (byteRemainder === 1) {
    chunk = bytes[mainLength];

    a = (chunk & 252) >> 2; // 252 = (2^6 - 1) << 2

    // Set the 4 least significant bits to zero
    b = (chunk & 3) << 4; // 3 = 2^2 - 1

    base64 += chars[a] + chars[b] + "==";
  } else if (byteRemainder === 2) {
    chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];

    a = (chunk & 64512) >> 10; // 64512 = (2^6 - 1) << 10
    b = (chunk & 1008) >> 4; // 1008 = (2^6 - 1) << 4

    // Set the 2 least significant bits to zero
    c = (chunk & 15) << 2; // 15 = 2^4 - 1

    base64 += chars[a] + chars[b] + chars[c] + "=";
  }

  return base64;
}

async function setCornerRadius(params) {
  const { nodeId, radius, corners } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (radius === undefined) {
    throw new Error("Missing radius parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Check if node supports corner radius
  if (!("cornerRadius" in node)) {
    throw new Error(`Node does not support corner radius: ${nodeId}`);
  }

  // If corners array is provided, set individual corner radii
  if (corners && Array.isArray(corners) && corners.length === 4) {
    if ("topLeftRadius" in node) {
      // Node supports individual corner radii
      if (corners[0]) node.topLeftRadius = radius;
      if (corners[1]) node.topRightRadius = radius;
      if (corners[2]) node.bottomRightRadius = radius;
      if (corners[3]) node.bottomLeftRadius = radius;
    } else {
      // Node only supports uniform corner radius
      node.cornerRadius = radius;
    }
  } else {
    // Set uniform corner radius
    node.cornerRadius = radius;
  }

  return {
    id: node.id,
    name: node.name,
    cornerRadius: "cornerRadius" in node ? node.cornerRadius : undefined,
    topLeftRadius: "topLeftRadius" in node ? node.topLeftRadius : undefined,
    topRightRadius: "topRightRadius" in node ? node.topRightRadius : undefined,
    bottomRightRadius:
      "bottomRightRadius" in node ? node.bottomRightRadius : undefined,
    bottomLeftRadius:
      "bottomLeftRadius" in node ? node.bottomLeftRadius : undefined,
  };
}

async function setTextContent(params) {
  const { nodeId, text } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (text === undefined) {
    throw new Error("Missing text parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    await figma.loadFontAsync(node.fontName);

    await setCharacters(node, text);

    return {
      id: node.id,
      name: node.name,
      characters: node.characters,
      fontName: node.fontName,
    };
  } catch (error) {
    throw new Error(`Error setting text content: ${error.message}`);
  }
}

// Initialize settings on load
(async function initializePlugin() {
  try {
    const savedSettings = await figma.clientStorage.getAsync("settings");
    if (savedSettings) {
      if (savedSettings.serverPort) {
        state.serverPort = savedSettings.serverPort;
      }
    }

    // Send initial settings to UI
    figma.ui.postMessage({
      type: "init-settings",
      settings: {
        serverPort: state.serverPort,
      },
    });
  } catch (error) {
    console.error("Error loading settings:", error);
  }
})();

function uniqBy(arr, predicate) {
  const cb = typeof predicate === "function" ? predicate : (o) => o[predicate];
  return [
    ...arr
      .reduce((map, item) => {
        const key = item === null || item === undefined ? item : cb(item);

        map.has(key) || map.set(key, item);

        return map;
      }, new Map())
      .values(),
  ];
}
const setCharacters = async (node, characters, options) => {
  const fallbackFont = (options && options.fallbackFont) || {
    family: "Inter",
    style: "Regular",
  };
  try {
    if (node.fontName === figma.mixed) {
      if (options && options.smartStrategy === "prevail") {
        const fontHashTree = {};
        for (let i = 1; i < node.characters.length; i++) {
          const charFont = node.getRangeFontName(i - 1, i);
          const key = `${charFont.family}::${charFont.style}`;
          fontHashTree[key] = fontHashTree[key] ? fontHashTree[key] + 1 : 1;
        }
        const prevailedTreeItem = Object.entries(fontHashTree).sort(
          (a, b) => b[1] - a[1]
        )[0];
        const [family, style] = prevailedTreeItem[0].split("::");
        const prevailedFont = {
          family,
          style,
        };
        await figma.loadFontAsync(prevailedFont);
        node.fontName = prevailedFont;
      } else if (options && options.smartStrategy === "strict") {
        return setCharactersWithStrictMatchFont(node, characters, fallbackFont);
      } else if (options && options.smartStrategy === "experimental") {
        return setCharactersWithSmartMatchFont(node, characters, fallbackFont);
      } else {
        const firstCharFont = node.getRangeFontName(0, 1);
        await figma.loadFontAsync(firstCharFont);
        node.fontName = firstCharFont;
      }
    } else {
      await figma.loadFontAsync({
        family: node.fontName.family,
        style: node.fontName.style,
      });
    }
  } catch (err) {
    console.warn(
      `Failed to load "${node.fontName["family"]} ${node.fontName["style"]}" font and replaced with fallback "${fallbackFont.family} ${fallbackFont.style}"`,
      err
    );
    await figma.loadFontAsync(fallbackFont);
    node.fontName = fallbackFont;
  }
  try {
    node.characters = characters;
    return true;
  } catch (err) {
    console.warn(`Failed to set characters. Skipped.`, err);
    return false;
  }
};

const setCharactersWithStrictMatchFont = async (
  node,
  characters,
  fallbackFont
) => {
  const fontHashTree = {};
  for (let i = 1; i < node.characters.length; i++) {
    const startIdx = i - 1;
    const startCharFont = node.getRangeFontName(startIdx, i);
    const startCharFontVal = `${startCharFont.family}::${startCharFont.style}`;
    while (i < node.characters.length) {
      i++;
      const charFont = node.getRangeFontName(i - 1, i);
      if (startCharFontVal !== `${charFont.family}::${charFont.style}`) {
        break;
      }
    }
    fontHashTree[`${startIdx}_${i}`] = startCharFontVal;
  }
  await figma.loadFontAsync(fallbackFont);
  node.fontName = fallbackFont;
  node.characters = characters;
  debugLog(fontHashTree);
  await Promise.all(
    Object.keys(fontHashTree).map(async (range) => {
      debugLog(range, fontHashTree[range]);
      const [start, end] = range.split("_");
      const [family, style] = fontHashTree[range].split("::");
      const matchedFont = {
        family,
        style,
      };
      await figma.loadFontAsync(matchedFont);
      return node.setRangeFontName(Number(start), Number(end), matchedFont);
    })
  );
  return true;
};

const getDelimiterPos = (str, delimiter, startIdx = 0, endIdx = str.length) => {
  const indices = [];
  let temp = startIdx;
  for (let i = startIdx; i < endIdx; i++) {
    if (
      str[i] === delimiter &&
      i + startIdx !== endIdx &&
      temp !== i + startIdx
    ) {
      indices.push([temp, i + startIdx]);
      temp = i + startIdx + 1;
    }
  }
  temp !== endIdx && indices.push([temp, endIdx]);
  return indices.filter(Boolean);
};

const buildLinearOrder = (node) => {
  const fontTree = [];
  const newLinesPos = getDelimiterPos(node.characters, "\n");
  newLinesPos.forEach(([newLinesRangeStart, newLinesRangeEnd], n) => {
    const newLinesRangeFont = node.getRangeFontName(
      newLinesRangeStart,
      newLinesRangeEnd
    );
    if (newLinesRangeFont === figma.mixed) {
      const spacesPos = getDelimiterPos(
        node.characters,
        " ",
        newLinesRangeStart,
        newLinesRangeEnd
      );
      spacesPos.forEach(([spacesRangeStart, spacesRangeEnd], s) => {
        const spacesRangeFont = node.getRangeFontName(
          spacesRangeStart,
          spacesRangeEnd
        );
        if (spacesRangeFont === figma.mixed) {
          const spacesRangeFont = node.getRangeFontName(
            spacesRangeStart,
            spacesRangeStart[0]
          );
          fontTree.push({
            start: spacesRangeStart,
            delimiter: " ",
            family: spacesRangeFont.family,
            style: spacesRangeFont.style,
          });
        } else {
          fontTree.push({
            start: spacesRangeStart,
            delimiter: " ",
            family: spacesRangeFont.family,
            style: spacesRangeFont.style,
          });
        }
      });
    } else {
      fontTree.push({
        start: newLinesRangeStart,
        delimiter: "\n",
        family: newLinesRangeFont.family,
        style: newLinesRangeFont.style,
      });
    }
  });
  return fontTree
    .sort((a, b) => +a.start - +b.start)
    .map(({ family, style, delimiter }) => ({ family, style, delimiter }));
};

const setCharactersWithSmartMatchFont = async (
  node,
  characters,
  fallbackFont
) => {
  const rangeTree = buildLinearOrder(node);
  const fontsToLoad = uniqBy(
    rangeTree,
    ({ family, style }) => `${family}::${style}`
  ).map(({ family, style }) => ({
    family,
    style,
  }));

  await Promise.all([...fontsToLoad, fallbackFont].map(figma.loadFontAsync));

  node.fontName = fallbackFont;
  node.characters = characters;

  let prevPos = 0;
  rangeTree.forEach(({ family, style, delimiter }) => {
    if (prevPos < node.characters.length) {
      const delimeterPos = node.characters.indexOf(delimiter, prevPos);
      const endPos =
        delimeterPos > prevPos ? delimeterPos : node.characters.length;
      const matchedFont = {
        family,
        style,
      };
      node.setRangeFontName(prevPos, endPos, matchedFont);
      prevPos = endPos + 1;
    }
  });
  return true;
};

// Add the cloneNode function implementation
async function cloneNode(params) {
  const { nodeId, x, y } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Clone the node
  const clone = node.clone();

  // If x and y are provided, move the clone to that position
  if (x !== undefined && y !== undefined) {
    if (!("x" in clone) || !("y" in clone)) {
      throw new Error(`Cloned node does not support position: ${nodeId}`);
    }
    clone.x = x;
    clone.y = y;
  }

  // Add the clone to the same parent as the original node
  if (node.parent) {
    node.parent.appendChild(clone);
  } else {
    figma.currentPage.appendChild(clone);
  }

  return {
    id: clone.id,
    name: clone.name,
    x: "x" in clone ? clone.x : undefined,
    y: "y" in clone ? clone.y : undefined,
    width: "width" in clone ? clone.width : undefined,
    height: "height" in clone ? clone.height : undefined,
  };
}

async function scanTextNodes(params) {
  debugLog(`Starting to scan text nodes from node ID: ${params.nodeId}`);
  const { nodeId, useChunking = true, chunkSize = 10, commandId = generateCommandId() } = params || {};
  
  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    console.error(`Node with ID ${nodeId} not found`);
    // Send error progress update
    sendProgressUpdate(
      commandId,
      'scan_text_nodes',
      'error',
      0,
      0,
      0,
      `Node with ID ${nodeId} not found`,
      { error: `Node not found: ${nodeId}` }
    );
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // If chunking is not enabled, use the original implementation
  if (!useChunking) {
    const textNodes = [];
    try {
      // Send started progress update
      sendProgressUpdate(
        commandId,
        'scan_text_nodes',
        'started',
        0,
        1, // Not known yet how many nodes there are
        0,
        `Starting scan of node "${node.name || nodeId}" without chunking`,
        null
      );

      await findTextNodes(node, [], 0, textNodes);
      
      // Send completed progress update
      sendProgressUpdate(
        commandId,
        'scan_text_nodes',
        'completed',
        100,
        textNodes.length,
        textNodes.length,
        `Scan complete. Found ${textNodes.length} text nodes.`,
        { textNodes }
      );

      return {
        success: true,
        message: `Scanned ${textNodes.length} text nodes.`,
        count: textNodes.length,
        textNodes: textNodes, 
        commandId
      };
    } catch (error) {
      console.error("Error scanning text nodes:", error);
      
      // Send error progress update
      sendProgressUpdate(
        commandId,
        'scan_text_nodes',
        'error',
        0,
        0,
        0,
        `Error scanning text nodes: ${error.message}`,
        { error: error.message }
      );
      
      throw new Error(`Error scanning text nodes: ${error.message}`);
    }
  }
  
  // Chunked implementation
  debugLog(`Using chunked scanning with chunk size: ${chunkSize}`);
  
  // First, collect all nodes to process (without processing them yet)
  const nodesToProcess = [];
  
  // Send started progress update
  sendProgressUpdate(
    commandId,
    'scan_text_nodes',
    'started',
    0,
    0, // Not known yet how many nodes there are
    0,
    `Starting chunked scan of node "${node.name || nodeId}"`,
    { chunkSize }
  );
  
  await collectNodesToProcess(node, [], 0, nodesToProcess);
  
  const totalNodes = nodesToProcess.length;
  debugLog(`Found ${totalNodes} total nodes to process`);
  
  // Calculate number of chunks needed
  const totalChunks = Math.ceil(totalNodes / chunkSize);
  debugLog(`Will process in ${totalChunks} chunks`);
  
  // Send update after node collection
  sendProgressUpdate(
    commandId,
    'scan_text_nodes',
    'in_progress',
    5, // 5% progress for collection phase
    totalNodes,
    0,
    `Found ${totalNodes} nodes to scan. Will process in ${totalChunks} chunks.`,
    {
      totalNodes,
      totalChunks,
      chunkSize
    }
  );
  
  // Process nodes in chunks
  const allTextNodes = [];
  let processedNodes = 0;
  let chunksProcessed = 0;
  
  for (let i = 0; i < totalNodes; i += chunkSize) {
    const chunkEnd = Math.min(i + chunkSize, totalNodes);
    debugLog(`Processing chunk ${chunksProcessed + 1}/${totalChunks} (nodes ${i} to ${chunkEnd - 1})`);
    
    // Send update before processing chunk
    sendProgressUpdate(
      commandId,
      'scan_text_nodes',
      'in_progress',
      Math.round(5 + ((chunksProcessed / totalChunks) * 90)), // 5-95% for processing
      totalNodes,
      processedNodes,
      `Processing chunk ${chunksProcessed + 1}/${totalChunks}`,
      {
        currentChunk: chunksProcessed + 1,
        totalChunks,
        textNodesFound: allTextNodes.length
      }
    );
    
    const chunkNodes = nodesToProcess.slice(i, chunkEnd);
    const chunkTextNodes = [];
    
    // Process each node in this chunk
    for (const nodeInfo of chunkNodes) {
      if (nodeInfo.node.type === "TEXT") {
        try {
          const textNodeInfo = await processTextNode(nodeInfo.node, nodeInfo.parentPath, nodeInfo.depth);
          if (textNodeInfo) {
            chunkTextNodes.push(textNodeInfo);
          }
        } catch (error) {
          console.error(`Error processing text node: ${error.message}`);
          // Continue with other nodes
        }
      }
      
      // Brief delay to allow UI updates and prevent freezing
      await delay(5);
    }
    
    // Add results from this chunk
    allTextNodes.push(...chunkTextNodes);
    processedNodes += chunkNodes.length;
    chunksProcessed++;
    
    // Send update after processing chunk
    sendProgressUpdate(
      commandId,
      'scan_text_nodes',
      'in_progress',
      Math.round(5 + ((chunksProcessed / totalChunks) * 90)), // 5-95% for processing
      totalNodes,
      processedNodes,
      `Processed chunk ${chunksProcessed}/${totalChunks}. Found ${allTextNodes.length} text nodes so far.`,
      {
        currentChunk: chunksProcessed,
        totalChunks,
        processedNodes,
        textNodesFound: allTextNodes.length,
        chunkResult: chunkTextNodes
      }
    );
    
    // Small delay between chunks to prevent UI freezing
    if (i + chunkSize < totalNodes) {
      await delay(50);
    }
  }
  
  // Send completed progress update
  sendProgressUpdate(
    commandId,
    'scan_text_nodes',
    'completed',
    100,
    totalNodes,
    processedNodes,
    `Scan complete. Found ${allTextNodes.length} text nodes.`,
    {
      textNodes: allTextNodes,
      processedNodes,
      chunks: chunksProcessed
    }
  );
  
  return {
    success: true,
    message: `Chunked scan complete. Found ${allTextNodes.length} text nodes.`,
    totalNodes: allTextNodes.length,
    processedNodes: processedNodes,
    chunks: chunksProcessed,
    textNodes: allTextNodes,
    commandId
  };
}

// Helper function to collect all nodes that need to be processed
async function collectNodesToProcess(node, parentPath = [], depth = 0, nodesToProcess = []) {
  // Skip invisible nodes
  if (node.visible === false) return;
  
  // Get the path to this node
  const nodePath = [...parentPath, node.name || `Unnamed ${node.type}`];
  
  // Add this node to the processing list
  nodesToProcess.push({
    node: node,
    parentPath: nodePath,
    depth: depth
  });
  
  // Recursively add children
  if ("children" in node) {
    for (const child of node.children) {
      await collectNodesToProcess(child, nodePath, depth + 1, nodesToProcess);
    }
  }
}

// Process a single text node
async function processTextNode(node, parentPath, depth) {
  if (node.type !== "TEXT") return null;
  
  try {
    // Safely extract font information
    let fontFamily = "";
    let fontStyle = "";

    if (node.fontName) {
      if (typeof node.fontName === "object") {
        if ("family" in node.fontName) fontFamily = node.fontName.family;
        if ("style" in node.fontName) fontStyle = node.fontName.style;
      }
    }

    // Create a safe representation of the text node
    const safeTextNode = {
      id: node.id,
      name: node.name || "Text",
      type: node.type,
      characters: node.characters,
      fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
      fontFamily: fontFamily,
      fontStyle: fontStyle,
      x: typeof node.x === "number" ? node.x : 0,
      y: typeof node.y === "number" ? node.y : 0,
      width: typeof node.width === "number" ? node.width : 0,
      height: typeof node.height === "number" ? node.height : 0,
      path: parentPath.join(" > "),
      depth: depth,
    };

    // Highlight the node briefly (optional visual feedback)
    try {
      const originalFills = JSON.parse(JSON.stringify(node.fills));
      node.fills = [
        {
          type: "SOLID",
          color: { r: 1, g: 0.5, b: 0 },
          opacity: 0.3,
        },
      ];

      // Brief delay for the highlight to be visible
      await delay(100);
      
      try {
        node.fills = originalFills;
      } catch (err) {
        console.error("Error resetting fills:", err);
      }
    } catch (highlightErr) {
      console.error("Error highlighting text node:", highlightErr);
      // Continue anyway, highlighting is just visual feedback
    }

    return safeTextNode;
  } catch (nodeErr) {
    console.error("Error processing text node:", nodeErr);
    return null;
  }
}

// A delay function that returns a promise
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Keep the original findTextNodes for backward compatibility
async function findTextNodes(node, parentPath = [], depth = 0, textNodes = []) {
  // Skip invisible nodes
  if (node.visible === false) return;

  // Get the path to this node including its name
  const nodePath = [...parentPath, node.name || `Unnamed ${node.type}`];

  if (node.type === "TEXT") {
    try {
      // Safely extract font information to avoid Symbol serialization issues
      let fontFamily = "";
      let fontStyle = "";

      if (node.fontName) {
        if (typeof node.fontName === "object") {
          if ("family" in node.fontName) fontFamily = node.fontName.family;
          if ("style" in node.fontName) fontStyle = node.fontName.style;
        }
      }

      // Create a safe representation of the text node with only serializable properties
      const safeTextNode = {
        id: node.id,
        name: node.name || "Text",
        type: node.type,
        characters: node.characters,
        fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
        fontFamily: fontFamily,
        fontStyle: fontStyle,
        x: typeof node.x === "number" ? node.x : 0,
        y: typeof node.y === "number" ? node.y : 0,
        width: typeof node.width === "number" ? node.width : 0,
        height: typeof node.height === "number" ? node.height : 0,
        path: nodePath.join(" > "),
        depth: depth,
      };

      // Only highlight the node if it's not being done via API
      try {
        // Safe way to create a temporary highlight without causing serialization issues
        const originalFills = JSON.parse(JSON.stringify(node.fills));
        node.fills = [
          {
            type: "SOLID",
            color: { r: 1, g: 0.5, b: 0 },
            opacity: 0.3,
          },
        ];

        // Promise-based delay instead of setTimeout
        await delay(500);
        
        try {
          node.fills = originalFills;
        } catch (err) {
          console.error("Error resetting fills:", err);
        }
      } catch (highlightErr) {
        console.error("Error highlighting text node:", highlightErr);
        // Continue anyway, highlighting is just visual feedback
      }

      textNodes.push(safeTextNode);
    } catch (nodeErr) {
      console.error("Error processing text node:", nodeErr);
      // Skip this node but continue with others
    }
  }

  // Recursively process children of container nodes
  if ("children" in node) {
    for (const child of node.children) {
      await findTextNodes(child, nodePath, depth + 1, textNodes);
    }
  }
}

// Replace text in a specific node
async function setMultipleTextContents(params) {
  const { nodeId, text } = params || {};
  const commandId = params.commandId || generateCommandId();

  if (!nodeId || !text || !Array.isArray(text)) {
    const errorMsg = "Missing required parameters: nodeId and text array";
    
    // Send error progress update
    sendProgressUpdate(
      commandId,
      'set_multiple_text_contents',
      'error',
      0,
      0,
      0,
      errorMsg,
      { error: errorMsg }
    );
    
    throw new Error(errorMsg);
  }

  debugLog(
    `Starting text replacement for node: ${nodeId} with ${text.length} text replacements`
  );
  
  // Send started progress update
  sendProgressUpdate(
    commandId,
    'set_multiple_text_contents',
    'started',
    0,
    text.length,
    0,
    `Starting text replacement for ${text.length} nodes`,
    { totalReplacements: text.length }
  );

  // Define the results array and counters
  const results = [];
  let successCount = 0;
  let failureCount = 0;

  // Split text replacements into chunks of 5
  const CHUNK_SIZE = 5;
  const chunks = [];
  
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }
  
  debugLog(`Split ${text.length} replacements into ${chunks.length} chunks`);
  
  // Send chunking info update
  sendProgressUpdate(
    commandId,
    'set_multiple_text_contents',
    'in_progress',
    5, // 5% progress for planning phase
    text.length,
    0,
    `Preparing to replace text in ${text.length} nodes using ${chunks.length} chunks`,
    {
      totalReplacements: text.length,
      chunks: chunks.length,
      chunkSize: CHUNK_SIZE
    }
  );

  // Process each chunk sequentially
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    debugLog(`Processing chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length} replacements`);
    
    // Send chunk processing start update
    sendProgressUpdate(
      commandId,
      'set_multiple_text_contents',
      'in_progress',
      Math.round(5 + ((chunkIndex / chunks.length) * 90)), // 5-95% for processing
      text.length,
      successCount + failureCount,
      `Processing text replacements chunk ${chunkIndex + 1}/${chunks.length}`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount
      }
    );
    
    // Process replacements within a chunk in parallel
    const chunkPromises = chunk.map(async (replacement) => {
      if (!replacement.nodeId || replacement.text === undefined) {
        console.error(`Missing nodeId or text for replacement`);
        return {
          success: false,
          nodeId: replacement.nodeId || "unknown",
          error: "Missing nodeId or text in replacement entry"
        };
      }

      try {
        debugLog(`Attempting to replace text in node: ${replacement.nodeId}`);

        // Get the text node to update (just to check it exists and get original text)
        const textNode = await figma.getNodeByIdAsync(replacement.nodeId);

        if (!textNode) {
          console.error(`Text node not found: ${replacement.nodeId}`);
          return {
            success: false,
            nodeId: replacement.nodeId,
            error: `Node not found: ${replacement.nodeId}`
          };
        }

        if (textNode.type !== "TEXT") {
          console.error(`Node is not a text node: ${replacement.nodeId} (type: ${textNode.type})`);
          return {
            success: false,
            nodeId: replacement.nodeId,
            error: `Node is not a text node: ${replacement.nodeId} (type: ${textNode.type})`
          };
        }

        // Save original text for the result
        const originalText = textNode.characters;
        debugLog(`Original text: "${originalText}"`);
        debugLog(`Will translate to: "${replacement.text}"`);

        // Highlight the node before changing text
        let originalFills;
        try {
          // Save original fills for restoration later
          originalFills = JSON.parse(JSON.stringify(textNode.fills));
          // Apply highlight color (orange with 30% opacity)
          textNode.fills = [
            {
              type: "SOLID",
              color: { r: 1, g: 0.5, b: 0 },
              opacity: 0.3,
            },
          ];
        } catch (highlightErr) {
          console.error(`Error highlighting text node: ${highlightErr.message}`);
          // Continue anyway, highlighting is just visual feedback
        }

        // Use the existing setTextContent function to handle font loading and text setting
        await setTextContent({
          nodeId: replacement.nodeId,
          text: replacement.text
        });

        // Keep highlight for a moment after text change, then restore original fills
        if (originalFills) {
          try {
            // Use delay function for consistent timing
            await delay(500);
            textNode.fills = originalFills;
          } catch (restoreErr) {
            console.error(`Error restoring fills: ${restoreErr.message}`);
          }
        }

        debugLog(`Successfully replaced text in node: ${replacement.nodeId}`);
        return {
          success: true,
          nodeId: replacement.nodeId,
          originalText: originalText,
          translatedText: replacement.text
        };
      } catch (error) {
        console.error(`Error replacing text in node ${replacement.nodeId}: ${error.message}`);
        return {
          success: false,
          nodeId: replacement.nodeId,
          error: `Error applying replacement: ${error.message}`
        };
      }
    });

    // Wait for all replacements in this chunk to complete
    const chunkResults = await Promise.all(chunkPromises);
    
    // Process results for this chunk
    chunkResults.forEach(result => {
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
      results.push(result);
    });
    
    // Send chunk processing complete update with partial results
    sendProgressUpdate(
      commandId,
      'set_multiple_text_contents',
      'in_progress',
      Math.round(5 + (((chunkIndex + 1) / chunks.length) * 90)), // 5-95% for processing
      text.length,
      successCount + failureCount,
      `Completed chunk ${chunkIndex + 1}/${chunks.length}. ${successCount} successful, ${failureCount} failed so far.`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
        chunkResults: chunkResults
      }
    );
    
    // Add a small delay between chunks to avoid overloading Figma
    if (chunkIndex < chunks.length - 1) {
      debugLog('Pausing between chunks to avoid overloading Figma...');
      await delay(1000); // 1 second delay between chunks
    }
  }

  debugLog(
    `Replacement complete: ${successCount} successful, ${failureCount} failed`
  );
  
  // Send completed progress update
  sendProgressUpdate(
    commandId,
    'set_multiple_text_contents',
    'completed',
    100,
    text.length,
    successCount + failureCount,
    `Text replacement complete: ${successCount} successful, ${failureCount} failed`,
    {
      totalReplacements: text.length,
      replacementsApplied: successCount,
      replacementsFailed: failureCount,
      completedInChunks: chunks.length,
      results: results
    }
  );

  return {
    success: successCount > 0,
    nodeId: nodeId,
    replacementsApplied: successCount,
    replacementsFailed: failureCount,
    totalReplacements: text.length,
    results: results,
    completedInChunks: chunks.length,
    commandId
  };
}

// Function to generate simple UUIDs for command IDs
function generateCommandId() {
  return 'cmd_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

async function setAutoLayout(params) {
  const { 
    nodeId, 
    layoutMode, 
    paddingTop, 
    paddingBottom, 
    paddingLeft, 
    paddingRight, 
    itemSpacing, 
    primaryAxisAlignItems, 
    counterAxisAlignItems, 
    layoutWrap, 
    strokesIncludedInLayout 
  } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (!layoutMode) {
    throw new Error("Missing layoutMode parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Check if the node is a frame or group
  if (!("layoutMode" in node)) {
    throw new Error(`Node does not support auto layout: ${nodeId}`);
  }

  // Configure layout mode
  if (layoutMode === "NONE") {
    node.layoutMode = "NONE";
  } else {
    // Set auto layout properties
    node.layoutMode = layoutMode;
    
    // Configure padding if provided
    if (paddingTop !== undefined) node.paddingTop = paddingTop;
    if (paddingBottom !== undefined) node.paddingBottom = paddingBottom;
    if (paddingLeft !== undefined) node.paddingLeft = paddingLeft;
    if (paddingRight !== undefined) node.paddingRight = paddingRight;
    
    // Configure item spacing
    if (itemSpacing !== undefined) node.itemSpacing = itemSpacing;
    
    // Configure alignment
    if (primaryAxisAlignItems !== undefined) {
      node.primaryAxisAlignItems = primaryAxisAlignItems;
    }
    
    if (counterAxisAlignItems !== undefined) {
      node.counterAxisAlignItems = counterAxisAlignItems;
    }
    
    // Configure wrap
    if (layoutWrap !== undefined) {
      node.layoutWrap = layoutWrap;
    }
    
    // Configure stroke inclusion
    if (strokesIncludedInLayout !== undefined) {
      node.strokesIncludedInLayout = strokesIncludedInLayout;
    }
  }

  return {
    id: node.id,
    name: node.name,
    layoutMode: node.layoutMode,
    paddingTop: node.paddingTop,
    paddingBottom: node.paddingBottom,
    paddingLeft: node.paddingLeft,
    paddingRight: node.paddingRight,
    itemSpacing: node.itemSpacing,
    primaryAxisAlignItems: node.primaryAxisAlignItems,
    counterAxisAlignItems: node.counterAxisAlignItems,
    layoutWrap: node.layoutWrap,
    strokesIncludedInLayout: node.strokesIncludedInLayout
  };
}

// Nuevas funciones para propiedades de texto

async function setFontName(params) {
  const { nodeId, family, style } = params || {};
  if (!nodeId || !family) {
    throw new Error("Missing nodeId or font family");
  }
  
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  
  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }
  
  try {
    await figma.loadFontAsync({ family, style: style || "Regular" });
    node.fontName = { family, style: style || "Regular" };
    return {
      id: node.id,
      name: node.name,
      fontName: node.fontName
    };
  } catch (error) {
    throw new Error(`Error setting font name: ${error.message}`);
  }
}

async function setFontSize(params) {
  const { nodeId, fontSize } = params || {};
  if (!nodeId || fontSize === undefined) {
    throw new Error("Missing nodeId or fontSize");
  }
  
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  
  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }
  
  try {
    await figma.loadFontAsync(node.fontName);
    node.fontSize = fontSize;
    return {
      id: node.id,
      name: node.name,
      fontSize: node.fontSize
    };
  } catch (error) {
    throw new Error(`Error setting font size: ${error.message}`);
  }
}

async function setFontWeight(params) {
  const { nodeId, weight } = params || {};
  if (!nodeId || weight === undefined) {
    throw new Error("Missing nodeId or weight");
  }
  
  // Map weight to font style
  const getFontStyle = (weight) => {
    switch (weight) {
      case 100: return "Thin";
      case 200: return "Extra Light";
      case 300: return "Light";
      case 400: return "Regular";
      case 500: return "Medium";
      case 600: return "Semi Bold";
      case 700: return "Bold";
      case 800: return "Extra Bold";
      case 900: return "Black";
      default: return "Regular";
    }
  };
  
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  
  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }
  
  try {
    const family = node.fontName.family;
    const style = getFontStyle(weight);
    await figma.loadFontAsync({ family, style });
    node.fontName = { family, style };
    return {
      id: node.id,
      name: node.name,
      fontName: node.fontName,
      weight: weight
    };
  } catch (error) {
    throw new Error(`Error setting font weight: ${error.message}`);
  }
}

async function setLetterSpacing(params) {
  const { nodeId, letterSpacing, unit = "PIXELS" } = params || {};
  if (!nodeId || letterSpacing === undefined) {
    throw new Error("Missing nodeId or letterSpacing");
  }
  
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  
  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }
  
  try {
    await figma.loadFontAsync(node.fontName);
    node.letterSpacing = { value: letterSpacing, unit };
    return {
      id: node.id,
      name: node.name,
      letterSpacing: node.letterSpacing
    };
  } catch (error) {
    throw new Error(`Error setting letter spacing: ${error.message}`);
  }
}

async function setLineHeight(params) {
  const { nodeId, lineHeight, unit = "PIXELS" } = params || {};
  if (!nodeId || lineHeight === undefined) {
    throw new Error("Missing nodeId or lineHeight");
  }
  
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  
  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }
  
  try {
    await figma.loadFontAsync(node.fontName);
    node.lineHeight = { value: lineHeight, unit };
    return {
      id: node.id,
      name: node.name,
      lineHeight: node.lineHeight
    };
  } catch (error) {
    throw new Error(`Error setting line height: ${error.message}`);
  }
}

async function setParagraphSpacing(params) {
  const { nodeId, paragraphSpacing } = params || {};
  if (!nodeId || paragraphSpacing === undefined) {
    throw new Error("Missing nodeId or paragraphSpacing");
  }
  
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  
  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }
  
  try {
    await figma.loadFontAsync(node.fontName);
    node.paragraphSpacing = paragraphSpacing;
    return {
      id: node.id,
      name: node.name,
      paragraphSpacing: node.paragraphSpacing
    };
  } catch (error) {
    throw new Error(`Error setting paragraph spacing: ${error.message}`);
  }
}

async function setTextCase(params) {
  const { nodeId, textCase } = params || {};
  if (!nodeId || textCase === undefined) {
    throw new Error("Missing nodeId or textCase");
  }
  
  // Valid textCase values: "ORIGINAL", "UPPER", "LOWER", "TITLE"
  if (!["ORIGINAL", "UPPER", "LOWER", "TITLE"].includes(textCase)) {
    throw new Error("Invalid textCase value. Must be one of: ORIGINAL, UPPER, LOWER, TITLE");
  }
  
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  
  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }
  
  try {
    await figma.loadFontAsync(node.fontName);
    node.textCase = textCase;
    return {
      id: node.id,
      name: node.name,
      textCase: node.textCase
    };
  } catch (error) {
    throw new Error(`Error setting text case: ${error.message}`);
  }
}

async function setTextDecoration(params) {
  const { nodeId, textDecoration } = params || {};
  if (!nodeId || textDecoration === undefined) {
    throw new Error("Missing nodeId or textDecoration");
  }
  
  // Valid textDecoration values: "NONE", "UNDERLINE", "STRIKETHROUGH"
  if (!["NONE", "UNDERLINE", "STRIKETHROUGH"].includes(textDecoration)) {
    throw new Error("Invalid textDecoration value. Must be one of: NONE, UNDERLINE, STRIKETHROUGH");
  }
  
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  
  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }
  
  try {
    await figma.loadFontAsync(node.fontName);
    node.textDecoration = textDecoration;
    return {
      id: node.id,
      name: node.name,
      textDecoration: node.textDecoration
    };
  } catch (error) {
    throw new Error(`Error setting text decoration: ${error.message}`);
  }
}

async function getStyledTextSegments(params) {
  const { nodeId, property } = params || {};
  if (!nodeId || !property) {
    throw new Error("Missing nodeId or property");
  }
  
  // Valid properties: "fillStyleId", "fontName", "fontSize", "textCase", 
  // "textDecoration", "textStyleId", "fills", "letterSpacing", "lineHeight", "fontWeight"
  const validProperties = [
    "fillStyleId", "fontName", "fontSize", "textCase", 
    "textDecoration", "textStyleId", "fills", "letterSpacing", 
    "lineHeight", "fontWeight"
  ];
  
  if (!validProperties.includes(property)) {
    throw new Error(`Invalid property. Must be one of: ${validProperties.join(", ")}`);
  }
  
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  
  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }
  
  try {
    const segments = node.getStyledTextSegments([property]);
    
    // Prepare segments data in a format safe for serialization
    const safeSegments = segments.map(segment => {
      const safeSegment = {
        characters: segment.characters,
        start: segment.start,
        end: segment.end
      };
      
      // Handle different property types for safe serialization
      if (property === "fontName") {
        if (segment[property] && typeof segment[property] === "object") {
          safeSegment[property] = {
            family: segment[property].family || "",
            style: segment[property].style || ""
          };
        } else {
          safeSegment[property] = { family: "", style: "" };
        }
      } else if (property === "letterSpacing" || property === "lineHeight") {
        // Handle spacing properties which have a value and unit
        if (segment[property] && typeof segment[property] === "object") {
          safeSegment[property] = {
            value: segment[property].value || 0,
            unit: segment[property].unit || "PIXELS"
          };
        } else {
          safeSegment[property] = { value: 0, unit: "PIXELS" };
        }
      } else if (property === "fills") {
        // Handle fills which can be complex
        safeSegment[property] = segment[property] ? JSON.parse(JSON.stringify(segment[property])) : [];
      } else {
        // Handle simple properties
        safeSegment[property] = segment[property];
      }
      
      return safeSegment;
    });
    
    return {
      id: node.id,
      name: node.name,
      property: property,
      segments: safeSegments
    };
  } catch (error) {
    throw new Error(`Error getting styled text segments: ${error.message}`);
  }
}

async function loadFontAsyncWrapper(params) {
  const { family, style = "Regular" } = params || {};
  if (!family) {
    throw new Error("Missing font family");
  }

  try {
    await figma.loadFontAsync({ family, style });
    return {
      success: true,
      family: family,
      style: style,
      message: `Successfully loaded ${family} ${style}`
    };
  } catch (error) {
    throw new Error(`Error loading font: ${error.message}`);
  }
}

async function createTextStyle(params) {
  const { nodeId, name, description } = params || {};

  if (!nodeId || !name) {
    throw new Error("Missing nodeId or name parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.type !== "TEXT") {
    throw new Error("Node is not a text node");
  }

  // Load the font to ensure it's available - with specific error handling
  try {
    await figma.loadFontAsync(node.fontName);
  } catch (error) {
    throw new Error(`Font "${node.fontName.family} ${node.fontName.style}" is not available. Please ensure the font is installed.`);
  }

  try {
    // Create the text style
    const textStyle = figma.createTextStyle();
    textStyle.name = name;
    if (description) {
      textStyle.description = description;
    }

    // Copy properties from the text node
    textStyle.fontSize = node.fontSize;
    textStyle.fontName = node.fontName;
    textStyle.letterSpacing = node.letterSpacing;
    textStyle.lineHeight = node.lineHeight;
    textStyle.paragraphIndent = node.paragraphIndent;
    textStyle.paragraphSpacing = node.paragraphSpacing;
    textStyle.textCase = node.textCase;
    textStyle.textDecoration = node.textDecoration;

    return {
      id: textStyle.id,
      name: textStyle.name,
      key: textStyle.key,
      fontName: textStyle.fontName,
      fontSize: textStyle.fontSize
    };
  } catch (error) {
    throw new Error(`Error creating text style: ${error.message}`);
  }
}

async function createTextStyleFromProperties(params) {
  const {
    name,
    fontSize,
    fontFamily,
    fontStyle,
    fontWeight,
    lineHeight,
    letterSpacing,
    textCase,
    textDecoration,
    description
  } = params || {};

  if (!name || !fontSize || !fontFamily) {
    throw new Error("Missing required parameters: name, fontSize, or fontFamily");
  }

  // Determine font style: prefer explicit fontStyle, then derive from fontWeight, then default to "Regular"
  // Note: Figma uses spaced names like "Semi Bold", "Extra Bold", "Extra Light"
  let actualFontStyle = fontStyle;
  if (!fontStyle && fontWeight) {
    if (fontWeight >= 900) actualFontStyle = "Black";
    else if (fontWeight >= 800) actualFontStyle = "Extra Bold";
    else if (fontWeight >= 700) actualFontStyle = "Bold";
    else if (fontWeight >= 600) actualFontStyle = "Semi Bold";
    else if (fontWeight >= 500) actualFontStyle = "Medium";
    else if (fontWeight >= 400) actualFontStyle = "Regular";
    else if (fontWeight >= 300) actualFontStyle = "Light";
    else if (fontWeight >= 200) actualFontStyle = "Extra Light";
    else if (fontWeight >= 100) actualFontStyle = "Thin";
    else actualFontStyle = "Regular";
  } else if (!fontStyle) {
    actualFontStyle = "Regular";
  }

  // Load the font FIRST - fail early before creating the style
  try {
    await figma.loadFontAsync({ family: fontFamily, style: actualFontStyle });
  } catch (error) {
    throw new Error(`Font "${fontFamily} ${actualFontStyle}" is not available. Please ensure the font is installed or use a different font.`);
  }

  try {
    // Create the text style only after font is confirmed available
    const textStyle = figma.createTextStyle();
    textStyle.name = name;
    if (description) {
      textStyle.description = description;
    }

    // Set properties
    textStyle.fontSize = fontSize;
    textStyle.fontName = { family: fontFamily, style: actualFontStyle };

    if (lineHeight) {
      textStyle.lineHeight = lineHeight;
    }

    if (letterSpacing) {
      textStyle.letterSpacing = letterSpacing;
    }

    if (textCase) {
      textStyle.textCase = textCase;
    }

    if (textDecoration) {
      textStyle.textDecoration = textDecoration;
    }

    return {
      id: textStyle.id,
      name: textStyle.name,
      key: textStyle.key,
      fontName: textStyle.fontName,
      fontSize: textStyle.fontSize
    };
  } catch (error) {
    throw new Error(`Error creating text style from properties: ${error.message}`);
  }
}

async function applyTextStyle(params) {
  const { nodeId, styleId } = params || {};

  if (!nodeId || !styleId) {
    throw new Error("Missing nodeId or styleId parameter");
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node || node.type !== "TEXT") {
      throw new Error("Node is not a text node");
    }

    const style = await figma.getStyleByIdAsync(styleId);
    if (!style || style.type !== "TEXT") {
      throw new Error("Style not found or is not a text style");
    }

    // Load the style's font (not the node's font which may be mixed)
    await figma.loadFontAsync(style.fontName);

    // Apply the style
    await node.setTextStyleIdAsync(styleId);

    return {
      nodeName: node.name,
      styleName: style.name
    };
  } catch (error) {
    throw new Error(`Error applying text style: ${error.message}`);
  }
}

async function getTextStyles() {
  try {
    const textStyles = await figma.getLocalTextStylesAsync();

    return {
      count: textStyles.length,
      styles: textStyles.map((style) => ({
        id: style.id,
        name: style.name,
        key: style.key,
        description: style.description || "",
        fontSize: style.fontSize,
        fontName: style.fontName,
        letterSpacing: style.letterSpacing,
        lineHeight: style.lineHeight,
        paragraphIndent: style.paragraphIndent,
        paragraphSpacing: style.paragraphSpacing,
        textCase: style.textCase,
        textDecoration: style.textDecoration
      }))
    };
  } catch (error) {
    throw new Error(`Error getting text styles: ${error.message}`);
  }
}

async function deleteTextStyle(params) {
  const { styleId } = params || {};

  if (!styleId) {
    throw new Error("Missing styleId parameter");
  }

  try {
    const style = await figma.getStyleByIdAsync(styleId);
    if (!style || style.type !== "TEXT") {
      throw new Error("Style not found or is not a text style");
    }

    const styleName = style.name;
    const styleIdCopy = style.id;

    // Remove the style
    style.remove();

    return {
      name: styleName,
      id: styleIdCopy
    };
  } catch (error) {
    throw new Error(`Error deleting text style: ${error.message}`);
  }
}

async function updateTextStyle(params) {
  const {
    styleId,
    name,
    description,
    fontSize,
    fontFamily,
    fontStyle,
    fontWeight,
    lineHeight,
    letterSpacing,
    textCase,
    textDecoration,
    paragraphSpacing,
    paragraphIndent
  } = params || {};

  if (!styleId) {
    throw new Error("Missing styleId parameter");
  }

  try {
    const style = await figma.getStyleByIdAsync(styleId);
    if (!style || style.type !== "TEXT") {
      throw new Error("Style not found or is not a text style");
    }

    const updatedProperties = [];

    // Update name if provided
    if (name !== undefined) {
      style.name = name;
      updatedProperties.push("name");
    }

    // Update description if provided
    if (description !== undefined) {
      style.description = description;
      updatedProperties.push("description");
    }

    // If font properties are being updated, we need to load the font first
    if (fontFamily !== undefined || fontStyle !== undefined || fontWeight !== undefined) {
      const newFontFamily = fontFamily || style.fontName.family;

      // Determine font style: prefer explicit fontStyle, then derive from fontWeight
      let newFontStyle = fontStyle;
      if (!fontStyle && fontWeight !== undefined) {
        // Convert fontWeight to fontStyle (Figma uses spaced names)
        if (fontWeight >= 900) newFontStyle = "Black";
        else if (fontWeight >= 800) newFontStyle = "Extra Bold";
        else if (fontWeight >= 700) newFontStyle = "Bold";
        else if (fontWeight >= 600) newFontStyle = "Semi Bold";
        else if (fontWeight >= 500) newFontStyle = "Medium";
        else if (fontWeight >= 400) newFontStyle = "Regular";
        else if (fontWeight >= 300) newFontStyle = "Light";
        else if (fontWeight >= 200) newFontStyle = "Extra Light";
        else if (fontWeight >= 100) newFontStyle = "Thin";
        else newFontStyle = "Regular";
      } else if (!fontStyle) {
        newFontStyle = style.fontName.style;
      }

      try {
        await figma.loadFontAsync({ family: newFontFamily, style: newFontStyle });
      } catch (error) {
        throw new Error(`Font "${newFontFamily} ${newFontStyle}" is not available. Please ensure the font is installed or use a different font.`);
      }
      style.fontName = { family: newFontFamily, style: newFontStyle };
      updatedProperties.push("fontName");
    }

    // Update fontSize if provided
    if (fontSize !== undefined) {
      style.fontSize = fontSize;
      updatedProperties.push("fontSize");
    }

    // Update lineHeight if provided
    if (lineHeight !== undefined) {
      style.lineHeight = lineHeight;
      updatedProperties.push("lineHeight");
    }

    // Update letterSpacing if provided
    if (letterSpacing !== undefined) {
      style.letterSpacing = letterSpacing;
      updatedProperties.push("letterSpacing");
    }

    // Update textCase if provided
    if (textCase !== undefined) {
      style.textCase = textCase;
      updatedProperties.push("textCase");
    }

    // Update textDecoration if provided
    if (textDecoration !== undefined) {
      style.textDecoration = textDecoration;
      updatedProperties.push("textDecoration");
    }

    // Update paragraphSpacing if provided
    if (paragraphSpacing !== undefined) {
      style.paragraphSpacing = paragraphSpacing;
      updatedProperties.push("paragraphSpacing");
    }

    // Update paragraphIndent if provided
    if (paragraphIndent !== undefined) {
      style.paragraphIndent = paragraphIndent;
      updatedProperties.push("paragraphIndent");
    }

    return {
      id: style.id,
      name: style.name,
      updatedProperties
    };
  } catch (error) {
    throw new Error(`Error updating text style: ${error.message}`);
  }
}

async function getRemoteComponents() {
  try {
    // Check if figma.teamLibrary is available
    if (!figma.teamLibrary) {
      console.error("Error: figma.teamLibrary API is not available");
      throw new Error("The figma.teamLibrary API is not available in this context");
    }
    
    // Check if figma.teamLibrary.getAvailableComponentsAsync exists
    if (!figma.teamLibrary.getAvailableComponentsAsync) {
      console.error("Error: figma.teamLibrary.getAvailableComponentsAsync is not available");
      throw new Error("The getAvailableComponentsAsync method is not available");
    }
    
    debugLog("Starting remote components retrieval...");
    
    // Set up a manual timeout to detect deadlocks
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("Internal timeout while retrieving remote components (15s)"));
      }, 15000); // 15 seconds internal timeout
    });
    
    // Execute the request with a manual timeout
    const fetchPromise = figma.teamLibrary.getAvailableComponentsAsync();
    
    // Use Promise.race to implement the timeout
    const teamComponents = await Promise.race([fetchPromise, timeoutPromise])
      .finally(() => {
        clearTimeout(timeoutId); // Clear the timeout
      });
    
    debugLog(`Retrieved ${teamComponents.length} remote components`);
    
    return {
      success: true,
      count: teamComponents.length,
      components: teamComponents.map(component => ({
        key: component.key,
        name: component.name,
        description: component.description || "",
        libraryName: component.libraryName
      }))
    };
  } catch (error) {
    console.error(`Detailed error retrieving remote components: ${error.message || "Unknown error"}`);
    console.error(`Stack trace: ${error.stack || "Not available"}`);
    
    // Instead of returning an error object, throw an exception with the error message
    throw new Error(`Error retrieving remote components: ${error.message}`);
  }
}

// Set Effects Tool
async function setEffects(params) {
  const { nodeId, effects } = params || {};
  
  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  
  if (!effects || !Array.isArray(effects)) {
    throw new Error("Missing or invalid effects parameter. Must be an array.");
  }
  
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  
  if (!("effects" in node)) {
    throw new Error(`Node does not support effects: ${nodeId}`);
  }
  
  try {
    // Convert incoming effects to valid Figma effects
    const validEffects = effects.map(effect => {
      // Ensure all effects have the required properties
      if (!effect.type) {
        throw new Error("Each effect must have a type property");
      }
      
      // Create a clean effect object based on type
      switch (effect.type) {
        case "DROP_SHADOW":
        case "INNER_SHADOW":
          return {
            type: effect.type,
            color: effect.color || { r: 0, g: 0, b: 0, a: 0.5 },
            offset: effect.offset || { x: 0, y: 0 },
            radius: effect.radius || 5,
            spread: effect.spread || 0,
            visible: effect.visible !== undefined ? effect.visible : true,
            blendMode: effect.blendMode || "NORMAL"
          };
        case "LAYER_BLUR":
        case "BACKGROUND_BLUR":
          return {
            type: effect.type,
            radius: effect.radius || 5,
            visible: effect.visible !== undefined ? effect.visible : true
          };
        default:
          throw new Error(`Unsupported effect type: ${effect.type}`);
      }
    });
    
    // Apply the effects to the node
    node.effects = validEffects;
    
    return {
      id: node.id,
      name: node.name,
      effects: node.effects
    };
  } catch (error) {
    throw new Error(`Error setting effects: ${error.message}`);
  }
}

// Set Effect Style ID Tool
async function setEffectStyleId(params) {
  const { nodeId, effectStyleId } = params || {};
  
  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  
  if (!effectStyleId) {
    throw new Error("Missing effectStyleId parameter");
  }
  
  try {
    // Set up a manual timeout to detect long operations
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("Timeout while setting effect style ID (8s). The operation took too long to complete."));
      }, 8000); // 8 seconds timeout
    });
    
    debugLog(`Starting to set effect style ID ${effectStyleId} on node ${nodeId}...`);
    
    // Get node and validate in a promise
    const nodePromise = (async () => {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }
      
      if (!("effectStyleId" in node)) {
        throw new Error(`Node with ID ${nodeId} does not support effect styles`);
      }
      
      // Try to validate the effect style exists before applying
      debugLog(`Fetching effect styles to validate style ID: ${effectStyleId}`);
      const effectStyles = await figma.getLocalEffectStylesAsync();
      const foundStyle = effectStyles.find(style => style.id === effectStyleId);
      
      if (!foundStyle) {
        throw new Error(`Effect style not found with ID: ${effectStyleId}. Available styles: ${effectStyles.length}`);
      }
      
      debugLog(`Effect style found, applying to node...`);
      
      // Apply the effect style to the node
      node.effectStyleId = effectStyleId;
      
      return {
        id: node.id,
        name: node.name,
        effectStyleId: node.effectStyleId,
        appliedEffects: node.effects
      };
    })();
    
    // Race between the node operation and the timeout
    const result = await Promise.race([nodePromise, timeoutPromise])
      .finally(() => {
        // Clear the timeout to prevent memory leaks
        clearTimeout(timeoutId);
      });
    
    debugLog(`Successfully set effect style ID on node ${nodeId}`);
    return result;
  } catch (error) {
    console.error(`Error setting effect style ID: ${error.message || "Unknown error"}`);
    console.error(`Stack trace: ${error.stack || "Not available"}`);
    
    // Proporcionar mensajes de error específicos para diferentes casos
    if (error.message.includes("timeout") || error.message.includes("Timeout")) {
      throw new Error(`The operation timed out after 8 seconds. This could happen with complex nodes or effects. Try with a simpler node or effect style.`);
    } else if (error.message.includes("not found") && error.message.includes("Node")) {
      throw new Error(`Node with ID "${nodeId}" not found. Make sure the node exists in the current document.`);
    } else if (error.message.includes("not found") && error.message.includes("style")) {
      throw new Error(`Effect style with ID "${effectStyleId}" not found. Make sure the style exists in your local styles.`);
    } else if (error.message.includes("does not support")) {
      throw new Error(`The selected node type does not support effect styles. Only certain node types like frames, components, and instances can have effect styles.`);
    } else {
      throw new Error(`Error setting effect style ID: ${error.message}`);
    }
  }
}

// Function to group nodes
async function groupNodes(params) {
  const { nodeIds, name } = params || {};
  
  if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length < 2) {
    throw new Error("Must provide at least two nodeIds to group");
  }
  
  try {
    // Get all nodes to be grouped
    const nodesToGroup = [];
    for (const nodeId of nodeIds) {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }
      nodesToGroup.push(node);
    }
    
    // Verify that all nodes have the same parent
    const parent = nodesToGroup[0].parent;
    for (const node of nodesToGroup) {
      if (node.parent !== parent) {
        throw new Error("All nodes must have the same parent to be grouped");
      }
    }
    
    // Create a group and add the nodes to it
    const group = figma.group(nodesToGroup, parent);
    
    // Optionally set a name for the group
    if (name) {
      group.name = name;
    }
    
    return {
      id: group.id,
      name: group.name,
      type: group.type,
      children: group.children.map(child => ({ id: child.id, name: child.name, type: child.type }))
    };
  } catch (error) {
    throw new Error(`Error grouping nodes: ${error.message}`);
  }
}

// Function to ungroup nodes
async function ungroupNodes(params) {
  const { nodeId } = params || {};
  
  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  
  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    
    // Verify that the node is a group or a frame
    if (node.type !== "GROUP" && node.type !== "FRAME") {
      throw new Error(`Node with ID ${nodeId} is not a GROUP or FRAME`);
    }
    
    // Get the parent and children before ungrouping
    const parent = node.parent;
    const children = [...node.children];
    
    // Ungroup the node
    const ungroupedItems = figma.ungroup(node);
    
    return {
      success: true,
      ungroupedCount: ungroupedItems.length,
      items: ungroupedItems.map(item => ({ id: item.id, name: item.name, type: item.type }))
    };
  } catch (error) {
    throw new Error(`Error ungrouping node: ${error.message}`);
  }
}

// Function to flatten nodes (e.g., boolean operations, convert to path)
async function flattenNode(params) {
  const { nodeId } = params || {};
  
  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  
  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    
    // Check for specific node types that can be flattened
    const flattenableTypes = ["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "ELLIPSE", "RECTANGLE"];
    
    if (!flattenableTypes.includes(node.type)) {
      throw new Error(`Node with ID ${nodeId} and type ${node.type} cannot be flattened. Only vector-based nodes can be flattened.`);
    }
    
    // Verify the node has the flatten method before calling it
    if (typeof node.flatten !== 'function') {
      throw new Error(`Node with ID ${nodeId} does not support the flatten operation.`);
    }
    
    // Implement a timeout mechanism
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("Flatten operation timed out after 8 seconds. The node may be too complex."));
      }, 8000); // 8 seconds timeout
    });
    
    // Execute the flatten operation in a promise
    const flattenPromise = new Promise((resolve, reject) => {
      // Execute in the next tick to allow UI updates
      setTimeout(() => {
        try {
          debugLog(`Starting flatten operation for node ID ${nodeId}...`);
          const flattened = node.flatten();
          debugLog(`Flatten operation completed successfully for node ID ${nodeId}`);
          resolve(flattened);
        } catch (err) {
          console.error(`Error during flatten operation: ${err.message}`);
          reject(err);
        }
      }, 0);
    });
    
    // Race between the timeout and the operation
    const flattened = await Promise.race([flattenPromise, timeoutPromise])
      .finally(() => {
        // Clear the timeout to prevent memory leaks
        clearTimeout(timeoutId);
      });
    
    return {
      id: flattened.id,
      name: flattened.name,
      type: flattened.type
    };
  } catch (error) {
    console.error(`Error in flattenNode: ${error.message}`);
    if (error.message.includes("timed out")) {
      // Provide a more helpful message for timeout errors
      throw new Error(`The flatten operation timed out. This usually happens with complex nodes. Try simplifying the node first or breaking it into smaller parts.`);
    } else {
      throw new Error(`Error flattening node: ${error.message}`);
    }
  }
}

// Function to detach a component instance from its main component
async function detachInstance(params) {
  const { nodeId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    // Verify that the node is an instance
    if (node.type !== "INSTANCE") {
      throw new Error(`Node with ID ${nodeId} is not an INSTANCE. Only component instances can be detached.`);
    }

    // Detach the instance
    const detached = node.detachInstance();

    return {
      id: detached.id,
      name: detached.name,
      type: detached.type
    };
  } catch (error) {
    throw new Error(`Error detaching instance: ${error.message}`);
  }
}

// Function to create a component from a frame or group
async function createComponent(params) {
  const { nodeId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    // Verify that the node can be converted to a component
    if (node.type !== "FRAME" && node.type !== "GROUP" && node.type !== "RECTANGLE" && node.type !== "ELLIPSE" && node.type !== "POLYGON" && node.type !== "STAR" && node.type !== "VECTOR" && node.type !== "TEXT" && node.type !== "LINE") {
      throw new Error(`Node with ID ${nodeId} is of type ${node.type} and cannot be converted to a component. Only FRAME, GROUP, and shape nodes can be converted.`);
    }

    // Create component from the node
    const component = figma.createComponentFromNode(node);

    return {
      id: component.id,
      name: component.name,
      key: component.key
    };
  } catch (error) {
    throw new Error(`Error creating component: ${error.message}`);
  }
}

// Function to create a component set from multiple components
async function createComponentSet(params) {
  const { nodeIds, name } = params || {};

  if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length < 1) {
    throw new Error("Must provide at least one nodeId to create a component set");
  }

  try {
    // Get all nodes and convert them to components if needed
    const components = [];
    for (const nodeId of nodeIds) {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }

      // If the node is already a component, use it directly
      if (node.type === "COMPONENT") {
        components.push(node);
      } else if (node.type === "FRAME" || node.type === "GROUP") {
        // Convert frame/group to component first
        const component = figma.createComponentFromNode(node);
        components.push(component);
      } else {
        throw new Error(`Node with ID ${nodeId} is of type ${node.type}. Only COMPONENT, FRAME, or GROUP nodes can be used in a component set.`);
      }
    }

    // Get the parent of the first component
    const parent = components[0].parent;

    // Combine components as variants
    const componentSet = figma.combineAsVariants(components, parent);

    // Optionally set the name
    if (name) {
      componentSet.name = name;
    }

    return {
      id: componentSet.id,
      name: componentSet.name,
      variantCount: components.length
    };
  } catch (error) {
    throw new Error(`Error creating component set: ${error.message}`);
  }
}

// Function to add a component property (BOOLEAN, TEXT, INSTANCE_SWAP, VARIANT)
async function addComponentProperty(params) {
  const { nodeId, propertyName, type, defaultValue } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!propertyName) {
    throw new Error("Missing propertyName parameter");
  }
  if (!type) {
    throw new Error("Missing type parameter");
  }

  const validTypes = ["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT"];
  if (!validTypes.includes(type)) {
    throw new Error(`Invalid type: ${type}. Must be one of: ${validTypes.join(", ")}`);
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
      throw new Error(`Node must be a COMPONENT or COMPONENT_SET, got: ${node.type}`);
    }

    // Determine default value based on type
    let actualDefaultValue = defaultValue;
    if (type === "BOOLEAN" && actualDefaultValue === undefined) {
      actualDefaultValue = true;
    } else if (type === "TEXT" && actualDefaultValue === undefined) {
      actualDefaultValue = "";
    } else if (type === "VARIANT" && actualDefaultValue === undefined) {
      actualDefaultValue = "Default";
    } else if (type === "INSTANCE_SWAP" && actualDefaultValue === undefined) {
      throw new Error("INSTANCE_SWAP type requires a defaultValue (component key)");
    }

    // Add the component property
    const fullPropertyName = node.addComponentProperty(propertyName, type, actualDefaultValue);

    return {
      nodeId: node.id,
      nodeName: node.name,
      propertyName: fullPropertyName,
      type: type,
      defaultValue: actualDefaultValue
    };
  } catch (error) {
    throw new Error(`Error adding component property: ${error.message}`);
  }
}

// Function to edit an existing component property
async function editComponentProperty(params) {
  const { nodeId, propertyName, newName, newDefaultValue, preferredValues } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!propertyName) {
    throw new Error("Missing propertyName parameter");
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
      throw new Error(`Node must be a COMPONENT or COMPONENT_SET, got: ${node.type}`);
    }

    // Build the update object with only provided fields
    const updateObj = {};
    if (newName !== undefined) {
      updateObj.name = newName;
    }
    if (newDefaultValue !== undefined) {
      updateObj.defaultValue = newDefaultValue;
    }
    if (preferredValues !== undefined) {
      updateObj.preferredValues = preferredValues;
    }

    if (Object.keys(updateObj).length === 0) {
      throw new Error("Must provide at least one of: newName, newDefaultValue, or preferredValues");
    }

    // Edit the component property
    const updatedPropertyName = node.editComponentProperty(propertyName, updateObj);

    return {
      nodeId: node.id,
      nodeName: node.name,
      oldPropertyName: propertyName,
      newPropertyName: updatedPropertyName,
      updates: updateObj
    };
  } catch (error) {
    throw new Error(`Error editing component property: ${error.message}`);
  }
}

// Function to delete a component property
async function deleteComponentProperty(params) {
  const { nodeId, propertyName } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!propertyName) {
    throw new Error("Missing propertyName parameter");
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
      throw new Error(`Node must be a COMPONENT or COMPONENT_SET, got: ${node.type}`);
    }

    // Delete the component property
    node.deleteComponentProperty(propertyName);

    return {
      nodeId: node.id,
      nodeName: node.name,
      deletedPropertyName: propertyName
    };
  } catch (error) {
    throw new Error(`Error deleting component property: ${error.message}`);
  }
}

// Function to set component property references on a child node (link visibility to boolean, etc.)
async function setComponentPropertyReferences(params) {
  const { nodeId, references } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!references || typeof references !== "object") {
    throw new Error("Missing or invalid references parameter (must be an object)");
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    // Verify the node can have componentPropertyReferences (must be a sublayer of a component)
    if (!("componentPropertyReferences" in node)) {
      throw new Error(`Node does not support componentPropertyReferences. It must be a sublayer of a component.`);
    }

    // Set the references
    // For boolean visibility: { visible: "PropertyName#123:456" }
    // For text content: { characters: "TextProperty#123:456" }
    // For instance swap: { mainComponent: "SwapProperty#123:456" }
    node.componentPropertyReferences = references;

    return {
      nodeId: node.id,
      nodeName: node.name,
      references: node.componentPropertyReferences
    };
  } catch (error) {
    throw new Error(`Error setting component property references: ${error.message}`);
  }
}

// Function to get all component properties from a component
async function getComponentProperties(params) {
  const { nodeId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
      throw new Error(`Node must be a COMPONENT or COMPONENT_SET, got: ${node.type}`);
    }

    const definitions = node.componentPropertyDefinitions || {};

    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      properties: definitions
    };
  } catch (error) {
    throw new Error(`Error getting component properties: ${error.message}`);
  }
}

// Function to rename a node
async function renameNode(params) {
  const { nodeId, name } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (!name) {
    throw new Error("Missing name parameter");
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    const oldName = node.name;
    node.name = name;

    return {
      id: node.id,
      oldName: oldName,
      newName: node.name
    };
  } catch (error) {
    throw new Error(`Error renaming node: ${error.message}`);
  }
}

// Function to insert a child into a parent node
async function insertChild(params) {
  const { parentId, childId, index } = params || {};

  if (!parentId) {
    throw new Error("Missing parentId parameter");
  }

  if (!childId) {
    throw new Error("Missing childId parameter");
  }

  try {
    // Get the parent and child nodes
    const parent = await figma.getNodeByIdAsync(parentId);
    if (!parent) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    
    const child = await figma.getNodeByIdAsync(childId);
    if (!child) {
      throw new Error(`Child node not found with ID: ${childId}`);
    }
    
    // Check if the parent can have children
    if (!("appendChild" in parent)) {
      throw new Error(`Parent node with ID ${parentId} cannot have children`);
    }
    
    // Save child's current parent for proper handling
    const originalParent = child.parent;
    
    // Insert the child at the specified index or append it
    if (index !== undefined && index >= 0 && index <= parent.children.length) {
      parent.insertChild(index, child);
    } else {
      parent.appendChild(child);
    }
    
    // Verify that the insertion worked
    const newIndex = parent.children.indexOf(child);
    
    return {
      parentId: parent.id,
      childId: child.id,
      index: newIndex,
      success: newIndex !== -1,
      previousParentId: originalParent ? originalParent.id : null
    };
  } catch (error) {
    console.error(`Error inserting child: ${error.message}`, error);
    throw new Error(`Error inserting child: ${error.message}`);
  }
}

async function createEllipse(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Ellipse",
    parentId,
    fillColor = { r: 0.8, g: 0.8, b: 0.8, a: 1 },
    strokeColor,
    strokeWeight
  } = params || {};

  // Create a new ellipse node
  const ellipse = figma.createEllipse();
  ellipse.name = name;
  
  // Position and size the ellipse
  ellipse.x = x;
  ellipse.y = y;
  ellipse.resize(width, height);
  
  // Set fill color if provided
  if (fillColor) {
    const fillStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(fillColor.r) || 0,
        g: parseFloat(fillColor.g) || 0,
        b: parseFloat(fillColor.b) || 0,
      },
      opacity: parseFloat(fillColor.a) || 1
    };
    ellipse.fills = [fillStyle];
  }
  
  // Set stroke color and weight if provided
  if (strokeColor) {
    const strokeStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(strokeColor.r) || 0,
        g: parseFloat(strokeColor.g) || 0,
        b: parseFloat(strokeColor.b) || 0,
      },
      opacity: parseFloat(strokeColor.a) || 1
    };
    ellipse.strokes = [strokeStyle];
    
    if (strokeWeight) {
      ellipse.strokeWeight = strokeWeight;
    }
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(ellipse);
  } else {
    figma.currentPage.appendChild(ellipse);
  }
  
  return {
    id: ellipse.id,
    name: ellipse.name,
    type: ellipse.type,
    x: ellipse.x,
    y: ellipse.y,
    width: ellipse.width,
    height: ellipse.height
  };
}

async function createPolygon(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    sides = 6,
    name = "Polygon",
    parentId,
    fillColor,
    strokeColor,
    strokeWeight
  } = params || {};

  // Create the polygon
  const polygon = figma.createPolygon();
  polygon.x = x;
  polygon.y = y;
  polygon.resize(width, height);
  polygon.name = name;
  
  // Set the number of sides
  if (sides >= 3) {
    polygon.pointCount = sides;
  }

  // Set fill color if provided
  if (fillColor) {
    const paintStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(fillColor.r) || 0,
        g: parseFloat(fillColor.g) || 0,
        b: parseFloat(fillColor.b) || 0,
      },
      opacity: parseFloat(fillColor.a) || 1,
    };
    polygon.fills = [paintStyle];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    const strokeStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(strokeColor.r) || 0,
        g: parseFloat(strokeColor.g) || 0,
        b: parseFloat(strokeColor.b) || 0,
      },
      opacity: parseFloat(strokeColor.a) || 1,
    };
    polygon.strokes = [strokeStyle];
  }

  // Set stroke weight if provided
  if (strokeWeight !== undefined) {
    polygon.strokeWeight = strokeWeight;
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(polygon);
  } else {
    figma.currentPage.appendChild(polygon);
  }

  return {
    id: polygon.id,
    name: polygon.name,
    type: polygon.type,
    x: polygon.x,
    y: polygon.y,
    width: polygon.width,
    height: polygon.height,
    pointCount: polygon.pointCount,
    fills: polygon.fills,
    strokes: polygon.strokes,
    strokeWeight: polygon.strokeWeight,
    parentId: polygon.parent ? polygon.parent.id : undefined,
  };
}

async function createStar(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    points = 5,
    innerRadius = 0.5, // As a proportion of the outer radius
    name = "Star",
    parentId,
    fillColor,
    strokeColor,
    strokeWeight
  } = params || {};

  // Create the star
  const star = figma.createStar();
  star.x = x;
  star.y = y;
  star.resize(width, height);
  star.name = name;
  
  // Set the number of points
  if (points >= 3) {
    star.pointCount = points;
  }

  // Set the inner radius ratio
  if (innerRadius > 0 && innerRadius < 1) {
    star.innerRadius = innerRadius;
  }

  // Set fill color if provided
  if (fillColor) {
    const paintStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(fillColor.r) || 0,
        g: parseFloat(fillColor.g) || 0,
        b: parseFloat(fillColor.b) || 0,
      },
      opacity: parseFloat(fillColor.a) || 1,
    };
    star.fills = [paintStyle];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    const strokeStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(strokeColor.r) || 0,
        g: parseFloat(strokeColor.g) || 0,
        b: parseFloat(strokeColor.b) || 0,
      },
      opacity: parseFloat(strokeColor.a) || 1,
    };
    star.strokes = [strokeStyle];
  }

  // Set stroke weight if provided
  if (strokeWeight !== undefined) {
    star.strokeWeight = strokeWeight;
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(star);
  } else {
    figma.currentPage.appendChild(star);
  }

  return {
    id: star.id,
    name: star.name,
    type: star.type,
    x: star.x,
    y: star.y,
    width: star.width,
    height: star.height,
    pointCount: star.pointCount,
    innerRadius: star.innerRadius,
    fills: star.fills,
    strokes: star.strokes,
    strokeWeight: star.strokeWeight,
    parentId: star.parent ? star.parent.id : undefined,
  };
}

async function createSvg(params) {
  const {
    svgString,
    x = 0,
    y = 0,
    name,
    parentId,
    flatten = false
  } = params || {};

  if (!svgString) {
    throw new Error("Missing svgString parameter");
  }

  // Validate SVG string - must start with <svg or <?xml
  const trimmedSvg = svgString.trim();
  if (!trimmedSvg.startsWith("<svg") && !trimmedSvg.startsWith("<?xml")) {
    throw new Error("Invalid SVG: must start with <svg or <?xml declaration");
  }

  debugLog(`createSvg: Creating SVG node, flatten=${flatten}`);

  // Create node from SVG string
  let svgNode;
  try {
    svgNode = figma.createNodeFromSvg(svgString);
  } catch (parseError) {
    const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
    console.error(`createSvg: Failed to parse SVG: ${errorMsg}`);
    throw new Error(`Failed to parse SVG: ${errorMsg}`);
  }

  // Position the node
  svgNode.x = x;
  svgNode.y = y;

  // Set name if provided
  if (name) {
    svgNode.name = name;
  }

  // Flatten to single vector if requested
  if (flatten && svgNode.children && svgNode.children.length > 0) {
    try {
      const flattened = figma.flatten([svgNode]);
      svgNode = flattened;
      if (name) {
        svgNode.name = name;
      }
      debugLog(`createSvg: Flattened SVG to single vector`);
    } catch (flattenError) {
      console.warn(`createSvg: Could not flatten SVG: ${flattenError}`);
      // Continue with unflattened node
    }
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(svgNode);
  } else {
    figma.currentPage.appendChild(svgNode);
  }

  debugLog(`createSvg: Created SVG node "${svgNode.name}" (${svgNode.id})`);

  return {
    id: svgNode.id,
    name: svgNode.name,
    type: svgNode.type,
    x: svgNode.x,
    y: svgNode.y,
    width: svgNode.width,
    height: svgNode.height,
    childCount: svgNode.children ? svgNode.children.length : 0,
    parentId: svgNode.parent ? svgNode.parent.id : undefined,
  };
}

async function createVector(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Vector",
    parentId,
    vectorPaths = [],
    fillColor,
    strokeColor,
    strokeWeight
  } = params || {};

  // Create the vector
  const vector = figma.createVector();
  vector.x = x;
  vector.y = y;
  vector.resize(width, height);
  vector.name = name;

  // Set vector paths if provided
  if (vectorPaths && vectorPaths.length > 0) {
    vector.vectorPaths = vectorPaths.map(path => {
      return {
        windingRule: path.windingRule || "EVENODD",
        data: path.data || ""
      };
    });
  }

  // Set fill color if provided
  if (fillColor) {
    const paintStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(fillColor.r) || 0,
        g: parseFloat(fillColor.g) || 0,
        b: parseFloat(fillColor.b) || 0,
      },
      opacity: parseFloat(fillColor.a) || 1,
    };
    vector.fills = [paintStyle];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    const strokeStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(strokeColor.r) || 0,
        g: parseFloat(strokeColor.g) || 0,
        b: parseFloat(strokeColor.b) || 0,
      },
      opacity: parseFloat(strokeColor.a) || 1,
    };
    vector.strokes = [strokeStyle];
  }

  // Set stroke weight if provided
  if (strokeWeight !== undefined) {
    vector.strokeWeight = strokeWeight;
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(vector);
  } else {
    figma.currentPage.appendChild(vector);
  }

  return {
    id: vector.id,
    name: vector.name,
    type: vector.type,
    x: vector.x,
    y: vector.y,
    width: vector.width,
    height: vector.height,
    vectorNetwork: vector.vectorNetwork,
    fills: vector.fills,
    strokes: vector.strokes,
    strokeWeight: vector.strokeWeight,
    parentId: vector.parent ? vector.parent.id : undefined,
  };
}

async function createLine(params) {
  const {
    x1 = 0,
    y1 = 0,
    x2 = 100,
    y2 = 0,
    name = "Line",
    parentId,
    strokeColor = { r: 0, g: 0, b: 0, a: 1 },
    strokeWeight = 1,
    strokeCap = "NONE" // Can be "NONE", "ROUND", "SQUARE", "ARROW_LINES", or "ARROW_EQUILATERAL"
  } = params || {};

  // Create a vector node to represent the line
  const line = figma.createVector();
  line.name = name;
  
  // Position the line at the starting point
  line.x = x1;
  line.y = y1;
  
  // Calculate the vector size
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  line.resize(width > 0 ? width : 1, height > 0 ? height : 1);
  
  // Create vector path data for a straight line
  // SVG path data format: M (move to) starting point, L (line to) ending point
  const dx = x2 - x1;
  const dy = y2 - y1;
  
  // Calculate relative endpoint coordinates in the vector's local coordinate system
  const endX = dx > 0 ? width : 0;
  const endY = dy > 0 ? height : 0;
  const startX = dx > 0 ? 0 : width;
  const startY = dy > 0 ? 0 : height;
  
  // Generate SVG path data for the line
  const pathData = `M ${startX} ${startY} L ${endX} ${endY}`;
  
  // Set vector paths
  line.vectorPaths = [{
    windingRule: "NONZERO",
    data: pathData
  }];
  
  // Set stroke color
  const strokeStyle = {
    type: "SOLID",
    color: {
      r: parseFloat(strokeColor.r) || 0,
      g: parseFloat(strokeColor.g) || 0,
      b: parseFloat(strokeColor.b) || 0,
    },
    opacity: parseFloat(strokeColor.a) || 1
  };
  line.strokes = [strokeStyle];
  
  // Set stroke weight
  line.strokeWeight = strokeWeight;
  
  // Set stroke cap style if supported
  if (["NONE", "ROUND", "SQUARE", "ARROW_LINES", "ARROW_EQUILATERAL"].includes(strokeCap)) {
    line.strokeCap = strokeCap;
  }
  
  // Set fill to none (transparent) as lines typically don't have fills
  line.fills = [];
  
  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(line);
  } else {
    figma.currentPage.appendChild(line);
  }
  
  return {
    id: line.id,
    name: line.name,
    type: line.type,
    x: line.x,
    y: line.y,
    width: line.width,
    height: line.height,
    strokeWeight: line.strokeWeight,
    strokeCap: line.strokeCap,
    strokes: line.strokes,
    vectorPaths: line.vectorPaths,
    parentId: line.parent ? line.parent.id : undefined
  };
}

// Variable-related functions

async function getVariables() {
  const variables = await figma.variables.getLocalVariablesAsync();
  const collections = await figma.variables.getLocalVariableCollectionsAsync();

  return {
    variables: variables.map(v => ({
      id: v.id,
      name: v.name,
      key: v.key,
      type: v.resolvedType,
      description: v.description || "",
      collectionId: v.variableCollectionId,
      values: Object.entries(v.valuesByMode).map(([modeId, value]) => ({
        modeId,
        value: formatVariableValue(value, v.resolvedType)
      }))
    })),
    collections: collections.map(c => ({
      id: c.id,
      name: c.name,
      variableIds: c.variableIds,
      modes: c.modes.map(m => ({ id: m.modeId, name: m.name }))
    }))
  };
}

function formatVariableValue(value, type) {
  if (type === "COLOR" && value && typeof value === "object") {
    return {
      r: value.r,
      g: value.g,
      b: value.b,
      a: value.a !== undefined ? value.a : 1
    };
  }
  return value;
}

async function getBoundVariables(params) {
  const { nodeId } = params;

  if (!nodeId) {
    throw new Error("nodeId is required");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  const bindings = [];
  const variables = await figma.variables.getLocalVariablesAsync();
  const variableMap = new Map(variables.map(v => [v.id, v]));

  // Check if node has boundVariables property
  if (node.boundVariables) {
    for (const [field, binding] of Object.entries(node.boundVariables)) {
      if (binding) {
        // Handle both single bindings and array bindings (like fills)
        const processBinding = (b, fieldPath) => {
          if (b && b.id) {
            const variable = variableMap.get(b.id);
            bindings.push({
              field: fieldPath,
              variableId: b.id,
              variableName: variable ? variable.name : "Unknown",
              variableType: variable ? variable.resolvedType : "Unknown"
            });
          }
        };

        if (Array.isArray(binding)) {
          binding.forEach((b, index) => {
            processBinding(b, `${field}/${index}`);
          });
        } else {
          processBinding(binding, field);
        }
      }
    }
  }

  return {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    bindings
  };
}

async function bindVariable(params) {
  const { nodeId, variableId, field } = params;

  if (!nodeId || !variableId || !field) {
    throw new Error("nodeId, variableId, and field are required");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  // Get the variable
  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) {
    throw new Error(`Variable not found: ${variableId}`);
  }

  // Parse the field path (e.g., "fills/0/color" -> ["fills", 0, "color"])
  const fieldParts = field.split("/");

  // Handle different field types
  try {
    if (fieldParts[0] === "fills" && fieldParts.length >= 2) {
      // Binding to fill color
      const fillIndex = parseInt(fieldParts[1]);
      if (isNaN(fillIndex)) {
        throw new Error(`Invalid fill index: ${fieldParts[1]}`);
      }

      // Get current fills or create default
      let fills = node.fills ? [...node.fills] : [];
      if (fills.length <= fillIndex) {
        // Create a default solid fill if needed
        while (fills.length <= fillIndex) {
          fills.push({ type: "SOLID", color: { r: 0, g: 0, b: 0 } });
        }
        node.fills = fills;
      }

      // Bind the variable to the fill paint using the correct API
      const fillsCopy = [...node.fills];
      fillsCopy[fillIndex] = figma.variables.setBoundVariableForPaint(
        fillsCopy[fillIndex],
        "color",
        variable
      );
      node.fills = fillsCopy;

    } else if (fieldParts[0] === "strokes" && fieldParts.length >= 2) {
      // Binding to stroke color
      const strokeIndex = parseInt(fieldParts[1]);
      if (isNaN(strokeIndex)) {
        throw new Error(`Invalid stroke index: ${fieldParts[1]}`);
      }

      // Get current strokes or create default
      let strokes = node.strokes ? [...node.strokes] : [];
      if (strokes.length <= strokeIndex) {
        while (strokes.length <= strokeIndex) {
          strokes.push({ type: "SOLID", color: { r: 0, g: 0, b: 0 } });
        }
        node.strokes = strokes;
      }

      // Bind the variable to the stroke paint using the correct API
      const strokesCopy = [...node.strokes];
      strokesCopy[strokeIndex] = figma.variables.setBoundVariableForPaint(
        strokesCopy[strokeIndex],
        "color",
        variable
      );
      node.strokes = strokesCopy;

    } else {
      // Direct property binding (opacity, width, height, etc.)
      const propertyName = fieldParts[0];
      node.setBoundVariable(propertyName, variable);
    }
  } catch (err) {
    throw new Error(`Failed to bind variable: ${err.message}. Make sure the variable type (${variable.resolvedType}) is compatible with the field "${field}"`);
  }

  return {
    nodeId: node.id,
    nodeName: node.name,
    field,
    variableId: variable.id,
    variableName: variable.name,
    variableType: variable.resolvedType
  };
}

async function unbindVariable(params) {
  const { nodeId, field } = params;

  if (!nodeId || !field) {
    throw new Error("nodeId and field are required");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  // Parse the field path
  const fieldParts = field.split("/");

  try {
    if (fieldParts[0] === "fills" && fieldParts.length >= 2) {
      // For fills/strokes, we need to unbind the specific paint
      const fillIndex = parseInt(fieldParts[1]);
      if (isNaN(fillIndex)) {
        throw new Error(`Invalid fill index: ${fieldParts[1]}`);
      }

      // Get current fills
      if ('fills' in node && node.fills !== figma.mixed && Array.isArray(node.fills)) {
        const fills = [...node.fills];
        if (fills[fillIndex] && fills[fillIndex].boundVariables) {
          // Remove variable binding by setting fills without bound variables
          const newFill = Object.assign({}, fills[fillIndex]);
          delete newFill.boundVariables;
          fills[fillIndex] = newFill;
          node.fills = fills;
        }
      }

    } else if (fieldParts[0] === "strokes" && fieldParts.length >= 2) {
      const strokeIndex = parseInt(fieldParts[1]);
      if (isNaN(strokeIndex)) {
        throw new Error(`Invalid stroke index: ${fieldParts[1]}`);
      }

      // Get current strokes
      if ('strokes' in node && node.strokes !== figma.mixed && Array.isArray(node.strokes)) {
        const strokes = [...node.strokes];
        if (strokes[strokeIndex] && strokes[strokeIndex].boundVariables) {
          const newStroke = Object.assign({}, strokes[strokeIndex]);
          delete newStroke.boundVariables;
          strokes[strokeIndex] = newStroke;
          node.strokes = strokes;
        }
      }

    } else {
      // For other properties, use setBoundVariable directly
      const propertyName = fieldParts[0];
      node.setBoundVariable(propertyName, null);
    }

    return {
      nodeId: node.id,
      nodeName: node.name,
      field,
      success: true
    };
  } catch (err) {
    throw new Error(`Failed to unbind variable: ${err.message}`);
  }
}
// Helper: Find collection by ID or name
async function findCollection(collectionIdOrName) {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();

  // Try to find by ID first
  let collection = collections.find(c => c.id === collectionIdOrName);

  // If not found, try by name
  if (!collection) {
    collection = collections.find(c => c.name === collectionIdOrName);
  }

  if (!collection) {
    throw new Error(`Collection not found: ${collectionIdOrName}`);
  }

  return collection;
}

// Helper: Find variable by ID or name in collection
async function findVariable(variableIdOrName, collectionId) {
  const variables = await figma.variables.getLocalVariablesAsync();

  // Try to find by ID first
  let variable = variables.find(v => v.id === variableIdOrName);

  // If not found and collectionId provided, try by name in collection
  if (!variable && collectionId) {
    const collection = await findCollection(collectionId);
    variable = variables.find(v =>
      v.name === variableIdOrName && v.variableCollectionId === collection.id
    );
  }

  if (!variable) {
    throw new Error(`Variable not found: ${variableIdOrName}`);
  }

  return variable;
}

// Helper: Calculate color scale
function calculateColorScaleFigma(baseColor, backgroundColor) {
  const mixPercentages = {
    50: 0.05, 100: 0.10, 200: 0.20, 300: 0.30, 400: 0.40,
    500: 0.50, 600: 0.60, 700: 0.70, 800: 0.80, 900: 0.90
  };

  const scale = {};
  for (const [level, mix] of Object.entries(mixPercentages)) {
    const invMix = 1 - mix;
    scale[level] = {
      r: baseColor.r * mix + backgroundColor.r * invMix,
      g: baseColor.g * mix + backgroundColor.g * invMix,
      b: baseColor.b * mix + backgroundColor.b * invMix,
      a: 1.0
    };
  }

  return scale;
}

// Helper: Get standard schema
function getStandardSchemaFigma(includeChartColors = false) {
  const baseVariables = [
    // Surfaces
    'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
    // Brand
    'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
    'tertiary', 'tertiary-foreground', 'accent', 'accent-foreground',
    // States
    'success', 'success-foreground', 'info', 'info-foreground',
    'warning', 'warning-foreground', 'destructive', 'destructive-foreground',
    // Interactive
    'link', 'link-hover',
    // Feedback
    'overlay', 'tooltip', 'tooltip-foreground', 'placeholder', 'placeholder-foreground',
    // Utility
    'muted', 'muted-foreground', 'selected', 'selected-foreground', 'border', 'input', 'ring'
  ];

  // Add scale variables
  const scaleColors = ['primary', 'secondary', 'accent', 'success', 'info', 'warning', 'destructive'];
  const levels = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
  const scaleVariables = [];
  for (const color of scaleColors) {
    for (const level of levels) {
      scaleVariables.push(`${color}-${level}`);
    }
  }

  let allVariables = [...baseVariables, ...scaleVariables];

  if (includeChartColors) {
    allVariables.push('chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'chart-7', 'chart-8');
  }

  return allVariables;
}

// Helper: Get default dark theme colors
function getDefaultDarkTheme() {
  return {
    // Surfaces
    'background': { r: 0.059, g: 0.063, b: 0.067, a: 1.0 },
    'foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    'card': { r: 0.059, g: 0.063, b: 0.067, a: 1.0 },
    'card-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    'popover': { r: 0.059, g: 0.063, b: 0.067, a: 1.0 },
    'popover-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    // Brand colors
    'primary': { r: 0.639, g: 0.902, b: 0.208, a: 1.0 },
    'primary-foreground': { r: 0.090, g: 0.102, b: 0.067, a: 1.0 },
    'secondary': { r: 0.149, g: 0.153, b: 0.153, a: 1.0 },
    'secondary-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    'tertiary': { r: 0.059, g: 0.063, b: 0.067, a: 1.0 },
    'tertiary-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    'accent': { r: 0.149, g: 0.153, b: 0.153, a: 1.0 },
    'accent-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    // State colors
    'success': { r: 0.078, g: 0.325, b: 0.176, a: 1.0 },
    'success-foreground': { r: 0.576, g: 0.773, b: 0.655, a: 1.0 },
    'info': { r: 0.118, g: 0.251, b: 0.686, a: 1.0 },
    'info-foreground': { r: 0.576, g: 0.773, b: 0.992, a: 1.0 },
    'warning': { r: 0.863, g: 0.696, b: 0.149, a: 1.0 },
    'warning-foreground': { r: 0.090, g: 0.102, b: 0.067, a: 1.0 },
    'destructive': { r: 0.863, g: 0.149, b: 0.149, a: 1.0 },
    'destructive-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    // Interactive
    'link': { r: 0.576, g: 0.773, b: 0.992, a: 1.0 },
    'link-hover': { r: 0.384, g: 0.608, b: 0.929, a: 1.0 },
    // Feedback
    'overlay': { r: 0.000, g: 0.000, b: 0.000, a: 0.8 },
    'tooltip': { r: 0.059, g: 0.063, b: 0.067, a: 1.0 },
    'tooltip-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    'placeholder': { r: 0.450, g: 0.450, b: 0.450, a: 1.0 },
    'placeholder-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    // Utility
    'muted': { r: 0.149, g: 0.153, b: 0.153, a: 1.0 },
    'muted-foreground': { r: 0.639, g: 0.647, b: 0.655, a: 1.0 },
    'selected': { r: 0.149, g: 0.153, b: 0.153, a: 1.0 },
    'selected-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    'border': { r: 0.149, g: 0.153, b: 0.153, a: 1.0 },
    'input': { r: 0.149, g: 0.153, b: 0.153, a: 1.0 },
    'ring': { r: 0.639, g: 0.902, b: 0.208, a: 1.0 }
  };
}

// 1. get_variable_collections
async function getVariableCollections() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();

  return {
    collections: collections.map(c => {
      const collectionVariables = variables.filter(v => v.variableCollectionId === c.id);
      return {
        id: c.id,
        name: c.name,
        modes: c.modes.map(m => m.name),
        variableCount: collectionVariables.length,
        defaultMode: (c.modes[0] && c.modes[0].name) || 'Mode 1'
      };
    })
  };
}

// 2. create_variable_collection
async function createVariableCollection(params) {
  const { name, defaultMode } = params;

  const collection = figma.variables.createVariableCollection(name);
  const mode = collection.modes[0];
  collection.renameMode(mode.modeId, defaultMode || 'dark');

  return {
    collectionId: collection.id,
    name: collection.name,
    defaultMode: defaultMode || 'dark',
    success: true
  };
}

// 3. get_collection_info
async function getCollectionInfo(params) {
  const { collectionId } = params;
  const collection = await findCollection(collectionId);
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(v => v.variableCollectionId === collection.id);

  // Categorize variables
  const standardSchema = getStandardSchemaFigma(true);
  const baseCount = collectionVariables.filter(v => !v.name.match(/-\d+$/) && !v.name.startsWith('chart-')).length;
  const scaleCount = collectionVariables.filter(v => v.name.match(/-(50|100|200|300|400|500|600|700|800|900)$/)).length;
  const chartCount = collectionVariables.filter(v => v.name.startsWith('chart-')).length;

  return {
    id: collection.id,
    name: collection.name,
    modes: collection.modes.map(m => m.name),
    defaultMode: (collection.modes[0] && collection.modes[0].name) || 'Mode 1',
    variableCount: collectionVariables.length,
    variablesByCategory: {
      base: baseCount,
      scales: scaleCount,
      chart: chartCount
    }
  };
}

// 3b. rename_variable_collection
async function renameVariableCollection(params) {
  const { collectionId, newName } = params;

  if (!newName) {
    throw new Error("Missing newName parameter");
  }

  const collection = await findCollection(collectionId);
  const oldName = collection.name;
  collection.name = newName;

  return {
    id: collection.id,
    oldName: oldName,
    newName: collection.name,
    success: true
  };
}

// 3c. delete_variable_collection
async function deleteVariableCollection(params) {
  const { collectionId } = params;

  const collection = await findCollection(collectionId);
  const collectionName = collection.name;
  const collectionIdValue = collection.id;

  // Get count of variables that will be deleted
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const variableCount = allVariables.filter(v => v.variableCollectionId === collection.id).length;

  // Remove the collection (this also removes all variables in it)
  collection.remove();

  return {
    id: collectionIdValue,
    name: collectionName,
    variablesDeleted: variableCount,
    success: true
  };
}

// 4. create_variable
async function createVariable(params) {
  const { collectionId, name, type, value, mode } = params;
  const collection = await findCollection(collectionId);

  // Default to COLOR for backward compatibility
  const variableType = type || 'COLOR';

  const variable = figma.variables.createVariable(name, collection, variableType);
  const targetMode = mode ? collection.modes.find(m => m.name === mode) : null;
  const modeId = targetMode ? targetMode.modeId : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  // Set value based on type
  let variableValue;
  if (variableType === 'COLOR') {
    variableValue = {
      r: value.r,
      g: value.g,
      b: value.b,
      a: value.a !== undefined ? value.a : 1.0
    };
  } else {
    // FLOAT, STRING, BOOLEAN - use value directly
    variableValue = value;
  }

  variable.setValueForMode(modeId, variableValue);

  return {
    variableId: variable.id,
    name: variable.name,
    type: variable.resolvedType,
    success: true
  };
}

// 5. create_variables_batch
async function createVariablesBatch(params) {
  const { collectionId, variables, mode } = params;
  const collection = await findCollection(collectionId);
  const targetMode = mode ? collection.modes.find(m => m.name === mode) : null;
  const modeId = targetMode ? targetMode.modeId : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  const created = [];
  const failed = [];
  const variableIds = [];
  const errors = [];

  for (const varDef of variables) {
    try {
      const variableType = varDef.type || 'COLOR';
      const variable = figma.variables.createVariable(varDef.name, collection, variableType);

      // Set value based on type
      let variableValue;
      if (variableType === 'COLOR') {
        variableValue = {
          r: varDef.value.r,
          g: varDef.value.g,
          b: varDef.value.b,
          a: varDef.value.a !== undefined ? varDef.value.a : 1.0
        };
      } else {
        // FLOAT, STRING, BOOLEAN - use value directly
        variableValue = varDef.value;
      }

      variable.setValueForMode(modeId, variableValue);
      created.push(varDef.name);
      variableIds.push(variable.id);
    } catch (error) {
      failed.push(varDef.name);
      errors.push({ name: varDef.name, error: error.message });
    }
  }

  return {
    created: created.length,
    failed: failed.length,
    variableIds,
    errors
  };
}

// 6. update_variable_value
async function updateVariableValue(params) {
  const { variableId, collectionId, value, mode } = params;
  const variable = await findVariable(variableId, collectionId);
  const collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);

  if (!collection) {
    throw new Error(`Variable collection not found for variable ${variable.name}`);
  }

  const targetMode = mode ? collection.modes.find(m => m.name === mode) : null;
  const modeId = targetMode ? targetMode.modeId : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  // Set value based on variable type
  let variableValue;
  const variableType = variable.resolvedType;

  if (variableType === 'COLOR') {
    // Handle color value
    if (typeof value !== 'object' || value.r === undefined) {
      throw new Error(`Expected color value with r, g, b properties for COLOR variable "${variable.name}"`);
    }
    variableValue = {
      r: value.r,
      g: value.g,
      b: value.b,
      a: value.a !== undefined ? value.a : 1.0
    };
  } else if (variableType === 'FLOAT') {
    // Handle number value
    if (typeof value !== 'number') {
      throw new Error(`Expected number value for FLOAT variable "${variable.name}", got ${typeof value}`);
    }
    variableValue = value;
  } else if (variableType === 'STRING') {
    // Handle string value
    if (typeof value !== 'string') {
      throw new Error(`Expected string value for STRING variable "${variable.name}", got ${typeof value}`);
    }
    variableValue = value;
  } else if (variableType === 'BOOLEAN') {
    // Handle boolean value
    if (typeof value !== 'boolean') {
      throw new Error(`Expected boolean value for BOOLEAN variable "${variable.name}", got ${typeof value}`);
    }
    variableValue = value;
  } else {
    throw new Error(`Unsupported variable type: ${variableType}`);
  }

  variable.setValueForMode(modeId, variableValue);

  return {
    variableId: variable.id,
    name: variable.name,
    type: variableType,
    updated: true
  };
}

// 7. rename_variable
async function renameVariable(params) {
  const { variableId, collectionId, newName } = params;
  const variable = await findVariable(variableId, collectionId);
  const oldName = variable.name;

  variable.name = newName;

  return {
    variableId: variable.id,
    oldName,
    newName: variable.name,
    success: true
  };
}

// 8. delete_variable
async function deleteVariable(params) {
  const { variableId, collectionId } = params;
  const variable = await findVariable(variableId, collectionId);
  const name = variable.name;
  const id = variable.id;

  variable.remove();

  return {
    variableId: id,
    name,
    deleted: true
  };
}

// 9. delete_variables_batch
async function deleteVariablesBatch(params) {
  const { variableIds, collectionId } = params;

  let deleted = 0;
  let failed = 0;
  const errors = [];

  for (const varId of variableIds) {
    try {
      const variable = await findVariable(varId, collectionId);
      variable.remove();
      deleted++;
    } catch (error) {
      failed++;
      errors.push({ variableId: varId, error: error.message });
    }
  }

  return {
    deleted,
    failed,
    errors
  };
}

// 10. audit_collection
async function auditCollection(params) {
  const { collectionId, includeChartColors, customSchema } = params;
  const collection = await findCollection(collectionId);
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(v => v.variableCollectionId === collection.id);

  const standardVariables = customSchema || getStandardSchemaFigma(includeChartColors);
  const existingNames = collectionVariables.map(v => v.name);
  const expectedCount = includeChartColors ? 110 : 102;

  // Find missing variables
  const missing = standardVariables.filter(name => !existingNames.includes(name));

  // Find non-standard variables
  const nonStandard = existingNames.filter(name => !standardVariables.includes(name));

  const compliancePercentage = ((existingNames.length - nonStandard.length) / expectedCount * 100).toFixed(1);

  return {
    status: missing.length === 0 && nonStandard.length === 0 ? 'Complete' : 'Incomplete',
    totalVariables: existingNames.length,
    expectedVariables: expectedCount,
    compliancePercentage: parseFloat(compliancePercentage),
    missing: {
      count: missing.length,
      variables: missing
    },
    nonStandard: {
      count: nonStandard.length,
      variables: nonStandard.map(name => ({
        name,
        recommendation: 'Review if needed or remove if not in standard schema',
        action: 'review'
      }))
    },
    existing: {
      count: existingNames.length,
      variables: existingNames
    }
  };
}

// 11. validate_color_contrast
async function validateColorContrast(params) {
  const { collectionId, mode, standard } = params;
  const collection = await findCollection(collectionId);
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(v => v.variableCollectionId === collection.id);

  const targetMode = mode ? collection.modes.find(m => m.name === mode) : null;
  const modeId = targetMode ? targetMode.modeId : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  // Helper to calculate contrast ratio
  function getLuminance(color) {
    const linearize = (val) => val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
    const r = linearize(color.r);
    const g = linearize(color.g);
    const b = linearize(color.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function getContrastRatio(fg, bg) {
    const lum1 = getLuminance(fg);
    const lum2 = getLuminance(bg);
    const lighter = Math.max(lum1, lum2);
    const darker = Math.min(lum1, lum2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // Find foreground/background pairs
  const pairs = [];
  const fgSuffix = '-foreground';

  for (const variable of collectionVariables) {
    if (variable.name.endsWith(fgSuffix)) {
      const baseName = variable.name.slice(0, -fgSuffix.length);
      const baseVariable = collectionVariables.find(v => v.name === baseName);

      if (baseVariable) {
        const fgValue = variable.valuesByMode[modeId];
        const bgValue = baseVariable.valuesByMode[modeId];

        if (fgValue && bgValue && typeof fgValue === 'object' && typeof bgValue === 'object') {
          const ratio = getContrastRatio(fgValue, bgValue);
          const minRatio = standard === 'AAA' ? 7.0 : 4.5;
          const pass = ratio >= minRatio;

          pairs.push({
            foreground: variable.name,
            background: baseVariable.name,
            ratio: parseFloat(ratio.toFixed(2)),
            pass,
            level: standard || 'AA',
            recommendation: pass ? `Meets ${standard} standards` : `Increase contrast - needs ${minRatio}:1 for ${standard} normal text`
          });
        }
      }
    }
  }

  const passed = pairs.filter(p => p.pass).length;
  const failed = pairs.filter(p => !p.pass).length;

  return {
    totalPairs: pairs.length,
    passed,
    failed,
    pairs
  };
}

// 12. suggest_missing_variables
async function suggestMissingVariables(params) {
  const { collectionId, useDefaults } = params;
  const collection = await findCollection(collectionId);
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(v => v.variableCollectionId === collection.id);

  const standardVariables = getStandardSchemaFigma(false);
  const existingNames = collectionVariables.map(v => v.name);
  const missing = standardVariables.filter(name => !existingNames.includes(name));

  const defaultTheme = getDefaultDarkTheme();
  const backgroundColor = defaultTheme['background'];

  const suggestions = missing.map(name => {
    let suggestedValue = useDefaults !== false ? defaultTheme[name] : null;

    // If it's a scale variable and useDefaults is true, calculate it
    if (useDefaults !== false && !suggestedValue && name.match(/-(50|100|200|300|400|500|600|700|800|900)$/)) {
      const baseName = name.split('-')[0];
      const level = name.split('-')[1];
      const baseColor = defaultTheme[baseName];

      if (baseColor) {
        const scale = calculateColorScaleFigma(baseColor, backgroundColor);
        suggestedValue = scale[level];
      }
    }

    return {
      name,
      category: getCategoryForVariable(name),
      suggestedValue,
      description: getDescriptionForVariable(name)
    };
  });

  return {
    missingCount: missing.length,
    suggestions
  };
}

function getCategoryForVariable(name) {
  if (name.match(/^(background|foreground|card|popover)/)) return 'surfaces';
  if (name.match(/^(primary|secondary|tertiary|accent)/)) return 'brand';
  if (name.match(/^(success|info|warning|destructive)/)) return 'states';
  if (name.match(/^(link)/)) return 'interactive';
  if (name.match(/^(overlay|tooltip|placeholder)/)) return 'feedback';
  if (name.match(/^(muted|selected|border|input|ring)/)) return 'utility';
  if (name.match(/^chart-/)) return 'chart';
  return 'unknown';
}

function getDescriptionForVariable(name) {
  const descriptions = {
    'background': 'Background color',
    'foreground': 'Foreground text color',
    'primary': 'Primary brand color',
    'success': 'Success state color',
    'info': 'Info state color',
    'warning': 'Warning state color',
    'destructive': 'Destructive/error state color'
  };

  if (name.endsWith('-foreground')) {
    const base = name.slice(0, -11);
    return `Text/icons for ${base}`;
  }

  if (name.match(/-\d+$/)) {
    return 'Color scale variant';
  }

  return descriptions[name] || 'Theme variable';
}

// 13. apply_default_theme
async function applyDefaultTheme(params) {
  const { collectionId, overwriteExisting, includeChartColors } = params;
  const collection = await findCollection(collectionId);
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(v => v.variableCollectionId === collection.id);
  const existingNames = new Set(collectionVariables.map(v => v.name));

  const defaultTheme = getDefaultDarkTheme();
  const backgroundColor = defaultTheme['background'];
  const modeId = collection.modes[0].modeId;

  let created = 0;
  let updated = 0;
  let skipped = 0;

  // Create base variables
  for (const [name, value] of Object.entries(defaultTheme)) {
    if (existingNames.has(name)) {
      if (overwriteExisting) {
        const variable = collectionVariables.find(v => v.name === name);
        variable.setValueForMode(modeId, value);
        updated++;
      } else {
        skipped++;
      }
    } else {
      const variable = figma.variables.createVariable(name, collection, 'COLOR');
      variable.setValueForMode(modeId, value);
      created++;
    }
  }

  // Create scale variables
  const scaleColors = ['primary', 'secondary', 'accent', 'success', 'info', 'warning', 'destructive'];
  for (const colorName of scaleColors) {
    const baseColor = defaultTheme[colorName];
    if (baseColor) {
      const scale = calculateColorScaleFigma(baseColor, backgroundColor);

      for (const [level, value] of Object.entries(scale)) {
        const varName = `${colorName}-${level}`;

        if (existingNames.has(varName)) {
          if (overwriteExisting) {
            const variable = collectionVariables.find(v => v.name === varName);
            variable.setValueForMode(modeId, value);
            updated++;
          } else {
            skipped++;
          }
        } else {
          const variable = figma.variables.createVariable(varName, collection, 'COLOR');
          variable.setValueForMode(modeId, value);
          created++;
        }
      }
    }
  }

  // Add chart colors if requested
  if (includeChartColors) {
    const chartColors = [
      { r: 0.639, g: 0.902, b: 0.208, a: 1.0 },
      { r: 0.118, g: 0.251, b: 0.686, a: 1.0 },
      { r: 0.863, g: 0.696, b: 0.149, a: 1.0 },
      { r: 0.863, g: 0.149, b: 0.149, a: 1.0 },
      { r: 0.576, g: 0.773, b: 0.992, a: 1.0 },
      { r: 0.078, g: 0.325, b: 0.176, a: 1.0 },
      { r: 0.980, g: 0.588, b: 0.118, a: 1.0 },
      { r: 0.639, g: 0.384, b: 0.863, a: 1.0 }
    ];

    for (let i = 0; i < chartColors.length; i++) {
      const varName = `chart-${i + 1}`;

      if (existingNames.has(varName)) {
        if (overwriteExisting) {
          const variable = collectionVariables.find(v => v.name === varName);
          variable.setValueForMode(modeId, chartColors[i]);
          updated++;
        } else {
          skipped++;
        }
      } else {
        const variable = figma.variables.createVariable(varName, collection, 'COLOR');
        variable.setValueForMode(modeId, chartColors[i]);
        created++;
      }
    }
  }

  const totalVariables = created + updated + skipped;

  return {
    created,
    updated,
    skipped,
    success: true,
    message: `Applied default ${includeChartColors ? 'dark theme with chart colors' : 'dark theme'} - ${created + updated} variables`
  };
}

// 14. create_color_scale_set
async function createColorScaleSet(params) {
  const { collectionId, colorName, baseColor, foregroundColor, backgroundColor, mode } = params;
  const collection = await findCollection(collectionId);
  const targetMode = mode ? collection.modes.find(m => m.name === mode) : null;
  const modeId = targetMode ? targetMode.modeId : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  const created = [];

  // Create base color
  const baseVar = figma.variables.createVariable(colorName, collection, 'COLOR');
  baseVar.setValueForMode(modeId, baseColor);
  created.push(colorName);

  // Create foreground color
  const fgVar = figma.variables.createVariable(`${colorName}-foreground`, collection, 'COLOR');
  fgVar.setValueForMode(modeId, foregroundColor);
  created.push(`${colorName}-foreground`);

  // Create scale
  const scale = calculateColorScaleFigma(baseColor, backgroundColor);
  const scaleVars = [];

  for (const [level, value] of Object.entries(scale)) {
    const varName = `${colorName}-${level}`;
    const variable = figma.variables.createVariable(varName, collection, 'COLOR');
    variable.setValueForMode(modeId, value);
    created.push(varName);
    scaleVars.push(varName);
  }

  return {
    created: created.length,
    variables: {
      base: colorName,
      foreground: `${colorName}-foreground`,
      scale: scaleVars
    },
    success: true
  };
}

// 15. apply_custom_palette
async function applyCustomPalette(params) {
  const { collectionId, palette, backgroundColor, regenerateScales } = params;
  const collection = await findCollection(collectionId);
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(v => v.variableCollectionId === collection.id);
  const modeId = collection.modes[0].modeId;

  let baseColorsUpdated = 0;
  let foregroundsUpdated = 0;
  let scalesRegenerated = 0;

  for (const [colorName, colors] of Object.entries(palette)) {
    // Update or create base color
    let baseVar = collectionVariables.find(v => v.name === colorName);
    if (!baseVar) {
      baseVar = figma.variables.createVariable(colorName, collection, 'COLOR');
    }
    baseVar.setValueForMode(modeId, colors.base);
    baseColorsUpdated++;

    // Update or create foreground color
    let fgVar = collectionVariables.find(v => v.name === `${colorName}-foreground`);
    if (!fgVar) {
      fgVar = figma.variables.createVariable(`${colorName}-foreground`, collection, 'COLOR');
    }
    fgVar.setValueForMode(modeId, colors.foreground);
    foregroundsUpdated++;

    // Regenerate scales if requested
    if (regenerateScales !== false) {
      const scale = calculateColorScaleFigma(colors.base, backgroundColor);

      for (const [level, value] of Object.entries(scale)) {
        const varName = `${colorName}-${level}`;
        let scaleVar = collectionVariables.find(v => v.name === varName);

        if (!scaleVar) {
          scaleVar = figma.variables.createVariable(varName, collection, 'COLOR');
        }
        scaleVar.setValueForMode(modeId, value);
        scalesRegenerated++;
      }
    }
  }

  return {
    baseColorsUpdated,
    foregroundsUpdated,
    scalesRegenerated,
    success: true
  };
}

// 16. reorder_variables
async function reorderVariables(params) {
  const { collectionId, order } = params;
  const collection = await findCollection(collectionId);

  // Note: Figma Plugin API doesn't directly support reordering variables
  // This is a limitation of the current API
  // We'll return success but note the limitation

  return {
    reordered: 0,
    success: true,
    message: 'Variable reordering is not supported by Figma Plugin API. Variables are ordered alphabetically by Figma.'
  };
}

// 17. generate_audit_report
async function generateAuditReport(params) {
  const { collectionId, includeChartColors, format } = params;

  // Get audit data
  const auditData = await auditCollection({ collectionId, includeChartColors });

  if (format === 'json') {
    return auditData;
  }

  // Generate markdown report
  const lines = [];
  lines.push('=== THEME COLLECTION AUDIT REPORT ===');
  lines.push('');
  lines.push(`Status: ${auditData.status}`);
  lines.push(`Total Variables: ${auditData.totalVariables} / ${auditData.expectedVariables} expected`);
  lines.push(`Compliance: ${auditData.compliancePercentage}%`);
  lines.push('');

  if (auditData.missing.count > 0) {
    lines.push(`MISSING VARIABLES (${auditData.missing.count}):`);
    auditData.missing.variables.forEach(name => {
      lines.push(`  - ${name}`);
    });
    lines.push('');
  }

  if (auditData.nonStandard.count > 0) {
    lines.push(`NON-STANDARD VARIABLES (${auditData.nonStandard.count}):`);
    auditData.nonStandard.variables.forEach(item => {
      lines.push(`  - ${item.name} (${item.recommendation})`);
    });
    lines.push('');
  }

  lines.push('RECOMMENDATIONS:');
  if (auditData.missing.count > 0) {
    lines.push(`1. Add ${auditData.missing.count} missing variables to reach ${auditData.expectedVariables}-variable standard`);
  }
  if (auditData.nonStandard.count > 0) {
    lines.push(`2. Review ${auditData.nonStandard.count} non-standard variables (rename/remove)`);
  }
  lines.push('3. Validate color contrast for all foreground variants');

  return lines.join('\n');
}

// 18. export_collection_schema
async function exportCollectionSchema(params) {
  const { collectionId, mode, includeMetadata } = params;
  const collection = await findCollection(collectionId);
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(v => v.variableCollectionId === collection.id);

  const targetMode = mode ? collection.modes.find(m => m.name === mode) : null;
  const modeId = targetMode ? targetMode.modeId : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  const schema = {
    schema_version: '1.2',
    variables: {}
  };

  if (includeMetadata !== false) {
    schema.collection = {
      name: collection.name,
      modes: collection.modes.map(m => m.name),
      exportedMode: mode || collection.modes[0].name,
      variableCount: collectionVariables.length
    };
  }

  for (const variable of collectionVariables) {
    const value = variable.valuesByMode[modeId];

    if (value && typeof value === 'object') {
      schema.variables[variable.name] = {
        type: 'COLOR',
        value,
        category: getCategoryForVariable(variable.name)
      };
    }
  }

  return schema;
}

// 19. import_collection_schema
async function importCollectionSchema(params) {
  const { collectionId, schema, mode, overwriteExisting } = params;
  const collection = await findCollection(collectionId);
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(v => v.variableCollectionId === collection.id);
  const existingNames = new Set(collectionVariables.map(v => v.name));

  const targetMode = mode ? collection.modes.find(m => m.name === mode) : null;
  const modeId = targetMode ? targetMode.modeId : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  for (const [name, varData] of Object.entries(schema.variables)) {
    try {
      if (existingNames.has(name)) {
        if (overwriteExisting) {
          const variable = collectionVariables.find(v => v.name === name);
          variable.setValueForMode(modeId, varData.value);
          updated++;
        } else {
          skipped++;
        }
      } else {
        const variable = figma.variables.createVariable(name, collection, 'COLOR');
        variable.setValueForMode(modeId, varData.value);
        imported++;
      }
    } catch (error) {
      failed++;
      errors.push({ name, error: error.message });
    }
  }

  return {
    imported,
    updated,
    skipped,
    failed,
    errors
  };
}

// 20. create_all_scales
async function createAllScales(params) {
  const { collectionId, baseColors, backgroundColor } = params;
  const collection = await findCollection(collectionId);
  const modeId = collection.modes[0].modeId;

  let created = 0;
  const scales = {};

  for (const [colorName, baseColor] of Object.entries(baseColors)) {
    const scale = calculateColorScaleFigma(baseColor, backgroundColor);
    let scaleCount = 0;

    for (const [level, value] of Object.entries(scale)) {
      const varName = `${colorName}-${level}`;
      const variable = figma.variables.createVariable(varName, collection, 'COLOR');
      variable.setValueForMode(modeId, value);
      scaleCount++;
      created++;
    }

    scales[colorName] = scaleCount;
  }

  return {
    created,
    scales,
    success: true
  };
}

// 21. fix_collection_to_standard
async function fixCollectionToStandard(params) {
  const { collectionId, preserveCustom, addChartColors, useDefaultValues, dryRun } = params;

  // Get current state
  const auditResult = await auditCollection({ collectionId, includeChartColors: addChartColors });

  const analysis = {
    missingBefore: auditResult.missing.count,
    nonStandardBefore: auditResult.nonStandard.count,
    totalBefore: auditResult.totalVariables
  };

  if (dryRun) {
    return {
      analysis,
      actions: {
        variablesAdded: auditResult.missing.count,
        variablesRenamed: 0,
        variablesRemoved: preserveCustom ? 0 : auditResult.nonStandard.count,
        variablesPreserved: preserveCustom ? auditResult.nonStandard.count : 0
      },
      result: {
        totalVariables: auditResult.totalVariables + auditResult.missing.count - (preserveCustom ? 0 : auditResult.nonStandard.count),
        compliance: '100%',
        status: 'Complete (Dry Run)'
      },
      dryRun: true
    };
  }

  // Apply fixes
  let variablesAdded = 0;
  let variablesRemoved = 0;

  // Add missing variables
  if (useDefaultValues !== false && auditResult.missing.count > 0) {
    const result = await applyDefaultTheme({
      collectionId,
      overwriteExisting: false,
      includeChartColors: addChartColors
    });
    variablesAdded = result.created;
  }

  // Remove non-standard variables
  if (!preserveCustom && auditResult.nonStandard.count > 0) {
    const result = await deleteVariablesBatch({
      variableIds: auditResult.nonStandard.variables.map(v => v.name),
      collectionId
    });
    variablesRemoved = result.deleted;
  }

  const finalAudit = await auditCollection({ collectionId, includeChartColors: addChartColors });

  return {
    analysis,
    actions: {
      variablesAdded,
      variablesRenamed: 0,
      variablesRemoved,
      variablesPreserved: preserveCustom ? auditResult.nonStandard.count : 0
    },
    result: {
      totalVariables: finalAudit.totalVariables,
      compliance: `${finalAudit.compliancePercentage}%`,
      status: finalAudit.status
    },
    success: true
  };
}

// 22. add_chart_colors
async function addChartColors(params) {
  const { collectionId, chartColors } = params;
  const collection = await findCollection(collectionId);
  const modeId = collection.modes[0].modeId;

  const defaultChartColors = [
    { r: 0.639, g: 0.902, b: 0.208, a: 1.0 },
    { r: 0.118, g: 0.251, b: 0.686, a: 1.0 },
    { r: 0.863, g: 0.696, b: 0.149, a: 1.0 },
    { r: 0.863, g: 0.149, b: 0.149, a: 1.0 },
    { r: 0.576, g: 0.773, b: 0.992, a: 1.0 },
    { r: 0.078, g: 0.325, b: 0.176, a: 1.0 },
    { r: 0.980, g: 0.588, b: 0.118, a: 1.0 },
    { r: 0.639, g: 0.384, b: 0.863, a: 1.0 }
  ];

  const colors = chartColors || defaultChartColors;
  const created = [];

  for (let i = 0; i < Math.min(colors.length, 8); i++) {
    const varName = `chart-${i + 1}`;
    const variable = figma.variables.createVariable(varName, collection, 'COLOR');
    variable.setValueForMode(modeId, colors[i]);
    created.push(varName);
  }

  return {
    created: created.length,
    chartColors: created,
    success: true
  };
}

// ========================================
// MODE MANAGEMENT FUNCTIONS
// ========================================

async function addModeToCollection(params) {
  const { collectionId, modeName } = params;
  const collection = await findCollection(collectionId);

  // Add new mode to collection
  const newModeId = collection.addMode(modeName);

  // Find the newly created mode
  const newMode = collection.modes.find(m => m.modeId === newModeId);

  return {
    collectionId: collection.id,
    collectionName: collection.name,
    modeId: newModeId,
    modeName: newMode ? newMode.name : modeName,
    totalModes: collection.modes.length,
    success: true
  };
}

async function renameMode(params) {
  const { collectionId, oldModeName, newModeName } = params;
  const collection = await findCollection(collectionId);

  // Find mode by name
  const mode = collection.modes.find(m => m.name === oldModeName);
  if (!mode) {
    throw new Error(`Mode "${oldModeName}" not found in collection`);
  }

  // Rename the mode
  collection.renameMode(mode.modeId, newModeName);

  return {
    collectionId: collection.id,
    collectionName: collection.name,
    modeId: mode.modeId,
    oldName: oldModeName,
    newName: newModeName,
    success: true
  };
}

async function deleteMode(params) {
  const { collectionId, modeName } = params;
  const collection = await findCollection(collectionId);

  // Cannot delete if only one mode
  if (collection.modes.length <= 1) {
    throw new Error('Cannot delete the last mode in a collection');
  }

  // Find mode by name
  const mode = collection.modes.find(m => m.name === modeName);
  if (!mode) {
    throw new Error(`Mode "${modeName}" not found in collection`);
  }

  // Delete the mode
  collection.removeMode(mode.modeId);

  return {
    collectionId: collection.id,
    collectionName: collection.name,
    deletedMode: modeName,
    remainingModes: collection.modes.map(m => m.name),
    success: true
  };
}

async function duplicateModeValues(params) {
  const { collectionId, sourceMode, targetMode, transformColors } = params;
  const collection = await findCollection(collectionId);

  // Find source and target modes
  const sourceModeObj = collection.modes.find(m => m.name === sourceMode);
  const targetModeObj = collection.modes.find(m => m.name === targetMode);

  if (!sourceModeObj) {
    throw new Error(`Source mode "${sourceMode}" not found`);
  }
  if (!targetModeObj) {
    throw new Error(`Target mode "${targetMode}" not found`);
  }

  const sourceModeId = sourceModeObj.modeId;
  const targetModeId = targetModeObj.modeId;

  // Get all variables in the collection
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(v => v.variableCollectionId === collection.id);

  let copied = 0;
  let transformed = 0;

  for (const variable of collectionVariables) {
    try {
      // Get value from source mode
      const sourceValue = variable.valuesByMode[sourceModeId];

      if (sourceValue === undefined) {
        continue; // Skip if no value in source mode
      }

      let targetValue = sourceValue;

      // Apply color transformations if specified
      if (transformColors && variable.resolvedType === 'COLOR' && typeof sourceValue === 'object') {
        const brightnessAdj = transformColors.brightness_adjustment || 0;

        if (brightnessAdj !== 0) {
          // Apply brightness adjustment
          targetValue = {
            r: Math.max(0, Math.min(1, sourceValue.r + brightnessAdj)),
            g: Math.max(0, Math.min(1, sourceValue.g + brightnessAdj)),
            b: Math.max(0, Math.min(1, sourceValue.b + brightnessAdj)),
            a: sourceValue.a !== undefined ? sourceValue.a : 1
          };
          transformed++;
        }
      }

      // Set value for target mode
      variable.setValueForMode(targetModeId, targetValue);
      copied++;
    } catch (error) {
      console.error(`Error copying variable ${variable.name}:`, error);
    }
  }

  return {
    collectionId: collection.id,
    collectionName: collection.name,
    sourceMode,
    targetMode,
    variablesCopied: copied,
    variablesTransformed: transformed,
    success: true
  };
}

// ============================================================
// DESIGN SYSTEM PRESET HANDLERS
// ============================================================

async function createSpacingSystem(params) {
  const { collection_id, preset, include_semantic } = params;
  const collection = await findCollection(collection_id);

  // Spacing presets
  const presets = {
    "8pt": { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96, 32: 128, 40: 160, 48: 192, 56: 224, 64: 256 },
    "4pt": { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 9: 36, 10: 40, 11: 44, 12: 48, 14: 56, 16: 64, 20: 80, 24: 96, 28: 112, 32: 128 },
    "tailwind": { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96, 32: 128, 40: 160, 48: 192, 64: 256 },
    "material": { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96 }
  };

  const spacingValues = presets[preset] || presets["8pt"];
  const variables = [];

  for (const [key, value] of Object.entries(spacingValues)) {
    const variable = figma.variables.createVariable(`spacing/${key}`, collection, "FLOAT");
    const mode = collection.modes[0];
    variable.setValueForMode(mode.modeId, value);
    variables.push(`spacing/${key}`);
  }

  return {
    success: true,
    primitiveCount: variables.length,
    primitiveVariables: variables,
    preset: preset
  };
}

async function createTypographySystem(params) {
  const { collection_id, scale_preset, base_size, include_weights, include_line_heights, include_semantic } = params;
  const collection = await findCollection(collection_id);

  const ratios = {
    "minor-third": 1.200,
    "major-third": 1.250,
    "perfect-fourth": 1.333
  };

  const ratio = ratios[scale_preset] || 1.250;
  const base = base_size || 16;
  const variables = [];

  // Font sizes
  const sizes = {
    xs: base / (ratio * ratio),
    sm: base / ratio,
    base: base,
    lg: base * ratio,
    xl: base * ratio * ratio,
    "2xl": base * ratio * ratio * ratio,
    "3xl": base * ratio * ratio * ratio * ratio,
    "4xl": base * ratio * ratio * ratio * ratio * ratio,
    "5xl": base * ratio * ratio * ratio * ratio * ratio * ratio
  };

  const mode = collection.modes[0];

  for (const [key, value] of Object.entries(sizes)) {
    const variable = figma.variables.createVariable(`font.size.${key}`, collection, "FLOAT");
    variable.setValueForMode(mode.modeId, Math.round(value));
    variables.push(`font.size.${key}`);
  }

  // Font weights
  if (include_weights) {
    const weights = { thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
    for (const [key, value] of Object.entries(weights)) {
      const variable = figma.variables.createVariable(`font.weight.${key}`, collection, "FLOAT");
      variable.setValueForMode(mode.modeId, value);
      variables.push(`font.weight.${key}`);
    }
  }

  // Line heights
  if (include_line_heights) {
    const lineHeights = { none: 1, tight: 1.25, snug: 1.375, normal: 1.5, relaxed: 1.625, loose: 2 };
    for (const [key, value] of Object.entries(lineHeights)) {
      const variable = figma.variables.createVariable(`font.lineHeight.${key}`, collection, "FLOAT");
      variable.setValueForMode(mode.modeId, value);
      variables.push(`font.lineHeight.${key}`);
    }
  }

  return {
    success: true,
    totalVariables: variables.length,
    variables: variables,
    preset: scale_preset
  };
}

async function createRadiusSystem(params) {
  const { collection_id, preset } = params;
  const collection = await findCollection(collection_id);

  const presets = {
    "standard": { none: 0, sm: 4, md: 8, lg: 12, xl: 16, "2xl": 24, "3xl": 32, full: 9999 },
    "subtle": { none: 0, sm: 2, md: 4, lg: 6, xl: 8, "2xl": 12, "3xl": 16, full: 9999 },
    "bold": { none: 0, sm: 8, md: 16, lg: 24, xl: 32, "2xl": 48, "3xl": 64, full: 9999 }
  };

  const radiusValues = presets[preset] || presets["standard"];
  const variables = [];
  const mode = collection.modes[0];

  for (const [key, value] of Object.entries(radiusValues)) {
    const variable = figma.variables.createVariable(`radius/${key}`, collection, "FLOAT");
    variable.setValueForMode(mode.modeId, value);
    variables.push(`radius/${key}`);
  }

  return {
    success: true,
    totalVariables: variables.length,
    variables: variables,
    preset: preset
  };
}

// ============================================================
// NEW COMMAND IMPLEMENTATIONS
// ============================================================

// AUTO LAYOUT INDIVIDUAL COMMANDS

async function setLayoutMode(params) {
  const { nodeId, layoutMode, layoutWrap } = params;
  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  if (node.type !== 'FRAME' && node.type !== 'COMPONENT' && node.type !== 'INSTANCE' && node.type !== 'COMPONENT_SET') {
    throw new Error(`Node "${node.name}" does not support auto layout (type: ${node.type})`);
  }

  node.layoutMode = layoutMode;
  if (layoutWrap !== undefined) {
    node.layoutWrap = layoutWrap;
  }

  return {
    nodeId: node.id,
    nodeName: node.name,
    layoutMode: node.layoutMode,
    layoutWrap: node.layoutWrap,
    success: true
  };
}

async function setPadding(params) {
  const { nodeId, paddingTop, paddingRight, paddingBottom, paddingLeft } = params;
  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  if (node.type !== 'FRAME' && node.type !== 'COMPONENT' && node.type !== 'INSTANCE' && node.type !== 'COMPONENT_SET') {
    throw new Error(`Node "${node.name}" does not support padding (type: ${node.type})`);
  }

  if (paddingTop !== undefined) node.paddingTop = paddingTop;
  if (paddingRight !== undefined) node.paddingRight = paddingRight;
  if (paddingBottom !== undefined) node.paddingBottom = paddingBottom;
  if (paddingLeft !== undefined) node.paddingLeft = paddingLeft;

  return {
    nodeId: node.id,
    nodeName: node.name,
    paddingTop: node.paddingTop,
    paddingRight: node.paddingRight,
    paddingBottom: node.paddingBottom,
    paddingLeft: node.paddingLeft,
    success: true
  };
}

async function setItemSpacing(params) {
  const { nodeId, itemSpacing, counterAxisSpacing } = params;
  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  if (node.type !== 'FRAME' && node.type !== 'COMPONENT' && node.type !== 'INSTANCE' && node.type !== 'COMPONENT_SET') {
    throw new Error(`Node "${node.name}" does not support item spacing (type: ${node.type})`);
  }

  if (itemSpacing !== undefined) node.itemSpacing = itemSpacing;
  if (counterAxisSpacing !== undefined) node.counterAxisSpacing = counterAxisSpacing;

  return {
    nodeId: node.id,
    nodeName: node.name,
    itemSpacing: node.itemSpacing,
    counterAxisSpacing: node.counterAxisSpacing,
    success: true
  };
}

async function setAxisAlign(params) {
  const { nodeId, primaryAxisAlignItems, counterAxisAlignItems } = params;
  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  if (node.type !== 'FRAME' && node.type !== 'COMPONENT' && node.type !== 'INSTANCE' && node.type !== 'COMPONENT_SET') {
    throw new Error(`Node "${node.name}" does not support axis alignment (type: ${node.type})`);
  }

  if (primaryAxisAlignItems !== undefined) node.primaryAxisAlignItems = primaryAxisAlignItems;
  if (counterAxisAlignItems !== undefined) node.counterAxisAlignItems = counterAxisAlignItems;

  return {
    nodeId: node.id,
    nodeName: node.name,
    primaryAxisAlignItems: node.primaryAxisAlignItems,
    counterAxisAlignItems: node.counterAxisAlignItems,
    success: true
  };
}

async function setLayoutSizing(params) {
  const { nodeId, layoutSizingHorizontal, layoutSizingVertical } = params;
  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  if (node.type !== 'FRAME' && node.type !== 'COMPONENT' && node.type !== 'INSTANCE' && node.type !== 'COMPONENT_SET') {
    throw new Error(`Node "${node.name}" does not support layout sizing (type: ${node.type})`);
  }

  if (layoutSizingHorizontal !== undefined) node.layoutSizingHorizontal = layoutSizingHorizontal;
  if (layoutSizingVertical !== undefined) node.layoutSizingVertical = layoutSizingVertical;

  return {
    nodeId: node.id,
    nodeName: node.name,
    layoutSizingHorizontal: node.layoutSizingHorizontal,
    layoutSizingVertical: node.layoutSizingVertical,
    success: true
  };
}

// SELECTION AND FOCUS COMMANDS

async function setFocus(params) {
  const { nodeId } = params;
  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Set selection and zoom to node
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);

  return {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    focused: true,
    success: true
  };
}

async function setSelections(params) {
  const { nodeIds } = params;

  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    throw new Error('nodeIds must be a non-empty array');
  }

  const nodes = [];
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (node) {
      nodes.push(node);
    }
  }

  if (nodes.length === 0) {
    throw new Error('No valid nodes found with provided IDs');
  }

  figma.currentPage.selection = nodes;
  figma.viewport.scrollAndZoomIntoView(nodes);

  return {
    selectedCount: nodes.length,
    selectedNodes: nodes.map(n => ({
      id: n.id,
      name: n.name,
      type: n.type
    })),
    success: true
  };
}

async function readMyDesign() {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    throw new Error('No nodes selected. Please select nodes in Figma first.');
  }

  const processNode = async (node) => {
    const baseInfo = {
      id: node.id,
      name: node.name,
      type: node.type,
      visible: node.visible
    };

    // Add position and size if available
    if ('x' in node && 'y' in node && 'width' in node && 'height' in node) {
      baseInfo.x = node.x;
      baseInfo.y = node.y;
      baseInfo.width = node.width;
      baseInfo.height = node.height;
    }

    // Add fill information
    if ('fills' in node && node.fills !== figma.mixed) {
      baseInfo.fills = node.fills.map(fill => {
        const fillInfo = {
          type: fill.type,
          visible: fill.visible
        };
        if (fill.type === 'SOLID' && fill.color) {
          fillInfo.color = `#${Math.round(fill.color.r * 255).toString(16).padStart(2, '0')}${Math.round(fill.color.g * 255).toString(16).padStart(2, '0')}${Math.round(fill.color.b * 255).toString(16).padStart(2, '0')}`;
          fillInfo.opacity = fill.opacity;
        }
        return fillInfo;
      });
    }

    // Add text content for text nodes
    if (node.type === 'TEXT') {
      baseInfo.characters = node.characters;
      baseInfo.fontSize = node.fontSize;
      baseInfo.fontName = node.fontName;
    }

    // Add children if it's a container
    if ('children' in node && node.children.length > 0) {
      baseInfo.children = [];
      for (const child of node.children) {
        baseInfo.children.push(await processNode(child));
      }
    }

    return baseInfo;
  };

  const result = [];
  for (const node of selection) {
    result.push(await processNode(node));
  }

  return {
    selectionCount: selection.length,
    selection: result
  };
}

// SCAN COMMANDS

async function scanNodesByTypes(params) {
  const { nodeId, types } = params;

  if (!Array.isArray(types) || types.length === 0) {
    throw new Error('types must be a non-empty array');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  const results = [];

  const scanNode = (n, depth = 0) => {
    if (types.includes(n.type)) {
      const nodeInfo = {
        id: n.id,
        name: n.name,
        type: n.type,
        depth: depth
      };
      if (n.x !== undefined) nodeInfo.x = n.x;
      if (n.y !== undefined) nodeInfo.y = n.y;
      if (n.width !== undefined) nodeInfo.width = n.width;
      if (n.height !== undefined) nodeInfo.height = n.height;
      results.push(nodeInfo);
    }

    // Recursively scan children
    if ('children' in n) {
      for (const child of n.children) {
        scanNode(child, depth + 1);
      }
    }
  };

  scanNode(node);

  return {
    rootNodeId: nodeId,
    rootNodeName: node.name,
    types: types,
    foundCount: results.length,
    nodes: results
  };
}

// ANNOTATION COMMANDS

const ANNOTATION_SUPPORTED_TYPES = [
  "COMPONENT", "COMPONENT_SET", "ELLIPSE", "FRAME",
  "INSTANCE", "LINE", "POLYGON", "RECTANGLE", "STAR",
  "TEXT", "VECTOR"
];

const ANNOTATION_VALID_COLORS = ["blue", "green", "yellow", "orange", "red", "purple", "gray", "teal"];

function isAnnotationSupported(node) {
  return ANNOTATION_SUPPORTED_TYPES.includes(node.type);
}

async function getAnnotations(params) {
  const { nodeId, includeCategories } = params;

  const targetNode = await figma.getNodeByIdAsync(nodeId);
  if (!targetNode) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  if (!isAnnotationSupported(targetNode)) {
    return {
      success: true,
      nodeId: targetNode.id,
      nodeName: targetNode.name,
      nodeType: targetNode.type,
      annotationCount: 0,
      annotations: [],
      message: `Node type ${targetNode.type} does not support annotations`
    };
  }

  const rawAnnotations = targetNode.annotations || [];
  const annotations = [];

  for (let i = 0; i < rawAnnotations.length; i++) {
    const ann = rawAnnotations[i];
    const entry = {
      index: i,
      label: ann.label || "",
      labelMarkdown: ann.labelMarkdown || "",
    };

    if (ann.categoryId) {
      entry.categoryId = ann.categoryId;
      if (includeCategories) {
        try {
          const category = await figma.annotations.getAnnotationCategoryByIdAsync(ann.categoryId);
          if (category) {
            entry.category = {
              id: category.id,
              label: category.label,
              color: category.color,
              isPreset: category.isPreset
            };
          }
        } catch (e) {
          // Category may have been deleted
        }
      }
    }

    if (ann.properties && ann.properties.length > 0) {
      entry.properties = ann.properties;
    }

    annotations.push(entry);
  }

  return {
    success: true,
    nodeId: targetNode.id,
    nodeName: targetNode.name,
    nodeType: targetNode.type,
    annotationCount: annotations.length,
    annotations
  };
}

async function setAnnotation(params) {
  const { nodeId, labelMarkdown, categoryId, properties, annotationId } = params;

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  if (!isAnnotationSupported(node)) {
    throw new Error(`Node type ${node.type} does not support annotations. Supported types: ${ANNOTATION_SUPPORTED_TYPES.join(", ")}`);
  }

  const annotation = { labelMarkdown: labelMarkdown || "" };
  if (categoryId) {
    annotation.categoryId = categoryId;
  }
  if (properties && Array.isArray(properties) && properties.length > 0) {
    annotation.properties = properties;
  }

  // Deep-copy existing annotations (readonly objects from Figma)
  const existingAnnotations = (node.annotations || []).map(a => {
    const copy = { labelMarkdown: a.labelMarkdown || "" };
    if (a.categoryId) copy.categoryId = a.categoryId;
    if (a.properties) copy.properties = a.properties.map(p => ({ ...p }));
    return copy;
  });

  let annotationIndex;

  if (annotationId !== undefined && annotationId !== null) {
    const idx = parseInt(annotationId, 10);
    if (isNaN(idx) || idx < 0 || idx >= existingAnnotations.length) {
      const rangeMsg = existingAnnotations.length === 0
        ? "no annotations exist on this node"
        : `valid range: 0-${existingAnnotations.length - 1}`;
      throw new Error(`Invalid annotation index ${annotationId}. ${rangeMsg}`);
    }
    existingAnnotations[idx] = annotation;
    annotationIndex = idx;
  } else {
    annotationIndex = existingAnnotations.length;
    existingAnnotations.push(annotation);
  }

  node.annotations = existingAnnotations;

  return {
    success: true,
    nodeId: node.id,
    nodeName: node.name,
    annotationIndex,
    totalAnnotations: existingAnnotations.length,
    annotation
  };
}

async function setMultipleAnnotations(params) {
  const { annotations } = params;

  if (!Array.isArray(annotations)) {
    throw new Error('annotations must be an array');
  }

  const results = [];
  let applied = 0;
  let failed = 0;

  for (const entry of annotations) {
    try {
      const result = await setAnnotation({
        nodeId: entry.nodeId,
        labelMarkdown: entry.labelMarkdown,
        categoryId: entry.categoryId,
        properties: entry.properties,
        annotationId: entry.annotationId
      });
      results.push({ success: true, nodeId: entry.nodeId, annotationIndex: result.annotationIndex });
      applied++;
    } catch (e) {
      results.push({ success: false, nodeId: entry.nodeId, error: e.message || String(e) });
      failed++;
    }
  }

  return {
    success: failed === 0,
    annotationsApplied: applied,
    annotationsFailed: failed,
    completedInChunks: 1,
    results
  };
}

// ANNOTATION CATEGORY COMMANDS

async function getAnnotationCategories() {
  const categories = await figma.annotations.getAnnotationCategoriesAsync();
  return {
    success: true,
    count: categories.length,
    categories: categories.map(c => ({
      id: c.id,
      label: c.label,
      color: c.color,
      isPreset: c.isPreset
    }))
  };
}

async function createAnnotationCategory(params) {
  const { label, color } = params;

  if (!label || typeof label !== "string" || label.trim() === "") {
    throw new Error("label is required and must be a non-empty string");
  }

  const categoryColor = color || "blue";
  if (!ANNOTATION_VALID_COLORS.includes(categoryColor)) {
    throw new Error(`Invalid color "${categoryColor}". Valid colors: ${ANNOTATION_VALID_COLORS.join(", ")}`);
  }

  const category = await figma.annotations.addAnnotationCategoryAsync(label.trim(), categoryColor);

  return {
    success: true,
    category: {
      id: category.id,
      label: category.label,
      color: category.color,
      isPreset: category.isPreset
    }
  };
}

async function updateAnnotationCategory(params) {
  const { categoryId, label, color } = params;

  if (!categoryId) {
    throw new Error("categoryId is required");
  }

  const category = await figma.annotations.getAnnotationCategoryByIdAsync(categoryId);
  if (!category) {
    throw new Error(`Annotation category with ID ${categoryId} not found`);
  }

  if (category.isPreset) {
    throw new Error("Cannot modify a preset annotation category");
  }

  if (label !== undefined && label !== null) {
    if (typeof label !== "string" || label.trim() === "") {
      throw new Error("label must be a non-empty string");
    }
    await category.setLabelAsync(label.trim());
  }

  if (color !== undefined && color !== null) {
    if (!ANNOTATION_VALID_COLORS.includes(color)) {
      throw new Error(`Invalid color "${color}". Valid colors: ${ANNOTATION_VALID_COLORS.join(", ")}`);
    }
    await category.setColorAsync(color);
  }

  return {
    success: true,
    category: {
      id: category.id,
      label: category.label,
      color: category.color,
      isPreset: category.isPreset
    }
  };
}

async function deleteAnnotationCategory(params) {
  const { categoryId } = params;

  if (!categoryId) {
    throw new Error("categoryId is required");
  }

  const category = await figma.annotations.getAnnotationCategoryByIdAsync(categoryId);
  if (!category) {
    throw new Error(`Annotation category with ID ${categoryId} not found`);
  }

  if (category.isPreset) {
    throw new Error("Cannot delete a preset annotation category");
  }

  await category.removeAsync();

  return {
    success: true,
    deletedCategoryId: categoryId
  };
}

// PROTOTYPING COMMANDS

async function getReactions(params) {
  const { nodeIds } = params;

  if (!Array.isArray(nodeIds)) {
    throw new Error('nodeIds must be an array');
  }

  const results = [];

  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) continue;

    if ('reactions' in node) {
      results.push({
        nodeId: node.id,
        nodeName: node.name,
        reactionCount: node.reactions.length,
        reactions: node.reactions.map(reaction => ({
          trigger: reaction.trigger ? {
            type: reaction.trigger.type
          } : null,
          actions: reaction.actions.map(action => {
            const actionInfo = {
              type: action.type
            };
            if (action.type === 'NODE' && action.destinationId) {
              actionInfo.destinationId = action.destinationId;
            }
            return actionInfo;
          })
        }))
      });
    }
  }

  return {
    nodeCount: nodeIds.length,
    nodesWithReactions: results.length,
    reactions: results
  };
}

async function setDefaultConnector(params) {
  const { connectorId } = params;

  const connector = await figma.getNodeByIdAsync(connectorId);
  if (!connector) {
    throw new Error(`Connector node with ID ${connectorId} not found`);
  }

  if (connector.type !== 'CONNECTOR') {
    throw new Error(`Node "${connector.name}" is not a connector (type: ${connector.type})`);
  }

  // Note: Setting default connector is not directly supported in plugin API
  // This would require UI interaction

  return {
    connectorId: connector.id,
    connectorName: connector.name,
    message: 'Default connector setting is not available in Figma Plugin API. Use Figma UI.',
    success: false
  };
}

async function createConnections(params) {
  const { connections } = params;

  if (!Array.isArray(connections)) {
    throw new Error('connections must be an array');
  }

  const results = [];

  for (const conn of connections) {
    const { startNodeId, endNodeId, text } = conn;

    const startNode = await figma.getNodeByIdAsync(startNodeId);
    const endNode = await figma.getNodeByIdAsync(endNodeId);

    if (!startNode || !endNode) {
      results.push({
        startNodeId,
        endNodeId,
        success: false,
        error: 'One or both nodes not found'
      });
      continue;
    }

    try {
      // Create connector
      const connector = figma.createConnector();
      connector.connectorStart = {
        endpointNodeId: startNode.id,
        magnet: 'AUTO'
      };
      connector.connectorEnd = {
        endpointNodeId: endNode.id,
        magnet: 'AUTO'
      };

      // Add text label if provided
      if (text) {
        connector.connectorLineType = 'ELBOWED';
        connector.textBackground = {
          cornerRadius: 4,
          fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
        };
      }

      figma.currentPage.appendChild(connector);

      results.push({
        startNodeId,
        endNodeId,
        connectorId: connector.id,
        success: true
      });
    } catch (error) {
      results.push({
        startNodeId,
        endNodeId,
        success: false,
        error: error.message
      });
    }
  }

  return {
    totalRequested: connections.length,
    successCount: results.filter(r => r.success).length,
    failedCount: results.filter(r => !r.success).length,
    connections: results
  };
}
