import { FigmaNodeLike } from "./figma-to-css-rows.js";

export interface DomRect {
  idx: number;
  parent: number;
  tag: string;
  id: string | null;
  testId: string | null;
  depth: number;
  rect: { x: number; y: number; w: number; h: number };
  selector: string | null;
  text: string | null;
}

export interface FigmaCandidate {
  id: string;
  name?: string;
  type?: string;
  parentId?: string;
  rect: { x: number; y: number; w: number; h: number };
  hasText: boolean;
}

export interface MatchPair {
  figmaId: string;
  figmaName?: string;
  figmaType?: string;
  selector: string | null;
  domIdx: number;
  tag: string;
  cost: number;
  iou: number;
}

export interface FrameAuditResult {
  matched: MatchPair[];
  unmatchedFigma: FigmaCandidate[];
  unmatchedDom: DomRect[];
  rootSelector: string | null;
}

// Flatten a Figma node tree to candidates that have a bounding box.
// Skips fully transparent / zero-size nodes.
export function flattenFigmaCandidates(root: FigmaNodeLike): FigmaCandidate[] {
  const out: FigmaCandidate[] = [];

  function visit(node: FigmaNodeLike, parentId: string | undefined) {
    if (!node.id) return;
    const bbox = node.absoluteBoundingBox;
    if (bbox && bbox.width > 0 && bbox.height > 0) {
      out.push({
        id: node.id,
        name: node.name,
        type: node.type,
        parentId,
        rect: { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height },
        hasText: node.type === "TEXT" || !!node.children?.some(hasTextDescendant),
      });
    }
    if (node.children?.length) {
      for (const c of node.children) visit(c, node.id);
    }
  }

  function hasTextDescendant(n: FigmaNodeLike): boolean {
    if (n.type === "TEXT") return true;
    return !!n.children?.some(hasTextDescendant);
  }

  visit(root, undefined);
  return out;
}

// Pixel-space rect after translating into the root frame's local coordinate space.
function toLocal(rect: { x: number; y: number; w: number; h: number }, origin: { x: number; y: number }) {
  return { x: rect.x - origin.x, y: rect.y - origin.y, w: rect.w, h: rect.h };
}

