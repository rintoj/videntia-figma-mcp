// Prototyping handlers — reactions, prototype links, transitions and flow maps.
//
// DURATION UNITS: every duration crossing the MCP boundary is in MILLISECONDS.
// The Figma API wants SECONDS — for `Transition.duration`, for
// `AFTER_TIMEOUT.timeout`, and for the `delay` on MOUSE_* triggers. All three
// are converted here, at the boundary. See utils/duration.ts for why.
//
// WRITES: this plugin's manifest sets `documentAccess: "dynamic-page"`, under
// which `node.reactions` is READ-ONLY. Assigning to it is silently discarded,
// so every write goes through `setReactionsAsync`.

import { assertValidMs, msToSeconds, secondsToMs, tidyFloat } from "../utils/duration";

// ---------------------------------------------------------------------------
// Shared reaction shapes
//
// Deliberately structural rather than importing Figma's own types: we accept a
// looser input (durations in ms, easing as a bare string) and normalise it.
// ---------------------------------------------------------------------------

interface RawEasing {
  type?: string;
  easingFunctionCubicBezier?: { x1: number; y1: number; x2: number; y2: number };
  easingFunctionSpring?: { mass: number; stiffness: number; damping: number; initialVelocity: number };
}

interface RawTransition {
  type?: string;
  direction?: string;
  matchLayers?: boolean;
  duration?: number;
  easing?: RawEasing;
}

interface RawAction {
  type: string;
  destinationId?: string | null;
  navigation?: string;
  transition?: RawTransition | null;
  preserveScrollPosition?: boolean;
  resetVideoPosition?: boolean;
  resetScrollPosition?: boolean;
  resetInteractiveComponents?: boolean;
  overlayRelativePosition?: { x: number; y: number };
  url?: string;
  openInNewTab?: boolean;
  variableId?: string | null;
  variableValue?: unknown;
  variableCollectionId?: string | null;
  variableModeId?: string | null;
  mediaAction?: string;
  amountToSkip?: number;
  newTimestamp?: number;
}

interface RawTrigger {
  type: string;
  timeout?: number;
  delay?: number;
  deprecatedVersion?: boolean;
  device?: string;
  keyCodes?: number[];
  mediaHitTime?: number;
}

interface RawReaction {
  trigger: RawTrigger | null;
  /** Figma still declares the deprecated singular form; tolerate it on read. */
  action?: RawAction | null;
  actions?: RawAction[];
}

interface ReactiveNodeLike {
  id: string;
  name: string;
  type: string;
  reactions: RawReaction[];
  setReactionsAsync?: (reactions: unknown[]) => Promise<void>;
  children?: readonly SceneNode[];
}

/** Read a node's reactions, tolerating the deprecated singular `action`. */
function actionsOf(reaction: RawReaction): RawAction[] {
  if (Array.isArray(reaction.actions)) return reaction.actions;
  if (reaction.action !== null && reaction.action !== undefined) return [reaction.action];
  return [];
}

async function loadReactiveNode(nodeId: string): Promise<ReactiveNodeLike> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error("Node not found: " + nodeId);
  if (!("reactions" in node)) {
    throw new Error(`Node "${node.name}" (type: ${node.type}) does not support reactions`);
  }
  return node as unknown as ReactiveNodeLike;
}

/**
 * Persist reactions.
 *
 * Under `documentAccess: "dynamic-page"` the `reactions` property is read-only
 * and a direct assignment is silently dropped, so `setReactionsAsync` is the
 * only write path that actually sticks.
 */
async function writeReactions(node: ReactiveNodeLike, reactions: unknown[]): Promise<void> {
  if (typeof node.setReactionsAsync !== "function") {
    throw new Error(
      `Node "${node.name}" does not expose setReactionsAsync. ` +
        "This Figma build is too old for prototype authoring under dynamic-page document access.",
    );
  }
  for (let i = 0; i < reactions.length; i++) {
    const count = actionsOf(reactions[i] as RawReaction).length;
    if (count > 1) {
      // setReactionsAsync never resolves on a multi-action reaction. add/remove
      // re-write the node's EXISTING reactions, which may have been authored in
      // Figma's UI with several actions — refuse instead of hanging.
      throw new Error(
        `Node "${node.name}" reaction[${i}] has ${count} actions. Figma's setReactionsAsync hangs on ` +
          "multi-action reactions, so this server cannot rewrite this node's reactions. Split it into " +
          "single-action reactions in Figma's UI (or replace them all with set_reactions) first.",
      );
    }
  }
  await node.setReactionsAsync(reactions);
}

