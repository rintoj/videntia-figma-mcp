import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma, joinChannel, getOpenChannels } from "../utils/websocket.js";
import { coerceArray } from "../utils/coerce-array.js";
import { mcpBooleanSchema } from "../utils/mcp-boolean.js";
import {
  outputFormatSchema,
  depthSchema,
  resolveDepth,
  fetchNodesAsJsx,
  fieldsSchema,
  ID_FIELDS,
  nodeOutputFormatSchema,
  nodeFormatAliasSchema,
  compactDefaultOutputFormatSchema,
  COMPACT_DEFAULT_NOTICE,
  cursorSchema,
  paginate,
  pageNotice,
} from "../utils/output-format.js";
import { convertToJsx } from "../utils/figma-to-jsx.js";
import { formatCompact, formatSummary, extractGeometry, violationId } from "../utils/compact-node.js";
import { filterNodeData, normalizeNodeId } from "../utils/figma-helpers.js";
import { normalizeCommandParams } from "../utils/command-params.js";
import { recordLintRun, getLintRun } from "../utils/lint-runs.js";
import { postProcessExport, writeExportToPath, resolveExportDestination } from "../utils/export-image-post.js";
import { exportCacheKey, getCachedExport, setCachedExport, approximateImageTokens } from "../utils/export-cache.js";
import { ColorInputSchema, colorParam, toRgba } from "../utils/color-input.js";
import type {
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
  return effects
    .map((e) => {
      const type =
        e.type === "DROP_SHADOW"
          ? "drop-shadow"
          : e.type === "INNER_SHADOW"
            ? "inner-shadow"
            : e.type === "LAYER_BLUR"
              ? "blur"
              : e.type === "BACKGROUND_BLUR"
                ? "bg-blur"
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
    })
    .join(", ");
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
  // Set Focus Tool
  server.tool(
    "set_focus",
    "Set focus on a specific node in Figma by selecting it and scrolling viewport to it",
    {
      nodeId: z.string().describe("The ID of the node to focus on"),
    },
    async ({ nodeId }) => {
      nodeId = normalizeNodeId(nodeId);
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
      nodeIds = nodeIds.map(normalizeNodeId);
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
      includeCategories: mcpBooleanSchema.optional().default(true).describe("Whether to include category information"),
    },
    async ({ nodeId, includeCategories }) => {
      nodeId = normalizeNodeId(nodeId);
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
          `Found ${annotations.length} annotation(s) on node "${(result as any).nodeName || (result as any).nodeId || nodeId}"`,
          "",
          "| Index | Label | Category |",
          "|-------|-------|----------|",
        ];
        for (const a of annotations) {
          const label = truncate(((a as any).labelMarkdown || (a as any).label || "-").replace(/\n/g, " "), 60);
          const cat = (a as any).category?.label || (a as any).categoryId || "-";
          lines.push(`| ${(a as any).index ?? "-"} | ${label} | ${cat} |`);
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
      nodeId = normalizeNodeId(nodeId);
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
      nodeId = normalizeNodeId(nodeId);
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
        .enum(["blue", "green", "yellow", "orange", "red", "purple", "gray", "teal", "pink", "violet"])
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
        .enum(["blue", "green", "yellow", "orange", "red", "purple", "gray", "teal", "pink", "violet"])
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

  // Get Comments Tool
  server.tool(
    "get_comments",
    "Get all comments in the current Figma file. Returns comment text, author, creation time, replies, and canvas position. Unresolved comments are returned by default.",
    {
      includeResolved: mcpBooleanSchema
        .optional()
        .default(false)
        .describe("Whether to include resolved comments (default: false)"),
    },
    async ({ includeResolved }) => {
      try {
        const result = await sendCommandToFigma<{
          success: boolean;
          count: number;
          totalComments: number;
          includeResolved: boolean;
          comments: Array<{
            id: string;
            message: string;
            author: { id: string; name: string };
            createdAt: string;
            editedAt: string | null;
            resolved: boolean;
            resolvedAt: string | null;
            position?: Record<string, unknown>;
            reactions?: Array<{ emoji: string; user: { id: string; name: string } | null; createdAt: string | null }>;
            replies?: Array<{
              id: string;
              message: string;
              author: { id: string; name: string } | null;
              createdAt: string | null;
              editedAt: string | null;
            }>;
          }>;
        }>("get_comments", { includeResolved });

        const comments = result.comments || [];

        if (comments.length === 0) {
          const scope = includeResolved ? "the file" : "the file (unresolved only)";
          return { content: [{ type: "text", text: `No comments found in ${scope}.` }] };
        }

        const lines: string[] = [
          `Found ${comments.length} comment(s)${result.totalComments !== result.count ? ` (${result.totalComments} total)` : ""}`,
          "",
        ];

        const escapeMd = (s: string): string => s.replace(/[\\`*_{}\[\]()#+\-.!|>~]/g, "\\$&");
        const inlineMessage = (s: string): string => escapeMd(s).replace(/\r?\n/g, " ");

        for (const c of comments) {
          lines.push(`### ${c.resolved ? "[Resolved] " : ""}Comment ${c.id}`);
          lines.push(`**Author:** ${escapeMd(c.author.name)}`);
          lines.push(`**Created:** ${c.createdAt}${c.editedAt ? ` (edited ${c.editedAt})` : ""}`);
          if (c.position) {
            const pos = c.position as Record<string, unknown>;
            if (pos["type"] === "canvas") {
              lines.push(`**Position:** canvas (${pos["x"]}, ${pos["y"]})`);
            } else if (pos["type"] === "frame") {
              const offset = pos["offset"] as Record<string, unknown> | undefined;
              lines.push(`**Position:** frame ${pos["nodeId"]}${offset ? ` at (${offset["x"]}, ${offset["y"]})` : ""}`);
            }
          }
          lines.push(`**Message:** ${inlineMessage(c.message)}`);
          if (c.reactions && c.reactions.length > 0) {
            const emojiSummary = c.reactions.map((r) => r.emoji).join(" ");
            lines.push(`**Reactions:** ${emojiSummary}`);
          }
          if (c.replies && c.replies.length > 0) {
            lines.push(`**Replies (${c.replies.length}):**`);
            for (const r of c.replies) {
              const replyAuthor = r.author?.name ? escapeMd(r.author.name) : "Unknown";
              lines.push(`  - ${replyAuthor}: ${inlineMessage(r.message)}`);
            }
          }
          lines.push("");
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting comments: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Scan Nodes By Types Tool
  server.tool(
    "scan_nodes_by_types",
    "Find all descendant nodes of specific types inside a parent node. Use when you have a parent nodeId and want all children matching certain types (e.g. all TEXT or FRAME nodes). Does not match by name — use search_nodes for name-based lookup. Returns JSX+Tailwind markup (default) or JSON.",
    {
      nodeId: z.string().describe("ID of the node to scan"),
      types: coerceArray(z.array(z.string())).describe("Array of node types (e.g. ['COMPONENT', 'FRAME'])"),
      limit: z.coerce.number().int().min(1).optional().describe("Max number of results to return. Default: 50."),
      fields: coerceArray(fieldsSchema)
        .optional()
        .describe("Optional array of fields to include. Controls which properties appear in both JSX and JSON output."),
      topLevelOnly: mcpBooleanSchema
        .optional()
        .describe(
          "When true, only DIRECT children of nodeId are considered (no recursion into descendants). Default: false (full subtree scan).",
        ),
      depth: depthSchema,
      output_format: nodeOutputFormatSchema,
      format: nodeFormatAliasSchema,
      cursor: cursorSchema,
    },
    async ({ nodeId, types, limit, fields, depth, output_format, format, topLevelOnly, cursor }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const result: any = await sendCommandToFigma("scan_nodes_by_types", {
          nodeId,
          types,
          limit,
          topLevelOnly: topLevelOnly === true,
          depth: resolveDepth(depth),
        });
        const returned = (result?.nodes ?? []).length;
        const totalFound = typeof result?.totalFound === "number" ? result.totalFound : returned;
        const truncated = result?.truncated === true || totalFound > returned;
        const prefix = [
          `scan_nodes_by_types: ${returned} of ${totalFound} matching node(s) returned` +
            (topLevelOnly === true ? " (topLevelOnly: direct children only)" : " (full subtree)") +
            `; truncated: ${truncated}`,
        ];
        if (truncated) {
          prefix.push(
            `WARNING: results are INCOMPLETE — ${totalFound - returned} match(es) omitted by limit=${result?.limit ?? limit ?? 50}. Do NOT treat this as a full sweep; raise \`limit\` to see the rest.`,
          );
        }
        const page = paginate(result?.nodes ?? [], cursor, limit ?? 50);
        prefix.push(pageNotice("scan_nodes_by_types page", page));
        return formatNodeResult({ ...(result ?? {}), nodes: page.items }, format ?? output_format, fields, prefix);
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

  /**
   * Strip ID fields from a node unless explicitly requested via fields.
   * Also simplifies bindings from { id, name } to just the name string.
   */
  function stripIdFields(node: any, fields?: string[]): any {
    const requestedIds = new Set((fields ?? []).filter((f) => (ID_FIELDS as readonly string[]).includes(f)));
    const result = { ...node };

    // Strip ID fields not explicitly requested
    for (const idField of ID_FIELDS) {
      if (idField === "bindingIds") continue; // handled below
      if (!requestedIds.has(idField)) {
        delete result[idField];
      }
    }

    // Simplify bindings: { id, name } → name (unless bindingIds requested)
    if (result.bindings && typeof result.bindings === "object") {
      if (requestedIds.has("bindingIds")) {
        // Keep full { id, name } objects
      } else {
        const simplified: Record<string, string> = {};
        for (const [key, val] of Object.entries(result.bindings)) {
          simplified[key] = (val as any)?.name ?? val;
        }
        result.bindings = simplified;
      }
    }

    // Recurse into children
    if (Array.isArray(result.children)) {
      result.children = result.children.map((c: any) => stripIdFields(c, fields));
    }

    return result;
  }

  /**
   * Shared handler: extracts selection from plugin result, applies fields/format.
   * All node-reading tools delegate here after calling the plugin.
   */
  function formatNodeResult(
    result: unknown,
    output_format: "jsx" | "json" | "compact",
    fields?: string[],
    prefixLines?: string[],
  ): { content: Array<{ type: "text"; text: string }> } {
    const selection: any[] = (result as any)?.nodes ?? [];
    const processed = selection
      .map((n: any) => stripIdFields(n, fields))
      .map((n: any) => filterNodeData(n, fields as any));
    const prefix = prefixLines && prefixLines.length > 0 ? `${prefixLines.join("\n")}\n` : "";
    if (processed.length === 0) {
      const empty =
        output_format === "jsx" ? "<!-- No nodes found -->" : output_format === "compact" ? "" : JSON.stringify([]);
      return { content: [{ type: "text", text: `${prefix}${empty}` }] };
    }
    if (output_format === "jsx") {
      return { content: [{ type: "text", text: `${prefix}${convertToJsx(processed)}` }] };
    }
    if (output_format === "compact") {
      return { content: [{ type: "text", text: `${prefix}${formatCompact(processed)}` }] };
    }
    return { content: [{ type: "text", text: `${prefix}${JSON.stringify(processed)}` }] };
  }

  // Selection Tool
  server.tool(
    "get_selection",
    "Get info on the currently selected node(s) in Figma. Use when you need to inspect or act on whatever the user has selected. Requires at least one non-page node to be selected. Returns JSX+Tailwind markup (default) or JSON.",
    {
      fields: coerceArray(fieldsSchema)
        .optional()
        .describe("Optional array of fields to include. Controls which properties appear in both JSX and JSON output."),
      depth: depthSchema,
      output_format: outputFormatSchema,
    },
    async ({ fields, depth, output_format }) => {
      try {
        const result = await sendCommandToFigma("get_selection", { depth: resolveDepth(depth) });
        return formatNodeResult(result, output_format, fields);
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
    "Get detailed info for a single node by its ID. Use when you already have a specific node ID and need its properties, layout, styles, or children. Returns JSX+Tailwind markup (default) or JSON.",
    {
      nodeId: z.string().describe("The ID of the node to get information about"),
      fields: coerceArray(fieldsSchema)
        .optional()
        .describe("Optional array of fields to include. Controls which properties appear in both JSX and JSON output."),
      depth: depthSchema,
      output_format: nodeOutputFormatSchema,
      format: nodeFormatAliasSchema,
    },
    async ({ nodeId, fields, depth, output_format, format }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const result = await sendCommandToFigma("get_node_info", { nodeIds: [nodeId], depth: resolveDepth(depth) });
        return formatNodeResult(result, format ?? output_format, fields);
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
    "Get detailed info for multiple nodes at once. Same as get_node_info but accepts an array of IDs — use this instead of calling get_node_info repeatedly. Returns JSX+Tailwind markup (default) or JSON.",
    {
      nodeIds: coerceArray(z.array(z.string())).describe("Array of node IDs to get information about"),
      fields: coerceArray(fieldsSchema)
        .optional()
        .describe("Optional array of fields to include. Controls which properties appear in both JSX and JSON output."),
      depth: depthSchema,
      output_format: compactDefaultOutputFormatSchema,
      format: nodeFormatAliasSchema,
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Max number of nodes to return in this page. Default: 25. Remaining nodes are PAGED, not dropped."),
      cursor: cursorSchema,
    },
    async ({ nodeIds, fields, depth, output_format, format, limit, cursor }) => {
      nodeIds = nodeIds.map(normalizeNodeId);
      try {
        const page = paginate(nodeIds, cursor, limit ?? 25);
        const result = await sendCommandToFigma("get_node_info", {
          nodeIds: page.items,
          depth: resolveDepth(depth),
        });
        const effective = format ?? output_format;
        const prefix = [pageNotice("get_nodes_info", page)];
        if (effective === "compact") prefix.push(COMPACT_DEFAULT_NOTICE);
        return formatNodeResult(result, effective, fields, prefix);
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

  // Measure Node Tool — geometry only, no styles, no JSX
  server.tool(
    "measure_node",
    "Get ONLY the geometry of one or more nodes: x, y, width, height, rotation and absoluteBoundingBox. Use this instead of get_node_info whenever you just need coordinates or sizes — it returns a fraction of the tokens. Optionally include child geometry via include_children/depth.",
    {
      nodeId: z
        .union([z.string(), coerceArray(z.array(z.string()))])
        .describe("Node ID (or array of node IDs) to measure"),
      include_children: mcpBooleanSchema
        .optional()
        .describe("Include geometry for descendant nodes as well. Default: false."),
      depth: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe("How many levels of children to include when include_children is true. Default: 1."),
      output_format: z
        .enum(["json", "compact"])
        .optional()
        .default("json")
        .describe('Output format: "json" (default) or "compact" (one line per node).'),
    },
    async ({ nodeId, include_children, depth, output_format }) => {
      const nodeIds = (Array.isArray(nodeId) ? nodeId : [nodeId]).map(normalizeNodeId);
      const includeChildren = include_children === true;
      const childDepth = includeChildren ? (depth ?? 1) : 0;
      try {
        const result: any = await sendCommandToFigma("get_node_info", { nodeIds, depth: childDepth });
        const nodes: any[] = result?.nodes ?? [];
        const geometry = nodes.map((n) => extractGeometry(n, includeChildren, childDepth));
        if (output_format === "compact") {
          const lines: string[] = [];
          const walk = (list: any[], indent: number) => {
            for (const g of list) {
              lines.push(
                `${"  ".repeat(indent)}${g.name} [${g.type}] ${g.id} ${g.x ?? "-"},${g.y ?? "-"} ${g.width ?? "-"}x${g.height ?? "-"}${g.rotation ? ` rot=${g.rotation}` : ""}`,
              );
              if (Array.isArray(g.children)) walk(g.children, indent + 1);
            }
          };
          walk(geometry, 0);
          return { content: [{ type: "text" as const, text: lines.join("\n") || "No nodes found" }] };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(geometry) }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error measuring node(s) "${nodeIds.join(", ")}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Node Summary Tool — one line per node
  server.tool(
    "get_node_summary",
    "Get a one-line-per-node summary: name, type, id, child count and key styles (layout, fill, stroke, radius, text style). Use this to orient inside a frame before drilling in with get_node_info — it is far cheaper than full node info.",
    {
      nodeId: z
        .union([z.string(), coerceArray(z.array(z.string()))])
        .describe("Node ID (or array of node IDs) to summarize"),
      include_children: mcpBooleanSchema
        .optional()
        .describe("Also summarize the direct children of each node. Default: false."),
    },
    async ({ nodeId, include_children }) => {
      const nodeIds = (Array.isArray(nodeId) ? nodeId : [nodeId]).map(normalizeNodeId);
      const includeChildren = include_children === true;
      try {
        const result: any = await sendCommandToFigma("get_node_info", { nodeIds, depth: includeChildren ? 1 : 0 });
        const nodes: any[] = result?.nodes ?? [];
        const lines: string[] = [];
        for (const n of nodes) {
          lines.push(formatSummary([n]));
          if (includeChildren && Array.isArray(n.children)) {
            for (const c of n.children) lines.push(`  ${formatSummary([c])}`);
          }
        }
        return { content: [{ type: "text" as const, text: lines.filter(Boolean).join("\n") || "No nodes found" }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error summarizing node(s) "${nodeIds.join(", ")}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Search Nodes Tool
  server.tool(
    "search_nodes",
    "Search the entire document (or a subtree via nodeId) for nodes by name substring or exact ID. Optionally filter by type. Use when you need to find a node by name (e.g. 'Header') or search broadly. For type-only filtering within a known parent, use scan_nodes_by_types instead. Returns JSX+Tailwind markup (default) or JSON.",
    {
      query: z
        .union([z.string(), z.array(z.string())])
        .describe(
          "Search query (string or array of strings) matched case-insensitively against node name (substring) or exact node ID. Pass an array to search for multiple terms in one call.",
        ),
      types: coerceArray(z.array(z.string()))
        .optional()
        .describe(
          "Optional node type filter. Only return nodes of these types e.g. ['FRAME', 'COMPONENT', 'TEXT']. Omit to match all types.",
        ),
      nodeId: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          "Optional node ID (or array of IDs) to scope the search to. When an array is passed, each ID is searched independently and results are grouped by ID. Defaults to the entire current page.",
        ),
      limit: z.coerce.number().int().min(1).optional().describe("Max number of results to return. Default: 50."),
      depth: depthSchema,
      leadingTrim: coerceArray(z.array(z.string()))
        .optional()
        .describe(
          "Optional filter for TEXT nodes by leadingTrim value(s) e.g. ['CAP_HEIGHT'] or ['NONE']. Pass empty query \"\" to match all text nodes with the given leadingTrim.",
        ),
      fields: coerceArray(fieldsSchema)
        .optional()
        .describe("Optional array of fields to include. Controls which properties appear in both JSX and JSON output."),
      output_format: compactDefaultOutputFormatSchema,
      format: nodeFormatAliasSchema,
      cursor: cursorSchema,
    },
    async ({ query, types, nodeId, limit, depth, leadingTrim, fields, output_format, format, cursor }) => {
      if (nodeId) nodeId = Array.isArray(nodeId) ? nodeId.map(normalizeNodeId) : normalizeNodeId(nodeId);
      try {
        const pageSize = limit ?? 50;
        const result: any = await sendCommandToFigma("search_nodes", {
          query,
          types,
          nodeId,
          limit,
          depth: resolveDepth(depth),
          leadingTrim,
        });
        const allNodes: any[] = result?.nodes ?? [];
        const page = paginate(allNodes, cursor, pageSize);
        const effective = format ?? output_format;
        const prefix = [pageNotice("search_nodes", page)];
        if (effective === "compact") prefix.push(COMPACT_DEFAULT_NOTICE);
        return formatNodeResult({ ...result, nodes: page.items }, effective, fields, prefix);
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error searching nodes for "${query}": ${error instanceof Error ? error.message : String(error)}`,
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
    'Get all local components from the Figma document. Returns JSX+Tailwind markup. WARNING: like other tools using `depth`, this defaults to depth=1 (direct children only) — nodes nested deeper (e.g. an icon\'s fill color three levels down) are silently omitted with no truncation notice. Pass depth: "all" when you need the full subtree, e.g. to audit every color/style actually used inside a component.',
    {
      depth: depthSchema,
      output_format: outputFormatSchema,
    },
    async ({ depth, output_format }) => {
      try {
        const result = await sendCommandToFigma("get_local_components");
        const components = Array.isArray(result) ? result : ((result as any)?.components ?? []);

        if (output_format === "jsx" && components.length > 0) {
          const ids = components.map((c: any) => c.id);
          const jsx = await fetchNodesAsJsx(ids, resolveDepth(depth));
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

  // Lint Frame Tool
  server.tool(
    "lint_frame",
    "Run a comprehensive compliance audit on a frame (or any node with children). Checks color tokens, spacing tokens, border radius tokens, text styles, effect styles, auto-layout compliance, child overflow, clipped content, and screen naming conventions in a single traversal. Clipped content (rule clipped-content, HIGH): inside any clipsContent=true frame/component/instance, each descendant's render extent (bounds + DROP_SHADOW offset±(radius+spread), LAYER_BLUR radius, OUTSIDE/CENTER strokes) must stay within the clipping bounds — reports the node, the clipping ancestor, sides and px, and cause (effect vs bounds); fix with set_clips_content {nodeId: ancestor, clipsContent: false} or padding ≥ the overflow. Image crops (IMAGE fill / Image/ layers) and bounds overflow under screen-level clips (linted root, page/section children, Screen/ frames — scrolling content) are not reported. No double reporting: while clippedContent is on, children of a non-screen clipping container are owned by clipped-content, not overflow (CRITICAL overflow still covers non-clipping parents); image layers are exempt from both. Paints inside component instances that are inherited from the main component are not re-reported per instance — only overridden fills/strokes are checked, and the main component is reported once when it is in the linted subtree. Every violation carries a stable rule id: root-frame-width-fixed, root-frame-device-width, root-frame-height-hug, root-frame-min-height, screen-naming, missing-text-style, mixed-text-style, font-variable-binding, hardcoded-color, gradient-without-style, invisible-paint, unbound-spacing, unbound-radius, missing-effect-style, no-auto-layout, absolute-in-auto-layout, overflow, clipped-content. Suppress intentional exceptions (carousels, cover crops, brand logos, diagram canvases, gradient scrims) with ignoreNodeIds / ignoreRules, or persistently in the file with set_lint_ignore (or a [lint-ignore] / [lint-ignore:rule1,rule2] token in the layer name); suppression applies to the node's whole subtree. Suppressed items are excluded from category totals and compliance and reported as suppressed counts by rule. Returns a structured report with violations by severity (CRITICAL/HIGH/MEDIUM/LOW) and compliance percentages per category. Pass fix=true to auto-fix deterministic violations (root frame sizing: layoutSizingHorizontal→FIXED, layoutSizingVertical→HUG, minHeight→device standard) and report only the remaining issues.",
    {
      nodeId: z.string().describe("The ID of the root node to lint"),
      ignoreNodeIds: coerceArray(z.array(z.string()))
        .optional()
        .describe(
          "Node IDs to suppress, together with their whole subtree (accepts 1:2 or 1-2). Use for intentional exceptions such as carousels, cover crops or brand logos.",
        ),
      ignoreRules: coerceArray(z.array(z.string()))
        .optional()
        .describe(
          "Rule ids (e.g. overflow, clipped-content, hardcoded-color) and/or category names (e.g. backgroundFills, autoLayout) to suppress across the whole scan.",
        ),
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
          colors: mcpBooleanSchema.optional().describe("Check fill/stroke color bindings (default: true)"),
          spacing: mcpBooleanSchema.optional().describe("Check padding/itemSpacing bindings (default: true)"),
          radius: mcpBooleanSchema.optional().describe("Check cornerRadius bindings (default: true)"),
          textStyles: mcpBooleanSchema.optional().describe("Check text style application (default: true)"),
          effectStyles: mcpBooleanSchema.optional().describe("Check effect style application (default: true)"),
          autoLayout: mcpBooleanSchema.optional().describe("Check auto-layout on frames (default: true)"),
          overflow: mcpBooleanSchema.optional().describe("Check child overflow beyond parent bounds (default: true)"),
          clippedContent: mcpBooleanSchema
            .optional()
            .describe(
              "Check for shadows/blurs/outside strokes/children cropped by a clipsContent=true ancestor (default: true)",
            ),
          screenNaming: mcpBooleanSchema
            .optional()
            .describe(
              "Check screen naming convention: Screen/{Feature}@{Breakpoint}/{View}[/{State}] on any frame starting with 'Screen/' (default: true)",
            ),
          clippedCorners: mcpBooleanSchema
            .optional()
            .describe(
              "Check for clipping children whose square background paints over a rounded parent's corners (default: true)",
            ),
          radiusProportion: mcpBooleanSchema
            .optional()
            .describe(
              "Check for a cornerRadius disproportionate to node height (lens-shaped, but not a deliberate capsule) (default: true)",
            ),
          crossAxisAlign: mcpBooleanSchema
            .optional()
            .describe(
              "Check for counterAxisAlignItems=MIN on a container with a fixed cross-axis size (default: true)",
            ),
          iconColorConsistency: mcpBooleanSchema
            .optional()
            .describe("Check for icons where only some vector parts have a bound colour (default: true)"),
          fixedWidthSlack: mcpBooleanSchema
            .optional()
            .describe("Check for small fixed-width packed rows carrying dead horizontal space (default: true)"),
        })
        .optional()
        .describe("Toggle individual check categories (all enabled by default)"),
      summary_only: mcpBooleanSchema
        .optional()
        .describe(
          "When true, return ONLY the per-category compliance scores and severity counts — no individual violation rows. Use for a quick pass/fail check before pulling the full report.",
        ),
      max_violations: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Max individual violation rows to print. Default: 25. Remaining rows are counted and reported, never silently dropped — pass 0 for no cap.",
        ),
      since_run: z
        .string()
        .optional()
        .describe(
          'Delta mode. Pass "last" (or a run_id from an earlier lint_frame response for this node) to list ONLY violations that are new since that run. Unchanged and resolved violations are reported as counts, not rows.',
        ),
      ignore_rules: z
        .array(z.string())
        .optional()
        .describe(
          'Deliberate, documented exceptions to excuse for this run — brand gradients, logo artwork, an intentionally filled icon. Accepts category names ("backgroundFills"), check names ("colors"), "category:property" pairs ("backgroundFills:fills[0]") or "*". Suppressed violations are removed from the verdict but reported separately so the exception stays visible. A per-node alternative also exists: set plugin data "lint.ignore" on a node, or suffix its name with "[lint-ignore: backgroundFills]" / "[role: artwork]" — both are inherited by descendants, and role=artwork exempts bespoke artwork from every token-binding rule.',
        ),
    },
    async ({
      nodeId,
      fix,
      checks,
      ignoreNodeIds,
      ignoreRules,
      summary_only,
      ignore_rules,
      max_violations,
      since_run,
    }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const payload = normalizeCommandParams("lint_frame", { nodeId, fix, checks, ignoreNodeIds, ignoreRules });
        const result = await sendCommandToFigma<LintFrameResult>("lint_frame", { ...payload, ignore_rules }, 60000);

        // Attach a stable id to every violation so repeat runs can be diffed.
        // Derived from nodeId + category + rule/property (+ severity) — deterministic,
        // independent of traversal order or run time.
        const violations: LintViolation[] = (result.violations ?? []).map((v: LintViolation) => ({
          ...v,
          id: (v as any).id ?? violationId([v.nodeId, v.category, v.property, v.severity]),
        }));
        result.violations = violations;

        // Partition violations into fixed vs remaining (only meaningful when fix=true)
        const fixedViolations = violations.filter((v: LintViolation) => v.fixed === true);
        const allRemaining = violations.filter((v: LintViolation) => v.fixed !== true);

        // --- Delta mode -------------------------------------------------
        // The same ~18 pre-existing violations were re-emitted on every one of
        // 136 measured calls. With `since_run`, only NEW violations get rows;
        // unchanged/resolved are reported as numbers.
        const currentIds = new Set(allRemaining.map((v) => String((v as any).id)));
        const previous = since_run ? getLintRun(nodeId, since_run) : undefined;
        let delta: { newCount: number; unchanged: number; resolved: number } | undefined;
        let remainingViolations = allRemaining;
        if (since_run) {
          if (!previous) {
            delta = undefined;
          } else {
            remainingViolations = allRemaining.filter((v) => !previous.ids.has(String((v as any).id)));
            let unchanged = 0;
            for (const id of previous.ids) if (currentIds.has(id)) unchanged++;
            delta = {
              newCount: remainingViolations.length,
              unchanged,
              resolved: previous.ids.size - unchanged,
            };
          }
        }
        const runId = recordLintRun(nodeId, currentIds);

        // Format as markdown compliance report
        const lines: string[] = [];

        const modeLabel = fix ? " (fix mode)" : "";
        lines.push(`# Compliance Audit: ${result.nodeName}${modeLabel}`);
        lines.push(`**Node:** ${result.nodeId} (${result.nodeType}) | **Nodes scanned:** ${result.totalNodes}`);
        lines.push(`**run_id:** ${runId} (pass since_run:"last" next time for a delta report)`);
        if (since_run && !previous) {
          lines.push(
            `**Delta unavailable:** no recorded run matching since_run="${since_run}" for this node in this session — showing the FULL report instead.`,
          );
        } else if (delta) {
          lines.push(
            `**Delta vs previous run:** ${delta.newCount} new, ${delta.unchanged} unchanged, ${delta.resolved} resolved. ` +
              `Only the ${delta.newCount} NEW violation(s) are listed below — the ${delta.unchanged} unchanged one(s) are NOT shown. Re-run without since_run for the complete list.`,
          );
        }
        if (fix && fixedViolations.length > 0) {
          lines.push(`**Auto-fixed:** ${fixedViolations.length} violation${fixedViolations.length !== 1 ? "s" : ""}`);
        }
        const suppressedViolations = result.suppressedViolations ?? [];
        if (suppressedViolations.length > 0) {
          lines.push(
            `**Suppressed:** ${suppressedViolations.length} (accepted exceptions — excluded from the verdict, listed at the end)`,
          );
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
          { key: "clippedContent", label: "Clipped Content" },
          { key: "screenNaming", label: "Screen Naming" },
        ];

        for (const { key, label } of catLabels) {
          const cat = result.categories[key];
          if (!cat) continue;
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
        if (result.suppressed && result.suppressed.total > 0) {
          const byRule = Object.entries(result.suppressed.byRule)
            .sort((a, b) => b[1] - a[1])
            .map(([rule, count]) => `${rule}: ${count}`)
            .join(", ");
          lines.push(`Suppressed (excluded from compliance): ${result.suppressed.total} — ${byRule}`);
          lines.push("");
        }
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

        if (summary_only === true) {
          lines.push("");
          lines.push(
            `Violation rows omitted (summary_only). Pending: ${remainingViolations.length}, fixed: ${fixedViolations.length}. Re-run without summary_only for details.`,
          );
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
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
          const rowCap = max_violations ?? 25;
          let rowsPrinted = 0;
          for (const sev of severities) {
            const sevViolations = remainingViolations.filter((v: LintViolation) => v.severity === sev);
            if (sevViolations.length === 0) continue;
            if (rowCap > 0 && rowsPrinted >= rowCap) break;

            lines.push("");
            lines.push(`### ${sev} (${sevViolations.length})`);
            lines.push("");
            lines.push("| ID | Node | Type | Rule | Category | Property | Message |");
            lines.push("|----|------|------|------|----------|----------|---------|");
            for (const v of sevViolations) {
              if (rowCap > 0 && rowsPrinted >= rowCap) break;
              const esc = (str: string | undefined) => (str || "-").replace(/\|/g, "\\|");
              lines.push(
                `| ${esc((v as any).id)} | ${esc(v.nodeName)} (${esc(v.nodeId)}) | ${esc(v.nodeType)} | ${esc(v.rule)} | ${esc(v.category)} | ${esc(v.property)} | ${esc(v.message)} |`,
              );
              rowsPrinted++;
            }
          }
          const rowsOmitted = remainingViolations.length - rowsPrinted;
          if (rowsOmitted > 0) {
            lines.push("");
            lines.push(
              `_${rowsOmitted} further violation row(s) OMITTED by the default cap of ${rowCap}. This list is INCOMPLETE — re-run with max_violations:0 for every row, or summary_only:true for counts alone._`,
            );
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

        // Accepted exceptions stay visible — they are excluded from the
        // verdict, not hidden, so a stale suppression can still be spotted.
        if (!summary_only && suppressedViolations.length > 0) {
          lines.push("");
          lines.push(`## Suppressed (${suppressedViolations.length}) — not counted in the verdict`);
          lines.push("");
          lines.push("| Node | Property | Rule | Suppressed by |");
          lines.push("|------|----------|------|---------------|");
          for (const v of suppressedViolations.slice(0, 100)) {
            lines.push(
              `| ${v.nodeName} (${v.nodeId}) | ${v.property} | ${v.category} | ${(v as LintViolation & { suppressedBy?: string }).suppressedBy ?? "—"} |`,
            );
          }
          if (suppressedViolations.length > 100) {
            lines.push(`\n_${suppressedViolations.length - 100} more suppressed entries not shown._`);
          }
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error running lint_frame on node "${nodeId}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "set_lint_ignore",
    'Persistently mark a node as an intentional lint exception, stored in the Figma file (shared plugin data videntia/lint-ignore) so every future lint_frame run honors it for the node and its whole subtree. Use for deliberate carousels, cover crops, brand logos, diagram canvases or gradient scrims instead of "fixing" them. rules: "*" (default) ignores every rule; an array limits it to rule ids (overflow, clipped-content, hardcoded-color, gradient-without-style, no-auto-layout, absolute-in-auto-layout, …) or category names. Replaces any existing value; clear=true removes it.',
    {
      nodeId: z.string().describe("ID of the node to mark (accepts 1:2 or 1-2)"),
      rules: z
        .union([z.literal("*"), coerceArray(z.array(z.string()))])
        .optional()
        .describe('"*" (default) for all rules, or an array of rule ids / category names'),
      clear: mcpBooleanSchema.optional().describe("true = remove the lint-ignore marker from the node"),
    },
    async ({ nodeId, rules, clear }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const result = await sendCommandToFigma(
          "set_lint_ignore",
          normalizeCommandParams("set_lint_ignore", { nodeId, rules, clear }),
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting lint-ignore on node "${nodeId}": ${error instanceof Error ? error.message : String(error)}`,
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
      if (name.startsWith("space/") || name.startsWith("spacing/")) {
        spacingVars.push(v);
      } else if (name.startsWith("radius/")) {
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
        lines.push(
          `| ${sanitizeCell(ts.name)} | ${tw} | ${font} | ${ts.fontSize} | ${lh} | ${sanitizeCell(purpose)} | ${ts.id} |`,
        );
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
        lines.push(
          `| ${sanitizeCell(es.name)} | ${tw} | ${sanitizeCell(value)} | ${sanitizeCell(purpose)} | ${es.id} |`,
        );
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
        lines.push(
          `| ${sanitizeCell(v.name)} | ${v.resolvedType} | ${sanitizeCell(val)} | ${sanitizeCell(purpose)} | ${v.id} |`,
        );
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

  // Figma Connect Tool — get_open_channels + join_channel in one call.
  //
  // ~84% of sessions opened with exactly that pair, so the pair is the tool.
  server.tool(
    "figma_connect",
    "START HERE. Connects this session to Figma in ONE call: discovers the open channels and joins the live one automatically. ALWAYS PREFER this over calling get_open_channels and then join_channel — that pair is the first thing almost every session does. With exactly one connected channel it joins it and reports the file name; with several it lists them and asks you to re-call with `channelId`; with none it reports how to fix the connection. Pass `channelId` directly when the user names a channel.",
    {
      channelId: z
        .string()
        .optional()
        .describe("Join this channel directly, skipping discovery. Omit to auto-discover."),
    },
    async ({ channelId }) => {
      const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
      try {
        if (channelId) {
          await joinChannel(channelId);
          return text(`Connected to Figma channel: ${channelId}`);
        }

        const channels = await getOpenChannels();
        // The "browser" channel belongs to the Chrome extension, not a Figma file.
        const figmaChannels = channels.filter((ch) => ch.channel !== "browser");
        const live = figmaChannels.filter((ch) => ch.hasPlugin);

        if (live.length === 0) {
          const stale = figmaChannels.length > 0 ? ` (${figmaChannels.length} stale channel(s) with no plugin)` : "";
          return text(
            `No live Figma channels found${stale}. Ensure the WebSocket server is running and the Claude MCP Plugin is open in Figma, then call figma_connect again.`,
          );
        }

        if (live.length === 1) {
          const only = live[0];
          await joinChannel(only.channel);
          return text(`Connected to Figma channel: ${only.channel} (${only.fileName || "unknown file"})`);
        }

        const list = live.map((ch) => `  - ${ch.channel} (${ch.fileName || "unknown file"})`).join("\n");
        return text(
          `${live.length} live Figma channels — ask the user which file to work in, then call figma_connect again with that channelId:\n${list}`,
        );
      } catch (error) {
        return text(
          `Error connecting to Figma: ${error instanceof Error ? error.message : String(error)}. Ensure the WebSocket server is running and the Claude MCP Plugin is open in Figma.`,
        );
      }
    },
  );

  // Join Channel Tool
  server.tool(
    "join_channel",
    "Join a specific channel to communicate with Figma",
    {
      channelId: z.string().describe("The ID or name of the channel to join"),
    },
    async ({ channelId }) => {
      try {
        if (!channelId) {
          // If no channel provided, ask the user for input
          return {
            content: [
              {
                type: "text",
                text: "Please provide a channel ID to join:",
              },
            ],
            followUp: {
              tool: "join_channel",
              description: "Join the specified channel",
            },
          };
        }

        // Use joinChannel instead of sendCommandToFigma to ensure currentChannel is updated
        await joinChannel(channelId);

        return {
          content: [
            {
              type: "text",
              text: `Successfully joined channel: ${channelId}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error joining channel "${channelId}": ${error instanceof Error ? error.message : String(error)}`,
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
          .map((ch) => {
            // The "browser" channel is joined by the Chrome extension, not a Figma file,
            // so it's judged by hasExtension rather than the Figma-plugin-only hasPlugin flag.
            const status =
              ch.channel === "browser"
                ? ch.hasExtension
                  ? "Chrome extension connected"
                  : "NO CHROME EXTENSION — open/reconnect the Figma Overlay extension"
                : ch.hasPlugin
                  ? "plugin connected"
                  : "NO PLUGIN — stale channel";
            return `  - ${ch.channel} (${ch.fileName || "unknown file"}) [${status}]`;
          })
          .join("\n");
        const hasAnyPlugin = channels.some((ch) => ch.channel !== "browser" && ch.hasPlugin);
        const warning = hasAnyPlugin
          ? ""
          : "\n\nWARNING: No channels have an active Figma plugin. Open the Claude MCP Plugin inside Figma to connect.";
        return {
          content: [
            {
              type: "text",
              text: `Available channels:\n${channelList}${warning}`,
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
    "Export a node as an image (PNG/JPG/SVG/PDF) or video (MP4/GIF/WEBM) from Figma. " +
      "BY DEFAULT the render is written to a file and only {path,width,height,bytes,format} is returned — a few tokens instead of tens of thousands. " +
      "Pass `inline: true` ONLY when you genuinely need to SEE the pixels in this conversation; structural checks ('did it render', 'is it clipped') never do. " +
      "Pass `save_to_path` for an exact file path, or `output_directory` (plus an optional `filename`) to choose a folder; otherwise a session temp file is used. " +
      "Identical re-exports of an unchanged node are served from a session cache (bypass with `force_refresh: true`). " +
      "`scale` defaults to 1 — that is almost always right; 2 doubles the pixel cost, so only use it when you are inspecting fine detail. " +
      "Inline returns are capped at 1200px on the longest edge unless `allow_full_resolution`, `max_width` or `max_height` is set. " +
      "Use `region` to crop, `max_width`/`max_height` to downscale, and `format: 'JPG'` with `jpeg_quality` for cheap review screenshots. " +
      "Video export requires the node to be a top-level frame (a direct child of a page) with animated content — a nested animated frame or an individual keyframed layer is rejected.",
    {
      nodeId: z.string().describe("The ID of the node to export"),
      format: z
        .enum(["PNG", "JPG", "SVG", "PDF", "MP4", "GIF", "WEBM", "png", "jpg", "svg", "pdf", "mp4", "gif", "webm"])
        .transform((v) => v.toUpperCase() as "PNG" | "JPG" | "SVG" | "PDF" | "MP4" | "GIF" | "WEBM")
        .optional()
        .describe("Export format (e.g. 'png' or 'PNG'). MP4/GIF/WEBM export a video instead of an image."),
      scale: z.coerce
        .number()
        .positive()
        .optional()
        .describe(
          "Export scale — image formats only (PNG/JPG/SVG/PDF). Defaults to 1. Values above 1 multiply the pixel (and token) cost; use <1 to shrink.",
        ),
      fps: z.coerce
        .number()
        .optional()
        .describe(
          "Video frame rate — video formats only. GIF: one of 8/12/15/24/30 (default 15). MP4/WEBM: one of 12/24/30/60 (default 30).",
        ),
      quality: z
        .enum(["LOW", "MEDIUM", "HIGH"])
        .optional()
        .describe("Video quality preset — MP4/WEBM only (default HIGH). Higher quality produces a larger file."),
      loopCount: z.coerce
        .number()
        .int()
        .min(0)
        .max(1000)
        .optional()
        .describe("Number of times the GIF loops, 0 = infinite (default 0) — GIF only."),
      constraintType: z
        .enum(["SCALE", "WIDTH", "HEIGHT"])
        .optional()
        .describe(
          "Video size constraint type — video formats only (default SCALE at value 1, i.e. 100% of node size).",
        ),
      constraintValue: z.coerce
        .number()
        .optional()
        .describe(
          "Video size constraint value — video formats only. For SCALE, must be one of 0.5/0.75/1/1.5/2/3/4. For WIDTH/HEIGHT, a pixel value (capped at 4K/3840x2160).",
        ),
      save_to_path: z
        .string()
        .optional()
        .describe(
          "Absolute file path to write the export to. STRONGLY PREFERRED for visual checks: returns only {path,width,height,bytes,format} instead of an inline base64 image. Parent directory must exist; overwrites.",
        ),
      output_directory: z
        .string()
        .optional()
        .describe(
          "Absolute directory to write the export into; created when missing. The file name is derived from the node name, id, scale and format unless `filename` is given. Ignored (with a warning) when `save_to_path` is also passed.",
        ),
      filename: z
        .string()
        .optional()
        .describe(
          "File name for the export (no path separators). The extension implied by `format` is appended when missing. Used with `output_directory`; falls back to the session temp directory when that is omitted.",
        ),
      max_width: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe("Downscale the exported image so its width is at most this many pixels (image formats only)."),
      max_height: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe("Downscale the exported image so its height is at most this many pixels (image formats only)."),
      allow_full_resolution: mcpBooleanSchema
        .optional()
        .describe(
          "Return the image inline at full resolution, bypassing the default 1200px longest-edge cap. Expensive — prefer save_to_path.",
        ),
      region: z
        .object({
          x: z.coerce.number(),
          y: z.coerce.number(),
          width: z.coerce.number().positive(),
          height: z.coerce.number().positive(),
        })
        .optional()
        .describe(
          "Crop the export to this rectangle, in exported-image pixels (i.e. after `scale` is applied), origin at the node's top-left. PNG/JPG only.",
        ),
      jpeg_quality: z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe(
          "JPEG encode quality 1-100 — format 'JPG' only. Lower values shrink review screenshots dramatically. Unrelated to the video `quality` preset.",
        ),
      inline: mcpBooleanSchema
        .optional()
        .describe(
          "Return the pixels inline in this conversation instead of writing a file. Expensive — only for work that genuinely needs to see the image.",
        ),
      force_refresh: mcpBooleanSchema
        .optional()
        .describe("Bypass the session render cache and force a fresh export, even if the node looks unchanged."),
    },
    async ({
      nodeId,
      format,
      scale,
      fps,
      quality,
      loopCount,
      constraintType,
      constraintValue,
      save_to_path,
      output_directory,
      filename,
      max_width,
      max_height,
      allow_full_resolution,
      region,
      jpeg_quality,
      inline,
      force_refresh,
    }) => {
      nodeId = normalizeNodeId(nodeId);
      const isVideo = format === "MP4" || format === "GIF" || format === "WEBM";
      try {
        const result = await sendCommandToFigma("export_node_as_image", {
          nodeId,
          format: format || "PNG",
          scale: scale || 1,
          fps,
          quality,
          loopCount,
          constraintType,
          constraintValue,
        });

        if (isVideo) {
          const typedResult = result as {
            videoData: string;
            mimeType: string;
            format: string;
            byteLength: number;
            name?: string;
          };
          if (save_to_path || output_directory || filename) {
            const destination = await resolveExportDestination({
              saveToPath: save_to_path,
              outputDirectory: output_directory,
              filename,
              nodeId,
              nodeName: typedResult.name,
              scale: scale || 1,
              format: typedResult.format,
            });
            const written = await writeExportToPath(destination.path, typedResult.videoData);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      path: written.path,
                      bytes: written.bytes,
                      format: typedResult.format,
                      ...(destination.warnings.length ? { warnings: destination.warnings } : {}),
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }
          return {
            content: [
              {
                type: "text",
                text: `Exported "${nodeId}" as ${typedResult.format} (${(typedResult.byteLength / 1024).toFixed(0)} KB).`,
              },
              {
                type: "resource",
                resource: {
                  uri: `figma-export://${nodeId}.${typedResult.format.toLowerCase()}`,
                  mimeType: typedResult.mimeType,
                  blob: typedResult.videoData,
                },
              },
            ],
          };
        }

        const typedResult = result as {
          imageData: string;
          mimeType: string;
          requestedScale: number;
          actualScale: number;
          originalWidth: number;
          originalHeight: number;
          exportedWidth: number;
          exportedHeight: number;
          subtreeHash?: string | null;
          name?: string;
        };

        const resolvedFormat = format || "PNG";
        const resolvedScale = scale || 1;
        const wantsInline = inline === true;

        // Where the file goes. Resolved even for inline renders so an explicit
        // destination still participates in the cache key.
        const destination = wantsInline
          ? { path: "", warnings: [] as string[] }
          : await resolveExportDestination({
              saveToPath: save_to_path,
              outputDirectory: output_directory,
              filename,
              nodeId,
              nodeName: typedResult.name,
              scale: resolvedScale,
              format: resolvedFormat,
            });

        // Session render cache. Keyed on the plugin-computed subtree version
        // hash — when that is missing we simply never cache (a false miss costs
        // one render; a false hit silently shows a stale design).
        const cacheKey = exportCacheKey({
          nodeId,
          scale: resolvedScale,
          format: resolvedFormat,
          subtreeHash: typedResult.subtreeHash,
          region,
          maxWidth: max_width,
          maxHeight: max_height,
          jpegQuality: jpeg_quality,
          allowFullResolution: allow_full_resolution === true,
          inline: wantsInline,
          destination: destination.path || null,
        });
        const cached = force_refresh === true ? undefined : getCachedExport(cacheKey);

        if (cached) {
          const savedNote =
            `Cache HIT — "${nodeId}" is unchanged since the last export at this scale (subtree hash ${typedResult.subtreeHash}); ` +
            `reusing that render and skipping ~${cached.approxTokens} result tokens. Pass force_refresh: true to re-render.`;
          if (cached.path) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      path: cached.path,
                      width: cached.width,
                      height: cached.height,
                      bytes: cached.bytes,
                      format: cached.format,
                      cached: true,
                      note: savedNote,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }
          return {
            content: [
              { type: "text" as const, text: savedNote },
              {
                type: "image" as const,
                data: cached.base64 as string,
                mimeType: cached.mimeType || "image/png",
              },
            ],
          };
        }

        // Server-side crop / downscale / re-encode. Saving to disk keeps full
        // resolution — the 1200px cap only guards inline (token-costly)
        // returns — but a fractional `scale` is enforced on BOTH paths.
        const longestSourceEdge = Math.max(typedResult.originalWidth || 0, typedResult.originalHeight || 0);
        const hardMaxEdge =
          resolvedScale < 1 && longestSourceEdge > 0
            ? Math.max(1, Math.round(longestSourceEdge * resolvedScale))
            : undefined;

        const processed = await postProcessExport({
          base64: typedResult.imageData,
          format: resolvedFormat,
          maxWidth: max_width,
          maxHeight: max_height,
          allowFullResolution: allow_full_resolution === true || !wantsInline,
          region,
          jpegQuality: jpeg_quality,
          hardMaxEdge,
        });

        const width = processed.width ?? typedResult.exportedWidth;
        const height = processed.height ?? typedResult.exportedHeight;
        const approxTokens = approximateImageTokens(width, height);

        // A2: writing a file is the DEFAULT. Pixels come back inline only when
        // the caller explicitly asks for them.
        if (!wantsInline) {
          const written = await writeExportToPath(destination.path, processed.base64);
          setCachedExport(cacheKey, {
            path: written.path,
            width,
            height,
            bytes: written.bytes,
            format: resolvedFormat,
            approxTokens,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    path: written.path,
                    width,
                    height,
                    bytes: written.bytes,
                    format: resolvedFormat,
                    cached: false,
                    ...(destination.warnings.length ? { warnings: destination.warnings } : {}),
                    note: [
                      ...processed.notes,
                      ...destination.warnings,
                      "Pass inline: true if you need to see the pixels in the conversation.",
                    ].join(" "),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];

        // Add warning if scale was auto-reduced or image is large
        const wasScaleReduced = typedResult.actualScale < typedResult.requestedScale;

        const summary = [
          `Exported "${nodeId}" as ${resolvedFormat} — ${width}x${height}px, ${(processed.bytes / 1024).toFixed(0)} KB (original node ${typedResult.originalWidth}x${typedResult.originalHeight}px).`,
          wasScaleReduced
            ? `⚠️ Scale auto-reduced from ${typedResult.requestedScale}x to ${typedResult.actualScale.toFixed(2)}x to fit Figma export limits.`
            : "",
          ...processed.notes,
          `Cache MISS (~${approxTokens} result tokens). Omit inline to get a file path instead of an inline image (far cheaper).`,
        ]
          .filter(Boolean)
          .join(" ");

        content.push({ type: "text", text: summary });

        content.push({
          type: "image",
          data: processed.base64,
          mimeType: typedResult.mimeType || "image/png",
        });

        setCachedExport(cacheKey, {
          base64: processed.base64,
          mimeType: typedResult.mimeType || "image/png",
          width,
          height,
          bytes: processed.bytes,
          format: resolvedFormat,
          approxTokens,
        });

        return { content };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error exporting node "${nodeId}" as ${format || "PNG"}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Export Image Fill Tool
  server.tool(
    "export_image_fill",
    "Export the raw image from an image fill on a node (e.g. a background image) and save it to a file. The parent directory must exist. Overwrites existing files.",
    {
      nodeId: z.string().describe("The ID of the node that has an image fill"),
      exportPath: z.string().describe("Absolute file path to save the image to. Parent directory must exist."),
      fillIndex: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Index of the image fill to export (0-based, defaults to 0). Only counts IMAGE-type fills."),
    },
    async ({ nodeId, exportPath, fillIndex }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const path = await import("path");
        const fs = await import("fs");

        // Validate absolute path
        if (!path.isAbsolute(exportPath)) {
          return {
            content: [
              { type: "text" as const, text: `Error: exportPath must be an absolute path, got: ${exportPath}` },
            ],
          };
        }

        // Validate parent directory exists
        const dir = path.dirname(exportPath);
        if (!fs.existsSync(dir)) {
          return {
            content: [{ type: "text" as const, text: `Error: Directory does not exist: ${dir}` }],
          };
        }

        const result = await sendCommandToFigma(
          "export_image_fill",
          {
            nodeId,
            fillIndex: fillIndex ?? 0,
          },
          120000,
        );
        const typedResult = result as {
          imageData: string;
          mimeType: string;
          width: number;
          height: number;
          imageHash: string;
          scaleMode: string;
          fillIndex: number;
        };

        // Write base64 image data to file
        const buffer = Buffer.from(typedResult.imageData, "base64");
        fs.writeFileSync(exportPath, buffer);

        return {
          content: [
            {
              type: "text" as const,
              text: `Image fill exported to ${exportPath} (${typedResult.width}x${typedResult.height}px, ${buffer.length} bytes, scaleMode: ${typedResult.scaleMode})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error exporting image fill from node "${nodeId}": ${error instanceof Error ? error.message : String(error)}`,
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
      nodeId = normalizeNodeId(nodeId);
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

  // Scan Bound Variables Tool
  server.tool(
    "scan_bound_variables",
    "Scan a node (or the current selection) and all its children recursively to find every variable binding. Returns a flat list of all bindings with node info, field, variable name, and type.",
    {
      nodeId: z
        .string()
        .optional()
        .describe("ID of the root node to scan. If omitted, scans the current Figma selection."),
    },
    async ({ nodeId }) => {
      try {
        const params: Record<string, unknown> = {};
        if (nodeId) {
          params.nodeId = normalizeNodeId(nodeId);
        }
        const result = await sendCommandToFigma<{
          totalBindings: number;
          bindings: Array<{
            nodeId: string;
            nodeName: string;
            nodeType: string;
            field: string;
            variableId: string;
            variableName: string;
            variableType: string;
          }>;
        }>("scan_bound_variables", params);

        if (!result.bindings || result.bindings.length === 0) {
          return { content: [{ type: "text", text: "No variable bindings found." }] };
        }

        const lines: string[] = [
          `Found ${result.totalBindings} variable binding(s)`,
          "",
          "| Node | Type | Field | Variable | Var Type |",
          "|------|------|-------|----------|----------|",
        ];
        for (const b of result.bindings) {
          lines.push(
            `| ${sanitizeCell(b.nodeName)} | ${sanitizeCell(b.nodeType)} | ${sanitizeCell(b.field)} | ${sanitizeCell(b.variableName)} | ${sanitizeCell(b.variableType)} |`,
          );
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error scanning bound variables: ${error instanceof Error ? error.message : String(error)}`,
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
  // Shared colour contract: hex, {r,g,b,a} in 0-1 or 0-255, or [r,g,b(,a)].
  const rgbaColorSchema = ColorInputSchema;

  server.tool(
    "setup_design_system",
    "Create or update an entire design system in a single call. Accepts multiple variable collections, text styles, and effect styles. Idempotent — existing items with the same name are updated, not duplicated.",
    {
      pages: coerceArray(z.array(z.string()))
        .optional()
        .describe(
          "Page names to ensure exist (default: ['Screens', 'Components', 'Draft']). If only 'Page 1' exists and is empty, it is renamed to the first page.",
        ),
      collections: coerceArray(
        z.array(
          z.object({
            name: z.string().describe("Collection name, e.g. 'Colors', 'Spacing', 'Radius'"),
            variables: z.array(
              z.object({
                name: z.string().describe("Variable name, e.g. 'background/primary' or 'space/md'"),
                type: z.enum(["COLOR", "FLOAT"]).describe("COLOR for colors, FLOAT for spacing/radius numbers"),
                value: z
                  .union([rgbaColorSchema, z.coerce.number()])
                  .describe("RGBA object for COLOR type, number for FLOAT type"),
                description: z.string().optional().describe("Token description/purpose"),
              }),
            ),
          }),
        ),
      )
        .optional()
        .describe("Variable collections to create/update, each with its own name and variables"),
      text_styles: coerceArray(
        z.array(
          z.object({
            name: z.string().describe("Style name, e.g. 'text/display/lg'"),
            font_family: z.string().describe("Font family, e.g. 'Manrope'"),
            font_style: z.string().describe("Font style, e.g. 'Bold', 'SemiBold', 'Regular'"),
            font_size: z.coerce.number().describe("Font size in pixels"),
            line_height: z
              .object({
                value: z.coerce.number(),
                unit: z.enum(["PIXELS", "PERCENT", "AUTO"]),
              })
              .optional()
              .describe("Line height specification"),
            letter_spacing: z
              .object({
                value: z.coerce.number(),
                unit: z.enum(["PIXELS", "PERCENT"]),
              })
              .optional()
              .describe("Letter spacing specification"),
            description: z.string().optional().describe("Style description/purpose"),
          }),
        ),
      )
        .optional()
        .describe("Text styles to create/update"),
      effect_styles: coerceArray(
        z.array(
          z.object({
            name: z.string().describe("Effect style name, e.g. 'shadow/subtle'"),
            effects: z
              .array(
                z.object({
                  type: z
                    .enum(["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR"])
                    .describe("Effect type"),
                  color: rgbaColorSchema.optional().describe("Effect color (for shadows)"),
                  offset: z
                    .object({ x: z.coerce.number(), y: z.coerce.number() })
                    .optional()
                    .describe("Shadow offset (for shadows)"),
                  radius: z.coerce.number().optional().describe("Blur radius"),
                  spread: z.coerce.number().optional().describe("Spread (for shadows)"),
                }),
              )
              .describe("Array of effects for this style"),
            description: z.string().optional().describe("Effect style description/purpose"),
          }),
        ),
      )
        .optional()
        .describe("Effect styles to create/update"),
    },
    async ({ pages, collections, text_styles, effect_styles }) => {
      try {
        const params: Record<string, unknown> = {};
        if (pages) params.pages = pages;
        if (collections) {
          // Normalize every COLOR value to 0-1 {r,g,b,a} — the schema accepts
          // hex strings, 0-255 objects and arrays too.
          params.collections = collections.map((collection) => ({
            ...collection,
            variables: collection.variables.map((variable) =>
              variable.type === "COLOR" ? { ...variable, value: toRgba(variable.value) } : variable,
            ),
          }));
        }
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
          params.effectStyles = effect_styles.map((style) => ({
            ...style,
            effects: style.effects.map((effect) =>
              effect.color === undefined ? effect : { ...effect, color: toRgba(effect.color) },
            ),
          }));
        }

        const setupResult = await sendCommandToFigma<SetupDesignSystemResult>("setup_design_system", params, 120000);

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

  // Undo Tool
  server.tool("undo", "Undo the last action in Figma", {}, async () => {
    try {
      await sendCommandToFigma("undo");
      return {
        content: [{ type: "text", text: "Undo triggered successfully" }],
      };
    } catch (error) {
      return {
        content: [
          { type: "text", text: `Error triggering undo: ${error instanceof Error ? error.message : String(error)}` },
        ],
      };
    }
  });

  // Commit Undo Tool
  server.tool(
    "commit_undo",
    "Commit an undo checkpoint: everything done up to now becomes one undo group, so a later `undo` (or the user pressing Cmd+Z once in Figma) reverts only what happens AFTER this call. Call it before any risky or exploratory sequence of edits - deletions, restructuring a frame, applying a theme across many nodes - so the whole sequence can be backed out in one step. `batch_actions` commits one for you by default (checkpoint: true).",
    {},
    async () => {
      try {
        await sendCommandToFigma("commit_undo");
        return {
          content: [{ type: "text", text: "Undo checkpoint committed" }],
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Error committing undo: ${error instanceof Error ? error.message : String(error)}` },
          ],
        };
      }
    },
  );

  // Save Version History Tool
  server.tool(
    "save_version_history",
    "Save a named version to the Figma file's version history. Use this to create checkpoints or tag important milestones.",
    {
      title: z.string().describe("The version title/name (required)"),
      description: z.string().optional().describe("Optional description for the version"),
    },
    async ({ title, description }) => {
      try {
        const result = await sendCommandToFigma("save_version_history", { title, description });
        const typedResult = result as { id: string };
        return {
          content: [
            {
              type: "text",
              text: `Saved version "${title}" (ID: ${typedResult.id})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error saving version history: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Page Background Tool
  server.tool(
    "set_page_background",
    "Set the canvas background color of a Figma page. Pages use `backgrounds` (not `fills`), so set_fill_color fails on a PAGE node — use this instead of faking the canvas with a full-bleed rectangle.",
    {
      pageId: z.string().optional().describe("Page ID. Defaults to the current page."),
      color: colorParam("Page background color. Use this OR r,g,b,a.").optional(),
      r: z.coerce.number().min(0).max(255).optional().describe("Red channel (0–1 normalized, or 0–255)"),
      g: z.coerce.number().min(0).max(255).optional().describe("Green channel (0–1 normalized, or 0–255)"),
      b: z.coerce.number().min(0).max(255).optional().describe("Blue channel (0–1 normalized, or 0–255)"),
      a: z.coerce.number().min(0).max(255).optional().describe("Alpha (0–1 normalized, or 0–255; default 1)"),
    },
    async ({ pageId, color, r, g, b, a }) => {
      try {
        const params: Record<string, unknown> = {};
        if (pageId) params.pageId = pageId;
        if (color !== undefined) {
          const normalized = toRgba(color);
          params.color = typeof color === "string" ? color : normalized;
        } else {
          if (r === undefined || g === undefined || b === undefined) {
            throw new Error("Provide either 'color' or r, g, b components");
          }
          const normalized = toRgba({ r, g, b, a });
          params.r = normalized.r;
          params.g = normalized.g;
          params.b = normalized.b;
          params.a = normalized.a;
        }
        const result = await sendCommandToFigma("set_page_background", params);
        const typed = result as { id: string; name: string };
        return {
          content: [
            {
              type: "text",
              text: `Set background of page "${typed.name}" (ID: ${typed.id}) to ${color ?? `rgba(${r}, ${g}, ${b}, ${a ?? 1})`}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting page background: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}
