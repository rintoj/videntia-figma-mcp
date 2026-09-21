// Figma Motion handlers — timelines, keyframe tracks and animation styles.
//
// Motion is a SECOND, INDEPENDENT animation system. It is NOT prototyping:
// `reactions`/`Transition` drive navigation between frames, while Motion
// animates properties of a single node along a timeline.
//
// The API is BETA ("subject to change") and may be absent entirely, so every
// entry point goes through assertMotionSupported first — see
// utils/motion-support.ts for why a raw TypeError is not good enough.
//
// DURATIONS: milliseconds at the MCP boundary, seconds at the Figma boundary.
// Motion measures `timelinePosition`, `duration` and `timelineOffset` in
// seconds; we convert in both directions here.

import { assertValidMs, msToSeconds, secondsToMs } from "../utils/duration";
import { assertMotionSupported, describeMotionSupport, isMotionSupported } from "../utils/motion-support";

// ---------------------------------------------------------------------------
// Types mirroring the Motion API, loosened at our boundary
// ---------------------------------------------------------------------------

interface KeyframeValueLike {
  type: string;
  value: unknown;
}

interface MotionEasingLike {
  type?: string;
  easingFunctionCubicBezier?: { x1: number; y1: number; x2: number; y2: number };
  easingFunctionSpring?: { bounce: number };
}

interface TimelineLike {
  id: string;
  duration: number;
}

interface MotionNodeLike {
  id: string;
  name: string;
  type: string;
  animationStyles?: Array<Record<string, unknown>>;
  animations?: Record<string, unknown>;
  manualKeyframeTracks?: Record<string, unknown>;
  timelines?: ReadonlyArray<TimelineLike>;
  applyAnimationStyle?: (styleId: string, config?: Record<string, unknown>) => string;
  removeAnimationStyle?: (id: string) => void;
  applyManualKeyframeTrack?: (field: unknown, track: Record<string, unknown>) => void;
  removeManualKeyframeTrack?: (field: unknown) => void;
  setTimelineDuration?: (id: string, duration: number) => void;
}

/**
 * Every property field the Motion API accepts on a PROPERTY keyframe track.
 * Kept explicit so a typo is rejected here rather than silently ignored by
 * Figma.
 */
const KEYFRAME_PROPERTY_FIELDS = [
  "CORNER_RADIUS",
  "STROKE_WEIGHT",
  "STACK_SPACING",
  "STACK_PADDING_LEFT",
  "STACK_PADDING_TOP",
  "STACK_PADDING_RIGHT",
  "STACK_PADDING_BOTTOM",
  "WIDTH",
  "HEIGHT",
  "RECTANGLE_TOP_LEFT_CORNER_RADIUS",
  "RECTANGLE_TOP_RIGHT_CORNER_RADIUS",
  "RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS",
  "RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS",
  "BORDER_TOP_WEIGHT",
  "BORDER_BOTTOM_WEIGHT",
  "BORDER_LEFT_WEIGHT",
  "BORDER_RIGHT_WEIGHT",
  "STACK_COUNTER_SPACING",
  "OPACITY",
  "GRID_ROW_GAP",
  "GRID_COLUMN_GAP",
  "TRANSLATION_X",
  "TRANSLATION_Y",
  "TRANSLATION_XY",
  "ROTATION",
  "SCALE_X",
  "SCALE_Y",
  "SCALE_XY",
  "PATH_TRIM_START",
  "PATH_TRIM_END",
];

async function loadMotionNode(nodeId: string, commandName: string): Promise<MotionNodeLike> {
  if (!nodeId) throw new Error(`${commandName}: nodeId is required`);
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`${commandName}: Node not found: ${nodeId}`);
  assertMotionSupported(node, commandName);
  return node as unknown as MotionNodeLike;
}

// ---------------------------------------------------------------------------
// Value + easing normalisation
// ---------------------------------------------------------------------------

/**
 * Accept a loose value and produce a Motion `KeyframeValue`.
 *
 * A bare number becomes FLOAT, a bare boolean BOOL, a bare string TEXT_DATA,
 * an {r,g,b,a} object COLOR, and {x,y} a VECTOR. An explicit
 * `{type, value}` is passed through untouched.
 */
