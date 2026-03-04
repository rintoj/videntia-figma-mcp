// Fill and stroke handler functions for the Claude Figma MCP plugin.

import { debugLog } from '../utils/helpers';

// ---------------------------------------------------------------------------
// Hex color parsing
// ---------------------------------------------------------------------------

/**
 * Parse a hex color string (e.g. "#ff0000", "#f00", "#ff000080") to { r, g, b, a }
 * with values normalized to 0–1. Returns null if the string is not a valid hex color.
 */
function parseHexColor(hex: string): { r: number; g: number; b: number; a: number } | null {
  if (typeof hex !== 'string') return null;
  var h = hex.charAt(0) === '#' ? hex.substring(1) : hex;
  // Expand 3-char or 4-char shorthand
  if (h.length === 3 || h.length === 4) {
    var expanded = '';
    for (var i = 0; i < h.length; i++) {
      expanded += h.charAt(i) + h.charAt(i);
    }
    h = expanded;
  }
  if (h.length !== 6 && h.length !== 8) return null;
  var rr = parseInt(h.substring(0, 2), 16);
  var gg = parseInt(h.substring(2, 4), 16);
  var bb = parseInt(h.substring(4, 6), 16);
  var aa = h.length === 8 ? parseInt(h.substring(6, 8), 16) : 255;
  if (isNaN(rr) || isNaN(gg) || isNaN(bb) || isNaN(aa)) return null;
  return { r: rr / 255, g: gg / 255, b: bb / 255, a: aa / 255 };
}

/**
 * Resolve color from params. Supports:
 *  - hex string: { color: "#ff0000" } or { color: "#ff000080" }
 *  - wrapped object: { color: { r, g, b, a } }
 *  - flat: { r, g, b, a }
 * Returns { r, g, b, a } with values 0–1, or throws.
 */
function resolveColor(params: Record<string, unknown>): { r: number; g: number; b: number; a: number } {
  var colorParam = params['color'];

  // Hex string
  if (typeof colorParam === 'string') {
    var parsed = parseHexColor(colorParam);
    if (!parsed) {
      throw new Error('Invalid hex color: ' + colorParam);
    }
    return parsed;
  }

  // Wrapped object { color: { r, g, b, a } } or flat { r, g, b, a }
  var source: Record<string, unknown> =
    colorParam !== null && colorParam !== undefined && typeof colorParam === 'object'
      ? colorParam as Record<string, unknown>
      : params;

  var r = source['r'];
  var g = source['g'];
  var b = source['b'];
  var a = source['a'];

  if (r === undefined || g === undefined || b === undefined) {
    throw new Error(
      'Color must be a hex string (e.g. "#ff0000") or provide r, g, b components.',
    );
  }

  var result = {
    r: parseFloat(r as string),
    g: parseFloat(g as string),
    b: parseFloat(b as string),
    a: a !== undefined ? parseFloat(a as string) : 1,
  };

  if (isNaN(result.r) || isNaN(result.g) || isNaN(result.b) || isNaN(result.a)) {
    throw new Error('Invalid color values - all components must be valid numbers');
  }

  return result;
}

// ---------------------------------------------------------------------------
// setFillColor
// ---------------------------------------------------------------------------

/**
 * Set the solid fill colour of a Figma node.
 * Supports hex string (e.g. "#ff0000"), wrapped `{ color: { r, g, b, a } }`,
 * and flat `{ r, g, b, a }` colour formats.
 */
export async function setFillColor(params: Record<string, unknown>): Promise<unknown> {
  debugLog('setFillColor', params);

  var paramsObj = params !== null && params !== undefined ? params : {};
  var nodeId = paramsObj['nodeId'] as string | undefined;

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  var rgbColor = resolveColor(paramsObj);

  var node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error('Node not found with ID: ' + nodeId);
  }

  if (!('fills' in node)) {
    throw new Error('Node does not support fills: ' + nodeId);
  }

  // Set fill - pure translation to Figma API format
  var paintStyle: SolidPaint = {
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
 * Supports hex string (e.g. "#ff0000"), wrapped `{ color: { r, g, b, a } }`,
 * and flat `{ r, g, b, a }` colour formats.
 */
export async function setStrokeColor(params: Record<string, unknown>): Promise<unknown> {
  var paramsObj = params !== null && params !== undefined ? params : {};
  var nodeId = paramsObj['nodeId'] as string | undefined;
  var strokeWeight = paramsObj['strokeWeight'];

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  var rgbColor = resolveColor(paramsObj);

  var node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error('Node not found with ID: ' + nodeId);
  }

  if (!('strokes' in node)) {
    throw new Error('Node does not support strokes: ' + nodeId);
  }

  // Default stroke weight to 1 if not provided
  var strokeWeightParsed = strokeWeight !== undefined ? parseFloat(strokeWeight as string) : 1;

  if (isNaN(strokeWeightParsed)) {
    throw new Error('Invalid stroke weight - must be a valid number');
  }

  var paintStyle: SolidPaint = {
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
    (node as unknown as { strokeWeight: number }).strokeWeight = strokeWeightParsed;
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

  // Only allow http/https URLs — reject file://, data:, and internal network addresses.
  if (!/^https?:\/\//i.test(imageUrl)) {
    throw new Error('imageUrl must use http:// or https:// scheme');
  }
  // Block loopback, private IPv4 ranges (RFC-1918), and link-local addresses.
  const hostMatch = imageUrl.match(/^https?:\/\/([^/:?#]+)/i);
  if (hostMatch) {
    const host = hostMatch[1].toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      throw new Error('imageUrl must not reference a loopback address');
    }
    if (host.endsWith('.local')) {
      throw new Error('imageUrl must not reference a .local domain');
    }
    const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4) {
      const a = parseInt(ipv4[1], 10);
      const b = parseInt(ipv4[2], 10);
      if (
        a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254)
      ) {
        throw new Error('imageUrl must not reference a private network address');
      }
    }
  }

  const validScaleModes = ['FILL', 'FIT', 'CROP', 'TILE'];
  if (!validScaleModes.includes(scaleMode)) {
    throw new Error(
      `Invalid scaleMode: ${scaleMode}. Must be one of: ${validScaleModes.join(', ')}`,
    );
  }

  debugLog(`setImageFill: Starting with nodeId=${nodeId}, imageUrl=<redacted>`);

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
      `Failed to fetch image. This may be due to CORS restrictions, an invalid URL, or an unsupported image format. Error: ${errorMsg}`,
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
  const stops = paramsObj['stops'] as Array<Record<string, unknown>> | undefined;
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
    !stops ||
    !Array.isArray(stops) ||
    stops.length < 2
  ) {
    throw new Error('stops must be an array with at least 2 stops');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!('fills' in node)) {
    throw new Error(`Node does not support fills: ${nodeId}`);
  }

  const figmaStops: ColorStop[] = stops.map(stop => {
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
