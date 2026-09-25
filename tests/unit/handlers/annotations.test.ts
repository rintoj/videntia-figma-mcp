import {
  getAnnotations,
  setAnnotation,
  setMultipleAnnotations,
  removeAnnotation,
  collectAnnotationGroups,
  isAnnotationSupported,
} from "../../../src/videntia_figma_plugin/handlers/annotations";

type MockNode = Record<string, any>;

let nodes: Map<string, MockNode>;

const CATEGORIES = [
  { id: "cat-dev", label: "Development", color: "blue", isPreset: true },
  { id: "cat-a11y", label: "Accessibility", color: "green", isPreset: false },
];

function addNode(id: string, type: string, parent: MockNode | null = null, annotations: any[] = []): MockNode {
  const node: MockNode = { id, type, name: `${type} ${id}`, parent };
  if (type !== "GROUP" && type !== "SECTION" && type !== "BOOLEAN_OPERATION") node.annotations = annotations;
  if (parent) {
    parent.children = parent.children || [];
    parent.children.push(node);
  }
  nodes.set(id, node);
  return node;
}

beforeEach(() => {
  nodes = new Map();
  (globalThis as any).figma = {
    getNodeByIdAsync: jest.fn(async (id: string) => nodes.get(id) ?? null),
    annotations: {
      getAnnotationCategoriesAsync: jest.fn(async () => CATEGORIES),
      getAnnotationCategoryByIdAsync: jest.fn(async (id: string) => CATEGORIES.find((c) => c.id === id) ?? null),
    },
  };
});

afterEach(() => {
  delete (globalThis as any).figma;
});

describe("annotation support allowlist", () => {
  it("includes TEXT_PATH and excludes GROUP / SECTION / BOOLEAN_OPERATION", () => {
    expect(isAnnotationSupported({ type: "TEXT_PATH" } as any)).toBe(true);
    expect(isAnnotationSupported({ type: "GROUP" } as any)).toBe(false);
    expect(isAnnotationSupported({ type: "SECTION" } as any)).toBe(false);
    expect(isAnnotationSupported({ type: "BOOLEAN_OPERATION" } as any)).toBe(false);
  });
});

describe("getAnnotations", () => {
  it("reads only the target node by default", async () => {
    const frame = addNode("1:1", "FRAME", null, [{ labelMarkdown: "Root", categoryId: "cat-dev" }]);
    addNode("1:2", "TEXT", frame, [{ labelMarkdown: "Child" }]);
    const result = await getAnnotations({ nodeId: "1:1", includeCategories: true });
    expect(result["annotationCount"]).toBe(1);
    expect(result["nodesScanned"]).toBe(1);
    const own = (result["annotations"] as any[])[0];
    expect(own).toMatchObject({ index: 0, labelMarkdown: "Root", categoryId: "cat-dev" });
    expect(own.category).toMatchObject({ id: "cat-dev", label: "Development" });
  });

  it("groups descendants by node with include_children, recursing through groups", async () => {
    const frame = addNode("1:1", "FRAME");
    const group = addNode("1:2", "GROUP", frame);
    addNode("1:3", "RECTANGLE", group, [{ labelMarkdown: "In group" }, { labelMarkdown: "Second" }]);
    const inner = addNode("1:4", "FRAME", frame);
    addNode("1:5", "TEXT", inner, [{ labelMarkdown: "Deep" }]);

    const result = await getAnnotations({ nodeId: "1:1", includeChildren: true });
    const groups = result["nodes"] as any[];
    expect(groups.map((g) => g.nodeId)).toEqual(["1:3", "1:5"]);
    expect(groups[0].annotations.map((a: any) => a.index)).toEqual([0, 1]);
    expect(result["annotationCount"]).toBe(3);
    expect(result["nodesScanned"]).toBe(5);
  });

  it("honours depth", async () => {
    const frame = addNode("1:1", "FRAME");
    const inner = addNode("1:2", "FRAME", frame, [{ labelMarkdown: "Level 1" }]);
    addNode("1:3", "TEXT", inner, [{ labelMarkdown: "Level 2" }]);
    const result = await getAnnotations({ nodeId: "1:1", includeChildren: true, depth: 1 });
    expect((result["nodes"] as any[]).map((g) => g.nodeId)).toEqual(["1:2"]);
  });

  it("explains that a GROUP can't hold annotations", async () => {
    addNode("1:1", "GROUP");
    const result = await getAnnotations({ nodeId: "1:1" });
    expect(result["supported"]).toBe(false);
    expect(result["message"]).toContain("GROUP nodes can't hold annotations");
    expect(result["message"]).toContain("wrap the group in a frame");
  });
});

