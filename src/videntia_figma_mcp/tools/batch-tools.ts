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
import { applyParamAliases } from "../utils/param-aliases";
import {
  batchPostPlan,
  NON_MUTATING_BATCH_ACTIONS,
  SERVER_POST_WORK_REASONS,
  type BatchPostProcessor,
} from "../utils/batch-post-process";

/** Pull a readable message out of a handler's MCP result (its first text block). */
function handlerResultText(returned: unknown): string | undefined {
  const content = (returned as { content?: Array<{ type?: string; text?: unknown }> } | undefined)?.content;
  if (!Array.isArray(content)) return undefined;
  const text = content.find((c) => c?.type === "text" && typeof c.text === "string")?.text as string | undefined;
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed?.error === "string") return parsed.error;
  } catch {
    // Plain-text result.
  }
  return text.length > 400 ? `${text.slice(0, 399)}…` : text;
}

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
): Promise<
  | { commands: { action: string; params: Record<string, unknown> }[]; parsed: Record<string, unknown> }
  | { error: string }
> {
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

  const { captured, error, returned } = await captureWireCommands(() => entry.handler(parsed, { meta: {} }));
  if (captured.length === 0) {
    // The handler returned before dispatch — almost always its own validation error
    // (unknown icon, bad path), which is exactly what the caller needs to read.
    const handlerMessage = handlerResultText(returned);
    return {
      error:
        error !== undefined
          ? `'${action}' failed while building its batch payload: ${error}`
          : handlerMessage
            ? `'${action}' was rejected before reaching Figma: ${handlerMessage}`
            : `'${action}' issued no Figma command, so it cannot run inside a batch.`,
    };
  }

  // A later command built after reading an earlier command's result was built from a
  // capture-mode placeholder, not real data — sending it would act on garbage.
  if (captured.slice(1).some((c) => c.resultReadsBefore > 0)) {
    return {
      error:
        `'${action}' chains several Figma commands where later ones depend on the result of earlier ones ` +
        `(${captured.map((c) => c.command).join(" → ")}), which a batch cannot reproduce. Call it standalone.`,
    };
  }

  return {
    commands: captured.map((c) => ({
      action: c.command,
      params: restoreResultRefs(c.params, sentinels) as Record<string, unknown>,
    })),
    parsed: restoreResultRefs(parsed, sentinels) as Record<string, unknown>,
  };
}

const RESULT_REF_PATTERN = /^\$result\[(\d+)\](.*)$/;

/**
 * Where one CALLER action (an entry of `actions`, as the caller indexed it) ended up.
 *  - `server`: never reached the plugin — a pure computation evaluated here, or an
 *    action rejected before dispatch.
 *  - `plugin`: dispatched as expandedActions[start..end) (create_icon expands to more
 *    than one command); `primary` holds the result `$result[N]` means. `post` is
 *    server-side work to run on that result once the plugin returns (exports).
 */
export type CallerSlot =
  | { action: string; kind: "server"; success: boolean; result?: unknown; error?: string }
  | { action: string; kind: "plugin"; start: number; end: number; primary: number; post?: BatchPostProcessor };

/**
 * Rewrites `$result[N]...` references from the caller's indices to what the plugin
 * will see. A reference to a PURE action is substituted with its computed value; a
 * reference to a dispatched action is rewritten to that action's primary expanded
 * position. A reference the plugin could only resolve wrongly — a later action, or one
 * that failed or never reached Figma — throws instead of being passed through.
 */
function remapResultIndices(value: unknown, slots: CallerSlot[], current: number): unknown {
  if (typeof value === "string") {
    const match = value.match(RESULT_REF_PATTERN);
    if (!match) return value;
    const index = parseInt(match[1], 10);
    if (index >= current) {
      throw new Error(
        `${value} refers to action #${index}, which has not run yet — this is action #${current}. ` +
          `$result[N] may only reference an EARLIER action; N is 0-based, in the order you listed the actions.`,
      );
    }
    const slot = slots[index];
    if (!slot) throw new Error(`${value} refers to action #${index}, which did not run.`);
    if (slot.kind === "server") {
      if (!slot.success) {
        throw new Error(`${value} refers to action #${index} (${slot.action}), which failed: ${slot.error}`);
      }
      // resolveResultReferences walks by array position, so pad up to `index`.
      return resolveResultReferences(value, [
        ...Array.from({ length: index }, () => ({ index: 0, action: "", success: true, result: {} })),
        { index, action: slot.action, success: true, result: slot.result },
      ] as BatchActionResult[]);
    }
    return `$result[${slot.primary}]${match[2]}`;
  }
  if (Array.isArray(value)) return value.map((item) => remapResultIndices(item, slots, current));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = remapResultIndices((value as Record<string, unknown>)[key], slots, current);
    }
    return out;
  }
  return value;
}

