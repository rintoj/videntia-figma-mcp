import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCompositeTools } from "../../src/videntia_figma_mcp/tools/composite-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("composite tools", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;
  let toolDescriptions: Map<string, string>;

  beforeEach(() => {
    server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });

    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();
    mockSendCommand.mockResolvedValue({ id: "1:2", name: "Frame", applied: {}, warnings: [] });

    toolHandlers = new Map();
    toolSchemas = new Map();
    toolDescriptions = new Map();

    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, description, schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
        toolDescriptions.set(name, description);
      }
      return (originalTool as any)(...args);
    });

    registerCompositeTools(server);
  });

  async function callTool(toolName: string, args: any) {
    const schema = toolSchemas.get(toolName);
    const handler = toolHandlers.get(toolName);
    if (!schema || !handler) throw new Error(`Tool ${toolName} not found`);
    return await handler(schema.parse(args), { meta: {} });
  }

  const ALL_TOOLS = [
    "create_autolayout_frame",
    "create_styled_text",
    "set_gap",
    "create_card",
    "bulk_bind_variables",
    "clone_and_place",
    "apply_role_preset",
  ];

  describe("registration", () => {
    it("registers all seven composite tools", () => {
      for (const name of ALL_TOOLS) {
        expect(toolHandlers.has(name)).toBe(true);
      }
    });

    it("tells agents to prefer composites over the multi-call sequences", () => {
      expect(toolDescriptions.get("create_autolayout_frame")).toContain("PREFERRED over create_frame");
      expect(toolDescriptions.get("create_styled_text")).toContain("PREFERRED over load_font_async");
      expect(toolDescriptions.get("set_gap")).toContain("spacer rectangles");
      expect(toolDescriptions.get("bulk_bind_variables")).toContain("PREFER this over repeated bind_variable");
      expect(toolDescriptions.get("clone_and_place")).toContain("PREFERRED over clone_node");
    });
  });

  describe("create_autolayout_frame", () => {
    it("sends every layout, fill and radius property in one command", async () => {
      await callTool("create_autolayout_frame", {
        x: 0,
        y: 0,
        width: 320,
        height: 200,
        name: "Panel",
        layoutMode: "VERTICAL",
        padding: { vertical: 16, horizontal: 12 },
        itemSpacing: 8,
        layoutSizingHorizontal: "FILL",
        fillVariable: "background/primary",
        radiusVariable: "radius/md",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("create_autolayout_frame");
      expect(params).toMatchObject({
        name: "Panel",
        layoutMode: "VERTICAL",
        // Every shorthand form is expanded to the four-sided shape before it leaves
        // the server, so the plugin sees one padding dialect.
        padding: { top: 16, right: 12, bottom: 16, left: 12 },
        itemSpacing: 8,
        layoutSizingHorizontal: "FILL",
        fillVariable: "background/primary",
        radiusVariable: "radius/md",
      });
    });

    it("expands the CSS-style array padding shorthand", async () => {
      await callTool("create_autolayout_frame", { layoutMode: "VERTICAL", padding: [8, 16] });
      const [, params] = mockSendCommand.mock.calls[0];
      expect(params.padding).toEqual({ top: 8, right: 16, bottom: 8, left: 16 });
    });

    it("accepts a hex string or rgba object for the raw fill", async () => {
      await callTool("create_autolayout_frame", { fill: "#ff0000" });
      expect(mockSendCommand.mock.calls[0][1].fill).toBe("#ff0000");

      mockSendCommand.mockClear();
      await callTool("create_autolayout_frame", { fill: { r: 1, g: 0, b: 0, a: 1 } });
      expect(mockSendCommand.mock.calls[0][1].fill).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    });

    it("rejects an invalid layout mode", async () => {
      await expect(callTool("create_autolayout_frame", { layoutMode: "DIAGONAL" })).rejects.toThrow();
    });

    it("returns the plugin result as JSON text", async () => {
      mockSendCommand.mockResolvedValue({ id: "5:5", name: "Panel", applied: { layoutMode: "VERTICAL" } });
      const response = await callTool("create_autolayout_frame", { name: "Panel" });
      expect(response.content[0].text).toContain('"id": "5:5"');
      expect(response.content[0].text).toContain("layoutMode");
    });

    it("surfaces plugin errors instead of throwing", async () => {
      mockSendCommand.mockRejectedValue(new Error("Parent node not found with ID: 9:9"));
      const response = await callTool("create_autolayout_frame", { parentId: "9:9" });
      expect(response.content[0].text).toContain("Error creating auto-layout frame");
      expect(response.content[0].text).toContain("Parent node not found");
    });
  });

  describe("create_styled_text", () => {
    it("passes the text style through so the font is loaded plugin-side", async () => {
      await callTool("create_styled_text", {
        text: "Hello",
        textStyle: "text/body/md",
        fillVariable: "foreground",
        parentId: "1:1",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("create_styled_text");
      expect(params).toMatchObject({
        text: "Hello",
        textStyle: "text/body/md",
        fillVariable: "foreground",
      });
    });

    it("requires text", async () => {
      await expect(callTool("create_styled_text", { fontSize: 12 })).rejects.toThrow();
    });
  });

  describe("set_gap", () => {
    it("sends a pixel gap", async () => {
      mockSendCommand.mockResolvedValue({ id: "1:2", itemSpacing: 12 });
      await callTool("set_gap", { nodeId: "1:2", gap: 12 });
      expect(mockSendCommand).toHaveBeenCalledWith("set_gap", expect.objectContaining({ nodeId: "1:2", gap: 12 }));
    });

    it("sends a spacing token instead of a pixel gap", async () => {
      await callTool("set_gap", { nodeId: "1:2", gapVariable: "space/4" });
      expect(mockSendCommand.mock.calls[0][1]).toMatchObject({ gapVariable: "space/4" });
    });

    it("rejects a negative gap", async () => {
      await expect(callTool("set_gap", { nodeId: "1:2", gap: -4 })).rejects.toThrow();
    });
  });

  describe("create_card", () => {
    it("sends a single create_card command with the caller's overrides", async () => {
      mockSendCommand.mockResolvedValue({ id: "3:3", role: "card", applied: {}, warnings: [] });
      const response = await callTool("create_card", { name: "Summary", width: 400, effectStyle: null });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("create_card");
      expect(params).toMatchObject({ name: "Summary", width: 400, effectStyle: null });
      expect(response.content[0].text).toContain('"role": "card"');
    });

    it("does not force the caller to supply any tokens", async () => {
      await callTool("create_card", {});
      expect(mockSendCommand).toHaveBeenCalledTimes(1);
    });
  });

  describe("bulk_bind_variables", () => {
    it("sends all triples in a single round trip", async () => {
      mockSendCommand.mockResolvedValue({
        total: 3,
        succeeded: 3,
        failed: 0,
        results: [
          { index: 0, success: true },
          { index: 1, success: true },
          { index: 2, success: true },
        ],
      });

      const response = await callTool("bulk_bind_variables", {
        bindings: [
          { nodeId: "1:1", field: "fills", variable: "background/primary" },
          { nodeId: "1:2", field: "cornerRadius", variable: "radius/md" },
          { nodeId: "1:3", field: "itemSpacing", variable: "space/4" },
        ],
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("bulk_bind_variables");
      expect(params.bindings).toHaveLength(3);
      expect(params.bindings[0]).toMatchObject({ nodeId: "1:1", field: "fills", variable: "background/primary" });
      expect(response.content[0].text).toContain('"succeeded": 3');
    });

    it("reports per-triple failures without failing the whole call", async () => {
      mockSendCommand.mockResolvedValue({
        total: 2,
        succeeded: 1,
        failed: 1,
        results: [
          { index: 0, success: true, variableName: "background/primary" },
          { index: 1, success: false, error: 'Variable not found: "nope"' },
        ],
      });

      const response = await callTool("bulk_bind_variables", {
        bindings: [
          { nodeId: "1:1", field: "fills", variable: "background/primary" },
          { nodeId: "1:2", field: "fills", variable: "nope" },
        ],
      });

      expect(response.content[0].text).toContain('"failed": 1');
      expect(response.content[0].text).toContain("Variable not found");
    });

    it("rejects an empty bindings array", async () => {
      await expect(callTool("bulk_bind_variables", { bindings: [] })).rejects.toThrow();
    });

    it("rejects a binding missing its variable", async () => {
      await expect(
        callTool("bulk_bind_variables", { bindings: [{ nodeId: "1:1", field: "fills" }] }),
      ).rejects.toThrow();
    });
  });

  describe("clone_and_place", () => {
    it("sends clone, rename, reparent and move as one command", async () => {
      mockSendCommand.mockResolvedValue({ id: "4:4", name: "Row copy", sourceId: "1:1", warnings: [] });
      await callTool("clone_and_place", {
        nodeId: "1:1",
        name: "Row copy",
        parentId: "2:2",
        index: 0,
        x: 10,
        y: 20,
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("clone_and_place");
      expect(params).toMatchObject({ nodeId: "1:1", name: "Row copy", parentId: "2:2", index: 0, x: 10, y: 20 });
    });

    it("rejects a negative child index", async () => {
      await expect(callTool("clone_and_place", { nodeId: "1:1", index: -1 })).rejects.toThrow();
    });
  });

  describe("apply_role_preset", () => {
    it.each(["card", "pill", "sheet", "tap-target"])("accepts the %s role", async (role) => {
      mockSendCommand.mockResolvedValue({ id: "1:1", role, applied: {}, warnings: [] });
      await callTool("apply_role_preset", { nodeId: "1:1", role });
      expect(mockSendCommand).toHaveBeenCalledWith("apply_role_preset", { nodeId: "1:1", role });
    });

    it("rejects an unknown role", async () => {
      await expect(callTool("apply_role_preset", { nodeId: "1:1", role: "banner" })).rejects.toThrow();
    });
  });
});

describe("ROLE_PRESETS", () => {
  // Imported lazily: the plugin module references the Figma sandbox globals only
  // inside function bodies, so importing the constant is safe under Jest.
  const { ROLE_PRESETS, ROLE_NAMES } = require("../../src/videntia_figma_plugin/handlers/composites");

  it("defines exactly the four supported roles in one editable constant", () => {
    expect(ROLE_NAMES.sort()).toEqual(["card", "pill", "sheet", "tap-target"]);
  });

  it("uses house design-system token names, not invented values", () => {
    expect(ROLE_PRESETS.card).toMatchObject({
      fillVariable: "card",
      radiusVariable: "radius/md",
      effectStyle: "shadow/sm",
    });
    expect(ROLE_PRESETS.pill.radiusVariable).toBe("radius/full");
    expect(ROLE_PRESETS.sheet).toMatchObject({ fillVariable: "popover", effectStyle: "shadow/lg" });
  });

  it("gives every role a literal fallback radius for files without tokens", () => {
    for (const role of ROLE_NAMES) {
      expect(typeof ROLE_PRESETS[role].radiusFallback).toBe("number");
    }
  });

  it("enforces a 44px minimum tap target", () => {
    expect(ROLE_PRESETS["tap-target"].minWidth).toBe(44);
    expect(ROLE_PRESETS["tap-target"].minHeight).toBe(44);
  });
});
