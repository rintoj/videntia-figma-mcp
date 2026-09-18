export {};

let log: string[];
let nodes: Map<string, any>;
let nextId: number;

function makeTextNode(init: Record<string, unknown> = {}): any {
  const node: any = {
    id: `t${nextId++}`,
    type: "TEXT",
    name: "Text",
    visible: true,
    x: 0,
    y: 0,
    width: 60,
    height: 17,
    textAutoResize: "WIDTH_AND_HEIGHT",
    textTruncation: "DISABLED",
    maxLines: null,
    fontName: { family: "Inter", style: "Regular" },
    fontSize: 14,
    lineHeight: { unit: "AUTO" },
    letterSpacing: { unit: "PIXELS", value: 0 },
    textAlignHorizontal: "LEFT",
    textAlignVertical: "TOP",
    textCase: "ORIGINAL",
    textDecoration: "NONE",
    characters: "",
    fills: [],
    parent: null,
    ...init,
  };
  node.getRangeAllFontNames = jest.fn(() => [node.fontName]);
  node.resize = (w: number, h: number) => {
    log.push(`resize:${w}x${h}`);
    node.width = w;
    node.height = h;
    node.textAutoResize = "NONE";
  };
  const proxy = new Proxy(node, {
    set(target, key, value) {
      if (["characters", "textAutoResize", "textAlignHorizontal", "textAlignVertical"].includes(String(key))) {
        log.push(`set:${String(key)}=${value}`);
      }
      target[key] = value;
      return true;
    },
  });
  nodes.set(node.id, proxy);
  return proxy;
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

async function loadText() {
  return await import("../../../src/videntia_figma_plugin/handlers/text");
}

describe("createText alignment", () => {
  it("applies alignment after width and textAutoResize are set", async () => {
    const { createText } = await loadText();

    const result = await createText({
      x: 0,
      y: 0,
      text: "Centred title",
      width: 240,
      textAlignHorizontal: "CENTER",
      textAlignVertical: "BOTTOM",
    });

    expect(result.textAlignHorizontal).toBe("CENTER");
    expect(result.textAlignVertical).toBe("BOTTOM");
    expect(result.textAutoResize).toBe("HEIGHT");
    const idx = (entry: string) => log.findIndex((e) => e.startsWith(entry));
    expect(idx("set:characters")).toBeLessThan(idx("resize:240x"));
    expect(idx("resize:240x")).toBeLessThan(idx("set:textAutoResize=HEIGHT"));
    expect(idx("set:textAutoResize=HEIGHT")).toBeLessThan(idx("set:textAlignHorizontal=CENTER"));
    expect(idx("set:textAutoResize=HEIGHT")).toBeLessThan(idx("set:textAlignVertical=BOTTOM"));
  });

  it("leaves Figma defaults when alignment is omitted", async () => {
    const { createText } = await loadText();

    const result = await createText({ x: 0, y: 0, text: "Label" });

    expect(result.textAlignHorizontal).toBe("LEFT");
    expect(result.textAlignVertical).toBe("TOP");
    expect(log.some((e) => e.startsWith("set:textAlign"))).toBe(false);
  });

  it("rejects an invalid alignment before creating a node", async () => {
    const { createText } = await loadText();

    await expect(createText({ x: 0, y: 0, text: "x", textAlignHorizontal: "MIDDLE" })).rejects.toThrow(
      /Invalid textAlignHorizontal for create_text: MIDDLE/,
    );
    await expect(createText({ x: 0, y: 0, text: "x", textAlignVertical: "LEFT" })).rejects.toThrow(
      /Invalid textAlignVertical/,
    );
    expect((globalThis as any).figma.createText).not.toHaveBeenCalled();
  });
});

describe("setTextAlign", () => {
  it("aligns a single node and returns the applied values", async () => {
    const { setTextAlign } = await loadText();
    const text = makeTextNode({ characters: "Hello", textAutoResize: "HEIGHT", name: "Title" });

    const result = await setTextAlign({ nodeId: text.id, textAlignHorizontal: "CENTER" });

    expect(result).toEqual({
      success: true,
      updated: 1,
      failed: 0,
      results: [
        {
          nodeId: text.id,
          name: "Title",
          success: true,
          textAlignHorizontal: "CENTER",
          textAlignVertical: "TOP",
          textAutoResize: "HEIGHT",
        },
      ],
    });
    expect(log.indexOf("loadFont")).toBeLessThan(log.indexOf("set:textAlignHorizontal=CENTER"));
  });

  it("aligns multiple nodes (nodeId + nodeIds, de-duplicated) with public param names", async () => {
    const { setTextAlign } = await loadText();
    const a = makeTextNode({ textAutoResize: "NONE" });
    const b = makeTextNode({ textAutoResize: "NONE" });

    const result = await setTextAlign({ nodeId: a.id, nodeIds: [a.id, b.id], horizontal: "RIGHT", vertical: "CENTER" });

    expect(result.updated).toBe(2);
    expect((result.results as any[]).map((r) => r.nodeId)).toEqual([a.id, b.id]);
    expect(a.textAlignHorizontal).toBe("RIGHT");
    expect(b.textAlignVertical).toBe("CENTER");
  });

  it("reports non-text and missing nodes per node while aligning the rest", async () => {
    const { setTextAlign } = await loadText();
    const text = makeTextNode({ textAutoResize: "HEIGHT" });
    nodes.set("f1", { id: "f1", type: "FRAME", name: "Card" });

    const result = await setTextAlign({ nodeIds: ["f1", text.id, "404"], textAlignVertical: "BOTTOM" });

    expect(result.success).toBe(false);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(2);
    const [frame, ok, missing] = result.results as any[];
    expect(frame).toEqual({
      nodeId: "f1",
      name: "Card",
      success: false,
      error: "Node is not a text node (type FRAME)",
    });
    expect(ok.textAlignVertical).toBe("BOTTOM");
    expect(missing.error).toMatch(/Node not found/);
  });

  it("notes that horizontal alignment is invisible on hugging text", async () => {
    const { setTextAlign } = await loadText();
    const text = makeTextNode({ textAutoResize: "WIDTH_AND_HEIGHT" });

    const result = await setTextAlign({ nodeId: text.id, textAlignHorizontal: "CENTER" });

    expect((result.results as any[])[0].note).toMatch(/WIDTH_AND_HEIGHT/);
  });

  it.each<[Record<string, unknown>, RegExp]>([
    [{ textAlignHorizontal: "CENTER" }, /requires nodeId or nodeIds/],
    [{ nodeIds: [], textAlignHorizontal: "CENTER" }, /requires nodeId or nodeIds/],
    [{ nodeId: "t1" }, /requires horizontal and\/or vertical/],
    [{ nodeId: "t1", textAlignHorizontal: "MIDDLE" }, /Invalid horizontal for set_text_align/],
    [{ nodeId: "t1", vertical: "LEFT" }, /Invalid vertical for set_text_align/],
  ])("rejects %j", async (params, message) => {
    const { setTextAlign } = await loadText();
    makeTextNode();

    await expect(setTextAlign(params)).rejects.toThrow(message);
    expect(log.some((e) => e.startsWith("set:textAlign"))).toBe(false);
  });
});

describe("serializeNodes TEXT alignment fields", () => {
  it("includes textAlignHorizontal and textAlignVertical", async () => {
    const { serializeNodes } = await import("../../../src/videntia_figma_plugin/handlers/node-serializer");
    const text = makeTextNode({ characters: "Hi", textAlignHorizontal: "CENTER", textAlignVertical: "BOTTOM" });

    const result = (await serializeNodes({ nodeIds: [text.id] })) as { nodes: Array<Record<string, unknown>> };

    expect(result.nodes[0].textAlignHorizontal).toBe("CENTER");
    expect(result.nodes[0].textAlignVertical).toBe("BOTTOM");
  });
});
