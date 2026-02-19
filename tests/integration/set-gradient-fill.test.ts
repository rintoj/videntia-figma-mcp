import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerModificationTools } from "../../src/claude_figma_mcp/tools/modification-tools";

jest.mock("../../src/claude_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("set_gradient_fill tool integration", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });

    mockSendCommand = require("../../src/claude_figma_mcp/utils/websocket").sendCommandToFigma;
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

  const twoStops = [
    { color: { r: 1, g: 0, b: 0 }, position: 0 },
    { color: { r: 0, g: 0, b: 1 }, position: 1 },
  ];

  describe("gradient types", () => {
    it("sends LINEAR gradient", async () => {
      mockSendCommand.mockResolvedValue({ id: "1:2", name: "Rect", gradientType: "LINEAR", stopsCount: 2 });
      const res = await callTool("set_gradient_fill", {
        nodeId: "1:2",
        gradientType: "LINEAR",
        gradientStops: twoStops,
      });
      expect(mockSendCommand).toHaveBeenCalledWith(
        "set_gradient_fill",
        expect.objectContaining({ gradientType: "LINEAR" }),
      );
      expect(res.content[0].text).toContain("LINEAR");
    });

    it("sends RADIAL gradient", async () => {
      mockSendCommand.mockResolvedValue({ id: "1:2", name: "Rect", gradientType: "RADIAL", stopsCount: 2 });
      const res = await callTool("set_gradient_fill", {
        nodeId: "1:2",
        gradientType: "RADIAL",
        gradientStops: twoStops,
      });
      expect(mockSendCommand).toHaveBeenCalledWith(
        "set_gradient_fill",
        expect.objectContaining({ gradientType: "RADIAL" }),
      );
      expect(res.content[0].text).toContain("RADIAL");
    });

    it("sends ANGULAR gradient", async () => {
      mockSendCommand.mockResolvedValue({ id: "1:2", name: "Rect", gradientType: "ANGULAR", stopsCount: 2 });
      await callTool("set_gradient_fill", { nodeId: "1:2", gradientType: "ANGULAR", gradientStops: twoStops });
      expect(mockSendCommand).toHaveBeenCalledWith(
        "set_gradient_fill",
        expect.objectContaining({ gradientType: "ANGULAR" }),
      );
    });

    it("sends DIAMOND gradient", async () => {
      mockSendCommand.mockResolvedValue({ id: "1:2", name: "Rect", gradientType: "DIAMOND", stopsCount: 2 });
      await callTool("set_gradient_fill", { nodeId: "1:2", gradientType: "DIAMOND", gradientStops: twoStops });
      expect(mockSendCommand).toHaveBeenCalledWith(
        "set_gradient_fill",
        expect.objectContaining({ gradientType: "DIAMOND" }),
      );
    });

    it("rejects invalid gradient type", async () => {
      await expect(
        callTool("set_gradient_fill", { nodeId: "1:2", gradientType: "INVALID", gradientStops: twoStops }),
      ).rejects.toThrow();
    });
  });

  describe("gradient stops", () => {
    it("passes stops through without alpha defaulting (plugin handles defaults)", async () => {
      mockSendCommand.mockResolvedValue({ id: "1:2", name: "Rect", gradientType: "LINEAR", stopsCount: 2 });
      await callTool("set_gradient_fill", { nodeId: "1:2", gradientType: "LINEAR", gradientStops: twoStops });
      const call = mockSendCommand.mock.calls[0][1];
      expect(call.gradientStops[0].color.a).toBeUndefined();
      expect(call.gradientStops[1].color.a).toBeUndefined();
    });

    it("preserves explicit alpha values", async () => {
      mockSendCommand.mockResolvedValue({ id: "1:2", name: "Rect", gradientType: "LINEAR", stopsCount: 2 });
      const stops = [
        { color: { r: 1, g: 0, b: 0, a: 0.5 }, position: 0 },
        { color: { r: 0, g: 0, b: 1, a: 0.8 }, position: 1 },
      ];
      await callTool("set_gradient_fill", { nodeId: "1:2", gradientType: "LINEAR", gradientStops: stops });
      const call = mockSendCommand.mock.calls[0][1];
      expect(call.gradientStops[0].color.a).toBe(0.5);
      expect(call.gradientStops[1].color.a).toBe(0.8);
    });

    it("rejects fewer than 2 stops", async () => {
      await expect(
        callTool("set_gradient_fill", {
          nodeId: "1:2",
          gradientType: "LINEAR",
          gradientStops: [{ color: { r: 1, g: 0, b: 0 }, position: 0 }],
        }),
      ).rejects.toThrow();
    });
  });

  describe("optional parameters", () => {
    it("defaults angle to 0", async () => {
      mockSendCommand.mockResolvedValue({ id: "1:2", name: "Rect", gradientType: "LINEAR", stopsCount: 2 });
      await callTool("set_gradient_fill", { nodeId: "1:2", gradientType: "LINEAR", gradientStops: twoStops });
      expect(mockSendCommand.mock.calls[0][1].angle).toBe(0);
    });

    it("passes custom angle", async () => {
      mockSendCommand.mockResolvedValue({ id: "1:2", name: "Rect", gradientType: "LINEAR", stopsCount: 2 });
      await callTool("set_gradient_fill", {
        nodeId: "1:2",
        gradientType: "LINEAR",
        gradientStops: twoStops,
        angle: 45,
      });
      expect(mockSendCommand.mock.calls[0][1].angle).toBe(45);
    });

    it("defaults opacity to 1", async () => {
      mockSendCommand.mockResolvedValue({ id: "1:2", name: "Rect", gradientType: "LINEAR", stopsCount: 2 });
      await callTool("set_gradient_fill", { nodeId: "1:2", gradientType: "LINEAR", gradientStops: twoStops });
      expect(mockSendCommand.mock.calls[0][1].opacity).toBe(1);
    });

    it("passes custom opacity", async () => {
      mockSendCommand.mockResolvedValue({ id: "1:2", name: "Rect", gradientType: "LINEAR", stopsCount: 2 });
      await callTool("set_gradient_fill", {
        nodeId: "1:2",
        gradientType: "LINEAR",
        gradientStops: twoStops,
        opacity: 0.5,
      });
      expect(mockSendCommand.mock.calls[0][1].opacity).toBe(0.5);
    });
  });

  describe("error handling", () => {
    it("returns error message on failure", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node not found"));
      const res = await callTool("set_gradient_fill", {
        nodeId: "1:2",
        gradientType: "LINEAR",
        gradientStops: twoStops,
      });
      expect(res.content[0].text).toContain("Error setting gradient fill");
      expect(res.content[0].text).toContain("Node not found");
    });
  });
});