export function normalizeKeyframeValue(value: unknown, fieldLabel: string): KeyframeValueLike {
  if (value === null || value === undefined) {
    throw new Error(`${fieldLabel}: a keyframe value is required`);
  }

  if (typeof value === "object" && value !== null && "type" in (value as Record<string, unknown>)) {
    const typed = value as KeyframeValueLike;
    if (typed.value === undefined) {
      throw new Error(`${fieldLabel}: keyframe value of type ${typed.type} is missing its "value"`);
    }
    return typed;
  }

  if (typeof value === "number") {
    if (!isFinite(value)) throw new Error(`${fieldLabel}: keyframe value must be finite`);
    return { type: "FLOAT", value };
  }
  if (typeof value === "boolean") return { type: "BOOL", value };
  if (typeof value === "string") return { type: "TEXT_DATA", value };

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj["r"] === "number" && typeof obj["g"] === "number" && typeof obj["b"] === "number") {
      return {
        type: "COLOR",
        value: { r: obj["r"], g: obj["g"], b: obj["b"], a: typeof obj["a"] === "number" ? obj["a"] : 1 },
      };
    }
    if (typeof obj["x"] === "number" && typeof obj["y"] === "number") {
      const x = obj["x"] as number;
      const y = obj["y"] as number;

      if (typeof obj["radius"] === "number") {
        const radius = obj["radius"] as number;
        // CIRCLE_POINT is CIRCLE plus an angle.
        return typeof obj["angle"] === "number"
          ? { type: "CIRCLE_POINT", value: { x, y, radius, angle: obj["angle"] as number } }
          : { type: "CIRCLE", value: { x, y, radius } };
      }
      if (typeof obj["x2"] === "number" && typeof obj["y2"] === "number") {
        return { type: "LINE", value: { x, y, x2: obj["x2"] as number, y2: obj["y2"] as number } };
      }
      // COLOR_POINT ({x, y, color}) — a gradient-stop keyframe. Without this it
      // fell through to VECTOR and the colour was silently discarded.
      const color = obj["color"];
      if (color !== null && typeof color === "object") {
        const rgba = color as Record<string, unknown>;
        if (typeof rgba["r"] === "number" && typeof rgba["g"] === "number" && typeof rgba["b"] === "number") {
          return {
            type: "COLOR_POINT",
            value: {
              x,
              y,
              color: {
                r: rgba["r"],
                g: rgba["g"],
                b: rgba["b"],
                a: typeof rgba["a"] === "number" ? rgba["a"] : 1,
              },
            },
          };
        }
      }
      return { type: "VECTOR", value: { x, y } };
    }
  }

  throw new Error(
    `${fieldLabel}: could not interpret keyframe value ${JSON.stringify(value)}. ` +
      'Pass a number, boolean, string, {r,g,b,a}, {x,y}, or an explicit {type, value} such as {"type":"FLOAT","value":0}.',
  );
}

/**
 * Normalise Motion easing.
 *
 * Motion's spring is a NORMALIZED spring ({bounce}), unlike prototyping's
 * 4-field physical spring. A physical spring is accepted and converted via
 * `figma.motion.physicalSpringToNormalized`.
 */
export function normalizeMotionEasing(easing: unknown): Record<string, unknown> | undefined {
  if (easing === undefined || easing === null) return undefined;

  const raw: MotionEasingLike =
    typeof easing === "string" ? { type: easing } : (easing as MotionEasingLike & Record<string, unknown>);
  const type = raw.type ?? "EASE_OUT";
  const result: Record<string, unknown> = { type };

  if (type === "CUSTOM_CUBIC_BEZIER") {
    if (!raw.easingFunctionCubicBezier) {
      throw new Error("Motion easing CUSTOM_CUBIC_BEZIER requires easingFunctionCubicBezier {x1,y1,x2,y2}");
    }
    result["easingFunctionCubicBezier"] = raw.easingFunctionCubicBezier;
  }

  if (type === "CUSTOM_SPRING") {
    const spring = raw.easingFunctionSpring as unknown as Record<string, number> | undefined;
    if (!spring) {
      throw new Error(
        "Motion easing CUSTOM_SPRING requires easingFunctionSpring — either {bounce} or {mass,stiffness,damping}",
      );
    }
    if (typeof spring["bounce"] === "number") {
      result["easingFunctionSpring"] = { bounce: spring["bounce"] };
    } else if (
      typeof spring["mass"] === "number" &&
      typeof spring["stiffness"] === "number" &&
      typeof spring["damping"] === "number"
    ) {
      // Motion wants a normalized bounce; convert the physical form for the caller.
      const motionApi = (figma as unknown as { motion: { physicalSpringToNormalized: (s: unknown) => number } }).motion;
      result["easingFunctionSpring"] = {
        bounce: motionApi.physicalSpringToNormalized({
          mass: spring["mass"],
          stiffness: spring["stiffness"],
          damping: spring["damping"],
        }),
      };
    } else {
      throw new Error("easingFunctionSpring must be {bounce} or {mass,stiffness,damping}");
    }
  }

  return result;
}

