// ---------------------------------------------------------------------------
// Post-write state (`return_state`) — write and verify in ONE round trip
// ---------------------------------------------------------------------------
//
// Mutating commands used to return only a success string, so agents wrote and
// then immediately called get_node_info to check the write had landed. That
// read-back loop is by far the most common adjacent call pair in the telemetry.
//
// With `return_state: true` a mutating command answers with the node's ACTUAL
// post-write state, so the follow-up read is unnecessary — and a write that did
// not apply cannot pretend it did, because the reported value is read off the
// node rather than echoed from the request.
//
// The payload is deliberately tiny (one summary line + only the properties the
// write touched) so this does not reintroduce the verbose-read problem.

import { extractGeometry, formatCompact } from "../../videntia_figma_mcp/utils/compact-node";
import type { WriteNoOp } from "./write-verify";

/** Session default, toggled via the `set_strict_mode` command's `return_state` field. */
const returnStateState = { enabled: false };

export function setReturnStateDefault(enabled: boolean): void {
  returnStateState.enabled = enabled;
}

export function isReturnStateDefault(): boolean {
  return returnStateState.enabled;
}

/** An explicit `return_state` param wins over the session default. */
export function resolveReturnState(params: Record<string, unknown> | null | undefined): boolean {
  if (params !== null && params !== undefined) {
    const raw = params["return_state"] !== undefined ? params["return_state"] : params["returnState"];
    if (raw !== undefined && raw !== null) return raw === true || raw === "true";
  }
  return returnStateState.enabled;
}

/** Params that describe the call rather than a property being written. */
const CONTROL_PARAMS: Record<string, true> = {
  nodeId: true,
  nodeIds: true,
  id: true,
  ids: true,
  parentId: true,
  commandId: true,
  strict: true,
  return_state: true,
  returnState: true,
  checkpoint: true,
  stopOnError: true,
  __expectedFile: true,
};

/**
 * Params whose name differs from the node property they end up writing.
 * Only the aliases that actually appear in the tool surface — an unknown key is
 * simply skipped, never guessed at.
 */
const PARAM_TO_PROPS: Record<string, string[]> = {
  padding: ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
  top: ["paddingTop"],
  right: ["paddingRight"],
  bottom: ["paddingBottom"],
  left: ["paddingLeft"],
  gap: ["itemSpacing"],
  rowGap: ["gridRowGap"],
  columnGap: ["gridColumnGap"],
  text: ["characters"],
  content: ["characters"],
  color: ["fills"],
  radius: ["cornerRadius"],
  layoutSizingHorizontal: ["layoutSizingHorizontal", "width"],
  layoutSizingVertical: ["layoutSizingVertical", "height"],
  width: ["width"],
  height: ["height"],
};

/** Cap the projection so a wide write cannot balloon the response. */
const MAX_PROPS = 14;
const MAX_NODES = 5;

type AnyNode = Record<string, any>;

function isScalar(value: unknown): boolean {
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean" || value === null;
}

/** First fill rendered as a short token, so `fills` is legible without an array dump. */
function describePaints(paints: unknown): string | undefined {
  if (!Array.isArray(paints) || paints.length === 0) return paints === undefined ? undefined : "none";
  const p = paints[0] as AnyNode;
  if (!p || typeof p !== "object") return "?";
  if (p.visible === false) return "hidden";
  if (p.type !== "SOLID" || !p.color) return String(p.type);
  const hex = (c: number): string => {
    const v = Math.max(0, Math.min(255, Math.round((typeof c === "number" ? c : 0) * 255)));
    return (v < 16 ? "0" : "") + v.toString(16);
  };
  const base = "#" + hex(p.color.r) + hex(p.color.g) + hex(p.color.b);
  const opacity = typeof p.opacity === "number" && p.opacity < 1 ? " @" + Math.round(p.opacity * 100) + "%" : "";
  return base + opacity;
}

/** Read one property off the node, reduced to something small and serialisable. */
function readProp(node: AnyNode, prop: string): unknown {
  let value: unknown;
  try {
    value = node[prop];
  } catch (_e) {
    return undefined;
  }
  if (value === undefined) return undefined;
  if (typeof value === "symbol") return "MIXED";
  if (prop === "fills" || prop === "strokes") return describePaints(value);
  if (isScalar(value)) {
    if (typeof value === "number" && !isFinite(value)) return null;
    if (typeof value === "string" && value.length > 80) return value.slice(0, 80) + "…";
    return value;
  }
  // Anything structural (effects, layoutGrids, …) is summarised, not dumped.
  if (Array.isArray(value)) return "[" + value.length + " item" + (value.length === 1 ? "" : "s") + "]";
  return undefined;
}

