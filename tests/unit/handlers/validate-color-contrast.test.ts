import { validateColorContrast } from "../../../src/videntia_figma_plugin/handlers/variables";

/**
 * Bug #44: validate_color_contrast returned "0/0 pairs" on real collections
 * because it only paired `<x>-foreground` with a sibling `<x>`, and never
 * resolved VARIABLE_ALIAS values. A 0-pair sweep also read as a pass.
 */

const COLLECTION = { id: "col-1", name: "Theme", modes: [{ modeId: "m-dark", name: "dark" }] };

function colorVar(name: string, value: unknown, id = name) {
  return {
    id,
    name,
    resolvedType: "COLOR",
    variableCollectionId: "col-1",
    valuesByMode: { "m-dark": value },
  };
}

function mockFigma(variables: unknown[], collections: unknown[] = [COLLECTION]) {
  (globalThis as any).figma = {
    variables: {
      getLocalVariableCollectionsAsync: async () => collections,
      getLocalVariablesAsync: async () => variables,
    },
  };
}

afterEach(() => {
  delete (globalThis as any).figma;
});

const WHITE = { r: 1, g: 1, b: 1, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const MID = { r: 0.5, g: 0.5, b: 0.5, a: 1 };

describe("validate_color_contrast (#44)", () => {
  it("pairs role-named tokens that the old -foreground-only rule missed", async () => {
    mockFigma([colorVar("text/primary", BLACK), colorVar("surface/primary", WHITE)]);

    const result = (await validateColorContrast({ collectionId: "Theme" })) as any;

    expect(result.totalPairs).toBeGreaterThan(0);
    expect(result.noPairsFound).toBeUndefined();
    const pair = result.pairs[0];
    expect(pair.foreground).toBe("text/primary");
    expect(pair.background).toBe("surface/primary");
    expect(pair.ratio).toBeCloseTo(21, 0);
    expect(pair.pass).toBe(true);
  });

  it("still pairs the legacy `<x>-foreground` convention", async () => {
    mockFigma([colorVar("button-foreground", WHITE), colorVar("button", MID)]);
    const result = (await validateColorContrast({ collectionId: "Theme" })) as any;
    expect(result.totalPairs).toBe(1);
    expect(result.pairs[0].strategy).toBe("sibling-suffix");
    // white on mid grey is ~3.9:1 -> fails AA normal
    expect(result.pairs[0].pass).toBe(false);
  });

  it("pairs `on-x` naming", async () => {
    mockFigma([colorVar("on-surface", BLACK), colorVar("surface", WHITE)]);
    const result = (await validateColorContrast({ collectionId: "Theme" })) as any;
    expect(result.totalPairs).toBeGreaterThan(0);
  });

  it("resolves VARIABLE_ALIAS values instead of producing NaN ratios", async () => {
    mockFigma([
      colorVar("palette/black", BLACK, "v-black"),
      colorVar("palette/white", WHITE, "v-white"),
      colorVar("text/default", { type: "VARIABLE_ALIAS", id: "v-black" }, "v-fg"),
      colorVar("background/default", { type: "VARIABLE_ALIAS", id: "v-white" }, "v-bg"),
    ]);
    const result = (await validateColorContrast({ collectionId: "Theme" })) as any;
    const pair = result.pairs.find((p: any) => p.foreground === "text/default");
    expect(pair).toBeDefined();
    expect(Number.isNaN(pair.ratio)).toBe(false);
    expect(pair.ratio).toBeCloseTo(21, 0);
  });

  it("applies the AAA threshold when asked", async () => {
    mockFigma([colorVar("text/muted", { r: 0.45, g: 0.45, b: 0.45, a: 1 }), colorVar("surface/muted", WHITE)]);
    const aa = (await validateColorContrast({ collectionId: "Theme", standard: "AA" })) as any;
    const aaa = (await validateColorContrast({ collectionId: "Theme", standard: "AAA" })) as any;
    expect(aa.pairs[0].pass).toBe(true);
    expect(aaa.pairs[0].pass).toBe(false);
  });

  it("fails LOUDLY (not as a silent pass) when nothing can be paired", async () => {
    mockFigma([colorVar("brand/500", BLACK), colorVar("brand/600", WHITE)]);
    const result = (await validateColorContrast({ collectionId: "Theme" })) as any;

    expect(result.totalPairs).toBe(0);
    expect(result.noPairsFound).toBe(true);
    expect(result.warning).toContain("NOT a pass");
    expect(result.reason).toMatch(/foreground/i);
    // Says what it searched
    expect(result.searched.colorVariables).toBe(2);
    expect(result.searched.mode).toBe("dark");
    expect(result.searched.strategiesTried.length).toBeGreaterThan(0);
    expect(result.sampleVariableNames).toContain("brand/500");
  });

  it("explains a collection with no COLOR variables", async () => {
    mockFigma([
      {
        id: "s1",
        name: "spacing/md",
        resolvedType: "FLOAT",
        variableCollectionId: "col-1",
        valuesByMode: { "m-dark": 8 },
      },
    ]);
    const result = (await validateColorContrast({ collectionId: "Theme" })) as any;
    expect(result.noPairsFound).toBe(true);
    expect(result.reason).toContain("none of type COLOR");
  });

  it("throws with the available modes when the requested mode does not exist", async () => {
    mockFigma([colorVar("text/primary", BLACK), colorVar("surface/primary", WHITE)]);
    await expect(validateColorContrast({ collectionId: "Theme", mode: "light" })).rejects.toThrow(
      /Available modes: dark/,
    );
  });
});
