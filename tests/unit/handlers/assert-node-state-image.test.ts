import { assertNodeState } from "../../../src/videntia_figma_plugin/handlers/verification";

describe("assertNodeState image paint readback", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("reads back scaleMode and scalingFactor of an IMAGE fill", async () => {
    const node = {
      id: "1:2",
      name: "Grain",
      type: "RECTANGLE",
      fills: [{ type: "IMAGE", imageHash: "abc", scaleMode: "TILE", scalingFactor: 0.5, visible: true, opacity: 1 }],
    };
    (globalThis as any).figma = { mixed: Symbol("mixed"), getNodeByIdAsync: jest.fn(async () => node) };

    const result = (await assertNodeState({
      nodeId: "1:2",
      expected: { fill: { type: "IMAGE", scaleMode: "TILE", scalingFactor: 0.5 } },
    })) as { actual: Record<string, any> };

    expect(result.actual.fill).toMatchObject({ type: "IMAGE", scaleMode: "TILE", scalingFactor: 0.5 });
  });
});
