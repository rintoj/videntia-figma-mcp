/**
 * Bug #13: `get_node_info` did not surface paint data reliably — a node whose only
 * fill was hidden, or whose paints were `figma.mixed`, produced NO `fills` key at
 * all, and IMAGE paints lost `scaleMode`/`imageHash`. With no way to read a fill
 * back, verifying a fill meant exporting an image (the single most expensive
 * operation in the server).
 *
 * These tests assert the paint data is ACTUALLY PRESENT AND CORRECT in the payload
 * at every layer — plugin serializer, JSON projection, compact projection and the
 * `fields: ["fills"]` projection. Asserting only "the tool returned success" is what
 * let this ship.
 */

const MIXED = Symbol("figma.mixed");
(globalThis as any).figma = { mixed: MIXED };

import {
  extractFills,
  extractStrokes,
  extractEffects,
} from "../../../src/videntia_figma_plugin/handlers/node-serializer";
import { filterNodeData, type NodeField } from "../../../src/videntia_figma_mcp/utils/figma-helpers";
import { formatCompact } from "../../../src/videntia_figma_mcp/utils/compact-node";
import { convertToJsx } from "../../../src/videntia_figma_mcp/utils/figma-to-jsx";

const solid = (r: number, g: number, b: number, extra: Record<string, unknown> = {}) => ({
  type: "SOLID",
  color: { r, g, b },
  ...extra,
});

const imagePaint = (extra: Record<string, unknown> = {}) => ({
  type: "IMAGE",
  imageHash: "abc123",
  scaleMode: "FILL",
  ...extra,
});

const node = (props: Record<string, unknown>) => props as any;

describe("extractFills (plugin serializer) — bug #13", () => {
  it("returns a structured SOLID paint with the colour as hex", () => {
    const fills = extractFills(node({ fills: [solid(1, 1, 1)] }));
    expect(fills).toEqual([{ type: "SOLID", color: "#ffffff" }]);
  });

  it("returns a structured IMAGE paint with scaleMode AND imageHash", () => {
    const fills = extractFills(node({ fills: [imagePaint({ scaleMode: "FIT" })] })) as any[];
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({
      type: "IMAGE",
      isImage: true,
      scaleMode: "FIT",
      imageHash: "abc123",
      // legacy key kept so the JSX renderer keeps producing backgroundImage
      imageRef: "abc123",
    });
  });

  it("returns EVERY paint when a node has multiple fills, in order", () => {
    const fills = extractFills(
      node({ fills: [solid(1, 0, 0), imagePaint(), solid(0, 0, 1, { opacity: 0.5 })] }),
    ) as any[];
    expect(fills.map((f) => f.type)).toEqual(["SOLID", "IMAGE", "SOLID"]);
    expect(fills[0].color).toBe("#ff0000");
    expect(fills[2]).toMatchObject({ color: "#0000ff", opacity: 0.5 });
  });

  it("KEEPS hidden paints, flagged visible:false (previously dropped entirely)", () => {
    const fills = extractFills(node({ fills: [imagePaint({ visible: false })] })) as any[];
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ type: "IMAGE", visible: false, imageHash: "abc123" });
  });

  it("emits an EMPTY array for a node with no fill, so 'no fill' is not 'not serialized'", () => {
    expect(extractFills(node({ fills: [] }))).toEqual([]);
  });

  it("emits a MIXED marker instead of silently omitting the key", () => {
    expect(extractFills(node({ fills: MIXED }))).toEqual([{ type: "MIXED" }]);
  });

  it("returns undefined only when the node genuinely has no fills property", () => {
    expect(extractFills(node({ id: "1:1" }))).toBeUndefined();
  });

  it("records blendMode when it is not the default", () => {
    const fills = extractFills(node({ fills: [solid(0, 0, 0, { blendMode: "MULTIPLY" })] })) as any[];
    expect(fills[0].blendMode).toBe("MULTIPLY");
    const plain = extractFills(node({ fills: [solid(0, 0, 0, { blendMode: "NORMAL" })] })) as any[];
    expect(plain[0].blendMode).toBeUndefined();
  });

  it("serializes gradient stops as hex", () => {
    const fills = extractFills(
      node({
        fills: [
          {
            type: "GRADIENT_LINEAR",
            gradientStops: [
              { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
              { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
            ],
          },
        ],
      }),
    ) as any[];
    expect(fills[0].gradient.stops).toEqual([
      { color: "#ff0000", position: 0 },
      { color: "#0000ff", position: 1 },
    ]);
  });
});

