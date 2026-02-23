import { debugLog, sendProgressUpdate } from '../utils/helpers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANNOTATION_SUPPORTED_TYPES = [
  'COMPONENT',
  'COMPONENT_SET',
  'ELLIPSE',
  'FRAME',
  'INSTANCE',
  'LINE',
  'POLYGON',
  'RECTANGLE',
  'STAR',
  'TEXT',
  'VECTOR',
];

const ANNOTATION_VALID_COLORS = ['blue', 'green', 'yellow', 'orange', 'red', 'purple', 'gray', 'teal'];

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function isAnnotationSupported(node: BaseNode): boolean {
  return ANNOTATION_SUPPORTED_TYPES.includes(node.type);
}

// ---------------------------------------------------------------------------
// Annotation node operations
// ---------------------------------------------------------------------------

export async function getAnnotations(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params['nodeId'] as string;
  const includeCategories = params['includeCategories'] as boolean | undefined;

  const targetNode = await figma.getNodeByIdAsync(nodeId);
  if (!targetNode) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  if (!isAnnotationSupported(targetNode)) {
    return {
      success: true,
      nodeId: targetNode.id,
      nodeName: targetNode.name,
      nodeType: targetNode.type,
      annotationCount: 0,
      annotations: [],
      message: `Node type ${targetNode.type} does not support annotations`,
    };
  }

  const annotatedNode = targetNode as FrameNode;
  const rawAnnotations: Annotation[] = (annotatedNode.annotations as Annotation[]) || [];
  const annotations: Record<string, unknown>[] = [];

  for (let i = 0; i < rawAnnotations.length; i++) {
    const ann = rawAnnotations[i];
    const entry: Record<string, unknown> = {
      index: i,
      label: (ann.label !== null && ann.label !== undefined) ? ann.label : '',
      labelMarkdown: (ann.labelMarkdown !== null && ann.labelMarkdown !== undefined) ? ann.labelMarkdown : '',
    };

    if (ann.categoryId) {
      entry['categoryId'] = ann.categoryId;
      if (includeCategories) {
        try {
          const category = await figma.annotations.getAnnotationCategoryByIdAsync(ann.categoryId);
          if (category) {
            entry['category'] = {
              id: category.id,
              label: category.label,
              color: category.color,
              isPreset: category.isPreset,
            };
          }
        } catch (e) {
          // Category may have been deleted
        }
      }
    }

    if (ann.properties && ann.properties.length > 0) {
      entry['properties'] = ann.properties;
    }

    annotations.push(entry);
  }

  return {
    success: true,
    nodeId: targetNode.id,
    nodeName: targetNode.name,
    nodeType: targetNode.type,
    annotationCount: annotations.length,
    annotations,
  };
}

export async function setAnnotation(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params['nodeId'] as string;
  const labelMarkdown = params['labelMarkdown'] as string | undefined;
  const categoryId = params['categoryId'] as string | undefined;
  const properties = params['properties'] as unknown[] | undefined;
  const annotationId = params['annotationId'] as string | number | null | undefined;

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  if (!isAnnotationSupported(node)) {
    throw new Error(`Node type ${node.type} does not support annotations. Supported types: ${ANNOTATION_SUPPORTED_TYPES.join(', ')}`);
  }

  const annotation: Record<string, unknown> = {
    labelMarkdown: (labelMarkdown !== null && labelMarkdown !== undefined) ? labelMarkdown : '',
  };
  if (categoryId) {
    annotation['categoryId'] = categoryId;
  }
  if (properties && Array.isArray(properties) && properties.length > 0) {
    annotation['properties'] = properties;
  }

  const annotatedNode = node as FrameNode;
  const rawAnnotations: Annotation[] = (annotatedNode.annotations as Annotation[]) || [];

  // Deep-copy existing annotations (readonly objects from Figma)
  const existingAnnotations: Record<string, unknown>[] = rawAnnotations.map((a) => {
    const copy: Record<string, unknown> = {
      labelMarkdown: (a.labelMarkdown !== null && a.labelMarkdown !== undefined) ? a.labelMarkdown : '',
    };
    if (a.categoryId) copy['categoryId'] = a.categoryId;
    if (a.properties) {
      copy['properties'] = a.properties.map((p) => Object.assign({}, p));
    }
    return copy;
  });

  let annotationIndex: number;

  if (annotationId !== undefined && annotationId !== null) {
    const idx = parseInt(String(annotationId), 10);
    if (isNaN(idx) || idx < 0 || idx >= existingAnnotations.length) {
      const rangeMsg =
        existingAnnotations.length === 0
          ? 'no annotations exist on this node'
          : `valid range: 0-${existingAnnotations.length - 1}`;
      throw new Error(`Invalid annotation index ${annotationId}. ${rangeMsg}`);
    }
    existingAnnotations[idx] = annotation;
    annotationIndex = idx;
  } else {
    annotationIndex = existingAnnotations.length;
    existingAnnotations.push(annotation);
  }

  (annotatedNode as unknown as Record<string, unknown>)['annotations'] = existingAnnotations;

  return {
    success: true,
    nodeId: node.id,
    nodeName: node.name,
    annotationIndex,
    totalAnnotations: existingAnnotations.length,
    annotation,
  };
}

