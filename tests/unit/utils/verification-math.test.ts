import {
  compositeOver,
  sampleGradientStops,
  gradientParamAt,
  resolvePaint,
  resolveBackdrop,
  isLargeText,
  fontWeightFromStyle,
  evaluateTextSample,
  sweepContrast,
  renderStackAt,
  textSamplePoints,
  intersectRects,
  findOverlappingSiblings,
  valuesMatch,
  diffNodeState,
  tokenKeyOf,
  findTokenCollisions,
  type TextSample,
  type StackNode,
  type OverlapNode,
  type VariableRecord,
} from "../../../src/videntia_figma_mcp/utils/verification-math";

const solid = (hexish: { r: number; g: number; b: number }, opacity = 1) => ({
  type: "SOLID",
  color: { ...hexish, a: 1 },
  opacity,
});

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 1, g: 1, b: 1 };

describe("compositeOver", () => {
  it("returns the source unchanged when fully opaque", () => {
    expect(compositeOver({ r: 1, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 1, a: 1 })).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it("blends 50% black over white to mid grey", () => {
    const out = compositeOver({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 1, g: 1, b: 1, a: 1 });
    expect(out.r).toBeCloseTo(0.5, 5);
    expect(out.a).toBe(1);
  });

  it("treats a missing alpha as opaque", () => {
    expect(compositeOver({ r: 0.2, g: 0.2, b: 0.2 }, WHITE).r).toBeCloseTo(0.2, 5);
  });
});

describe("sampleGradientStops", () => {
  const stops = [
    { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
  ];

  it("interpolates linearly between two stops", () => {
    expect(sampleGradientStops(stops, 0.25).r).toBeCloseTo(0.25, 5);
    expect(sampleGradientStops(stops, 0.75).g).toBeCloseTo(0.75, 5);
  });

  it("clamps outside the stop range", () => {
    expect(sampleGradientStops(stops, -3).r).toBe(0);
    expect(sampleGradientStops(stops, 9).r).toBe(1);
  });

  it("handles unsorted stops and a mid stop", () => {
    const messy = [
      { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
      { position: 0.5, color: { r: 1, g: 0, b: 0, a: 1 } },
      { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
    ];
    expect(sampleGradientStops(messy, 0.5).r).toBeCloseTo(1, 5);
    expect(sampleGradientStops(messy, 0.25).r).toBeCloseTo(0.5, 5);
  });

  it("returns transparent for an empty stop list", () => {
    expect(sampleGradientStops([], 0.5).a).toBe(0);
  });
});

describe("gradientParamAt", () => {
  it("projects onto a vertical axis", () => {
    const handles = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(gradientParamAt(handles, { x: 0.5, y: 0.3 })).toBeCloseTo(0.3, 5);
  });

  it("projects onto a horizontal axis", () => {
    const handles = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
    expect(gradientParamAt(handles, { x: 0.8, y: 0.1 })).toBeCloseTo(0.8, 5);
  });

  it("falls back to the y axis without handles", () => {
    expect(gradientParamAt(undefined, { x: 0.2, y: 0.6 })).toBeCloseTo(0.6, 5);
  });
});

describe("resolvePaint", () => {
  it("multiplies paint opacity into alpha", () => {
    const out = resolvePaint(solid(BLACK, 0.4), { x: 0, y: 0 });
    expect(out?.a).toBeCloseTo(0.4, 5);
  });

  it("skips invisible and zero-opacity paints", () => {
    expect(resolvePaint({ type: "SOLID", color: { r: 1, g: 0, b: 0 }, visible: false }, { x: 0, y: 0 })).toBeNull();
    expect(resolvePaint(solid(BLACK, 0), { x: 0, y: 0 })).toBeNull();
  });

  it("returns null for image paints (unknowable from metadata)", () => {
    expect(resolvePaint({ type: "IMAGE" }, { x: 0, y: 0 })).toBeNull();
  });
});

describe("resolveBackdrop", () => {
  it("resolves the innermost opaque ancestor fill", () => {
    const out = resolveBackdrop(
      [
        { nodeId: "1", nodeName: "Page", bounds: { x: 0, y: 0, width: 100, height: 100 }, fills: [solid(WHITE)] },
        { nodeId: "2", nodeName: "Card", bounds: { x: 0, y: 0, width: 100, height: 100 }, fills: [solid(BLACK)] },
      ],
      { x: 50, y: 50 },
    );
    expect(out.hex.toLowerCase()).toBe("#000000");
    expect(out.sourceNodeName).toBe("Card");
  });

  it("composites a translucent overlay against the layer beneath", () => {
    const out = resolveBackdrop(
      [
        { nodeId: "1", nodeName: "Page", bounds: { x: 0, y: 0, width: 100, height: 100 }, fills: [solid(WHITE)] },
        {
          nodeId: "2",
          nodeName: "Scrim",
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 0.5 }],
        },
      ],
      { x: 50, y: 50 },
    );
    expect(out.color.r).toBeCloseTo(0.5, 5);
  });

  it("samples a gradient at the sampled y position", () => {
    const layers = [
      {
        nodeId: "g",
        nodeName: "Hero",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        fills: [
          {
            type: "GRADIENT_LINEAR",
            gradientHandlePositions: [
              { x: 0, y: 0 },
              { x: 0, y: 1 },
            ],
            gradientStops: [
              { position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
              { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
            ],
          },
        ],
      },
    ];
    // Text near the top sits on white; near the bottom on black.
    expect(resolveBackdrop(layers, { x: 50, y: 5 }).color.r).toBeCloseTo(0.95, 5);
    expect(resolveBackdrop(layers, { x: 50, y: 95 }).color.r).toBeCloseTo(0.05, 5);
  });

  it("flags an unresolvable image paint", () => {
    const out = resolveBackdrop(
      [{ nodeId: "i", nodeName: "Photo", bounds: { x: 0, y: 0, width: 10, height: 10 }, fills: [{ type: "IMAGE" }] }],
      { x: 5, y: 5 },
    );
    expect(out.unresolvedPaint).toBe(true);
  });

  it("defaults to white when nothing paints a background", () => {
    expect(resolveBackdrop([], { x: 0, y: 0 }).hex.toLowerCase()).toBe("#ffffff");
  });
});

describe("isLargeText (Figma sizes are px: 18pt = 24px, 14pt ≈ 18.67px)", () => {
  it("20px Regular is NOT large", () => expect(isLargeText(20, 400, "Regular")).toBe(false));
  it("20px with unknown weight is NOT large", () => expect(isLargeText(20)).toBe(false));
  it("20px Bold is large", () => expect(isLargeText(20, 700, "Bold")).toBe(true));
  it("24px Regular is large", () => expect(isLargeText(24, 400, "Regular")).toBe(true));
  it("18px Bold is NOT large", () => expect(isLargeText(18, 700, "Bold")).toBe(false));
  it("19px Bold is large", () => expect(isLargeText(19, 700, "Bold")).toBe(true));
  it("18.67px Bold is large", () => expect(isLargeText(18.67, 700)).toBe(true));
  it("20px SemiBold (600) is NOT large", () => expect(isLargeText(20, undefined, "SemiBold")).toBe(false));
  it("20px Semi Bold Italic is NOT large", () => expect(isLargeText(20, undefined, "Semi Bold Italic")).toBe(false));
  it("20px Bold Italic from the style name is large", () =>
    expect(isLargeText(20, undefined, "Bold Italic")).toBe(true));
  it("an explicit weight wins over the style name", () => expect(isLargeText(20, 600, "Bold")).toBe(false));
  it("14px Bold is NOT large", () => expect(isLargeText(14, 700)).toBe(false));
});

describe("fontWeightFromStyle", () => {
  it.each([
    ["Thin", 100],
    ["Hairline", 100],
    ["ExtraLight", 200],
    ["Extra Light", 200],
    ["UltraLight", 200],
    ["Light", 300],
    ["Light Italic", 300],
    ["Regular", 400],
    ["Italic", 400],
    ["Book", 400],
    ["Medium", 500],
    ["Medium Italic", 500],
    ["SemiBold", 600],
    ["Semi Bold", 600],
    ["Semibold", 600],
    ["DemiBold", 600],
    ["SemiBold Italic", 600],
    ["Bold", 700],
    ["Bold Italic", 700],
    ["Condensed Bold", 700],
    ["ExtraBold", 800],
    ["Extra Bold", 800],
    ["UltraBold", 800],
    ["Black", 900],
    ["Black Italic", 900],
    ["Heavy", 900],
  ])("%s → %d", (style, weight) => expect(fontWeightFromStyle(style)).toBe(weight));
  it("returns undefined for a missing style", () => expect(fontWeightFromStyle(undefined)).toBeUndefined());
});

function sample(over: Partial<TextSample> = {}): TextSample {
  return {
    nodeId: "1:1",
    nodeName: "Label",
    characters: "Hello",
    fontSize: 14,
    bounds: { x: 0, y: 0, width: 100, height: 20 },
    fills: [solid(BLACK)],
    backdrop: [
      { nodeId: "p", nodeName: "Page", bounds: { x: 0, y: 0, width: 400, height: 400 }, fills: [solid(WHITE)] },
    ],
    ...over,
  };
}

describe("evaluateTextSample", () => {
  it("scores black on white at 21:1 and passes AAA", () => {
    const f = evaluateTextSample(sample());
    expect(f.ratio).toBeCloseTo(21, 1);
    expect(f.passAA).toBe(true);
    expect(f.passAAA).toBe(true);
    expect(f.severity).toBe("pass");
  });

  it("flags a real-world borderline failure (4.35:1 body text)", () => {
    // #949494 on white ≈ 4.35:1 — passes nothing at 14pt regular.
    const grey = { r: 0.58, g: 0.58, b: 0.58 };
    const f = evaluateTextSample(sample({ fills: [solid(grey)] }));
    expect(f.ratio).toBeLessThan(4.5);
    expect(f.passAA).toBe(false);
    expect(f.severity).toBe("error");
    expect(f.requiredAA).toBe(4.5);
  });

  it("requires 4.5:1 for 20px Regular text (not large)", () => {
    // #949494 on white ≈ 3.0:1 — would pass as large text, must fail as body text.
    const grey = { r: 0.58, g: 0.58, b: 0.58 };
    const f = evaluateTextSample(sample({ fills: [solid(grey)], fontSize: 20, fontWeight: 400, fontStyle: "Regular" }));
    expect(f.isLargeText).toBe(false);
    expect(f.requiredAA).toBe(4.5);
    expect(f.passAA).toBe(false);
    expect(f.severity).toBe("error");
  });

  it("judges each mixed segment by its own size and weight", () => {
    const grey = { r: 0.58, g: 0.58, b: 0.58 };
    const f = evaluateTextSample(
      sample({
        characters: "AAAABBBBCCCC",
        fills: [],
        segments: [
          { start: 0, end: 4, fontSize: 20, fontStyle: "Regular", fills: [solid(grey)] },
          { start: 4, end: 8, fontSize: 20, fontStyle: "Bold", fills: [solid(grey)] },
          { start: 8, end: 12, fontSize: 20, fontStyle: "SemiBold", fills: [solid(grey)] },
        ],
      }),
    );
    expect(f.segments!.map((s) => s.isLargeText)).toEqual([false, true, false]);
    expect(f.segments!.map((s) => s.requiredAA)).toEqual([4.5, 3, 4.5]);
    expect(f.segments!.map((s) => s.passAA)).toEqual([false, true, false]);
    expect(f.severity).toBe("error");
  });

  it("applies the relaxed large-text threshold", () => {
    const grey = { r: 0.58, g: 0.58, b: 0.58 };
    const f = evaluateTextSample(sample({ fills: [solid(grey)], fontSize: 24 }));
    expect(f.isLargeText).toBe(true);
    expect(f.requiredAA).toBe(3);
    expect(f.passAA).toBe(true);
    expect(f.severity).toBe("warn");
  });

  it("accounts for node opacity on the text fill", () => {
    const opaque = evaluateTextSample(sample());
    const faded = evaluateTextSample(sample({ opacity: 0.3 }));
    expect(faded.ratio).toBeLessThan(opaque.ratio);
  });

  it("resolves the backdrop through the legacy ancestor list (innermost ancestor wins)", () => {
    const f = evaluateTextSample(
      sample({
        fills: [solid(WHITE)],
        backdrop: [
          { nodeId: "p", nodeName: "Page", bounds: { x: 0, y: 0, width: 400, height: 400 }, fills: [solid(WHITE)] },
          { nodeId: "c", nodeName: "Card", bounds: { x: 0, y: 0, width: 200, height: 200 }, fills: [solid(BLACK)] },
        ],
      }),
    );
    expect(f.background.toLowerCase()).toBe("#000000");
    expect(f.passAA).toBe(true);
  });

  it("marks a text node with no visible fill indeterminate instead of assuming black", () => {
    const f = evaluateTextSample(sample({ fills: [] }));
    expect(f.severity).toBe("indeterminate");
    expect(f.indeterminate).toContain("no visible text fill");
    expect(f.passAA).toBe(true);
  });

  it("marks an IMAGE fill on the text indeterminate", () => {
    const f = evaluateTextSample(sample({ fills: [{ type: "IMAGE" }] }));
    expect(f.severity).toBe("indeterminate");
    expect(f.indeterminate).toContain("IMAGE fill on the text");
  });
});

// ─────────────────────────────────────────────── full paint-stack rendering ──

const TEXT_BOX = { x: 10, y: 10, width: 80, height: 20 };

function textLeaf(over: Partial<StackNode> = {}): StackNode {
  return { nodeId: "t", nodeName: "Label", bounds: TEXT_BOX, target: true, ...over };
}

function page(children: StackNode[], fills = [solid(WHITE)]): StackNode {
  return { nodeId: "0:1", nodeName: "Page", nodeType: "PAGE", fills, children };
}

function stackSample(stack: StackNode, over: Partial<TextSample> = {}): TextSample {
  return {
    nodeId: "t",
    nodeName: "Label",
    characters: "Buy now",
    fontSize: 14,
    bounds: TEXT_BOX,
    fills: [solid(WHITE)],
    stack,
    ...over,
  };
}

describe("evaluateTextSample with a paint stack", () => {
  it("uses a sibling shape painted beneath the text (button rectangle + label)", () => {
    const button: StackNode = {
      nodeId: "b",
      nodeName: "Button",
      nodeType: "GROUP",
      bounds: { x: 0, y: 0, width: 100, height: 40 },
      children: [
        {
          nodeId: "r",
          nodeName: "Bg",
          nodeType: "RECTANGLE",
          bounds: { x: 0, y: 0, width: 100, height: 40 },
          fills: [solid(BLACK)],
        },
        textLeaf(),
      ],
    };
    const f = evaluateTextSample(stackSample(page([button])));
    expect(f.background.toLowerCase()).toBe("#000000");
    expect(f.backgroundSource).toBe("Bg");
    expect(f.ratio).toBeCloseTo(21, 0);
    expect(f.severity).toBe("pass");
  });

  it("uses the page background instead of a hard-coded white", () => {
    const dark = { r: 0.1, g: 0.1, b: 0.1 };
    const f = evaluateTextSample(stackSample(page([textLeaf()], [solid(dark)])));
    expect(f.background.toLowerCase()).toBe("#1a1a1a");
    expect(f.passAA).toBe(true);
  });

  it("ignores an ancestor fill that does not cover the sample points", () => {
    const f = evaluateTextSample(
      stackSample(
        page([
          {
            nodeId: "x",
            nodeName: "Faraway",
            bounds: { x: 500, y: 500, width: 50, height: 50 },
            fills: [solid(WHITE)],
          },
          textLeaf(),
        ]),
        { fills: [solid(BLACK)] },
      ),
    );
    expect(f.background.toLowerCase()).toBe("#ffffff");
    expect(f.backgroundSource).toBe("Page");
  });

  it("reports the worst of several sample points (sibling covering only the left half)", () => {
    const half: StackNode = {
      nodeId: "h",
      nodeName: "HalfBlack",
      bounds: { x: 0, y: 0, width: 40, height: 40 },
      fills: [solid(BLACK)],
    };
    // Black text: centre + right sit on white (21:1), the left point sits on black (1:1).
    const f = evaluateTextSample(stackSample(page([half, textLeaf()]), { fills: [solid(BLACK)] }));
    expect(f.ratio).toBeCloseTo(1, 1);
    expect(f.passAA).toBe(false);
  });

  it("applies group opacity to the text and its backdrop together", () => {
    const group: StackNode = {
      nodeId: "g",
      nodeName: "Faded",
      nodeType: "GROUP",
      opacity: 0.5,
      bounds: { x: 0, y: 0, width: 100, height: 40 },
      children: [
        { nodeId: "r", nodeName: "Bg", bounds: { x: 0, y: 0, width: 100, height: 40 }, fills: [solid(BLACK)] },
        textLeaf(),
      ],
    };
    const f = evaluateTextSample(stackSample(page([group])));
    // Text pixel = white (0.5 white + 0.5 page white), backdrop = 50% black over white.
    expect(f.foreground.toLowerCase()).toBe("#ffffff");
    expect(f.background.toLowerCase()).toBe("#808080");
    expect(f.ratio).toBeLessThan(4.5);
  });

  it("does not paint children of a clipping ancestor outside its bounds", () => {
    const clip: StackNode = {
      nodeId: "c",
      nodeName: "Clip",
      clips: true,
      bounds: { x: 0, y: 0, width: 100, height: 40 },
      children: [
        { nodeId: "o", nodeName: "Overflow", bounds: { x: 0, y: 0, width: 400, height: 400 }, fills: [solid(BLACK)] },
      ],
    };
    const outside = { x: 200, y: 200, width: 80, height: 20 };
    const f = evaluateTextSample(
      stackSample(page([clip, textLeaf({ bounds: outside })]), { bounds: outside, fills: [solid(BLACK)] }),
    );
    expect(f.background.toLowerCase()).toBe("#ffffff");
    expect(f.passAA).toBe(true);
  });

  it("marks text clipped out of view at every point indeterminate", () => {
    const clip: StackNode = {
      nodeId: "c",
      nodeName: "Clip",
      clips: true,
      bounds: { x: 0, y: 0, width: 5, height: 5 },
      children: [textLeaf()],
    };
    const f = evaluateTextSample(stackSample(page([clip])));
    expect(f.severity).toBe("indeterminate");
    expect(f.indeterminate).toContain("clipped");
  });

  it("is indeterminate when an image sits behind the text", () => {
    const photo: StackNode = {
      nodeId: "p",
      nodeName: "Hero",
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      fills: [{ type: "IMAGE" }],
    };
    const f = evaluateTextSample(stackSample(page([photo, textLeaf()])));
    expect(f.severity).toBe("indeterminate");
    expect(f.passAA).toBe(true);
    expect(f.indeterminate).toContain('IMAGE paint on "Hero"');
  });

  it("is determinate when an opaque layer fully covers the image", () => {
    const photo: StackNode = {
      nodeId: "p",
      nodeName: "Hero",
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      fills: [{ type: "IMAGE" }, solid(BLACK)],
    };
    const f = evaluateTextSample(stackSample(page([photo, textLeaf()])));
    expect(f.indeterminate).toBeUndefined();
    expect(f.severity).toBe("pass");
  });

  it("stays indeterminate under a translucent scrim over an image", () => {
    const f = evaluateTextSample(
      stackSample(
        page([
          {
            nodeId: "p",
            nodeName: "Hero",
            bounds: { x: 0, y: 0, width: 200, height: 200 },
            fills: [{ type: "VIDEO" }],
          },
          {
            nodeId: "s",
            nodeName: "Scrim",
            bounds: { x: 0, y: 0, width: 200, height: 200 },
            fills: [solid(BLACK, 0.4)],
          },
          textLeaf(),
        ]),
      ),
    );
    expect(f.severity).toBe("indeterminate");
  });

  it("notes a non-normal blend mode as approximate", () => {
    const f = evaluateTextSample(
      stackSample(
        page([
          {
            nodeId: "m",
            nodeName: "Tint",
            blendMode: "MULTIPLY",
            bounds: { x: 0, y: 0, width: 100, height: 40 },
            fills: [solid(BLACK)],
          },
          textLeaf(),
        ]),
      ),
    );
    expect(f.note).toContain("MULTIPLY");
  });

  it("scores mixed-style text per segment and reports the worst one", () => {
    const grey = { r: 0.7, g: 0.7, b: 0.7 };
    const f = evaluateTextSample(
      stackSample(page([textLeaf()]), {
        characters: "Total: $10",
        fills: [],
        segments: [
          { start: 0, end: 7, characters: "Total: ", fontSize: 14, fills: [solid(BLACK)] },
          { start: 7, end: 10, characters: "$10", fontSize: 24, fontWeight: 700, fills: [solid(grey)] },
        ],
      }),
    );
    expect(f.segments).toHaveLength(2);
    expect(f.segments![0].passAA).toBe(true);
    // #b3b3b3 on white ≈ 2.1:1 — fails even the large-text threshold.
    expect(f.segments![1].isLargeText).toBe(true);
    expect(f.segments![1].passAA).toBe(false);
    expect(f.ratio).toBe(f.segments![1].ratio);
    expect(f.fontSize).toBe(24);
    expect(f.severity).toBe("error");
  });

  it("does not read mixed text as black when every segment is white on dark", () => {
    const f = evaluateTextSample(
      stackSample(page([textLeaf()], [solid(BLACK)]), {
        fills: [],
        segments: [
          { start: 0, end: 3, fontSize: 14, fills: [solid(WHITE)] },
          { start: 3, end: 6, fontSize: 14, fills: [solid({ r: 0.9, g: 0.9, b: 0.9 })] },
        ],
      }),
    );
    expect(f.passAA).toBe(true);
    expect(f.foreground.toLowerCase()).not.toBe("#000000");
  });

  it("keeps a definite segment failure even when another segment is indeterminate", () => {
    const f = evaluateTextSample(
      stackSample(page([textLeaf()]), {
        fills: [],
        segments: [
          { start: 0, end: 3, fontSize: 14, fills: [{ type: "IMAGE" }] },
          { start: 3, end: 6, fontSize: 14, fills: [solid({ r: 0.8, g: 0.8, b: 0.8 })] },
        ],
      }),
    );
    expect(f.severity).toBe("error");
    expect(f.indeterminate).toContain("IMAGE");
  });
});

describe("renderStackAt", () => {
  it("reports whether the target was reached", () => {
    const stack = page([textLeaf()]);
    expect(renderStackAt(stack, { x: 50, y: 20 }, null).hit).toBe(true);
    expect(renderStackAt(stack, { x: 500, y: 20 }, null).hit).toBe(false);
  });
});

describe("textSamplePoints", () => {
  it("samples the centre and four points inside the box", () => {
    const pts = textSamplePoints({ x: 0, y: 0, width: 100, height: 20 });
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual({ x: 50, y: 10 });
    for (const p of pts) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(100);
    }
  });
});

describe("sweepContrast", () => {
  it("tallies AA and AAA failures", () => {
    const grey = { r: 0.58, g: 0.58, b: 0.58 };
    const report = sweepContrast([sample(), sample({ nodeId: "2:2", fills: [solid(grey)] })]);
    expect(report.total).toBe(2);
    expect(report.failingAA).toBe(1);
    expect(report.failingAAA).toBe(1);
  });

  it("counts indeterminate nodes separately from failures", () => {
    const report = sweepContrast([sample(), sample({ nodeId: "2:2", fills: [{ type: "IMAGE" }] })]);
    expect(report.failingAA).toBe(0);
    expect(report.indeterminate).toBe(1);
  });

  it("handles an empty frame", () => {
    expect(sweepContrast([])).toEqual({ total: 0, failingAA: 0, failingAAA: 0, indeterminate: 0, findings: [] });
  });
});

describe("intersectRects", () => {
  const a = { x: 0, y: 0, width: 10, height: 10 };

  it("returns the intersection rectangle", () => {
    expect(intersectRects(a, { x: 5, y: 5, width: 10, height: 10 }, 0)).toEqual({ x: 5, y: 5, width: 5, height: 5 });
  });

  it("returns null for disjoint rectangles", () => {
    expect(intersectRects(a, { x: 20, y: 0, width: 5, height: 5 }, 0)).toBeNull();
  });

  it("returns null for edge-touching rectangles", () => {
    expect(intersectRects(a, { x: 10, y: 0, width: 5, height: 5 }, 0)).toBeNull();
  });

  it("forgives overlap within the tolerance", () => {
    expect(intersectRects(a, { x: 9.7, y: 0, width: 5, height: 5 }, 0.5)).toBeNull();
  });
});

describe("findOverlappingSiblings", () => {
  const node = (over: Partial<OverlapNode>): OverlapNode => ({
    nodeId: "n",
    nodeName: "n",
    nodeType: "FRAME",
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    parentId: "p1",
    parentName: "Row",
    ...over,
  });

  it("reports an overlapping sibling pair", () => {
    const pairs = findOverlappingSiblings([
      node({ nodeId: "a", nodeName: "Caption" }),
      node({ nodeId: "b", nodeName: "Screenshot", bounds: { x: 5, y: 5, width: 10, height: 10 } }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].a.nodeName).toBe("Caption");
    expect(pairs[0].overlapRatio).toBeGreaterThan(0);
  });

  it("does not pair nodes with different parents", () => {
    const pairs = findOverlappingSiblings([
      node({ nodeId: "a", parentId: "p1" }),
      node({ nodeId: "b", parentId: "p2" }),
    ]);
    expect(pairs).toHaveLength(0);
  });

  it("skips hidden nodes by default and includes them when asked", () => {
    const nodes = [node({ nodeId: "a" }), node({ nodeId: "b", visible: false })];
    expect(findOverlappingSiblings(nodes)).toHaveLength(0);
    expect(findOverlappingSiblings(nodes, { ignoreHidden: false })).toHaveLength(1);
  });

  it("filters by min_overlap_ratio", () => {
    const nodes = [
      node({ nodeId: "a" }),
      node({ nodeId: "b", bounds: { x: 9, y: 0, width: 10, height: 10 } }), // 10% of smaller
    ];
    expect(findOverlappingSiblings(nodes, { tolerance: 0, minOverlapRatio: 0.05 })).toHaveLength(1);
    expect(findOverlappingSiblings(nodes, { tolerance: 0, minOverlapRatio: 0.5 })).toHaveLength(0);
  });

  it("sorts the worst overlaps first", () => {
    const pairs = findOverlappingSiblings([
      node({ nodeId: "a" }),
      node({ nodeId: "b", bounds: { x: 9, y: 0, width: 10, height: 10 } }),
      node({ nodeId: "c", bounds: { x: 1, y: 1, width: 10, height: 10 } }),
    ]);
    expect(pairs[0].overlapRatio).toBeGreaterThanOrEqual(pairs[pairs.length - 1].overlapRatio);
  });
});

describe("valuesMatch", () => {
  it("tolerates float drift", () => {
    expect(valuesMatch(12, 12.004)).toBe(true);
    expect(valuesMatch(12, 12.5)).toBe(false);
  });

  it("equates hex and RGBA colours", () => {
    expect(valuesMatch("#ff0000", { r: 1, g: 0, b: 0, a: 1 })).toBe(true);
    expect(valuesMatch("#f00", { r: 1, g: 0, b: 0, a: 1 })).toBe(true);
    expect(valuesMatch("#00ff00", { r: 1, g: 0, b: 0, a: 1 })).toBe(false);
  });

  it("uses subset semantics for objects", () => {
    expect(valuesMatch({ r: 1 }, { r: 1, g: 0, b: 0 })).toBe(true);
  });

  it("compares arrays element-wise", () => {
    expect(valuesMatch([1, 2], [1, 2])).toBe(true);
    expect(valuesMatch([1, 2], [1])).toBe(false);
  });
});

describe("diffNodeState", () => {
  it("passes when every assertion holds", () => {
    const r = diffNodeState({ width: 320, name: "Card" }, { width: 320.002, name: "Card", height: 90 });
    expect(r.matched).toBe(true);
    expect(r.mismatches).toHaveLength(0);
    expect(r.checked).toBe(2);
  });

  it("reports a silent no-op write as a mismatch", () => {
    const r = diffNodeState({ cornerRadius: 24 }, { cornerRadius: 0 });
    expect(r.matched).toBe(false);
    expect(r.mismatches[0]).toMatchObject({ field: "cornerRadius", expected: 24, actual: 0 });
  });

  it("treats a missing property as a mismatch", () => {
    const r = diffNodeState({ itemSpacing: 8 }, {});
    expect(r.matched).toBe(false);
    expect(r.mismatches[0].actual).toBeUndefined();
  });
});

describe("tokenKeyOf", () => {
  it("strips a leading collection prefix", () => {
    expect(tokenKeyOf("theme/radius/3xl", "theme")).toBe("radius/3xl");
    expect(tokenKeyOf("Radius/radius/3xl", "Radius")).toBe("radius/3xl");
  });

  it("leaves unprefixed names alone (lowercased)", () => {
    expect(tokenKeyOf("Radius/3xl", "theme")).toBe("radius/3xl");
  });
});

describe("findTokenCollisions", () => {
  const v = (over: Partial<VariableRecord>): VariableRecord => ({
    collectionId: "c1",
    collectionName: "theme",
    variableId: "V:1",
    name: "theme/radius/3xl",
    resolvedType: "FLOAT",
    valuesByMode: { Default: 28 },
    ...over,
  });

  it("reports the real-world 28 vs 24 radius collision", () => {
    const out = findTokenCollisions([
      v({}),
      v({
        collectionId: "c2",
        collectionName: "Radius",
        variableId: "V:2",
        name: "Radius/radius/3xl",
        valuesByMode: { Default: 24 },
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].token).toBe("radius/3xl");
    expect(out[0].definitions.map((d) => d.valueLabel).sort()).toEqual(["24", "28"]);
  });

  it("ignores duplicates that agree, unless asked", () => {
    const pair = [
      v({}),
      v({ collectionId: "c2", collectionName: "Radius", variableId: "V:2", name: "Radius/radius/3xl" }),
    ];
    expect(findTokenCollisions(pair)).toHaveLength(0);
    expect(findTokenCollisions(pair, { includeIdentical: true })).toHaveLength(1);
  });

  it("ignores duplicates inside one collection", () => {
    expect(findTokenCollisions([v({}), v({ variableId: "V:2", valuesByMode: { Default: 24 } })])).toHaveLength(0);
  });

  it("compares colours by hex", () => {
    const out = findTokenCollisions([
      v({ resolvedType: "COLOR", name: "theme/brand", valuesByMode: { Default: { r: 1, g: 0, b: 0, a: 1 } } }),
      v({
        collectionId: "c2",
        collectionName: "Brand",
        variableId: "V:2",
        resolvedType: "COLOR",
        name: "Brand/brand",
        valuesByMode: { Default: { r: 0, g: 0, b: 1, a: 1 } },
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].definitions.map((d) => d.valueLabel).sort()).toEqual(["#0000ff", "#ff0000"]);
  });
});
