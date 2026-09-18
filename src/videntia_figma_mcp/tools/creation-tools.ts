import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { coerceArray } from "../utils/coerce-array.js";
import { mcpBooleanSchema } from "../utils/mcp-boolean.js";
import { normalizeNodeId } from "../utils/figma-helpers.js";
import { normalizeCommandParams } from "../utils/command-params.js";
import { svgConstraintsSchema } from "../utils/constraints-schema.js";
import { resolveFrameLayout, paddingShorthandSchema, PADDING_SHORTHAND_DESCRIPTION } from "../utils/frame-layout.js";
import { colorParam, toRgba } from "../utils/color-input.js";

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
      x: z.coerce
        .number()
        .describe("X position in pixels on the canvas (or relative to parent frame if parentId is set)"),
      y: z.coerce
        .number()
        .describe("Y position in pixels on the canvas (or relative to parent frame if parentId is set)"),
      width: z.coerce.number().describe("Width in pixels (must be > 0)"),
      height: z.coerce.number().describe("Height in pixels (must be > 0)"),
      name: z.string().optional().describe("Layer name for the rectangle (default: 'Rectangle')"),
      parentId: z.string().optional().describe("ID of the parent frame or group to insert the rectangle into"),
      cornerRadius: z.coerce
        .number()
        .min(0)
        .optional()
        .describe("Uniform corner radius in pixels (default: 0, sharp corners)"),
      fillColor: colorParam("Solid fill.").optional(),
      layoutPositioning: z
        .enum(["ABSOLUTE", "RELATIVE"])
        .optional()
        .describe(
          "How this node positions inside an auto-layout parent: ABSOLUTE = uses x/y coordinates ignoring auto-layout flow, RELATIVE = participates in auto-layout flow (default when inside auto-layout)",
        ),
    },
    async ({ x, y, width, height, name, parentId, cornerRadius, fillColor, layoutPositioning }) => {
      if (parentId) parentId = normalizeNodeId(parentId);
      try {
        const result = await sendCommandToFigma("create_rectangle", {
          x,
          y,
          width,
          height,
          name: name || "Rectangle",
          parentId,
          cornerRadius,
          fillColor: fillColor === undefined ? undefined : toRgba(fillColor),
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
    "Create a frame AND finish it in ONE call. Pass `layout` and `size` and this tool applies auto-layout, padding, gap, alignment, wrap and sizing in the order Figma actually requires (layoutMode before padding/gap, parenting before FILL sizing) — so you should NEVER follow a create_frame with set_auto_layout, set_layout_sizing, set_padding, set_item_spacing or resize_node. Preferred form: create_frame({ name, parentId, size: { width, height }, layout: { mode: 'VERTICAL', sizing: { horizontal: 'FILL', vertical: 'HUG' }, padding: 16, gap: 8, align: { primary: 'MIN', counter: 'CENTER' } } }). The flat spellings (layoutMode, padding, gap, horizontal/vertical, width/height, ...) are still accepted; `create_autolayout_frame` is an alias of this same one-call form.",
    {
      x: z.coerce
        .number()
        .optional()
        .describe("X position in pixels on the canvas (default 0; ignored inside an auto-layout parent)"),
      y: z.coerce
        .number()
        .optional()
        .describe("Y position in pixels on the canvas (default 0; ignored inside an auto-layout parent)"),
      width: z.coerce.number().optional().describe("Width in pixels (default 100). Or pass size.width."),
      height: z.coerce.number().optional().describe("Height in pixels (default 100). Or pass size.height."),
      size: z
        .object({
          width: z.coerce.number().optional().describe("Width in pixels"),
          height: z.coerce.number().optional().describe("Height in pixels"),
        })
        .optional()
        .describe("Frame size in one object — wins over the flat width/height"),
      layout: z
        .object({
          mode: z
            .enum(["NONE", "HORIZONTAL", "VERTICAL", "GRID"])
            .optional()
            .describe("Auto-layout direction. Required before padding/gap/align/sizing have any effect."),
          sizing: z
            .union([
              z.enum(["FIXED", "HUG", "FILL"]).describe("Same sizing on both axes"),
              z.object({
                horizontal: z.enum(["FIXED", "HUG", "FILL"]).optional(),
                vertical: z.enum(["FIXED", "HUG", "FILL"]).optional(),
              }),
            ])
            .optional()
            .describe("Layout sizing: one value for both axes, or { horizontal, vertical }"),
          padding: paddingShorthandSchema.optional().describe(PADDING_SHORTHAND_DESCRIPTION),
          gap: z.coerce.number().min(0).optional().describe("Spacing between children in pixels"),
          align: z
            .object({
              primary: z.enum(["MIN", "CENTER", "MAX", "SPACE_BETWEEN"]).optional().describe("Along the layout axis"),
              counter: z.enum(["MIN", "CENTER", "MAX", "BASELINE"]).optional().describe("Across the layout axis"),
            })
            .optional()
            .describe("Axis alignment"),
          wrap: z
            .union([z.enum(["NO_WRAP", "WRAP"]), z.boolean()])
            .optional()
            .describe("Wrap children onto multiple lines (HORIZONTAL layout only)"),
        })
        .optional()
        .describe(
          "Everything auto-layout, in one object — applied in Figma's required order. Use this instead of following up with set_auto_layout / set_padding / set_item_spacing / set_layout_sizing.",
        ),
      name: z.string().optional().describe("Layer name for the frame (default: 'Frame')"),
      parentId: z.string().optional().describe("ID of the parent frame to nest this frame inside"),
      fillColor: colorParam("Background fill color (default: white).").optional(),
      strokeColor: colorParam("Border/stroke color — omit for no stroke.").optional(),
      strokeWeight: z.coerce
        .number()
        .positive()
        .optional()
        .describe("Border thickness in pixels (must be > 0; requires strokeColor to be visible)"),
      clipsContent: mcpBooleanSchema
        .optional()
        .describe(
          "true = hide content that overflows the frame boundary (CSS overflow:hidden), which also clips children's drop shadows, glows and focus rings; false = show overflow. Default: false when parentId is a frame/component (nested container), true for top-level frames (no parentId, or parentId is a page or section). Change later with set_clips_content.",
        ),
      cornerRadius: z.coerce
        .number()
        .min(0)
        .optional()
        .describe("Uniform corner radius in pixels (default: 0, sharp corners)"),
      layoutPositioning: z
        .enum(["ABSOLUTE", "RELATIVE"])
        .optional()
        .describe(
          "How this frame positions inside an auto-layout parent: ABSOLUTE = positioned by x/y ignoring layout flow, RELATIVE = participates in layout flow (default when inside auto-layout)",
        ),
      layoutMode: z
        .enum(["NONE", "HORIZONTAL", "VERTICAL", "GRID"])
        .optional()
        .describe(
          "Auto layout for the new frame. Required before gap/padding/alignment have any effect — passing those without a layoutMode is an error, not a silent no-op",
        ),
      layoutWrap: z
        .enum(["NO_WRAP", "WRAP"])
        .optional()
        .describe("Wrap children onto multiple lines (requires layoutMode HORIZONTAL)"),
      gap: z.coerce.number().min(0).optional().describe("Spacing between children in pixels (requires layoutMode)"),
      padding: paddingShorthandSchema.optional().describe(`${PADDING_SHORTHAND_DESCRIPTION} (requires layoutMode)`),
      top: z.coerce
        .number()
        .min(0)
        .optional()
        .describe("Top padding in pixels; overrides `padding` (requires layoutMode)"),
      right: z.coerce
        .number()
        .min(0)
        .optional()
        .describe("Right padding in pixels; overrides `padding` (requires layoutMode)"),
      bottom: z.coerce
        .number()
        .min(0)
        .optional()
        .describe("Bottom padding in pixels; overrides `padding` (requires layoutMode)"),
      left: z.coerce
        .number()
        .min(0)
        .optional()
        .describe("Left padding in pixels; overrides `padding` (requires layoutMode)"),
      primaryAxisAlignItems: z
        .enum(["MIN", "CENTER", "MAX", "SPACE_BETWEEN"])
        .optional()
        .describe("Alignment along the layout direction (requires layoutMode)"),
      counterAxisAlignItems: z
        .enum(["MIN", "CENTER", "MAX", "BASELINE"])
        .optional()
        .describe("Alignment perpendicular to the layout direction (requires layoutMode)"),
      horizontal: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Horizontal sizing mode (requires layoutMode)"),
      vertical: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Vertical sizing mode (requires layoutMode)"),
      itemSpacing: z.coerce.number().min(0).optional().describe("Alias for `gap` (the Figma property name)"),
      paddingTop: z.coerce.number().optional().describe("Alias for `top`"),
      paddingRight: z.coerce.number().optional().describe("Alias for `right`"),
      paddingBottom: z.coerce.number().optional().describe("Alias for `bottom`"),
      paddingLeft: z.coerce.number().optional().describe("Alias for `left`"),
      layoutSizingHorizontal: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe("Alias for `horizontal` (the Figma property name)"),
      layoutSizingVertical: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe("Alias for `vertical` (the Figma property name)"),
    },
    async ({
      itemSpacing,
      paddingTop,
      paddingRight,
      paddingBottom,
      paddingLeft,
      layoutSizingHorizontal,
      layoutSizingVertical,
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
      cornerRadius,
      layoutPositioning,
      layoutMode,
      layoutWrap,
      gap,
      padding,
      top,
      right,
      bottom,
      left,
      primaryAxisAlignItems,
      counterAxisAlignItems,
      horizontal,
      vertical,
      size,
      layout,
    }) => {
      if (parentId) parentId = normalizeNodeId(parentId);

      // Nested `size` / `layout` are the preferred one-call spelling; the flat
      // params stay supported and are used wherever the nested form is silent.
      const resolved = resolveFrameLayout({
        size,
        layout,
        width,
        height,
        layoutMode,
        layoutWrap,
        gap,
        itemSpacing,
        padding,
        top,
        right,
        bottom,
        left,
        paddingTop,
        paddingRight,
        paddingBottom,
        paddingLeft,
        primaryAxisAlignItems,
        counterAxisAlignItems,
        horizontal,
        vertical,
        layoutSizingHorizontal,
        layoutSizingVertical,
      });

      try {
        const result = await sendCommandToFigma("create_frame", {
          x: x ?? 0,
          y: y ?? 0,
          width: resolved.width,
          height: resolved.height,
          name: name || "Frame",
          parentId,
          fillColor: fillColor === undefined ? { r: 1, g: 1, b: 1, a: 1 } : toRgba(fillColor),
          strokeColor: strokeColor === undefined ? undefined : toRgba(strokeColor),
          strokeWeight: strokeWeight,
          clipsContent,
          cornerRadius,
          layoutPositioning,
          layoutMode: resolved.layoutMode,
          layoutWrap: resolved.layoutWrap,
          itemSpacing: resolved.itemSpacing,
          paddingTop: resolved.paddingTop,
          paddingRight: resolved.paddingRight,
          paddingBottom: resolved.paddingBottom,
          paddingLeft: resolved.paddingLeft,
          primaryAxisAlignItems: resolved.primaryAxisAlignItems,
          counterAxisAlignItems: resolved.counterAxisAlignItems,
          layoutSizingHorizontal: resolved.layoutSizingHorizontal,
          layoutSizingVertical: resolved.layoutSizingVertical,
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
    "Create a new text element in Figma. Wrapping: without `width` the text auto-sizes to its content on a single line (textAutoResize WIDTH_AND_HEIGHT) and never wraps — right for labels and buttons. " +
      "With `width` (and no `textAutoResize`) the text gets that fixed width and textAutoResize HEIGHT: it wraps at the width and its height grows — right for paragraphs. " +
      "Pass `textAutoResize` to override (NONE = fixed box that can overflow; WIDTH_AND_HEIGHT ignores `width`). " +
      'Alignment: `textAlignHorizontal` only visibly matters when the text box is wider than its content (a `width` / textAutoResize HEIGHT or NONE, or FILL sizing) — WIDTH_AND_HEIGHT text hugs its content, so for centred text pass `textAlignHorizontal: "CENTER"` together with `width`.',
    {
      x: z.coerce.number().describe("X position in pixels on the canvas (or relative to parent if parentId is set)"),
      y: z.coerce.number().describe("Y position in pixels on the canvas (or relative to parent if parentId is set)"),
      text: z.string().describe("Text content to display"),
      fontSize: z.coerce.number().optional().describe("Font size in pixels (default: 14)"),
      fontFamily: z
        .string()
        .optional()
        .describe("Font family name as it appears in Figma, e.g. 'Inter', 'Roboto', 'SF Pro' (default: 'Inter')"),
      fontWeight: z.coerce
        .number()
        .optional()
        .describe(
          "Font weight as a number: 100=Thin, 200=ExtraLight, 300=Light, 400=Regular, 500=Medium, 600=SemiBold, 700=Bold, 800=ExtraBold, 900=Black (default: 400)",
        ),
      fontColor: colorParam("Text color (default: black).").optional(),
      name: z.string().optional().describe("Layer name for the text node (default: the text content itself)"),
      parentId: z.string().optional().describe("ID of the parent frame to insert the text into"),
      width: z.coerce
        .number()
        .positive()
        .optional()
        .describe(
          "Fixed width in pixels. When set without textAutoResize, the text wraps at this width and its height grows (textAutoResize HEIGHT). Omit for single-line text that hugs its content",
        ),
      textAutoResize: z
        .enum(["NONE", "HEIGHT", "WIDTH_AND_HEIGHT"])
        .optional()
        .describe(
          "Text box sizing: HEIGHT = fixed width, wraps, height grows (default when width is set); WIDTH_AND_HEIGHT = single line, hugs content (default when width is omitted); NONE = fixed width and height, text may overflow",
        ),
      textAlignHorizontal: z
        .enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"])
        .optional()
        .describe(
          "Horizontal text alignment (Figma default LEFT). Only visible when the box is wider than the text — combine with `width` (or FILL sizing); WIDTH_AND_HEIGHT text hugs its content",
        ),
      textAlignVertical: z
        .enum(["TOP", "CENTER", "BOTTOM"])
        .optional()
        .describe(
          "Vertical text alignment within the box (Figma default TOP). Only visible when the box is taller than the text (textAutoResize NONE or a fixed/FILL height)",
        ),
    },
    async ({
      x,
      y,
      text,
      fontSize,
      fontFamily,
      fontWeight,
      fontColor,
      name,
      parentId,
      width,
      textAutoResize,
      textAlignHorizontal,
      textAlignVertical,
    }) => {
      if (parentId) parentId = normalizeNodeId(parentId);
      try {
        const result = await sendCommandToFigma("create_text", {
          x,
          y,
          text,
          fontSize: fontSize || 14,
          fontFamily: fontFamily || "Inter",
          fontWeight: fontWeight || 400,
          fontColor: fontColor === undefined ? { r: 0, g: 0, b: 0, a: 1 } : toRgba(fontColor),
          name: name || "Text",
          parentId,
          width,
          textAutoResize,
          textAlignHorizontal,
          textAlignVertical,
        });
        const typedResult = result as {
          name: string;
          id: string;
          width?: number;
          textAutoResize?: string;
          textAlignHorizontal?: string;
          textAlignVertical?: string;
        };
        const alignText = [
          textAlignHorizontal !== undefined && typedResult.textAlignHorizontal !== undefined
            ? `, textAlignHorizontal: ${typedResult.textAlignHorizontal}`
            : "",
          textAlignVertical !== undefined && typedResult.textAlignVertical !== undefined
            ? `, textAlignVertical: ${typedResult.textAlignVertical}`
            : "",
        ].join("");
        const sizingText =
          typedResult.textAutoResize !== undefined
            ? ` (textAutoResize: ${typedResult.textAutoResize}${typedResult.width !== undefined ? `, width: ${typedResult.width}` : ""}${alignText})`
            : "";
        return {
          content: [
            {
              type: "text",
              text: `Created text "${typedResult.name}" with ID: ${typedResult.id}${sizingText}`,
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
      nodeIds: coerceArray(z.array(z.string())).describe(
        "Array of node IDs to group together (minimum 2; all must be siblings in the same parent)",
      ),
      name: z.string().optional().describe("Layer name for the resulting group (default: 'Group')"),
    },
    async ({ nodeIds, name }) => {
      nodeIds = nodeIds.map(normalizeNodeId);
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
      nodeId = normalizeNodeId(nodeId);
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
      parentId: z.string().optional().describe("ID of the parent node to place the clone into"),
      index: z.coerce.number().optional().describe("Zero-based position within the parent's children (omit to append)"),
    },
    async ({ nodeId, x, y, parentId, index }) => {
      nodeId = normalizeNodeId(nodeId);
      if (parentId) parentId = normalizeNodeId(parentId);
      try {
        const result = await sendCommandToFigma("clone_node", { nodeId, x, y, parentId, index });
        const typedResult = result as { name: string; id: string };
        const parts = [`Cloned node "${typedResult.name}" with new ID: ${typedResult.id}`];
        if (parentId) parts.push(`into parent ${parentId}${index !== undefined ? ` at index ${index}` : ""}`);
        if (x !== undefined && y !== undefined) parts.push(`at position (${x}, ${y})`);
        return {
          content: [
            {
              type: "text",
              text: parts.join(" "),
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
      index: z.coerce
        .number()
        .optional()
        .describe(
          "Zero-based position to insert the child at within the parent's children array (0 = front/first; omit to append at the end)",
        ),
    },
    async ({ parentId, childId, index }) => {
      parentId = normalizeNodeId(parentId);
      childId = normalizeNodeId(childId);
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
      flatten: mcpBooleanSchema
        .optional()
        .describe(
          "true = merge all SVG paths into a single vector node (loses individual path structure but simplifies the layer); false = preserve path hierarchy as separate nodes (default: false)",
        ),
      constraints: svgConstraintsSchema.optional(),
    },
    async ({ svgString, x, y, name, parentId, flatten, constraints }) => {
      if (parentId) parentId = normalizeNodeId(parentId);
      try {
        const result = await sendCommandToFigma(
          "create_svg",
          normalizeCommandParams("create_svg", {
            svgString,
            x,
            y,
            name,
            parentId,
            flatten,
            ...(constraints ? { constraints } : {}),
          }),
        );
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
          constraints?: { horizontal?: string; vertical?: string };
          constraintsAppliedTo?: number;
        };
        const c = typedResult.constraints;
        const constraintsText = c
          ? `; constraints (${[c.horizontal && `horizontal: ${c.horizontal}`, c.vertical && `vertical: ${c.vertical}`].filter(Boolean).join(", ")}) applied to ${typedResult.constraintsAppliedTo ?? 0} layer(s)`
          : "";
        return {
          content: [
            {
              type: "text",
              text: `Created SVG node "${typedResult.name}" (ID: ${typedResult.id}, ${typedResult.width}x${typedResult.height}px, ${typedResult.childCount} children)${typedResult.parentId ? ` inside parent ${typedResult.parentId}` : ""}${constraintsText}`,
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
      nodeId = normalizeNodeId(nodeId);
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

  // Create Section Tool
  server.tool(
    "create_section",
    "Create a Figma Section (figma.createSection) — a chrome-free, collapsible, deep-linkable container used for file organisation. Sections can only be parented to a PAGE or another SECTION.",
    {
      name: z.string().optional().describe("Section name (shown as the section title on canvas)"),
      x: z.coerce.number().optional().describe("X position on canvas"),
      y: z.coerce.number().optional().describe("Y position on canvas"),
      width: z.coerce.number().optional().describe("Section width (applied via resizeWithoutConstraints)"),
      height: z.coerce.number().optional().describe("Section height"),
      color: colorParam("Section background color.").optional(),
      parentId: z.string().optional().describe("Parent PAGE or SECTION id. Defaults to the current page."),
    },
    async ({ name, x, y, width, height, color, parentId }) => {
      try {
        const result = await sendCommandToFigma("create_section", {
          name,
          x,
          y,
          width,
          height,
          color: color === undefined ? undefined : toRgba(color),
          parentId: parentId ? normalizeNodeId(parentId) : undefined,
        });
        const typed = result as { id: string; name: string; width: number; height: number };
        return {
          content: [
            {
              type: "text",
              text: `Created section "${typed.name}" (ID: ${typed.id}) ${typed.width}x${typed.height}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Error creating section: ${error instanceof Error ? error.message : String(error)}` },
          ],
        };
      }
    },
  );
}
