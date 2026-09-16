import {
  applyWrites,
  mergeWriteResults,
  isStrictModeEnabled,
  resolveStrict,
  setStrictModeEnabled,
  withWriteReport,
} from "../../../src/videntia_figma_plugin/utils/write-verify";

/**
 * Stand-in for a Figma node whose property writes may be silently discarded.
 * `readonlyProps` models the runtime behaviour we are guarding against: the
 * assignment is accepted without error but the stored value never changes.
 */
function makeNode(props: Record<string, unknown>, readonlyProps: string[] = []): any {
  const store: Record<string, unknown> = { ...props };
  return new Proxy(
    { name: "Node" },
    {
      has: (_t, key) => key === "name" || key in store,
      get: (_t, key: string) => (key === "name" ? "Node" : store[key]),
      set: (_t, key: string, value: unknown) => {
        if (readonlyProps.indexOf(key) === -1) store[key] = value;
        return true;
      },
    },
  );
}

afterEach(() => setStrictModeEnabled(false));

describe("applyWrites", () => {
  it("reports writes that land as applied", () => {
    const node = makeNode({ paddingTop: 0, paddingLeft: 0 });
    const report = applyWrites(node, { paddingTop: 16, paddingLeft: 8 }, { label: "set_padding" });

    expect(report.applied).toEqual(["paddingTop", "paddingLeft"]);
    expect(report.noops).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(node.paddingTop).toBe(16);
  });

  it("detects a silently discarded write and names the property and both values", () => {
    const node = makeNode({ itemSpacing: 0 }, ["itemSpacing"]);
    const report = applyWrites(node, { itemSpacing: 24 }, { label: "set_item_spacing" });

    expect(report.applied).toEqual([]);
    expect(report.noops).toEqual([{ property: "itemSpacing", requested: 24, actual: 0 }]);
    expect(report.warnings[0]).toContain("set_item_spacing");
    expect(report.warnings[0]).toContain("itemSpacing");
    expect(report.warnings[0]).toContain("24");
  });

  it("throws in strict mode instead of reporting the no-op", () => {
    const node = makeNode({ itemSpacing: 0 }, ["itemSpacing"]);
    expect(() => applyWrites(node, { itemSpacing: 24 }, { label: "set_item_spacing", strict: true })).toThrow(
      /did not take effect/,
    );
  });

  it("does not throw in strict mode when every write lands", () => {
    const node = makeNode({ itemSpacing: 0 });
    expect(() => applyWrites(node, { itemSpacing: 24 }, { strict: true })).not.toThrow();
  });

  it("skips undefined values so an omitted argument is never written", () => {
    const node = makeNode({ paddingTop: 4, paddingLeft: 4 });
    const report = applyWrites(node, { paddingTop: 16, paddingLeft: undefined });

    expect(report.applied).toEqual(["paddingTop"]);
    expect(node.paddingLeft).toBe(4);
  });

  it("skips properties the node does not expose", () => {
    const node = makeNode({ paddingTop: 0 });
    const report = applyWrites(node, { gridRowGap: 10 });

    expect(report.applied).toEqual([]);
    expect(report.noops).toEqual([]);
  });

  it("tolerates float representation drift but not real differences", () => {
    const node = makeNode({ itemSpacing: 0 });
    const report = applyWrites(node, { itemSpacing: 12.00005 });
    expect(report.noops).toEqual([]);

    const clamped = makeNode({ itemSpacing: 0 }, ["itemSpacing"]);
    expect(applyWrites(clamped, { itemSpacing: 12 }).noops).toHaveLength(1);
  });

  it("appends the hint to the warning when one is given", () => {
    const node = makeNode({ layoutSizingHorizontal: "FIXED" }, ["layoutSizingHorizontal"]);
    const report = applyWrites(node, { layoutSizingHorizontal: "HUG" }, { hint: "Parent has no auto layout." });
    expect(report.warnings[0]).toContain("Parent has no auto layout.");
  });
});

describe("strict mode toggle", () => {
  it("defaults to off", () => {
    expect(isStrictModeEnabled()).toBe(false);
    expect(resolveStrict({})).toBe(false);
  });

  it("follows the global toggle", () => {
    setStrictModeEnabled(true);
    expect(isStrictModeEnabled()).toBe(true);
    expect(resolveStrict({})).toBe(true);
    expect(resolveStrict(undefined)).toBe(true);
  });

  it("lets a per-command strict param override the global toggle in both directions", () => {
    setStrictModeEnabled(true);
    expect(resolveStrict({ strict: false })).toBe(false);
    setStrictModeEnabled(false);
    expect(resolveStrict({ strict: true })).toBe(true);
    expect(resolveStrict({ strict: "true" })).toBe(true);
  });

  it("ignores a null strict param", () => {
    setStrictModeEnabled(true);
    expect(resolveStrict({ strict: null })).toBe(true);
  });
});

describe("withWriteReport", () => {
  it("marks success true when nothing was discarded", () => {
    const result = withWriteReport({ nodeId: "1" }, { applied: ["paddingTop"], noops: [], warnings: [] });
    expect(result["success"]).toBe(true);
    expect(result["warnings"]).toBeUndefined();
  });

  it("marks success false and surfaces warnings when a write was discarded", () => {
    const result = withWriteReport(
      { nodeId: "1" },
      { applied: [], noops: [{ property: "itemSpacing", requested: 24, actual: 0 }], warnings: ["nope"] },
    );
    expect(result["success"]).toBe(false);
    expect(result["warnings"]).toEqual(["nope"]);
    expect(result["noops"]).toHaveLength(1);
  });
});

describe("mergeWriteResults", () => {
  it("concatenates applied, noops and warnings across phases", () => {
    const merged = mergeWriteResults(
      { applied: ["a"], noops: [], warnings: [] },
      { applied: [], noops: [{ property: "b", requested: 1, actual: 0 }], warnings: ["w"] },
    );
    expect(merged.applied).toEqual(["a"]);
    expect(merged.noops).toHaveLength(1);
    expect(merged.warnings).toEqual(["w"]);
  });
});
