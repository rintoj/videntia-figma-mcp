/**
 * Server-side math for the verification tools (§7).
 *
 * The Figma plugin side stays "dumb": it collects raw paints, bounds and
 * variable values and ships them here. All of the arithmetic — alpha
 * compositing, gradient interpolation, WCAG evaluation, rectangle
 * intersection, value diffing and token-collision detection — lives in this
 * file so it can be unit-tested without a Figma document.
 *
 * Colour primitives are deliberately reused from ./color-calculations.
 */

import { calculateContrastRatio, rgbaToHex, type RGBAColor } from "./color-calculations.js";

// ───────────────────────────────────────────────────────────── shared shapes ──

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GradientStop {
  position: number;
  color: { r: number; g: number; b: number; a?: number };
}

export interface PaintLike {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: { r: number; g: number; b: number; a?: number };
  gradientStops?: GradientStop[];
  /** Figma's 3 handles, normalised to the node's bounding box. */
  gradientHandlePositions?: Array<{ x: number; y: number }>;
}

export interface BackdropLayer {
  nodeId: string;
  nodeName: string;
  nodeType?: string;
  opacity?: number;
  bounds: Bounds;
  fills: PaintLike[];
}

export interface TextSample {
  nodeId: string;
  nodeName: string;
  characters: string;
  fontSize: number;
  /** Numeric weight when known (400/700/…). */
  fontWeight?: number;
  fontStyle?: string;
  opacity?: number;
  bounds: Bounds;
  fills: PaintLike[];
  /** Ancestors, OUTERMOST first, innermost last. */
  backdrop: BackdropLayer[];
}

// ───────────────────────────────────────────────────────── alpha compositing ──

const WHITE: RGBAColor = { r: 1, g: 1, b: 1, a: 1 };

