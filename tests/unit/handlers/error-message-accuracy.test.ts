/**
 * Regression tests for two misleading-message defects found in live Figma smoke testing:
 *  1. batch failures claimed earlier actions "already committed" based on INDEX, not success.
 *  2. set_font_weight reported "Error setting font weight: Error setting font weight: undefined".
 */
import { describeCommitted, batchActions } from "../../../src/videntia_figma_plugin/handlers/batch";
import { setFontWeight } from "../../../src/videntia_figma_plugin/handlers/text";

describe("describeCommitted", () => {
  it("says nothing committed when no action succeeded", () => {
    expect(describeCommitted([])).toBe("no actions were committed");
  });

  it("reports a contiguous committed range", () => {
    expect(describeCommitted([0, 1, 2])).toBe("actions 0..2 already committed");
  });

  it("lists non-contiguous committed indices", () => {
    expect(describeCommitted([0, 2])).toBe("actions 0, 2 already committed");
  });
});

describe("batchActions error suffix", () => {
  beforeEach(() => {
    (global as any).figma = { ui: { postMessage: jest.fn() } };
  });

  it("never claims a failed action committed anything", async () => {
    const handleCommand = jest.fn(async (command: string) => {
      if (command === "create_text") throw new Error("Parent node not found with ID: 0:1");
      throw new Error("$result[0] references a failed action: boom");
    });

    const result = (await batchActions(
      {
        actions: [
          { action: "create_text", params: {} },
          { action: "set_font_size", params: {} },
          { action: "rename_node", params: {} },
        ],
      },
      handleCommand as any,
    )) as any;

    expect(result.succeeded).toBe(0);
    for (const r of result.results) {
      expect(r.error).toContain("no actions were committed");
      expect(r.error).not.toContain("already committed");
    }
  });

  it("counts only succeeded actions in the committed range", async () => {
    const handleCommand = jest.fn(async (command: string) => {
      if (command === "ok") return { id: "1" };
      throw new Error("nope");
    });

    const result = (await batchActions(
      {
        actions: [
          { action: "ok", params: {} },
          { action: "bad", params: {} },
          { action: "bad", params: {} },
        ],
      },
      handleCommand as any,
    )) as any;

    const failures = result.results.filter((r: any) => !r.success);
    expect(failures[0].error).toContain("action #0 already committed");
    // Action #2 must NOT claim 0..1 committed — action #1 failed.
    expect(failures[1].error).toContain("action #0 already committed");
    expect(failures[1].error).not.toContain("0..1");
  });
});

describe("setFontWeight missing-style error", () => {
  const textNode = {
    id: "1:2",
    name: "Label",
    type: "TEXT",
    fontName: { family: "Roboto", style: "Regular" },
  };

  beforeEach(() => {
    (global as any).figma = {
      mixed: Symbol("mixed"),
      getNodeByIdAsync: jest.fn(async () => textNode),
      loadFontAsync: jest.fn(async () => {
        // Figma can reject with a non-Error value — the source of ": undefined".
        throw { toString: () => "[object Object]" };
      }),
      listAvailableFontsAsync: jest.fn(async () => [
        { fontName: { family: "Roboto", style: "Regular" } },
        { fontName: { family: "Roboto", style: "Bold" } },
        { fontName: { family: "Inter", style: "Semi Bold" } },
      ]),
    };
  });

  it("names the family, the requested weight, the missing style and the available styles", async () => {
    await expect(setFontWeight({ nodeId: "1:2", weight: 600 })).rejects.toThrow(
      /Font "Roboto" has no style "Semi Bold" \(requested weight 600\)/,
    );
    await expect(setFontWeight({ nodeId: "1:2", weight: 600 })).rejects.toThrow(
      /Available styles for "Roboto": Regular, Bold/,
    );
  });

  it("does not double-prefix or emit 'undefined'", async () => {
    let message = "";
    try {
      await setFontWeight({ nodeId: "1:2", weight: 600 });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain("undefined");
    expect(message).not.toContain("Error setting font weight");
  });
});
