import { debugLog } from '../utils/helpers';

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

// Centralized helper for the JSON_REST_V1 export format which is not in
// the standard @figma/plugin-typings definitions and requires a cast.
type JsonRestExportable = { exportAsync: (opts: { format: string }) => Promise<{ document: unknown }> };

function exportAsJsonV1(node: BaseNode): Promise<{ document: unknown }> {
  return (node as unknown as JsonRestExportable).exportAsync({ format: 'JSON_REST_V1' });
}

export async function getSelection(): Promise<Record<string, unknown>> {
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
function stripImageData(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(stripImageData);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    // Skip large binary/base64 image data
    if (key === 'imageRef' || key === 'imageBytes' || key === 'gifRef') {
      // Keep a marker that there was image data, but don't include the actual data
      result[key] = '[IMAGE_DATA_STRIPPED]';
      continue;
    }

    // Recursively process nested objects
    result[key] = stripImageData(value);
  }
  return result;
}

/**
 * Truncates the node tree to `depth` levels of children (depth=0 means no children at all,
 * depth=1 means direct children only with grandchildren replaced by a hint, etc.).
 * Nodes whose children are truncated get a `_children` hint so callers know to drill in.
 */
function truncateToDepth(doc: unknown, depth: number): unknown {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return doc;
  }
  const node = doc as Record<string, unknown>;
  if (!Array.isArray(node.children)) {
    return node;
  }
  if (depth <= 0) {
    const count = (node.children as unknown[]).length;
    const { children: _omitted, ...rest } = node;
    if (count === 0) return rest;
    return {
      ...rest,
      _children: count + ' children \u2014 call get_node_info with id="' + rest['id'] + '" to explore',
    };
  }
  const truncatedChildren = node.children.map((child: unknown) => {
    return truncateToDepth(child, depth - 1);
  });
  return { ...node, children: truncatedChildren };
}

/**
 * Search descendants for nodes matching a name (case-insensitive substring) or exact id.
 * Returns up to `limit` matching nodes (metadata only, no deep children).
 */
function findDescendants(
  doc: unknown,
  query: string,
  results: Record<string, unknown>[],
  limit: number,
): void {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return;
  if (results.length >= limit) return;
  const node = doc as Record<string, unknown>;
  const name = typeof node['name'] === 'string' ? node['name'] : '';
  const id = typeof node['id'] === 'string' ? node['id'] : '';
  if (
    name.toLowerCase().indexOf(query.toLowerCase()) !== -1 ||
    id === query
  ) {
    const { children: _c, ...meta } = node;
    const childCount = Array.isArray(node['children']) ? (node['children'] as unknown[]).length : 0;
    results.push(childCount > 0
      ? { ...meta, _children: childCount + ' children \u2014 call get_node_info with id="' + id + '" to explore' }
      : meta);
  }
  if (Array.isArray(node['children'])) {
    for (const child of node['children'] as unknown[]) {
      if (results.length >= limit) break;
      findDescendants(child, query, results, limit);
    }
  }
}

export interface GetNodeInfoOptions {
  stripImages?: boolean;
  /** Max depth of children to include. Default: 1 (direct children only). 0 = no children. */
  depth?: number;
  /** If false, return only node metadata without any children. Includes parentId. */
  includeChildren?: boolean;
  /** Search descendants by name (substring) or exact ID. Returns matching nodes only. */
  find?: string;
}

export async function getNodeInfo(
  nodeId: string,
  options: GetNodeInfoOptions = {},
): Promise<unknown> {
  const stripImages = options.stripImages !== undefined ? options.stripImages : true;
  const depth = options.depth !== undefined ? options.depth : 1;
  const includeChildren = options.includeChildren !== undefined ? options.includeChildren : true;

  debugLog('getNodeInfo', nodeId, options);

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  const response = await exportAsJsonV1(node);

  let document = response.document;

  // Strip image data by default to prevent large responses
  if (stripImages) {
    document = stripImageData(document);
  }

  // Attach parentId to the root of the response
  if (node.parent) {
    (document as Record<string, unknown>)['parentId'] = node.parent.id;
  }

  // find mode: search descendants and return matches
  if (options.find !== undefined && options.find !== null && options.find !== '') {
    const results: Record<string, unknown>[] = [];
    findDescendants(document, options.find, results, 50);
    return { query: options.find, matches: results, total: results.length };
  }

  // includeChildren: false — return only the node itself (no children)
  if (!includeChildren) {
    const doc = document as Record<string, unknown>;
    const { children: _c, ...meta } = doc;
    return meta;
  }

  // Truncate to requested depth (default 1 = direct children only)
  document = truncateToDepth(document, depth);

  return document;
}

export async function getNodesInfo(
  nodeIds: string[],
  options: GetNodeInfoOptions = {},
): Promise<unknown[]> {
  const stripImages = options.stripImages !== undefined ? options.stripImages : true;
  const depth = options.depth !== undefined ? options.depth : 1;
  const includeChildren = options.includeChildren !== undefined ? options.includeChildren : true;

  debugLog('getNodesInfo', nodeIds, options);

  try {
    // Load all nodes in parallel
    const nodes = await Promise.all(
      nodeIds.map((id) => figma.getNodeByIdAsync(id)),
    );

    // Filter out any null values (nodes that weren't found)
    const validNodes = nodes.filter((node) => node !== null) as BaseNode[];

    // Export all valid nodes in parallel
    const responses = await Promise.all(
      validNodes.map(async (node) => {
        const response = await exportAsJsonV1(node);
        let document = response.document;

        if (stripImages) {
          document = stripImageData(document);
        }

        if (node.parent) {
          (document as Record<string, unknown>)['parentId'] = node.parent.id;
        }

        if (options.find !== undefined && options.find !== null && options.find !== '') {
          const results: Record<string, unknown>[] = [];
          findDescendants(document, options.find, results, 50);
          document = { query: options.find, matches: results, total: results.length };
        } else if (!includeChildren) {
          const doc = document as Record<string, unknown>;
          const { children: _c, ...meta } = doc;
          document = meta;
        } else {
          document = truncateToDepth(document, depth);
        }

        return {
          nodeId: node.id,
          document,
        };
      }),
    );

    return responses;
  } catch (error) {
    throw new Error(`Error getting nodes info: ${(error as Error).message}`);
  }
}
