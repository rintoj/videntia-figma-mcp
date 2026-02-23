import type { Violation, ViolationSeverity, ViolationCategory, ViolationDetails, ColorVarEntry, FloatVarEntry, LookupMaps } from './types';
import { COLOR_SEMANTIC_KEYWORDS, FLOAT_SEMANTIC_KEYWORDS } from './constants';

// ── Fill / scalar binding helpers ────────────────────────────────────────────

export function isFillBound(node: SceneNode, propKey: string, idx: number): boolean {
  var bv = (node as GeometryMixin & { boundVariables?: Record<string, unknown> }).boundVariables;
  if (bv) {
    var binding = bv[propKey];
    if (binding) {
      if (Array.isArray(binding)) {
        var item = (binding as Array<{ id?: string }>)[idx];
        if (item && item.id) return true;
      } else if ((binding as { id?: string }).id) {
        return true;
      }
    }
  }
  return false;
}

export function isScalarBound(node: SceneNode, propKey: string): boolean {
  var bv = (node as { boundVariables?: Record<string, unknown> }).boundVariables;
  if (bv && bv[propKey]) {
    var binding = bv[propKey];
    if ((binding as { id?: string }).id) return true;
    if (Array.isArray(binding) && binding.length > 0 && (binding as Array<{ id?: string }>)[0] && (binding as Array<{ id?: string }>)[0].id) return true;
  }
  return false;
}

// ── Paint / style presence helpers ───────────────────────────────────────────

export function hasFillPaintStyle(node: SceneNode): boolean {
  try {
    var styleId = (node as unknown as { fillStyleId?: string | typeof figma.mixed }).fillStyleId;
    if (styleId && styleId !== '' && styleId !== figma.mixed) return true;
  } catch (e) {}
  return false;
}

export function hasStrokePaintStyle(node: SceneNode): boolean {
  try {
    var styleId = (node as unknown as { strokeStyleId?: string | typeof figma.mixed }).strokeStyleId;
    if (styleId && styleId !== '' && styleId !== figma.mixed) return true;
  } catch (e) {}
  return false;
}

export function hasTextStyle(node: SceneNode): boolean {
  try {
    var styleId = (node as unknown as { textStyleId?: string | typeof figma.mixed }).textStyleId;
    if (styleId && styleId !== '' && styleId !== figma.mixed) return true;
  } catch (e) {}
  return false;
}

export function hasEffectStyle(node: SceneNode): boolean {
  try {
    var styleId = (node as unknown as { effectStyleId?: string | typeof figma.mixed }).effectStyleId;
    if (styleId && styleId !== '' && styleId !== figma.mixed) return true;
  } catch (e) {}
  return false;
}

// ── Typography variable binding helper ───────────────────────────────────────

