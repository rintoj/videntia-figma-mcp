import {
  buildBackdropStack,
  contrastCheckFrame,
  collectImageHashes,
  fetchBackdropImages,
  serializePaints,
  MAX_IMAGE_BYTES_TOTAL,
  type StackSourceNode,
} from "../../../src/videntia_figma_plugin/handlers/verification";
import { evaluateTextSample, type TextSample } from "../../../src/videntia_figma_mcp/utils/verification-math";

type N = StackSourceNode & { children?: N[]; parent?: N | null; [k: string]: unknown };

const MIXED = Symbol("mixed");
const solid = (r: number, g: number, b: number, opacity = 1) => ({
  type: "SOLID",
  visible: true,
  opacity,
  color: { r, g, b },
});

function node(id: string, type: string, box: [number, number, number, number], extra: Partial<N> = {}): N {
  const [x, y, width, height] = box;
  return { id, name: id, type, absoluteBoundingBox: { x, y, width, height }, ...extra } as N;
}

function attach(parent: N, ...kids: N[]): N {
  parent.children = kids;
  for (const k of kids) k.parent = parent;
  return parent;
}

function pageWith(...kids: N[]): N {
  const page = { id: "0:1", name: "Page 1", type: "PAGE", backgrounds: [solid(0.2, 0.2, 0.2)] } as N;
  return attach(page, ...kids);
}

describe("buildBackdropStack", () => {
  it("includes the page background, ancestors and the sibling shape beneath the text", () => {
    const rect = node("rect", "RECTANGLE", [0, 0, 120, 40], { fills: [solid(0, 0, 0)] });
    const label = node("label", "TEXT", [10, 10, 100, 20], { fills: [solid(1, 1, 1)] });
    const button = attach(node("button", "GROUP", [0, 0, 120, 40], { opacity: 0.8 }), rect, label);
    const frame = attach(
      node("frame", "FRAME", [0, 0, 400, 400], { fills: [solid(1, 1, 1)], clipsContent: true }),
      button,
    );
    pageWith(frame);

    const { stack, partial } = buildBackdropStack(label);
    expect(partial).toBe(false);
    expect(stack.nodeType).toBe("PAGE");
    expect(stack.fills).toHaveLength(1);
    const f = stack.children![0];
    expect(f.nodeId).toBe("frame");
    expect(f.clips).toBe(true);
    const g = f.children![0];
    expect(g.nodeId).toBe("button");
    expect(g.opacity).toBe(0.8);
    expect(g.children!.map((c) => c.nodeId)).toEqual(["rect", "label"]);
    expect(g.children![1].target).toBe(true);
    expect(g.children![1].fills).toBeUndefined();
  });

  it("skips siblings above the text, hidden ones, text, masks and ones that miss the text box", () => {
    const label = node("label", "TEXT", [10, 10, 100, 20]);
    const frame = attach(
      node("frame", "FRAME", [0, 0, 400, 400]),
      node("far", "RECTANGLE", [300, 300, 10, 10], { fills: [solid(0, 0, 0)] }),
      node("hidden", "RECTANGLE", [0, 0, 200, 200], { fills: [solid(0, 0, 0)], visible: false }),
      node("otherText", "TEXT", [0, 0, 200, 200], { fills: [solid(0, 0, 0)] }),
      node("mask", "RECTANGLE", [0, 0, 200, 200], { fills: [solid(0, 0, 0)], isMask: true }),
      node("under", "RECTANGLE", [0, 0, 200, 200], { fills: [solid(0, 0, 1)] }),
      label,
      node("above", "RECTANGLE", [0, 0, 200, 200], { fills: [solid(1, 0, 0)] }),
    );
    pageWith(frame);
    const f = buildBackdropStack(label).stack.children![0];
    expect(f.children!.map((c) => c.nodeId)).toEqual(["under", "label"]);
  });

  it("recurses into a sibling container to find the filled descendants under the text", () => {
    const label = node("label", "TEXT", [10, 10, 100, 20]);
    const card = attach(
      node("card", "FRAME", [0, 0, 200, 100]),
      node("chip", "RECTANGLE", [0, 0, 150, 50], { fills: [solid(0, 0, 0)] }),
      node("elsewhere", "RECTANGLE", [180, 80, 10, 10], { fills: [solid(1, 0, 0)] }),
    );
    pageWith(card, label);
    const { stack } = buildBackdropStack(label);
    expect(stack.children!.map((c) => c.nodeId)).toEqual(["card", "label"]);
    expect(stack.children![0].children!.map((c) => c.nodeId)).toEqual(["chip"]);
  });

  it("flags a partial stack when the node cap is hit", () => {
    const label = node("label", "TEXT", [0, 0, 10, 10]);
    const many = Array.from({ length: 120 }, (_, i) =>
      node(`r${i}`, "RECTANGLE", [0, 0, 50, 50], { fills: [solid(0, 0, 0)] }),
    );
    pageWith(...many, label);
    expect(buildBackdropStack(label).partial).toBe(true);
  });

  it("feeds evaluateTextSample: white label on a black button passes", () => {
    const rect = node("rect", "RECTANGLE", [0, 0, 120, 40], { fills: [solid(0, 0, 0)] });
    const label = node("label", "TEXT", [10, 10, 100, 20]);
    pageWith(attach(node("button", "GROUP", [0, 0, 120, 40]), rect, label));
    const sample: TextSample = {
      nodeId: "label",
      nodeName: "label",
      characters: "Buy",
      fontSize: 14,
      bounds: { x: 10, y: 10, width: 100, height: 20 },
      fills: [solid(1, 1, 1)] as TextSample["fills"],
      stack: buildBackdropStack(label).stack as TextSample["stack"],
    };
    const f = evaluateTextSample(sample);
    expect(f.background.toLowerCase()).toBe("#000000");
    expect(f.severity).toBe("pass");
  });
});