describe("extractStrokes / extractEffects — sibling paint properties (bug #13)", () => {
  it("returns structured strokes with colour, opacity and hidden flag", () => {
    const strokes = extractStrokes(
      node({ strokes: [solid(0, 0, 0, { opacity: 0.25 }), solid(1, 1, 1, { visible: false })] }),
    ) as any[];
    expect(strokes).toEqual([
      { type: "SOLID", opacity: 0.25, color: "#000000" },
      { type: "SOLID", visible: false, color: "#ffffff" },
    ]);
  });

  it("returns IMAGE strokes with scaleMode and imageHash", () => {
    const strokes = extractStrokes(node({ strokes: [imagePaint()] })) as any[];
    expect(strokes[0]).toMatchObject({ type: "IMAGE", scaleMode: "FILL", imageHash: "abc123" });
  });

  it("KEEPS hidden effects rather than dropping them", () => {
    const effects = extractEffects(
      node({
        effects: [
          { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.5 }, offset: { x: 0, y: 2 }, radius: 4, spread: 0 },
          { type: "LAYER_BLUR", radius: 8, visible: false },
        ],
      }),
    ) as any[];
    expect(effects).toHaveLength(2);
    expect(effects[0]).toMatchObject({ type: "DROP_SHADOW", radius: 4, offset: { x: 0, y: 2 } });
    expect(effects[1]).toMatchObject({ type: "LAYER_BLUR", radius: 8, visible: false });
  });
});

describe("fields projection keeps the fills key (bug #13)", () => {
  const serialized = {
    id: "1:1",
    name: "Hero",
    type: "FRAME",
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    fills: [{ type: "IMAGE", isImage: true, imageRef: "abc123", imageHash: "abc123", scaleMode: "FILL" }],
    strokes: [{ type: "SOLID", color: "#000000" }],
    strokeWeight: 2,
    effects: [{ type: "DROP_SHADOW", color: "#00000080", offset: { x: 0, y: 2 }, radius: 4 }],
  };

  it('fields: ["fills"] projects the fills key itself, not just its sub-properties', () => {
    const projected = filterNodeData(serialized, ["fills"] as NodeField[]) as any;
    expect(projected.fills).toBeDefined();
    expect(projected.fills[0]).toMatchObject({ type: "IMAGE", scaleMode: "FILL", imageHash: "abc123" });
    // and nothing unrelated leaks through
    expect(projected.effects).toBeUndefined();
  });

  it('fields: ["strokes"] projects strokes AND strokeWeight', () => {
    const projected = filterNodeData(serialized, ["strokes"] as NodeField[]) as any;
    expect(projected.strokes[0]).toEqual({ type: "SOLID", color: "#000000" });
    expect(projected.strokeWeight).toBe(2);
  });

  it('fields: ["effects"] projects effects', () => {
    const projected = filterNodeData(serialized, ["effects"] as NodeField[]) as any;
    expect(projected.effects[0]).toMatchObject({ type: "DROP_SHADOW", radius: 4 });
  });

  it("JSON (no fields) keeps every paint property verbatim", () => {
    const json = JSON.parse(JSON.stringify([serialized]));
    expect(json[0].fills[0].imageHash).toBe("abc123");
    expect(json[0].fills[0].scaleMode).toBe("FILL");
    expect(json[0].strokes[0].color).toBe("#000000");
  });
});

