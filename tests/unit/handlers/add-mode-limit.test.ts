/// <reference types="@figma/plugin-typings" />
import { addModeToCollection, isModeLimitError } from "../../../src/videntia_figma_plugin/handlers/variables";

function installCollection(addMode: (name: string) => string) {
  const collection = {
    id: "VariableCollectionId:1:1",
    name: "Design Tokens",
    modes: [{ modeId: "1:0", name: "Light" }],
    addMode: jest.fn(addMode),
  };
  (globalThis as any).figma = {
    variables: {
      getLocalVariableCollectionsAsync: jest.fn(async () => [collection]),
    },
  };
  return collection;
}

describe("addModeToCollection mode limit errors", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("explains a plan mode-limit error with mode count and workaround", async () => {
    installCollection(() => {
      throw new Error("in addMode: Limited to 1 modes only");
    });

    const error = await addModeToCollection({ collectionId: "Design Tokens", modeName: "Dark" }).catch((e) => e);
    expect(error.message).toContain("Mode limit reached");
    expect(error.message).toMatch(/already has 1 mode,/);
    expect(error.message).toContain("Starter/free plan = 1 mode per collection");
    expect(error.message).toContain("create_variable_collection");
    expect(error.message).toContain('defaultMode: "Dark"');
    expect(error.message).toContain("Limited to 1 modes only");
  });

  it("passes non-limit errors through unchanged", async () => {
    const original = new Error("Mode name must be unique");
    installCollection(() => {
      throw original;
    });

    const error = await addModeToCollection({ collectionId: "Design Tokens", modeName: "Light" }).catch((e) => e);
    expect(error).toBe(original);
  });

  it("returns the new mode on success", async () => {
    const collection = installCollection((name) => {
      collection.modes.push({ modeId: "1:1", name });
      return "1:1";
    });

    const result = await addModeToCollection({ collectionId: "Design Tokens", modeName: "Dark" });
    expect(result).toMatchObject({ modeId: "1:1", modeName: "Dark", totalModes: 2, success: true });
  });

  it("classifies limit messages", () => {
    expect(isModeLimitError("Limited to 4 modes only")).toBe(true);
    expect(isModeLimitError("Upgrade your plan to add more modes")).toBe(true);
    expect(isModeLimitError("Mode name must be unique")).toBe(false);
    expect(isModeLimitError("Unexpected explanation token in delimiter")).toBe(false);
  });
});
