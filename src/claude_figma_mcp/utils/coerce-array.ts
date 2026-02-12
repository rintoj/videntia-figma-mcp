import { z } from "zod";

/**
 * Wraps a z.array() schema with preprocessing that coerces string inputs to arrays.
 * Handles: JSON strings ("[\"a\",\"b\"]"), comma-separated ("a,b"), and single values ("a").
 */
export function coerceArray<T extends z.ZodTypeAny>(schema: z.ZodArray<T>) {
  return z.preprocess((val) => {
    if (Array.isArray(val)) return val;
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed.startsWith("[")) {
        try {
          return JSON.parse(trimmed);
        } catch {
          /* fall through */
        }
      }
      if (trimmed.includes(",")) {
        return trimmed
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (trimmed.length > 0) {
        return [trimmed];
      }
    }
    return val;
  }, schema);
}
