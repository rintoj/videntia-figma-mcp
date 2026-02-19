import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchIcons, getIcon, listIcons } from "../utils/icon-search.js";

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
    'Search for Lucide icons by keyword with fuzzy matching. Use | for multi-pattern search (e.g. "arrow|chevron"). Supports aliases like "notification" → bell, "hamburger" → menu.',
    {
      query: z.string().describe('Search query. Use | for multiple patterns (e.g. "arrow|chevron")'),
      limit: z.number().min(1).max(20).optional().describe("Max results to return (default 5, max 20)"),
    },
    async ({ query, limit }) => {
      try {
        const results = searchIcons(query, limit ?? 5);

        if (results.length === 0) {
          return { content: [{ type: "text" as const, text: `No icons found for "${query}".` }] };
        }
        const parts: string[] = [`Found ${results.length} icon(s) for "${query}"\n`];
        for (const { name, svg, matchType } of results) {
          parts.push(`### ${name} (${matchType})\n${svg}\n`);
        }
        return {
          content: [
            {
              type: "text" as const,
              text: parts.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error searching icons: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * get_icon — direct lookup by exact icon name.
   * Returns the SVG markup or an error with suggestions.
   */
  server.tool(
    "get_icon",
    "Get a Lucide icon SVG by exact name. Returns the SVG markup directly. If not found, suggests similar icons.",
    {
      name: z.string().describe('Exact icon name (e.g. "arrow-left", "bell", "check")'),
    },
    async ({ name }) => {
      try {
        const result = getIcon(name);

        if (result) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ name: result.name, svg: result.svg }, null, 2),
              },
            ],
          };
        }

        // Not found — provide suggestions
        const suggestions = searchIcons(name, 5);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: `Icon "${name}" not found`,
                  suggestions: suggestions.map(({ name, matchType }) => ({ name, matchType })),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting icon: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * list_icons — paginated listing of available Lucide icon names.
   * Supports optional prefix filtering.
   */
  server.tool(
    "list_icons",
    "List available Lucide icon names with optional prefix filter and pagination. Returns names only (use get_icon to fetch SVG).",
    {
      prefix: z.string().optional().describe('Filter icons by name prefix (e.g. "arrow", "circle")'),
      offset: z.number().min(0).optional().describe("Start index for pagination (default 0)"),
      limit: z.number().min(1).max(200).optional().describe("Max results per page (default 50, max 200)"),
    },
    async ({ prefix, offset, limit }) => {
      try {
        const result = listIcons({
          prefix,
          offset: offset ?? 0,
          limit: limit ?? 50,
        });

        const r = result as unknown as { total: number; offset: number; limit: number; names: string[] };
        const end = r.offset + r.names.length;
        const lines = [
          `Icons ${r.offset + 1}-${end} of ${r.total}${prefix ? ` (prefix: "${prefix}")` : ""}`,
          "",
          r.names.join(", "),
        ];
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
              text: `Error listing icons: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}
