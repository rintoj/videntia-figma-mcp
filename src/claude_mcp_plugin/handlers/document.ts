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
    pages: [
      {
        id: page.id,
        name: page.name,
        childCount: page.children.length,
      },
    ],
  };
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

  const response = await (node as unknown as { exportAsync: (opts: { format: string }) => Promise<{ document: unknown }> }).exportAsync({
    format: 'JSON_REST_V1',
  });

  let document = response.document;

  // Strip image data by default to prevent large responses
  if (stripImages) {
    document = stripImageData(document);
  }

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
        const response = await (node as unknown as { exportAsync: (opts: { format: string }) => Promise<{ document: unknown }> }).exportAsync({
          format: 'JSON_REST_V1',
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
      }),
    );

    return responses;
  } catch (error) {
    throw new Error(`Error getting nodes info: ${(error as Error).message}`);
  }
}
