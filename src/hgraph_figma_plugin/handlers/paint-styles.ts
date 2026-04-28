// Paint/color style handler functions for the Claude Figma MCP plugin.

import { resolveColor, parseHexColor } from './fills';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a gradient paint from params.gradient object.
 */
function buildGradientPaint(gradient: Record<string, unknown>): GradientPaint {
  var gradientType = gradient['type'] as string;
  var stops = gradient['stops'] as Array<Record<string, unknown>>;
  var angle = gradient['angle'] !== undefined ? (gradient['angle'] as number) : 0;
  var opacity = gradient['opacity'] !== undefined ? (gradient['opacity'] as number) : 1;

  var validTypes = ['LINEAR', 'RADIAL', 'ANGULAR', 'DIAMOND'];
  if (!gradientType || !validTypes.includes(gradientType)) {
    throw new Error('gradient.type must be one of: ' + validTypes.join(', '));
  }

  if (!stops || !Array.isArray(stops) || stops.length < 2) {
    throw new Error('gradient.stops must be an array with at least 2 stops');
  }

  var figmaStops: ColorStop[] = stops.map(function(stop) {
    var colorStr = stop['color'] as string;
    var parsed = parseHexColor(colorStr);
    if (!parsed) {
      throw new Error('Invalid hex color in gradient stop: ' + colorStr);
    }
    return {
      color: { r: parsed.r, g: parsed.g, b: parsed.b, a: parsed.a },
      position: stop['position'] as number,
    };
  });

  // Build transform matrix — same logic as setGradientFill in fills.ts
  var angleRad = (angle * Math.PI) / 180;
  var cos = Math.cos(angleRad);
  var sin = Math.sin(angleRad);
  var cx = 0.5;
  var cy = 0.5;
  var startX = cx - cos * 0.5;
  var startY = cy - sin * 0.5;

  var gradientTransform: Transform;
  if (gradientType === 'LINEAR') {
    gradientTransform = [
      [cos, sin, startX],
      [-sin, cos, startY],
    ];
  } else {
    gradientTransform = [
      [1, 0, 0],
      [0, 1, 0],
    ];
  }

  return {
    type: ('GRADIENT_' + gradientType) as GradientPaint['type'],
    gradientStops: figmaStops,
    gradientTransform: gradientTransform,
    opacity: opacity,
  } as GradientPaint;
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
  var gradient: Record<string, unknown> | null = null;
  var paintType = 'UNKNOWN';

  if (firstPaint && firstPaint.type === 'SOLID') {
    paintType = 'SOLID';
    var solid = firstPaint as SolidPaint;
    color = {
      r: solid.color.r,
      g: solid.color.g,
      b: solid.color.b,
      a: solid.opacity !== undefined ? solid.opacity : 1,
    };
  } else if (firstPaint && typeof firstPaint.type === 'string' && firstPaint.type.indexOf('GRADIENT_') === 0) {
    paintType = firstPaint.type;
    var grad = firstPaint as GradientPaint;
    gradient = {
      type: firstPaint.type.replace('GRADIENT_', ''),
      stops: grad.gradientStops,
      opacity: grad.opacity !== undefined ? grad.opacity : 1,
    };
  }

  return {
    id: style.id,
    name: style.name,
    key: style.key,
    description: style.description,
    paintType: paintType,
    color: color,
    gradient: gradient,
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
  var gradientParam = params['gradient'] as Record<string, unknown> | undefined;

  if (!name) {
    throw new Error('Missing required parameter: name');
  }

  if (!params['color'] && !gradientParam) {
    throw new Error('Must provide either color (hex string) or gradient');
  }

  try {
    var paintStyle = figma.createPaintStyle();
    paintStyle.name = name;

    if (gradientParam) {
      paintStyle.paints = [buildGradientPaint(gradientParam)];
    } else {
      var color = resolveColor(params);
      paintStyle.paints = [{
        type: 'SOLID',
        color: { r: color.r, g: color.g, b: color.b },
        opacity: color.a,
      }];
    }

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
  var gradientParam = params['gradient'] as Record<string, unknown> | undefined;

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

    if (gradientParam) {
      style.paints = [buildGradientPaint(gradientParam)];
      updatedProperties.push('gradient');
    } else if (hasColor) {
      var color = resolveColor(params);
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
