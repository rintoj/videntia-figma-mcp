import type {
  Violation,
  ViolationSeverity,
  ViolationCategory,
  ViolationDetails,
  ColorVarEntry,
  FloatVarEntry,
  LookupMaps,
  LintRuleId,
  IgnoreSet,
  LintScope,
} from "./types";
import { COLOR_SEMANTIC_KEYWORDS, FLOAT_SEMANTIC_KEYWORDS, LINT_IGNORE_NAMESPACE, LINT_IGNORE_KEY } from "./constants";

// ── Image layer detection ─────────────────────────────────────────────────────

export function hasImageFill(node: SceneNode): boolean {
  try {
    let fills = (node as GeometryMixin).fills;
    if (!Array.isArray(fills)) return false;
    for (let i = 0; i < fills.length; i++) {
      if (fills[i] && fills[i].type === "IMAGE" && fills[i].visible !== false) return true;
    }
  } catch (_e) {}
  return false;
}

/** Image layers (visible IMAGE paint or `Image/` name) are intentionally cropped/bled — exempt from overflow and clip bounds. */
export function isImageLayer(node: SceneNode): boolean {
  let name = "";
  try {
    name = node.name || "";
  } catch (_e) {}
  return name.indexOf("Image/") === 0 || hasImageFill(node);
}

// ── Suppression ───────────────────────────────────────────────────────────────

/** Accepts URL-style ids (`1-2`, `I1-2;3-4`) and returns Figma ids (`1:2`, `I1:2;3:4`). */
export function normalizeLintNodeId(id: string): string {
  let s = String(id).trim();
  if (s.indexOf(":") !== -1) return s;
  return s.replace(/(\d+)-(\d+)/g, "$1:$2");
}

/** Parses a lint-ignore value: "*" (or empty rule list) → all rules; otherwise comma-separated rule ids/categories. */
export function parseIgnoreValue(value: string | undefined | null): IgnoreSet | null {
  if (value === undefined || value === null) return null;
  let raw = String(value).trim();
  if (raw === "") return null;
  let parts = raw.split(",");
  let rules: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    let p = parts[i].trim();
    if (p === "*") return { all: true, rules: [] };
    if (p !== "" && rules.indexOf(p) === -1) rules.push(p);
  }
  return rules.length > 0 ? { all: false, rules: rules } : null;
}

const NAME_IGNORE_TOKEN = /\[lint-ignore(?::([^\]]*))?\]/i;

/** Reads a node's own suppression: ignoreNodeIds, shared plugin data `videntia/lint-ignore`, or a `[lint-ignore(:rules)]` name token. */
export function readNodeIgnore(node: BaseNode, scope: LintScope | undefined): IgnoreSet | null {
  let own: IgnoreSet | null = null;
  if (scope && scope.ignoreNodeIds[node.id]) return { all: true, rules: [] };
  try {
    let getter = (node as BaseNode & { getSharedPluginData?: (ns: string, key: string) => string }).getSharedPluginData;
    if (typeof getter === "function") {
      own = mergeIgnore(own, parseIgnoreValue(getter.call(node, LINT_IGNORE_NAMESPACE, LINT_IGNORE_KEY)));
    }
  } catch (_e) {}
  let name = "";
  try {
    name = node.name || "";
  } catch (_e) {}
  if (name.indexOf("[") !== -1) {
    let m = NAME_IGNORE_TOKEN.exec(name);
    if (m) own = mergeIgnore(own, m[1] === undefined ? { all: true, rules: [] } : parseIgnoreValue(m[1] || "*"));
  }
  return own;
}

export function mergeIgnore(a: IgnoreSet | null, b: IgnoreSet | null): IgnoreSet | null {
  if (!a) return b;
  if (!b) return a;
  if (a.all) return a;
  if (b.all) return b;
  let rules = a.rules.slice();
  for (let i = 0; i < b.rules.length; i++) {
    if (rules.indexOf(b.rules[i]) === -1) rules.push(b.rules[i]);
  }
  return { all: false, rules: rules };
}

