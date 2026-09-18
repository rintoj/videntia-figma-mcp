import {
  PURE_BATCH_ACTIONS,
  computePureAction,
  isPureAction,
  nonBatchableReason,
} from "../../../src/videntia_figma_mcp/utils/pure-batch-actions";
import { mergeServerSideResults } from "../../../src/videntia_figma_mcp/tools/batch-tools";
import { isGradientFullyBound } from "../../../src/videntia_figma_plugin/handlers/lint/helpers";

describe("pure batch actions (#16)", () => {
  it("classifies every pure computation tool as batchable", () => {
    for (const name of PURE_BATCH_ACTIONS) {
      expect(isPureAction(name)).toBe(true);
      expect(nonBatchableReason(name)).toBeUndefined();
    }
  });

  it("computes a composite colour with the documented blend formula", () => {
    // 50% of black over white = mid grey.
    const result = computePureAction("calculate_composite_color", {
      base: "#000000",
      background: "#ffffff",
      mixPercentage: 0.5,
    }) as { hex: string; color: { r: number } };
    expect(result.color.r).toBeCloseTo(0.5, 5);
    expect(result.hex.toLowerCase()).toBe("#808080");
  });

  it("rejects an out-of-range mixPercentage instead of producing NaN", () => {
    expect(() =>
      computePureAction("calculate_composite_color", { base: "#000", background: "#fff", mixPercentage: 5 }),
    ).toThrow(/mixPercentage must be a number 0–1/);
  });

  it("produces a 10-level scale whose 900 is nearest the base colour", () => {
    const result = computePureAction("calculate_color_scale", {
      baseColor: "#000000",
      backgroundColor: "#ffffff",
    }) as { scale: Record<string, { color: { r: number } }> };
    expect(Object.keys(result.scale)).toHaveLength(10);
    expect(result.scale["900"].color.r).toBeCloseTo(0.1, 5);
    expect(result.scale["50"].color.r).toBeCloseTo(0.95, 5);
  });

  it("computes WCAG contrast for black on white as 21:1", () => {
    const result = computePureAction("calculate_contrast_ratio", {
      foreground: "#000000",
      background: "#ffffff",
    }) as { ratio: number; compliance: { aaa_normal: boolean } };
    expect(result.ratio).toBe(21);
    expect(result.compliance.aaa_normal).toBe(true);
  });

  it("evaluates many contrast pairs and counts AA failures", () => {
    const result = computePureAction("calculate_contrast_ratios", {
      pairs: [
        { label: "ok", foreground: "#000000", background: "#ffffff" },
        { label: "bad", foreground: "#ffffff", background: "#ffffff" },
      ],
    }) as { rows: Array<{ ratio: number }>; failures: number };
    expect(result.rows.map((r) => r.ratio)).toEqual([21, 1]);
    expect(result.failures).toBe(1);
  });

  it("converts rgb255 input to hex", () => {
    const result = computePureAction("convert_color_format", {
      color: { r: 255, g: 0, b: 0 },
      fromFormat: "rgb255",
      toFormat: "hex",
    }) as { output: unknown };
    expect(String(result.output).toLowerCase()).toBe("#ff0000");
  });

  it("names the real reason a server-side-only tool cannot be batched", () => {
    const reason = nonBatchableReason("browser_click");
    expect(reason).toContain("'browser_click' is a server-side-only tool");
    expect(reason).toContain("browser channel");
    // The generic "Unknown command" must be gone.
    expect(reason).not.toContain("Unknown command");
    expect(nonBatchableReason("figma_connect")).toContain("channel/session management");
    expect(nonBatchableReason("get_schema_definition")).toContain("documentation lookup");
  });

  it("leaves genuine Figma commands alone", () => {
    expect(nonBatchableReason("set_fill_color")).toBeUndefined();
    expect(isPureAction("set_fill_color")).toBe(false);
  });
});

describe("mergeServerSideResults", () => {
  const plugin = (index: number, action: string) => ({ index, action, success: true, result: { id: `n${index}` } });

  it("splices a server-side result into the caller's original position", () => {
    // Caller wrote: [0] calculate_composite_color (server), [1] set_fill_color (plugin).
    const merged = mergeServerSideResults([plugin(0, "set_fill_color") as any], [
      { expandedPos: 0, action: "calculate_composite_color", success: true, result: { hex: "#808080" } },
    ] as any);
    expect(merged.map((r) => r.action)).toEqual(["calculate_composite_color", "set_fill_color"]);
    expect(merged.map((r) => r.index)).toEqual([0, 1]);
  });

  it("keeps ordering when a server-side action sits between plugin actions", () => {
    const merged = mergeServerSideResults([plugin(0, "create_frame") as any, plugin(1, "set_fill_color") as any], [
      { expandedPos: 1, action: "convert_color_format", success: false, error: "boom" },
    ] as any);
    expect(merged.map((r) => r.action)).toEqual(["create_frame", "convert_color_format", "set_fill_color"]);
    expect(merged[1].success).toBe(false);
    expect(merged[1].error).toBe("boom");
    expect(merged.map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it("returns the plugin results untouched when there is nothing to splice", () => {
    const merged = mergeServerSideResults([plugin(0, "create_frame") as any], []);
    expect(merged).toHaveLength(1);
    expect(merged[0].action).toBe("create_frame");
  });
});

describe("isGradientFullyBound (#30 lint gate)", () => {
  const stop = (bound: boolean) => ({
    position: 0,
    color: { r: 0, g: 0, b: 0, a: 1 },
    ...(bound ? { boundVariables: { color: { type: "VARIABLE_ALIAS", id: "VariableID:1:2" } } } : {}),
  });

  it("is true only when EVERY stop carries a colour alias", () => {
    expect(isGradientFullyBound({ gradientStops: [stop(true), stop(true)] })).toBe(true);
    expect(isGradientFullyBound({ gradientStops: [stop(true), stop(false)] })).toBe(false);
    expect(isGradientFullyBound({ gradientStops: [] })).toBe(false);
    expect(isGradientFullyBound(null)).toBe(false);
  });
});