export function hasFontVariableBindings(node: SceneNode): boolean {
  var bv = (node as { boundVariables?: Record<string, { id?: string }> }).boundVariables;
  if (!bv) return false;
  var fontProps = ['fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'lineHeight', 'letterSpacing', 'paragraphSpacing'];
  for (var fi = 0; fi < fontProps.length; fi++) {
    var prop = bv[fontProps[fi]];
    if (prop && prop.id) return true;
  }
  return false;
}

// ── Node classification helpers ───────────────────────────────────────────────

export function isIconLike(node: SceneNode): boolean {
  if (node.type === 'VECTOR' || node.type === 'LINE' || node.type === 'BOOLEAN_OPERATION') return true;
  if (node.type === 'INSTANCE' || node.type === 'COMPONENT') {
    try {
      var sized = node as InstanceNode | ComponentNode;
      if (sized.width <= 48 && sized.height <= 48) return true;
    } catch (e) {}
  }
  return false;
}

export function isColorFill(fill: Paint): boolean {
  if (!fill || fill.visible === false) return false;
  if (
    fill.type === 'SOLID' ||
    fill.type === 'GRADIENT_LINEAR' ||
    fill.type === 'GRADIENT_RADIAL' ||
    fill.type === 'GRADIENT_ANGULAR' ||
    fill.type === 'GRADIENT_DIAMOND'
  ) return true;
  return false;
}

// ── Violation accumulator ─────────────────────────────────────────────────────

export function addViolation(
  violations: Violation[],
  violationsCappedRef: { value: boolean },
  maxViolations: number,
  node: SceneNode,
  depth: number,
  severity: ViolationSeverity,
  category: ViolationCategory,
  property: string,
  message: string,
  details?: ViolationDetails,
): void {
  if (violations.length >= maxViolations) {
    violationsCappedRef.value = true;
    return;
  }
  var v: Violation = {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    depth: depth,
    severity: severity,
    category: category,
    property: property,
    message: message,
  };
  if (details !== undefined) v.details = details;
  violations.push(v);
}

// ── Color distance ────────────────────────────────────────────────────────────

export function colorDist(c1: { r: number; g: number; b: number }, c2: { r: number; g: number; b: number }): number {
  var dr = c1.r - c2.r;
  var dg = c1.g - c2.g;
  var db = c1.b - c2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// ── Semantic name matching ────────────────────────────────────────────────────

export function isSemanticMatch(nameLower: string, category: string): boolean {
  var kws = COLOR_SEMANTIC_KEYWORDS[category];
  if (!kws) return false;
  for (var ki = 0; ki < kws.length; ki++) {
    if (nameLower.indexOf(kws[ki]) !== -1) return true;
  }
  return false;
}

// ── Lookup map builder ────────────────────────────────────────────────────────

export async function buildLookupMaps(): Promise<LookupMaps> {
  var preloadResults = await Promise.all([
    figma.variables.getLocalVariablesAsync(),
    figma.getLocalTextStylesAsync(),
    figma.getLocalEffectStylesAsync(),
    figma.getLocalPaintStylesAsync(),
  ]);

  var localVars = preloadResults[0];
  var localTextStyles = preloadResults[1];
  var localEffectStyles = preloadResults[2];
  var localPaintStyles = preloadResults[3];

  var variableMap: Record<string, Variable> = {};
  for (var vi = 0; vi < localVars.length; vi++) {
    variableMap[localVars[vi].id] = localVars[vi];
  }

  var textStyleMap: Record<string, TextStyle> = {};
  for (var ti = 0; ti < localTextStyles.length; ti++) {
    textStyleMap[localTextStyles[ti].id] = localTextStyles[ti];
  }

  var effectStyleMap: Record<string, EffectStyle> = {};
  for (var ei = 0; ei < localEffectStyles.length; ei++) {
    effectStyleMap[localEffectStyles[ei].id] = localEffectStyles[ei];
  }

  var paintStyleMap: Record<string, PaintStyle> = {};
  for (var pi = 0; pi < localPaintStyles.length; pi++) {
    paintStyleMap[localPaintStyles[pi].id] = localPaintStyles[pi];
  }

  // Build color variable entries (literal non-alias COLOR vars)
  var colorVarEntries: ColorVarEntry[] = [];
  for (var cvi = 0; cvi < localVars.length; cvi++) {
    var cv = localVars[cvi];
    if (cv.resolvedType !== 'COLOR') continue;
    var cvModeIds = Object.keys(cv.valuesByMode);
    if (cvModeIds.length === 0) continue;
    var cvVal = cv.valuesByMode[cvModeIds[0]] as { r?: number; g?: number; b?: number };
    if (!cvVal || typeof cvVal.r !== 'number') continue;
    colorVarEntries.push({
      id: cv.id,
      nameLower: cv.name.toLowerCase(),
      color: { r: cvVal.r as number, g: cvVal.g as number, b: cvVal.b as number },
    });
  }

  // Build float variable entries (literal non-alias FLOAT vars)
  var floatVarEntries: FloatVarEntry[] = [];
  for (var flvi = 0; flvi < localVars.length; flvi++) {
    var flv = localVars[flvi];
    if (flv.resolvedType !== 'FLOAT') continue;
    var flvModeIds = Object.keys(flv.valuesByMode);
    if (flvModeIds.length === 0) continue;
    var flvVal = flv.valuesByMode[flvModeIds[0]];
    if (typeof flvVal !== 'number') continue;
    floatVarEntries.push({
      id: flv.id,
      nameLower: flv.name.toLowerCase(),
      value: flvVal,
    });
  }

  // Build text style exact map keyed by "fontFamily|fontStyle|roundedFontSize"
  var textStyleExactMap: Record<string, TextStyle> = {};
  for (var tsi = 0; tsi < localTextStyles.length; tsi++) {
    var ts = localTextStyles[tsi];
    try {
      if (ts.fontName && typeof ts.fontSize === 'number') {
        var tsKey = ts.fontName.family.toLowerCase() + '|' + ts.fontName.style.toLowerCase() + '|' + Math.round(ts.fontSize);
        if (!textStyleExactMap[tsKey]) {
          textStyleExactMap[tsKey] = ts;
        }
      }
    } catch (e) {}
  }

  return {
    variableMap,
    textStyleMap,
    effectStyleMap,
    paintStyleMap,
    localVars,
    localTextStyles,
    colorVarEntries,
    floatVarEntries,
    textStyleExactMap,
  };
}
