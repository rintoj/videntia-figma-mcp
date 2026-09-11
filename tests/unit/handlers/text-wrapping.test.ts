export {};

type Sizing = "FIXED" | "HUG" | "FILL";
type AutoResize = "NONE" | "HEIGHT" | "WIDTH_AND_HEIGHT" | "TRUNCATE";

const LOGGED_KEYS = new Set([
  "characters",
  "fontName",
  "fontSize",
  "textAutoResize",
  "layoutSizingHorizontal",
  "layoutSizingVertical",
]);

let log: string[];
let nodes: Map<string, any>;
let nextId: number;

function applyAutoResizeSideEffects(target: any, value: AutoResize): void {
  if (value === "WIDTH_AND_HEIGHT") {
    target.layoutSizingHorizontal = "HUG";
    target.layoutSizingVertical = "HUG";
  } else if (value === "HEIGHT") {
    if (target.layoutSizingHorizontal === "HUG") target.layoutSizingHorizontal = "FIXED";
    target.layoutSizingVertical = "HUG";
  } else {
    if (target.layoutSizingHorizontal === "HUG") target.layoutSizingHorizontal = "FIXED";
    if (target.layoutSizingVertical === "HUG") target.layoutSizingVertical = "FIXED";
  }
}

/** Minimal TEXT node that mimics Figma: resize() forces textAutoResize NONE. */
function makeTextNode(init: Record<string, unknown> = {}): any {
  const state: any = {
    id: `t${nextId++}`,
    type: "TEXT",
    name: "Text",
    visible: true,
    x: 0,
    y: 0,
    width: 60,
    height: 17,
    textAutoResize: "WIDTH_AND_HEIGHT" as AutoResize,
    textTruncation: "DISABLED",
    maxLines: null,
    layoutSizingHorizontal: "HUG" as Sizing,
    layoutSizingVertical: "HUG" as Sizing,
    layoutPositioning: "AUTO",
    fontName: { family: "Inter", style: "Regular" },
    fontSize: 14,
    lineHeight: { unit: "AUTO" },
    letterSpacing: { unit: "PIXELS", value: 0 },
    textAlignHorizontal: "LEFT",
    textCase: "ORIGINAL",
    textDecoration: "NONE",
    characters: "",
    fills: [],
    parent: null,
    throwOnFill: false,
    ...init,
  };
  state.resize = (w: number, h: number) => {
    log.push(`resize:${w}x${h}`);
    state.width = w;
    state.height = h;
    state.textAutoResize = "NONE";
    applyAutoResizeSideEffects(state, "NONE");
  };
  const proxy = new Proxy(state, {
    set(target, key, value) {
      if (LOGGED_KEYS.has(String(key))) {
        log.push(`set:${String(key)}=${typeof value === "object" ? "obj" : value}`);
      }
      if (
        (key === "layoutSizingHorizontal" || key === "layoutSizingVertical") &&
        value === "FILL" &&
        target.throwOnFill
      ) {
        throw new Error("simulated FILL failure");
      }
      target[key] = value;
      if (key === "textAutoResize") applyAutoResizeSideEffects(target, value);
      return true;
    },
  });
  nodes.set(state.id, proxy);
  return proxy;
}

function makeFrame(id: string, layoutMode: string): any {
  const frame: any = {
    id,
    type: "FRAME",
    name: `Frame ${id}`,
    layoutMode,
    children: [] as any[],
    appendChild(child: any) {
      log.push(`appendChild:${id}`);
      frame.children.push(child);
      child.parent = frame;
    },
  };
  nodes.set(id, frame);
  return frame;
}

function mutationEntries(): string[] {
  return log.filter((e) => e.startsWith("set:") || e.startsWith("resize:"));
}

beforeEach(() => {
  log = [];
  nodes = new Map();
  nextId = 1;
  (globalThis as any).figma = {
    mixed: Symbol("mixed"),
    createText: jest.fn(() => makeTextNode()),
    loadFontAsync: jest.fn(async () => {
      log.push("loadFont");
    }),
    getNodeByIdAsync: jest.fn(async (id: string) => nodes.get(id) ?? null),
    currentPage: {
      id: "page",
      selection: [],
      appendChild: (child: any) => {
        log.push("appendChild:page");
        child.parent = { id: "page", type: "PAGE", name: "Page" };
      },
    },
    variables: { getLocalVariablesAsync: jest.fn(async () => []) },
    getLocalTextStylesAsync: jest.fn(async () => []),
    getLocalEffectStylesAsync: jest.fn(async () => []),
    ui: { postMessage: jest.fn() },
  };
});

afterEach(() => {
  delete (globalThis as any).figma;
});

