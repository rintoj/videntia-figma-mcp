import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerModificationTools } from "../../src/videntia_figma_mcp/tools/modification-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("set_effects integration", () => {
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

  describe("standard effects", () => {
    it("sends DROP_SHADOW effect", async () => {
      mockSendCommand.mockResolvedValue({ name: "Node", effects: [] });
      await callTool("set_effects", {
        nodeId: "1:2",
        effects: [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.5 }, offset: { x: 0, y: 4 }, radius: 8 }],
      });
      expect(mockSendCommand).toHaveBeenCalledWith(
        "set_effects",
        expect.objectContaining({
          nodeId: "1:2",
          effects: expect.arrayContaining([expect.objectContaining({ type: "DROP_SHADOW" })]),
        }),
      );
    });

    it("sends LAYER_BLUR effect", async () => {
      mockSendCommand.mockResolvedValue({ name: "Node", effects: [] });
      await callTool("set_effects", {
        nodeId: "1:2",
        effects: [{ type: "LAYER_BLUR", radius: 10 }],
      });
      expect(mockSendCommand).toHaveBeenCalledWith(
        "set_effects",
        expect.objectContaining({
          effects: expect.arrayContaining([expect.objectContaining({ type: "LAYER_BLUR" })]),
        }),
      );
    });

    it("sends BACKGROUND_BLUR effect", async () => {
      mockSendCommand.mockResolvedValue({ name: "Node", effects: [] });
      await callTool("set_effects", {
        nodeId: "1:2",
        effects: [{ type: "BACKGROUND_BLUR", radius: 15 }],
      });
      expect(mockSendCommand).toHaveBeenCalledWith(
        "set_effects",
        expect.objectContaining({
          effects: expect.arrayContaining([expect.objectContaining({ type: "BACKGROUND_BLUR" })]),
        }),
      );
    });
  });

  describe("beta effect types", () => {
    it("accepts NOISE effect with defaults", async () => {
      mockSendCommand.mockResolvedValue({ name: "Node", effects: [] });
      await callTool("set_effects", {
        nodeId: "1:2",
        effects: [{ type: "NOISE" }],
      });
      expect(mockSendCommand).toHaveBeenCalledTimes(1);
    });

    it("accepts NOISE with noiseType and color", async () => {
      mockSendCommand.mockResolvedValue({ name: "Node", effects: [] });
      await callTool("set_effects", {
        nodeId: "1:2",
        effects: [
          {
            type: "NOISE",
            noiseType: "DUOTONE",
            color: { r: 1, g: 1, b: 1, a: 0.2 },
            secondaryColor: { r: 0, g: 0, b: 0, a: 0.1 },
            noiseSize: 2,
            density: 0.8,
          },
        ],
      });
      expect(mockSendCommand).toHaveBeenCalledTimes(1);
    });

    it("accepts TEXTURE effect", async () => {
      mockSendCommand.mockResolvedValue({ name: "Node", effects: [] });
      await callTool("set_effects", {
        nodeId: "1:2",
        effects: [{ type: "TEXTURE", noiseSize: 1.5, radius: 5, clipToShape: true }],
      });
      expect(mockSendCommand).toHaveBeenCalledTimes(1);
    });

    it("accepts GLASS effect", async () => {
      mockSendCommand.mockResolvedValue({ name: "Node", effects: [] });
      await callTool("set_effects", {
        nodeId: "1:2",
        effects: [
          {
            type: "GLASS",
            lightIntensity: 0.6,
            lightAngle: 45,
            refraction: 0.3,
            depth: 0.4,
            dispersion: 0.1,
            radius: 8,
          },
        ],
      });
      expect(mockSendCommand).toHaveBeenCalledTimes(1);
    });
  });

  describe("multiple effects", () => {
    it("sends multiple effects at once", async () => {
      mockSendCommand.mockResolvedValue({ name: "Node", effects: [] });
      await callTool("set_effects", {
        nodeId: "1:2",
        effects: [
          { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.3 }, offset: { x: 0, y: 2 }, radius: 4 },
          { type: "BACKGROUND_BLUR", radius: 10 },
        ],
      });
      expect(mockSendCommand.mock.calls[0][1].effects).toHaveLength(2);
    });
  });

  describe("error handling", () => {
    it("returns error message on sendCommandToFigma failure", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node not found"));
      const res = await callTool("set_effects", {
        nodeId: "1:2",
        effects: [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.5 }, offset: { x: 0, y: 4 }, radius: 8 }],
      });
      expect(res.content[0].text).toContain("Error setting effects");
    });

    it("rejects invalid effect type via schema", async () => {
      await expect(
        callTool("set_effects", {
          nodeId: "1:2",
          effects: [{ type: "INVALID_TYPE" }],
        }),
      ).rejects.toThrow();
    });
  });
});
