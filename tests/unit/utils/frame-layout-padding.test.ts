import {
  expandPadding,
  paddingShorthandSchema,
  resolveFrameLayout,
} from "../../../src/videntia_figma_mcp/utils/frame-layout";

/**
 * One padding dialect, shared by every tool that takes a `padding` parameter.
 * A second dialect is how `set_auto_layout({ padding: 20 })` came to be accepted
 * and silently ignored.
 */
describe("expandPadding", () => {
  it("expands a number to all four sides", () => {
    expect(expandPadding(20)).toEqual({ top: 20, right: 20, bottom: 20, left: 20 });
  });

  it("expands CSS-style arrays", () => {
    expect(expandPadding([8])).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
    expect(expandPadding([4, 8])).toEqual({ top: 4, right: 8, bottom: 4, left: 8 });
    expect(expandPadding([1, 2, 3])).toEqual({ top: 1, right: 2, bottom: 3, left: 2 });
    expect(expandPadding([1, 2, 3, 4])).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
  });

  it("expands the object forms", () => {
    expect(expandPadding({ vertical: 6, horizontal: 12 })).toEqual({ top: 6, right: 12, bottom: 6, left: 12 });
    expect(expandPadding({ top: 1, left: 2 })).toEqual({ top: 1, right: undefined, bottom: undefined, left: 2 });
  });

  it("returns undefined for nothing", () => {
    expect(expandPadding(undefined)).toBeUndefined();
    expect(expandPadding([])).toBeUndefined();
  });
});

describe("paddingShorthandSchema", () => {
  it("accepts every form of the dialect and rejects junk", () => {
    expect(paddingShorthandSchema.safeParse(20).success).toBe(true);
    expect(paddingShorthandSchema.safeParse([4, 8]).success).toBe(true);
    expect(paddingShorthandSchema.safeParse({ vertical: 4 }).success).toBe(true);
    expect(paddingShorthandSchema.safeParse([1, 2, 3, 4, 5]).success).toBe(false);
    expect(paddingShorthandSchema.safeParse("wide").success).toBe(false);
  });
});

describe("resolveFrameLayout padding precedence", () => {
  it("lets explicit per-side params win over the shorthand", () => {
    const resolved = resolveFrameLayout({ padding: [10, 20], top: 0, paddingRight: 2 });
    expect(resolved.paddingTop).toBe(0);
    expect(resolved.paddingRight).toBe(2);
    expect(resolved.paddingBottom).toBe(10);
    expect(resolved.paddingLeft).toBe(20);
  });
});