/** Source-over: `src` (may be translucent) painted on an opaque `dst`. */
export function compositeOver(src: RGBAColor, dst: RGBAColor): RGBAColor {
  const a = src.a === undefined ? 1 : Math.max(0, Math.min(1, src.a));
  return {
    r: src.r * a + dst.r * (1 - a),
    g: src.g * a + dst.g * (1 - a),
    b: src.b * a + dst.b * (1 - a),
    a: 1,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Colour of a gradient at parametric position `t` (0..1) along its axis.
 * Stops are sorted and the value is clamped outside the first/last stop.
 */
export function sampleGradientStops(stops: GradientStop[], t: number): RGBAColor {
  if (!stops || stops.length === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const sorted = stops.slice().sort((a, b) => a.position - b.position);
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped <= sorted[0].position) {
    const c = sorted[0].color;
    return { r: c.r, g: c.g, b: c.b, a: c.a === undefined ? 1 : c.a };
  }
  const last = sorted[sorted.length - 1];
  if (clamped >= last.position) {
    return { r: last.color.r, g: last.color.g, b: last.color.b, a: last.color.a === undefined ? 1 : last.color.a };
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i];
    const hi = sorted[i + 1];
    if (clamped >= lo.position && clamped <= hi.position) {
      const span = hi.position - lo.position;
      const local = span === 0 ? 0 : (clamped - lo.position) / span;
      return {
        r: lerp(lo.color.r, hi.color.r, local),
        g: lerp(lo.color.g, hi.color.g, local),
        b: lerp(lo.color.b, hi.color.b, local),
        a: lerp(lo.color.a === undefined ? 1 : lo.color.a, hi.color.a === undefined ? 1 : hi.color.a, local),
      };
    }
  }
  return { r: last.color.r, g: last.color.g, b: last.color.b, a: 1 };
}

/**
 * Parametric position of point `p` (normalised 0..1 inside the painted node)
 * projected onto the gradient axis defined by Figma's handle positions.
 * Falls back to a top→bottom axis when handles are missing.
 */
export function gradientParamAt(
  handles: Array<{ x: number; y: number }> | undefined,
  p: { x: number; y: number },
): number {
  if (!handles || handles.length < 2) return Math.max(0, Math.min(1, p.y));
  const p0 = handles[0];
  const p1 = handles[1];
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  const t = ((p.x - p0.x) * dx + (p.y - p0.y) * dy) / lenSq;
  return Math.max(0, Math.min(1, t));
}

/** Resolve one paint to a colour, sampling gradients at `point`. */
export function resolvePaint(paint: PaintLike, point: { x: number; y: number }): RGBAColor | null {
  if (paint.visible === false) return null;
  const paintAlpha = paint.opacity === undefined ? 1 : paint.opacity;
  if (paintAlpha === 0) return null;

  if (paint.type === "SOLID") {
    if (!paint.color) return null;
    const own = paint.color.a === undefined ? 1 : paint.color.a;
    return { r: paint.color.r, g: paint.color.g, b: paint.color.b, a: own * paintAlpha };
  }
  if (typeof paint.type === "string" && paint.type.indexOf("GRADIENT_") === 0) {
    const t = gradientParamAt(paint.gradientHandlePositions, point);
    const c = sampleGradientStops(paint.gradientStops || [], t);
    return { r: c.r, g: c.g, b: c.b, a: (c.a === undefined ? 1 : c.a) * paintAlpha };
  }
  // IMAGE / VIDEO / pattern paints: backdrop is unknowable from metadata.
  return null;
}

function normalisedPointIn(bounds: Bounds, sample: { x: number; y: number }): { x: number; y: number } {
  const w = bounds.width || 1;
  const h = bounds.height || 1;
  return { x: (sample.x - bounds.x) / w, y: (sample.y - bounds.y) / h };
}

export interface ResolvedBackdrop {
  color: RGBAColor;
  hex: string;
  /** Node whose paint contributed the final (innermost opaque) layer. */
  sourceNodeId: string | null;
  sourceNodeName: string | null;
  /** True when an IMAGE/VIDEO paint sat between the text and the resolved colour. */
  unresolvedPaint: boolean;
}

/**
 * Walk ancestor layers outermost→innermost, compositing every visible paint,
 * to get the effective colour behind a point.
 */
export function resolveBackdrop(
  layers: BackdropLayer[],
  samplePoint: { x: number; y: number },
  base: RGBAColor = WHITE,
): ResolvedBackdrop {
  let acc: RGBAColor = { r: base.r, g: base.g, b: base.b, a: 1 };
  let sourceNodeId: string | null = null;
  let sourceNodeName: string | null = null;
  let unresolvedPaint = false;

  for (const layer of layers) {
    const layerOpacity = layer.opacity === undefined ? 1 : layer.opacity;
    if (layerOpacity === 0) continue;
    const point = normalisedPointIn(layer.bounds, samplePoint);
    for (const paint of layer.fills || []) {
      if (paint.visible === false) continue;
      if (paint.type !== "SOLID" && String(paint.type).indexOf("GRADIENT_") !== 0) {
        if (paint.type === "IMAGE" || paint.type === "VIDEO") unresolvedPaint = true;
        continue;
      }
      const resolved = resolvePaint(paint, point);
      if (!resolved) continue;
      const withLayer: RGBAColor = { ...resolved, a: (resolved.a === undefined ? 1 : resolved.a) * layerOpacity };
      acc = compositeOver(withLayer, acc);
      sourceNodeId = layer.nodeId;
      sourceNodeName = layer.nodeName;
    }
  }

  return { color: acc, hex: rgbaToHex({ ...acc, a: 1 }), sourceNodeId, sourceNodeName, unresolvedPaint };
}

// ─────────────────────────────────────────────────────────── WCAG evaluation ──

export interface ContrastFinding {
  nodeId: string;
  nodeName: string;
  text: string;
  fontSize: number;
  fontWeight?: number;
  isLargeText: boolean;
  foreground: string;
  background: string;
  backgroundSource: string | null;
  ratio: number;
  requiredAA: number;
  requiredAAA: number;
  passAA: boolean;
  passAAA: boolean;
  /** "error" when AA fails, "warn" when AA passes but AAA fails. */
  severity: "error" | "warn" | "pass";
  note?: string;
}

/** WCAG 1.4.3: ≥18pt, or ≥14pt bold, counts as large text. */
export function isLargeText(fontSize: number, fontWeight?: number, fontStyle?: string): boolean {
  const bold = (fontWeight !== undefined && fontWeight >= 700) || /bold|black|heavy/i.test(fontStyle || "");
  if (fontSize >= 18) return true;
  return bold && fontSize >= 14;
}

export function evaluateTextSample(sample: TextSample): ContrastFinding {
  const centre = {
    x: sample.bounds.x + sample.bounds.width / 2,
    y: sample.bounds.y + sample.bounds.height / 2,
  };
  const backdrop = resolveBackdrop(sample.backdrop || [], centre);

  const fillPoint = normalisedPointIn(sample.bounds, centre);
  const nodeOpacity = sample.opacity === undefined ? 1 : sample.opacity;
  let effectiveFg: RGBAColor = backdrop.color;
  let sawFill = false;
  for (const paint of sample.fills || []) {
    const resolved = resolvePaint(paint, fillPoint);
    if (!resolved) continue;
    sawFill = true;
    effectiveFg = compositeOver(
      { ...resolved, a: (resolved.a === undefined ? 1 : resolved.a) * nodeOpacity },
      effectiveFg,
    );
  }
  if (!sawFill) effectiveFg = { r: 0, g: 0, b: 0, a: 1 };

  const ratio = calculateContrastRatio(effectiveFg, backdrop.color);
  const large = isLargeText(sample.fontSize, sample.fontWeight, sample.fontStyle);
  const requiredAA = large ? 3 : 4.5;
  const requiredAAA = large ? 4.5 : 7;
  const passAA = ratio >= requiredAA;
  const passAAA = ratio >= requiredAAA;

  const finding: ContrastFinding = {
    nodeId: sample.nodeId,
    nodeName: sample.nodeName,
    text: (sample.characters || "").slice(0, 80),
    fontSize: sample.fontSize,
    fontWeight: sample.fontWeight,
    isLargeText: large,
    foreground: rgbaToHex({ ...effectiveFg, a: 1 }),
    background: backdrop.hex,
    backgroundSource: backdrop.sourceNodeName,
    ratio: Math.round(ratio * 100) / 100,
    requiredAA,
    requiredAAA,
    passAA,
    passAAA,
    severity: !passAA ? "error" : !passAAA ? "warn" : "pass",
  };
  if (backdrop.unresolvedPaint) {
    finding.note = "An image/video paint sits behind this text — the resolved backdrop is approximate.";
  }
  if (!sawFill) finding.note = (finding.note ? finding.note + " " : "") + "No resolvable text fill; assumed black.";
  return finding;
}

export interface ContrastSweepReport {
  total: number;
  failingAA: number;
  failingAAA: number;
  findings: ContrastFinding[];
}

export function sweepContrast(samples: TextSample[]): ContrastSweepReport {
  const findings = (samples || []).map(evaluateTextSample);
  return {
    total: findings.length,
    failingAA: findings.filter((f) => !f.passAA).length,
    failingAAA: findings.filter((f) => !f.passAAA).length,
    findings,
  };
}

// ────────────────────────────────────────────────────────────────── overlaps ──

export interface OverlapNode {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  visible?: boolean;
  bounds: Bounds;
  parentId?: string;
  parentName?: string;
}

export interface OverlapPair {
  parentId?: string;
  parentName?: string;
  a: { nodeId: string; nodeName: string; nodeType: string };
  b: { nodeId: string; nodeName: string; nodeType: string };
  overlap: Bounds;
  overlapArea: number;
  /** Overlap area as a fraction of the SMALLER node's area (0..1). */
  overlapRatio: number;
}

/** Intersection rectangle, or null when the rectangles do not overlap by > tolerance. */
export function intersectRects(a: Bounds, b: Bounds, tolerance = 0): Bounds | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const w = x2 - x1 - tolerance;
  const h = y2 - y1 - tolerance;
  if (w <= 0 || h <= 0) return null;
  return { x: x1, y: y1, width: w, height: h };
}

