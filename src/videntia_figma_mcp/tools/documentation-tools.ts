import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket.js";
import { coerceArray } from "../utils/coerce-array.js";

export function registerDocumentationTools(server: McpServer): void {

  server.tool(
    "enumerate_all_frames",
    "List all frames across all pages (or a specific page) with metadata: name, size, position, prototype links, annotations, and child count. Use this as the starting point for documentation workflows.",
    {
      pageId: z.string().optional().describe("Scope to a specific page ID. Omit to scan all pages."),
      topLevelOnly: z.boolean().optional().default(true).describe("Only return top-level frames (direct children of pages). Set false to include nested frames."),
      includeComponents: z.boolean().optional().default(false).describe("Also include COMPONENT and COMPONENT_SET nodes."),
    },
    async ({ pageId, topLevelOnly, includeComponents }) => {
      try {
        const result = await sendCommandToFigma<Record<string, unknown>>("enumerate_all_frames", {
          pageId,
          topLevelOnly,
          includeComponents,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error enumerating frames: ${error instanceof Error ? error.message : String(error)}` }],
        };
      }
    },
  );

  server.tool(
    "map_prototype_flows",
    "Build a complete flow graph from prototype reactions across the document. Returns all nodes with navigation links, edges (from→to with trigger/action), and computed entry points (screens with no incoming links). Use this to document user journeys and navigation flows.",
    {
      pageId: z.string().optional().describe("Scope to a specific page ID. Omit to map flows across all pages."),
    },
    async ({ pageId }) => {
      try {
        const result = await sendCommandToFigma<Record<string, unknown>>("map_prototype_flows", { pageId });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error mapping prototype flows: ${error instanceof Error ? error.message : String(error)}` }],
        };
      }
    },
  );

  server.tool(
    "bulk_export_frames",
    "Export multiple frames as images in a single call. Returns base64-encoded image data for each frame. If no nodeIds are provided, exports all top-level frames on the current page (or specified page).",
    {
      nodeIds: z.array(z.string()).optional().describe("List of frame/node IDs to export. Omit to export all top-level frames on the page."),
      format: z.enum(["PNG", "JPG", "SVG", "PDF"]).optional().default("PNG").describe("Export format."),
      scale: z.number().min(0.1).max(4).optional().default(1).describe("Export scale factor (1 = 1x, 2 = 2x, etc.)."),
      pageId: z.string().optional().describe("Page to export from when nodeIds is omitted."),
    },
    async ({ nodeIds, format, scale, pageId }) => {
      try {
        const result = await sendCommandToFigma<Record<string, unknown>>("bulk_export_frames", {
          nodeIds,
          format,
          scale,
          pageId,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error bulk exporting frames: ${error instanceof Error ? error.message : String(error)}` }],
        };
      }
    },
  );

  server.tool(
    "get_content_tree",
    "Extract the complete content tree from a frame, page, or node — including all text content with inferred semantic roles (heading, subheading, body, cta, label, hint), component types, and layout containers. Also returns a flat text inventory for easy copy auditing.",
    {
      nodeId: z.string().optional().describe("Root node ID to extract content from. Omit to extract from all top-level frames on the page."),
      pageId: z.string().optional().describe("Page to extract from when nodeId is omitted."),
      maxDepth: z.number().min(1).max(20).optional().default(5).describe("Maximum depth to traverse the node tree."),
      includeImages: z.boolean().optional().default(false).describe("Include image fill indicators in the output."),
    },
    async ({ nodeId, pageId, maxDepth, includeImages }) => {
      try {
        const result = await sendCommandToFigma<Record<string, unknown>>("get_content_tree", {
          nodeId,
          pageId,
          maxDepth,
          includeImages,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error getting content tree: ${error instanceof Error ? error.message : String(error)}` }],
        };
      }
    },
  );

  server.tool(
    "get_frame_documentation",
    "Get a complete documentation packet for one or more frames: metadata, all annotations (recursively from every child node), all comments anchored to or positioned within the frame, and prototype navigation links. Use this to generate per-screen documentation without multiple round-trips.",
    {
      nodeId: z.string().optional().describe("Single frame/node ID to document."),
      nodeIds: z.array(z.string()).optional().describe("Multiple frame/node IDs to document in one call."),
      includeResolved: z.boolean().optional().default(false).describe("Include resolved comments (default: false)."),
    },
    async ({ nodeId, nodeIds, includeResolved }) => {
      try {
        const ids = coerceArray(nodeIds ?? (nodeId ? [nodeId] : []));
        if (ids.length === 0) {
          return { content: [{ type: "text", text: "Provide nodeId or nodeIds" }] };
        }
        const result = await sendCommandToFigma<Record<string, unknown>>("get_frame_documentation", {
          nodeIds: ids,
          includeResolved,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error getting frame documentation: ${error instanceof Error ? error.message : String(error)}` }],
        };
      }
    },
  );
}
