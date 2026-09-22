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

/** Round to `places` decimals, so float noise never reaches Figma or a diff. */
function tidy(value: number, places: number): number {
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

/**
 * MCP milliseconds -> Figma seconds.
 *
 * 6dp keeps microsecond resolution (1e-6s = 0.001ms), which is the finest
 * distinction the ms side can express.
 */
export function msToSeconds(ms: number): number {
  return tidy(ms / 1000, 6);
}

/**
 * Figma seconds -> MCP milliseconds.
 *
 * Rounded to 3dp (microseconds). Figma stores these as 32-bit floats, so a
 * duration written as 300ms comes back as 0.30000001192092896s and a naive
 * conversion reports `300.000012ms` — noise that makes a written value look
 * different from the value read back, which is exactly the confusion this
 * module exists to prevent. float32's relative error (~1e-7) stays far below
 * 0.001ms for any realistic animation duration.
 */
export function secondsToMs(seconds: number): number {
  return tidy(seconds * 1000, 3);
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
 * Round a dimensionless float (bezier control point, spring value) for
 * reporting.
 *
 * Figma stores these as 32-bit floats, so a bezier written as 0.4 reads back as
 * 0.4000000059604645. That noise makes a written value look different from the
 * value read back — the same confusion the ms/seconds conversion exists to
 * prevent, so it gets the same treatment.
 */
export function tidyFloat(value: number): number {
  return Math.round(value * 1e6) / 1e6;
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
