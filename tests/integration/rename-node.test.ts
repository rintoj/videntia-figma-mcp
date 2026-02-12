import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerModificationTools } from '../../src/claude_figma_mcp/tools/modification-tools';

jest.mock('../../src/claude_figma_mcp/utils/websocket', () => ({
  sendCommandToFigma: jest.fn()
}));

describe("rename_node tool integration", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  let toolHandler: Function;
  let toolSchema: z.ZodObject<any>;

  beforeEach(() => {
    server = new McpServer(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    mockSendCommand = require('../../src/claude_figma_mcp/utils/websocket').sendCommandToFigma;
    mockSendCommand.mockClear();

    const originalTool = server.tool.bind(server);
    jest.spyOn(server, 'tool').mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, description, schema, handler] = args;
        if (name === 'rename_node') {
          toolHandler = handler;
          toolSchema = z.object(schema);
        }
      }
      return (originalTool as any)(...args);
    });

    registerModificationTools(server);
  });

  async function callToolWithValidation(args: any) {
    const validatedArgs = toolSchema.parse(args);
    const result = await toolHandler(validatedArgs, { meta: {} });
    return result;
  }

  describe("successful renaming", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        id: "node-123",
        oldName: "Old Name",
        newName: "New Name"
      });
    });

    it("successfully renames a node", async () => {
      const response = await callToolWithValidation({
        nodeId: "node-123",
        name: "New Name"
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("rename_node", {
        nodeId: "node-123",
        name: "New Name"
      });
      expect(response.content[0].text).toContain('Renamed node from "Old Name" to "New Name"');
      expect(response.content[0].text).toContain("node-123");
    });

    it("handles names with special characters", async () => {
      mockSendCommand.mockResolvedValue({
        id: "node-456",
        oldName: "Button",
        newName: "Button/Primary/Large"
      });

      const response = await callToolWithValidation({
        nodeId: "node-456",
        name: "Button/Primary/Large"
      });

      expect(mockSendCommand).toHaveBeenCalledWith("rename_node", {
        nodeId: "node-456",
        name: "Button/Primary/Large"
      });
      expect(response.content[0].text).toContain("Button/Primary/Large");
    });

    it("handles empty string to non-empty name", async () => {
      mockSendCommand.mockResolvedValue({
        id: "node-789",
        oldName: "",
        newName: "Named Node"
      });

      const response = await callToolWithValidation({
        nodeId: "node-789",
        name: "Named Node"
      });

      expect(response.content[0].text).toContain('Renamed node from "" to "Named Node"');
    });

    it("handles unicode characters in names", async () => {
      mockSendCommand.mockResolvedValue({
        id: "node-unicode",
        oldName: "Button",
        newName: "Botón Principal"
      });

      const response = await callToolWithValidation({
        nodeId: "node-unicode",
        name: "Botón Principal"
      });

      expect(mockSendCommand).toHaveBeenCalledWith("rename_node", {
        nodeId: "node-unicode",
        name: "Botón Principal"
      });
    });

    it("handles very long names", async () => {
      const longName = "A".repeat(200);
      mockSendCommand.mockResolvedValue({
        id: "node-long",
        oldName: "Short",
        newName: longName
      });

      const response = await callToolWithValidation({
        nodeId: "node-long",
        name: longName
      });

      expect(mockSendCommand).toHaveBeenCalledWith("rename_node", {
        nodeId: "node-long",
        name: longName
      });
    });
  });

  describe("parameter validation", () => {
    it("requires nodeId parameter", async () => {
      await expect(callToolWithValidation({
        name: "New Name"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("requires name parameter", async () => {
      await expect(callToolWithValidation({
        nodeId: "node-123"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects non-string nodeId", async () => {
      await expect(callToolWithValidation({
        nodeId: 123,
        name: "New Name"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects non-string name", async () => {
      await expect(callToolWithValidation({
        nodeId: "node-123",
        name: 456
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("handles node not found error", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node not found with ID: invalid-id"));

      const response = await callToolWithValidation({
        nodeId: "invalid-id",
        name: "New Name"
      });

      expect(response.content[0].text).toContain("Error renaming node");
      expect(response.content[0].text).toContain("Node not found");
    });

    it("handles permission errors", async () => {
      mockSendCommand.mockRejectedValue(new Error("Cannot rename this node type"));

      const response = await callToolWithValidation({
        nodeId: "locked-node",
        name: "New Name"
      });

      expect(response.content[0].text).toContain("Error renaming node");
      expect(response.content[0].text).toContain("Cannot rename");
    });

    it("handles network errors", async () => {
      mockSendCommand.mockRejectedValue(new Error("Connection timeout"));

      const response = await callToolWithValidation({
        nodeId: "node-123",
        name: "New Name"
      });

      expect(response.content[0].text).toContain("Error renaming node");
      expect(response.content[0].text).toContain("Connection timeout");
    });
  });

  describe("edge cases", () => {
    it("handles renaming to same name", async () => {
      mockSendCommand.mockResolvedValue({
        id: "node-same",
        oldName: "Same Name",
        newName: "Same Name"
      });

      const response = await callToolWithValidation({
        nodeId: "node-same",
        name: "Same Name"
      });

      expect(response.content[0].text).toContain('Renamed node from "Same Name" to "Same Name"');
    });

    it("handles names with leading/trailing spaces", async () => {
      mockSendCommand.mockResolvedValue({
        id: "node-spaces",
        oldName: "Old",
        newName: "  Spaced Name  "
      });

      const response = await callToolWithValidation({
        nodeId: "node-spaces",
        name: "  Spaced Name  "
      });

      expect(mockSendCommand).toHaveBeenCalledWith("rename_node", {
        nodeId: "node-spaces",
        name: "  Spaced Name  "
      });
    });

    it("handles names with newlines", async () => {
      mockSendCommand.mockResolvedValue({
        id: "node-newline",
        oldName: "Old",
        newName: "Line1\nLine2"
      });

      const response = await callToolWithValidation({
        nodeId: "node-newline",
        name: "Line1\nLine2"
      });

      expect(mockSendCommand).toHaveBeenCalledWith("rename_node", {
        nodeId: "node-newline",
        name: "Line1\nLine2"
      });
    });
  });
});