/** Build a Motion `KeyframeField` from our loose input. */
export function normalizeKeyframeField(field: unknown): Record<string, unknown> {
  if (typeof field === "string") {
    const name = field.toUpperCase();
    if (KEYFRAME_PROPERTY_FIELDS.indexOf(name) === -1) {
      throw new Error(
        `Unknown keyframe property "${field}". Expected one of: ${KEYFRAME_PROPERTY_FIELDS.join(", ")}. ` +
          'For a fill, stroke or effect track pass the object form instead, e.g. {"type":"INDEXED_ITEM","collection":"fills","index":0}.',
      );
    }
    return { type: "PROPERTY", name };
  }

  if (typeof field !== "object" || field === null) {
    throw new Error('field must be a property name (e.g. "OPACITY") or a KeyframeField object');
  }

  const obj = field as Record<string, unknown>;
  const type = obj["type"];

  if (type === "PROPERTY") {
    const name = String(obj["name"] ?? "").toUpperCase();
    if (KEYFRAME_PROPERTY_FIELDS.indexOf(name) === -1) {
      throw new Error(
        `Unknown keyframe property "${obj["name"]}". Expected one of: ${KEYFRAME_PROPERTY_FIELDS.join(", ")}.`,
      );
    }
    return { type: "PROPERTY", name };
  }

  if (type === "INDEXED_ITEM") {
    const collection = obj["collection"];
    if (collection !== "fills" && collection !== "strokes" && collection !== "effects") {
      throw new Error('INDEXED_ITEM collection must be "fills", "strokes" or "effects"');
    }
    const index = obj["index"];
    if (typeof index !== "number" || index < 0) {
      throw new Error("INDEXED_ITEM requires a non-negative numeric index");
    }
    const result: Record<string, unknown> = { type: "INDEXED_ITEM", collection, index };
    if (obj["field"] !== undefined) result["field"] = obj["field"];
    if (obj["propertyId"] !== undefined) result["propertyId"] = obj["propertyId"];
    return result;
  }

  throw new Error(`Unknown keyframe field type "${String(type)}". Expected "PROPERTY" or "INDEXED_ITEM".`);
}

/**
 * The combined-axis fields take a VECTOR keyframe value, not a FLOAT.
 * Figma rejects a scalar outright:
 *   "baseValue for SCALE_XY must be a VECTOR keyframe value"
 * Callers naturally reach for a single number ("scale to 0.97"), so a scalar is
 * widened to {x, y} rather than bounced back.
 */
function isVectorField(field: Record<string, unknown>): boolean {
  return field["type"] === "PROPERTY" && String(field["name"]).slice(-3) === "_XY";
}

function widenScalarToVector(value: KeyframeValueLike): KeyframeValueLike {
  if (value.type !== "FLOAT" || typeof value.value !== "number") return value;
  return { type: "VECTOR", value: { x: value.value, y: value.value } };
}

/** A short label for error messages. */
function fieldLabel(field: Record<string, unknown>): string {
  if (field["type"] === "PROPERTY") return String(field["name"]);
  return `${String(field["collection"])}[${String(field["index"])}]`;
}

// ---------------------------------------------------------------------------
// get_motion_info
// ---------------------------------------------------------------------------

export interface MotionTrackSummary {
  field: string;
  keyframeCount: number;
  /** Milliseconds. */
  positions: number[];
  baseValue?: unknown;
}

export interface MotionNodeInfo {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  timelines: Array<{ id: string; durationMs: number }>;
  animationStyles: Array<Record<string, unknown>>;
  manualKeyframeTracks: MotionTrackSummary[];
  hasMotion: boolean;
}

export interface GetMotionInfoResult {
  motionSupported: boolean;
  playheadPositionMs?: number;
  nodeCount: number;
  nodesWithMotion: number;
  nodes: MotionNodeInfo[];
  reason?: string;
}

/**
 * Figma's built-in animation styles express these props in SECONDS
 * (`duration: number // default: 0.5 (s)`). Everything else on this server is
 * milliseconds, so they are converted in both directions — otherwise
 * `props: { duration: 240 }` would mean 240 SECONDS.
 */
const TIME_VALUED_STYLE_PROPS = ["duration", "delay", "timelineOffset"];

function convertStyleProps(props: unknown, convert: (value: number) => number): Record<string, unknown> | undefined {
  if (props === null || typeof props !== "object") return undefined;
  const source = props as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    const value = source[key];
    result[key] = TIME_VALUED_STYLE_PROPS.indexOf(key) !== -1 && typeof value === "number" ? convert(value) : value;
  }
  return result;
}

/**
 * Report an applied animation style in milliseconds.
 *
 * Without this, `apply_animation_style { duration: 300 }` read back as
 * `duration: 0.30000001192092896` — seconds, with float32 noise — which is the
 * exact write/read disagreement this server exists to prevent.
 */
function describeAppliedStyle(style: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...style };
  if (typeof style["duration"] === "number") result["durationMs"] = secondsToMs(style["duration"] as number);
  if (typeof style["timelineOffset"] === "number") {
    result["timelineOffsetMs"] = secondsToMs(style["timelineOffset"] as number);
  }
  delete result["duration"];
  delete result["timelineOffset"];
  const props = convertStyleProps(style["props"], secondsToMs);
  if (props) result["props"] = props;
  return result;
}

