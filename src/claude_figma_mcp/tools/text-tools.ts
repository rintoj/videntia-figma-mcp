import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";

/**
 * Register text-related tools to the MCP server
 * This module contains tools for working with text elements in Figma
 * @param server - The MCP server instance
 */
export function registerTextTools(server: McpServer): void {
  // Set Text Content Tool
  server.tool(
    "set_text_content",
    "Set the text content of an existing text node in Figma",
    {
      nodeId: z.string().describe("The ID of the text node to modify"),
      text: z.string().describe("New text content"),
    },
    async ({ nodeId, text }) => {
      try {
        const result = await sendCommandToFigma("set_text_content", {
          nodeId,
          text,
        });
        const typedResult = result as { name: string };
        return {
          content: [
            {
              type: "text",
              text: `Updated text content of node "${typedResult.name}" to "${text}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting text content: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Multiple Text Contents Tool
  server.tool(
    "set_multiple_text_contents",
    "Set multiple text contents parallelly in a node",
    {
      nodeId: z.string().describe("The ID of the node containing the text nodes to replace"),
      text: z
        .array(
          z.object({
            nodeId: z.string().describe("The ID of the text node"),
            text: z.string().describe("The replacement text"),
          }),
        )
        .describe("Array of text node IDs and their replacement texts"),
    },
    async ({ nodeId, text }, extra) => {
      try {
        if (!text || text.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No text provided",
              },
            ],
          };
        }

        // Initial response to indicate we're starting the process
        const initialStatus = {
          type: "text" as const,
          text: `Starting text replacement for ${text.length} nodes. This will be processed in batches of 5...`,
        };

        // Track overall progress
        let totalProcessed = 0;
        const totalToProcess = text.length;

        // Use the plugin's set_multiple_text_contents function with chunking
        const result = await sendCommandToFigma("set_multiple_text_contents", {
          nodeId,
          text,
        });

        // Cast the result to a specific type to work with it safely
        interface TextReplaceResult {
          success: boolean;
          nodeId: string;
          replacementsApplied?: number;
          replacementsFailed?: number;
          totalReplacements?: number;
          completedInChunks?: number;
          results?: Array<{
            success: boolean;
            nodeId: string;
            error?: string;
            originalText?: string;
            translatedText?: string;
          }>;
        }

        const typedResult = result as TextReplaceResult;

        // Format the results for display
        const success = typedResult.replacementsApplied && typedResult.replacementsApplied > 0;
        const progressText = `
        Text replacement completed:
        - ${typedResult.replacementsApplied || 0} of ${totalToProcess} successfully updated
        - ${typedResult.replacementsFailed || 0} failed
        - Processed in ${typedResult.completedInChunks || 1} batches
        `;

        // Detailed results
        const detailedResults = typedResult.results || [];
        const failedResults = detailedResults.filter((item) => !item.success);

        // Create the detailed part of the response
        let detailedResponse = "";
        if (failedResults.length > 0) {
          detailedResponse = `\n\nNodes that failed:\n${failedResults
            .map((item) => `- ${item.nodeId}: ${item.error || "Unknown error"}`)
            .join("\n")}`;
        }

        return {
          content: [
            initialStatus,
            {
              type: "text" as const,
              text: progressText + detailedResponse,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting multiple text contents: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Font Name Tool
  server.tool(
    "set_font_name",
    "Set the font name and style of a text node in Figma",
    {
      nodeId: z.string().describe("The ID of the text node to modify"),
      family: z.string().describe("Font family name"),
      style: z.string().optional().describe("Font style (e.g., 'Regular', 'Bold', 'Italic')"),
    },
    async ({ nodeId, family, style }) => {
      try {
        const result = await sendCommandToFigma("set_font_name", {
          nodeId,
          family,
          style,
        });
        const typedResult = result as { name: string; fontName: { family: string; style: string } };
        return {
          content: [
            {
              type: "text",
              text: `Updated font of node "${typedResult.name}" to ${typedResult.fontName.family} ${typedResult.fontName.style}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting font name: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Font Size Tool
  server.tool(
    "set_font_size",
    "Set the font size of a text node in Figma",
    {
      nodeId: z.string().describe("The ID of the text node to modify"),
      size: z.coerce.number().positive().describe("Font size in pixels"),
    },
    async ({ nodeId, size }) => {
      try {
        const result = await sendCommandToFigma("set_font_size", {
          nodeId,
          fontSize: size,
        });
        const typedResult = result as { name: string; fontSize: number };
        return {
          content: [
            {
              type: "text",
              text: `Updated font size of node "${typedResult.name}" to ${typedResult.fontSize}px`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting font size: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Font Weight Tool
  server.tool(
    "set_font_weight",
    "Set the font weight of a text node in Figma",
    {
      nodeId: z.string().describe("The ID of the text node to modify"),
      weight: z.coerce.number().describe("Font weight as a multiple of 100 (100=Thin, 200=ExtraLight, 300=Light, 400=Regular, 500=Medium, 600=SemiBold, 700=Bold, 800=ExtraBold, 900=Black) — must be available in the font family"),
    },
    async ({ nodeId, weight }) => {
      try {
        const result = await sendCommandToFigma("set_font_weight", {
          nodeId,
          weight,
        });
        const typedResult = result as { name: string; fontName: { family: string; style: string }; weight: number };
        return {
          content: [
            {
              type: "text",
              text: `Updated font weight of node "${typedResult.name}" to ${typedResult.weight} (${typedResult.fontName.style})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting font weight: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Letter Spacing Tool
  server.tool(
    "set_letter_spacing",
    "Set the letter spacing of a text node in Figma",
    {
      nodeId: z.string().describe("The ID of the text node to modify"),
      spacing: z.coerce.number().describe("Letter spacing value — negative values tighten, positive values loosen (e.g. 0 = normal, 1 = slightly loose, -0.5 = slightly tight)"),
      unit: z.enum(["PIXELS", "PERCENT"]).optional().describe("Unit for spacing: PIXELS = absolute pixel value, PERCENT = relative to font size (e.g. 5 PERCENT = 5% of font size; default: PIXELS)"),
    },
    async ({ nodeId, spacing, unit }) => {
      try {
        const result = await sendCommandToFigma("set_letter_spacing", {
          nodeId,
          letterSpacing: spacing,
          unit: unit || "PIXELS",
        });
        const typedResult = result as { name: string; letterSpacing: { value: number; unit: string } };
        return {
          content: [
            {
              type: "text",
              text: `Updated letter spacing of node "${typedResult.name}" to ${typedResult.letterSpacing.value} ${typedResult.letterSpacing.unit}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting letter spacing: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Line Height Tool
  server.tool(
    "set_line_height",
    "Set the line height of a text node in Figma",
    {
      nodeId: z.string().describe("The ID of the text node to modify"),
      height: z.coerce.number().describe("Line height value — ignored when unit is AUTO (e.g. 24 for 24px, or 150 for 150%)"),
      unit: z.enum(["PIXELS", "PERCENT", "AUTO"]).optional().describe("Unit: PIXELS = fixed pixel height, PERCENT = percentage of font size (e.g. 150 = 1.5× font size), AUTO = let Figma calculate based on font metrics (ignores height value; default: PIXELS)"),
    },
    async ({ nodeId, height, unit }) => {
      try {
        const result = await sendCommandToFigma("set_line_height", {
          nodeId,
          lineHeight: height,
          unit: unit || "PIXELS",
        });
        const typedResult = result as { name: string; lineHeight: { value: number; unit: string } };
        return {
          content: [
            {
              type: "text",
              text: `Updated line height of node "${typedResult.name}" to ${typedResult.lineHeight.value} ${typedResult.lineHeight.unit}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting line height: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Paragraph Spacing Tool
  server.tool(
    "set_paragraph_spacing",
    "Set the paragraph spacing of a text node in Figma",
    {
      nodeId: z.string().describe("The ID of the text node to modify"),
      spacing: z.coerce.number().describe("Space added between paragraphs in pixels (≥ 0; similar to CSS margin-bottom on paragraphs)"),
    },
    async ({ nodeId, spacing }) => {
      try {
        const result = await sendCommandToFigma("set_paragraph_spacing", {
          nodeId,
          paragraphSpacing: spacing,
        });
        const typedResult = result as { name: string; paragraphSpacing: number };
        return {
          content: [
            {
              type: "text",
              text: `Updated paragraph spacing of node "${typedResult.name}" to ${typedResult.paragraphSpacing}px`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting paragraph spacing: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Text Case Tool
  server.tool(
    "set_text_case",
    "Set the text case of a text node in Figma",
    {
      nodeId: z.string().describe("The ID of the text node to modify"),
      textCase: z.enum(["ORIGINAL", "UPPER", "LOWER", "TITLE"]).describe("Text case transform: ORIGINAL = preserve the typed casing as-is, UPPER = ALL CAPS, LOWER = all lowercase, TITLE = Capitalize Each Word"),
    },
    async ({ nodeId, textCase }) => {
      try {
        const result = await sendCommandToFigma("set_text_case", {
          nodeId,
          textCase,
        });
        const typedResult = result as { name: string; textCase: string };
        return {
          content: [
            {
              type: "text",
              text: `Updated text case of node "${typedResult.name}" to ${typedResult.textCase}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting text case: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Text Decoration Tool
  server.tool(
    "set_text_decoration",
    "Set the text decoration of a text node in Figma",
    {
      nodeId: z.string().describe("The ID of the text node to modify"),
      decoration: z.enum(["NONE", "UNDERLINE", "STRIKETHROUGH"]).describe("Text decoration type"),
    },
    async ({ nodeId, decoration }) => {
      try {
        const result = await sendCommandToFigma("set_text_decoration", {
          nodeId,
          textDecoration: decoration,
        });
        const typedResult = result as { name: string; textDecoration: string };
        return {
          content: [
            {
              type: "text",
              text: `Updated text decoration of node "${typedResult.name}" to ${typedResult.textDecoration}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting text decoration: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Get Styled Text Segments Tool
  server.tool(
    "get_styled_text_segments",
    "Get text segments with specific styling in a text node",
    {
      nodeId: z.string().describe("The ID of the text node to analyze"),
      property: z
        .enum([
          "fillStyleId",
          "fontName",
          "fontSize",
          "textCase",
          "textDecoration",
          "textStyleId",
          "fills",
          "letterSpacing",
          "lineHeight",
          "fontWeight",
        ])
        .describe("Style property to segment by — returns runs of text that share the same value for this property: fontName = font family+style, fontSize = size in px, fontWeight = weight number, fills = fill color objects, fillStyleId = applied fill style ID, textStyleId = applied text style ID, letterSpacing = spacing value, lineHeight = line height value, textCase = case transform, textDecoration = underline/strikethrough"),
    },
    async ({ nodeId, property }) => {
      try {
        const result = await sendCommandToFigma("get_styled_text_segments", {
          nodeId,
          property,
        });

        const segments = (result as any)?.segments || (Array.isArray(result) ? result : []);
        if (segments.length === 0) {
          return { content: [{ type: "text", text: "No styled text segments found." }] };
        }
        const lines: string[] = [
          `Found ${segments.length} segment(s) by "${property}"`,
          "",
          "| Start | End | Characters | Value |",
          "|-------|-----|------------|-------|",
        ];
        for (const seg of segments) {
          const chars = (seg.characters || "").replace(/\n/g, " ").slice(0, 30);
          const val =
            seg[property] != null
              ? typeof seg[property] === "object"
                ? JSON.stringify(seg[property])
                : String(seg[property])
              : "-";
          lines.push(`| ${seg.start ?? "-"} | ${seg.end ?? "-"} | ${chars} | ${val} |`);
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
              text: `Error getting styled text segments: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Load Font Async Tool
  server.tool(
    "load_font_async",
    "Load a font asynchronously in Figma",
    {
      family: z.string().describe("Font family name"),
      style: z.string().optional().describe("Font style (e.g., 'Regular', 'Bold', 'Italic')"),
    },
    async ({ family, style }) => {
      try {
        const result = await sendCommandToFigma("load_font_async", {
          family,
          style: style || "Regular",
        });
        const typedResult = result as { success: boolean; family: string; style: string; message: string };
        return {
          content: [
            {
              type: "text",
              text: typedResult.message || `Loaded font ${family} ${style || "Regular"}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error loading font: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Create Text Style Tool
  server.tool(
    "create_text_style",
    "Create a text style from a text node in Figma",
    {
      nodeId: z.string().describe("The ID of the text node to create a style from"),
      name: z.string().describe("Name for the text style (e.g., 'Heading/H1', 'Body/Large')"),
      description: z.string().optional().describe("Optional description for the text style"),
    },
    async ({ nodeId, name, description }) => {
      try {
        const result = await sendCommandToFigma("create_text_style", {
          nodeId,
          name,
          description,
        });
        const typedResult = result as { id: string; name: string; key: string };
        return {
          content: [
            {
              type: "text",
              text: `Created text style "${typedResult.name}" (ID: ${typedResult.id})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating text style: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Create Text Style from Properties Tool
  server.tool(
    "create_text_style_from_properties",
    "Create a text style from specified properties without needing an existing node",
    {
      name: z.string().describe("Name for the text style (e.g., 'Heading/H1')"),
      fontSize: z.coerce.number().describe("Font size in pixels"),
      fontFamily: z.string().describe("Font family name"),
      fontStyle: z.string().optional().describe("Font style string as shown in Figma (e.g. 'Regular', 'Bold', 'Italic', 'Medium Italic') — if provided, takes priority over fontWeight"),
      fontWeight: z.coerce.number().optional().describe("Font weight 100–900 (ignored if fontStyle is provided; used to resolve the style string when fontStyle is omitted)"),
      lineHeight: z
        .object({
          value: z.coerce.number().describe("Line height value (ignored when unit is AUTO)"),
          unit: z.enum(["PIXELS", "PERCENT", "AUTO"]).describe("PIXELS = absolute px, PERCENT = % of font size (e.g. 150 = 1.5×), AUTO = font-native line height"),
        })
        .optional()
        .describe("Line height — e.g. {value:24, unit:'PIXELS'} or {value:150, unit:'PERCENT'} or {value:0, unit:'AUTO'}"),
      letterSpacing: z
        .object({
          value: z.coerce.number().describe("Spacing amount (negative = tighten, positive = loosen)"),
          unit: z.enum(["PIXELS", "PERCENT"]).describe("PIXELS = absolute px offset, PERCENT = % of font size"),
        })
        .optional()
        .describe("Letter spacing — e.g. {value:0.5, unit:'PIXELS'} or {value:2, unit:'PERCENT'}"),
      textCase: z.enum(["ORIGINAL", "UPPER", "LOWER", "TITLE"]).optional().describe("Text case transform: ORIGINAL = no transform, UPPER = ALL CAPS, LOWER = all lowercase, TITLE = Capitalize Each Word"),
      textDecoration: z.enum(["NONE", "UNDERLINE", "STRIKETHROUGH"]).optional().describe("Text decoration: NONE = no decoration, UNDERLINE = underline, STRIKETHROUGH = strikethrough"),
      description: z.string().optional().describe("Optional description"),
    },
    async ({
      name,
      fontSize,
      fontFamily,
      fontStyle,
      fontWeight,
      lineHeight,
      letterSpacing,
      textCase,
      textDecoration,
      description,
    }) => {
      try {
        const result = await sendCommandToFigma("create_text_style_from_properties", {
          name,
          fontSize,
          fontFamily,
          fontStyle,
          fontWeight,
          lineHeight,
          letterSpacing,
          textCase,
          textDecoration,
          description,
        });
        const typedResult = result as { id: string; name: string; key: string };
        return {
          content: [
            {
              type: "text",
              text: `Created text style "${typedResult.name}" (ID: ${typedResult.id})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating text style from properties: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Apply Text Style Tool
  server.tool(
    "apply_text_style",
    "Apply a text style to a text node. Accepts a style ID (from get_text_styles) or a style name (e.g. 'body/md').",
    {
      nodeId: z.string().describe("The ID of the text node"),
      styleId: z
        .string()
        .optional()
        .describe(
          "The style ID (the 'id' field from get_text_styles, e.g. 'S:abc123,'). Do NOT pass the 'key' field (the 40-char hex hash) — that is a cross-file sharing key, not an ID.",
        ),
      styleName: z
        .string()
        .optional()
        .describe(
          "The style name (e.g. 'body/md', 'heading/xl', 'text/heading/h3'). Dashes are auto-converted to slashes. Use as an alternative to styleId.",
        ),
    },
    async ({ nodeId, styleId, styleName }) => {
      if (!styleId && !styleName) {
        return {
          content: [{ type: "text", text: "Error: either styleId or styleName is required" }],
        };
      }
      try {
        const result = await sendCommandToFigma("apply_text_style", {
          nodeId,
          styleId: styleId || styleName,
        });
        const typedResult = result as { nodeName: string; styleName: string };
        return {
          content: [
            {
              type: "text",
              text: `Applied text style "${typedResult.styleName}" to node "${typedResult.nodeName}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error applying text style: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Get Text Styles Tool
  server.tool(
    "get_text_styles",
    "Get all local text styles in the document. Each style has an 'id' (use this with apply_text_style, looks like 'S:abc123,') and a 'key' (a hex hash for cross-file sharing — do NOT use with apply_text_style).",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_text_styles", {});
        const typedResult = result as {
          count: number;
          styles: Array<{
            id: string;
            name: string;
            key: string;
            description: string;
            fontSize: number;
            fontName: { family: string; style: string };
            letterSpacing: { value: number; unit: string };
            lineHeight: { value: number; unit: string } | { unit: "AUTO" };
            paragraphIndent: number;
            paragraphSpacing: number;
            textCase: string;
            textDecoration: string;
          }>;
        };
        if (!typedResult.styles || typedResult.styles.length === 0) {
          return { content: [{ type: "text", text: "No text styles found." }] };
        }
        const lines: string[] = [
          `Found ${typedResult.count} text style(s)`,
          "",
          "| Name | Font | Size | Weight | Line Height | ID |",
          "|------|------|------|--------|-------------|----|",
        ];
        for (const s of typedResult.styles) {
          const font = s.fontName ? `${s.fontName.family}` : "-";
          const weight = s.fontName?.style || "-";
          const lh =
            s.lineHeight && (s.lineHeight as any).unit === "AUTO"
              ? "auto"
              : s.lineHeight
                ? `${(s.lineHeight as any).value}${(s.lineHeight as any).unit === "PERCENT" ? "%" : "px"}`
                : "-";
          lines.push(`| ${s.name} | ${font} | ${s.fontSize} | ${weight} | ${lh} | ${s.id} |`);
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
              text: `Error getting text styles: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Delete Text Style Tool
  server.tool(
    "delete_text_style",
    "Delete a text style from the document",
    {
      styleId: z.string().describe("The ID or name of the text style to delete (e.g. 'S:abc123,' or 'body/md' or 'body-md')"),
    },
    async ({ styleId }) => {
      try {
        const result = await sendCommandToFigma("delete_text_style", {
          styleId,
        });
        const typedResult = result as { name: string; id: string };
        return {
          content: [
            {
              type: "text",
              text: `Deleted text style "${typedResult.name}" (ID: ${typedResult.id})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting text style: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Update Text Style Tool
  server.tool(
    "update_text_style",
    "Update an existing text style's properties",
    {
      styleId: z.string().describe("The ID or name of the text style to update (e.g. 'S:abc123,' or 'body/md' or 'body-md')"),
      name: z.string().optional().describe("New name for the text style"),
      description: z.string().optional().describe("New description for the text style"),
      fontSize: z.coerce.number().optional().describe("New font size in pixels"),
      fontFamily: z.string().optional().describe("New font family name"),
      fontStyle: z.string().optional().describe("Font style string as shown in Figma (e.g. 'Regular', 'Bold Italic') — if provided, takes priority over fontWeight"),
      fontWeight: z.coerce.number().optional().describe("Font weight 100–900 — IGNORED if fontStyle is also provided; use one or the other, not both"),
      lineHeight: z
        .object({
          value: z.coerce.number().describe("Line height value (ignored when unit is AUTO)"),
          unit: z.enum(["PIXELS", "PERCENT", "AUTO"]).describe("PIXELS = absolute px, PERCENT = % of font size, AUTO = font-native"),
        })
        .optional()
        .describe("Line height — e.g. {value:24, unit:'PIXELS'} or {value:0, unit:'AUTO'}"),
      letterSpacing: z
        .object({
          value: z.coerce.number().describe("Spacing (negative = tighter, positive = looser)"),
          unit: z.enum(["PIXELS", "PERCENT"]).describe("PIXELS = px offset, PERCENT = % of font size"),
        })
        .optional()
        .describe("Letter spacing — e.g. {value:0.5, unit:'PIXELS'}"),
      textCase: z.enum(["ORIGINAL", "UPPER", "LOWER", "TITLE"]).optional().describe("Text case: ORIGINAL = no transform, UPPER = ALL CAPS, LOWER = lowercase, TITLE = Capitalize Each Word"),
      textDecoration: z.enum(["NONE", "UNDERLINE", "STRIKETHROUGH"]).optional().describe("Text decoration: NONE, UNDERLINE, or STRIKETHROUGH"),
      paragraphSpacing: z.coerce.number().optional().describe("Space between paragraphs in pixels (≥ 0)"),
      paragraphIndent: z.coerce.number().optional().describe("First-line indent within each paragraph in pixels (≥ 0)"),
    },
    async ({
      styleId,
      name,
      description,
      fontSize,
      fontFamily,
      fontStyle,
      fontWeight,
      lineHeight,
      letterSpacing,
      textCase,
      textDecoration,
      paragraphSpacing,
      paragraphIndent,
    }) => {
      try {
        const result = await sendCommandToFigma("update_text_style", {
          styleId,
          name,
          description,
          fontSize,
          fontFamily,
          fontStyle,
          fontWeight,
          lineHeight,
          letterSpacing,
          textCase,
          textDecoration,
          paragraphSpacing,
          paragraphIndent,
        });
        const typedResult = result as { id: string; name: string; updatedProperties: string[] };
        return {
          content: [
            {
              type: "text",
              text: `Updated text style "${typedResult.name}" (ID: ${typedResult.id}). Modified: ${typedResult.updatedProperties.join(", ")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error updating text style: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}
