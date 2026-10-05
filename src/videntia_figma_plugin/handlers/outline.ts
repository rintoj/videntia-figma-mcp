/**
 * get_outline: a sparse, style-free outline of a subtree, modeled on Figma's
 * get_metadata. One compact line per node, indented by depth:
 *
 *   12:34 FRAME "Card" 0,0 320x200 c=3
 *     12:35 TEXT "Title" 16,16 288x24
 *     12:36 INSTANCE "Icon" 16,48 24x24 hidden
 *
 * Cheap by design (~50-80 bytes per node): no styles, no fills, no text content.
 * Use it to orient in a large tree, then drill in with get_node_info /
 * get_content_tree on the ids it lists.
 */
import { getCommandSignal, throwIfCancelled } from "../utils/cancellation";
import { createYielder } from "../utils/walk-budget";

export const OUTLINE_DEFAULT_MAX_NODES = 5000;
export const OUTLINE_DEFAULT_MAX_DEPTH = 20;
const NAME_MAX = 40;

interface OutlineNode {
  id: string;
  type: string;
  name: string;
  visible?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: readonly OutlineNode[];
}

const r = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0);

/** Pure: one outline line for a node (without indentation). */
export function outlineLine(node: OutlineNode): string {
  let name = String(node.name ?? "").replace(/\s+/g, " ");
  if (name.length > NAME_MAX) name = name.slice(0, NAME_MAX - 1) + "…";
  let line = `${node.id} ${node.type} ${JSON.stringify(name)}`;
  if (node.type !== "PAGE" && node.type !== "DOCUMENT") {
    line += ` ${r(node.x)},${r(node.y)} ${r(node.width)}x${r(node.height)}`;
  }
  const kids = node.children;
  if (kids && kids.length > 0) line += ` c=${kids.length}`;
  if (node.visible === false) line += " hidden";
  return line;
}

export interface OutlineResult {
  rootId: string;
  outline: string;
  nodes: number;
  truncated: boolean;
  truncatedBy?: "maxNodes";
  /** Nodes whose children were cut by maxDepth. */
  depthCut: number;
  hint?: string;
}

/** Pure-ish walk over any node-like tree. Iterative, yields, honours cancellation. */
export async function buildOutline(
  root: OutlineNode,
  opts: { maxDepth?: number; maxNodes?: number } = {},
): Promise<OutlineResult> {
  const maxDepth = opts.maxDepth ?? OUTLINE_DEFAULT_MAX_DEPTH;
  const maxNodes = opts.maxNodes ?? OUTLINE_DEFAULT_MAX_NODES;
  const signal = getCommandSignal();
  const tick = createYielder(1000, undefined, signal);
  const lines: string[] = [];
  let depthCut = 0;
  let truncated = false;
  const stack: Array<{ node: OutlineNode; depth: number }> = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    if (lines.length >= maxNodes) {
      truncated = true;
      break;
    }
    await tick();
    const { node, depth } = stack.pop()!;
    lines.push(" ".repeat(depth) + outlineLine(node));
    const kids = node.children;
    if (kids && kids.length > 0) {
      if (depth >= maxDepth) {
        depthCut++;
        continue;
      }
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i], depth: depth + 1 });
    }
  }
  throwIfCancelled(signal);
  const result: OutlineResult = {
    rootId: root.id,
    outline: lines.join("\n"),
    nodes: lines.length,
    truncated,
    depthCut,
  };
  if (truncated) {
    result.truncatedBy = "maxNodes";
    result.hint =
      `Outline stopped at maxNodes=${maxNodes}. Call get_outline on one of the c=N nodes above to continue, ` +
      `or raise maxNodes.`;
  } else if (depthCut > 0) {
    result.hint = `${depthCut} node(s) have children below maxDepth=${maxDepth}; call get_outline on their ids.`;
  }
  return result;
}

export async function getOutline(params: Record<string, unknown>): Promise<OutlineResult> {
  const nodeId = typeof params["nodeId"] === "string" && params["nodeId"] ? (params["nodeId"] as string) : undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined);
  let root: BaseNode | null;
  if (nodeId) {
    root = await figma.getNodeByIdAsync(nodeId);
    if (!root) throw new Error(`Node not found: ${nodeId}`);
  } else {
    root = figma.currentPage;
    await figma.currentPage.loadAsync();
  }
  return buildOutline(root as unknown as OutlineNode, {
    maxDepth: num(params["maxDepth"]),
    maxNodes: num(params["maxNodes"]),
  });
}
