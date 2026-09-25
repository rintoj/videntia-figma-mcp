// Figma MCP plugin.

import { debugLog } from "../utils/helpers";
import { customBase64Decode } from "../utils/base64";
import { resolveColorVariable } from "./icons";
import {
  linearGradientTransform,
  resolveCssAngle,
  sortGradientStops,
} from "../../videntia_figma_mcp/utils/gradient-geometry";

// ---------------------------------------------------------------------------
// Hex color parsing
// ---------------------------------------------------------------------------

/**
 * Parse a hex color string (e.g. "#ff0000", "#f00", "#ff000080") to { r, g, b, a }
 * with values normalized to 0–1. Returns null if the string is not a valid hex color.
 */
export function parseHexColor(hex: string): { r: number; g: number; b: number; a: number } | null {
  if (typeof hex !== "string") return null;
  var h = hex.charAt(0) === "#" ? hex.substring(1) : hex;
  // Expand 3-char or 4-char shorthand
  if (h.length === 3 || h.length === 4) {
    var expanded = "";
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
 * Resolve color from params. Mirrors the MCP-side `toRgba` helper
 * (src/videntia_figma_mcp/utils/color-input.ts) — keep the two in step.
 * Supports:
 *  - hex string: { color: "#ff0000" } / "#f00" / "#ff000080" / "#f008"
 *  - wrapped object: { color: { r, g, b, a } }
 *  - array: { color: [r, g, b] } or [r, g, b, a]
 *  - flat: { r, g, b, a }
 * Channels may be 0–1 OR 0–255: if any of r/g/b is > 1 the triple is read as
 * 0–255, otherwise as already-normalized 0–1 (so { r: 1, g: 1, b: 1 } is
 * white, not near-black rgb(1,1,1)).
 * Returns { r, g, b, a } with values 0–1, or throws — never NaN.
 */
export function resolveColor(params: Record<string, unknown>): { r: number; g: number; b: number; a: number } {
  var colorParam = params["color"];

  // Hex string
  if (typeof colorParam === "string") {
    var parsed = parseHexColor(colorParam);
    if (!parsed) {
      throw new Error("Invalid hex color: " + colorParam);
    }
    return parsed;
  }

  var r: unknown;
  var g: unknown;
  var b: unknown;
  var a: unknown;

  if (Object.prototype.toString.call(colorParam) === "[object Array]") {
    var arr = colorParam as unknown[];
    if (arr.length < 3 || arr.length > 4) {
      throw new Error("Color array must have 3 or 4 entries: [r, g, b] or [r, g, b, a].");
    }
    r = arr[0];
    g = arr[1];
    b = arr[2];
    a = arr.length === 4 ? arr[3] : undefined;
  } else {
    // Wrapped object { color: { r, g, b, a } } or flat { r, g, b, a }
    var source: Record<string, unknown> =
      colorParam !== null && colorParam !== undefined && typeof colorParam === "object"
        ? (colorParam as Record<string, unknown>)
        : params;
    r = source["r"];
    g = source["g"];
    b = source["b"];
    a = source["a"];
  }

  if (r === undefined || g === undefined || b === undefined) {
    throw new Error(
      'Color must be a hex string (e.g. "#ff0000"), an { r, g, b, a } object (channels 0–1 or 0–255), or an [r, g, b(, a)] array.',
    );
  }

  var rn = parseFloat(r as string);
  var gn = parseFloat(g as string);
  var bn = parseFloat(b as string);
  var an = a !== undefined && a !== null ? parseFloat(a as string) : 1;

  if (isNaN(rn) || isNaN(gn) || isNaN(bn) || isNaN(an)) {
    throw new Error("Invalid color values - all components must be valid numbers");
  }

  // Disambiguate 0–255 from 0–1: any channel above 1 means the caller used 0–255.
  var div = rn > 1 || gn > 1 || bn > 1 ? 255 : 1;
  if (an > 1) an = an / 255;

  var clamp = function (n: number): number {
    return Math.max(0, Math.min(1, n));
  };

  return {
    r: clamp(rn / div),
    g: clamp(gn / div),
    b: clamp(bn / div),
    a: clamp(an),
  };
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
  debugLog("setFillColor", params);

  var paramsObj = params !== null && params !== undefined ? params : {};
  var nodeId = paramsObj["nodeId"] as string | undefined;

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  var rgbColor = resolveColor(paramsObj);

  var node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error("Node not found with ID: " + nodeId);
  }

  if (!("fills" in node)) {
    throw new Error("Node does not support fills: " + nodeId);
  }

  // Set fill - pure translation to Figma API format
  var paintStyle: SolidPaint = {
    type: "SOLID",
    color: {
      r: rgbColor.r,
      g: rgbColor.g,
      b: rgbColor.b,
    },
    opacity: rgbColor.a,
  };

  debugLog("paintStyle", paintStyle);

  (node as GeometryMixin).fills = [paintStyle];

  return {
    id: node.id,
    name: node.name,
    fills: [paintStyle],
  };
}

// ---------------------------------------------------------------------------
// removeFill
// ---------------------------------------------------------------------------

/**
 * Remove all fills from a Figma node (sets fills to an empty array).
 */
export async function removeFill(params: Record<string, unknown>): Promise<unknown> {
  var paramsObj = params !== null && params !== undefined ? params : {};
  var nodeId = paramsObj["nodeId"] as string | undefined;

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  var node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error("Node not found with ID: " + nodeId);
  }

  if (!("fills" in node)) {
    throw new Error("Node does not support fills: " + nodeId);
  }

  (node as GeometryMixin).fills = [];

  return {
    id: node.id,
    name: node.name,
    fills: [],
  };
}

