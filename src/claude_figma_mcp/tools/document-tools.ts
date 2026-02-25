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
  BoundVariablesResult,
  LintFrameResult,
  LintViolation,
  GetDesignSystemResult,
  DesignSystemVariable,
  DesignSystemTextStyle,
  DesignSystemEffect,
  DesignSystemEffectStyle,
  SetupDesignSystemResult,
} from "../types/index.js";
import {
  formatColorValue,
  formatVariableValue,
  formatVariablesAsText,
  sanitizeCell,
  truncate,
} from "../utils/format-helpers.js";

/**
 * Purpose descriptions for known design tokens.
 * Used as fallback when Figma variable/style has no description set.
 */
export const TOKEN_PURPOSE_MAP: Record<string, string> = {
  // Background
  "background/primary": "Main app background, root screen fill",
  "background/secondary": "Cards, elevated sections, sidebar panels",
  "background/tertiary": "Subtle fills, image placeholders, input fields",
  "background/inverse": "Inverted hero sections, highlight banners",
  // Text
  "text/primary": "Headings, primary labels, high-emphasis content",
  "text/secondary": "Descriptions, subtitles, supporting copy",
  "text/tertiary": "Hints, placeholders, disabled labels",
  "text/inverse": "Text on bright backgrounds (brand/primary, inverse)",
  "text/body": "Long-form body paragraphs, readable content",
  "text/muted": "De-emphasized metadata, timestamps, footnotes",
  "text/link": "Clickable links, inline actions",
  // Brand
  "brand/primary": "Primary brand accent, hero highlights, key CTAs",
  "brand/secondary": "Secondary accent, badges, notifications, emphasis",
  "brand/accent": "Cool accent, data visualization, progress indicators",
  "brand/button": "Primary button fills, prominent action backgrounds",
  "brand/primary/subtle": "Soft brand tint for tags, selected states, hover fills",
  "brand/accent/subtle": "Soft accent tint for info badges, active indicators",
  // Semantic
  "semantic/success": "Success icons, confirmation text, positive indicators",
  "semantic/warning": "Warning icons, caution text, attention signals",
  "semantic/error": "Error text, destructive actions, validation failures",
  "semantic/info": "Info icons, help text, neutral status indicators",
  "semantic/success/subtle": "Success banner backgrounds, positive row highlights",
  "semantic/warning/subtle": "Warning banner backgrounds, caution row highlights",
  "semantic/error/subtle": "Error banner backgrounds, destructive row highlights",
  "semantic/info/subtle": "Info banner backgrounds, neutral row highlights",
  // Border
  "border/default": "Standard card/input borders, dividers",
  "border/subtle": "Soft dividers, section separators",
  "border/strong": "Emphasized borders, active input outlines",
  "border/strong/light": "High-contrast borders, focused states",
  "border/subtle/dark": "Near-invisible separators, nested card edges",
  "border/success": "Success state borders, confirmation outlines",
  "border/warning": "Warning state borders, caution outlines",
  "border/error": "Error state borders, validation outlines",
  "border/info": "Info state borders, help outlines",
  // Preview
  "preview/sidebar": "Sidebar background in preview/demo mode",
  "preview/nav/inactive": "Inactive nav items in preview/demo mode",
  "preview/content/bg": "Content area background in preview/demo mode",
  // Spacing
  "space/0": "No spacing, flush elements",
  "space/1": "Tight — icon-to-label, badge padding",
  "space/2": "Small — inline elements, compact lists",
  "space/3": "Default — form field gaps, card inner padding",
  "space/4": "Medium — standard card padding, section inner gaps",
  "space/5": "Comfortable — generous card padding",
  "space/6": "Relaxed — section padding, group separation",
  "space/8": "Large — major section breaks",
  "space/10": "XL — hero padding, dramatic breathing room",
  "space/12": "Section — top-level section dividers",
  "space/16": "Page — page-level vertical rhythm, hero whitespace",
  // Radius
  "radius/none": "Sharp corners — dividers, full-bleed sections",
  "radius/sm": "Inputs, small buttons, chips, tags",
  "radius/md": "Cards, standard buttons, dropdowns",
  "radius/lg": "Large cards, image containers, panels",
  "radius/xl": "Modals, bottom sheets, feature cards",
  "radius/2xl": "Large modals, hero containers",
  "radius/full": "Pills, avatars, circular buttons",
  // Text styles
  "text/display/lg": "Hero headlines, splash screens, landing page titles",
  "text/display/md": "Feature section headlines, onboarding titles",
  "text/display/sm": "Sub-hero text, promotional headings",
  "text/heading/h1": "Page titles, primary screen headings",
  "text/heading/h2": "Section titles, card group headers",
  "text/heading/h3": "Card titles, list group headers",
  "text/heading/h4": "Sub-section headers, field group labels",
  "text/body/lg": "Featured descriptions, intro paragraphs",
  "text/body/md": "Standard body copy, descriptions",
  "text/body/sm": "Secondary body text, supporting details",
  "text/label/lg": "Primary button labels, nav items",
  "text/label/md": "Secondary button labels, tab labels, form labels",
  "text/label/sm": "Chip labels, badge text, overline text",
  "text/caption/l1": "Timestamps, metadata, helper text",
  "text/caption/l2": "Fine print, legal text, footnotes",
  // Effect styles
  "shadow/subtle": "Slight lift — hover states, subtle card edges",
  "shadow/sm": "Cards, tiles, content panels",
  "shadow/md": "Dropdowns, popovers, floating menus",
  "shadow/lg": "Modals, dialogs, bottom sheets",
  "shadow/xl": "Toasts, snackbars, high-priority alerts",
};

