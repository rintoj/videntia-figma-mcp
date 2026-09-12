import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerModificationTools } from "../../src/videntia_figma_mcp/tools/modification-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("new modification tools integration", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });

    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();

    toolHandlers = new Map();
    toolSchemas = new Map();

    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, description, schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });

    registerModificationTools(server);
  });

  async function callTool(toolName: string, args: any) {
    const schema = toolSchemas.get(toolName);
    const handler = toolHandlers.get(toolName);
    if (!schema || !handler) {
      throw new Error(`Tool ${toolName} not found`);
    }
    const validatedArgs = schema.parse(args);
    return await handler(validatedArgs, { meta: {} });
  }

  describe("delete_multiple_nodes", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        deleted: 3,
        nodeIds: ["node-1", "node-2", "node-3"],
      });
    });

    it("successfully deletes multiple nodes", async () => {
      const response = await callTool("delete_multiple_nodes", {
        nodeIds: ["node-1", "node-2", "node-3"],
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("delete_multiple_nodes", {
        nodeIds: ["node-1", "node-2", "node-3"],
      });
      expect(response.content[0].text).toContain("Deleted 3 node(s)");
    });

    it("requires nodeIds parameter", async () => {
      await expect(callTool("delete_multiple_nodes", {})).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("coerces string nodeIds into an array", async () => {
      mockSendCommand.mockResolvedValue({ deleted: ["node-1"] });
      const response = await callTool("delete_multiple_nodes", {
        nodeIds: "node-1",
      });
      expect(mockSendCommand).toHaveBeenCalledWith("delete_multiple_nodes", { nodeIds: ["node-1"] });
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Some nodes not found"));

      const response = await callTool("delete_multiple_nodes", {
        nodeIds: ["invalid-1", "invalid-2"],
      });

      expect(response.content[0].text).toContain("Error deleting multiple nodes");
      expect(response.content[0].text).toContain("Some nodes not found");
    });
  });

  describe("set_grid_child", () => {
    it("sends placement, spans and alignment and reports the applied values", async () => {
      mockSendCommand.mockResolvedValue({
        name: "Card",
        row: 1,
        column: 0,
        rowSpan: 2,
        columnSpan: 3,
        horizontalAlign: "CENTER",
        verticalAlign: "AUTO",
      });
      const response = await callTool("set_grid_child", {
        nodeId: "1-2",
        row: "1",
        column: 0,
        rowSpan: 2,
        columnSpan: 3,
        horizontalAlign: "CENTER",
      });
      expect(mockSendCommand).toHaveBeenCalledWith("set_grid_child", {
        nodeId: "1:2",
        row: 1,
        column: 0,
        rowSpan: 2,
        columnSpan: 3,
        horizontalAlign: "CENTER",
      });
      expect(response.content[0].text).toContain('Placed "Card" at row 1, column 0 (span 2×3');
    });

    it("rejects a call with nothing to set without contacting Figma", async () => {
      const response = await callTool("set_grid_child", { nodeId: "1:2" });
      expect(mockSendCommand).not.toHaveBeenCalled();
      expect(response.content[0].text).toContain("Error setting grid child");
      expect(response.content[0].text).toContain("requires at least one of");
    });

    it("rejects negative indices and zero spans at the schema", () => {
      const schema = toolSchemas.get("set_grid_child")!;
      expect(schema.safeParse({ nodeId: "1:2", row: -1 }).success).toBe(false);
      expect(schema.safeParse({ nodeId: "1:2", columnSpan: 0 }).success).toBe(false);
      expect(schema.safeParse({ nodeId: "1:2", verticalAlign: "STRETCH" }).success).toBe(false);
    });

    it("surfaces plugin errors", async () => {
      mockSendCommand.mockRejectedValue(new Error("is not a child of a GRID auto-layout frame"));
      const response = await callTool("set_grid_child", { nodeId: "1:2", row: 0 });
      expect(response.content[0].text).toContain("not a child of a GRID");
    });
  });

  describe("grid track sizes", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({ name: "Grid", gridRowCount: 1, gridColumnCount: 2 });
    });

    it("set_layout_mode forwards columnSizes as gridColumnSizes", async () => {
      await callTool("set_layout_mode", {
        nodeId: "1:2",
        mode: "GRID",
        columns: 2,
        columnSizes: '[{"type":"FIXED","value":"240"},{"type":"FLEX"}]',
      });
      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_mode", {
        nodeId: "1:2",
        layoutMode: "GRID",
        gridColumnCount: 2,
        gridColumnSizes: [{ type: "FIXED", value: 240 }, { type: "FLEX" }],
      });
    });

    it("set_auto_layout forwards rowSizes and rejects them outside GRID", async () => {
      await callTool("set_auto_layout", { nodeId: "1:2", mode: "GRID", rowSizes: [{ type: "HUG" }] });
      expect(mockSendCommand).toHaveBeenCalledWith(
        "set_auto_layout",
        expect.objectContaining({ layoutMode: "GRID", gridRowSizes: [{ type: "HUG" }] }),
      );

      mockSendCommand.mockClear();
      const response = await callTool("set_auto_layout", {
        nodeId: "1:2",
        mode: "VERTICAL",
        rowSizes: [{ type: "HUG" }],
      });
      expect(mockSendCommand).not.toHaveBeenCalled();
      expect(response.content[0].text).toContain("apply to GRID mode only");
    });

    it("rejects unknown track types at the schema", () => {
      const schema = toolSchemas.get("set_layout_mode")!;
      expect(schema.safeParse({ nodeId: "1:2", mode: "GRID", rowSizes: [{ type: "AUTO" }] }).success).toBe(false);
    });
  });

  describe("set_layout_mode", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        name: "Auto Layout Frame",
      });
    });

    it("successfully sets layout mode to HORIZONTAL", async () => {
      const response = await callTool("set_layout_mode", {
        nodeId: "frame-123",
        mode: "HORIZONTAL",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_mode", {
        nodeId: "frame-123",
        layoutMode: "HORIZONTAL",
        layoutWrap: "NO_WRAP",
      });
      expect(response.content[0].text).toContain("Set layout mode");
      expect(response.content[0].text).toContain("Auto Layout Frame");
      expect(response.content[0].text).toContain("HORIZONTAL");
    });

    it("successfully sets layout mode to VERTICAL", async () => {
      const response = await callTool("set_layout_mode", {
        nodeId: "frame-123",
        mode: "VERTICAL",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_mode", {
        nodeId: "frame-123",
        layoutMode: "VERTICAL",
        layoutWrap: "NO_WRAP",
      });
    });

    it("successfully sets layout mode to NONE", async () => {
      const response = await callTool("set_layout_mode", {
        nodeId: "frame-123",
        mode: "NONE",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_mode", {
        nodeId: "frame-123",
        layoutMode: "NONE",
        layoutWrap: "NO_WRAP",
      });
    });

    it("accepts layoutWrap parameter", async () => {
      await callTool("set_layout_mode", {
        nodeId: "frame-123",
        mode: "HORIZONTAL",
        wrap: "WRAP",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_mode", {
        nodeId: "frame-123",
        layoutMode: "HORIZONTAL",
        layoutWrap: "WRAP",
      });
    });

    it("successfully sets layout mode to GRID", async () => {
      const response = await callTool("set_layout_mode", {
        nodeId: "frame-123",
        mode: "GRID",
      });

      // layoutWrap is a flex concept and is omitted for GRID.
      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_mode", {
        nodeId: "frame-123",
        layoutMode: "GRID",
      });
      expect(response.content[0].text).toContain("GRID");
    });

    it("forwards grid track counts and reports them", async () => {
      mockSendCommand.mockResolvedValue({
        name: "Perks",
        gridRowCount: 2,
        gridColumnCount: 3,
      });

      const response = await callTool("set_layout_mode", {
        nodeId: "frame-123",
        mode: "GRID",
        rows: 2,
        columns: 3,
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_mode", {
        nodeId: "frame-123",
        layoutMode: "GRID",
        gridRowCount: 2,
        gridColumnCount: 3,
      });
      expect(response.content[0].text).toContain("2 rows × 3 columns");
    });

    it("rejects rows/columns on non-GRID modes without calling Figma", async () => {
      const response = await callTool("set_layout_mode", {
        nodeId: "frame-123",
        mode: "HORIZONTAL",
        columns: 3,
      });

      expect(mockSendCommand).not.toHaveBeenCalled();
      expect(response.content[0].text).toContain("GRID mode only");
    });

    it("rejects wrap on GRID rather than silently dropping it", async () => {
      const response = await callTool("set_layout_mode", {
        nodeId: "frame-123",
        mode: "GRID",
        wrap: "WRAP",
      });

      expect(mockSendCommand).not.toHaveBeenCalled();
      expect(response.content[0].text).toContain("does not apply to GRID");
    });

    it("requires nodeId and layoutMode parameters", async () => {
      await expect(
        callTool("set_layout_mode", {
          nodeId: "frame-123",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    describe("set_auto_layout GRID support", () => {
      it("forwards grid tracks and gaps", async () => {
        mockSendCommand.mockResolvedValue({
          name: "Perks",
          layoutMode: "GRID",
          gridRowGap: 48,
          gridColumnGap: 24,
        });

        await callTool("set_auto_layout", {
          nodeId: "frame-123",
          mode: "GRID",
          rows: 2,
          columns: 3,
          rowGap: 48,
          columnGap: 24,
        });

        const [command, params] = mockSendCommand.mock.calls[0];
        expect(command).toBe("set_auto_layout");
        expect(params.layoutMode).toBe("GRID");
        expect(params.gridRowCount).toBe(2);
        expect(params.gridColumnCount).toBe(3);
        expect(params.gridRowGap).toBe(48);
        expect(params.gridColumnGap).toBe(24);
      });

      it("passes gap through as the shorthand for GRID", async () => {
        mockSendCommand.mockResolvedValue({ name: "Perks", layoutMode: "GRID" });

        await callTool("set_auto_layout", {
          nodeId: "frame-123",
          mode: "GRID",
          gap: 48,
        });

        const [, params] = mockSendCommand.mock.calls[0];
        expect(params.itemSpacing).toBe(48);
        expect(params.gridRowGap).toBeUndefined();
      });

      it("rejects grid params on non-GRID modes without calling Figma", async () => {
        const response = await callTool("set_auto_layout", {
          nodeId: "frame-123",
          mode: "VERTICAL",
          columns: 3,
        });

        expect(mockSendCommand).not.toHaveBeenCalled();
        expect(response.content[0].text).toContain("GRID mode only");
      });

      it("rejects flex-only params on GRID rather than silently dropping them", async () => {
        const response = await callTool("set_auto_layout", {
          nodeId: "frame-123",
          mode: "GRID",
          counterAxisAlignItems: "CENTER",
          wrap: "WRAP",
        });

        expect(mockSendCommand).not.toHaveBeenCalled();
        expect(response.content[0].text).toContain("counterAxisAlignItems/wrap");
        expect(response.content[0].text).toContain("do not apply to GRID");
      });

      it("still accepts padding and sizing alongside GRID", async () => {
        mockSendCommand.mockResolvedValue({ name: "Perks", layoutMode: "GRID" });

        await callTool("set_auto_layout", {
          nodeId: "frame-123",
          mode: "GRID",
          top: 16,
          horizontal: "FILL",
        });

        const [, params] = mockSendCommand.mock.calls[0];
        expect(params.paddingTop).toBe(16);
        expect(params.layoutSizingHorizontal).toBe("FILL");
      });
    });

    it("rejects invalid layoutMode values", async () => {
      await expect(
        callTool("set_layout_mode", {
          nodeId: "frame-123",
          mode: "INVALID",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node is not a frame"));

      const response = await callTool("set_layout_mode", {
        nodeId: "text-123",
        mode: "HORIZONTAL",
      });

      expect(response.content[0].text).toContain("Error setting layout mode");
      expect(response.content[0].text).toContain("Node is not a frame");
    });
  });

  describe("reorder_grid_tracks", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        name: "Grid Frame",
        moves: [{ from: 0, to: 2 }],
      });
    });

    it("successfully reorders grid columns", async () => {
      const response = await callTool("reorder_grid_tracks", {
        nodeId: "grid-123",
        axis: "COLUMN",
        fromIndices: [0],
        insertionIndex: 2,
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("reorder_grid_tracks", {
        nodeId: "grid-123",
        axis: "COLUMN",
        fromIndices: [0],
        insertionIndex: 2,
      });
      expect(response.content[0].text).toContain("Reordered columns");
      expect(response.content[0].text).toContain("Grid Frame");
      expect(response.content[0].text).toContain("0→2");
    });

    it("rejects an invalid axis value", async () => {
      await expect(
        callTool("reorder_grid_tracks", {
          nodeId: "grid-123",
          axis: "DIAGONAL",
          fromIndices: [0],
          insertionIndex: 1,
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node is not in GRID mode"));

      const response = await callTool("reorder_grid_tracks", {
        nodeId: "grid-123",
        axis: "ROW",
        fromIndices: [0, 1],
        insertionIndex: 3,
      });

      expect(response.content[0].text).toContain("Error reordering grid tracks");
      expect(response.content[0].text).toContain("Node is not in GRID mode");
    });
  });

  describe("set_padding", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        name: "Padded Frame",
      });
    });

    it("successfully sets all padding values", async () => {
      const response = await callTool("set_padding", {
        nodeId: "frame-123",
        top: 10,
        right: 20,
        bottom: 10,
        left: 20,
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_padding", {
        nodeId: "frame-123",
        paddingTop: 10,
        paddingRight: 20,
        paddingBottom: 10,
        paddingLeft: 20,
      });
      expect(response.content[0].text).toContain("padding");
      expect(response.content[0].text).toContain("Padded Frame");
      expect(response.content[0].text).toContain("top: 10");
      expect(response.content[0].text).toContain("right: 20");
    });

    it("successfully sets individual padding values", async () => {
      const response = await callTool("set_padding", {
        nodeId: "frame-123",
        top: 15,
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_padding", {
        nodeId: "frame-123",
        paddingTop: 15,
        paddingRight: undefined,
        paddingBottom: undefined,
        paddingLeft: undefined,
      });
      expect(response.content[0].text).toContain("top: 15");
    });

    it("requires nodeId parameter", async () => {
      await expect(
        callTool("set_padding", {
          top: 10,
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Not an auto-layout frame"));

      const response = await callTool("set_padding", {
        nodeId: "frame-123",
        top: 10,
      });

      expect(response.content[0].text).toContain("Error setting padding");
      expect(response.content[0].text).toContain("Not an auto-layout frame");
    });
  });

  describe("set_axis_align", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        name: "Aligned Frame",
      });
    });

    it("successfully sets primary axis alignment", async () => {
      const response = await callTool("set_axis_align", {
        nodeId: "frame-123",
        primaryAxisAlignItems: "CENTER",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_axis_align", {
        nodeId: "frame-123",
        primaryAxisAlignItems: "CENTER",
        counterAxisAlignItems: undefined,
      });
      expect(response.content[0].text).toContain("axis alignment");
      expect(response.content[0].text).toContain("primary: CENTER");
    });

    it("successfully sets counter axis alignment", async () => {
      const response = await callTool("set_axis_align", {
        nodeId: "frame-123",
        counterAxisAlignItems: "MAX",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_axis_align", {
        nodeId: "frame-123",
        primaryAxisAlignItems: undefined,
        counterAxisAlignItems: "MAX",
      });
      expect(response.content[0].text).toContain("counter: MAX");
    });

    it("successfully sets both axis alignments", async () => {
      const response = await callTool("set_axis_align", {
        nodeId: "frame-123",
        primaryAxisAlignItems: "SPACE_BETWEEN",
        counterAxisAlignItems: "BASELINE",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_axis_align", {
        nodeId: "frame-123",
        primaryAxisAlignItems: "SPACE_BETWEEN",
        counterAxisAlignItems: "BASELINE",
      });
      expect(response.content[0].text).toContain("primary: SPACE_BETWEEN");
      expect(response.content[0].text).toContain("counter: BASELINE");
    });

    it("requires nodeId parameter", async () => {
      await expect(
        callTool("set_axis_align", {
          primaryAxisAlignItems: "CENTER",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects invalid alignment values", async () => {
      await expect(
        callTool("set_axis_align", {
          nodeId: "frame-123",
          primaryAxisAlignItems: "INVALID",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Not an auto-layout frame"));

      const response = await callTool("set_axis_align", {
        nodeId: "frame-123",
        primaryAxisAlignItems: "CENTER",
      });

      expect(response.content[0].text).toContain("Error setting axis alignment");
    });
  });

  describe("set_layout_sizing", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        name: "Sized Frame",
      });
    });

    it("successfully sets horizontal sizing", async () => {
      const response = await callTool("set_layout_sizing", {
        nodeId: "frame-123",
        horizontal: "HUG",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_sizing", {
        nodeId: "frame-123",
        layoutSizingHorizontal: "HUG",
        layoutSizingVertical: undefined,
      });
      expect(response.content[0].text).toContain("layout sizing");
      expect(response.content[0].text).toContain("horizontal: HUG");
    });

    it("successfully sets vertical sizing", async () => {
      const response = await callTool("set_layout_sizing", {
        nodeId: "frame-123",
        vertical: "FILL",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_sizing", {
        nodeId: "frame-123",
        layoutSizingHorizontal: undefined,
        layoutSizingVertical: "FILL",
      });
      expect(response.content[0].text).toContain("vertical: FILL");
    });

    it("successfully sets both sizing modes", async () => {
      const response = await callTool("set_layout_sizing", {
        nodeId: "frame-123",
        horizontal: "FIXED",
        vertical: "HUG",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_layout_sizing", {
        nodeId: "frame-123",
        layoutSizingHorizontal: "FIXED",
        layoutSizingVertical: "HUG",
      });
      expect(response.content[0].text).toContain("horizontal: FIXED");
      expect(response.content[0].text).toContain("vertical: HUG");
    });

    it("requires nodeId parameter", async () => {
      await expect(
        callTool("set_layout_sizing", {
          horizontal: "HUG",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects invalid sizing values", async () => {
      await expect(
        callTool("set_layout_sizing", {
          nodeId: "frame-123",
          horizontal: "INVALID",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Cannot set sizing"));

      const response = await callTool("set_layout_sizing", {
        nodeId: "frame-123",
        horizontal: "HUG",
      });

      expect(response.content[0].text).toContain("Error setting layout sizing");
    });
  });

  describe("set_item_spacing", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        name: "Spaced Frame",
        gap: 10,
        counterAxisSpacing: 20,
      });
    });

    it("successfully sets item spacing", async () => {
      const response = await callTool("set_item_spacing", {
        nodeId: "frame-123",
        gap: 10,
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_item_spacing", {
        nodeId: "frame-123",
        itemSpacing: 10,
      });
      expect(response.content[0].text).toContain("Updated spacing");
      expect(response.content[0].text).toContain("Spaced Frame");
      expect(response.content[0].text).toContain("gap=10");
    });

    it("forwards rowGap/columnGap for GRID frames", async () => {
      mockSendCommand.mockResolvedValue({
        name: "Perks",
        layoutMode: "GRID",
        gridRowGap: 48,
        gridColumnGap: 24,
      });

      const response = await callTool("set_item_spacing", {
        nodeId: "frame-123",
        rowGap: 48,
        columnGap: 24,
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_item_spacing", {
        nodeId: "frame-123",
        gridRowGap: 48,
        gridColumnGap: 24,
      });
      expect(response.content[0].text).toContain("rowGap=48");
      expect(response.content[0].text).toContain("columnGap=24");
    });

    it("reports grid gaps rather than gap when the frame is a GRID", async () => {
      mockSendCommand.mockResolvedValue({
        name: "Perks",
        layoutMode: "GRID",
        gridRowGap: 48,
        gridColumnGap: 48,
      });

      // `gap` is the shorthand — the plugin applies it to both axes.
      const response = await callTool("set_item_spacing", {
        nodeId: "frame-123",
        gap: 48,
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_item_spacing", {
        nodeId: "frame-123",
        itemSpacing: 48,
      });
      expect(response.content[0].text).toContain("rowGap=48");
      expect(response.content[0].text).toContain("columnGap=48");
      // The flex-shaped "gap=48" wording must not appear for a grid frame.
      expect(response.content[0].text).not.toMatch(/\bgap=48/);
    });

    it("surfaces the plugin's guidance when grid params hit a flex frame", async () => {
      mockSendCommand.mockRejectedValue(
        new Error('Frame "Card" has VERTICAL layout — rowGap/columnGap apply to GRID frames only. Use gap instead.'),
      );

      const response = await callTool("set_item_spacing", {
        nodeId: "frame-123",
        rowGap: 48,
      });

      expect(response.content[0].text).toContain("GRID frames only");
      expect(response.content[0].text).toContain("Use gap instead");
    });

    it("successfully sets counter axis spacing", async () => {
      const response = await callTool("set_item_spacing", {
        nodeId: "frame-123",
        counterAxisSpacing: 20,
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_item_spacing", {
        nodeId: "frame-123",
        counterAxisSpacing: 20,
      });
      expect(response.content[0].text).toContain("counterAxisSpacing=20");
    });

    it("successfully sets both spacing values", async () => {
      const response = await callTool("set_item_spacing", {
        nodeId: "frame-123",
        gap: 10,
        counterAxisSpacing: 20,
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_item_spacing", {
        nodeId: "frame-123",
        itemSpacing: 10,
        counterAxisSpacing: 20,
      });
      expect(response.content[0].text).toContain("gap=10");
      expect(response.content[0].text).toContain("counterAxisSpacing=20");
    });

    it("requires nodeId parameter", async () => {
      await expect(
        callTool("set_item_spacing", {
          gap: 10,
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Not an auto-layout frame"));

      const response = await callTool("set_item_spacing", {
        nodeId: "frame-123",
        gap: 10,
      });

      expect(response.content[0].text).toContain("Error setting item spacing");
      expect(response.content[0].text).toContain("Not an auto-layout frame");
    });
  });

  describe("set_image_fill", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        id: "rect-123",
        name: "Image Rectangle",
        imageHash: "abc123def456",
        imageSize: { width: 800, height: 600 },
        scaleMode: "FILL",
      });
    });

    it("successfully sets image fill from URL", async () => {
      const response = await callTool("set_image_fill", {
        nodeId: "rect-123",
        imageUrl: "https://picsum.photos/800/600",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_image_fill", {
        nodeId: "rect-123",
        imageUrl: "https://picsum.photos/800/600",
        scaleMode: "FILL",
        rotation: undefined,
        exposure: undefined,
        contrast: undefined,
        saturation: undefined,
        temperature: undefined,
        tint: undefined,
        highlights: undefined,
        shadows: undefined,
      });
      expect(response.content[0].text).toContain("Set image fill");
      expect(response.content[0].text).toContain("Image Rectangle");
      expect(response.content[0].text).toContain("800x600");
      expect(response.content[0].text).toContain("FILL");
    });

    it("successfully sets image fill with FIT scale mode", async () => {
      mockSendCommand.mockResolvedValue({
        id: "rect-123",
        name: "Image Rectangle",
        imageHash: "abc123def456",
        imageSize: { width: 800, height: 600 },
        scaleMode: "FIT",
      });

      const response = await callTool("set_image_fill", {
        nodeId: "rect-123",
        imageUrl: "https://picsum.photos/800/600",
        scaleMode: "FIT",
      });

      expect(mockSendCommand).toHaveBeenCalledWith(
        "set_image_fill",
        expect.objectContaining({
          nodeId: "rect-123",
          imageUrl: "https://picsum.photos/800/600",
          scaleMode: "FIT",
        }),
      );
      expect(response.content[0].text).toContain("FIT");
    });

    it("successfully sets image fill with CROP scale mode", async () => {
      mockSendCommand.mockResolvedValue({
        id: "rect-123",
        name: "Image Rectangle",
        imageHash: "abc123def456",
        imageSize: { width: 800, height: 600 },
        scaleMode: "CROP",
      });

      const response = await callTool("set_image_fill", {
        nodeId: "rect-123",
        imageUrl: "https://picsum.photos/800/600",
        scaleMode: "CROP",
      });

      expect(mockSendCommand).toHaveBeenCalledWith(
        "set_image_fill",
        expect.objectContaining({
          scaleMode: "CROP",
        }),
      );
    });

    it("successfully sets image fill with TILE scale mode", async () => {
      mockSendCommand.mockResolvedValue({
        id: "rect-123",
        name: "Image Rectangle",
        imageHash: "abc123def456",
        imageSize: { width: 800, height: 600 },
        scaleMode: "TILE",
      });

      const response = await callTool("set_image_fill", {
        nodeId: "rect-123",
        imageUrl: "https://picsum.photos/800/600",
        scaleMode: "TILE",
      });

      expect(mockSendCommand).toHaveBeenCalledWith(
        "set_image_fill",
        expect.objectContaining({
          scaleMode: "TILE",
        }),
      );
    });

    it("successfully sets image fill with filters", async () => {
      const response = await callTool("set_image_fill", {
        nodeId: "rect-123",
        imageUrl: "https://picsum.photos/800/600",
        exposure: 0.2,
        contrast: 0.1,
        saturation: -0.3,
      });

      expect(mockSendCommand).toHaveBeenCalledWith(
        "set_image_fill",
        expect.objectContaining({
          nodeId: "rect-123",
          imageUrl: "https://picsum.photos/800/600",
          exposure: 0.2,
          contrast: 0.1,
          saturation: -0.3,
        }),
      );
    });

    it("requires nodeId parameter", async () => {
      await expect(
        callTool("set_image_fill", {
          imageUrl: "https://picsum.photos/800/600",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("requires either imageUrl or imageBytes", async () => {
      const response = await callTool("set_image_fill", {
        nodeId: "rect-123",
      });
      expect(response.content[0].text).toContain("Provide either imageUrl or imageBytes");
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects both imageUrl and imageBytes together", async () => {
      const response = await callTool("set_image_fill", {
        nodeId: "rect-123",
        imageUrl: "https://picsum.photos/800/600",
        imageBytes: "aGVsbG8=",
      });
      expect(response.content[0].text).toContain("Provide only one of imageUrl or imageBytes");
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("successfully sets image fill from imageBytes", async () => {
      const response = await callTool("set_image_fill", {
        nodeId: "rect-123",
        imageBytes: "aGVsbG8=",
      });

      expect(mockSendCommand).toHaveBeenCalledWith(
        "set_image_fill",
        expect.objectContaining({
          nodeId: "rect-123",
          imageBytes: "aGVsbG8=",
          scaleMode: "FILL",
        }),
      );
      expect(response.content[0].text).toContain("Set image fill");
    });

    it("requires valid URL for imageUrl", async () => {
      await expect(
        callTool("set_image_fill", {
          nodeId: "rect-123",
          imageUrl: "not-a-valid-url",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects invalid scaleMode values", async () => {
      await expect(
        callTool("set_image_fill", {
          nodeId: "rect-123",
          imageUrl: "https://picsum.photos/800/600",
          scaleMode: "INVALID",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects filter values outside valid range", async () => {
      await expect(
        callTool("set_image_fill", {
          nodeId: "rect-123",
          imageUrl: "https://picsum.photos/800/600",
          exposure: 2.0, // Must be between -1 and 1
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles CORS/network errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(
        new Error("Failed to fetch image from URL. This may be due to CORS restrictions"),
      );

      const response = await callTool("set_image_fill", {
        nodeId: "rect-123",
        imageUrl: "https://blocked-domain.com/image.png",
      });

      expect(response.content[0].text).toContain("Error setting image fill");
      expect(response.content[0].text).toContain("CORS");
    });

    it("handles node not found errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node not found with ID: invalid-123"));

      const response = await callTool("set_image_fill", {
        nodeId: "invalid-123",
        imageUrl: "https://picsum.photos/800/600",
      });

      expect(response.content[0].text).toContain("Error setting image fill");
      expect(response.content[0].text).toContain("Node not found");
    });

    it("handles unsupported node type errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node does not support fills"));

      const response = await callTool("set_image_fill", {
        nodeId: "text-123",
        imageUrl: "https://picsum.photos/800/600",
      });

      expect(response.content[0].text).toContain("Error setting image fill");
      expect(response.content[0].text).toContain("does not support fills");
    });
  });
});
