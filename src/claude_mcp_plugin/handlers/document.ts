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
  query: string;
  /** Optional node type filter e.g. FRAME, TEXT, COMPONENT */
  types?: string[];
  /** Node ID to scope the search to. Defaults to the current page. */
  nodeId?: string;
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

  const lowerQuery = query.toLowerCase();

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
    const nameMatch = node.name.toLowerCase().indexOf(lowerQuery) !== -1;
    const idMatch = node.id === query;
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
