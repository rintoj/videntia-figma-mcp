/**
 * An export straight after an image fill (e.g. the next action of one batch) could
 * render the image paint blank while Figma was still loading it. The export handler
 * now awaits every referenced image's readiness before calling exportAsync.
 */
import { collectImageHashes, awaitSubtreeImagesReady } from "../../../src/videntia_figma_plugin/utils/image-readiness";
import { exportNodeAsImage } from "../../../src/videntia_figma_plugin/handlers/nodes";
import { setImageFill } from "../../../src/videntia_figma_plugin/handlers/fills";

const MIXED = Symbol("figma.mixed");

function tree(): any {
  return {
    id: "1:1",
    type: "FRAME",
    name: "Root",
    width: 10,
    height: 10,
    fills: [{ type: "IMAGE", imageHash: "a", scaleMode: "FILL" }],
    strokes: [],
    children: [
      { id: "1:2", type: "RECTANGLE", name: "r", fills: [{ type: "IMAGE", imageHash: "b", scaleMode: "TILE" }] },
      { id: "1:3", type: "RECTANGLE", name: "dup", fills: [{ type: "IMAGE", imageHash: "a" }] },
      { id: "1:4", type: "RECTANGLE", name: "solid", fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }] },
      { id: "1:5", type: "TEXT", name: "mixed", fills: MIXED },
    ],
  };
}

afterEach(() => {
  delete (globalThis as any).figma;
});

describe("collectImageHashes", () => {
  it("returns each IMAGE hash in the subtree once", () => {
    expect(collectImageHashes(tree()).sort()).toEqual(["a", "b"]);
  });
});

describe("awaitSubtreeImagesReady", () => {
  it("awaits getSizeAsync for every referenced image and never throws", async () => {
    const loaded: string[] = [];
    (globalThis as any).figma = {
      mixed: MIXED,
      getImageByHash: (hash: string) =>
        hash === "b"
          ? { getSizeAsync: async () => Promise.reject(new Error("broken")) }
          : { getSizeAsync: async () => (loaded.push(hash), { width: 1, height: 1 }) },
    };
    await expect(awaitSubtreeImagesReady(tree())).resolves.toBeUndefined();
    expect(loaded).toEqual(["a"]);
  });
});

describe("exportNodeAsImage", () => {
  it("waits for the subtree's images to load before calling exportAsync", async () => {
    const order: string[] = [];
    let release!: () => void;
    const pending = new Promise<void>((r) => (release = r));
    const node = {
      ...tree(),
      exportAsync: async () => {
        order.push("export");
        return new Uint8Array([1, 2, 3]);
      },
    };
    (globalThis as any).figma = {
      mixed: MIXED,
      getNodeByIdAsync: async () => node,
      getImageByHash: () => ({
        getSizeAsync: async () => {
          await pending;
          order.push("ready");
          return { width: 1, height: 1 };
        },
      }),
    };
    const run = exportNodeAsImage({ nodeId: "1:1" });
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual([]);
    release();
    await run;
    expect(order[order.length - 1]).toBe("export");
    expect(order.filter((o) => o === "ready")).toHaveLength(2);
  });
});

describe("setImageFill", () => {
  it("resolves the image's readiness before assigning the fill", async () => {
    const order: string[] = [];
    const node: any = { id: "1:2", name: "Rect" };
    let fills: unknown[] = [];
    Object.defineProperty(node, "fills", {
      get: () => fills,
      set: (v) => {
        order.push("assign");
        fills = v;
      },
    });
    (globalThis as any).figma = {
      getNodeByIdAsync: async () => node,
      createImage: () => ({
        hash: "h1",
        getSizeAsync: async () => {
          order.push("ready");
          return { width: 4, height: 4 };
        },
      }),
    };
    await setImageFill({ nodeId: "1:2", imageBytes: "iVBORw0KGgo=", scaleMode: "TILE", scalingFactor: 0.5 });
    expect(order).toEqual(["ready", "assign"]);
  });
});
