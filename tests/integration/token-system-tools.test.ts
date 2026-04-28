import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerVariableTools } from "../../src/hgraph_figma_mcp/tools/variable-tools";

jest.mock("../../src/hgraph_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("token system tools", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });

    mockSendCommand = require("../../src/hgraph_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();

    toolHandlers = new Map();
    toolSchemas = new Map();

    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, description, schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      } else if (args.length === 3) {
        const [name, description, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object({}));
      }
      return (originalTool as any)(...args);
    });

    registerVariableTools(server);
  });

  async function callTool(toolName: string, args: any = {}) {
    const schema = toolSchemas.get(toolName);
    const handler = toolHandlers.get(toolName);
    if (!schema || !handler) {
      throw new Error(`Tool ${toolName} not found`);
    }
    const validatedArgs = Object.keys(args).length > 0 ? schema.parse(args) : {};
    return await handler(validatedArgs, { meta: {} });
  }

  // ====================
  // CREATE SPACING SYSTEM
  // ====================

  describe("create_spacing_system", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        created: 17,
        failed: 0,
        variableIds: ["var-1", "var-2", "var-3"],
        errors: [],
      });
    });

    it("successfully creates 8pt spacing system", async () => {
      const response = await callTool("create_spacing_system", {
        collection_id: "Design Tokens",
        preset: "8pt",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith(
        "create_variables_batch",
        expect.objectContaining({
          collectionId: "Design Tokens",
          variables: expect.arrayContaining([
            expect.objectContaining({ name: "spacing/0", type: "FLOAT", value: 0 }),
            expect.objectContaining({ name: "spacing/1", type: "FLOAT", value: 4 }),
            expect.objectContaining({ name: "spacing/2", type: "FLOAT", value: 8 }),
          ]),
        }),
      );
      expect(response.content[0].text).toContain("spacing");
      expect(response.content[0].text).toContain("8pt");
    });

    it("successfully creates 4pt spacing system", async () => {
      const response = await callTool("create_spacing_system", {
        collection_id: "Design Tokens",
        preset: "4pt",
      });

      expect(mockSendCommand).toHaveBeenCalledWith(
        "create_variables_batch",
        expect.objectContaining({
          variables: expect.arrayContaining([expect.objectContaining({ name: "spacing/5", type: "FLOAT", value: 20 })]),
        }),
      );
    });

    it("successfully creates Tailwind spacing system", async () => {
      await callTool("create_spacing_system", {
        collection_id: "Design Tokens",
        preset: "tailwind",
      });

      expect(mockSendCommand).toHaveBeenCalled();
    });

    it("successfully creates Material spacing system", async () => {
      await callTool("create_spacing_system", {
        collection_id: "Design Tokens",
        preset: "material",
      });

      expect(mockSendCommand).toHaveBeenCalled();
    });

    it("validates preset is valid", async () => {
      await expect(
        callTool("create_spacing_system", {
          collection_id: "Design Tokens",
          preset: "invalid",
        }),
      ).rejects.toThrow();
    });
  });

  // ====================
  // CREATE TYPOGRAPHY SYSTEM
  // ====================

  describe("create_typography_system", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        created: 28,
        failed: 0,
        variableIds: Array(28).fill("var-id"),
        errors: [],
      });
    });

    it("successfully creates major-third typography system", async () => {
      const response = await callTool("create_typography_system", {
        collection_id: "Design Tokens",
        scale_preset: "major-third",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith(
        "create_variables_batch",
        expect.objectContaining({
          collectionId: "Design Tokens",
          variables: expect.arrayContaining([
            expect.objectContaining({ name: "font.size.base", type: "FLOAT", value: 16 }),
            expect.objectContaining({ name: "font.weight.normal", type: "FLOAT", value: 400 }),
            expect.objectContaining({ name: "font.lineHeight.normal", type: "FLOAT", value: 1.5 }),
          ]),
        }),
      );
      expect(response.content[0].text).toContain("font.size");
    });

    it("successfully creates minor-third typography system", async () => {
      await callTool("create_typography_system", {
        collection_id: "Design Tokens",
        scale_preset: "minor-third",
      });

      expect(mockSendCommand).toHaveBeenCalled();
    });

    it("successfully creates perfect-fourth typography system", async () => {
      await callTool("create_typography_system", {
        collection_id: "Design Tokens",
        scale_preset: "perfect-fourth",
      });

      expect(mockSendCommand).toHaveBeenCalled();
    });

    it("validates preset is valid", async () => {
      await expect(
        callTool("create_typography_system", {
          collection_id: "Design Tokens",
          scale_preset: "invalid",
        }),
      ).rejects.toThrow();
    });
  });

  // ====================
  // CREATE RADIUS SYSTEM
  // ====================

  describe("create_radius_system", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        created: 8,
        failed: 0,
        variableIds: Array(8).fill("var-id"),
        errors: [],
      });
    });

    it("successfully creates standard radius system", async () => {
      const response = await callTool("create_radius_system", {
        collection_id: "Design Tokens",
        preset: "standard",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith(
        "create_variables_batch",
        expect.objectContaining({
          collectionId: "Design Tokens",
          variables: expect.arrayContaining([
            expect.objectContaining({ name: "radius/none", type: "FLOAT", value: 0 }),
            expect.objectContaining({ name: "radius/sm", type: "FLOAT", value: 4 }),
            expect.objectContaining({ name: "radius/full", type: "FLOAT", value: 9999 }),
          ]),
        }),
      );
      expect(response.content[0].text).toContain("radius");
    });

    it("successfully creates subtle radius system", async () => {
      await callTool("create_radius_system", {
        collection_id: "Design Tokens",
        preset: "subtle",
      });

      expect(mockSendCommand).toHaveBeenCalled();
    });

    it("successfully creates bold radius system", async () => {
      await callTool("create_radius_system", {
        collection_id: "Design Tokens",
        preset: "bold",
      });

      expect(mockSendCommand).toHaveBeenCalled();
    });

    it("validates preset is valid", async () => {
      await expect(
        callTool("create_radius_system", {
          collection_id: "Design Tokens",
          preset: "invalid",
        }),
      ).rejects.toThrow();
    });
  });

  // ====================
  // ERROR HANDLING
  // ====================

  describe("error handling", () => {
    it("handles collection not found error", async () => {
      mockSendCommand.mockRejectedValue(new Error("Collection not found"));

      const response = await callTool("create_spacing_system", {
        collection_id: "NonExistent",
        preset: "8pt",
      });

      expect(response.content[0].text).toContain("Error");
      expect(response.content[0].text).toContain("Collection not found");
    });
  });
});
