import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { coerceArray } from "../utils/coerce-array.js";
import { outputFormatSchema, fetchNodesAsJsx } from "../utils/output-format.js";
import { CreateComponentInstanceResult, GetReactionsResult, GetComponentPropertiesResult } from "../types";

/**
 * Register component-related tools to the MCP server
 * This module contains tools for working with components in Figma
 * @param server - The MCP server instance
 */
export function registerComponentTools(server: McpServer): void {
  // Create Component Instance Tool
  server.tool(
    "create_component_instance",
    "Create an instance of a component in Figma. Returns JSX+Tailwind markup. For local components, use the node ID (e.g., '123:456') from get_local_components. For library components, use the component key.",
    {
      componentKey: z
        .string()
        .describe("Component node ID (for local, e.g., '123:456') or component key (for library components)"),
      x: z.number().describe("X position"),
      y: z.number().describe("Y position"),
      output_format: outputFormatSchema,
    },
    async ({ componentKey, x, y, output_format }) => {
      try {
        const result = await sendCommandToFigma<CreateComponentInstanceResult>("create_component_instance", {
          componentKey,
          x,
          y,
        });

        if (output_format === "jsx" && result?.id) {
          const jsx = await fetchNodesAsJsx([result.id]);
          return { content: [{ type: "text", text: jsx }] };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating component instance (componentKey="${componentKey}"): ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
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
    },
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
    },
  );

  // Create Component Set Tool
  server.tool(
    "create_component_set",
    "Combine multiple components into a component set (variants) in Figma",
    {
      nodeIds: coerceArray(z.array(z.string())).describe("Array of component node IDs to combine into a component set"),
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
    },
  );

  // Get Reactions Tool
  server.tool(
    "get_reactions",
    "Get Figma Prototyping Reactions from multiple nodes",
    {
      nodeIds: coerceArray(z.array(z.string())).describe("Array of node IDs to get reactions from"),
    },
    async ({ nodeIds }) => {
      try {
        const result = await sendCommandToFigma<GetReactionsResult>("get_reactions", { nodeIds });
        const nodes = Array.isArray(result) ? result : (result?.nodes ?? []);
        const total = nodes.reduce((sum, n) => sum + (n.reactions?.length || 0), 0);
        const lines: string[] = [`Found ${total} reaction(s) across ${nodes.length} node(s)`];
        for (const n of nodes) {
          if (!n.reactions?.length) continue;
          lines.push(
            `\n**${n.nodeName || n.nodeId}** (${n.reactions.length} reaction${n.reactions.length > 1 ? "s" : ""}):`,
          );
          for (const r of n.reactions) {
            const trigger = r.trigger?.type || "unknown";
            const action = r.action?.type || "unknown";
            const dest = r.action?.destinationId || "-";
            lines.push(`- ${trigger} → ${action} (dest: ${dest})`);
          }
        }
        lines.push("", "Use 'reaction_to_connector_strategy' prompt to prepare parameters");
        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting reactions for nodes [${nodeIds.join(", ")}]: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Default Connector Tool
  server.tool(
    "set_default_connector",
    "Set a copied connector node as the default connector",
    {
      connectorId: z.string().optional().describe("The ID of the connector node to set as default"),
    },
    async ({ connectorId }) => {
      try {
        const result = await sendCommandToFigma("set_default_connector", {
          connectorId,
        });
        return {
          content: [
            {
              type: "text",
              text: `Default connector set: ${JSON.stringify(result)}`,
            },
          ],
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
    },
  );

  // Create Connections Tool
  server.tool(
    "create_connections",
    "Create connections between nodes using the default connector style",
    {
      connections: coerceArray(
        z.array(
          z.object({
            startNodeId: z.string().describe("ID of the starting node"),
            endNodeId: z.string().describe("ID of the ending node"),
            text: z.string().optional().describe("Optional text to display on the connector"),
          }),
        ),
      ).describe("Array of node connections to create"),
    },
    async ({ connections }) => {
      try {
        if (!connections || connections.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No connections provided",
              },
            ],
          };
        }

        const result = await sendCommandToFigma("create_connections", {
          connections,
        });

        return {
          content: [
            {
              type: "text",
              text: `Created ${connections.length} connections: ${JSON.stringify(result)}`,
            },
          ],
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
    },
  );

  // Get Instance Overrides Tool
  server.tool(
    "get_instance_overrides",
    "Get all override properties from a selected component instance",
    {
      nodeId: z.string().optional().describe("Optional ID of component instance. Uses current selection if omitted"),
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("get_instance_overrides", {
          instanceNodeId: nodeId || null,
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
                : `Failed to get instance overrides: ${typedResult.message}`,
            },
          ],
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
    },
  );

  // Set Instance Overrides Tool
  server.tool(
    "set_instance_overrides",
    "Apply previously copied overrides to selected component instances",
    {
      sourceInstanceId: z.string().describe("ID of the source component instance"),
      targetNodeIds: coerceArray(z.array(z.string())).describe("Array of target instance IDs"),
    },
    async ({ sourceInstanceId, targetNodeIds }) => {
      try {
        const result = await sendCommandToFigma("set_instance_overrides", {
          sourceInstanceId,
          targetNodeIds: targetNodeIds || [],
        });
        const typedResult = result as {
          success: boolean;
          message: string;
          totalCount?: number;
          results?: Array<{ success: boolean }>;
        };

        if (typedResult.success) {
          const successCount = typedResult.results?.filter((r) => r.success).length || 0;
          return {
            content: [
              {
                type: "text",
                text: `Successfully applied ${typedResult.totalCount || 0} overrides to ${successCount} instances.`,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `Failed to set instance overrides: ${typedResult.message}`,
              },
            ],
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
    },
  );

  // Add Component Property Tool
  server.tool(
    "add_component_property",
    "Add a new component property (BOOLEAN, TEXT, INSTANCE_SWAP, or VARIANT) to a component. Boolean properties can control layer visibility.",
    {
      nodeId: z.string().describe("The ID of the component or component set"),
      propertyName: z.string().describe("Name for the property (e.g., 'Show Icon', 'Label Text')"),
      type: z.enum(["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT"]).describe("Type of property to create"),
      defaultValue: z
        .union([z.boolean(), z.string()])
        .optional()
        .describe(
          "Default value (boolean for BOOLEAN type, string for TEXT/VARIANT, required component key for INSTANCE_SWAP)",
        ),
    },
    async ({ nodeId, propertyName, type, defaultValue }) => {
      try {
        const result = await sendCommandToFigma("add_component_property", {
          nodeId,
          propertyName,
          type,
          defaultValue,
        });
        const typedResult = result as {
          nodeId: string;
          nodeName: string;
          propertyName: string;
          type: string;
          defaultValue: boolean | string;
        };
        return {
          content: [
            {
              type: "text",
              text: `Added ${typedResult.type} property "${typedResult.propertyName}" to "${typedResult.nodeName}" with default value: ${typedResult.defaultValue}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error adding component property: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Edit Component Property Tool
  server.tool(
    "edit_component_property",
    "Edit an existing component property's name, default value, or preferred values",
    {
      nodeId: z.string().describe("The ID of the component or component set"),
      propertyName: z.string().describe("The full property name including the #ID suffix (e.g., 'Show Icon#123:456')"),
      newName: z.string().optional().describe("New name for the property"),
      newDefaultValue: z.union([z.boolean(), z.string()]).optional().describe("New default value"),
      preferredValues: coerceArray(
        z.array(
          z.object({
            type: z.enum(["COMPONENT", "COMPONENT_SET"]),
            key: z.string(),
          }),
        ),
      )
        .optional()
        .describe("Preferred values for INSTANCE_SWAP properties"),
    },
    async ({ nodeId, propertyName, newName, newDefaultValue, preferredValues }) => {
      try {
        const result = await sendCommandToFigma("edit_component_property", {
          nodeId,
          propertyName,
          newName,
          newDefaultValue,
          preferredValues,
        });
        const typedResult = result as {
          nodeId: string;
          nodeName: string;
          oldPropertyName: string;
          newPropertyName: string;
          updates: object;
        };
        return {
          content: [
            {
              type: "text",
              text: `Updated property "${typedResult.oldPropertyName}" on "${typedResult.nodeName}". New name: "${typedResult.newPropertyName}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error editing component property: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Delete Component Property Tool
  server.tool(
    "delete_component_property",
    "Delete a component property from a component. Only supports BOOLEAN, TEXT, and INSTANCE_SWAP types.",
    {
      nodeId: z.string().describe("The ID of the component or component set"),
      propertyName: z.string().describe("The full property name including the #ID suffix (e.g., 'Show Icon#123:456')"),
    },
    async ({ nodeId, propertyName }) => {
      try {
        const result = await sendCommandToFigma("delete_component_property", {
          nodeId,
          propertyName,
        });
        const typedResult = result as {
          nodeId: string;
          nodeName: string;
          deletedPropertyName: string;
        };
        return {
          content: [
            {
              type: "text",
              text: `Deleted property "${typedResult.deletedPropertyName}" from "${typedResult.nodeName}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting component property: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Component Property References Tool
  server.tool(
    "set_component_property_references",
    "Link a component property to a child node. Use 'visible' to control visibility with a boolean property, 'characters' for text content, or 'mainComponent' for instance swap.",
    {
      nodeId: z.string().describe("The ID of the child node within the component"),
      references: z
        .record(z.string())
        .describe(
          "Object mapping property types to property names. E.g., { visible: 'ShowIcon#123:456' } for boolean visibility",
        ),
    },
    async ({ nodeId, references }) => {
      try {
        const result = await sendCommandToFigma("set_component_property_references", {
          nodeId,
          references,
        });
        const typedResult = result as {
          nodeId: string;
          nodeName: string;
          references: Record<string, string>;
        };
        return {
          content: [
            {
              type: "text",
              text: `Set property references on "${typedResult.nodeName}": ${JSON.stringify(typedResult.references)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting component property references: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Get Component Properties Tool
  server.tool(
    "get_component_properties",
    "Get all component property definitions from a component or component set",
    {
      nodeId: z.string().describe("The ID of the component or component set"),
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma<GetComponentPropertiesResult>("get_component_properties", {
          nodeId,
        });
        const typedResult = result as GetComponentPropertiesResult & {
          nodeId?: string;
          nodeName?: string;
          nodeType?: string;
        };
        const props = typedResult.properties || {};
        const propEntries = Object.entries(props);
        const lines: string[] = [
          `## ${typedResult.nodeName || "-"} (${typedResult.nodeType || "-"})`,
          `Properties: ${propEntries.length}`,
        ];
        if (propEntries.length > 0) {
          lines.push("", "| Property | Type | Default |", "|----------|------|---------|");
          for (const [name, prop] of propEntries) {
            const p = prop as any;
            lines.push(`| ${name} | ${p.type || "-"} | ${p.defaultValue ?? "-"} |`);
          }
        }
        return {
          content: [
            {
              type: "text",
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting component properties for node "${nodeId}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}
