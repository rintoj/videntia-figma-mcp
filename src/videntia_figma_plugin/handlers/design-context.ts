/**
 * get_design_context / get_variables_used.
 *
 * Code-ready, read-only context for a node: layout in flexbox terms, sizes,
 * typography, paints, radius, effects, component info, and every bound
 * variable resolved to its token name AND value. Both walks are capped,
 * yield to Figma every YIELD_EVERY nodes and report `truncated`.
 */

import { getCommandSignal, throwIfCancelled } from "../utils/cancellation";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const YIELD_EVERY = 1000;
export const DEFAULT_CONTEXT_MAX_NODES = 300;
export const DEFAULT_VARIABLES_MAX_NODES = 5000;
export const CSS_TIMEOUT_MS = 1500;
export const CSS_MAX_NODES = 40;

type AnyNode = any;

const yieldToFigma = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function isMixed(v: unknown): boolean {
  return typeof figma !== "undefined" && v === (figma as any).mixed;
}

/** Race a promise against a timeout; resolves undefined on timeout or error. */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p.catch(() => undefined),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const hex2 = (n: number) =>
  Math.round(Math.max(0, Math.min(1, n)) * 255)
    .toString(16)
    .padStart(2, "0");

export function colorToHex(c: { r: number; g: number; b: number; a?: number }, opacity = 1): string {
  const a = (c.a ?? 1) * opacity;
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${a < 0.999 ? hex2(a) : ""}`;
}

// ── variable resolution ─────────────────────────────────────────────────────

export interface ResolvedVariable {
  id: string;
  name: string;
  collection: string;
  type: string;
  valuesByMode: Record<string, string>;
}

function formatVariableValue(v: any, aliasNames: Map<string, string>): string {
  if (v && typeof v === "object") {
    if (v.type === "VARIABLE_ALIAS") return `→ ${aliasNames.get(v.id) ?? v.id}`;
    if ("r" in v && "g" in v && "b" in v) return colorToHex(v);
  }
  return String(v);
}

export class VariableResolver {
  private cache = new Map<string, Promise<ResolvedVariable | null>>();
  private collections = new Map<string, Promise<any>>();

  resolve(id: string): Promise<ResolvedVariable | null> {
    let p = this.cache.get(id);
    if (!p) {
      p = this.load(id);
      this.cache.set(id, p);
    }
    return p;
  }

  private async collection(id: string): Promise<any> {
    let p = this.collections.get(id);
    if (!p) {
      p = Promise.resolve(figma.variables.getVariableCollectionByIdAsync(id)).catch(() => null);
      this.collections.set(id, p);
    }
    return p;
  }

  private async load(id: string): Promise<ResolvedVariable | null> {
    try {
      const v: any = await figma.variables.getVariableByIdAsync(id);
      if (!v) return null;
      const col = await this.collection(v.variableCollectionId);
      const modeNames = new Map<string, string>();
      for (const m of col?.modes ?? []) modeNames.set(m.modeId, m.name);
      const aliasNames = new Map<string, string>();
      for (const val of Object.values(v.valuesByMode ?? {}) as any[]) {
        if (val && typeof val === "object" && val.type === "VARIABLE_ALIAS") {
          const target: any = await Promise.resolve(figma.variables.getVariableByIdAsync(val.id)).catch(() => null);
          if (target) aliasNames.set(val.id, target.name);
        }
      }
      const valuesByMode: Record<string, string> = {};
      for (const [modeId, val] of Object.entries(v.valuesByMode ?? {})) {
        valuesByMode[modeNames.get(modeId) ?? modeId] = formatVariableValue(val, aliasNames);
      }
      return { id, name: v.name, collection: col?.name ?? v.variableCollectionId, type: v.resolvedType, valuesByMode };
    } catch {
      return null;
    }
  }
}

/** Every (field, variableId) binding on a node: fields, paints, effects, text ranges. */
export function collectBindings(node: AnyNode): Array<{ field: string; id: string }> {
  const out: Array<{ field: string; id: string }> = [];
  const push = (field: string, a: any) => {
    if (a && typeof a === "object" && typeof a.id === "string") out.push({ field, id: a.id });
  };
  const bv = node.boundVariables;
  if (bv && typeof bv === "object") {
    for (const [field, val] of Object.entries(bv)) {
      if (field === "fills" || field === "strokes" || field === "effects") continue; // covered per paint below
      if (Array.isArray(val)) val.forEach((a, i) => push(`${field}[${i}]`, a));
      else push(field, val);
    }
  }
  for (const prop of ["fills", "strokes"]) {
    const paints = node[prop];
    if (!Array.isArray(paints)) continue;
    paints.forEach((p: any, i: number) => {
      for (const [k, a] of Object.entries(p?.boundVariables ?? {})) push(`${prop}[${i}].${k}`, a);
    });
  }
  if (Array.isArray(node.effects)) {
    node.effects.forEach((e: any, i: number) => {
      for (const [k, a] of Object.entries(e?.boundVariables ?? {})) push(`effects[${i}].${k}`, a);
    });
  }
  if (node.type === "TEXT" && typeof node.getStyledTextSegments === "function") {
    try {
      const segs = node.getStyledTextSegments(["boundVariables", "fills"]);
      for (const s of segs) {
        for (const [k, a] of Object.entries(s.boundVariables ?? {})) {
          if (Array.isArray(a)) a.forEach((x, i) => push(`text[${s.start}-${s.end}].${k}[${i}]`, x));
          else push(`text[${s.start}-${s.end}].${k}`, a);
        }
        (s.fills ?? []).forEach((p: any, i: number) => {
          for (const [k, a] of Object.entries(p?.boundVariables ?? {}))
            push(`text[${s.start}-${s.end}].fills[${i}].${k}`, a);
        });
      }
    } catch {
      /* segments unavailable; field-level bindings still reported */
    }
  }
  // dedupe identical field/id pairs (paint + range can repeat for single-range text)
  const seen = new Set<string>();
  return out.filter((b) => {
    const k = `${b.field}|${b.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const STYLE_FIELDS: Array<[string, string]> = [
  ["fillStyleId", "PAINT"],
  ["strokeStyleId", "PAINT"],
  ["textStyleId", "TEXT"],
  ["effectStyleId", "EFFECT"],
];

export function collectStyleIds(node: AnyNode): Array<{ field: string; id: string; kind: string }> {
  const out: Array<{ field: string; id: string; kind: string }> = [];
  for (const [field, kind] of STYLE_FIELDS) {
    const v = node[field];
    if (typeof v === "string" && v) out.push({ field, id: v, kind });
  }
  return out;
}

// ── bounded walk ────────────────────────────────────────────────────────────

/** Breadth-first walk with a node cap, depth cap and a yield every YIELD_EVERY nodes. */
export async function walkBounded(
  root: AnyNode,
  opts: { maxNodes: number; maxDepth?: number; includeChildren?: boolean; includeHidden?: boolean },
  visit: (node: AnyNode, depth: number) => void | Promise<void>,
): Promise<{ visited: number; truncated: boolean }> {
  const signal = getCommandSignal();
  throwIfCancelled(signal);
  const queue: Array<[AnyNode, number]> = [[root, 0]];
  let visited = 0;
  let truncated = false;
  while (queue.length) {
    const [node, depth] = queue.shift()!;
    if (visited >= opts.maxNodes) {
      truncated = true;
      break;
    }
    await visit(node, depth);
    visited++;
    if (visited % YIELD_EVERY === 0) {
      await yieldToFigma();
      throwIfCancelled(signal);
    }
    if (opts.includeChildren === false) continue;
    if (!Array.isArray(node.children)) continue;
    if (opts.maxDepth !== undefined && depth >= opts.maxDepth) continue;
    for (const c of node.children) {
      if (!opts.includeHidden && c.visible === false) continue;
      queue.push([c, depth + 1]);
    }
  }
  return { visited, truncated };
}

async function getNode(nodeId: unknown): Promise<AnyNode> {
  if (typeof nodeId !== "string" || !nodeId) throw new Error("Missing nodeId");
  const node = await figma.getNodeByIdAsync(nodeId.replace(/-/g, ":"));
  if (!node) throw new Error(`Node not found: ${nodeId}`);
  return node;
}

// ── get_variables_used ──────────────────────────────────────────────────────

export async function getVariablesUsed(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const root = await getNode(params.nodeId);
  const maxNodes = typeof params.maxNodes === "number" ? params.maxNodes : DEFAULT_VARIABLES_MAX_NODES;
  const includeChildren = params.includeChildren !== false;
  const examplesPer = 5;

  const vars = new Map<string, { count: number; fields: Set<string>; examples: string[] }>();
  const styles = new Map<string, { kind: string; count: number; examples: string[] }>();
  const bump = (m: Map<string, { count: number; examples: string[] }>, id: string, nodeId: string, init: () => any) => {
    let e = m.get(id);
    if (!e) {
      e = init();
      m.set(id, e!);
    }
    e!.count++;
    if (e!.examples.length < examplesPer && !e!.examples.includes(nodeId)) e!.examples.push(nodeId);
    return e!;
  };

  const walk = await walkBounded(root, { maxNodes, includeChildren, includeHidden: true }, (node) => {
    for (const b of collectBindings(node)) {
      const e = bump(vars as any, b.id, node.id, () => ({ count: 0, fields: new Set(), examples: [] })) as any;
      e.fields.add(b.field.replace(/\[\d+(-\d+)?\]/g, "[]"));
    }
    for (const s of collectStyleIds(node))
      bump(styles, s.id, node.id, () => ({ kind: s.kind, count: 0, examples: [] }));
  });

  const resolver = new VariableResolver();
  const variables = [] as Array<Record<string, unknown>>;
  for (const [id, e] of vars) {
    const r = await resolver.resolve(id);
    variables.push({
      id,
      name: r?.name ?? null,
      collection: r?.collection ?? null,
      type: r?.type ?? null,
      valuesByMode: r?.valuesByMode ?? {},
      missing: !r,
      usageCount: e.count,
      fields: [...e.fields].sort(),
      exampleNodeIds: e.examples,
    });
  }
  variables.sort(
    (a: any, b: any) =>
      String(a.collection).localeCompare(String(b.collection)) || String(a.name).localeCompare(String(b.name)),
  );

  const styleRows = [] as Array<Record<string, unknown>>;
  for (const [id, e] of styles) {
    const st: any = await Promise.resolve(figma.getStyleByIdAsync(id)).catch(() => null);
    styleRows.push({
      id,
      kind: e.kind,
      name: st?.name ?? null,
      remote: st?.remote ?? null,
      missing: !st,
      usageCount: e.count,
      exampleNodeIds: e.examples,
    });
  }
  styleRows.sort((a: any, b: any) => a.kind.localeCompare(b.kind) || String(a.name).localeCompare(String(b.name)));

  return {
    nodeId: root.id,
    nodeName: root.name,
    nodesVisited: walk.visited,
    truncated: walk.truncated,
    maxNodes,
    variables,
    styles: styleRows,
  };
}

// ── get_design_context ──────────────────────────────────────────────────────

function paintSummary(p: any, bindings: Map<string, string>, key: string): string | null {
  if (!p || p.visible === false) return null;
  const token = bindings.get(`${key}.color`);
  if (p.type === "SOLID") {
    const hex = colorToHex(p.color, p.opacity ?? 1);
    return token ? `${hex} {${token}}` : hex;
  }
  if (p.type && p.type.startsWith("GRADIENT")) {
    const stops = (p.gradientStops ?? []).map((s: any) => `${colorToHex(s.color)} ${Math.round(s.position * 100)}%`);
    return `${p.type.replace("GRADIENT_", "").toLowerCase()}-gradient(${stops.join(", ")})`;
  }
  if (p.type === "IMAGE") return `image(${p.scaleMode ?? "FILL"})`;
  return p.type ?? null;
}

const num = (v: unknown) => (typeof v === "number" && !isMixed(v) ? Math.round(v * 100) / 100 : undefined);

/** Pure extraction of one node's code-ready properties. `tokens` maps field -> "name = value". */
export function extractNodeContext(node: AnyNode, tokens: Map<string, string>): Record<string, unknown> {
  const ctx: Record<string, unknown> = { id: node.id, name: node.name, type: node.type };
  if (node.visible === false) ctx.hidden = true;
  const w = num(node.width);
  const h = num(node.height);
  if (w !== undefined)
    ctx.size = {
      width: w,
      height: h,
      ...(tokens.has("width") ? { widthToken: tokens.get("width") } : {}),
      ...(tokens.has("height") ? { heightToken: tokens.get("height") } : {}),
    };
  if (num(node.opacity) !== undefined && node.opacity < 1) ctx.opacity = num(node.opacity);

  // layout → flexbox
  if (node.layoutMode && node.layoutMode !== "NONE") {
    const mapAlign = (v: string) =>
      ({ MIN: "flex-start", CENTER: "center", MAX: "flex-end", SPACE_BETWEEN: "space-between", BASELINE: "baseline" })[
        v
      ] ?? v?.toLowerCase();
    const layout: Record<string, unknown> = {
      display: node.layoutMode === "GRID" ? "grid" : "flex",
    };
    if (node.layoutMode !== "GRID") {
      layout.flexDirection = node.layoutMode === "HORIZONTAL" ? "row" : "column";
      layout.justifyContent = mapAlign(node.primaryAxisAlignItems);
      layout.alignItems = mapAlign(node.counterAxisAlignItems);
      if (node.layoutWrap === "WRAP") layout.flexWrap = "wrap";
    }
    const gap = num(node.itemSpacing);
    if (gap) layout.gap = tokens.has("itemSpacing") ? `${gap} {${tokens.get("itemSpacing")}}` : gap;
    const pads = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"].map((k) => {
      const v = num(node[k]) ?? 0;
      return tokens.has(k) ? `${v} {${tokens.get(k)}}` : v;
    });
    if (pads.some((p) => p !== 0)) layout.padding = pads;
    ctx.layout = layout;
  }
  if (node.layoutSizingHorizontal || node.layoutSizingVertical) {
    ctx.sizing = { horizontal: node.layoutSizingHorizontal, vertical: node.layoutSizingVertical };
  }
  if (node.layoutPositioning === "ABSOLUTE") ctx.position = { absolute: true, x: num(node.x), y: num(node.y) };

  // radius
  if (num(node.cornerRadius) !== undefined) {
    if (node.cornerRadius)
      ctx.radius = tokens.has("topLeftRadius")
        ? `${num(node.cornerRadius)} {${tokens.get("topLeftRadius")}}`
        : num(node.cornerRadius);
  } else if (node.topLeftRadius !== undefined) {
    ctx.radius = [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius];
  }

  // paints
  if (node.type !== "TEXT" && Array.isArray(node.fills)) {
    const f = node.fills.map((p: any, i: number) => paintSummary(p, tokens, `fills[${i}]`)).filter(Boolean);
    if (f.length) ctx.fills = f;
  }
  if (Array.isArray(node.strokes) && node.strokes.length) {
    const s = node.strokes.map((p: any, i: number) => paintSummary(p, tokens, `strokes[${i}]`)).filter(Boolean);
    if (s.length) {
      const sw = num(node.strokeWeight);
      ctx.stroke = { paints: s, weight: sw ?? "mixed", align: node.strokeAlign };
    }
  }
  if (Array.isArray(node.effects)) {
    const e = node.effects
      .filter((x: any) => x.visible !== false)
      .map((x: any) =>
        x.type === "DROP_SHADOW" || x.type === "INNER_SHADOW"
          ? `${x.type === "INNER_SHADOW" ? "inset " : ""}${num(x.offset?.x)}px ${num(x.offset?.y)}px ${num(x.radius)}px ${num(x.spread) ?? 0}px ${colorToHex(x.color)}`
          : `${x.type.toLowerCase()}(${num(x.radius)}px)`,
      );
    if (e.length) ctx.effects = e;
  }

  // typography
  if (node.type === "TEXT") {
    const chars: string = node.characters ?? "";
    ctx.text = chars.length > 200 ? `${chars.slice(0, 200)}…` : chars;
    const t: Record<string, unknown> = {};
    const fn = node.fontName;
    if (fn && !isMixed(fn)) {
      t.fontFamily = fn.family;
      t.fontStyle = fn.style;
    } else t.fontFamily = "mixed";
    t.fontSize = num(node.fontSize) ?? "mixed";
    if (num(node.fontWeight) !== undefined) t.fontWeight = num(node.fontWeight);
    const lh = node.lineHeight;
    if (lh && !isMixed(lh))
      t.lineHeight = lh.unit === "AUTO" ? "auto" : lh.unit === "PERCENT" ? `${num(lh.value)}%` : num(lh.value);
    const ls = node.letterSpacing;
    if (ls && !isMixed(ls) && ls.value) t.letterSpacing = ls.unit === "PERCENT" ? `${num(ls.value)}%` : num(ls.value);
    if (node.textAlignHorizontal && node.textAlignHorizontal !== "LEFT")
      t.textAlign = node.textAlignHorizontal.toLowerCase();
    if (node.textCase && !isMixed(node.textCase) && node.textCase !== "ORIGINAL") t.textCase = node.textCase;
    if (Array.isArray(node.fills)) {
      const c = node.fills.map((p: any, i: number) => paintSummary(p, tokens, `fills[${i}]`)).filter(Boolean);
      if (c.length) t.color = c.length === 1 ? c[0] : c;
    } else if (isMixed(node.fills)) t.color = "mixed";
    for (const k of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing"]) {
      if (tokens.has(k)) t[`${k}Token`] = tokens.get(k);
    }
    ctx.typography = t;
  }

  // every other bound token not already inlined
  const inlined =
    /^(fills\[\d+\]\.color|strokes\[\d+\]\.color|itemSpacing|padding(Top|Right|Bottom|Left)|width|height|topLeftRadius|fontFamily|fontSize|fontWeight|lineHeight|letterSpacing)$/;
  const extra: Record<string, string> = {};
  for (const [field, tok] of tokens) if (!inlined.test(field)) extra[field] = tok;
  if (Object.keys(extra).length) ctx.tokens = extra;
  return ctx;
}

