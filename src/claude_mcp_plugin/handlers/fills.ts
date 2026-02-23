// Fill and stroke handler functions for the Claude Figma MCP plugin.

import { debugLog } from '../utils/helpers';

// ---------------------------------------------------------------------------
// setFillColor
// ---------------------------------------------------------------------------

/**
 * Set the solid fill colour of a Figma node.
 * Supports both wrapped `{ color: { r, g, b, a } }` and flat `{ r, g, b, a }`
 * colour formats.
 */
export async function setFillColor(params: Record<string, unknown>): Promise<unknown> {
  debugLog('setFillColor', params);

  const paramsObj = params !== null && params !== undefined ? params : {};
  const nodeId = paramsObj['nodeId'] as string | undefined;
  const colorObj = paramsObj['color'] as Record<string, unknown> | undefined;

  // Support both wrapped { color: { r, g, b, a } } and flat { r, g, b, a } formats
  const source: Record<string, unknown> =
    colorObj !== null && colorObj !== undefined
      ? colorObj
      : paramsObj;

  const r = source['r'];
  const g = source['g'];
  const b = source['b'];
  const a = source['a'];

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!('fills' in node)) {
    throw new Error(`Node does not support fills: ${nodeId}`);
  }

  // Validate that MCP layer provided complete data
  if (r === undefined || g === undefined || b === undefined || a === undefined) {
    throw new Error(
      'Incomplete color data received from MCP layer. All RGBA components must be provided.',
    );
  }

  // Parse values - no defaults, just format conversion
  const rgbColor = {
    r: parseFloat(r as string),
    g: parseFloat(g as string),
    b: parseFloat(b as string),
    a: parseFloat(a as string),
  };

  // Validate parsing succeeded
  if (
    isNaN(rgbColor.r) ||
    isNaN(rgbColor.g) ||
    isNaN(rgbColor.b) ||
    isNaN(rgbColor.a)
  ) {
    throw new Error(
      'Invalid color values received - all components must be valid numbers',
    );
  }

  // Set fill - pure translation to Figma API format
  const paintStyle: SolidPaint = {
    type: 'SOLID',
    color: {
      r: rgbColor.r,
      g: rgbColor.g,
      b: rgbColor.b,
    },
    opacity: rgbColor.a,
  };

  debugLog('paintStyle', paintStyle);

  (node as GeometryMixin).fills = [paintStyle];

  return {
    id: node.id,
    name: node.name,
    fills: [paintStyle],
  };
}

// ---------------------------------------------------------------------------
// setStrokeColor
// ---------------------------------------------------------------------------

/**
 * Set the solid stroke colour and weight of a Figma node.
 * Supports both wrapped `{ color: { r, g, b, a } }` and flat `{ r, g, b, a }`
 * colour formats.
 */
export async function setStrokeColor(params: Record<string, unknown>): Promise<unknown> {
  const paramsObj = params !== null && params !== undefined ? params : {};
  const nodeId = paramsObj['nodeId'] as string | undefined;
  const colorObj = paramsObj['color'] as Record<string, unknown> | undefined;
  const strokeWeight = paramsObj['strokeWeight'];

  // Support both wrapped { color: { r, g, b, a } } and flat { r, g, b, a } formats
  const source: Record<string, unknown> =
    colorObj !== null && colorObj !== undefined
      ? colorObj
      : paramsObj;

  const r = source['r'];
  const g = source['g'];
  const b = source['b'];
  const a = source['a'];

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!('strokes' in node)) {
    throw new Error(`Node does not support strokes: ${nodeId}`);
  }

  if (r === undefined || g === undefined || b === undefined || a === undefined) {
    throw new Error(
      'Incomplete color data received from MCP layer. All RGBA components must be provided.',
    );
  }

  if (strokeWeight === undefined) {
    throw new Error('Stroke weight must be provided by MCP layer.');
  }

  const rgbColor = {
    r: parseFloat(r as string),
    g: parseFloat(g as string),
    b: parseFloat(b as string),
    a: parseFloat(a as string),
  };
  const strokeWeightParsed = parseFloat(strokeWeight as string);

  if (
    isNaN(rgbColor.r) ||
    isNaN(rgbColor.g) ||
    isNaN(rgbColor.b) ||
    isNaN(rgbColor.a)
  ) {
    throw new Error(
      'Invalid color values received - all components must be valid numbers',
    );
  }

  if (isNaN(strokeWeightParsed)) {
    throw new Error('Invalid stroke weight - must be a valid number');
  }

  const paintStyle: SolidPaint = {
    type: 'SOLID',
    color: {
      r: rgbColor.r,
      g: rgbColor.g,
      b: rgbColor.b,
    },
    opacity: rgbColor.a,
  };

  (node as GeometryMixin).strokes = [paintStyle];

  // Set stroke weight if the node supports it
  if ('strokeWeight' in node) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node as any).strokeWeight = strokeWeightParsed;
  }

  return {
    id: node.id,
    name: node.name,
    strokes: (node as GeometryMixin).strokes,
    strokeWeight: 'strokeWeight' in node ? (node as unknown as { strokeWeight: number }).strokeWeight : undefined,
  };
}

