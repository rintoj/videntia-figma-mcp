import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { coerceArray } from "../utils/coerce-array.js";

/**
 * Register creation tools to the MCP server
 * This module contains tools for creating various shapes and elements in Figma
 * @param server - The MCP server instance
 */
export function registerCreationTools(server: McpServer): void {
  // Create Rectangle Tool
  server.tool(
    "create_rectangle",
    "Create a new rectangle in Figma",
    {
      x: z.coerce.number().describe("X position in pixels on the canvas (or relative to parent frame if parentId is set)"),
      y: z.coerce.number().describe("Y position in pixels on the canvas (or relative to parent frame if parentId is set)"),
      width: z.coerce.number().describe("Width in pixels (must be > 0)"),
      height: z.coerce.number().describe("Height in pixels (must be > 0)"),
      name: z.string().optional().describe("Layer name for the rectangle (default: 'Rectangle')"),
      parentId: z.string().optional().describe("ID of the parent frame or group to insert the rectangle into"),
      layoutPositioning: z
        .enum(["ABSOLUTE", "RELATIVE"])
        .optional()
        .describe("How this node positions inside an auto-layout parent: ABSOLUTE = uses x/y coordinates ignoring auto-layout flow, RELATIVE = participates in auto-layout flow (default when inside auto-layout)"),
    },
    async ({ x, y, width, height, name, parentId, layoutPositioning }) => {
      try {
        const result = await sendCommandToFigma("create_rectangle", {
          x,
          y,
          width,
          height,
          name: name || "Rectangle",
          parentId,
          layoutPositioning,
        });
        return {
          content: [
            {
              type: "text",
              text: `Created rectangle "${JSON.stringify(result)}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating rectangle: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Create Frame Tool
  server.tool(
    "create_frame",
    "Create a new frame in Figma",
    {
      x: z.coerce.number().describe("X position in pixels on the canvas (or relative to parent if parentId is set)"),
      y: z.coerce.number().describe("Y position in pixels on the canvas (or relative to parent if parentId is set)"),
      width: z.coerce.number().describe("Width in pixels (must be > 0)"),
      height: z.coerce.number().describe("Height in pixels (must be > 0)"),
      name: z.string().optional().describe("Layer name for the frame (default: 'Frame')"),
      parentId: z.string().optional().describe("ID of the parent frame to nest this frame inside"),
      fillColor: z
        .object({
          r: z.coerce.number().min(0).max(1).describe("Red channel 0–1"),
          g: z.coerce.number().min(0).max(1).describe("Green channel 0–1"),
          b: z.coerce.number().min(0).max(1).describe("Blue channel 0–1"),
          a: z.coerce.number().min(0).max(1).optional().describe("Alpha 0–1 (default: 1)"),
        })
        .optional()
        .describe("Background fill color (default: white {r:1,g:1,b:1,a:1})"),
      strokeColor: z
        .object({
          r: z.coerce.number().min(0).max(1).describe("Red channel 0–1"),
          g: z.coerce.number().min(0).max(1).describe("Green channel 0–1"),
          b: z.coerce.number().min(0).max(1).describe("Blue channel 0–1"),
          a: z.coerce.number().min(0).max(1).optional().describe("Alpha 0–1 (default: 1)"),
        })
        .optional()
        .describe("Border/stroke color — omit for no stroke"),
      strokeWeight: z.coerce.number().positive().optional().describe("Border thickness in pixels (must be > 0; requires strokeColor to be visible)"),
      clipsContent: z.coerce.boolean().optional().describe("true = hide content that overflows the frame boundary (CSS overflow:hidden); false = show overflow (default: false)"),
      layoutPositioning: z
        .enum(["ABSOLUTE", "RELATIVE"])
        .optional()
        .describe("How this frame positions inside an auto-layout parent: ABSOLUTE = positioned by x/y ignoring layout flow, RELATIVE = participates in layout flow (default when inside auto-layout)"),
    },
    async ({
      x,
      y,
      width,
      height,
      name,
      parentId,
      fillColor,
      strokeColor,
      strokeWeight,
      clipsContent,
      layoutPositioning,
    }) => {
      try {
        const result = await sendCommandToFigma("create_frame", {
          x,
          y,
          width,
          height,
          name: name || "Frame",
          parentId,
          fillColor: fillColor || { r: 1, g: 1, b: 1, a: 1 },
          strokeColor: strokeColor,
          strokeWeight: strokeWeight,
          clipsContent,
          layoutPositioning,
        });
        const typedResult = result as { name: string; id: string };
        return {
          content: [
            {
              type: "text",
              text: `Created frame "${typedResult.name}" with ID: ${typedResult.id}. Use the ID as the parentId to appendChild inside this frame.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating frame: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Create Text Tool
  server.tool(
    "create_text",
    "Create a new text element in Figma",
    {
      x: z.coerce.number().describe("X position in pixels on the canvas (or relative to parent if parentId is set)"),
      y: z.coerce.number().describe("Y position in pixels on the canvas (or relative to parent if parentId is set)"),
      text: z.string().describe("Text content to display"),
      fontSize: z.coerce.number().optional().describe("Font size in pixels (default: 14)"),
      fontFamily: z.string().optional().describe("Font family name as it appears in Figma, e.g. 'Inter', 'Roboto', 'SF Pro' (default: 'Inter')"),
      fontWeight: z.coerce.number().optional().describe("Font weight as a number: 100=Thin, 200=ExtraLight, 300=Light, 400=Regular, 500=Medium, 600=SemiBold, 700=Bold, 800=ExtraBold, 900=Black (default: 400)"),
      fontColor: z
        .object({
          r: z.coerce.number().min(0).max(1).describe("Red channel 0–1"),
          g: z.coerce.number().min(0).max(1).describe("Green channel 0–1"),
          b: z.coerce.number().min(0).max(1).describe("Blue channel 0–1"),
          a: z.coerce.number().min(0).max(1).optional().describe("Alpha 0–1 (default: 1)"),
        })
        .optional()
        .describe("Text color in normalized RGBA (default: black {r:0,g:0,b:0,a:1})"),
      name: z.string().optional().describe("Layer name for the text node (default: the text content itself)"),
      parentId: z.string().optional().describe("ID of the parent frame to insert the text into"),
    },
    async ({ x, y, text, fontSize, fontFamily, fontWeight, fontColor, name, parentId }) => {
      try {
        const result = await sendCommandToFigma("create_text", {
          x,
          y,
          text,
          fontSize: fontSize || 14,
          fontFamily: fontFamily || "Inter",
          fontWeight: fontWeight || 400,
          fontColor: fontColor || { r: 0, g: 0, b: 0, a: 1 },
          name: name || "Text",
          parentId,
        });
        const typedResult = result as { name: string; id: string };
        return {
          content: [
            {
              type: "text",
              text: `Created text "${typedResult.name}" with ID: ${typedResult.id}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating text: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Group Nodes Tool
  server.tool(
    "group_nodes",
    "Group nodes in Figma",
    {
      nodeIds: coerceArray(z.array(z.string())).describe("Array of node IDs to group together (minimum 2; all must be siblings in the same parent)"),
      name: z.string().optional().describe("Layer name for the resulting group (default: 'Group')"),
    },
    async ({ nodeIds, name }) => {
      try {
        const result = await sendCommandToFigma("group_nodes", {
          nodeIds,
          name,
        });

        const typedResult = result as {
          id: string;
          name: string;
          type: string;
          children: Array<{ id: string; name: string; type: string }>;
        };

        return {
          content: [
            {
              type: "text",
              text: `Nodes successfully grouped into "${typedResult.name}" with ID: ${typedResult.id}. The group contains ${typedResult.children.length} elements.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error grouping nodes: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Ungroup Nodes Tool
  server.tool(
    "ungroup_nodes",
    "Ungroup nodes in Figma",
    {
      nodeId: z.string().describe("ID of the node (group or frame) to ungroup"),
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("ungroup_nodes", { nodeId });

        const typedResult = result as {
          success: boolean;
          ungroupedCount: number;
          items: Array<{ id: string; name: string; type: string }>;
        };

        return {
          content: [
            {
              type: "text",
              text: `Node successfully ungrouped. ${typedResult.ungroupedCount} elements were released.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error ungrouping node: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Clone Node Tool
  server.tool(
    "clone_node",
    "Clone an existing node in Figma",
    {
      nodeId: z.string().describe("The ID of the node to clone"),
      x: z.coerce.number().optional().describe("New X position for the clone"),
      y: z.coerce.number().optional().describe("New Y position for the clone"),
    },
    async ({ nodeId, x, y }) => {
      try {
        const result = await sendCommandToFigma("clone_node", { nodeId, x, y });
        const typedResult = result as { name: string; id: string };
        return {
          content: [
            {
              type: "text",
              text: `Cloned node "${typedResult.name}" with new ID: ${typedResult.id}${x !== undefined && y !== undefined ? ` at position (${x}, ${y})` : ""}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error cloning node: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Insert Child Tool
  server.tool(
    "insert_child",
    "Insert a child node inside a parent node in Figma",
    {
      parentId: z.string().describe("ID of the parent node where the child will be inserted"),
      childId: z.string().describe("ID of the child node to insert"),
      index: z
        .number()
        .optional()
        .describe("Zero-based position to insert the child at within the parent's children array (0 = front/first; omit to append at the end)"),
    },
    async ({ parentId, childId, index }) => {
      try {
        const result = await sendCommandToFigma("insert_child", {
          parentId,
          childId,
          index,
        });

        const typedResult = result as {
          parentId: string;
          childId: string;
          index: number;
          success: boolean;
        };

        return {
          content: [
            {
              type: "text",
              text: `Child node with ID: ${typedResult.childId} successfully inserted into parent node with ID: ${typedResult.parentId}${index !== undefined ? ` at position ${typedResult.index}` : ""}.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error inserting child node: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Create SVG Tool
  server.tool(
    "create_svg",
    "Create a node from an SVG string in Figma. Useful for inserting SVG icons. The SVG is parsed and converted to Figma vector nodes.",
    {
      svgString: z.string().describe("The SVG markup string (must start with <svg or <?xml)"),
      x: z.coerce.number().optional().describe("X position (default: 0)"),
      y: z.coerce.number().optional().describe("Y position (default: 0)"),
      name: z.string().optional().describe("Name for the created node"),
      parentId: z.string().optional().describe("Parent node ID to insert the SVG into"),
      flatten: z.coerce.boolean().optional().describe("true = merge all SVG paths into a single vector node (loses individual path structure but simplifies the layer); false = preserve path hierarchy as separate nodes (default: false)"),
    },
    async ({ svgString, x, y, name, parentId, flatten }) => {
      try {
        const result = await sendCommandToFigma("create_svg", {
          svgString,
          x: x ?? 0,
          y: y ?? 0,
          name,
          parentId,
          flatten: flatten ?? false,
        });
        const typedResult = result as {
          id: string;
          name: string;
          type: string;
          x: number;
          y: number;
          width: number;
          height: number;
          childCount: number;
          parentId?: string;
        };
        return {
          content: [
            {
              type: "text",
              text: `Created SVG node "${typedResult.name}" (ID: ${typedResult.id}, ${typedResult.width}x${typedResult.height}px, ${typedResult.childCount} children)${typedResult.parentId ? ` inside parent ${typedResult.parentId}` : ""}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating SVG: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Flatten Node Tool
  server.tool(
    "flatten_node",
    "Flatten a node in Figma (e.g., for boolean operations or converting to path)",
    {
      nodeId: z.string().describe("ID of the node to flatten"),
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("flatten_node", { nodeId });

        const typedResult = result as {
          id: string;
          name: string;
          type: string;
        };

        return {
          content: [
            {
              type: "text",
              text: `Node "${typedResult.name}" flattened successfully. The new node has ID: ${typedResult.id} and is of type ${typedResult.type}.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error flattening node: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}
