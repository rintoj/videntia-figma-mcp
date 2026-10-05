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
import { isLargeText } from "./font-weight.js";
import { sampleImagePaint, type ImageRasterMap } from "./image-backdrop.js";

export { isLargeText, fontWeightFromStyle } from "./font-weight.js";
export type { ImageRasterMap } from "./image-backdrop.js";

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
  blendMode?: string;
  /** IMAGE paints: which image and how it is laid out on the node. */
  imageHash?: string;
  scaleMode?: string;
  scalingFactor?: number;
  imageTransform?: number[][];
  rotation?: number;
  /** Non-zero image adjustments (exposure, contrast, …) — not simulated. */
  filters?: Record<string, number>;
}

export interface BackdropLayer {
  nodeId: string;
  nodeName: string;
  nodeType?: string;
  opacity?: number;
  bounds: Bounds;
  fills: PaintLike[];
}

/**
 * One node of the paint stack under a text node, as the plugin serialises it.
 * `children` are in PAINT order (bottom first). Exactly one leaf carries
 * `target: true` — the text node itself, whose colour is supplied at render
 * time. A node without `bounds` is unbounded (the PAGE root).
 */
export interface StackNode {
  nodeId: string;
  nodeName: string;
  nodeType?: string;
  opacity?: number;
  blendMode?: string;
  bounds?: Bounds | null;
  /** Node rotation in degrees; `bounds` is then the axis-aligned box. */
  rotation?: number;
  fills?: PaintLike[];
  /** clipsContent — children are only painted inside `bounds`. */
  clips?: boolean;
  children?: StackNode[];
  target?: boolean;
}

/** A styled range of a mixed-style text node (getStyledTextSegments). */
export interface TextSegmentSample {
  start: number;
  end: number;
  characters?: string;
  fontSize: number;
  fontWeight?: number;
  fontStyle?: string;
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
  /** Present when fills / fontSize / fontName are mixed: evaluated one by one. */
  segments?: TextSegmentSample[];
  /** Full paint stack (page → ancestors → siblings below → text). Preferred. */
  stack?: StackNode;
  /** Legacy: ancestors only, OUTERMOST first. Used when `stack` is absent. */
  backdrop?: BackdropLayer[];
  /** Set by the plugin when the stack walk hit its node cap. */
  stackPartial?: boolean;
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
  /** True when an IMAGE/VIDEO/PATTERN paint sat between the text and the resolved colour. */
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
        unresolvedPaint = true;
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

export interface ContrastSegmentFinding {
  start: number;
  end: number;
  text: string;
  fontSize: number;
  isLargeText: boolean;
  foreground: string;
  background: string;
  ratio: number;
  requiredAA: number;
  requiredAAA: number;
  passAA: boolean;
  passAAA: boolean;
  /** Why this segment could not be scored (image backdrop, image text fill, …). */
  indeterminate?: string;
}

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
  /** Over the DETERMINATE segments only — an indeterminate node is not a failure. */
  passAA: boolean;
  passAAA: boolean;
  /**
   * "error" when AA fails, "warn" when AA passes but AAA fails, "indeterminate"
   * when nothing fails but part of the node could not be resolved.
   */
  severity: "error" | "warn" | "pass" | "indeterminate";
  /** Reason the node (or one of its segments) could not be scored. */
  indeterminate?: string;
  /** Per-range results for mixed-style text; the node reports the worst one. */
  segments?: ContrastSegmentFinding[];
  note?: string;
}

/** Premultiplied RGBA plus provenance, for stack rendering. */
export interface PremulColor {
  r: number;
  g: number;
  b: number;
  a: number;
  /** Set while an unresolvable paint (image/video/pattern) shows through. */
  unknown: string | null;
  source: string | null;
}

const CLEAR: PremulColor = { r: 0, g: 0, b: 0, a: 0, unknown: null, source: null };
const NORMAL_BLENDS = ["NORMAL", "PASS_THROUGH"];

function isResolvablePaint(paint: PaintLike): boolean {
  return paint.type === "SOLID" || String(paint.type).indexOf("GRADIENT_") === 0;
}

function toPremul(c: RGBAColor, source: string | null): PremulColor {
  const a = Math.max(0, Math.min(1, c.a === undefined ? 1 : c.a));
  return { r: c.r * a, g: c.g * a, b: c.b * a, a, unknown: null, source };
}

