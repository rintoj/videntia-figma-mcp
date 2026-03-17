import { customBase64Encode } from '../utils/base64';
import { debugLog, parseNum } from '../utils/helpers';
import { selectAndFocusNode } from '../utils/plugin-state';

function getParam<T>(params: Record<string, unknown>, key: string, defaultVal: T): T {
  const p = params !== null && params !== undefined ? params[key] : undefined;
  return (p !== null && p !== undefined) ? p as T : defaultVal;
}

function getOptParam<T>(params: Record<string, unknown>, key: string): T | undefined {
  if (params === null || params === undefined) return undefined;
  const p = params[key];
  return (p !== null && p !== undefined) ? p as T : undefined;
}

export async function createRectangle(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const x: number = getParam<number>(params, 'x', 0);
  const y: number = getParam<number>(params, 'y', 0);
  const width: number = getParam<number>(params, 'width', 100);
  const height: number = getParam<number>(params, 'height', 100);
  const name: string = getParam<string>(params, 'name', 'Rectangle');
  const parentId: string | undefined = getOptParam<string>(params, 'parentId');
  const layoutPositioning: string | undefined = getOptParam<string>(params, 'layoutPositioning');

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
    if (!('appendChild' in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    (parentNode as FrameNode).appendChild(rect);
  } else {
    figma.currentPage.appendChild(rect);
  }

  // Set layoutPositioning after appendChild (node must be attached first)
  if (layoutPositioning !== undefined) {
    (rect as unknown as { layoutPositioning: string }).layoutPositioning = layoutPositioning;
    // Re-apply coordinates — setting ABSOLUTE resets position within parent
    rect.x = x;
    rect.y = y;
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

export async function createFrame(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const x: number = getParam<number>(params, 'x', 0);
  const y: number = getParam<number>(params, 'y', 0);
  const width: number = getParam<number>(params, 'width', 100);
  const height: number = getParam<number>(params, 'height', 100);
  const name: string = getParam<string>(params, 'name', 'Frame');
  const parentId: string | undefined = getOptParam<string>(params, 'parentId');
  const fillColor: Record<string, unknown> | undefined = getOptParam<Record<string, unknown>>(params, 'fillColor');
  const strokeColor: Record<string, unknown> | undefined = getOptParam<Record<string, unknown>>(params, 'strokeColor');
  const strokeWeight: number | undefined = getOptParam<number>(params, 'strokeWeight');
  const clipsContent: boolean | undefined = getOptParam<boolean>(params, 'clipsContent');
  const layoutPositioning: string | undefined = getOptParam<string>(params, 'layoutPositioning');

  const frame = figma.createFrame();
  frame.x = x;
  frame.y = y;
  frame.resize(width, height);
  frame.name = name;

  // Set fill color if provided, otherwise clear the default white fill
  if (fillColor) {
    const paintStyle: SolidPaint = {
      type: 'SOLID',
      color: {
        r: parseNum(fillColor['r'], 0),
        g: parseNum(fillColor['g'], 0),
        b: parseNum(fillColor['b'], 0),
      },
      opacity: parseNum(fillColor['a'], 1),
    };
    frame.fills = [paintStyle];
  } else {
    frame.fills = [];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    const strokeStyle: SolidPaint = {
      type: 'SOLID',
      color: {
        r: parseNum(strokeColor['r'], 0),
        g: parseNum(strokeColor['g'], 0),
        b: parseNum(strokeColor['b'], 0),
      },
      opacity: parseNum(strokeColor['a'], 1),
    };
    frame.strokes = [strokeStyle];
  }

  // Set stroke weight if provided
  if (strokeWeight !== undefined) {
    frame.strokeWeight = strokeWeight;
  }

  // Set clipsContent if provided
  if (clipsContent !== undefined) {
    frame.clipsContent = clipsContent;
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!('appendChild' in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    (parentNode as FrameNode).appendChild(frame);
  } else {
    figma.currentPage.appendChild(frame);
  }

  // Set layoutPositioning after appendChild (node must be attached first)
  if (layoutPositioning !== undefined) {
    (frame as unknown as { layoutPositioning: string }).layoutPositioning = layoutPositioning;
    // Re-apply coordinates — setting ABSOLUTE resets position within parent
    frame.x = x;
    frame.y = y;
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
    clipsContent: frame.clipsContent,
    parentId: frame.parent ? frame.parent.id : undefined,
  };
}

export async function moveNode(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = getOptParam<string>(params, 'nodeId');
  const x = getOptParam<number>(params, 'x');
  const y = getOptParam<number>(params, 'y');
  const parentId = getOptParam<string>(params, 'parentId');
  const index = getOptParam<number>(params, 'index');

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Reparent if parentId is provided
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!('appendChild' in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    const parent = parentNode as FrameNode | GroupNode | ComponentNode | PageNode;
    if (index !== undefined) {
      parent.insertChild(index, node as SceneNode);
    } else {
      parent.appendChild(node as SceneNode);
    }
  }

  // Reposition if x/y provided
  if (x !== undefined && y !== undefined) {
    if (!('x' in node) || !('y' in node)) {
      throw new Error(`Node does not support position: ${nodeId}`);
    }
    (node as SceneNode & { x: number; y: number }).x = x;
    (node as SceneNode & { x: number; y: number }).y = y;
  } else if (x !== undefined) {
    (node as SceneNode & { x: number }).x = x;
  } else if (y !== undefined) {
    (node as SceneNode & { y: number }).y = y;
  }

  return {
    id: node.id,
    name: node.name,
    x: 'x' in node ? (node as SceneNode & { x: number }).x : undefined,
    y: 'y' in node ? (node as SceneNode & { y: number }).y : undefined,
  };
}

export async function resizeNode(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = getOptParam<string>(params, 'nodeId');
  const width = getOptParam<number>(params, 'width');
  const height = getOptParam<number>(params, 'height');

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  if (width === undefined || height === undefined) {
    throw new Error('Missing width or height parameters');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!('resize' in node)) {
    throw new Error(`Node does not support resizing: ${nodeId}`);
  }

  (node as FrameNode).resize(width, height);

  return {
    id: node.id,
    name: node.name,
    width: (node as FrameNode).width,
    height: (node as FrameNode).height,
  };
}

export async function deleteNode(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = getOptParam<string>(params, 'nodeId');

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
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

export async function deleteMultipleNodes(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeIds = getOptParam<string[]>(params, 'nodeIds');

  if (!nodeIds || !Array.isArray(nodeIds)) {
    throw new Error('Missing or invalid nodeIds parameter - must be an array');
  }

  if (nodeIds.length === 0) {
    throw new Error('nodeIds array is empty');
  }

  const deletedNodes: Array<{ id: string; name: string; type: string }> = [];
  const errors: Array<{ nodeId: string; error: string }> = [];

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
      errors.push({ nodeId, error: (error as Error).message });
    }
  }

  return {
    deletedNodes,
    deletedCount: deletedNodes.length,
    errors: errors.length > 0 ? errors : undefined,
    totalRequested: nodeIds.length,
  };
}

export async function exportNodeAsImage(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = getOptParam<string>(params, 'nodeId');
  const scale: number = getParam<number>(params, 'scale', 1);

  const format = 'PNG';
  const MAX_DIMENSION = 7680; // Stay under Claude's 8000px limit with some margin

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!('exportAsync' in node)) {
    throw new Error(`Node does not support exporting: ${nodeId}`);
  }

  try {
    // Get node dimensions
    const nodeWidth = ('width' in node ? (node as FrameNode).width : 0) || 0;
    const nodeHeight = ('height' in node ? (node as FrameNode).height : 0) || 0;

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

    const settings: ExportSettingsImage = {
      format: format,
      constraint: { type: 'SCALE', value: finalScale },
    };

    const bytes = await (node as FrameNode).exportAsync(settings);

    // Use a local string variable so the switch is not narrowed to the literal type 'PNG'
    const formatStr: string = format;
    let mimeType: string;
    if (formatStr === 'PNG') {
      mimeType = 'image/png';
    } else if (formatStr === 'JPG') {
      mimeType = 'image/jpeg';
    } else if (formatStr === 'SVG') {
      mimeType = 'image/svg+xml';
    } else if (formatStr === 'PDF') {
      mimeType = 'application/pdf';
    } else {
      mimeType = 'application/octet-stream';
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
    throw new Error(`Error exporting node as image: ${(error as Error).message}`);
  }
}

export async function exportImageFill(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = getOptParam<string>(params, 'nodeId');
  const fillIndex = getParam<number>(params, 'fillIndex', 0);

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!('fills' in node)) {
    throw new Error(`Node does not have fills: ${nodeId}`);
  }

  const fills = (node as GeometryMixin).fills;
  if (fills === figma.mixed) {
    throw new Error('Node has mixed fills — specify a text range or use a different node');
  }

  if (!Array.isArray(fills) || fills.length === 0) {
    throw new Error('Node has no fills');
  }

  // Find image fills
  const imageFills = fills
    .map((f, i) => ({ fill: f, index: i }))
    .filter(({ fill }) => fill.type === 'IMAGE');

  if (imageFills.length === 0) {
    throw new Error('Node has no image fills. Fill types present: ' + fills.map(f => f.type).join(', '));
  }

  if (fillIndex >= imageFills.length) {
    throw new Error(`fillIndex ${fillIndex} out of range. Node has ${imageFills.length} image fill(s).`);
  }

  const imagePaint = imageFills[fillIndex].fill as ImagePaint;
  const imageHash = imagePaint.imageHash;

  if (!imageHash) {
    throw new Error('Image fill has no imageHash — the image may not be loaded');
  }

  const image = figma.getImageByHash(imageHash);
  if (!image) {
    throw new Error(`Could not retrieve image for hash: ${imageHash}`);
  }

  try {
    const bytes = await image.getBytesAsync();
    const size = await image.getSizeAsync();
    const base64 = customBase64Encode(bytes);

    // Detect MIME type from byte header
    let mimeType = 'application/octet-stream';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      mimeType = 'image/png';
    } else if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
      mimeType = 'image/jpeg';
    } else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
               bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      mimeType = 'image/webp';
    } else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      mimeType = 'image/gif';
    }

    return {
      nodeId,
      fillIndex: imageFills[fillIndex].index,
      imageHash,
      width: size.width,
      height: size.height,
      scaleMode: imagePaint.scaleMode || 'FILL',
      mimeType,
      imageData: base64,
    };
  } catch (error) {
    throw new Error(`Error exporting image fill: ${(error as Error).message}`);
  }
}

