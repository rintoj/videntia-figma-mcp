import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerComponentTools } from '../../src/claude_figma_mcp/tools/component-tools';

jest.mock('../../src/claude_figma_mcp/utils/websocket', () => ({
  sendCommandToFigma: jest.fn()
}));

describe("new component tools integration", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    mockSendCommand = require('../../src/claude_figma_mcp/utils/websocket').sendCommandToFigma;
    mockSendCommand.mockClear();

    toolHandlers = new Map();
    toolSchemas = new Map();

    const originalTool = server.tool.bind(server);
    jest.spyOn(server, 'tool').mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, description, schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });

    registerComponentTools(server);
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

  describe("get_reactions", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        reactions: [
          { nodeId: "btn-1", action: "NAVIGATE", destination: "frame-2" },
          { nodeId: "btn-2", action: "NAVIGATE", destination: "frame-3" }
        ]
      });
    });

    it("successfully gets reactions from multiple nodes", async () => {
      const response = await callTool("get_reactions", {
        nodeIds: ["btn-1", "btn-2"]
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("get_reactions", {
        nodeIds: ["btn-1", "btn-2"]
      });
      expect(response.content[0].text).toContain("btn-1");
      expect(response.content[1].text).toContain("reaction_to_connector_strategy");
    });

    it("requires nodeIds parameter", async () => {
      await expect(callTool("get_reactions", {})).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("requires nodeIds to be an array", async () => {
      await expect(callTool("get_reactions", {
        nodeIds: "btn-1"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Nodes not found"));

      const response = await callTool("get_reactions", {
        nodeIds: ["invalid-1"]
      });

      expect(response.content[0].text).toContain("Error getting reactions");
      expect(response.content[0].text).toContain("Nodes not found");
    });
  });

  describe("set_default_connector", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        success: true,
        connectorId: "connector-123"
      });
    });

    it("successfully sets default connector with ID", async () => {
      const response = await callTool("set_default_connector", {
        connectorId: "connector-123"
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_default_connector", {
        connectorId: "connector-123"
      });
      expect(response.content[0].text).toContain("Default connector set");
    });

    it("successfully sets default connector without ID", async () => {
      const response = await callTool("set_default_connector", {});

      expect(mockSendCommand).toHaveBeenCalledWith("set_default_connector", {
        connectorId: undefined
      });
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Invalid connector"));

      const response = await callTool("set_default_connector", {
        connectorId: "invalid-123"
      });

      expect(response.content[0].text).toContain("Error setting default connector");
      expect(response.content[0].text).toContain("Invalid connector");
    });
  });

  describe("create_connections", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        success: true,
        connectionsCreated: 2
      });
    });

    it("successfully creates connections between nodes", async () => {
      const response = await callTool("create_connections", {
        connections: [
          { startNodeId: "frame-1", endNodeId: "frame-2" },
          { startNodeId: "frame-2", endNodeId: "frame-3", text: "Next" }
        ]
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("create_connections", {
        connections: [
          { startNodeId: "frame-1", endNodeId: "frame-2" },
          { startNodeId: "frame-2", endNodeId: "frame-3", text: "Next" }
        ]
      });
      expect(response.content[0].text).toContain("Created 2 connections");
    });

    it("returns early if no connections provided", async () => {
      const response = await callTool("create_connections", {
        connections: []
      });

      expect(mockSendCommand).not.toHaveBeenCalled();
      expect(response.content[0].text).toContain("No connections provided");
    });

    it("requires connections parameter", async () => {
      await expect(callTool("create_connections", {})).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("requires startNodeId and endNodeId for each connection", async () => {
      await expect(callTool("create_connections", {
        connections: [{ startNodeId: "frame-1" }]
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Connection failed"));

      const response = await callTool("create_connections", {
        connections: [
          { startNodeId: "frame-1", endNodeId: "frame-2" }
        ]
      });

      expect(response.content[0].text).toContain("Error creating connections");
      expect(response.content[0].text).toContain("Connection failed");
    });
  });

  describe("get_instance_overrides", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        success: true,
        message: "Found 5 overrides"
      });
    });

    it("successfully gets instance overrides with nodeId", async () => {
      const response = await callTool("get_instance_overrides", {
        nodeId: "instance-123"
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("get_instance_overrides", {
        instanceNodeId: "instance-123"
      });
      expect(response.content[0].text).toContain("Successfully got instance overrides");
      expect(response.content[0].text).toContain("Found 5 overrides");
    });

    it("successfully gets instance overrides without nodeId (uses selection)", async () => {
      const response = await callTool("get_instance_overrides", {});

      expect(mockSendCommand).toHaveBeenCalledWith("get_instance_overrides", {
        instanceNodeId: null
      });
    });

    it("reports failure when success is false", async () => {
      mockSendCommand.mockResolvedValue({
        success: false,
        message: "No instance selected"
      });

      const response = await callTool("get_instance_overrides", {});

      expect(response.content[0].text).toContain("Failed to get instance overrides");
      expect(response.content[0].text).toContain("No instance selected");
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Instance not found"));

      const response = await callTool("get_instance_overrides", {
        nodeId: "invalid-123"
      });

      expect(response.content[0].text).toContain("Error getting instance overrides");
      expect(response.content[0].text).toContain("Instance not found");
    });
  });

  describe("set_instance_overrides", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        success: true,
        message: "Overrides applied",
        totalCount: 5,
        results: [
          { success: true },
          { success: true },
          { success: true }
        ]
      });
    });

    it("successfully sets instance overrides", async () => {
      const response = await callTool("set_instance_overrides", {
        sourceInstanceId: "source-123",
        targetNodeIds: ["target-1", "target-2", "target-3"]
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_instance_overrides", {
        sourceInstanceId: "source-123",
        targetNodeIds: ["target-1", "target-2", "target-3"]
      });
      expect(response.content[0].text).toContain("Successfully applied 5 overrides to 3 instances");
    });

    it("reports failure when success is false", async () => {
      mockSendCommand.mockResolvedValue({
        success: false,
        message: "Source instance not found"
      });

      const response = await callTool("set_instance_overrides", {
        sourceInstanceId: "invalid-source",
        targetNodeIds: ["target-1"]
      });

      expect(response.content[0].text).toContain("Failed to set instance overrides");
      expect(response.content[0].text).toContain("Source instance not found");
    });

    it("requires sourceInstanceId parameter", async () => {
      await expect(callTool("set_instance_overrides", {
        targetNodeIds: ["target-1"]
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("requires targetNodeIds parameter", async () => {
      await expect(callTool("set_instance_overrides", {
        sourceInstanceId: "source-123"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("requires targetNodeIds to be an array", async () => {
      await expect(callTool("set_instance_overrides", {
        sourceInstanceId: "source-123",
        targetNodeIds: "target-1"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Override failed"));

      const response = await callTool("set_instance_overrides", {
        sourceInstanceId: "source-123",
        targetNodeIds: ["target-1"]
      });

      expect(response.content[0].text).toContain("Error setting instance overrides");
      expect(response.content[0].text).toContain("Override failed");
    });
  });

  describe("add_component_property", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        nodeId: "component-123",
        nodeName: "Button",
        propertyName: "Show Icon#456:789",
        type: "BOOLEAN",
        defaultValue: true
      });
    });

    it("successfully adds a boolean component property", async () => {
      const response = await callTool("add_component_property", {
        nodeId: "component-123",
        propertyName: "Show Icon",
        type: "BOOLEAN",
        defaultValue: true
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("add_component_property", {
        nodeId: "component-123",
        propertyName: "Show Icon",
        type: "BOOLEAN",
        defaultValue: true
      });
      expect(response.content[0].text).toContain("Added BOOLEAN property");
      expect(response.content[0].text).toContain("Show Icon#456:789");
    });

    it("successfully adds a text component property", async () => {
      mockSendCommand.mockResolvedValue({
        nodeId: "component-123",
        nodeName: "Button",
        propertyName: "Label#456:789",
        type: "TEXT",
        defaultValue: "Click me"
      });

      const response = await callTool("add_component_property", {
        nodeId: "component-123",
        propertyName: "Label",
        type: "TEXT",
        defaultValue: "Click me"
      });

      expect(mockSendCommand).toHaveBeenCalledWith("add_component_property", {
        nodeId: "component-123",
        propertyName: "Label",
        type: "TEXT",
        defaultValue: "Click me"
      });
      expect(response.content[0].text).toContain("Added TEXT property");
    });

    it("requires nodeId parameter", async () => {
      await expect(callTool("add_component_property", {
        propertyName: "Show Icon",
        type: "BOOLEAN"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("requires propertyName parameter", async () => {
      await expect(callTool("add_component_property", {
        nodeId: "component-123",
        type: "BOOLEAN"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("requires valid type parameter", async () => {
      await expect(callTool("add_component_property", {
        nodeId: "component-123",
        propertyName: "Show Icon",
        type: "INVALID"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node is not a component"));

      const response = await callTool("add_component_property", {
        nodeId: "frame-123",
        propertyName: "Show Icon",
        type: "BOOLEAN"
      });

      expect(response.content[0].text).toContain("Error adding component property");
      expect(response.content[0].text).toContain("Node is not a component");
    });
  });

  describe("edit_component_property", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        nodeId: "component-123",
        nodeName: "Button",
        oldPropertyName: "Show Icon#456:789",
        newPropertyName: "Display Icon#456:789",
        updates: { name: "Display Icon" }
      });
    });

    it("successfully edits a component property name", async () => {
      const response = await callTool("edit_component_property", {
        nodeId: "component-123",
        propertyName: "Show Icon#456:789",
        newName: "Display Icon"
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("edit_component_property", {
        nodeId: "component-123",
        propertyName: "Show Icon#456:789",
        newName: "Display Icon",
        newDefaultValue: undefined,
        preferredValues: undefined
      });
      expect(response.content[0].text).toContain("Updated property");
    });

    it("successfully edits a component property default value", async () => {
      mockSendCommand.mockResolvedValue({
        nodeId: "component-123",
        nodeName: "Button",
        oldPropertyName: "Show Icon#456:789",
        newPropertyName: "Show Icon#456:789",
        updates: { defaultValue: false }
      });

      const response = await callTool("edit_component_property", {
        nodeId: "component-123",
        propertyName: "Show Icon#456:789",
        newDefaultValue: false
      });

      expect(mockSendCommand).toHaveBeenCalledWith("edit_component_property", {
        nodeId: "component-123",
        propertyName: "Show Icon#456:789",
        newName: undefined,
        newDefaultValue: false,
        preferredValues: undefined
      });
    });

    it("requires nodeId parameter", async () => {
      await expect(callTool("edit_component_property", {
        propertyName: "Show Icon#456:789",
        newName: "Display Icon"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("requires propertyName parameter", async () => {
      await expect(callTool("edit_component_property", {
        nodeId: "component-123",
        newName: "Display Icon"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Property not found"));

      const response = await callTool("edit_component_property", {
        nodeId: "component-123",
        propertyName: "Invalid#000:000",
        newName: "New Name"
      });

      expect(response.content[0].text).toContain("Error editing component property");
      expect(response.content[0].text).toContain("Property not found");
    });
  });

  describe("delete_component_property", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        nodeId: "component-123",
        nodeName: "Button",
        deletedPropertyName: "Show Icon#456:789"
      });
    });

    it("successfully deletes a component property", async () => {
      const response = await callTool("delete_component_property", {
        nodeId: "component-123",
        propertyName: "Show Icon#456:789"
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("delete_component_property", {
        nodeId: "component-123",
        propertyName: "Show Icon#456:789"
      });
      expect(response.content[0].text).toContain("Deleted property");
      expect(response.content[0].text).toContain("Show Icon#456:789");
    });

    it("requires nodeId parameter", async () => {
      await expect(callTool("delete_component_property", {
        propertyName: "Show Icon#456:789"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("requires propertyName parameter", async () => {
      await expect(callTool("delete_component_property", {
        nodeId: "component-123"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Cannot delete variant property"));

      const response = await callTool("delete_component_property", {
        nodeId: "component-123",
        propertyName: "Variant#456:789"
      });

      expect(response.content[0].text).toContain("Error deleting component property");
      expect(response.content[0].text).toContain("Cannot delete variant property");
    });
  });

  describe("set_component_property_references", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        nodeId: "icon-layer-123",
        nodeName: "Icon",
        references: { visible: "Show Icon#456:789" }
      });
    });

    it("successfully sets visibility reference", async () => {
      const response = await callTool("set_component_property_references", {
        nodeId: "icon-layer-123",
        references: { visible: "Show Icon#456:789" }
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("set_component_property_references", {
        nodeId: "icon-layer-123",
        references: { visible: "Show Icon#456:789" }
      });
      expect(response.content[0].text).toContain("Set property references");
      expect(response.content[0].text).toContain("visible");
    });

    it("successfully sets text reference", async () => {
      mockSendCommand.mockResolvedValue({
        nodeId: "text-layer-123",
        nodeName: "Label",
        references: { characters: "Label Text#456:789" }
      });

      const response = await callTool("set_component_property_references", {
        nodeId: "text-layer-123",
        references: { characters: "Label Text#456:789" }
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_component_property_references", {
        nodeId: "text-layer-123",
        references: { characters: "Label Text#456:789" }
      });
      expect(response.content[0].text).toContain("characters");
    });

    it("requires nodeId parameter", async () => {
      await expect(callTool("set_component_property_references", {
        references: { visible: "Show Icon#456:789" }
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("requires references parameter", async () => {
      await expect(callTool("set_component_property_references", {
        nodeId: "icon-layer-123"
      })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node is not a component sublayer"));

      const response = await callTool("set_component_property_references", {
        nodeId: "frame-123",
        references: { visible: "Show Icon#456:789" }
      });

      expect(response.content[0].text).toContain("Error setting component property references");
      expect(response.content[0].text).toContain("Node is not a component sublayer");
    });
  });

  describe("get_component_properties", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        nodeId: "component-123",
        nodeName: "Button",
        nodeType: "COMPONENT",
        properties: {
          "Show Icon#456:789": { type: "BOOLEAN", defaultValue: true },
          "Label#456:790": { type: "TEXT", defaultValue: "Click me" }
        }
      });
    });

    it("successfully gets component properties", async () => {
      const response = await callTool("get_component_properties", {
        nodeId: "component-123"
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("get_component_properties", {
        nodeId: "component-123"
      });
      expect(response.content[0].text).toContain("Button");
      expect(response.content[0].text).toContain("BOOLEAN");
      expect(response.content[0].text).toContain("TEXT");
    });

    it("requires nodeId parameter", async () => {
      await expect(callTool("get_component_properties", {})).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node is not a component"));

      const response = await callTool("get_component_properties", {
        nodeId: "frame-123"
      });

      expect(response.content[0].text).toContain("Error getting component properties");
      expect(response.content[0].text).toContain("Node is not a component");
    });
  });
});