function over(src: PremulColor, dst: PremulColor): PremulColor {
  const k = 1 - src.a;
  return {
    r: src.r + dst.r * k,
    g: src.g + dst.g * k,
    b: src.b + dst.b * k,
    a: src.a + dst.a * k,
    unknown: src.a >= 0.999 ? src.unknown : src.unknown || dst.unknown,
    source: src.a > 0 ? src.source || dst.source : dst.source,
  };
}

function scalePremul(p: PremulColor, k: number): PremulColor {
  if (k >= 1) return p;
  if (k <= 0) return CLEAR;
  return { ...p, r: p.r * k, g: p.g * k, b: p.b * k, a: p.a * k };
}

function containsPoint(b: Bounds, p: { x: number; y: number }): boolean {
  return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
}

function labelOf(node: { nodeName: string; nodeId: string }): string {
  return `"${node.nodeName}" (${node.nodeId})`;
}

type ImagePaintResult = { color: RGBAColor | null } | { unknown: string };

/** Sample an IMAGE paint at `point`, or say why it cannot be sampled. */
function resolveImagePaint(
  paint: PaintLike,
  bounds: Bounds,
  point: { x: number; y: number },
  owner: string,
  images: ImageRasterMap | undefined,
  approx: Set<string> | undefined,
  nodeRotation?: number,
): ImagePaintResult {
  const raster = paint.imageHash && images ? images.get(paint.imageHash) : undefined;
  if (!raster || typeof raster === "string") {
    const why = typeof raster === "string" ? raster : paint.imageHash ? "image bytes unavailable" : "image has no hash";
    return { unknown: `IMAGE paint on ${owner} (${why})` };
  }
  const sampled = sampleImagePaint(paint, raster, bounds, point);
  if (approx) {
    approx.add(`backdrop includes image on ${owner} (sampled)`);
    if (sampled.approx) approx.add(`${sampled.approx} on ${owner}`);
    const filters = Object.keys(paint.filters || {});
    if (filters.length > 0) approx.add(`image filters (${filters.join(", ")}) on ${owner} not simulated — approximate`);
    if (nodeRotation) approx.add(`${owner} is rotated ${Math.round(nodeRotation)}° — image mapping approximate`);
  }
  if (!sampled.color) return { color: null };
  const paintAlpha = paint.opacity === undefined ? 1 : paint.opacity;
  return { color: { ...sampled.color, a: sampled.color.a * paintAlpha } };
}

/**
 * Render the paint stack at `point` over transparent. `fg` is the text
 * colour painted by the `target` leaf; pass null to render the backdrop
 * alone. Group/ancestor opacity applies to everything beneath it, exactly as
 * Figma composites an isolated group, so rendering with and without the text
 * gives the two colours the eye actually compares.
 */
export function renderStackAt(
  node: StackNode,
  point: { x: number; y: number },
  fg: PremulColor | null,
  approx?: Set<string>,
  images?: ImageRasterMap,
): { color: PremulColor; hit: boolean } {
  const inside = !node.bounds || containsPoint(node.bounds, point);
  let acc: PremulColor = CLEAR;
  let hit = false;

  if (node.target) {
    if (!inside) return { color: CLEAR, hit: false };
    hit = true;
    if (fg) acc = fg;
  } else {
    if (inside) {
      const local = node.bounds ? normalisedPointIn(node.bounds, point) : { x: 0.5, y: 0.5 };
      for (const paint of node.fills || []) {
        if (paint.visible === false || paint.opacity === 0) continue;
        if (paint.type === "IMAGE" && node.bounds) {
          const img = resolveImagePaint(paint, node.bounds, point, labelOf(node), images, approx, node.rotation);
          if ("unknown" in img) {
            acc = { ...acc, unknown: img.unknown };
          } else if (img.color) {
            acc = over(toPremul(img.color, node.nodeName), acc);
          }
          continue;
        }
        if (!isResolvablePaint(paint)) {
          acc = { ...acc, unknown: `${paint.type} paint on ${labelOf(node)}` };
          continue;
        }
        const resolved = resolvePaint(paint, local);
        if (!resolved) continue;
        if (approx && paint.blendMode && NORMAL_BLENDS.indexOf(paint.blendMode) === -1) {
          approx.add(`${paint.blendMode} paint blend on ${labelOf(node)} treated as NORMAL`);
        }
        acc = over(toPremul(resolved, node.nodeName), acc);
      }
    }
    if (!node.clips || inside) {
      for (const child of node.children || []) {
        const out = renderStackAt(child, point, fg, approx, images);
        if (out.hit) hit = true;
        if (out.color.a > 0 || out.color.unknown) acc = over(out.color, acc);
      }
    }
  }

  const opacity = node.opacity === undefined ? 1 : node.opacity;
  acc = scalePremul(acc, opacity);
  if (approx && node.blendMode && NORMAL_BLENDS.indexOf(node.blendMode) === -1 && (acc.a > 0 || hit)) {
    approx.add(`${node.blendMode} layer blend on ${labelOf(node)} treated as NORMAL`);
  }
  return { color: acc, hit };
}

