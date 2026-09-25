import { absolutePosition } from "../utils/helpers";

type RotatableNode = SceneNode & {
  rotation: number;
  x: number;
  y: number;
  width: number;
  height: number;
  relativeTransform: Transform;
};

/** Wraps any angle into Figma's (-180, 180] range. */
export function normalizeRotation(degrees: number): number {
  let r = degrees % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return Math.abs(r) < 1e-9 ? 0 : r;
}

/** The node's centre in its parent's coordinate space. */
export function transformedCenter(transform: Transform, width: number, height: number): { x: number; y: number } {
  return {
    x: transform[0][0] * (width / 2) + transform[0][1] * (height / 2) + transform[0][2],
    y: transform[1][0] * (width / 2) + transform[1][1] * (height / 2) + transform[1][2],
  };
}

function isLaidOutByParent(node: SceneNode): boolean {
  const parent = node.parent as (BaseNode & { layoutMode?: string }) | null;
  if (!parent || parent.layoutMode === undefined || parent.layoutMode === "NONE") return false;
  return (node as SceneNode & { layoutPositioning?: string }).layoutPositioning !== "ABSOLUTE";
}

export async function setRotation(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safe = params !== null && params !== undefined ? params : {};
  const nodeId = safe.nodeId as string | undefined;
  const raw = safe.rotation !== undefined ? safe.rotation : safe.angle !== undefined ? safe.angle : safe.degrees;
  const requested = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : (raw as number);
  const relative = safe.relative === true || safe.relative === "true";
  const originParam = safe.origin !== undefined && safe.origin !== null ? String(safe.origin) : "center";

  if (!nodeId) throw new Error("Missing nodeId parameter");
  if (typeof requested !== "number" || !isFinite(requested)) {
    throw new Error(`set_rotation: rotation must be a finite number of degrees (got ${JSON.stringify(raw)})`);
  }
  if (originParam !== "center" && originParam !== "top-left") {
    throw new Error(`set_rotation: origin must be "center" or "top-left" (got ${JSON.stringify(originParam)})`);
  }

  const found = await figma.getNodeByIdAsync(nodeId);
  if (!found) throw new Error(`Node not found with ID: ${nodeId}`);
  if (!("rotation" in found) || !("relativeTransform" in found)) {
    throw new Error(`set_rotation: ${found.type} node ${nodeId} cannot be rotated`);
  }
  const node = found as RotatableNode;

  const previous = node.rotation;
  const target = normalizeRotation(relative ? previous + requested : requested);
  const warnings: string[] = [];
  let origin = originParam;

  const centerBefore = transformedCenter(node.relativeTransform, node.width, node.height);
  node.rotation = target;

  if (origin === "center") {
    if (isLaidOutByParent(node)) {
      origin = "top-left";
      warnings.push(
        "The parent's auto layout positions this node, so it was rotated in place and the layout reflowed around its new bounds; set layoutPositioning ABSOLUTE first to pivot on the centre.",
      );
    } else {
      const centerAfter = transformedCenter(node.relativeTransform, node.width, node.height);
      node.x = node.x + (centerBefore.x - centerAfter.x);
      node.y = node.y + (centerBefore.y - centerAfter.y);
    }
  }

  const result: Record<string, unknown> = {
    id: node.id,
    name: node.name,
    previousRotation: previous,
    rotation: node.rotation,
    origin,
    x: node.x,
    y: node.y,
    ...absolutePosition(node),
  };
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}

const NAMED_POSITIONS = ["front", "back", "forward", "backward"];

/** Target index for a layer-order request. 0 = back of the z-stack, count - 1 = front. */
export function resolveLayerIndex(position: unknown, current: number, count: number): number {
  const last = count - 1;
  if (typeof position === "string" && NAMED_POSITIONS.indexOf(position.toLowerCase()) !== -1) {
    switch (position.toLowerCase()) {
      case "front":
        return last;
      case "back":
        return 0;
      case "forward":
        return Math.min(current + 1, last);
      default:
        return Math.max(current - 1, 0);
    }
  }
  const n = typeof position === "string" && position.trim() !== "" ? Number(position) : (position as number);
  if (typeof n !== "number" || !isFinite(n) || Math.floor(n) !== n || n < 0) {
    throw new Error(
      `set_layer_order: position must be "front", "back", "forward", "backward" or a non-negative integer index (got ${JSON.stringify(position)})`,
    );
  }
  return Math.min(n, last);
}

export async function setLayerOrder(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safe = params !== null && params !== undefined ? params : {};
  const nodeId = safe.nodeId as string | undefined;
  const position = safe.position !== undefined ? safe.position : safe.index;
  if (!nodeId) throw new Error("Missing nodeId parameter");
  if (position === undefined || position === null) throw new Error("Missing position parameter");

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node not found with ID: ${nodeId}`);
  const parent = node.parent as (BaseNode & ChildrenMixin) | null;
  if (!parent || node.type === "PAGE" || node.type === "DOCUMENT" || !("insertChild" in parent)) {
    throw new Error(`set_layer_order: node ${nodeId} has no parent to reorder within`);
  }

  const child = node as SceneNode;
  const count = parent.children.length;
  const previousIndex = parent.children.indexOf(child);
  const target = resolveLayerIndex(position, previousIndex, count);

  if (target !== previousIndex) {
    if (target === count - 1) parent.appendChild(child);
    else parent.insertChild(target, child);
    // insertChild within the same parent may count the node's old slot; correct once.
    const landed = parent.children.indexOf(child);
    if (landed !== target) parent.insertChild(landed < target ? target + 1 : target, child);
  }

  const index = parent.children.indexOf(child);
  if (index !== target) {
    throw new Error(`set_layer_order: Figma placed "${node.name}" at index ${index} instead of ${target}`);
  }
  return {
    id: node.id,
    name: node.name,
    parentId: parent.id,
    previousIndex,
    index,
    childCount: count,
  };
}
