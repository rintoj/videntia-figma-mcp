// The ONE duration dialect for this server.
//
// The MCP boundary speaks MILLISECONDS — every tool schema, every description,
// every value an agent passes or reads back. The Figma API speaks SECONDS for
// both prototype transitions (`Transition.duration`) and Motion
// (`ManualKeyframeInput.timelinePosition`, `Timeline.duration`,
// `AnimationStyleConfiguration.duration` / `.timelineOffset`).
//
// Converting here, at the plugin boundary, is what keeps the two from drifting.
// Before this existed, `add_prototype_link` documented `transitionDuration` as
// ms and passed it through untouched, so writing 300 produced a 300-SECOND
// transition while `get_frame_animations` reported the value back in seconds —
// reads and writes disagreed about what the number meant.

/** Round to 6dp so 0.1 + 0.2 style float noise never reaches Figma or a diff. */
function tidy(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** MCP milliseconds -> Figma seconds. */
export function msToSeconds(ms: number): number {
  return tidy(ms / 1000);
}

/** Figma seconds -> MCP milliseconds. */
export function secondsToMs(seconds: number): number {
  return tidy(seconds * 1000);
}

/**
 * Convert an optional ms value, preserving `undefined` so callers can tell
 * "not supplied" from "supplied as 0".
 */
export function msToSecondsOptional(ms: number | undefined): number | undefined {
  return ms === undefined ? undefined : msToSeconds(ms);
}

/** Convert an optional seconds value back to ms, preserving `undefined`. */
export function secondsToMsOptional(seconds: number | undefined): number | undefined {
  return seconds === undefined ? undefined : secondsToMs(seconds);
}

/**
 * Validate a duration supplied in milliseconds.
 *
 * Figma silently misbehaves on negative or non-finite durations rather than
 * throwing, so reject them here with a message that names the offending param.
 */
export function assertValidMs(ms: number, paramName: string): void {
  if (typeof ms !== "number" || !isFinite(ms)) {
    throw new Error(`${paramName} must be a finite number of milliseconds, got ${String(ms)}`);
  }
  if (ms < 0) {
    throw new Error(`${paramName} must be >= 0 milliseconds, got ${ms}`);
  }
}