async function componentInfo(node: AnyNode): Promise<Record<string, unknown> | undefined> {
  try {
    if (node.type === "INSTANCE") {
      const main: any = await node.getMainComponentAsync();
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node.componentProperties ?? {}) as any)
        props[k.replace(/#\d+:\d+$/, "")] = v?.value;
      return {
        kind: "instance",
        mainComponent: main?.name ?? null,
        mainComponentId: main?.id ?? null,
        componentSet: main?.parent?.type === "COMPONENT_SET" ? main.parent.name : null,
        remote: main?.remote ?? null,
        props,
      };
    }
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      const defs =
        node.type === "COMPONENT" && node.parent?.type === "COMPONENT_SET" ? null : node.componentPropertyDefinitions;
      return {
        kind: node.type === "COMPONENT" ? "component" : "componentSet",
        ...(node.variantProperties ? { variant: node.variantProperties } : {}),
        ...(defs
          ? {
              propertyDefinitions: Object.entries(defs).reduce((acc: Record<string, string>, [k, d]: any) => {
                acc[k.replace(/#\d+:\d+$/, "")] = d.type;
                return acc;
              }, {}),
            }
          : {}),
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function getDesignContext(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const root = await getNode(params.nodeId);
  const maxDepth = typeof params.depth === "number" ? params.depth : 2;
  const maxNodes = typeof params.maxNodes === "number" ? params.maxNodes : DEFAULT_CONTEXT_MAX_NODES;
  const includeCss = params.includeCss !== false;
  const resolver = new VariableResolver();

  const flat: Array<Record<string, unknown>> = [];
  const byId = new Map<string, Record<string, unknown>>();
  const parentOf = new Map<string, string>();
  let cssCount = 0;
  let cssTimeouts = 0;
  let depthTruncated = false;

  const walk = await walkBounded(root, { maxNodes, maxDepth }, async (node, depth) => {
    const tokens = new Map<string, string>();
    for (const b of collectBindings(node)) {
      const r = await resolver.resolve(b.id);
      if (!r) continue;
      const first = Object.values(r.valuesByMode)[0];
      tokens.set(b.field, `${r.name} = ${first ?? "?"}`);
    }
    const ctx = extractNodeContext(node, tokens);
    const comp = await componentInfo(node);
    if (comp) ctx.component = comp;
    if (includeCss && cssCount < CSS_MAX_NODES && typeof node.getCSSAsync === "function") {
      cssCount++;
      const css = await withTimeout<Record<string, string>>(node.getCSSAsync(), CSS_TIMEOUT_MS);
      if (css) ctx.css = css;
      else cssTimeouts++;
    }
    if (depth >= maxDepth && Array.isArray(node.children) && node.children.length) {
      ctx.childCount = node.children.length;
      depthTruncated = true;
    }
    flat.push(ctx);
    byId.set(node.id, ctx);
    for (const c of node.children ?? []) parentOf.set(c.id, node.id);
  });

  // rebuild the tree from the flat BFS list
  for (const ctx of flat) {
    const pid = parentOf.get(ctx.id as string);
    const parent = pid ? byId.get(pid) : undefined;
    if (parent && ctx !== byId.get(root.id)) {
      (parent.children as unknown[] | undefined) ?? (parent.children = []);
      (parent.children as unknown[]).push(ctx);
    }
  }

  return {
    nodeId: root.id,
    nodeName: root.name,
    nodesVisited: walk.visited,
    truncated: walk.truncated,
    depthTruncated,
    maxDepth,
    maxNodes,
    cssUnavailable: cssTimeouts,
    root: byId.get(root.id),
  };
}
