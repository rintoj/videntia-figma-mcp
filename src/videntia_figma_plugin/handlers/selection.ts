// ---------------------------------------------------------------------------
// Focus and selection
// ---------------------------------------------------------------------------

import { serializeNodes } from "./node-serializer";
import { chunkedFindByTypes } from "../utils/chunked-find";
import { getCommandSignal } from "../utils/cancellation";
import { getCommandDeadline } from "../utils/with-timeout";

/** Max nodes a scan visits before stopping. totalFound becomes a lower bound. */
export const SCAN_MAX_VISITED = 50000;
/** Stop the walk this long before the command deadline so serialization still fits. */
const SCAN_DEADLINE_MARGIN_MS = 5000;

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
  // Default 0: serialize matched nodes only. An explicit depth opts into subtrees.
  const depth = params["depth"] === undefined ? 0 : (params["depth"] as number | null);
  const topLevelOnly = params["topLevelOnly"] === true;
  const exactTotal = params["exactTotal"] === true;

  if (!Array.isArray(types) || types.length === 0) {
    throw new Error("types must be a non-empty array");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Stop once `limit` matches are found unless the caller asks for exactTotal;
  // either way the result says whether totalFound is exact.
  const allMatchedIds: string[] = [];

  const maxVisited =
    typeof params["maxVisited"] === "number" && (params["maxVisited"] as number) > 0
      ? (params["maxVisited"] as number)
      : SCAN_MAX_VISITED;
  const deadlineAt = getCommandDeadline();
  const stopAt = deadlineAt !== undefined ? deadlineAt - SCAN_DEADLINE_MARGIN_MS : undefined;
  let visited = 0;
  let stopReason: "maxVisited" | "deadline" | "limit" | undefined;
  const signal = getCommandSignal();

  if ("children" in node) {
    const kids = (node as ChildrenMixin).children;
    if (topLevelOnly) {
      // Only direct children of the scanned node are considered.
      for (const child of kids) {
        visited++;
        if (types.includes((child as SceneNode).type)) {
          if (!exactTotal && allMatchedIds.length >= limit) {
            stopReason = "limit";
            break;
          }
          allMatchedIds.push(child.id);
        }
      }
    } else {
      // Hybrid walk (utils/chunked-find.ts): narrow nodes go to one native
      // findAllWithCriteria call, wide ones are descended, with an adaptive
      // per-call time budget. Yields between calls for cancel and the deadline.
      const res = await chunkedFindByTypes(kids as readonly SceneNode[], {
        types,
        signal,
        stopAt,
        maxVisited,
        onMatch: (n) => {
          // One past limit proves truncation without walking further.
          if (!exactTotal && allMatchedIds.length > limit) return false;
          allMatchedIds.push(n.id);
          return true;
        },
      });
      visited = res.visited;
      if (res.stopReason) stopReason = res.stopReason;
    }
  }
  const totalExact = stopReason === undefined;
  const walkInfo: Record<string, unknown> = { visited, totalExact };
  if (!totalExact) {
    walkInfo["stopReason"] = stopReason;
    walkInfo["warning"] =
      stopReason === "limit"
        ? `Scan stopped at limit (${limit}); totalFound is a lower bound. Pass exactTotal: true for an exact count.`
        : `Scan stopped early (${stopReason}) after ${visited} nodes; totalFound is a lower bound. ` +
          "Scan a smaller nodeId to get an exact count.";
  }

  const totalFound = allMatchedIds.length;
  const matchedIds = totalFound > limit ? allMatchedIds.slice(0, limit) : allMatchedIds;
  const truncated = totalFound > matchedIds.length || !totalExact;

  if (matchedIds.length === 0) {
    return { count: 0, totalFound, truncated, limit, topLevelOnly, ...walkInfo, nodes: [] };
  }

  const serialized = await serializeNodes({ nodeIds: matchedIds, depth: depth ?? undefined });
  return { ...serialized, count: matchedIds.length, totalFound, truncated, limit, topLevelOnly, ...walkInfo };
}
