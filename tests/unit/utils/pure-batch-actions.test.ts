import {
  PURE_BATCH_ACTIONS,
  computePureAction,
  isPureAction,
  nonBatchableReason,
} from "../../../src/videntia_figma_mcp/utils/pure-batch-actions";
import { assembleCallerRows } from "../../../src/videntia_figma_mcp/tools/batch-tools";
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

describe("assembleCallerRows", () => {
  const plugin = (index: number, action: string, extra: Record<string, unknown> = {}) => ({
    index,
    action,
    success: true,
    result: { id: `n${index}` },
    ...extra,
  });
  const at = (action: string, start: number, end = start + 1) =>
    ({ action, kind: "plugin", start, end, primary: start }) as const;

  it("splices a server-side result into the caller's original position", () => {
    // Caller wrote: [0] calculate_composite_color (server), [1] set_fill_color (plugin).
    const merged = assembleCallerRows(
      [
        { action: "calculate_composite_color", kind: "server", success: true, result: { hex: "#808080" } },
        at("set_fill_color", 0),
      ],
      [plugin(0, "set_fill_color")],
    );
    expect(merged.map((r) => r.action)).toEqual(["calculate_composite_color", "set_fill_color"]);
    expect(merged.map((r) => r.index)).toEqual([0, 1]);
  });

  it("keeps ordering when a server-side action sits between plugin actions", () => {
    const merged = assembleCallerRows(
      [
        at("create_frame", 0),
        { action: "convert_color_format", kind: "server", success: false, error: "boom" },
        at("set_fill_color", 1),
      ],
      [plugin(0, "create_frame"), plugin(1, "set_fill_color")],
    );
    expect(merged.map((r) => r.action)).toEqual(["create_frame", "convert_color_format", "set_fill_color"]);
    expect(merged[1].success).toBe(false);
    expect(merged[1].error).toBe("boom");
    expect(merged.map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it("numbers rows by CALLER index after an action expands (create_icon → create_svg + insert_child)", () => {
    const merged = assembleCallerRows(
      [at("create_icon", 0, 2), at("rename_node", 2)],
      [plugin(0, "create_svg"), plugin(1, "insert_child"), plugin(2, "rename_node")],
    );
    expect(merged.map((r) => [r.index, r.action])).toEqual([
      [0, "create_icon"],
      [1, "rename_node"],
    ]);
    expect(merged[0].result).toEqual({ id: "n0" });
  });

  it("reports a failed secondary step on the caller's row, with the caller's index", () => {
    const merged = assembleCallerRows(
      [at("create_icon", 0, 2)],
      [
        plugin(0, "create_svg"),
        {
          index: 1,
          action: "insert_child",
          success: false,
          error: "Parent not found [action #1 (0-based) of 2; action #0 already committed]",
        },
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].success).toBe(false);
    expect(merged[0].error).toMatch(/^Parent not found — /);
    expect(merged[0].error).toContain("node n0 exists");
    expect(merged[0].error).not.toContain("of 2");
  });

  it("omits actions that never ran (stopOnError abort)", () => {
    const merged = assembleCallerRows([at("create_frame", 0), at("set_fill_color", 1)], [plugin(0, "create_frame")]);
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
