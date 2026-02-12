import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";

/**
 * Register batch operation tools to the MCP server.
 * Provides a meta-tool for executing multiple Figma commands in a single round-trip.
 * @param server - The MCP server instance
 */
export function registerBatchTools(server: McpServer): void {
  server.tool(
    "batch_actions",
    "Execute multiple Figma commands in a single batch call. Use this to batch operations like clone_node, rename_node, resize_node, set_fill_color, bind_variable etc. for multiple nodes instead of calling them one by one. Supports $result[N].field references to use results from earlier actions (e.g., clone then rename using new ID).",
    {
      actions: z
        .array(
          z.object({
            action: z
              .string()
              .describe("Command name (e.g., 'clone_node', 'set_fill_color')"),
            params: z
              .record(z.any())
              .optional()
              .default({})
              .describe("Parameters for the command"),
          }),
        )
        .min(1)
        .max(200)
        .describe("Array of actions to execute sequentially in a single batch"),
    },
    async ({ actions }) => {
      try {
        const timeoutMs = 30000 + actions.length * 2000;
        const result = (await sendCommandToFigma(
          "batch_actions",
          { actions },
          timeoutMs,
        )) as {
          success: boolean;
          totalActions: number;
          succeeded: number;
          failed: number;
          results: Array<{
            index: number;
            action: string;
            success: boolean;
            result?: any;
            error?: string;
          }>;
        };

        const summary = `Batch completed: ${result.succeeded}/${result.totalActions} succeeded${result.failed > 0 ? `, ${result.failed} failed` : ""}`;

        return {
          content: [
            {
              type: "text" as const,
              text: `${summary}\n\n${JSON.stringify(result.results, null, 2)}`,
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
