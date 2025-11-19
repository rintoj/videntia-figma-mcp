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

  // Get Reactions Tool
  server.tool(
    "get_reactions",
    "Get Figma Prototyping Reactions from multiple nodes",
    {
      nodeIds: z.array(z.string())
        .describe("Array of node IDs to get reactions from")
    },
    async ({ nodeIds }) => {
      try {
        const result = await sendCommandToFigma("get_reactions", { nodeIds });
        return {
          content: [
            { type: "text", text: JSON.stringify(result) },
            {
              type: "text",
              text: "Use 'reaction_to_connector_strategy' prompt to prepare parameters"
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting reactions: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Set Default Connector Tool
  server.tool(
    "set_default_connector",
    "Set a copied connector node as the default connector",
    {
      connectorId: z.string().optional()
        .describe("The ID of the connector node to set as default")
    },
    async ({ connectorId }) => {
      try {
        const result = await sendCommandToFigma("set_default_connector", {
          connectorId
        });
        return {
          content: [
            {
              type: "text",
              text: `Default connector set: ${JSON.stringify(result)}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting default connector: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Create Connections Tool
  server.tool(
    "create_connections",
    "Create connections between nodes using the default connector style",
    {
      connections: z.array(z.object({
        startNodeId: z.string().describe("ID of the starting node"),
        endNodeId: z.string().describe("ID of the ending node"),
        text: z.string().optional()
          .describe("Optional text to display on the connector")
      })).describe("Array of node connections to create")
    },
    async ({ connections }) => {
      try {
        if (!connections || connections.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No connections provided"
              }
            ]
          };
        }

        const result = await sendCommandToFigma("create_connections", {
          connections
        });

        return {
          content: [
            {
              type: "text",
              text: `Created ${connections.length} connections: ${JSON.stringify(result)}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating connections: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Get Instance Overrides Tool
  server.tool(
    "get_instance_overrides",
    "Get all override properties from a selected component instance",
    {
      nodeId: z.string().optional()
        .describe("Optional ID of component instance. Uses current selection if omitted")
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("get_instance_overrides", {
          instanceNodeId: nodeId || null
        });
        const typedResult = result as {
          success: boolean;
          message: string;
        };

        return {
          content: [
            {
              type: "text",
              text: typedResult.success
                ? `Successfully got instance overrides: ${typedResult.message}`
                : `Failed to get instance overrides: ${typedResult.message}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting instance overrides: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Set Instance Overrides Tool
  server.tool(
    "set_instance_overrides",
    "Apply previously copied overrides to selected component instances",
    {
      sourceInstanceId: z.string()
        .describe("ID of the source component instance"),
      targetNodeIds: z.array(z.string())
        .describe("Array of target instance IDs")
    },
    async ({ sourceInstanceId, targetNodeIds }) => {
      try {
        const result = await sendCommandToFigma("set_instance_overrides", {
          sourceInstanceId,
          targetNodeIds: targetNodeIds || []
        });
        const typedResult = result as {
          success: boolean;
          message: string;
          totalCount?: number;
          results?: Array<{ success: boolean }>;
        };

        if (typedResult.success) {
          const successCount = typedResult.results
            ?.filter(r => r.success).length || 0;
          return {
            content: [
              {
                type: "text",
                text: `Successfully applied ${typedResult.totalCount || 0} overrides to ${successCount} instances.`
              }
            ]
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `Failed to set instance overrides: ${typedResult.message}`
              }
            ]
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting instance overrides: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}