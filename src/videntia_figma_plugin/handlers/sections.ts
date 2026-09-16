// Figma Sections — createSection / setSectionStatus.
//
// SectionNode is NOT a regular SceneNode: it has no cornerRadius, no strokes,
// no resize() (it uses resizeWithoutConstraints), and no layout properties.
// It does support: name, x, y, fills, devStatus, appendChild/insertChild.

import { resolveColor } from "./fills";

type DevStatusType = "READY_FOR_DEV" | "COMPLETED";

interface SectionLike {
  id: string;
  name: string;
  type: string;
  parent: { id: string } | null;
  x: number;
  y: number;
  width: number;
  height: number;
  fills: readonly Paint[] | typeof figma.mixed;
  devStatus: { type: DevStatusType; description?: string } | null;
  resizeWithoutConstraints: (width: number, height: number) => void;
}

function optNum(params: Record<string, unknown>, key: string): number | undefined {
  const v = params !== null && params !== undefined ? params[key] : undefined;
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

export async function createSection(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const p = params || {};
  const name = p["name"] as string | undefined;
  const x = optNum(p, "x");
  const y = optNum(p, "y");
  const width = optNum(p, "width");
  const height = optNum(p, "height");
  const parentId = p["parentId"] as string | undefined;

  if (typeof figma.createSection !== "function") {
    throw new Error("figma.createSection is not available in this Figma version");
  }

  const section = figma.createSection() as unknown as SectionLike;

  if (name) section.name = name;
  if (x !== undefined) section.x = x;
  if (y !== undefined) section.y = y;
  if (width !== undefined && height !== undefined) {
    section.resizeWithoutConstraints(width, height);
  }

  if (p["color"] !== undefined || p["fillColor"] !== undefined) {
    const src = p["fillColor"] !== undefined ? { color: p["fillColor"] } : p;
    const rgba = resolveColor(src as Record<string, unknown>);
    section.fills = [
      {
        type: "SOLID",
        color: { r: rgba.r, g: rgba.g, b: rgba.b },
        opacity: rgba.a,
      } as SolidPaint,
    ];
  }

  if (parentId) {
    const parent = await figma.getNodeByIdAsync(parentId);
    if (!parent) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    // Sections may only live on a page or inside another section.
    if (parent.type !== "PAGE" && parent.type !== "SECTION") {
      throw new Error(`Sections can only be parented to a PAGE or another SECTION (got ${parent.type})`);
    }
    (parent as unknown as { appendChild: (n: unknown) => void }).appendChild(section);
  } else {
    (figma.currentPage as unknown as { appendChild: (n: unknown) => void }).appendChild(section);
  }

  return {
    id: section.id,
    name: section.name,
    type: section.type,
    x: section.x,
    y: section.y,
    width: section.width,
    height: section.height,
    parentId: section.parent ? section.parent.id : undefined,
  };
}

export async function setSectionStatus(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const p = params || {};
  const nodeId = p["nodeId"] as string | undefined;
  const statusRaw = p["status"] as string | undefined;
  const description = p["description"] as string | undefined;

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!statusRaw) {
    throw new Error("Missing status parameter (READY_FOR_DEV, COMPLETED, or NONE)");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  if (node.type !== "SECTION") {
    throw new Error(`Node ${nodeId} is not a SECTION (type: ${node.type})`);
  }

  const section = node as unknown as SectionLike;
  if (!("devStatus" in section)) {
    throw new Error("devStatus is not supported by this Figma plugin API version");
  }

  const status = statusRaw.toUpperCase();
  if (status === "NONE" || status === "NULL") {
    section.devStatus = null;
  } else if (status === "READY_FOR_DEV" || status === "COMPLETED") {
    const devStatus: { type: DevStatusType; description?: string } = { type: status as DevStatusType };
    if (description !== undefined) devStatus.description = description;
    section.devStatus = devStatus;
  } else {
    throw new Error(`Invalid status "${statusRaw}". Expected READY_FOR_DEV, COMPLETED, or NONE`);
  }

  return {
    id: section.id,
    name: section.name,
    devStatus: section.devStatus,
  };
}
