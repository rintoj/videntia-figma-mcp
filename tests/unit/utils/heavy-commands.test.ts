import { isHeavyCommand } from "../../../src/videntia_figma_mcp/utils/heavy-commands";

describe("isHeavyCommand", () => {
  it("classifies always-heavy commands", () => {
    for (const c of [
      "scan_nodes_by_types",
      "lint_frame",
      "contrast_check_frame",
      "find_unbound",
      "find_overlaps",
      "export_node_as_image",
      "export_image_fill",
      "bulk_export_frames",
      "get_design_system",
      "get_variables",
      "enumerate_all_frames",
      "map_prototype_flows",
    ]) {
      expect(isHeavyCommand(c, {})).toBe(true);
    }
  });
  it("leaves light reads and writes light", () => {
    expect(isHeavyCommand("get_node_info", { nodeId: "1:2" })).toBe(false);
    expect(isHeavyCommand("set_fill_color", {})).toBe(false);
  });
  it("get_content_tree is heavy only when deep", () => {
    expect(isHeavyCommand("get_content_tree", {})).toBe(true);
    expect(isHeavyCommand("get_content_tree", { maxDepth: 5 })).toBe(true);
    expect(isHeavyCommand("get_content_tree", { maxDepth: 2 })).toBe(false);
    expect(isHeavyCommand("get_content_tree", { depth: 3 })).toBe(false);
  });
  it("search_nodes is heavy only page-wide", () => {
    expect(isHeavyCommand("search_nodes", { query: "x" })).toBe(true);
    expect(isHeavyCommand("search_nodes", { query: "x", nodeId: "1:2" })).toBe(false);
    expect(isHeavyCommand("search_nodes", { query: "x", nodeId: [] })).toBe(true);
  });

  it("classifies the design-context tools", () => {
    expect(isHeavyCommand("get_variables_used", { nodeId: "1:2" })).toBe(true);
    expect(isHeavyCommand("get_design_context", { nodeId: "1:2" })).toBe(false);
    expect(isHeavyCommand("get_design_context", { nodeId: "1:2", maxNodes: 2000 })).toBe(true);
    expect(isHeavyCommand("get_design_context", { nodeId: "1:2", depth: 6 })).toBe(true);
  });
});
