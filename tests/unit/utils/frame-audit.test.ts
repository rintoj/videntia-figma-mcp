import { auditFrame, flattenFigmaCandidates, hungarian } from "../../../src/videntia_figma_mcp/utils/frame-audit";
import type { DomRect } from "../../../src/videntia_figma_mcp/utils/frame-audit";

describe("hungarian", () => {
  it("solves a trivial 2x2 assignment", () => {
    // Should assign row 0 → col 1, row 1 → col 0 (min total 0+0 = 0)
    const result = hungarian([
      [5, 0],
      [0, 5],
    ]);
    expect(result).toEqual([1, 0]);
  });

  it("handles rectangular matrices (more rows than cols)", () => {
    const result = hungarian([
      [1, 0],
      [0, 1],
      [5, 5],
    ]);
    // Two cols → only two rows assigned; the high-cost row drops out.
    const assigned = result.filter((v) => v !== -1);
    expect(assigned.length).toBe(2);
    expect(result[2]).toBe(-1);
    // Whatever assignment chosen, total cost must be 0 (two zero-cost cells).
    let total = 0;
    const m = [
      [1, 0],
      [0, 1],
      [5, 5],
    ];
    for (let i = 0; i < result.length; i++) {
      if (result[i] !== -1) total += m[i][result[i]];
    }
    expect(total).toBe(0);
  });
});

describe("flattenFigmaCandidates", () => {
  it("walks the tree and tags hasText correctly", () => {
    const tree = {
      id: "1",
      type: "FRAME",
      name: "Root",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
      children: [
        {
          id: "2",
          type: "TEXT",
          name: "Title",
          absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 24 },
        },
        {
          id: "3",
          type: "FRAME",
          name: "Card",
          absoluteBoundingBox: { x: 10, y: 50, width: 180, height: 40 },
          children: [
            {
              id: "4",
              type: "TEXT",
              name: "Body",
              absoluteBoundingBox: { x: 20, y: 60, width: 100, height: 20 },
            },
          ],
        },
      ],
    };
    const out = flattenFigmaCandidates(tree as any);
    expect(out.map((c) => c.id)).toEqual(["1", "2", "3", "4"]);
    expect(out.find((c) => c.id === "1")!.hasText).toBe(true);
    expect(out.find((c) => c.id === "3")!.hasText).toBe(true);
    expect(out.find((c) => c.id === "2")!.hasText).toBe(true);
  });

  it("drops zero-size nodes", () => {
    const out = flattenFigmaCandidates({
      id: "1",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      children: [{ id: "hidden", absoluteBoundingBox: { x: 0, y: 0, width: 0, height: 0 } }],
    } as any);
    expect(out.map((c) => c.id)).toEqual(["1"]);
  });
});

