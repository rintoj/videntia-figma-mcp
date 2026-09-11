import { setLintIgnore } from "../../../src/videntia_figma_plugin/handlers/lint/ignore";

type MockNode = { id: string; name: string; type: string; setSharedPluginData: jest.Mock };

let target: MockNode;

beforeEach(() => {
  target = { id: "1:2", name: "Carousel", type: "FRAME", setSharedPluginData: jest.fn() };
  (globalThis as any).figma = {
    getNodeByIdAsync: jest.fn(async (id: string) => (id === "1:2" ? target : null)),
  };
});

describe("set_lint_ignore handler", () => {
  it("writes a comma-separated rule list to shared plugin data", async () => {
    const result = await setLintIgnore({ nodeId: "1-2", rules: ["overflow", "clipped-content", "overflow"] });

    expect(target.setSharedPluginData).toHaveBeenCalledWith("videntia", "lint-ignore", "overflow,clipped-content");
    expect(result).toEqual({ id: "1:2", name: "Carousel", lintIgnore: "overflow,clipped-content", cleared: false });
  });

  it('writes "*" when rules is "*" or omitted, and accepts category names', async () => {
    await setLintIgnore({ nodeId: "1:2", rules: "*" });
    await setLintIgnore({ nodeId: "1:2" });
    await setLintIgnore({ nodeId: "1:2", rules: ["backgroundFills"] });

    expect(target.setSharedPluginData.mock.calls.map((c) => c[2])).toEqual(["*", "*", "backgroundFills"]);
  });

  it("clears the marker", async () => {
    const result = await setLintIgnore({ nodeId: "1:2", rules: ["overflow"], clear: true });

    expect(target.setSharedPluginData).toHaveBeenCalledWith("videntia", "lint-ignore", "");
    expect(result).toMatchObject({ lintIgnore: null, cleared: true });
  });

  it("rejects an unknown node", async () => {
    await expect(setLintIgnore({ nodeId: "9:9" })).rejects.toThrow("Node not found");
  });

  it("rejects unknown rule ids without writing", async () => {
    await expect(setLintIgnore({ nodeId: "1:2", rules: ["overflw"] })).rejects.toThrow("Unknown lint rule(s): overflw");
    expect(target.setSharedPluginData).not.toHaveBeenCalled();
  });
});