/** The node property names a set of request params is expected to have written. */
export function touchedProps(params: Record<string, unknown> | null | undefined): string[] {
  const out: string[] = [];
  if (params === null || params === undefined) return out;
  const keys = Object.keys(params);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (CONTROL_PARAMS[key] === true) continue;
    if (key.charAt(0) === "_") continue;
    if (params[key] === undefined) continue;
    const mapped = PARAM_TO_PROPS[key] !== undefined ? PARAM_TO_PROPS[key] : [key];
    for (let m = 0; m < mapped.length; m++) {
      if (out.indexOf(mapped[m]) === -1) out.push(mapped[m]);
    }
  }
  return out;
}

export interface NodeState {
  /** `name [TYPE] id x,y wxh · style tokens` — the same one-line shape reads use. */
  summary: string;
  /** Read-back values of the properties this write touched. */
  props: Record<string, unknown>;
  /** Present only when a requested write was silently discarded. */
  noops?: WriteNoOp[];
}

/**
 * Build the compact post-write projection for one node: geometry (via the shared
 * `extractGeometry` / `formatCompact` renderers used by reads) plus a read-back of
 * only the properties the write touched.
 */
export function buildNodeState(node: AnyNode, props: string[], noops?: WriteNoOp[]): NodeState {
  const geo = extractGeometry(node, false, 0) as AnyNode;
  // Style tokens formatCompact understands, read straight off the live node.
  const styled: AnyNode = geo;
  const carry = ["layoutMode", "itemSpacing", "cornerRadius", "opacity", "characters"];
  for (let i = 0; i < carry.length; i++) {
    const v = readProp(node, carry[i]);
    if (v !== undefined && v !== null && typeof v !== "object") styled[carry[i]] = v;
  }
  const fill = describePaints(node.fills);
  if (fill !== undefined && fill !== "none") styled.fills = [{ color: fill }];

  const projection: Record<string, unknown> = {};
  let count = 0;
  for (let i = 0; i < props.length && count < MAX_PROPS; i++) {
    const value = readProp(node, props[i]);
    if (value === undefined) continue;
    projection[props[i]] = value;
    count++;
  }

  const state: NodeState = { summary: formatCompact([styled]), props: projection };
  if (noops !== undefined && noops !== null && noops.length > 0) state.noops = noops;
  return state;
}

/** Node ids this command acted on — preferring the ids the handler reported back. */
export function collectNodeIds(params: Record<string, unknown> | null | undefined, result: unknown): string[] {
  const ids: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === "string" && value && ids.indexOf(value) === -1 && ids.length < MAX_NODES) ids.push(value);
  };
  const scan = (source: unknown): void => {
    if (source === null || source === undefined || typeof source !== "object") return;
    const rec = source as Record<string, unknown>;
    push(rec["nodeId"]);
    push(rec["id"]);
    const many = rec["nodeIds"] !== undefined ? rec["nodeIds"] : rec["ids"];
    if (Array.isArray(many)) for (let i = 0; i < many.length; i++) push(many[i]);
  };
  scan(result);
  if (ids.length === 0) scan(params);
  return ids;
}

export type NodeResolver = (id: string) => Promise<AnyNode | null>;

/**
 * Attach `state` to a mutating command's result. Never throws: a state capture
 * failure must not turn a successful write into an error.
 *
 * No-ops detected by `applyWrites` (carried on the result as `noops`) are copied
 * into the state, so a discarded write is visible exactly where the caller looks
 * for the post-write value.
 */
export async function attachPostWriteState(
  params: Record<string, unknown> | null | undefined,
  result: unknown,
  getNode: NodeResolver,
): Promise<unknown> {
  if (result === null || result === undefined || typeof result !== "object" || Array.isArray(result)) return result;
  const record = result as Record<string, unknown>;
  const ids = collectNodeIds(params, result);
  if (ids.length === 0) return result;

  const noops = Array.isArray(record["noops"]) ? (record["noops"] as WriteNoOp[]) : undefined;
  const props = touchedProps(params);
  const states: NodeState[] = [];

  for (let i = 0; i < ids.length; i++) {
    try {
      const node = await getNode(ids[i]);
      if (!node) {
        states.push({ summary: ids[i] + " [MISSING] — node not found after write", props: {} });
        continue;
      }
      states.push(buildNodeState(node, props, ids.length === 1 ? noops : undefined));
    } catch (_e) {
      /* state capture is best-effort */
    }
  }

  if (states.length === 0) return result;
  record["state"] = states.length === 1 ? states[0] : states;
  return record;
}
