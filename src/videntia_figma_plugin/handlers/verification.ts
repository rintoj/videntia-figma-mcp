/**
 * Verification handlers (§7).
 *
 * These stay deliberately thin: they COLLECT raw data out of the Figma
 * document and hand it to the MCP server, which does the arithmetic in
 * src/videntia_figma_mcp/utils/verification-math.ts (unit-tested there).
 */

import { lintFrame } from "./lint/index";

const MAX_VERIFY_NODES = 6000;

function boundsOf(node: SceneNode): { x: number; y: number; width: number; height: number } {
  try {
    const bb = (node as SceneNode & { absoluteBoundingBox?: Rect | null }).absoluteBoundingBox;
    if (bb) return { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
  } catch (_e) {}
  const n = node as SceneNode & { x?: number; y?: number; width?: number; height?: number };
  return { x: n.x || 0, y: n.y || 0, width: n.width || 0, height: n.height || 0 };
}

function serializePaints(paints: unknown): unknown[] {
  if (!paints || paints === (figma.mixed as unknown) || !Array.isArray(paints)) return [];
  const out: unknown[] = [];
  for (const p of paints as ReadonlyArray<Paint>) {
    const base: Record<string, unknown> = {
      type: p.type,
      visible: p.visible !== false,
      opacity: p.opacity === undefined ? 1 : p.opacity,
    };
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
    }
    out.push(base);
  }
  return out;
}

function ancestorBackdrop(node: SceneNode): unknown[] {
  // Innermost → outermost while walking up, reversed before returning.
  const layers: unknown[] = [];
  let current: BaseNode | null = node.parent;
  let guard = 0;
  while (current && current.type !== "PAGE" && current.type !== "DOCUMENT" && guard++ < 60) {
    const scene = current as SceneNode;
    let fills: unknown[] = [];
    try {
      if ("fills" in scene) fills = serializePaints((scene as GeometryMixin).fills);
    } catch (_e) {}
    if (fills.length > 0) {
      layers.push({
        nodeId: scene.id,
        nodeName: scene.name,
        nodeType: scene.type,
        opacity: (scene as SceneNode & { opacity?: number }).opacity,
        bounds: boundsOf(scene),
        fills,
      });
    }
    current = current.parent;
  }
  return layers.reverse();
}

function fontWeightOf(node: TextNode): { weight?: number; style?: string } {
  try {
    const fn = node.fontName;
    if (fn === figma.mixed) return {};
    const style = (fn as FontName).style || "";
    const map: Record<string, number> = {
      thin: 100,
      extralight: 200,
      ultralight: 200,
      light: 300,
      regular: 400,
      normal: 400,
      book: 400,
      medium: 500,
      semibold: 600,
      demibold: 600,
      bold: 700,
      extrabold: 800,
      ultrabold: 800,
      black: 900,
      heavy: 900,
    };
    const key = style.toLowerCase().replace(/\s|italic|oblique/g, "");
    return { weight: map[key], style };
  } catch (_e) {
    return {};
  }
}

// ── contrast_check_frame ─────────────────────────────────────────────────────

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
      let fontSize = 0;
      try {
        fontSize = t.fontSize === figma.mixed ? 16 : (t.fontSize as number);
      } catch (_e) {
        fontSize = 16;
      }
      const fw = fontWeightOf(t);
      samples.push({
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
        backdrop: ancestorBackdrop(t),
      });
    }
    const children = (node as SceneNode & { children?: ReadonlyArray<SceneNode> }).children;
    if (children) for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }

  return {
    nodeId: root.id,
    nodeName: root.name,
    nodesScanned: scanned,
    truncated: scanned >= MAX_VERIFY_NODES,
    samples,
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
