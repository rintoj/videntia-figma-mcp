/**
 * Shared formatting helpers for converting Figma tool results
 * from raw JSON to token-efficient markdown text.
 */

/**
 * Format a Figma normalized RGBA color (0-1 range) as a readable string.
 */
export function formatColorValue(value: any): string {
  if (value == null) return "-";
  if (typeof value === "object" && "r" in value) {
    const r = Math.round((value.r ?? 0) * 255);
    const g = Math.round((value.g ?? 0) * 255);
    const b = Math.round((value.b ?? 0) * 255);
    const a = value.a ?? 1;
    if (a === 1) return `rgb(${r},${g},${b})`;
    return `rgba(${r},${g},${b},${parseFloat(a.toFixed(2))})`;
  }
  return String(value);
}

/**
 * Format a variable value based on its resolved type.
 */
export function formatVariableValue(type: string, value: any): string {
  if (value == null) return "-";
  if (type === "COLOR") return formatColorValue(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Truncate a string to a max length, appending "..." if trimmed.
 */
export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + "...";
}
