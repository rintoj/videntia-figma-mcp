// Capability gate for the Figma Motion API.
//
// Motion shipped to plugins in BETA (2026-06-23) and its docs carry an explicit
// "subject to change" banner. It may also be absent entirely — an older Figma
// desktop build, or an account without the feature. Without this gate every
// motion command would fail with a raw `TypeError: figma.motion is undefined`
// or `node.applyManualKeyframeTrack is not a function`, which tells the caller
// nothing about WHY.

/** Does this Figma build expose the top-level Motion API? */
export function isMotionSupported(): boolean {
  const api = figma as unknown as { motion?: unknown };
  return typeof api.motion === "object" && api.motion !== null;
}

/** Does this specific node carry the MotionNodeMixin methods? */
export function nodeSupportsMotion(node: unknown): boolean {
  if (node === null || typeof node !== "object") return false;
  const candidate = node as Record<string, unknown>;
  return (
    typeof candidate["applyManualKeyframeTrack"] === "function" &&
    typeof candidate["applyAnimationStyle"] === "function"
  );
}

const UNSUPPORTED_HINT =
  "The Figma Motion API is not available in this editor. It is a Beta API — " +
  "check that Motion is enabled for your account and that the Figma desktop app " +
  "is up to date, then reopen the plugin.";

/**
 * Throw a message that names the real problem unless Motion is usable on `node`.
 *
 * `node` is optional so commands that only touch `figma.motion` (e.g.
 * `list_animation_styles`) can gate on the API alone.
 */
export function assertMotionSupported(node?: unknown, commandName?: string): void {
  const label = commandName ? `${commandName}: ` : "";

  if (!isMotionSupported()) {
    throw new Error(`${label}${UNSUPPORTED_HINT}`);
  }

  if (node !== undefined && !nodeSupportsMotion(node)) {
    const type = (node as { type?: string } | null)?.type ?? "unknown";
    throw new Error(
      `${label}This node (type: ${type}) does not support Motion. ` +
        "MotionNodeMixin is mixed into SceneNode, so PAGE and DOCUMENT nodes are excluded. " +
        UNSUPPORTED_HINT,
    );
  }
}

/**
 * A machine-readable support report, for `get_capabilities` and for the
 * `motionSupported` field every motion read returns.
 */
export interface MotionSupportReport {
  motionSupported: boolean;
  /** Present only when Motion is available; `undefined` means no active timeline. */
  playheadPositionMs?: number;
  reason?: string;
}

export function describeMotionSupport(): MotionSupportReport {
  if (!isMotionSupported()) {
    return { motionSupported: false, reason: UNSUPPORTED_HINT };
  }
  const playhead = (figma as unknown as { motion: { playheadPosition?: number } }).motion.playheadPosition;
  return {
    motionSupported: true,
    ...(playhead === undefined ? {} : { playheadPositionMs: Math.round(playhead * 1000) }),
  };
}
