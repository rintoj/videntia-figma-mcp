import { sanitizeResult } from "../../../src/videntia_figma_plugin/handlers/batch";

describe("sanitizeResult", () => {
  it("passes plain JSON through unchanged", () => {
    const value = { id: "1:2", name: "Card", nested: { n: 1, ok: true, list: ["a", "b"] } };
    expect(sanitizeResult(value)).toEqual(value);
  });

  it("replaces Symbols (figma.mixed) with MIXED — the 'Cannot unwrap symbol' cause", () => {
    const mixed = Symbol("figma.mixed");
    expect(sanitizeResult(mixed)).toBe("MIXED");
    expect(sanitizeResult({ cornerRadius: mixed, id: "1:2" })).toEqual({ cornerRadius: "MIXED", id: "1:2" });
    expect(sanitizeResult([mixed, 4])).toEqual(["MIXED", 4]);
  });

  it("drops functions", () => {
    expect(sanitizeResult({ id: "1:2", remove: () => undefined, name: "n" })).toEqual({ id: "1:2", name: "n" });
  });

  it("reduces a live Figma node proxy to an id reference", () => {
    const node = { id: "1:2", name: "Frame", type: "FRAME", remove: () => undefined, parent: {} };
    expect(sanitizeResult({ node })).toEqual({ node: { id: "1:2", name: "Frame", type: "FRAME" } });
  });

  it("stringifies bigint and nulls non-finite numbers", () => {
    expect(sanitizeResult({ big: BigInt(5), inf: Infinity, nan: NaN })).toEqual({
      big: "5",
      inf: null,
      nan: null,
    });
  });

  it("preserves null and undefined", () => {
    expect(sanitizeResult(null)).toBeNull();
    expect(sanitizeResult(undefined)).toBeUndefined();
  });

  it("caps recursion depth instead of blowing the stack on cycles", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => JSON.stringify(sanitizeResult(a))).not.toThrow();
  });

  it("result stays structured-cloneable end to end", () => {
    const dirty = { id: "1:2", fontSize: Symbol("mixed"), fills: [{ type: "SOLID", opacity: 1 }] };
    expect(() => JSON.stringify(sanitizeResult(dirty))).not.toThrow();
  });
});
