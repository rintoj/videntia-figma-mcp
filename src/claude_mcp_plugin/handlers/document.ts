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
      childCount: page.children.length,
    },
    // Only the current page is guaranteed to be loaded; other pages must not
    // have their `.children` accessed without calling `loadAsync()` first.
    pages: figma.root.children.map((p) => ({
      id: p.id,
      name: p.name,
      childCount: p.id === page.id ? page.children.length : null,
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
 * Truncates the node tree to one level of children.
 * For each direct child that itself has children, replaces the nested
 * `children` array with a `_children` note so callers know to drill in
 * with get_node_info using that child's id.
 */
function truncateToFirstLevelChildren(doc: unknown): unknown {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return doc;
  }
  const node = doc as Record<string, unknown>;
  if (!Array.isArray(node.children)) {
    return node;
  }
  const truncatedChildren = node.children.map((child: unknown) => {
    if (!child || typeof child !== 'object' || Array.isArray(child)) {
      return child;
    }
    const childNode = child as Record<string, unknown>;
    if (!Array.isArray(childNode.children) || childNode.children.length === 0) {
      return childNode;
    }
    const count = (childNode.children as unknown[]).length;
    const { children: _omitted, ...rest } = childNode;
    return {
      ...rest,
      _children: count + ' children \u2014 call get_node_info with id="' + rest['id'] + '" to explore',
    };
  });
  return { ...node, children: truncatedChildren };
}

export interface GetNodeInfoOptions {
  stripImages?: boolean;
}

export async function getNodeInfo(
  nodeId: string,
  options: GetNodeInfoOptions = {},
): Promise<unknown> {
  const stripImages = options.stripImages !== undefined ? options.stripImages : true;

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

  // Return only first-level children; nested children are replaced with a note
  document = truncateToFirstLevelChildren(document);

  return document;
}

export async function getNodesInfo(
  nodeIds: string[],
  options: GetNodeInfoOptions = {},
): Promise<unknown[]> {
  const stripImages = options.stripImages !== undefined ? options.stripImages : true;

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

        // Strip image data by default to prevent large responses
        if (stripImages) {
          document = stripImageData(document);
        }

        // Return only first-level children; nested children are replaced with a note
        document = truncateToFirstLevelChildren(document);

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