/** The plugin tags errors with its own (expanded, chunk-local) action index — drop it. */
const PLUGIN_INDEX_SUFFIX = / \[action #\d+ (?:\(0-based\) )?of \d+; [^\]]*\]$/;

/**
 * Folds the plugin's per-command results back into ONE row per caller action, indexed
 * by the caller's own 0-based position — the same N a `$result[N]` reference uses —
 * and named by the action the caller wrote (create_icon, not create_svg). Actions that
 * never ran (a stopOnError abort) have no row.
 */
export function assembleCallerRows(slots: CallerSlot[], pluginResults: BatchActionResult[]): BatchActionResult[] {
  const byPos = new Map<number, BatchActionResult>();
  for (const r of pluginResults) byPos.set(r.index, r);

  const rows: BatchActionResult[] = [];
  slots.forEach((slot, index) => {
    if (!slot) return;
    if (slot.kind === "server") {
      rows.push({
        index,
        action: slot.action,
        success: slot.success,
        ...(slot.success ? { result: slot.result } : { error: slot.error }),
      } as BatchActionResult);
      return;
    }
    const parts: BatchActionResult[] = [];
    for (let pos = slot.start; pos < slot.end; pos++) {
      const r = byPos.get(pos);
      if (r) parts.push(r);
    }
    if (parts.length === 0) return;
    const primary = byPos.get(slot.primary);
    const failed = parts.find((r) => !r.success);
    if (failed) {
      let error = (failed.error || "unknown error").replace(PLUGIN_INDEX_SUFFIX, "");
      if (primary?.success && failed !== primary) {
        const nodeId = extractNodeId(primary.result);
        error += ` — its ${primary.action} step succeeded${nodeId ? ` (node ${nodeId} exists)` : ""} before ${failed.action} failed`;
      }
      rows.push({ index, action: slot.action, success: false, error });
      return;
    }
    rows.push({ ...(primary ?? parts[0]), index, action: slot.action, success: true });
  });
  return rows;
}

/**
 * Runs each dispatched action's server-side post step (see utils/batch-post-process.ts)
 * on its real plugin result, replacing the row's result with what the standalone tool
 * would have returned. A post step that throws turns the row into a failure.
 */
async function applyPostProcessors(rows: BatchActionResult[], slots: CallerSlot[]): Promise<void> {
  for (const row of rows) {
    const slot = slots[row.index];
    if (!row.success || !slot || slot.kind !== "plugin" || !slot.post) continue;
    try {
      row.result = await slot.post(row.result);
    } catch (error) {
      row.success = false;
      delete row.result;
      row.error =
        `Figma returned the export, but the server-side step (write/crop/cache) failed: ` +
        (error instanceof Error ? error.message : String(error));
    }
  }
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

  let offset = 0;
  while (offset < actions.length) {
    // Rebase one action at a time. A reference into an EARLIER chunk that cannot
    // resolve (failed action, missing field) must fail only THAT action — as it would
    // inside one plugin batch — not throw away every committed chunk's results. So the
    // chunk is cut just before it and the action gets a failure row of its own.
    const chunk: { action: string; params: Record<string, unknown> }[] = [];
    let refError: { action: string; error: string } | undefined;
    for (let pos = offset; pos < actions.length && chunk.length < BATCH_CHUNK_SIZE; pos++) {
      try {
        chunk.push({
          action: actions[pos].action,
          params: rebaseResultRefs(actions[pos].params, offset, results) as Record<string, unknown>,
        });
      } catch (error) {
        refError = { action: actions[pos].action, error: error instanceof Error ? error.message : String(error) };
        break;
      }
    }

    if (chunk.length === 0 && refError) {
      results.push({ index: offset, action: refError.action, success: false, error: refError.error });
      failed++;
      offset++;
      if (stopOnError) break;
      continue;
    }

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
    offset += chunk.length;
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
    'Execute multiple Figma commands in a single batch call. SHAPE: {actions: [{action: "<command_name>", params: {...}}, ...]} — `action` is the command name string and `params` its object (`type` is accepted as an alias for `action`; params written flat next to `action` are folded in). EXAMPLE: {"actions": [{"action": "clone_node", "params": {"nodeId": "1:23"}}, {"action": "rename_node", "params": {"nodeId": "$result[0].id", "name": "Copy"}}, {"action": "apply_text_style", "params": {"nodeId": "1:24", "styleName": "body/md"}}]}. Every batched action accepts EXACTLY the same parameters as the equivalent standalone tool, names included — pass styleName/variableName/icon name and they are resolved server-side, exactly as standalone. Call get_schema_definition with target:"batch_actions" for the full action schema. Supports $result[N].field references to use results from earlier actions (e.g., clone then rename using new ID) — N is the 0-based index of the action as YOU listed it in `actions` (the first action is $result[0]), regardless of how any action (e.g. create_icon) expands internally; references are preserved even when a long batch is auto-chunked. A reference to a later, failed or missing action, or to a field the result does not have, fails that action with an error listing the available fields — it never resolves to undefined. Result rows and error messages use the same 0-based numbering. export_node_as_image / export_image_fill inside a batch write their files exactly as standalone (the row reports {path,width,height,bytes,format}); inline: true is rejected in a batch. Set stopOnError to true to abort remaining actions after the first failure. An undo checkpoint is committed before the batch runs by default, so one undo in Figma reverts exactly this batch (set checkpoint:false to opt out). The response ALWAYS carries one compact row per action (index, action, OK/FAIL, and a short digest of what it returned — new node id, or a read command\'s natural value), so no follow-up read is needed just to see what happened; set return_state:true for the verbose post-write state of every node touched.',
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
        // One slot per CALLER action (see CallerSlot). create_icon is expanded here into
        // create_svg (+ insert_child); pure computations are evaluated here; everything
        // else is built by its standalone handler in capture mode.
        const slots: CallerSlot[] = [];
        const fail = (i: number, action: string, error: unknown) => {
          slots[i] = {
            action,
            kind: "server",
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        };

        for (let i = 0; i < actions.length; i++) {
          const { action, params: rawParams } = actions[i];
          let actionParams: Record<string, unknown>;
          try {
            actionParams = remapResultIndices(rawParams, slots, i) as Record<string, unknown>;
          } catch (error) {
            fail(i, action, error);
            if (stopOnError) break;
            continue;
          }

          if (isPureAction(action)) {
            // Computed server-side, right now: the value is available to every later
            // action in this same batch via $result[i].
            try {
              slots[i] = { action, kind: "server", success: true, result: computePureAction(action, actionParams) };
            } catch (error) {
              fail(i, action, error);
              if (stopOnError) break;
            }
            continue;
          }

          const blocked = nonBatchableReason(action) ?? SERVER_POST_WORK_REASONS[action];
          if (blocked) {
            fail(i, action, blocked);
            if (stopOnError) break;
            continue;
          }

          if (action === "create_icon") {
            try {
              const p = applyParamAliases("create_icon", actionParams);
              const parentId = normalizeNodeId(String(p.parentId ?? ""));
              const resolved = resolveCreateIconParams({
                parentId,
                index: p.index !== undefined ? Number(p.index) : undefined,
                name: typeof p.name === "string" ? p.name : "",
                color: p.color !== undefined ? String(p.color) : undefined,
                colorVariable: p.colorVariable !== undefined ? String(p.colorVariable) : undefined,
                size: Number(p.size ?? 24),
                constraints:
                  p.constraints && typeof p.constraints === "object"
                    ? (p.constraints as { horizontal?: string; vertical?: string })
                    : undefined,
              });

              // The icon node itself — created by create_svg — is what a caller's
              // $result[i] reference means, whether or not an insert_child follows.
              const start = expandedActions.length;
              expandedActions.push({
                action: "create_svg",
                params: resolved.createSvgParams as Record<string, unknown>,
              });
              if (resolved.insertChildIndex !== undefined) {
                expandedActions.push({
                  action: "insert_child",
                  params: {
                    parentId,
                    childId: `$result[${start}].id`,
                    index: resolved.insertChildIndex,
                  },
                });
              }
              slots[i] = { action, kind: "plugin", start, end: expandedActions.length, primary: start };
            } catch (error) {
              fail(i, action, error);
              if (stopOnError) break;
            }
            continue;
          }

          // EVERY other action: parsed by its standalone tool's own zod schema and
          // built by its standalone handler, so the payload is identical to the
          // standalone call by construction (utils/tool-capture.ts).
          const built = await buildActionCommands(action, actionParams);
          const followsMutation = actions
            .slice(0, i)
            .some((a) => !NON_MUTATING_BATCH_ACTIONS.has(a.action) && !isPureAction(a.action));
          const plan = "error" in built ? built : batchPostPlan(action, built.parsed, { followsMutation });
          if ("error" in built || "error" in plan) {
            fail(i, action, "error" in built ? built.error : (plan as { error: string }).error);
            if (stopOnError) break;
            continue;
          }
          // A tool that expands to several Figma commands queues them all; $result[i]
          // means its FIRST command, the one that creates or identifies the node.
          const start = expandedActions.length;
          for (const cmd of built.commands) expandedActions.push(cmd);
          slots[i] = {
            action,
            kind: "plugin",
            start,
            end: expandedActions.length,
            primary: start,
            post: (plan as { post?: BatchPostProcessor }).post,
          };
        }

        const dispatched =
          expandedActions.length > 0
            ? await dispatchInChunks(expandedActions, stopOnError, return_state)
            : ({ success: true, totalActions: 0, succeeded: 0, failed: 0, results: [] } as BatchActionsResult);

        // One row per caller action, numbered by the caller's own index, whether it ran
        // in Figma or in the MCP server; then the server-side post steps (exports).
        const mergedResults = assembleCallerRows(slots, dispatched.results ?? []);
        await applyPostProcessors(mergedResults, slots);
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
