import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket.js";
import { normalizeNodeId } from "../utils/figma-helpers.js";
import { coerceArray } from "../utils/coerce-array.js";

/**
 * Figma Motion tools — timelines, keyframe tracks and animation styles.
 *
 * Motion is a SECOND, INDEPENDENT animation system, not prototyping:
 * reactions/transitions navigate BETWEEN frames, Motion animates properties
 * of a single node ALONG a timeline. The Motion plugin API is Beta.
 *
 * Every duration and timeline position here is in MILLISECONDS; the plugin
 * converts to the seconds Figma wants.
 */

const KEYFRAME_PROPERTIES = [
  "OPACITY",
  "TRANSLATION_X",
  "TRANSLATION_Y",
  "TRANSLATION_XY",
  "ROTATION",
  "SCALE_X",
  "SCALE_Y",
  "SCALE_XY",
  "WIDTH",
  "HEIGHT",
  "CORNER_RADIUS",
  "RECTANGLE_TOP_LEFT_CORNER_RADIUS",
  "RECTANGLE_TOP_RIGHT_CORNER_RADIUS",
  "RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS",
  "RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS",
  "STROKE_WEIGHT",
  "BORDER_TOP_WEIGHT",
  "BORDER_BOTTOM_WEIGHT",
  "BORDER_LEFT_WEIGHT",
  "BORDER_RIGHT_WEIGHT",
  "STACK_SPACING",
  "STACK_COUNTER_SPACING",
  "STACK_PADDING_LEFT",
  "STACK_PADDING_TOP",
  "STACK_PADDING_RIGHT",
  "STACK_PADDING_BOTTOM",
  "GRID_ROW_GAP",
  "GRID_COLUMN_GAP",
  "PATH_TRIM_START",
  "PATH_TRIM_END",
] as const;

/** Motion easing — the prototyping set plus HOLD. */
const MOTION_EASING_TYPES = [
  "EASE_IN",
  "EASE_OUT",
  "EASE_IN_AND_OUT",
  "LINEAR",
  "EASE_IN_BACK",
  "EASE_OUT_BACK",
  "EASE_IN_AND_OUT_BACK",
  "CUSTOM_CUBIC_BEZIER",
  "GENTLE",
  "QUICK",
  "BOUNCY",
  "SLOW",
  "CUSTOM_SPRING",
  "HOLD",
] as const;

const easingSchema = z.union([
  z.enum(MOTION_EASING_TYPES),
  z.object({
    type: z.enum(MOTION_EASING_TYPES),
    easingFunctionCubicBezier: z
      .object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() })
      .optional()
      .describe("Required for CUSTOM_CUBIC_BEZIER"),
    easingFunctionSpring: z
      .union([
        z.object({ bounce: z.number() }).describe("Motion's normalized spring"),
        z
          .object({ mass: z.number(), stiffness: z.number(), damping: z.number() })
          .describe("Physical spring; converted to Motion's normalized bounce"),
      ])
      .optional()
      .describe("Required for CUSTOM_SPRING"),
  }),
]);

/** A keyframe value: a bare primitive, {r,g,b,a}, {x,y}, or explicit {type,value}. */
const keyframeValueSchema = z.union([z.number(), z.boolean(), z.string(), z.record(z.string(), z.any())]);

const keyframeFieldSchema = z.union([
  z.enum(KEYFRAME_PROPERTIES).describe("A property name shorthand"),
  z.object({ type: z.literal("PROPERTY"), name: z.enum(KEYFRAME_PROPERTIES) }),
  z.object({
    type: z.literal("INDEXED_ITEM"),
    collection: z.enum(["fills", "strokes", "effects"]),
    index: z.number().int().min(0),
    field: z.string().optional().describe("Effect field, e.g. RADIUS, COLOR, SPREAD"),
    propertyId: z.string().optional(),
  }),
]);

function errorResult(label: string, error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Error ${label}: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
  };
}

