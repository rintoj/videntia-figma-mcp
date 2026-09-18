import { z } from "zod";
import { mcpBooleanSchema } from "./mcp-boolean.js";

/**
 * Shared `return_state` plumbing.
 *
 * A mutating tool with `return_state: true` answers with the node's ACTUAL
 * post-write state (read off the node in the plugin, see
 * `videntia_figma_plugin/utils/post-write-state.ts`), so the caller does not need
 * a follow-up `get_node_info` to check the write landed — and a discarded write
 * cannot read as success.
 */
export const returnStateParam = mcpBooleanSchema
  .optional()
  .describe(
    "Return the node's actual post-write state (compact: one summary line + the properties this write touched) so no follow-up get_node_info is needed. Silently discarded writes are listed under `noops`.",
  ) as z.ZodType<boolean | undefined>;

interface NodeStatePayload {
  summary?: string;
  props?: Record<string, unknown>;
  noops?: Array<{ property: string; requested: unknown; actual: unknown }>;
}

function renderOne(state: NodeStatePayload): string {
  const lines: string[] = [];
  if (state.summary) lines.push(state.summary);
  const props = state.props ?? {};
  const keys = Object.keys(props);
  if (keys.length > 0) {
    lines.push(keys.map((k) => `${k}=${JSON.stringify(props[k])}`).join(" "));
  }
  if (state.noops?.length) {
    for (const n of state.noops) {
      lines.push(
        `NOT APPLIED: ${n.property} requested ${JSON.stringify(n.requested)}, node has ${JSON.stringify(n.actual)}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Render the `state` a plugin result carries, or "" when the command did not
 * return one (no `return_state`, or nothing to report).
 */
export function formatState(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const state = (result as Record<string, unknown>)["state"];
  if (!state) return "";
  const rendered = Array.isArray(state)
    ? (state as NodeStatePayload[]).map(renderOne).filter(Boolean).join("\n")
    : renderOne(state as NodeStatePayload);
  return rendered ? `\nstate:\n${rendered}` : "";
}
