import {
  clearFontStyleCache,
  fontStyleCandidates,
  matchFontStyle,
  matchFontWeight,
  parseFontStyle,
  resolveAndLoadFontStyle,
  styleNameForWeight,
} from "../../../src/videntia_figma_plugin/utils/font-style";

const GENERAL_SANS = [
  "Extralight",
  "Extralight Italic",
  "Light",
  "Regular",
  "Italic",
  "Medium",
  "Semibold",
  "Semibold Italic",
  "Bold",
  "Bold Italic",
];

describe("matchFontStyle (pure)", () => {
  it("maps weight 600 onto every family spelling of Semi Bold", () => {
    expect(matchFontWeight(600, GENERAL_SANS)).toBe("Semibold");
    expect(matchFontWeight(600, ["Regular", "SemiBold"])).toBe("SemiBold");
    expect(matchFontWeight(600, ["Regular", "Semi Bold"])).toBe("Semi Bold");
    expect(matchFontWeight(600, ["Regular", "DemiBold"])).toBe("DemiBold");
    expect(matchFontWeight(600, ["Regular", "Demi Bold"])).toBe("Demi Bold");
  });

  it("matches case and spacing insensitively before falling back to synonyms", () => {
    expect(matchFontStyle("semi bold", GENERAL_SANS)).toBe("Semibold");
    expect(matchFontStyle("SEMIBOLD", GENERAL_SANS)).toBe("Semibold");
    expect(matchFontStyle("Extra-Light", GENERAL_SANS)).toBe("Extralight");
  });

  it("resolves weight synonyms", () => {
    expect(matchFontWeight(800, ["Bold", "UltraBold"])).toBe("UltraBold");
    expect(matchFontWeight(800, ["Extra Bold"])).toBe("Extra Bold");
    expect(matchFontWeight(200, ["UltraLight"])).toBe("UltraLight");
    expect(matchFontWeight(400, ["Book", "Bold"])).toBe("Book");
    expect(matchFontWeight(400, ["Normal"])).toBe("Normal");
    expect(matchFontWeight(900, ["Heavy"])).toBe("Heavy");
    expect(matchFontWeight(100, ["Hairline"])).toBe("Hairline");
    expect(matchFontStyle("Heavy", ["Black"])).toBe("Black");
  });

  it("prefers the canonical spelling when a family ships two synonyms", () => {
    expect(matchFontWeight(900, ["Heavy", "Black"])).toBe("Black");
    expect(matchFontStyle("Heavy", ["Heavy", "Black"])).toBe("Heavy");
  });

  it("keeps italic and upright faces apart", () => {
    expect(matchFontWeight(600, GENERAL_SANS, true)).toBe("Semibold Italic");
    expect(matchFontStyle("Italic", GENERAL_SANS)).toBe("Italic");
    expect(matchFontStyle("Regular Italic", GENERAL_SANS)).toBe("Italic");
    expect(matchFontStyle("SemiBold Italic", GENERAL_SANS)).toBe("Semibold Italic");
    expect(matchFontStyle("Bold Oblique", ["Bold", "Bold Italic"])).toBe("Bold Italic");
    expect(matchFontWeight(700, ["Bold Italic"])).toBeUndefined();
  });

  it("returns undefined when the family has no such face", () => {
    expect(matchFontWeight(900, GENERAL_SANS)).toBeUndefined();
    expect(matchFontStyle("Condensed Bold", GENERAL_SANS)).toBeUndefined();
    expect(matchFontStyle("Condensed Bold", ["Condensed Bold"])).toBe("Condensed Bold");
  });

  it("parses and names weights", () => {
    expect(parseFontStyle("Semi Bold Italic")).toEqual({ weight: 600, italic: true });
    expect(parseFontStyle("Italic")).toEqual({ weight: 400, italic: true });
    expect(parseFontStyle("Condensed")).toBeUndefined();
    expect(styleNameForWeight(600)).toBe("Semi Bold");
    expect(styleNameForWeight(400, true)).toBe("Italic");
    expect(styleNameForWeight(650)).toBe("Bold");
    expect(styleNameForWeight(1000)).toBe("Black");
  });

  it("fontStyleCandidates includes the Title-case compact spelling", () => {
    expect(fontStyleCandidates("Semi Bold")).toEqual(expect.arrayContaining(["Semi Bold", "SemiBold", "Semibold"]));
  });
});

describe("resolveAndLoadFontStyle", () => {
  let listCalls: number;
  const install = (fonts: Array<{ family: string; style: string }>, loadable?: string[]) => {
    listCalls = 0;
    (globalThis as any).figma = {
      loadFontAsync: jest.fn(async ({ family, style }: { family: string; style: string }) => {
        const ok = loadable ? loadable.includes(style) : fonts.some((f) => f.family === family && f.style === style);
        if (!ok) throw new Error(`cannot load ${family} ${style}`);
      }),
      listAvailableFontsAsync: jest.fn(async () => {
        listCalls++;
        return fonts.map((fontName) => ({ fontName }));
      }),
    };
  };

  beforeEach(() => clearFontStyleCache());
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("loads General Sans Semibold for a Semi Bold request on the first try", async () => {
    install(GENERAL_SANS.map((style) => ({ family: "General Sans", style })));
    await expect(resolveAndLoadFontStyle("General Sans", "Semi Bold", "test")).resolves.toBe("Semibold");
    expect((globalThis as any).figma.loadFontAsync).toHaveBeenCalledTimes(1);
  });

  it("reads the font list once per session", async () => {
    install(GENERAL_SANS.map((style) => ({ family: "General Sans", style })));
    await resolveAndLoadFontStyle("General Sans", "Bold", "test");
    await resolveAndLoadFontStyle("General Sans", "Medium", "test");
    expect(listCalls).toBe(1);
  });

  it("falls back to spelling candidates when the font list is unavailable", async () => {
    (globalThis as any).figma = {
      loadFontAsync: jest.fn(async ({ style }: { style: string }) => {
        if (style !== "SemiBold") throw new Error("nope");
      }),
    };
    await expect(resolveAndLoadFontStyle("Inter", "Semi Bold", "test")).resolves.toBe("SemiBold");
  });

  it("names the available styles when nothing matches", async () => {
    install(GENERAL_SANS.map((style) => ({ family: "General Sans", style })));
    await expect(resolveAndLoadFontStyle("General Sans", "Black", "create_text")).rejects.toThrow(
      /create_text: font "General Sans" has no style matching "Black".*Available styles for "General Sans": Extralight/,
    );
  });
});
