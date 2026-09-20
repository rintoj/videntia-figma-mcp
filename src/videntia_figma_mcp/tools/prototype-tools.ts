import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket.js";
import { normalizeNodeId } from "../utils/figma-helpers.js";
import { coerceArray } from "../utils/coerce-array.js";

/**
 * Prototyping tools — reactions, prototype links, transitions and flow maps.
 *
 * Every duration in this file is in MILLISECONDS. The plugin converts to the
 * seconds the Figma API expects (src/videntia_figma_plugin/utils/duration.ts).
 * Reads come back in milliseconds too, so a value written here reads back
 * identically.
 */

const TRIGGER_TYPES = [
  "ON_CLICK",
  "ON_HOVER",
  "ON_PRESS",
  "ON_DRAG",
  "AFTER_TIMEOUT",
  "MOUSE_UP",
  "MOUSE_DOWN",
  "MOUSE_ENTER",
  "MOUSE_LEAVE",
  "ON_KEY_DOWN",
  "ON_MEDIA_HIT",
  "ON_MEDIA_END",
] as const;

const NAVIGATION_TYPES = ["NAVIGATE", "OVERLAY", "SWAP", "SCROLL_TO", "CHANGE_TO"] as const;

const TRANSITION_TYPES = [
  "DISSOLVE",
  "SMART_ANIMATE",
  "SCROLL_ANIMATE",
  "MOVE_IN",
  "MOVE_OUT",
  "PUSH",
  "SLIDE_IN",
  "SLIDE_OUT",
] as const;

const EASING_TYPES = [
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
] as const;

const ACTION_TYPES = [
  "NODE",
  "BACK",
  "CLOSE",
  "URL",
  "SET_VARIABLE",
  "SET_VARIABLE_MODE",
  "UPDATE_MEDIA_RUNTIME",
] as const;

const cubicBezierSchema = z.object({
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
});

const springSchema = z.object({
  mass: z.number(),
  stiffness: z.number(),
  damping: z.number(),
  initialVelocity: z.number(),
});

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

interface ReactionActionInfo {
  type: string;
  destinationId?: string;
  destinationName?: string;
  navigation?: string;
  transitionType?: string;
  duration?: number;
  direction?: string;
  matchLayers?: boolean;
  url?: string;
  easing?: { type: string };
}

interface NodeReactionInfo {
  nodeId: string;
  nodeName: string;
  reactionCount: number;
  reactions: Array<{
    trigger: { type: string; timeout?: number; delay?: number } | null;
    actions: ReactionActionInfo[];
  }>;
}

interface GetReactionsResponse {
  nodeCount: number;
  nodesWithReactions: number;
  reactions: NodeReactionInfo[];
}

/** One human line per action, naming the real trigger, action and destination. */
function renderAction(action: ReactionActionInfo): string {
  const dest = action.destinationName ?? action.destinationId ?? action.url ?? "-";
  const parts: string[] = [`${action.type} → ${dest}`];
  if (action.navigation) parts.push(action.navigation);
  if (action.transitionType) {
    const bits = [action.transitionType];
    if (action.duration !== undefined) bits.push(`${action.duration}ms`);
    if (action.easing?.type) bits.push(action.easing.type);
    if (action.direction) bits.push(action.direction);
    if (action.matchLayers) bits.push("matchLayers");
    parts.push(bits.join(" "));
  }
  return parts.join(" | ");
}

