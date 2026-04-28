import { resolveResultReferences } from "../../../src/hgraph_figma_mcp/utils/resolve-result-references";
import { BatchActionResult } from "../../../src/hgraph_figma_mcp/types";

describe("resolveResultReferences", () => {
  const successResult = (index: number, result: any): BatchActionResult => ({
    index,
    action: "test_action",
    success: true,
    result,
  });

  const failedResult = (index: number, error: string): BatchActionResult => ({
    index,
    action: "test_action",
    success: false,
    error,
  });

  describe("primitives and passthrough", () => {
    it("returns null as-is", () => {
      expect(resolveResultReferences(null, [])).toBeNull();
    });

    it("returns undefined as-is", () => {
      expect(resolveResultReferences(undefined, [])).toBeUndefined();
    });

    it("returns numbers as-is", () => {
      expect(resolveResultReferences(42, [])).toBe(42);
    });

    it("returns booleans as-is", () => {
      expect(resolveResultReferences(true, [])).toBe(true);
    });

    it("returns plain strings as-is", () => {
      expect(resolveResultReferences("hello world", [])).toBe("hello world");
    });

    it("returns strings containing $result in the middle as-is", () => {
      expect(resolveResultReferences("use $result[0].id here", [])).toBe("use $result[0].id here");
    });
  });

  describe("simple field references", () => {
    const results = [
      successResult(0, { id: "node-1", name: "Rectangle" }),
      successResult(1, { id: "node-2", name: "Circle" }),
    ];

    it("resolves $result[0].id", () => {
      expect(resolveResultReferences("$result[0].id", results)).toBe("node-1");
    });

    it("resolves $result[1].name", () => {
      expect(resolveResultReferences("$result[1].name", results)).toBe("Circle");
    });

    it("resolves $result[0] to entire result object", () => {
      expect(resolveResultReferences("$result[0]", results)).toEqual({
        id: "node-1",
        name: "Rectangle",
      });
    });
  });

  describe("nested field access", () => {
    const results = [
      successResult(0, {
        id: "frame-1",
        children: [
          { id: "child-0", name: "First" },
          { id: "child-1", name: "Second", bounds: { x: 10, y: 20 } },
        ],
      }),
    ];

    it("resolves nested array + field path", () => {
      expect(resolveResultReferences("$result[0].children[1].name", results)).toBe("Second");
    });

    it("resolves deeply nested path", () => {
      expect(resolveResultReferences("$result[0].children[1].bounds.x", results)).toBe(10);
    });

    it("resolves array index on children", () => {
      expect(resolveResultReferences("$result[0].children[0].id", results)).toBe("child-0");
    });
  });

  describe("object and array recursion", () => {
    const results = [successResult(0, { id: "node-1" }), successResult(1, { id: "node-2" })];

    it("resolves references inside objects", () => {
      const params = {
        nodeId: "$result[0].id",
        name: "static-name",
        width: 100,
      };
      expect(resolveResultReferences(params, results)).toEqual({
        nodeId: "node-1",
        name: "static-name",
        width: 100,
      });
    });

    it("resolves references inside arrays", () => {
      const params = ["$result[0].id", "$result[1].id", "static"];
      expect(resolveResultReferences(params, results)).toEqual(["node-1", "node-2", "static"]);
    });

    it("resolves references in nested objects", () => {
      const params = {
        outer: {
          inner: "$result[0].id",
          static: true,
        },
      };
      expect(resolveResultReferences(params, results)).toEqual({
        outer: {
          inner: "node-1",
          static: true,
        },
      });
    });

    it("resolves references in arrays inside objects", () => {
      const params = {
        ids: ["$result[0].id", "$result[1].id"],
      };
      expect(resolveResultReferences(params, results)).toEqual({
        ids: ["node-1", "node-2"],
      });
    });
  });

  describe("chained dependencies", () => {
    it("resolves multi-level references (action 2 refs action 1, which refs action 0)", () => {
      const results = [
        successResult(0, { id: "original" }),
        successResult(1, { id: "cloned", parentId: "original" }),
        successResult(2, { id: "cloned", name: "Renamed" }),
      ];

      expect(resolveResultReferences("$result[2].name", results)).toBe("Renamed");
      expect(resolveResultReferences("$result[1].parentId", results)).toBe("original");
    });
  });

  describe("error: referencing future action", () => {
    it("throws when referencing an action that hasn't executed", () => {
      const results = [successResult(0, { id: "node-1" })];

      expect(() => resolveResultReferences("$result[1].id", results)).toThrow(
        "$result[1] references action that hasn't executed yet (only 1 completed)",
      );
    });

    it("throws when referencing index 0 with empty results", () => {
      expect(() => resolveResultReferences("$result[0].id", [])).toThrow(
        "$result[0] references action that hasn't executed yet (only 0 completed)",
      );
    });
  });

  describe("error: referencing failed action", () => {
    it("throws when referencing a failed action", () => {
      const results = [failedResult(0, "Node not found")];

      expect(() => resolveResultReferences("$result[0].id", results)).toThrow(
        "$result[0] references a failed action: Node not found",
      );
    });
  });

  describe("error: null/undefined in path", () => {
    it("throws when accessing field on null", () => {
      const results = [successResult(0, { child: null })];

      expect(() => resolveResultReferences("$result[0].child.name", results)).toThrow(
        "Cannot access '.name' on null/undefined",
      );
    });

    it("throws when accessing field on undefined", () => {
      const results = [successResult(0, { data: {} })];

      expect(() => resolveResultReferences("$result[0].data.missing.deep", results)).toThrow(
        "Cannot access '.deep' on null/undefined",
      );
    });
  });

  describe("depth limit", () => {
    it("throws when field path exceeds max depth of 10", () => {
      const deepObj: any = {};
      let current = deepObj;
      for (let i = 0; i < 11; i++) {
        current[`level${i}`] = {};
        current = current[`level${i}`];
      }
      current.value = "deep";

      const results = [successResult(0, deepObj)];
      const deepPath = "$result[0]" + Array.from({ length: 11 }, (_, i) => `.level${i}`).join("") + ".value";

      expect(() => resolveResultReferences(deepPath, results)).toThrow("Field path exceeds maximum depth of 10");
    });

    it("allows paths at exactly depth 10", () => {
      let deepObj: any = {};
      let current = deepObj;
      for (let i = 0; i < 9; i++) {
        current[`l${i}`] = {};
        current = current[`l${i}`];
      }
      current.val = "found";

      const results = [successResult(0, deepObj)];
      const path = "$result[0]" + Array.from({ length: 9 }, (_, i) => `.l${i}`).join("") + ".val";

      expect(resolveResultReferences(path, results)).toBe("found");
    });
  });

  describe("edge cases", () => {
    it("handles result value of 0", () => {
      const results = [successResult(0, { count: 0 })];
      expect(resolveResultReferences("$result[0].count", results)).toBe(0);
    });

    it("handles result value of empty string", () => {
      const results = [successResult(0, { name: "" })];
      expect(resolveResultReferences("$result[0].name", results)).toBe("");
    });

    it("handles result value of false", () => {
      const results = [successResult(0, { visible: false })];
      expect(resolveResultReferences("$result[0].visible", results)).toBe(false);
    });

    it("returns undefined for missing field without throwing", () => {
      const results = [successResult(0, { id: "node-1" })];
      expect(resolveResultReferences("$result[0].nonexistent", results)).toBeUndefined();
    });

    it("handles array result at top level", () => {
      const results = [successResult(0, ["a", "b", "c"])];
      expect(resolveResultReferences("$result[0][1]", results)).toBe("b");
    });

    it("handles empty object params", () => {
      expect(resolveResultReferences({}, [])).toEqual({});
    });

    it("handles empty array params", () => {
      expect(resolveResultReferences([], [])).toEqual([]);
    });

    it("does not resolve partial $result patterns in longer strings", () => {
      expect(resolveResultReferences("prefix $result[0].id suffix", [])).toBe("prefix $result[0].id suffix");
    });

    it("handles string result value", () => {
      const results = [successResult(0, "just a string")];
      expect(resolveResultReferences("$result[0]", results)).toBe("just a string");
    });
  });
});
