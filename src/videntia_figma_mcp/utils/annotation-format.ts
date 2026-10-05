import type { AnnotationsResult } from "../types/index.js";
import { sanitizeCell, truncate } from "./format-helpers.js";

interface AnnotationEntry {
  index?: number;
  label?: string;
  labelMarkdown?: string;
  categoryId?: string;
  category?: { id?: string; label?: string };
  properties?: Array<{ type?: string }>;
}

interface AnnotationGroup {
  nodeId: string;
  nodeName?: string;
  nodeType?: string;
  annotations: AnnotationEntry[];
}

/**
 * Fold the `index` param and its deprecated `annotationId` spelling into one 0-based
 * index. `annotationId` was always an index, never an id.
 */
export function resolveAnnotationIndex(index: number | undefined, annotationId: unknown): number | undefined {
  if (index !== undefined) return index;
  if (annotationId === undefined || annotationId === null || annotationId === "") return undefined;
  const n = typeof annotationId === "number" ? annotationId : Number(String(annotationId).trim());
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid annotation index ${String(annotationId)}: expected a 0-based integer`);
  }
  return n;
}

function formatCategory(a: AnnotationEntry): string {
  const id = a.categoryId || a.category?.id;
  if (!id) return "-";
  const label = a.category?.label;
  return label ? `${sanitizeCell(label)} (${id})` : id;
}

function formatProperties(a: AnnotationEntry): string {
  if (!a.properties || a.properties.length === 0) return "-";
  return a.properties.map((p) => p.type || "?").join(", ");
}

/** Render a get_annotations result as per-node tables. */
export function formatAnnotationsResult(result: AnnotationsResult, nodeId: string, includeChildren: boolean): string {
  const r = result as AnnotationsResult & {
    nodeId?: string;
    nodeName?: string;
    nodeType?: string;
    supported?: boolean;
    message?: string;
    nodesScanned?: number;
    nodes?: AnnotationGroup[];
  };
  const rootName = r.nodeName || r.nodeId || nodeId;
  let groups: AnnotationGroup[] = Array.isArray(r.nodes) ? r.nodes : [];
  if (groups.length === 0) {
    const own = (r.annotations || (Array.isArray(result) ? result : [])) as AnnotationEntry[];
    if (own.length > 0) {
      groups = [{ nodeId: r.nodeId || nodeId, nodeName: r.nodeName, nodeType: r.nodeType, annotations: own }];
    }
  }

  const note = r.supported === false && r.message ? r.message : undefined;
  const total = groups.reduce((sum, g) => sum + g.annotations.length, 0);

  if (total === 0) {
    if (note && !includeChildren) return note;
    const scope = includeChildren
      ? `node "${rootName}" or its descendants (${r.nodesScanned ?? "?"} nodes scanned)`
      : `node "${rootName}"`;
    const lines = [`No annotations found on ${scope}.`];
    if (note) lines.push(`Note: ${note}`);
    return lines.join("\n");
  }

  const lines: string[] = [
    includeChildren
      ? `Found ${total} annotation(s) on ${groups.length} node(s) under "${rootName}" (${r.nodesScanned ?? "?"} nodes scanned)`
      : `Found ${total} annotation(s) on node "${rootName}"`,
  ];
  if (note) lines.push(`Note: ${note}`);
  for (const g of groups) {
    lines.push(
      "",
      `### ${sanitizeCell(g.nodeName || g.nodeId)} (${g.nodeType || "?"}, ${g.nodeId})`,
      "",
      "| Index | Label | Category (id) | Properties |",
      "|-------|-------|---------------|------------|",
    );
    for (const a of g.annotations) {
      const label = truncate((a.labelMarkdown || a.label || "-").replace(/\n/g, " "), 60);
      lines.push(`| ${a.index ?? "-"} | ${sanitizeCell(label)} | ${formatCategory(a)} | ${formatProperties(a)} |`);
    }
  }
  return lines.join("\n");
}
