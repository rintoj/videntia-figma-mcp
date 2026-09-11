export interface GetReactionsParams {
  nodeIds: string[];
}

export interface ReactionTriggerInfo {
  type: string;
}

export interface ReactionActionInfo {
  type: string;
  destinationId?: string;
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

export async function getReactions(params: Record<string, unknown>): Promise<GetReactionsResult> {
  const nodeIds = params["nodeIds"] as string[] | undefined;

  if (!Array.isArray(nodeIds)) {
    throw new Error("nodeIds must be an array");
  }
  const typedNodeIds = nodeIds as string[];
  const results: NodeReactionInfo[] = [];

  for (const id of typedNodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) continue;

    if ("reactions" in node) {
      const reactiveNode = node as unknown as {
        id: string;
        name: string;
        reactions: Array<{
          trigger: { type: string } | null;
          actions: Array<{ type: string; destinationId?: string }>;
        }>;
      };

      results.push({
        nodeId: reactiveNode.id,
        nodeName: reactiveNode.name,
        reactionCount: reactiveNode.reactions.length,
        reactions: reactiveNode.reactions.map((reaction) => ({
          trigger: reaction.trigger !== null && reaction.trigger !== undefined ? { type: reaction.trigger.type } : null,
          actions: reaction.actions.map((action) => {
            const actionInfo: ReactionActionInfo = {
              type: action.type,
            };
            if (action.type === "NODE" && action.destinationId) {
              actionInfo.destinationId = action.destinationId;
            }
            return actionInfo;
          }),
        })),
      });
    }
  }

  return {
    nodeCount: nodeIds.length,
    nodesWithReactions: results.length,
    reactions: results,
  };
}

// ---------------------------------------------------------------------------
// get_frame_animations — read prototype transitions (animations) within a frame
// ---------------------------------------------------------------------------

export interface AnimationEasing {
  type: string;
  cubicBezier?: { x1: number; y1: number; x2: number; y2: number };
}

export interface FrameAnimationInfo {
  sourceId: string;
  sourceName: string;
  sourceType: string;
  trigger: string;
  triggerTimeout?: number;
  action: string;
  navigation?: string;
  destinationId?: string;
  destinationName?: string;
  transitionType: string;
  direction?: string;
  matchLayers?: boolean;
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

interface RawTransition {
  type?: string;
  direction?: string;
  matchLayers?: boolean;
  duration?: number;
  easing?: { type?: string; easingFunctionCubicBezier?: { x1: number; y1: number; x2: number; y2: number } };
}

interface RawAction {
  type: string;
  destinationId?: string;
  navigation?: string;
  transition?: RawTransition | null;
  preserveScrollPosition?: boolean;
}

interface RawReaction {
  trigger: { type: string; timeout?: number } | null;
  actions?: RawAction[];
}

interface RawReactiveNode {
  id: string;
  name: string;
  type: string;
  reactions?: RawReaction[];
  children?: readonly SceneNode[];
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
    const node = stack.pop() as unknown as RawReactiveNode;
    nodesScanned += 1;