/**
 * All sibling pairs (same `parentId`) whose bounds intersect.
 * `minOverlapRatio` filters out hairline/rounding overlaps.
 */
export function findOverlappingSiblings(
  nodes: OverlapNode[],
  options: { tolerance?: number; ignoreHidden?: boolean; minOverlapRatio?: number } = {},
): OverlapPair[] {
  const tolerance = options.tolerance ?? 0.5;
  const ignoreHidden = options.ignoreHidden !== false;
  const minRatio = options.minOverlapRatio ?? 0;

  const groups = new Map<string, OverlapNode[]>();
  for (const n of nodes || []) {
    if (ignoreHidden && n.visible === false) continue;
    const key = n.parentId || "";
    const list = groups.get(key);
    if (list) list.push(n);
    else groups.set(key, [n]);
  }

  const pairs: OverlapPair[] = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const rect = intersectRects(a.bounds, b.bounds, tolerance);
        if (!rect) continue;
        const area = rect.width * rect.height;
        const smaller = Math.min(
          Math.max(a.bounds.width * a.bounds.height, 1e-6),
          Math.max(b.bounds.width * b.bounds.height, 1e-6),
        );
        const ratio = area / smaller;
        if (ratio < minRatio) continue;
        pairs.push({
          parentId: a.parentId,
          parentName: a.parentName,
          a: { nodeId: a.nodeId, nodeName: a.nodeName, nodeType: a.nodeType },
          b: { nodeId: b.nodeId, nodeName: b.nodeName, nodeType: b.nodeType },
          overlap: rect,
          overlapArea: Math.round(area * 100) / 100,
          overlapRatio: Math.round(ratio * 1000) / 1000,
        });
      }
    }
  }
  pairs.sort((x, y) => y.overlapRatio - x.overlapRatio);
  return pairs;
}