export async function setCornerRadius(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = getOptParam<string>(params, 'nodeId');
  const radius = getOptParam<number>(params, 'radius');
  const corners = getOptParam<unknown[]>(params, 'corners');

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  if (radius === undefined) {
    throw new Error('Missing radius parameter');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Check if node supports corner radius
  if (!('cornerRadius' in node)) {
    throw new Error(`Node does not support corner radius: ${nodeId}`);
  }

  const cornerNode = node as FrameNode;

  // If corners array is provided, set individual corner radii
  if (corners && Array.isArray(corners) && corners.length === 4) {
    if ('topLeftRadius' in node) {
      // Node supports individual corner radii
      if (corners[0] === true) cornerNode.topLeftRadius = radius;
      if (corners[1] === true) cornerNode.topRightRadius = radius;
      if (corners[2] === true) cornerNode.bottomRightRadius = radius;
      if (corners[3] === true) cornerNode.bottomLeftRadius = radius;
    } else {
      // Node only supports uniform corner radius
      cornerNode.cornerRadius = radius;
    }
  } else {
    // Set uniform corner radius
    cornerNode.cornerRadius = radius;
  }

  return {
    id: node.id,
    name: node.name,
    cornerRadius: 'cornerRadius' in node ? cornerNode.cornerRadius : undefined,
    topLeftRadius: 'topLeftRadius' in node ? cornerNode.topLeftRadius : undefined,
    topRightRadius: 'topRightRadius' in node ? cornerNode.topRightRadius : undefined,
    bottomRightRadius: 'bottomRightRadius' in node ? cornerNode.bottomRightRadius : undefined,
    bottomLeftRadius: 'bottomLeftRadius' in node ? cornerNode.bottomLeftRadius : undefined,
  };
}

export async function cloneNode(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = getOptParam<string>(params, 'nodeId');
  const x = getOptParam<number>(params, 'x');
  const y = getOptParam<number>(params, 'y');
  const parentId = getOptParam<string>(params, 'parentId');
  const index = getOptParam<number>(params, 'index');

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Clone the node
  const clone = (node as SceneNode).clone();

  // If x and y are provided, move the clone to that position
  if (x !== undefined && y !== undefined) {
    if (!('x' in clone) || !('y' in clone)) {
      throw new Error(`Cloned node does not support position: ${nodeId}`);
    }
    (clone as FrameNode).x = x;
    (clone as FrameNode).y = y;
  }

  // Determine target parent
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error('Parent node not found with ID: ' + parentId);
    }
    if (!('children' in parentNode)) {
      throw new Error('Parent node does not support children: ' + parentId);
    }
    const container = parentNode as FrameNode;
    if (index !== undefined && index !== null) {
      container.insertChild(index, clone);
    } else {
      container.appendChild(clone);
    }
  } else if ((node as SceneNode).parent) {
    ((node as SceneNode).parent as FrameNode).appendChild(clone);
  } else {
    figma.currentPage.appendChild(clone);
  }

  // Focus on the cloned node (only when auto-focus is enabled)
  selectAndFocusNode(clone);

  return {
    id: clone.id,
    name: clone.name,
    x: 'x' in clone ? (clone as FrameNode).x : undefined,
    y: 'y' in clone ? (clone as FrameNode).y : undefined,
    width: 'width' in clone ? (clone as FrameNode).width : undefined,
    height: 'height' in clone ? (clone as FrameNode).height : undefined,
  };
}

