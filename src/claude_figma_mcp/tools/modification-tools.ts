import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { applyColorDefaults, applyDefault, FIGMA_DEFAULTS } from "../utils/defaults";
import { Color } from "../types/color";
import { coerceArray } from "../utils/coerce-array.js";
import { mcpBooleanSchema } from "../utils/mcp-boolean.js";
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
    "Set the fill color of a node in Figma. Accepts either a hex color string (e.g. '#ff0000', '#ff000080' with alpha) or individual r,g,b,a channels (0–1). Alpha defaults to 1 (fully opaque) if not specified.",
    {
      nodeId: z.string().describe("Node ID (e.g. '123:456') — get from get_selection or get_node_info"),
      color: z.string().optional().describe("Hex color string (e.g. '#ff0000', '#f00', '#ff000080' for alpha). Use this OR r,g,b,a — not both."),
      r: z.preprocess((v) => (typeof v === "boolean" || v === null ? undefined : v), z.coerce.number().min(0).max(1)).optional().describe("Red channel, normalized 0–1 (e.g. 1 = full red)"),
      g: z.preprocess((v) => (typeof v === "boolean" || v === null ? undefined : v), z.coerce.number().min(0).max(1)).optional().describe("Green channel, normalized 0–1"),
      b: z.preprocess((v) => (typeof v === "boolean" || v === null ? undefined : v), z.coerce.number().min(0).max(1)).optional().describe("Blue channel, normalized 0–1"),
      a: z.preprocess((v) => (typeof v === "boolean" || v === null ? undefined : v), z.coerce.number().min(0).max(1)).optional().describe("Alpha/opacity, normalized 0–1 (default: 1 = fully opaque; 0 = fully transparent)"),
    },
    async ({ nodeId, color, r, g, b, a }) => {
      try {
        // Build params for the plugin handler (which handles both hex and rgba)
        const params: Record<string, unknown> = { nodeId };
        if (color !== undefined) {
          params.color = color;
        } else {
          if (r === undefined || g === undefined || b === undefined) {
            throw new Error("Provide either 'color' (hex string) or r, g, b components");
          }
          const colorInput: Color = { r, g, b, a };
          params.color = applyColorDefaults(colorInput);
        }

        const result = await sendCommandToFigma("set_fill_color", params);
        const typedResult = result as { name: string };
        const colorDesc = color !== undefined ? color : `RGBA(${r}, ${g}, ${b}, ${a ?? 1})`;
        return {
          content: [
            {
              type: "text",
              text: `Set fill color of node "${typedResult.name}" to ${colorDesc}`,
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
    "Set the stroke color of a node in Figma. Accepts either a hex color string (e.g. '#ff0000', '#ff000080' with alpha) or individual r,g,b,a channels (0–1). Defaults: opacity 1, weight 1.",
    {
      nodeId: z.string().describe("Node ID (e.g. '123:456') — get from get_selection or get_node_info"),
      color: z.string().optional().describe("Hex color string (e.g. '#ff0000', '#f00', '#ff000080' for alpha). Use this OR r,g,b,a — not both."),
      r: z.coerce.number().min(0).max(1).optional().describe("Red channel, normalized 0–1"),
      g: z.coerce.number().min(0).max(1).optional().describe("Green channel, normalized 0–1"),
      b: z.coerce.number().min(0).max(1).optional().describe("Blue channel, normalized 0–1"),
      a: z.coerce.number().min(0).max(1).optional().describe("Alpha/opacity, normalized 0–1 (default: 1 = fully opaque; 0 = fully transparent)"),
      weight: z.coerce.number().min(0).optional().describe("Stroke thickness in pixels ≥ 0 (default: 1; use 0 for invisible stroke)"),
    },
    async ({ nodeId, color, r, g, b, a, weight }) => {
      try {
        const params: Record<string, unknown> = { nodeId };
        if (color !== undefined) {
          params.color = color;
        } else {
          if (r === undefined || g === undefined || b === undefined) {
            throw new Error("Provide either 'color' (hex string) or r, g, b components");
          }
          const colorInput: Color = { r, g, b, a };
          params.color = applyColorDefaults(colorInput);
        }

        const strokeWeightWithDefault = applyDefault(weight, FIGMA_DEFAULTS.stroke.weight);
        params.strokeWeight = strokeWeightWithDefault;

        const result = await sendCommandToFigma("set_stroke_color", params);
        const typedResult = result as { name: string };
        const colorDesc = color !== undefined ? color : `RGBA(${r}, ${g}, ${b}, ${a ?? 1})`;
        return {
          content: [
            {
              type: "text",
              text: `Set stroke color of node "${typedResult.name}" to ${colorDesc} with weight ${strokeWeightWithDefault}`,
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
      nodeId: z.string().describe("Node ID to move — get from get_selection or get_node_info"),
      x: z.coerce.number().optional().describe("New X position in pixels, relative to the canvas (or parent frame if nested)"),
      y: z.coerce.number().optional().describe("New Y position in pixels, relative to the canvas (or parent frame if nested)"),
      parentId: z.string().optional().describe("ID of the new parent node to move the node into"),
      index: z.coerce.number().optional().describe("Index position within the new parent's children"),
    },
    async ({ nodeId, x, y, parentId, index }) => {
      if (x === undefined && y === undefined && parentId === undefined) {
        return {
          content: [{ type: "text", text: "Error: provide x/y for repositioning or parentId for reparenting" }],
        };
      }
      try {
        const result = await sendCommandToFigma("move_node", { nodeId, x, y, parentId, index });
        const typedResult = result as { name: string };
        const posInfo = x !== undefined && y !== undefined ? ` to position (${x}, ${y})` : "";
        const parentInfo = parentId ? ` into parent ${parentId}` : "";
        return {
          content: [
            {
              type: "text",
              text: `Moved node "${typedResult.name}"${posInfo}${parentInfo}`,
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
      nodeId: z.string().describe("Node ID to resize — get from get_selection or get_node_info"),
      width: z.coerce.number().positive().describe("New width in pixels (must be > 0)"),
      height: z.coerce.number().positive().describe("New height in pixels (must be > 0)"),
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
      nodeId: z.string().describe("Frame node ID — must be a FRAME type, not a group"),
      mode: z.enum(["NONE", "HORIZONTAL", "VERTICAL"]).describe("Layout direction: NONE = no auto-layout, HORIZONTAL = children flow left-to-right, VERTICAL = children flow top-to-bottom"),
      wrap: z.enum(["NO_WRAP", "WRAP"]).optional().describe("WRAP = children wrap to next row/column when they overflow (only applies in HORIZONTAL or VERTICAL mode; default: NO_WRAP)"),
    },
    async ({ nodeId, mode, wrap }) => {
      try {
        const result = await sendCommandToFigma("set_layout_mode", {
          nodeId,
          layoutMode: mode,
          layoutWrap: wrap || "NO_WRAP",
        });
        const typedResult = result as { name: string };
        return {
          content: [
            {
              type: "text",
              text: `Set layout mode of frame "${typedResult.name}" to ${mode}`,
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
      nodeId: z.string().describe("Frame node ID — frame must have auto-layout enabled (set_layout_mode first)"),
      top: z.coerce.number().optional().describe("Top padding in pixels (≥ 0; omit to leave unchanged)"),
      right: z.coerce.number().optional().describe("Right padding in pixels (≥ 0; omit to leave unchanged)"),
      bottom: z.coerce.number().optional().describe("Bottom padding in pixels (≥ 0; omit to leave unchanged)"),
      left: z.coerce.number().optional().describe("Left padding in pixels (≥ 0; omit to leave unchanged)"),
    },
    async ({ nodeId, top, right, bottom, left }) => {
      try {
        const result = await sendCommandToFigma("set_padding", {
          nodeId,
          paddingTop: top,
          paddingRight: right,
          paddingBottom: bottom,
          paddingLeft: left,
        });
        const typedResult = result as { name: string };

        const paddingMessages = [];
        if (top !== undefined) paddingMessages.push(`top: ${top}`);
        if (right !== undefined) paddingMessages.push(`right: ${right}`);
        if (bottom !== undefined) paddingMessages.push(`bottom: ${bottom}`);
        if (left !== undefined) paddingMessages.push(`left: ${left}`);

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
      nodeId: z.string().describe("Auto-layout frame node ID — frame must have auto-layout enabled"),
      primaryAxisAlignItems: z
        .enum(["MIN", "MAX", "CENTER", "SPACE_BETWEEN"])
        .optional()
        .describe("Alignment along the primary axis (the layout direction): MIN = start/left/top, CENTER = center, MAX = end/right/bottom, SPACE_BETWEEN = distribute children evenly"),
      counterAxisAlignItems: z.enum(["MIN", "MAX", "CENTER", "BASELINE"]).optional().describe("Alignment along the cross axis (perpendicular to layout direction): MIN = top/left, CENTER = center, MAX = bottom/right, BASELINE = align text baselines (text nodes only)"),
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
      nodeId: z.string().describe("Frame or text node ID — also works on TEXT nodes for width sizing"),
      horizontal: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Horizontal sizing: FIXED = explicit width, HUG = shrink-wrap children, FILL = expand to fill parent (requires node to be inside an auto-layout frame)"),
      vertical: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Vertical sizing: FIXED = explicit height, HUG = shrink-wrap children, FILL = expand to fill parent (requires node to be inside an auto-layout frame)"),
    },
    async ({ nodeId, horizontal, vertical }) => {
      try {
        const result = await sendCommandToFigma("set_layout_sizing", {
          nodeId,
          layoutSizingHorizontal: horizontal,
          layoutSizingVertical: vertical,
        });
        const typedResult = result as { name: string };

        const sizingMessages = [];
        if (horizontal !== undefined) sizingMessages.push(`horizontal: ${horizontal}`);
        if (vertical !== undefined) sizingMessages.push(`vertical: ${vertical}`);

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
      nodeId: z.string().describe("Auto-layout frame node ID — frame must have HORIZONTAL or VERTICAL layout mode"),
      gap: z.coerce.number().optional().describe("Gap between children in pixels along the primary axis (≥ 0; equivalent to CSS gap)"),
      counterAxisSpacing: z.coerce.number().optional().describe("Gap between wrapped rows/columns in pixels (≥ 0; only applies when wrap=WRAP)"),
    },
    async ({ nodeId, gap, counterAxisSpacing }) => {
      try {
        const params: any = { nodeId };
        if (gap !== undefined) params.itemSpacing = gap;
        if (counterAxisSpacing !== undefined) params.counterAxisSpacing = counterAxisSpacing;

        const result = await sendCommandToFigma("set_item_spacing", params);
        const typedResult = result as {
          name: string;
          itemSpacing?: number;
          counterAxisSpacing?: number;
        };

        let message = `Updated spacing for frame "${typedResult.name}":`;
        if (gap !== undefined) message += ` gap=${gap}`;
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
      nodeId: z.string().describe("Node ID of a rectangle, frame, or component — must support corner radius"),
      radius: z.coerce.number().min(0).describe("Corner radius in pixels (≥ 0; applies to all corners unless 'corners' overrides specific ones)"),
      corners: coerceArray(z.array(mcpBooleanSchema).length(4))
        .optional()
        .describe("Array of exactly 4 booleans controlling which corners are rounded: [topLeft, topRight, bottomRight, bottomLeft]. E.g. [true, true, false, false] rounds top corners only. Omit to round all corners."),
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
      nodeId: z.string().describe("Frame node ID to enable/configure auto-layout on"),
      mode: z.enum(["HORIZONTAL", "VERTICAL", "NONE"]).describe("Layout direction: HORIZONTAL = children flow left-to-right, VERTICAL = children flow top-to-bottom, NONE = disable auto-layout"),
      top: z.coerce.number().optional().describe("Top padding in pixels (≥ 0)"),
      bottom: z.coerce.number().optional().describe("Bottom padding in pixels (≥ 0)"),
      left: z.coerce.number().optional().describe("Left padding in pixels (≥ 0)"),
      right: z.coerce.number().optional().describe("Right padding in pixels (≥ 0)"),
      gap: z.coerce.number().optional().describe("Gap between children in pixels along the primary axis (≥ 0; CSS gap equivalent)"),
      primaryAxisAlignItems: z
        .enum(["MIN", "CENTER", "MAX", "SPACE_BETWEEN"])
        .optional()
        .describe("Alignment along the layout direction: MIN = start, CENTER = center, MAX = end, SPACE_BETWEEN = distribute evenly"),
      counterAxisAlignItems: z.enum(["MIN", "CENTER", "MAX"]).optional().describe("Alignment perpendicular to layout direction: MIN = top/left, CENTER = center, MAX = bottom/right"),
      wrap: z.enum(["WRAP", "NO_WRAP"]).optional().describe("WRAP = children wrap to next line when overflow (default: NO_WRAP)"),
      strokesIncludedInLayout: mcpBooleanSchema.optional().describe("true = strokes count toward layout dimensions; false = strokes are outside layout bounds (default: false)"),
      clipsContent: mcpBooleanSchema.optional().describe("true = content outside the frame boundary is hidden (like CSS overflow:hidden); false = content is visible (default: false)"),
      horizontal: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe("Horizontal sizing mode. FILL only works inside an auto-layout parent; defaults to FIXED for top-level frames, FILL for nested frames."),
      vertical: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe("Vertical sizing mode. FILL only works inside an auto-layout parent; defaults to HUG."),
    },
    async ({
      nodeId,
      mode,
      top,
      bottom,
      left,
      right,
      gap,
      primaryAxisAlignItems,
      counterAxisAlignItems,
      wrap,
      strokesIncludedInLayout,
      clipsContent,
      horizontal,
      vertical,
    }) => {
      try {
        const result = await sendCommandToFigma("set_auto_layout", {
          nodeId,
          layoutMode: mode,
          paddingTop: top,
          paddingBottom: bottom,
          paddingLeft: left,
          paddingRight: right,
          itemSpacing: gap,
          primaryAxisAlignItems,
          counterAxisAlignItems,
          layoutWrap: wrap,
          strokesIncludedInLayout,
          clipsContent,
          layoutSizingHorizontal: horizontal,
          layoutSizingVertical: vertical,
        });

        const typedResult = result as { name: string };
        return {
          content: [
            {
              type: "text",
              text: `Applied auto layout to node "${typedResult.name}" with mode: ${mode}`,
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
              .describe("Effect type: DROP_SHADOW = shadow cast outward, INNER_SHADOW = shadow inside the shape, LAYER_BLUR = blurs the node itself, BACKGROUND_BLUR = blurs content behind the node, NOISE = grain/film grain overlay, TEXTURE = frosted texture surface, GLASS = frosted glass with refraction (frames only)"),
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
              .describe("Shadow offset in pixels (DROP_SHADOW and INNER_SHADOW only)"),
            radius: z.coerce.number().optional().describe("Blur radius in pixels ≥ 0 (used for all blur types, TEXTURE, and GLASS; higher = more blur)"),
            spread: z.coerce.number().optional().describe("Shadow expansion in pixels — positive spreads outward, negative contracts (DROP_SHADOW and INNER_SHADOW only)"),
            visible: mcpBooleanSchema.optional().describe("Whether this effect layer is visible (default: true)"),
            blendMode: z.string().optional().describe("CSS-compatible blend mode string, e.g. 'NORMAL', 'MULTIPLY', 'SCREEN', 'OVERLAY' (default: NORMAL)"),
            noiseType: z
              .enum(["MONOTONE", "DUOTONE", "MULTITONE"])
              .optional()
              .describe("Grain color style (NOISE only): MONOTONE = single color grain, DUOTONE = two-color grain (requires secondaryColor), MULTITONE = full color grain (default: MONOTONE)"),
            noiseSize: z.coerce.number().optional().describe("Grain particle size in pixels — larger = coarser grain (NOISE and TEXTURE; typical range 1–100)"),
            density: z.coerce.number().optional().describe("Grain density 0–1 — higher = more grain particles visible (NOISE only; typical range 0.1–0.9)"),
            secondaryColor: z
              .object({
                r: z.coerce.number().min(0).max(1).describe("Red (0-1)"),
                g: z.coerce.number().min(0).max(1).describe("Green (0-1)"),
                b: z.coerce.number().min(0).max(1).describe("Blue (0-1)"),
                a: z.coerce.number().min(0).max(1).describe("Alpha (0-1)"),
              })
              .optional()
              .describe("Second grain color (NOISE DUOTONE only — ignored for MONOTONE/MULTITONE)"),
            opacity: z.coerce.number().min(0).max(1).optional().describe("Effect opacity 0–1 (NOISE MULTITONE only — ignored for MONOTONE/DUOTONE)"),
            clipToShape: mcpBooleanSchema.optional().describe("true = texture is masked to the node's shape; false = texture fills bounding box (TEXTURE only; default: true)"),
            lightIntensity: z.coerce.number().optional().describe("Simulated light brightness 0–1 (GLASS only; typical range 0–1)"),
            lightAngle: z.coerce.number().optional().describe("Light source direction in degrees 0–360, where 0 = top (GLASS only)"),
            refraction: z.coerce.number().optional().describe("Background distortion amount ≥ 0 — higher = more bending of background (GLASS only; typical range 0–50)"),
            depth: z.coerce.number().optional().describe("Perceived 3D depth of the glass surface ≥ 0 (GLASS only; typical range 0–100)"),
            dispersion: z.coerce.number().optional().describe("Chromatic aberration/rainbow fringing amount ≥ 0 (GLASS only; typical range 0–20)"),
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
      effectStyleId: z.string().optional().describe("The ID of the effect style to apply (e.g. 'S:abc123,')"),
      styleName: z.string().optional().describe("The name of the effect style to apply (e.g. 'shadow/md' or 'shadow-md')"),
    },
    async ({ nodeId, effectStyleId, styleName }) => {
      const resolvedStyleId = effectStyleId || styleName;
      if (!resolvedStyleId) {
        return {
          content: [{ type: "text", text: "Error: provide either effectStyleId or styleName" }],
        };
      }
      try {
        const result = await sendCommandToFigma("set_effect_style_id", {
          nodeId,
          effectStyleId: resolvedStyleId,
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
    visible: mcpBooleanSchema.optional().describe("Whether the effect is visible"),
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
      styleId: z.string().describe("The ID or name of the effect style to update (e.g. 'S:abc123,' or 'shadow/md' or 'shadow-md')"),
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
      styleId: z.string().describe("The ID or name of the effect style to delete (e.g. 'S:abc123,' or 'shadow/md' or 'shadow-md')"),
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

  // ── Paint/Color Style Tools ──

  // Shared schema for gradient stops (reused in create and update)
  const gradientStopSchema = z.object({
    color: z.string().describe("Hex color for this stop (e.g. '#ff0000')"),
    position: z.coerce.number().min(0).max(1).describe("Position along gradient 0–1"),
  });

  const gradientSchema = z.object({
    type: z.enum(["LINEAR", "RADIAL", "ANGULAR", "DIAMOND"]).describe("Gradient type"),
    stops: coerceArray(z.array(gradientStopSchema).min(2)).describe("Array of color stops (min 2)"),
    angle: z.coerce.number().optional().describe("Direction in degrees 0–360 (LINEAR only, default 0)"),
    opacity: z.coerce.number().min(0).max(1).optional().describe("Overall opacity 0–1 (default 1)"),
  });

  // Create Color Style Tool
  server.tool(
    "create_color_style",
    "Create a new paint (color) style in Figma — solid color or gradient. The style can then be applied to nodes using set_color_style_id. Provide either 'color' for a solid fill OR 'gradient' for a gradient fill.",
    {
      name: z.string().describe("Name of the color style (e.g., 'color/primary', 'brand/blue')"),
      color: z.string().optional().describe("Hex color string for solid fill (e.g. '#ff0000'). Use this OR gradient, not both."),
      gradient: gradientSchema.optional().describe("Gradient definition. Use this OR color, not both."),
      description: z.string().optional().describe("Description of the color style"),
    },
    async ({ name, color, gradient, description }) => {
      try {
        const result = await sendCommandToFigma("create_color_style", {
          name,
          ...(color !== undefined && { color }),
          ...(gradient !== undefined && { gradient }),
          ...(description !== undefined && { description }),
        });
        const typedResult = result as { name?: string; id?: string };
        return {
          content: [
            {
              type: "text",
              text: `Created color style "${typedResult.name || name}" (ID: ${typedResult.id || "-"})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating color style "${name}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Get Color Styles Tool
  server.tool(
    "get_color_styles",
    "List all local paint (color) styles in the Figma document with their colors",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_color_styles", {});
        return {
          content: [
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
              text: `Error getting color styles: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Get Color Style Tool
  server.tool(
    "get_color_style",
    "Get details of a single paint (color) style by ID or name",
    {
      styleId: z.string().describe("The ID or name of the color style (e.g. 'S:abc123,' or 'color/primary' or 'color-primary')"),
    },
    async ({ styleId }) => {
      try {
        const result = await sendCommandToFigma("get_color_style", { styleId });
        return {
          content: [
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
              text: `Error getting color style: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Update Color Style Tool
  server.tool(
    "update_color_style",
    "Update an existing paint (color) style's properties (name, color/gradient, description). Provide 'color' for solid fill or 'gradient' for gradient fill.",
    {
      styleId: z.string().describe("The ID or name of the color style to update (e.g. 'S:abc123,' or 'color/primary' or 'color-primary')"),
      name: z.string().optional().describe("New name for the color style"),
      color: z.string().optional().describe("New hex color string for solid fill (e.g. '#ff0000'). Use this OR gradient, not both."),
      gradient: gradientSchema.optional().describe("New gradient definition. Use this OR color, not both."),
      description: z.string().optional().describe("New description for the color style"),
    },
    async ({ styleId, name, color, gradient, description }) => {
      try {
        const result = await sendCommandToFigma("update_color_style", {
          styleId,
          ...(name !== undefined && { name }),
          ...(color !== undefined && { color }),
          ...(gradient !== undefined && { gradient }),
          ...(description !== undefined && { description }),
        });
        const typedResult = result as { name?: string; id?: string };
        return {
          content: [
            {
              type: "text",
              text: `Updated color style "${typedResult.name || name || "-"}" (ID: ${typedResult.id || styleId})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error updating color style (styleId="${styleId}"): ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Delete Color Style Tool
  server.tool(
    "delete_color_style",
    "Delete a paint (color) style from the document",
    {
      styleId: z.string().describe("The ID or name of the color style to delete (e.g. 'S:abc123,' or 'color/primary' or 'color-primary')"),
    },
    async ({ styleId }) => {
      try {
        await sendCommandToFigma("delete_color_style", { styleId });
        return {
          content: [
            {
              type: "text",
              text: `Deleted color style (ID: ${styleId})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting color style: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Color Style ID Tool
  server.tool(
    "set_color_style_id",
    "Apply a paint (color) style to a node's fill in Figma",
    {
      nodeId: z.string().describe("The ID of the node to modify"),
      styleId: z.string().optional().describe("The ID of the color style to apply (e.g. 'S:abc123,')"),
      styleName: z.string().optional().describe("The name of the color style to apply (e.g. 'color/primary' or 'color-primary')"),
    },
    async ({ nodeId, styleId, styleName }) => {
      const resolvedStyleId = styleId || styleName;
      if (!resolvedStyleId) {
        return {
          content: [{ type: "text", text: "Error: provide either styleId or styleName" }],
        };
      }
      try {
        const result = await sendCommandToFigma("set_color_style_id", {
          nodeId,
          styleId: resolvedStyleId,
        });
        const typedResult = result as { name?: string };
        return {
          content: [
            {
              type: "text",
              text: `Successfully applied color style to node "${typedResult.name || nodeId}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting color style: ${error instanceof Error ? error.message : String(error)}`,
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
      variableId: z.string().describe("The ID or name of the variable to bind (e.g. 'VariableID:1:2' or 'background/primary' or 'background-primary')"),
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
          name: string;
          field: string;
          variableId: string;
          variableName: string;
          variableType: string;
        };

        return {
          content: [
            {
              type: "text",
              text: `Successfully bound variable "${typedResult.variableName}" (${typedResult.variableType}) to "${typedResult.field}" on node "${typedResult.name}"`,
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
          name: string;
          field: string;
        };

        return {
          content: [
            {
              type: "text",
              text: `Successfully removed variable binding from "${typedResult.field}" on node "${typedResult.name}"`,
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
        .describe("How the image scales within the node (default: FILL): FILL = cover the entire area (may crop), FIT = fit entirely inside (may letterbox), CROP = manual crop with transform handles, TILE = repeat/tile the image"),
      rotation: z.coerce.number().optional().describe("Image rotation in degrees — must be a multiple of 90 (0, 90, 180, 270). Only applies to FILL, FIT, and TILE modes; ignored for CROP."),
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
      nodeId: z.string().describe("Node ID to apply the gradient fill to"),
      type: z.enum(["LINEAR", "RADIAL", "ANGULAR", "DIAMOND"]).describe("Gradient shape: LINEAR = straight line between two points, RADIAL = circular/elliptical from center outward, ANGULAR = conic/sweep around a center point, DIAMOND = diamond-shaped four-directional"),
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
      angle: z.coerce.number().optional().describe("Gradient direction in degrees 0–360, where 0 = top-to-bottom, 90 = left-to-right (LINEAR only; default: 0)"),
      opacity: z.coerce.number().min(0).max(1).optional().describe("Overall fill opacity 0–1 applied on top of individual stop alphas (default: 1)"),
    },
    async ({ nodeId, type, stops, angle, opacity }) => {
      try {
        const result = await sendCommandToFigma("set_gradient_fill", {
          nodeId,
          gradientType: type,
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
              text: `Set ${type} gradient fill on "${typedResult.name}" with ${typedResult.stopsCount} stops`,
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