export function isSuppressed(
  ignore: IgnoreSet | null,
  scope: LintScope | undefined,
  category: ViolationCategory,
  rule: LintRuleId,
): boolean {
  if (scope && scope.ignoreRules.length > 0) {
    if (scope.ignoreRules.indexOf(rule) !== -1 || scope.ignoreRules.indexOf(category) !== -1) return true;
  }
  if (!ignore) return false;
  if (ignore.all) return true;
  return ignore.rules.indexOf(rule) !== -1 || ignore.rules.indexOf(category) !== -1;
}

export function countSuppressed(scope: LintScope | undefined, rule: LintRuleId): void {
  if (!scope) return;
  scope.suppressed.total++;
  scope.suppressed.byRule[rule] = (scope.suppressed.byRule[rule] || 0) + 1;
}

// ── Instance override detection ───────────────────────────────────────────────

/** Map of sublayer id → overridden fields for an INSTANCE (`instance.overrides`). */
export function readInstanceOverrides(node: SceneNode): Record<string, string[]> {
  let map: Record<string, string[]> = {};
  try {
    let list = (node as InstanceNode).overrides;
    if (Array.isArray(list)) {
      for (let i = 0; i < list.length; i++) {
        let entry = list[i];
        if (entry && entry.id && Array.isArray(entry.overriddenFields)) {
          map[entry.id] = (map[entry.id] || []).concat(entry.overriddenFields as string[]);
        }
      }
    }
  } catch (_e) {}
  return map;
}

/** True when the paint property (`fills` / `strokes`) on a node inside an instance is overridden rather than inherited. */
export function isPaintOverridden(
  overrides: Record<string, string[]>,
  nodeId: string,
  prop: "fills" | "strokes",
): boolean {
  let fields = overrides[nodeId];
  if (!fields) return false;
  let styleField = prop === "fills" ? "fillStyleId" : "strokeStyleId";
  return fields.indexOf(prop) !== -1 || fields.indexOf(styleField) !== -1;
}

// ── Fill / scalar binding helpers ────────────────────────────────────────────

export function isFillBound(node: SceneNode, propKey: string, idx: number): boolean {
  let bv = (node as GeometryMixin & { boundVariables?: Record<string, unknown> }).boundVariables;
  if (bv) {
    let binding = bv[propKey];
    if (binding) {
      if (Array.isArray(binding)) {
        let item = (binding as Array<{ id?: string }>)[idx];
        if (item && item.id) return true;
      } else if ((binding as { id?: string }).id) {
        return true;
      }
    }
  }
  return false;
}

export function isScalarBound(node: SceneNode, propKey: string): boolean {
  let bv = (node as { boundVariables?: Record<string, unknown> }).boundVariables;
  if (bv && bv[propKey]) {
    let binding = bv[propKey];
    if ((binding as { id?: string }).id) return true;
    if (
      Array.isArray(binding) &&
      binding.length > 0 &&
      (binding as Array<{ id?: string }>)[0] &&
      (binding as Array<{ id?: string }>)[0].id
    )
      return true;
  }
  return false;
}

// ── Paint / style presence helpers ───────────────────────────────────────────

export function hasFillPaintStyle(node: SceneNode): boolean {
  try {
    let styleId = (node as unknown as { fillStyleId?: string | typeof figma.mixed }).fillStyleId;
    if (styleId && styleId !== "" && styleId !== figma.mixed) return true;
  } catch (_e) {}
  return false;
}

export function hasStrokePaintStyle(node: SceneNode): boolean {
  try {
    let styleId = (node as unknown as { strokeStyleId?: string | typeof figma.mixed }).strokeStyleId;
    if (styleId && styleId !== "" && styleId !== figma.mixed) return true;
  } catch (_e) {}
  return false;
}

