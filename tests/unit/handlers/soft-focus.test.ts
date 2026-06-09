type MockNode = {
  id: string;
  type: string;
  parent: MockNode | null;
  absoluteBoundingBox: { x: number; y: number; width: number; height: number } | null;
};

function makeNode(id: string, page: MockNode, bbox: { x: number; y: number; width: number; height: number } | null): MockNode {
  return { id, type: "FRAME", parent: page, absoluteBoundingBox: bbox };
}

function makePage(id: string): MockNode {
  return { id, type: "PAGE", parent: null, absoluteBoundingBox: null };
}

let scrollSpy: jest.Mock;
let currentPageRef: { id: string; selection: MockNode[] };
let nodes: Map<string, MockNode>;
let viewportBounds: { x: number; y: number; width: number; height: number };

beforeEach(() => {
  scrollSpy = jest.fn();
  nodes = new Map();
  viewportBounds = { x: 0, y: 0, width: 1000, height: 1000 };

  const pageA = makePage("page-a");
  const pageB = makePage("page-b");
  nodes.set(pageA.id, pageA);
  nodes.set(pageB.id, pageB);

  // In-viewport node on page A
  nodes.set("inA", makeNode("inA", pageA, { x: 10, y: 10, width: 100, height: 100 }));
  // Out-of-viewport node on page A
  nodes.set("outA", makeNode("outA", pageA, { x: 5000, y: 5000, width: 100, height: 100 }));
  // In-viewport node on page B
  nodes.set("inB", makeNode("inB", pageB, { x: 10, y: 10, width: 100, height: 100 }));

  currentPageRef = { id: pageA.id, selection: [] };

  (globalThis as any).figma = {
    getNodeByIdAsync: jest.fn(async (id: string) => nodes.get(id) ?? null),
    get currentPage() {
      return currentPageRef;
    },
    set currentPage(p: any) {
      currentPageRef = { id: p.id, selection: [] };
    },
    viewport: {
      get bounds() {
        return viewportBounds;
      },
      scrollAndZoomIntoView: scrollSpy,
    },
  };
});

afterEach(() => {
  delete (globalThis as any).figma;
});

async function loadHandlers() {
  return await import("../../../src/videntia_figma_plugin/handlers/selection");
}

describe("softFocusNodes", () => {
  it("no-op for empty array", async () => {
    const { softFocusNodes } = await loadHandlers();
    await softFocusNodes([]);
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("skips scroll when single node already visible on current page", async () => {
    const { softFocusNodes } = await loadHandlers();
    await softFocusNodes(["inA"]);
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(currentPageRef.selection.map((n) => n.id)).toEqual(["inA"]);
  });

  it("scrolls when single node off-viewport", async () => {
    const { softFocusNodes } = await loadHandlers();
    await softFocusNodes(["outA"]);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy.mock.calls[0][0].map((n: MockNode) => n.id)).toEqual(["outA"]);
  });

  it("switches page and scrolls when node on different page", async () => {
    const { softFocusNodes } = await loadHandlers();
    await softFocusNodes(["inB"]);
    expect(currentPageRef.id).toBe("page-b");
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it("multi-node: scrolls when any node off-viewport", async () => {
    const { softFocusNodes } = await loadHandlers();
    await softFocusNodes(["inA", "outA"]);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy.mock.calls[0][0].map((n: MockNode) => n.id)).toEqual(["inA", "outA"]);
    expect(currentPageRef.selection.map((n) => n.id)).toEqual(["inA", "outA"]);
  });

  it("multi-node: skips scroll when all visible on current page", async () => {
    nodes.set("inA2", makeNode("inA2", nodes.get("page-a")!, { x: 200, y: 200, width: 50, height: 50 }));
    const { softFocusNodes } = await loadHandlers();
    await softFocusNodes(["inA", "inA2"]);
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(currentPageRef.selection.map((n) => n.id)).toEqual(["inA", "inA2"]);
  });

  it("silently skips missing nodes", async () => {
    const { softFocusNodes } = await loadHandlers();
    await softFocusNodes(["does-not-exist"]);
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("softFocusNode delegates to softFocusNodes", async () => {
    const { softFocusNode } = await loadHandlers();
    await softFocusNode("outA");
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });
});