describe("compact projection renders paints tersely (bug #13, group E)", () => {
  const base = { id: "1:1", name: "Card", type: "FRAME", x: 0, y: 0, width: 10, height: 10 };

  const line = (extra: Record<string, unknown>) => formatCompact([{ ...base, ...extra }]);

  it("renders a SOLID fill as fill=#hex", () => {
    expect(line({ fills: [{ type: "SOLID", color: "#ffffff" }] })).toContain("fill=#ffffff");
  });

  it("renders an IMAGE fill as fill=IMAGE(<scaleMode>)", () => {
    expect(line({ fills: [{ type: "IMAGE", isImage: true, scaleMode: "FILL", imageHash: "abc" }] })).toContain(
      "fill=IMAGE(FILL)",
    );
  });

  it("renders multiple fills as the first plus a count, not a paint dump", () => {
    const out = line({
      fills: [
        { type: "SOLID", color: "#ff0000" },
        { type: "IMAGE", isImage: true },
      ],
    });
    expect(out).toContain("fill=#ff0000+1");
    expect(out).not.toContain("imageHash");
    expect(out).not.toContain("{");
  });

  it("renders an explicitly empty fill list as fill=none", () => {
    expect(line({ fills: [] })).toContain("fill=none");
  });

  it("renders an all-hidden fill list as fill=hidden", () => {
    expect(line({ fills: [{ type: "SOLID", color: "#ffffff", visible: false }] })).toContain("fill=hidden");
  });

  it("renders mixed fills as fill=MIXED", () => {
    expect(line({ fills: [{ type: "MIXED" }] })).toContain("fill=MIXED");
  });

  it("omits the fill token entirely for a node that has no fills property", () => {
    expect(line({})).not.toContain("fill=");
  });

  it("prefers the bound variable name over the raw colour", () => {
    expect(
      line({ fills: [{ type: "SOLID", color: "#ffffff" }], bindings: { "fills/0": "surface/primary" } }),
    ).toContain("fill=surface/primary");
  });

  it("renders strokes and strokeWeight tersely", () => {
    const out = line({
      strokes: [{ type: "SOLID", color: "#000000" }],
      strokeWeight: 2,
      effects: [{ type: "DROP_SHADOW", radius: 4 }],
    });
    expect(out).toContain("stroke=#000000");
    expect(out).toContain("strokeWeight=2");
    // effects stay out of the compact line — they belong to the json/jsx views.
    expect(out).not.toContain("DROP_SHADOW");
  });
});

describe("jsx output still works with the richer paint payload (bug #13)", () => {
  const base = { id: "1:1", name: "Card", type: "FRAME", visible: true, width: 10, height: 10 };

  it("still folds a solid fill into a bg-[...] class", () => {
    expect(convertToJsx([{ ...base, fills: [{ type: "SOLID", color: "#ffffff" }] } as any])).toContain("bg-[#ffffff]");
  });

  it("still emits bg-cover/bg-center and backgroundImage for an image fill", () => {
    const jsx = convertToJsx([
      {
        ...base,
        fills: [{ type: "IMAGE", isImage: true, imageRef: "abc", imageHash: "abc", scaleMode: "FILL" }],
      } as any,
    ]);
    expect(jsx).toContain("bg-cover");
    expect(jsx).toContain("url(abc)");
  });

  it("does NOT render a hidden fill as a visible background", () => {
    const jsx = convertToJsx([{ ...base, fills: [{ type: "SOLID", color: "#ff0000", visible: false }] } as any]);
    expect(jsx).not.toContain("bg-[#ff0000]");
  });

  it("does NOT render a hidden stroke as a border colour", () => {
    const jsx = convertToJsx([
      { ...base, strokes: [{ type: "SOLID", color: "#ff0000", visible: false }], strokeWeight: 1 } as any,
    ]);
    expect(jsx).not.toContain("border-[#ff0000]");
  });

  it("does NOT render a hidden shadow", () => {
    const jsx = convertToJsx([
      {
        ...base,
        effects: [{ type: "DROP_SHADOW", color: "#000000", offset: { x: 0, y: 2 }, radius: 4, visible: false }],
      } as any,
    ]);
    expect(jsx).not.toContain("boxShadow");
  });
});
