import { createFrame } from "../../../src/videntia_figma_plugin/handlers/nodes";
import { setClipsContent } from "../../../src/videntia_figma_plugin/handlers/layout";
import { setAutoLayout } from "../../../src/videntia_figma_plugin/handlers/text";

type MockNode = Record<string, any>;

function makeContainer(id: string, type: string): MockNode {
  const node: MockNode = {
    id,
    type,
    name: id,
    children: [] as MockNode[],
    appendChild(child: MockNode) {
      child.parent = node;
      node.children.push(child);
    },
  };
  return node;
}

let nodes: Map<string, MockNode>;
let page: MockNode;

beforeEach(() => {
  nodes = new Map();
  page = makeContainer("0:1", "PAGE");
  nodes.set(page.id, page);
  nodes.set("1:1", makeContainer("1:1", "FRAME"));
  nodes.set("1:2", makeContainer("1:2", "COMPONENT"));

  let counter = 100;
  (globalThis as any).figma = {
    getNodeByIdAsync: jest.fn(async (id: string) => nodes.get(id) ?? null),
    currentPage: page,
    createFrame: jest.fn(() => {
      const frame: MockNode = {
        id: `9:${counter++}`,
        type: "FRAME",
        name: "Frame",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        clipsContent: true,
        parent: null,
        resize(w: number, h: number) {
          frame.width = w;
          frame.height = h;
        },
      };
      return frame;
    }),
  };
});

afterEach(() => {
  delete (globalThis as any).figma;
});

describe("createFrame clipsContent default", () => {
  it("clips top-level frames when no parentId is given", async () => {
    const result = await createFrame({ x: 0, y: 0, width: 10, height: 10 });
    expect(result.clipsContent).toBe(true);
  });

  it("clips frames whose parentId is a page", async () => {
    const result = await createFrame({ x: 0, y: 0, width: 10, height: 10, parentId: "0:1" });
    expect(result.clipsContent).toBe(true);
  });

  it("clips frames whose parentId is a section", async () => {
    nodes.set("2:1", makeContainer("2:1", "SECTION"));
    const result = await createFrame({ x: 0, y: 0, width: 10, height: 10, parentId: "2:1" });
    expect(result.clipsContent).toBe(true);
  });

  it("does not clip nested frames by default", async () => {
    const inFrame = await createFrame({ x: 0, y: 0, width: 10, height: 10, parentId: "1:1" });
    const inComponent = await createFrame({ x: 0, y: 0, width: 10, height: 10, parentId: "1:2" });
    expect(inFrame.clipsContent).toBe(false);
    expect(inComponent.clipsContent).toBe(false);
  });

  it("honours an explicit clipsContent over the default", async () => {
    const nestedClipped = await createFrame({ x: 0, y: 0, width: 10, height: 10, parentId: "1:1", clipsContent: true });
    const topUnclipped = await createFrame({ x: 0, y: 0, width: 10, height: 10, clipsContent: false });
    expect(nestedClipped.clipsContent).toBe(true);
    expect(topUnclipped.clipsContent).toBe(false);
  });
});

describe("setClipsContent", () => {
  it.each(["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"])("sets clipsContent on %s nodes", async (type) => {
    nodes.set("2:1", { id: "2:1", type, name: "Target", clipsContent: true });
    const result = await setClipsContent({ nodeId: "2:1", clipsContent: false });
    expect(result).toEqual({ id: "2:1", name: "Target", clipsContent: false });
    expect(nodes.get("2:1")!.clipsContent).toBe(false);
  });

  it("rejects unsupported node types", async () => {
    nodes.set("2:2", { id: "2:2", type: "TEXT", name: "Label" });
    await expect(setClipsContent({ nodeId: "2:2", clipsContent: false })).rejects.toThrow(
      'Node "Label" does not support clipsContent (type: TEXT)',
    );
  });

  it("rejects missing nodes and params", async () => {
    await expect(setClipsContent({ nodeId: "404:1", clipsContent: false })).rejects.toThrow("not found");
    await expect(setClipsContent({ clipsContent: false })).rejects.toThrow("Missing nodeId");
    await expect(setClipsContent({ nodeId: "1:1" })).rejects.toThrow("Missing clipsContent");
  });
});

describe("setAutoLayout clipsContent", () => {
  it("applies clipsContent when mode is NONE", async () => {
    nodes.set("3:1", { id: "3:1", type: "FRAME", name: "Card", layoutMode: "NONE", clipsContent: true, parent: page });
    const result = await setAutoLayout({ nodeId: "3:1", layoutMode: "NONE", clipsContent: false });
    expect(result.clipsContent).toBe(false);
    expect(nodes.get("3:1")!.layoutMode).toBe("NONE");
  });

  it("applies clipsContent when enabling auto layout", async () => {
    nodes.set("3:2", { id: "3:2", type: "FRAME", name: "Row", layoutMode: "NONE", clipsContent: true, parent: page });
    const result = await setAutoLayout({ nodeId: "3:2", layoutMode: "HORIZONTAL", clipsContent: false });
    expect(result.clipsContent).toBe(false);
    expect(result.layoutMode).toBe("HORIZONTAL");
  });
});
