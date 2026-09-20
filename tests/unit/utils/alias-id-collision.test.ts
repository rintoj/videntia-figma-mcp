import { applyParamAliases } from "../../../src/videntia_figma_mcp/utils/param-aliases";

/**
 * `id`/`node` are salvaged into `nodeId` for the many tools whose only node
 * parameter is `nodeId`. But a tool may own `id` as a real, distinct parameter
 * — `remove_animation_style` takes `nodeId` AND `id` (the applied style id).
 * The salvage used to delete that `id` unconditionally, so the tool could
 * never receive it and always reported "id is required".
 */
describe("id/node salvage vs a tool's own parameters", () => {
  it("still salvages a bare id into nodeId for an ordinary tool", () => {
    const out = applyParamAliases("set_opacity", { id: "1:2", opacity: 0.5 }, { hasNodeId: true });
    expect(out.nodeId).toBe("1:2");
    expect(out.id).toBeUndefined();
  });

  it("still salvages a bare node into nodeId", () => {
    const out = applyParamAliases("set_opacity", { node: "1:2" }, { hasNodeId: true });
    expect(out.nodeId).toBe("1:2");
    expect(out.node).toBeUndefined();
  });

  it("preserves an `id` the tool declares itself", () => {
    const out = applyParamAliases(
      "remove_animation_style",
      { nodeId: "1:2", id: "AnimationPresetId:158:38" },
      { hasNodeId: true, declaresId: true },
    );
    expect(out.nodeId).toBe("1:2");
    expect(out.id).toBe("AnimationPresetId:158:38");
  });

  it("does not hijack a declared `id` into nodeId when nodeId is absent", () => {
    const out = applyParamAliases(
      "remove_animation_style",
      { id: "AnimationPresetId:158:38" },
      { hasNodeId: true, declaresId: true },
    );
    expect(out.nodeId).toBeUndefined();
    expect(out.id).toBe("AnimationPresetId:158:38");
  });

  it("preserves a declared `node` parameter", () => {
    const out = applyParamAliases(
      "some_tool",
      { nodeId: "1:2", node: "custom" },
      {
        hasNodeId: true,
        declaresNode: true,
      },
    );
    expect(out.node).toBe("custom");
    expect(out.nodeId).toBe("1:2");
  });

  it("leaves `id` alone entirely for tools without a nodeId", () => {
    const out = applyParamAliases("delete_variable_collection", { id: "coll-1" }, { hasNodeId: false });
    expect(out.id).toBe("coll-1");
    expect(out.nodeId).toBeUndefined();
  });
});
