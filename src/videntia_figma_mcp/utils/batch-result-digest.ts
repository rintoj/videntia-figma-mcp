/**
 * Compact per-action digests for `batch_actions`.
 *
 * A batch used to answer with nothing but a "3/3 succeeded" line, which made it
 * write-only: the caller could not tell what an action produced (a new node id) nor
 * what a read-style action (get_node_info, measure_node, …) actually returned without
 * a second round trip. These helpers render ONE short line per action instead of a
 * full node dump, keeping the default response informative but token-lean.
 *
 * `return_state: true` remains the verbose opt-in (see `utils/return-state.ts`): it adds
 * the node's ACTUAL post-write state and any silently discarded writes.
 */

/** Hard cap on one action's detail cell, so a read result cannot flood the response. */
export const DIGEST_MAX_LENGTH = 160;

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > DIGEST_MAX_LENGTH ? `${flat.slice(0, DIGEST_MAX_LENGTH - 1)}…` : flat;
}

/** Cells live inside a markdown table — an unescaped pipe would break the row. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function digestValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[${value.length}] ${JSON.stringify(value[0])}`;
  }
  return JSON.stringify(value);
}

/**
 * One compact line describing what an action returned.
 *
 * Identity-bearing keys (id/name/type) win, because they are what a caller chains on;
 * everything else falls back to a truncated JSON rendering, so read-style commands
 * still surface their natural return value.
 */
export function summarizeActionResult(result: unknown): string {
  if (result === null || result === undefined) return "ok";
  if (typeof result !== "object") return truncate(digestValue(result)) || "ok";
  if (Array.isArray(result)) return truncate(digestValue(result));

  const record = result as Record<string, unknown>;
  const parts: string[] = [];
  const id = record.id ?? record.nodeId ?? record.newNodeId;
  if (typeof id === "string") parts.push(`id=${id}`);
  if (typeof record.name === "string") parts.push(`name=${record.name}`);
  if (typeof record.type === "string") parts.push(`type=${record.type}`);

  if (parts.length > 0) return truncate(parts.join(" "));

  const keys = Object.keys(record);
  if (keys.length === 0) return "ok";
  return truncate(JSON.stringify(record));
}

/**
 * The per-action table every batch answers with, whatever the outcome.
 * Rows are `| # | action | OK|FAIL | detail |`.
 */
export function renderActionTable(
  results: Array<{ index: number; action: string; success: boolean; result?: unknown; error?: string }>,
): string[] {
  const lines = ["| # | Action | Status | Detail |", "|---|--------|--------|--------|"];
  for (const r of results) {
    const detail = r.success ? summarizeActionResult(r.result) : r.error || "unknown error";
    lines.push(`| ${r.index} | ${r.action} | ${r.success ? "OK" : "FAIL"} | ${escapeCell(truncate(detail))} |`);
  }
  return lines;
}
