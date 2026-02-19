import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { BatchActionsResult } from "../types";

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
        .max(200)
        .describe("Array of actions to execute sequentially in a single batch"),
      stopOnError: z
        .boolean()
        .optional()
        .default(false)
        .describe("Stop processing remaining actions after the first failure (default: false)"),
    },
    async ({ actions, stopOnError }) => {
      try {
        const timeoutMs = 30000 + actions.length * 2000;
        const result = (await sendCommandToFigma(
          "batch_actions",
          { actions, stopOnError },
          timeoutMs,
        )) as BatchActionsResult;

        const summary = `Batch completed: ${result.succeeded}/${result.totalActions} succeeded${result.failed > 0 ? `, ${result.failed} failed` : ""}`;
        const lines: string[] = [summary];
        if (result.results?.length) {
          lines.push("", "| # | Action | Status | Detail |", "|---|--------|--------|--------|");
          for (const r of result.results) {
            const status = r.success ? "OK" : "FAIL";
            const detail = r.error || (r.result?.id ? `ID: ${r.result.id}` : "done");
            lines.push(`| ${r.index} | ${r.action} | ${status} | ${detail} |`);
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: lines.join("\n"),
            },
          ],
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