/**
 * Re-shape a reaction READ from Figma so it can be written back.
 *
 * The read shape carries keys the runtime validator rejects on write: the
 * deprecated singular `action`, and `deprecatedVersion` on MOUSE_ENTER/LEAVE.
 */
function toWritableReaction(reaction: RawReaction): Record<string, unknown> {
  let trigger: Record<string, unknown> | null = null;
  if (reaction.trigger) {
    trigger = { ...(reaction.trigger as unknown as Record<string, unknown>) };
    delete trigger["deprecatedVersion"];
  }
  return { trigger, actions: actionsOf(reaction) };
}

// ---------------------------------------------------------------------------
// Normalisation: our ms-based, loosely-typed input -> Figma's exact shapes
// ---------------------------------------------------------------------------

const SIMPLE_TRANSITIONS = ["DISSOLVE", "SMART_ANIMATE", "SCROLL_ANIMATE"];
const MEDIA_ACTIONS = [
  "PLAY",
  "PAUSE",
  "TOGGLE_PLAY_PAUSE",
  "MUTE",
  "UNMUTE",
  "TOGGLE_MUTE_UNMUTE",
  "SKIP_FORWARD",
  "SKIP_BACKWARD",
  "SKIP_TO",
];
const DIRECTIONAL_TRANSITIONS = ["MOVE_IN", "MOVE_OUT", "PUSH", "SLIDE_IN", "SLIDE_OUT"];

function normalizeEasing(easing: RawEasing | string | undefined): Record<string, unknown> {
  const raw: RawEasing = typeof easing === "string" ? { type: easing } : (easing ?? {});
  const type = raw.type ?? "EASE_OUT";
  const result: Record<string, unknown> = { type };

  if (type === "CUSTOM_CUBIC_BEZIER") {
    if (!raw.easingFunctionCubicBezier) {
      throw new Error("easing type CUSTOM_CUBIC_BEZIER requires easingFunctionCubicBezier {x1,y1,x2,y2}");
    }
    result["easingFunctionCubicBezier"] = raw.easingFunctionCubicBezier;
  }
  if (type === "CUSTOM_SPRING") {
    if (!raw.easingFunctionSpring) {
      throw new Error(
        "easing type CUSTOM_SPRING requires easingFunctionSpring {mass,stiffness,damping,initialVelocity}",
      );
    }
    result["easingFunctionSpring"] = raw.easingFunctionSpring;
  }
  return result;
}

/** Build a Figma `Transition`, converting the ms duration to seconds. */
function normalizeTransition(transition: RawTransition | null | undefined): Record<string, unknown> | null {
  if (!transition || !transition.type) return null;

  const type = transition.type;
  const durationMs = transition.duration ?? 300;
  assertValidMs(durationMs, "transition duration");

  const base: Record<string, unknown> = {
    type,
    duration: msToSeconds(durationMs),
    easing: normalizeEasing(transition.easing),
  };

  if (DIRECTIONAL_TRANSITIONS.indexOf(type) !== -1) {
    // Figma rejects a directional transition without a direction, and
    // `matchLayers` is required on the same shape.
    base["direction"] = transition.direction ?? "LEFT";
    base["matchLayers"] = transition.matchLayers === true;
  } else if (SIMPLE_TRANSITIONS.indexOf(type) === -1) {
    throw new Error(
      `Unknown transition type "${type}". Expected one of ` +
        `${SIMPLE_TRANSITIONS.concat(DIRECTIONAL_TRANSITIONS).join(", ")}.`,
    );
  } else if (type === "SMART_ANIMATE" && transition.matchLayers !== undefined) {
    // SMART_ANIMATE is a SimpleTransition in the API — it has no matchLayers
    // field, and layer matching is implicit. Silently dropping the param would
    // be the sort of no-op this server exists to surface.
    throw new Error(
      "matchLayers is only valid on directional transitions (MOVE_IN, MOVE_OUT, PUSH, SLIDE_IN, SLIDE_OUT). " +
        "SMART_ANIMATE matches layers by name automatically.",
    );
  }

  return base;
}

