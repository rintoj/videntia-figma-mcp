import {
  animateNode,
  getMotionInfo,
  normalizeKeyframeField,
  normalizeKeyframeValue,
  normalizeMotionEasing,
  setKeyframeTrack,
  setTimelineDuration,
  MOTION_PRESETS,
} from "../../../src/videntia_figma_plugin/handlers/motion";
import { msToSeconds, secondsToMs, assertValidMs } from "../../../src/videntia_figma_plugin/utils/duration";

type MockNode = {
  id: string;
  name: string;
  type: string;
  timelines?: Array<{ id: string; duration: number }>;
  animationStyles?: Array<Record<string, unknown>>;
  manualKeyframeTracks?: Record<string, unknown>;
  applyManualKeyframeTrack?: jest.Mock;
  removeManualKeyframeTrack?: jest.Mock;
  applyAnimationStyle?: jest.Mock;
  removeAnimationStyle?: jest.Mock;
  setTimelineDuration?: jest.Mock;
};

let nodes: Map<string, MockNode>;

function motionNode(overrides: Partial<MockNode> = {}): MockNode {
  return {
    id: "1:2",
    name: "Hero",
    type: "FRAME",
    timelines: [{ id: "tl-1", duration: 1 }],
    animationStyles: [],
    manualKeyframeTracks: {},
    applyManualKeyframeTrack: jest.fn(),
    removeManualKeyframeTrack: jest.fn(),
    applyAnimationStyle: jest.fn(() => "as-1"),
    removeAnimationStyle: jest.fn(),
    setTimelineDuration: jest.fn(),
    ...overrides,
  };
}

function installFigma(options: { motion?: boolean } = {}) {
  const withMotion = options.motion !== false;
  (globalThis as any).figma = {
    getNodeByIdAsync: jest.fn(async (id: string) => nodes.get(id) ?? null),
    ...(withMotion
      ? {
          motion: {
            playheadPosition: 0.5,
            figmaAnimationStyles: jest.fn(() => [
              { styleId: "S:1", name: "Fade", props: {} },
              { styleId: "S:2", name: "Pop", props: {} },
            ]),
            physicalSpringToNormalized: jest.fn(() => 0.42),
          },
        }
      : {}),
  };
}

beforeEach(() => {
  nodes = new Map();
  installFigma();
});

describe("duration conversion", () => {
  it("round-trips milliseconds through seconds", () => {
    expect(msToSeconds(300)).toBe(0.3);
    expect(secondsToMs(0.3)).toBe(300);
    expect(secondsToMs(msToSeconds(2000))).toBe(2000);
  });

  it("tidies float noise", () => {
    expect(msToSeconds(100)).toBe(0.1);
    expect(secondsToMs(0.1 + 0.2)).toBe(300);
  });

  it("absorbs float32 noise coming back from Figma", () => {
    // Figma stores durations as 32-bit floats: 300ms written comes back as
    // 0.30000001192092896s. A naive conversion reported "300.000012ms", making
    // a written value look different from the value read back.
    expect(secondsToMs(0.30000001192092896)).toBe(300);
    expect(secondsToMs(0.20000000298023224)).toBe(200);
    expect(secondsToMs(2.0000000298023224)).toBe(2000);
  });

  it("rejects negative and non-finite durations", () => {
    expect(() => assertValidMs(-1, "duration")).toThrow("must be >= 0");
    expect(() => assertValidMs(NaN, "duration")).toThrow("finite");
  });
});

describe("normalizeKeyframeValue", () => {
  it("infers FLOAT from a bare number", () => {
    expect(normalizeKeyframeValue(0.5, "x")).toEqual({ type: "FLOAT", value: 0.5 });
  });

  it("infers COLOR from an rgba object, defaulting alpha", () => {
    expect(normalizeKeyframeValue({ r: 1, g: 0, b: 0 }, "x")).toEqual({
      type: "COLOR",
      value: { r: 1, g: 0, b: 0, a: 1 },
    });
  });

  it("infers VECTOR from {x,y}", () => {
    expect(normalizeKeyframeValue({ x: 1, y: 2 }, "x")).toEqual({ type: "VECTOR", value: { x: 1, y: 2 } });
  });

  it("passes an explicit {type,value} through", () => {
    expect(normalizeKeyframeValue({ type: "BOOL", value: true }, "x")).toEqual({ type: "BOOL", value: true });
  });

  it("infers COLOR_POINT from {x,y,color} instead of dropping the colour", () => {
    // Previously fell through to VECTOR and discarded `color` silently — a
    // gradient-stop keyframe would lose its colour with no error.
    expect(normalizeKeyframeValue({ x: 0.5, y: 0.5, color: { r: 1, g: 0, b: 0, a: 1 } }, "x")).toEqual({
      type: "COLOR_POINT",
      value: { x: 0.5, y: 0.5, color: { r: 1, g: 0, b: 0, a: 1 } },
    });
  });

  it("strips stray keys from shape values", () => {
    expect(normalizeKeyframeValue({ x: 1, y: 2, radius: 3, bogus: 9 }, "x")).toEqual({
      type: "CIRCLE",
      value: { x: 1, y: 2, radius: 3 },
    });
  });

  it("rejects an uninterpretable value", () => {
    expect(() => normalizeKeyframeValue({ nope: 1 }, "x")).toThrow("could not interpret");
  });
});

