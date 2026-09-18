// ---------------------------------------------------------------------------
// Write verification + strict mode
// ---------------------------------------------------------------------------
//
// Several Figma properties accept a write and silently discard it (the Figma
// runtime keeps a derived/managed value instead). Handlers that write such
// properties used to return `success: true` regardless, so an agent had no way
// to tell a landed write from a discarded one and would loop forever.
//
// `applyWrites` centralises the "write, read back, compare" check so the eight
// affected handlers do not each reimplement it:
//
//   - strict (DEFAULT): a discarded write throws immediately.
//   - non-strict: a discarded write is reported in `noops` / `warnings` on the
//     command result, so the caller can see it but the call still "succeeds".
//
// Strict is the default because silent success is the worst failure mode here:
// a reported-success-but-discarded write forces the caller into an export-image
// verification loop to discover it (47 such loops were measured in one session).
// Strict mode is a global toggle (`set_strict_mode`) that individual commands
// can override with a `strict` param.
//
// This module deliberately has no imports so any handler can use it without
// creating a circular module dependency with index.ts.

/** Global strict-mode flag, toggled by the `set_strict_mode` command. Default ON. */
const strictState = { enabled: true };

export function setStrictModeEnabled(enabled: boolean): void {
  strictState.enabled = enabled;
}

export function isStrictModeEnabled(): boolean {
  return strictState.enabled;
}

/**
 * Resolve the effective strict setting for one command invocation: an explicit
 * `strict` param wins over the global toggle.
 */
export function resolveStrict(params: Record<string, unknown> | null | undefined): boolean {
  if (params !== null && params !== undefined && params["strict"] !== undefined && params["strict"] !== null) {
    return params["strict"] === true || params["strict"] === "true";
  }
  return strictState.enabled;
}

export interface WriteNoOp {
  property: string;
  requested: unknown;
  actual: unknown;
}

export interface ApplyWritesResult {
  /** Properties whose read-back value matched the requested value. */
  applied: string[];
  /** Properties whose write was silently discarded by the Figma runtime. */
  noops: WriteNoOp[];
  /** Human-readable warnings, one per no-op. Empty when everything landed. */
  warnings: string[];
  /**
   * Side effects the caller acknowledged (`allow_side_effects` /
   * `expect_side_effects`). Reported, never thrown, and never a failure.
   */
  acknowledged?: Array<WriteNoOp & { kind: string }>;
}

// Figma stores layout numbers as floats; tolerate representation drift only.
const EPSILON = 0.001;

function valuesMatch(requested: unknown, actual: unknown): boolean {
  if (typeof requested === "number" && typeof actual === "number") {
    if (isNaN(requested) && isNaN(actual)) return true;
    return Math.abs(requested - actual) <= EPSILON;
  }
  return requested === actual;
}

/**
 * Write each `property: value` pair onto `node`, then read it back and compare.
 *
 * `undefined` values are skipped (the caller did not ask for that property).
 * Properties the node does not expose are skipped rather than reported — the
 * calling handler is responsible for its own type guards.
 *
 * @param label  Prefix used in the thrown/reported message, e.g. `set_padding`.
 * @param strict When true, the first detected no-op throws.
 */
export function applyWrites(
  node: BaseNode,
  writes: Record<string, unknown>,
  options?: { label?: string; strict?: boolean; hint?: string },
): ApplyWritesResult {
  const opts = options !== undefined && options !== null ? options : {};
  const label = opts.label !== undefined ? opts.label : "write";
  const hint = opts.hint !== undefined && opts.hint !== null ? " " + opts.hint : "";
  const target = node as unknown as Record<string, unknown>;

  const applied: string[] = [];
  const noops: WriteNoOp[] = [];
  const warnings: string[] = [];

  const keys = Object.keys(writes);
  for (let i = 0; i < keys.length; i++) {
    const property = keys[i];
    const value = writes[property];
    if (value === undefined) continue;
    if (!(property in node)) continue;

    target[property] = value;
    const actual = target[property];

    if (valuesMatch(value, actual)) {
      applied.push(property);
      continue;
    }

    noops.push({ property, requested: value, actual });
    warnings.push(
      label +
        ': write to "' +
        property +
        '" on node "' +
        node.name +
        '" did not take effect (requested ' +
        JSON.stringify(value) +
        ", node still reports " +
        JSON.stringify(actual) +
        ")." +
        hint,
    );
  }

  if (noops.length > 0 && opts.strict === true) {
    throw new Error(warnings.join(" "));
  }

  return { applied, noops, warnings };
}

