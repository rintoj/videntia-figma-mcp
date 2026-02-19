import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma, joinChannel, getOpenChannels } from "../utils/websocket.js";
import { filterFigmaNode } from "../utils/figma-helpers.js";
import { figmaAccessToken, FIGMA_API_BASE_URL } from "../config/config.js";
import { coerceArray } from "../utils/coerce-array.js";
import { convertToJsx } from "../utils/figma-to-jsx.js";
import { parseJsx } from "../utils/jsx-to-figma.js";
import { outputFormatSchema, fetchNodesAsJsx, fetchSelectionAsJsx } from "../utils/output-format.js";
import type {
  ReadMyDesignResult,
  DocumentInfoResult,
  AnnotationsResult,
  SetAnnotationResult,
  AnnotationCategoriesResult,
  CreateAnnotationCategoryResult,
  UpdateAnnotationCategoryResult,
  StylesResult,
  RemoteComponentsResult,
  BoundVariablesResult,
} from "../types/index.js";
import {
  formatColorValue,
  formatVariableValue,
  formatVariablesAsText,
  sanitizeCell,
  truncate,
} from "../utils/format-helpers.js";

/**
 * Register document-related tools to the MCP server
 * @param server - The MCP server instance
 */
export function registerDocumentTools(server: McpServer): void {
  // Document Info Tool
  server.tool("get_document_info", "Get detailed information about the current Figma document", {}, async () => {
    try {
      const result = await sendCommandToFigma<DocumentInfoResult>("get_document_info");
      const pages = result.pages || [];
      const lines: string[] = [`## ${result.name || "Untitled"} (ID: ${result.id || "-"})`, `Pages: ${pages.length}`];
      if (pages.length > 0) {
        lines.push("");
        lines.push("| Page | ID |");
        lines.push("|------|----|");
        for (const p of pages) lines.push(`| ${p.name || "-"} | ${p.id || "-"} |`);
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
            text: `Error getting document info: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  });

  // Read My Design Tool
  server.tool(
    "read_my_design",
    "Read the current Figma selection (or a specific node) as JSX with Tailwind CSS classes. Returns compact, Claude-readable markup instead of verbose JSON.",
    {
      nodeId: z.string().optional().describe("Specific node ID to read (defaults to current selection)"),
      depth: z.number().optional().describe("Max depth to traverse (default: unlimited)"),
    },
    async ({ nodeId, depth }) => {
      try {
        const result = (await sendCommandToFigma("read_my_design", { nodeId, depth })) as ReadMyDesignResult;
        const selection = result?.selection ?? [];
        const jsx = convertToJsx(selection);
        return {
          content: [
            {
              type: "text",
              text: jsx,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error reading design${nodeId ? ` for node "${nodeId}"` : ""}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // JSX to Figma Tool
  server.tool(
    "jsx_to_figma",
    "Create or update Figma nodes from JSX+Tailwind markup. When an element has id='<nodeId>' matching an existing Figma node, that node is updated in-place (properties only — existing children are preserved). Set replaceChildren=true to also replace children. Without an id, creates new nodes. Accepts the same format that read_my_design outputs. Auto-positions next to existing page content when no positioning params are given.",
    {
      jsx: z.string().describe("JSX+Tailwind markup string"),
      parentId: z.string().optional().describe("Parent node ID to insert into (defaults to current page)"),
      nextToId: z.string().optional().describe("Place the new node to the right of this node ID"),
      x: z.number().optional().describe("X position for the root node"),
      y: z.number().optional().describe("Y position for the root node"),
      replaceChildren: z.boolean().optional().describe("When updating an existing node (via id), replace its children with the JSX children. Default: false (preserve existing children)"),
    },
    async ({ jsx, parentId, nextToId, x, y, replaceChildren }) => {
      try {
        const data = parseJsx(jsx);
        // DEBUG: log what parseJsx produced (server-side)
        const serverDebug = data.map((d: any) => ({
          type: d.type,
          layoutMode: d.layoutMode,
          fillsCount: d.fills?.length ?? 0,
          fills: d.fills,
          fontFamily: d.fontFamily,
          children: d.children?.map((c: any) => ({
            type: c.type,
            layoutMode: c.layoutMode,
            fillsCount: c.fills?.length ?? 0,
            fills: c.fills,
            fontFamily: c.fontFamily,
          })),
        }));
        const result = await sendCommandToFigma("create_from_data", { data, parentId, nextToId, x, y, replaceChildren });
        const typedResult = result as {
          createdNodes: Array<{ id: string; name: string; type: string; action?: string }>;
          debugInfo?: unknown;
        };
        const created = typedResult.createdNodes.filter((n) => n.action !== "updated");
        const updated = typedResult.createdNodes.filter((n) => n.action === "updated");
        const lines: string[] = [];
        if (updated.length > 0) {
          lines.push(`Updated ${updated.length} node(s): ${updated.map((n) => `"${n.name}" (${n.id})`).join(", ")}`);
        }
        if (created.length > 0) {
          lines.push(`Created ${created.length} node(s): ${created.map((n) => `"${n.name}" (${n.id})`).join(", ")}`);
        }
        if (lines.length === 0) {
          lines.push("No nodes created or updated.");
        }
        lines.push(`\nSERVER parseJsx output:\n${JSON.stringify(serverDebug, null, 2)}`);
        if (typedResult.debugInfo) {
          lines.push(`\nPLUGIN received data:\n${JSON.stringify(typedResult.debugInfo, null, 2)}`);
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
              text: `Error creating from JSX: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Focus Tool
  server.tool(
    "set_focus",
    "Set focus on a specific node in Figma by selecting it and scrolling viewport to it",
    {
      nodeId: z.string().describe("The ID of the node to focus on"),
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("set_focus", { nodeId });
        const typedResult = result as { name: string; id: string };
        return {
          content: [
            {
              type: "text",
              text: `Focused on node "${typedResult.name}" (ID: ${typedResult.id})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting focus on node "${nodeId}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Selections Tool
  server.tool(
    "set_selections",
    "Set selection to multiple nodes in Figma and scroll viewport to show them",
    {
      nodeIds: coerceArray(z.array(z.string())).describe("Array of node IDs to select"),
    },
    async ({ nodeIds }) => {
      try {
        const result = await sendCommandToFigma("set_selections", { nodeIds });
        const typedResult = result as {
          selectedNodes: Array<{ name: string; id: string }>;
          count: number;
        };
        return {
          content: [
            {
              type: "text",
              text: `Selected ${typedResult.count} nodes: ${typedResult.selectedNodes
                .map((n) => `"${n.name}" (${n.id})`)
                .join(", ")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting selections for ${nodeIds.length} node(s): ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Get Annotations Tool
  server.tool(
    "get_annotations",
    "Get all annotations in the current document or specific node",
    {
      nodeId: z.string().describe("Node ID to get annotations for specific node"),
      includeCategories: z.boolean().optional().default(true).describe("Whether to include category information"),
    },
    async ({ nodeId, includeCategories }) => {
      try {
        const result = await sendCommandToFigma<AnnotationsResult>("get_annotations", {
          nodeId,
          includeCategories,
        });
        const annotations = result.annotations || (Array.isArray(result) ? result : []);
        if (annotations.length === 0) {
          return { content: [{ type: "text", text: "No annotations found." }] };
        }
        const lines: string[] = [
          `Found ${annotations.length} annotation(s)`,
          "",
          "| Label | Category | Node ID | ID |",
          "|-------|----------|---------|----|",
        ];
        for (const a of annotations) {
          const label = truncate((a.labelMarkdown || a.label || "-").replace(/\n/g, " "), 60);
          const cat = a.category?.label || a.categoryId || "-";
          lines.push(`| ${label} | ${cat} | ${a.nodeId || "-"} | ${a.id ?? "-"} |`);
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
              text: `Error getting annotations for node "${nodeId}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Annotation Tool
  server.tool(
    "set_annotation",
    "Create or update an annotation",
    {
      nodeId: z.string().describe("The ID of the node to annotate"),
      annotationId: z
        .string()
        .optional()
        .describe("The index of the annotation to update (0-based). Omit to append a new annotation."),
      labelMarkdown: z.string().describe("The annotation text in markdown format"),
      categoryId: z.string().optional().describe("The ID of the annotation category"),
      properties: coerceArray(z.array(z.object({ type: z.string() })))
        .optional()
        .describe("Additional properties for the annotation"),
    },
    async ({ nodeId, annotationId, labelMarkdown, categoryId, properties }) => {
      try {
        const result = await sendCommandToFigma<SetAnnotationResult>("set_annotation", {
          nodeId,
          annotationId,
          labelMarkdown,
          categoryId,
          properties,
        });
        const action = annotationId != null ? "Updated" : "Created";
        return {
          content: [
            {
              type: "text",
              text: `${action} annotation on node "${result.nodeName || nodeId}" (index: ${result.annotationIndex ?? annotationId ?? 0})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting annotation on node "${nodeId}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Multiple Annotations Tool
  server.tool(
    "set_multiple_annotations",
    "Set multiple annotations parallelly in a node",
    {
      nodeId: z.string().describe("The ID of the node containing elements to annotate"),
      annotations: coerceArray(
        z.array(
          z.object({
            nodeId: z.string().describe("The ID of the node to annotate"),
            labelMarkdown: z.string().describe("The annotation text in markdown format"),
            categoryId: z.string().optional().describe("The ID of the annotation category"),
            annotationId: z.string().optional().describe("The ID of the annotation to update"),
            properties: coerceArray(z.array(z.object({ type: z.string() })))
              .optional()
              .describe("Additional properties for the annotation"),
          }),
        ),
      ).describe("Array of annotations to apply"),
    },
    async ({ nodeId, annotations }) => {
      try {
        if (!annotations || annotations.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No annotations provided",
              },
            ],
          };
        }

        const result = await sendCommandToFigma("set_multiple_annotations", {
          nodeId,
          annotations,
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

        const failedResults = (typedResult.results || []).filter((item) => !item.success);

        let detailedResponse = "";
        if (failedResults.length > 0) {
          detailedResponse = `\n\nFailed nodes:\n${failedResults
            .map((item) => `- ${item.nodeId}: ${item.error || "Unknown error"}`)
            .join("\n")}`;
        }

        return {
          content: [{ type: "text" as const, text: progressText + detailedResponse }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting multiple annotations on node "${nodeId}" (${annotations?.length ?? 0} annotations): ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Get Annotation Categories Tool
  server.tool("get_annotation_categories", "Get all annotation categories in the current document", {}, async () => {
    try {
      const result = await sendCommandToFigma<AnnotationCategoriesResult>("get_annotation_categories");
      const categories = result.categories || (Array.isArray(result) ? result : []);
      if (categories.length === 0) {
        return { content: [{ type: "text", text: "No annotation categories found." }] };
      }
      const lines: string[] = [
        `Found ${categories.length} annotation category/categories`,
        "",
        "| Label | Color | Preset | ID |",
        "|-------|-------|--------|----|",
      ];
      for (const c of categories) {
        lines.push(`| ${c.label || "-"} | ${c.color || "-"} | ${c.isPreset ? "Yes" : "No"} | ${c.id} |`);
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
            text: `Error getting annotation categories: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  });

  // Create Annotation Category Tool
  server.tool(
    "create_annotation_category",
    "Create a new annotation category",
    {
      label: z.string().describe("The label for the new category"),
      color: z
        .enum(["blue", "green", "yellow", "orange", "red", "purple", "gray", "teal"])
        .optional()
        .default("blue")
        .describe("The color for the category"),
    },
    async ({ label, color }) => {
      try {
        const result = await sendCommandToFigma<CreateAnnotationCategoryResult>("create_annotation_category", {
          label,
          color,
        });
        return {
          content: [
            {
              type: "text",
              text: `Created annotation category "${result.name || label}" (ID: ${result.id || "-"}, color: ${result.color || color})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating annotation category "${label}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Update Annotation Category Tool
  server.tool(
    "update_annotation_category",
    "Update an existing annotation category's label or color",
    {
      categoryId: z.string().describe("The ID of the category to update"),
      label: z.string().optional().describe("New label for the category"),
      color: z
        .enum(["blue", "green", "yellow", "orange", "red", "purple", "gray", "teal"])
        .optional()
        .describe("New color for the category"),
    },
    async ({ categoryId, label, color }) => {
      try {
        const result = await sendCommandToFigma<UpdateAnnotationCategoryResult>("update_annotation_category", {
          categoryId,
          label,
          color,
        });
        return {
          content: [
            {
              type: "text",
              text: `Updated annotation category "${result.name || label || "-"}" (ID: ${result.id || categoryId})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error updating annotation category "${categoryId}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Delete Annotation Category Tool
  server.tool(
    "delete_annotation_category",
    "Delete a custom annotation category (preset categories cannot be deleted)",
    {
      categoryId: z.string().describe("The ID of the category to delete"),
    },
    async ({ categoryId }) => {
      try {
        const result = await sendCommandToFigma("delete_annotation_category", {
          categoryId,
        });
        return {
          content: [
            {
              type: "text",
              text: `Deleted annotation category (ID: ${categoryId})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting annotation category "${categoryId}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Scan Nodes By Types Tool
  server.tool(
    "scan_nodes_by_types",
    "Scan for child nodes with specific types in the selected Figma node. Returns JSX+Tailwind by default; use output_format='json' for raw Figma JSON.",
    {
      nodeId: z.string().describe("ID of the node to scan"),
      types: coerceArray(z.array(z.string())).describe("Array of node types (e.g. ['COMPONENT', 'FRAME'])"),
      output_format: outputFormatSchema,
    },
    async ({ nodeId, types, output_format }) => {
      try {
        const result = await sendCommandToFigma("scan_nodes_by_types", {
          nodeId,
          types,
        });

        if (result && typeof result === "object" && "matchingNodes" in result) {
          const typedResult = result as {
            success: boolean;
            count: number;
            matchingNodes: Array<any>;
            searchedTypes: Array<string>;
          };

          const summaryText = `Found ${typedResult.count} nodes matching types: ${typedResult.searchedTypes.join(", ")}`;

          if (output_format === "jsx" && typedResult.matchingNodes.length > 0) {
            const ids = typedResult.matchingNodes.map((n: any) => n.id);
            const jsx = await fetchNodesAsJsx(ids);
            return {
              content: [
                { type: "text" as const, text: summaryText },
                { type: "text" as const, text: jsx },
              ],
            };
          }

          const nodeLines: string[] = ["| Name | Type | ID |", "|------|------|----|"];
          for (const n of typedResult.matchingNodes) {
            nodeLines.push(`| ${n.name || "-"} | ${n.type || "-"} | ${n.id} |`);
          }
          return {
            content: [
              { type: "text" as const, text: summaryText },
              { type: "text" as const, text: nodeLines.join("\n") },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error scanning nodes by types [${types.join(", ")}] in node "${nodeId}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Selection Tool
  server.tool(
    "get_selection",
    "Get information about the current selection in Figma. Returns JSX+Tailwind by default; use output_format='json' for raw Figma JSON.",
    {
      output_format: outputFormatSchema,
    },
    async ({ output_format }) => {
      try {
        if (output_format === "jsx") {
          const jsx = await fetchSelectionAsJsx();
          return { content: [{ type: "text", text: jsx }] };
        }
        const result = await sendCommandToFigma("get_selection");
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
              text: `Error getting selection: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Node Info Tool
  server.tool(
    "get_node_info",
    "Get detailed information about a specific node in Figma. Returns JSX+Tailwind by default; use output_format='json' for raw Figma JSON.",
    {
      nodeId: z.string().describe("The ID of the node to get information about"),
      fields: coerceArray(
        z.array(
          z.enum([
            "id",
            "name",
            "type",
            "fills",
            "strokes",
            "cornerRadius",
            "absoluteBoundingBox",
            "characters",
            "style",
            "children",
            "effects",
            "opacity",
            "blendMode",
            "constraints",
            "layoutMode",
            "padding",
            "itemSpacing",
            "componentProperties",
          ]),
        ),
      )
        .optional()
        .describe(
          "Optional array of fields to include in the response (only used when output_format='json'). If not specified, returns: id, name, type, fills, strokes, cornerRadius, absoluteBoundingBox, characters, style. Available fields: id, name, type, fills, strokes, cornerRadius, absoluteBoundingBox, characters, style, children, effects, opacity, blendMode, constraints, layoutMode, padding, itemSpacing, componentProperties",
        ),
      stripImages: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether to strip image data (only used when output_format='json'). Defaults to true."),
      output_format: outputFormatSchema,
    },
    async ({ nodeId, fields, stripImages, output_format }) => {
      try {
        if (output_format === "jsx") {
          const jsx = await fetchNodesAsJsx([nodeId]);
          return { content: [{ type: "text", text: jsx }] };
        }
        const result = await sendCommandToFigma("get_node_info", { nodeId, stripImages });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(filterFigmaNode(result, fields)),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting node info for "${nodeId}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Nodes Info Tool
  server.tool(
    "get_nodes_info",
    "Get detailed information about multiple nodes in Figma. Returns JSX+Tailwind by default; use output_format='json' for raw Figma JSON.",
    {
      nodeIds: coerceArray(z.array(z.string())).describe("Array of node IDs to get information about"),
      fields: coerceArray(
        z.array(
          z.enum([
            "id",
            "name",
            "type",
            "fills",
            "strokes",
            "cornerRadius",
            "absoluteBoundingBox",
            "characters",
            "style",
            "children",
            "effects",
            "opacity",
            "blendMode",
            "constraints",
            "layoutMode",
            "padding",
            "itemSpacing",
            "componentProperties",
          ]),
        ),
      )
        .optional()
        .describe(
          "Optional array of fields to include in the response (only used when output_format='json'). If not specified, returns: id, name, type, fills, strokes, cornerRadius, absoluteBoundingBox, characters, style. Available fields: id, name, type, fills, strokes, cornerRadius, absoluteBoundingBox, characters, style, children, effects, opacity, blendMode, constraints, layoutMode, padding, itemSpacing, componentProperties",
        ),
      stripImages: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether to strip image data (only used when output_format='json'). Defaults to true."),
      output_format: outputFormatSchema,
    },
    async ({ nodeIds, fields, stripImages, output_format }) => {
      try {
        if (output_format === "jsx") {
          const jsx = await fetchNodesAsJsx(nodeIds);
          return { content: [{ type: "text", text: jsx }] };
        }
        const results = await Promise.all(
          nodeIds.map(async (nodeId) => {
            const result = await sendCommandToFigma("get_node_info", { nodeId, stripImages });
            return { nodeId, info: result };
          }),
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results.map((result) => filterFigmaNode(result.info, fields))),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting nodes info for ${nodeIds.length} node(s): ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Get Styles Tool
  server.tool("get_styles", "Get all styles from the current Figma document", {}, async () => {
    try {
      const result = await sendCommandToFigma<StylesResult>("get_styles");
      const styles = Array.isArray(result) ? result : result?.styles || [];
      if (styles.length === 0) {
        return { content: [{ type: "text", text: "No styles found." }] };
      }
      // Group by style type
      const grouped = new Map<string, any[]>();
      for (const s of styles) {
        const type = s.type || "UNKNOWN";
        const list = grouped.get(type) || [];
        list.push(s);
        grouped.set(type, list);
      }
      const lines: string[] = [`Found ${styles.length} style(s)`, ""];
      for (const [type, items] of grouped) {
        lines.push(`### ${type} Styles (${items.length})`);
        lines.push("| Name | ID | Key |");
        lines.push("|------|----|-----|");
        for (const s of items) {
          lines.push(`| ${s.name || "-"} | ${s.id || "-"} | ${s.key || "-"} |`);
        }
        lines.push("");
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
            text: `Error getting styles: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  });

  // Get Local Components Tool
  server.tool(
    "get_local_components",
    "Get all local components from the Figma document. Returns JSX+Tailwind by default; use output_format='json' for raw Figma JSON.",
    {
      output_format: outputFormatSchema,
    },
    async ({ output_format }) => {
      try {
        const result = await sendCommandToFigma("get_local_components");
        const components = Array.isArray(result) ? result : ((result as any)?.components ?? []);

        if (output_format === "jsx" && components.length > 0) {
          const ids = components.map((c: any) => c.id);
          const jsx = await fetchNodesAsJsx(ids);
          return {
            content: [
              { type: "text" as const, text: `Found ${components.length} local components` },
              { type: "text" as const, text: jsx },
            ],
          };
        }

        if (components.length === 0) {
          return { content: [{ type: "text", text: "No local components found." }] };
        }
        const lines: string[] = [
          `Found ${components.length} local component(s)`,
          "",
          "| Name | Type | ID | Key |",
          "|------|------|----|-----|",
        ];
        for (const c of components) {
          lines.push(`| ${sanitizeCell(c.name || "-")} | ${c.type || "-"} | ${c.id || "-"} | ${c.key || "-"} |`);
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
              text: `Error getting local components: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Get Remote Components Tool
  server.tool("get_remote_components", "Get available components from team libraries in Figma", {}, async () => {
    try {
      const result = await sendCommandToFigma<RemoteComponentsResult>("get_remote_components");
      const components = Array.isArray(result) ? result : (result?.components ?? []);
      if (components.length === 0) {
        return { content: [{ type: "text", text: "No remote components found." }] };
      }
      const lines: string[] = [
        `Found ${components.length} remote component(s)`,
        "",
        "| Name | ID | Key | Library |",
        "|------|----|-----|---------|",
      ];
      for (const c of components) {
        lines.push(`| ${c.name || "-"} | ${c.id || "-"} | ${c.key || "-"} | ${c.libraryName || c.library || "-"} |`);
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
            text: `Error getting remote components: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  });

  // Text Node Scanning Tool
  server.tool(
    "scan_text_nodes",
    "Scan all text nodes in the selected Figma node. Returns JSX+Tailwind by default; use output_format='json' for raw Figma JSON.",
    {
      nodeId: z.string().describe("ID of the node to scan"),
      output_format: outputFormatSchema,
    },
    async ({ nodeId, output_format }) => {
      try {
        // Use the plugin's scan_text_nodes function with chunking flag
        const result = await sendCommandToFigma("scan_text_nodes", {
          nodeId,
          useChunking: true, // Enable chunking on the plugin side
          chunkSize: 10, // Process 10 nodes at a time
        });

        // If the result indicates chunking was used, format the response accordingly
        if (result && typeof result === "object" && "chunks" in result) {
          const typedResult = result as {
            success: boolean;
            totalNodes: number;
            processedNodes: number;
            chunks: number;
            textNodes: Array<any>;
          };

          const summaryText = `Found ${typedResult.totalNodes} text nodes (processed in ${typedResult.chunks} chunks)`;

          if (output_format === "jsx" && typedResult.textNodes.length > 0) {
            const ids = typedResult.textNodes.map((n: any) => n.id);
            const jsx = await fetchNodesAsJsx(ids);
            return {
              content: [
                { type: "text" as const, text: summaryText },
                { type: "text" as const, text: jsx },
              ],
            };
          }

          const nodeLines: string[] = [
            "| Name | Characters | Font | Size | ID |",
            "|------|------------|------|------|----|",
          ];
          for (const n of typedResult.textNodes) {
            const chars = truncate((n.characters || "").replace(/\n/g, " "), 40);
            const font = n.fontName
              ? `${n.fontName.family} ${n.fontName.style || ""}`.trim()
              : n.style?.fontFamily || "-";
            const size = n.fontSize ?? n.style?.fontSize ?? "-";
            nodeLines.push(`| ${n.name || "-"} | ${chars} | ${font} | ${size} | ${n.id} |`);
          }
          return {
            content: [
              { type: "text" as const, text: summaryText },
              { type: "text" as const, text: nodeLines.join("\n") },
            ],
          };
        }

        // If chunking wasn't used, try to extract IDs for JSX mode
        if (output_format === "jsx" && result && typeof result === "object" && "textNodes" in result) {
          const typedResult = result as { textNodes: Array<any> };
          if (typedResult.textNodes.length > 0) {
            const ids = typedResult.textNodes.map((n: any) => n.id);
            const jsx = await fetchNodesAsJsx(ids);
            return {
              content: [
                { type: "text" as const, text: `Found ${typedResult.textNodes.length} text nodes` },
                { type: "text" as const, text: jsx },
              ],
            };
          }
        }

        return {
          content: [
            {
              type: "text",
              text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error scanning text nodes in node "${nodeId}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
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
              text: `Error joining channel "${channel}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Get Open Channels Tool
  server.tool(
    "get_open_channels",
    "Get all open Figma channels and their corresponding file names. Use this to discover available channels before joining one.",
    {},
    async () => {
      try {
        const channels = await getOpenChannels();
        if (channels.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No open channels found. Make sure the Figma plugin is running and connected.",
              },
            ],
          };
        }
        const lines: string[] = [
          `Found ${channels.length} open channel(s)`,
          "",
          "| File Name | Channel ID |",
          "|-----------|------------|",
        ];
        for (const ch of channels) {
          lines.push(
            `| ${ch.fileName || "-"} | ${ch.channel || "-"} |`,
          );
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
              text: `Error getting open channels: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Export Node as Image Tool
  server.tool(
    "export_node_as_image",
    "Export a node as a base64 image from Figma. For large images (>4000px), consider using export_node_as_image_url instead which returns a CDN URL.",
    {
      nodeId: z.string().describe("The ID of the node to export"),
      format: z.enum(["PNG", "JPG", "SVG", "PDF"]).optional().describe("Export format"),
      scale: z.number().positive().optional().describe("Export scale"),
    },
    async ({ nodeId, format, scale }) => {
      try {
        const result = await sendCommandToFigma("export_node_as_image", {
          nodeId,
          format: format || "PNG",
          scale: scale || 1,
        });
        const typedResult = result as {
          imageData: string;
          mimeType: string;
          requestedScale: number;
          actualScale: number;
          originalWidth: number;
          originalHeight: number;
          exportedWidth: number;
          exportedHeight: number;
        };

        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];

        // Add warning if scale was auto-reduced or image is large
        const wasScaleReduced = typedResult.actualScale < typedResult.requestedScale;
        const isLargeImage = typedResult.exportedWidth > 4000 || typedResult.exportedHeight > 4000;

        if (wasScaleReduced) {
          content.push({
            type: "text",
            text: `⚠️ Image was auto-scaled from ${typedResult.requestedScale}x to ${typedResult.actualScale.toFixed(2)}x to fit within size limits. Original: ${typedResult.originalWidth}x${typedResult.originalHeight}px, Exported: ${typedResult.exportedWidth}x${typedResult.exportedHeight}px. For full resolution, use export_node_as_image_url (requires FIGMA_ACCESS_TOKEN).`,
          });
        } else if (isLargeImage) {
          content.push({
            type: "text",
            text: `ℹ️ Large image exported (${typedResult.exportedWidth}x${typedResult.exportedHeight}px). For better performance with large images, consider using export_node_as_image_url.`,
          });
        }

        content.push({
          type: "image",
          data: typedResult.imageData,
          mimeType: typedResult.mimeType || "image/png",
        });

        return { content };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error exporting node "${nodeId}" as image (${format || "PNG"}): ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Export Node as Image URL Tool (using Figma REST API)
  server.tool(
    "export_node_as_image_url",
    "Export a node as an image URL using Figma REST API. Returns a CDN URL instead of base64 data. Requires FIGMA_ACCESS_TOKEN environment variable or --figma-token CLI argument.",
    {
      nodeId: z.string().describe("The ID of the node to export"),
      format: z.enum(["png", "jpg", "svg", "pdf"]).optional().default("png").describe("Export format (lowercase)"),
      scale: z.number().positive().min(0.01).max(4).optional().default(1).describe("Export scale (0.01 to 4)"),
      fileKey: z.string().optional().describe("Figma file key. If not provided, will be fetched from the plugin."),
    },
    async ({ nodeId, format, scale, fileKey }) => {
      try {
        // Check if token is configured
        if (!figmaAccessToken) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Figma access token not configured. Set FIGMA_ACCESS_TOKEN environment variable or use --figma-token=<token> CLI argument.",
              },
            ],
          };
        }

        // Get file key from plugin if not provided
        let resolvedFileKey = fileKey;
        if (!resolvedFileKey) {
          const fileKeyResult = await sendCommandToFigma("get_file_key", {});
          const typedResult = fileKeyResult as { fileKey: string; fileName: string };
          resolvedFileKey = typedResult.fileKey;
        }

        if (!resolvedFileKey) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Could not determine file key. Please provide it as a parameter or ensure the Figma file is saved.",
              },
            ],
          };
        }

        // Build the Figma REST API URL
        // Node IDs in Figma use ":" separator, but REST API expects "-" separator
        const encodedNodeId = encodeURIComponent(nodeId.replace(/:/g, "-"));
        const apiUrl = `${FIGMA_API_BASE_URL}/images/${resolvedFileKey}?ids=${encodedNodeId}&format=${format}&scale=${scale}`;

        // Make the API request
        const response = await fetch(apiUrl, {
          method: "GET",
          headers: {
            "X-Figma-Token": figmaAccessToken,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = `Figma API error (${response.status})`;
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.err || errorJson.message || errorMessage;
          } catch {
            errorMessage = errorText || errorMessage;
          }
          return {
            content: [
              {
                type: "text",
                text: `Error from Figma API: ${errorMessage}`,
              },
            ],
          };
        }

        const data = (await response.json()) as {
          err?: string;
          images?: Record<string, string | null>;
        };

        if (data.err) {
          return {
            content: [
              {
                type: "text",
                text: `Figma API error: ${data.err}`,
              },
            ],
          };
        }

        // Extract the image URL from response
        const images = data.images || {};
        const imageUrl = Object.values(images)[0];

        if (!imageUrl) {
          return {
            content: [
              {
                type: "text",
                text: `No image generated for node ${nodeId}. The node may be empty, invisible, or not exportable.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Exported node ${nodeId} as ${format.toUpperCase()} (scale: ${scale}x)\n\nURL: ${imageUrl}\n\nNote: CDN URL expires in ~30 days.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error exporting node "${nodeId}" as image URL (${format}): ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
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
              text: formatVariablesAsText(result as { variables: any[]; collections: any[] }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting variables: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Get Bound Variables Tool
  server.tool(
    "get_bound_variables",
    "Get all variable bindings for a specific node in Figma",
    {
      nodeId: z.string().describe("The ID of the node to check for variable bindings"),
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma<BoundVariablesResult>("get_bound_variables", { nodeId });
        // Result can be an object map {property: binding} or {bindings: [...]}
        const bindings = result.bindings || (Array.isArray(result) ? result : null);
        if (bindings) {
          // Array format
          if (bindings.length === 0) {
            return { content: [{ type: "text", text: "No variable bindings found on this node." }] };
          }
          const lines: string[] = [
            `Found ${bindings.length} variable binding(s)`,
            "",
            "| Property | Variable | Collection | ID |",
            "|----------|----------|------------|----|",
          ];
          for (const b of bindings) {
            lines.push(
              `| ${sanitizeCell(b.property || "-")} | ${sanitizeCell(b.name || b.variableName || "-")} | ${sanitizeCell(b.collectionName || "-")} | ${b.variableId || b.id || "-"} |`,
            );
          }
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }
        // Object map format {property: {variableId, ...}}
        const metadataKeys = new Set(["nodeId", "nodeName", "bindings"]);
        const entries = Object.entries(result).filter(([k]) => !metadataKeys.has(k));
        if (entries.length === 0) {
          return { content: [{ type: "text", text: "No variable bindings found on this node." }] };
        }
        const lines: string[] = [
          `Found ${entries.length} variable binding(s)`,
          "",
          "| Property | Variable | ID |",
          "|----------|----------|----|",
        ];
        for (const [prop, binding] of entries) {
          const b = binding as any;
          lines.push(
            `| ${sanitizeCell(prop)} | ${sanitizeCell(b.name || b.variableName || "-")} | ${b.variableId || b.id || "-"} |`,
          );
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
              text: `Error getting bound variables for node "${nodeId}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Create Page Tool
  server.tool(
    "create_page",
    "Create a new page in the Figma document",
    {
      name: z.string().describe("The name for the new page"),
    },
    async ({ name }) => {
      try {
        const result = await sendCommandToFigma("create_page", { name });
        const typedResult = result as { id: string; name: string };
        return {
          content: [
            {
              type: "text",
              text: `Created page "${typedResult.name}" (ID: ${typedResult.id})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating page "${name}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Rename Page Tool
  server.tool(
    "rename_page",
    "Rename an existing page in the Figma document",
    {
      pageId: z.string().describe("The ID of the page to rename"),
      name: z.string().describe("The new name for the page"),
    },
    async ({ pageId, name }) => {
      try {
        const result = await sendCommandToFigma("rename_page", { pageId, name });
        const typedResult = result as { id: string; oldName: string; newName: string };
        return {
          content: [
            {
              type: "text",
              text: `Renamed page from "${typedResult.oldName}" to "${typedResult.newName}" (ID: ${typedResult.id})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error renaming page "${pageId}" to "${name}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Delete Page Tool
  server.tool(
    "delete_page",
    "Delete a page from the Figma document. Cannot delete the last remaining page.",
    {
      pageId: z.string().describe("The ID of the page to delete"),
    },
    async ({ pageId }) => {
      try {
        const result = await sendCommandToFigma("delete_page", { pageId });
        const typedResult = result as { id: string; name: string };
        return {
          content: [
            {
              type: "text",
              text: `Deleted page "${typedResult.name}" (ID: ${typedResult.id})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting page "${pageId}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}
