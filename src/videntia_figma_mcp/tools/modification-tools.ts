import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { coerceArray } from "../utils/coerce-array.js";
import { mcpBooleanSchema } from "../utils/mcp-boolean.js";
import { DeleteMultipleNodesResult, CreateEffectStyleResult, UpdateEffectStyleResult } from "../types";
import { normalizeNodeId } from "../utils/figma-helpers.js";
import { normalizeCommandParams } from "../utils/command-params.js";
import { constraintTypeSchema } from "../utils/constraints-schema.js";
import { formatState, returnStateParam } from "../utils/return-state.js";
import { allowSideEffectsParam, expectSideEffectsParam } from "../utils/side-effects.js";
import { readImageFileAsBase64 } from "../utils/image-file-input.js";
import { colorParam, toRgba, resolveColorWithAlpha, COLOR_INPUT_DESCRIPTION } from "../utils/color-input.js";
import { formatPlacement, parentRelativePositionDescription } from "../utils/position-docs.js";
import { isGradientDirection, sortGradientStops } from "../utils/gradient-geometry.js";
import { expandPadding, paddingShorthandSchema, PADDING_SHORTHAND_DESCRIPTION } from "../utils/frame-layout.js";

/** Normalize the `color` on each effect entry to 0-1 {r,g,b,a}. */
function normalizeEffectColors<T extends { color?: unknown; secondaryColor?: unknown }>(effects: T[]): T[] {
  return effects.map((effect) => {
    const next: T = { ...effect };
    if (next.color !== undefined) next.color = toRgba(next.color);
    if (next.secondaryColor !== undefined) next.secondaryColor = toRgba(next.secondaryColor);
    return next;
  });
}

const channelParam = z.preprocess(
  (v) => (typeof v === "boolean" || v === null ? undefined : v),
  z.coerce.number().min(0).max(255),
);

/**
 * Register modification tools to the MCP server
 * This module contains tools for modifying existing elements in Figma
 * @param server - The MCP server instance
 */
const variableRef = (field: string) =>
  z
    .string()
    .optional()
    .describe(
      `Variable name or ID to bind the effect's ${field} to (e.g. 'shadow/color'); the raw value is the fallback`,
    );

/** Optional per-effect variable bindings shared by set_effects and the effect style tools. */
const effectVariableParams = {
  colorVariable: variableRef("color (COLOR variable; DROP_SHADOW/INNER_SHADOW)"),
  radiusVariable: variableRef("radius (FLOAT variable; shadows and LAYER_BLUR/BACKGROUND_BLUR)"),
  spreadVariable: variableRef("spread (FLOAT variable; shadows only)"),
  offsetXVariable: variableRef("offset.x (FLOAT variable; shadows only)"),
  offsetYVariable: variableRef("offset.y (FLOAT variable; shadows only)"),
};

/**
 * Widen the shapes callers actually write for gradient stops into the canonical
 * `{color, position}` array.
 *
 * These coercions used to live in the batch-only param normaliser, which meant a
 * gradient written one way worked in a batch and failed standalone. They belong on the
 * schema, where both call paths get them.
 */
function normalizeGradientStops(value: unknown): unknown {
  let stops = value;
  if (typeof stops === "string") {
    try {
      const parsed = JSON.parse(stops);
      if (Array.isArray(parsed)) stops = parsed;
    } catch {
      return value; // leave it; zod reports a precise error
    }
  }
  if (!Array.isArray(stops)) return stops;
  const all = stops as unknown[];
  const evenly = (i: number) => (all.length > 1 ? i / (all.length - 1) : 0);
  return all.map((stop, i) => {
    if (typeof stop === "string") return { color: stop, position: evenly(i) };
    if (stop === null || typeof stop !== "object") return stop;
    const o = { ...(stop as Record<string, unknown>) };
    if (o.color === undefined && o.hex !== undefined) o.color = o.hex;
    if (o.color === undefined && o.r !== undefined) {
      o.color = { r: o.r, g: o.g, b: o.b, ...(o.a !== undefined ? { a: o.a } : {}) };
      delete o.r;
      delete o.g;
      delete o.b;
      delete o.a;
    }
    if (o.position === undefined && o.offset !== undefined) o.position = o.offset;
    if (o.position === undefined) o.position = evenly(i);
    return o;
  });
}

const imageScalingFactorParam = z.coerce
  .number()
  .positive()
  .optional()
  .describe(
    "TILE only: tile size as a multiple of the image's natural size (0.5 = half-size tiles, 2 = double). Implies scaleMode TILE when scaleMode is omitted; an error with any other scaleMode. Aliases: `tileScale`, `scale`.",
  );

/** scaleMode + scalingFactor for the plugin; scalingFactor only means something for TILE. */
export function resolveImageScale(
  scaleMode: string | undefined,
  scalingFactor: number | undefined,
): { scaleMode: string; scalingFactor?: number } {
  if (scalingFactor === undefined) return { scaleMode: scaleMode || "FILL" };
  if (scaleMode !== undefined && scaleMode !== "TILE") {
    throw new Error(
      `scalingFactor only applies to scaleMode TILE (got ${scaleMode}). Drop scalingFactor, or use scaleMode "TILE".`,
    );
  }
  return { scaleMode: "TILE", scalingFactor };
}

const GRADIENT_ANGLE_DESCRIPTION =
  "LINEAR gradient angle in degrees, CSS linear-gradient convention (0 = to top, 90 = to right, 180 = to bottom, 270 = to left, clockwise; default 180). Wins over `direction`.";

const gradientDirectionParam = z
  .string()
  .refine(isGradientDirection, {
    message:
      'direction must be a side/corner keyword: "to top", "to right", "to bottom", "to left", "to top right", "to bottom right", … or Tailwind "t", "r", "b", "l", "tr", "br", "bl", "tl".',
  })
  .optional()
  .describe(
    'LINEAR direction keyword instead of `angle`: "to top" | "to right" | "to bottom" | "to left" | "to top right" | "to bottom right" | "to bottom left" | "to top left", or Tailwind "t" | "r" | "b" | "l" | "tr" | "br" | "bl" | "tl". Corners follow CSS: the angle depends on the aspect ratio so the ramp runs corner to corner.',
  );

