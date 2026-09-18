import { setGradientFill } from "../../../src/videntia_figma_plugin/handlers/fills";

/**
 * #30 — gradient stops CAN be bound to variables.
 *
 * Verified against @figma/plugin-typings 1.136.0: `ColorStop.boundVariables`
 * exists (`plugin-api.d.ts:4506`) with `VariableBindableColorStopField = 'color'`
 * (`:6742`). What does NOT work is `figma.variables.setBoundVariableForPaint`,
 * typed `(paint: SolidPaint, …): SolidPaint` (`:2186`) — so the alias has to be
 * written into the ColorStop at author time, which is what these tests assert.
 */
describe("setGradientFill — per-stop variable binding (#30)", () => {
  const brandVar = {
    id: "VariableID:10:1",
    name: "brand/primary",
    resolvedType: "COLOR",
    valuesByMode: { "1:0": { r: 0.2, g: 0.4, b: 0.8, a: 1 } },
  };

  let node: any;

  beforeEach(() => {
    node = { id: "1:2", name: "Rect", fills: [], width: 100, height: 100 };
    (globalThis as any).figma = {
      getNodeByIdAsync: jest.fn(async () => node),
      variables: {
        getLocalVariablesAsync: jest.fn(async () => [brandVar]),
      },
    };
  });

  afterEach(() => {
    delete (globalThis as any).figma;
  });

  const call = (stops: any[]) =>
    setGradientFill({ nodeId: "1:2", gradientType: "LINEAR", stops, angle: 0, opacity: 1 });

  it("writes a VARIABLE_ALIAS onto the stop it was asked to bind", async () => {
    await call([
      { colorVariable: "brand/primary", position: 0 },
      { color: "#ffffff", position: 1 },
    ]);

    const paint = node.fills[0];
    expect(paint.type).toBe("GRADIENT_LINEAR");
    expect(paint.gradientStops[0].boundVariables).toEqual({
      color: { type: "VARIABLE_ALIAS", id: "VariableID:10:1" },
    });
    // The unbound stop must NOT gain a phantom binding.
    expect(paint.gradientStops[1].boundVariables).toBeUndefined();
  });

  it("falls back to the variable's own value for the literal colour, never NaN", async () => {
    await call([
      { colorVariable: "brand/primary", position: 0 },
      { color: "#ffffff", position: 1 },
    ]);

    const stopColor = node.fills[0].gradientStops[0].color;
    expect(stopColor).toEqual({ r: 0.2, g: 0.4, b: 0.8, a: 1 });
    for (const channel of [stopColor.r, stopColor.g, stopColor.b, stopColor.a]) {
      expect(Number.isFinite(channel)).toBe(true);
    }
  });

  it("resolves a dash-spelled token name (brand-primary → brand/primary)", async () => {
    await call([
      { colorVariable: "brand-primary", position: 0 },
      { color: "#ffffff", position: 1 },
    ]);
    expect(node.fills[0].gradientStops[0].boundVariables.color.id).toBe("VariableID:10:1");
  });

  it("throws a clear, actionable error for an unknown token rather than silently ignoring it", async () => {
    await expect(
      call([
        { colorVariable: "does/not/exist", position: 0 },
        { color: "#ffffff", position: 1 },
      ]),
    ).rejects.toThrow(/no COLOR variable matches "does\/not\/exist"/);
    // Nothing was written to the node.
    expect(node.fills).toEqual([]);
  });

  it("reports how many stops ended up bound", async () => {
    const result: any = await call([
      { colorVariable: "brand/primary", position: 0 },
      { colorVariable: "brand/primary", position: 1 },
    ]);
    expect(result.stopsCount).toBe(2);
    expect(result.boundStopsCount).toBe(2);
  });

  it("leaves plain literal gradients completely unbound", async () => {
    const result: any = await call([
      { color: "#ff0000", position: 0 },
      { color: "#0000ff", position: 1 },
    ]);
    expect(result.boundStopsCount).toBe(0);
    expect(node.fills[0].gradientStops.every((s: any) => s.boundVariables === undefined)).toBe(true);
  });
});