/** Summarise one `ManualKeyframeBinding` without dumping the whole structure. */
function summarizeTrack(name: string, binding: unknown): MotionTrackSummary | null {
  if (typeof binding !== "object" || binding === null) return null;
  const obj = binding as Record<string, unknown>;
  const keyframes = obj["keyframes"];
  if (!Array.isArray(keyframes)) return null;

  return {
    field: name,
    keyframeCount: keyframes.length,
    positions: keyframes.map((kf) => {
      const position = (kf as Record<string, unknown>)["timelinePosition"];
      return typeof position === "number" ? secondsToMs(position) : 0;
    }),
    baseValue: obj["baseValue"],
  };
}

function collectTracks(tracks: Record<string, unknown> | undefined): MotionTrackSummary[] {
  if (!tracks) return [];
  const summaries: MotionTrackSummary[] = [];

  for (const key of Object.keys(tracks)) {
    const value = tracks[key];
    if (key === "fills" || key === "strokes" || key === "effects") {
      // Indexed collections: { 0: binding, 1: {...} }
      if (typeof value !== "object" || value === null) continue;
      const indexed = value as Record<string, unknown>;
      for (const index of Object.keys(indexed)) {
        const entry = indexed[index];
        if (typeof entry === "object" && entry !== null && !("keyframes" in entry)) {
          // An entry that is not itself a binding: either `{properties: {...}}`
          // (component-prop tracks, valid on fills/strokes AND effects) or, for
          // effects, a map of field -> binding. Both used to vanish silently —
          // fills/strokes because summarizeTrack returned null, and `properties`
          // because it was treated as an effect field name.
          const nested = entry as Record<string, unknown>;
          for (const nestedKey of Object.keys(nested)) {
            if (nestedKey === "properties") {
              const props = nested[nestedKey];
              if (props !== null && typeof props === "object") {
                const propMap = props as Record<string, unknown>;
                for (const propKey of Object.keys(propMap)) {
                  const summary = summarizeTrack(`${key}[${index}].properties.${propKey}`, propMap[propKey]);
                  if (summary) summaries.push(summary);
                }
              }
              continue;
            }
            const summary = summarizeTrack(`${key}[${index}].${nestedKey}`, nested[nestedKey]);
            if (summary) summaries.push(summary);
          }
          continue;
        }
        const summary = summarizeTrack(`${key}[${index}]`, entry);
        if (summary) summaries.push(summary);
      }
      continue;
    }
    const summary = summarizeTrack(key, value);
    if (summary) summaries.push(summary);
  }
  return summaries;
}

export async function getMotionInfo(params: Record<string, unknown>): Promise<GetMotionInfoResult> {
  const nodeIds = params["nodeIds"] as string[] | undefined;
  if (!Array.isArray(nodeIds)) throw new Error("nodeIds must be an array");

  const support = describeMotionSupport();
  if (!support.motionSupported) {
    return {
      motionSupported: false,
      nodeCount: nodeIds.length,
      nodesWithMotion: 0,
      nodes: [],
      reason: support.reason,
    };
  }

  const nodes: MotionNodeInfo[] = [];

  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) continue;
    const motionNode = node as unknown as MotionNodeLike;
    if (typeof motionNode.applyManualKeyframeTrack !== "function") continue;

    const timelines = (motionNode.timelines ?? []).map((t) => ({
      id: t.id,
      durationMs: secondsToMs(t.duration),
    }));
    const tracks = collectTracks(motionNode.manualKeyframeTracks);
    const styles = (motionNode.animationStyles ?? []).map(describeAppliedStyle);

    nodes.push({
      nodeId: motionNode.id,
      nodeName: motionNode.name,
      nodeType: motionNode.type,
      timelines,
      animationStyles: styles,
      manualKeyframeTracks: tracks,
      hasMotion: tracks.length > 0 || styles.length > 0,
    });
  }

  return {
    motionSupported: true,
    ...(support.playheadPositionMs === undefined ? {} : { playheadPositionMs: support.playheadPositionMs }),
    nodeCount: nodeIds.length,
    nodesWithMotion: nodes.filter((n) => n.hasMotion).length,
    nodes,
  };
}

// ---------------------------------------------------------------------------
// list_animation_styles
// ---------------------------------------------------------------------------

export interface ListAnimationStylesResult {
  motionSupported: boolean;
  count: number;
  styles: Array<Record<string, unknown>>;
  reason?: string;
}

export async function listAnimationStyles(): Promise<ListAnimationStylesResult> {
  if (!isMotionSupported()) {
    const support = describeMotionSupport();
    return { motionSupported: false, count: 0, styles: [], reason: support.reason };
  }

  const motionApi = (figma as unknown as { motion: { figmaAnimationStyles: () => Array<Record<string, unknown>> } })
    .motion;
  const styles = motionApi.figmaAnimationStyles();

  return { motionSupported: true, count: styles.length, styles };
}

