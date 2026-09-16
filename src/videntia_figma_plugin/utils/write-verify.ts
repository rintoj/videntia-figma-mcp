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
  return result;
}