/**
 * Get purpose for a token name. Falls back to "-" if not found.
 */
export function getTokenPurpose(name: string, figmaDescription?: string): string {
  if (figmaDescription) return figmaDescription;
  return TOKEN_PURPOSE_MAP[name] || "-";
}

/**
 * Derive Tailwind CSS class from a Figma variable/style name.
 */
export function deriveTailwindClass(name: string, type: "color" | "spacing" | "radius" | "text" | "effect"): string {
  const normalized = name.replace(/\s+/g, "-").toLowerCase();

  if (type === "text") {
    return `text-${normalized.replace(/\//g, "-")}`;
  }
  if (type === "effect") {
    return `shadow-${normalized.replace(/\//g, "-")}`;
  }
  if (type === "spacing") {
    // space/4 → p-space-4, gap-space-4
    const cls = normalized.replace(/\//g, "-");
    return `p-${cls}, gap-${cls}`;
  }
  if (type === "radius") {
    return `rounded-${normalized.replace(/\//g, "-")}`;
  }

  // Color type - derive from prefix
  const parts = normalized.split("/");
  const prefix = parts[0];
  const rest = parts.slice(1).join("-");

  switch (prefix) {
    case "background":
      return `bg-background-${rest}`;
    case "text":
      return `text-text-${rest}`;
    case "brand":
      return `bg-brand-${rest}`;
    case "semantic": {
      if (rest.endsWith("-subtle") || rest.endsWith("subtle")) {
        return `bg-semantic-${rest}`;
      }
      return `text-semantic-${rest}`;
    }
    case "border":
      return `border-border-${rest}`;
    case "interactive":
      return `bg-interactive-${rest}`;
    case "overlay":
      return `bg-overlay-${rest}`;
    case "preview":
      return `bg-preview-${rest}`;
    default:
      return `bg-${normalized.replace(/\//g, "-")}`;
  }
}

/**
 * Format a variable's value from its mode values array.
 * Colors → hex, numbers → raw number.
 */
function formatVariableDisplayValue(values: Array<{ modeId: string; modeName: string; value: unknown }>): string {
  if (!values || values.length === 0) return "-";
  const parts: string[] = [];
  for (const mv of values) {
    const v = mv.value;
    let formatted: string;
    if (v && typeof v === "object" && "r" in v && "g" in v && "b" in v) {
      const c = v as { r: number; g: number; b: number; a?: number };
      const r = Math.round(c.r * 255);
      const g = Math.round(c.g * 255);
      const b = Math.round(c.b * 255);
      const a = c.a !== undefined ? c.a : 1;
      if (a < 1) {
        formatted = `rgba(${r},${g},${b},${a.toFixed(2)})`;
      } else {
        formatted = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
      }
    } else if (typeof v === "number") {
      formatted = String(v);
    } else if (typeof v === "string") {
      formatted = v;
    } else {
      formatted = "-";
    }
    if (values.length > 1) {
      parts.push(`${mv.modeName}: ${formatted}`);
    } else {
      parts.push(formatted);
    }
  }
  return parts.join(", ");
}

/**
 * Format a Figma lineHeight value into a readable string.
 */
function formatLineHeight(lh: unknown): string {
  if (!lh || typeof lh !== "object") return "-";
  const obj = lh as { unit?: string; value?: number };
  if (obj.unit === "AUTO") return "auto";
  if (obj.unit === "PERCENT" && obj.value !== undefined) return `${obj.value}%`;
  if (obj.unit === "PIXELS" && obj.value !== undefined) return `${obj.value}px`;
  return "-";
}

/**
 * Format effect style effects into a compact CSS-like string.
 * e.g. "drop-shadow(0 2 4 0 rgba(0,0,0,0.10))"
 */
function formatEffectValue(effects: DesignSystemEffect[]): string {
  if (!effects || effects.length === 0) return "-";
  return effects.map((e) => {
    const type = e.type === "DROP_SHADOW" ? "drop-shadow"
      : e.type === "INNER_SHADOW" ? "inner-shadow"
      : e.type === "LAYER_BLUR" ? "blur"
      : e.type === "BACKGROUND_BLUR" ? "bg-blur"
      : e.type;
    if (e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR") {
      return `${type}(${e.radius !== undefined ? e.radius : 0})`;
    }
    const ox = e.offset ? e.offset.x : 0;
    const oy = e.offset ? e.offset.y : 0;
    const r = e.radius !== undefined ? e.radius : 0;
    const s = e.spread !== undefined ? e.spread : 0;
    const c = e.color
      ? `rgba(${Math.round(e.color.r * 255)},${Math.round(e.color.g * 255)},${Math.round(e.color.b * 255)},${(e.color.a !== undefined ? e.color.a : 1).toFixed(2)})`
      : "rgba(0,0,0,1)";
    return `${type}(${ox} ${oy} ${r} ${s} ${c})`;
  }).join(", ");
}

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
      depth: z.coerce.number().optional().describe("Max depth to traverse (default: unlimited)"),
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
    "Create or update Figma nodes from JSX+Tailwind markup. Supports multiple root elements in a single call — batch them together instead of making separate calls. When an element has id='<nodeId>' matching an existing Figma node, that node is updated in-place (properties only — existing children are preserved). Set replaceChildren=true to also replace children. Without an id, creates new nodes. Accepts the same format that read_my_design outputs. Auto-positions next to existing page content when no positioning params are given.",
    {
      jsx: z
        .string()
        .describe(
          'JSX+Tailwind markup string. Supports multiple root elements e.g. \'<div id="1:1" .../><div id="1:2" .../>\' — always batch multiple nodes into one call.',
        ),
      parentId: z.string().optional().describe("Parent node ID to insert into (defaults to current page)"),
      nextToId: z.string().optional().describe("Place the new node to the right of this node ID"),
      x: z.coerce.number().optional().describe("X position for the root node"),
      y: z.coerce.number().optional().describe("Y position for the root node"),
      replaceChildren: z
        .boolean()
        .optional()
        .describe(
          "When updating an existing node (via id), replace its children with the JSX children. When true with no JSX children, clears all existing children. Omit or false to preserve existing children.",
        ),
    },
    async ({ jsx, parentId, nextToId, x, y, replaceChildren }) => {
      try {
        const data = parseJsx(jsx);
        const result = await sendCommandToFigma("create_from_data", {
          data,
          parentId,
          nextToId,
          x,
          y,
          replaceChildren,
        });
        const typedResult = result as {
          createdNodes: Array<{ id: string; name: string; type: string; action?: string }>;
        };
        const created = typedResult.createdNodes.filter((n) => n.action !== "updated");
        const updated = typedResult.createdNodes.filter((n) => n.action === "updated");
        const parts: string[] = [];
        if (updated.length > 0) {
          parts.push(`Updated ${updated.length} node(s): ${updated.map((n) => `"${n.name}" (${n.id})`).join(", ")}`);
        }
        if (created.length > 0) {
          parts.push(`Created ${created.length} node(s): ${created.map((n) => `"${n.name}" (${n.id})`).join(", ")}`);
        }
        return {
          content: [
            {
              type: "text",
              text: parts.length > 0 ? parts.join(" | ") : "No nodes created or updated.",
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
        const typedResult = result as { name: string; nodeId: string };
        return {
          content: [
            {
              type: "text",
              text: `Focused on node "${typedResult.name}" (ID: ${typedResult.nodeId ?? nodeId})`,
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
          selectedCount: number;
        };
        return {
          content: [
            {
              type: "text",
              text: `Selected ${typedResult.selectedCount ?? nodeIds.length} nodes: ${typedResult.selectedNodes
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
      includeCategories: z.coerce.boolean().optional().default(true).describe("Whether to include category information"),
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
    "Scan for child nodes with specific types in the selected Figma node. Returns JSX+Tailwind markup.",
    {
      nodeId: z.string().describe("ID of the node to scan"),
      types: coerceArray(z.array(z.string())).describe("Array of node types (e.g. ['COMPONENT', 'FRAME'])"),
      topLevelOnly: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "When true (default), returns only the first matching nodes without descending into their children. Set to false to recursively find all nested matches.",
        ),
      output_format: outputFormatSchema,
    },
    async ({ nodeId, types, topLevelOnly, output_format }) => {
      try {
        const result = await sendCommandToFigma("scan_nodes_by_types", {
          nodeId,
          types,
          topLevelOnly,
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
    "Get information about the current selection in Figma. Returns JSX+Tailwind markup.",
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
    "Get detailed information about a specific node in Figma. Returns JSX+Tailwind markup.",
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
          "Optional array of fields to include in the response. Ignored in JSX mode. For JSON mode only — fields to include. Defaults: id, name, type, fills, strokes, cornerRadius, absoluteBoundingBox, characters, style",
        ),
      stripImages: z
        .boolean()
        .optional()
        .default(true)
        .describe("Ignored in JSX mode. For JSON mode only — strip image data. Defaults to true."),
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
    "Get detailed information about multiple nodes in Figma. Returns JSX+Tailwind markup.",
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
          "Optional array of fields to include in the response. Ignored in JSX mode. For JSON mode only — fields to include. Defaults: id, name, type, fills, strokes, cornerRadius, absoluteBoundingBox, characters, style",
        ),
      stripImages: z
        .boolean()
        .optional()
        .default(true)
        .describe("Ignored in JSX mode. For JSON mode only — strip image data. Defaults to true."),
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

      // The plugin returns { colors: [...], texts: [...], effects: [...], grids: [...] }
      const raw = result as any;
      const categories: { label: string; key: string; extraColumns?: string[] }[] = [
        { label: "Paint", key: "colors", extraColumns: ["paint"] },
        { label: "Text", key: "texts", extraColumns: ["fontSize", "fontName"] },
        { label: "Effect", key: "effects" },
        { label: "Grid", key: "grids" },
      ];

      const lines: string[] = [];
      let totalCount = 0;

      for (const cat of categories) {
        const items: any[] = raw?.[cat.key] || [];
        if (items.length === 0) continue;
        totalCount += items.length;

        lines.push(`### ${cat.label} Styles (${items.length})`);

        if (cat.key === "texts") {
          lines.push("| Name | ID | Key | Font | Size |");
          lines.push("|------|----|-----|------|------|");
          for (const s of items) {
            const font = s.fontName ? `${s.fontName.family} ${s.fontName.style}` : "-";
            lines.push(`| ${s.name || "-"} | ${s.id || "-"} | ${s.key || "-"} | ${font} | ${s.fontSize || "-"} |`);
          }
        } else if (cat.key === "colors") {
          lines.push("| Name | ID | Key | Paint Type |");
          lines.push("|------|----|-----|------------|");
          for (const s of items) {
            const paintType = s.paint?.type || "-";
            lines.push(`| ${s.name || "-"} | ${s.id || "-"} | ${s.key || "-"} | ${paintType} |`);
          }
        } else {
          lines.push("| Name | ID | Key |");
          lines.push("|------|----|-----|");
          for (const s of items) {
            lines.push(`| ${s.name || "-"} | ${s.id || "-"} | ${s.key || "-"} |`);
          }
        }
        lines.push("");
      }

      if (totalCount === 0) {
        return { content: [{ type: "text", text: "No styles found." }] };
      }

      lines.unshift(`Found ${totalCount} style(s)`, "");
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
    "Get all local components from the Figma document. Returns JSX+Tailwind markup.",
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

  // Text Node Scanning Tool
  server.tool(
    "scan_text_nodes",
    "Scan all text nodes in the selected Figma node. Returns JSX+Tailwind markup.",
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

  // Lint Frame Tool
  server.tool(
    "lint_frame",
    "Run a comprehensive compliance audit on a frame (or any node with children). Checks color tokens, spacing tokens, border radius tokens, text styles, effect styles, auto-layout compliance, and child overflow in a single traversal. Returns a structured report with violations by severity (CRITICAL/HIGH/MEDIUM/LOW) and compliance percentages across 9 categories. Pass fix=true to auto-fix deterministic violations (root frame sizing: layoutSizingHorizontal→FIXED, layoutSizingVertical→HUG, minHeight→device standard) and report only the remaining issues.",
    {
      node_id: z.string().describe("The ID of the root node to lint"),
      fix: z
        .boolean()
        .optional()
        .describe(
          "When true, automatically fix violations where the correct value is unambiguous (root frame sizing rules). Fixed violations are excluded from the output; only pending issues remain.",
        ),
      checks: z
        .object({
          rootFrame: z
            .boolean()
            .optional()
            .describe(
              "Check root frame sizing: width=FIXED at device width (desktop=1440, tablet=768, mobile=375), height=HUG with minHeight set to device height (default: true)",
            ),
          colors: z.coerce.boolean().optional().describe("Check fill/stroke color bindings (default: true)"),
          spacing: z.coerce.boolean().optional().describe("Check padding/itemSpacing bindings (default: true)"),
          radius: z.coerce.boolean().optional().describe("Check cornerRadius bindings (default: true)"),
          textStyles: z.coerce.boolean().optional().describe("Check text style application (default: true)"),
          effectStyles: z.coerce.boolean().optional().describe("Check effect style application (default: true)"),
          autoLayout: z.coerce.boolean().optional().describe("Check auto-layout on frames (default: true)"),
          overflow: z.coerce.boolean().optional().describe("Check child overflow beyond parent bounds (default: true)"),
        })
        .optional()
        .describe("Toggle individual check categories (all enabled by default)"),
    },
    async ({ node_id, fix, checks }) => {
      try {
        const result = await sendCommandToFigma<LintFrameResult>(
          "lint_frame",
          { nodeId: node_id, fix: fix ?? false, checks },
          60000,
        );

        // Partition violations into fixed vs remaining (only meaningful when fix=true)
        const fixedViolations = result.violations.filter((v: LintViolation) => v.fixed === true);
        const remainingViolations = result.violations.filter((v: LintViolation) => v.fixed !== true);

        // Format as markdown compliance report
        const lines: string[] = [];

        const modeLabel = fix ? " (fix mode)" : "";
        lines.push(`# Compliance Audit: ${result.nodeName}${modeLabel}`);
        lines.push(`**Node:** ${result.nodeId} (${result.nodeType}) | **Nodes scanned:** ${result.totalNodes}`);
        if (fix && fixedViolations.length > 0) {
          lines.push(`**Auto-fixed:** ${fixedViolations.length} violation${fixedViolations.length !== 1 ? "s" : ""}`);
        }
        lines.push("");

        // Compliance table
        lines.push("## Compliance by Category");
        lines.push("");
        lines.push("| Category | Total | Bound | Unbound | Compliance |");
        lines.push("|----------|-------|-------|---------|------------|");

        const catLabels: { key: keyof typeof result.categories; label: string }[] = [
          { key: "rootFrame", label: "Root Frame" },
          { key: "typography", label: "Typography" },
          { key: "backgroundFills", label: "Background Fills" },
          { key: "iconColors", label: "Icon Colors" },
          { key: "strokesBorders", label: "Strokes/Borders" },
          { key: "spacing", label: "Spacing" },
          { key: "borderRadius", label: "Border Radius" },
          { key: "effectStyles", label: "Effect Styles" },
          { key: "overflow", label: "Overflow" },
        ];

        for (const { key, label } of catLabels) {
          const cat = result.categories[key];
          const pct = cat.compliance;
          const status = pct === 100 ? "PASS" : pct >= 80 ? "WARN" : "FAIL";
          lines.push(`| ${label} | ${cat.total} | ${cat.bound} | ${cat.unbound} | ${status} ${pct}% |`);
        }
        lines.push("");

        // Summary
        const s = result.summary;
        lines.push("## Summary");
        lines.push("");
        lines.push(`**Overall Compliance: ${s.compliance}%**`);
        lines.push("");
        if (remainingViolations.length === 0 && fixedViolations.length === 0) {
          lines.push("No violations found.");
        } else {
          if (remainingViolations.length > 0) {
            const rc = remainingViolations.reduce(
              (acc, v: LintViolation) => {
                acc[v.severity] = (acc[v.severity] || 0) + 1;
                return acc;
              },
              {} as Record<string, number>,
            );
            lines.push(`Pending violations: ${remainingViolations.length}`);
            if (rc["CRITICAL"]) lines.push(`- CRITICAL: ${rc["CRITICAL"]}`);
            if (rc["HIGH"]) lines.push(`- HIGH: ${rc["HIGH"]}`);
            if (rc["MEDIUM"]) lines.push(`- MEDIUM: ${rc["MEDIUM"]}`);
            if (rc["LOW"]) lines.push(`- LOW: ${rc["LOW"]}`);
          } else if (fix) {
            lines.push("No pending violations — all fixable issues were resolved.");
          }
        }

        // Fixed violations (shown only in fix mode)
        if (fix && fixedViolations.length > 0) {
          lines.push("");
          lines.push("## Auto-Fixed");
          lines.push("");
          lines.push("| Node | Category | Property | Bound To |");
          lines.push("|------|----------|----------|----------|");
          for (const v of fixedViolations) {
            const esc = (str: string) => (str || "-").replace(/\|/g, "\\|");
            const boundTo = v.fixedWith ? esc(v.fixedWith) : esc(v.message);
            lines.push(
              `| ${esc(v.nodeName)} (${esc(v.nodeId)}) | ${esc(v.category)} | ${esc(v.property)} | ${boundTo} |`,
            );
          }
        }

        // Remaining violations list (grouped by severity)
        if (remainingViolations.length > 0) {
          lines.push("");
          lines.push(fix ? "## Pending Violations" : "## Violations");

          const severities: Array<"CRITICAL" | "HIGH" | "MEDIUM" | "LOW"> = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
          for (const sev of severities) {
            const sevViolations = remainingViolations.filter((v: LintViolation) => v.severity === sev);
            if (sevViolations.length === 0) continue;

            lines.push("");
            lines.push(`### ${sev} (${sevViolations.length})`);
            lines.push("");
            lines.push("| Node | Type | Category | Property | Message |");
            lines.push("|------|------|----------|----------|---------|");
            for (const v of sevViolations) {
              const esc = (str: string) => (str || "-").replace(/\|/g, "\\|");
              lines.push(
                `| ${esc(v.nodeName)} (${esc(v.nodeId)}) | ${esc(v.nodeType)} | ${esc(v.category)} | ${esc(v.property)} | ${esc(v.message)} |`,
              );
            }
          }
        }

        // Verdict (based on remaining violations only)
        lines.push("");
        if (remainingViolations.length === 0) {
          lines.push(
            fix && fixedViolations.length > 0
              ? `**Verdict: PASS** — All violations fixed (${fixedViolations.length} auto-fixed).`
              : "**Verdict: PASS** — All checks passed.",
          );
        } else {
          const hasCritical = remainingViolations.some((v: LintViolation) => v.severity === "CRITICAL");
          if (hasCritical) {
            lines.push("**Verdict: FAIL** — Critical violations must be resolved.");
          } else if (s.compliance >= 80) {
            lines.push("**Verdict: WARN** — Minor issues to address.");
          } else {
            lines.push("**Verdict: FAIL** — Significant compliance gaps.");
          }
        }

        if (result.violationsCapped) {
          lines.push("");
          lines.push("**Note:** Violations list was capped at 500 entries. Additional violations may exist.");
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error running lint_frame on node "${node_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Format design system result into markdown tables
  function formatDesignSystemMarkdown(result: GetDesignSystemResult): string {
    // Categorize variables
    const colorVars: DesignSystemVariable[] = [];
    const spacingVars: DesignSystemVariable[] = [];
    const radiusVars: DesignSystemVariable[] = [];
    const otherVars: DesignSystemVariable[] = [];

    for (const v of result.variables) {
      const name = v.name.toLowerCase();
      if (
        name.startsWith("space/") ||
        name.startsWith("spacing/")
      ) {
        spacingVars.push(v);
      } else if (
        name.startsWith("radius/")
      ) {
        radiusVars.push(v);
      } else if (v.resolvedType === "COLOR") {
        colorVars.push(v);
      } else {
        otherVars.push(v);
      }
    }

    const lines: string[] = [];
    lines.push("# Design System");
    lines.push("");

    // Pages
    lines.push("## Pages");
    lines.push("");
    if (result.pages.length === 0) {
      lines.push("No pages found.");
    } else {
      lines.push("| Page Name | ID |");
      lines.push("|-----------|-----|");
      for (const page of result.pages) {
        lines.push(`| ${sanitizeCell(page.name)} | ${page.id} |`);
      }
    }
    lines.push("");

    // Color Variables
    lines.push("## Color Variables");
    lines.push("");
    if (colorVars.length === 0) {
      lines.push("No color variables found.");
    } else {
      lines.push("| Variable Name | Tailwind Class | Value | Purpose | ID |");
      lines.push("|---------------|----------------|-------|---------|----|");
      for (const v of colorVars) {
        const tw = deriveTailwindClass(v.name, "color");
        const purpose = getTokenPurpose(v.name, v.description);
        const val = formatVariableDisplayValue(v.values);
        lines.push(`| ${sanitizeCell(v.name)} | ${tw} | ${sanitizeCell(val)} | ${sanitizeCell(purpose)} | ${v.id} |`);
      }
    }
    lines.push("");

    // Spacing Variables
    lines.push("## Spacing Variables");
    lines.push("");
    if (spacingVars.length === 0) {
      lines.push("No spacing variables found.");
    } else {
      lines.push("| Variable Name | Tailwind Class | Value | Purpose | ID |");
      lines.push("|---------------|----------------|-------|---------|----|");
      for (const v of spacingVars) {
        const tw = deriveTailwindClass(v.name, "spacing");
        const purpose = getTokenPurpose(v.name, v.description);
        const val = formatVariableDisplayValue(v.values);
        lines.push(`| ${sanitizeCell(v.name)} | ${tw} | ${sanitizeCell(val)} | ${sanitizeCell(purpose)} | ${v.id} |`);
      }
    }
    lines.push("");

    // Radius Variables
    lines.push("## Radius Variables");
    lines.push("");
    if (radiusVars.length === 0) {
      lines.push("No radius variables found.");
    } else {
      lines.push("| Variable Name | Tailwind Class | Value | Purpose | ID |");
      lines.push("|---------------|----------------|-------|---------|----|");
      for (const v of radiusVars) {
        const tw = deriveTailwindClass(v.name, "radius");
        const purpose = getTokenPurpose(v.name, v.description);
        const val = formatVariableDisplayValue(v.values);
        lines.push(`| ${sanitizeCell(v.name)} | ${tw} | ${sanitizeCell(val)} | ${sanitizeCell(purpose)} | ${v.id} |`);
      }
    }
    lines.push("");

    // Text Styles
    lines.push("## Text Styles");
    lines.push("");
    if (result.textStyles.length === 0) {
      lines.push("No text styles found.");
    } else {
      lines.push("| Style Name | Tailwind Class | Font | Size | Line Height | Purpose | ID |");
      lines.push("|------------|----------------|------|------|-------------|---------|----|");
      for (const ts of result.textStyles) {
        const tw = deriveTailwindClass(ts.name, "text");
        const font = ts.fontName ? `${ts.fontName.family} ${ts.fontName.style}` : "-";
        const lh = formatLineHeight(ts.lineHeight);
        const purpose = getTokenPurpose(ts.name);
        lines.push(`| ${sanitizeCell(ts.name)} | ${tw} | ${font} | ${ts.fontSize} | ${lh} | ${sanitizeCell(purpose)} | ${ts.id} |`);
      }
    }
    lines.push("");

    // Effect Styles
    lines.push("## Effect Styles");
    lines.push("");
    if (result.effectStyles.length === 0) {
      lines.push("No effect styles found.");
    } else {
      lines.push("| Style Name | Tailwind Class | Value | Purpose | ID |");
      lines.push("|------------|----------------|-------|---------|----|");
      for (const es of result.effectStyles) {
        const tw = deriveTailwindClass(es.name, "effect");
        const purpose = getTokenPurpose(es.name, es.description);
        const value = formatEffectValue(es.effects);
        lines.push(`| ${sanitizeCell(es.name)} | ${tw} | ${sanitizeCell(value)} | ${sanitizeCell(purpose)} | ${es.id} |`);
      }
    }
    lines.push("");

    // Other Variables (if any)
    if (otherVars.length > 0) {
      lines.push("## Other Variables");
      lines.push("");
      lines.push("| Variable Name | Type | Value | Purpose | ID |");
      lines.push("|---------------|------|-------|---------|----|");
      for (const v of otherVars) {
        const purpose = getTokenPurpose(v.name, v.description);
        const val = formatVariableDisplayValue(v.values);
        lines.push(`| ${sanitizeCell(v.name)} | ${v.resolvedType} | ${sanitizeCell(val)} | ${sanitizeCell(purpose)} | ${v.id} |`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  // Get Design System Tool
  server.tool(
    "get_design_system",
    "Aggregate all design system tokens (pages, color variables, spacing, radius, text styles, effect styles) from the active Figma file. Returns formatted markdown tables.",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma<GetDesignSystemResult>("get_design_system", {}, 60000);
        return {
          content: [{ type: "text", text: formatDesignSystemMarkdown(result) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting design system: ${error instanceof Error ? error.message : String(error)}`,
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
        const channelList = channels
          .map((ch) => `  - ${ch.channel} (${ch.fileName || "unknown file"})`)
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text: `Available channels:\n${channelList}`,
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
      scale: z.coerce.number().positive().optional().describe("Export scale"),
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
      scale: z.coerce.number().positive().min(0.01).max(4).optional().default(1).describe("Export scale (0.01 to 4)"),
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
        const apiUrl = `${FIGMA_API_BASE_URL}/images/${encodeURIComponent(resolvedFileKey)}?ids=${encodedNodeId}&format=${format}&scale=${scale}`;

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

  // Setup Design System Tool
  const rgbaColorSchema = z.object({
    r: z.coerce.number().min(0).max(1).describe("Red channel (0-1)"),
    g: z.coerce.number().min(0).max(1).describe("Green channel (0-1)"),
    b: z.coerce.number().min(0).max(1).describe("Blue channel (0-1)"),
    a: z.coerce.number().min(0).max(1).optional().describe("Alpha channel (0-1), defaults to 1"),
  });

  server.tool(
    "setup_design_system",
    "Create or update an entire design system in a single call. Accepts multiple variable collections, text styles, and effect styles. Idempotent — existing items with the same name are updated, not duplicated.",
    {
      pages: coerceArray(z.array(z.string())).optional().describe("Page names to ensure exist (default: ['Screens', 'Components', 'Draft']). If only 'Page 1' exists and is empty, it is renamed to the first page."),
      collections: coerceArray(z.array(z.object({
        name: z.string().describe("Collection name, e.g. 'Colors', 'Spacing', 'Radius'"),
        variables: z.array(z.object({
          name: z.string().describe("Variable name, e.g. 'background/primary' or 'space/md'"),
          type: z.enum(["COLOR", "FLOAT"]).describe("COLOR for colors, FLOAT for spacing/radius numbers"),
          value: z.union([rgbaColorSchema, z.coerce.number()]).describe("RGBA object for COLOR type, number for FLOAT type"),
          description: z.string().optional().describe("Token description/purpose"),
        })),
      }))).optional().describe("Variable collections to create/update, each with its own name and variables"),
      text_styles: coerceArray(z.array(z.object({
        name: z.string().describe("Style name, e.g. 'text/display/lg'"),
        font_family: z.string().describe("Font family, e.g. 'Manrope'"),
        font_style: z.string().describe("Font style, e.g. 'Bold', 'SemiBold', 'Regular'"),
        font_size: z.coerce.number().describe("Font size in pixels"),
        line_height: z.object({
          value: z.coerce.number(),
          unit: z.enum(["PIXELS", "PERCENT", "AUTO"]),
        }).optional().describe("Line height specification"),
        letter_spacing: z.object({
          value: z.coerce.number(),
          unit: z.enum(["PIXELS", "PERCENT"]),
        }).optional().describe("Letter spacing specification"),
        description: z.string().optional().describe("Style description/purpose"),
      }))).optional().describe("Text styles to create/update"),
      effect_styles: coerceArray(z.array(z.object({
        name: z.string().describe("Effect style name, e.g. 'shadow/subtle'"),
        effects: z.array(z.object({
          type: z.enum(["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR"]).describe("Effect type"),
          color: rgbaColorSchema.optional().describe("Effect color (for shadows)"),
          offset: z.object({ x: z.coerce.number(), y: z.coerce.number() }).optional().describe("Shadow offset (for shadows)"),
          radius: z.coerce.number().optional().describe("Blur radius"),
          spread: z.coerce.number().optional().describe("Spread (for shadows)"),
        })).describe("Array of effects for this style"),
        description: z.string().optional().describe("Effect style description/purpose"),
      }))).optional().describe("Effect styles to create/update"),
    },
    async ({ pages, collections, text_styles, effect_styles }) => {
      try {
        const params: Record<string, unknown> = {};
        if (pages) params.pages = pages;
        if (collections) params.collections = collections;
        if (text_styles) {
          params.textStyles = text_styles.map((ts) => ({
            name: ts.name,
            fontFamily: ts.font_family,
            fontStyle: ts.font_style,
            fontSize: ts.font_size,
            lineHeight: ts.line_height,
            letterSpacing: ts.letter_spacing,
            description: ts.description,
          }));
        }
        if (effect_styles) {
          params.effectStyles = effect_styles;
        }

        const setupResult = await sendCommandToFigma<SetupDesignSystemResult>(
          "setup_design_system",
          params,
          120000,
        );

        // Collect setup errors
        const errorLines: string[] = [];
        const sections = [
          { label: "Variables", data: setupResult.variables },
          { label: "Text Styles", data: setupResult.textStyles },
          { label: "Effect Styles", data: setupResult.effectStyles },
        ];

        for (const section of sections) {
          const d = section.data;
          if (d.failed > 0 && d.errors) {
            for (const err of d.errors) {
              errorLines.push(`- **${section.label}** — ${err.name}: ${err.error}`);
            }
          }
        }

        // Fetch the current design system state
        const dsResult = await sendCommandToFigma<GetDesignSystemResult>("get_design_system", {}, 60000);
        const dsMarkdown = formatDesignSystemMarkdown(dsResult);

        // Prepend errors if any
        const lines: string[] = [];
        if (errorLines.length > 0) {
          lines.push("## Setup Errors");
          lines.push("");
          lines.push(...errorLines);
          lines.push("");
        }
        lines.push(dsMarkdown);

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting up design system: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}
