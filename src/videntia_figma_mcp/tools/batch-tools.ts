import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { BatchActionsResult } from "../types";
import { resolveCreateIconParams, resolveUpdateIconParams } from "./icon-tools";
import { normalizeNodeId } from "../utils/figma-helpers";
import { normalizeCommandParams } from "../utils/normalize-batch-params";

const RESULT_REF_PATTERN = /^\$result\[(\d+)\](.*)$/;

/**
 * Rewrites `$result[N]...` references in action params from the caller's original
 * (1-per-action) indices to their actual position in `expandedActions`. Needed
 * because some actions (e.g. create_icon) expand into more than one Figma-native
 * action, which shifts every subsequent action's index out from under any
 * $result[N] reference the caller wrote against their own action list.
 */
function remapResultIndices(value: unknown, indexMap: number[]): unknown {
  if (typeof value === "string") {
    const match = value.match(RESULT_REF_PATTERN);
    if (match) {
      const originalIndex = parseInt(match[1], 10);
      const mapped = indexMap[originalIndex];
      if (mapped === undefined) return value;
      return `$result[${mapped}]${match[2]}`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => remapResultIndices(item, indexMap));
  }
  if (value !== null && typeof value === "object") {
    const remapped: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      remapped[key] = remapResultIndices((value as Record<string, unknown>)[key], indexMap);
    }
    return remapped;
  }
  return value;
}

/**
 * Register batch operation tools to the MCP server.
 * Provides a meta-tool for executing multiple Figma commands in a single round-trip.
 * @param server - The MCP server instance
 */
