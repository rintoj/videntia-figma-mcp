import { loadFontAsyncWrapper } from "../../../src/videntia_figma_plugin/handlers/text";

/**
 * Bug #37: `load_font_async` surfaced "Error loading font: undefined" (3x in one
 * session) because Figma rejects with a bare object whose `.message` is
 * undefined. The failure must name the family, the requested style, the
 * spellings tried, and the styles that actually exist.
 */
const withFigma = (loadable: string[], available: Array<{ family: string; style: string }>) => {
  (globalThis as any).figma = {
    loadFontAsync: async ({ family, style }: { family: string; style: string }) => {
      if (loadable.indexOf(style) === -1) {
        // Figma's real rejection shape: no `message` property at all.
        throw { toString: () => "[object Object]" };
      }
      return undefined;
    },
    listAvailableFontsAsync: async () => available.map((f) => ({ fontName: f })),
  };
};

afterEach(() => {
  delete (globalThis as any).figma;
});

describe("load_font_async diagnostics", () => {
  it("never reports 'undefined' and names family, style and available styles", async () => {
    withFigma(
      [],
      [
        { family: "Inter", style: "Regular" },
        { family: "Inter", style: "Semi Bold" },
        { family: "Roboto", style: "Bold" },
      ],
    );

    await expect(loadFontAsyncWrapper({ family: "Inter", style: "Ultra Wide" })).rejects.toThrow(
      /Error loading font: font "Inter" has no style matching "Ultra Wide"/,
    );

    let message = "";
    try {
      await loadFontAsyncWrapper({ family: "Inter", style: "Ultra Wide" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain("undefined");
    expect(message).toContain('Available styles for "Inter": Regular, Semi Bold.');
  });

  it("says the family could not be listed when no styles exist for it", async () => {
    withFigma([], [{ family: "Roboto", style: "Bold" }]);
    let message = "";
    try {
      await loadFontAsyncWrapper({ family: "Notafont", style: "Regular" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('No styles could be listed for "Notafont"');
    expect(message).not.toContain("undefined");
  });

  it("resolves alternate face spellings and reports the style that loaded", async () => {
    withFigma(["Semi Bold"], [{ family: "Inter", style: "Semi Bold" }]);
    const result = await loadFontAsyncWrapper({ family: "Inter", style: "SemiBold" });
    expect(result.success).toBe(true);
    expect(result.style).toBe("Semi Bold");
    expect(result.requestedStyle).toBe("SemiBold");
  });

  it("still rejects a missing family up front", async () => {
    withFigma([], []);
    await expect(loadFontAsyncWrapper({})).rejects.toThrow("Missing font family");
  });
});
