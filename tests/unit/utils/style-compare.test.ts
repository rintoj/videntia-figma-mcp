import { compareStyles } from "../../../src/videntia_figma_mcp/utils/style-compare.js";

describe("compareStyles", () => {
  it("returns no deviations when styles match", () => {
    const figmaStyles = { fontSize: "16px", color: "rgba(0, 0, 0, 1)" };
    const computedStyles = { fontSize: "16px", color: "rgba(0, 0, 0, 1)" };
    const result = compareStyles(figmaStyles, computedStyles);
    expect(result).toHaveLength(0);
  });

  it("returns deviation when values differ", () => {
    const figmaStyles = { fontSize: "16px" };
    const computedStyles = { fontSize: "15px" };
    const result = compareStyles(figmaStyles, computedStyles);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ property: "fontSize", figma: "16px", actual: "15px" });
  });
});