// ──────────────────────────────────────────────────────────────── state diff ──

export interface StateFieldDiff {
  field: string;
  expected: unknown;
  actual: unknown;
  match: boolean;
}

export interface StateDiffReport {
  matched: boolean;
  checked: number;
  mismatches: StateFieldDiff[];
  fields: StateFieldDiff[];
}

function canonicalColor(value: unknown): string | null {
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.r === "number" && typeof o.g === "number" && typeof o.b === "number") {
      return rgbaToHex({ r: o.r, g: o.g, b: o.b, a: typeof o.a === "number" ? o.a : 1 }).toLowerCase();
    }
  }
  if (typeof value === "string" && /^#([0-9a-f]{3,8})$/i.test(value.trim())) {
    const s = value.trim().toLowerCase();
    // normalise shorthand
    if (s.length === 4 || s.length === 5) {
      return (
        "#" +
        s
          .slice(1)
          .split("")
          .map((c) => c + c)
          .join("")
      );
    }
    return s.length === 9 && s.slice(7) === "ff" ? s.slice(0, 7) : s;
  }
  return null;
}

/** Structural equality with number tolerance and hex/RGBA colour equivalence. */
export function valuesMatch(expected: unknown, actual: unknown, tolerance = 0.01): boolean {
  if (expected === actual) return true;

  const ec = canonicalColor(expected);
  const ac = canonicalColor(actual);
  if (ec !== null && ac !== null) {
    return ec === ac || ec.slice(0, 7) === ac.slice(0, 7);
  }

  if (typeof expected === "number" && typeof actual === "number") {
    return Math.abs(expected - actual) <= tolerance;
  }
  if (typeof expected === "string" && typeof actual === "string") {
    return expected.trim() === actual.trim();
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) return false;
    return expected.every((v, i) => valuesMatch(v, actual[i], tolerance));
  }
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    const eo = expected as Record<string, unknown>;
    const ao = actual as Record<string, unknown>;
    // Subset semantics: only keys the caller asserted must match.
    return Object.keys(eo).every((k) => valuesMatch(eo[k], ao[k], tolerance));
  }
  return false;
}