/** Build a Figma `Trigger`, converting ms timeout/delay to seconds. */
function normalizeTrigger(trigger: RawTrigger | string | null | undefined): Record<string, unknown> | null {
  const raw: RawTrigger = typeof trigger === "string" ? { type: trigger } : (trigger ?? { type: "ON_CLICK" });
  const type = raw.type;
  const result: Record<string, unknown> = { type };

  switch (type) {
    case "AFTER_TIMEOUT": {
      const timeoutMs = raw.timeout ?? 800;
      assertValidMs(timeoutMs, "trigger timeout");
      result["timeout"] = msToSeconds(timeoutMs);
      break;
    }
    case "MOUSE_UP":
    case "MOUSE_DOWN": {
      const delayMs = raw.delay ?? 0;
      assertValidMs(delayMs, "trigger delay");
      result["delay"] = msToSeconds(delayMs);
      break;
    }
    case "MOUSE_ENTER":
    case "MOUSE_LEAVE": {
      const delayMs = raw.delay ?? 0;
      assertValidMs(delayMs, "trigger delay");
      result["delay"] = msToSeconds(delayMs);
      // NOTE: the typings declare `deprecatedVersion` on MOUSE_ENTER/MOUSE_LEAVE,
      // but Figma's RUNTIME validator rejects it:
      //   "Unrecognized key(s) in object: 'deprecatedVersion' at [0].trigger"
      // (verified 2026-09-20). Typings and runtime disagree, so it is never
      // written. It is still tolerated and reported on the read path.
      break;
    }
    case "ON_KEY_DOWN": {
      result["device"] = raw.device ?? "KEYBOARD";
      result["keyCodes"] = Array.isArray(raw.keyCodes) ? raw.keyCodes : [];
      break;
    }
    case "ON_MEDIA_HIT": {
      const hitMs = raw.mediaHitTime ?? 0;
      assertValidMs(hitMs, "mediaHitTime");
      result["mediaHitTime"] = msToSeconds(hitMs);
      break;
    }
    case "ON_CLICK":
    case "ON_HOVER":
    case "ON_PRESS":
    case "ON_DRAG":
    case "ON_MEDIA_END":
      break;
    default:
      throw new Error(
        `Unknown trigger type "${type}". Expected one of ON_CLICK, ON_HOVER, ON_PRESS, ON_DRAG, ` +
          "AFTER_TIMEOUT, MOUSE_UP, MOUSE_DOWN, MOUSE_ENTER, MOUSE_LEAVE, ON_KEY_DOWN, ON_MEDIA_HIT, ON_MEDIA_END.",
      );
  }
  return result;
}

/** Build a Figma `Action` from our looser input. */
function normalizeAction(action: RawAction): Record<string, unknown> {
  const type = action.type;

  switch (type) {
    case "BACK":
    case "CLOSE":
      return { type };

    case "URL": {
      if (!action.url) throw new Error('action type "URL" requires a url');
      return { type, url: action.url, openInNewTab: action.openInNewTab === true };
    }

    case "SET_VARIABLE": {
      const result: Record<string, unknown> = { type, variableId: action.variableId ?? null };
      // Figma's action is {type, variableId, variableValue?: VariableData}.
      // Dropping variableValue made SET_VARIABLE able to write only a valueless
      // action, which is never what a caller means.
      if (action.variableValue !== undefined) result["variableValue"] = action.variableValue;
      return result;
    }

    case "SET_VARIABLE_MODE":
      return {
        type,
        variableCollectionId: action.variableCollectionId ?? null,
        variableModeId: action.variableModeId ?? null,
      };

    case "UPDATE_MEDIA_RUNTIME": {
      const mediaAction = action.mediaAction ?? "TOGGLE_PLAY_PAUSE";
      if (MEDIA_ACTIONS.indexOf(mediaAction) === -1) {
        // Unvalidated, a near-miss like "SKIP-FORWARD" missed the branch below,
        // never attached amountToSkip, and wrote a malformed action.
        throw new Error(`Unknown mediaAction "${mediaAction}". Expected one of ${MEDIA_ACTIONS.join(", ")}.`);
      }
      const base: Record<string, unknown> = {
        type,
        destinationId: action.destinationId ?? null,
        mediaAction,
      };
      if (mediaAction === "SKIP_FORWARD" || mediaAction === "SKIP_BACKWARD") {
        const skipMs = action.amountToSkip ?? 0;
        assertValidMs(skipMs, "amountToSkip");
        base["amountToSkip"] = msToSeconds(skipMs);
      }
      if (mediaAction === "SKIP_TO") {
        const stampMs = action.newTimestamp ?? 0;
        assertValidMs(stampMs, "newTimestamp");
        base["newTimestamp"] = msToSeconds(stampMs);
      }
      return base;
    }

    case "NODE": {
      const result: Record<string, unknown> = {
        type,
        destinationId: action.destinationId ?? null,
        navigation: action.navigation ?? "NAVIGATE",
        transition: normalizeTransition(action.transition),
      };
      if (action.preserveScrollPosition !== undefined) {
        result["preserveScrollPosition"] = action.preserveScrollPosition === true;
      }
      if (action.resetVideoPosition !== undefined) {
        result["resetVideoPosition"] = action.resetVideoPosition === true;
      }
      if (action.resetScrollPosition !== undefined) {
        result["resetScrollPosition"] = action.resetScrollPosition === true;
      }
      if (action.resetInteractiveComponents !== undefined) {
        result["resetInteractiveComponents"] = action.resetInteractiveComponents === true;
      }
      if (action.overlayRelativePosition) {
        result["overlayRelativePosition"] = action.overlayRelativePosition;
      }
      return result;
    }

    default:
      throw new Error(
        `Unknown action type "${type}". Expected one of NODE, BACK, CLOSE, URL, ` +
          "SET_VARIABLE, SET_VARIABLE_MODE, UPDATE_MEDIA_RUNTIME. " +
          "CONDITIONAL is not yet supported by this server.",
      );
  }
}

