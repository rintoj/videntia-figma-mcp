import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerVariableTools } from "../../src/hgraph_figma_mcp/tools/variable-tools";

jest.mock("../../src/hgraph_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("mode management tools", () => {
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
  // ADD MODE TO COLLECTION
  // ====================

  describe("add_mode_to_collection", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        collectionId: "col-123",
        collectionName: "Design Tokens",
        modeId: "mode-456",
        modeName: "Dark",
        totalModes: 2,
        success: true,
      });
    });

    it("successfully adds a new mode to collection", async () => {
      const response = await callTool("add_mode_to_collection", {
        id: "col-123",
        name: "Dark",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("add_mode_to_collection", {
        collectionId: "col-123",
        modeName: "Dark",
      });
      expect(response.content[0].text).toContain("Dark");
      expect(response.content[0].text).toContain("Added mode");
    });

    it("accepts collection name instead of ID", async () => {
      const response = await callTool("add_mode_to_collection", {
        id: "Design Tokens",
        name: "Brand",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("add_mode_to_collection", {
        collectionId: "Design Tokens",
        modeName: "Brand",
      });
    });

    it("validates mode name is provided", async () => {
      await expect(
        callTool("add_mode_to_collection", {
          id: "col-123",
        }),
      ).rejects.toThrow();
    });
  });

  // ====================
  // RENAME MODE
  // ====================

  describe("rename_mode", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        collectionId: "col-123",
        collectionName: "Design Tokens",
        modeId: "mode-456",
        oldName: "Mode 1",
        newName: "Light",
        success: true,
      });
    });

    it("successfully renames a mode", async () => {
      const response = await callTool("rename_mode", {
        id: "col-123",
        old_name: "Mode 1",
        new_name: "Light",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("rename_mode", {
        collectionId: "col-123",
        oldModeName: "Mode 1",
        newModeName: "Light",
      });
      expect(response.content[0].text).toContain("Mode 1");
      expect(response.content[0].text).toContain("Light");
      expect(response.content[0].text).toContain("Renamed mode");
    });

    it("validates both old and new names are provided", async () => {
      await expect(
        callTool("rename_mode", {
          id: "col-123",
          old_name: "Mode 1",
        }),
      ).rejects.toThrow();

      await expect(
        callTool("rename_mode", {
          id: "col-123",
          new_name: "Light",
        }),
      ).rejects.toThrow();
    });
  });

  // ====================
  // DELETE MODE
  // ====================

  describe("delete_mode", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        collectionId: "col-123",
        collectionName: "Design Tokens",
        deletedMode: "Deprecated",
        remainingModes: 2,
        success: true,
      });
    });

    it("successfully deletes a mode", async () => {
      const response = await callTool("delete_mode", {
        id: "col-123",
        name: "Deprecated",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("delete_mode", {
        collectionId: "col-123",
        modeName: "Deprecated",
      });
      expect(response.content[0].text).toContain("Deprecated");
      expect(response.content[0].text).toContain("Deleted mode");
    });

    it("handles error when trying to delete last mode", async () => {
      mockSendCommand.mockRejectedValue(new Error("Cannot delete the last mode"));

      const response = await callTool("delete_mode", {
        id: "col-123",
        name: "Light",
      });

      expect(response.content[0].text).toContain("Error");
      expect(response.content[0].text).toContain("Cannot delete the last mode");
    });

    it("validates mode name is provided", async () => {
      await expect(
        callTool("delete_mode", {
          id: "col-123",
        }),
      ).rejects.toThrow();
    });
  });

  // ====================
  // DUPLICATE MODE VALUES
  // ====================

  describe("duplicate_mode_values", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        collectionId: "col-123",
        collectionName: "Design Tokens",
        sourceMode: "Light",
        targetMode: "Dark",
        variablesCopied: 50,
        variablesTransformed: 30,
        success: true,
      });
    });

    it("successfully duplicates mode values without transformations", async () => {
      const response = await callTool("duplicate_mode_values", {
        id: "col-123",
        from: "Light",
        to: "Dark",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("duplicate_mode_values", {
        collectionId: "col-123",
        sourceMode: "Light",
        targetMode: "Dark",
        transformColors: undefined,
      });
      expect(response.content[0].text).toContain("Light");
      expect(response.content[0].text).toContain("Dark");
      expect(response.content[0].text).toContain("50");
      expect(response.content[0].text).toContain("Copied");
    });

    it("successfully duplicates with brightness adjustment", async () => {
      const response = await callTool("duplicate_mode_values", {
        id: "col-123",
        from: "Light",
        to: "Dark",
        transform_colors: {
          brightness_adjustment: -0.2,
        },
      });

      expect(mockSendCommand).toHaveBeenCalledWith("duplicate_mode_values", {
        collectionId: "col-123",
        sourceMode: "Light",
        targetMode: "Dark",
        transformColors: {
          brightness_adjustment: -0.2,
        },
      });
      expect(response.content[0].text).toContain("Copied");
    });

    it("validates source and target modes are different", async () => {
      mockSendCommand.mockRejectedValue(new Error("Source and target modes must be different"));

      const response = await callTool("duplicate_mode_values", {
        id: "col-123",
        from: "Light",
        to: "Light",
      });

      expect(response.content[0].text).toContain("Error");
    });

    it("validates both modes are provided", async () => {
      await expect(
        callTool("duplicate_mode_values", {
          id: "col-123",
          from: "Light",
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

      const response = await callTool("add_mode_to_collection", {
        id: "invalid-id",
        name: "Dark",
      });

      expect(response.content[0].text).toContain("Error");
      expect(response.content[0].text).toContain("Collection not found");
    });

    it("handles mode not found error", async () => {
      mockSendCommand.mockRejectedValue(new Error("Mode not found"));

      const response = await callTool("rename_mode", {
        id: "col-123",
        old_name: "NonExistent",
        new_name: "Light",
      });

      expect(response.content[0].text).toContain("Error");
      expect(response.content[0].text).toContain("Mode not found");
    });

    it("handles duplicate mode name error", async () => {
      mockSendCommand.mockRejectedValue(new Error("Mode with this name already exists"));

      const response = await callTool("add_mode_to_collection", {
        id: "col-123",
        name: "Light",
      });

      expect(response.content[0].text).toContain("Error");
      expect(response.content[0].text).toContain("already exists");
    });
  });
});
