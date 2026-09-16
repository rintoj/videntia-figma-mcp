// Batch actions handler — executes multiple commands in a single round-trip.
// handleCommand is injected to avoid a circular module dependency.

import { sendProgressUpdate } from "../utils/helpers";
import type { BatchAction, BatchActionResult } from "../types";

// Max depth for field path navigation to prevent abuse.
// NOTE: This logic is mirrored in src/videntia_figma_mcp/utils/resolve-result-references.ts
// which has comprehensive unit tests. Keep both implementations in sync.
const RESOLVE_MAX_PATH_DEPTH = 10;

export type HandleCommandFn = (command: string, params: Record<string, unknown>) => Promise<unknown>;

// Resolves $result[N].field references in action params against previous results.
function resolveResultReferences(params: unknown, results: BatchActionResult[]): unknown {
  if (params === null || params === undefined) return params;

  if (typeof params === "string") {
    const refMatch = params.match(/^\$result\[(\d+)\](.*)$/);
    if (refMatch) {
      const refIndex = parseInt(refMatch[1], 10);
      const fieldPath = refMatch[2]; // e.g., ".id" or ".children[0].name"

      if (refIndex >= results.length) {
        throw new Error(
          "$result[" +
            refIndex +
            "] references action that has not executed yet (only " +
            results.length +
            " completed)",
        );
      }

      const referencedResult = results[refIndex];
      if (!referencedResult.success) {
        throw new Error(
          "$result[" +
            refIndex +
            "] references a failed action: " +
            (referencedResult.error !== undefined ? referencedResult.error : "unknown error"),
        );
      }

      let value: unknown = referencedResult.result;

      if (fieldPath) {
        const segments = fieldPath.match(/\.([a-zA-Z_]\w*)|(\[\d+\])/g);
        if (segments) {
          if (segments.length > RESOLVE_MAX_PATH_DEPTH) {
            throw new Error(
              "Field path exceeds maximum depth of " +
                RESOLVE_MAX_PATH_DEPTH +
                ": $result[" +
                refIndex +
                "]" +
                fieldPath,
            );
          }
          for (let s = 0; s < segments.length; s++) {
            const segment = segments[s];
            if (value === null || value === undefined) {
              throw new Error(
                "Cannot access '" + segment + "' on null/undefined in $result[" + refIndex + "]" + fieldPath,
              );
            }
            if (segment.startsWith("[")) {
              const arrIndex = parseInt(segment.slice(1, -1), 10);
              value = (value as unknown[])[arrIndex];
            } else {
              // Remove leading dot
              value = (value as Record<string, unknown>)[segment.slice(1)];
            }
          }
        }
      }

      return value;
    }
    return params;
  }

  if (Array.isArray(params)) {
    return params.map(function (item: unknown) {
      return resolveResultReferences(item, results);
    });
  }

  if (typeof params === "object") {
    const resolved: Record<string, unknown> = {};
    const keys = Object.keys(params as object);
    for (let k = 0; k < keys.length; k++) {
      resolved[keys[k]] = resolveResultReferences((params as Record<string, unknown>)[keys[k]], results);
    }
    return resolved;
  }

  return params;
}

/**
 * Deep-converts a handler result into plain, structured-cloneable JSON.
 *
 * WHY: batch results are posted back across the Figma plugin sandbox boundary. If a
 * handler returns anything the sandbox cannot serialise — `figma.mixed` (a Symbol),
 * a live SceneNode / Variable proxy, a function — the WHOLE batch response fails with
 * "Cannot unwrap symbol" and the caller loses every per-action result, with no idea
 * which action failed or whether earlier actions were committed. Sanitising here
 * guarantees the results array is always serialisable.
 */
export function sanitizeResult(value: unknown, depth?: number): unknown {
  const d = depth === undefined ? 0 : depth;
  if (d > 8) return "[max depth]";

  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") {
    return t === "number" && !isFinite(value as number) ? null : value;
  }
  // figma.mixed is a Symbol — the direct cause of "Cannot unwrap symbol".
  if (t === "symbol") return "MIXED";
  if (t === "function") return undefined;
  if (t === "bigint") return String(value);

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) out.push(sanitizeResult(value[i], d + 1));
    return out;
  }

  if (t === "object") {
    // A live Figma node/variable proxy cannot cross the boundary — reduce it to an id ref.
    const maybeNode = value as { id?: unknown; type?: unknown; name?: unknown; remove?: unknown };
    if (typeof maybeNode.remove === "function" && typeof maybeNode.id === "string") {
      return {
        id: maybeNode.id,
        name: typeof maybeNode.name === "string" ? maybeNode.name : undefined,
        type: typeof maybeNode.type === "string" ? maybeNode.type : undefined,
      };
    }
    const out: Record<string, unknown> = {};
    let keys: string[];
    try {
      keys = Object.keys(value as object);
    } catch (_e) {
      return String(value);
    }
    for (let k = 0; k < keys.length; k++) {
      try {
        const sanitized = sanitizeResult((value as Record<string, unknown>)[keys[k]], d + 1);
        if (sanitized !== undefined) out[keys[k]] = sanitized;
      } catch (_e) {
        out[keys[k]] = "[unserializable]";
      }
    }
    return out;
  }

  return String(value);
}