export function diffNodeState(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  tolerance = 0.01,
): StateDiffReport {
  const fields: StateFieldDiff[] = Object.keys(expected || {}).map((field) => ({
    field,
    expected: expected[field],
    actual: actual ? actual[field] : undefined,
    match: valuesMatch(expected[field], actual ? actual[field] : undefined, tolerance),
  }));
  const mismatches = fields.filter((f) => !f.match);
  return { matched: mismatches.length === 0, checked: fields.length, mismatches, fields };
}

// ─────────────────────────────────────────────────────────── token collisions ──

export interface VariableRecord {
  collectionId: string;
  collectionName: string;
  variableId: string;
  name: string;
  resolvedType: string;
  /** Resolved value per mode name. */
  valuesByMode: Record<string, unknown>;
}

export interface TokenCollision {
  /** The token name shared across collections (leading collection prefix stripped). */
  token: string;
  resolvedTypes: string[];
  definitions: Array<{
    collectionName: string;
    collectionId: string;
    variableId: string;
    fullName: string;
    value: unknown;
    valueLabel: string;
  }>;
  distinctValues: number;
}

function valueLabel(value: unknown): string {
  const hex = canonicalColor(value);
  if (hex) return hex;
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Strip a leading collection-ish prefix so `theme/radius/3xl` and
 * `Radius/radius/3xl` both key on `radius/3xl`.
 */
export function tokenKeyOf(variableName: string, collectionName: string): string {
  const parts = String(variableName || "").split("/");
  if (parts.length > 1 && parts[0].toLowerCase() === String(collectionName || "").toLowerCase()) {
    return parts.slice(1).join("/").toLowerCase();
  }
  return parts.join("/").toLowerCase();
}

/**
 * Report token names defined in MORE THAN ONE collection with DIFFERING
 * resolved values — the silent failure mode where a node binds to a
 * plausible-looking but wrong duplicate.
 */
export function findTokenCollisions(
  variables: VariableRecord[],
  options: { includeIdentical?: boolean } = {},
): TokenCollision[] {
  const byToken = new Map<string, VariableRecord[]>();
  for (const v of variables || []) {
    const key = tokenKeyOf(v.name, v.collectionName);
    if (!key) continue;
    const list = byToken.get(key);
    if (list) list.push(v);
    else byToken.set(key, [v]);
  }

  const collisions: TokenCollision[] = [];
  for (const [token, records] of byToken.entries()) {
    const collections = new Set(records.map((r) => r.collectionId));
    if (collections.size < 2) continue;

    const definitions = records.map((r) => {
      const modes = Object.keys(r.valuesByMode || {});
      const value = modes.length > 0 ? r.valuesByMode[modes[0]] : undefined;
      return {
        collectionName: r.collectionName,
        collectionId: r.collectionId,
        variableId: r.variableId,
        fullName: r.name,
        value,
        valueLabel: valueLabel(value),
      };
    });

    const distinct = new Set(definitions.map((d) => d.valueLabel));
    if (distinct.size < 2 && !options.includeIdentical) continue;

    collisions.push({
      token,
      resolvedTypes: Array.from(new Set(records.map((r) => r.resolvedType))),
      definitions,
      distinctValues: distinct.size,
    });
  }
  collisions.sort((a, b) => b.distinctValues - a.distinctValues || a.token.localeCompare(b.token));
  return collisions;
}