// ---------------------------------------------------------------------------
// apply_animation_style / remove_animation_style
// ---------------------------------------------------------------------------

export interface ApplyAnimationStyleResult {
  nodeId: string;
  nodeName: string;
  appliedStyleId: string;
  styleName: string;
  warnings: string[];
  success: boolean;
}

export async function applyAnimationStyle(params: Record<string, unknown>): Promise<ApplyAnimationStyleResult> {
  const nodeId = params["nodeId"] as string;
  const style = params["style"] as string | undefined;
  if (!style) throw new Error("apply_animation_style: style (id or name) is required");

  const node = await loadMotionNode(nodeId, "apply_animation_style");

  const motionApi = (figma as unknown as { motion: { figmaAnimationStyles: () => Array<Record<string, unknown>> } })
    .motion;
  const available = motionApi.figmaAnimationStyles();

  // Accept an id OR a name, matching this server's name-over-id convention.
  const match =
    available.find((s) => s["styleId"] === style) ||
    available.find((s) => String(s["name"]).toLowerCase() === style.toLowerCase());

  if (!match) {
    throw new Error(
      `apply_animation_style: no animation style with id or name "${style}". ` +
        `Available: ${available.map((s) => s["name"]).join(", ") || "(none)"}. ` +
        "Call list_animation_styles to see them with their props.",
    );
  }

  const warnings: string[] = [];
  const config: Record<string, unknown> = {};

  const durationMs = params["duration"] as number | undefined;
  if (durationMs !== undefined) {
    assertValidMs(durationMs, "duration");
    config["duration"] = msToSeconds(durationMs);
  }
  const offsetMs = params["timelineOffset"] as number | undefined;
  if (offsetMs !== undefined) {
    assertValidMs(offsetMs, "timelineOffset");
    config["timelineOffset"] = msToSeconds(offsetMs);
  }
  if (params["props"] !== undefined) {
    // `delay` / `duration` inside props are seconds to Figma; ms to us.
    config["props"] = convertStyleProps(params["props"], msToSeconds) ?? params["props"];
  }

  const appliedStyleId = node.applyAnimationStyle!(String(match["styleId"]), config);

  if ((node.timelines ?? []).length === 0) {
    warnings.push(
      "The node reports no timeline after applying this style. The Figma Plugin API exposes " +
        "setTimelineDuration but no createTimeline, so a timeline may need to exist in the editor first.",
    );
  }

  return {
    nodeId: node.id,
    nodeName: node.name,
    appliedStyleId,
    styleName: String(match["name"]),
    warnings,
    success: true,
  };
}

export interface RemoveAnimationStyleResult {
  nodeId: string;
  nodeName: string;
  removedId: string;
  remainingCount: number;
  success: boolean;
}

export async function removeAnimationStyle(params: Record<string, unknown>): Promise<RemoveAnimationStyleResult> {
  const nodeId = params["nodeId"] as string;
  const id = params["id"] as string;
  if (!id) throw new Error("remove_animation_style: id is required (from get_motion_info or apply_animation_style)");

  const node = await loadMotionNode(nodeId, "remove_animation_style");

  const present = (node.animationStyles ?? []).some((s) => s["id"] === id);
  if (!present) {
    throw new Error(
      `remove_animation_style: node "${node.name}" has no applied animation style with id "${id}". ` +
        "Call get_motion_info to list the applied styles.",
    );
  }

  node.removeAnimationStyle!(id);

  return {
    nodeId: node.id,
    nodeName: node.name,
    removedId: id,
    remainingCount: (node.animationStyles ?? []).length,
    success: true,
  };
}

// ---------------------------------------------------------------------------
// set_keyframe_track / remove_keyframe_track
// ---------------------------------------------------------------------------

export interface SetKeyframeTrackResult {
  nodeId: string;
  nodeName: string;
  field: string;
  keyframeCount: number;
  warnings: string[];
  success: boolean;
}

