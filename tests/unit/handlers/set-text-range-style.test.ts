/// <reference types="@figma/plugin-typings" />
import { applyTextStyle, setTextRangeStyle } from "../../../src/videntia_figma_plugin/handlers/text";

type Font = { family: string; style: string };

const MIXED = Symbol("mixed");
const INTER: Font = { family: "Inter", style: "Regular" };
const LINK_VAR = { id: "VariableID:1:5", name: "text/link", resolvedType: "COLOR" };
const STRONG_STYLE = {
  id: "S:strong,",
  name: "Body/Strong",
  type: "TEXT",
  fontName: { family: "Inter", style: "Semi Bold" },
};

let loaded: Set<string>;
let unavailable: Set<string>;
let mutations: string[];
let fills: unknown[] | undefined;
let node: any;

const key = (f: Font) => `${f.family}::${f.style}`;

function requireLoaded(fonts: Font[]): void {
  for (const f of fonts) {
    if (!loaded.has(key(f))) throw new Error(`font not loaded: ${key(f)}`);
  }
}

/** TEXT node mock with per-character fonts; every range setter requires the affected fonts to be loaded. */
function makeTextNode(characters: string, fonts?: Font[]): any {
  const charFonts: Font[] = fonts ? fonts.map((f) => ({ ...f })) : Array.from(characters, () => ({ ...INTER }));
  const inRange = (s: number, e: number) => charFonts.slice(s, e);
  return {
    id: "1:1",
    type: "TEXT",
    name: "Sentence",
    characters,
    charFonts,
    getRangeFontName(s: number, e: number) {
      const slice = inRange(s, e);
      return slice.every((f) => key(f) === key(slice[0])) ? { ...slice[0] } : MIXED;
    },
    setRangeFontName(s: number, e: number, font: Font) {
      requireLoaded([...inRange(s, e), font]);
      for (let i = s; i < e; i++) charFonts[i] = { ...font };
      mutations.push(`fontName:${s}-${e}:${key(font)}`);
    },
    setRangeFontSize(s: number, e: number, value: number) {
      requireLoaded(inRange(s, e));
      mutations.push(`fontSize:${s}-${e}:${value}`);
    },
    setRangeFills(s: number, e: number, paints: unknown[]) {
      requireLoaded(inRange(s, e));
      fills = paints;
      mutations.push(`fills:${s}-${e}`);
    },
    setRangeTextDecoration(s: number, e: number, value: string) {
      requireLoaded(inRange(s, e));
      mutations.push(`textDecoration:${s}-${e}:${value}`);
    },
    setRangeLetterSpacing(s: number, e: number, value: unknown) {
      requireLoaded(inRange(s, e));
      mutations.push(`letterSpacing:${s}-${e}:${JSON.stringify(value)}`);
    },
    setRangeLineHeight(s: number, e: number, value: unknown) {
      requireLoaded(inRange(s, e));
      mutations.push(`lineHeight:${s}-${e}:${JSON.stringify(value)}`);
    },
    async setRangeTextStyleIdAsync(s: number, e: number, id: string) {
      requireLoaded([STRONG_STYLE.fontName]);
      for (let i = s; i < e; i++) charFonts[i] = { ...STRONG_STYLE.fontName };
      mutations.push(`textStyle:${s}-${e}:${id}`);
    },
    async setTextStyleIdAsync(id: string) {
      mutations.push(`nodeTextStyle:${id}`);
    },
  };
}

beforeEach(() => {
  loaded = new Set();
  unavailable = new Set();
  mutations = [];
  fills = undefined;
  node = makeTextNode("Hello world");
  (globalThis as any).figma = {
    mixed: MIXED,
    getNodeByIdAsync: jest.fn(async (id: string) => (node && node.id === id ? node : null)),
    loadFontAsync: jest.fn(async (font: Font) => {
      if (unavailable.has(key(font))) throw new Error("font unavailable");
      loaded.add(key(font));
    }),
    getStyleByIdAsync: jest.fn(async (id: string) => (id === STRONG_STYLE.id ? STRONG_STYLE : null)),
    getLocalTextStylesAsync: jest.fn(async () => [STRONG_STYLE]),
    variables: {
      getVariableByIdAsync: jest.fn(async (id: string) => (id === LINK_VAR.id ? LINK_VAR : null)),
      getLocalVariablesAsync: jest.fn(async () => [LINK_VAR]),
      setBoundVariableForPaint: jest.fn((paint: any, field: string, variable: any) => ({
        ...paint,
        boundVariables: { [field]: { type: "VARIABLE_ALIAS", id: variable.id } },
      })),
    },
  };
});

