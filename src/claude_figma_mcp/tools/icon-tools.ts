import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchIcons, getIcon } from "../utils/icon-search.js";

/**
 * Register icon lookup tools to the MCP server.
 * Pure server-side — no Figma communication required.
 */
export function registerIconTools(server: McpServer): void {

  /**
   * search_icon — fuzzy search for Lucide icons by keyword.
   * Supports multi-pattern queries with "|" separator.
   */
  server.tool(
    "search_icon",
    "Search for Lucide icons by keyword with fuzzy matching. Use | for multi-pattern search (e.g. \"arrow|chevron\"). Supports aliases like \"notification\" → bell, \"hamburger\" → menu.",
    {
      query: z.string().describe("Search query. Use | for multiple patterns (e.g. \"arrow|chevron\")"),
      limit: z.number().min(1).max(20).optional().describe("Max results to return (default 5, max 20)")
    },
    async ({ query, limit }) => {
      try {
        const results = searchIcons(query, limit ?? 5);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                query,
                count: results.length,
                icons: results.map(({ name, svg, matchType }) => ({ name, svg, matchType }))
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error searching icons: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * get_icon — direct lookup by exact icon name.
   * Returns the SVG markup or an error with suggestions.
   */
  server.tool(
    "get_icon",
    "Get a Lucide icon SVG by exact name. Returns the SVG markup directly. If not found, suggests similar icons.",
    {
      name: z.string().describe("Exact icon name (e.g. \"arrow-left\", \"bell\", \"check\")")
    },
    async ({ name }) => {
      try {
        const result = getIcon(name);

        if (result) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ name: result.name, svg: result.svg }, null, 2)
              }
            ]
          };
        }

        // Not found — provide suggestions
        const suggestions = searchIcons(name, 5);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Icon "${name}" not found`,
                suggestions: suggestions.map(({ name, matchType }) => ({ name, matchType }))
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting icon: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );
}