export async function setKeyframeTrack(params: Record<string, unknown>): Promise<SetKeyframeTrackResult> {
  const nodeId = params["nodeId"] as string;
  const node = await loadMotionNode(nodeId, "set_keyframe_track");

  const field = normalizeKeyframeField(params["field"]);
  const label = fieldLabel(field);
  const vectorField = isVectorField(field);

  const keyframes = params["keyframes"];
  if (!Array.isArray(keyframes) || keyframes.length === 0) {
    throw new Error("set_keyframe_track: keyframes must be a non-empty array");
  }

  const warnings: string[] = [];

  const normalizedKeyframes = keyframes.map((entry, index) => {
    const kf = entry as Record<string, unknown>;
    const positionMs = kf["timelinePosition"];
    if (typeof positionMs !== "number") {
      throw new Error(`keyframes[${index}].timelinePosition is required, in milliseconds`);
    }
    assertValidMs(positionMs, `keyframes[${index}].timelinePosition`);

    const normalizedValue = normalizeKeyframeValue(kf["value"], `keyframes[${index}]`);
    const result: Record<string, unknown> = {
      timelinePosition: msToSeconds(positionMs),
      value: vectorField ? widenScalarToVector(normalizedValue) : normalizedValue,
    };
    const easing = normalizeMotionEasing(kf["easing"]);
    if (easing) result["easing"] = easing;
    if (kf["id"] !== undefined) result["id"] = kf["id"];
    return result;
  });

  const track: Record<string, unknown> = { keyframes: normalizedKeyframes };
  if (params["baseValue"] !== undefined) {
    const base = normalizeKeyframeValue(params["baseValue"], "baseValue");
    track["baseValue"] = vectorField ? widenScalarToVector(base) : base;
  }
  if (params["id"] !== undefined) track["id"] = params["id"];

  // NOTE: this REPLACES any existing track on this field — the API has no
  // append-a-keyframe operation.
  node.applyManualKeyframeTrack!(field, track);

  if ((node.timelines ?? []).length === 0) {
    warnings.push(
      "The node reports no timeline after writing this track. The Figma Plugin API exposes " +
        "setTimelineDuration but no createTimeline, so a timeline may need to exist in the editor first. " +
        "Open the Motion timeline panel on this node and re-run get_motion_info to confirm.",
    );
  }

  return {
    nodeId: node.id,
    nodeName: node.name,
    field: label,
    keyframeCount: normalizedKeyframes.length,
    warnings,
    success: true,
  };
}

export interface RemoveKeyframeTrackResult {
  nodeId: string;
  nodeName: string;
  field: string;
  success: boolean;
}

export async function removeKeyframeTrack(params: Record<string, unknown>): Promise<RemoveKeyframeTrackResult> {
  const nodeId = params["nodeId"] as string;
  const node = await loadMotionNode(nodeId, "remove_keyframe_track");
  const field = normalizeKeyframeField(params["field"]);

  node.removeManualKeyframeTrack!(field);

  return {
    nodeId: node.id,
    nodeName: node.name,
    field: fieldLabel(field),
    success: true,
  };
}

// ---------------------------------------------------------------------------
// set_timeline_duration
// ---------------------------------------------------------------------------

export interface SetTimelineDurationResult {
  nodeId: string;
  nodeName: string;
  timelineId: string;
  durationMs: number;
  success: boolean;
}

export async function setTimelineDuration(params: Record<string, unknown>): Promise<SetTimelineDurationResult> {
  const nodeId = params["nodeId"] as string;
  const node = await loadMotionNode(nodeId, "set_timeline_duration");

  const durationMs = params["duration"] as number;
  if (typeof durationMs !== "number") {
    throw new Error("set_timeline_duration: duration is required, in milliseconds");
  }
  assertValidMs(durationMs, "duration");

  const timelines = node.timelines ?? [];
  if (timelines.length === 0) {
    throw new Error(
      `set_timeline_duration: node "${node.name}" has no timeline. The Figma Plugin API exposes ` +
        "setTimelineDuration but no createTimeline — add a keyframe (set_keyframe_track / animate_node) " +
        "or create the timeline in the Motion panel first.",
    );
  }

  const requestedId = params["timelineId"] as string | undefined;
  const timeline = requestedId ? timelines.find((t) => t.id === requestedId) : timelines[0];

  if (!timeline) {
    throw new Error(
      `set_timeline_duration: no timeline with id "${requestedId}" on "${node.name}". ` +
        `Available: ${timelines.map((t) => t.id).join(", ")}.`,
    );
  }

  node.setTimelineDuration!(timeline.id, msToSeconds(durationMs));

  return {
    nodeId: node.id,
    nodeName: node.name,
    timelineId: timeline.id,
    durationMs,
    success: true,
  };
}

export { KEYFRAME_PROPERTY_FIELDS };

// ---------------------------------------------------------------------------
// animate_node — the composite. One round trip per common motion effect.
//
// Timings and easings come from resources/design-knowledge/motion.ts so the
// tool and the guidance this server ships cannot drift apart.
// ---------------------------------------------------------------------------

interface MotionPresetKeyframe {
  /** Fraction of the preset duration, 0..1. */
  at: number;
  value: number;
  easing?: string;
}

interface MotionPresetTrack {
  field: string;
  baseValue?: number;
  keyframes: MotionPresetKeyframe[];
  /** Multiply the value by `distance` (used by the slide presets). */
  scaleByDistance?: boolean;
}

interface MotionPreset {
  description: string;
  durationMs: number;
  easing: string;
  /** Default travel in px for the slide presets. */
  distance?: number;
  tracks: MotionPresetTrack[];
}

