import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCompositeTools } from "../../src/videntia_figma_mcp/tools/composite-tools";
import { registerCreationTools } from "../../src/videntia_figma_mcp/tools/creation-tools";
import { resolveFrameLayout, expandPadding } from "../../src/videntia_figma_mcp/utils/frame-layout";
import { ALLOWED_COMMANDS } from "../../src/videntia_figma_plugin/ui/constants";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
  getOpenChannels: jest.fn(),
}));

const ws = require("../../src/videntia_figma_mcp/utils/websocket");

describe("plural / one-call APIs", () => {
  let mockSend: jest.Mock;
  let handlers: Map<string, Function>;
  let schemas: Map<string, z.ZodObject<any>>;
  let descriptions: Map<string, string>;

  beforeEach(() => {
    const server = new McpServer({ name: "t", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSend = ws.sendCommandToFigma as jest.Mock;
    mockSend.mockClear();
    mockSend.mockResolvedValue({ id: "1:2", name: "Frame", ids: ["1:3"], results: [] });

    handlers = new Map();
    schemas = new Map();
    descriptions = new Map();
    const original = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        handlers.set(args[0], args[3]);
        schemas.set(args[0], z.object(args[2]));
        descriptions.set(args[0], args[1]);
      }
      return (original as any)(...args);
    });
    registerCompositeTools(server);
    registerCreationTools(server);
  });

  async function call(name: string, args: any) {
    const schema = schemas.get(name);
    const handler = handlers.get(name);
    if (!schema || !handler) throw new Error(`Tool ${name} not registered`);
    return await handler(schema.parse(args), { meta: {} });
  }

  const NEW_TOOLS = ["bind_many", "create_texts", "create_svgs", "insert_children", "move_nodes"];

  describe("registration", () => {
    it("registers every new plural tool", () => {
      for (const name of NEW_TOOLS) expect(handlers.has(name)).toBe(true);
    });

    it("allowlists every new plugin command", () => {
      for (const name of NEW_TOOLS) expect(ALLOWED_COMMANDS.has(name)).toBe(true);
    });

    it("steers agents away from the singular hand-loop", () => {
      for (const name of NEW_TOOLS) {
        expect(descriptions.get(name)).toMatch(/ALWAYS PREFER this over/);
      }
    });
  });

  // -------------------------------------------------------------------------
  // C2 — one frame constructor
  // -------------------------------------------------------------------------
  describe("create_frame one-call form", () => {
    it("advertises the nested layout/size form and warns off the follow-ups", () => {
      const d = descriptions.get("create_frame")!;
      expect(d).toMatch(/ONE call/);
      expect(d).toMatch(/NEVER follow a create_frame with set_auto_layout/);
      expect(d).toContain("create_autolayout_frame");
    });

    it("applies a whole nested layout in one round trip", async () => {
      await call("create_frame", {
        name: "Row",
        parentId: "1:1",
        size: { width: 320, height: 64 },
        layout: {
          mode: "HORIZONTAL",
          sizing: { horizontal: "FILL", vertical: "HUG" },
          padding: { vertical: 8, horizontal: 16 },
          gap: 12,
          align: { primary: "SPACE_BETWEEN", counter: "CENTER" },
          wrap: true,
        },
      });
      const [cmd, params] = mockSend.mock.calls[0] as [string, any];
      expect(cmd).toBe("create_frame");
      expect(params).toMatchObject({
        width: 320,
        height: 64,
        layoutMode: "HORIZONTAL",
        layoutWrap: "WRAP",
        itemSpacing: 12,
        paddingTop: 8,
        paddingBottom: 8,
        paddingLeft: 16,
        paddingRight: 16,
        primaryAxisAlignItems: "SPACE_BETWEEN",
        counterAxisAlignItems: "CENTER",
        layoutSizingHorizontal: "FILL",
        layoutSizingVertical: "HUG",
      });
    });

    it("still honours the flat spelling, and x/y/width/height are optional", async () => {
      await call("create_frame", { layoutMode: "VERTICAL", gap: 4, padding: 8, horizontal: "FILL" });
      const params = mockSend.mock.calls[0][1];
      expect(params).toMatchObject({
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        layoutMode: "VERTICAL",
        itemSpacing: 4,
        paddingTop: 8,
        paddingLeft: 8,
        layoutSizingHorizontal: "FILL",
      });
    });

    it("create_autolayout_frame accepts the same nested spelling", async () => {
      await call("create_autolayout_frame", {
        size: { width: 200 },
        layout: { mode: "VERTICAL", sizing: "FILL", gap: 6, padding: 10, align: { counter: "CENTER" } },
      });
      const [cmd, params] = mockSend.mock.calls[0] as [string, any];
      expect(cmd).toBe("create_autolayout_frame");
      expect(params).toMatchObject({
        width: 200,
        layoutMode: "VERTICAL",
        itemSpacing: 6,
        padding: { top: 10, right: 10, bottom: 10, left: 10 },
        counterAxisAlignItems: "CENTER",
        layoutSizingHorizontal: "FILL",
        layoutSizingVertical: "FILL",
      });
    });
  });

  describe("resolveFrameLayout", () => {
    it("lets the nested form win over the flat one", () => {
      const r = resolveFrameLayout({ layout: { mode: "GRID", gap: 2 }, layoutMode: "VERTICAL", gap: 99 });
      expect(r.layoutMode).toBe("GRID");
      expect(r.itemSpacing).toBe(2);
    });
    it("expands padding shorthands", () => {
      expect(expandPadding(6)).toEqual({ top: 6, right: 6, bottom: 6, left: 6 });
      expect(expandPadding({ vertical: 2, left: 5 })).toEqual({ top: 2, right: undefined, bottom: 2, left: 5 });
      expect(expandPadding(undefined)).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // C1 — bind_many
  // -------------------------------------------------------------------------
  describe("bind_many", () => {
    it("sends one nodeId with many field/variable pairs", async () => {
      await call("bind_many", {
        nodeId: "1:5",
        bindings: [
          { field: "fills", variable: "background/primary" },
          { field: "cornerRadius", variable: "radius/md" },
          { field: "itemSpacing", variable: "space/4" },
        ],
      });
      const [cmd, params] = mockSend.mock.calls[0] as [string, any];
      expect(cmd).toBe("bind_many");
      expect(params.nodeId).toBe("1:5");
      expect(params.bindings).toHaveLength(3);
      expect(params.bindings[0]).toEqual({ field: "fills", variable: "background/primary" });
    });

    it("accepts a per-binding nodeId override", async () => {
      await call("bind_many", {
        nodeId: "1:5",
        bindings: [{ field: "fills", variable: "card", nodeId: "1:9" }],
      });
      expect(mockSend.mock.calls[0][1].bindings[0].nodeId).toBe("1:9");
    });
  });

  // -------------------------------------------------------------------------
  // C5 — create_texts / create_svgs
  // -------------------------------------------------------------------------
  describe("create_texts", () => {
    it("fans a shared parentId across items", async () => {
      await call("create_texts", {
        parentId: "1:1",
        items: [{ text: "Label" }, { text: "Value", textStyle: "text/body/md" }],
      });
      const [cmd, params] = mockSend.mock.calls[0] as [string, any];
      expect(cmd).toBe("create_texts");
      expect(params.parentId).toBe("1:1");
      expect(params.items.map((i: any) => i.text)).toEqual(["Label", "Value"]);
    });

    it("says fonts are handled internally", () => {
      expect(descriptions.get("create_texts")).toMatch(/never call load_font_async/i);
    });
  });

  describe("create_svgs", () => {
    it("sends every svg in one call", async () => {
      await call("create_svgs", {
        parentId: "1:1",
        items: [{ svgString: "<svg/>" }, { svgString: "<svg/>", name: "b", flatten: true }],
      });
      const [cmd, params] = mockSend.mock.calls[0] as [string, any];
      expect(cmd).toBe("create_svgs");
      expect(params.items).toHaveLength(2);
      expect(params.items[1].flatten).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // C10 / C11
  // -------------------------------------------------------------------------
  describe("insert_children", () => {
    it("passes the parent, the ordered ids and the start index", async () => {
      await call("insert_children", { parentId: "1:1", childIds: ["1:2", "1:3", "1:4"], index: 0 });
      const [cmd, params] = mockSend.mock.calls[0] as [string, any];
      expect(cmd).toBe("insert_children");
      expect(params).toEqual({ parentId: "1:1", childIds: ["1:2", "1:3", "1:4"], index: 0 });
    });
  });

  describe("move_nodes", () => {
    it("sends every move in one call", async () => {
      await call("move_nodes", {
        moves: [
          { nodeId: "1:2", x: 0, y: 0 },
          { nodeId: "1:3", x: 10, y: 0, parentId: "1:1", index: 2 },
        ],
      });
      const [cmd, params] = mockSend.mock.calls[0] as [string, any];
      expect(cmd).toBe("move_nodes");
      expect(params.moves).toHaveLength(2);
      expect(params.moves[1]).toMatchObject({ nodeId: "1:3", parentId: "1:1", index: 2 });
    });

    it("reports the transport error instead of throwing", async () => {
      mockSend.mockRejectedValueOnce(new Error("boom"));
      const res: any = await call("move_nodes", { moves: [{ nodeId: "1:2", x: 1 }] });
      expect(res.content[0].text).toContain("Error moving nodes: boom");
    });
  });
});