// ---------------------------------------------------------------------------
// setImageFill
// ---------------------------------------------------------------------------

/**
 * Apply an image fill to a Figma node by fetching the image from a URL.
 * Supports FILL, FIT, CROP, and TILE scale modes, plus optional image filters.
 */
export async function setImageFill(params: Record<string, unknown>): Promise<unknown> {
  const paramsObj = params !== null && params !== undefined ? params : {};

  const nodeId = paramsObj['nodeId'] as string | undefined;
  const imageUrl = paramsObj['imageUrl'] as string | undefined;
  const scaleMode =
    paramsObj['scaleMode'] !== undefined ? (paramsObj['scaleMode'] as string) : 'FILL';
  const rotation = paramsObj['rotation'] as number | undefined;
  const exposure = paramsObj['exposure'] as number | undefined;
  const contrast = paramsObj['contrast'] as number | undefined;
  const saturation = paramsObj['saturation'] as number | undefined;
  const temperature = paramsObj['temperature'] as number | undefined;
  const tint = paramsObj['tint'] as number | undefined;
  const highlights = paramsObj['highlights'] as number | undefined;
  const shadows = paramsObj['shadows'] as number | undefined;

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  if (!imageUrl) {
    throw new Error('Missing imageUrl parameter');
  }

  const validScaleModes = ['FILL', 'FIT', 'CROP', 'TILE'];
  if (!validScaleModes.includes(scaleMode)) {
    throw new Error(
      `Invalid scaleMode: ${scaleMode}. Must be one of: ${validScaleModes.join(', ')}`,
    );
  }

  debugLog(`setImageFill: Starting with nodeId=${nodeId}, imageUrl=${imageUrl}`);

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!('fills' in node)) {
    throw new Error(`Node does not support fills: ${nodeId}`);
  }

  debugLog(`setImageFill: Found node "${node.name}", fetching image...`);

  // Create image from URL - this can fail due to CORS, invalid URL, or unsupported format
  let image: Image;
  try {
    image = await figma.createImageAsync(imageUrl);
  } catch (fetchError) {
    const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    console.error(`setImageFill: Failed to fetch image: ${errorMsg}`);
    throw new Error(
      `Failed to fetch image from URL. This may be due to CORS restrictions, invalid URL, or unsupported image format. URL: ${imageUrl}. Error: ${errorMsg}`,
    );
  }

  debugLog(`setImageFill: Image fetched, hash=${image.hash}`);

  let width: number;
  let height: number;
  try {
    const size = await image.getSizeAsync();
    width = size.width;
    height = size.height;
  } catch (sizeError) {
    console.error(`setImageFill: Failed to get image size: ${sizeError}`);
    // Continue without size info
    width = 0;
    height = 0;
  }

  debugLog(`setImageFill: Image size ${width}x${height}`);

  // Build image filters if any were provided (values range from -1.0 to 1.0, default 0)
  const hasFilters = exposure !== undefined || contrast !== undefined ||
    saturation !== undefined || temperature !== undefined ||
    tint !== undefined || highlights !== undefined || shadows !== undefined;
  const imageFilters: ImageFilters | undefined = hasFilters ? {
    ...(exposure !== undefined ? { exposure } : {}),
    ...(contrast !== undefined ? { contrast } : {}),
    ...(saturation !== undefined ? { saturation } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(tint !== undefined ? { tint } : {}),
    ...(highlights !== undefined ? { highlights } : {}),
    ...(shadows !== undefined ? { shadows } : {}),
  } : undefined;

  // Build the image paint object using the typed ImagePaint interface
  const imagePaint: ImagePaint = {
    type: 'IMAGE',
    imageHash: image.hash,
    scaleMode: scaleMode as ImagePaint['scaleMode'],
    // rotation is only valid for TILE, FILL, FIT scale modes
    ...(rotation !== undefined && ['TILE', 'FILL', 'FIT'].includes(scaleMode) ? { rotation } : {}),
    ...(imageFilters !== undefined ? { filters: imageFilters } : {}),
  };

  // Apply the image fill
  try {
    (node as GeometryMixin).fills = [imagePaint];
  } catch (fillError) {
    const errorMsg = fillError instanceof Error ? fillError.message : String(fillError);
    console.error(`setImageFill: Failed to apply fill: ${errorMsg}`);
    throw new Error(`Failed to apply image fill to node: ${errorMsg}`);
  }

  debugLog('setImageFill: Successfully applied image fill');

  return {
    id: node.id,
    name: node.name,
    imageHash: image.hash,
    imageSize: { width, height },
    scaleMode: scaleMode,
    fills: [imagePaint],
  };
}

