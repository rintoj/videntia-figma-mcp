import { batchActions } from "../../../src/videntia_figma_plugin/handlers/batch";

beforeAll(() => {
  (globalThis as any).figma = { ui: { postMessage: () => undefined } };
});
afterAll(() => {
  delete (globalThis as any).figma;
});

describe("plugin batch_actions $result references", () => {
  it("fails the action when a path segment is missing, listing the available keys", async () => {
    const seen: string[] = [];
    const handle = async (command: string, params: Record<string, unknown>) => {
      seen.push(command);
      return command === "create_frame" && params.parentId === undefined ? { id: "1:1", name: "Parent" } : {};
    };
    const result = await batchActions(
      {
        actions: [
          { action: "create_frame", params: {} },
          { action: "create_frame", params: { parentId: "$result[0].nodeId" } },
        ],
      } as any,
      handle,
    );
    const rows = result.results as any[];
    expect(rows[1].success).toBe(false);
    expect(rows[1].error).toContain("$result[0].nodeId: the referenced result has no 'nodeId' field");
    expect(rows[1].error).toContain("Available keys: id, name");
    // Never dispatched with an undefined parentId.
    expect(seen).toEqual(["create_frame"]);
  });

  it("uses 0-based action numbers in its error text", async () => {
    const result = await batchActions({ actions: [{ action: "boom", params: {} }] } as any, async () => {
      throw new Error("nope");
    });
    expect((result.results as any[])[0].error).toContain("[action #0 (0-based) of 1;");
  });

  it("rejects an out-of-range array index", async () => {
    const result = await batchActions(
      {
        actions: [
          { action: "a", params: {} },
          { action: "b", params: { nodeId: "$result[0].ids[2]" } },
        ],
      } as any,
      async (command) => (command === "a" ? { ids: ["1:1"] } : {}),
    );
    expect((result.results as any[])[1].error).toContain("out of range");
  });
});