describe("setAnnotation", () => {
  it("appends and resolves a category by label, case-insensitively", async () => {
    const rect = addNode("1:1", "RECTANGLE");
    const result = await setAnnotation({ nodeId: "1:1", labelMarkdown: "Hi", category: "accessibility" });
    expect(result["action"]).toBe("created");
    expect(result["name"]).toBe("RECTANGLE 1:1");
    expect(rect.annotations).toEqual([{ labelMarkdown: "Hi", categoryId: "cat-a11y" }]);
  });

  it("lists available categories when the name is unknown", async () => {
    addNode("1:1", "RECTANGLE");
    await expect(setAnnotation({ nodeId: "1:1", labelMarkdown: "Hi", category: "Nope" })).rejects.toThrow(
      /Annotation category "Nope" not found\. Available categories: "Development" \(cat-dev\), "Accessibility" \(cat-a11y\)/,
    );
  });

  it("merges on update: omitted fields are kept", async () => {
    const rect = addNode("1:1", "RECTANGLE", null, [
      { labelMarkdown: "Keep me", categoryId: "cat-dev", properties: [{ type: "fills" }] },
      { labelMarkdown: "Other" },
    ]);
    await setAnnotation({ nodeId: "1:1", index: 0, category: "Accessibility" });
    expect(rect.annotations[0]).toEqual({
      labelMarkdown: "Keep me",
      categoryId: "cat-a11y",
      properties: [{ type: "fills" }],
    });
    expect(rect.annotations[1]).toEqual({ labelMarkdown: "Other" });

    await setAnnotation({ nodeId: "1:1", index: 0, labelMarkdown: "New text" });
    expect(rect.annotations[0]).toMatchObject({ labelMarkdown: "New text", categoryId: "cat-a11y" });
  });

  it("clears the category with an empty string and properties with []", async () => {
    const rect = addNode("1:1", "RECTANGLE", null, [
      { labelMarkdown: "x", categoryId: "cat-dev", properties: [{ type: "fills" }] },
    ]);
    await setAnnotation({ nodeId: "1:1", index: 0, category: "", properties: [] });
    expect(rect.annotations[0]).toEqual({ labelMarkdown: "x" });
  });

  it("accepts the deprecated annotationId as an index", async () => {
    const rect = addNode("1:1", "RECTANGLE", null, [{ labelMarkdown: "a" }]);
    const result = await setAnnotation({ nodeId: "1:1", annotationId: "0", labelMarkdown: "b" });
    expect(result["action"]).toBe("updated");
    expect(rect.annotations).toEqual([{ labelMarkdown: "b" }]);
  });

  it("requires labelMarkdown only when appending", async () => {
    addNode("1:1", "RECTANGLE");
    await expect(setAnnotation({ nodeId: "1:1" })).rejects.toThrow(/labelMarkdown is required/);
  });

  it("rejects GROUP with actionable guidance", async () => {
    addNode("1:1", "GROUP");
    await expect(setAnnotation({ nodeId: "1:1", labelMarkdown: "x" })).rejects.toThrow(
      /annotate a child or wrap the group in a frame/,
    );
  });

  it("keeps a plain-label annotation intact when another one is edited", async () => {
    const rect = addNode("1:1", "RECTANGLE", null, [{ label: "Plain", labelMarkdown: "" }, { labelMarkdown: "b" }]);
    await setAnnotation({ nodeId: "1:1", index: 1, labelMarkdown: "c" });
    expect(rect.annotations).toEqual([{ label: "Plain" }, { labelMarkdown: "c" }]);
  });
});

describe("setMultipleAnnotations", () => {
  it("uses the top-level nodeId as the default for entries without one", async () => {
    const a = addNode("1:1", "FRAME");
    const b = addNode("1:2", "TEXT");
    const result = await setMultipleAnnotations({
      nodeId: "1:1",
      annotations: [
        { labelMarkdown: "on default", category: "Development" },
        { nodeId: "1:2", labelMarkdown: "on b" },
      ],
    });
    expect(result["annotationsApplied"]).toBe(2);
    expect(a.annotations).toEqual([{ labelMarkdown: "on default", categoryId: "cat-dev" }]);
    expect(b.annotations).toEqual([{ labelMarkdown: "on b" }]);
    expect((globalThis as any).figma.annotations.getAnnotationCategoriesAsync).toHaveBeenCalledTimes(1);
  });
});

describe("removeAnnotation", () => {
  it("removes one annotation by index", async () => {
    const rect = addNode("1:1", "RECTANGLE", null, [{ labelMarkdown: "a" }, { labelMarkdown: "b" }]);
    const result = await removeAnnotation({ nodeId: "1:1", index: 0 });
    expect(rect.annotations).toEqual([{ labelMarkdown: "b" }]);
    expect(result).toMatchObject({ removedCount: 1, remainingAnnotations: 1 });
  });

  it("removes every annotation with all: true", async () => {
    const rect = addNode("1:1", "RECTANGLE", null, [{ labelMarkdown: "a" }, { labelMarkdown: "b" }]);
    const result = await removeAnnotation({ nodeId: "1:1", all: true });
    expect(rect.annotations).toEqual([]);
    expect(result["removedCount"]).toBe(2);
  });

  it("requires exactly one of index / all", async () => {
    addNode("1:1", "RECTANGLE", null, [{ labelMarkdown: "a" }]);
    await expect(removeAnnotation({ nodeId: "1:1" })).rejects.toThrow(/exactly one of index/);
    await expect(removeAnnotation({ nodeId: "1:1", index: 0, all: true })).rejects.toThrow(/exactly one of index/);
  });

  it("rejects an out-of-range index", async () => {
    addNode("1:1", "RECTANGLE", null, [{ labelMarkdown: "a" }]);
    await expect(removeAnnotation({ nodeId: "1:1", index: 3 })).rejects.toThrow(/valid range: 0-0/);
  });
});

describe("collectAnnotationGroups", () => {
  it("skips category lookups unless asked", async () => {
    addNode("1:1", "FRAME", null, [{ labelMarkdown: "x", categoryId: "cat-dev" }]);
    const { groups } = await collectAnnotationGroups(nodes.get("1:1") as any, { includeChildren: true });
    expect(groups[0].annotations[0]).toMatchObject({ categoryId: "cat-dev" });
    expect(groups[0].annotations[0]["category"]).toBeUndefined();
    expect((globalThis as any).figma.annotations.getAnnotationCategoryByIdAsync).not.toHaveBeenCalled();
  });
});
