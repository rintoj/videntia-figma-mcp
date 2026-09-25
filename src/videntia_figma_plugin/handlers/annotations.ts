// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Structural type for nodes that carry the Figma annotations mixin.
// Using this instead of FrameNode avoids the incorrect assumption that
// only frames support annotations — all ANNOTATION_SUPPORTED_TYPES do.
type AnnotatableNode = BaseNode & { readonly annotations: ReadonlyArray<Annotation> };

type CategoryInfo = { id: string; label: string; color: string; isPreset: boolean };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Node types whose typings include AnnotationsMixin. GROUP, SECTION,
// BOOLEAN_OPERATION and TRANSFORM_GROUP do not — a platform limit.
export const ANNOTATION_SUPPORTED_TYPES = [
  "COMPONENT",
  "COMPONENT_SET",
  "ELLIPSE",
  "FRAME",
  "INSTANCE",
  "SLOT",
  "LINE",
  "POLYGON",
  "RECTANGLE",
  "STAR",
  "TEXT",
  "TEXT_PATH",
  "VECTOR",
];

const ANNOTATION_VALID_COLORS = [
  "blue",
  "green",
  "yellow",
  "orange",
  "red",
  "purple",
  "gray",
  "teal",
  "pink",
  "violet",
];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function isAnnotationSupported(node: BaseNode): boolean {
  return ANNOTATION_SUPPORTED_TYPES.includes(node.type);
}

export function unsupportedAnnotationMessage(type: string): string {
  switch (type) {
    case "GROUP":
      return "GROUP nodes can't hold annotations in Figma; annotate a child or wrap the group in a frame";
    case "SECTION":
      return "SECTION nodes can't hold annotations in Figma; annotate a frame or layer inside the section";
    case "BOOLEAN_OPERATION":
      return "BOOLEAN_OPERATION nodes can't hold annotations in Figma; annotate a child layer or flatten it into a vector";
    default:
      return `${type} nodes can't hold annotations in Figma. Supported types: ${ANNOTATION_SUPPORTED_TYPES.join(", ")}`;
  }
}

function toCategoryInfo(c: AnnotationCategory): CategoryInfo {
  return { id: c.id, label: c.label, color: c.color, isPreset: c.isPreset };
}

type CategoryLoader = () => Promise<CategoryInfo[]>;

function makeCategoryLoader(): CategoryLoader {
  let pending: Promise<CategoryInfo[]> | undefined;
  return () => {
    if (!pending) {
      pending = figma.annotations.getAnnotationCategoriesAsync().then((cats) => cats.map(toCategoryInfo));
    }
    return pending;
  };
}

/**
 * Resolve the category a write asked for. `categoryId` wins; `category` matches a
 * category label (case-insensitive) or id. Returns undefined when neither was
 * given, and null when the caller asked to clear the category (an empty string).
 */
export async function resolveAnnotationCategoryId(
  params: Record<string, unknown>,
  loadCategories: CategoryLoader = makeCategoryLoader(),
): Promise<string | null | undefined> {
  const categoryId = params["categoryId"];
  const category = params["category"];
  const requested = categoryId !== undefined && categoryId !== null ? categoryId : category;
  if (requested === undefined || requested === null) return undefined;
  if (typeof requested !== "string") throw new Error("category/categoryId must be a string");
  const wanted = requested.trim();
  if (wanted === "") return null;
  if (requested === categoryId) return wanted;

  const categories = await loadCategories();
  const lower = wanted.toLowerCase();
  const match =
    categories.find((c) => c.id === wanted) || categories.find((c) => c.label.trim().toLowerCase() === lower);
  if (!match) {
    const available = categories.map((c) => `"${c.label}" (${c.id})`).join(", ") || "none";
    throw new Error(`Annotation category "${wanted}" not found. Available categories: ${available}`);
  }
  return match.id;
}

function copyAnnotation(a: Annotation): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  if (a.labelMarkdown) copy["labelMarkdown"] = a.labelMarkdown;
  else if (a.label) copy["label"] = a.label;
  if (a.categoryId) copy["categoryId"] = a.categoryId;
  if (a.properties && a.properties.length > 0) {
    copy["properties"] = a.properties.map((p) => Object.assign({}, p));
  }
  return copy;
}