describe("auditFrame", () => {
  function makeDom(): DomRect[] {
    // DOM: root (0) → title (1), card (2) → body (3)
    return [
      {
        idx: 0,
        parent: -1,
        tag: "section",
        id: null,
        testId: null,
        depth: 0,
        rect: { x: 0, y: 0, w: 400, h: 200 },
        selector: ".root",
        text: null,
      },
      {
        idx: 1,
        parent: 0,
        tag: "h2",
        id: null,
        testId: null,
        depth: 1,
        rect: { x: 20, y: 20, w: 200, h: 48 },
        selector: ".root > h2",
        text: "Title",
      },
      {
        idx: 2,
        parent: 0,
        tag: "div",
        id: null,
        testId: null,
        depth: 1,
        rect: { x: 20, y: 100, w: 360, h: 80 },
        selector: ".root > div",
        text: null,
      },
      {
        idx: 3,
        parent: 2,
        tag: "p",
        id: null,
        testId: null,
        depth: 2,
        rect: { x: 40, y: 120, w: 200, h: 40 },
        selector: ".root > div > p",
        text: "Body",
      },
    ];
  }

  function makeFigma() {
    // Same shape, Figma at 200x100 — scaling tests included.
    return {
      id: "F",
      type: "FRAME",
      name: "Frame",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
      children: [
        {
          id: "title",
          type: "TEXT",
          name: "Title",
          absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 24 },
        },
        {
          id: "card",
          type: "FRAME",
          name: "Card",
          absoluteBoundingBox: { x: 10, y: 50, width: 180, height: 40 },
          children: [
            {
              id: "body",
              type: "TEXT",
              name: "Body",
              absoluteBoundingBox: { x: 20, y: 60, width: 100, height: 20 },
            },
          ],
        },
      ],
    } as any;
  }

  it("matches every Figma descendant to its DOM counterpart", () => {
    const result = auditFrame(makeFigma(), 0, makeDom());
    const matchedIds = result.matched.map((m) => m.figmaId).sort();
    expect(matchedIds).toEqual(["body", "card", "title"]);
    expect(result.unmatchedFigma).toHaveLength(0);
  });

  it("flags an extra DOM element as unmatched", () => {
    const dom = makeDom();
    dom.push({
      idx: 4,
      parent: 0,
      tag: "div",
      id: null,
      testId: null,
      depth: 1,
      rect: { x: 300, y: 20, w: 50, h: 50 },
      selector: ".root > .extra",
      text: null,
    });
    const result = auditFrame(makeFigma(), 0, dom);
    expect(result.unmatchedDom.some((d) => d.selector === ".root > .extra")).toBe(true);
  });

  it("applies cropTop to align mobile-frame coordinates with DOM coordinates", () => {
    // Figma frame includes 91px of iOS status+address bar; DOM has none.
    const fig: any = {
      id: "F",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 691 },
      children: [
        {
          id: "content",
          type: "FRAME",
          name: "Content",
          // y=171 in Figma; once cropTop=91 shifts the origin to y=91,
          // local y becomes 171-91=80, matching the DOM.
          absoluteBoundingBox: { x: 0, y: 171, width: 390, height: 400 },
        },
      ],
    };
    const dom = [
      {
        idx: 0,
        parent: -1,
        tag: "body",
        id: null,
        testId: null,
        depth: 0,
        rect: { x: 0, y: 0, w: 390, h: 600 },
        selector: "body",
        text: null,
      },
      {
        idx: 1,
        parent: 0,
        tag: "main",
        id: null,
        testId: null,
        depth: 1,
        rect: { x: 0, y: 80, w: 390, h: 400 },
        selector: "main",
        text: null,
      },
    ];
    const without = auditFrame(fig, 0, dom);
    const withCrop = auditFrame(fig, 0, dom, { cropTop: 91 });
    // cropTop=91 eliminates the y-mismatch entirely → cost drops to ~0, IoU rises to ~1.
    const wc = withCrop.matched.find((m) => m.figmaId === "content")!;
    const wo = without.matched.find((m) => m.figmaId === "content")!;
    expect(wc.iou).toBeGreaterThan(wo.iou);
    expect(wc.cost).toBeLessThan(wo.cost);
    expect(wc.iou).toBeGreaterThan(0.99);
    expect(wc.selector).toBe("main");
  });

  it("matches grandchildren even when their direct Figma parent fails to match", () => {
    // Figma: root → wrapper (no DOM counterpart) → contentContainer (has DOM counterpart)
    const fig: any = {
      id: "F",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 600 },
      children: [
        {
          id: "wrapper",
          type: "FRAME",
          name: "Wrapper",
          // Far from any real DOM element — won't match.
          absoluteBoundingBox: { x: 9999, y: 9999, width: 100, height: 100 },
          children: [
            {
              id: "contentContainer",
              type: "FRAME",
              name: "Content Container",
              absoluteBoundingBox: { x: 20, y: 80, width: 350, height: 500 },
            },
          ],
        },
      ],
    };
    const dom = [
      {
        idx: 0,
        parent: -1,
        tag: "body",
        id: null,
        testId: null,
        depth: 0,
        rect: { x: 0, y: 0, w: 400, h: 600 },
        selector: "body",
        text: null,
      },
      {
        idx: 1,
        parent: 0,
        tag: "main",
        id: null,
        testId: null,
        depth: 1,
        rect: { x: 20, y: 80, w: 350, h: 500 },
        selector: "main",
        text: null,
      },
    ];
    const result = auditFrame(fig, 0, dom);
    // Pre-fix: wrapper failed → contentContainer was dropped to unmatched without ever trying.
    expect(result.matched.find((m) => m.figmaId === "contentContainer")?.selector).toBe("main");
    expect(result.unmatchedFigma.map((f) => f.id)).toEqual(["wrapper"]);
  });

  it("flags a Figma node with no DOM counterpart as unmatched", () => {
    const fig = makeFigma();
    fig.children.push({
      id: "ghost",
      type: "TEXT",
      name: "Ghost",
      absoluteBoundingBox: { x: 1000, y: 1000, width: 100, height: 24 },
    });
    const result = auditFrame(fig, 0, makeDom());
    expect(result.unmatchedFigma.some((f) => f.id === "ghost")).toBe(true);
  });
});

