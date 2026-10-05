import {
  normalizeRotation,
  resolveLayerIndex,
  setLayerOrder,
  setRotation,
} from "../../../src/videntia_figma_plugin/handlers/arrange";

/** A node whose `rotation` setter pivots on the top-left, like Figma's. */
function makeRotatable(init: { x: number; y: number; width: number; height: number; parent?: any }): any {
  const node: any = {
    id: "1:1",
    name: "Box",
    type: "RECTANGLE",
    width: init.width,
    height: init.height,
    parent: init.parent ?? { id: "0:1", type: "PAGE" },
    _deg: 0,
    relativeTransform: [
      [1, 0, init.x],
      [0, 1, init.y],
    ],
  };
  Object.defineProperty(node, "x", {
    get: () => node.relativeTransform[0][2],
    set: (v: number) =>
      (node.relativeTransform = [node.relativeTransform[0].slice(0, 2).concat(v), node.relativeTransform[1]]),
  });
  Object.defineProperty(node, "y", {
    get: () => node.relativeTransform[1][2],
    set: (v: number) =>
      (node.relativeTransform = [node.relativeTransform[0], node.relativeTransform[1].slice(0, 2).concat(v)]),
  });
  Object.defineProperty(node, "rotation", {
    get: () => node._deg,
    set: (deg: number) => {
      node._deg = deg;
      const r = (deg * Math.PI) / 180;
      node.relativeTransform = [
        [Math.cos(r), Math.sin(r), node.x],
        [-Math.sin(r), Math.cos(r), node.y],
      ];
    },
  });
  Object.defineProperty(node, "absoluteBoundingBox", { get: () => ({ x: node.x, y: node.y, width: 0, height: 0 }) });
  return node;
}

function center(node: any) {
  const t = node.relativeTransform;
  return {
    x: t[0][0] * (node.width / 2) + t[0][1] * (node.height / 2) + t[0][2],
    y: t[1][0] * (node.width / 2) + t[1][1] * (node.height / 2) + t[1][2],
  };
}

describe("set_rotation", () => {
  let node: any;
  const install = (n: any) => {
    node = n;
    (globalThis as any).figma = { getNodeByIdAsync: jest.fn(async () => node) };
  };
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("keeps the centre fixed by default", async () => {
    install(makeRotatable({ x: 100, y: 50, width: 200, height: 100 }));
    const before = center(node);
    const result = await setRotation({ nodeId: "1:1", rotation: 45 });
    expect(result.rotation).toBe(45);
    expect(result.origin).toBe("center");
    const after = center(node);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("pivots on the top-left when asked", async () => {
    install(makeRotatable({ x: 100, y: 50, width: 200, height: 100 }));
    await setRotation({ nodeId: "1:1", rotation: 90, origin: "top-left" });
    expect(node.x).toBe(100);
    expect(node.y).toBe(50);
  });

  it("adds to the current angle when relative, wrapping into (-180, 180]", async () => {
    install(makeRotatable({ x: 0, y: 0, width: 10, height: 10 }));
    node.rotation = 170;
    const result = await setRotation({ nodeId: "1:1", rotation: 30, relative: true });
    expect(result.previousRotation).toBe(170);
    expect(result.rotation).toBe(-160);
  });

  it("accepts the angle/degrees spellings", async () => {
    install(makeRotatable({ x: 0, y: 0, width: 10, height: 10 }));
    expect((await setRotation({ nodeId: "1:1", angle: 15 })).rotation).toBe(15);
    expect((await setRotation({ nodeId: "1:1", degrees: "-30" })).rotation).toBe(-30);
  });

  it("does not fight auto layout and says so", async () => {
    install(makeRotatable({ x: 0, y: 0, width: 10, height: 10, parent: { id: "p", layoutMode: "HORIZONTAL" } }));
    const result = await setRotation({ nodeId: "1:1", rotation: 20 });
    expect(result.origin).toBe("top-left");
    expect((result.warnings as string[])[0]).toMatch(/auto layout/);
  });

  it("rejects bad input", async () => {
    install(makeRotatable({ x: 0, y: 0, width: 10, height: 10 }));
    await expect(setRotation({ nodeId: "1:1", rotation: "abc" })).rejects.toThrow(/finite number/);
    await expect(setRotation({ nodeId: "1:1", rotation: 5, origin: "middle" })).rejects.toThrow(/origin/);
    install({ id: "0:1", type: "PAGE", name: "Page" });
    await expect(setRotation({ nodeId: "0:1", rotation: 5 })).rejects.toThrow(/cannot be rotated/);
  });

  it("normalizeRotation wraps", () => {
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(190)).toBe(-170);
    expect(normalizeRotation(-180)).toBe(180);
  });
});

describe("set_layer_order", () => {
  /** Parent whose insertChild counts the moved node's old slot, like a naive splice. */
  function makeParent(names: string[], removeFirst: boolean): any {
    const parent: any = { id: "p:1", type: "FRAME", children: [] as any[] };
    const detach = (n: any) => {
      const i = parent.children.indexOf(n);
      if (i !== -1) parent.children.splice(i, 1);
    };
    parent.appendChild = (n: any) => {
      detach(n);
      parent.children.push(n);
    };
    parent.insertChild = (index: number, n: any) => {
      const old = parent.children.indexOf(n);
      detach(n);
      const at = !removeFirst && old !== -1 && old < index ? index - 1 : index;
      parent.children.splice(at, 0, n);
    };
    parent.children = names.map((name) => ({ id: name, name, type: "RECTANGLE", parent }));
    return parent;
  }

  const order = (parent: any) => parent.children.map((c: any) => c.name).join("");

  for (const removeFirst of [true, false]) {
    describe(removeFirst ? "final-index insertChild" : "before-original-slot insertChild", () => {
      let parent: any;
      beforeEach(() => {
        parent = makeParent(["a", "b", "c", "d"], removeFirst);
        (globalThis as any).figma = {
          getNodeByIdAsync: jest.fn(async (id: string) => parent.children.find((c: any) => c.id === id) ?? null),
        };
      });
      afterEach(() => {
        delete (globalThis as any).figma;
      });

      it("front / back", async () => {
        await setLayerOrder({ nodeId: "a", position: "front" });
        expect(order(parent)).toBe("bcda");
        await setLayerOrder({ nodeId: "d", position: "back" });
        expect(order(parent)).toBe("dbca");
      });

      it("forward / backward by one", async () => {
        const r = await setLayerOrder({ nodeId: "b", position: "forward" });
        expect(order(parent)).toBe("acbd");
        expect(r).toMatchObject({ previousIndex: 1, index: 2, childCount: 4, parentId: "p:1" });
        await setLayerOrder({ nodeId: "b", position: "backward" });
        expect(order(parent)).toBe("abcd");
      });

      it("exact index, clamped", async () => {
        await setLayerOrder({ nodeId: "a", position: 2 });
        expect(order(parent)).toBe("bcad");
        await setLayerOrder({ nodeId: "a", position: 99 });
        expect(order(parent)).toBe("bcda");
      });
    });
  }

  it("resolveLayerIndex validates", () => {
    expect(resolveLayerIndex("FRONT", 0, 3)).toBe(2);
    expect(resolveLayerIndex("forward", 2, 3)).toBe(2);
    expect(resolveLayerIndex("backward", 0, 3)).toBe(0);
    expect(() => resolveLayerIndex("top", 0, 3)).toThrow(/front/);
    expect(() => resolveLayerIndex(-1, 0, 3)).toThrow(/non-negative/);
  });
});
