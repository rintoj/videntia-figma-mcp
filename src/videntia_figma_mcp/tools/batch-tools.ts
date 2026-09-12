import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { BatchActionsResult } from "../types";
import { resolveCreateIconParams, resolveUpdateIconParams } from "./icon-tools";
import { normalizeNodeId } from "../utils/figma-helpers";
import { normalizeCommandParams } from "../utils/command-params";

const RESULT_REF_PATTERN = /^\$result\[(\d+)\](.*)$/;
const MAX_DETAIL_LENGTH = 160;
/** Caps the per-action table so very large batches don't flood the response; failures are always listed. */
const MAX_SUCCESS_ROWS = 100;

/** Tools that do their work on the MCP server, so the plugin-side batch cannot run them. */
const SERVER_ONLY_ACTIONS = new Set([
  "create_complete_design_system",
  "compare_figma_to_component",
  "diff_figma_to_browser",
  "diff_figma_frame_to_page",
]);

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

function summarizeResult(result: unknown): string {
  if (result === undefined || result === null) return "—";
  const text = typeof result === "string" ? result : JSON.stringify(result);
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
}

function tableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Register batch operation tools to the MCP server.
 * Provides a meta-tool for executing multiple Figma commands in a single round-trip.
 * @param server - The MCP server instance
 */
export function registerBatchTools(server: McpServer): void {
  server.tool(
    "batch_actions",
    "Execute multiple Figma commands in a single batch call. Use this to batch operations like clone_node, rename_node, resize_node, set_fill_color, set_layout_sizing, bind_variable etc. for multiple nodes instead of calling them one by one. Each action's params use the SAME names as the individual tool (e.g. set_layout_sizing {nodeId, horizontal, vertical}; set_layout_mode {nodeId, mode, rows, columns}; set_padding {top, right, bottom, left}) and get the same defaults, validation and node-id normalization ('1-2' → '1:2'). Supports $result[N].field references to use results from earlier actions (e.g., clone then rename using new ID) — N is the index of the action as YOU listed it in `actions`, regardless of how any action (e.g. create_icon) expands internally. The response lists each action with its status and a compact result so you can confirm each one changed what you expected (every failure is listed; successful rows are capped at the first 100). Set stopOnError to true to abort remaining actions after the first failure.",
    {
      actions: z
        .array(
          z.object({
            action: z.string().describe("Command name (e.g., 'clone_node', 'set_fill_color')"),
            params: z
              .record(z.unknown())
              .optional()
              .default({})
              .describe("Parameters for the command — same names as the individual tool"),
          }),
        )
        .min(1)
        .describe("Array of actions to execute sequentially in a single batch"),
      stopOnError: z
        .boolean()
        .optional()
        .default(false)
        .describe("Stop processing remaining actions after the first failure (default: false)"),
    },
    async ({ actions, stopOnError }) => {
      try {
        const expandedActions: Array<{ action: string; params: Record<string, unknown> }> = [];
        // indexMap[originalActionIndex] = index in expandedActions holding that
        // action's primary result (the node create_icon expands to, not its
        // secondary insert_child step) — used to rewrite $result[N] references
        // the caller wrote against their own (pre-expansion) action list.
        const indexMap: number[] = [];
        // originalIndexOf[expandedIndex] = the caller's action index, for reporting.
        const originalIndexOf: number[] = [];
        // Actions rejected before reaching Figma; the plugin fails them with this message.
        const preflightErrors = new Map<number, string>();

        const pushAction = (originalIndex: number, action: string, params: Record<string, unknown>): number => {
          expandedActions.push({ action, params });
          originalIndexOf.push(originalIndex);
          return expandedActions.length - 1;
        };
        const pushError = (originalIndex: number, action: string, message: string): number => {
          const index = pushAction(originalIndex, action, { __batchError: message });
          preflightErrors.set(index, message);
          return index;
        };

        for (let i = 0; i < actions.length; i++) {
          const { action, params: rawParams } = actions[i];
          const p = remapResultIndices(rawParams, indexMap) as Record<string, unknown>;

          if (action === "create_icon") {
            // Server-side only: resolve the SVG, then create_svg + optional insert_child.
            try {
              const parentId = normalizeNodeId(String(p.parentId ?? ""));
              const resolved = resolveCreateIconParams({
                parentId,
                index: p.index !== undefined ? Number(p.index) : undefined,
                name: String(p.name ?? ""),
                color: p.color !== undefined ? String(p.color) : undefined,
                colorVariable: p.colorVariable !== undefined ? String(p.colorVariable) : undefined,
                size: Number(p.size ?? 24),
                constraints:
                  p.constraints && typeof p.constraints === "object"
                    ? (p.constraints as { horizontal?: string; vertical?: string })
                    : undefined,
              });
              // The icon node itself is what a caller's $result[i] reference means.
              indexMap[i] = pushAction(i, "create_svg", resolved.createSvgParams);
              if (resolved.insertChildIndex !== undefined) {
                pushAction(i, "insert_child", {
                  parentId,
                  childId: `$result[${indexMap[i]}].id`,
                  index: resolved.insertChildIndex,
                });
              }
            } catch (error) {
              indexMap[i] = pushError(i, action, errorMessage(error));
            }
          } else if (action === "update_icon") {
            try {
              const resolved = resolveUpdateIconParams({
                nodeId: String(p.nodeId ?? ""),
                name: String(p.name ?? ""),
                color: p.color !== undefined ? String(p.color) : undefined,
                colorVariable: p.colorVariable !== undefined ? String(p.colorVariable) : undefined,
                size: Number(p.size ?? 24),
              });
              indexMap[i] = pushAction(i, action, resolved);
            } catch (error) {
              indexMap[i] = pushError(i, action, errorMessage(error));
            }
          } else if (
            SERVER_ONLY_ACTIONS.has(action) ||
            (action === "export_image_fill" && p.exportPath !== undefined)
          ) {
            indexMap[i] = pushError(
              i,
              action,
              `${action} runs on the MCP server and cannot be used inside batch_actions — call the tool directly`,
            );
          } else {
            try {
              indexMap[i] = pushAction(i, action, normalizeCommandParams(action, p));
            } catch (error) {
              indexMap[i] = pushError(i, action, errorMessage(error));
            }
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
          lines.push("", "| # | Action | Status | Detail |", "|---|--------|--------|--------|");
          let okRows = 0;
          let omittedOk = 0;
          for (const r of result.results) {
            if (r.success && okRows >= MAX_SUCCESS_ROWS) {
              omittedOk++;
              continue;
            }
            if (r.success) okRows++;
            const detail = r.success
              ? summarizeResult(r.result)
              : (preflightErrors.get(r.index) ?? r.error ?? "unknown error");
            const index = originalIndexOf[r.index] ?? r.index;
            lines.push(`| ${index} | ${r.action} | ${r.success ? "OK" : "FAIL"} | ${tableCell(detail)} |`);
          }
          if (omittedOk > 0) {
            lines.push(
              "",
              `${omittedOk} more successful action(s) not listed (first ${MAX_SUCCESS_ROWS} OK rows shown; failures are always listed).`,
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
        return {
          content: [
            {
              type: "text" as const,
              text: `Error executing batch actions: ${errorMessage(error)}`,
            },
          ],
        };
      }
    },
  );
}
