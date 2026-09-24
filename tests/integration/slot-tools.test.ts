import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerComponentTools } from "../../src/videntia_figma_mcp/tools/component-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("slot tools", () => {
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockReset();
    toolHandlers = new Map();
    toolSchemas = new Map();
    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, , schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });
    registerComponentTools(server);
  });

  async function callTool(toolName: string, args: any) {
    const schema = toolSchemas.get(toolName)!;
    const handler = toolHandlers.get(toolName)!;
    return await handler(schema.parse(args), { meta: {} });
  }

  describe("create_slot", () => {
    it("forwards layout params and expands the padding shorthand", async () => {
      mockSendCommand.mockResolvedValue({ slotId: "1:9", propertyName: "Slot#1:9", componentId: "1:2" });
      const response = await callTool("create_slot", {
        componentId: "1-2",
        name: "Content",
        layoutMode: "VERTICAL",
        gap: 8,
        padding: [4, 12],
      });
      expect(mockSendCommand).toHaveBeenCalledWith("create_slot", {
        componentId: "1:2",
        name: "Content",
        parentId: undefined,
        index: undefined,
        width: undefined,
        height: undefined,
        layoutMode: "VERTICAL",
        itemSpacing: 8,
        padding: { top: 4, right: 12, bottom: 4, left: 12 },
      });
      expect(response.content[0].text).toContain("Slot#1:9");
    });

    it("rejects GRID layout at the schema", async () => {
      await expect(callTool("create_slot", { componentId: "1:2", layoutMode: "GRID" })).rejects.toThrow();
    });

    it("surfaces a plugin error for a non-component target", async () => {
      mockSendCommand.mockRejectedValue(new Error("create_slot needs a COMPONENT, got: FRAME"));
      const response = await callTool("create_slot", { componentId: "1:3" });
      expect(response.content[0].text).toContain("Error creating slot");
      expect(response.content[0].text).toContain("got: FRAME");
    });
  });

  describe("reset_slot", () => {
    it("forwards the normalized node id", async () => {
      mockSendCommand.mockResolvedValue({ success: true, slotId: "5:6", limitViolations: [] });
      await callTool("reset_slot", { nodeId: "5-6" });
      expect(mockSendCommand).toHaveBeenCalledWith("reset_slot", { nodeId: "5:6" });
    });

    it("reports a non-slot error", async () => {
      mockSendCommand.mockRejectedValue(new Error("reset_slot needs a SLOT node, got: FRAME"));
      const response = await callTool("reset_slot", { nodeId: "5:7" });
      expect(response.content[0].text).toContain("Error resetting slot");
    });
  });

  describe("get_slot_info", () => {
    it("returns limit violations", async () => {
      mockSendCommand.mockResolvedValue({
        nodeId: "7:1",
        type: "INSTANCE",
        slots: [{ slotId: "7:2", childCount: 4, limitViolations: ["ABOVE_MAX"], slotSettings: { maxChildren: 3 } }],
      });
      const response = await callTool("get_slot_info", { nodeId: "7:1" });
      expect(mockSendCommand).toHaveBeenCalledWith("get_slot_info", { nodeId: "7:1" });
      expect(response.content[0].text).toContain("ABOVE_MAX");
    });
  });

  describe("add_component_property", () => {
    it("passes displayEmptyByDefault through slotSettings", async () => {
      mockSendCommand.mockResolvedValue({ nodeId: "1:2", propertyName: "Body#1:3", type: "SLOT", defaultValue: "" });
      await callTool("add_component_property", {
        nodeId: "1:2",
        propertyName: "Body",
        type: "SLOT",
        slotSettings: { displayEmptyByDefault: true, maxChildren: 2 },
      });
      expect(mockSendCommand.mock.calls[0][1].slotSettings).toEqual({ displayEmptyByDefault: true, maxChildren: 2 });
    });
  });
});