export function registerBatchTools(server: McpServer): void {
  server.tool(
    "batch_actions",
    "Execute multiple Figma commands in a single batch call. Use this to batch operations like clone_node, rename_node, resize_node, set_fill_color, bind_variable etc. for multiple nodes instead of calling them one by one. Supports $result[N].field references to use results from earlier actions (e.g., clone then rename using new ID) — N is the index of the action as YOU listed it in `actions`, regardless of how any action (e.g. create_icon) expands internally. Set stopOnError to true to abort remaining actions after the first failure. An undo checkpoint is committed before the batch runs by default, so one undo in Figma reverts exactly this batch (set checkpoint:false to opt out).",
    {
      actions: z
        .array(
          z.object({
            action: z.string().describe("Command name (e.g., 'clone_node', 'set_fill_color')"),
            params: z.record(z.unknown()).optional().default({}).describe("Parameters for the command"),
          }),
        )
        .min(1)
        .describe("Array of actions to execute sequentially in a single batch"),
      stopOnError: z
        .boolean()
        .optional()
        .default(false)
        .describe("Stop processing remaining actions after the first failure (default: false)"),
      checkpoint: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Commit an undo checkpoint BEFORE running the batch (default: true), so a single undo in Figma reverts exactly this batch and nothing that came before it. Set to false only to deliberately merge this batch into the preceding undo group.",
        ),
    },
    async ({ actions, stopOnError, checkpoint }) => {
      // Declared outside the try so the catch block can report how many actions were
      // actually dispatched when the transport itself fails.
      const expandedActions: { action: string; params: Record<string, unknown> }[] = [];
      try {
        // Close off everything done so far into its own undo group, so the batch that
        // follows is one clean, revertible unit. Best-effort: a checkpoint failure must
        // never block the work the caller actually asked for.
        if (checkpoint) {
          try {
            await sendCommandToFigma("commit_undo");
          } catch {
            // Nothing to checkpoint yet (e.g. fresh session) — proceed with the batch.
          }
        }
        // Pre-process: expand server-side-only commands (create_icon) into Figma-native commands.
        // create_icon → create_svg + optional insert_child (icon SVG resolved server-side).
        // indexMap[originalActionIndex] = index in expandedActions holding that
        // action's primary result (the node create_icon expands to, not its
        // secondary insert_child step) — used to rewrite $result[N] references
        // the caller wrote against their own (pre-expansion) action list.
        const indexMap: number[] = [];

        for (let i = 0; i < actions.length; i++) {
          const { action, params: rawParams } = actions[i];
          // Normalise BEFORE dispatch so a batched action accepts the same param names
          // and value formats as the equivalent standalone tool (batch forwards params
          // raw to the plugin, bypassing each tool's own zod schema).
          const actionParams = normalizeCommandParams(
            action,
            remapResultIndices(rawParams, indexMap) as Record<string, unknown>,
          );

          if (action === "create_icon") {
            try {
              const p = actionParams as Record<string, unknown>;
              const parentId = normalizeNodeId(String(p.parentId ?? ""));
              const resolved = resolveCreateIconParams({
                parentId,
                index: p.index !== undefined ? Number(p.index) : undefined,
                name: String(p.name ?? ""),
                color: p.color !== undefined ? String(p.color) : undefined,
                colorVariable: p.colorVariable !== undefined ? String(p.colorVariable) : undefined,
                size: Number(p.size ?? 24),
              });

              expandedActions.push({
                action: "create_svg",
                params: resolved.createSvgParams as Record<string, unknown>,
              });
              // The icon node itself — created by create_svg — is what a caller's
              // $result[i] reference means, regardless of whether an insert_child
              // step follows it.
              indexMap[i] = expandedActions.length - 1;

              if (resolved.insertChildIndex !== undefined) {
                expandedActions.push({
                  action: "insert_child",
                  params: {
                    parentId,
                    childId: `$result[${expandedActions.length - 1}].id`,
                    index: resolved.insertChildIndex,
                  },
                });
              }
            } catch (error) {
              // Icon resolution failed — push a no-op that will surface the error clearly
              // Use a non-existent action that will fail in the plugin with a clear message
              expandedActions.push({
                action: "create_icon",
                params: {
                  _error: error instanceof Error ? error.message : String(error),
                },
              });
              indexMap[i] = expandedActions.length - 1;
            }
          } else if (action === "update_icon") {
            // Resolve the Lucide icon server-side — the plugin needs `svgString`, which
            // only the standalone tool used to produce.
            try {
              const p = actionParams;
              expandedActions.push({
                action: "update_icon",
                params:
                  p.svgString !== undefined
                    ? p
                    : resolveUpdateIconParams({
                        nodeId: normalizeNodeId(String(p.nodeId ?? "")),
                        name: String(p.name ?? ""),
                        color: p.color !== undefined ? String(p.color) : undefined,
                        colorVariable: p.colorVariable !== undefined ? String(p.colorVariable) : undefined,
                        size: Number(p.size ?? 24),
                      }),
              });
            } catch (error) {
              expandedActions.push({
                action: "update_icon",
                params: { _error: error instanceof Error ? error.message : String(error) },
              });
            }
            indexMap[i] = expandedActions.length - 1;
          } else {
            expandedActions.push({ action, params: actionParams });
            indexMap[i] = expandedActions.length - 1;
          }
        }

        const timeoutMs = 30000 + expandedActions.length * 2000;
        const result = (await sendCommandToFigma(
          "batch_actions",
          { actions: expandedActions, stopOnError },
          timeoutMs,
        )) as BatchActionsResult;

        const summary = `Batch completed: ${result.succeeded}/${result.totalActions} succeeded${result.failed > 0 ? `, ${result.failed} failed` : ""}`;
        const lines: string[] = [summary];
        if (result.results?.length) {
          const failedResults = result.results.filter((r) => !r.success);
          if (failedResults.length > 0) {
            lines.push("", "| # | Action | Status | Detail |", "|---|--------|--------|--------|");
            for (const r of failedResults) {
              lines.push(`| ${r.index} | ${r.action} | FAIL | ${r.error || "unknown error"} |`);
            }
            const firstFailure = failedResults[0];
            // Only actions that SUCCEEDED mutated the document. When the very first
            // action failed, nothing was committed — saying otherwise sends the caller
            // hunting for a node that was never created.
            const committedBefore = (result.results ?? []).filter((r) => r.success && r.index < firstFailure.index);
            lines.push(
              "",
              committedBefore.length === 0
                ? `First failure: action #${firstFailure.index} (${firstFailure.action}). No actions were committed to the document.`
                : `First failure: action #${firstFailure.index} (${firstFailure.action}). ${committedBefore.length} earlier action(s) succeeded and ARE committed in the document (${committedBefore.map((r) => `#${r.index}`).join(", ")}).`,
            );
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: lines.join("\n"),
            },
          ],
          isError: result.failed > 0,
        };
      } catch (error) {
        // A transport-level failure (timeout, serialisation error such as "Cannot unwrap
        // symbol") gives us no per-action results — say so explicitly rather than leaving
        // the caller unsure which action failed or what was committed.
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Error executing batch actions: ${message}`,
                "",
                `The batch was dispatched as ${expandedActions.length} action(s) but no per-action results were returned.`,
                "Actions that ran before the failure ARE committed in the Figma document — re-run only the remaining actions, or use undo.",
                "Re-run with stopOnError: true and a smaller batch to identify the failing action index.",
              ].join("\n"),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