describe("normalizeKeyframeField", () => {
  it("accepts a property shorthand", () => {
    expect(normalizeKeyframeField("OPACITY")).toEqual({ type: "PROPERTY", name: "OPACITY" });
  });

  it("rejects an unknown property and lists the valid ones", () => {
    expect(() => normalizeKeyframeField("OPACTIY")).toThrow(/Unknown keyframe property/);
  });

  it("accepts an indexed effects field", () => {
    expect(normalizeKeyframeField({ type: "INDEXED_ITEM", collection: "effects", index: 0, field: "RADIUS" })).toEqual({
      type: "INDEXED_ITEM",
      collection: "effects",
      index: 0,
      field: "RADIUS",
    });
  });

  it("rejects an unknown collection", () => {
    expect(() => normalizeKeyframeField({ type: "INDEXED_ITEM", collection: "shadows", index: 0 })).toThrow(
      /must be "fills", "strokes" or "effects"/,
    );
  });
});

describe("normalizeMotionEasing", () => {
  it("accepts a bare string", () => {
    expect(normalizeMotionEasing("EASE_OUT")).toEqual({ type: "EASE_OUT" });
  });

  it("requires control points for CUSTOM_CUBIC_BEZIER", () => {
    expect(() => normalizeMotionEasing({ type: "CUSTOM_CUBIC_BEZIER" })).toThrow(/easingFunctionCubicBezier/);
  });

  it("converts a physical spring to Motion's normalized bounce", () => {
    const result = normalizeMotionEasing({
      type: "CUSTOM_SPRING",
      easingFunctionSpring: { mass: 1, stiffness: 100, damping: 10 },
    });
    // Motion's spring is {bounce}, NOT the 4-field physical spring prototyping uses.
    expect(result).toEqual({ type: "CUSTOM_SPRING", easingFunctionSpring: { bounce: 0.42 } });
    expect((globalThis as any).figma.motion.physicalSpringToNormalized).toHaveBeenCalled();
  });

  it("passes a normalized spring through unchanged", () => {
    expect(normalizeMotionEasing({ type: "CUSTOM_SPRING", easingFunctionSpring: { bounce: 0.2 } })).toEqual({
      type: "CUSTOM_SPRING",
      easingFunctionSpring: { bounce: 0.2 },
    });
  });
});

describe("capability gate", () => {
  it("get_motion_info reports the reason rather than throwing when Motion is absent", async () => {
    installFigma({ motion: false });
    nodes.set("1:2", motionNode());
    const result = await getMotionInfo({ nodeIds: ["1:2"] });
    expect(result.motionSupported).toBe(false);
    expect(result.reason).toContain("Motion API is not available");
  });

  it("writes throw an actionable error when Motion is absent", async () => {
    installFigma({ motion: false });
    nodes.set("1:2", motionNode());
    await expect(
      setKeyframeTrack({ nodeId: "1:2", field: "OPACITY", keyframes: [{ timelinePosition: 0, value: 0 }] }),
    ).rejects.toThrow(/Motion API is not available/);
  });

  it("rejects a node that lacks the Motion mixin", async () => {
    nodes.set("page", { id: "page", name: "Page 1", type: "PAGE" });
    await expect(
      setKeyframeTrack({ nodeId: "page", field: "OPACITY", keyframes: [{ timelinePosition: 0, value: 0 }] }),
    ).rejects.toThrow(/does not support Motion/);
  });
});

describe("setKeyframeTrack", () => {
  it("converts ms positions to seconds for Figma", async () => {
    const node = motionNode();
    nodes.set("1:2", node);

    await setKeyframeTrack({
      nodeId: "1:2",
      field: "OPACITY",
      baseValue: 1,
      keyframes: [
        { timelinePosition: 0, value: 0 },
        { timelinePosition: 200, value: 1, easing: "EASE_OUT" },
      ],
    });

    const [field, track] = node.applyManualKeyframeTrack!.mock.calls[0];
    expect(field).toEqual({ type: "PROPERTY", name: "OPACITY" });
    expect(track.keyframes[0].timelinePosition).toBe(0);
    expect(track.keyframes[1].timelinePosition).toBe(0.2); // 200ms -> 0.2s
    expect(track.baseValue).toEqual({ type: "FLOAT", value: 1 });
  });

  it("warns when the node has no timeline", async () => {
    const node = motionNode({ timelines: [] });
    nodes.set("1:2", node);

    const result = await setKeyframeTrack({
      nodeId: "1:2",
      field: "OPACITY",
      keyframes: [{ timelinePosition: 0, value: 0 }],
    });
    expect(result.warnings.join(" ")).toContain("no timeline");
    expect(result.success).toBe(true);
  });

  it("rejects an empty keyframe list", async () => {
    nodes.set("1:2", motionNode());
    await expect(setKeyframeTrack({ nodeId: "1:2", field: "OPACITY", keyframes: [] })).rejects.toThrow(
      /non-empty array/,
    );
  });
});

