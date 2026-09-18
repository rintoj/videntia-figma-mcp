import { setTextAlign } from "../../../src/videntia_figma_plugin/handlers/text";
import { resizeNode } from "../../../src/videntia_figma_plugin/handlers/nodes";

let nodes: Map<string, any>;

function register(node: any) {
  nodes.set(node.id, node);
  return node;
}

beforeEach(() => {
  nodes = new Map();
  (globalThis as any).figma = {
    mixed: Symbol("mixed"),
    getNodeByIdAsync: jest.fn(async (id: string) => nodes.get(id) ?? null),
    loadFontAsync: jest.fn(async () => undefined),
  };
});

function makeTextNode(id = "1:1") {
  return register({
    id,
    name: "Label",
    type: "TEXT",
    fontName: { family: "Inter", style: "Regular" },
    textAlignHorizontal: "LEFT",
    textAlignVertical: "TOP",
    characters: "",
    getRangeAllFontNames: () => [{ family: "Inter", style: "Regular" }],
  });
}

describe("set_text_align (#29)", () => {
  it("actually sets textAlignHorizontal on the node", async () => {
    const node = makeTextNode();
    const result = await setTextAlign({ nodeId: node.id, horizontal: "CENTER" });
    expect(node.textAlignHorizontal).toBe("CENTER");
    expect((result.results as any[])[0].textAlignHorizontal).toBe("CENTER");
    expect(node.textAlignVertical).toBe("TOP"); // untouched
  });

  it("sets both axes and accepts the `align` alias", async () => {
    const node = makeTextNode();
    await setTextAlign({ nodeId: node.id, align: "RIGHT", vertical: "BOTTOM" });
    expect(node.textAlignHorizontal).toBe("RIGHT");
    expect(node.textAlignVertical).toBe("BOTTOM");
  });

  it("accepts the Figma-native textAlignHorizontal alias", async () => {
    const node = makeTextNode();
    await setTextAlign({ nodeId: node.id, textAlignHorizontal: "JUSTIFIED" });
    expect(node.textAlignHorizontal).toBe("JUSTIFIED");
  });

  it("rejects invalid values without mutating the node", async () => {
    const node = makeTextNode();
    await expect(setTextAlign({ nodeId: node.id, horizontal: "MIDDLE" })).rejects.toThrow(/Invalid horizontal/);
    expect(node.textAlignHorizontal).toBe("LEFT");
  });

  it("requires at least one alignment axis", async () => {
    const node = makeTextNode();
    await expect(setTextAlign({ nodeId: node.id })).rejects.toThrow(/requires horizontal and\/or vertical/);
  });

  it("reports non-text nodes per node instead of throwing", async () => {
    register({ id: "2:2", name: "Box", type: "FRAME" });
    const result = await setTextAlign({ nodeId: "2:2", horizontal: "CENTER" });
    expect(result.success).toBe(false);
    expect((result.results as any[])[0].error).toMatch(/not a text node/);
  });
});

describe("resize_node scale_strokes (#33)", () => {
  function makeIcon() {
    const child1 = { id: "3:2", name: "path-1", type: "VECTOR", strokeWeight: 2 };
    const child2 = { id: "3:3", name: "path-2", type: "VECTOR", strokeWeight: 1.5 };
    const grandchild = { id: "3:4", name: "nested", type: "VECTOR", strokeWeight: 4 };
    (child2 as any).children = [grandchild];
    const frame: any = {
      id: "3:1",
      name: "Icon",
      type: "FRAME",
      width: 24,
      height: 24,
      children: [child1, child2],
      resize(w: number, h: number) {
        this.width = w;
        this.height = h;
      },
    };
    register(frame);
    return { frame, child1, child2, grandchild };
  }

  it("halves child vector stroke weights on a 0.5x resize", async () => {
    const { frame, child1, child2, grandchild } = makeIcon();
    const result = await resizeNode({ nodeId: frame.id, width: 12, height: 12, scale_strokes: true });
    expect(frame.width).toBe(12);
    expect(child1.strokeWeight).toBe(1);
    expect(child2.strokeWeight).toBe(0.75);
    expect(grandchild.strokeWeight).toBe(2); // recurses into the whole subtree
    expect(result.strokeScaleFactor).toBe(0.5);
    expect(result.strokesScaled).toBe(3);
  });

  it("doubles stroke weights on a 2x resize", async () => {
    const { frame, child1 } = makeIcon();
    await resizeNode({ nodeId: frame.id, width: 48, height: 48, scaleStrokes: true });
    expect(child1.strokeWeight).toBe(4);
  });

  it("leaves stroke weights untouched when the option is absent (back-compat)", async () => {
    const { frame, child1, grandchild } = makeIcon();
    const result = await resizeNode({ nodeId: frame.id, width: 12, height: 12 });
    expect(child1.strokeWeight).toBe(2);
    expect(grandchild.strokeWeight).toBe(4);
    expect(result.strokeScaleFactor).toBeUndefined();
  });

  it("uses the average factor for a non-uniform resize", async () => {
    const { frame, child1 } = makeIcon();
    // 24->12 (0.5x) horizontally, 24->48 (2x) vertically → average 1.25
    const result = await resizeNode({ nodeId: frame.id, width: 12, height: 48, scale_strokes: true });
    expect(result.strokeScaleFactor).toBe(1.25);
    expect(child1.strokeWeight).toBe(2.5);
  });
});
