/**
 * Shared formatting helpers for converting Figma tool results
 * from raw JSON to token-efficient markdown text.
 */

/**
 * Sanitize a string for use inside a markdown table cell.
 * Escapes pipe characters and strips newlines to prevent table breakage.
 */
export function sanitizeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

/**
 * Format a Figma normalized RGBA color (0-1 range) as a readable string.
 */
export function formatColorValue(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "object" && value !== null && "r" in value) {
    const c = value as { r?: number; g?: number; b?: number; a?: number };
    const r = Math.round((c.r ?? 0) * 255);
    const g = Math.round((c.g ?? 0) * 255);
    const b = Math.round((c.b ?? 0) * 255);
    const a = c.a ?? 1;
    if (a === 1) return `rgb(${r},${g},${b})`;
    return `rgba(${r},${g},${b},${parseFloat(a.toFixed(2))})`;
  }
  return String(value);
}

/**
 * Format a variable value based on its resolved type.
 */
export function formatVariableValue(type: string, value: unknown): string {
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

/**
 * Format a variables+collections result as a markdown text table.
 * Extracted from document-tools for reuse and testability.
 */
export function formatVariablesAsText(result: { variables: any[]; collections: any[] }): string {
  const { variables, collections } = result;

  // Group variables by collectionId
  const grouped = new Map<string, any[]>();
  for (const v of variables) {
    const list = grouped.get(v.collectionId) || [];
    list.push(v);
    grouped.set(v.collectionId, list);
  }

  const lines: string[] = [];

  for (const col of collections) {
    const vars = grouped.get(col.id) || [];
    if (vars.length === 0) continue;

    lines.push(`## Collection: ${col.name} (id: ${col.id})`);
    const modeStr = col.modes.map((m: any) => `${m.name} (id: ${m.modeId})`).join(", ");
    lines.push(`Modes: ${modeStr}`);
    lines.push("");

    const modes = col.modes as { name: string; modeId: string }[];
    const multiMode = modes.length > 1;

    if (multiMode) {
      const modeHeaders = modes.map((m) => m.name).join(" | ");
      lines.push(`| Name | Type | ${modeHeaders} | ID |`);
      lines.push(`|------|------|${modes.map(() => "------").join("|")}|----|`);
    } else {
      lines.push("| Name | Type | Value | ID |");
      lines.push("|------|------|-------|----|");
    }

    for (const v of vars) {
      const name = v.description ? `${sanitizeCell(v.name)} — ${sanitizeCell(v.description)}` : sanitizeCell(v.name);

      if (multiMode) {
        // Pre-index values by modeId for O(1) lookups
        const valueByMode = new Map<string, unknown>();
        for (const val of v.values ?? []) {
          valueByMode.set(val.modeId, val.value);
        }
        const values = modes.map((m) => formatVariableValue(v.type, valueByMode.get(m.modeId))).join(" | ");
        lines.push(`| ${name} | ${v.type} | ${values} | ${v.id} |`);
      } else {
        const value = v.values?.[0]?.value;
        lines.push(`| ${name} | ${v.type} | ${formatVariableValue(v.type, value)} | ${v.id} |`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}
