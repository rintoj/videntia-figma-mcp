import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTextTools } from "../../src/videntia_figma_mcp/tools/text-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("text tools integration", () => {
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

    registerTextTools(server);
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

  describe("set_text_wrap_style", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        name: "Heading",
        textWrapStyle: "BALANCE",
      });
    });

    it("successfully sets the text wrap style", async () => {
      const response = await callTool("set_text_wrap_style", {
        nodeId: "text-123",
        textWrapStyle: "BALANCE",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_text_wrap_style", {
        nodeId: "text-123",
        textWrapStyle: "BALANCE",
      });
      expect(response.content[0].text).toContain("Heading");
      expect(response.content[0].text).toContain("BALANCE");
    });

    it("rejects an invalid textWrapStyle value", async () => {
      await expect(
        callTool("set_text_wrap_style", {
          nodeId: "text-123",
          textWrapStyle: "JUSTIFY",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node is not a text node"));

      const response = await callTool("set_text_wrap_style", {
        nodeId: "text-123",
        textWrapStyle: "AUTO",
      });

      expect(response.content[0].text).toContain("Error setting text wrap style");
      expect(response.content[0].text).toContain("Node is not a text node");
    });
  });
});
