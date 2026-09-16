import {
  compositeOver,
  sampleGradientStops,
  gradientParamAt,
  resolvePaint,
  resolveBackdrop,
  isLargeText,
  evaluateTextSample,
  sweepContrast,
  intersectRects,
  findOverlappingSiblings,
  valuesMatch,
  diffNodeState,
  tokenKeyOf,
  findTokenCollisions,
  type TextSample,
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

describe("isLargeText", () => {
  it("counts >=18pt as large", () => expect(isLargeText(18)).toBe(true));
  it("counts >=14pt bold as large", () => expect(isLargeText(14, 700)).toBe(true));
  it("does not count 14pt regular as large", () => expect(isLargeText(14, 400)).toBe(false));
  it("reads boldness from the style name", () => expect(isLargeText(16, undefined, "Bold")).toBe(true));
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

  it("resolves the backdrop through the ancestor stack, not the page", () => {
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

  it("notes a missing text fill instead of silently scoring it", () => {
    const f = evaluateTextSample(sample({ fills: [] }));
    expect(f.note).toContain("No resolvable text fill");
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

  it("handles an empty frame", () => {
    expect(sweepContrast([])).toEqual({ total: 0, failingAA: 0, failingAAA: 0, findings: [] });
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