function iou(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

function centerDist(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  const dx = a.x + a.w / 2 - (b.x + b.w / 2);
  const dy = a.y + a.h / 2 - (b.y + b.h / 2);
  return Math.sqrt(dx * dx + dy * dy);
}

function sizeDelta(a: { w: number; h: number }, b: { w: number; h: number }) {
  return (Math.abs(a.w - b.w) + Math.abs(a.h - b.h)) / 2;
}

// Cost combines center distance (px) + size mismatch (px) + small text-mismatch penalty.
// Both rects must already be in the same coordinate system (root-frame local).
function cost(
  f: FigmaCandidate,
  d: DomRect,
  fLocal: { x: number; y: number; w: number; h: number },
  dLocal: { x: number; y: number; w: number; h: number },
  frameSize: { w: number; h: number },
) {
  const center = centerDist(fLocal, dLocal);
  const size = sizeDelta(fLocal, dLocal);
  const diag = Math.sqrt(frameSize.w ** 2 + frameSize.h ** 2) || 1;
  const norm = (center + size) / diag;

  let penalty = 0;
  if (f.hasText && !d.text) penalty += 0.05;
  if (!f.hasText && d.text && d.tag !== "img" && d.tag !== "svg") penalty += 0.02;
  return norm + penalty;
}

// O(n^3) Hungarian — fine for the small N we see per subtree.
// Returns assignment: rows[i] = colIdx (or -1 if unassigned).
export function hungarian(costMatrix: number[][]): number[] {
  const n = costMatrix.length;
  if (n === 0) return [];
  const m = costMatrix[0].length;
  const INF = 1e15;
  const size = Math.max(n, m);
  // Pad to square with INF.
  const a: number[][] = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => (i < n && j < m ? costMatrix[i][j] : INF)),
  );

  const u = new Array(size + 1).fill(0);
  const v = new Array(size + 1).fill(0);
  const p = new Array(size + 1).fill(0);
  const way = new Array(size + 1).fill(0);

  for (let i = 1; i <= size; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(size + 1).fill(INF);
    const used = new Array(size + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= size; j++) {
        if (used[j]) continue;
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= size; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = new Array(n).fill(-1);
  for (let j = 1; j <= size; j++) {
    if (p[j] - 1 < n && j - 1 < m && a[p[j] - 1][j - 1] < INF) {
      assignment[p[j] - 1] = j - 1;
    }
  }
  return assignment;
}

export interface AuditOptions {
  // Skip matches whose normalized cost exceeds this threshold.
  maxCost?: number;
  // Skip matches whose IoU is below this threshold.
  minIou?: number;
  // Pixels (Figma-space) to subtract from every Figma y coordinate before matching.
  // Use to strip iOS status bar / browser chrome that's baked into mobile frames.
  cropTop?: number;
  // Pixels to subtract from the bottom of the Figma frame (effectively shrinks frame height).
  cropBottom?: number;
}

// Match Figma candidates to DOM rects hierarchically. The root Figma frame is
// matched to the DOM root (already chosen by caller). For each subtree level,
// we run Hungarian on the children of the matched parents.
export function auditFrame(
  frameNode: FigmaNodeLike,
  rootDomIdx: number,
  domRects: DomRect[],
  options: AuditOptions = {},
): FrameAuditResult {
  const maxCost = options.maxCost ?? 0.15;
  const minIou = options.minIou ?? 0.05;
  const cropTop = options.cropTop ?? 0;
  const cropBottom = options.cropBottom ?? 0;

  const figmaRoot = frameNode;
  const rawOrigin = figmaRoot.absoluteBoundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
  // Shift origin down by cropTop and shrink height by (cropTop + cropBottom) so the
  // "effective" Figma frame matches the visible browser viewport.
  const figmaOrigin = {
    x: rawOrigin.x,
    y: rawOrigin.y + cropTop,
    width: rawOrigin.width,
    height: Math.max(1, rawOrigin.height - cropTop - cropBottom),
  };
  const domRoot = domRects[rootDomIdx];
  const domOriginRect = domRoot?.rect ?? { x: 0, y: 0, w: 0, h: 0 };

  const figByParent = new Map<string | undefined, FigmaCandidate[]>();
  const figParentOf = new Map<string, string | undefined>();
  const candidates = flattenFigmaCandidates(figmaRoot);
  for (const c of candidates) {
    figParentOf.set(c.id, c.parentId);
    if (c.id === figmaRoot.id) continue;
    const key = c.parentId;
    if (!figByParent.has(key)) figByParent.set(key, []);
    figByParent.get(key)!.push(c);
  }

  const domChildrenByParent = new Map<number, number[]>();
  for (const d of domRects) {
    if (!domChildrenByParent.has(d.parent)) domChildrenByParent.set(d.parent, []);
    domChildrenByParent.get(d.parent)!.push(d.idx);
  }

  const figmaIdToDomIdx = new Map<string, number>();
  figmaIdToDomIdx.set(figmaRoot.id!, rootDomIdx);

  const matched: MatchPair[] = [];
  const unmatchedFigma: FigmaCandidate[] = [];
  const matchedDomIdxs = new Set<number>([rootDomIdx]);

  // Walk up the Figma ancestor chain until we hit a node with a DOM match; fall
  // back to the root DOM idx if none up the chain has matched yet.
  function nearestMatchedDomIdx(figmaId: string): number {
    let cur: string | undefined = figmaId;
    while (cur !== undefined) {
      const idx = figmaIdToDomIdx.get(cur);
      if (idx !== undefined) return idx;
      cur = figParentOf.get(cur);
    }
    return rootDomIdx;
  }

  // BFS over Figma tree by parent IDs.
  const queue: string[] = [figmaRoot.id!];
  while (queue.length) {
    const parentFigmaId = queue.shift()!;
    const figmaChildren = figByParent.get(parentFigmaId) ?? [];
    if (figmaChildren.length === 0) continue;

    // If the figma parent didn't match a DOM element, climb to the nearest
    // matched ancestor so its children still get a chance. Without this,
    // a single bad match cascades into every descendant being unmatched.
    const parentDomIdx = nearestMatchedDomIdx(parentFigmaId);

    // DOM candidate pool = descendants of parent's DOM element, exclude already matched.
    const descendants: number[] = [];
    const stack = [...(domChildrenByParent.get(parentDomIdx) ?? [])];
    while (stack.length) {
      const idx = stack.pop()!;
      if (matchedDomIdxs.has(idx)) continue;
      descendants.push(idx);
      const kids = domChildrenByParent.get(idx) ?? [];
      for (const k of kids) stack.push(k);
    }
    if (descendants.length === 0) {
      for (const f of figmaChildren) {
        unmatchedFigma.push(f);
        // Still enqueue so grandchildren can try via the fallback pool.
        queue.push(f.id);
      }
      continue;
    }

    // Translate Figma rects into root frame local coords.
    const frameSize = { w: figmaOrigin.width, h: figmaOrigin.height };
    const figmaLocals = figmaChildren.map((c) => toLocal(c.rect, figmaOrigin));

    // Translate DOM rects into root DOM local coords + scale.
    const scaleX = figmaOrigin.width > 0 && domOriginRect.w > 0 ? figmaOrigin.width / domOriginRect.w : 1;
    const scaleY = figmaOrigin.height > 0 && domOriginRect.h > 0 ? figmaOrigin.height / domOriginRect.h : 1;
    const domLocals = descendants.map((idx) => {
      const r = domRects[idx].rect;
      return {
        idx,
        rect: {
          x: (r.x - domOriginRect.x) * scaleX,
          y: (r.y - domOriginRect.y) * scaleY,
          w: r.w * scaleX,
          h: r.h * scaleY,
        },
      };
    });

    const costMatrix: number[][] = figmaChildren.map((f, i) =>
      domLocals.map((d) => cost(f, domRects[d.idx], figmaLocals[i], d.rect, frameSize)),
    );
    const assignment = hungarian(costMatrix);

    for (let i = 0; i < figmaChildren.length; i++) {
      const f = figmaChildren[i];
      const col = assignment[i];
      // Always enqueue so descendants still get processed even when the parent
      // failed to find a DOM mate.
      queue.push(f.id);

      if (col === -1) {
        unmatchedFigma.push(f);
        continue;
      }
      const c = costMatrix[i][col];
      const local = domLocals[col];
      const overlap = iou(figmaLocals[i], local.rect);
      if (c > maxCost || overlap < minIou) {
        unmatchedFigma.push(f);
        continue;
      }
      const d = domRects[local.idx];
      figmaIdToDomIdx.set(f.id, d.idx);
      matchedDomIdxs.add(d.idx);
      matched.push({
        figmaId: f.id,
        figmaName: f.name,
        figmaType: f.type,
        selector: d.selector,
        domIdx: d.idx,
        tag: d.tag,
        cost: parseFloat(c.toFixed(3)),
        iou: parseFloat(overlap.toFixed(3)),
      });
    }
  }

  const unmatchedDom = domRects.filter((d) => !matchedDomIdxs.has(d.idx) && d.idx !== rootDomIdx);
  return {
    matched,
    unmatchedFigma,
    unmatchedDom,
    rootSelector: domRoot?.selector ?? null,
  };
}
