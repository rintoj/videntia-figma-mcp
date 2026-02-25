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
      x: z.coerce.number().describe("X position"),
      y: z.coerce.number().describe("Y position"),
      width: z.coerce.number().describe("Width of the rectangle"),
      height: z.coerce.number().describe("Height of the rectangle"),
      name: z.string().optional().describe("Optional name for the rectangle"),
      parentId: z.string().optional().describe("Optional parent node ID to append the rectangle to"),
      layoutPositioning: z
        .enum(["ABSOLUTE", "RELATIVE"])
        .optional()
        .describe("Position mode within auto-layout parent"),
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
      x: z.coerce.number().describe("X position"),
      y: z.coerce.number().describe("Y position"),
      width: z.coerce.number().describe("Width of the frame"),
      height: z.coerce.number().describe("Height of the frame"),
      name: z.string().optional().describe("Optional name for the frame"),
      parentId: z.string().optional().describe("Optional parent node ID to append the frame to"),
      fillColor: z
        .object({
          r: z.coerce.number().min(0).max(1).describe("Red component (0-1)"),
          g: z.coerce.number().min(0).max(1).describe("Green component (0-1)"),
          b: z.coerce.number().min(0).max(1).describe("Blue component (0-1)"),
          a: z.coerce.number().min(0).max(1).optional().describe("Alpha component (0-1)"),
        })
        .optional()
        .describe("Fill color in RGBA format"),
      strokeColor: z
        .object({
          r: z.coerce.number().min(0).max(1).describe("Red component (0-1)"),
          g: z.coerce.number().min(0).max(1).describe("Green component (0-1)"),
          b: z.coerce.number().min(0).max(1).describe("Blue component (0-1)"),
          a: z.coerce.number().min(0).max(1).optional().describe("Alpha component (0-1)"),
        })
        .optional()
        .describe("Stroke color in RGBA format"),
      strokeWeight: z.coerce.number().positive().optional().describe("Stroke weight"),
      clipsContent: z.coerce.boolean().optional().describe("Whether to clip content outside frame bounds"),
      layoutPositioning: z
        .enum(["ABSOLUTE", "RELATIVE"])
        .optional()
        .describe("Position mode within auto-layout parent"),
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
      x: z.coerce.number().describe("X position"),
      y: z.coerce.number().describe("Y position"),
      text: z.string().describe("Text content"),
      fontSize: z.coerce.number().optional().describe("Font size (default: 14)"),
      fontFamily: z.string().optional().describe("Font family name (default: Inter)"),
      fontWeight: z.coerce.number().optional().describe("Font weight (e.g., 400 for Regular, 700 for Bold)"),
      fontColor: z
        .object({
          r: z.coerce.number().min(0).max(1).describe("Red component (0-1)"),
          g: z.coerce.number().min(0).max(1).describe("Green component (0-1)"),
          b: z.coerce.number().min(0).max(1).describe("Blue component (0-1)"),
          a: z.coerce.number().min(0).max(1).optional().describe("Alpha component (0-1)"),
        })
        .optional()
        .describe("Font color in RGBA format"),
      name: z.string().optional().describe("Optional name for the text node by default following text"),
      parentId: z.string().optional().describe("Optional parent node ID to append the text to"),
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
      nodeIds: coerceArray(z.array(z.string())).describe("Array of IDs of the nodes to group"),
      name: z.string().optional().describe("Optional name for the group"),
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
        .describe("Optional index where to insert the child (if not specified, it will be added at the end)"),
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
      flatten: z.coerce.boolean().optional().describe("Flatten all paths into a single vector node (default: false)"),
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
