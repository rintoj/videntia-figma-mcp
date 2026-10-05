/**
 * Server-side work a tool does AFTER its plugin command returns — replayed for
 * `batch_actions`.
 *
 * A batched action is built by running its standalone handler in capture mode
 * (utils/tool-capture.ts), which records the plugin command and hands the handler a
 * placeholder result. Anything the handler would have done with the REAL result — write
 * an export to disk, crop it, cache it — therefore never happened, and the batch row
 * reported OK for a file that was never written.
 *
 * Tools listed here get that step back: after the plugin batch returns, the processor
 * runs on the action's real result and its return value replaces the row's result.
 * Tools whose post-dispatch work cannot be replayed are refused up front instead.
 */

import { finalizeNodeExport, writeImageFillExport, type NodeExportOptions } from "./export-finalize.js";
import { normalizeNodeId } from "./figma-helpers.js";

export type BatchPostProcessor = (pluginResult: unknown) => Promise<unknown>;

/** Where in its batch the action sits — see `batchPostPlan`. */
export interface BatchPostContext {
  /**
   * An earlier action in the same batch may have changed the document (anything that is
   * not itself an export or a pure server-side computation counts).
   */
  followsMutation: boolean;
}

type PostPlanner = (
  params: Record<string, unknown>,
  context: BatchPostContext,
) => { post: BatchPostProcessor } | { error: string };

/** Batch actions that never change the document, for `BatchPostContext.followsMutation`. */
export const NON_MUTATING_BATCH_ACTIONS: ReadonlySet<string> = new Set(["export_node_as_image", "export_image_fill"]);

const POST_PROCESSED: Record<string, PostPlanner> = {
  export_node_as_image: (params, context) => {
    if (params.inline === true) {
      return {
        error:
          "export_node_as_image with inline: true cannot run inside batch_actions — a batch row cannot carry an image. " +
          "Omit inline (the render is written to a file and the row reports {path,width,height,bytes,format}), " +
          "or call export_node_as_image standalone.",
      };
    }
    const options = params as unknown as NodeExportOptions;
    return {
      post: async (pluginResult) => {
        const r = (pluginResult ?? {}) as { nodeId?: unknown };
        const nodeId = typeof r.nodeId === "string" ? r.nodeId : normalizeNodeId(String(options.nodeId ?? ""));
        // A batched export NEVER serves a cached render: the batch may have changed the
        // node moments earlier. And a render taken right after a mutation in the same
        // batch is not recorded either — an image fill assigned earlier in the batch can
        // still be loading, and caching that (blank) render would pin it for every later
        // export until force_refresh.
        const outcome = await finalizeNodeExport(pluginResult, { ...options, nodeId }, true, {
          read: false,
          write: !context.followsMutation,
        });
        if (outcome.kind !== "file") throw new Error("export did not produce a file");
        return outcome.payload;
      },
    };
  },
  export_image_fill: (params) => ({
    post: (pluginResult) => writeImageFillExport(String(params.exportPath), pluginResult),
  }),
};

/**
 * Tools whose handler does real server-side work around its plugin call that a batch
 * cannot replay. Refused with this reason rather than reporting a silent OK.
 */
export const SERVER_POST_WORK_REASONS: Record<string, string> = {
  bulk_export_frames:
    "'bulk_export_frames' cannot run inside batch_actions: it enumerates frames and writes every render to disk in the MCP server, " +
    "which a batch cannot replay. Call it standalone (it is already a bulk operation), or batch export_node_as_image with save_to_path/output_directory.",
};

/**
 * The post-dispatch step for a batched `action`, if it has one. `params` are the action's
 * params as parsed by the standalone tool's schema.
 */
export function batchPostPlan(
  action: string,
  params: Record<string, unknown>,
  context: BatchPostContext = { followsMutation: true },
): { post?: BatchPostProcessor } | { error: string } {
  const planner = POST_PROCESSED[action];
  return planner ? planner(params, context) : {};
}
