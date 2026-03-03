// ---------------------------------------------------------------------------
// Focus and selection
// ---------------------------------------------------------------------------

import { serializeNodes } from './node-serializer';

function getPage(node: BaseNode): PageNode | null {
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === 'PAGE') return current as PageNode;
    current = current.parent;
  }
  return null;
}

export async function setFocus(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params['nodeId'] as string;
  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Navigate to the node's page first (required before setting selection)
  const page = getPage(node);
  if (page && page.id !== figma.currentPage.id) {
    figma.currentPage = page;
  }

  // Set selection and zoom to node
  figma.currentPage.selection = [node as SceneNode];
  figma.viewport.scrollAndZoomIntoView([node as SceneNode]);

  return {
    nodeId: node.id,
    name: node.name,
    nodeType: node.type,
    focused: true,
    success: true,
  };
}

export async function setSelections(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeIds = params['nodeIds'] as string[] | undefined;

  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    throw new Error('nodeIds must be a non-empty array');
  }

  const nodes: SceneNode[] = [];
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (node) {
      nodes.push(node as SceneNode);
    }
  }

  if (nodes.length === 0) {
    throw new Error('No valid nodes found with provided IDs');
  }

  // Navigate to the page of the first node (all nodes must be on the same page)
  const page = getPage(nodes[0]);
  if (page && page.id !== figma.currentPage.id) {
    figma.currentPage = page;
  }

  figma.currentPage.selection = nodes;
  figma.viewport.scrollAndZoomIntoView(nodes);

  return {
    selectedCount: nodes.length,
    selectedNodes: nodes.map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
    })),
    success: true,
  };
}

// ---------------------------------------------------------------------------
// Scan nodes by type
// ---------------------------------------------------------------------------

export async function scanNodesByTypes(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params['nodeId'] as string;
  const types = params['types'] as string[] | undefined;
  const limit = (params['limit'] !== undefined && params['limit'] !== null) ? (params['limit'] as number) : 50;
  const depth = params['depth'] as number | undefined;

  if (!Array.isArray(types) || types.length === 0) {
    throw new Error('types must be a non-empty array');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  const matchedIds: string[] = [];

  const scanNode = (n: SceneNode): void => {
    if (matchedIds.length >= limit) return;
    if (types.includes(n.type)) {
      matchedIds.push(n.id);
    }
    if ('children' in n) {
      for (const child of (n as ChildrenMixin).children) {
        if (matchedIds.length >= limit) break;
        scanNode(child as SceneNode);
      }
    }
  };

  if ('children' in node) {
    for (const child of (node as ChildrenMixin).children) {
      if (matchedIds.length >= limit) break;
      scanNode(child as SceneNode);
    }
  }

  if (matchedIds.length === 0) {
    return { selectionCount: 0, selection: [] };
  }

  return await serializeNodes({ nodeIds: matchedIds, depth: depth });
}