// ---------------------------------------------------------------------------
// removeStroke
// ---------------------------------------------------------------------------

/**
 * Remove all strokes from a Figma node (sets strokes to an empty array).
 */
export async function removeStroke(params: Record<string, unknown>): Promise<unknown> {
  var paramsObj = params !== null && params !== undefined ? params : {};
  var nodeId = paramsObj["nodeId"] as string | undefined;

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  var node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error("Node not found with ID: " + nodeId);
  }

  if (!("strokes" in node)) {
    throw new Error("Node does not support strokes: " + nodeId);
  }

  (node as GeometryMixin).strokes = [];

  return {
    id: node.id,
    name: node.name,
    strokes: [],
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
  var nodeId = paramsObj["nodeId"] as string | undefined;
  var strokeWeight = paramsObj["strokeWeight"];
  var dashPattern = paramsObj["dashPattern"] as number[] | undefined;

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  var rgbColor = resolveColor(paramsObj);

  var node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error("Node not found with ID: " + nodeId);
  }

  if (!("strokes" in node)) {
    throw new Error("Node does not support strokes: " + nodeId);
  }

  // When `strokeWeight` is omitted the caller asked only about colour — keep
  // whatever weight the node already has. Defaulting to 1 here silently
  // destroyed hairline/thick strokes the caller never mentioned.
  var existingWeight =
    "strokeWeight" in node ? (node as unknown as { strokeWeight: number | symbol }).strokeWeight : undefined;
  // `strokeWeight` reads back as figma.mixed when per-side weights differ.
  var hasMixedWeight = existingWeight === figma.mixed;
  var strokeWeightParsed: number | undefined;
  if (strokeWeight !== undefined && strokeWeight !== null) {
    strokeWeightParsed = parseFloat(strokeWeight as string);
    if (isNaN(strokeWeightParsed)) {
      throw new Error("Invalid stroke weight - must be a valid number");
    }
  } else if (typeof existingWeight === "number") {
    strokeWeightParsed = existingWeight;
  }

  var paintStyle: SolidPaint = {
    type: "SOLID",
    color: {
      r: rgbColor.r,
      g: rgbColor.g,
      b: rgbColor.b,
    },
    opacity: rgbColor.a,
  };

  (node as GeometryMixin).strokes = [paintStyle];

  // Set stroke weight if the node supports it. When individual side weights are
  // enabled, writing the uniform `strokeWeight` alone is silently ignored by the
  // Figma API — the per-side weights still win. Disable that mode first so the
  // requested uniform weight actually takes effect.
  //
  // Only do this when a weight was explicitly requested: forcing the uniform
  // mode on a node with deliberate per-side weights would itself be a
  // destructive change the caller did not ask for.
  if ("strokeWeight" in node && strokeWeightParsed !== undefined) {
    if (strokeWeight !== undefined && strokeWeight !== null) {
      if ("individualStrokeWeightsEnabled" in node) {
        (node as unknown as { individualStrokeWeightsEnabled: boolean }).individualStrokeWeightsEnabled = false;
      }
      (node as unknown as { strokeWeight: number }).strokeWeight = strokeWeightParsed;
    } else if (!hasMixedWeight) {
      // Re-assert the pre-existing uniform weight (a no-op, but keeps the
      // reported value honest if Figma reset it while replacing strokes).
      (node as unknown as { strokeWeight: number }).strokeWeight = strokeWeightParsed;
    }
  }

  // Set dash pattern if provided, e.g. [4, 4] for an even dash/gap, [] to clear
  if (dashPattern !== undefined && "dashPattern" in node) {
    if (!Array.isArray(dashPattern) || dashPattern.some((n) => typeof n !== "number" || isNaN(n) || n < 0)) {
      throw new Error("Invalid dashPattern - must be an array of non-negative numbers, e.g. [4, 4]");
    }
    (node as unknown as { dashPattern: number[] }).dashPattern = dashPattern;
  }

  return {
    id: node.id,
    name: node.name,
    strokes: (node as GeometryMixin).strokes,
    strokeWeight: "strokeWeight" in node ? (node as unknown as { strokeWeight: number }).strokeWeight : undefined,
    dashPattern: "dashPattern" in node ? (node as unknown as { dashPattern: number[] }).dashPattern : undefined,
  };
}

