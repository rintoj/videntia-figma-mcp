/**
 * Code-ready, read-only design context (ideas borrowed from Figma's Dev Mode
 * MCP, implemented on our own plugin):
 *   get_design_context, get_variables_used.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket.js";
import { mcpBooleanSchema } from "../utils/mcp-boolean.js";
import { normalizeNodeId } from "../utils/figma-helpers.js";
import {
  formatDesignContext,
  formatVariablesUsed,
  type DesignContextPayload,
  type VariablesUsedPayload,
} from "../utils/design-context-format.js";

const text = (body: string) => ({ content: [{ type: "text" as const, text: body }] });
const errorText = (prefix: string, error: unknown) =>
  text(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);

export function registerDesignContextTools(server: McpServer): void {
  server.tool(
    "get_design_context",
    "Code-ready context for a node in ONE call: auto layout as flexbox, sizes, typography, fills/strokes, radius, effects, every bound variable resolved to token name AND value, and component/instance info (main component, variant props). Supplemented by Figma's getCSSAsync where it adds something. Read-only; capped and yields on large frames.",
    {
      nodeId: z.string().describe("Node to describe (URL 12-34 form accepted)"),
      depth: z.number().int().min(0).max(10).optional().describe("Child depth to expand (default 2)"),
      format: z.enum(["css", "tailwind", "jsx"]).optional().describe("Output dialect (default jsx)"),
      maxNodes: z.number().int().min(1).max(2000).optional().describe("Node cap (default 300)"),
      includeCss: mcpBooleanSchema
        .optional()
        .describe("Call getCSSAsync per node (first 40, 1.5s timeout each). Default true"),
    },
    async ({ nodeId, depth, format, maxNodes, includeCss }) => {
      try {
        const raw = await sendCommandToFigma<DesignContextPayload>(
          "get_design_context",
          { nodeId: normalizeNodeId(nodeId), depth: depth ?? 2, maxNodes, includeCss: includeCss !== false },
          60000,
        );
        return text(formatDesignContext(raw, format ?? "jsx"));
      } catch (error) {
        return errorText("Error getting design context", error);
      }
    },
  );

  server.tool(
    "get_variables_used",
    "List every variable referenced by a node and its subtree (field bindings, paints, effects, text ranges), deduped, with collection, name, resolved value per mode, usage count and example node ids. Paint/text/effect styles used are listed in a separate section. Read-only; capped (default 5000 nodes) with a truncated flag.",
    {
      nodeId: z.string().describe("Root node (URL 12-34 form accepted)"),
      includeChildren: mcpBooleanSchema.optional().describe("Walk the subtree (default true)"),
      maxNodes: z.number().int().min(1).max(50000).optional().describe("Node cap (default 5000)"),
    },
    async ({ nodeId, includeChildren, maxNodes }) => {
      try {
        const raw = await sendCommandToFigma<VariablesUsedPayload>(
          "get_variables_used",
          { nodeId: normalizeNodeId(nodeId), includeChildren: includeChildren !== false, maxNodes },
          120000,
        );
        return text(formatVariablesUsed(raw));
      } catch (error) {
        return errorText("Error listing variables used", error);
      }
    },
  );
}
