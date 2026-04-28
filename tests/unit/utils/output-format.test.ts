import { resolveDepth } from "../../../src/hgraph_figma_mcp/utils/output-format";

describe("resolveDepth", () => {
  it("returns undefined for 'all'", () => {
    expect(resolveDepth("all")).toBeUndefined();
  });

  it("returns 1 for undefined (default)", () => {
    expect(resolveDepth(undefined)).toBe(1);
  });

  it("returns 0 for 0", () => {
    expect(resolveDepth(0)).toBe(0);
  });

  it("returns the number as-is for positive integers", () => {
    expect(resolveDepth(3)).toBe(3);
    expect(resolveDepth(10)).toBe(10);
  });
});