export async function setMultipleAnnotations(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const annotations = params['annotations'] as Record<string, unknown>[] | undefined;

  if (!Array.isArray(annotations)) {
    throw new Error('annotations must be an array');
  }

  const results: Record<string, unknown>[] = [];
  let applied = 0;
  let failed = 0;

  for (const entry of annotations) {
    try {
      const result = await setAnnotation({
        nodeId: entry['nodeId'],
        labelMarkdown: entry['labelMarkdown'],
        categoryId: entry['categoryId'],
        properties: entry['properties'],
        annotationId: entry['annotationId'],
      } as Record<string, unknown>);
      results.push({ success: true, nodeId: entry['nodeId'], annotationIndex: result['annotationIndex'] });
      applied++;
    } catch (e) {
      const err = e as Error;
      results.push({ success: false, nodeId: entry['nodeId'], error: (err.message !== null && err.message !== undefined) ? err.message : String(e) });
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
  const label = params['label'] as string | undefined;
  const color = params['color'] as string | undefined;

  if (!label || typeof label !== 'string' || label.trim() === '') {
    throw new Error('label is required and must be a non-empty string');
  }

  const categoryColor = (color !== null && color !== undefined) ? color : 'blue';
  if (!ANNOTATION_VALID_COLORS.includes(categoryColor)) {
    throw new Error(`Invalid color "${categoryColor}". Valid colors: ${ANNOTATION_VALID_COLORS.join(', ')}`);
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
  const categoryId = params['categoryId'] as string | undefined;
  const label = params['label'] as string | null | undefined;
  const color = params['color'] as string | null | undefined;

  if (!categoryId) {
    throw new Error('categoryId is required');
  }

  const category = await figma.annotations.getAnnotationCategoryByIdAsync(categoryId);
  if (!category) {
    throw new Error(`Annotation category with ID ${categoryId} not found`);
  }

  if (category.isPreset) {
    throw new Error('Cannot modify a preset annotation category');
  }

  if (label !== undefined && label !== null) {
    if (typeof label !== 'string' || label.trim() === '') {
      throw new Error('label must be a non-empty string');
    }
    category.setLabel(label.trim());
  }

  if (color !== undefined && color !== null) {
    if (!ANNOTATION_VALID_COLORS.includes(color)) {
      throw new Error(`Invalid color "${color}". Valid colors: ${ANNOTATION_VALID_COLORS.join(', ')}`);
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
  const categoryId = params['categoryId'] as string | undefined;

  if (!categoryId) {
    throw new Error('categoryId is required');
  }

  const category = await figma.annotations.getAnnotationCategoryByIdAsync(categoryId);
  if (!category) {
    throw new Error(`Annotation category with ID ${categoryId} not found`);
  }

  if (category.isPreset) {
    throw new Error('Cannot delete a preset annotation category');
  }

  category.remove();

  return {
    success: true,
    deletedCategoryId: categoryId,
  };
}

// Suppress unused import warning — these may be used by the broader plugin
void debugLog;
void sendProgressUpdate;