/** The sample's paint stack; a legacy flat ancestor list paints beneath the text. */
function stackOf(sample: TextSample): StackNode {
  if (sample.stack) return sample.stack;
  const layers: StackNode[] = (sample.backdrop || []).map((l) => ({
    nodeId: l.nodeId,
    nodeName: l.nodeName,
    nodeType: l.nodeType,
    opacity: l.opacity,
    bounds: l.bounds,
    fills: l.fills,
  }));
  const target: StackNode = {
    nodeId: sample.nodeId,
    nodeName: sample.nodeName,
    bounds: sample.bounds,
    opacity: sample.opacity,
    target: true,
  };
  return { nodeId: "page", nodeName: "Page", children: [...layers, target] };
}

/**
 * Centre plus four inset points across the text box. `dense` adds a 5×3 grid,
 * used when an image is involved so a busy photo is probed across the whole
 * text box (the worst point wins).
 */
export function textSamplePoints(b: Bounds, dense = false): Array<{ x: number; y: number }> {
  const at = (fx: number, fy: number) => ({ x: b.x + b.width * fx, y: b.y + b.height * fy });
  const points = [at(0.5, 0.5), at(0.15, 0.5), at(0.85, 0.5), at(0.5, 0.25), at(0.5, 0.75)];
  if (dense) {
    for (const fy of [0.2, 0.5, 0.8]) for (const fx of [0.05, 0.3, 0.7, 0.95]) points.push(at(fx, fy));
  }
  return points;
}

function hasImagePaint(paints: PaintLike[] | undefined): boolean {
  return (paints || []).some((p) => p.type === "IMAGE" && p.visible !== false && p.opacity !== 0);
}

function stackHasImage(node: StackNode): boolean {
  return hasImagePaint(node.fills) || (node.children || []).some(stackHasImage);
}

function textFillAt(
  fills: PaintLike[],
  bounds: Bounds,
  point: { x: number; y: number },
  images?: ImageRasterMap,
  approx?: Set<string>,
): PremulColor | string {
  const local = normalisedPointIn(bounds, point);
  let acc: PremulColor = CLEAR;
  for (const paint of fills || []) {
    if (paint.visible === false || paint.opacity === 0) continue;
    if (paint.type === "IMAGE") {
      const img = resolveImagePaint(paint, bounds, point, "the text fill", images, approx);
      if ("unknown" in img) return img.unknown.replace("IMAGE paint on the text fill", "IMAGE fill on the text");
      if (img.color) acc = over(toPremul(img.color, null), acc);
      continue;
    }
    if (!isResolvablePaint(paint)) return `${paint.type} fill on the text`;
    const resolved = resolvePaint(paint, local);
    if (resolved) acc = over(toPremul(resolved, null), acc);
  }
  if (acc.a <= 0) return "no visible text fill";
  return acc;
}

/** The render result sits on an opaque white canvas when the page paints nothing. */
function flatten(p: PremulColor): RGBAColor {
  const k = 1 - p.a;
  return { r: p.r + k, g: p.g + k, b: p.b + k, a: 1 };
}

interface SegmentEval extends ContrastSegmentFinding {
  source: string | null;
}

