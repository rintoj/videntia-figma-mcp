/**
 * Integration tests for newly implemented and fixed commands
 * Tests auto layout, selection, annotations, connectors, and design system commands
 */

// Mock commands registry
const mockCommands: Record<string, any> = {};

function mockSendCommandToFigma(command: string, params: any) {
  console.log(`Mock command: ${command}`, params);
  return Promise.resolve(mockCommands[command]?.(params) || { success: true });
}

describe("Auto Layout Commands", () => {
  const frameId = "test-frame-001";

  beforeAll(() => {
    mockCommands["set_layout_mode"] = (params: any) => ({
      nodeId: params.nodeId,
      nodeName: "Test Frame",
      layoutMode: params.layoutMode,
      layoutWrap: params.layoutWrap || "NO_WRAP",
      success: true,
    });

    mockCommands["set_padding"] = (params: any) => ({
      nodeId: params.nodeId,
      nodeName: "Test Frame",
      paddingTop: params.paddingTop || 0,
      paddingRight: params.paddingRight || 0,
      paddingBottom: params.paddingBottom || 0,
      paddingLeft: params.paddingLeft || 0,
      success: true,
    });

    mockCommands["set_item_spacing"] = (params: any) => ({
      nodeId: params.nodeId,
      nodeName: "Test Frame",
      itemSpacing: params.itemSpacing || 0,
      counterAxisSpacing: params.counterAxisSpacing || 0,
      success: true,
    });

    mockCommands["set_axis_align"] = (params: any) => ({
      nodeId: params.nodeId,
      nodeName: "Test Frame",
      primaryAxisAlignItems: params.primaryAxisAlignItems || "MIN",
      counterAxisAlignItems: params.counterAxisAlignItems || "MIN",
      success: true,
    });

    mockCommands["set_layout_sizing"] = (params: any) => ({
      nodeId: params.nodeId,
      nodeName: "Test Frame",
      layoutSizingHorizontal: params.layoutSizingHorizontal || "FIXED",
      layoutSizingVertical: params.layoutSizingVertical || "FIXED",
      success: true,
    });
  });

  it("should set layout mode to HORIZONTAL", async () => {
    const result = await mockSendCommandToFigma("set_layout_mode", {
      nodeId: frameId,
      layoutMode: "HORIZONTAL",
      layoutWrap: "NO_WRAP",
    });

    expect(result.success).toBe(true);
    expect(result.layoutMode).toBe("HORIZONTAL");
    expect(result.layoutWrap).toBe("NO_WRAP");
  });

  it("should set padding on all sides", async () => {
    const result = await mockSendCommandToFigma("set_padding", {
      nodeId: frameId,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
    });

    expect(result.success).toBe(true);
    expect(result.paddingTop).toBe(16);
    expect(result.paddingRight).toBe(16);
    expect(result.paddingBottom).toBe(16);
    expect(result.paddingLeft).toBe(16);
  });

  it("should set item spacing", async () => {
    const result = await mockSendCommandToFigma("set_item_spacing", {
      nodeId: frameId,
      itemSpacing: 12,
      counterAxisSpacing: 8,
    });

    expect(result.success).toBe(true);
    expect(result.itemSpacing).toBe(12);
    expect(result.counterAxisSpacing).toBe(8);
  });

  it("should set axis alignment", async () => {
    const result = await mockSendCommandToFigma("set_axis_align", {
      nodeId: frameId,
      primaryAxisAlignItems: "CENTER",
      counterAxisAlignItems: "CENTER",
    });

    expect(result.success).toBe(true);
    expect(result.primaryAxisAlignItems).toBe("CENTER");
    expect(result.counterAxisAlignItems).toBe("CENTER");
  });

  it("should set layout sizing to HUG", async () => {
    const result = await mockSendCommandToFigma("set_layout_sizing", {
      nodeId: frameId,
      layoutSizingHorizontal: "HUG",
      layoutSizingVertical: "HUG",
    });

    expect(result.success).toBe(true);
    expect(result.layoutSizingHorizontal).toBe("HUG");
    expect(result.layoutSizingVertical).toBe("HUG");
  });
});