/**
 * Describes which actions have actually been committed to the document at the point a
 * failure is reported. Counts SUCCEEDED actions, never indices — an action that failed
 * committed nothing, so a failure at index 2 after two failures must not claim
 * "actions 0..1 already committed".
 */
export function describeCommitted(committedIndices: number[]): string {
  if (committedIndices.length === 0) return "no actions were committed";
  if (committedIndices.length === 1) return "action #" + committedIndices[0] + " already committed";
  const contiguous =
    committedIndices[committedIndices.length - 1] - committedIndices[0] + 1 === committedIndices.length;
  if (contiguous) {
    return (
      "actions " + committedIndices[0] + ".." + committedIndices[committedIndices.length - 1] + " already committed"
    );
  }
  return "actions " + committedIndices.join(", ") + " already committed";
}

export async function batchActions(
  params: Record<string, unknown>,
  handleCommand: HandleCommandFn,
): Promise<Record<string, unknown>> {
  const rawActions = params !== null && params !== undefined ? params["actions"] : undefined;
  const stopOnError =
    params !== null && params !== undefined && params["stopOnError"] !== undefined
      ? (params["stopOnError"] as boolean)
      : false;

  if (!Array.isArray(rawActions) || rawActions.length === 0) {
    throw new Error("batch_actions requires a non-empty 'actions' array");
  }

  const actions = rawActions as BatchAction[];
  const results: BatchActionResult[] = [];
  // Indices of actions that actually SUCCEEDED (and so mutated the document).
  // Never derive "what committed" from the failing action's index: a batch whose
  // action #0 fails has committed nothing, no matter what index we are on.
  const committedIndices: number[] = [];
  let succeeded = 0;
  let failed = 0;
  const commandId =
    params !== null && params !== undefined && params["commandId"] !== undefined
      ? String(params["commandId"])
      : "batch";
  const totalActions = actions.length;
  const shouldSendProgress = totalActions > 1;
  // Emit ~10 progress updates regardless of batch size (at least 1 per action for small batches)
  const progressInterval = Math.max(1, Math.floor(totalActions / 10));

  for (let i = 0; i < totalActions; i++) {
    const { action, params: actionParams } = actions[i];

    // Block recursive batch_actions calls
    if (action === "batch_actions") {
      results.push({
        index: i,
        action,
        success: false,
        error: "Recursive batch_actions calls are not allowed",
      });
      failed++;
      if (stopOnError) break;
      continue;
    }

    try {
      // Resolve $result[N].field references
      const resolvedParams = resolveResultReferences(
        actionParams !== null && actionParams !== undefined ? actionParams : {},
        results,
      ) as Record<string, unknown>;

      const result = await handleCommand(action, resolvedParams);
      // Sanitise before it enters `results` — both so the batch response can cross the
      // sandbox boundary, and so $result[N].field lookups navigate plain data.
      results.push({ index: i, action, success: true, result: sanitizeResult(result) });
      committedIndices.push(i);
      succeeded++;
    } catch (error) {
      results.push({
        index: i,
        action,
        success: false,
        error:
          (error instanceof Error ? error.message : String(error)) +
          " [action #" +
          i +
          " of " +
          totalActions +
          "; " +
          describeCommitted(committedIndices) +
          "]",
      });
      failed++;

      // Send immediate progress update on failure for large batches
      if (shouldSendProgress) {
        const progress = Math.round(((i + 1) / totalActions) * 100);
        sendProgressUpdate(
          commandId,
          "batch_actions",
          "in_progress",
          progress,
          totalActions,
          i + 1,
          `Action ${i + 1} (${action}) failed. Processed ${i + 1}/${totalActions} (${succeeded} succeeded, ${failed} failed)`,
        );
      }

      if (stopOnError) break;
    }

    // Send progress updates — once per action for small batches, every N for large batches
    if (shouldSendProgress && (i + 1) % progressInterval === 0) {
      const progress = Math.round(((i + 1) / totalActions) * 100);
      sendProgressUpdate(
        commandId,
        "batch_actions",
        "in_progress",
        progress,
        totalActions,
        i + 1,
        `Processed ${i + 1}/${totalActions} actions (${succeeded} succeeded, ${failed} failed)`,
      );
    }
  }

  return {
    success: failed === 0,
    totalActions,
    succeeded,
    failed,
    results,
  };
}