/**
 * Merge several `applyWrites` results into one, for handlers that write to more
 * than one node or in more than one phase.
 */
export function mergeWriteResults(...results: ApplyWritesResult[]): ApplyWritesResult {
  const merged: ApplyWritesResult = { applied: [], noops: [], warnings: [] };
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r) continue;
    merged.applied = merged.applied.concat(r.applied);
    merged.noops = merged.noops.concat(r.noops);
    merged.warnings = merged.warnings.concat(r.warnings);
    if (r.acknowledged !== undefined && r.acknowledged.length > 0) {
      merged.acknowledged = (merged.acknowledged ?? []).concat(r.acknowledged);
    }
  }
  return merged;
}

/**
 * Attach no-op information to a handler result. Keeps the shape consistent
 * across handlers: `success` is false when anything was silently discarded, and
 * `warnings` carries the explanation.
 */
export function withWriteReport(result: Record<string, unknown>, report: ApplyWritesResult): Record<string, unknown> {
  if (report.noops.length > 0) {
    result["success"] = false;
    result["warnings"] = report.warnings;
    result["noops"] = report.noops;
  } else if (result["success"] === undefined) {
    result["success"] = true;
  }
  if (report.acknowledged !== undefined && report.acknowledged.length > 0) {
    result["acknowledgedSideEffects"] = report.acknowledged;
    // `report.warnings` already carries the acknowledgement lines; only set them
    // when the no-op branch above did not already publish the same array.
    if (result["warnings"] === undefined) result["warnings"] = report.warnings;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Parent collapse guard (bug #9)
// ---------------------------------------------------------------------------
//
// Setting a CHILD to FILL inside an auto-layout parent that hugs on that axis
// makes Figma recompute the parent's hug size from the child's new
// contribution — a FILL child contributes its minimum, not its old fixed size,
// so the parent silently shrinks by the padding/spacing delta (observed: a
// fixed 343px bar became 339px). The caller never asked for that.
//
// Policy:
//   - parent is FIXED on the drifted axis -> the drift is pure side effect and
//     resizing back is safe; we restore silently and report it.
//   - parent HUGS on the drifted axis    -> restoring fights Figma's layout
//     engine (it would just re-hug). We surface a precise error (strict) or a
//     warning (non-strict) instead of letting a silent 4px drift ship.

export interface ParentSizeSnapshot {
  node: BaseNode & { width: number; height: number; resize?: (w: number, h: number) => void };
  name: string;
  id: string;
  width: number;
  height: number;
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  layoutMode?: string;
}

/** Snapshot an auto-layout parent's size + sizing modes, or null when not applicable. */
export function snapshotParentSize(parent: unknown): ParentSizeSnapshot | null {
  if (parent === null || parent === undefined) return null;
  const p = parent as Record<string, unknown>;
  if (!("layoutMode" in p) || !("width" in p) || !("height" in p)) return null;
  const layoutMode = p["layoutMode"] as string;
  if (layoutMode !== "HORIZONTAL" && layoutMode !== "VERTICAL" && layoutMode !== "GRID") return null;
  return {
    node: parent as ParentSizeSnapshot["node"],
    name: (p["name"] as string) ?? "(unnamed)",
    id: (p["id"] as string) ?? "",
    width: p["width"] as number,
    height: p["height"] as number,
    primaryAxisSizingMode: p["primaryAxisSizingMode"] as string | undefined,
    counterAxisSizingMode: p["counterAxisSizingMode"] as string | undefined,
    layoutMode,
  };
}

/**
 * Detect and handle a parent dimension that moved as a side effect of a write
 * to one of its children. Restores where safe, throws/warns where Figma insists
 * on hugging.
 */
export function guardParentSize(
  snapshot: ParentSizeSnapshot | null,
  options: { label: string; strict: boolean; childName: string; allowSideEffects?: string[] },
): ApplyWritesResult {
  const result: ApplyWritesResult = { applied: [], noops: [], warnings: [] };
  const acknowledgedResize = isSideEffectAllowed(options.allowSideEffects, "parentResize");
  if (snapshot === null) return result;

  const parent = snapshot.node as unknown as Record<string, unknown>;
  const axes: Array<{
    dim: "width" | "height";
    before: number;
    // Which sizing mode governs this dimension for this parent's layoutMode.
    mode: string | undefined;
  }> = [
    {
      dim: "width",
      before: snapshot.width,
      mode: snapshot.layoutMode === "HORIZONTAL" ? snapshot.primaryAxisSizingMode : snapshot.counterAxisSizingMode,
    },
    {
      dim: "height",
      before: snapshot.height,
      mode: snapshot.layoutMode === "HORIZONTAL" ? snapshot.counterAxisSizingMode : snapshot.primaryAxisSizingMode,
    },
  ];

  for (let i = 0; i < axes.length; i++) {
    const axis = axes[i];
    const after = parent[axis.dim] as number;
    if (typeof after !== "number" || Math.abs(after - axis.before) <= EPSILON) continue;

    // Acknowledged: the caller asked for this resize, so do NOT restore it either —
    // restoring would undo the very change they wanted. Report and move on.
    if (acknowledgedResize) {
      result.acknowledged = (result.acknowledged ?? []).concat([
        { kind: "parentResize", property: `parent.${axis.dim}`, requested: axis.before, actual: after },
      ]);
      result.warnings.push(
        `${options.label}: sizing "${options.childName}" changed its parent "${snapshot.name}" (${snapshot.id}) ` +
          `${axis.dim} from ${axis.before} to ${after} — acknowledged via allow_side_effects/expect_side_effects, kept.`,
      );
      continue;
    }

    const hugs = axis.mode === "AUTO";
    if (!hugs && typeof parent["resize"] === "function") {
      const targetW = axis.dim === "width" ? axis.before : (parent["width"] as number);
      const targetH = axis.dim === "height" ? axis.before : (parent["height"] as number);
      try {
        (parent["resize"] as (w: number, h: number) => void).call(parent, targetW, targetH);
      } catch {
        // fall through to the drift check below
      }
      const restored = parent[axis.dim] as number;
      if (Math.abs(restored - axis.before) <= EPSILON) {
        result.applied.push(`parent.${axis.dim}`);
        result.warnings.push(
          `${options.label}: sizing "${options.childName}" shrank its parent "${snapshot.name}" (${snapshot.id}) ` +
            `${axis.dim} from ${axis.before} to ${after}; restored to ${axis.before}.`,
        );
        continue;
      }
    }

    const message =
      `${options.label}: sizing "${options.childName}" changed its parent "${snapshot.name}" (${snapshot.id}) ` +
      `${axis.dim} from ${axis.before} to ${after} — a side effect you did not request. The parent ` +
      `${hugs ? `hugs on this axis (${axis.dim === "width" ? "horizontal" : "vertical"} sizing mode AUTO), so Figma recomputes its size from the FILL child and will not keep ${axis.before}` : "could not be resized back"}. ` +
      `Fix: set the parent to FIXED on this axis first (set_layout_sizing on "${snapshot.name}", or resize_node), ` +
      `or pass the child's horizontal/vertical sizing in the same set_auto_layout call.`;

    result.noops.push({ property: `parent.${axis.dim}`, requested: axis.before, actual: after });
    result.warnings.push(message);
  }

  if (result.noops.length > 0 && options.strict === true) {
    throw new Error(result.warnings.join(" "));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Side-effect acknowledgement
// ---------------------------------------------------------------------------
//
// `guardParentSize` is right about WHAT happened but cannot know whether the
// caller wanted it: shrinking the parent is often the entire point of the edit.
// Without an opt-out, strict mode blocks an intentional edit and the only escape
// is turning strict off wholesale — which also gives up silent-no-op detection.
//
// So the caller may acknowledge a side effect, per call or as a session default:
//   - `allow_side_effects: true`             -> acknowledge every kind
//   - `expect_side_effects: ["parentResize"]`-> acknowledge only those kinds
// Acknowledged side effects never throw and never flip `success` to false; they
// are still REPORTED, on `acknowledged` + a warning, so the measurement that made
// the diagnostic useful is not lost.

/** Every side-effect kind the guards can raise. */
export const SIDE_EFFECT_KINDS = ["parentResize"] as const;
export type SideEffectKind = (typeof SIDE_EFFECT_KINDS)[number];

/** Wildcard entry meaning "every kind is acknowledged". */
const ALL_SIDE_EFFECTS = "*";

/** Session default, set by `set_strict_mode { allow_side_effects }`. Default: none. */
const sideEffectState = { allowed: [] as string[] };

function canonicalKind(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (key === "") return null;
  if (key === "all" || value.trim() === ALL_SIDE_EFFECTS) return ALL_SIDE_EFFECTS;
  if (key === "parentresize" || key === "parentsize" || key === "parentwidth" || key === "parentheight") {
    return "parentResize";
  }
  return value.trim();
}

function parseAllowance(params: Record<string, unknown> | null | undefined): string[] | null {
  if (params === null || params === undefined) return null;

  const kinds: string[] = [];
  let sawAny = false;

  const expected =
    params["expect_side_effects"] !== undefined ? params["expect_side_effects"] : params["expectSideEffects"];
  if (expected !== undefined && expected !== null) {
    sawAny = true;
    const list = Array.isArray(expected) ? expected : String(expected).split(",");
    for (let i = 0; i < list.length; i++) {
      const kind = canonicalKind(list[i]);
      if (kind !== null) kinds.push(kind);
    }
  }

  const allow = params["allow_side_effects"] !== undefined ? params["allow_side_effects"] : params["allowSideEffects"];
  if (allow !== undefined && allow !== null) {
    sawAny = true;
    if (allow === true || allow === "true") kinds.push(ALL_SIDE_EFFECTS);
    else if (Array.isArray(allow) || (typeof allow === "string" && allow !== "false")) {
      const list = Array.isArray(allow) ? allow : String(allow).split(",");
      for (let i = 0; i < list.length; i++) {
        const kind = canonicalKind(list[i]);
        if (kind !== null) kinds.push(kind);
      }
    }
  }

  return sawAny ? kinds : null;
}

/** Set the session-wide acknowledgement default (used by `set_strict_mode`). */
export function setSideEffectAllowanceDefault(value: unknown): void {
  const parsed = parseAllowance({ allow_side_effects: value });
  sideEffectState.allowed = parsed === null ? [] : parsed;
}

/** The current session-wide acknowledgement default. */
export function getSideEffectAllowanceDefault(): string[] {
  return sideEffectState.allowed.slice();
}

/**
 * Resolve the acknowledged side-effect kinds for one command invocation: explicit
 * per-call params win over the session default (including `allow_side_effects:
 * false`, which narrows back to "acknowledge nothing").
 */
export function resolveSideEffectAllowance(params: Record<string, unknown> | null | undefined): string[] {
  const perCall = parseAllowance(params);
  return perCall === null ? sideEffectState.allowed.slice() : perCall;
}

/** True when `kind` was acknowledged by the caller (directly or via the wildcard). */
export function isSideEffectAllowed(allowance: string[] | null | undefined, kind: string): boolean {
  if (!allowance) return false;
  for (let i = 0; i < allowance.length; i++) {
    if (allowance[i] === ALL_SIDE_EFFECTS || allowance[i] === kind) return true;
  }
  return false;
}