function jsonResult(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

interface MotionTrackSummary {
  field: string;
  keyframeCount: number;
  positions: number[];
}

interface MotionNodeInfo {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  timelines: Array<{ id: string; durationMs: number }>;
  animationStyles: Array<Record<string, unknown>>;
  manualKeyframeTracks: MotionTrackSummary[];
  hasMotion: boolean;
}

interface GetMotionInfoResponse {
  motionSupported: boolean;
  playheadPositionMs?: number;
  nodeCount: number;
  nodesWithMotion: number;
  nodes: MotionNodeInfo[];
  reason?: string;
}

/** One line per track, in the token-efficient house style. */
function renderCompact(result: GetMotionInfoResponse): string {
  if (!result.motionSupported) {
    return `motion unavailable — ${result.reason ?? "figma.motion is not exposed by this editor"}`;
  }

  const lines: string[] = [
    `${result.nodesWithMotion} of ${result.nodeCount} node(s) carry motion` +
      (result.playheadPositionMs === undefined ? "" : ` | playhead=${result.playheadPositionMs}ms`),
  ];

  for (const node of result.nodes) {
    const timelines = node.timelines.map((t) => `${t.durationMs}ms`).join(", ") || "none";
    lines.push(`\n${node.nodeName} (${node.nodeType}, ${node.nodeId}) timelines=[${timelines}]`);
    if (node.animationStyles.length > 0) {
      lines.push(`  styles: ${node.animationStyles.map((s) => String(s["name"] ?? s["styleId"])).join(", ")}`);
    }
    for (const track of node.manualKeyframeTracks) {
      lines.push(`  ${track.field}: ${track.keyframeCount} keyframe(s) @ [${track.positions.join(", ")}]ms`);
    }
    if (node.manualKeyframeTracks.length === 0 && node.animationStyles.length === 0) {
      lines.push("  (no keyframe tracks or animation styles)");
    }
  }
  return lines.join("\n");
}

export function registerMotionTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // get_motion_info (read)
  // -------------------------------------------------------------------------
  server.tool(
    "get_motion_info",
    "Read Figma Motion data for nodes: timelines (duration in ms), applied animation styles, and manual " +
      "keyframe tracks with each keyframe's timeline position in ms. Also reports the editor's current " +
      "playhead position. Motion is a separate system from prototyping — use get_reactions / " +
      "get_frame_animations for navigation transitions. Returns motionSupported: false with a reason when " +
      "the Beta Motion API is unavailable.",
    {
      nodeIds: coerceArray(z.array(z.string())).describe("Node IDs to read motion data from"),
      output_format: z
        .enum(["json", "compact"])
        .optional()
        .describe("compact = one line per track (default). json = the full structure."),
    },
    async ({ nodeIds, output_format }) => {
      const normalized = nodeIds.map(normalizeNodeId);
      try {
        const result = await sendCommandToFigma<GetMotionInfoResponse>("get_motion_info", { nodeIds: normalized });
        if (output_format === "json") return jsonResult(result);
        return { content: [{ type: "text", text: renderCompact(result) }] };
      } catch (error) {
        return errorResult("getting motion info", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // list_animation_styles (read)
  // -------------------------------------------------------------------------
  server.tool(
    "list_animation_styles",
    "List the Figma Motion animation styles available in this document, with their styleId, name, " +
      "description and configurable props. Call this before apply_animation_style — that tool accepts a " +
      "style NAME as well as an id.",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma<Record<string, unknown>>("list_animation_styles", {});
        return jsonResult(result);
      } catch (error) {
        return errorResult("listing animation styles", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // apply_animation_style (write)
  // -------------------------------------------------------------------------
  server.tool(
    "apply_animation_style",
    "Apply a Figma Motion animation style (a preset template) to a node. Accepts the style's id OR its " +
      "name. Returns the applied-style id needed by remove_animation_style. Durations are in MILLISECONDS.",
    {
      nodeId: z.string().describe("Target node ID"),
      style: z.string().describe("Animation style id or name (see list_animation_styles)"),
      duration: z.number().optional().describe("Duration in MILLISECONDS"),
      timelineOffset: z.number().optional().describe("Offset from the timeline start, in MILLISECONDS"),
      props: z
        .record(z.string(), z.any())
        .optional()
        .describe(
          "Style-specific props (see list_animation_styles). NOTE: list_animation_styles documents " +
            "`duration`/`delay` in seconds because that is Figma's own unit; pass them here in " +
            "MILLISECONDS like every other duration on this server and they are converted for you.",
        ),
    },
    async ({ nodeId, style, duration, timelineOffset, props }) => {
      try {
        const result = await sendCommandToFigma("apply_animation_style", {
          nodeId: normalizeNodeId(nodeId),
          style,
          duration,
          timelineOffset,
          props,
        });
        const r = result as { nodeName: string; styleName: string; appliedStyleId: string; warnings?: string[] };
        const warning = r.warnings?.length ? `\nWarnings:\n- ${r.warnings.join("\n- ")}` : "";
        return {
          content: [
            {
              type: "text",
              text: `Applied "${r.styleName}" to "${r.nodeName}" (appliedStyleId: ${r.appliedStyleId}).${warning}`,
            },
          ],
        };
      } catch (error) {
        return errorResult("applying animation style", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // remove_animation_style (write)
  // -------------------------------------------------------------------------
  server.tool(
    "remove_animation_style",
    "Remove an applied Figma Motion animation style from a node, by its APPLIED id (the `id` field from " +
      "get_motion_info, or the value apply_animation_style returned — not the styleId).",
    {
      nodeId: z.string().describe("Target node ID"),
      id: z.string().describe("The applied animation style id"),
    },
    async ({ nodeId, id }) => {
      try {
        const result = await sendCommandToFigma("remove_animation_style", {
          nodeId: normalizeNodeId(nodeId),
          id,
        });
        const r = result as { nodeName: string; remainingCount: number };
        return {
          content: [
            {
              type: "text",
              text: `Removed animation style from "${r.nodeName}". ${r.remainingCount} style(s) remaining.`,
            },
          ],
        };
      } catch (error) {
        return errorResult("removing animation style", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // set_keyframe_track (write)
  // -------------------------------------------------------------------------
  server.tool(
    "set_keyframe_track",
    "Write a Figma Motion keyframe track onto a node property. " +
      "IMPORTANT: this REPLACES the entire existing track for that field — the Figma API has no " +
      "append-a-single-keyframe operation, so pass every keyframe you want the track to end up with. " +
      "Timeline positions are in MILLISECONDS. Prefer animate_node for common effects (fade, slide, scale); " +
      "use this when you need exact control.",
    {
      nodeId: z.string().describe("Target node ID"),
      field: keyframeFieldSchema.describe(
        'Property to animate — a name like "OPACITY", or an indexed form like ' +
          '{"type":"INDEXED_ITEM","collection":"fills","index":0}',
      ),
      keyframes: z
        .array(
          z.object({
            timelinePosition: z.number().describe("Position on the timeline, in MILLISECONDS"),
            value: keyframeValueSchema.describe(
              'A bare number/boolean/string, {r,g,b,a} for colour, {x,y} for vector, or {"type","value"}',
            ),
            easing: easingSchema.optional().describe("Easing into this keyframe"),
            id: z.string().optional(),
          }),
        )
        .min(1)
        .describe("The COMPLETE set of keyframes for this field"),
      baseValue: keyframeValueSchema.optional().describe("The track's base value before the first keyframe"),
      id: z.string().optional().describe("Explicit track id"),
    },
    async ({ nodeId, field, keyframes, baseValue, id }) => {
      try {
        const result = await sendCommandToFigma("set_keyframe_track", {
          nodeId: normalizeNodeId(nodeId),
          field,
          keyframes,
          baseValue,
          id,
        });
        const r = result as { nodeName: string; field: string; keyframeCount: number; warnings?: string[] };
        const warning = r.warnings?.length ? `\nWarnings:\n- ${r.warnings.join("\n- ")}` : "";
        return {
          content: [
            {
              type: "text",
              text: `Set ${r.keyframeCount} keyframe(s) on ${r.field} for "${r.nodeName}".${warning}`,
            },
          ],
        };
      } catch (error) {
        return errorResult("setting keyframe track", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // remove_keyframe_track (write)
  // -------------------------------------------------------------------------
  server.tool(
    "remove_keyframe_track",
    "Remove an entire Figma Motion keyframe track from a node property.",
    {
      nodeId: z.string().describe("Target node ID"),
      field: keyframeFieldSchema.describe("The property whose track is removed"),
    },
    async ({ nodeId, field }) => {
      try {
        const result = await sendCommandToFigma("remove_keyframe_track", {
          nodeId: normalizeNodeId(nodeId),
          field,
        });
        const r = result as { nodeName: string; field: string };
        return {
          content: [{ type: "text", text: `Removed the ${r.field} keyframe track from "${r.nodeName}".` }],
        };
      } catch (error) {
        return errorResult("removing keyframe track", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // animate_node (composite)
  // -------------------------------------------------------------------------
  server.tool(
    "animate_node",
    "PREFERRED over set_keyframe_track + set_timeline_duration for common motion. Applies a house motion " +
      "preset to a node in ONE round trip: writes every keyframe track the effect needs and grows the " +
      "timeline to fit. Timings and easings come from this server's own motion design-knowledge module " +
      "(90-500ms bands, EASE_OUT to enter, EASE_IN to exit). Durations in MILLISECONDS.",
    {
      nodeId: z.string().describe("Target node ID"),
      preset: z
        .enum([
          "fade-in",
          "fade-out",
          "slide-up",
          "slide-down",
          "slide-left",
          "slide-right",
          "scale-in",
          "pulse",
          "press-feedback",
        ])
        .describe("Motion preset to apply"),
      duration: z.number().optional().describe("Override the preset duration, in MILLISECONDS"),
      delay: z.number().optional().describe("Offset the whole effect from the timeline start, in MILLISECONDS"),
      easing: easingSchema.optional().describe("Override the preset easing"),
      distance: z.number().optional().describe("Travel in px for the slide presets (default: preset's own)"),
    },
    async ({ nodeId, preset, duration, delay, easing, distance }) => {
      try {
        const result = await sendCommandToFigma("animate_node", {
          nodeId: normalizeNodeId(nodeId),
          preset,
          duration,
          delay,
          easing,
          distance,
        });
        const r = result as {
          nodeName: string;
          preset: string;
          durationMs: number;
          easing: string;
          applied: Record<string, unknown>;
          warnings?: string[];
        };
        const applied = Object.entries(r.applied)
          .map(([key, value]) => `  ${key}: ${String(value)}`)
          .join("\n");
        const warning = r.warnings?.length ? `\nWarnings:\n- ${r.warnings.join("\n- ")}` : "";
        return {
          content: [
            {
              type: "text",
              text:
                `Applied "${r.preset}" to "${r.nodeName}" (${r.durationMs}ms, ${r.easing}).\n` + `${applied}${warning}`,
            },
          ],
        };
      } catch (error) {
        return errorResult("animating node", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // set_timeline_duration (write)
  // -------------------------------------------------------------------------
  server.tool(
    "set_timeline_duration",
    "Set the duration of a node's Figma Motion timeline, in MILLISECONDS. Defaults to the node's first " +
      "timeline. Note the Plugin API has no createTimeline — a timeline must already exist (add a keyframe " +
      "first, or create it in the Motion panel).",
    {
      nodeId: z.string().describe("Target node ID"),
      duration: z.number().describe("Timeline duration in MILLISECONDS"),
      timelineId: z.string().optional().describe("Timeline id (defaults to the node's first timeline)"),
    },
    async ({ nodeId, duration, timelineId }) => {
      try {
        const result = await sendCommandToFigma("set_timeline_duration", {
          nodeId: normalizeNodeId(nodeId),
          duration,
          timelineId,
        });
        const r = result as { nodeName: string; timelineId: string; durationMs: number };
        return {
          content: [
            {
              type: "text",
              text: `Set timeline ${r.timelineId} on "${r.nodeName}" to ${r.durationMs}ms.`,
            },
          ],
        };
      } catch (error) {
        return errorResult("setting timeline duration", error);
      }
    },
  );
}
