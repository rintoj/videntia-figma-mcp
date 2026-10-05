import { setFontName, setFontWeight } from "../../../src/videntia_figma_plugin/handlers/text";
import { clearFontStyleCache } from "../../../src/videntia_figma_plugin/utils/font-style";

const STYLES = ["Regular", "Medium", "Semibold", "Semibold Italic", "Bold"];

describe("text handlers resolve weights against the family's real style names", () => {
  let node: any;
  let loaded: string[];

  beforeEach(() => {
    clearFontStyleCache();
    loaded = [];
    node = { id: "1:2", name: "Label", type: "TEXT", fontName: { family: "General Sans", style: "Regular" } };
    (globalThis as any).figma = {
      mixed: Symbol("mixed"),
      getNodeByIdAsync: jest.fn(async () => node),
      loadFontAsync: jest.fn(async ({ family, style }: { family: string; style: string }) => {
        if (family !== "General Sans" || !STYLES.includes(style)) throw new Error(`no ${family} ${style}`);
        loaded.push(style);
      }),
      listAvailableFontsAsync: jest.fn(async () =>
        STYLES.map((style) => ({ fontName: { family: "General Sans", style } })),
      ),
    };
  });

  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("set_font_weight 600 picks General Sans 'Semibold'", async () => {
    const result = await setFontWeight({ nodeId: "1:2", weight: 600 });
    expect(node.fontName).toEqual({ family: "General Sans", style: "Semibold" });
    expect(result.fontName).toEqual({ family: "General Sans", style: "Semibold" });
    expect(loaded).toEqual(["Semibold"]);
  });

  it("set_font_name maps 'Semi Bold Italic' onto 'Semibold Italic'", async () => {
    const result = await setFontName({ nodeId: "1:2", family: "General Sans", style: "Semi Bold Italic" });
    expect(result.resolvedStyle).toBe("Semibold Italic");
  });

  it("still fails loudly for a weight the family does not ship", async () => {
    await expect(setFontWeight({ nodeId: "1:2", weight: 900 })).rejects.toThrow(
      /no style matching "Black".*Available styles for "General Sans"/,
    );
  });
});