describe("auditFrame — data-fig-id pre-pass", () => {
  const dom = (over: Partial<DomRect> & { idx: number; parent: number }): DomRect => ({
    tag: "div",
    id: null,
    testId: null,
    figId: null,
    depth: over.parent === -1 ? 0 : 1,
    rect: { x: 0, y: 0, w: 10, h: 10 },
    selector: `sel-${over.idx}`,
    text: null,
    ...over,
  });

  const tree = {
    id: "1:0",
    type: "FRAME",
    name: "Root",
    absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 200 },
    children: [
      {
        id: "1:1",
        type: "FRAME",
        name: "Card A",
        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
      },
      {
        id: "1:2",
        type: "FRAME",
        name: "Card B",
        absoluteBoundingBox: { x: 200, y: 0, width: 200, height: 200 },
      },
    ],
  };

  it("pairs annotated elements at cost 0 even when geometry disagrees", () => {
    const domRects: DomRect[] = [
      dom({ idx: 0, parent: -1, rect: { x: 0, y: 0, w: 400, h: 200 } }),
      // Annotated for Card A but positioned where Card B lives — the annotation must win.
      dom({ idx: 1, parent: 0, figId: "1:1", rect: { x: 200, y: 0, w: 200, h: 200 } }),
      dom({ idx: 2, parent: 0, rect: { x: 0, y: 0, w: 200, h: 200 } }),
    ];

    const result = auditFrame(tree as any, 0, domRects);
    const cardA = result.matched.find((m) => m.figmaId === "1:1");
    expect(cardA).toMatchObject({ domIdx: 1, cost: 0, matchedBy: "fig-id" });
  });

  it("keeps annotated pairs out of the Hungarian pool so siblings match correctly", () => {
    const domRects: DomRect[] = [
      dom({ idx: 0, parent: -1, rect: { x: 0, y: 0, w: 400, h: 200 } }),
      dom({ idx: 1, parent: 0, figId: "1:1", rect: { x: 0, y: 0, w: 200, h: 200 } }),
      dom({ idx: 2, parent: 0, rect: { x: 200, y: 0, w: 200, h: 200 } }),
    ];

    const result = auditFrame(tree as any, 0, domRects);
    const cardB = result.matched.find((m) => m.figmaId === "1:2");
    // Card B geometry-matches the remaining element — never the consumed annotated one.
    expect(cardB).toMatchObject({ domIdx: 2 });
    expect(cardB?.matchedBy).toBeUndefined();
    expect(result.unmatchedFigma).toHaveLength(0);
  });

  it("ignores duplicate fig-id annotations and falls back to geometry", () => {
    const domRects: DomRect[] = [
      dom({ idx: 0, parent: -1, rect: { x: 0, y: 0, w: 400, h: 200 } }),
      dom({ idx: 1, parent: 0, figId: "1:1", rect: { x: 0, y: 0, w: 200, h: 200 } }),
      dom({ idx: 2, parent: 0, figId: "1:1", rect: { x: 200, y: 0, w: 200, h: 200 } }),
    ];

    const result = auditFrame(tree as any, 0, domRects);
    // No cost-0 pre-pass matches; both matched via geometry instead.
    expect(result.matched.filter((m) => m.matchedBy === "fig-id")).toHaveLength(0);
    expect(result.matched).toHaveLength(2);
  });

  it("still processes children of pre-matched parents", () => {
    const deepTree = {
      ...tree,
      children: [
        {
          id: "1:1",
          type: "FRAME",
          name: "Card A",
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
          children: [
            {
              id: "1:3",
              type: "TEXT",
              name: "Label",
              absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 20 },
            },
          ],
        },
      ],
    };
    const domRects: DomRect[] = [
      dom({ idx: 0, parent: -1, rect: { x: 0, y: 0, w: 400, h: 200 } }),
      dom({ idx: 1, parent: 0, figId: "1:1", rect: { x: 0, y: 0, w: 200, h: 200 } }),
      dom({ idx: 2, parent: 1, tag: "span", text: "Label", rect: { x: 10, y: 10, w: 100, h: 20 } }),
    ];

    const result = auditFrame(deepTree as any, 0, domRects);
    const label = result.matched.find((m) => m.figmaId === "1:3");
    expect(label).toMatchObject({ domIdx: 2 });
  });
});

