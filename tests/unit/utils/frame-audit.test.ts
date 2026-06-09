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