export function registerPrototypeTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // get_reactions
  // -------------------------------------------------------------------------
  server.tool(
    "get_reactions",
    "Read prototype reactions (interactions) from nodes. Returns every trigger with ALL of its actions — " +
      "destination, navigation, transition type, duration in ms, easing, direction and matchLayers. " +
      "Use get_frame_animations to sweep a whole frame subtree instead of named nodes.",
    {
      nodeIds: coerceArray(z.array(z.string())).describe("Array of node IDs to read reactions from"),
    },
    async ({ nodeIds }) => {
      nodeIds = nodeIds.map(normalizeNodeId);
      try {
        const result = await sendCommandToFigma<GetReactionsResponse>("get_reactions", { nodeIds });
        const nodes = result?.reactions ?? [];
        const total = nodes.reduce((sum, n) => sum + (n.reactions?.length || 0), 0);

        const lines: string[] = [`Found ${total} reaction(s) across ${nodes.length} node(s)`];
        for (const node of nodes) {
          if (!node.reactions?.length) continue;
          lines.push(`\n**${node.nodeName || node.nodeId}** (${node.reactions.length} reaction(s)):`);
          for (const reaction of node.reactions) {
            const trigger = reaction.trigger?.type ?? "unknown";
            const timing =
              reaction.trigger?.timeout !== undefined
                ? ` (after ${reaction.trigger.timeout}ms)`
                : reaction.trigger?.delay
                  ? ` (delay ${reaction.trigger.delay}ms)`
                  : "";
            if (reaction.actions.length === 0) {
              lines.push(`- ${trigger}${timing} → (no actions)`);
              continue;
            }
            for (const action of reaction.actions) {
              lines.push(`- ${trigger}${timing} → ${renderAction(action)}`);
            }
          }
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(`getting reactions for nodes [${nodeIds.join(", ")}]`, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // get_frame_animations
  // -------------------------------------------------------------------------
  server.tool(
    "get_frame_animations",
    "Read every prototype animation (transition) within a frame and its descendants. Surfaces the full " +
      "detail: transition type (SMART_ANIMATE, MOVE_IN, PUSH, DISSOLVE, SLIDE_IN, SCROLL_ANIMATE…), " +
      "direction, matchLayers, duration in MILLISECONDS, and easing including custom cubic-bezier and " +
      "spring control points. Each entry also carries the trigger (with AFTER_TIMEOUT timeout in ms), " +
      "destination and preserveScrollPosition.",
    {
      nodeId: z.string().describe("Frame/node ID to scan. Animations on this node and all descendants are returned."),
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma<Record<string, unknown>>("get_frame_animations", {
          nodeId: normalizeNodeId(nodeId),
        });
        return jsonResult(result);
      } catch (error) {
        return errorResult("getting frame animations", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // map_prototype_flows
  // -------------------------------------------------------------------------
  server.tool(
    "map_prototype_flows",
    "Build a complete flow graph from prototype reactions across the document. Returns all nodes with " +
      "navigation links, edges (from→to with trigger/action), and computed entry points (screens with no " +
      "incoming links). Use this to document user journeys and navigation flows.",
    {
      pageId: z.string().optional().describe("Scope to a specific page ID. Omit to map flows across all pages."),
    },
    async ({ pageId }) => {
      try {
        const result = await sendCommandToFigma<Record<string, unknown>>("map_prototype_flows", { pageId });
        return jsonResult(result);
      } catch (error) {
        return errorResult("mapping prototype flows", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // add_prototype_link
  // -------------------------------------------------------------------------
  server.tool(
    "add_prototype_link",
    "Add ONE prototype navigation link (reaction) from a node to a destination. Appends to the node's " +
      "existing reactions. All durations are in MILLISECONDS. Use set_reactions instead when you need " +
      "multiple actions per trigger, or a non-navigation action (URL, BACK, CLOSE, SET_VARIABLE…).",
    {
      nodeId: z
        .string()
        .describe("ID of the source node (must support reactions: frames, components, instances, etc.)"),
      destinationId: z.string().describe("ID of the destination frame to navigate to"),
      trigger: z.enum(TRIGGER_TYPES).optional().describe("Trigger type (default: ON_CLICK)"),
      navigation: z.enum(NAVIGATION_TYPES).optional().describe("Navigation type (default: NAVIGATE)"),
      transitionType: z
        .enum(TRANSITION_TYPES)
        .optional()
        .describe("Transition animation type. Omit for an instant cut with no animation."),
      transitionDuration: z.number().optional().describe("Transition duration in MILLISECONDS (default: 300)"),
      transitionEasing: z.enum(EASING_TYPES).optional().describe("Easing type (default: EASE_OUT)"),
      easingFunctionCubicBezier: cubicBezierSchema
        .optional()
        .describe("Required when transitionEasing is CUSTOM_CUBIC_BEZIER"),
      easingFunctionSpring: springSchema.optional().describe("Required when transitionEasing is CUSTOM_SPRING"),
      direction: z
        .enum(["LEFT", "RIGHT", "TOP", "BOTTOM"])
        .optional()
        .describe("Required for MOVE_IN/MOVE_OUT/PUSH/SLIDE_IN/SLIDE_OUT (default: LEFT)"),
      matchLayers: z
        .boolean()
        .optional()
        .describe("Match layers by name. Only valid on directional transitions; SMART_ANIMATE does this implicitly."),
      preserveScrollPosition: z.boolean().optional().describe("Preserve scroll position on navigate"),
      resetVideoPosition: z.boolean().optional().describe("Reset video playback position on navigate"),
      resetScrollPosition: z.boolean().optional().describe("Reset scroll position on navigate"),
      resetInteractiveComponents: z.boolean().optional().describe("Reset interactive component state on navigate"),
      overlayRelativePosition: z
        .object({ x: z.number(), y: z.number() })
        .optional()
        .describe("Overlay offset, only meaningful when navigation is OVERLAY"),
      triggerTimeout: z.number().optional().describe("Timeout in MILLISECONDS for AFTER_TIMEOUT (default: 800)"),
      triggerDelay: z.number().optional().describe("Delay in MILLISECONDS for MOUSE_* triggers (default: 0)"),
      keyDevice: z
        .enum(["KEYBOARD", "XBOX_ONE", "PS4", "SWITCH_PRO", "UNKNOWN_CONTROLLER"])
        .optional()
        .describe("Input device for ON_KEY_DOWN (default: KEYBOARD)"),
      keyCodes: z.array(z.number()).optional().describe("Key codes for ON_KEY_DOWN"),
      mediaHitTime: z.number().optional().describe("Media timestamp in MILLISECONDS for ON_MEDIA_HIT"),
    },
    async (params) => {
      const nodeId = normalizeNodeId(params.nodeId);
      const destinationId = normalizeNodeId(params.destinationId);
      try {
        const result = await sendCommandToFigma("add_prototype_link", { ...params, nodeId, destinationId });
        const r = result as {
          nodeName: string;
          destinationName: string;
          trigger: string;
          navigation: string;
          reactionCount: number;
        };
        return {
          content: [
            {
              type: "text",
              text:
                `Added prototype link: "${r.nodeName}" → "${r.destinationName}" ` +
                `(${r.trigger} / ${r.navigation}). Node now has ${r.reactionCount} reaction(s).`,
            },
          ],
        };
      } catch (error) {
        return errorResult("adding prototype link", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // set_reactions
  // -------------------------------------------------------------------------
  server.tool(
    "set_reactions",
    "REPLACE a node's entire reaction array — the full-fidelity authoring path. Use when add_prototype_link " +
      "is not enough: multiple actions per trigger, or non-navigation actions (URL, BACK, CLOSE, SET_VARIABLE, " +
      "SET_VARIABLE_MODE, UPDATE_MEDIA_RUNTIME), or the triggers add_prototype_link does not reach. " +
      "Pass reactions: [] to clear every reaction. All durations are in MILLISECONDS. " +
      "CONDITIONAL actions are not yet supported.",
    {
      nodeId: z.string().describe("ID of the node whose reactions are replaced"),
      reactions: z
        .array(
          z.object({
            trigger: z
              .object({
                type: z.enum(TRIGGER_TYPES),
                timeout: z.number().optional().describe("AFTER_TIMEOUT, in MILLISECONDS"),
                delay: z.number().optional().describe("MOUSE_* triggers, in MILLISECONDS"),
                device: z.string().optional(),
                keyCodes: z.array(z.number()).optional(),
                mediaHitTime: z.number().optional().describe("In MILLISECONDS"),
              })
              .describe("The trigger that fires this reaction"),
            actions: z
              .array(
                z.object({
                  type: z.enum(ACTION_TYPES),
                  destinationId: z.string().optional(),
                  navigation: z.enum(NAVIGATION_TYPES).optional(),
                  url: z.string().optional().describe("Required for URL actions"),
                  openInNewTab: z.boolean().optional(),
                  variableId: z.string().optional(),
                  variableCollectionId: z.string().optional(),
                  variableModeId: z.string().optional(),
                  mediaAction: z.string().optional(),
                  amountToSkip: z.number().optional().describe("In MILLISECONDS"),
                  newTimestamp: z.number().optional().describe("In MILLISECONDS"),
                  preserveScrollPosition: z.boolean().optional(),
                  resetVideoPosition: z.boolean().optional(),
                  resetScrollPosition: z.boolean().optional(),
                  resetInteractiveComponents: z.boolean().optional(),
                  overlayRelativePosition: z.object({ x: z.number(), y: z.number() }).optional(),
                  transition: z
                    .object({
                      type: z.enum(TRANSITION_TYPES),
                      duration: z.number().optional().describe("In MILLISECONDS (default: 300)"),
                      direction: z.enum(["LEFT", "RIGHT", "TOP", "BOTTOM"]).optional(),
                      matchLayers: z.boolean().optional(),
                      easing: z
                        .object({
                          type: z.enum(EASING_TYPES),
                          easingFunctionCubicBezier: cubicBezierSchema.optional(),
                          easingFunctionSpring: springSchema.optional(),
                        })
                        .optional(),
                    })
                    .nullable()
                    .optional(),
                }),
              )
              .min(1)
              .describe("One or more actions fired by this trigger"),
          }),
        )
        .describe("The complete reaction array. Replaces what is already on the node."),
    },
    async ({ nodeId, reactions }) => {
      try {
        const result = await sendCommandToFigma("set_reactions", {
          nodeId: normalizeNodeId(nodeId),
          reactions,
        });
        const r = result as { nodeName: string; reactionCount: number; replacedCount: number };
        return {
          content: [
            {
              type: "text",
              text: `Set ${r.reactionCount} reaction(s) on "${r.nodeName}" (replaced ${r.replacedCount}).`,
            },
          ],
        };
      } catch (error) {
        return errorResult("setting reactions", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // remove_prototype_link
  // -------------------------------------------------------------------------
  server.tool(
    "remove_prototype_link",
    "Remove prototype navigation link(s) from a node. Removes every reaction that targets the given " +
      "destination in ANY of its actions. Omit destinationId to clear all reactions from the node.",
    {
      nodeId: z.string().describe("ID of the source node"),
      destinationId: z
        .string()
        .optional()
        .describe("ID of the destination to remove (omit to remove ALL reactions from the node)"),
    },
    async ({ nodeId, destinationId }) => {
      const normalizedNodeId = normalizeNodeId(nodeId);
      const normalizedDestination =
        destinationId && destinationId.length > 0 ? normalizeNodeId(destinationId) : undefined;
      try {
        const result = await sendCommandToFigma("remove_prototype_link", {
          nodeId: normalizedNodeId,
          destinationId: normalizedDestination,
        });
        const r = result as { nodeName: string; removedCount: number; remainingCount: number };
        return {
          content: [
            {
              type: "text",
              text: `Removed ${r.removedCount} reaction(s) from "${r.nodeName}". ${r.remainingCount} remaining.`,
            },
          ],
        };
      } catch (error) {
        return errorResult("removing prototype link", error);
      }
    },
  );
}
