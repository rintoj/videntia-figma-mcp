process.env.VIDENTIA_FIGMA_TOOLS = "all";

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../src/videntia_figma_mcp/tools";
import { resolveCreateIconParams } from "../../src/videntia_figma_mcp/tools/icon-tools";
import { clearToolRegistry } from "../../src/videntia_figma_mcp/utils/tool-registry";
import { filterNodeData } from "../../src/videntia_figma_mcp/utils/figma-helpers";

// Batched actions are built by running the standalone handler in capture mode.
jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => {
  const { createCaptureAwareSend } = require("../helpers/capture-aware-websocket");
  return {
    sendCommandToFigma: createCaptureAwareSend(),
    sendCommandToChannel: jest.fn(),
    connectToFigma: jest.fn(),
    joinChannel: jest.fn(),
    getOpenChannels: jest.fn(async () => []),
    getCurrentChannel: jest.fn(() => "test-channel"),
  };
});

describe("constraints tools", () => {
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
      const handler = args[args.length - 1];
      const schema = args.find((arg, i) => i > 0 && i < args.length - 1 && arg && typeof arg === "object");
      toolHandlers.set(args[0], handler);
      toolSchemas.set(args[0], z.object(schema ?? {}));
      return (originalTool as any)(...args);
    });
    clearToolRegistry();
    registerTools(server);
  });

  const sentCalls = () => mockSendCommand.mock.calls.map((c: unknown[]) => [c[0], c[1]]);

  async function callTool(toolName: string, args: any) {
    const schema = toolSchemas.get(toolName);
    const handler = toolHandlers.get(toolName);
    if (!schema || !handler) throw new Error(`Tool ${toolName} not found`);
    return await handler(schema.parse(args), { meta: {} });
  }

  describe("set_constraints", () => {
    it("sends normalized ids and axes and reports each node", async () => {
      mockSendCommand.mockResolvedValue({
        success: true,
        updated: 2,
        failed: 0,
        results: [
          { nodeId: "1:2", name: "Glyph", success: true, constraints: { horizontal: "CENTER", vertical: "CENTER" } },
          {
            nodeId: "3:4",
            name: "Row child",
            success: true,
            constraints: { horizontal: "CENTER", vertical: "MIN" },
            warning: '"Row child" is an auto-layout child of "Row" (layoutPositioning AUTO)',
          },
        ],
      });
      const response = await callTool("set_constraints", { nodeIds: ["1-2", "3-4"], horizontal: "CENTER" });
      expect(sentCalls()).toContainEqual([
        "set_constraints",
        {
          nodeIds: ["1:2", "3:4"],
          horizontal: "CENTER",
        },
      ]);
      const text = response.content[0].text;
      expect(text).toContain("Updated constraints on 2 of 2 node(s)");
      expect(text).toContain("Glyph (1:2): horizontal CENTER, vertical CENTER");
      expect(text).toContain('warning: "Row child" is an auto-layout child');
    });

    it("accepts a single nodeId and a JSON-string nodeIds", async () => {
      mockSendCommand.mockResolvedValue({ success: true, updated: 1, failed: 0, results: [] });
      await callTool("set_constraints", { nodeId: "5-6", vertical: "STRETCH" });
      expect(sentCalls().at(-1)).toEqual(["set_constraints", { nodeId: "5:6", vertical: "STRETCH" }]);
      await callTool("set_constraints", { nodeIds: '["7-8"]', vertical: "SCALE" });
      expect(sentCalls().at(-1)).toEqual(["set_constraints", { nodeIds: ["7:8"], vertical: "SCALE" }]);
    });

    it("lists per-node failures", async () => {
      mockSendCommand.mockResolvedValue({
        success: false,
        updated: 1,
        failed: 1,
        results: [
          { nodeId: "1:2", name: "A", success: true, constraints: { horizontal: "MAX", vertical: "MIN" } },
          { nodeId: "9:9", success: false, error: "Node with ID 9:9 not found" },
        ],
      });
      const response = await callTool("set_constraints", { nodeIds: ["1:2", "9:9"], horizontal: "MAX" });
      expect(response.content[0].text).toContain("Updated constraints on 1 of 2 node(s)");
      expect(response.content[0].text).toContain("9:9 failed: Node with ID 9:9 not found");
    });

    it("rejects missing nodes or axes without calling Figma", async () => {
      const noAxis = await callTool("set_constraints", { nodeId: "1:2" });
      expect(noAxis.content[0].text).toContain("requires horizontal and/or vertical");
      const noNode = await callTool("set_constraints", { horizontal: "MIN" });
      expect(noNode.content[0].text).toContain("requires nodeId or nodeIds");
      expect(sentCalls()).toEqual([]);
      expect(() => toolSchemas.get("set_constraints")!.parse({ nodeId: "1:2", horizontal: "LEFT" })).toThrow();
    });

    it("works inside batch_actions with the same payload", async () => {
      mockSendCommand.mockResolvedValue({ success: true, totalActions: 1, succeeded: 1, failed: 0, results: [] });
      await callTool("batch_actions", {
        actions: [{ action: "set_constraints", params: { nodeIds: "1-2,3-4", horizontal: "STRETCH" } }],
        checkpoint: false,
      });
      expect(mockSendCommand.mock.calls[0][1].actions[0]).toEqual({
        action: "set_constraints",
        params: { nodeIds: ["1:2", "3:4"], horizontal: "STRETCH" },
      });
    });
  });

  describe("create_svg constraints", () => {
    const svg = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';

    it("forwards constraints and reports how many layers received them", async () => {
      mockSendCommand.mockResolvedValue({
        id: "9:1",
        name: "Icon",
        width: 24,
        height: 24,
        childCount: 1,
        constraints: { horizontal: "CENTER", vertical: "CENTER" },
        constraintsAppliedTo: 1,
      });
      const response = await callTool("create_svg", {
        svgString: svg,
        constraints: { horizontal: "CENTER", vertical: "CENTER" },
      });
      expect(sentCalls()).toContainEqual([
        "create_svg",
        {
          svgString: svg,
          x: 0,
          y: 0,
          name: undefined,
          parentId: undefined,
          flatten: false,
          constraints: { horizontal: "CENTER", vertical: "CENTER" },
        },
      ]);
      expect(response.content[0].text).toContain(
        "constraints (horizontal: CENTER, vertical: CENTER) applied to 1 layer(s)",
      );
    });

    it("omits constraints when not given and rejects empty or invalid objects", async () => {
      mockSendCommand.mockResolvedValue({ id: "9:1", name: "Icon", width: 24, height: 24, childCount: 1 });
      await callTool("create_svg", { svgString: svg });
      expect(mockSendCommand.mock.calls[0][1]).not.toHaveProperty("constraints");
      const schema = toolSchemas.get("create_svg")!;
      expect(() => schema.parse({ svgString: svg, constraints: {} })).toThrow();
      expect(() => schema.parse({ svgString: svg, constraints: { horizontal: "LEFT" } })).toThrow();
    });
  });

  describe("create_icon constraints", () => {
    it("forwards constraints to create_svg and echoes them", async () => {
      mockSendCommand.mockResolvedValue({
        id: "9:1",
        name: "bell",
        width: 16,
        height: 16,
        constraints: { horizontal: "CENTER", vertical: "CENTER" },
        constraintsAppliedTo: 2,
      });
      const response = await callTool("create_icon", {
        parentId: "1-2",
        name: "bell",
        size: 16,
        constraints: { horizontal: "CENTER", vertical: "CENTER" },
      });
      expect(mockSendCommand.mock.calls[0][0]).toBe("create_svg");
      expect(mockSendCommand.mock.calls[0][1]).toMatchObject({
        parentId: "1:2",
        constraints: { horizontal: "CENTER", vertical: "CENTER" },
      });
      const payload = JSON.parse(response.content[0].text);
      expect(payload).toMatchObject({
        constraints: { horizontal: "CENTER", vertical: "CENTER" },
        constraintsAppliedTo: 2,
      });
    });

    it("does not send constraints by default", async () => {
      mockSendCommand.mockResolvedValue({ id: "9:1", name: "bell", width: 16, height: 16 });
      await callTool("create_icon", { parentId: "1:2", name: "bell", size: 16 });
      expect(mockSendCommand.mock.calls[0][1]).not.toHaveProperty("constraints");
    });

    it("batch expansion forwards constraints", async () => {
      expect(
        resolveCreateIconParams({ parentId: "1:2", name: "bell", size: 16, constraints: { vertical: "CENTER" } })
          .createSvgParams.constraints,
      ).toEqual({ vertical: "CENTER" });
      mockSendCommand.mockResolvedValue({ success: true, totalActions: 1, succeeded: 1, failed: 0, results: [] });
      await callTool("batch_actions", {
        actions: [
          {
            action: "create_icon",
            params: { parentId: "1:2", name: "bell", size: 16, constraints: { horizontal: "CENTER" } },
          },
        ],
        checkpoint: false,
      });
      expect(mockSendCommand.mock.calls[0][1].actions[0].params.constraints).toEqual({ horizontal: "CENTER" });
    });
  });

  describe("get_node_info constraints field", () => {
    it("keeps constraints when the constraints field is requested", () => {
      const node = {
        id: "1:2",
        name: "A",
        type: "FRAME",
        constraints: { horizontal: "STRETCH", vertical: "MIN" },
        fills: [],
      };
      expect(filterNodeData(node, ["constraints"])).toEqual({
        id: "1:2",
        name: "A",
        type: "FRAME",
        constraints: { horizontal: "STRETCH", vertical: "MIN" },
      });
      expect(filterNodeData(node, ["fills"])).not.toHaveProperty("constraints");
    });
  });
});