/** Convert a Figma-side easing back to our reporting shape. */
function describeEasing(easing: RawEasing | undefined): AnimationEasing | undefined {
  if (!easing || !easing.type) return undefined;
  const result: AnimationEasing = { type: easing.type };
  const bezier = easing.easingFunctionCubicBezier;
  if (bezier) {
    result.cubicBezier = {
      x1: tidyFloat(bezier.x1),
      y1: tidyFloat(bezier.y1),
      x2: tidyFloat(bezier.x2),
      y2: tidyFloat(bezier.y2),
    };
  }
  const spring = easing.easingFunctionSpring;
  if (spring) {
    result.spring = {
      mass: tidyFloat(spring.mass),
      stiffness: tidyFloat(spring.stiffness),
      damping: tidyFloat(spring.damping),
      initialVelocity: tidyFloat(spring.initialVelocity),
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// get_reactions
// ---------------------------------------------------------------------------

export interface ReactionTriggerInfo {
  type: string;
  /** Milliseconds, converted from Figma's seconds. */
  timeout?: number;
  delay?: number;
  mediaHitTime?: number;
  keyCodes?: number[];
  device?: string;
  deprecatedVersion?: boolean;
}

export interface ReactionActionInfo {
  type: string;
  destinationId?: string;
  destinationName?: string;
  navigation?: string;
  transitionType?: string;
  /** Milliseconds. */
  duration?: number;
  easing?: AnimationEasing;
  direction?: string;
  matchLayers?: boolean;
  url?: string;
  openInNewTab?: boolean;
  variableId?: string;
  variableCollectionId?: string;
  variableModeId?: string;
  mediaAction?: string;
  /** Milliseconds. */
  amountToSkip?: number;
  /** Milliseconds. */
  newTimestamp?: number;
  preserveScrollPosition?: boolean;
}

export interface NodeReactionInfo {
  nodeId: string;
  nodeName: string;
  reactionCount: number;
  reactions: Array<{
    trigger: ReactionTriggerInfo | null;
    actions: ReactionActionInfo[];
  }>;
}

export interface GetReactionsResult {
  nodeCount: number;
  nodesWithReactions: number;
  reactions: NodeReactionInfo[];
}

function describeTrigger(trigger: RawTrigger | null): ReactionTriggerInfo | null {
  if (!trigger) return null;
  const info: ReactionTriggerInfo = { type: trigger.type };
  if (typeof trigger.timeout === "number") info.timeout = secondsToMs(trigger.timeout);
  if (typeof trigger.delay === "number") info.delay = secondsToMs(trigger.delay);
  // Written in seconds (normalizeTrigger), so it must come back in ms too —
  // otherwise a get -> edit -> set round trip silently resets it to the default.
  if (typeof trigger.mediaHitTime === "number") info.mediaHitTime = secondsToMs(trigger.mediaHitTime);
  if (Array.isArray(trigger.keyCodes)) info.keyCodes = trigger.keyCodes;
  if (trigger.device) info.device = trigger.device;
  if (typeof trigger.deprecatedVersion === "boolean") info.deprecatedVersion = trigger.deprecatedVersion;
  return info;
}

async function describeAction(action: RawAction): Promise<ReactionActionInfo> {
  const info: ReactionActionInfo = { type: action.type };

  if (action.destinationId) {
    info.destinationId = action.destinationId;
    const dest = await figma.getNodeByIdAsync(action.destinationId);
    if (dest) info.destinationName = dest.name;
  }
  if (action.navigation) info.navigation = action.navigation;
  if (action.url) info.url = action.url;
  if (typeof action.openInNewTab === "boolean") info.openInNewTab = action.openInNewTab;
  if (action.variableId) info.variableId = action.variableId;
  if (action.variableCollectionId) info.variableCollectionId = action.variableCollectionId;
  if (action.variableModeId) info.variableModeId = action.variableModeId;
  if (action.mediaAction) info.mediaAction = action.mediaAction;
  // Both persisted in seconds by normalizeAction — report them in ms.
  if (typeof action.amountToSkip === "number") info.amountToSkip = secondsToMs(action.amountToSkip);
  if (typeof action.newTimestamp === "number") info.newTimestamp = secondsToMs(action.newTimestamp);
  if (typeof action.preserveScrollPosition === "boolean") {
    info.preserveScrollPosition = action.preserveScrollPosition;
  }

  const transition = action.transition;
  if (transition && transition.type) {
    info.transitionType = transition.type;
    if (typeof transition.duration === "number") info.duration = secondsToMs(transition.duration);
    const easing = describeEasing(transition.easing);
    if (easing) info.easing = easing;
    if (transition.direction) info.direction = transition.direction;
    if (typeof transition.matchLayers === "boolean") info.matchLayers = transition.matchLayers;
  }
  return info;
}

export async function getReactions(params: Record<string, unknown>): Promise<GetReactionsResult> {
  const nodeIds = params["nodeIds"] as string[] | undefined;
  if (!Array.isArray(nodeIds)) {
    throw new Error("nodeIds must be an array");
  }

  const results: NodeReactionInfo[] = [];

  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) continue;
    if (!("reactions" in node)) continue;

    const reactiveNode = node as unknown as ReactiveNodeLike;
    const reactions = Array.isArray(reactiveNode.reactions) ? reactiveNode.reactions : [];
    if (reactions.length === 0) continue;

    const described = [];
    for (const reaction of reactions) {
      const actions = [];
      for (const action of actionsOf(reaction)) {
        actions.push(await describeAction(action));
      }
      described.push({ trigger: describeTrigger(reaction.trigger), actions });
    }

    results.push({
      nodeId: reactiveNode.id,
      nodeName: reactiveNode.name,
      reactionCount: reactions.length,
      reactions: described,
    });
  }

  return {
    nodeCount: nodeIds.length,
    nodesWithReactions: results.length,
    reactions: results,
  };
}

// ---------------------------------------------------------------------------
// get_frame_animations — every prototype transition within a frame
// ---------------------------------------------------------------------------

export interface AnimationEasing {
  type: string;
  cubicBezier?: { x1: number; y1: number; x2: number; y2: number };
  spring?: { mass: number; stiffness: number; damping: number; initialVelocity: number };
}

export interface FrameAnimationInfo {
  sourceId: string;
  sourceName: string;
  sourceType: string;
  trigger: string;
  /** Milliseconds. */
  triggerTimeout?: number;
  /** Milliseconds. */
  triggerDelay?: number;
  action: string;
  navigation?: string;
  destinationId?: string;
  destinationName?: string;
  transitionType: string;
  direction?: string;
  matchLayers?: boolean;
  /** Milliseconds. */
  duration?: number;
  easing?: AnimationEasing;
  preserveScrollPosition?: boolean;
}

export interface GetFrameAnimationsResult {
  frameId: string;
  frameName: string;
  nodesScanned: number;
  animationCount: number;
  animations: FrameAnimationInfo[];
}

export async function getFrameAnimations(params: Record<string, unknown>): Promise<GetFrameAnimationsResult> {
  const nodeId = params["nodeId"] as string | undefined;
  if (!nodeId) throw new Error("nodeId is required");

  const frame = await figma.getNodeByIdAsync(nodeId);
  if (!frame) throw new Error("Node not found: " + nodeId);

  const animations: FrameAnimationInfo[] = [];
  let nodesScanned = 0;

  // Depth-first walk of the frame subtree, including the frame node itself.
  const stack: SceneNode[] = [frame as SceneNode];
  while (stack.length > 0) {
    const node = stack.pop() as unknown as ReactiveNodeLike;
    nodesScanned += 1;

    if (Array.isArray(node.reactions)) {
      for (const reaction of node.reactions) {
        for (const action of actionsOf(reaction)) {
          const transition = action.transition;
          // Only actions that carry a transition are "animations".
          if (!transition || !transition.type) continue;

          const info: FrameAnimationInfo = {
            sourceId: node.id,
            sourceName: node.name,
            sourceType: node.type,
            trigger: reaction.trigger?.type ?? "UNKNOWN",
            action: action.type,
            transitionType: transition.type,
          };

          if (reaction.trigger && typeof reaction.trigger.timeout === "number") {
            info.triggerTimeout = secondsToMs(reaction.trigger.timeout);
          }
          if (reaction.trigger && typeof reaction.trigger.delay === "number") {
            info.triggerDelay = secondsToMs(reaction.trigger.delay);
          }
          if (action.navigation) info.navigation = action.navigation;
          if (action.destinationId) {
            info.destinationId = action.destinationId;
            const dest = await figma.getNodeByIdAsync(action.destinationId);
            if (dest) info.destinationName = dest.name;
          }
          if (transition.direction) info.direction = transition.direction;
          if (typeof transition.matchLayers === "boolean") info.matchLayers = transition.matchLayers;
          if (typeof transition.duration === "number") info.duration = secondsToMs(transition.duration);
          const easing = describeEasing(transition.easing);
          if (easing) info.easing = easing;
          if (typeof action.preserveScrollPosition === "boolean") {
            info.preserveScrollPosition = action.preserveScrollPosition;
          }

          animations.push(info);
        }
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) stack.push(child);
    }
  }

  return {
    frameId: frame.id,
    frameName: frame.name,
    nodesScanned,
    animationCount: animations.length,
    animations,
  };
}

// ---------------------------------------------------------------------------
// set_default_connector — unsupported by the platform
// ---------------------------------------------------------------------------

export async function setDefaultConnector(params: Record<string, unknown>): Promise<never> {
  const connectorId = params["connectorId"] as string | undefined;
  // Previously this returned `{ success: false }`, which reads as a completed
  // call and lets a caller carry on as though the connector had been set.
  // The operation is genuinely impossible, so say so loudly.
  throw new Error(
    "set_default_connector is not supported: the Figma Plugin API exposes no way to set the default connector" +
      (connectorId ? ` (requested ${connectorId})` : "") +
      ". Set it from the Figma UI instead, then use create_connections to draw connectors.",
  );
}

// ---------------------------------------------------------------------------
// add_prototype_link
// ---------------------------------------------------------------------------

export interface AddPrototypeLinkResult {
  nodeId: string;
  nodeName: string;
  destinationId: string;
  destinationName: string;
  trigger: string;
  navigation: string;
  reactionCount: number;
  success: boolean;
}

export async function addPrototypeLink(params: Record<string, unknown>): Promise<AddPrototypeLinkResult> {
  const nodeId = params["nodeId"] as string;
  const destinationId = params["destinationId"] as string;

  const node = await loadReactiveNode(nodeId);

  const destNode = await figma.getNodeByIdAsync(destinationId);
  if (!destNode) throw new Error("Destination node not found: " + destinationId);

  const triggerType = (params["trigger"] as string) || "ON_CLICK";
  const trigger = normalizeTrigger({
    type: triggerType,
    timeout: params["triggerTimeout"] as number | undefined,
    delay: params["triggerDelay"] as number | undefined,
    device: params["keyDevice"] as string | undefined,
    keyCodes: params["keyCodes"] as number[] | undefined,
    mediaHitTime: params["mediaHitTime"] as number | undefined,
  });

  const transitionType = params["transitionType"] as string | undefined;
  const transition: RawTransition | null = transitionType
    ? {
        type: transitionType,
        duration: params["transitionDuration"] as number | undefined,
        direction: params["direction"] as string | undefined,
        matchLayers: params["matchLayers"] as boolean | undefined,
        easing: {
          type: (params["transitionEasing"] as string | undefined) ?? "EASE_OUT",
          easingFunctionCubicBezier: params["easingFunctionCubicBezier"] as RawEasing["easingFunctionCubicBezier"],
          easingFunctionSpring: params["easingFunctionSpring"] as RawEasing["easingFunctionSpring"],
        },
      }
    : null;

  const action = normalizeAction({
    type: "NODE",
    destinationId,
    navigation: (params["navigation"] as string) || "NAVIGATE",
    transition,
    preserveScrollPosition: params["preserveScrollPosition"] as boolean | undefined,
    resetVideoPosition: params["resetVideoPosition"] as boolean | undefined,
    resetScrollPosition: params["resetScrollPosition"] as boolean | undefined,
    resetInteractiveComponents: params["resetInteractiveComponents"] as boolean | undefined,
    overlayRelativePosition: params["overlayRelativePosition"] as { x: number; y: number } | undefined,
  });

  const existing = Array.isArray(node.reactions) ? node.reactions.map(toWritableReaction) : [];
  const next = existing.concat([{ trigger, actions: [action] }]);
  await writeReactions(node, next);

  return {
    nodeId: node.id,
    nodeName: node.name,
    destinationId,
    destinationName: destNode.name,
    trigger: triggerType,
    navigation: (params["navigation"] as string) || "NAVIGATE",
    reactionCount: next.length,
    success: true,
  };
}

// ---------------------------------------------------------------------------
// set_reactions — full-fidelity authoring, replaces the whole array
// ---------------------------------------------------------------------------

export interface SetReactionsResult {
  nodeId: string;
  nodeName: string;
  reactionCount: number;
  replacedCount: number;
  success: boolean;
}

export async function setReactions(params: Record<string, unknown>): Promise<SetReactionsResult> {
  const nodeId = params["nodeId"] as string;
  const reactions = params["reactions"];

  if (!Array.isArray(reactions)) {
    throw new Error("reactions must be an array (pass [] to clear every reaction on the node)");
  }

  const node = await loadReactiveNode(nodeId);
  const replacedCount = Array.isArray(node.reactions) ? node.reactions.length : 0;

  const normalized = (reactions as RawReaction[]).map((reaction, index) => {
    const actions = actionsOf(reaction);
    if (actions.length === 0) {
      throw new Error(`reactions[${index}] has no actions; every reaction needs at least one action`);
    }
    if (actions.length > 1) {
      // Verified against Figma 2026-09-20: setReactionsAsync never resolves when
      // a reaction carries more than one action — reproducible even with a
      // trivial [BACK, CLOSE] pair. It HANGS rather than throwing, so without
      // this guard the command blocks until the socket times out.
      throw new Error(
        `reactions[${index}] has ${actions.length} actions. Figma's setReactionsAsync hangs (never ` +
          "resolves) on a reaction with more than one action, so this server refuses it rather than " +
          "blocking until the socket times out. Use one action per reaction — several reactions on the " +
          "same trigger is the working equivalent. Build multi-action interactions in Figma's UI instead.",
      );
    }
    return {
      trigger: normalizeTrigger(reaction.trigger),
      actions: actions.map(normalizeAction),
    };
  });

  // Verify every NODE destination exists BEFORE writing. add_prototype_link has
  // always done this; without it set_reactions happily wrote links pointing at
  // ids that are not in the file and reported success, leaving a dead link in
  // the prototype.
  for (let i = 0; i < normalized.length; i++) {
    for (const action of normalized[i].actions) {
      if (action["type"] !== "NODE") continue;
      const destinationId = action["destinationId"];
      if (typeof destinationId !== "string" || destinationId.length === 0) continue;
      const dest = await figma.getNodeByIdAsync(destinationId);
      if (!dest) {
        throw new Error(
          `reactions[${i}]: destination node not found: ${destinationId}. ` +
            "Node ids from a Figma URL use a dash (3082-47270); the API needs a colon (3082:47270).",
        );
      }
    }
  }

  await writeReactions(node, normalized);

  return {
    nodeId: node.id,
    nodeName: node.name,
    reactionCount: normalized.length,
    replacedCount,
    success: true,
  };
}

// ---------------------------------------------------------------------------
// remove_prototype_link
// ---------------------------------------------------------------------------

export interface RemovePrototypeLinkResult {
  nodeId: string;
  nodeName: string;
  removedCount: number;
  remainingCount: number;
  success: boolean;
}

export async function removePrototypeLink(params: Record<string, unknown>): Promise<RemovePrototypeLinkResult> {
  const nodeId = params["nodeId"] as string;
  const destinationId = params["destinationId"] as string | undefined;

  const node = await loadReactiveNode(nodeId);
  const existing = Array.isArray(node.reactions) ? node.reactions : [];
  const before = existing.length;

  let next: RawReaction[];
  if (destinationId !== undefined && destinationId !== null) {
    // Scan EVERY action, not just actions[0] — a reaction whose matching
    // action sits at index >= 1 was previously never removed.
    next = existing.filter(
      (reaction) =>
        !actionsOf(reaction).some((action) => action.type === "NODE" && action.destinationId === destinationId),
    );
  } else {
    next = [];
  }

  await writeReactions(node, next.map(toWritableReaction));

  return {
    nodeId: node.id,
    nodeName: node.name,
    removedCount: before - next.length,
    remainingCount: next.length,
    success: true,
  };
}

// ---------------------------------------------------------------------------
// create_connections — FigJam-style connector nodes
// ---------------------------------------------------------------------------

export interface ConnectionRequest {
  startNodeId: string;
  endNodeId: string;
  text?: string;
}

export interface ConnectionResult {
  startNodeId: string;
  endNodeId: string;
  connectorId?: string;
  success: boolean;
  error?: string;
}

export interface CreateConnectionsResult {
  totalRequested: number;
  successCount: number;
  failedCount: number;
  connections: ConnectionResult[];
}

export async function createConnections(params: Record<string, unknown>): Promise<CreateConnectionsResult> {
  const connections = params["connections"] as ConnectionRequest[] | undefined;

  if (!Array.isArray(connections)) {
    throw new Error("connections must be an array");
  }

  const results: ConnectionResult[] = [];

  for (const conn of connections) {
    const { startNodeId, endNodeId, text } = conn;

    const startNode = await figma.getNodeByIdAsync(startNodeId);
    const endNode = await figma.getNodeByIdAsync(endNodeId);

    if (!startNode || !endNode) {
      results.push({
        startNodeId,
        endNodeId,
        success: false,
        error: "One or both nodes not found",
      });
      continue;
    }

    try {
      const connector = figma.createConnector();
      connector.connectorStart = { endpointNodeId: startNode.id, magnet: "AUTO" };
      connector.connectorEnd = { endpointNodeId: endNode.id, magnet: "AUTO" };

      if (text) {
        connector.connectorLineType = "ELBOWED";
        // textBackground is read-only in plugin typings; skip assignment
      }

      figma.currentPage.appendChild(connector);

      results.push({ startNodeId, endNodeId, connectorId: connector.id, success: true });
    } catch (error) {
      results.push({
        startNodeId,
        endNodeId,
        success: false,
        error: (error as Error).message,
      });
    }
  }

  return {
    totalRequested: connections.length,
    successCount: results.filter((r) => r.success).length,
    failedCount: results.filter((r) => !r.success).length,
    connections: results,
  };
}

// ---------------------------------------------------------------------------
// map_prototype_flows — the page-level flow graph
// ---------------------------------------------------------------------------

interface FlowNode {
  id: string;
  name: string;
  type: string;
  pageId: string;
  pageName: string;
}

interface FlowEdge {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  trigger: string;
  action: string;
  pageId: string;
  pageName: string;
}

function getPageId(node: BaseNode): string | null {
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === "PAGE") return current.id;
    current = current.parent;
  }
  return null;
}