describe("contrastCheckFrame", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("serialises styled segments for mixed text instead of dropping its fills", async () => {
    const label = node("label", "TEXT", [0, 0, 100, 20], {
      characters: "Hi there",
      fills: MIXED,
      fontSize: MIXED,
      fontName: MIXED,
      opacity: 1,
      getStyledTextSegments: jest.fn(() => [
        {
          start: 0,
          end: 3,
          characters: "Hi ",
          fills: [solid(1, 1, 1)],
          fontSize: 12,
          fontName: { family: "Inter", style: "Bold" },
        },
        {
          start: 3,
          end: 8,
          characters: "there",
          fills: [solid(0.5, 0.5, 0.5)],
          fontSize: 20,
          fontName: { family: "Inter", style: "Regular" },
        },
      ]),
    });
    const frame = attach(node("frame", "FRAME", [0, 0, 200, 200], { fills: [solid(0, 0, 0)] }), label);
    pageWith(frame);
    (globalThis as any).figma = { mixed: MIXED, getNodeByIdAsync: jest.fn(async () => frame) };

    const out = (await contrastCheckFrame({ nodeId: "frame" })) as { samples: Array<Record<string, any>> };
    expect(out.samples).toHaveLength(1);
    const s = out.samples[0];
    expect(s.fills).toEqual([]);
    expect(s.segments).toHaveLength(2);
    expect(s.segments[0]).toMatchObject({ start: 0, end: 3, fontSize: 12, fontWeight: 700 });
    expect(s.segments[1]).toMatchObject({ start: 3, end: 8, fontSize: 20, fontWeight: 400 });
    expect(s.stack.nodeType).toBe("PAGE");

    const f = evaluateTextSample(s as TextSample);
    expect(f.segments).toHaveLength(2);
    expect(f.foreground.toLowerCase()).not.toBe("#000000");
  });

  it("omits segments for uniformly styled text", async () => {
    const label = node("label", "TEXT", [0, 0, 100, 20], {
      characters: "Hi",
      fills: [solid(0, 0, 0)],
      fontSize: 14,
      fontName: { family: "Inter", style: "Regular" },
      getStyledTextSegments: jest.fn(),
    });
    pageWith(label);
    (globalThis as any).figma = { mixed: MIXED, getNodeByIdAsync: jest.fn(async () => label) };
    const out = (await contrastCheckFrame({ nodeId: "label" })) as { samples: Array<Record<string, any>> };
    expect(out.samples[0].segments).toBeUndefined();
    expect((label as any).getStyledTextSegments).not.toHaveBeenCalled();
  });
});

