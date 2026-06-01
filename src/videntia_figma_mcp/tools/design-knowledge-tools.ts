import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DESIGN_KNOWLEDGE_MODULES } from "../resources/design-knowledge/types.js";

export function registerDesignKnowledgeTool(server: McpServer): void {
  server.tool(
    "get_design_knowledge",
    "Retrieve design knowledge guides covering typography, color systems, motion, icons, craft details, anti-AI-slop rules, and the Research-First methodology. Use these guides to inform design decisions before building in Figma.",
    {
      module: z
        .enum(["anti-ai-slop", "typography", "color", "motion", "icons", "craft-details", "skill", "depth-elevation", "spacing-radius"])
        .describe(
          "The design knowledge module to retrieve. Options: anti-ai-slop (banned patterns, visual tells), typography (type scale, font pairing, letter-spacing, brand-validated display tracking), color (60/30/10, dark theme, tokens), motion (timing, easing, micro-interactions), icons (sizing, optical corrections, library rankings), craft-details (focus states, forms, touch targets), skill (Research-First 5-phase methodology), depth-elevation (multi-layer shadow recipes, shadow-as-border, brand-colored shadows, Figma effect style values), spacing-radius (8px grid, spacing scale, button padding, border radius archetypes by brand)"
        ),
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
            text: `# ${mod.name}\n\n${mod.content}`,
          },
        ],
      };
    }
  );
}
