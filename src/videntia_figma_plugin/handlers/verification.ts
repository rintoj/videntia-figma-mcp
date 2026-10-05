/**
 * Verification handlers (§7).
 *
 * These stay deliberately thin: they COLLECT raw data out of the Figma
 * document and hand it to the MCP server, which does the arithmetic in
 * src/videntia_figma_mcp/utils/verification-math.ts (unit-tested there).
 */

import { lintFrame } from "./lint/index";
import { extractImagePaintFields } from "./node-serializer";
import { customBase64Encode } from "../utils/base64";
import { fontWeightFromStyle } from "../../videntia_figma_mcp/utils/font-weight";

const MAX_VERIFY_NODES = 6000;
/** Nodes serialised into one text node's backdrop stack (siblings + their descendants). */
const STACK_NODE_CAP = 80;
const STACK_DEPTH_CAP = 6;
const MAX_TEXT_SEGMENTS = 60;
/** Image bytes shipped for backdrop sampling: total budget and distinct-image cap. */
export const MAX_IMAGE_BYTES_TOTAL = 20 * 1024 * 1024;
export const MAX_IMAGES = 24;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The slice of a Figma node the backdrop-stack walk reads. Real SceneNodes
 * satisfy it structurally; unit tests pass plain objects.
 */
export interface StackSourceNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: string;
  rotation?: number;
  isMask?: boolean;
  clipsContent?: boolean;
  absoluteBoundingBox?: Box | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fills?: unknown;
  backgrounds?: unknown;
  children?: ReadonlyArray<StackSourceNode>;
  parent?: StackSourceNode | null;
}

export interface SerializedStackNode {
  nodeId: string;
  nodeName: string;
  nodeType?: string;
  opacity?: number;
  blendMode?: string;
  bounds?: Box;
  /** Node rotation in degrees, when non-zero (bounds are then axis-aligned). */
  rotation?: number;
  fills?: unknown[];
  clips?: boolean;
  children?: SerializedStackNode[];
  target?: boolean;
}