function readIndex(params: Record<string, unknown>): number | undefined {
  const raw = params["index"] !== undefined && params["index"] !== null ? params["index"] : params["annotationId"];
  if (raw === undefined || raw === null || raw === "") return undefined;
  const idx = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isInteger(idx)) throw new Error(`Invalid annotation index ${String(raw)}: expected a 0-based integer`);
  return idx;
}

function assertIndexInRange(idx: number, length: number): void {
  if (idx < 0 || idx >= length) {
    const rangeMsg = length === 0 ? "no annotations exist on this node" : `valid range: 0-${length - 1}`;
    throw new Error(`Invalid annotation index ${idx}. ${rangeMsg}`);
  }
}

async function serializeAnnotations(
  node: BaseNode,
  categoryById: (id: string) => Promise<CategoryInfo | undefined>,
): Promise<Record<string, unknown>[]> {
  const raw: Annotation[] = Array.from((node as unknown as AnnotatableNode).annotations || []);
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ann = raw[i];
    const entry: Record<string, unknown> = {
      index: i,
      label: ann.label !== null && ann.label !== undefined ? ann.label : "",
      labelMarkdown: ann.labelMarkdown !== null && ann.labelMarkdown !== undefined ? ann.labelMarkdown : "",
    };
    if (ann.categoryId) {
      entry["categoryId"] = ann.categoryId;
      const category = await categoryById(ann.categoryId);
      if (category) entry["category"] = category;
    }
    if (ann.properties && ann.properties.length > 0) {
      entry["properties"] = ann.properties;
    }
    out.push(entry);
  }
  return out;
}

export interface AnnotatedNodeGroup {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  annotations: Record<string, unknown>[];
}

/**
 * Walk `root` (and, when `includeChildren`, its descendants down to `depth` levels —
 * unlimited when undefined) and return one group per node that carries annotations.
 * Every child-bearing node is descended into, including GROUP/SECTION/BOOLEAN_OPERATION,
 * which cannot hold annotations themselves but can contain annotatable layers.
 */
export async function collectAnnotationGroups(
  root: BaseNode,
  options: { includeChildren?: boolean; depth?: number; includeCategories?: boolean } = {},
): Promise<{ groups: AnnotatedNodeGroup[]; nodesScanned: number }> {
  const cache = new Map<string, Promise<CategoryInfo | undefined>>();
  const categoryById = (id: string): Promise<CategoryInfo | undefined> => {
    if (!options.includeCategories) return Promise.resolve(undefined);
    let hit = cache.get(id);
    if (!hit) {
      hit = figma.annotations
        .getAnnotationCategoryByIdAsync(id)
        .then((c) => (c ? toCategoryInfo(c) : undefined))
        .catch(() => undefined);
      cache.set(id, hit);
    }
    return hit;
  };

  const groups: AnnotatedNodeGroup[] = [];
  let nodesScanned = 0;
  const maxDepth = options.includeChildren ? (options.depth === undefined ? Infinity : options.depth) : 0;

  const visit = async (node: BaseNode, level: number): Promise<void> => {
    nodesScanned++;
    if (isAnnotationSupported(node)) {
      const annotations = await serializeAnnotations(node, categoryById);
      if (annotations.length > 0) {
        groups.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, annotations });
      }
    }
    if (level < maxDepth && "children" in node) {
      for (const child of (node as ChildrenMixin).children) {
        await visit(child, level + 1);
      }
    }
  };

  await visit(root, 0);
  return { groups, nodesScanned };
}

// ---------------------------------------------------------------------------
// Annotation node operations
// ---------------------------------------------------------------------------

