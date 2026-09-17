import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { BatchActionsResult, BatchActionResult } from "../types";
import { resolveCreateIconParams } from "./icon-tools";
import { normalizeNodeId } from "../utils/figma-helpers";
import { resolveResultReferences } from "../utils/resolve-result-references";
import { formatState } from "../utils/return-state";
import { renderActionTable } from "../utils/batch-result-digest";
import { batchActionSchema } from "../utils/batch-action-schema";
import { computePureAction, isPureAction, nonBatchableReason } from "../utils/pure-batch-actions";
import { getRegisteredTool } from "../utils/tool-registry";
import { captureWireCommands } from "../utils/tool-capture";
import { parseWithResultRefs, restoreResultRefs } from "../utils/result-ref-parse";

/**
 * Build the wire payload(s) for ONE batched action by running its STANDALONE tool.
 *
 * This is the whole point of the unification: the action is parsed by the tool's own
 * zod schema (same names, same coercions, same defaults) and then the tool's own
 * handler is run in capture mode, so whatever it would have put on the wire standalone
 * is exactly what the batch sends. No alias map, no second source of truth.
 */
async function buildActionCommands(
  action: string,
  params: Record<string, unknown>,
): Promise<{ commands: { action: string; params: Record<string, unknown> }[] } | { error: string }> {
  const entry = getRegisteredTool(action);
  if (!entry) {
    return {
      error:
        `Unknown command '${action}': no MCP tool of that name is registered. ` +
        `A batched action must name a tool exactly as it is spelled standalone. ` +
        `This server uses progressive tool discovery, so a tool absent from your tool list still exists here — ` +
        `call find_figma_tools({query:"${action.replace(/_/g, " ")}"}) to get the right name, then describe_figma_tools first for its schema.`,
    };
  }

  let parsed: Record<string, unknown>;
  let sentinels: Map<number, string>;
  try {
    const out = parseWithResultRefs(entry.schema, params);
    parsed = out.parsed;
    sentinels = out.sentinels;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const detail = error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      return { error: `Invalid params for '${action}' (same schema as the standalone tool): ${detail}` };
    }
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const { captured, error } = await captureWireCommands(() => entry.handler(parsed, { meta: {} }));
  if (captured.length === 0) {
    return {
      error:
        error !== undefined
          ? `'${action}' failed while building its batch payload: ${error}`
          : `'${action}' issued no Figma command, so it cannot run inside a batch.`,
    };
  }

  return {
    commands: captured.map((c) => ({
      action: c.command,
      params: restoreResultRefs(c.params, sentinels) as Record<string, unknown>,
    })),
  };
}

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
 * A batch entry that never reaches the plugin: a pure server-side computation
 * (#16) evaluated here, or a server-side-only tool that cannot be batched at all.
 * `expandedPos` is the number of Figma-native actions queued BEFORE it, i.e. where
 * its result has to be spliced back into the plugin's result list so the caller
 * sees one row per action in their original order.
 */
interface ServerSideEntry {
  expandedPos: number;
  action: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Substitutes `$result[N]...` references that point at a PURE action, using the
 * value computed server-side. Done before dispatch, so the plugin never has to know
 * the pure action existed — this is what makes "compute a colour, then apply it"
 * chain cleanly inside one batch.
 */
function substitutePureRefs(value: unknown, computed: Map<number, unknown>): unknown {
  if (typeof value === "string") {
    const match = value.match(RESULT_REF_PATTERN);
    if (!match) return value;
    const index = parseInt(match[1], 10);
    if (!computed.has(index)) return value;
    return resolveResultReferences(value, [
      // resolveResultReferences walks by array position, so pad up to `index`.
      ...Array.from({ length: index }, () => ({ index: 0, action: "", success: true, result: {} })),
      { index, action: "", success: true, result: computed.get(index) },
    ] as BatchActionResult[]);
  }
  if (Array.isArray(value)) return value.map((item) => substitutePureRefs(item, computed));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = substitutePureRefs((value as Record<string, unknown>)[key], computed);
    }
    return out;
  }
  return value;
}

/**
 * Splices the server-side entries back into the plugin's per-action results, so the
 * returned list is one row per dispatched-or-computed action, re-indexed in order.
 */
