import { customBase64Encode } from '../utils/base64';
import { debugLog } from '../utils/helpers';

export async function createRectangle(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const x: number = (params !== null && params !== undefined && params['x'] !== null && params['x'] !== undefined) ? params['x'] as number : 0;
  const y: number = (params !== null && params !== undefined && params['y'] !== null && params['y'] !== undefined) ? params['y'] as number : 0;
  const width: number = (params !== null && params !== undefined && params['width'] !== null && params['width'] !== undefined) ? params['width'] as number : 100;
  const height: number = (params !== null && params !== undefined && params['height'] !== null && params['height'] !== undefined) ? params['height'] as number : 100;
  const name: string = (params !== null && params !== undefined && params['name'] !== null && params['name'] !== undefined) ? params['name'] as string : 'Rectangle';
  const parentId: string | undefined = (params !== null && params !== undefined) ? params['parentId'] as string | undefined : undefined;
  const layoutPositioning: string | undefined = (params !== null && params !== undefined) ? params['layoutPositioning'] as string | undefined : undefined;

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
  const x: number = (params !== null && params !== undefined && params['x'] !== null && params['x'] !== undefined) ? params['x'] as number : 0;
  const y: number = (params !== null && params !== undefined && params['y'] !== null && params['y'] !== undefined) ? params['y'] as number : 0;
  const width: number = (params !== null && params !== undefined && params['width'] !== null && params['width'] !== undefined) ? params['width'] as number : 100;
  const height: number = (params !== null && params !== undefined && params['height'] !== null && params['height'] !== undefined) ? params['height'] as number : 100;
  const name: string = (params !== null && params !== undefined && params['name'] !== null && params['name'] !== undefined) ? params['name'] as string : 'Frame';
  const parentId: string | undefined = (params !== null && params !== undefined) ? params['parentId'] as string | undefined : undefined;
  const fillColor: Record<string, unknown> | undefined = (params !== null && params !== undefined) ? params['fillColor'] as Record<string, unknown> | undefined : undefined;
  const strokeColor: Record<string, unknown> | undefined = (params !== null && params !== undefined) ? params['strokeColor'] as Record<string, unknown> | undefined : undefined;
  const strokeWeight: number | undefined = (params !== null && params !== undefined) ? params['strokeWeight'] as number | undefined : undefined;
  const clipsContent: boolean | undefined = (params !== null && params !== undefined) ? params['clipsContent'] as boolean | undefined : undefined;
  const layoutPositioning: string | undefined = (params !== null && params !== undefined) ? params['layoutPositioning'] as string | undefined : undefined;

  const frame = figma.createFrame();
  frame.x = x;
  frame.y = y;
  frame.resize(width, height);
  frame.name = name;

  // Set fill color if provided
  if (fillColor) {
    const paintStyle: SolidPaint = {
      type: 'SOLID',
      color: {
        r: parseFloat(fillColor['r'] as string) || 0,
        g: parseFloat(fillColor['g'] as string) || 0,
        b: parseFloat(fillColor['b'] as string) || 0,
      },
      opacity: parseFloat(fillColor['a'] as string) || 1,
    };
    frame.fills = [paintStyle];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    const strokeStyle: SolidPaint = {
      type: 'SOLID',
      color: {
        r: parseFloat(strokeColor['r'] as string) || 0,
        g: parseFloat(strokeColor['g'] as string) || 0,
        b: parseFloat(strokeColor['b'] as string) || 0,
      },
      opacity: parseFloat(strokeColor['a'] as string) || 1,
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
  const nodeId = (params !== null && params !== undefined) ? params['nodeId'] as string : undefined;
  const x = (params !== null && params !== undefined) ? params['x'] as number : undefined;
  const y = (params !== null && params !== undefined) ? params['y'] as number : undefined;

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  if (x === undefined || y === undefined) {
    throw new Error('Missing x or y parameters');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!('x' in node) || !('y' in node)) {
    throw new Error(`Node does not support position: ${nodeId}`);
  }

  (node as SceneNode & { x: number; y: number }).x = x;
  (node as SceneNode & { x: number; y: number }).y = y;

  return {
    id: node.id,
    name: node.name,
    x: (node as SceneNode & { x: number }).x,
    y: (node as SceneNode & { y: number }).y,
  };
}

export async function resizeNode(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = (params !== null && params !== undefined) ? params['nodeId'] as string : undefined;
  const width = (params !== null && params !== undefined) ? params['width'] as number : undefined;
  const height = (params !== null && params !== undefined) ? params['height'] as number : undefined;

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
  const nodeId = (params !== null && params !== undefined) ? params['nodeId'] as string : undefined;

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
  const nodeIds = (params !== null && params !== undefined) ? params['nodeIds'] as string[] : undefined;

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
  const nodeId = (params !== null && params !== undefined) ? params['nodeId'] as string : undefined;
  const scale: number = (params !== null && params !== undefined && params['scale'] !== null && params['scale'] !== undefined) ? params['scale'] as number : 1;

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

export async function setCornerRadius(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = (params !== null && params !== undefined) ? params['nodeId'] as string : undefined;
  const radius = (params !== null && params !== undefined) ? params['radius'] as number : undefined;
  const corners = (params !== null && params !== undefined) ? params['corners'] as unknown[] : undefined;

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
      if (corners[0]) cornerNode.topLeftRadius = radius;
      if (corners[1]) cornerNode.topRightRadius = radius;
      if (corners[2]) cornerNode.bottomRightRadius = radius;
      if (corners[3]) cornerNode.bottomLeftRadius = radius;
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
  const nodeId = (params !== null && params !== undefined) ? params['nodeId'] as string : undefined;
  const x = (params !== null && params !== undefined) ? params['x'] as number : undefined;
  const y = (params !== null && params !== undefined) ? params['y'] as number : undefined;

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

  // Add the clone to the same parent as the original node
  if ((node as SceneNode).parent) {
    ((node as SceneNode).parent as FrameNode).appendChild(clone);
  } else {
    figma.currentPage.appendChild(clone);
  }

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
  const nodeIds = (params !== null && params !== undefined) ? params['nodeIds'] as string[] : undefined;
  const name = (params !== null && params !== undefined) ? params['name'] as string : undefined;

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
  const nodeId = (params !== null && params !== undefined) ? params['nodeId'] as string : undefined;

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
  const nodeId = (params !== null && params !== undefined) ? params['nodeId'] as string : undefined;

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    // Check for specific node types that can be flattened
    const flattenableTypes = ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'ELLIPSE', 'RECTANGLE'];

    if (!flattenableTypes.includes(node.type)) {
      throw new Error(`Node with ID ${nodeId} and type ${node.type} cannot be flattened. Only vector-based nodes can be flattened.`);
    }

    // Cast to a type that exposes flatten (not declared on VectorNode in typings)
    type FlattenableNode = BaseNode & { flatten(): VectorNode };

    // Verify the node has the flatten method before calling it
    if (typeof (node as unknown as FlattenableNode).flatten !== 'function') {
      throw new Error(`Node with ID ${nodeId} does not support the flatten operation.`);
    }

    const flattenableNode = node as unknown as FlattenableNode;

    // Implement a timeout mechanism
    let timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => { /* placeholder */ }, 0);
    clearTimeout(timeoutId); // clear the placeholder immediately
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Flatten operation timed out after 8 seconds. The node may be too complex.'));
      }, 8000); // 8 seconds timeout
    });

    // Execute the flatten operation in a promise
    const flattenPromise = new Promise<VectorNode>((resolve, reject) => {
      // Execute in the next tick to allow UI updates
      setTimeout(() => {
        try {
          debugLog(`Starting flatten operation for node ID ${nodeId}...`);
          const flattened = flattenableNode.flatten();
          debugLog(`Flatten operation completed successfully for node ID ${nodeId}`);
          resolve(flattened);
        } catch (err) {
          console.error(`Error during flatten operation: ${(err as Error).message}`);
          reject(err);
        }
      }, 0);
    });

    // Race between the timeout and the operation
    // Use try/finally pattern rather than .finally() which requires ES2018
    let flattened: VectorNode;
    try {
      flattened = await Promise.race([flattenPromise, timeoutPromise]);
    } finally {
      // Clear the timeout to prevent memory leaks
      clearTimeout(timeoutId);
    }

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
  const nodeId = (params !== null && params !== undefined) ? params['nodeId'] as string : undefined;
  const name = (params !== null && params !== undefined) ? params['name'] as string : undefined;

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
  const parentId = (params !== null && params !== undefined) ? params['parentId'] as string : undefined;
  const childId = (params !== null && params !== undefined) ? params['childId'] as string : undefined;
  const index = (params !== null && params !== undefined) ? params['index'] as number : undefined;

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
