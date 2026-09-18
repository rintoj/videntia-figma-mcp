// ---------------------------------------------------------------------------
// Focus and selection
// ---------------------------------------------------------------------------

import { serializeNodes } from "./node-serializer";

function getPage(node: BaseNode): PageNode | null {
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === "PAGE") return current as PageNode;
    current = current.parent;
  }
  return null;
}

/**
 * Check whether a scene node is fully visible in the current viewport.
 */
function isNodeVisibleInViewport(node: SceneNode): boolean {
  if (!("absoluteBoundingBox" in node)) return false;
  var bounds = (node as any).absoluteBoundingBox as { x: number; y: number; width: number; height: number } | null;
  if (!bounds) return false;

  var vp = figma.viewport.bounds;
  return (
    bounds.x >= vp.x &&
    bounds.y >= vp.y &&
    bounds.x + bounds.width <= vp.x + vp.width &&
    bounds.y + bounds.height <= vp.y + vp.height
  );
}

/**
 * Focus a node by navigating to its page and scrolling into view.
 * Always focuses regardless of current viewport.
 */
export async function focusNode(nodeId: string): Promise<void> {
  var node = await figma.getNodeByIdAsync(nodeId);
  if (!node) return;

  var page = getPage(node);
  if (page && page.id !== figma.currentPage.id) {
    await figma.setCurrentPageAsync(page);
  }

  figma.currentPage.selection = [node as SceneNode];
  figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
}

/**
 * Soft focus — only scrolls/zooms if the node is not already visible in the viewport.
 * Used by auto-focus to avoid disrupting the user's view.
 */
export async function softFocusNode(nodeId: string): Promise<void> {
  await softFocusNodes([nodeId]);
}

/**
 * Soft focus for multiple nodes. Uses the first resolvable node's page. Skips
 * scroll/zoom if all nodes are already visible.
 */
export async function softFocusNodes(nodeIds: string[]): Promise<void> {
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) return;

  var scenes: SceneNode[] = [];
  for (var i = 0; i < nodeIds.length; i++) {
    var node = await figma.getNodeByIdAsync(nodeIds[i]);
    if (node) scenes.push(node as SceneNode);
  }
  if (scenes.length === 0) return;

  var page = getPage(scenes[0]);
  var onDifferentPage = page && page.id !== figma.currentPage.id;
  if (onDifferentPage) {
    await figma.setCurrentPageAsync(page!);
  }

  figma.currentPage.selection = scenes;

  var anyHidden = false;
  for (var j = 0; j < scenes.length; j++) {
    if (!isNodeVisibleInViewport(scenes[j])) {
      anyHidden = true;
      break;
    }
  }

  if (onDifferentPage || anyHidden) {
    figma.viewport.scrollAndZoomIntoView(scenes);
  }
}

export async function setFocus(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params["nodeId"] as string;
  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  await focusNode(nodeId);

  return {
    nodeId: node.id,
    name: node.name,
    nodeType: node.type,
    focused: true,
    success: true,
  };
}

export async function setSelections(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeIds = params["nodeIds"] as string[] | undefined;

  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    throw new Error("nodeIds must be a non-empty array");
  }

  const nodes: SceneNode[] = [];
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (node) {
      nodes.push(node as SceneNode);
    }
  }

  if (nodes.length === 0) {
    throw new Error("No valid nodes found with provided IDs");
  }

  // Navigate to the page of the first node (all nodes must be on the same page)
  const page = getPage(nodes[0]);
  if (page && page.id !== figma.currentPage.id) {
    await figma.setCurrentPageAsync(page);
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
  const nodeId = params["nodeId"] as string;
  const types = params["types"] as string[] | undefined;
  const limit = params["limit"] !== undefined && params["limit"] !== null ? (params["limit"] as number) : 50;
  const depth = params["depth"] as number | undefined;
  const topLevelOnly = params["topLevelOnly"] === true;

  if (!Array.isArray(types) || types.length === 0) {
    throw new Error("types must be a non-empty array");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Collect ALL matches first so totalFound is accurate even when the result is
  // truncated by `limit`. Truncating during traversal is what made previous
  // sweeps silently incomplete.
  const allMatchedIds: string[] = [];

  const scanNode = (n: SceneNode): void => {
    const isMatch = types.includes(n.type);
    if (isMatch) {
      allMatchedIds.push(n.id);
      // A matched node's descendants are nested, not top level.
      if (topLevelOnly) return;
    }
    if ("children" in n) {
      for (const child of (n as ChildrenMixin).children) {
        scanNode(child as SceneNode);
      }
    }
  };

  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children) {
      if (topLevelOnly) {
        // Only direct children of the scanned node are considered.
        if (types.includes((child as SceneNode).type)) {
          allMatchedIds.push(child.id);
        }
      } else {
        scanNode(child as SceneNode);
      }
    }
  }

  const totalFound = allMatchedIds.length;
  const matchedIds = totalFound > limit ? allMatchedIds.slice(0, limit) : allMatchedIds;
  const truncated = totalFound > matchedIds.length;

  if (matchedIds.length === 0) {
    return { count: 0, totalFound, truncated: false, limit, topLevelOnly, nodes: [] };
  }

  const serialized = await serializeNodes({ nodeIds: matchedIds, depth: depth });
  return { ...serialized, count: matchedIds.length, totalFound, truncated, limit, topLevelOnly };
}
