import { createFromData } from "../../../src/videntia_figma_plugin/handlers/design-system";
import { serializeNodes } from "../../../src/videntia_figma_plugin/handlers/node-serializer";

type MockNode = Record<string, any>;

let nodes: Map<string, MockNode>;
let page: MockNode;
let counter: number;

function makeRectangle(id: string): MockNode {
  const rect: MockNode = {
    id,
    type: "RECTANGLE",
    name: "Rectangle",
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    parent: null,
    resize(w: number, h: number) {
      rect.width = w;
      rect.height = h;
    },
  };
  nodes.set(id, rect);
  return rect;
}

beforeEach(() => {
  nodes = new Map();
  counter = 1;
  page = {
    id: "0:1",
    type: "PAGE",
    name: "Page",
    children: [] as MockNode[],
    appendChild(child: MockNode) {
      child.parent = page;
      page.children.push(child);
    },
    findAll: () => [],
  };
  (globalThis as any).figma = {
    mixed: Symbol("mixed"),
    currentPage: page,
    variables: { getLocalVariablesAsync: jest.fn(async () => []) },
    getLocalTextStylesAsync: jest.fn(async () => []),
    getLocalEffectStylesAsync: jest.fn(async () => []),
    getNodeByIdAsync: jest.fn(async (id: string) => nodes.get(id) ?? null),
    createRectangle: jest.fn(() => makeRectangle(`9:${counter++}`)),
  };
});

afterEach(() => {
  delete (globalThis as any).figma;
});

describe("create_from_data visible", () => {
  it("creates a hidden node", async () => {
    const result = await createFromData({
      data: [{ type: "RECTANGLE", name: "Scrim", width: 10, height: 10, visible: false }],
      x: 0,
      y: 0,
    });
    const created = nodes.get("9:1");
    expect(created?.visible).toBe(false);
    expect(result["createdNodes"]).toEqual([{ id: "9:1", name: "Scrim", type: "RECTANGLE", action: "created" }]);
  });

  it("leaves visibility untouched when the key is absent", async () => {
    await createFromData({ data: [{ type: "RECTANGLE", name: "Card" }], x: 0, y: 0 });
    expect(nodes.get("9:1")?.visible).toBe(true);
  });

  it("updates visibility on an existing node in place", async () => {
    const existing = makeRectangle("5:1");
    existing.visible = false;
    page.appendChild(existing);
    const result = await createFromData({ data: [{ id: "5:1", type: "RECTANGLE", name: "Badge", visible: "true" }] });
    expect(existing.visible).toBe(true);
    expect(result["createdNodes"]).toEqual([{ id: "5:1", name: "Badge", type: "RECTANGLE", action: "updated" }]);
  });
});

describe("serializeNodes hidden nodes", () => {
  it("reports a directly requested hidden node but skips hidden descendants", async () => {
    const shown = makeRectangle("2:2");
    const hidden = makeRectangle("2:3");
    hidden.visible = false;
    const frame: MockNode = {
      id: "2:1",
      type: "FRAME",
      name: "Card",
      visible: false,
      children: [shown, hidden],
    };
    nodes.set(frame.id, frame);

    const result = (await serializeNodes({ nodeIds: ["2:1"] })) as { nodes: Array<Record<string, any>> };
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({ id: "2:1", visible: false });
    expect(result.nodes[0].children.map((c: MockNode) => c.id)).toEqual(["2:2"]);
  });
});