describe("image paints for backdrop sampling", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  const imagePaint = (hash: string, extra: Record<string, unknown> = {}) => ({
    type: "IMAGE",
    visible: true,
    opacity: 1,
    imageHash: hash,
    scaleMode: "FILL",
    ...extra,
  });

  it("serialises what the server needs to map an image paint", () => {
    const [p] = serializePaints([
      imagePaint("abc", {
        scaleMode: "CROP",
        imageTransform: [
          [0.5, 0, 0.25],
          [0, 0.5, 0.25],
        ],
        rotation: 90,
        scalingFactor: 0.5,
        filters: { exposure: 0.2, contrast: 0 },
      }),
    ]) as Array<Record<string, unknown>>;
    expect(p).toMatchObject({
      type: "IMAGE",
      imageHash: "abc",
      scaleMode: "CROP",
      rotation: 90,
      scalingFactor: 0.5,
      imageTransform: [
        [0.5, 0, 0.25],
        [0, 0.5, 0.25],
      ],
      filters: { exposure: 0.2 },
    });
  });

  it("collects distinct hashes from stacks and text fills, skipping hidden paints", () => {
    const hashes = collectImageHashes([
      {
        stack: {
          nodeId: "p",
          nodeName: "p",
          fills: [imagePaint("a")],
          children: [
            {
              nodeId: "r",
              nodeName: "r",
              fills: [imagePaint("b"), imagePaint("a"), imagePaint("x", { visible: false })],
            },
          ],
        },
        fills: [imagePaint("c")],
        segments: [{ fills: [imagePaint("b"), imagePaint("d")] }],
      },
    ]);
    expect(hashes).toEqual(["a", "b", "c", "d"]);
  });

  it("fetches bytes once per hash and reports missing images and the byte budget", async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES_TOTAL - 2);
    const getBytesAsync = jest.fn(async () => new Uint8Array([1, 2, 3]));
    (globalThis as any).figma = {
      getImageByHash: jest.fn((h: string) => {
        if (h === "missing") return null;
        if (h === "big") return { getBytesAsync: async () => big };
        return { getBytesAsync };
      }),
    };
    const out = await fetchBackdropImages(["big", "small", "missing", "boom"]);
    expect("base64" in out.big).toBe(true);
    expect((out.small as { error: string }).error).toContain("budget exceeded");
    expect((out.missing as { error: string }).error).toContain("not found");
  });

  it("contrastCheckFrame ships image bytes for an image sitting behind text", async () => {
    const photo = node("photo", "RECTANGLE", [0, 0, 200, 100], { fills: [imagePaint("h1")] });
    const label = node("label", "TEXT", [10, 10, 100, 20], {
      characters: "Hi",
      fills: [solid(1, 1, 1)],
      fontSize: 20,
      fontName: { family: "Inter", style: "Regular" },
      getStyledTextSegments: jest.fn(),
    });
    const frame = attach(node("frame", "FRAME", [0, 0, 200, 100]), photo, label);
    pageWith(frame);
    const getImageByHash = jest.fn(() => ({ getBytesAsync: async () => new Uint8Array([137, 80, 78, 71]) }));
    (globalThis as any).figma = { mixed: MIXED, getNodeByIdAsync: jest.fn(async () => frame), getImageByHash };
    const out = (await contrastCheckFrame({ nodeId: "frame" })) as Record<string, any>;
    expect(getImageByHash).toHaveBeenCalledTimes(1);
    expect(out.images.h1).toEqual({ base64: "iVBORw==", bytes: 4 });
    expect(out.samples[0].fontWeight).toBe(400);
  });

  it("omits the images map when nothing is image-backed", async () => {
    const label = node("label", "TEXT", [0, 0, 100, 20], {
      characters: "Hi",
      fills: [solid(0, 0, 0)],
      fontSize: 14,
      fontName: { family: "Inter", style: "Regular" },
      getStyledTextSegments: jest.fn(),
    });
    pageWith(label);
    (globalThis as any).figma = { mixed: MIXED, getNodeByIdAsync: jest.fn(async () => label) };
    const out = (await contrastCheckFrame({ nodeId: "label" })) as Record<string, any>;
    expect(out.images).toBeUndefined();
  });
});