afterEach(() => {
  delete (globalThis as any).figma;
});

function run(ranges: unknown[]): Promise<any> {
  return setTextRangeStyle({ nodeId: "1:1", ranges });
}

describe("setTextRangeStyle", () => {
  it("applies a hex color with alpha as a solid range fill", async () => {
    const result = await run([{ start: 6, end: 11, color: "#ff000080" }]);

    expect(mutations).toEqual(["fills:6-11"]);
    expect(fills).toEqual([{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 128 / 255 }]);
    expect(result.ranges).toEqual([
      { start: 6, end: 11, characters: "world", applied: { color: { r: 1, g: 0, b: 0, a: 128 / 255 } } },
    ]);
  });

  it("applies an RGBA object color", async () => {
    await run([{ start: 0, end: 5, color: { r: 0, g: 0.5, b: 1 } }]);
    expect(fills).toEqual([{ type: "SOLID", color: { r: 0, g: 0.5, b: 1 }, opacity: 1 }]);
  });

  it.each([
    ["name", "text/link"],
    ["dash name", "text-link"],
    ["id", LINK_VAR.id],
  ])("binds a color variable by %s", async (_label, ref) => {
    const result = await run([{ start: 6, end: 11, colorVariable: ref }]);

    expect((globalThis as any).figma.variables.setBoundVariableForPaint).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SOLID" }),
      "color",
      LINK_VAR,
    );
    expect(fills).toEqual([
      expect.objectContaining({ boundVariables: { color: { type: "VARIABLE_ALIAS", id: LINK_VAR.id } } }),
    ]);
    expect(result.ranges[0].applied).toEqual({ colorVariable: { id: LINK_VAR.id, name: "text/link" } });
  });

  it("resolves fontWeight to a style name and keeps the run's family", async () => {
    const result = await run([{ start: 0, end: 5, fontWeight: 700 }]);

    expect(mutations).toEqual(["fontName:0-5:Inter::Bold"]);
    expect(node.charFonts[0]).toEqual({ family: "Inter", style: "Bold" });
    expect(node.charFonts[6]).toEqual(INTER);
    expect(result.ranges[0].applied).toEqual({ fontName: { family: "Inter", style: "Bold" } });
  });

  it("prefers fontStyle over fontWeight and applies fontFamily", async () => {
    await run([{ start: 0, end: 5, fontFamily: "Roboto", fontStyle: "Italic", fontWeight: 700 }]);
    expect(mutations).toEqual(["fontName:0-5:Roboto::Italic"]);
  });

  it("loads every existing font in a mixed range and restyles each run", async () => {
    const roboto: Font = { family: "Roboto", style: "Regular" };
    node = makeTextNode("Hello world", [...Array(6).fill(INTER), ...Array(5).fill(roboto)]);

    const result = await run([{ start: 0, end: 11, fontWeight: 600, color: "#000" }]);

    expect(loaded).toEqual(new Set(["Inter::Regular", "Roboto::Regular", "Inter::Semi Bold", "Roboto::Semi Bold"]));
    expect(mutations).toEqual(["fontName:0-6:Inter::Semi Bold", "fontName:6-11:Roboto::Semi Bold", "fills:0-11"]);
    expect(result.ranges[0].applied.fontName).toEqual([
      { family: "Inter", style: "Semi Bold" },
      { family: "Roboto", style: "Semi Bold" },
    ]);
  });

  it("applies a text style by name before explicit overrides", async () => {
    const result = await run([{ start: 0, end: 5, textStyle: "Body/Strong", fontSize: 18 }]);

    expect(loaded.has("Inter::Semi Bold")).toBe(true);
    expect(mutations).toEqual(["textStyle:0-5:S:strong,", "fontSize:0-5:18"]);
    expect(result.ranges[0].applied).toEqual({
      textStyle: { id: STRONG_STYLE.id, name: "Body/Strong" },
      fontSize: 18,
    });
  });

  it("applies decoration, letter spacing and line height", async () => {
    await run([
      { start: 6, end: 11, textDecoration: "UNDERLINE", letterSpacing: 1.5, lineHeight: "AUTO" },
      { start: 0, end: 5, letterSpacing: { value: 4, unit: "PERCENT" }, lineHeight: { value: 150, unit: "PERCENT" } },
    ]);

    expect(mutations).toEqual([
      "textDecoration:6-11:UNDERLINE",
      'letterSpacing:6-11:{"value":1.5,"unit":"PIXELS"}',
      'lineHeight:6-11:{"unit":"AUTO"}',
      'letterSpacing:0-5:{"value":4,"unit":"PERCENT"}',
      'lineHeight:0-5:{"value":150,"unit":"PERCENT"}',
    ]);
  });

  describe("validation happens before any mutation", () => {
    it.each<[string, unknown[], string]>([
      ["end past text length", [{ start: 6, end: 12, color: "#000" }], "ranges[0]: invalid range [6, 12)"],
      ["start equal to end", [{ start: 3, end: 3, color: "#000" }], "0 <= start < end <= 11"],
      ["negative start", [{ start: -1, end: 3, color: "#000" }], "invalid range"],
      ["non-integer bounds", [{ start: 0.5, end: 3, color: "#000" }], "invalid range"],
      ["no style properties", [{ start: 0, end: 3 }], "ranges[0] sets no style"],
      [
        "second range invalid",
        [
          { start: 0, end: 5, color: "#000" },
          { start: 4, end: 20, fontWeight: 700 },
        ],
        "ranges[1]: invalid range",
      ],
      ["color and colorVariable", [{ start: 0, end: 5, color: "#000", colorVariable: "text/link" }], "not both"],
      ["invalid hex", [{ start: 0, end: 5, color: "#zz" }], "ranges[0].color: Invalid hex color"],
      ["unknown variable", [{ start: 0, end: 5, colorVariable: "text/missing" }], "COLOR variable not found"],
      ["unknown text style", [{ start: 0, end: 5, textStyle: "Heading/9" }], "text style not found"],
      ["unsupported weight", [{ start: 0, end: 5, fontWeight: 650 }], "fontWeight must be one of"],
      ["invalid decoration", [{ start: 0, end: 5, textDecoration: "OVERLINE" }], "textDecoration must be one of"],
      ["invalid spacing unit", [{ start: 0, end: 5, letterSpacing: { value: 1, unit: "EM" } }], "PIXELS or PERCENT"],
    ])("rejects %s", async (_label, ranges, message) => {
      await expect(run(ranges)).rejects.toThrow(message);
      expect(mutations).toEqual([]);
      expect(fills).toBeUndefined();
    });

    it("rejects an unavailable font without mutating", async () => {
      unavailable.add("Nope::Regular");
      await expect(
        run([
          { start: 0, end: 5, color: "#000" },
          { start: 6, end: 11, fontFamily: "Nope" },
        ]),
      ).rejects.toThrow('Font "Nope Regular" could not be loaded');
      expect(mutations).toEqual([]);
    });

    it("rejects non-text nodes and empty ranges", async () => {
      node = { ...makeTextNode("Hi"), type: "FRAME" };
      await expect(run([{ start: 0, end: 1, color: "#000" }])).rejects.toThrow("Node is not a text node");
      await expect(run([])).rejects.toThrow("ranges must be a non-empty array");
      await expect(setTextRangeStyle({ nodeId: "9:9", ranges: [{ start: 0, end: 1, color: "#000" }] })).rejects.toThrow(
        "Node not found",
      );
    });
  });
});

describe("applyTextStyle (shared style lookup)", () => {
  it("still resolves a text style by dashed name", async () => {
    const result = await applyTextStyle({ nodeId: "1:1", styleId: "Body-Strong" });
    expect(result).toEqual({ nodeName: "Sentence", styleName: "Body/Strong" });
    expect(mutations).toEqual(["nodeTextStyle:S:strong,"]);
  });
});