export function hasTextStyle(node: SceneNode): boolean {
  try {
    let styleId = (node as unknown as { textStyleId?: string | typeof figma.mixed }).textStyleId;
    if (styleId && styleId !== "" && styleId !== figma.mixed) return true;
  } catch (_e) {}
  return false;
}

export function hasEffectStyle(node: SceneNode): boolean {
  try {
    let styleId = (node as unknown as { effectStyleId?: string | typeof figma.mixed }).effectStyleId;
    if (styleId && styleId !== "" && styleId !== figma.mixed) return true;
  } catch (_e) {}
  return false;
}

// ── Typography variable binding helper ───────────────────────────────────────

export function hasFontVariableBindings(node: SceneNode): boolean {
  let bv = (node as { boundVariables?: Record<string, { id?: string }> }).boundVariables;
  if (!bv) return false;
  let fontProps = [
    "fontFamily",
    "fontSize",
    "fontStyle",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "paragraphSpacing",
  ];
  for (let fi = 0; fi < fontProps.length; fi++) {
    let prop = bv[fontProps[fi]];
    if (prop && prop.id) return true;
  }
  return false;
}

// ── Node classification helpers ───────────────────────────────────────────────

export function isIconLike(node: SceneNode): boolean {
  if (node.type === "VECTOR" || node.type === "LINE" || node.type === "BOOLEAN_OPERATION") return true;
  if (node.type === "INSTANCE" || node.type === "COMPONENT") {
    try {
      let sized = node as InstanceNode | ComponentNode;
      if (sized.width <= 48 && sized.height <= 48) return true;
    } catch (_e) {}
  }
  // Frame-like nodes containing only vector primitives are SVG/icon containers
  if ("children" in node) {
    try {
      let children = (node as FrameNode).children;
      if (children && children.length > 0 && hasOnlyVectorChildren(children)) return true;
    } catch (_e) {}
  }
  return false;
}

function hasOnlyVectorChildren(children: ReadonlyArray<SceneNode>): boolean {
  for (let i = 0; i < children.length; i++) {
    let ct = children[i].type;
    if (
      ct === "VECTOR" ||
      ct === "LINE" ||
      ct === "BOOLEAN_OPERATION" ||
      ct === "ELLIPSE" ||
      ct === "RECTANGLE" ||
      ct === "POLYGON" ||
      ct === "STAR"
    ) {
      continue;
    }
    // Nested groups/frames containing only vectors (SVG <g> elements)
    if ((ct === "GROUP" || ct === "FRAME") && "children" in children[i]) {
      let nested = (children[i] as FrameNode).children;
      if (nested && nested.length > 0 && hasOnlyVectorChildren(nested)) continue;
    }
    return false;
  }
  return true;
}

export function isColorFill(fill: Paint): boolean {
  if (!fill || fill.visible === false) return false;
  if (
    fill.type === "SOLID" ||
    fill.type === "GRADIENT_LINEAR" ||
    fill.type === "GRADIENT_RADIAL" ||
    fill.type === "GRADIENT_ANGULAR" ||
    fill.type === "GRADIENT_DIAMOND"
  )
    return true;
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
  rule: LintRuleId,
  property: string,
  message: string,
  details?: ViolationDetails,
): void {
  if (violations.length >= maxViolations) {
    violationsCappedRef.value = true;
    return;
  }
  let v: Violation = {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    depth: depth,
    severity: severity,
    category: category,
    rule: rule,
    property: property,
    message: message,
  };
  if (details !== undefined) v.details = details;
  violations.push(v);
}

// ── Color distance ────────────────────────────────────────────────────────────