export async function groupNodes(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeIds = getOptParam<string[]>(params, 'nodeIds');
  const name = getOptParam<string>(params, 'name');

  if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length < 2) {
    throw new Error('Must provide at least two nodeIds to group');
  }

  try {
    // Get all nodes to be grouped
    const nodesToGroup: SceneNode[] = [];
    for (const nodeId of nodeIds) {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }
      nodesToGroup.push(node as SceneNode);
    }

    // Verify that all nodes have the same parent
    const parent = nodesToGroup[0].parent;
    for (const node of nodesToGroup) {
      if (node.parent !== parent) {
        throw new Error('All nodes must have the same parent to be grouped');
      }
    }

    // Create a group and add the nodes to it
    const group = figma.group(nodesToGroup, parent as BaseNode & ChildrenMixin);

    // Optionally set a name for the group
    if (name) {
      group.name = name;
    }

    return {
      id: group.id,
      name: group.name,
      type: group.type,
      children: group.children.map(child => ({ id: child.id, name: child.name, type: child.type })),
    };
  } catch (error) {
    throw new Error(`Error grouping nodes: ${(error as Error).message}`);
  }
}

export async function ungroupNodes(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = getOptParam<string>(params, 'nodeId');

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    // Verify that the node is a group or a frame
    if (node.type !== 'GROUP' && node.type !== 'FRAME') {
      throw new Error(`Node with ID ${nodeId} is not a GROUP or FRAME`);
    }

    // Ungroup the node
    const ungroupedItems = figma.ungroup(node as GroupNode | FrameNode);

    return {
      success: true,
      ungroupedCount: ungroupedItems.length,
      items: ungroupedItems.map(item => ({ id: item.id, name: item.name, type: item.type })),
    };
  } catch (error) {
    throw new Error(`Error ungrouping node: ${(error as Error).message}`);
  }
}

