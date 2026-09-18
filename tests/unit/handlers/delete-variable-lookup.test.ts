/**
 * `delete_variable` used to reject the obvious `variableId` spelling and then blame the
 * DATA for it ("Variable not found: undefined") — the caller was told their variable was
 * missing when in fact their parameter name was wrong. It also refused a plain variable
 * NAME unless a collectionId came with it, even though name-based lookup is advertised
 * across the variable tools.
 *
 * These tests pin the three things that failure hid: the alias is accepted, a name works
 * on its own, and each distinct failure gets its own honest message.
 */

const mixed = Symbol("figma.mixed");

interface FakeVariable {
  id: string;
  name: string;
  variableCollectionId: string;
  removed?: boolean;
  remove: () => void;
}

function makeVariable(id: string, name: string, collectionId: string): FakeVariable {
  const v: FakeVariable = {
    id,
    name,
    variableCollectionId: collectionId,
    removed: false,
    remove: () => {
      v.removed = true;
    },
  };
  return v;
}

let variables: FakeVariable[] = [];
const collections = [
  { id: "C:1", name: "Theme", modes: [{ modeId: "m1", name: "Light" }] },
  { id: "C:2", name: "Radius", modes: [{ modeId: "m1", name: "Light" }] },
];

beforeEach(() => {
  variables = [
    makeVariable("VariableID:1:1", "color/primary", "C:1"),
    makeVariable("VariableID:1:2", "color/secondary", "C:1"),
    makeVariable("VariableID:2:1", "radius/3xl", "C:2"),
    makeVariable("VariableID:2:2", "color/primary", "C:2"),
  ];
  (globalThis as any).figma = {
    mixed,
    variables: {
      getLocalVariableCollectionsAsync: async () => collections,
      getLocalVariablesAsync: async () => variables,
    },
  };
});

afterEach(() => {
  delete (globalThis as any).figma;
});

// Imported after the figma global exists — the module reads it at call time only, but
// keeping the order explicit documents the dependency.
import { deleteVariable, deleteVariablesBatch } from "../../../src/videntia_figma_plugin/handlers/variables";

describe("delete_variable identifier handling", () => {
  it("accepts the canonical `variableId` spelling", async () => {
    const result = await deleteVariable({ variableId: "VariableID:2:1" });
    expect(result.deleted).toBe(true);
    expect(result.name).toBe("radius/3xl");
    expect(variables.find((v) => v.id === "VariableID:2:1")!.removed).toBe(true);
  });

  it("accepts `id` — the tool's own parameter name — as the same thing", async () => {
    const result = await deleteVariable({ id: "VariableID:2:1" });
    expect(result.variableId).toBe("VariableID:2:1");
  });

  it("accepts a unique variable NAME with no collectionId", async () => {
    const result = await deleteVariable({ variableId: "radius/3xl" });
    expect(result.variableId).toBe("VariableID:2:1");
  });

  it("accepts the dashed spelling of a name", async () => {
    const result = await deleteVariable({ variableId: "radius-3xl" });
    expect(result.variableId).toBe("VariableID:2:1");
  });

  it("resolves an ambiguous name once a collection is given", async () => {
    const result = await deleteVariable({ variableId: "color/primary", collectionId: "Radius" });
    expect(result.variableId).toBe("VariableID:2:2");
  });

  it("says the NAME is ambiguous — not that the variable is missing", async () => {
    await expect(deleteVariable({ variableId: "color/primary" })).rejects.toThrow(/ambiguous/i);
    await expect(deleteVariable({ variableId: "color/primary" })).rejects.toThrow(/Theme, Radius/);
  });

  it("names the PARAMETER when no identifier was supplied at all", async () => {
    await expect(deleteVariable({})).rejects.toThrow(/Missing variable identifier/);
    await expect(deleteVariable({})).rejects.toThrow(/variableId/);
  });

  it("says no variable matched the id or name — not 'Variable not found: undefined'", async () => {
    await expect(deleteVariable({ variableId: "nope/nope" })).rejects.toThrow(
      /No variable found with id or name "nope\/nope"/,
    );
  });

  it("scopes the miss to the collection when one was given", async () => {
    await expect(deleteVariable({ variableId: "nope/nope", collectionId: "Theme" })).rejects.toThrow(
      /in collection "Theme"/,
    );
  });
});

describe("delete_variables_batch identifier handling", () => {
  it("accepts `ids` as well as `variableIds`", async () => {
    const result = await deleteVariablesBatch({ ids: ["VariableID:2:1", "color/secondary"] });
    expect(result.deleted).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("accepts a single string instead of an array", async () => {
    const result = await deleteVariablesBatch({ variableIds: "radius/3xl" });
    expect(result.deleted).toBe(1);
  });

  it("names the parameter when nothing was supplied", async () => {
    await expect(deleteVariablesBatch({})).rejects.toThrow(/Missing variable identifiers/);
  });

  it("reports per-id failures with the honest message", async () => {
    const result = (await deleteVariablesBatch({ ids: ["VariableID:2:1", "ghost"] })) as any;
    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0].error).toMatch(/No variable found with id or name "ghost"/);
  });
});
