import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DESIGN_KNOWLEDGE_MODULES, DESIGN_KNOWLEDGE_MODULE_IDS } from "../resources/design-knowledge/index.js";

const MODULE_OPTIONS = Array.from(DESIGN_KNOWLEDGE_MODULES.values(), (mod) => `${mod.id} (${mod.name})`).join(", ");

/**
 * Register the server-side `get_design_knowledge` tool (no Figma connection required).
 */
export function registerDesignKnowledgeTool(server: McpServer): void {
  server.tool(
    "get_design_knowledge",
    "Retrieve design knowledge guides for designing in Figma: typography, color, motion, icons, depth and elevation, spacing and radius, auto layout, components and variants, working within an existing design system, the build workflow and canvas QA, craft details, anti-AI-slop rules, and the Research-First methodology. Use these guides to inform design decisions before building in Figma.",
    {
      module: z
        .enum(DESIGN_KNOWLEDGE_MODULE_IDS)
        .describe(`The design knowledge module to retrieve. Options: ${MODULE_OPTIONS}`),
    },
    async ({ module }) => {
      const mod = DESIGN_KNOWLEDGE_MODULES.get(module);
      if (!mod) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown module: "${module}". Available modules: ${Array.from(DESIGN_KNOWLEDGE_MODULES.keys()).join(", ")}`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: mod.content,
          },
        ],
      };
    },
  );
}