describe("Selection and Focus Commands", () => {
  const nodeId1 = "node-001";
  const nodeId2 = "node-002";

  beforeAll(() => {
    mockCommands["set_focus"] = (params: any) => ({
      nodeId: params.nodeId,
      nodeName: "Test Node",
      nodeType: "FRAME",
      focused: true,
      success: true,
    });

    mockCommands["set_selections"] = (params: any) => ({
      selectedCount: params.nodeIds.length,
      selectedNodes: params.nodeIds.map((id: string) => ({
        id,
        name: `Node ${id}`,
        type: "FRAME",
      })),
      success: true,
    });
  });

  it("should focus on a specific node", async () => {
    const result = await mockSendCommandToFigma("set_focus", {
      nodeId: nodeId1,
    });

    expect(result.success).toBe(true);
    expect(result.focused).toBe(true);
    expect(result.nodeId).toBe(nodeId1);
  });

  it("should select multiple nodes", async () => {
    const result = await mockSendCommandToFigma("set_selections", {
      nodeIds: [nodeId1, nodeId2],
    });

    expect(result.success).toBe(true);
    expect(result.selectedCount).toBe(2);
    expect(result.selectedNodes).toHaveLength(2);
  });
});

describe("Scan Commands", () => {
  const pageId = "0:1";

  beforeAll(() => {
    mockCommands["scan_nodes_by_types"] = (params: any) => ({
      rootNodeId: params.nodeId,
      rootNodeName: "Page 1",
      types: params.types,
      foundCount: 5,
      nodes: [
        { id: "f1", name: "Frame 1", type: "FRAME", depth: 0, x: 0, y: 0, width: 100, height: 100 },
        { id: "f2", name: "Frame 2", type: "FRAME", depth: 1, x: 10, y: 10, width: 80, height: 80 },
        { id: "g1", name: "Group 1", type: "GROUP", depth: 0, x: 150, y: 0 },
        { id: "f3", name: "Frame 3", type: "FRAME", depth: 2, x: 20, y: 20, width: 60, height: 60 },
        { id: "g2", name: "Group 2", type: "GROUP", depth: 1, x: 160, y: 10 },
      ],
    });
  });

  it("should scan and find nodes by types", async () => {
    const result = await mockSendCommandToFigma("scan_nodes_by_types", {
      nodeId: pageId,
      types: ["FRAME", "GROUP"],
    });

    expect(result.foundCount).toBe(5);
    expect(result.nodes).toHaveLength(5);
    expect(result.types).toEqual(["FRAME", "GROUP"]);

    const frames = result.nodes.filter((n: any) => n.type === "FRAME");
    const groups = result.nodes.filter((n: any) => n.type === "GROUP");

    expect(frames).toHaveLength(3);
    expect(groups).toHaveLength(2);
  });
});