export function mergeServerSideResults(
  pluginResults: BatchActionResult[],
  entries: ServerSideEntry[],
): BatchActionResult[] {
  const merged: BatchActionResult[] = [];
  const inserts = [...entries].sort((a, b) => a.expandedPos - b.expandedPos);
  let consumed = 0;
  let ins = 0;
  while (consumed < pluginResults.length || ins < inserts.length) {
    if (ins < inserts.length && (inserts[ins].expandedPos <= consumed || consumed >= pluginResults.length)) {
      const e = inserts[ins++];
      merged.push({
        index: merged.length,
        action: e.action,
        success: e.success,
        ...(e.success ? { result: e.result } : { error: e.error }),
      } as BatchActionResult);
    } else {
      merged.push({ ...pluginResults[consumed], index: merged.length });
      consumed++;
    }
  }
  return merged;
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

  return { success: failed === 0, totalActions: results.length, succeeded, failed, results } as BatchActionsResult;
}

/**
 * Best-effort node id for one batch action's result, so the recovery manifest can
 * name what each committed action actually produced or touched.
 */
function extractNodeId(result: unknown): string | undefined {
  if (result === null || typeof result !== "object") return undefined;
  const r = result as Record<string, unknown>;
  for (const key of ["id", "nodeId", "newNodeId"]) {
    if (typeof r[key] === "string") return r[key] as string;
  }
  if (Array.isArray(r.ids) && typeof r.ids[0] === "string") return r.ids[0] as string;
  return undefined;
}

/**
 * Register batch operation tools to the MCP server.
 * Provides a meta-tool for executing multiple Figma commands in a single round-trip.
 * @param server - The MCP server instance
 */
