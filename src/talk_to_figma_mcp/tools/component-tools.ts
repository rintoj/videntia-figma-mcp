import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";

/**
 * Register component-related tools to the MCP server
 * This module contains tools for working with components in Figma
 * @param server - The MCP server instance
 */
export function registerComponentTools(server: McpServer): void {
  // Create Component Instance Tool
  server.tool(
    "create_component_instance",
    "Create an instance of a component in Figma",
    {
      componentKey: z.string().describe("Key of the component to instantiate"),
      x: z.number().describe("X position"),
      y: z.number().describe("Y position"),
    },
    async ({ componentKey, x, y }) => {
      try {
        const result = await sendCommandToFigma("create_component_instance", {
          componentKey,
          x,
          y,
        });
        const typedResult = result as any;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(typedResult),
            }
          ]
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating component instance: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Detach Instance Tool
  server.tool(
    "detach_instance",
    "Detach a component instance from its main component in Figma, converting it to a regular frame",
    {
      nodeId: z.string().describe("The ID of the instance node to detach"),
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("detach_instance", { nodeId });
        const typedResult = result as { id: string; name: string; type: string };
        return {
          content: [
            {
              type: "text",
              text: `Detached instance "${typedResult.name}" (ID: ${typedResult.id}). Node is now a ${typedResult.type}.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error detaching instance: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Create Component Tool
  server.tool(
    "create_component",
    "Convert a frame or group into a component in Figma",
    {
      nodeId: z.string().describe("The ID of the frame or group to convert to a component"),
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("create_component", { nodeId });
        const typedResult = result as { id: string; name: string; key: string };
        return {
          content: [
            {
              type: "text",
              text: `Created component "${typedResult.name}" (ID: ${typedResult.id}, Key: ${typedResult.key})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating component: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Create Component Set Tool
  server.tool(
    "create_component_set",
    "Combine multiple components into a component set (variants) in Figma",
    {
      nodeIds: z.array(z.string()).describe("Array of component node IDs to combine into a component set"),
      name: z.string().optional().describe("Optional name for the component set"),
    },
    async ({ nodeIds, name }) => {
      try {
        const result = await sendCommandToFigma("create_component_set", { nodeIds, name });
        const typedResult = result as { id: string; name: string; variantCount: number };
        return {
          content: [
            {
              type: "text",
              text: `Created component set "${typedResult.name}" (ID: ${typedResult.id}) with ${typedResult.variantCount} variants`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating component set: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}