export async function getAnnotations(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params["nodeId"] as string;
  const includeCategories = params["includeCategories"] !== false;
  const includeChildren = params["includeChildren"] === true;
  const rawDepth = params["depth"];
  const depth = rawDepth === undefined || rawDepth === null ? undefined : Number(rawDepth);
  if (depth !== undefined && (!Number.isInteger(depth) || depth < 0)) {
    throw new Error(`depth must be a non-negative integer, got ${String(rawDepth)}`);
  }

  const targetNode = await figma.getNodeByIdAsync(nodeId);
  if (!targetNode) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  const supported = isAnnotationSupported(targetNode);
  const { groups, nodesScanned } = await collectAnnotationGroups(targetNode, {
    includeChildren,
    depth,
    includeCategories,
  });
  const own = groups.find((g) => g.nodeId === targetNode.id);
  const annotationCount = groups.reduce((sum, g) => sum + g.annotations.length, 0);

  const result: Record<string, unknown> = {
    success: true,
    nodeId: targetNode.id,
    nodeName: targetNode.name,
    nodeType: targetNode.type,
    supported,
    includeChildren,
    nodesScanned,
    annotationCount,
    annotations: own ? own.annotations : [],
    nodes: groups,
  };
  if (!supported) result["message"] = unsupportedAnnotationMessage(targetNode.type);
  return result;
}

async function applyAnnotation(
  params: Record<string, unknown>,
  loadCategories: CategoryLoader,
): Promise<Record<string, unknown>> {
  const nodeId = params["nodeId"] as string;
  const labelMarkdown = params["labelMarkdown"] as string | undefined;
  const properties = params["properties"] as unknown[] | undefined;

  if (!nodeId) throw new Error("nodeId is required");
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }
  if (!isAnnotationSupported(node)) {
    throw new Error(unsupportedAnnotationMessage(node.type));
  }

  const index = readIndex(params);
  const categoryId = await resolveAnnotationCategoryId(params, loadCategories);

  const annotatedNode = node as unknown as AnnotatableNode;
  const existing = Array.from(annotatedNode.annotations || []).map(copyAnnotation);

  let annotation: Record<string, unknown>;
  let annotationIndex: number;
  if (index !== undefined) {
    assertIndexInRange(index, existing.length);
    annotation = existing[index];
    annotationIndex = index;
  } else {
    if (labelMarkdown === undefined || labelMarkdown === null) {
      throw new Error(
        "labelMarkdown is required when appending a new annotation (omit it only when updating by index)",
      );
    }
    annotation = {};
    annotationIndex = existing.length;
    existing.push(annotation);
  }

  if (labelMarkdown !== undefined && labelMarkdown !== null) {
    delete annotation["label"];
    annotation["labelMarkdown"] = labelMarkdown;
  }
  if (categoryId === null) delete annotation["categoryId"];
  else if (categoryId !== undefined) annotation["categoryId"] = categoryId;
  if (Array.isArray(properties)) {
    if (properties.length > 0) annotation["properties"] = properties;
    else delete annotation["properties"];
  }

  (annotatedNode as unknown as Record<string, unknown>)["annotations"] = existing;

  return {
    success: true,
    nodeId: node.id,
    name: node.name,
    nodeName: node.name,
    action: index !== undefined ? "updated" : "created",
    annotationIndex,
    totalAnnotations: existing.length,
    annotation,
  };
}

export async function setAnnotation(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  return applyAnnotation(params, makeCategoryLoader());
}

export async function setMultipleAnnotations(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const annotations = params["annotations"] as Record<string, unknown>[] | undefined;
  const defaultNodeId = params["nodeId"] as string | undefined;

  if (!Array.isArray(annotations)) {
    throw new Error("annotations must be an array");
  }

  const loadCategories = makeCategoryLoader();
  const results: Record<string, unknown>[] = [];
  let applied = 0;
  let failed = 0;

  for (const entry of annotations) {
    const nodeId = (entry["nodeId"] as string | undefined) || defaultNodeId;
    try {
      const result = await applyAnnotation(
        {
          nodeId,
          labelMarkdown: entry["labelMarkdown"],
          categoryId: entry["categoryId"],
          category: entry["category"],
          properties: entry["properties"],
          index: entry["index"],
          annotationId: entry["annotationId"],
        },
        loadCategories,
      );
      results.push({
        success: true,
        nodeId,
        action: result["action"],
        annotationIndex: result["annotationIndex"],
      });
      applied++;
    } catch (e) {
      const err = e as Error;
      results.push({
        success: false,
        nodeId,
        error: err.message !== null && err.message !== undefined ? err.message : String(e),
      });
      failed++;
    }
  }

  return {
    success: failed === 0,
    annotationsApplied: applied,
    annotationsFailed: failed,
    completedInChunks: 1,
    results,
  };
}