export function registerBatchTools(server: McpServer): void {
  server.tool(
    "batch_actions",
    'Execute multiple Figma commands in a single batch call. SHAPE: {actions: [{action: "<command_name>", params: {...}}, ...]} — `action` is the command name string and `params` its object (`type` is accepted as an alias for `action`; params written flat next to `action` are folded in). EXAMPLE: {"actions": [{"action": "clone_node", "params": {"nodeId": "1:23"}}, {"action": "rename_node", "params": {"nodeId": "$result[0].id", "name": "Copy"}}, {"action": "apply_text_style", "params": {"nodeId": "1:24", "styleName": "body/md"}}]}. Every batched action accepts EXACTLY the same parameters as the equivalent standalone tool, names included — pass styleName/variableName/icon name and they are resolved server-side, exactly as standalone. Call get_schema_definition with target:"batch_actions" for the full action schema. Supports $result[N].field references to use results from earlier actions (e.g., clone then rename using new ID) — N is the index of the action as YOU listed it in `actions`, regardless of how any action (e.g. create_icon) expands internally; references are preserved even when a long batch is auto-chunked. Set stopOnError to true to abort remaining actions after the first failure. An undo checkpoint is committed before the batch runs by default, so one undo in Figma reverts exactly this batch (set checkpoint:false to opt out). The response ALWAYS carries one compact row per action (index, action, OK/FAIL, and a short digest of what it returned — new node id, or a read command\'s natural value), so no follow-up read is needed just to see what happened; set return_state:true for the verbose post-write state of every node touched.',
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
          "VERBOSE opt-in on top of the per-action rows every batch already returns: each action additionally reports the ACTUAL post-write state of the node it touched (one compact summary line + the properties that write touched, plus any silently discarded writes under `noops`). Use this instead of following a batch with get_node_info calls.",
        ),
      checkpoint: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Commit an undo checkpoint BEFORE running the batch (default: true), so a single undo in Figma reverts exactly this batch and nothing that came before it. This is the only rollback available — Figma's plugin API has no transaction, so a partially-failed batch is never rolled back automatically; the failure report lists every action's committed state so you can recover without re-reading the document. Set to false only to deliberately merge this batch into the preceding undo group.",
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
        // Entries that never reach the plugin: pure computations evaluated here, and
        // server-side-only tools rejected with a reason instead of "Unknown command".
        const serverSideEntries: ServerSideEntry[] = [];
        // originalActionIndex -> value, for $result[N] references to a pure action.
        const pureValues = new Map<number, unknown>();

        for (let i = 0; i < actions.length; i++) {
          const { action, params: rawParams } = actions[i];
          const actionParams = remapResultIndices(substitutePureRefs(rawParams, pureValues), indexMap) as Record<
            string,
            unknown
          >;

          if (isPureAction(action)) {
            // Computed server-side, right now: the value is available to every later
            // action in this same batch via $result[i].
            try {
              const value = computePureAction(action, actionParams);
              pureValues.set(i, value);
              serverSideEntries.push({
                expandedPos: expandedActions.length,
                action,
                success: true,
                result: value,
              });
            } catch (error) {
              serverSideEntries.push({
                expandedPos: expandedActions.length,
                action,
                success: false,
                error: error instanceof Error ? error.message : String(error),
              });
              if (stopOnError) break;
            }
            indexMap[i] = -1;
            continue;
          }

          const blocked = nonBatchableReason(action);
          if (blocked) {
            serverSideEntries.push({
              expandedPos: expandedActions.length,
              action,
              success: false,
              error: blocked,
            });
            indexMap[i] = -1;
            if (stopOnError) break;
            continue;
          }

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
          } else {
            // EVERY other action: parsed by its standalone tool's own zod schema and
            // built by its standalone handler, so the payload is identical to the
            // standalone call by construction (utils/tool-capture.ts).
            const built = await buildActionCommands(action, actionParams);
            if ("error" in built) {
              serverSideEntries.push({
                expandedPos: expandedActions.length,
                action,
                success: false,
                error: built.error,
              });
              indexMap[i] = -1;
              if (stopOnError) break;
              continue;
            }
            // A tool that expands to several Figma commands (none currently do outside
            // create_icon) queues them all; $result[i] means its FIRST command, which is
            // the one that creates or identifies the node the caller is referring to.
            indexMap[i] = expandedActions.length;
            for (const cmd of built.commands) expandedActions.push(cmd);
          }
        }

        const dispatched =
          expandedActions.length > 0
            ? await dispatchInChunks(expandedActions, stopOnError, return_state)
            : ({ success: true, totalActions: 0, succeeded: 0, failed: 0, results: [] } as BatchActionsResult);

        // Fold the server-side entries back in so the caller sees one row per action,
        // in their original order, whether it ran in Figma or in the MCP server.
        const mergedResults = mergeServerSideResults(dispatched.results ?? [], serverSideEntries);
        const result: BatchActionsResult = {
          success: mergedResults.every((r) => r.success),
          totalActions: mergedResults.length,
          succeeded: mergedResults.filter((r) => r.success).length,
          failed: mergedResults.filter((r) => !r.success).length,
          results: mergedResults,
        };

        const summary = `Batch completed: ${result.succeeded}/${result.totalActions} succeeded${result.failed > 0 ? `, ${result.failed} failed` : ""}`;
        const lines: string[] = [summary];
        if (result.results?.length) {
          // ALWAYS one compact row per action — a batch must be informative without the
          // caller opting in, and without dumping whole nodes (utils/batch-result-digest.ts).
          lines.push("", ...renderActionTable(result.results));
          const failedResults = result.results.filter((r) => !r.success);
          if (failedResults.length > 0) {
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
            if (committedBefore.length > 0) {
              lines.push(
                "A partial batch is NOT rolled back automatically: the Figma plugin API exposes no transaction, " +
                  "and undo is a user-level stack the plugin cannot replay selectively. Because an undo checkpoint was " +
                  "committed before this batch, ONE undo in Figma (or the `undo` tool) reverts exactly these actions and " +
                  "nothing earlier. Otherwise, use the per-action results below to re-run only what did not land.",
              );
            }
          }
        }

        // Machine-readable recovery manifest. Figma exposes NO transactional rollback
        // (see the comment on `checkpoint` below), so when a batch partially commits the
        // caller needs to know EXACTLY what landed without re-reading the document:
        // one row per action with its index, command, outcome, resulting node id, and
        // whether it is committed.
        if (result.failed > 0 && result.results?.length) {
          const manifest = result.results.map((r) => ({
            index: r.index,
            action: r.action,
            success: r.success,
            // Only a successful action mutated the document; a failed one wrote nothing.
            committed: r.success,
            nodeId: r.success ? extractNodeId(r.result) : undefined,
            ...(r.success ? {} : { error: r.error || "unknown error" }),
          }));
          lines.push(
            "",
            "Per-action results (machine-readable; no document re-read needed):",
            "```json",
            JSON.stringify(manifest),
            "```",
          );
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
