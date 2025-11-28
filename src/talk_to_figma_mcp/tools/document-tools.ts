import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma, joinChannel } from "../utils/websocket.js";
import { filterFigmaNode } from "../utils/figma-helpers.js";

/**
 * Register document-related tools to the MCP server
 * @param server - The MCP server instance
 */
export function registerDocumentTools(server: McpServer): void {
  // Document Info Tool
  server.tool(
    "get_document_info",
    "Get detailed information about the current Figma document",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_document_info");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting document info: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Read My Design Tool
  server.tool(
    "read_my_design",
    "Get detailed information about the current selection in Figma, including all node details",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("read_my_design", {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error reading design: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Set Focus Tool
  server.tool(
    "set_focus",
    "Set focus on a specific node in Figma by selecting it and scrolling viewport to it",
    {
      nodeId: z.string().describe("The ID of the node to focus on")
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("set_focus", { nodeId });
        const typedResult = result as { name: string; id: string };
        return {
          content: [
            {
              type: "text",
              text: `Focused on node "${typedResult.name}" (ID: ${typedResult.id})`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting focus: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Set Selections Tool
  server.tool(
    "set_selections",
    "Set selection to multiple nodes in Figma and scroll viewport to show them",
    {
      nodeIds: z.array(z.string()).describe("Array of node IDs to select")
    },
    async ({ nodeIds }) => {
      try {
        const result = await sendCommandToFigma("set_selections", { nodeIds });
        const typedResult = result as {
          selectedNodes: Array<{ name: string; id: string }>;
          count: number
        };
        return {
          content: [
            {
              type: "text",
              text: `Selected ${typedResult.count} nodes: ${typedResult.selectedNodes
                .map(n => `"${n.name}" (${n.id})`)
                .join(', ')}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting selections: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Get Annotations Tool
  server.tool(
    "get_annotations",
    "Get all annotations in the current document or specific node",
    {
      nodeId: z.string().describe("Node ID to get annotations for specific node"),
      includeCategories: z.boolean()
        .optional()
        .default(true)
        .describe("Whether to include category information")
    },
    async ({ nodeId, includeCategories }) => {
      try {
        const result = await sendCommandToFigma("get_annotations", {
          nodeId,
          includeCategories
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting annotations: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Set Annotation Tool
  server.tool(
    "set_annotation",
    "Create or update an annotation",
    {
      nodeId: z.string().describe("The ID of the node to annotate"),
      annotationId: z.string().optional()
        .describe("The ID of the annotation to update"),
      labelMarkdown: z.string().describe("The annotation text in markdown format"),
      categoryId: z.string().optional()
        .describe("The ID of the annotation category"),
      properties: z.array(z.object({ type: z.string() }))
        .optional()
        .describe("Additional properties for the annotation")
    },
    async ({ nodeId, annotationId, labelMarkdown, categoryId, properties }) => {
      try {
        const result = await sendCommandToFigma("set_annotation", {
          nodeId,
          annotationId,
          labelMarkdown,
          categoryId,
          properties
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting annotation: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Set Multiple Annotations Tool
  server.tool(
    "set_multiple_annotations",
    "Set multiple annotations parallelly in a node",
    {
      nodeId: z.string()
        .describe("The ID of the node containing elements to annotate"),
      annotations: z.array(
        z.object({
          nodeId: z.string().describe("The ID of the node to annotate"),
          labelMarkdown: z.string()
            .describe("The annotation text in markdown format"),
          categoryId: z.string().optional()
            .describe("The ID of the annotation category"),
          annotationId: z.string().optional()
            .describe("The ID of the annotation to update"),
          properties: z.array(z.object({ type: z.string() }))
            .optional()
            .describe("Additional properties for the annotation")
        })
      ).describe("Array of annotations to apply")
    },
    async ({ nodeId, annotations }) => {
      try {
        if (!annotations || annotations.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No annotations provided"
              }
            ]
          };
        }

        const result = await sendCommandToFigma("set_multiple_annotations", {
          nodeId,
          annotations
        });

        interface AnnotationResult {
          success: boolean;
          annotationsApplied?: number;
          annotationsFailed?: number;
          completedInChunks?: number;
          results?: Array<{ success: boolean; nodeId: string; error?: string }>;
        }

        const typedResult = result as AnnotationResult;
        const progressText = `Annotation process completed: ${typedResult.annotationsApplied || 0} successfully applied, ${typedResult.annotationsFailed || 0} failed, processed in ${typedResult.completedInChunks || 1} batches`;

        const failedResults = (typedResult.results || [])
          .filter(item => !item.success);

        let detailedResponse = "";
        if (failedResults.length > 0) {
          detailedResponse = `\n\nFailed nodes:\n${failedResults
            .map(item => `- ${item.nodeId}: ${item.error || "Unknown error"}`)
            .join('\n')}`;
        }

        return {
          content: [
            { type: "text" as const, text: progressText + detailedResponse }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting multiple annotations: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Scan Nodes By Types Tool
  server.tool(
    "scan_nodes_by_types",
    "Scan for child nodes with specific types in the selected Figma node",
    {
      nodeId: z.string().describe("ID of the node to scan"),
      types: z.array(z.string())
        .describe("Array of node types (e.g. ['COMPONENT', 'FRAME'])")
    },
    async ({ nodeId, types }) => {
      try {
        const result = await sendCommandToFigma("scan_nodes_by_types", {
          nodeId,
          types
        });

        if (result && typeof result === 'object' && 'matchingNodes' in result) {
          const typedResult = result as {
            success: boolean;
            count: number;
            matchingNodes: Array<any>;
            searchedTypes: Array<string>;
          };

          const summaryText = `Found ${typedResult.count} nodes matching types: ${typedResult.searchedTypes.join(', ')}`;

          return {
            content: [
              { type: "text" as const, text: summaryText },
              { type: "text" as const, text: JSON.stringify(typedResult.matchingNodes, null, 2) }
            ]
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error scanning nodes by types: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Selection Tool
  server.tool(
    "get_selection",
    "Get information about the current selection in Figma",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_selection");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting selection: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Node Info Tool
  server.tool(
    "get_node_info",
    "Get detailed information about a specific node in Figma",
    {
      nodeId: z.string().describe("The ID of the node to get information about"),
      fields: z.array(z.enum([
        "id", "name", "type", "fills", "strokes", "cornerRadius",
        "absoluteBoundingBox", "characters", "style", "children",
        "effects", "opacity", "blendMode", "constraints", "layoutMode",
        "padding", "itemSpacing", "componentProperties"
      ])).optional().describe(
        "Optional array of fields to include in the response. If not specified, returns: id, name, type, fills, strokes, cornerRadius, absoluteBoundingBox, characters, style. Available fields: id, name, type, fills, strokes, cornerRadius, absoluteBoundingBox, characters, style, children, effects, opacity, blendMode, constraints, layoutMode, padding, itemSpacing, componentProperties"
      ),
    },
    async ({ nodeId, fields }) => {
      try {
        const result = await sendCommandToFigma("get_node_info", { nodeId });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(filterFigmaNode(result, fields))
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting node info: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Nodes Info Tool
  server.tool(
    "get_nodes_info",
    "Get detailed information about multiple nodes in Figma",
    {
      nodeIds: z.array(z.string()).describe("Array of node IDs to get information about"),
      fields: z.array(z.enum([
        "id", "name", "type", "fills", "strokes", "cornerRadius",
        "absoluteBoundingBox", "characters", "style", "children",
        "effects", "opacity", "blendMode", "constraints", "layoutMode",
        "padding", "itemSpacing", "componentProperties"
      ])).optional().describe(
        "Optional array of fields to include in the response. If not specified, returns: id, name, type, fills, strokes, cornerRadius, absoluteBoundingBox, characters, style. Available fields: id, name, type, fills, strokes, cornerRadius, absoluteBoundingBox, characters, style, children, effects, opacity, blendMode, constraints, layoutMode, padding, itemSpacing, componentProperties"
      ),
    },
    async ({ nodeIds, fields }) => {
      try {
        const results = await Promise.all(
          nodeIds.map(async (nodeId) => {
            const result = await sendCommandToFigma('get_node_info', { nodeId });
            return { nodeId, info: result };
          })
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results.map((result) => filterFigmaNode(result.info, fields)))
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting nodes info: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // Get Styles Tool
  server.tool(
    "get_styles",
    "Get all styles from the current Figma document",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_styles");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting styles: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Get Local Components Tool
  server.tool(
    "get_local_components",
    "Get all local components from the Figma document",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_local_components");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting local components: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Get Remote Components Tool
  server.tool(
    "get_remote_components",
    "Get available components from team libraries in Figma",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_remote_components");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting remote components: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // Text Node Scanning Tool
  server.tool(
    "scan_text_nodes",
    "Scan all text nodes in the selected Figma node",
    {
      nodeId: z.string().describe("ID of the node to scan"),
    },
    async ({ nodeId }) => {
      try {
        // Initial response to indicate we're starting the process
        const initialStatus = {
          type: "text" as const,
          text: "Starting text node scanning. This may take a moment for large designs...",
        };

        // Use the plugin's scan_text_nodes function with chunking flag
        const result = await sendCommandToFigma("scan_text_nodes", {
          nodeId,
          useChunking: true,  // Enable chunking on the plugin side
          chunkSize: 10       // Process 10 nodes at a time
        });

        // If the result indicates chunking was used, format the response accordingly
        if (result && typeof result === 'object' && 'chunks' in result) {
          const typedResult = result as {
            success: boolean,
            totalNodes: number,
            processedNodes: number,
            chunks: number,
            textNodes: Array<any>
          };

          const summaryText = `
          Scan completed:
          - Found ${typedResult.totalNodes} text nodes
          - Processed in ${typedResult.chunks} chunks
          `;

          return {
            content: [
              initialStatus,
              {
                type: "text" as const,
                text: summaryText
              },
              {
                type: "text" as const,
                text: JSON.stringify(typedResult.textNodes, null, 2)
              }
            ],
          };
        }

        // If chunking wasn't used or wasn't reported in the result format, return the result as is
        return {
          content: [
            initialStatus,
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error scanning text nodes: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Join Channel Tool
  server.tool(
    "join_channel",
    "Join a specific channel to communicate with Figma",
    {
      channel: z.string().describe("The name of the channel to join"),
    },
    async ({ channel }) => {
      try {
        if (!channel) {
          // If no channel provided, ask the user for input
          return {
            content: [
              {
                type: "text",
                text: "Please provide a channel name to join:",
              },
            ],
            followUp: {
              tool: "join_channel",
              description: "Join the specified channel",
            },
          };
        }

        // Use joinChannel instead of sendCommandToFigma to ensure currentChannel is updated
        await joinChannel(channel);
        
        return {
          content: [
            {
              type: "text",
              text: `Successfully joined channel: ${channel}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error joining channel: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Export Node as Image Tool
  server.tool(
    "export_node_as_image",
    "Export a node as an image from Figma",
    {
      nodeId: z.string().describe("The ID of the node to export"),
      format: z
        .enum(["PNG", "JPG", "SVG", "PDF"])
        .optional()
        .describe("Export format"),
      scale: z.number().positive().optional().describe("Export scale"),
    },
    async ({ nodeId, format, scale }) => {
      try {
        const result = await sendCommandToFigma("export_node_as_image", {
          nodeId,
          format: format || "PNG",
          scale: scale || 1,
        });
        const typedResult = result as { imageData: string; mimeType: string };

        return {
          content: [
            {
              type: "image",
              data: typedResult.imageData,
              mimeType: typedResult.mimeType || "image/png",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error exporting node as image: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Get Variables Tool
  server.tool(
    "get_variables",
    "Get all variables and variable collections from the current Figma document",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_variables");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting variables: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // Get Bound Variables Tool
  server.tool(
    "get_bound_variables",
    "Get all variable bindings for a specific node in Figma",
    {
      nodeId: z.string().describe("The ID of the node to check for variable bindings")
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("get_bound_variables", { nodeId });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting bound variables: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );
}