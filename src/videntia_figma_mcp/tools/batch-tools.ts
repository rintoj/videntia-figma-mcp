import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { BatchActionsResult, BatchActionResult } from "../types";
import { resolveCreateIconParams, resolveUpdateIconParams } from "./icon-tools";
import { normalizeNodeId } from "../utils/figma-helpers";
import { normalizeCommandParams } from "../utils/normalize-batch-params";
import { resolveResultReferences } from "../utils/resolve-result-references";
import { formatState } from "../utils/return-state";
import { batchActionSchema } from "../utils/batch-action-schema";

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
 * Max Figma-native actions sent to the plugin in ONE round trip.
 *
 * WHY: very long batches intermittently blow up the plugin bridge with
 * "Cannot unwrap symbol" — a serialisation failure of the WHOLE response, which
 * costs the caller every per-action result, not just the offending one. Result
 * sanitisation (plugin side) fixes the offending values; chunking bounds the payload
 * so one oversized response cannot take the entire batch down with it.
 */
export const BATCH_CHUNK_SIZE = 40;

/**
 * Rewrites `$result[N]` references for a chunk that starts at `offset`.
 *  - N < offset  → the referenced action already ran: substitute its VALUE, so the
 *                  reference survives a chunk boundary the plugin cannot see across.
 *  - N >= offset → rewrite to the chunk-local index `N - offset`.
 */
function rebaseResultRefs(value: unknown, offset: number, completed: BatchActionResult[]): unknown {
  if (typeof value === "string") {
    const match = value.match(RESULT_REF_PATTERN);
    if (!match) return value;
    const index = parseInt(match[1], 10);
    if (index >= offset) return `$result[${index - offset}]${match[2]}`;
    // Resolve against results we already hold. resolveResultReferences throws a
    // descriptive error for a failed/absent reference — let it propagate.
    return resolveResultReferences(value, completed);
  }
  if (Array.isArray(value)) return value.map((item) => rebaseResultRefs(item, offset, completed));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = rebaseResultRefs((value as Record<string, unknown>)[key], offset, completed);
    }
    return out;
  }
  return value;
}

/**
 * Sends `actions` to the plugin, splitting into chunks of BATCH_CHUNK_SIZE when
 * needed and stitching the per-action results back into ONE global-indexed result,
 * so chunking is invisible to the caller — `$result[N]` indices included.
 */
async function dispatchInChunks(
  actions: { action: string; params: Record<string, unknown> }[],
  stopOnError: boolean,
  return_state?: unknown,
): Promise<BatchActionsResult> {
  // Only send return_state when it is ON: an always-present `false` would change
  // the plugin payload for every existing caller.
  const stateFlag: Record<string, unknown> = return_state ? { return_state: true } : {};

  if (actions.length <= BATCH_CHUNK_SIZE) {
    const timeoutMs = 30000 + actions.length * 2000;
    return (await sendCommandToFigma(
      "batch_actions",
      { actions, stopOnError, ...stateFlag },
      timeoutMs,
    )) as BatchActionsResult;
  }

  const results: BatchActionResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (let offset = 0; offset < actions.length; offset += BATCH_CHUNK_SIZE) {
    const chunk = actions.slice(offset, offset + BATCH_CHUNK_SIZE).map((a) => ({
      action: a.action,
      params: rebaseResultRefs(a.params, offset, results) as Record<string, unknown>,
    }));

    const timeoutMs = 30000 + chunk.length * 2000;
    const chunkResult = (await sendCommandToFigma(
      "batch_actions",
      { actions: chunk, stopOnError, ...stateFlag },
      timeoutMs,
    )) as BatchActionsResult;

    for (const r of chunkResult.results ?? []) {
      results.push({ ...r, index: r.index + offset });
      if (r.success) succeeded++;
      else failed++;
    }

    // stopOnError must hold ACROSS chunks too, or a failure in chunk 1 would still
    // let chunk 2 mutate the document.
    if (stopOnError && failed > 0) break;
  }

  return { totalActions: results.length, succeeded, failed, results } as BatchActionsResult;
}

/**
 * Register batch operation tools to the MCP server.
 * Provides a meta-tool for executing multiple Figma commands in a single round-trip.
 * @param server - The MCP server instance
 */
export function registerBatchTools(server: McpServer): void {
  server.tool(
    "batch_actions",
    'Execute multiple Figma commands in a single batch call. SHAPE: {actions: [{action: "<command_name>", params: {...}}, ...]} — `action` is the command name string and `params` its object (`type` is accepted as an alias for `action`; params written flat next to `action` are folded in). EXAMPLE: {"actions": [{"action": "clone_node", "params": {"nodeId": "1:23"}}, {"action": "rename_node", "params": {"nodeId": "$result[0].id", "name": "Copy"}}, {"action": "apply_text_style", "params": {"nodeId": "1:24", "styleName": "body/md"}}]}. Every batched action accepts EXACTLY the same parameters as the equivalent standalone tool, names included — pass styleName/variableName/icon name and they are resolved server-side, exactly as standalone. Call get_schema_definition with target:"batch_actions" for the full action schema. Supports $result[N].field references to use results from earlier actions (e.g., clone then rename using new ID) — N is the index of the action as YOU listed it in `actions`, regardless of how any action (e.g. create_icon) expands internally; references are preserved even when a long batch is auto-chunked. Set stopOnError to true to abort remaining actions after the first failure. An undo checkpoint is committed before the batch runs by default, so one undo in Figma reverts exactly this batch (set checkpoint:false to opt out).',
    {
      actions: z
        .array(batchActionSchema)
        .min(1)
        .describe(
          "Array of actions to execute sequentially in a single batch. Each entry is {action, params}; `type` is accepted as an alias for `action`, and params written flat alongside `action` are folded into `params` automatically.",
        ),
      stopOnError: z
        .boolean()
        .optional()
        .default(false)
        .describe("Stop processing remaining actions after the first failure (default: false)"),
      return_state: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Apply-and-verify: each action's result carries the ACTUAL post-write state of the node it touched (one compact summary line + the properties that write touched, plus any silently discarded writes). Use this instead of following a batch with get_node_info calls.",
        ),
      checkpoint: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Commit an undo checkpoint BEFORE running the batch (default: true), so a single undo in Figma reverts exactly this batch and nothing that came before it. Set to false only to deliberately merge this batch into the preceding undo group.",
        ),
    },
    async ({ actions, stopOnError, checkpoint, return_state }) => {
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

        const result = await dispatchInChunks(expandedActions, stopOnError, return_state);

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

        if (return_state && result.results?.length) {
          const stateLines: string[] = [];
          for (const r of result.results) {
            if (!r.success) continue;
            const rendered = formatState(r.result);
            if (rendered) stateLines.push(`#${r.index} ${r.action}${rendered}`);
          }
          if (stateLines.length > 0) lines.push("", ...stateLines);
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
