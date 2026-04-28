import { BatchActionResult } from "../types";

const MAX_PATH_DEPTH = 10;
const REF_PATTERN = /^\$result\[(\d+)\](.*)$/;

/**
 * Recursively resolves `$result[N].field` references in action params.
 * Replaces string values matching the pattern with actual values from previous batch results.
 *
 * Supports:
 * - `$result[0]` - entire result object of action 0
 * - `$result[0].id` - field access
 * - `$result[0].children[1].name` - nested array + field access
 *
 * @param params - The params value to resolve (string, object, array, or primitive)
 * @param results - Array of previous batch action results
 * @returns The resolved value with all references replaced
 */
export function resolveResultReferences(params: unknown, results: BatchActionResult[]): unknown {
  if (params === null || params === undefined) return params;

  if (typeof params === "string") {
    const refMatch = params.match(REF_PATTERN);
    if (refMatch) {
      const refIndex = parseInt(refMatch[1], 10);
      const fieldPath = refMatch[2];

      if (refIndex >= results.length) {
        throw new Error(
          `$result[${refIndex}] references action that hasn't executed yet (only ${results.length} completed)`,
        );
      }

      const referencedResult = results[refIndex];
      if (!referencedResult.success) {
        throw new Error(`$result[${refIndex}] references a failed action: ${referencedResult.error}`);
      }

      let value: any = referencedResult.result;

      if (fieldPath) {
        const segments = fieldPath.match(/\.([a-zA-Z_]\w*)|(\[\d+\])/g);
        if (segments) {
          if (segments.length > MAX_PATH_DEPTH) {
            throw new Error(`Field path exceeds maximum depth of ${MAX_PATH_DEPTH}: $result[${refIndex}]${fieldPath}`);
          }
          for (const segment of segments) {
            if (value === null || value === undefined) {
              throw new Error(`Cannot access '${segment}' on null/undefined in $result[${refIndex}]${fieldPath}`);
            }
            if (segment.startsWith("[")) {
              const arrIndex = parseInt(segment.slice(1, -1), 10);
              value = value[arrIndex];
            } else {
              value = value[segment.slice(1)];
            }
          }
        }
      }

      return value;
    }
    return params;
  }

  if (Array.isArray(params)) {
    return params.map((item) => resolveResultReferences(item, results));
  }

  if (typeof params === "object") {
    const resolved: Record<string, unknown> = {};
    for (const key of Object.keys(params as Record<string, unknown>)) {
      resolved[key] = resolveResultReferences((params as Record<string, unknown>)[key], results);
    }
    return resolved;
  }

  return params;
}
