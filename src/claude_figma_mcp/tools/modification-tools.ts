import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { applyColorDefaults, applyDefault, FIGMA_DEFAULTS } from "../utils/defaults";
import { Color } from "../types/color";
import { coerceArray } from "../utils/coerce-array.js";
import { DeleteMultipleNodesResult, CreateEffectStyleResult, UpdateEffectStyleResult } from "../types";

/**
 * Register modification tools to the MCP server
 * This module contains tools for modifying existing elements in Figma
 * @param server - The MCP server instance
 */
export function registerModificationTools(server: McpServer): void {
  // Set Fill Color Tool
  server.tool(
    "set_fill_color",
    "Set the fill color of a node in Figma. Alpha component defaults to 1 (fully opaque) if not specified. Use alpha 0 for fully transparent.",
    {
      nodeId: z.string().describe("The ID of the node to modify"),
      r: z.coerce.number().min(0).max(1).describe("Red component (0-1)"),
      g: z.coerce.number().min(0).max(1).describe("Green component (0-1)"),
      b: z.coerce.number().min(0).max(1).describe("Blue component (0-1)"),
      a: z.coerce.number().min(0).max(1).optional().describe("Alpha component (0-1, defaults to 1 if not specified)"),
    },
    async ({ nodeId, r, g, b, a }) => {
      try {
        // Additional validation: Ensure RGB values are provided (they should not be undefined)
        if (r === undefined || g === undefined || b === undefined) {
          throw new Error("RGB components (r, g, b) are required and cannot be undefined");
        }

        // Apply default values safely - preserves opacity 0 for transparency
        const colorInput: Color = { r, g, b, a };
        const colorWithDefaults = applyColorDefaults(colorInput);

        const result = await sendCommandToFigma("set_fill_color", {
          nodeId,
          color: colorWithDefaults,
        });
        const typedResult = result as { name: string };
        return {
          content: [
            {
              type: "text",
              text: `Set fill color of node "${typedResult.name}" to RGBA(${r}, ${g}, ${b}, ${colorWithDefaults.a})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting fill color: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Stroke Color Tool
  server.tool(
    "set_stroke_color",
    "Set the stroke color of a node in Figma (defaults: opacity 1, weight 1)",
    {
      nodeId: z.string().describe("The ID of the node to modify"),
      r: z.coerce.number().min(0).max(1).describe("Red component (0-1)"),
      g: z.coerce.number().min(0).max(1).describe("Green component (0-1)"),
      b: z.coerce.number().min(0).max(1).describe("Blue component (0-1)"),
      a: z.coerce.number().min(0).max(1).optional().describe("Alpha component (0-1)"),
      strokeWeight: z.coerce.number().min(0).optional().describe("Stroke weight >= 0)"),
    },
    async ({ nodeId, r, g, b, a, strokeWeight }) => {
      try {
        if (r === undefined || g === undefined || b === undefined) {
          throw new Error("RGB components (r, g, b) are required and cannot be undefined");
        }

        const colorInput: Color = { r, g, b, a };
        const colorWithDefaults = applyColorDefaults(colorInput);

        const strokeWeightWithDefault = applyDefault(strokeWeight, FIGMA_DEFAULTS.stroke.weight);

        const result = await sendCommandToFigma("set_stroke_color", {
          nodeId,
          color: colorWithDefaults,
          strokeWeight: strokeWeightWithDefault,
        });
        const typedResult = result as { name: string };
        return {
          content: [
            {
              type: "text",
              text: `Set stroke color of node "${typedResult.name}" to RGBA(${r}, ${g}, ${b}, ${colorWithDefaults.a}) with weight ${strokeWeightWithDefault}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting stroke color: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Move Node Tool
  server.tool(
    "move_node",
    "Move a node to a new position in Figma",
    {
      nodeId: z.string().describe("The ID of the node to move"),
      x: z.coerce.number().describe("New X position"),
      y: z.coerce.number().describe("New Y position"),
    },
    async ({ nodeId, x, y }) => {
      try {
        const result = await sendCommandToFigma("move_node", { nodeId, x, y });
        const typedResult = result as { name: string };
        return {
          content: [
            {
              type: "text",
              text: `Moved node "${typedResult.name}" to position (${x}, ${y})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error moving node: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Resize Node Tool
  server.tool(
    "resize_node",
    "Resize a node in Figma",
    {
      nodeId: z.string().describe("The ID of the node to resize"),
      width: z.coerce.number().positive().describe("New width"),
      height: z.coerce.number().positive().describe("New height"),
    },
    async ({ nodeId, width, height }) => {
      try {
        const result = await sendCommandToFigma("resize_node", {
          nodeId,
          width,
          height,
        });
        const typedResult = result as { name: string };
        return {
          content: [
            {
              type: "text",
              text: `Resized node "${typedResult.name}" to width ${width} and height ${height}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error resizing node: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Delete Node Tool
  server.tool(
    "delete_node",
    "Delete a node from Figma",
    {
      nodeId: z.string().describe("The ID of the node to delete"),
    },
    async ({ nodeId }) => {
      try {
        await sendCommandToFigma("delete_node", { nodeId });
        return {
          content: [
            {
              type: "text",
              text: `Deleted node with ID: ${nodeId}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting node: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Delete Multiple Nodes Tool
  server.tool(
    "delete_multiple_nodes",
    "Delete multiple nodes from Figma at once",
    {
      nodeIds: coerceArray(z.array(z.string())).describe("Array of node IDs to delete"),
    },
    async ({ nodeIds }) => {
      try {
        const result = await sendCommandToFigma<DeleteMultipleNodesResult>("delete_multiple_nodes", {
          nodeIds,
        });
        const deleted = result?.deleted ?? nodeIds.length;
        return {
          content: [
            {
              type: "text",
              text: `Deleted ${deleted} node(s)`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting multiple nodes [${nodeIds.join(", ")}]: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Layout Mode Tool
  server.tool(
    "set_layout_mode",
    "Set the layout mode and wrap behavior of a frame in Figma",
    {
      nodeId: z.string().describe("The ID of the frame to modify"),
      layoutMode: z.enum(["NONE", "HORIZONTAL", "VERTICAL"]).describe("Layout mode for the frame"),
      layoutWrap: z.enum(["NO_WRAP", "WRAP"]).optional().describe("Whether the auto-layout frame wraps its children"),
    },
    async ({ nodeId, layoutMode, layoutWrap }) => {
      try {
        const result = await sendCommandToFigma("set_layout_mode", {
          nodeId,
          layoutMode,
          layoutWrap: layoutWrap || "NO_WRAP",
        });
        const typedResult = result as { name: string };
        return {
          content: [
            {
              type: "text",
              text: `Set layout mode of frame "${typedResult.name}" to ${layoutMode}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting layout mode: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Padding Tool
  server.tool(
    "set_padding",
    "Set padding values for an auto-layout frame in Figma",
    {
      nodeId: z.string().describe("The ID of the frame to modify"),
      paddingTop: z.coerce.number().optional().describe("Top padding value"),
      paddingRight: z.coerce.number().optional().describe("Right padding value"),
      paddingBottom: z.coerce.number().optional().describe("Bottom padding value"),
      paddingLeft: z.coerce.number().optional().describe("Left padding value"),
    },
    async ({ nodeId, paddingTop, paddingRight, paddingBottom, paddingLeft }) => {
      try {
        const result = await sendCommandToFigma("set_padding", {
          nodeId,
          paddingTop,
          paddingRight,
          paddingBottom,
          paddingLeft,
        });
        const typedResult = result as { name: string };

        const paddingMessages = [];
        if (paddingTop !== undefined) paddingMessages.push(`top: ${paddingTop}`);
        if (paddingRight !== undefined) paddingMessages.push(`right: ${paddingRight}`);
        if (paddingBottom !== undefined) paddingMessages.push(`bottom: ${paddingBottom}`);
        if (paddingLeft !== undefined) paddingMessages.push(`left: ${paddingLeft}`);

        const paddingText = paddingMessages.length > 0 ? `padding (${paddingMessages.join(", ")})` : "padding";

        return {
          content: [
            {
              type: "text",
              text: `Set ${paddingText} for frame "${typedResult.name}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting padding: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Axis Align Tool
  server.tool(
    "set_axis_align",
    "Set primary and counter axis alignment for an auto-layout frame",
    {
      nodeId: z.string().describe("The ID of the frame to modify"),
      primaryAxisAlignItems: z
        .enum(["MIN", "MAX", "CENTER", "SPACE_BETWEEN"])
        .optional()
        .describe("Primary axis alignment"),
      counterAxisAlignItems: z.enum(["MIN", "MAX", "CENTER", "BASELINE"]).optional().describe("Counter axis alignment"),
    },
    async ({ nodeId, primaryAxisAlignItems, counterAxisAlignItems }) => {
      try {
        const result = await sendCommandToFigma("set_axis_align", {
          nodeId,
          primaryAxisAlignItems,
          counterAxisAlignItems,
        });
        const typedResult = result as { name: string };

        const alignMessages = [];
        if (primaryAxisAlignItems !== undefined) alignMessages.push(`primary: ${primaryAxisAlignItems}`);
        if (counterAxisAlignItems !== undefined) alignMessages.push(`counter: ${counterAxisAlignItems}`);

        const alignText = alignMessages.length > 0 ? `axis alignment (${alignMessages.join(", ")})` : "axis alignment";

        return {
          content: [
            {
              type: "text",
              text: `Set ${alignText} for frame "${typedResult.name}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting axis alignment: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Layout Sizing Tool
  server.tool(
    "set_layout_sizing",
    "Set horizontal and vertical sizing modes for an auto-layout frame",
    {
      nodeId: z.string().describe("The ID of the frame to modify"),
      layoutSizingHorizontal: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Horizontal sizing mode"),
      layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Vertical sizing mode"),
    },
    async ({ nodeId, layoutSizingHorizontal, layoutSizingVertical }) => {
      try {
        const result = await sendCommandToFigma("set_layout_sizing", {
          nodeId,
          layoutSizingHorizontal,
          layoutSizingVertical,
        });
        const typedResult = result as { name: string };

        const sizingMessages = [];
        if (layoutSizingHorizontal !== undefined) sizingMessages.push(`horizontal: ${layoutSizingHorizontal}`);
        if (layoutSizingVertical !== undefined) sizingMessages.push(`vertical: ${layoutSizingVertical}`);

        const sizingText = sizingMessages.length > 0 ? `layout sizing (${sizingMessages.join(", ")})` : "layout sizing";

        return {
          content: [
            {
              type: "text",
              text: `Set ${sizingText} for frame "${typedResult.name}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting layout sizing: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Item Spacing Tool
  server.tool(
    "set_item_spacing",
    "Set distance between children in an auto-layout frame",
    {
      nodeId: z.string().describe("The ID of the frame to modify"),
      itemSpacing: z.coerce.number().optional().describe("Distance between children"),
      counterAxisSpacing: z.coerce.number().optional().describe("Distance between wrapped rows/columns"),
    },
    async ({ nodeId, itemSpacing, counterAxisSpacing }) => {
      try {
        const params: any = { nodeId };
        if (itemSpacing !== undefined) params.itemSpacing = itemSpacing;
        if (counterAxisSpacing !== undefined) params.counterAxisSpacing = counterAxisSpacing;

        const result = await sendCommandToFigma("set_item_spacing", params);
        const typedResult = result as {
          name: string;
          itemSpacing?: number;
          counterAxisSpacing?: number;
        };

        let message = `Updated spacing for frame "${typedResult.name}":`;
        if (itemSpacing !== undefined) message += ` itemSpacing=${itemSpacing}`;
        if (counterAxisSpacing !== undefined) message += ` counterAxisSpacing=${counterAxisSpacing}`;

        return {
          content: [
            {
              type: "text",
              text: message,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting item spacing: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Corner Radius Tool
  server.tool(
    "set_corner_radius",
    "Set the corner radius of a node in Figma",
    {
      nodeId: z.string().describe("The ID of the node to modify"),
      radius: z.coerce.number().min(0).describe("Corner radius value"),
      corners: coerceArray(z.array(z.coerce.boolean()).length(4))
        .optional()
        .describe(
          "Optional array of 4 booleans to specify which corners to round [topLeft, topRight, bottomRight, bottomLeft]",
        ),
    },
    async ({ nodeId, radius, corners }) => {
      try {
        const result = await sendCommandToFigma("set_corner_radius", {
          nodeId,
          radius,
          corners: corners || [true, true, true, true],
        });
        const typedResult = result as { name: string };
        return {
          content: [
            {
              type: "text",
              text: `Set corner radius of node "${typedResult.name}" to ${radius}px`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting corner radius: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Auto Layout Tool
  server.tool(
    "set_auto_layout",
    "Configure auto layout properties for a node in Figma. Note: FILL sizing is only valid when the node is a child of another auto-layout frame. For top-level or standalone frames, use FIXED or HUG.",
    {
      nodeId: z.string().describe("The ID of the node to configure auto layout"),
      layoutMode: z.enum(["HORIZONTAL", "VERTICAL", "NONE"]).describe("Layout direction"),
      paddingTop: z.coerce.number().optional().describe("Top padding in pixels"),
      paddingBottom: z.coerce.number().optional().describe("Bottom padding in pixels"),
      paddingLeft: z.coerce.number().optional().describe("Left padding in pixels"),
      paddingRight: z.coerce.number().optional().describe("Right padding in pixels"),
      itemSpacing: z.coerce.number().optional().describe("Spacing between items in pixels"),
      primaryAxisAlignItems: z
        .enum(["MIN", "CENTER", "MAX", "SPACE_BETWEEN"])
        .optional()
        .describe("Alignment along primary axis"),
      counterAxisAlignItems: z.enum(["MIN", "CENTER", "MAX"]).optional().describe("Alignment along counter axis"),
      layoutWrap: z.enum(["WRAP", "NO_WRAP"]).optional().describe("Whether items wrap to new lines"),
      strokesIncludedInLayout: z.coerce.boolean().optional().describe("Whether strokes are included in layout calculations"),
      clipsContent: z.coerce.boolean().optional().describe("Whether to clip content outside frame bounds"),
      layoutSizingHorizontal: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe("Horizontal sizing mode. FILL only works inside an auto-layout parent; defaults to FIXED for top-level frames, FILL for nested frames."),
      layoutSizingVertical: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe("Vertical sizing mode. FILL only works inside an auto-layout parent; defaults to HUG."),
    },
    async ({
      nodeId,
      layoutMode,
      paddingTop,
      paddingBottom,
      paddingLeft,
      paddingRight,
      itemSpacing,
      primaryAxisAlignItems,
      counterAxisAlignItems,
      layoutWrap,
      strokesIncludedInLayout,
      clipsContent,
      layoutSizingHorizontal,
      layoutSizingVertical,
    }) => {
      try {
        const result = await sendCommandToFigma("set_auto_layout", {
          nodeId,
          layoutMode,
          paddingTop,
          paddingBottom,
          paddingLeft,
          paddingRight,
          itemSpacing,
          primaryAxisAlignItems,
          counterAxisAlignItems,
          layoutWrap,
          strokesIncludedInLayout,
          clipsContent,
          layoutSizingHorizontal,
          layoutSizingVertical,
        });

        const typedResult = result as { name: string };
        return {
          content: [
            {
              type: "text",
              text: `Applied auto layout to node "${typedResult.name}" with mode: ${layoutMode}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting auto layout: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Effects Tool
  server.tool(
    "set_effects",
    "Set the visual effects of a node in Figma. Supports DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, BACKGROUND_BLUR, and beta types NOISE (grain overlay), TEXTURE (frosted texture), GLASS (frosted glass with refraction, frame-only).",
    {
      nodeId: z.string().describe("The ID of the node to modify"),
      effects: coerceArray(
        z.array(
          z.object({
            type: z
              .enum(["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR", "NOISE", "TEXTURE", "GLASS"])
              .describe("Effect type"),
            color: z
              .object({
                r: z.coerce.number().min(0).max(1).describe("Red (0-1)"),
                g: z.coerce.number().min(0).max(1).describe("Green (0-1)"),
                b: z.coerce.number().min(0).max(1).describe("Blue (0-1)"),
                a: z.coerce.number().min(0).max(1).describe("Alpha (0-1)"),
              })
              .optional()
              .describe("Effect color (for shadows and NOISE)"),
            offset: z
              .object({
                x: z.coerce.number().describe("X offset"),
                y: z.coerce.number().describe("Y offset"),
              })
              .optional()
              .describe("Offset (for shadows)"),
            radius: z.coerce.number().optional().describe("Effect radius (blur radius for blurs/TEXTURE/GLASS)"),
            spread: z.coerce.number().optional().describe("Shadow spread (for shadows)"),
            visible: z.coerce.boolean().optional().describe("Whether the effect is visible"),
            blendMode: z.string().optional().describe("Blend mode"),
            noiseType: z
              .enum(["MONOTONE", "DUOTONE", "MULTITONE"])
              .optional()
              .describe("Noise variant (NOISE only, default MONOTONE)"),
            noiseSize: z.coerce.number().optional().describe("Grain size (NOISE/TEXTURE)"),
            density: z.coerce.number().optional().describe("Grain density (NOISE)"),
            secondaryColor: z
              .object({
                r: z.coerce.number().min(0).max(1).describe("Red (0-1)"),
                g: z.coerce.number().min(0).max(1).describe("Green (0-1)"),
                b: z.coerce.number().min(0).max(1).describe("Blue (0-1)"),
                a: z.coerce.number().min(0).max(1).describe("Alpha (0-1)"),
              })
              .optional()
              .describe("Secondary color (NOISE DUOTONE only)"),
            opacity: z.coerce.number().min(0).max(1).optional().describe("Opacity (NOISE MULTITONE only)"),
            clipToShape: z.coerce.boolean().optional().describe("Clip texture to shape bounds (TEXTURE only, default true)"),
            lightIntensity: z.coerce.number().optional().describe("Light intensity (GLASS only)"),
            lightAngle: z.coerce.number().optional().describe("Light angle in degrees (GLASS only)"),
            refraction: z.coerce.number().optional().describe("Refraction amount (GLASS only)"),
            depth: z.coerce.number().optional().describe("Depth amount (GLASS only)"),
            dispersion: z.coerce.number().optional().describe("Chromatic dispersion (GLASS only)"),
          }),
        ),
      ).describe("Array of effects to apply"),
    },
    async ({ nodeId, effects }) => {
      try {
        const result = await sendCommandToFigma("set_effects", {
          nodeId,
          effects,
        });

        const typedResult = result as { name: string; effects: any[] };

        return {
          content: [
            {
              type: "text",
              text: `Successfully applied ${effects.length} effect(s) to node "${typedResult.name}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting effects: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Effect Style ID Tool
  server.tool(
    "set_effect_style_id",
    "Apply an effect style to a node in Figma",
    {
      nodeId: z.string().describe("The ID of the node to modify"),
      effectStyleId: z.string().describe("The ID of the effect style to apply"),
    },
    async ({ nodeId, effectStyleId }) => {
      try {
        const result = await sendCommandToFigma("set_effect_style_id", {
          nodeId,
          effectStyleId,
        });

        const typedResult = result as { name: string; effectStyleId: string };

        return {
          content: [
            {
              type: "text",
              text: `Successfully applied effect style to node "${typedResult.name}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting effect style: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Shared schema for effect style operations
  const effectStyleEntrySchema = z.object({
    type: z.enum(["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR"]).describe("Effect type"),
    color: z
      .object({
        r: z.coerce.number().min(0).max(1).describe("Red (0-1)"),
        g: z.coerce.number().min(0).max(1).describe("Green (0-1)"),
        b: z.coerce.number().min(0).max(1).describe("Blue (0-1)"),
        a: z.coerce.number().min(0).max(1).describe("Alpha (0-1)"),
      })
      .optional()
      .describe("Effect color (for shadows)"),
    offset: z
      .object({
        x: z.coerce.number().describe("X offset"),
        y: z.coerce.number().describe("Y offset"),
      })
      .optional()
      .describe("Offset (for shadows)"),
    radius: z.coerce.number().optional().describe("Blur radius"),
    spread: z.coerce.number().optional().describe("Shadow spread (for shadows)"),
    visible: z.coerce.boolean().optional().describe("Whether the effect is visible"),
    blendMode: z.string().optional().describe("Blend mode"),
  });

  // Create Effect Style Tool
  server.tool(
    "create_effect_style",
    "Create a new effect style in Figma (e.g., shadow, blur). The style can then be applied to nodes using set_effect_style_id.",
    {
      name: z.string().describe("Name of the effect style (e.g., 'shadow/sm', 'shadow/md', 'blur/overlay')"),
      effects: coerceArray(z.array(effectStyleEntrySchema)).describe("Array of effects for the style"),
      description: z.string().optional().describe("Description of the effect style"),
    },
    async ({ name, effects, description }) => {
      try {
        const result = await sendCommandToFigma<CreateEffectStyleResult>("create_effect_style", {
          name,
          effects,
          description,
        });
        return {
          content: [
            {
              type: "text",
              text: `Created effect style "${result?.name || name}" (ID: ${result?.id || "-"})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating effect style "${name}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Update Effect Style Tool
  server.tool(
    "update_effect_style",
    "Update an existing effect style's properties (name, effects, description)",
    {
      styleId: z.string().describe("The ID of the effect style to update"),
      name: z.string().optional().describe("New name for the effect style"),
      effects: coerceArray(z.array(effectStyleEntrySchema)).optional().describe("New array of effects for the style"),
      description: z.string().optional().describe("New description for the effect style"),
    },
    async ({ styleId, name, effects, description }) => {
      try {
        const result = await sendCommandToFigma<UpdateEffectStyleResult>("update_effect_style", {
          styleId,
          name,
          effects,
          description,
        });
        return {
          content: [
            {
              type: "text",
              text: `Updated effect style "${result?.name || name || "-"}" (ID: ${result?.id || styleId})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error updating effect style (styleId="${styleId}"): ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Delete Effect Style Tool
  server.tool(
    "delete_effect_style",
    "Delete an effect style from the document",
    {
      styleId: z.string().describe("The ID of the effect style to delete"),
    },
    async ({ styleId }) => {
      try {
        await sendCommandToFigma("delete_effect_style", {
          styleId,
        });
        return {
          content: [
            {
              type: "text",
              text: `Deleted effect style (ID: ${styleId})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting effect style: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Bind Variable Tool
  server.tool(
    "bind_variable",
    "Bind a variable to a node property in Figma (e.g., fill color, stroke weight, opacity)",
    {
      nodeId: z.string().describe("The ID of the node to modify"),
      variableId: z.string().describe("The ID of the variable to bind"),
      field: z
        .string()
        .describe(
          'Property field path to bind to. Examples: "fills/0/color" for fill color, "strokes/0/color" for stroke color, "opacity", "width", "height", "strokeWeight", "cornerRadius", "topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "itemSpacing", "counterAxisSpacing"',
        ),
    },
    async ({ nodeId, variableId, field }) => {
      try {
        const result = await sendCommandToFigma("bind_variable", {
          nodeId,
          variableId,
          field,
        });

        const typedResult = result as {
          nodeId: string;
          nodeName: string;
          field: string;
          variableId: string;
          variableName: string;
          variableType: string;
        };

        return {
          content: [
            {
              type: "text",
              text: `Successfully bound variable "${typedResult.variableName}" (${typedResult.variableType}) to "${typedResult.field}" on node "${typedResult.nodeName}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error binding variable: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Unbind Variable Tool
  server.tool(
    "unbind_variable",
    "Remove a variable binding from a node property in Figma",
    {
      nodeId: z.string().describe("The ID of the node to modify"),
      field: z
        .string()
        .describe(
          'Property field path to unbind. Examples: "fills/0/color" for fill color, "strokes/0/color" for stroke color, "opacity", "strokeWeight", etc.',
        ),
    },
    async ({ nodeId, field }) => {
      try {
        const result = await sendCommandToFigma("unbind_variable", {
          nodeId,
          field,
        });

        const typedResult = result as {
          nodeId: string;
          nodeName: string;
          field: string;
        };

        return {
          content: [
            {
              type: "text",
              text: `Successfully removed variable binding from "${typedResult.field}" on node "${typedResult.nodeName}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error unbinding variable: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Rename Node Tool
  server.tool(
    "rename_node",
    "Rename a node in Figma",
    {
      nodeId: z.string().describe("The ID of the node to rename"),
      name: z.string().describe("The new name for the node"),
    },
    async ({ nodeId, name }) => {
      try {
        const result = await sendCommandToFigma("rename_node", {
          nodeId,
          name,
        });

        const typedResult = result as {
          id: string;
          oldName: string;
          newName: string;
        };

        return {
          content: [
            {
              type: "text",
              text: `Renamed node from "${typedResult.oldName}" to "${typedResult.newName}" (ID: ${typedResult.id})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error renaming node: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Image Fill Tool
  server.tool(
    "set_image_fill",
    "Set an image fill on a node from a URL. Supports PNG, JPEG, and GIF images up to 4096x4096 pixels.",
    {
      nodeId: z.string().describe("The ID of the node to modify"),
      imageUrl: z.string().url().describe("URL of the image (PNG, JPEG, or GIF)"),
      scaleMode: z
        .enum(["FILL", "FIT", "CROP", "TILE"])
        .optional()
        .describe("How the image scales within the node (default: FILL)"),
      rotation: z.coerce.number().optional().describe("Image rotation in degrees (increments of 90, only for FILL/FIT/TILE)"),
      exposure: z.coerce.number().min(-1).max(1).optional().describe("Exposure adjustment (-1 to 1, default: 0)"),
      contrast: z.coerce.number().min(-1).max(1).optional().describe("Contrast adjustment (-1 to 1, default: 0)"),
      saturation: z.coerce.number().min(-1).max(1).optional().describe("Saturation adjustment (-1 to 1, default: 0)"),
      temperature: z.coerce.number().min(-1).max(1).optional().describe("Temperature adjustment (-1 to 1, default: 0)"),
      tint: z.coerce.number().min(-1).max(1).optional().describe("Tint adjustment (-1 to 1, default: 0)"),
      highlights: z.coerce.number().min(-1).max(1).optional().describe("Highlights adjustment (-1 to 1, default: 0)"),
      shadows: z.coerce.number().min(-1).max(1).optional().describe("Shadows adjustment (-1 to 1, default: 0)"),
    },
    async ({
      nodeId,
      imageUrl,
      scaleMode,
      rotation,
      exposure,
      contrast,
      saturation,
      temperature,
      tint,
      highlights,
      shadows,
    }) => {
      try {
        const result = await sendCommandToFigma("set_image_fill", {
          nodeId,
          imageUrl,
          scaleMode: scaleMode || "FILL",
          rotation,
          exposure,
          contrast,
          saturation,
          temperature,
          tint,
          highlights,
          shadows,
        });
        const typedResult = result as {
          id: string;
          name: string;
          imageHash: string;
          imageSize: { width: number; height: number };
          scaleMode: string;
        };
        return {
          content: [
            {
              type: "text",
              text: `Set image fill on "${typedResult.name}" (${typedResult.imageSize.width}x${typedResult.imageSize.height}px, scaleMode: ${typedResult.scaleMode})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting image fill: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Gradient Fill Tool
  server.tool(
    "set_gradient_fill",
    "Set a gradient fill on a node. Supports LINEAR, RADIAL, ANGULAR, and DIAMOND gradient types.",
    {
      nodeId: z.string().describe("The ID of the node to modify"),
      gradientType: z.enum(["LINEAR", "RADIAL", "ANGULAR", "DIAMOND"]).describe("Type of gradient"),
      stops: coerceArray(
        z
          .array(
            z.object({
              color: z.object({
                r: z.coerce.number().min(0).max(1).describe("Red channel (0-1)"),
                g: z.coerce.number().min(0).max(1).describe("Green channel (0-1)"),
                b: z.coerce.number().min(0).max(1).describe("Blue channel (0-1)"),
                a: z.coerce.number().min(0).max(1).optional().describe("Alpha channel (0-1, default 1)"),
              }),
              position: z.coerce.number().min(0).max(1).describe("Stop position (0-1)"),
            }),
          )
          .min(2),
      ).describe("Array of gradient color stops (minimum 2)"),
      angle: z.coerce.number().optional().describe("Gradient angle in degrees (LINEAR only, default 0)"),
      opacity: z.coerce.number().min(0).max(1).optional().describe("Overall fill opacity (0-1, default 1)"),
    },
    async ({ nodeId, gradientType, stops, angle, opacity }) => {
      try {
        const result = await sendCommandToFigma("set_gradient_fill", {
          nodeId,
          gradientType,
          stops,
          angle: angle ?? 0,
          opacity: opacity ?? 1,
        });

        const typedResult = result as {
          id: string;
          name: string;
          gradientType: string;
          stopsCount: number;
        };

        return {
          content: [
            {
              type: "text",
              text: `Set ${typedResult.gradientType} gradient fill on "${typedResult.name}" with ${typedResult.stopsCount} stops`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting gradient fill: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}