export async function flattenNode(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = getOptParam<string>(params, 'nodeId');

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    // Check for specific node types that can be flattened
    const flattenableTypes = ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'ELLIPSE', 'RECTANGLE', 'FRAME', 'GROUP'];

    if (!flattenableTypes.includes(node.type)) {
      throw new Error(`Node with ID ${nodeId} and type ${node.type} cannot be flattened. Supported types: VECTOR, BOOLEAN_OPERATION, STAR, POLYGON, ELLIPSE, RECTANGLE, FRAME, GROUP.`);
    }

    // Use figma.flatten([node]) — the correct Plugin API (not a node instance method)
    const flattened = figma.flatten([node as SceneNode]);

    return {
      id: flattened.id,
      name: flattened.name,
      type: flattened.type,
    };
  } catch (error) {
    console.error(`Error in flattenNode: ${(error as Error).message}`);
    if ((error as Error).message.includes('timed out')) {
      // Provide a more helpful message for timeout errors
      throw new Error('The flatten operation timed out. This usually happens with complex nodes. Try simplifying the node first or breaking it into smaller parts.');
    } else {
      throw new Error(`Error flattening node: ${(error as Error).message}`);
    }
  }
}

export async function renameNode(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = getOptParam<string>(params, 'nodeId');
  const name = getOptParam<string>(params, 'name');

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  if (!name) {
    throw new Error('Missing name parameter');
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
      newName: node.name,
    };
  } catch (error) {
    throw new Error(`Error renaming node: ${(error as Error).message}`);
  }
}

export async function insertChild(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const parentId = getOptParam<string>(params, 'parentId');
  const childId = getOptParam<string>(params, 'childId');
  const index = getOptParam<number>(params, 'index');

  if (!parentId) {
    throw new Error('Missing parentId parameter');
  }

  if (!childId) {
    throw new Error('Missing childId parameter');
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
    if (!('appendChild' in parent)) {
      throw new Error(`Parent node with ID ${parentId} cannot have children`);
    }

    const parentWithChildren = parent as FrameNode;
    const childScene = child as SceneNode;

    // Save child's current parent for proper handling
    const originalParent = childScene.parent;

    // Insert the child at the specified index or append it
    if (index !== undefined && index >= 0 && index <= parentWithChildren.children.length) {
      parentWithChildren.insertChild(index, childScene);
    } else {
      parentWithChildren.appendChild(childScene);
    }

    // Verify that the insertion worked
    const newIndex = parentWithChildren.children.indexOf(childScene);

    return {
      parentId: parent.id,
      childId: child.id,
      index: newIndex,
      success: newIndex !== -1,
      previousParentId: originalParent ? originalParent.id : null,
    };
  } catch (error) {
    console.error(`Error inserting child: ${(error as Error).message}`, error);
    throw new Error(`Error inserting child: ${(error as Error).message}`);
  }
}