/**
 * House motion presets.
 *
 * Every duration sits inside the 90-500ms band from the design-knowledge
 * module, enter animations use EASE_OUT and exits EASE_IN, per that guidance.
 */
export const MOTION_PRESETS: Record<string, MotionPreset> = {
  "fade-in": {
    description: "Opacity 0 -> 1. List item / content entrance.",
    durationMs: 200,
    easing: "EASE_OUT",
    tracks: [
      {
        field: "OPACITY",
        baseValue: 1,
        keyframes: [
          { at: 0, value: 0 },
          { at: 1, value: 1 },
        ],
      },
    ],
  },
  "fade-out": {
    description: "Opacity 1 -> 0. Exits run faster than entrances.",
    durationMs: 160,
    easing: "EASE_IN",
    tracks: [
      {
        field: "OPACITY",
        baseValue: 1,
        keyframes: [
          { at: 0, value: 1 },
          { at: 1, value: 0 },
        ],
      },
    ],
  },
  "slide-up": {
    description: "Rise into place while fading in. Modal / sheet open.",
    durationMs: 240,
    easing: "EASE_OUT",
    distance: 8,
    tracks: [
      {
        field: "TRANSLATION_Y",
        baseValue: 0,
        scaleByDistance: true,
        keyframes: [
          { at: 0, value: 1 },
          { at: 1, value: 0 },
        ],
      },
      {
        field: "OPACITY",
        baseValue: 1,
        keyframes: [
          { at: 0, value: 0 },
          { at: 1, value: 1 },
        ],
      },
    ],
  },
  "slide-down": {
    description: "Drop into place while fading in.",
    durationMs: 240,
    easing: "EASE_OUT",
    distance: 8,
    tracks: [
      {
        field: "TRANSLATION_Y",
        baseValue: 0,
        scaleByDistance: true,
        keyframes: [
          { at: 0, value: -1 },
          { at: 1, value: 0 },
        ],
      },
      {
        field: "OPACITY",
        baseValue: 1,
        keyframes: [
          { at: 0, value: 0 },
          { at: 1, value: 1 },
        ],
      },
    ],
  },
  "slide-left": {
    description: "Slide in from the right edge. Drawer open.",
    durationMs: 280,
    easing: "EASE_OUT",
    distance: 16,
    tracks: [
      {
        field: "TRANSLATION_X",
        baseValue: 0,
        scaleByDistance: true,
        keyframes: [
          { at: 0, value: 1 },
          { at: 1, value: 0 },
        ],
      },
      {
        field: "OPACITY",
        baseValue: 1,
        keyframes: [
          { at: 0, value: 0 },
          { at: 1, value: 1 },
        ],
      },
    ],
  },
  "slide-right": {
    description: "Slide in from the left edge. Drawer open.",
    durationMs: 280,
    easing: "EASE_OUT",
    distance: 16,
    tracks: [
      {
        field: "TRANSLATION_X",
        baseValue: 0,
        scaleByDistance: true,
        keyframes: [
          { at: 0, value: -1 },
          { at: 1, value: 0 },
        ],
      },
      {
        field: "OPACITY",
        baseValue: 1,
        keyframes: [
          { at: 0, value: 0 },
          { at: 1, value: 1 },
        ],
      },
    ],
  },
  "scale-in": {
    description: "Scale 0 -> 100% with a fade. Success checkmark / popover.",
    durationMs: 200,
    easing: "EASE_OUT",
    tracks: [
      {
        field: "SCALE_XY",
        baseValue: 1,
        keyframes: [
          { at: 0, value: 0 },
          { at: 1, value: 1 },
        ],
      },
      {
        field: "OPACITY",
        baseValue: 1,
        keyframes: [
          { at: 0, value: 0 },
          { at: 1, value: 1 },
        ],
      },
    ],
  },
  pulse: {
    description: "Opacity 40% -> 80% -> 40%. Skeleton loading; meant to loop.",
    durationMs: 1200,
    easing: "EASE_IN_AND_OUT",
    tracks: [
      {
        field: "OPACITY",
        baseValue: 1,
        keyframes: [
          { at: 0, value: 0.4 },
          { at: 0.5, value: 0.8 },
          { at: 1, value: 0.4 },
        ],
      },
    ],
  },
  "press-feedback": {
    description: "Scale to 97% and back. Button press.",
    durationMs: 240,
    easing: "EASE_IN_AND_OUT",
    tracks: [
      {
        field: "SCALE_XY",
        baseValue: 1,
        keyframes: [
          { at: 0, value: 1 },
          { at: 0.375, value: 0.97 },
          { at: 1, value: 1 },
        ],
      },
    ],
  },
};

export interface AnimateNodeResult {
  nodeId: string;
  nodeName: string;
  preset: string;
  durationMs: number;
  easing: string;
  applied: Record<string, unknown>;
  appliedCount: number;
  failedCount: number;
  warnings: string[];
  success: boolean;
}

