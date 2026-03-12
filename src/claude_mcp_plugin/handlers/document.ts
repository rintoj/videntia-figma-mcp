import { serializeNodes } from './node-serializer';

export async function getFileKey(): Promise<Record<string, unknown>> {
  const fileKey = figma.fileKey;
  if (!fileKey) {
    throw new Error("File key not available. Make sure you're in a saved Figma file.");
  }
  return {
    fileKey,
    fileName: figma.root.name,
  };
}

export async function getDocumentInfo(): Promise<Record<string, unknown>> {
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
      loadedChildCount: page.children.length,
    },
    // Only the current page is guaranteed to be loaded; other pages must not
    // have their `.children` accessed without calling `loadAsync()` first.
    pages: figma.root.children.map((p) => ({
      id: p.id,
      name: p.name,
      loadedChildCount: p.id === page.id ? page.children.length : null,
    })),
  };
}

export interface SearchNodesOptions {
  /** Search query — matched case-insensitively against node name (substring) or exact node ID */
  query: string | string[];
  /** Optional node type filter e.g. FRAME, TEXT, COMPONENT */
  types?: string[];
  /** Node ID (or array of IDs) to scope the search to. Defaults to the current page. */
  nodeId?: string | string[];
  /** Max number of results to return. Default: 50. */
  limit?: number;
  /** Max depth of children to include. */
  depth?: number;
}

/**
 * Search all nodes in the document (or a subtree) by name or ID.
 * Delegates to serializeNodes for consistent output format.
 */
export async function searchNodes(options: SearchNodesOptions): Promise<unknown> {
  const { query, types, nodeId, limit: limitOpt, depth } = options;
  const limit = limitOpt !== undefined ? limitOpt : 50;

  // When nodeId is an array, search each root independently and group results
  if (Array.isArray(nodeId)) {
    var grouped: Record<string, unknown> = {};
    for (var i = 0; i < nodeId.length; i++) {
      var singleResult = await searchNodes({
        query: query,
        types: types,
        nodeId: nodeId[i],
        limit: limit,
        depth: depth,
      });
      grouped[nodeId[i]] = singleResult;
    }
    return grouped;
  }

  const queries = Array.isArray(query) ? query : [query];
  const lowerQueries = queries.map(function(q) { return q.toLowerCase(); });

  let root: BaseNode;
  if (nodeId) {
    const found = await figma.getNodeByIdAsync(nodeId);
    if (!found) {
      throw new Error('Node not found with ID: ' + nodeId);
    }
    root = found;
  } else {
    await figma.currentPage.loadAsync();
    root = figma.currentPage;
  }

  const matchedIds: string[] = [];

  const walk = (node: BaseNode): void => {
    if (matchedIds.length >= limit) return;
    const lowerName = node.name.toLowerCase();
    const nameMatch = lowerQueries.some(function(q) { return lowerName.indexOf(q) !== -1; });
    const idMatch = queries.indexOf(node.id) !== -1;
    const typeMatch = !types || types.length === 0 || types.includes(node.type);
    if ((nameMatch || idMatch) && typeMatch) {
      matchedIds.push(node.id);
    }
    if ('children' in node) {
      for (const child of (node as ChildrenMixin).children) {
        if (matchedIds.length >= limit) break;
        walk(child);
      }
    }
  };

  walk(root);

  if (matchedIds.length === 0) {
    return { count: 0, nodes: [] };
  }

  return await serializeNodes({
    nodeIds: matchedIds,
    depth: depth,
  });
}

export async function saveVersionHistory(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const title = params.title as string;
  if (!title) {
    throw new Error('title is required');
  }
  const description = params.description as string | undefined;
  const result = description
    ? await figma.saveVersionHistoryAsync(title, description)
    : await figma.saveVersionHistoryAsync(title);
  return { id: result.id };
}

export function triggerUndo(): Record<string, unknown> {
  figma.triggerUndo();
  return { success: true };
}

export function commitUndoAction(): Record<string, unknown> {
  figma.commitUndo();
  return { success: true };
}