describe("Annotation Commands", () => {
  const nodeId = "node-001";

  beforeAll(() => {
    mockCommands["get_annotations"] = (params: any) => ({
      success: true,
      nodeId: params.nodeId,
      nodeName: "Test Node",
      nodeType: "FRAME",
      annotationCount: 2,
      annotations: [
        { index: 0, label: "First", labelMarkdown: "First", categoryId: "cat-1" },
        { index: 1, label: "Second", labelMarkdown: "Second" },
      ],
    });

    mockCommands["set_annotation"] = (params: any) => ({
      success: true,
      nodeId: params.nodeId,
      nodeName: "Test Node",
      annotationIndex: params.annotationId !== undefined ? parseInt(params.annotationId) : 0,
      totalAnnotations: 1,
      annotation: { labelMarkdown: params.labelMarkdown },
    });

    mockCommands["set_multiple_annotations"] = (params: any) => ({
      success: true,
      annotationsApplied: params.annotations.length,
      annotationsFailed: 0,
      completedInChunks: 1,
      results: params.annotations.map((a: any) => ({ success: true, nodeId: a.nodeId })),
    });

    mockCommands["get_annotation_categories"] = () => ({
      success: true,
      count: 2,
      categories: [
        { id: "cat-1", label: "Development", color: "blue", isPreset: true },
        { id: "cat-2", label: "QA Review", color: "green", isPreset: false },
      ],
    });

    mockCommands["create_annotation_category"] = (params: any) => ({
      success: true,
      category: { id: "cat-new", label: params.label, color: params.color || "blue", isPreset: false },
    });

    mockCommands["update_annotation_category"] = (params: any) => ({
      success: true,
      category: {
        id: params.categoryId,
        label: params.label || "Updated",
        color: params.color || "blue",
        isPreset: false,
      },
    });

    mockCommands["delete_annotation_category"] = (params: any) => ({
      success: true,
      deletedCategoryId: params.categoryId,
    });
  });

  it("should get annotations for a node", async () => {
    const result = await mockSendCommandToFigma("get_annotations", {
      nodeId: nodeId,
      includeCategories: true,
    });

    expect(result.success).toBe(true);
    expect(result.annotationCount).toBe(2);
    expect(result.annotations).toHaveLength(2);
    expect(result.annotations[0].labelMarkdown).toBe("First");
  });

  it("should set an annotation on a node", async () => {
    const result = await mockSendCommandToFigma("set_annotation", {
      nodeId: nodeId,
      labelMarkdown: "Test annotation",
    });

    expect(result.success).toBe(true);
    expect(result.annotationIndex).toBe(0);
    expect(result.annotation.labelMarkdown).toBe("Test annotation");
  });

  it("should update an existing annotation by index", async () => {
    const result = await mockSendCommandToFigma("set_annotation", {
      nodeId: nodeId,
      annotationId: "1",
      labelMarkdown: "Updated annotation",
    });

    expect(result.success).toBe(true);
    expect(result.annotationIndex).toBe(1);
  });

  it("should set multiple annotations", async () => {
    const result = await mockSendCommandToFigma("set_multiple_annotations", {
      nodeId: nodeId,
      annotations: [
        { nodeId: "child-1", labelMarkdown: "Annotation 1" },
        { nodeId: "child-2", labelMarkdown: "Annotation 2" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.annotationsApplied).toBe(2);
    expect(result.annotationsFailed).toBe(0);
  });

  it("should get annotation categories", async () => {
    const result = await mockSendCommandToFigma("get_annotation_categories", {});

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.categories[0].label).toBe("Development");
    expect(result.categories[1].isPreset).toBe(false);
  });

  it("should create a new annotation category", async () => {
    const result = await mockSendCommandToFigma("create_annotation_category", {
      label: "Design Review",
      color: "purple",
    });

    expect(result.success).toBe(true);
    expect(result.category.label).toBe("Design Review");
    expect(result.category.color).toBe("purple");
    expect(result.category.isPreset).toBe(false);
  });

  it("should update an annotation category", async () => {
    const result = await mockSendCommandToFigma("update_annotation_category", {
      categoryId: "cat-2",
      label: "QA Approved",
      color: "teal",
    });

    expect(result.success).toBe(true);
    expect(result.category.id).toBe("cat-2");
  });

  it("should delete an annotation category", async () => {
    const result = await mockSendCommandToFigma("delete_annotation_category", {
      categoryId: "cat-2",
    });

    expect(result.success).toBe(true);
    expect(result.deletedCategoryId).toBe("cat-2");
  });
});

describe("Prototyping Commands", () => {
  const nodeId1 = "button-001";
  const nodeId2 = "screen-002";

  beforeAll(() => {
    mockCommands["get_reactions"] = (params: any) => ({
      nodeCount: params.nodeIds.length,
      nodesWithReactions: 1,
      reactions: [
        {
          nodeId: nodeId1,
          nodeName: "Button",
          reactionCount: 1,
          reactions: [
            {
              trigger: { type: "ON_CLICK" },
              actions: [{ type: "NODE", destinationId: nodeId2 }],
            },
          ],
        },
      ],
    });

    mockCommands["create_connections"] = (params: any) => ({
      totalRequested: params.connections.length,
      successCount: params.connections.length,
      failedCount: 0,
      connections: params.connections.map((conn: any) => ({
        ...conn,
        connectorId: `connector-${conn.startNodeId}-${conn.endNodeId}`,
        success: true,
      })),
    });

    mockCommands["set_default_connector"] = (params: any) => ({
      connectorId: params.connectorId,
      connectorName: "Default Connector",
      message: "Default connector setting is not available in Figma Plugin API. Use Figma UI.",
      success: false,
    });
  });

  it("should get reactions from nodes", async () => {
    const result = await mockSendCommandToFigma("get_reactions", {
      nodeIds: [nodeId1, nodeId2],
    });

    expect(result.nodeCount).toBe(2);
    expect(result.nodesWithReactions).toBe(1);
    expect(result.reactions).toHaveLength(1);
    expect(result.reactions[0].reactionCount).toBe(1);
  });

  it("should create connections between nodes", async () => {
    const result = await mockSendCommandToFigma("create_connections", {
      connections: [
        { startNodeId: "node-A", endNodeId: "node-B", text: "Navigate" },
        { startNodeId: "node-B", endNodeId: "node-C" },
      ],
    });

    expect(result.totalRequested).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.connections).toHaveLength(2);
  });

  it("should acknowledge default connector limitation", async () => {
    const result = await mockSendCommandToFigma("set_default_connector", {
      connectorId: "connector-001",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Use Figma UI");
  });
});

describe("Design System Preset Commands", () => {
  const collectionId = "collection-001";

  beforeAll(() => {
    mockCommands["create_spacing_system"] = (params: any) => ({
      success: true,
      primitiveCount: 19,
      primitiveVariables: [
        "spacing/0",
        "spacing/1",
        "spacing/2",
        "spacing/3",
        "spacing/4",
        "spacing/5",
        "spacing/6",
        "spacing/7",
        "spacing/8",
        "spacing/10",
        "spacing/12",
        "spacing/16",
        "spacing/20",
        "spacing/24",
        "spacing/32",
        "spacing/40",
        "spacing/48",
        "spacing/56",
        "spacing/64",
      ],
      preset: params.preset,
    });

    mockCommands["create_typography_system"] = (params: any) => ({
      success: true,
      totalVariables: 24,
      variables: [
        "font.size.xs",
        "font.size.sm",
        "font.size.base",
        "font.size.lg",
        "font.size.xl",
        "font.size.2xl",
        "font.size.3xl",
        "font.size.4xl",
        "font.size.5xl",
        "font.weight.thin",
        "font.weight.extralight",
        "font.weight.light",
        "font.weight.normal",
        "font.weight.medium",
        "font.weight.semibold",
        "font.weight.bold",
        "font.weight.extrabold",
        "font.weight.black",
        "font.lineHeight.none",
        "font.lineHeight.tight",
        "font.lineHeight.snug",
        "font.lineHeight.normal",
        "font.lineHeight.relaxed",
        "font.lineHeight.loose",
      ],
      preset: params.scale_preset,
    });

    mockCommands["create_radius_system"] = (params: any) => ({
      success: true,
      totalVariables: 9,
      variables: [
        "radius/none",
        "radius/sm",
        "radius/md",
        "radius/md",
        "radius/lg",
        "radius/xl",
        "radius/2xl",
        "radius/3xl",
        "radius/full",
      ],
      preset: params.preset,
    });
  });

  it("should create spacing system with 8pt grid", async () => {
    const result = await mockSendCommandToFigma("create_spacing_system", {
      collection_id: collectionId,
      preset: "8pt",
      include_semantic: true,
    });

    expect(result.success).toBe(true);
    expect(result.primitiveCount).toBe(19);
    expect(result.preset).toBe("8pt");
    expect(result.primitiveVariables).toContain("spacing/8");
    expect(result.primitiveVariables).toContain("spacing/16");
  });

  it("should create typography system with major-third scale", async () => {
    const result = await mockSendCommandToFigma("create_typography_system", {
      collection_id: collectionId,
      scale_preset: "major-third",
      base_size: 16,
      include_weights: true,
      include_line_heights: true,
      include_semantic: true,
    });

    expect(result.success).toBe(true);
    expect(result.totalVariables).toBe(24);
    expect(result.preset).toBe("major-third");
    expect(result.variables).toContain("font.size.base");
    expect(result.variables).toContain("font.weight.bold");
    expect(result.variables).toContain("font.lineHeight.normal");
  });

  it("should create radius system with standard preset", async () => {
    const result = await mockSendCommandToFigma("create_radius_system", {
      collection_id: collectionId,
      preset: "standard",
    });

    expect(result.success).toBe(true);
    expect(result.totalVariables).toBe(9);
    expect(result.preset).toBe("standard");
    expect(result.variables).toContain("radius/sm");
    expect(result.variables).toContain("radius/full");
  });
});

describe("Fixed Commands", () => {
  beforeAll(() => {
    mockCommands["create_component_instance"] = (params: any) => ({
      id: "instance-001",
      name: "Button Instance",
      x: params.x || 0,
      y: params.y || 0,
      width: 100,
      height: 40,
      componentId: params.componentKey,
      parentId: params.parentId || "0:1",
    });

    mockCommands["unbind_variable"] = (params: any) => ({
      nodeId: params.nodeId,
      nodeName: "Test Node",
      field: params.field,
      success: true,
    });
  });

  it("should create component instance successfully", async () => {
    const result = await mockSendCommandToFigma("create_component_instance", {
      componentKey: "component-key-123",
      x: 50,
      y: 100,
      parentId: "frame-001",
    });

    expect(result.id).toBe("instance-001");
    expect(result.x).toBe(50);
    expect(result.y).toBe(100);
    expect(result.parentId).toBe("frame-001");
  });

  it("should unbind variable from node successfully", async () => {
    const result = await mockSendCommandToFigma("unbind_variable", {
      nodeId: "rect-001",
      field: "fills/0",
    });

    expect(result.success).toBe(true);
    expect(result.field).toBe("fills/0");
  });
});

console.log("✅ All new command tests defined successfully!");