export async function animateNode(params: Record<string, unknown>): Promise<AnimateNodeResult> {
  const nodeId = params["nodeId"] as string;
  const presetName = params["preset"] as string;

  if (!presetName) {
    throw new Error(`animate_node: preset is required. Available: ${Object.keys(MOTION_PRESETS).join(", ")}.`);
  }
  const preset = MOTION_PRESETS[presetName];
  if (!preset) {
    throw new Error(
      `animate_node: unknown preset "${presetName}". Available: ${Object.keys(MOTION_PRESETS).join(", ")}.`,
    );
  }

  const node = await loadMotionNode(nodeId, "animate_node");

  const durationMs = (params["duration"] as number | undefined) ?? preset.durationMs;
  assertValidMs(durationMs, "duration");
  const delayMs = (params["delay"] as number | undefined) ?? 0;
  assertValidMs(delayMs, "delay");
  const distance = (params["distance"] as number | undefined) ?? preset.distance ?? 0;
  const easing = normalizeMotionEasing(params["easing"] ?? preset.easing);

  const warnings: string[] = [];
  const applied: Record<string, unknown> = {};
  let appliedCount = 0;

  for (const track of preset.tracks) {
    const field = normalizeKeyframeField(track.field);

    const vectorField = isVectorField(field);
    const asKeyframeValue = (value: number): KeyframeValueLike =>
      vectorField ? { type: "VECTOR", value: { x: value, y: value } } : { type: "FLOAT", value };

    const keyframes = track.keyframes.map((kf) => {
      const positionMs = delayMs + kf.at * durationMs;
      const value = track.scaleByDistance ? kf.value * distance : kf.value;
      const entry: Record<string, unknown> = {
        timelinePosition: msToSeconds(positionMs),
        value: asKeyframeValue(value),
      };
      if (easing) entry["easing"] = easing;
      return entry;
    });

    // With a delay, the first keyframe lands at `delayMs`, not 0. What the node
    // shows between 0 and the delay then depends on how Motion treats
    // `baseValue` (the RESTING value — opacity 1 for fade-in): if it renders the
    // base value before the first keyframe, the node sits fully visible, then
    // snaps to opacity 0 and animates in. That is exactly wrong for the
    // staggered-entrance case `delay` exists for.
    //
    // The playhead is read-only, so the rendered value in that window cannot be
    // observed through the API. Rather than bet on one reading of baseValue,
    // pin the start value at 0 explicitly: correct under either semantics.
    if (delayMs > 0 && keyframes.length > 0) {
      keyframes.unshift({ timelinePosition: 0, value: keyframes[0]["value"] });
    }

    const trackInput: Record<string, unknown> = { keyframes };
    if (track.baseValue !== undefined) {
      trackInput["baseValue"] = asKeyframeValue(track.baseValue);
    }

    try {
      node.applyManualKeyframeTrack!(field, trackInput);
      applied[track.field] = `${keyframes.length} keyframe(s)`;
      appliedCount += 1;
    } catch (error) {
      // A composite reports what it could not do rather than failing wholesale.
      warnings.push(`${track.field}: ${(error as Error).message}`);
    }
  }

  const totalMs = delayMs + durationMs;
  const timelines = node.timelines ?? [];

  if (timelines.length === 0) {
    warnings.push(
      "The node reports no timeline after writing these tracks, so the timeline duration was not set. " +
        "The Figma Plugin API exposes setTimelineDuration but no createTimeline — open the Motion panel " +
        "on this node, then re-run get_motion_info to confirm the keyframes landed.",
    );
  } else {
    const timeline = timelines[0];
    if (timeline.duration < totalMs / 1000) {
      // Grow the timeline so the last keyframe is reachable.
      try {
        node.setTimelineDuration!(timeline.id, msToSeconds(totalMs));
        applied["timelineDuration"] = `${totalMs}ms`;
      } catch (error) {
        warnings.push(`timelineDuration: ${(error as Error).message}`);
      }
    } else {
      applied["timelineDuration"] = `${secondsToMs(timeline.duration)}ms (unchanged, already long enough)`;
    }
  }

  // A composite tolerates a partial failure, but reporting success: true when
  // EVERY track failed would tell the caller the animation was applied when
  // nothing was written at all.
  const failedCount = preset.tracks.length - appliedCount;
  if (appliedCount === 0) {
    throw new Error(
      `animate_node: every keyframe track for preset "${presetName}" failed on "${node.name}". ` + warnings.join("; "),
    );
  }

  return {
    nodeId: node.id,
    nodeName: node.name,
    preset: presetName,
    durationMs,
    easing: String((easing ?? {})["type"] ?? preset.easing),
    applied,
    appliedCount,
    failedCount,
    warnings,
    success: true,
  };
}