function boundsOf(node: SceneNode | StackSourceNode): Box {
  try {
    const bb = (node as StackSourceNode).absoluteBoundingBox;
    if (bb) return { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
  } catch (_e) {}
  const n = node as StackSourceNode;
  return { x: n.x || 0, y: n.y || 0, width: n.width || 0, height: n.height || 0 };
}

// figma.mixed is a symbol, so the Array.isArray guard also rejects it.
export function serializePaints(paints: unknown): unknown[] {
  if (!paints || !Array.isArray(paints)) return [];
  const out: unknown[] = [];
  for (const p of paints as ReadonlyArray<Paint>) {
    const base: Record<string, unknown> = {
      type: p.type,
      visible: p.visible !== false,
      opacity: p.opacity === undefined ? 1 : p.opacity,
    };
    const blend = (p as Paint & { blendMode?: string }).blendMode;
    if (blend && blend !== "NORMAL") base.blendMode = blend;
    if (p.type === "SOLID") {
      const s = p as SolidPaint;
      base.color = { r: s.color.r, g: s.color.g, b: s.color.b, a: 1 };
    } else if (String(p.type).indexOf("GRADIENT_") === 0) {
      const g = p as GradientPaint;
      base.gradientStops = (g.gradientStops || []).map((st) => ({
        position: st.position,
        color: { r: st.color.r, g: st.color.g, b: st.color.b, a: st.color.a },
      }));
      const handles = (g as unknown as { gradientHandlePositions?: ReadonlyArray<{ x: number; y: number }> })
        .gradientHandlePositions;
      base.gradientHandlePositions = (handles || []).map((h) => ({ x: h.x, y: h.y }));
    } else if (p.type === "IMAGE") {
      const img = p as ImagePaint;
      if (img.imageHash) base.imageHash = img.imageHash;
      base.scaleMode = img.scaleMode;
      if (typeof img.scalingFactor === "number") base.scalingFactor = img.scalingFactor;
      if (typeof img.rotation === "number" && img.rotation !== 0) base.rotation = img.rotation;
      if (img.imageTransform) {
        base.imageTransform = img.imageTransform.map((row) => [row[0], row[1], row[2]]);
      }
      const filters: Record<string, number> = {};
      const f = (img.filters || {}) as Record<string, number | undefined>;
      for (const k of Object.keys(f)) {
        const v = f[k];
        if (typeof v === "number" && v !== 0) filters[k] = v;
      }
      if (Object.keys(filters).length > 0) base.filters = filters;
    }
    out.push(base);
  }
  return out;
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function describeStackNode(node: StackSourceNode): SerializedStackNode {
  const out: SerializedStackNode = {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    bounds: boundsOf(node),
  };
  try {
    if (typeof node.opacity === "number" && node.opacity !== 1) out.opacity = node.opacity;
    if (typeof node.rotation === "number" && Math.abs(node.rotation) > 0.01) out.rotation = node.rotation;
    if (node.blendMode && node.blendMode !== "NORMAL" && node.blendMode !== "PASS_THROUGH") {
      out.blendMode = node.blendMode;
    }
    const fills = serializePaints(node.fills);
    if (fills.length > 0) out.fills = fills;
    if (node.clipsContent === true) out.clips = true;
  } catch (_e) {}
  return out;
}

// Glyph fills and hairlines never form a backdrop for text painted above them.
const NON_BACKDROP_TYPES: Record<string, boolean> = { TEXT: true, LINE: true, CONNECTOR: true, STICKY: true };

function snapshotBelow(
  node: StackSourceNode,
  region: Box,
  depth: number,
  budget: { left: number; partial: boolean },
): SerializedStackNode | null {
  if (node.visible === false || node.isMask === true || NON_BACKDROP_TYPES[node.type]) return null;
  if (!intersects(boundsOf(node), region)) return null;
  if (budget.left <= 0) {
    budget.partial = true;
    return null;
  }
  budget.left--;
  const out = describeStackNode(node);
  const kids = node.children;
  if (kids && kids.length > 0 && node.type !== "BOOLEAN_OPERATION") {
    if (depth >= STACK_DEPTH_CAP) {
      budget.partial = true;
    } else {
      const children: SerializedStackNode[] = [];
      for (const k of kids) {
        const s = snapshotBelow(k, region, depth + 1, budget);
        if (s) children.push(s);
      }
      if (children.length > 0) out.children = children;
    }
  }
  return out.fills || out.children ? out : null;
}

/**
 * The paint stack beneath a text node, in paint order: the page background,
 * every ancestor (fills, opacity, clipping) and — at each level — the
 * siblings painted BELOW the current node that overlap the text box,
 * recursing into their descendants. The text itself is the `target` leaf.
 */
export function buildBackdropStack(target: StackSourceNode): { stack: SerializedStackNode; partial: boolean } {
  const region = boundsOf(target);
  const budget = { left: STACK_NODE_CAP, partial: false };
  let node: SerializedStackNode = { ...describeStackNode(target), target: true };
  delete node.fills;
  let current: StackSourceNode = target;
  let guard = 0;
  while (current.parent && guard++ < 60) {
    const parent: StackSourceNode = current.parent;
    const siblings = parent.children || [];
    const below: SerializedStackNode[] = [];
    const idx = siblings.indexOf(current);
    for (let i = 0; i < idx; i++) {
      const s = snapshotBelow(siblings[i], region, 1, budget);
      if (s) below.push(s);
    }
    if (parent.type === "PAGE" || parent.type === "DOCUMENT") {
      const root: SerializedStackNode = { nodeId: parent.id, nodeName: parent.name, nodeType: parent.type };
      const backgrounds = serializePaints(parent.backgrounds);
      if (backgrounds.length > 0) root.fills = backgrounds;
      root.children = [...below, node];
      return { stack: root, partial: budget.partial };
    }
    const wrap = describeStackNode(parent);
    wrap.children = [...below, node];
    node = wrap;
    current = parent;
  }
  return { stack: { nodeId: "root", nodeName: "Root", children: [node] }, partial: budget.partial };
}

function weightOfFontName(fn: unknown): { weight?: number; style?: string } {
  if (!fn || typeof fn !== "object") return {};
  const style = (fn as FontName).style || "";
  return { weight: fontWeightFromStyle(style), style };
}

/** Styled ranges of a mixed text node, or undefined when the node is uniform. */
function textSegmentsOf(t: TextNode): unknown[] | undefined {
  let mixed = false;
  try {
    mixed = t.fills === figma.mixed || t.fontSize === figma.mixed || t.fontName === figma.mixed;
  } catch (_e) {}
  if (!mixed || typeof t.getStyledTextSegments !== "function") return undefined;
  try {
    const segs = t.getStyledTextSegments(["fills", "fontSize", "fontName"]);
    return segs.slice(0, MAX_TEXT_SEGMENTS).map((s) => {
      const fw = weightOfFontName(s.fontName);
      return {
        start: s.start,
        end: s.end,
        characters: (s.characters || "").slice(0, 40),
        fontSize: s.fontSize,
        fontWeight: fw.weight,
        fontStyle: fw.style,
        fills: serializePaints(s.fills),
      };
    });
  } catch (_e) {
    return undefined;
  }
}

// ── contrast_check_frame ─────────────────────────────────────────────────────

function hashesInPaints(paints: unknown, into: string[]): void {
  if (!Array.isArray(paints)) return;
  for (const p of paints as Array<Record<string, unknown>>) {
    if (!p || p.type !== "IMAGE" || p.visible === false || p.opacity === 0) continue;
    const hash = p.imageHash;
    if (typeof hash === "string" && hash && into.indexOf(hash) === -1) into.push(hash);
  }
}

function hashesInStack(node: SerializedStackNode | undefined, into: string[]): void {
  if (!node) return;
  hashesInPaints(node.fills, into);
  for (const c of node.children || []) hashesInStack(c, into);
}

/** Every distinct image hash a sample's backdrop stack or text fill could paint, in first-seen order. */
export function collectImageHashes(samples: ReadonlyArray<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const s of samples) {
    hashesInStack(s.stack as SerializedStackNode | undefined, out);
    hashesInPaints(s.fills, out);
    for (const seg of (s.segments as Array<Record<string, unknown>> | undefined) || []) hashesInPaints(seg.fills, out);
  }
  return out;
}

export type BackdropImagePayload = { base64: string; bytes: number } | { error: string };

/**
 * Raw bytes of each image so the server can sample the pixels behind text.
 * Raw bytes (not a node export) keep the image paint separable from the
 * node's other fills, strokes and effects, so it composites in paint order
 * like every other layer. Deduped by hash and capped by count and total size.
 */
export async function fetchBackdropImages(hashes: string[]): Promise<Record<string, BackdropImagePayload>> {
  const out: Record<string, BackdropImagePayload> = {};
  let total = 0;
  let count = 0;
  for (const hash of hashes) {
    if (count >= MAX_IMAGES) {
      out[hash] = { error: `image budget exceeded (more than ${MAX_IMAGES} distinct images)` };
      continue;
    }
    try {
      const image = figma.getImageByHash(hash);
      if (!image) {
        out[hash] = { error: "image not found in this file" };
        continue;
      }
      const bytes = await image.getBytesAsync();
      if (total + bytes.byteLength > MAX_IMAGE_BYTES_TOTAL) {
        out[hash] = {
          error: `image budget exceeded (${Math.round(bytes.byteLength / 1024)}KB would pass the ${MAX_IMAGE_BYTES_TOTAL / 1024 / 1024}MB cap)`,
        };
        continue;
      }
      total += bytes.byteLength;
      count++;
      out[hash] = { base64: customBase64Encode(bytes), bytes: bytes.byteLength };
    } catch (e) {
      out[hash] = { error: `image fetch failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160) };
    }
  }
  return out;
}

export async function contrastCheckFrame(params: Record<string, unknown>): Promise<unknown> {
  const nodeId = params && (params["nodeId"] as string);
  if (!nodeId) throw new Error("nodeId is required");
  const includeHidden = params && params["include_hidden"] === true;

  const root = await figma.getNodeByIdAsync(String(nodeId));
  if (!root) throw new Error("Node not found: " + String(nodeId).substring(0, 50));

  const samples: unknown[] = [];
  const stack: SceneNode[] = [root as SceneNode];
  let scanned = 0;
  while (stack.length > 0 && scanned < MAX_VERIFY_NODES) {
    const node = stack.pop() as SceneNode;
    scanned++;
    if (!includeHidden && (node as SceneNode & { visible?: boolean }).visible === false) continue;
    if (node.type === "TEXT") {
      const t = node as TextNode;
      let fontSize = 16;
      try {
        if (t.fontSize !== figma.mixed) fontSize = t.fontSize as number;
      } catch (_e) {}
      let fw: { weight?: number; style?: string } = {};
      try {
        fw = weightOfFontName(t.fontName);
      } catch (_e) {}
      const backdrop = buildBackdropStack(t as unknown as StackSourceNode);
      const sample: Record<string, unknown> = {
        nodeId: t.id,
        nodeName: t.name,
        characters: (() => {
          try {
            return t.characters || "";
          } catch (_e) {
            return "";
          }
        })(),
        fontSize,
        fontWeight: fw.weight,
        fontStyle: fw.style,
        opacity: (t as SceneNode & { opacity?: number }).opacity,
        bounds: boundsOf(t),
        fills: serializePaints(t.fills),
        stack: backdrop.stack,
      };
      const segments = textSegmentsOf(t);
      if (segments) sample.segments = segments;
      if (backdrop.partial) sample.stackPartial = true;
      samples.push(sample);
    }
    const children = (node as SceneNode & { children?: ReadonlyArray<SceneNode> }).children;
    if (children) for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }

  const hashes = collectImageHashes(samples as Array<Record<string, unknown>>);
  const images = hashes.length > 0 ? await fetchBackdropImages(hashes) : undefined;

  return {
    nodeId: root.id,
    nodeName: root.name,
    nodesScanned: scanned,
    truncated: scanned >= MAX_VERIFY_NODES,
    samples,
    ...(images ? { images } : {}),
  };
}

// ── find_overlaps ────────────────────────────────────────────────────────────

export async function findOverlaps(params: Record<string, unknown>): Promise<unknown> {
  const nodeId = params && ((params["frameId"] as string) || (params["nodeId"] as string));
  if (!nodeId) throw new Error("frameId is required");
  const ignoreHidden = !(params && params["ignore_hidden"] === false);

  const root = await figma.getNodeByIdAsync(String(nodeId));
  if (!root) throw new Error("Node not found: " + String(nodeId).substring(0, 50));

  const nodes: unknown[] = [];
  const stack: Array<{ node: SceneNode; parent: SceneNode | null }> = [{ node: root as SceneNode, parent: null }];
  let scanned = 0;
  while (stack.length > 0 && scanned < MAX_VERIFY_NODES) {
    const entry = stack.pop() as { node: SceneNode; parent: SceneNode | null };
    const node = entry.node;
    scanned++;
    const visible = (node as SceneNode & { visible?: boolean }).visible !== false;
    if (ignoreHidden && !visible) continue;
    if (entry.parent) {
      nodes.push({
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        visible,
        bounds: boundsOf(node),
        parentId: entry.parent.id,
        parentName: entry.parent.name,
      });
    }
    const children = (node as SceneNode & { children?: ReadonlyArray<SceneNode> }).children;
    if (children) for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], parent: node });
  }

  return { nodeId: root.id, nodeName: root.name, nodesScanned: scanned, nodes };
}

// ── assert_node_state ────────────────────────────────────────────────────────

const ASSERT_COLOR_KEYS: Record<string, "fills" | "strokes"> = {
  fill: "fills",
  fills: "fills",
  stroke: "strokes",
  strokes: "strokes",
};

function readProperty(node: SceneNode, key: string): unknown {
  const paintKey = ASSERT_COLOR_KEYS[key];
  if (paintKey) {
    try {
      const paints = (node as unknown as Record<string, unknown>)[paintKey];
      if (!paints || paints === (figma.mixed as unknown) || !Array.isArray(paints)) return undefined;
      const first = (paints as ReadonlyArray<Paint>)[0];
      if (first && first.type === "SOLID") {
        const c = (first as SolidPaint).color;
        return { r: c.r, g: c.g, b: c.b, a: first.opacity === undefined ? 1 : first.opacity };
      }
      if (first && first.type === "IMAGE") {
        const out: Record<string, unknown> = { type: "IMAGE" };
        extractImagePaintFields(first as ImagePaint, out);
        return out;
      }
      return first ? { type: first.type } : undefined;
    } catch (_e) {
      return undefined;
    }
  }
  if (key === "boundVariables") {
    try {
      return (node as unknown as { boundVariables?: unknown }).boundVariables;
    } catch (_e) {
      return undefined;
    }
  }
  try {
    const value = (node as unknown as Record<string, unknown>)[key];
    if (value === figma.mixed) return "MIXED";
    if (typeof value === "function") return undefined;
    return value;
  } catch (_e) {
    return undefined;
  }
}

export async function assertNodeState(params: Record<string, unknown>): Promise<unknown> {
  const nodeId = params && (params["nodeId"] as string);
  if (!nodeId) throw new Error("nodeId is required");
  const expected = (params && (params["expected"] as Record<string, unknown>)) || {};
  if (Object.keys(expected).length === 0) throw new Error("expected must be a non-empty object of property → value");

  const node = await figma.getNodeByIdAsync(String(nodeId));
  if (!node) throw new Error("Node not found: " + String(nodeId).substring(0, 50));

  const actual: Record<string, unknown> = {};
  for (const key of Object.keys(expected)) {
    actual[key] = readProperty(node as SceneNode, key);
  }

  return { nodeId: node.id, nodeName: node.name, nodeType: node.type, expected, actual };
}

// ── find_unbound ─────────────────────────────────────────────────────────────

export async function findUnbound(params: Record<string, unknown>): Promise<unknown> {
  const nodeId = params && ((params["frameId"] as string) || (params["nodeId"] as string));
  if (!nodeId) throw new Error("frameId is required");

  // Reuse the lint traversal rather than writing a second one — only the
  // token-binding checks matter here.
  const lint = await lintFrame({
    nodeId,
    ignore_rules: params ? params["ignore_rules"] : undefined,
    checks: {
      rootFrame: false,
      colors: true,
      spacing: true,
      radius: true,
      textStyles: true,
      effectStyles: true,
      autoLayout: false,
      overflow: false,
      screenNaming: false,
      clippedCorners: false,
      radiusProportion: false,
      crossAxisAlign: false,
      iconColorConsistency: false,
      fixedWidthSlack: false,
    },
  } as unknown as Record<string, unknown>);

  const ROLE_OF: Record<string, string> = {
    backgroundFills: "fill",
    iconColors: "fill",
    strokesBorders: "stroke",
    borderRadius: "radius",
    spacing: "spacing",
    typography: "typography",
    effectStyles: "effect",
  };

  const groups: Record<string, Array<Record<string, unknown>>> = {};
  for (const v of lint.violations) {
    const role = ROLE_OF[v.category];
    if (!role) continue;
    if (!groups[role]) groups[role] = [];
    groups[role].push({
      nodeId: v.nodeId,
      nodeName: v.nodeName,
      nodeType: v.nodeType,
      property: v.property,
      severity: v.severity,
      message: v.message,
    });
  }

  return {
    nodeId: lint.nodeId,
    nodeName: lint.nodeName,
    totalNodes: lint.totalNodes,
    groups,
    totalUnbound: Object.keys(groups).reduce((sum, k) => sum + groups[k].length, 0),
    suppressed: lint.summary.suppressed || 0,
    capped: lint.violationsCapped,
  };
}

// ── check_token_collisions ───────────────────────────────────────────────────

export async function checkTokenCollisions(_params: Record<string, unknown>): Promise<unknown> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const records: unknown[] = [];

  for (const collection of collections) {
    const modeNameById: Record<string, string> = {};
    for (const mode of collection.modes) modeNameById[mode.modeId] = mode.name;

    for (const variableId of collection.variableIds) {
      let variable: Variable | null = null;
      try {
        variable = await figma.variables.getVariableByIdAsync(variableId);
      } catch (_e) {}
      if (!variable) continue;

      const valuesByMode: Record<string, unknown> = {};
      for (const modeId of Object.keys(variable.valuesByMode || {})) {
        const raw = variable.valuesByMode[modeId];
        const label = modeNameById[modeId] || modeId;
        if (raw && typeof raw === "object" && "type" in (raw as unknown as Record<string, unknown>)) {
          // VariableAlias — record the alias target so aliases never look like
          // a literal-value collision.
          valuesByMode[label] = { alias: (raw as unknown as VariableAlias).id };
        } else {
          valuesByMode[label] = raw;
        }
      }

      records.push({
        collectionId: collection.id,
        collectionName: collection.name,
        variableId: variable.id,
        name: variable.name,
        resolvedType: variable.resolvedType,
        valuesByMode,
      });
    }
  }

  return { collections: collections.length, variables: records.length, records };
}
