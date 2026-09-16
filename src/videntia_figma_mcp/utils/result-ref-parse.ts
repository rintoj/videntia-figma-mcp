/**
 * Parsing a batched action with its standalone tool's zod schema, WITHOUT breaking
 * `$result[N]` references.
 *
 * THE PROBLEM
 * -----------
 * `$result[0].id` is a string placeholder the PLUGIN resolves at execution time. Most
 * of the time it sits in a string field (`nodeId`, `childId`, `parentId`) and sails
 * through the schema untouched. Occasionally it sits in a numeric field (`index`,
 * `width`), where the standalone schema rightly rejects a non-numeric string — yet
 * the reference is legitimate and used to work, because batch forwarded params raw.
 *
 * THE FIX
 * -------
 * Parse optimistically. When zod rejects a value that IS a reference, swap in a unique
 * numeric sentinel of the expected type, re-parse, and swap the reference back into the
 * built wire payload afterwards — by VALUE, not by path, because the handler is free to
 * rename the key on its way to the wire (`mode` -> `layoutMode`).
 */

import { z } from "zod";

const RESULT_REF = /^\$result\[\d+\]/;

/** Sentinels are far outside any plausible real value, so a value-swap cannot collide. */
const SENTINEL_BASE = -987654000;

export interface RefTolerantParse {
  parsed: Record<string, unknown>;
  /** sentinel number -> the original `$result[...]` string it stands in for. */
  sentinels: Map<number, string>;
}

function isRef(value: unknown): value is string {
  return typeof value === "string" && RESULT_REF.test(value);
}

function atPath(root: unknown, path: (string | number)[]): unknown {
  let cur = root;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

function setAtPath(root: unknown, path: (string | number)[], value: unknown): void {
  let cur = root as Record<string | number, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    cur = cur[path[i]] as Record<string | number, unknown>;
    if (cur === null || typeof cur !== "object") return;
  }
  cur[path[path.length - 1]] = value;
}

/**
 * Parse `params` with `schema`, tolerating `$result[N]` references in non-string
 * fields. Throws the schema's own ZodError for anything that is genuinely invalid.
 */
export function parseWithResultRefs(schema: z.ZodType<unknown>, params: Record<string, unknown>): RefTolerantParse {
  const sentinels = new Map<number, string>();
  let working: Record<string, unknown> = structuredClone(params);
  let nextSentinel = SENTINEL_BASE;

  // Bounded: each pass must replace at least one reference or we stop and let the
  // error surface, so a schema that rejects for an unrelated reason cannot spin.
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = schema.safeParse(working);
    if (result.success) {
      return { parsed: result.data as Record<string, unknown>, sentinels };
    }
    let replaced = false;
    for (const issue of result.error.issues) {
      const original = atPath(working, issue.path as (string | number)[]);
      if (!isRef(original)) continue;
      // Only numeric stand-ins can be swapped back unambiguously by value; a boolean
      // or enum reference has no unique representation, so it stays an error.
      const expected = (issue as { expected?: string }).expected;
      if (issue.code !== "invalid_type" && issue.code !== "too_small" && issue.code !== "too_big") continue;
      if (expected !== undefined && expected !== "number" && expected !== "integer") continue;
      const sentinel = nextSentinel--;
      sentinels.set(sentinel, original);
      setAtPath(working, issue.path as (string | number)[], sentinel);
      replaced = true;
    }
    if (!replaced) throw result.error;
  }

  return { parsed: schema.parse(working) as Record<string, unknown>, sentinels };
}

/** Put the `$result[...]` strings back wherever their sentinel ended up. */
export function restoreResultRefs(value: unknown, sentinels: Map<number, string>): unknown {
  if (sentinels.size === 0) return value;
  if (typeof value === "number" && sentinels.has(value)) return sentinels.get(value);
  if (Array.isArray(value)) return value.map((item) => restoreResultRefs(item, sentinels));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = restoreResultRefs((value as Record<string, unknown>)[key], sentinels);
    }
    return out;
  }
  return value;
}