describe("createText wrapping", () => {
  it("with width: appends, resizes, then sets textAutoResize HEIGHT", async () => {
    const { createText } = await import("../../../src/videntia_figma_plugin/handlers/text");
    makeFrame("parent", "VERTICAL");

    const result = await createText({ x: 0, y: 0, text: "A long paragraph", width: 240, parentId: "parent" });

    expect(result.textAutoResize).toBe("HEIGHT");
    expect(result.width).toBe(240);
    const idx = (entry: string) => log.findIndex((e) => e.startsWith(entry));
    expect(idx("loadFont")).toBeGreaterThanOrEqual(0);
    expect(idx("loadFont")).toBeLessThan(idx("set:characters"));
    expect(idx("set:characters")).toBeLessThan(idx("appendChild:parent"));
    expect(idx("appendChild:parent")).toBeLessThan(idx("resize:240x"));
    expect(idx("resize:240x")).toBeLessThan(idx("set:textAutoResize=HEIGHT"));
  });

  it("without width: keeps Figma default WIDTH_AND_HEIGHT and never resizes", async () => {
    const { createText } = await import("../../../src/videntia_figma_plugin/handlers/text");

    const result = await createText({ x: 0, y: 0, text: "Label" });

    expect(result.textAutoResize).toBe("WIDTH_AND_HEIGHT");
    expect(log.some((e) => e.startsWith("resize:"))).toBe(false);
    expect(log.some((e) => e.startsWith("set:textAutoResize"))).toBe(false);
  });

  it("honours an explicit textAutoResize with width", async () => {
    const { createText } = await import("../../../src/videntia_figma_plugin/handlers/text");

    const result = await createText({ x: 0, y: 0, text: "Box", width: 120, textAutoResize: "NONE" });

    expect(result.textAutoResize).toBe("NONE");
    expect(result.width).toBe(120);
  });

  it("rejects an invalid width", async () => {
    const { createText } = await import("../../../src/videntia_figma_plugin/handlers/text");
    await expect(createText({ x: 0, y: 0, text: "x", width: -5 })).rejects.toThrow(/width/);
  });
});

describe("resizeNode on TEXT", () => {
  it.each([
    ["HEIGHT", "HEIGHT"],
    ["WIDTH_AND_HEIGHT", "HEIGHT"],
    ["NONE", "NONE"],
    ["TRUNCATE", "NONE"],
  ])("textAutoResize %s → %s after resize", async (before, after) => {
    const { resizeNode } = await import("../../../src/videntia_figma_plugin/handlers/nodes");
    const text = makeTextNode({ textAutoResize: before });

    const result = await resizeNode({ nodeId: text.id, width: 180, height: 40 });

    expect(result.width).toBe(180);
    expect(result.textAutoResize).toBe(after);
    expect(text.textAutoResize).toBe(after);
  });

  it("loads the node's fonts before writing textAutoResize", async () => {
    const { resizeNode } = await import("../../../src/videntia_figma_plugin/handlers/nodes");
    const text = makeTextNode({ textAutoResize: "HEIGHT" });

    await resizeNode({ nodeId: text.id, width: 180, height: 40 });

    const loadIdx = log.indexOf("loadFont");
    expect(loadIdx).toBeGreaterThanOrEqual(0);
    expect(loadIdx).toBeLessThan(log.findIndex((e) => e.startsWith("resize:")));
    expect(loadIdx).toBeLessThan(log.indexOf("set:textAutoResize=HEIGHT"));
  });

  it("resizes fixed text without loading fonts (missing fonts must not block it)", async () => {
    const { resizeNode } = await import("../../../src/videntia_figma_plugin/handlers/nodes");
    const text = makeTextNode({ textAutoResize: "NONE" });
    (globalThis as any).figma.loadFontAsync = jest.fn(async () => {
      throw new Error("font missing");
    });

    const result = await resizeNode({ nodeId: text.id, width: 90, height: 30 });

    expect(result.width).toBe(90);
    expect(result.textAutoResize).toBe("NONE");
  });

  it("leaves non-text nodes as a plain resize", async () => {
    const { resizeNode } = await import("../../../src/videntia_figma_plugin/handlers/nodes");
    const frame: any = { id: "f1", type: "FRAME", name: "Card", width: 10, height: 10 };
    frame.resize = jest.fn((w: number, h: number) => {
      frame.width = w;
      frame.height = h;
    });
    nodes.set("f1", frame);

    const result = await resizeNode({ nodeId: "f1", width: 300, height: 200 });

    expect(frame.resize).toHaveBeenCalledWith(300, 200);
    expect(result).toEqual({ id: "f1", name: "Card", width: 300, height: 200 });
  });
});

