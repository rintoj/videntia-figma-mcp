/// <reference types="@figma/plugin-typings" />
import {
  bindVariable,
  unbindVariable,
  parseBindField,
} from "../../../src/videntia_figma_plugin/handlers/variable-bindings";
import { setEffects, createEffectStyle, updateEffectStyle } from "../../../src/videntia_figma_plugin/handlers/effects";
import { setGradientFill } from "../../../src/videntia_figma_plugin/handlers/fills";

type AnyRecord = Record<string, any>;

const MIXED = Symbol("mixed");

function makeVariable(id: string, name: string, resolvedType: string): AnyRecord {
  return { id, name, resolvedType };
}

const alias = (v: AnyRecord) => ({ type: "VARIABLE_ALIAS", id: v.id });

let nodes: Map<string, AnyRecord>;
let styles: AnyRecord[];
let variables: AnyRecord[];

const shadow = () => ({
  type: "DROP_SHADOW",
  color: { r: 0, g: 0, b: 0, a: 0.2 },
  offset: { x: 0, y: 2 },
  radius: 4,
  spread: 0,
  visible: true,
  blendMode: "NORMAL",
});

const linearGradient = () => ({
  type: "GRADIENT_LINEAR",
  gradientTransform: [
    [1, 0, 0],
    [0, 1, 0],
  ],
  gradientStops: [
    { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
  ],
});

beforeEach(() => {
  variables = [
    makeVariable("VariableID:1:1", "shadow/color", "COLOR"),
    makeVariable("VariableID:1:2", "shadow/blur", "FLOAT"),
    makeVariable("VariableID:1:3", "brand/primary", "COLOR"),
  ];
  nodes = new Map<string, AnyRecord>([
    [
      "1:1",
      {
        id: "1:1",
        name: "Card",
        type: "FRAME",
        effects: [shadow()],
        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
        strokes: [],
      },
    ],
    ["1:2", { id: "1:2", name: "Hero", type: "RECTANGLE", effects: [], fills: [linearGradient()], strokes: [] }],
  ]);
  styles = [
    {
      id: "S:effect1,",
      name: "shadow/md",
      type: "EFFECT",
      effects: [shadow(), { type: "LAYER_BLUR", radius: 8, visible: true }],
    },
    { id: "S:text1,", name: "body/md", type: "TEXT", setBoundVariable: jest.fn() },
  ];

  (globalThis as any).figma = {
    mixed: MIXED,
    getNodeByIdAsync: jest.fn(async (id: string) => nodes.get(id) ?? null),
    getStyleByIdAsync: jest.fn(async (id: string) => styles.find((s) => s.id === id) ?? null),
    getLocalTextStylesAsync: jest.fn(async () => styles.filter((s) => s.type === "TEXT")),
    getLocalEffectStylesAsync: jest.fn(async () => styles.filter((s) => s.type === "EFFECT")),
    createEffectStyle: jest.fn(() => {
      const style: AnyRecord = { id: "S:new,", key: "k", name: "", effects: [] };
      styles.push(Object.assign(style, { type: "EFFECT" }));
      return style;
    }),
    variables: {
      getVariableByIdAsync: jest.fn(async (id: string) => variables.find((v) => v.id === id) ?? null),
      getLocalVariablesAsync: jest.fn(async () => variables),
      createVariableAlias: jest.fn((v: AnyRecord) => alias(v)),
      setBoundVariableForPaint: jest.fn((paint: AnyRecord, field: string, v: AnyRecord | null) => {
        const bound = { ...(paint.boundVariables || {}) };
        if (v) bound[field] = alias(v);
        else delete bound[field];
        return { ...paint, boundVariables: bound };
      }),
      setBoundVariableForEffect: jest.fn((effect: AnyRecord, field: string, v: AnyRecord | null) => {
        const bound = { ...(effect.boundVariables || {}) };
        if (v) bound[field] = alias(v);
        else delete bound[field];
        return { ...effect, boundVariables: bound };
      }),
    },
  };
});

afterEach(() => {
  delete (globalThis as any).figma;
});

describe("parseBindField", () => {
  it.each([
    ["fills", { kind: "paint", prop: "fills", index: 0 }],
    ["strokes/2/color", { kind: "paint", prop: "strokes", index: 2 }],
    ["fills/0/gradientStops/1/color", { kind: "gradientStop", prop: "fills", index: 0, stopIndex: 1 }],
    ["effects/3/offsetY", { kind: "effect", index: 3, field: "offsetY" }],
    ["cornerRadius", { kind: "node", field: "cornerRadius" }],
  ])("parses %s", (field, expected) => {
    expect(parseBindField(field)).toEqual(expected);
  });

  it("rejects unsupported fields with the list of supported fields", () => {
    expect(() => parseBindField("effects/0/blendMode")).toThrow("color, radius, spread, offsetX, offsetY");
    expect(() => parseBindField("rotation")).toThrow("Supported fields: fills/N/color");
    expect(() => parseBindField("fills/0/gradientStops/x/color")).toThrow('Invalid gradient stop index "x"');
  });
});

describe("bind_variable on effects", () => {
  it("binds a shadow color on a node by variable name", async () => {
    const result = await bindVariable({ nodeId: "1:1", variableId: "shadow/color", field: "effects/0/color" });
    expect(nodes.get("1:1")!.effects[0].boundVariables).toEqual({ color: alias(variables[0]) });
    expect(result).toMatchObject({ nodeId: "1:1", field: "effects/0/color", variableName: "shadow/color" });
  });

  it("binds a shadow radius on a node by variable id", async () => {
    await bindVariable({ nodeId: "1:1", variableId: "VariableID:1:2", field: "effects/0/radius" });
    expect(nodes.get("1:1")!.effects[0].boundVariables).toEqual({ radius: alias(variables[1]) });
  });

  it("binds on an effect style resolved by name", async () => {
    const result = await bindVariable({ nodeId: "shadow-md", variableId: "shadow/blur", field: "effects/1/radius" });
    const style = styles[0];
    expect(style.effects[1].boundVariables).toEqual({ radius: alias(variables[1]) });
    expect(style.effects[0].boundVariables).toBeUndefined();
    expect(result).toMatchObject({ styleId: "S:effect1,", name: "shadow/md", field: "effects/1/radius" });
  });

  it("rejects color on a blur effect", async () => {
    await expect(
      bindVariable({ nodeId: "S:effect1,", variableId: "shadow/color", field: "effects/1/color" }),
    ).rejects.toThrow('"color" cannot be bound on a LAYER_BLUR effect');
  });

  it("rejects a variable of the wrong type", async () => {
    await expect(bindVariable({ nodeId: "1:1", variableId: "shadow/blur", field: "effects/0/color" })).rejects.toThrow(
      "needs a COLOR variable",
    );
  });

  it("reports a missing effect index", async () => {
    await expect(bindVariable({ nodeId: "1:1", variableId: "shadow/color", field: "effects/4/color" })).rejects.toThrow(
      "has 1 effect(s)",
    );
  });

  it("rejects non-effect fields on an effect style", async () => {
    await expect(
      bindVariable({ nodeId: "shadow/md", variableId: "shadow/color", field: "fills/0/color" }),
    ).rejects.toThrow("effect styles only accept effects/N/<field>");
  });
});

describe("bind_variable on paints", () => {
  it("binds a gradient stop color", async () => {
    await bindVariable({ nodeId: "1:2", variableId: "brand/primary", field: "fills/0/gradientStops/1/color" });
    const stops = nodes.get("1:2")!.fills[0].gradientStops;
    expect(stops[1].boundVariables).toEqual({ color: alias(variables[2]) });
    expect(stops[0].boundVariables).toBeUndefined();
    expect(nodes.get("1:2")!.fills[0].type).toBe("GRADIENT_LINEAR");
  });

  it("points fills/N/color on a gradient paint to gradientStops", async () => {
    await expect(bindVariable({ nodeId: "1:2", variableId: "brand/primary", field: "fills/0/color" })).rejects.toThrow(
      'Bind each stop with "fills/0/gradientStops/M/color" (M = 0..1)',
    );
  });

  it("rejects a gradient stop path on a solid paint", async () => {
    await expect(
      bindVariable({ nodeId: "1:1", variableId: "brand/primary", field: "fills/0/gradientStops/0/color" }),
    ).rejects.toThrow('not a gradient. Use "fills/0/color"');
  });

  it("rejects an out-of-range gradient stop", async () => {
    await expect(
      bindVariable({ nodeId: "1:2", variableId: "brand/primary", field: "fills/0/gradientStops/5/color" }),
    ).rejects.toThrow("gradient stop 5 does not exist");
  });

  it("still binds solid fill colors", async () => {
    await bindVariable({ nodeId: "1:1", variableId: "brand/primary", field: "fills/0/color" });
    expect(nodes.get("1:1")!.fills[0].boundVariables).toEqual({ color: alias(variables[2]) });
  });
});

describe("unbind_variable", () => {
  it("unbinds an effect field on a node", async () => {
    await bindVariable({ nodeId: "1:1", variableId: "shadow/color", field: "effects/0/color" });
    await unbindVariable({ nodeId: "1:1", field: "effects/0/color" });
    expect(nodes.get("1:1")!.effects[0].boundVariables).toEqual({});
  });

  it("unbinds an effect field on an effect style", async () => {
    await bindVariable({ nodeId: "shadow/md", variableId: "shadow/blur", field: "effects/0/radius" });
    const result = await unbindVariable({ nodeId: "shadow/md", field: "effects/0/radius" });
    expect(styles[0].effects[0].boundVariables).toEqual({});
    expect(result).toMatchObject({ styleId: "S:effect1,", success: true });
  });

  it("unbinds a gradient stop color", async () => {
    await bindVariable({ nodeId: "1:2", variableId: "brand/primary", field: "fills/0/gradientStops/0/color" });
    await unbindVariable({ nodeId: "1:2", field: "fills/0/gradientStops/0/color" });
    expect(nodes.get("1:2")!.fills[0].gradientStops[0].boundVariables).toBeUndefined();
  });

  it("points fills/N/color on a gradient paint to gradientStops", async () => {
    await expect(unbindVariable({ nodeId: "1:2", field: "fills/0/color" })).rejects.toThrow("gradientStops/M/color");
  });
});

describe("variable params on effect and gradient tools", () => {
  it("set_effects binds colorVariable and radiusVariable", async () => {
    await setEffects({
      nodeId: "1:1",
      effects: [{ type: "DROP_SHADOW", colorVariable: "shadow/color", radiusVariable: "shadow-blur" }],
    });
    expect(nodes.get("1:1")!.effects[0].boundVariables).toEqual({
      color: alias(variables[0]),
      radius: alias(variables[1]),
    });
    expect((globalThis as any).figma.variables.getLocalVariablesAsync).toHaveBeenCalledTimes(1);
  });

  it("set_effects reports an unknown variable", async () => {
    await expect(
      setEffects({ nodeId: "1:1", effects: [{ type: "DROP_SHADOW", colorVariable: "nope" }] }),
    ).rejects.toThrow('Variable not found: "nope"');
  });

  it("create_effect_style binds per-effect variables", async () => {
    const result = await createEffectStyle({
      name: "focus/ring",
      effects: [{ type: "DROP_SHADOW", spread: 2, colorVariable: "brand/primary" }],
    });
    expect((result.effects as AnyRecord[])[0].boundVariables).toEqual({ color: alias(variables[2]) });
  });

  it("update_effect_style binds per-effect variables", async () => {
    await updateEffectStyle({
      styleId: "shadow/md",
      effects: [{ type: "LAYER_BLUR", radiusVariable: "VariableID:1:2" }],
    });
    expect(styles[0].effects[0].boundVariables).toEqual({ radius: alias(variables[1]) });
  });

  it("update_effect_style leaves the style untouched when a variable is missing", async () => {
    const before = styles[0].name;
    await expect(
      updateEffectStyle({
        styleId: "shadow/md",
        name: "shadow/renamed",
        effects: [{ type: "DROP_SHADOW", colorVariable: "nope" }],
      }),
    ).rejects.toThrow('Variable not found: "nope"');
    expect(styles[0].name).toBe(before);
  });

  it("set_gradient_fill binds stop colorVariable and allows omitting color", async () => {
    await setGradientFill({
      nodeId: "1:1",
      gradientType: "LINEAR",
      stops: [
        { position: 0, colorVariable: "brand/primary" },
        { position: 1, color: { r: 1, g: 1, b: 1 } },
      ],
    });
    const stops = nodes.get("1:1")!.fills[0].gradientStops;
    expect(stops[0].boundVariables).toEqual({ color: alias(variables[2]) });
    expect(stops[1].boundVariables).toBeUndefined();
  });

  it("set_gradient_fill rejects a stop with neither color nor colorVariable", async () => {
    await expect(
      setGradientFill({
        nodeId: "1:1",
        gradientType: "LINEAR",
        stops: [{ position: 0 }, { position: 1, color: { r: 1, g: 1, b: 1 } }],
      }),
    ).rejects.toThrow("stops[0].color must be a hex string or {r,g,b,a}");
  });
});