export function registerModificationTools(server: McpServer): void {
  // Strict Mode Tool
  server.tool(
    "set_strict_mode",
    "Toggle strict mode. Strict mode is ON by default: any write that Figma silently discards (a 'silent no-op') throws an error instead of reporting success, so you never have to read a node back to find out whether a change landed. Turn it OFF only if you deliberately want discarded writes reported as warnings instead of errors (individual commands can also opt out per call with strict:false).",
    {
      enabled: mcpBooleanSchema.describe(
        "true = silent no-ops throw (DEFAULT); false = they are only reported as warnings on the result",
      ),
      return_state: returnStateParam.describe(
        "Session default for post-write state: when on, EVERY mutating command answers with the node's actual state after the write, so a follow-up get_node_info is never needed.",
      ),
      allow_side_effects: allowSideEffectsParam.describe(
        "Session default for side-effect acknowledgement: when on, an intentional knock-on change (e.g. an auto-layout parent resizing) is kept and reported as a warning instead of throwing. Individual commands override it per call with allow_side_effects / expect_side_effects.",
      ),
    },
    async ({ enabled, return_state, allow_side_effects }) => {
      try {
        const result = (await sendCommandToFigma("set_strict_mode", {
          enabled,
          return_state,
          allow_side_effects,
        })) as {
          strict: boolean;
          returnState?: boolean;
          allowSideEffects?: string[];
        };
        return {
          content: [
            {
              type: "text",
              text: `Strict mode is now ${result.strict ? "ON" : "OFF"}. Post-write state is ${result.returnState ? "ON" : "OFF"}. Acknowledged side effects: ${result.allowSideEffects && result.allowSideEffects.length > 0 ? result.allowSideEffects.join(", ") : "none"}.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting strict mode: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Fill Color Tool
  server.tool(
    "set_fill_color",
    `Set the fill color of a node in Figma. ${COLOR_INPUT_DESCRIPTION} Alternatively pass individual r,g,b,a channels. Alpha defaults to 1 (fully opaque).`,
    {
      nodeId: z.string().describe("Node ID (e.g. '123:456') — get from get_selection or get_node_info"),
      color: colorParam("Fill color. Use this OR r,g,b,a — not both.").optional(),
      r: channelParam.optional().describe("Red channel (0–1 normalized, or 0–255)"),
      g: channelParam.optional().describe("Green channel (0–1 normalized, or 0–255)"),
      b: channelParam.optional().describe("Blue channel (0–1 normalized, or 0–255)"),
      a: channelParam
        .optional()
        .describe(
          "Alpha/opacity (0–1 normalized, or 0–255; default: 1 = fully opaque). Also accepted as `alpha` or `opacity`. When given alongside `color` it OVERRIDES the colour's own alpha.",
        ),
      return_state: returnStateParam,
    },
    async ({ nodeId, color, r, g, b, a, return_state }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        // Build params for the plugin handler (which handles both hex and rgba)
        const params: Record<string, unknown> = { nodeId, return_state };
        if (color !== undefined) {
          // Validate every accepted form here so a bad value never reaches the
          // plugin. Hex strings go through verbatim (the plugin parses them);
          // objects/arrays are normalized to 0–1 {r,g,b,a}.
          params.color = resolveColorWithAlpha(color, a);
        } else {
          if (r === undefined || g === undefined || b === undefined) {
            throw new Error("Provide either 'color' (hex string) or r, g, b components");
          }
          params.color = toRgba({ r, g, b, a });
        }

        const result = await sendCommandToFigma("set_fill_color", params);
        const typedResult = result as { name: string };
        const colorDesc =
          color !== undefined
            ? typeof params.color === "string"
              ? params.color
              : JSON.stringify(params.color)
            : `RGBA(${r}, ${g}, ${b}, ${a ?? 1})`;
        return {
          content: [
            {
              type: "text",
              text: `Set fill color of node "${typedResult.name}" to ${colorDesc}${formatState(result)}`,
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
    "Set the stroke color of a node in Figma. Accepts either a hex color string (e.g. '#ff0000', '#ff000080' with alpha) or individual r,g,b,a channels (0–1). Opacity defaults to 1; omitting weight keeps the node's existing stroke weight. Optionally set dashPattern for a dashed/dotted stroke.",
    {
      nodeId: z.string().describe("Node ID (e.g. '123:456') — get from get_selection or get_node_info"),
      color: colorParam("Stroke color. Use this OR r,g,b,a — not both.").optional(),
      r: channelParam.optional().describe("Red channel (0–1 normalized, or 0–255)"),
      g: channelParam.optional().describe("Green channel (0–1 normalized, or 0–255)"),
      b: channelParam.optional().describe("Blue channel (0–1 normalized, or 0–255)"),
      a: channelParam
        .optional()
        .describe(
          "Alpha/opacity (0–1 normalized, or 0–255; default: 1 = fully opaque). Also accepted as `alpha` or `opacity`. When given alongside `color` it OVERRIDES the colour's own alpha.",
        ),
      weight: z.coerce
        .number()
        .min(0)
        .optional()
        .describe(
          "Stroke thickness in pixels ≥ 0. Omit to keep the node's current stroke weight; use 0 for an invisible stroke.",
        ),
      dashPattern: z
        .array(z.coerce.number().min(0))
        .optional()
        .describe(
          "Dash/gap lengths in pixels, e.g. [4, 4] for an even dashed line, [1, 3] for dotted, [8, 4, 2, 4] for dash-dot. Omit for a solid stroke; pass [] to clear an existing pattern back to solid.",
        ),
    },
    async ({ nodeId, color, r, g, b, a, weight, dashPattern }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const params: Record<string, unknown> = { nodeId };
        if (color !== undefined) {
          // Validate every accepted form here so a bad value never reaches the
          // plugin. Hex strings go through verbatim (the plugin parses them);
          // objects/arrays are normalized to 0–1 {r,g,b,a}.
          params.color = resolveColorWithAlpha(color, a);
        } else {
          if (r === undefined || g === undefined || b === undefined) {
            throw new Error("Provide either 'color' (hex string) or r, g, b components");
          }
          params.color = toRgba({ r, g, b, a });
        }

        // Do NOT substitute a default weight here. Omitting `weight` means
        // "only change the colour" — the plugin preserves the node's existing
        // strokeWeight (and falls back to Figma's own default for a node that
        // has none). Sending a synthetic 1 silently destroyed thick strokes.
        if (weight !== undefined) {
          params.strokeWeight = weight;
        }
        if (dashPattern !== undefined) {
          params.dashPattern = dashPattern;
        }

        const result = await sendCommandToFigma("set_stroke_color", params);
        const typedResult = result as { name: string; strokeWeight?: number };
        const colorDesc =
          color !== undefined
            ? typeof params.color === "string"
              ? params.color
              : JSON.stringify(params.color)
            : `RGBA(${r}, ${g}, ${b}, ${a ?? 1})`;
        // Report the weight the plugin actually ended up with, never a locally
        // assumed one.
        const resultingWeight = typedResult.strokeWeight !== undefined ? typedResult.strokeWeight : weight;
        const weightDesc = resultingWeight !== undefined ? ` with weight ${resultingWeight}` : "";
        return {
          content: [
            {
              type: "text",
              text: `Set stroke color of node "${typedResult.name}" to ${colorDesc}${weightDesc}`,
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

  // Remove Fill Tool
  server.tool(
    "remove_fill",
    "Remove all fills from a node in Figma (sets fills to an empty array). Use this to clear transparent or unwanted fills.",
    {
      nodeId: z.string().describe("Node ID (e.g. '123:456')"),
    },
    async ({ nodeId }) => {
      try {
        nodeId = normalizeNodeId(nodeId);
        const result = await sendCommandToFigma("remove_fill", { nodeId });
        const typedResult = result as { name: string };
        return {
          content: [
            {
              type: "text" as const,
              text: `Removed fills from node "${typedResult.name}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error removing fills: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Remove Stroke Tool
  server.tool(
    "remove_stroke",
    "Remove all strokes from a node in Figma (sets strokes to an empty array). Use this to clear transparent or unwanted strokes.",
    {
      nodeId: z.string().describe("Node ID (e.g. '123:456')"),
    },
    async ({ nodeId }) => {
      try {
        nodeId = normalizeNodeId(nodeId);
        const result = await sendCommandToFigma("remove_stroke", { nodeId });
        const typedResult = result as { name: string };
        return {
          content: [
            {
              type: "text" as const,
              text: `Removed strokes from node "${typedResult.name}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error removing strokes: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Move Node (absolute coordinates) Tool
  server.tool(
    "move_node_absolute",
    "Move a node to ABSOLUTE canvas coordinates — the same frame of reference as absoluteBoundingBox and the Figma inspector. Use this instead of move_node whenever you have canvas coordinates, or right after reparenting a node (move_node's x/y are PARENT-relative, so the same numbers mean something different once the parent changes). The conversion to parent-relative coordinates happens inside the plugin.",
    {
      nodeId: z.string().describe("Node ID to move — get from get_selection or get_node_info"),
      x: z.coerce.number().optional().describe("Target absolute X on the canvas, in pixels"),
      y: z.coerce.number().optional().describe("Target absolute Y on the canvas, in pixels"),
    },
    async ({ nodeId, x, y }) => {
      nodeId = normalizeNodeId(nodeId);
      if (x === undefined && y === undefined) {
        return {
          content: [{ type: "text" as const, text: "Error: provide at least one of x or y (absolute canvas coords)" }],
        };
      }
      try {
        const result = (await sendCommandToFigma("move_node_absolute", { nodeId, x, y })) as {
          name: string;
          x: number;
          y: number;
          absoluteX?: number;
          absoluteY?: number;
          warning?: string;
        };
        const abs = result.absoluteX !== undefined ? ` (absolute ${result.absoluteX}, ${result.absoluteY})` : "";
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Moved node "${result.name}" to parent-relative (${result.x}, ${result.y})${abs}` +
                (result.warning ? `\nWarning: ${result.warning}` : ""),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error moving node: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Move Node Tool
  server.tool(
    "move_node",
    "Move a node to a position relative to its PARENT (for absolute canvas coordinates use move_node_absolute instead), and/or reparent it. Note that after changing parentId, x/y are interpreted against the NEW parent. To change stacking order without moving, use set_layer_order.",
    {
      nodeId: z.string().describe("Node ID to move — get from get_selection or get_node_info"),
      x: z.coerce.number().optional().describe(parentRelativePositionDescription("X")),
      y: z.coerce.number().optional().describe(parentRelativePositionDescription("Y")),
      parentId: z.string().optional().describe("ID of the new parent node to move the node into"),
      index: z.coerce
        .number()
        .optional()
        .describe(
          "Layer index within the new parent's children: 0 = bottom/back of the z-stack (first in auto-layout flow); omit to append on top",
        ),
    },
    async ({ nodeId, x, y, parentId, index }) => {
      nodeId = normalizeNodeId(nodeId);
      if (parentId) parentId = normalizeNodeId(parentId);
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

  // Set Rotation Tool
  server.tool(
    "set_rotation",
    "Rotate a node (degrees, positive = counter-clockwise, the same sign as the Figma inspector). Figma's own rotation pivots on the node's top-left corner; this tool defaults to origin 'center', which keeps the node's centre where it is (what designers expect). Inside an auto-layout parent (non-ABSOLUTE child) the layout owns the position, so only the angle changes.",
    {
      nodeId: z.string().describe("Node ID to rotate — get from get_selection or get_node_info"),
      rotation: z.coerce
        .number()
        .describe("Angle in degrees. Absolute by default; with relative: true it is added to the current rotation"),
      relative: mcpBooleanSchema
        .optional()
        .describe("true = rotate BY this many degrees from the current angle; false (default) = rotate TO it"),
      origin: z
        .enum(["center", "top-left"])
        .optional()
        .describe("Pivot point: 'center' (default) keeps the centre fixed; 'top-left' is Figma's native pivot"),
    },
    async ({ nodeId, rotation, relative, origin }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const result = (await sendCommandToFigma("set_rotation", { nodeId, rotation, relative, origin })) as {
          name: string;
          rotation: number;
          origin: string;
          x?: number;
          y?: number;
          absoluteX?: number;
          absoluteY?: number;
          warnings?: string[];
        };
        const warnings = result.warnings && result.warnings.length > 0 ? `\nWarning: ${result.warnings.join(" ")}` : "";
        return {
          content: [
            {
              type: "text" as const,
              text: `Rotated "${result.name}" to ${result.rotation}° about its ${result.origin}${formatPlacement(result)}${warnings}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error rotating node: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Layer Order Tool
  server.tool(
    "set_layer_order",
    "Reorder a node among its siblings (z-order / layer order) without reparenting. 'front' = top of the stack (drawn above every sibling, last in Figma's children array), 'back' = bottom (index 0), 'forward'/'backward' = one step. A number is the exact target index (0 = back). In an auto-layout parent this also changes flow order (back = first, front = last).",
    {
      nodeId: z.string().describe("Node ID to reorder"),
      position: z
        .union([z.enum(["front", "back", "forward", "backward"]), z.coerce.number().int().min(0)])
        .describe("'front' | 'back' | 'forward' | 'backward', or a zero-based target index (0 = back)"),
    },
    async ({ nodeId, position }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const result = (await sendCommandToFigma("set_layer_order", { nodeId, position })) as {
          name: string;
          previousIndex: number;
          index: number;
          childCount: number;
          parentId: string;
        };
        const change =
          result.previousIndex === result.index
            ? `already at index ${result.index}`
            : `moved from index ${result.previousIndex} to ${result.index}`;
        return {
          content: [
            {
              type: "text" as const,
              text: `Layer "${result.name}" ${change} of ${result.childCount} in parent ${result.parentId} (0 = back, ${result.childCount - 1} = front)`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error reordering layer: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Resize Node Tool
  server.tool(
    "resize_node",
    "Resize a node in Figma. On TEXT nodes that auto-size (textAutoResize HEIGHT or WIDTH_AND_HEIGHT), the new width is kept and textAutoResize becomes HEIGHT, so the text wraps at that width and its height grows to fit (the requested height is not kept). TEXT nodes already fixed (NONE/TRUNCATE) keep the exact width and height. Other node types resize to exactly width × height.",
    {
      nodeId: z.string().describe("Node ID to resize — get from get_selection or get_node_info"),
      width: z.coerce.number().positive().describe("New width in pixels (must be > 0)"),
      height: z.coerce
        .number()
        .positive()
        .describe(
          "New height in pixels (must be > 0). Ignored for auto-sizing TEXT nodes, whose height follows the wrapped text",
        ),
      scale_strokes: z
        .boolean()
        .optional()
        .describe(
          "When true, multiply strokeWeight on the node and every descendant by the resize scale factor. Figma's resize() keeps stroke weights at their original absolute value, so downscaled icons look too heavy and upscaled ones too thin — set this for vector/SVG content.",
        ),
    },
    async ({ nodeId, width, height, scale_strokes }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const result = await sendCommandToFigma("resize_node", {
          nodeId,
          width,
          height,
          ...(scale_strokes ? { scale_strokes: true } : {}),
        });
        const typedResult = result as { name: string; width?: number; height?: number; textAutoResize?: string };
        const text =
          typedResult.textAutoResize !== undefined
            ? `Resized text node "${typedResult.name}" to width ${typedResult.width ?? width} and height ${typedResult.height ?? height} (textAutoResize: ${typedResult.textAutoResize})`
            : `Resized node "${typedResult.name}" to width ${width} and height ${height}`;
        return {
          content: [
            {
              type: "text",
              text,
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
      nodeId = normalizeNodeId(nodeId);
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
      nodeIds = nodeIds.map(normalizeNodeId);
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

  const gridTrackSizesSchema = coerceArray(
    z.array(
      z.object({
        type: z
          .enum(["FIXED", "FLEX", "HUG"])
          .describe("FIXED = pixel size, FLEX = fractional share (CSS fr), HUG = fit content"),
        value: z.coerce
          .number()
          .positive()
          .optional()
          .describe("Pixels for FIXED (required), fr weight for FLEX (optional), omit for HUG"),
      }),
    ),
  );

  // Set Layout Mode Tool
  server.tool(
    "set_layout_mode",
    "Set the layout mode and wrap behavior of a frame in Figma",
    {
      nodeId: z.string().describe("Frame node ID — must be a FRAME type, not a group"),
      mode: z
        .enum(["NONE", "HORIZONTAL", "VERTICAL", "GRID"])
        .optional()
        .describe(
          "Layout direction: NONE = no auto-layout, HORIZONTAL = children flow left-to-right, VERTICAL = children flow top-to-bottom, GRID = children placed on a row/column grid",
        ),
      layoutMode: z
        .enum(["NONE", "HORIZONTAL", "VERTICAL", "GRID"])
        .optional()
        .describe("Alias for `mode` (the Figma property name); `mode` wins if both are given"),
      wrap: z
        .enum(["NO_WRAP", "WRAP"])
        .optional()
        .describe(
          "WRAP = children wrap to next row/column when they overflow (only applies in HORIZONTAL or VERTICAL mode; ignored for GRID). Omit to keep the frame's current wrap setting.",
        ),
      rows: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe("Number of grid rows (GRID mode only; omit to keep Figma's current track count)"),
      columns: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe("Number of grid columns (GRID mode only; omit to keep Figma's current track count)"),
      gridAutoTracks: z
        .enum(["NONE", "ROWS"])
        .optional()
        .describe(
          "GRID mode only. ROWS = automatically add/remove rows to fit children (gridRowCount becomes read-only and cannot be set directly while this is ROWS); NONE = manual row count (default).",
        ),
      gridItemsPositioning: z
        .enum(["MANUAL", "ROW_AUTO_FLOW"])
        .optional()
        .describe(
          "GRID mode only. MANUAL = children stay at their explicitly assigned cell (default); ROW_AUTO_FLOW = children auto-place into the next free cell in row-major order as they're added — reorder via insert_child, not manual cell assignment, in this mode.",
        ),
      rowSizes: gridTrackSizesSchema
        .optional()
        .describe(
          'GRID mode only. One { type, value? } per row, top to bottom, applied after rows — length must equal the row count. E.g. [{"type":"FIXED","value":64},{"type":"FLEX"}]. FLEX tracks are invalid on an axis whose container sizing is HUG.',
        ),
      columnSizes: gridTrackSizesSchema
        .optional()
        .describe(
          "GRID mode only. One { type, value? } per column, left to right, applied after columns — length must equal the column count.",
        ),
    },
    async ({
      nodeId,
      mode: modeArg,
      layoutMode: layoutModeAlias,
      wrap,
      rows,
      columns,
      gridAutoTracks,
      gridItemsPositioning,
      rowSizes,
      columnSizes,
    }) => {
      nodeId = normalizeNodeId(nodeId);
      const mode = modeArg !== undefined ? modeArg : layoutModeAlias;
      if (mode === undefined) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error setting layout mode: missing `mode` (alias: layoutMode) — NONE, HORIZONTAL, VERTICAL or GRID",
            },
          ],
        };
      }
      try {
        if (mode !== "GRID" && (rows !== undefined || columns !== undefined)) {
          throw new Error(`rows/columns apply to GRID mode only (mode is ${mode})`);
        }
        if (mode !== "GRID" && (gridAutoTracks !== undefined || gridItemsPositioning !== undefined)) {
          throw new Error(`gridAutoTracks/gridItemsPositioning apply to GRID mode only (mode is ${mode})`);
        }
        if (mode !== "GRID" && (rowSizes !== undefined || columnSizes !== undefined)) {
          throw new Error(`rowSizes/columnSizes apply to GRID mode only (mode is ${mode})`);
        }
        if (mode === "GRID" && wrap !== undefined) {
          throw new Error("wrap does not apply to GRID mode — grid children are placed on tracks, not wrapped");
        }

        const params: Record<string, unknown> = { nodeId, layoutMode: mode };
        if (mode === "GRID") {
          if (gridAutoTracks !== undefined) params.gridAutoTracks = gridAutoTracks;
          if (gridItemsPositioning !== undefined) params.gridItemsPositioning = gridItemsPositioning;
          if (rows !== undefined) params.gridRowCount = rows;
          if (columns !== undefined) params.gridColumnCount = columns;
          if (rowSizes !== undefined) params.gridRowSizes = rowSizes;
          if (columnSizes !== undefined) params.gridColumnSizes = columnSizes;
        } else {
          // Only send layoutWrap when the caller asked for it — defaulting to
          // NO_WRAP here would silently un-wrap an existing wrapping frame.
          if (wrap !== undefined) params.layoutWrap = wrap;
        }

        const result = await sendCommandToFigma("set_layout_mode", params);
        const typedResult = result as { name: string; gridRowCount?: number; gridColumnCount?: number };
        const tracks =
          mode === "GRID" && typedResult.gridColumnCount !== undefined
            ? ` (${typedResult.gridRowCount} rows × ${typedResult.gridColumnCount} columns)`
            : "";
        return {
          content: [
            {
              type: "text",
              text: `Set layout mode of frame "${typedResult.name}" to ${mode}${tracks}`,
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

  // Reorder Grid Tracks Tool
  server.tool(
    "reorder_grid_tracks",
    "Move one or more rows or columns to a new position in a GRID-mode frame, shifting the other tracks as needed. GRID mode only.",
    {
      nodeId: z.string().describe("GRID-mode frame node ID"),
      axis: z.enum(["ROW", "COLUMN"]).describe("Whether to reorder rows or columns"),
      fromIndices: coerceArray(z.array(z.coerce.number().int().nonnegative())).describe(
        "Indices of the rows/columns to move. Need not be sorted, contiguous, or deduplicated; all must be within the current track count.",
      ),
      insertionIndex: z.coerce
        .number()
        .int()
        .nonnegative()
        .describe(
          "Position to insert the selected tracks at, evaluated against the original track order before the move (e.g. a 4-column grid accepts insertion indices 0-4).",
        ),
    },
    async ({ nodeId, axis, fromIndices, insertionIndex }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const result = await sendCommandToFigma("reorder_grid_tracks", {
          nodeId,
          axis,
          fromIndices,
          insertionIndex,
        });
        const typedResult = result as { name: string; moves: Array<{ from: number; to: number }> };
        const movesDesc = typedResult.moves.map((m) => `${m.from}→${m.to}`).join(", ");
        return {
          content: [
            {
              type: "text",
              text: `Reordered ${axis.toLowerCase()}s on "${typedResult.name}": ${movesDesc || "no movement"}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error reordering grid tracks: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Grid Child Tool
  server.tool(
    "set_grid_child",
    "Place a child of a GRID auto-layout frame (FRAME, COMPONENT or COMPONENT_SET) in a specific cell, span it across rows/columns, and align it inside its cell. Indices are 0-based. Everything is validated before any change: the parent must be GRID, the cell area must fit the grid's row/column counts and must not overlap another visible child. Positions cannot be set when the grid uses gridItemsPositioning ROW_AUTO_FLOW (spans and alignment still can). Returns the applied row, column, spans and alignment.",
    {
      nodeId: z.string().describe("ID of a direct child of a GRID-mode frame"),
      row: z.coerce.number().int().nonnegative().optional().describe("0-based row index of the child's top-left cell"),
      column: z.coerce
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("0-based column index of the child's top-left cell"),
      rowSpan: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe("Number of rows the child covers (≥ 1; row + rowSpan must not exceed the row count)"),
      columnSpan: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe("Number of columns the child covers (≥ 1; column + columnSpan must not exceed the column count)"),
      horizontalAlign: z
        .enum(["MIN", "CENTER", "MAX", "AUTO"])
        .optional()
        .describe("Horizontal alignment inside the cell area: MIN = left, CENTER, MAX = right, AUTO = grid default"),
      verticalAlign: z
        .enum(["MIN", "CENTER", "MAX", "AUTO"])
        .optional()
        .describe("Vertical alignment inside the cell area: MIN = top, CENTER, MAX = bottom, AUTO = grid default"),
    },
    async ({ nodeId, row, column, rowSpan, columnSpan, horizontalAlign, verticalAlign }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const params = normalizeCommandParams("set_grid_child", {
          nodeId,
          row,
          column,
          rowSpan,
          columnSpan,
          horizontalAlign,
          verticalAlign,
        });
        const result = (await sendCommandToFigma("set_grid_child", params)) as {
          name: string;
          row: number;
          column: number;
          rowSpan: number;
          columnSpan: number;
          horizontalAlign: string;
          verticalAlign: string;
        };
        return {
          content: [
            {
              type: "text",
              text: `Placed "${result.name}" at row ${result.row}, column ${result.column} (span ${result.rowSpan}×${result.columnSpan}, align ${result.horizontalAlign}/${result.verticalAlign})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting grid child: ${error instanceof Error ? error.message : String(error)}`,
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
      padding: paddingShorthandSchema.optional().describe(PADDING_SHORTHAND_DESCRIPTION),
      paddingTop: z.coerce.number().optional().describe("Alias for `top` (the Figma property name)"),
      paddingRight: z.coerce.number().optional().describe("Alias for `right` (the Figma property name)"),
      paddingBottom: z.coerce.number().optional().describe("Alias for `bottom` (the Figma property name)"),
      paddingLeft: z.coerce.number().optional().describe("Alias for `left` (the Figma property name)"),
      return_state: returnStateParam,
    },
    async ({
      nodeId,
      top,
      right,
      bottom,
      left,
      padding,
      paddingTop,
      paddingRight,
      paddingBottom,
      paddingLeft,
      return_state,
    }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const shorthand = expandPadding(padding as never);
        const pick = (short: number | undefined, long: number | undefined, side: number | undefined) =>
          short !== undefined ? short : long !== undefined ? long : side;
        const wantTop = pick(top, paddingTop, shorthand?.top);
        const wantRight = pick(right, paddingRight, shorthand?.right);
        const wantBottom = pick(bottom, paddingBottom, shorthand?.bottom);
        const wantLeft = pick(left, paddingLeft, shorthand?.left);
        if (wantTop === undefined && wantRight === undefined && wantBottom === undefined && wantLeft === undefined) {
          throw new Error("Nothing to set — pass padding, or any of top/right/bottom/left (aliases: padding*).");
        }

        const result = await sendCommandToFigma("set_padding", {
          nodeId,
          paddingTop: wantTop,
          paddingRight: wantRight,
          paddingBottom: wantBottom,
          paddingLeft: wantLeft,
          return_state,
        });
        const typedResult = result as {
          name: string;
          paddingTop?: number;
          paddingRight?: number;
          paddingBottom?: number;
          paddingLeft?: number;
        };

        // Echo values read back from the node so a discarded write can't read as success.
        const echo = (label: string, readBack?: number, requested?: number) => {
          const value = readBack !== undefined ? readBack : requested;
          return value !== undefined ? `${label}: ${value}` : undefined;
        };
        const paddingMessages = [
          echo("top", typedResult.paddingTop, wantTop),
          echo("right", typedResult.paddingRight, wantRight),
          echo("bottom", typedResult.paddingBottom, wantBottom),
          echo("left", typedResult.paddingLeft, wantLeft),
        ].filter((entry): entry is string => entry !== undefined);

        const paddingText = paddingMessages.length > 0 ? `padding (${paddingMessages.join(", ")})` : "padding";

        return {
          content: [
            {
              type: "text",
              text: `Set ${paddingText} for frame "${typedResult.name}"${formatState(result)}`,
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
        .describe(
          "Alignment along the primary axis (the layout direction): MIN = start/left/top, CENTER = center, MAX = end/right/bottom, SPACE_BETWEEN = distribute children evenly",
        ),
      counterAxisAlignItems: z
        .enum(["MIN", "MAX", "CENTER", "BASELINE"])
        .optional()
        .describe(
          "Alignment along the cross axis (perpendicular to layout direction): MIN = top/left, CENTER = center, MAX = bottom/right, BASELINE = align text baselines (text nodes only)",
        ),
    },
    async ({ nodeId, primaryAxisAlignItems, counterAxisAlignItems }) => {
      nodeId = normalizeNodeId(nodeId);
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

  // Set Constraints Tool
  server.tool(
    "set_constraints",
    "Set resize constraints on one or more nodes — how a layer follows its parent when the parent (or an instance of its component) is resized. " +
      "MIN = keep distance to left/top, MAX = keep distance to right/bottom, CENTER = stay centred at its size, STRETCH = keep both edge distances (grows with the parent), SCALE = scale proportionally. " +
      "An omitted axis keeps its current value. Constraints only take effect on absolutely positioned children and children of frames/components without auto layout; the result warns for auto-layout children in the flow (use set_layout_sizing there) and for nodes directly on the page. " +
      "Nodes that do not support constraints (e.g. groups) fail individually. Typical: STRETCH for image slots and backgrounds, CENTER or MIN/MAX for fixed icons and badges, SCALE for illustrations. Read back with get_node_info (output_format json).",
    {
      nodeId: z.string().optional().describe("ID of a single node (combine with nodeIds or use alone)"),
      nodeIds: coerceArray(z.array(z.string())).optional().describe("IDs of the nodes to update"),
      horizontal: constraintTypeSchema
        .optional()
        .describe("Horizontal constraint: MIN | CENTER | MAX | STRETCH | SCALE"),
      vertical: constraintTypeSchema.optional().describe("Vertical constraint: MIN | CENTER | MAX | STRETCH | SCALE"),
    },
    async ({ nodeId, nodeIds, horizontal, vertical }) => {
      try {
        const result = (await sendCommandToFigma(
          "set_constraints",
          normalizeCommandParams("set_constraints", {
            ...(nodeId !== undefined ? { nodeId } : {}),
            ...(nodeIds !== undefined ? { nodeIds } : {}),
            ...(horizontal !== undefined ? { horizontal } : {}),
            ...(vertical !== undefined ? { vertical } : {}),
          }),
        )) as {
          updated?: number;
          failed?: number;
          results?: Array<{
            nodeId: string;
            name?: string;
            success: boolean;
            constraints?: { horizontal: string; vertical: string };
            warning?: string;
            error?: string;
          }>;
        };
        const results = result.results ?? [];
        const total = (result.updated ?? 0) + (result.failed ?? 0);
        const lines = [`Updated constraints on ${result.updated ?? 0} of ${total} node(s)`];
        for (const r of results) {
          if (r.success) {
            lines.push(
              `- ${r.name ?? r.nodeId} (${r.nodeId}): horizontal ${r.constraints?.horizontal}, vertical ${r.constraints?.vertical}`,
            );
            if (r.warning) lines.push(`  warning: ${r.warning}`);
          } else {
            lines.push(`- ${r.nodeId} failed: ${r.error}`);
          }
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting constraints: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Layout Sizing Tool
  server.tool(
    "set_layout_sizing",
    "Set horizontal/vertical sizing (FIXED, HUG, FILL) on an auto-layout frame or on a child of one — including TEXT nodes. " +
      "FILL requires the node's parent to have auto layout; otherwise the call fails and nothing changes. " +
      "On TEXT nodes sizing maps to textAutoResize: horizontal HUG → WIDTH_AND_HEIGHT (single line, never wraps); " +
      "horizontal FIXED or FILL with vertical HUG → HEIGHT (wraps at the width, height grows); no HUG on either axis → NONE (fixed box, text can overflow). " +
      "For TEXT, passing horizontal FIXED or FILL without vertical makes vertical HUG, so the text wraps. The response reports the resulting sizing and textAutoResize.",
    {
      nodeId: z.string().describe("ID of an auto-layout frame, or of a frame/text node inside an auto-layout frame"),
      horizontal: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe(
          "Horizontal sizing: FIXED = explicit width, HUG = shrink-wrap content, FILL = expand to fill parent (parent must have auto layout). On TEXT, HUG = single line; FIXED/FILL = wrap at that width",
        ),
      vertical: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe(
          "Vertical sizing: FIXED = explicit height, HUG = shrink-wrap content, FILL = expand to fill parent (parent must have auto layout). On TEXT, omitted with horizontal FIXED/FILL defaults to HUG",
        ),
      layoutSizingHorizontal: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe("Alias for `horizontal` (the Figma property name); `horizontal` wins if both are given"),
      layoutSizingVertical: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe("Alias for `vertical` (the Figma property name); `vertical` wins if both are given"),
      return_state: returnStateParam,
      allow_side_effects: allowSideEffectsParam,
      expect_side_effects: expectSideEffectsParam,
    },
    async ({
      nodeId,
      horizontal,
      vertical,
      layoutSizingHorizontal,
      layoutSizingVertical,
      return_state,
      allow_side_effects,
      expect_side_effects,
    }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const wantHorizontal = horizontal !== undefined ? horizontal : layoutSizingHorizontal;
        const wantVertical = vertical !== undefined ? vertical : layoutSizingVertical;
        if (wantHorizontal === undefined && wantVertical === undefined) {
          throw new Error(
            "Nothing to set — pass horizontal and/or vertical (aliases: layoutSizingHorizontal/layoutSizingVertical) with FIXED, HUG or FILL.",
          );
        }

        const result = await sendCommandToFigma("set_layout_sizing", {
          nodeId,
          layoutSizingHorizontal: wantHorizontal,
          layoutSizingVertical: wantVertical,
          return_state,
          allow_side_effects,
          expect_side_effects,
        });
        const typedResult = result as {
          name: string;
          layoutSizingHorizontal?: string;
          layoutSizingVertical?: string;
          textAutoResize?: string;
        };

        // Echo the values READ BACK from the node, never the requested ones — a
        // write Figma discarded must never be reported as a success with no values.
        const sizingMessages = [];
        if (typedResult.layoutSizingHorizontal !== undefined)
          sizingMessages.push(`horizontal: ${typedResult.layoutSizingHorizontal}`);
        if (typedResult.layoutSizingVertical !== undefined)
          sizingMessages.push(`vertical: ${typedResult.layoutSizingVertical}`);

        const sizingText =
          sizingMessages.length > 0 ? `layout sizing (${sizingMessages.join(", ")})` : "layout sizing (unreported)";

        const resultingState: string[] = [];
        if (typedResult.layoutSizingHorizontal !== undefined)
          resultingState.push(`layoutSizingHorizontal: ${typedResult.layoutSizingHorizontal}`);
        if (typedResult.layoutSizingVertical !== undefined)
          resultingState.push(`layoutSizingVertical: ${typedResult.layoutSizingVertical}`);
        if (typedResult.textAutoResize !== undefined)
          resultingState.push(`textAutoResize: ${typedResult.textAutoResize}`);
        const stateText = resultingState.length > 0 ? ` → ${resultingState.join(", ")}` : "";

        return {
          content: [
            {
              type: "text",
              text: `Set ${sizingText} for node "${typedResult.name}"${stateText}${formatState(result)}`,
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
      nodeId: z.string().describe("Auto-layout frame node ID — frame must have HORIZONTAL, VERTICAL, or GRID layout"),
      gap: z.coerce
        .number()
        .optional()
        .describe(
          "Gap between children in pixels (≥ 0; equivalent to CSS gap). On HORIZONTAL/VERTICAL frames this is the primary-axis spacing; on GRID frames it is the shorthand and sets both axes",
        ),
      itemSpacing: z.coerce.number().optional().describe("Alias for `gap` (the Figma property name)"),
      counterAxisSpacing: z.coerce
        .number()
        .optional()
        .describe("Gap between wrapped rows/columns in pixels (≥ 0; only applies when wrap=WRAP; not valid on GRID)"),
      rowGap: z.coerce
        .number()
        .optional()
        .describe("Gap between grid rows in pixels (GRID frames only; overrides gap for this axis)"),
      columnGap: z.coerce
        .number()
        .optional()
        .describe("Gap between grid columns in pixels (GRID frames only; overrides gap for this axis)"),
      return_state: returnStateParam,
    },
    async ({ nodeId, gap, itemSpacing, counterAxisSpacing, rowGap, columnGap, return_state }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const wantGap = gap !== undefined ? gap : itemSpacing;
        if (
          wantGap === undefined &&
          counterAxisSpacing === undefined &&
          rowGap === undefined &&
          columnGap === undefined
        ) {
          throw new Error("Nothing to set — pass gap (alias: itemSpacing), counterAxisSpacing, rowGap or columnGap.");
        }
        const params: any = { nodeId, return_state };
        if (wantGap !== undefined) params.itemSpacing = wantGap;
        if (counterAxisSpacing !== undefined) params.counterAxisSpacing = counterAxisSpacing;
        if (rowGap !== undefined) params.gridRowGap = rowGap;
        if (columnGap !== undefined) params.gridColumnGap = columnGap;

        const result = await sendCommandToFigma("set_item_spacing", params);
        const typedResult = result as {
          name: string;
          itemSpacing?: number;
          counterAxisSpacing?: number;
          gridRowGap?: number;
          gridColumnGap?: number;
          layoutMode?: string;
        };

        let message = `Updated spacing for frame "${typedResult.name}":`;
        if (typedResult.layoutMode === "GRID") {
          message += ` rowGap=${typedResult.gridRowGap} columnGap=${typedResult.gridColumnGap}`;
        } else {
          if (gap !== undefined) message += ` gap=${gap}`;
          if (counterAxisSpacing !== undefined) message += ` counterAxisSpacing=${counterAxisSpacing}`;
        }

        return {
          content: [
            {
              type: "text",
              text: `${message}${formatState(result)}`,
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
      radius: z.coerce
        .number()
        .min(0)
        .describe("Corner radius in pixels (≥ 0; applies to all corners unless 'corners' overrides specific ones)"),
      corners: z
        .preprocess(
          // Accept {topLeft, topRight, bottomRight, bottomLeft} as well as the positional
          // array. Batch used to widen this on its own; the widening belongs here so both
          // call paths accept it.
          (value) => {
            if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
            const c = value as Record<string, unknown>;
            const named = ["topLeft", "topRight", "bottomRight", "bottomLeft"];
            if (!named.some((k) => k in c)) return value;
            return named.map((k) => c[k] !== false);
          },
          coerceArray(z.array(mcpBooleanSchema).length(4)),
        )
        .optional()
        .describe(
          "Array of exactly 4 booleans controlling which corners are rounded: [topLeft, topRight, bottomRight, bottomLeft]. E.g. [true, true, false, false] rounds top corners only. Omit to round all corners.",
        ),
      return_state: returnStateParam,
    },
    async ({ nodeId, radius, corners, return_state }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const result = await sendCommandToFigma("set_corner_radius", {
          nodeId,
          radius,
          corners: corners || [true, true, true, true],
          return_state,
        });
        const typedResult = result as { name: string };
        return {
          content: [
            {
              type: "text",
              text: `Set corner radius of node "${typedResult.name}" to ${radius}px${formatState(result)}`,
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
    "Configure auto layout properties for a node in Figma. Note: FILL sizing is only valid when the node is a child of another auto-layout frame. For top-level or standalone frames, use FIXED or HUG. clipsContent is applied with any mode, including NONE.",
    {
      nodeId: z.string().describe("Frame node ID to enable/configure auto-layout on"),
      mode: z
        .enum(["HORIZONTAL", "VERTICAL", "GRID", "NONE"])
        .optional()
        .describe(
          "Layout direction: HORIZONTAL = children flow left-to-right, VERTICAL = children flow top-to-bottom, GRID = children placed on a row/column grid, NONE = disable auto-layout",
        ),
      top: z.coerce.number().optional().describe("Top padding in pixels (≥ 0)"),
      bottom: z.coerce.number().optional().describe("Bottom padding in pixels (≥ 0)"),
      left: z.coerce.number().optional().describe("Left padding in pixels (≥ 0)"),
      right: z.coerce.number().optional().describe("Right padding in pixels (≥ 0)"),
      gap: z.coerce
        .number()
        .optional()
        .describe(
          "Gap between children in pixels (≥ 0; CSS gap equivalent). Primary-axis spacing in HORIZONTAL/VERTICAL mode; in GRID mode it is the shorthand and sets both axes",
        ),
      rows: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe("Number of grid rows (GRID mode only; omit to keep Figma's current track count)"),
      columns: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe("Number of grid columns (GRID mode only; omit to keep Figma's current track count)"),
      rowGap: z.coerce
        .number()
        .optional()
        .describe("Gap between grid rows in pixels (GRID mode only; overrides gap for this axis)"),
      columnGap: z.coerce
        .number()
        .optional()
        .describe("Gap between grid columns in pixels (GRID mode only; overrides gap for this axis)"),
      gridAutoTracks: z
        .enum(["NONE", "ROWS"])
        .optional()
        .describe(
          "GRID mode only. ROWS = automatically add/remove rows to fit children (gridRowCount becomes read-only and cannot be set directly while this is ROWS); NONE = manual row count (default).",
        ),
      gridItemsPositioning: z
        .enum(["MANUAL", "ROW_AUTO_FLOW"])
        .optional()
        .describe(
          "GRID mode only. MANUAL = children stay at their explicitly assigned cell (default); ROW_AUTO_FLOW = children auto-place into the next free cell in row-major order as they're added — reorder via insert_child, not manual cell assignment, in this mode.",
        ),
      rowSizes: gridTrackSizesSchema
        .optional()
        .describe(
          'GRID mode only. One { type, value? } per row, top to bottom, applied after rows — length must equal the row count. E.g. [{"type":"FIXED","value":64},{"type":"FLEX"}]. FLEX tracks are invalid on an axis whose container sizing is HUG.',
        ),
      columnSizes: gridTrackSizesSchema
        .optional()
        .describe(
          "GRID mode only. One { type, value? } per column, left to right, applied after columns — length must equal the column count.",
        ),
      primaryAxisAlignItems: z
        .enum(["MIN", "CENTER", "MAX", "SPACE_BETWEEN"])
        .optional()
        .describe(
          "Alignment along the layout direction: MIN = start, CENTER = center, MAX = end, SPACE_BETWEEN = distribute evenly",
        ),
      counterAxisAlignItems: z
        .enum(["MIN", "CENTER", "MAX"])
        .optional()
        .describe(
          "Alignment perpendicular to layout direction: MIN = top/left, CENTER = center, MAX = bottom/right. There is no STRETCH value — to make children fill the counter axis (equal-height/width rows), set that child's layoutSizingVertical/Horizontal to FILL via set_layout_sizing instead. At least one child in the row must stay HUG or FIXED, or the row collapses.",
        ),
      wrap: z
        .enum(["WRAP", "NO_WRAP"])
        .optional()
        .describe("WRAP = children wrap to next line when overflow (default: NO_WRAP)"),
      strokesIncludedInLayout: mcpBooleanSchema
        .optional()
        .describe(
          "true = strokes count toward layout dimensions; false = strokes are outside layout bounds (default: false)",
        ),
      clipsContent: mcpBooleanSchema
        .optional()
        .describe(
          "true = content outside the frame boundary is hidden (like CSS overflow:hidden), including children's drop shadows and focus rings; false = content is visible. Applied with any mode, including NONE. Omit to leave the frame's current value unchanged (Figma frames clip by default). Use set_clips_content to change clipping alone.",
        ),
      preserveChildSizing: mcpBooleanSchema
        .optional()
        .describe(
          "Keep every existing child's layoutSizingHorizontal/Vertical across this call (DEFAULT: true). Figma otherwise resets children to grow/hug when the parent gains auto layout, collapsing fixed-size buttons and frames. Set false only if you want Figma's defaults.",
        ),
      horizontal: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe(
          "Horizontal sizing mode. FILL only works inside an auto-layout parent; defaults to FIXED for top-level frames, FILL for nested frames.",
        ),
      vertical: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe("Vertical sizing mode. FILL only works inside an auto-layout parent; defaults to HUG."),
      layoutMode: z
        .enum(["NONE", "HORIZONTAL", "VERTICAL", "GRID"])
        .optional()
        .describe("Alias for `mode` (the Figma property name); `mode` wins if both are given"),
      itemSpacing: z.coerce.number().optional().describe("Alias for `gap` (the Figma property name)"),
      padding: paddingShorthandSchema.optional().describe(PADDING_SHORTHAND_DESCRIPTION),
      paddingTop: z.coerce.number().optional().describe("Alias for `top`"),
      paddingBottom: z.coerce.number().optional().describe("Alias for `bottom`"),
      paddingLeft: z.coerce.number().optional().describe("Alias for `left`"),
      paddingRight: z.coerce.number().optional().describe("Alias for `right`"),
      layoutSizingHorizontal: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe("Alias for `horizontal` (the Figma property name)"),
      layoutSizingVertical: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe("Alias for `vertical` (the Figma property name)"),
      allow_side_effects: allowSideEffectsParam,
      expect_side_effects: expectSideEffectsParam,
    },
    async ({
      nodeId,
      allow_side_effects,
      expect_side_effects,
      mode: modeArg,
      layoutMode: layoutModeAlias,
      itemSpacing,
      padding,
      paddingTop,
      paddingBottom,
      paddingLeft,
      paddingRight,
      layoutSizingHorizontal,
      layoutSizingVertical,
      top,
      bottom,
      left,
      right,
      gap,
      rows,
      columns,
      rowGap,
      columnGap,
      gridAutoTracks,
      gridItemsPositioning,
      rowSizes,
      columnSizes,
      primaryAxisAlignItems,
      counterAxisAlignItems,
      wrap,
      strokesIncludedInLayout,
      clipsContent,
      preserveChildSizing,
      horizontal: horizontalArg,
      vertical: verticalArg,
    }) => {
      nodeId = normalizeNodeId(nodeId);
      const mode = modeArg !== undefined ? modeArg : layoutModeAlias;
      if (mode === undefined) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error setting auto layout: missing `mode` (alias: layoutMode) — NONE, HORIZONTAL, VERTICAL or GRID",
            },
          ],
        };
      }
      const horizontal = horizontalArg !== undefined ? horizontalArg : layoutSizingHorizontal;
      const vertical = verticalArg !== undefined ? verticalArg : layoutSizingVertical;
      // `padding` is the shorthand; any explicit per-side value (or its padding* alias)
      // wins over it — the same precedence `set_padding` and `create_frame` use.
      const shorthand = expandPadding(padding as never);
      const pickSide = (side: number | undefined, alias: number | undefined, short: number | undefined) =>
        side !== undefined ? side : alias !== undefined ? alias : short;
      top = pickSide(top, paddingTop, shorthand?.top);
      bottom = pickSide(bottom, paddingBottom, shorthand?.bottom);
      left = pickSide(left, paddingLeft, shorthand?.left);
      right = pickSide(right, paddingRight, shorthand?.right);
      gap = gap !== undefined ? gap : itemSpacing;
      try {
        const params = normalizeCommandParams("set_auto_layout", {
          nodeId,
          mode,
          top,
          bottom,
          left,
          right,
          gap,
          rows,
          columns,
          rowGap,
          columnGap,
          gridAutoTracks,
          gridItemsPositioning,
          rowSizes,
          columnSizes,
          primaryAxisAlignItems,
          counterAxisAlignItems,
          wrap,
          strokesIncludedInLayout,
          clipsContent,
          horizontal,
          vertical,
          ...(preserveChildSizing !== undefined ? { preserveChildSizing } : {}),
          allow_side_effects,
          expect_side_effects,
        });
        const result = await sendCommandToFigma("set_auto_layout", params);

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
    "Set the visual effects of a node in Figma. Supports DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, BACKGROUND_BLUR, and beta types NOISE (grain overlay), TEXTURE (frosted texture), GLASS (frosted glass with refraction, frame-only). Bind effect values to variables per effect with colorVariable/radiusVariable/spreadVariable/offsetXVariable/offsetYVariable (e.g. a focus ring colour bound to 'ring').",
    {
      nodeId: z.string().describe("The ID of the node to modify"),
      effects: coerceArray(
        z.array(
          z.object({
            type: z
              .enum(["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR", "NOISE", "TEXTURE", "GLASS"])
              .describe(
                "Effect type: DROP_SHADOW = shadow cast outward, INNER_SHADOW = shadow inside the shape, LAYER_BLUR = blurs the node itself, BACKGROUND_BLUR = blurs content behind the node, NOISE = grain/film grain overlay, TEXTURE = frosted texture surface, GLASS = frosted glass with refraction (frames only)",
              ),
            color: colorParam("Effect color (for shadows and NOISE).").optional(),
            offset: z
              .object({
                x: z.coerce.number().describe("X offset"),
                y: z.coerce.number().describe("Y offset"),
              })
              .optional()
              .describe("Shadow offset in pixels (DROP_SHADOW and INNER_SHADOW only)"),
            radius: z.coerce
              .number()
              .optional()
              .describe("Blur radius in pixels ≥ 0 (used for all blur types, TEXTURE, and GLASS; higher = more blur)"),
            spread: z.coerce
              .number()
              .optional()
              .describe(
                "Shadow expansion in pixels — positive spreads outward, negative contracts (DROP_SHADOW and INNER_SHADOW only)",
              ),
            visible: mcpBooleanSchema.optional().describe("Whether this effect layer is visible (default: true)"),
            blendMode: z
              .string()
              .optional()
              .describe(
                "CSS-compatible blend mode string, e.g. 'NORMAL', 'MULTIPLY', 'SCREEN', 'OVERLAY' (default: NORMAL)",
              ),
            noiseType: z
              .enum(["MONOTONE", "DUOTONE", "MULTITONE"])
              .optional()
              .describe(
                "Grain color style (NOISE only): MONOTONE = single color grain, DUOTONE = two-color grain (requires secondaryColor), MULTITONE = full color grain (default: MONOTONE)",
              ),
            noiseSize: z.coerce
              .number()
              .optional()
              .describe(
                "Grain particle size in pixels — larger = coarser grain (NOISE and TEXTURE; typical range 1–100)",
              ),
            density: z.coerce
              .number()
              .optional()
              .describe(
                "Grain density 0–1 — higher = more grain particles visible (NOISE only; typical range 0.1–0.9)",
              ),
            secondaryColor: colorParam(
              "Second grain color (NOISE DUOTONE only — ignored for MONOTONE/MULTITONE).",
            ).optional(),
            opacity: z.coerce
              .number()
              .min(0)
              .max(1)
              .optional()
              .describe("Effect opacity 0–1 (NOISE MULTITONE only — ignored for MONOTONE/DUOTONE)"),
            clipToShape: mcpBooleanSchema
              .optional()
              .describe(
                "true = texture is masked to the node's shape; false = texture fills bounding box (TEXTURE only; default: true)",
              ),
            lightIntensity: z.coerce
              .number()
              .min(
                0,
                "lightIntensity must be between 0 and 1 (Figma normalises this GLASS field; it is NOT a 0-20/0-50 scale)",
              )
              .max(
                1,
                "lightIntensity must be between 0 and 1 (Figma normalises this GLASS field; it is NOT a 0-20/0-50 scale)",
              )
              .optional()
              .describe("Specular highlight intensity, 0–1 normalised (GLASS only)"),
            lightAngle: z.coerce
              .number()
              .optional()
              .describe("Light source direction in degrees 0–360, where 0 = top (GLASS only)"),
            refraction: z.coerce
              .number()
              .min(
                0,
                "refraction must be between 0 and 1 (Figma normalises this GLASS field; it is NOT a 0-20/0-50 scale)",
              )
              .max(
                1,
                "refraction must be between 0 and 1 (Figma normalises this GLASS field; it is NOT a 0-20/0-50 scale)",
              )
              .optional()
              .describe(
                "Refraction distortion intensity, 0–1 normalised — higher = more bending of the background (GLASS only). NOT 0–50: Figma rejects values outside 0–1.",
              ),
            depth: z.coerce
              .number()
              .optional()
              .describe(
                "Depth of the refraction effect (GLASS only). Figma's typings document this as >= 1; higher = deeper glass.",
              ),
            dispersion: z.coerce
              .number()
              .min(
                0,
                "dispersion must be between 0 and 1 (Figma normalises this GLASS field; it is NOT a 0-20/0-50 scale)",
              )
              .max(
                1,
                "dispersion must be between 0 and 1 (Figma normalises this GLASS field; it is NOT a 0-20/0-50 scale)",
              )
              .optional()
              .describe(
                "Chromatic aberration / rainbow fringing, 0–1 normalised (GLASS only). NOT 0–20: Figma rejects values outside 0–1.",
              ),
            ...effectVariableParams,
          }),
        ),
      ).describe("Array of effects to apply"),
    },
    async ({ nodeId, effects }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const result = await sendCommandToFigma("set_effects", {
          nodeId,
          effects: effects === undefined ? undefined : normalizeEffectColors(effects),
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
      styleName: z
        .string()
        .optional()
        .describe("The name of the effect style to apply (e.g. 'shadow/md' or 'shadow-md')"),
    },
    async ({ nodeId, effectStyleId, styleName }) => {
      nodeId = normalizeNodeId(nodeId);
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
    type: z
      .enum(["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR", "NOISE", "TEXTURE", "GLASS"])
      .describe(
        "Effect type: DROP_SHADOW = shadow cast outward, INNER_SHADOW = shadow inside the shape, LAYER_BLUR = blurs the node itself, BACKGROUND_BLUR = blurs content behind the node, NOISE = grain/film grain overlay, TEXTURE = frosted texture surface, GLASS = frosted glass with refraction (frames only)",
      ),
    color: colorParam("Effect color (for shadows and NOISE).").optional(),
    offset: z
      .object({
        x: z.coerce.number().describe("X offset"),
        y: z.coerce.number().describe("Y offset"),
      })
      .optional()
      .describe("Shadow offset in pixels (DROP_SHADOW and INNER_SHADOW only)"),
    radius: z.coerce
      .number()
      .optional()
      .describe("Blur radius in pixels ≥ 0 (used for all blur types, TEXTURE, and GLASS; higher = more blur)"),
    spread: z.coerce
      .number()
      .optional()
      .describe(
        "Shadow expansion in pixels — positive spreads outward, negative contracts (DROP_SHADOW and INNER_SHADOW only)",
      ),
    visible: mcpBooleanSchema.optional().describe("Whether the effect is visible"),
    blendMode: z
      .string()
      .optional()
      .describe("CSS-compatible blend mode string, e.g. 'NORMAL', 'MULTIPLY', 'SCREEN', 'OVERLAY' (default: NORMAL)"),
    noiseType: z
      .enum(["MONOTONE", "DUOTONE", "MULTITONE"])
      .optional()
      .describe(
        "Grain color style (NOISE only): MONOTONE = single color grain, DUOTONE = two-color grain (requires secondaryColor), MULTITONE = full color grain (default: MONOTONE)",
      ),
    noiseSize: z.coerce
      .number()
      .optional()
      .describe("Grain particle size in pixels — larger = coarser grain (NOISE and TEXTURE; typical range 1–100)"),
    density: z.coerce
      .number()
      .optional()
      .describe("Grain density 0–1 — higher = more grain particles visible (NOISE only; typical range 0.1–0.9)"),
    secondaryColor: colorParam("Second grain color (NOISE DUOTONE only — ignored for MONOTONE/MULTITONE).").optional(),
    opacity: z.coerce
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Effect opacity 0–1 (NOISE MULTITONE only — ignored for MONOTONE/DUOTONE)"),
    clipToShape: mcpBooleanSchema
      .optional()
      .describe(
        "true = texture is masked to the node's shape; false = texture fills bounding box (TEXTURE only; default: true)",
      ),
    lightIntensity: z.coerce
      .number()
      .min(0, "lightIntensity must be between 0 and 1 (Figma normalises this GLASS field; it is NOT a 0-20/0-50 scale)")
      .max(1, "lightIntensity must be between 0 and 1 (Figma normalises this GLASS field; it is NOT a 0-20/0-50 scale)")
      .optional()
      .describe("Specular highlight intensity, 0–1 normalised (GLASS only)"),
    lightAngle: z.coerce
      .number()
      .optional()
      .describe("Light source direction in degrees 0–360, where 0 = top (GLASS only)"),
    refraction: z.coerce
      .number()
      .min(0, "refraction must be between 0 and 1 (Figma normalises this GLASS field; it is NOT a 0-20/0-50 scale)")
      .max(1, "refraction must be between 0 and 1 (Figma normalises this GLASS field; it is NOT a 0-20/0-50 scale)")
      .optional()
      .describe(
        "Refraction distortion intensity, 0–1 normalised — higher = more bending of the background (GLASS only). NOT 0–50: Figma rejects values outside 0–1.",
      ),
    depth: z.coerce
      .number()
      .optional()
      .describe(
        "Depth of the refraction effect (GLASS only). Figma's typings document this as >= 1; higher = deeper glass.",
      ),
    dispersion: z.coerce
      .number()
      .min(0, "dispersion must be between 0 and 1 (Figma normalises this GLASS field; it is NOT a 0-20/0-50 scale)")
      .max(1, "dispersion must be between 0 and 1 (Figma normalises this GLASS field; it is NOT a 0-20/0-50 scale)")
      .optional()
      .describe(
        "Chromatic aberration / rainbow fringing, 0–1 normalised (GLASS only). NOT 0–20: Figma rejects values outside 0–1.",
      ),
    ...effectVariableParams,
  });

  // Create Effect Style Tool
  server.tool(
    "create_effect_style",
    "Create a new effect style in Figma (e.g., shadow, blur). The style can then be applied to nodes using set_effect_style_id. Each effect can bind its colour/radius/spread/offsets to variables with colorVariable/radiusVariable/spreadVariable/offsetXVariable/offsetYVariable.",
    {
      name: z.string().describe("Name of the effect style (e.g., 'shadow/sm', 'shadow/md', 'blur/overlay')"),
      effects: coerceArray(z.array(effectStyleEntrySchema)).describe("Array of effects for the style"),
      description: z.string().optional().describe("Description of the effect style"),
    },
    async ({ name, effects, description }) => {
      try {
        const result = await sendCommandToFigma<CreateEffectStyleResult>("create_effect_style", {
          name,
          effects: effects === undefined ? undefined : normalizeEffectColors(effects),
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
    "Update an existing effect style's properties (name, effects, description). Effects accept the same per-effect variable params as create_effect_style (colorVariable, radiusVariable, spreadVariable, offsetXVariable, offsetYVariable).",
    {
      styleId: z
        .string()
        .describe("The ID or name of the effect style to update (e.g. 'S:abc123,' or 'shadow/md' or 'shadow-md')"),
      name: z.string().optional().describe("New name for the effect style"),
      effects: coerceArray(z.array(effectStyleEntrySchema)).optional().describe("New array of effects for the style"),
      description: z.string().optional().describe("New description for the effect style"),
    },
    async ({ styleId, name, effects, description }) => {
      try {
        const result = await sendCommandToFigma<UpdateEffectStyleResult>("update_effect_style", {
          styleId,
          name,
          effects: effects === undefined ? undefined : normalizeEffectColors(effects),
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
      styleId: z
        .string()
        .describe("The ID or name of the effect style to delete (e.g. 'S:abc123,' or 'shadow/md' or 'shadow-md')"),
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
    color: colorParam("Color for this stop."),
    position: z.coerce.number().min(0).max(1).describe("Position along gradient 0–1"),
  });

  const gradientSchema = z.object({
    type: z.enum(["LINEAR", "RADIAL", "ANGULAR", "DIAMOND"]).describe("Gradient type"),
    stops: z
      .preprocess(normalizeGradientStops, coerceArray(z.array(gradientStopSchema).min(2)))
      .describe("Array of color stops (min 2); stop colors accept hex or {r,g,b,a}") as unknown as z.ZodType<
      Array<{ color: unknown; position: number }>
    >,
    angle: z.coerce
      .number()
      .optional()
      .describe(`${GRADIENT_ANGLE_DESCRIPTION} Measured in the unit square (styles have no size).`),
    direction: gradientDirectionParam,
    opacity: z.coerce.number().min(0).max(1).optional().describe("Overall opacity 0–1 (default 1)"),
  });

  /** Stops → {color: 0–1 RGBA, position}, sorted, so hex AND {r,g,b,a} stops both reach the plugin intact. */
  const normalizeStyleGradient = (gradient: z.infer<typeof gradientSchema>) => ({
    ...gradient,
    stops: sortGradientStops(gradient.stops.map((stop) => ({ ...stop, color: toRgba(stop.color) }))),
  });

  // Create Color Style Tool
  server.tool(
    "create_color_style",
    "Create a new paint (color) style in Figma — solid color or gradient. The style can then be applied to nodes using set_color_style_id. Provide either 'color' for a solid fill OR 'gradient' for a gradient fill.",
    {
      name: z.string().describe("Name of the color style (e.g., 'color/primary', 'brand/blue')"),
      color: colorParam("Solid fill color. Use this OR gradient, not both.").optional(),
      gradient: gradientSchema.optional().describe("Gradient definition. Use this OR color, not both."),
      description: z.string().optional().describe("Description of the color style"),
    },
    async ({ name, color, gradient, description }) => {
      try {
        const result = await sendCommandToFigma("create_color_style", {
          name,
          ...(color !== undefined && { color }),
          ...(gradient !== undefined && { gradient: normalizeStyleGradient(gradient) }),
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
      styleId: z
        .string()
        .describe("The ID or name of the color style (e.g. 'S:abc123,' or 'color/primary' or 'color-primary')"),
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
      styleId: z
        .string()
        .describe(
          "The ID or name of the color style to update (e.g. 'S:abc123,' or 'color/primary' or 'color-primary')",
        ),
      name: z.string().optional().describe("New name for the color style"),
      color: colorParam("New solid fill color. Use this OR gradient, not both.").optional(),
      gradient: gradientSchema.optional().describe("New gradient definition. Use this OR color, not both."),
      description: z.string().optional().describe("New description for the color style"),
    },
    async ({ styleId, name, color, gradient, description }) => {
      try {
        const result = await sendCommandToFigma("update_color_style", {
          styleId,
          ...(name !== undefined && { name }),
          ...(color !== undefined && { color }),
          ...(gradient !== undefined && { gradient: normalizeStyleGradient(gradient) }),
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
      styleId: z
        .string()
        .describe(
          "The ID or name of the color style to delete (e.g. 'S:abc123,' or 'color/primary' or 'color-primary')",
        ),
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
      styleName: z
        .string()
        .optional()
        .describe("The name of the color style to apply (e.g. 'color/primary' or 'color-primary')"),
    },
    async ({ nodeId, styleId, styleName }) => {
      nodeId = normalizeNodeId(nodeId);
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
    'Bind a variable to a node property, a text style field or an effect style field in Figma. For nodes: SOLID fills/strokes use "fills/0/color" or "strokes/0/color" (bare "fills" or "strokes" defaults to index 0); gradient paints bind per stop with "fills/0/gradientStops/1/color"; effects bind with "effects/0/color", "effects/0/radius", "effects/0/spread", "effects/0/offsetX" or "effects/0/offsetY" (shadows; blurs support radius only); other fields are opacity/strokeWeight/cornerRadius/etc with no index. For text styles: pass the text style id (e.g. \'S:abc123,\') or name (e.g. \'body/md\') as nodeId, and a field of fontFamily, fontStyle, fontSize, fontWeight, lineHeight, letterSpacing, paragraphSpacing, or paragraphIndent. For effect styles: pass the effect style id or name (e.g. \'shadow/md\') as nodeId and an effects/N/<field> path.',
    {
      nodeId: z
        .string()
        .describe(
          "The ID of the node, or the ID/name of a text style (e.g. 'body/md') or an effect style (e.g. 'shadow/md', effects/N/* fields only)",
        ),
      variableId: z
        .string()
        .describe(
          "The ID or name of the variable to bind (e.g. 'VariableID:1:2' or 'background/primary' or 'background-primary')",
        ),
      field: z
        .string()
        .describe(
          'Property field path to bind to. Examples: "fills/0/color" for a SOLID fill color, "strokes/0/color" for stroke color, "fills/0/gradientStops/1/color" for a gradient stop, "effects/0/color" / "effects/0/radius" / "effects/0/spread" / "effects/0/offsetX" / "effects/0/offsetY" for a shadow, "opacity", "width", "height", "strokeWeight", "cornerRadius", "topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "itemSpacing", "counterAxisSpacing"',
        ),
    },
    async ({ nodeId, variableId, field }) => {
      nodeId = normalizeNodeId(nodeId);
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
              text: `Successfully bound variable "${typedResult.variableName}" (${typedResult.variableType}) to "${typedResult.field}" on ${typedResult.nodeId ? "node" : "style"} "${typedResult.name}"`,
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
    "Remove a variable binding from a node property, a text style field or an effect style field in Figma. Pass a node id, or a text/effect style id or name as nodeId. Accepts the same field paths as bind_variable, including gradient stops and effects.",
    {
      nodeId: z
        .string()
        .describe(
          "The ID of the node, or the ID/name of a text style (e.g. 'body/md') or an effect style (e.g. 'shadow/md', effects/N/* fields only)",
        ),
      field: z
        .string()
        .describe(
          'Property field path to unbind. Examples: "fills/0/color" for fill color, "strokes/0/color" for stroke color, "fills/0/gradientStops/1/color" for a gradient stop, "effects/0/color" or "effects/0/radius" for a shadow, "opacity", "strokeWeight", etc.',
        ),
    },
    async ({ nodeId, field }) => {
      nodeId = normalizeNodeId(nodeId);
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
      nodeId = normalizeNodeId(nodeId);
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

  // Set Visible Tool
  server.tool(
    "set_visible",
    "Show or hide one or more layers (node.visible, the eye toggle in the Layers panel). Works on any scene node; pass nodeId, nodeIds, or both. Returns per-node {id, name, visible}; a node that can't be updated (e.g. not found) is listed with an error while the rest still apply. Hidden layers stay in the tree but take no space in auto layout. Note: hiding a layer inside an INSTANCE sets an override on that one instance only. For a show/hide toggle designers control per instance, add a BOOLEAN component property on the main component and wire it with set_component_property_references { visible } instead.",
    {
      nodeId: z.string().optional().describe("ID of a single node to show or hide"),
      nodeIds: coerceArray(z.array(z.string())).optional().describe("IDs of several nodes to show or hide"),
      visible: mcpBooleanSchema.describe("true = show the layer, false = hide it"),
    },
    async ({ nodeId, nodeIds, visible }) => {
      try {
        const result = await sendCommandToFigma(
          "set_visible",
          normalizeCommandParams("set_visible", { nodeId, nodeIds, visible }),
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting visibility: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Image Fill Tool
  server.tool(
    "set_image_fill",
    "Set an image fill on a node from a LOCAL FILE PATH (`image_path`), a public URL (`imageUrl`), or raw base64 bytes (`imageBytes`). Supports PNG, JPEG, GIF and WEBP up to 4096x4096 pixels. Provide exactly ONE source. PREFER `image_path` for any image already on disk: the server reads and base64-encodes the file itself, so the bytes never pass through the conversation (`set_image_fill_from_path` is an equivalent alias tool). Inlining a real image as `imageBytes` is usually impossible (a 705KB file is ~176,000 tokens of tool argument) and shell substitution like $(cat file) arrives literally and fails with 'Invalid base64 string'.",
    {
      nodeId: z.string().describe("The ID of the node to modify"),
      imageUrl: z
        .string()
        .url()
        .optional()
        .describe(
          "URL of the image (PNG, JPEG, or GIF) — fetched by Figma itself, so it must be a public http(s) URL (no loopback/private-network/.local addresses). Use this OR imageBytes, not both.",
        ),
      imageBytes: z
        .string()
        .optional()
        .describe(
          "Base64-encoded image bytes (PNG, JPEG, or GIF), sent directly with no network fetch. Only practical for tiny images you can literally emit — for a file on disk use `set_image_fill_from_path` (path in, bytes read server-side). A `data:image/...;base64,` prefix is accepted and stripped automatically. Use this OR imageUrl, not both. Capped at 20MB decoded.",
        ),
      image_path: z
        .string()
        .optional()
        .describe(
          "Absolute path to a local image file (PNG, JPG, GIF, or WEBP, up to 20MB). The server reads and base64-encodes it, so the bytes never enter the conversation. Use this instead of imageBytes for anything on disk. Aliases: `path`, `load_from_path`.",
        ),
      path: z.string().optional().describe("Alias for image_path — absolute path to a local image file."),
      load_from_path: z.string().optional().describe("Alias for image_path — absolute path to a local image file."),
      scaleMode: z
        .enum(["FILL", "FIT", "CROP", "TILE"])
        .optional()
        .describe(
          "How the image scales within the node (default: FILL): FILL = cover the entire area (may crop), FIT = fit entirely inside (may letterbox), CROP = manual crop with transform handles, TILE = repeat/tile the image",
        ),
      rotation: z.coerce
        .number()
        .optional()
        .describe(
          "Image rotation in degrees — must be a multiple of 90 (0, 90, 180, 270). Only applies to FILL, FIT, and TILE modes; ignored for CROP.",
        ),
      scalingFactor: imageScalingFactorParam,
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
      imageBytes,
      image_path,
      path: pathAlias,
      load_from_path,
      scaleMode,
      rotation,
      scalingFactor,
      exposure,
      contrast,
      saturation,
      temperature,
      tint,
      highlights,
      shadows,
    }) => {
      nodeId = normalizeNodeId(nodeId);
      let sourceNote = "";
      try {
        // A local file path is a first-class source here: agents reach for
        // `set_image_fill` by name and must not hit a wall that forces them to inline
        // a ~50,000-char base64 string (measured: 0/6 agents ever managed it).
        const imagePath = image_path || pathAlias || load_from_path;
        if (imagePath) {
          if (imageUrl || imageBytes) {
            throw new Error("Provide only ONE image source: image_path, imageUrl, or imageBytes.");
          }
          const file = await readImageFileAsBase64(imagePath);
          imageBytes = file.base64;
          sourceNote = ` from ${imagePath} (${file.mimeType}, ${file.bytes} bytes)`;
        }
        if (!imageUrl && !imageBytes) {
          throw new Error(
            "Provide exactly one image source: image_path (absolute path to a local file — preferred, read server-side; aliases: path, load_from_path), imageUrl (public http(s) URL), or imageBytes (base64).",
          );
        }
        if (imageUrl && imageBytes) {
          throw new Error("Provide only one of imageUrl or imageBytes, not both");
        }
        const result = await sendCommandToFigma(
          "set_image_fill",
          {
            nodeId,
            imageUrl,
            imageBytes,
            ...resolveImageScale(scaleMode, scalingFactor),
            rotation,
            exposure,
            contrast,
            saturation,
            temperature,
            tint,
            highlights,
            shadows,
          },
          // A large local file is base64-encoded and relayed to the plugin; give it the
          // same headroom as set_image_fill_from_path.
          imagePath ? 120000 : undefined,
        );
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
              text: `Set image fill on "${typedResult.name}"${sourceNote} (${typedResult.imageSize.width}x${typedResult.imageSize.height}px, scaleMode: ${typedResult.scaleMode})`,
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

  // Set Image Fill From Local File Path Tool
  server.tool(
    "set_image_fill_from_path",
    "Set an image fill on a node from an image file on the local disk. The server reads and base64-encodes the file itself, so the image bytes never pass through the conversation — this is the ONLY practical way to apply a real local image (a 705KB file inlined as `imageBytes` would be ~176,000 tokens). Accepts PNG, JPG, GIF, and WEBP up to 20MB.",
    {
      nodeId: z.string().describe("The ID of the node to modify"),
      path: z
        .string()
        .describe(
          "Absolute path to a local image file (PNG, JPG, GIF, or WEBP). The file is read and encoded server-side; do not paste file contents.",
        ),
      scaleMode: z
        .enum(["FILL", "FIT", "CROP", "TILE"])
        .optional()
        .describe(
          "How the image scales within the node (default: FILL): FILL = cover the entire area (may crop), FIT = fit entirely inside (may letterbox), CROP = manual crop with transform handles, TILE = repeat/tile the image",
        ),
      rotation: z.coerce
        .number()
        .optional()
        .describe(
          "Image rotation in degrees — must be a multiple of 90 (0, 90, 180, 270). Only applies to FILL, FIT, and TILE modes; ignored for CROP.",
        ),
      scalingFactor: imageScalingFactorParam,
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
      path: imagePath,
      scaleMode,
      rotation,
      scalingFactor,
      exposure,
      contrast,
      saturation,
      temperature,
      tint,
      highlights,
      shadows,
    }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const { base64, bytes, mimeType } = await readImageFileAsBase64(imagePath);

        const result = await sendCommandToFigma(
          "set_image_fill",
          {
            nodeId,
            imageBytes: base64,
            ...resolveImageScale(scaleMode, scalingFactor),
            rotation,
            exposure,
            contrast,
            saturation,
            temperature,
            tint,
            highlights,
            shadows,
          },
          120000,
        );
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
              text: `Set image fill on "${typedResult.name}" from ${imagePath} (${mimeType}, ${bytes} bytes, ${typedResult.imageSize.width}x${typedResult.imageSize.height}px, scaleMode: ${typedResult.scaleMode})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting image fill from path: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Gradient Fill Tool
  server.tool(
    "set_gradient_fill",
    "Set a gradient fill on a node. Supports LINEAR, RADIAL, ANGULAR, and DIAMOND gradient types. LINEAR angles use the CSS linear-gradient convention (0 = to top, 90 = to right, 180 = to bottom, 270 = to left, clockwise; default 180), or pass `direction` (e.g. 'to bottom right' or 'r'). Aspect-corrected exactly like CSS: stop positions 0..1 always span the node's FULL extent along that direction regardless of the node's width:height ratio. Author stop positions in plain 0..1 — never pre-distort them. Stops are sorted by position. TOKENS: each stop accepts `colorVariable` (a COLOR variable name or id) and the stop is bound to it via ColorStop.boundVariables — this is the ONLY way to make a gradient token-driven, because bind_variable/setBoundVariableForPaint accept SolidPaint only and cannot bind an existing gradient after the fact. An unresolvable colorVariable is an ERROR, never a silent raw-colour fallback.",
    {
      nodeId: z.string().describe("Node ID to apply the gradient fill to"),
      type: z
        .enum(["LINEAR", "RADIAL", "ANGULAR", "DIAMOND"])
        .optional()
        .describe(
          "Gradient shape: LINEAR = straight line between two points, RADIAL = circular/elliptical from center outward, ANGULAR = conic/sweep around a center point, DIAMOND = diamond-shaped four-directional",
        ),
      stops: z
        .preprocess(
          normalizeGradientStops,
          coerceArray(
            z
              .array(
                z.object({
                  color: colorParam("Color for this gradient stop.").optional(),
                  colorVariable: z
                    .string()
                    .optional()
                    .describe(
                      'COLOR variable name or id to BIND this stop to (e.g. "brand/primary"). Binds via ColorStop.boundVariables.color — the only supported way to token-drive a gradient. When given, `color` is optional and defaults to the variable\'s own value. An unresolvable name throws.',
                    ),
                  position: z.coerce.number().min(0).max(1).describe("Stop position (0-1)"),
                }),
              )
              .min(2),
          ),
        )
        .describe(
          'Array of gradient color stops (minimum 2). Also accepts the loose spellings agents reach for: a JSON-encoded array, bare colours ("#fff") or flat {r,g,b} stops, `hex`/`offset` keys, and omitted positions (spaced evenly).',
        )
        .optional() as unknown as z.ZodType<
        Array<{ color?: unknown; colorVariable?: string; position: number }> | undefined
      >,
      colors: coerceArray(z.array(z.unknown()))
        .optional()
        .describe('Shorthand for evenly-spaced stops: ["#ffffff", "#000000"]. Ignored when `stops` is given.'),
      angle: z.coerce
        .number()
        .optional()
        .describe(
          `${GRADIENT_ANGLE_DESCRIPTION} Aspect-corrected — the full 0..1 stop range spans the node's actual extent.`,
        ),
      direction: gradientDirectionParam,
      aspect_correct: mcpBooleanSchema
        .optional()
        .describe(
          "false = measure the angle in the node's normalised unit square instead of pixels (the visual angle then stretches with the node's aspect ratio; still centred, still spanning 0..1). Default: true (CSS behaviour).",
        ),
      opacity: z.coerce
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Overall fill opacity 0–1 applied on top of individual stop alphas (default: 1)"),
    },
    async ({ nodeId, type, stops, colors, angle, direction, opacity, aspect_correct }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        // `colors: ["#a", "#b"]` is the shorthand callers reach for; it used to work only
        // inside a batch. Positions are spaced evenly, exactly as the batch did.
        const resolvedStops: Array<{ color?: unknown; colorVariable?: string; position: number }> =
          stops ??
          (colors ?? []).map((color, i, all) => ({
            color,
            position: all.length > 1 ? i / (all.length - 1) : 0,
          }));
        if (resolvedStops.length < 2) {
          throw new Error("A gradient needs at least 2 stops — pass `stops` or the `colors` shorthand.");
        }
        const result = await sendCommandToFigma("set_gradient_fill", {
          nodeId,
          gradientType: type ?? "LINEAR",
          stops: sortGradientStops(
            resolvedStops.map((stop) => {
              if (stop.color === undefined && stop.colorVariable === undefined) {
                throw new Error("Each gradient stop needs a `color`, a `colorVariable`, or both.");
              }
              // A stop with only a colorVariable carries no literal colour: the plugin
              // resolves the variable's own value rather than writing a NaN paint.
              return stop.color === undefined ? stop : { ...stop, color: toRgba(stop.color) };
            }),
          ),
          ...(angle === undefined && direction !== undefined ? { direction } : { angle: angle ?? 180 }),
          opacity: opacity ?? 1,
          aspect_correct: aspect_correct ?? true,
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

  // Set Clips Content Tool
  server.tool(
    "set_clips_content",
    "Toggle clipsContent ('Clip content') on a frame-like node (FRAME, COMPONENT, COMPONENT_SET, INSTANCE). Required for rounded containers to actually clip their children. Not supported on SECTION nodes.",
    {
      nodeId: z.string().describe("Node ID of a frame, component, component set, or instance"),
      clipsContent: mcpBooleanSchema.describe("true to clip children to the node bounds, false to let them overflow"),
    },
    async ({ nodeId, clipsContent }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const result = await sendCommandToFigma("set_clips_content", { nodeId, clipsContent });
        const typed = result as { name: string; clipsContent: boolean };
        return {
          content: [{ type: "text", text: `Set clipsContent of "${typed.name}" to ${typed.clipsContent}` }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting clipsContent: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Set Opacity Tool
  server.tool(
    "set_opacity",
    "Set a node's opacity (0–1) and/or blend mode. Prefer this over baking alpha into 8-digit hex fill colors.",
    {
      nodeId: z.string().describe("Node ID (e.g. '123:456')"),
      opacity: z.coerce.number().min(0).max(1).optional().describe("Node opacity, 0 (transparent) to 1 (opaque)"),
      blendMode: z
        .enum([
          "PASS_THROUGH",
          "NORMAL",
          "DARKEN",
          "MULTIPLY",
          "LINEAR_BURN",
          "COLOR_BURN",
          "LIGHTEN",
          "SCREEN",
          "LINEAR_DODGE",
          "COLOR_DODGE",
          "OVERLAY",
          "SOFT_LIGHT",
          "HARD_LIGHT",
          "DIFFERENCE",
          "EXCLUSION",
          "HUE",
          "SATURATION",
          "COLOR",
          "LUMINOSITY",
        ])
        .optional()
        .describe("Optional layer blend mode"),
    },
    async ({ nodeId, opacity, blendMode }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const result = await sendCommandToFigma("set_opacity", { nodeId, opacity, blendMode });
        const typed = result as { name: string; opacity?: number; blendMode?: string };
        return {
          content: [
            {
              type: "text",
              text: `Updated "${typed.name}" — opacity: ${typed.opacity}, blendMode: ${typed.blendMode}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Error setting opacity: ${error instanceof Error ? error.message : String(error)}` },
          ],
        };
      }
    },
  );

  // Set Section Status Tool
  server.tool(
    "set_section_status",
    "Set the dev status of a Figma SECTION node (Ready for dev / Completed), or clear it with NONE.",
    {
      nodeId: z.string().describe("Node ID of a SECTION node"),
      status: z
        .enum(["READY_FOR_DEV", "COMPLETED", "NONE"])
        .describe("READY_FOR_DEV, COMPLETED, or NONE to clear the status"),
      description: z.string().optional().describe("Optional dev status description"),
    },
    async ({ nodeId, status, description }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const result = await sendCommandToFigma("set_section_status", { nodeId, status, description });
        const typed = result as { name: string; devStatus: { type: string } | null };
        return {
          content: [
            {
              type: "text",
              text: `Set dev status of section "${typed.name}" to ${typed.devStatus ? typed.devStatus.type : "NONE"}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting section status: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // OpenType features (read-only — Figma cannot set them from a plugin)
  server.tool(
    "get_text_opentype_features",
    "Read the OpenType features (ligatures LIGA/CLIG/DLIG, tabular figures TNUM, slashed zero ZERO, stylistic sets SS01…, etc.) of a TEXT node, node-wide and per character range. Only features that differ from the font's defaults are listed. PLATFORM LIMIT: Figma's Plugin API exposes OpenType features READ-ONLY (TextNode.openTypeFeatures has no setter and there is no setRange… call), so no tool can turn ligatures off or tabular figures on. Workarounds: pick a font family/style that already renders the way you need (verify by reading it back with this tool), or set the features manually in Figma's Type details panel.",
    {
      nodeId: z.string().describe("TEXT node ID"),
    },
    async ({ nodeId }) => {
      nodeId = normalizeNodeId(nodeId);
      try {
        const result = (await sendCommandToFigma("get_text_opentype_features", { nodeId })) as {
          name: string;
          features: Record<string, boolean> | "mixed";
          ranges: Array<{ start: number; end: number; features: Record<string, boolean> }>;
          note: string;
        };
        const fmt = (f: Record<string, boolean>) =>
          Object.keys(f).length === 0
            ? "(font defaults)"
            : Object.entries(f)
                .map(([k, v]) => `${k}=${v ? "on" : "off"}`)
                .join(" ");
        const lines = [
          `"${result.name}" OpenType features: ${result.features === "mixed" ? "mixed across ranges" : fmt(result.features)}`,
        ];
        if (result.features === "mixed" || result.ranges.length > 1) {
          for (const r of result.ranges) lines.push(`  [${r.start}-${r.end}) ${fmt(r.features)}`);
        }
        lines.push(result.note);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error reading OpenType features: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}