describe("setLayoutSizing on TEXT", () => {
  async function loadLayout() {
    return await import("../../../src/videntia_figma_plugin/handlers/layout");
  }

  it("horizontal FILL alone on a resized (fixed) text makes vertical HUG → textAutoResize HEIGHT", async () => {
    const { setLayoutSizing } = await loadLayout();
    const parent = makeFrame("col", "VERTICAL");
    const text = makeTextNode({
      textAutoResize: "NONE",
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
    });
    parent.appendChild(text);

    const result = await setLayoutSizing({ nodeId: text.id, layoutSizingHorizontal: "FILL" });

    expect(result.layoutSizingHorizontal).toBe("FILL");
    expect(result.layoutSizingVertical).toBe("HUG");
    expect(result.textAutoResize).toBe("HEIGHT");
  });

  it("loads the text node's fonts before writing textAutoResize", async () => {
    const { setLayoutSizing } = await loadLayout();
    const parent = makeFrame("col", "VERTICAL");
    const text = makeTextNode({ textAutoResize: "NONE", layoutSizingHorizontal: "FIXED" });
    parent.appendChild(text);
    log = [];

    await setLayoutSizing({ nodeId: text.id, layoutSizingHorizontal: "FILL" });

    const loadIdx = log.indexOf("loadFont");
    expect(loadIdx).toBeGreaterThanOrEqual(0);
    expect(loadIdx).toBeLessThan(log.findIndex((e) => e.startsWith("set:textAutoResize")));
  });

  it("horizontal FIXED alone → vertical HUG and textAutoResize HEIGHT", async () => {
    const { setLayoutSizing } = await loadLayout();
    const parent = makeFrame("row", "HORIZONTAL");
    const text = makeTextNode({
      textAutoResize: "NONE",
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
    });
    parent.appendChild(text);

    const result = await setLayoutSizing({ nodeId: text.id, layoutSizingHorizontal: "FIXED" });

    expect(result.layoutSizingVertical).toBe("HUG");
    expect(result.textAutoResize).toBe("HEIGHT");
  });

  it("horizontal HUG → WIDTH_AND_HEIGHT; FIXED + FIXED → NONE", async () => {
    const { setLayoutSizing } = await loadLayout();
    const parent = makeFrame("col", "VERTICAL");
    const text = makeTextNode({ textAutoResize: "HEIGHT", layoutSizingHorizontal: "FIXED" });
    parent.appendChild(text);

    const hug = await setLayoutSizing({ nodeId: text.id, layoutSizingHorizontal: "HUG" });
    expect(hug.textAutoResize).toBe("WIDTH_AND_HEIGHT");

    const fixed = await setLayoutSizing({
      nodeId: text.id,
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
    });
    expect(fixed.textAutoResize).toBe("NONE");
    expect(fixed.layoutSizingVertical).toBe("FIXED");
  });

  it("FILL outside an auto-layout parent throws before any mutation", async () => {
    const { setLayoutSizing } = await loadLayout();
    const parent = makeFrame("plain", "NONE");
    const text = makeTextNode({
      textAutoResize: "NONE",
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
    });
    parent.appendChild(text);
    log = [];

    await expect(setLayoutSizing({ nodeId: text.id, layoutSizingHorizontal: "FILL" })).rejects.toThrow(
      /FILL only works on children of an auto-layout frame/,
    );

    expect(mutationEntries()).toEqual([]);
    expect(text.textAutoResize).toBe("NONE");
    expect(text.layoutSizingHorizontal).toBe("FIXED");
    expect(text.layoutSizingVertical).toBe("FIXED");
  });

  it("FILL on a frame outside auto layout also throws without mutating", async () => {
    const { setLayoutSizing } = await loadLayout();
    const page = { id: "page", type: "PAGE", name: "Page" };
    const frame: any = { id: "f2", type: "FRAME", name: "Card", parent: page, layoutSizingHorizontal: "FIXED" };
    nodes.set("f2", frame);

    await expect(setLayoutSizing({ nodeId: "f2", layoutSizingHorizontal: "FILL" })).rejects.toThrow(
      /No changes were made/,
    );
    expect(frame.layoutSizingHorizontal).toBe("FIXED");
  });

  it("rolls back textAutoResize when Figma rejects the sizing write", async () => {
    const { setLayoutSizing } = await loadLayout();
    const parent = makeFrame("col", "VERTICAL");
    const text = makeTextNode({
      textAutoResize: "NONE",
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
      throwOnFill: true,
    });
    parent.appendChild(text);

    await expect(setLayoutSizing({ nodeId: text.id, layoutSizingHorizontal: "FILL" })).rejects.toThrow(
      "simulated FILL failure",
    );

    expect(text.textAutoResize).toBe("NONE");
    expect(text.layoutSizingHorizontal).toBe("FIXED");
    expect(text.layoutSizingVertical).toBe("FIXED");
  });
});

describe("serializeNodes TEXT wrapping fields", () => {
  it("includes textAutoResize, textTruncation and maxLines", async () => {
    const { serializeNodes } = await import("../../../src/videntia_figma_plugin/handlers/node-serializer");
    const text = makeTextNode({ characters: "Hello", textAutoResize: "HEIGHT", textTruncation: "ENDING", maxLines: 3 });

    const result = (await serializeNodes({ nodeIds: [text.id] })) as { nodes: Array<Record<string, unknown>> };

    expect(result.nodes[0].textAutoResize).toBe("HEIGHT");
    expect(result.nodes[0].textTruncation).toBe("ENDING");
    expect(result.nodes[0].maxLines).toBe(3);
  });

  it("omits maxLines when null", async () => {
    const { serializeNodes } = await import("../../../src/videntia_figma_plugin/handlers/node-serializer");
    const text = makeTextNode({ characters: "Hi" });

    const result = (await serializeNodes({ nodeIds: [text.id] })) as { nodes: Array<Record<string, unknown>> };

    expect(result.nodes[0].textAutoResize).toBe("WIDTH_AND_HEIGHT");
    expect(result.nodes[0]).not.toHaveProperty("maxLines");
  });
});
