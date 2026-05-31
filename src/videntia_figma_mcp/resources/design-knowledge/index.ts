import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DESIGN_KNOWLEDGE_MODULES } from "./types.js";
import { ANTI_AI_SLOP } from "./anti-ai-slop.js";
import { TYPOGRAPHY } from "./typography.js";
import { COLOR } from "./color.js";
import { MOTION } from "./motion.js";
import { ICONS } from "./icons.js";
import { CRAFT_DETAILS } from "./craft-details.js";
import { SKILL } from "./skill.js";
import { DEPTH_ELEVATION } from "./depth-elevation.js";
import { SPACING_RADIUS } from "./spacing-radius.js";

// Populate the module map
const ALL_MODULES = [ANTI_AI_SLOP, TYPOGRAPHY, COLOR, MOTION, ICONS, CRAFT_DETAILS, SKILL, DEPTH_ELEVATION, SPACING_RADIUS];
for (const mod of ALL_MODULES) {
  DESIGN_KNOWLEDGE_MODULES.set(mod.id, mod);
}

export function registerDesignKnowledge(server: McpServer): void {
  // Dynamic ResourceTemplate for lookup by module ID
  const template = new ResourceTemplate("figma://design-knowledge/{module}", {
    list: () => ({
      resources: ALL_MODULES.map((mod) => ({
        uri: `figma://design-knowledge/${mod.id}`,
        name: mod.name,
        description: mod.description,
        mimeType: "text/markdown",
      })),
    }),
    complete: {
      module: () => ALL_MODULES.map((mod) => mod.id),
    },
  });

  server.resource(
    "design_knowledge_template",
    template,
    { mimeType: "text/markdown" },
    async (uri, { module }) => {
      const mod = DESIGN_KNOWLEDGE_MODULES.get(module as string);
      if (!mod) {
        const available = ALL_MODULES.map((m) => m.id).join(", ");
        throw new Error(`Unknown design knowledge module: "${module}". Available: ${available}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: mod.content,
          },
        ],
      };
    }
  );

  // Static resources for discoverability (clients that don't support templates)
  for (const mod of ALL_MODULES) {
    try {
      server.resource(
        `design_knowledge_${mod.id.replace(/-/g, "_")}`,
        `figma://design-knowledge/${mod.id}`,
        {
          description: mod.description,
          mimeType: "text/markdown",
        },
        async (uri) => ({
          contents: [
            {
              uri: uri.href,
              mimeType: "text/markdown",
              text: mod.content,
            },
          ],
        })
      );
    } catch {
      // SDK may reject static URIs that overlap with a template — safe to skip
    }
  }
}