function evaluateSegment(
  stack: StackNode,
  bounds: Bounds,
  seg: TextSegmentSample,
  approx: Set<string>,
  images: ImageRasterMap | undefined,
  dense: boolean,
): SegmentEval {
  const large = isLargeText(seg.fontSize, seg.fontWeight, seg.fontStyle);
  const requiredAA = large ? 3 : 4.5;
  const requiredAAA = large ? 4.5 : 7;
  let worst: { ratio: number; fg: RGBAColor; bg: RGBAColor; source: string | null } | null = null;
  let indeterminate: string | undefined;

  for (const point of textSamplePoints(bounds, dense || hasImagePaint(seg.fills))) {
    const fill = textFillAt(seg.fills, bounds, point, images, approx);
    if (typeof fill === "string") {
      indeterminate = fill;
      break;
    }
    const withText = renderStackAt(stack, point, fill, approx, images);
    if (!withText.hit) continue;
    const backdrop = renderStackAt(stack, point, null, undefined, images);
    if (backdrop.color.unknown && !indeterminate) indeterminate = `${backdrop.color.unknown} sits behind the text`;
    const fg = flatten(withText.color);
    const bg = flatten(backdrop.color);
    const ratio = calculateContrastRatio(fg, bg);
    if (!worst || ratio < worst.ratio) worst = { ratio, fg, bg, source: backdrop.color.source };
  }
  if (!worst && !indeterminate) indeterminate = "text is clipped out of view at every sample point";

  const ratio = worst ? worst.ratio : 0;
  return {
    start: seg.start,
    end: seg.end,
    text: (seg.characters || "").slice(0, 40),
    fontSize: seg.fontSize,
    isLargeText: large,
    foreground: worst ? rgbaToHex(worst.fg) : "—",
    background: worst ? rgbaToHex(worst.bg) : "—",
    ratio: Math.round(ratio * 100) / 100,
    requiredAA,
    requiredAAA,
    passAA: ratio >= requiredAA,
    passAAA: ratio >= requiredAAA,
    indeterminate,
    source: worst ? worst.source : null,
  };
}

/**
 * Score one text node. Mixed-style text is evaluated per styled segment and
 * the node reports its worst segment. Several points across the text box are
 * sampled against the full paint stack (page background, ancestors and the
 * siblings painted beneath) and the worst point wins. A node whose backdrop or
 * fill cannot be resolved is `indeterminate` rather than pass/fail — unless a
 * resolvable segment definitely fails.
 */
export function evaluateTextSample(sample: TextSample, images?: ImageRasterMap): ContrastFinding {
  const stack = stackOf(sample);
  const dense = stackHasImage(stack);
  const approx = new Set<string>();
  const segmentsIn: TextSegmentSample[] =
    sample.segments && sample.segments.length > 0
      ? sample.segments
      : [
          {
            start: 0,
            end: (sample.characters || "").length,
            characters: sample.characters,
            fontSize: sample.fontSize,
            fontWeight: sample.fontWeight,
            fontStyle: sample.fontStyle,
            fills: sample.fills,
          },
        ];
  const segs = segmentsIn.map((s) => evaluateSegment(stack, sample.bounds, s, approx, images, dense));

  const determinate = segs.filter((s) => !s.indeterminate);
  const pool = determinate.length > 0 ? determinate : segs;
  const worst = pool.reduce((a, b) => (b.ratio / b.requiredAA < a.ratio / a.requiredAA ? b : a));
  const passAA = determinate.every((s) => s.passAA);
  const passAAA = determinate.every((s) => s.passAAA);
  const indeterminate = segs.find((s) => s.indeterminate)?.indeterminate;

  const finding: ContrastFinding = {
    nodeId: sample.nodeId,
    nodeName: sample.nodeName,
    text: (sample.characters || "").slice(0, 80),
    fontSize: worst.fontSize,
    fontWeight: segmentsIn.length === 1 ? segmentsIn[0].fontWeight : undefined,
    isLargeText: worst.isLargeText,
    foreground: worst.foreground,
    background: worst.background,
    backgroundSource: worst.source,
    ratio: worst.ratio,
    requiredAA: worst.requiredAA,
    requiredAAA: worst.requiredAAA,
    passAA,
    passAAA,
    severity: !passAA ? "error" : indeterminate ? "indeterminate" : !passAAA ? "warn" : "pass",
  };
  if (indeterminate) finding.indeterminate = indeterminate;
  if (segs.length > 1) finding.segments = segs.map(({ source: _source, ...rest }) => rest);

  const notes: string[] = [];
  if (sample.stackPartial) notes.push("backdrop stack hit its node cap — partially resolved");
  for (const a of approx) notes.push(a);
  if (notes.length > 0) finding.note = notes.join("; ");
  return finding;
}

export interface ContrastSweepReport {
  total: number;
  failingAA: number;
  failingAAA: number;
  /** Nodes with no definite AA failure but an unresolvable backdrop or fill. */
  indeterminate: number;
  findings: ContrastFinding[];
}

/** `images` holds the decoded rasters (see decodeBackdropImages) for IMAGE paints. */
export function sweepContrast(samples: TextSample[], images?: ImageRasterMap): ContrastSweepReport {
  const findings = (samples || []).map((s) => evaluateTextSample(s, images));
  return {
    total: findings.length,
    failingAA: findings.filter((f) => !f.passAA).length,
    failingAAA: findings.filter((f) => !f.passAAA).length,
    indeterminate: findings.filter((f) => f.severity === "indeterminate").length,
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
