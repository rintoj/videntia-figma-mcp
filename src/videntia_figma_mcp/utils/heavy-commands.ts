/**
 * Which plugin commands are "heavy": page-wide or deep-subtree walks, image
 * renders and bulk dumps that can hold the plugin main thread for seconds.
 *
 * Shared by the plugin scheduler (utils/command-scheduler) the same way
 * readonly-commands.ts is shared: light reads may jump ahead of queued heavy
 * ones, and only one heavy command runs at a time.
 */

/** Always heavy, whatever the params. */
export const HEAVY_COMMANDS: ReadonlySet<string> = new Set<string>([
  "scan_nodes_by_types",
  "scan_text_nodes",
  "scan_bound_variables",
  "lint_frame",
  "contrast_check_frame",
  "find_unbound",
  "find_overlaps",
  "check_token_collisions",
  "export_node_as_image",
  "export_selection_as_image",
  "export_image_fill",
  "bulk_export_frames",
  "get_design_system",
  "get_variables",
  "get_local_components",
  "get_remote_components",
  "get_styles",
  "export_collection_schema",
  "generate_audit_report",
  "audit_collection",
  "enumerate_all_frames",
  "map_prototype_flows",
  "get_frame_documentation",
  // Walks the subtree (default cap 5000 nodes) and resolves every bound variable.
  "get_variables_used",
]);

/** get_design_context is heavy past this node cap (default 300) or depth (default 2). */
export const DESIGN_CONTEXT_HEAVY_NODES = 1000;
export const DESIGN_CONTEXT_HEAVY_DEPTH = 3;

/** get_outline is heavy only when asked for more than this many nodes. */
export const OUTLINE_HEAVY_NODES = 5000;

/** get_content_tree is heavy past this depth (its default maxDepth is 5). */
export const CONTENT_TREE_HEAVY_DEPTH = 3;
const CONTENT_TREE_DEFAULT_DEPTH = 5;

function hasScope(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((x) => typeof x === "string" && x.length > 0);
  return typeof v === "string" && v.length > 0;
}

export function isHeavyCommand(command: string, params: unknown): boolean {
  if (HEAVY_COMMANDS.has(command)) return true;
  const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
  if (command === "get_content_tree") {
    const raw = p["maxDepth"] ?? p["depth"];
    if (raw === undefined || raw === null) return CONTENT_TREE_DEFAULT_DEPTH > CONTENT_TREE_HEAVY_DEPTH;
    const n = Number(raw);
    return !Number.isFinite(n) || n > CONTENT_TREE_HEAVY_DEPTH;
  }
  if (command === "search_nodes") return !hasScope(p["nodeId"]);
  if (command === "get_design_context") {
    const n = Number(p["maxNodes"]);
    const d = Number(p["depth"]);
    return (
      (Number.isFinite(n) && n > DESIGN_CONTEXT_HEAVY_NODES) || (Number.isFinite(d) && d > DESIGN_CONTEXT_HEAVY_DEPTH)
    );
  }
  // The outline is cheap; only an explicitly large one is heavy.
  if (command === "get_outline") {
    const n = Number(p["maxNodes"]);
    return Number.isFinite(n) && n > OUTLINE_HEAVY_NODES;
  }
  return false;
}
