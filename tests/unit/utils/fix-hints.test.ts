import { suggestFix } from "../../../src/videntia_figma_mcp/utils/fix-hints";
import type { CompareRow } from "../../../src/videntia_figma_mcp/utils/normalize-style";

const row = (over: Partial<CompareRow>): CompareRow => ({
  property: "gap",
  figma: "24px",
  browser: "32px",
  status: "❌",
  ...over,
});

describe("suggestFix", () => {
  it("returns undefined for non-mismatch rows", () => {
    expect(suggestFix(row({ status: "✓" }))).toBeUndefined();
    expect(suggestFix(row({ status: "—" }))).toBeUndefined();
  });

  it("names the exact Tailwind class swap when the current class is present", () => {
    const hint = suggestFix(row({ property: "gap", figma: "24px", browser: "32px" }), {
      className: "flex flex-col items-center gap-8",
    });
    expect(hint).toBe("change gap-8 → gap-6 (Figma 24px)");
  });

  it("falls back to a generic instruction when the class is absent", () => {
    const hint = suggestFix(row({ property: "gap", figma: "24px", browser: "32px" }), { className: "flex" });
    expect(hint).toBe("set gap to 24px (e.g. gap-6)");
  });

  it("uses an arbitrary-value class for off-scale spacing", () => {
    const hint = suggestFix(row({ property: "padding-left", figma: "18px", browser: "16px" }), {
      className: "pl-4",
    });
    expect(hint).toBe("change pl-4 → pl-[18px] (Figma 18px)");
  });

  it("maps font sizes to the Tailwind type scale", () => {
    const hint = suggestFix(row({ property: "font-size", figma: "48px", browser: "36px" }), {
      className: "text-4xl font-sans",
    });
    expect(hint).toBe("change text-4xl → text-5xl (Figma 48px)");
  });

  it("emits token-grounded color hints", () => {
    const hint = suggestFix(row({ property: "border-color", figma: "gold-200 (#d0ccc4)", browser: "#e2e1df" }));
    expect(hint).toBe("set border-color to #d0ccc4 (e.g. border-gold-200)");
  });

  it("emits plain color hints without a token", () => {
    const hint = suggestFix(row({ property: "color", figma: "#083b38", browser: "#000000" }));
    expect(hint).toBe("set color to #083b38");
  });

  it("maps border-radius to the Tailwind radius scale including full", () => {
    expect(suggestFix(row({ property: "border-radius", figma: "999px", browser: "0px" }))).toBe(
      "set border-radius to 999px (e.g. rounded-full)",
    );
    expect(
      suggestFix(row({ property: "border-radius", figma: "8px", browser: "0px" }), { className: "rounded-sm" }),
    ).toBe("change rounded-sm → rounded-lg (Figma 8px)");
  });

  it("suggests flexbox utilities for layout rows", () => {
    expect(suggestFix(row({ property: "justify-content", figma: "center", browser: "flex-start" }))).toBe(
      "set justify-content to center (e.g. justify-center)",
    );
    expect(suggestFix(row({ property: "align-items", figma: "center", browser: "stretch" }))).toBe(
      "set align-items to center (e.g. items-center)",
    );
    expect(suggestFix(row({ property: "layout-mode", figma: "flex column", browser: "flex row" }))).toMatch(/flex-col/);
    expect(suggestFix(row({ property: "flex-wrap", figma: "wrap", browser: "nowrap" }))).toMatch(/flex-wrap/);
  });

  it("returns undefined for unknown properties", () => {
    expect(suggestFix(row({ property: "backdrop-filter", figma: "blur(8px)", browser: "none" }))).toBeUndefined();
  });
});