describe("auditFrame — large DOM pool performance", () => {
  it("completes quickly with 1200 DOM candidates (candidate pruning)", () => {
    const children = Array.from({ length: 40 }, (_, i) => ({
      id: `c:${i}`,
      type: "FRAME",
      name: `Child ${i}`,
      absoluteBoundingBox: { x: (i % 8) * 100, y: Math.floor(i / 8) * 100, width: 90, height: 90 },
    }));
    const tree = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 500 },
      children,
    };
    const domRects: DomRect[] = [
      {
        idx: 0,
        parent: -1,
        tag: "div",
        id: null,
        testId: null,
        depth: 0,
        rect: { x: 0, y: 0, w: 800, h: 500 },
        selector: "root",
        text: null,
      },
    ];
    for (let i = 1; i <= 1200; i++) {
      domRects.push({
        idx: i,
        parent: 0,
        tag: "div",
        id: null,
        testId: null,
        depth: 1,
        rect: { x: (i % 40) * 20, y: Math.floor(i / 40) * 16, w: 90, h: 90 },
        selector: `sel-${i}`,
        text: null,
      });
    }

    const start = Date.now();
    const result = auditFrame(tree as any, 0, domRects);
    const elapsed = Date.now() - start;

    // Pre-pruning this padded to a 1200³ Hungarian (~minutes); pruned it's well under a second.
    expect(elapsed).toBeLessThan(2000);
    expect(result.matched.length + result.unmatchedFigma.length).toBe(40);
  });
});

describe("hungarian — regression: rectangular matrix that cycled forever", () => {
  it("terminates on the real 2x28 hero matrix (finite-sentinel tie bug)", () => {
    // Captured live from the HomeVault hero audit: the original implementation used
    // the finite padding constant as the search sentinel, and exact ties made the
    // augmenting path cycle forever. Sentinels must be Infinity.
    const matrix: number[][] = [
      [
        0.2812080883936198, 0.2812080883936198, 0.3350755891741938, 0.43229404182206116, 0.43539169426905205,
        0.37810457165296096, 0.22059297836755556, 0.24026585545414125, 0.22059297836755556, 0.3229520679970676,
        0.3290573181869906, 0.2464792086088192, 0.26769358658840137, 0.12112220978065173, 0.12112220978065173,
        0.12112220978065173, 0.12112220978065173, 0.2648603409042668, 0.2648603409042668, 0.2681437402888681,
        0.2908429098949092, 0.35393034617461433, 0.35393034617461433, 0.23865027714543752, 0.38538815198573934,
        0.400214100243464, 0.42240523146278774, 0.44677886493002017,
      ],
      [
        0.32610941405367366, 0.32610941405367366, 0.34700461857475423, 0.4426571604849823, 0.4457548129319733,
        0.32041238723714455, 0.24199410980494362, 0.2968488322468357, 0.24199410980494362, 0.34022513795190035,
        0.3463559170860993, 0.26880356808685896, 0.22239454813349466, 0.16969647154948003, 0.16969647154948003,
        0.16969647154948003, 0.16969647154948003, 0.28870319030764413, 0.28870319030764413, 0.291604314871493,
        0.2636163434977342, 0.5670437364569184, 0.5670437364569184, 0.2702661711513781, 0.4996903160018187,
        0.5142516767940514, 0.46644280801337507, 0.5641483610877952,
      ],
    ];
    const start = Date.now();
    const assignment = hungarian(matrix);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(assignment).toHaveLength(2);
    expect(assignment[0]).not.toBe(-1);
    expect(assignment[1]).not.toBe(-1);
    expect(assignment[0]).not.toBe(assignment[1]);
  });
});
