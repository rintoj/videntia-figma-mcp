import { z } from "zod";

const TRUE_STRINGS = new Set(["true", "1", "yes", "on"]);
const FALSE_STRINGS = new Set(["false", "0", "no", "off"]);

/**
 * Strict boolean parser for MCP transport values.
 * Accepts booleans and common string/number representations, but rejects arbitrary truthy strings.
 */
export const mcpBooleanSchema = z.preprocess((value) => {
  if (typeof value === "boolean") return value;

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (TRUE_STRINGS.has(normalized)) return true;
    if (FALSE_STRINGS.has(normalized)) return false;
    return value;
  }

  return value;
}, z.boolean());