// ---------------------------------------------------------------------------
// setImageFill
// ---------------------------------------------------------------------------

// Sanity cap on decoded imageBytes size — Figma itself caps image dimensions at
// 4096x4096, but a much larger base64 payload would either blow past the relay's
// message size or take unreasonably long to decode. This just fails fast with a
// clear message instead of an opaque relay/decode error.
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Apply an image fill to a Figma node, either by fetching it from a URL or by
 * decoding raw image bytes (base64) sent directly by the MCP client.
 * Supports FILL, FIT, CROP, and TILE scale modes, plus optional image filters.
 */
export async function setImageFill(params: Record<string, unknown>): Promise<unknown> {
  const paramsObj = params !== null && params !== undefined ? params : {};

  const nodeId = paramsObj["nodeId"] as string | undefined;
  const imageUrl = paramsObj["imageUrl"] as string | undefined;
  const imageBytes = paramsObj["imageBytes"] as string | undefined;
  const scaleMode = paramsObj["scaleMode"] !== undefined ? (paramsObj["scaleMode"] as string) : "FILL";
  const rotation = paramsObj["rotation"] as number | undefined;
  const scalingFactor = paramsObj["scalingFactor"] !== undefined ? Number(paramsObj["scalingFactor"]) : undefined;
  const exposure = paramsObj["exposure"] as number | undefined;
  const contrast = paramsObj["contrast"] as number | undefined;
  const saturation = paramsObj["saturation"] as number | undefined;
  const temperature = paramsObj["temperature"] as number | undefined;
  const tint = paramsObj["tint"] as number | undefined;
  const highlights = paramsObj["highlights"] as number | undefined;
  const shadows = paramsObj["shadows"] as number | undefined;

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (!imageUrl && !imageBytes) {
    throw new Error("Provide either imageUrl or imageBytes");
  }
  if (imageUrl && imageBytes) {
    throw new Error("Provide only one of imageUrl or imageBytes, not both");
  }

  if (imageUrl) {
    // Only allow http/https URLs — reject file://, data:, and internal network addresses.
    if (!/^https?:\/\//i.test(imageUrl)) {
      throw new Error("imageUrl must use http:// or https:// scheme");
    }
    // Block loopback, private IPv4 ranges (RFC-1918), and link-local addresses.
    const hostMatch = imageUrl.match(/^https?:\/\/([^/:?#]+)/i);
    if (hostMatch) {
      const host = hostMatch[1].toLowerCase();
      if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
        throw new Error("imageUrl must not reference a loopback address");
      }
      if (host.endsWith(".local")) {
        throw new Error("imageUrl must not reference a .local domain");
      }
      const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
      if (ipv4) {
        const a = parseInt(ipv4[1], 10);
        const b = parseInt(ipv4[2], 10);
        if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) {
          throw new Error("imageUrl must not reference a private network address");
        }
      }
    }
  }

  const validScaleModes = ["FILL", "FIT", "CROP", "TILE"];
  if (!validScaleModes.includes(scaleMode)) {
    throw new Error(`Invalid scaleMode: ${scaleMode}. Must be one of: ${validScaleModes.join(", ")}`);
  }
  if (scalingFactor !== undefined) {
    if (!isFinite(scalingFactor) || scalingFactor <= 0) {
      throw new Error(`scalingFactor must be a positive number, got ${paramsObj["scalingFactor"]}`);
    }
    if (scaleMode !== "TILE") {
      throw new Error(`scalingFactor only applies to scaleMode TILE (got ${scaleMode}).`);
    }
  }

  debugLog(`setImageFill: Starting with nodeId=${nodeId}, source=${imageUrl ? "url" : "bytes"} (redacted)`);

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("fills" in node)) {
    throw new Error(`Node does not support fills: ${nodeId}`);
  }

  debugLog(`setImageFill: Found node "${node.name}", loading image...`);

  let image: Image;
  if (imageBytes) {
    let bytes: Uint8Array;
    try {
      bytes = customBase64Decode(imageBytes);
    } catch (decodeError) {
      const errorMsg = decodeError instanceof Error ? decodeError.message : String(decodeError);
      throw new Error(`Failed to decode imageBytes: ${errorMsg}`);
    }
    if (bytes.byteLength === 0) {
      throw new Error("imageBytes decoded to an empty image");
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(
        `imageBytes is ${Math.round(bytes.byteLength / 1024 / 1024)}MB, exceeding the ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit`,
      );
    }
    try {
      image = figma.createImage(bytes);
    } catch (createError) {
      const errorMsg = createError instanceof Error ? createError.message : String(createError);
      throw new Error(
        `Failed to create image from imageBytes. This may be due to an unsupported or corrupt image format, or dimensions exceeding 4096x4096. Error: ${errorMsg}`,
      );
    }
  } else {
    // Create image from URL - this can fail due to CORS, invalid URL, or unsupported format
    try {
      image = await figma.createImageAsync(imageUrl as string);
    } catch (fetchError) {
      const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error(`setImageFill: Failed to fetch image: ${errorMsg}`);
      throw new Error(
        `Failed to fetch image. This may be due to CORS restrictions, an invalid URL, or an unsupported image format. Error: ${errorMsg}`,
      );
    }
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
  const hasFilters =
    exposure !== undefined ||
    contrast !== undefined ||
    saturation !== undefined ||
    temperature !== undefined ||
    tint !== undefined ||
    highlights !== undefined ||
    shadows !== undefined;
  const imageFilters: ImageFilters | undefined = hasFilters
    ? {
        ...(exposure !== undefined ? { exposure } : {}),
        ...(contrast !== undefined ? { contrast } : {}),
        ...(saturation !== undefined ? { saturation } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(tint !== undefined ? { tint } : {}),
        ...(highlights !== undefined ? { highlights } : {}),
        ...(shadows !== undefined ? { shadows } : {}),
      }
    : undefined;

  // Build the image paint object using the typed ImagePaint interface
  const imagePaint: ImagePaint = {
    type: "IMAGE",
    imageHash: image.hash,
    scaleMode: scaleMode as ImagePaint["scaleMode"],
    // rotation is only valid for TILE, FILL, FIT scale modes
    ...(rotation !== undefined && ["TILE", "FILL", "FIT"].includes(scaleMode) ? { rotation } : {}),
    ...(scalingFactor !== undefined ? { scalingFactor } : {}),
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

  debugLog("setImageFill: Successfully applied image fill");

  return {
    id: node.id,
    name: node.name,
    imageHash: image.hash,
    imageSize: { width, height },
    scaleMode: scaleMode,
    ...(scalingFactor !== undefined ? { scalingFactor } : {}),
    fills: [imagePaint],
  };
}

// ---------------------------------------------------------------------------
// computeGradientTransform
// ---------------------------------------------------------------------------

/**
 * Build the 2x3 `gradientTransform` for a LINEAR gradient.
 *
 * CONVENTION: CSS `linear-gradient` angles — 0 = to top, 90 = to right,
 * 180 = to bottom, 270 = to left, clockwise. The geometry lives in
 * `utils/gradient-geometry.ts` (shared with paint styles and the JSX round-trip).
 *
 * With `aspectCorrect` (default) the gradient line is projected in PIXEL space, so the
 * visual angle is the requested one and the 0..1 stop range spans the node's real
 * extent for any aspect ratio. `aspectCorrect: false` measures the angle in the node's
 * normalised unit square instead (the angle then stretches with the node), still
 * centred and still spanning 0..1 corner-to-corner.
 */
export function computeGradientTransform(
  angle: number,
  width: number,
  height: number,
  aspectCorrect: boolean = true,
): Transform {
  return (aspectCorrect ? linearGradientTransform(angle, width, height) : linearGradientTransform(angle)) as Transform;
}

/**
 * A gradient stop bound to a variable still needs a literal `color` (Figma renders
 * the literal until the alias resolves). Take the variable's first concrete COLOR
 * mode value; fall back to opaque black if it only aliases another variable.
 */
function resolveVariableColor(variable: Variable): { r: number; g: number; b: number; a: number } {
  const modes = Object.keys(variable.valuesByMode || {});
  for (let i = 0; i < modes.length; i++) {
    const value = variable.valuesByMode[modes[i]] as unknown;
    if (value !== null && typeof value === "object" && typeof (value as { r?: unknown }).r === "number") {
      const c = value as { r: number; g: number; b: number; a?: number };
      return { r: c.r, g: c.g, b: c.b, a: typeof c.a === "number" ? c.a : 1 };
    }
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

// ---------------------------------------------------------------------------
// setGradientFill
// ---------------------------------------------------------------------------

/**
 * Apply a gradient fill (LINEAR, RADIAL, ANGULAR, or DIAMOND) to a Figma node.
 */
export async function setGradientFill(params: Record<string, unknown>): Promise<unknown> {
  const paramsObj = params !== null && params !== undefined ? params : {};

  const nodeId = paramsObj["nodeId"] as string | undefined;
  const gradientType = paramsObj["gradientType"] as string | undefined;
  const stops = paramsObj["stops"] as Array<Record<string, unknown>> | undefined;
  const opacity = paramsObj["opacity"] !== undefined ? (paramsObj["opacity"] as number) : 1;

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (!gradientType) {
    throw new Error("Missing gradientType parameter");
  }

  const validTypes = ["LINEAR", "RADIAL", "ANGULAR", "DIAMOND"];
  if (!validTypes.includes(gradientType)) {
    throw new Error(`Invalid gradientType: ${gradientType}. Must be one of: ${validTypes.join(", ")}`);
  }

  if (!stops || !Array.isArray(stops) || stops.length < 2) {
    throw new Error("stops must be an array with at least 2 stops");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("fills" in node)) {
    throw new Error(`Node does not support fills: ${nodeId}`);
  }

  // Stops must accept exactly what every other colour tool accepts. Standalone,
  // zod coerces the caller into {r,g,b,a}; inside batch_actions params are
  // forwarded RAW, so a hex stop ("#fff" — the form set_fill_color takes) landed
  // here as `undefined` channels and produced NaN colours. Parse here instead,
  // and throw a precise error rather than writing a garbage paint.
  // Gradient stop → variable binding (#30).
  //
  // VERIFIED against @figma/plugin-typings 1.136.0: `ColorStop` DOES carry
  // `boundVariables?: { [field in VariableBindableColorStopField]?: VariableAlias }`
  // (plugin-api.d.ts:4506) with `VariableBindableColorStopField = 'color'`
  // (:6742). What is NOT supported is the `figma.variables.setBoundVariableForPaint`
  // HELPER, which is typed `(paint: SolidPaint, …): SolidPaint` (:2186) with no
  // GradientPaint overload — that helper is the limit, not the data model. So a stop
  // is bound by constructing the ColorStop with `boundVariables.color` directly.
  const variableCache = await figma.variables.getLocalVariablesAsync();

  const figmaStops: ColorStop[] = [];
  for (let index = 0; index < stops.length; index++) {
    const stop = stops[index];
    const raw = stop !== null && stop !== undefined ? stop : {};

    // Accept every spelling the other colour tools accept for a token reference.
    const variableRef =
      raw["colorVariable"] !== undefined
        ? raw["colorVariable"]
        : raw["variable"] !== undefined
          ? raw["variable"]
          : raw["variableName"] !== undefined
            ? raw["variableName"]
            : raw["variableId"];

    let boundVariable: Variable | null = null;
    if (variableRef !== undefined && variableRef !== null && variableRef !== "") {
      const refName = String(variableRef);
      boundVariable = await resolveColorVariable(refName, variableCache);
      if (!boundVariable) {
        // Never silently drop the token — an unresolvable name would otherwise
        // produce a raw-value gradient that lints as a violation forever.
        throw new Error(
          `stops[${index}]: no COLOR variable matches "${refName}". Create it first (create_variable), or pass a literal hex colour.`,
        );
      }
    }

    const source =
      raw["color"] !== undefined ? raw["color"] : boundVariable ? resolveVariableColor(boundVariable) : raw;
    let rgba: { r: number; g: number; b: number; a: number } | null = null;

    if (typeof source === "string") {
      rgba = parseHexColor(source);
      if (!rgba) {
        throw new Error(`stops[${index}].color: "${source}" is not a valid hex colour (e.g. "#ff0000" or "#f00").`);
      }
    } else if (source !== null && typeof source === "object") {
      const c = source as Record<string, unknown>;
      const r = Number(c["r"]);
      const g = Number(c["g"]);
      const b = Number(c["b"]);
      if (!isFinite(r) || !isFinite(g) || !isFinite(b)) {
        throw new Error(
          `stops[${index}].color must be a hex string or {r,g,b,a} with 0-1 channels, got ${JSON.stringify(source)}.`,
        );
      }
      const a = c["a"] !== undefined && c["a"] !== null ? Number(c["a"]) : 1;
      // 0-255 channels are a common mistake and silently render as pure white.
      const scale = r > 1 || g > 1 || b > 1 ? 255 : 1;
      rgba = { r: r / scale, g: g / scale, b: b / scale, a: isFinite(a) ? a : 1 };
    } else {
      throw new Error(`stops[${index}] must be an object with a color, got ${JSON.stringify(stop)}.`);
    }

    const position = Number(raw["position"]);
    if (!isFinite(position)) {
      throw new Error(`stops[${index}].position must be a number 0-1, got ${JSON.stringify(raw["position"])}.`);
    }

    const colorStop: ColorStop = {
      color: { r: rgba.r, g: rgba.g, b: rgba.b, a: rgba.a },
      position,
    };
    figmaStops.push(
      boundVariable
        ? ({
            ...colorStop,
            boundVariables: { color: { type: "VARIABLE_ALIAS", id: boundVariable.id } },
          } as ColorStop)
        : colorStop,
    );
  }

  const aspectCorrect = paramsObj["aspect_correct"] !== false;
  const nodeWidth = Number((node as unknown as { width?: number }).width);
  const nodeHeight = Number((node as unknown as { height?: number }).height);

  const angle =
    gradientType === "LINEAR"
      ? resolveCssAngle(
          { angle: paramsObj["angle"], direction: paramsObj["direction"] },
          aspectCorrect ? nodeWidth : undefined,
          aspectCorrect ? nodeHeight : undefined,
        )
      : 0;

  const gradientTransform =
    gradientType === "LINEAR"
      ? computeGradientTransform(
          angle,
          aspectCorrect && isFinite(nodeWidth) && nodeWidth > 0 ? nodeWidth : 1,
          aspectCorrect && isFinite(nodeHeight) && nodeHeight > 0 ? nodeHeight : 1,
          aspectCorrect,
        )
      : ([
          [1, 0, 0],
          [0, 1, 0],
        ] as Transform);

  const sortedStops = sortGradientStops(figmaStops);

  const gradientPaint: GradientPaint = {
    type: `GRADIENT_${gradientType}` as GradientPaint["type"],
    gradientStops: sortedStops,
    gradientTransform,
    opacity,
  };

  (node as GeometryMixin).fills = [gradientPaint];

  return {
    id: node.id,
    name: node.name,
    gradientType,
    stopsCount: figmaStops.length,
    boundStopsCount: figmaStops.filter(function (st) {
      return (st as { boundVariables?: unknown }).boundVariables !== undefined;
    }).length,
    aspectCorrect: gradientType === "LINEAR" ? aspectCorrect : false,
    ...(gradientType === "LINEAR" ? { angle } : {}),
    gradientTransform,
  };
}
