import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket.js";
import { mcpBooleanSchema } from "../utils/mcp-boolean.js";
import { cursorSchema, paginate, pageNotice } from "../utils/output-format.js";

/**
 * Outline projection of one content-tree node.
 *
 * Measured rationale: 186/186 `get_content_tree` calls in one production
 * session passed no projection at all (2,258 tokens mean). A never-used option
 * is a default problem, so the projection is now the default and the full tree
 * is opt-in via view:"full".
 */
function projectContentNode(node: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {
    id: node.id,
    name: node.name,
    type: node.type,
  };
  if (node.role !== undefined) out.role = node.role;
  if (node.text !== undefined && node.text !== "") out.text = node.text;
  if (node.boundVariables !== undefined) out.boundVariables = node.boundVariables;
  if (node.bindings !== undefined) out.bindings = node.bindings;
  if (Array.isArray(node.children)) {
    out.children = node.children.map(projectContentNode);
  } else if (
    "children" in node === false &&
    (node.type === "FRAME" || node.type === "GROUP" || node.type === "INSTANCE" || node.type === "COMPONENT")
  ) {
    // Container reached the depth cut-off: say so rather than implying it is a leaf.
    out.truncatedChildren = true;
  }
  return out;
}

export function registerDocumentationTools(server: McpServer): void {
  server.tool(
    "enumerate_all_frames",
    "List all frames across all pages (or a specific page) with metadata: name, size, position, prototype links, annotations, and child count. Use this as the starting point for documentation workflows.",
    {
      pageId: z.string().optional().describe("Scope to a specific page ID. Omit to scan all pages."),
      topLevelOnly: z
        .boolean()
        .optional()
        .default(true)
        .describe("Only return top-level frames (direct children of pages). Set false to include nested frames."),
      includeComponents: z
        .boolean()
        .optional()
        .default(false)
        .describe("Also include COMPONENT and COMPONENT_SET nodes."),
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
          content: [
            {
              type: "text",
              text: `Error enumerating frames: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
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
          content: [
            {
              type: "text",
              text: `Error mapping prototype flows: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "get_frame_animations",
    "Read all prototype animations (transitions) within a frame and its descendants. Unlike get_reactions/map_prototype_flows, this surfaces the full animation detail that those tools drop: transition type (SMART_ANIMATE, MOVE_IN, PUSH, DISSOLVE, SLIDE_IN, SCROLL_ANIMATE…), direction, matchLayers, duration (seconds), and easing (including custom cubic-bezier control points). Each entry also includes the trigger (with AFTER_TIMEOUT timeout), destination, and preserveScrollPosition. Use this to document or audit motion/interaction design.",
    {
      nodeId: z.string().describe("Frame/node ID to scan. Animations on this node and all descendants are returned."),
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma<Record<string, unknown>>("get_frame_animations", { nodeId });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting frame animations: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "bulk_export_frames",
    "Export multiple frames as images in a single call. Returns base64-encoded image data for each frame. If no nodeIds are provided, exports all top-level frames on the current page (or specified page).",
    {
      nodeIds: z
        .array(z.string())
        .optional()
        .describe("List of frame/node IDs to export. Omit to export all top-level frames on the page."),
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
          content: [
            {
              type: "text",
              text: `Error bulk exporting frames: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "get_content_tree",
    'Extract the content tree from a frame, page, or node — text content with inferred semantic roles (heading, subheading, body, cta, label, hint), component types, and layout containers, plus a flat text inventory for copy auditing. Returns a SHALLOW, PROJECTED tree by default (maxDepth 2, outline view) — pass view:"full" and a larger maxDepth for everything.',
    {
      nodeId: z
        .string()
        .optional()
        .describe("Root node ID to extract content from. Omit to extract from all top-level frames on the page."),
      pageId: z.string().optional().describe("Page to extract from when nodeId is omitted."),
      maxDepth: z.coerce
        .number()
        .min(1)
        .max(20)
        .optional()
        .default(2)
        .describe(
          "Maximum depth to traverse the node tree. Default: 2 (was 5) — deeper levels are collapsed to a child count, not silently dropped. Raise it when you actually need the deep structure.",
        ),
      view: z
        .enum(["outline", "full"])
        .optional()
        .default("outline")
        .describe(
          'Projection. "outline" (default) keeps id/name/type/role/text/bound variables and drops geometry, font metrics and image markers. "full" returns every field the plugin produced.',
        ),
      includeImages: mcpBooleanSchema
        .optional()
        .default(false)
        .describe("Include image fill indicators in the output."),
      text_limit: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Max text-inventory entries per page. Default: 100. Remaining entries are PAGED via next_cursor."),
      cursor: cursorSchema,
    },
    async ({ nodeId, pageId, maxDepth, includeImages, view, text_limit, cursor }) => {
      try {
        const result = await sendCommandToFigma<Record<string, unknown>>("get_content_tree", {
          nodeId,
          pageId,
          maxDepth,
          includeImages,
        });

        const tree = (result?.tree as any[]) ?? [];
        const projected = view === "full" ? tree : tree.map(projectContentNode);
        const inventory = (result?.textInventory as any[]) ?? [];
        const page = paginate(inventory, cursor, text_limit ?? 100);

        const notices: string[] = [
          `get_content_tree: view=${view}, maxDepth=${maxDepth}.`,
          view === "full"
            ? "Tree is the FULL plugin projection."
            : 'Tree is the OUTLINE projection: id, name, type, role, text and bound variables only. Node geometry (width/height), font size/weight and image-fill markers are OMITTED — pass view:"full" for them.',
          `Nodes deeper than maxDepth=${maxDepth} are NOT included; a node cut off there carries "truncatedChildren": true. Raise maxDepth (max 20) to see them.`,
          pageNotice("textInventory", page),
        ];

        const payload: Record<string, unknown> = {
          _notice: notices,
          nodeCount: result?.nodeCount,
          view,
          maxDepth,
          tree: projected,
          textInventory: page.items,
          textInventoryTotal: page.total,
        };
        if (page.nextCursor !== undefined) payload.next_cursor = page.nextCursor;

        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting content tree: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "get_frame_documentation",
    "Get a complete documentation packet for one or more frames: metadata, all annotations (recursively from every child node), all comments anchored to or positioned within the frame, and prototype navigation links. Use this to generate per-screen documentation without multiple round-trips.",
    {
      nodeId: z.string().optional().describe("Single frame/node ID to document. Ignored if nodeIds is provided."),
      nodeIds: z
        .array(z.string())
        .optional()
        .describe("Multiple frame/node IDs to document in one call. Takes precedence over nodeId."),
      includeResolved: z.boolean().optional().default(false).describe("Include resolved comments (default: false)."),
    },
    async ({ nodeId, nodeIds, includeResolved }) => {
      try {
        const ids = nodeIds ?? (nodeId ? [nodeId] : []);
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
          content: [
            {
              type: "text",
              text: `Error getting frame documentation: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}