// ---------------------------------------------------------------------------
// setGradientFill
// ---------------------------------------------------------------------------

/**
 * Apply a gradient fill (LINEAR, RADIAL, ANGULAR, or DIAMOND) to a Figma node.
 */
export async function setGradientFill(params: Record<string, unknown>): Promise<unknown> {
  const paramsObj = params !== null && params !== undefined ? params : {};

  const nodeId = paramsObj['nodeId'] as string | undefined;
  const gradientType = paramsObj['gradientType'] as string | undefined;
  const gradientStops = paramsObj['gradientStops'] as Array<Record<string, unknown>> | undefined;
  const angle = paramsObj['angle'] !== undefined ? (paramsObj['angle'] as number) : 0;
  const opacity = paramsObj['opacity'] !== undefined ? (paramsObj['opacity'] as number) : 1;

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  if (!gradientType) {
    throw new Error('Missing gradientType parameter');
  }

  const validTypes = ['LINEAR', 'RADIAL', 'ANGULAR', 'DIAMOND'];
  if (!validTypes.includes(gradientType)) {
    throw new Error(
      `Invalid gradientType: ${gradientType}. Must be one of: ${validTypes.join(', ')}`,
    );
  }

  if (
    !gradientStops ||
    !Array.isArray(gradientStops) ||
    gradientStops.length < 2
  ) {
    throw new Error('gradientStops must be an array with at least 2 stops');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!('fills' in node)) {
    throw new Error(`Node does not support fills: ${nodeId}`);
  }

  const figmaStops: ColorStop[] = gradientStops.map(stop => {
    const stopColor = stop['color'] as Record<string, unknown>;
    return {
      color: {
        r: stopColor['r'] as number,
        g: stopColor['g'] as number,
        b: stopColor['b'] as number,
        a: stopColor['a'] !== undefined ? (stopColor['a'] as number) : 1,
      },
      position: stop['position'] as number,
    };
  });

  // Figma gradients use a 2x3 affine transform matrix in normalised [0,1] space.
  // For LINEAR: rotate around centre (0.5, 0.5) by the specified angle.
  // For RADIAL/ANGULAR/DIAMOND: identity matrix (centred, no rotation).
  const angleRad = (angle * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const cx = 0.5;
  const cy = 0.5;
  const startX = cx - cos * 0.5;
  const startY = cy - sin * 0.5;

  let gradientTransform: Transform;
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

  const gradientPaint: GradientPaint = {
    type: `GRADIENT_${gradientType}` as GradientPaint['type'],
    gradientStops: figmaStops,
    gradientTransform,
    opacity,
  };

  (node as GeometryMixin).fills = [gradientPaint];

  return {
    id: node.id,
    name: node.name,
    gradientType,
    stopsCount: figmaStops.length,
  };
}
