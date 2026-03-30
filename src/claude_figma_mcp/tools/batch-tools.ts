import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { BatchActionsResult } from "../types";
import { resolveCreateIconParams } from "./icon-tools";
import { normalizeNodeId } from "../utils/figma-helpers";

/**
 * Register batch operation tools to the MCP server.
 * Provides a meta-tool for executing multiple Figma commands in a single round-trip.
 * @param server - The MCP server instance
 */
export function registerBatchTools(server: McpServer): void {
  server.tool(
    "batch_actions",
    "Execute multiple Figma commands in a single batch call. Use this to batch operations like clone_node, rename_node, resize_node, set_fill_color, bind_variable etc. for multiple nodes instead of calling them one by one. Supports $result[N].field references to use results from earlier actions (e.g., clone then rename using new ID). Set stopOnError to true to abort remaining actions after the first failure.",
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
    },
    async ({ actions, stopOnError }) => {
      try {
        // Pre-process: expand server-side-only commands (create_icon) into Figma-native commands.
        // create_icon → create_svg + optional insert_child (icon SVG resolved server-side).
        const expandedActions: typeof actions = [];

        for (let i = 0; i < actions.length; i++) {
          const { action, params: actionParams } = actions[i];

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
            }
          } else {
            expandedActions.push({ action, params: actionParams });
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
              text: `Error executing batch actions: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}