export async function removeAnnotation(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params["nodeId"] as string;
  const all = params["all"] === true;
  const index = readIndex(params);

  if ((index === undefined) === !all) {
    throw new Error("Pass exactly one of index (a 0-based annotation index) or all: true");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }
  if (!isAnnotationSupported(node)) {
    throw new Error(unsupportedAnnotationMessage(node.type));
  }

  const annotatedNode = node as unknown as AnnotatableNode;
  const existing = Array.from(annotatedNode.annotations || []).map(copyAnnotation);

  let removed: Record<string, unknown>[];
  if (all) {
    removed = existing.splice(0, existing.length);
  } else {
    assertIndexInRange(index as number, existing.length);
    removed = existing.splice(index as number, 1);
  }

  (annotatedNode as unknown as Record<string, unknown>)["annotations"] = existing;

  return {
    success: true,
    nodeId: node.id,
    name: node.name,
    nodeName: node.name,
    removedCount: removed.length,
    removed,
    remainingAnnotations: existing.length,
  };
}

// ---------------------------------------------------------------------------
// Annotation category operations
// ---------------------------------------------------------------------------

export async function getAnnotationCategories(): Promise<Record<string, unknown>> {
  const categories = await figma.annotations.getAnnotationCategoriesAsync();
  return {
    success: true,
    count: categories.length,
    categories: categories.map((c) => ({
      id: c.id,
      label: c.label,
      color: c.color,
      isPreset: c.isPreset,
    })),
  };
}

export async function createAnnotationCategory(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const label = params["label"] as string | undefined;
  const color = params["color"] as string | undefined;

  if (!label || typeof label !== "string" || label.trim() === "") {
    throw new Error("label is required and must be a non-empty string");
  }

  const categoryColor = color !== null && color !== undefined ? color : "blue";
  if (!ANNOTATION_VALID_COLORS.includes(categoryColor)) {
    throw new Error(`Invalid color "${categoryColor}". Valid colors: ${ANNOTATION_VALID_COLORS.join(", ")}`);
  }

  const category = await figma.annotations.addAnnotationCategoryAsync({
    label: label.trim(),
    color: categoryColor as AnnotationCategoryColor,
  });

  return {
    success: true,
    category: {
      id: category.id,
      label: category.label,
      color: category.color,
      isPreset: category.isPreset,
    },
  };
}

export async function updateAnnotationCategory(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const categoryId = params["categoryId"] as string | undefined;
  const label = params["label"] as string | null | undefined;
  const color = params["color"] as string | null | undefined;

  if (!categoryId) {
    throw new Error("categoryId is required");
  }

  const category = await figma.annotations.getAnnotationCategoryByIdAsync(categoryId);
  if (!category) {
    throw new Error(`Annotation category with ID ${categoryId} not found`);
  }

  if (category.isPreset) {
    throw new Error("Cannot modify a preset annotation category");
  }

  if (label !== undefined && label !== null) {
    if (typeof label !== "string" || label.trim() === "") {
      throw new Error("label must be a non-empty string");
    }
    category.setLabel(label.trim());
  }

  if (color !== undefined && color !== null) {
    if (!ANNOTATION_VALID_COLORS.includes(color)) {
      throw new Error(`Invalid color "${color}". Valid colors: ${ANNOTATION_VALID_COLORS.join(", ")}`);
    }
    category.setColor(color as AnnotationCategoryColor);
  }

  return {
    success: true,
    category: {
      id: category.id,
      label: category.label,
      color: category.color,
      isPreset: category.isPreset,
    },
  };
}

export async function deleteAnnotationCategory(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const categoryId = params["categoryId"] as string | undefined;

  if (!categoryId) {
    throw new Error("categoryId is required");
  }

  const category = await figma.annotations.getAnnotationCategoryByIdAsync(categoryId);
  if (!category) {
    throw new Error(`Annotation category with ID ${categoryId} not found`);
  }

  if (category.isPreset) {
    throw new Error("Cannot delete a preset annotation category");
  }

  category.remove();

  return {
    success: true,
    deletedCategoryId: categoryId,
  };
}