    if (Array.isArray(node.reactions)) {
      for (const reaction of node.reactions) {
        const actions = Array.isArray(reaction.actions) ? reaction.actions : [];
        for (const action of actions) {
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
            info.triggerTimeout = reaction.trigger.timeout;
          }
          if (action.navigation) info.navigation = action.navigation;
          if (action.destinationId) {
            info.destinationId = action.destinationId;
            const dest = await figma.getNodeByIdAsync(action.destinationId);
            if (dest) info.destinationName = dest.name;
          }
          if (transition.direction) info.direction = transition.direction;
          if (typeof transition.matchLayers === "boolean") info.matchLayers = transition.matchLayers;
          if (typeof transition.duration === "number") info.duration = transition.duration;
          if (transition.easing && transition.easing.type) {
            const easing: AnimationEasing = { type: transition.easing.type };
            if (transition.easing.easingFunctionCubicBezier) {
              easing.cubicBezier = transition.easing.easingFunctionCubicBezier;
            }
            info.easing = easing;
          }
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

export interface SetDefaultConnectorParams {
  connectorId: string;
}

export interface SetDefaultConnectorResult {
  connectorId: string;
  connectorName: string;
  message: string;
  success: boolean;
}

export async function setDefaultConnector(params: Record<string, unknown>): Promise<SetDefaultConnectorResult> {
  const connectorId = params["connectorId"] as string;

  const connector = await figma.getNodeByIdAsync(connectorId);
  if (!connector) {
    throw new Error(`Connector node with ID ${connectorId} not found`);
  }

  if (connector.type !== "CONNECTOR") {
    throw new Error(`Node "${connector.name}" is not a connector (type: ${connector.type})`);
  }

  // Note: Setting default connector is not directly supported in plugin API
  // This would require UI interaction

  return {
    connectorId: connector.id,
    connectorName: connector.name,
    message: "Default connector setting is not available in Figma Plugin API. Use Figma UI.",
    success: false,
  };
}

export interface AddPrototypeLinkParams {
  nodeId: string;
  destinationId: string;
  trigger?: string;
  navigation?: string;
  transitionType?: string;
  transitionDuration?: number;
  transitionEasing?: string;
  preserveScrollPosition?: boolean;
  triggerTimeout?: number;
}

export interface AddPrototypeLinkResult {
  nodeId: string;
  nodeName: string;
  destinationId: string;
  destinationName: string;
  trigger: string;
  navigation: string;
  success: boolean;
}

export async function addPrototypeLink(params: Record<string, unknown>): Promise<AddPrototypeLinkResult> {
  const nodeId = params["nodeId"] as string;
  const destinationId = params["destinationId"] as string;
  const trigger = (params["trigger"] as string) || "ON_CLICK";
  const navigation = (params["navigation"] as string) || "NAVIGATE";
  const transitionType = (params["transitionType"] as string) || null;
  const transitionDuration =
    params["transitionDuration"] !== undefined ? (params["transitionDuration"] as number) : 300;
  const transitionEasing = (params["transitionEasing"] as string) || "EASE_OUT";
  const preserveScrollPosition = params["preserveScrollPosition"] === true;
  const triggerTimeout = params["triggerTimeout"] !== undefined ? (params["triggerTimeout"] as number) : 800;

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error("Node not found: " + nodeId);
  if (!("reactions" in node)) throw new Error("Node type does not support reactions: " + node.type);

  const destNode = await figma.getNodeByIdAsync(destinationId);
  if (!destNode) throw new Error("Destination node not found: " + destinationId);

  const reactiveNode = node as unknown as {
    name: string;
    reactions: Array<{
      trigger: { type: string } | null;
      actions: Array<{
        type: string;
        destinationId?: string;
        navigation?: string;
        transition?: unknown;
        preserveScrollPosition?: boolean;
      }>;
    }>;
  };

  const transition =
    transitionType !== null
      ? { type: transitionType, duration: transitionDuration, easing: { type: transitionEasing } }
      : null;

  const triggerObj = trigger === "AFTER_TIMEOUT" ? { type: trigger, timeout: triggerTimeout } : { type: trigger };

  const newReaction = {
    trigger: triggerObj,
    actions: [
      {
        type: "NODE",
        destinationId,
        navigation,
        transition,
        preserveScrollPosition,
      },
    ],
  };

  const existing = Array.isArray(reactiveNode.reactions) ? reactiveNode.reactions.slice() : [];
  reactiveNode.reactions = existing.concat([newReaction]) as typeof reactiveNode.reactions;

  return {
    nodeId: node.id,
    nodeName: reactiveNode.name,
    destinationId,
    destinationName: destNode.name,
    trigger,
    navigation,
    success: true,
  };
}

export interface RemovePrototypeLinkParams {
  nodeId: string;
  destinationId?: string;
}

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

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error("Node not found: " + nodeId);
  if (!("reactions" in node)) throw new Error("Node type does not support reactions: " + node.type);

  const reactiveNode = node as unknown as {
    name: string;
    reactions: Array<{
      trigger: { type: string } | null;
      actions: Array<{ type: string; destinationId?: string }>;
    }>;
  };

  const before = Array.isArray(reactiveNode.reactions) ? reactiveNode.reactions.length : 0;

  if (destinationId !== undefined && destinationId !== null) {
    reactiveNode.reactions = reactiveNode.reactions.filter((r) => {
      const action = r.actions && r.actions[0];
      return !(action && action.type === "NODE" && action.destinationId === destinationId);
    }) as typeof reactiveNode.reactions;
  } else {
    reactiveNode.reactions = [] as typeof reactiveNode.reactions;
  }

  const after = reactiveNode.reactions.length;

  return {
    nodeId: node.id,
    nodeName: reactiveNode.name,
    removedCount: before - after,
    remainingCount: after,
    success: true,
  };
}

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

export interface CreateConnectionsParams {
  connections: ConnectionRequest[];
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
  const typedConnections = connections as ConnectionRequest[];

  const results: ConnectionResult[] = [];

  for (const conn of typedConnections) {
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
      // Create connector
      const connector = figma.createConnector();
      connector.connectorStart = {
        endpointNodeId: startNode.id,
        magnet: "AUTO",
      };
      connector.connectorEnd = {
        endpointNodeId: endNode.id,
        magnet: "AUTO",
      };

      // Add text label if provided
      if (text) {
        connector.connectorLineType = "ELBOWED";
        // textBackground is read-only in plugin typings; skip assignment
      }

      figma.currentPage.appendChild(connector);

      results.push({
        startNodeId,
        endNodeId,
        connectorId: connector.id,
        success: true,
      });
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
