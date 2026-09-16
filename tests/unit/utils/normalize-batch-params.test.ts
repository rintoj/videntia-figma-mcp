import { normalizeCommandParams } from "../../../src/videntia_figma_mcp/utils/normalize-batch-params";

describe("normalizeCommandParams", () => {
  describe("universal node id normalisation", () => {
    it("converts URL-style node ids to API form", () => {
      expect(normalizeCommandParams("rename_node", { nodeId: "65-7554", name: "X" })).toEqual({
        nodeId: "65:7554",
        name: "X",
      });
    });

    it("normalises parentId and nodeIds arrays", () => {
      expect(normalizeCommandParams("delete_multiple_nodes", { nodeIds: ["1-2", "3:4"] }).nodeIds).toEqual([
        "1:2",
        "3:4",
      ]);
      expect(normalizeCommandParams("insert_child", { parentId: "9-9", childId: "8-8" })).toEqual({
        parentId: "9:9",
        childId: "8:8",
      });
    });

    it("leaves $result references untouched", () => {
      expect(normalizeCommandParams("insert_child", { childId: "$result[0].id" }).childId).toBe("$result[0].id");
    });

    it("passes unknown commands through", () => {
      expect(normalizeCommandParams("some_future_command", { foo: "bar" })).toEqual({ foo: "bar" });
    });

    it("handles missing params", () => {
      expect(normalizeCommandParams("rename_node", undefined)).toEqual({});
    });

    it("does not mutate the caller's object", () => {
      const input = { nodeId: "1-2", mode: "vertical" };
      normalizeCommandParams("set_layout_mode", input);
      expect(input).toEqual({ nodeId: "1-2", mode: "vertical" });
    });
  });

  describe("set_layout_mode: mode -> layoutMode", () => {
    it("aliases and upper-cases mode", () => {
      expect(normalizeCommandParams("set_layout_mode", { nodeId: "1:2", mode: "vertical" })).toEqual({
        nodeId: "1:2",
        layoutMode: "VERTICAL",
      });
    });

    it("is idempotent on already-canonical params", () => {
      const canonical = { nodeId: "1:2", layoutMode: "GRID" };
      expect(normalizeCommandParams("set_layout_mode", canonical)).toEqual(canonical);
    });

    it("prefers the canonical key when both are present", () => {
      expect(normalizeCommandParams("set_layout_mode", { layoutMode: "GRID", mode: "VERTICAL" })).toEqual({
        layoutMode: "GRID",
      });
    });

    it("maps rows/columns to grid track counts", () => {
      expect(normalizeCommandParams("set_layout_mode", { mode: "GRID", rows: 2, columns: 3 })).toEqual({
        layoutMode: "GRID",
        gridRowCount: 2,
        gridColumnCount: 3,
      });
    });
  });

  describe("set_line_height: height -> lineHeight", () => {
    it("aliases height and defaults the unit", () => {
      expect(normalizeCommandParams("set_line_height", { nodeId: "1:2", height: 24 })).toEqual({
        nodeId: "1:2",
        lineHeight: 24,
        unit: "PIXELS",
      });
    });

    it("coerces numeric strings and upper-cases the unit", () => {
      expect(normalizeCommandParams("set_line_height", { height: "150", unit: "percent" })).toEqual({
        lineHeight: 150,
        unit: "PERCENT",
      });
    });
  });

  describe("rename_* name aliases", () => {
    it("rename_node accepts newName", () => {
      expect(normalizeCommandParams("rename_node", { nodeId: "1:2", newName: "Card" })).toEqual({
        nodeId: "1:2",
        name: "Card",
      });
    });

    it("rename_variable maps id/name to variableId/newName", () => {
      expect(normalizeCommandParams("rename_variable", { id: "brand/500", name: "brand/600" })).toEqual({
        variableId: "brand/500",
        newName: "brand/600",
      });
    });
  });

  describe("bind_variable: variable/variableName -> variableId", () => {
    it.each(["variable", "variableName"])("accepts %s", (key) => {
      expect(
        normalizeCommandParams("bind_variable", { nodeId: "1:2", [key]: "background/primary", field: "fills/0" }),
      ).toEqual({ nodeId: "1:2", variableId: "background/primary", field: "fills/0" });
    });

    it("accepts property as an alias for field", () => {
      expect(normalizeCommandParams("bind_variable", { variableId: "v", property: "opacity" }).field).toBe("opacity");
    });
  });

  describe("apply_text_style: styleName -> styleId", () => {
    it("routes styleName into styleId (the plugin resolves id or name)", () => {
      expect(normalizeCommandParams("apply_text_style", { nodeId: "1:2", styleName: "body/md" })).toEqual({
        nodeId: "1:2",
        styleId: "body/md",
      });
    });

    it("keeps an explicit styleId", () => {
      expect(normalizeCommandParams("apply_text_style", { styleId: "S:abc,", styleName: "body/md" })).toEqual({
        styleId: "S:abc,",
      });
    });
  });

  describe("set_gradient_fill: type -> gradientType (+ defaults)", () => {
    it("supplies gradientType, angle and opacity", () => {
      expect(normalizeCommandParams("set_gradient_fill", { nodeId: "1:2", type: "linear", stops: [1, 2] })).toEqual({
        nodeId: "1:2",
        gradientType: "LINEAR",
        stops: [1, 2],
        angle: 0,
        opacity: 1,
        // Contract change (bug #30): the standalone tool defaults aspect_correct to true
        // and sends it explicitly, so the batch normaliser mirrors it for wire parity.
        aspect_correct: true,
      });
    });

    it("does not clobber caller-supplied angle/opacity", () => {
      const out = normalizeCommandParams("set_gradient_fill", { gradientType: "RADIAL", angle: 90, opacity: 0.5 });
      expect(out).toEqual({ gradientType: "RADIAL", angle: 90, opacity: 0.5, aspect_correct: true });
    });
  });

  describe("set_corner_radius", () => {
    it("defaults corners to all-true", () => {
      expect(normalizeCommandParams("set_corner_radius", { nodeId: "1:2", radius: 8 }).corners).toEqual([
        true,
        true,
        true,
        true,
      ]);
    });

    it("converts the object form to the [tl, tr, br, bl] array", () => {
      expect(
        normalizeCommandParams("set_corner_radius", {
          radius: 8,
          corners: { topLeft: true, topRight: true, bottomRight: false, bottomLeft: false },
        }).corners,
      ).toEqual([true, true, false, false]);
    });

    it("preserves an explicit array", () => {
      expect(
        normalizeCommandParams("set_corner_radius", { radius: 4, corners: [true, false, false, true] }).corners,
      ).toEqual([true, false, false, true]);
    });
  });

  describe("create_text / create_rectangle defaults", () => {
    it("fills in create_text defaults the standalone tool applies", () => {
      expect(normalizeCommandParams("create_text", { x: 0, y: 0, text: "Hi" })).toEqual({
        x: 0,
        y: 0,
        text: "Hi",
        fontSize: 14,
        fontFamily: "Inter",
        fontWeight: 400,
        fontColor: { r: 0, g: 0, b: 0, a: 1 },
        name: "Hi",
      });
    });

    it("accepts characters as an alias for text", () => {
      expect(normalizeCommandParams("create_text", { characters: "Hello" }).text).toBe("Hello");
    });

    it("aliases fill/color to fillColor on create_rectangle", () => {
      expect(normalizeCommandParams("create_rectangle", { x: 0, y: 0, fill: "#ff0000" })).toMatchObject({
        fillColor: "#ff0000",
        name: "Rectangle",
      });
    });
  });
});