async function traverseForReactions(
  nodes: readonly SceneNode[],
  page: PageNode,
  nodesMap: Map<string, FlowNode>,
  edges: FlowEdge[],
): Promise<void> {
  for (const node of nodes) {
    if ("reactions" in node) {
      const reactiveNode = node as unknown as ReactiveNodeLike;

      if (reactiveNode.reactions.length > 0) {
        if (!nodesMap.has(reactiveNode.id)) {
          nodesMap.set(reactiveNode.id, {
            id: reactiveNode.id,
            name: reactiveNode.name,
            type: reactiveNode.type,
            pageId: page.id,
            pageName: page.name,
          });
        }

        for (const reaction of reactiveNode.reactions) {
          for (const action of actionsOf(reaction)) {
            if (!action.destinationId) continue;

            const destNode = await figma.getNodeByIdAsync(action.destinationId);
            if (!destNode) continue;

            const destPageId = getPageId(destNode);
            const destPage = destPageId ? figma.root.children.find((p) => p.id === destPageId) : page;

            if (!nodesMap.has(destNode.id)) {
              nodesMap.set(destNode.id, {
                id: destNode.id,
                name: destNode.name,
                type: destNode.type,
                pageId: destPage?.id ?? page.id,
                pageName: destPage?.name ?? page.name,
              });
            }

            edges.push({
              fromId: reactiveNode.id,
              fromName: reactiveNode.name,
              toId: destNode.id,
              toName: destNode.name,
              trigger: reaction.trigger?.type ?? "UNKNOWN",
              action: action.type,
              pageId: page.id,
              pageName: page.name,
            });
          }
        }
      }
    }

    if ("children" in node) {
      await traverseForReactions((node as FrameNode).children, page, nodesMap, edges);
    }
  }
}

export async function mapPrototypeFlows(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const pageId = params["pageId"] as string | undefined;

  const pagesToScan: PageNode[] = [];
  if (pageId) {
    const page = figma.root.children.find((p) => p.id === pageId);
    if (!page) throw new Error(`Page not found: ${pageId}`);
    pagesToScan.push(page);
  } else {
    pagesToScan.push(...figma.root.children);
  }

  const nodesMap = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  const entryPoints: FlowNode[] = [];

  for (const page of pagesToScan) {
    await page.loadAsync();
    await traverseForReactions(page.children, page, nodesMap, edges);
  }

  // Entry points are nodes that are the destination of no edge.
  const destinationIds = new Set(edges.map((e) => e.toId));
  for (const [id, node] of nodesMap) {
    if (!destinationIds.has(id)) {
      entryPoints.push(node);
    }
  }

  return {
    totalNodes: nodesMap.size,
    totalEdges: edges.length,
    entryPoints,
    nodes: Array.from(nodesMap.values()),
    edges,
  };
}