export function colorDist(c1: { r: number; g: number; b: number }, c2: { r: number; g: number; b: number }): number {
  let dr = c1.r - c2.r;
  let dg = c1.g - c2.g;
  let db = c1.b - c2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// ── Semantic name matching ────────────────────────────────────────────────────

export function isSemanticMatch(nameLower: string, category: string): boolean {
  let kws = COLOR_SEMANTIC_KEYWORDS[category];
  if (!kws) return false;
  for (let ki = 0; ki < kws.length; ki++) {
    if (nameLower.indexOf(kws[ki]) !== -1) return true;
  }
  return false;
}

// ── Lookup map builder ────────────────────────────────────────────────────────

export async function buildLookupMaps(): Promise<LookupMaps> {
  let preloadResults = await Promise.all([
    figma.variables.getLocalVariablesAsync(),
    figma.getLocalTextStylesAsync(),
    figma.getLocalEffectStylesAsync(),
    figma.getLocalPaintStylesAsync(),
  ]);

  let localVars = preloadResults[0];
  let localTextStyles = preloadResults[1];
  let localEffectStyles = preloadResults[2];
  let localPaintStyles = preloadResults[3];

  let variableMap: Record<string, Variable> = {};
  for (let vi = 0; vi < localVars.length; vi++) {
    variableMap[localVars[vi].id] = localVars[vi];
  }

  let textStyleMap: Record<string, TextStyle> = {};
  for (let ti = 0; ti < localTextStyles.length; ti++) {
    textStyleMap[localTextStyles[ti].id] = localTextStyles[ti];
  }

  let effectStyleMap: Record<string, EffectStyle> = {};
  for (let ei = 0; ei < localEffectStyles.length; ei++) {
    effectStyleMap[localEffectStyles[ei].id] = localEffectStyles[ei];
  }

  let paintStyleMap: Record<string, PaintStyle> = {};
  for (let pi = 0; pi < localPaintStyles.length; pi++) {
    paintStyleMap[localPaintStyles[pi].id] = localPaintStyles[pi];
  }

  // Build color variable entries (literal non-alias COLOR vars)
  let colorVarEntries: ColorVarEntry[] = [];
  for (let cvi = 0; cvi < localVars.length; cvi++) {
    let cv = localVars[cvi];
    if (cv.resolvedType !== "COLOR") continue;
    let cvModeIds = Object.keys(cv.valuesByMode);
    if (cvModeIds.length === 0) continue;
    let cvVal = cv.valuesByMode[cvModeIds[0]] as { r?: number; g?: number; b?: number };
    if (!cvVal || typeof cvVal.r !== "number") continue;
    colorVarEntries.push({
      id: cv.id,
      nameLower: cv.name.toLowerCase(),
      color: { r: cvVal.r as number, g: cvVal.g as number, b: cvVal.b as number },
    });
  }

  // Build float variable entries (literal non-alias FLOAT vars)
  let floatVarEntries: FloatVarEntry[] = [];
  for (let flvi = 0; flvi < localVars.length; flvi++) {
    let flv = localVars[flvi];
    if (flv.resolvedType !== "FLOAT") continue;
    let flvModeIds = Object.keys(flv.valuesByMode);
    if (flvModeIds.length === 0) continue;
    let flvVal = flv.valuesByMode[flvModeIds[0]];
    if (typeof flvVal !== "number") continue;
    floatVarEntries.push({
      id: flv.id,
      nameLower: flv.name.toLowerCase(),
      value: flvVal,
    });
  }

  // Build text style exact map keyed by "fontFamily|fontStyle|roundedFontSize"
  let textStyleExactMap: Record<string, TextStyle> = {};
  for (let tsi = 0; tsi < localTextStyles.length; tsi++) {
    let ts = localTextStyles[tsi];
    try {
      if (ts.fontName && typeof ts.fontSize === "number") {
        let tsKey =
          ts.fontName.family.toLowerCase() + "|" + ts.fontName.style.toLowerCase() + "|" + Math.round(ts.fontSize);
        if (!textStyleExactMap[tsKey]) {
          textStyleExactMap[tsKey] = ts;
        }
      }
    } catch (_e) {}
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
