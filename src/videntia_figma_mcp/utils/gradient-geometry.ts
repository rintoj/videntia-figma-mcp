/**
 * The ONE linear-gradient geometry used by every gradient writer (set_gradient_fill,
 * paint styles, JSX → Figma) and reader (node serializer → figma-to-jsx).
 *
 * ANGLE CONVENTION — CSS `linear-gradient`: 0deg = to top, 90deg = to right,
 * 180deg = to bottom, 270deg = to left, clockwise. In Figma's y-down node space the
 * gradient runs along u = (sin θ, −cos θ).
 *
 * Figma's `gradientTransform` maps normalised node space (the unit square) into
 * gradient space, where the ramp runs along x from 0 to 1. Only the first row is
 * observable for a LINEAR gradient: t = a·x + b·y + c.
 *
 * The gradient line length is the CSS one, L = |w·sin θ| + |h·cos θ|, so the
 * 0..1 stop range always spans the node corner-to-corner along the gradient line and
 * the centre of the node is t = 0.5 for every angle.
 */

export type GradientTransform = [[number, number, number], [number, number, number]];

export const DEFAULT_CSS_GRADIENT_ANGLE = 180;

function round6(value: number): number {
  const r = Math.round(value * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

function safeDim(n: number | undefined): number {
  return typeof n === "number" && isFinite(n) && n > 0 ? n : 1;
}

/** Normalise any angle to [0, 360). */
export function normalizeAngle(angle: number): number {
  const a = Number(angle) || 0;
  const r = ((a % 360) + 360) % 360;
  return round6(r === 360 ? 0 : r);
}

/**
 * Linear gradient transform for a CSS angle on a `width` x `height` node. Omit the
 * dimensions (paint styles have none) to use the unit square.
 */
export function linearGradientTransform(cssAngle: number, width?: number, height?: number): GradientTransform {
  const rad = ((Number(cssAngle) || 0) * Math.PI) / 180;
  const ux = Math.sin(rad);
  const uy = -Math.cos(rad);
  const w = safeDim(width);
  const h = safeDim(height);

  const length = Math.abs(w * ux) + Math.abs(h * uy);
  const L = length > 1e-9 ? length : 1;

  const a1 = (w * ux) / L;
  const b1 = (h * uy) / L;
  const c1 = 0.5 - 0.5 * a1 - 0.5 * b1;
  // Perpendicular axis: unobservable for LINEAR but keeps the affine basis well-formed.
  const a2 = -b1;
  const b2 = a1;
  const c2 = 0.5 - 0.5 * a2 - 0.5 * b2;

  return [
    [round6(a1), round6(b1), round6(c1)],
    [round6(a2), round6(b2), round6(c2)],
  ];
}

/** Evaluate the gradient parameter t at a normalised node point. */
export function gradientParamAt(transform: GradientTransform, x: number, y: number): number {
  return transform[0][0] * x + transform[0][1] * y + transform[0][2];
}

/**
 * Inverse of `linearGradientTransform`: recover the CSS angle a LINEAR transform
 * renders on a `width` x `height` node. Rounded to 2 decimals.
 */
export function gradientTransformToCssAngle(transform: unknown, width?: number, height?: number): number | null {
  if (!Array.isArray(transform) || !Array.isArray(transform[0])) return null;
  const a = Number(transform[0][0]);
  const b = Number(transform[0][1]);
  if (!isFinite(a) || !isFinite(b) || (Math.abs(a) < 1e-12 && Math.abs(b) < 1e-12)) return null;
  const ux = a / safeDim(width);
  const uy = b / safeDim(height);
  const deg = (Math.atan2(ux, -uy) * 180) / Math.PI;
  return Math.round(normalizeAngle(deg) * 100) / 100;
}

type Vertical = "top" | "bottom" | null;
type Horizontal = "left" | "right" | null;

const WORDS: Record<string, "top" | "bottom" | "left" | "right"> = {
  t: "top",
  top: "top",
  b: "bottom",
  bottom: "bottom",
  l: "left",
  left: "left",
  r: "right",
  right: "right",
};

function parseDirection(direction: string): { v: Vertical; h: Horizontal } | null {
  let s = String(direction).trim().toLowerCase();
  s = s.replace(/^(bg-gradient-|bg-linear-)/, "");
  s = s.replace(/^to[\s-]+/, "");
  let tokens = s.split(/[\s_-]+/).filter(Boolean);
  // Tailwind compact form: "tr", "bl", …
  if (tokens.length === 1 && /^[tblr]{2}$/.test(tokens[0])) tokens = tokens[0].split("");
  if (tokens.length === 0 || tokens.length > 2) return null;
  let v: Vertical = null;
  let h: Horizontal = null;
  for (const tok of tokens) {
    const word = WORDS[tok];
    if (!word) return null;
    if (word === "top" || word === "bottom") {
      if (v) return null;
      v = word;
    } else {
      if (h) return null;
      h = word;
    }
  }
  return { v, h };
}

/** True when `direction` is a recognised side/corner keyword. */
export function isGradientDirection(direction: unknown): boolean {
  return typeof direction === "string" && parseDirection(direction) !== null;
}

/**
 * Map a direction keyword ("to top", "to bottom right", "right", Tailwind "t" / "br",
 * "bg-gradient-to-r") to its CSS angle. Corner keywords follow the CSS spec: the angle
 * depends on the box aspect ratio so the gradient line is perpendicular to the diagonal
 * joining the two neighbouring corners (45deg multiples only on a square). Returns null
 * for an unrecognised keyword.
 */
export function directionToCssAngle(direction: string, width?: number, height?: number): number | null {
  const parsed = parseDirection(direction);
  if (!parsed) return null;
  const { v, h } = parsed;
  if (!h) return v === "top" ? 0 : 180;
  if (!v) return h === "right" ? 90 : 270;
  const alpha = (Math.atan2(safeDim(height), safeDim(width)) * 180) / Math.PI;
  let angle: number;
  if (v === "top" && h === "right") angle = alpha;
  else if (v === "bottom" && h === "right") angle = 180 - alpha;
  else if (v === "bottom" && h === "left") angle = 180 + alpha;
  else angle = 360 - alpha;
  return round6(angle);
}

/**
 * Resolve the CSS angle for a gradient spec that may carry `angle` and/or `direction`.
 * `angle` wins; with neither the CSS default (180 = to bottom) applies.
 */
export function resolveCssAngle(
  spec: { angle?: unknown; direction?: unknown },
  width?: number,
  height?: number,
  fallback: number = DEFAULT_CSS_GRADIENT_ANGLE,
): number {
  if (spec.angle !== undefined && spec.angle !== null && spec.angle !== "") {
    const n = Number(spec.angle);
    if (isFinite(n)) return n;
  }
  if (typeof spec.direction === "string" && spec.direction.trim() !== "") {
    const a = directionToCssAngle(spec.direction, width, height);
    if (a === null) {
      throw new Error(
        `Unrecognised gradient direction "${spec.direction}". Use "to top", "to right", "to bottom right", … or Tailwind "t", "r", "br", ….`,
      );
    }
    return a;
  }
  return fallback;
}

/** Stable sort by position (Figma renders stops in array order). */
export function sortGradientStops<T extends { position?: unknown }>(stops: T[]): T[] {
  return stops
    .map((stop, i) => ({ stop, i }))
    .sort((x, y) => Number(x.stop.position) - Number(y.stop.position) || x.i - y.i)
    .map((e) => e.stop);
}

/**
 * CSS stop-position fix-up: a missing first/last position is 0/1, positions never go
 * backwards, and runs of positionless stops are spread evenly between their neighbours.
 */
export function distributeStopPositions<T extends { position?: number | null }>(
  stops: T[],
): Array<Omit<T, "position"> & { position: number }> {
  const pos: Array<number | null> = stops.map((s) =>
    typeof s.position === "number" && isFinite(s.position) ? s.position : null,
  );
  if (pos.length === 0) return [];
  if (pos[0] === null) pos[0] = 0;
  if (pos[pos.length - 1] === null) pos[pos.length - 1] = pos.length > 1 ? Math.max(1, ...pos.map((p) => p ?? 0)) : 0;
  let max = -Infinity;
  for (let i = 0; i < pos.length; i++) {
    if (pos[i] !== null) {
      if (pos[i]! < max) pos[i] = max;
      max = pos[i]!;
    }
  }
  let i = 0;
  while (i < pos.length) {
    if (pos[i] !== null) {
      i++;
      continue;
    }
    const start = i - 1;
    let end = i;
    while (pos[end] === null) end++;
    const from = pos[start]!;
    const to = pos[end]!;
    for (let k = start + 1; k < end; k++) pos[k] = from + ((to - from) * (k - start)) / (end - start);
    i = end;
  }
  return stops.map((s, k) => ({ ...s, position: Math.round(pos[k]! * 1e6) / 1e6 }));
}

function splitTopLevel(value: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === sep && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseAngleToken(token: string): number | null {
  const m = token.trim().match(/^(-?\d*\.?\d+)(deg|turn|rad|grad)$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2].toLowerCase()) {
    case "turn":
      return n * 360;
    case "rad":
      return (n * 180) / Math.PI;
    case "grad":
      return n * 0.9;
    default:
      return n;
  }
}

export interface ParsedCssGradient {
  type: "GRADIENT_LINEAR" | "GRADIENT_RADIAL";
  stops: Array<{ color: string; position: number }>;
  angle?: number;
  direction?: string;
}

/**
 * Parse a CSS `linear-gradient(...)` / `radial-gradient(...)` (`repeating-` is not
 * supported). Accepts an angle (`45deg`, `0.25turn`, …) or a
 * `to …` keyword, positionless stops (distributed per CSS), fractional percentages
 * and two-position stops (`red 10% 20%`). Returns null when nothing usable parses.
 */
export function parseCssGradient(value: string): ParsedCssGradient | null {
  const m = String(value)
    .trim()
    .match(/^(linear|radial)-gradient\(([\s\S]+)\)$/i);
  if (!m) return null;
  const type = m[1].toLowerCase() === "linear" ? "GRADIENT_LINEAR" : "GRADIENT_RADIAL";
  const parts = splitTopLevel(m[2], ",");
  if (parts.length === 0) return null;

  let angle: number | undefined;
  let direction: string | undefined;
  const first = parts[0].trim();
  if (type === "GRADIENT_LINEAR") {
    const a = parseAngleToken(first);
    if (a !== null) {
      angle = a;
      parts.shift();
    } else if (/^to\s+/i.test(first) && isGradientDirection(first)) {
      direction = first.toLowerCase().replace(/\s+/g, " ");
      parts.shift();
    }
  } else if (/\b(circle|ellipse|at|closest|farthest)\b/i.test(first)) {
    // radial shape/position prelude — not a stop
    parts.shift();
  }

  const raw: Array<{ color: string; position?: number | null }> = [];
  for (const part of parts) {
    const tokens = splitTopLevel(part, " ");
    const positions: number[] = [];
    while (tokens.length > 1) {
      const last = tokens[tokens.length - 1];
      const pm = last.match(/^(-?\d*\.?\d+)%$/);
      if (!pm) break;
      positions.unshift(parseFloat(pm[1]) / 100);
      tokens.pop();
    }
    const color = tokens.join(" ").trim();
    if (!color) continue;
    if (positions.length === 0) raw.push({ color, position: null });
    else for (const p of positions) raw.push({ color, position: p });
  }
  if (raw.length === 0) return null;

  const stops = distributeStopPositions(raw).map((s) => ({ color: s.color, position: s.position }));
  const result: ParsedCssGradient = { type, stops };
  if (angle !== undefined) result.angle = angle;
  if (direction !== undefined) result.direction = direction;
  return result;
}
