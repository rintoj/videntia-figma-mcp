import type { CommandKind } from "./command-scheduler";

/**
 * Read walks that run with `figma.skipInvisibleInstanceChildren = true`, which makes
 * Figma omit invisible nodes inside instances from children/findAll*. A large
 * speed-up on instance-heavy files. A call that asks for hidden nodes
 * (include_hidden / includeHidden / includeHiddenNodes true, or ignore_hidden false)
 * runs with it OFF, and every other command (writes, get_content_tree, node reads)
 * runs with it OFF, so hidden-node recovery keeps working.
 */
export const SKIP_INVISIBLE_WALKS = new Set<string>([
  "scan_nodes_by_types",
  "get_outline",
  "search_nodes",
  "lint_frame",
  "find_unbound",
  "find_overlaps",
  "contrast_check_frame",
]);

export function wantsSkipInvisible(command: string, kind: CommandKind, params: Record<string, unknown>): boolean {
  if (kind === "write" || !SKIP_INVISIBLE_WALKS.has(command)) return false;
  const p = params || {};
  if (p["include_hidden"] === true || p["includeHidden"] === true || p["includeHiddenNodes"] === true) return false;
  if (p["ignore_hidden"] === false || p["ignoreHidden"] === false) return false;
  return true;
}
