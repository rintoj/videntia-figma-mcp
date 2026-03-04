// Paint/color style handler functions for the Claude Figma MCP plugin.

import { parseHexColor } from './fills';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a color from params — hex string or { r, g, b, a } object.
 */
function resolvePaintColor(params: Record<string, unknown>): { r: number; g: number; b: number; a: number } {
  var colorParam = params['color'];

  if (typeof colorParam === 'string') {
    var parsed = parseHexColor(colorParam);
    if (!parsed) {
      throw new Error('Invalid hex color: ' + colorParam);
    }
    return parsed;
  }

  if (colorParam !== null && colorParam !== undefined && typeof colorParam === 'object') {
    var obj = colorParam as Record<string, unknown>;
    var r = obj['r'];
    var g = obj['g'];
    var b = obj['b'];
    var a = obj['a'];
    if (r === undefined || g === undefined || b === undefined) {
      throw new Error('Color object must have r, g, b components.');
    }
    return {
      r: parseFloat(r as string),
      g: parseFloat(g as string),
      b: parseFloat(b as string),
      a: a !== undefined ? parseFloat(a as string) : 1,
    };
  }

  throw new Error('Missing required parameter: color (hex string or { r, g, b, a } object)');
}

/**
 * Find a paint style by ID or name (with dash-to-slash normalization).
 */
async function findPaintStyle(styleId: string): Promise<PaintStyle> {
  var style = await figma.getStyleByIdAsync(styleId);
  if (style && style.type === 'PAINT') {
    return style as PaintStyle;
  }

  var allStyles = await figma.getLocalPaintStylesAsync();
  var found = allStyles.find(function(s) { return s.name === styleId; });
  if (found) return found;

  var normalizedInput = styleId.replace(/-/g, '/');
  if (normalizedInput !== styleId) {
    found = allStyles.find(function(s) { return s.name === normalizedInput; });
    if (found) return found;
  }

  throw new Error('Paint style not found: "' + styleId + '". Pass a style ID or name (e.g. "color/primary").');
}

/**
 * Convert a paint style to a serializable object.
 */
function serializePaintStyle(style: PaintStyle): Record<string, unknown> {
  var paints = style.paints;
  var firstPaint = paints.length > 0 ? paints[0] : null;
  var color: Record<string, unknown> | null = null;
  if (firstPaint && firstPaint.type === 'SOLID') {
    var solid = firstPaint as SolidPaint;
    color = {
      r: solid.color.r,
      g: solid.color.g,
      b: solid.color.b,
      a: solid.opacity !== undefined ? solid.opacity : 1,
    };
  }
  return {
    id: style.id,
    name: style.name,
    key: style.key,
    description: style.description,
    color: color,
    paints: paints,
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function createColorStyle(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  var name = params['name'] as string | undefined;
  var description = params['description'] as string | undefined;

  if (!name) {
    throw new Error('Missing required parameter: name');
  }

  var color = resolvePaintColor(params);

  try {
    var paintStyle = figma.createPaintStyle();
    paintStyle.name = name;
    paintStyle.paints = [{
      type: 'SOLID',
      color: { r: color.r, g: color.g, b: color.b },
      opacity: color.a,
    }];
    if (description !== undefined) {
      paintStyle.description = description;
    }

    return serializePaintStyle(paintStyle);
  } catch (error) {
    throw new Error('Error creating color style: ' + (error as Error).message);
  }
}

export async function getColorStyles(
  _params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    var styles = await figma.getLocalPaintStylesAsync();
    var result = styles.map(function(s) { return serializePaintStyle(s); });
    return { styles: result, count: result.length };
  } catch (error) {
    throw new Error('Error getting color styles: ' + (error as Error).message);
  }
}

export async function getColorStyle(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  var styleId = params['styleId'] as string | undefined;

  if (!styleId) {
    throw new Error('Missing required parameter: styleId');
  }

  try {
    var style = await findPaintStyle(styleId);
    return serializePaintStyle(style);
  } catch (error) {
    throw new Error('Error getting color style: ' + (error as Error).message);
  }
}

export async function updateColorStyle(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  var styleId = params['styleId'] as string | undefined;
  var name = params['name'] as string | undefined;
  var description = params['description'] as string | undefined;
  var hasColor = params['color'] !== undefined;

  if (!styleId) {
    throw new Error('Missing required parameter: styleId');
  }

  try {
    var style = await findPaintStyle(styleId);
    var updatedProperties: string[] = [];

    if (name !== undefined) {
      style.name = name;
      updatedProperties.push('name');
    }

    if (description !== undefined) {
      style.description = description;
      updatedProperties.push('description');
    }

    if (hasColor) {
      var color = resolvePaintColor(params);
      style.paints = [{
        type: 'SOLID',
        color: { r: color.r, g: color.g, b: color.b },
        opacity: color.a,
      }];
      updatedProperties.push('color');
    }

    var result = serializePaintStyle(style);
    (result as Record<string, unknown>)['updatedProperties'] = updatedProperties;
    return result;
  } catch (error) {
    throw new Error('Error updating color style: ' + (error as Error).message);
  }
}

export async function deleteColorStyle(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  var styleId = params['styleId'] as string | undefined;

  if (!styleId) {
    throw new Error('Missing required parameter: styleId');
  }

  try {
    var style = await findPaintStyle(styleId);
    var styleName = style.name;
    var styleIdCopy = style.id;

    style.remove();

    return { id: styleIdCopy, name: styleName };
  } catch (error) {
    throw new Error('Error deleting color style: ' + (error as Error).message);
  }
}

export async function setColorStyleId(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  var nodeId = params['nodeId'] as string | undefined;
  var styleId = params['styleId'] as string | undefined;

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  if (!styleId) {
    throw new Error('Missing styleId parameter');
  }

  try {
    var node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error('Node not found with ID: ' + nodeId);
    }

    if (!('fillStyleId' in node)) {
      throw new Error('Node with ID ' + nodeId + ' does not support fill styles');
    }

    var style = await findPaintStyle(styleId);

    var fillNode = node as GeometryMixin;
    await fillNode.setFillStyleIdAsync(style.id);

    return {
      id: node.id,
      name: node.name,
      fillStyleId: fillNode.fillStyleId,
    };
  } catch (error) {
    throw new Error('Error setting color style: ' + (error as Error).message);
  }
}