describe("setTimelineDuration", () => {
  it("converts ms to seconds", async () => {
    const node = motionNode();
    nodes.set("1:2", node);
    await setTimelineDuration({ nodeId: "1:2", duration: 1500 });
    expect(node.setTimelineDuration).toHaveBeenCalledWith("tl-1", 1.5);
  });

  it("names the createTimeline limitation when there is no timeline", async () => {
    nodes.set("1:2", motionNode({ timelines: [] }));
    await expect(setTimelineDuration({ nodeId: "1:2", duration: 500 })).rejects.toThrow(/no createTimeline/);
  });
});

describe("animateNode", () => {
  it("writes every track the preset defines", async () => {
    const node = motionNode();
    nodes.set("1:2", node);

    const result = await animateNode({ nodeId: "1:2", preset: "slide-up" });

    // slide-up animates TRANSLATION_Y and OPACITY.
    expect(node.applyManualKeyframeTrack).toHaveBeenCalledTimes(2);
    const fields = node.applyManualKeyframeTrack!.mock.calls.map((c) => c[0].name);
    expect(fields).toEqual(["TRANSLATION_Y", "OPACITY"]);
    expect(result.success).toBe(true);
  });

  it("scales the slide distance and offsets by the delay", async () => {
    const node = motionNode();
    nodes.set("1:2", node);

    await animateNode({ nodeId: "1:2", preset: "slide-up", duration: 200, delay: 100, distance: 16 });

    const [, track] = node.applyManualKeyframeTrack!.mock.calls[0];
    // First keyframe starts at the delay (100ms -> 0.1s) and travels `distance`.
    expect(track.keyframes[0].timelinePosition).toBe(0.1);
    expect(track.keyframes[0].value).toEqual({ type: "FLOAT", value: 16 });
    // Last keyframe lands at delay + duration = 300ms.
    expect(track.keyframes[1].timelinePosition).toBe(0.3);
  });

  it("grows the timeline to fit the effect", async () => {
    const node = motionNode({ timelines: [{ id: "tl-1", duration: 0.1 }] });
    nodes.set("1:2", node);

    await animateNode({ nodeId: "1:2", preset: "fade-in", duration: 400 });
    expect(node.setTimelineDuration).toHaveBeenCalledWith("tl-1", 0.4);
  });

  it("leaves a timeline that is already long enough", async () => {
    const node = motionNode({ timelines: [{ id: "tl-1", duration: 5 }] });
    nodes.set("1:2", node);

    const result = await animateNode({ nodeId: "1:2", preset: "fade-in" });
    expect(node.setTimelineDuration).not.toHaveBeenCalled();
    expect(String(result.applied["timelineDuration"])).toContain("unchanged");
  });

  it("throws rather than reporting success when EVERY track fails", async () => {
    const node = motionNode();
    node.applyManualKeyframeTrack = jest.fn(() => {
      throw new Error("unsupported");
    });
    nodes.set("1:2", node);

    // Reporting success: true with an empty `applied` told the caller the
    // animation had been applied when nothing was written at all.
    await expect(animateNode({ nodeId: "1:2", preset: "slide-up" })).rejects.toThrow(/every keyframe track/);
  });

  it("counts applied and failed tracks on a partial failure", async () => {
    const node = motionNode();
    node.applyManualKeyframeTrack = jest.fn((field: any) => {
      if (field.name === "OPACITY") throw new Error("nope");
    });
    nodes.set("1:2", node);

    const result = await animateNode({ nodeId: "1:2", preset: "slide-up" });
    expect(result.appliedCount).toBe(1);
    expect(result.failedCount).toBe(1);
  });

  it("rejects an unknown preset and lists the valid ones", async () => {
    nodes.set("1:2", motionNode());
    await expect(animateNode({ nodeId: "1:2", preset: "fade-sideways" })).rejects.toThrow(/unknown preset/);
  });

  it("reports a failed track as a warning rather than failing wholesale", async () => {
    const node = motionNode();
    node.applyManualKeyframeTrack = jest.fn((field: any) => {
      if (field.name === "OPACITY") throw new Error("nope");
    });
    nodes.set("1:2", node);

    const result = await animateNode({ nodeId: "1:2", preset: "slide-up" });
    expect(result.success).toBe(true);
    expect(result.warnings.join(" ")).toContain("OPACITY: nope");
    expect(result.applied["TRANSLATION_Y"]).toBeDefined();
  });

  it("keeps every preset inside the 90-500ms band, except the looping pulse", () => {
    for (const [name, preset] of Object.entries(MOTION_PRESETS)) {
      if (name === "pulse") continue; // a continuous loop, not a transition
      expect(preset.durationMs).toBeGreaterThanOrEqual(90);
      expect(preset.durationMs).toBeLessThanOrEqual(500);
    }
  });
});
