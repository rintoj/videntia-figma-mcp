import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerComponentTools } from "../../src/hgraph_figma_mcp/tools/component-tools";

jest.mock("../../src/hgraph_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("component tools integration", () => {
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

  describe("detach_instance", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        id: "detached-123",
        name: "Detached Frame",
        type: "FRAME",
      });
    });

    it("successfully detaches a component instance", async () => {
      const response = await callTool("detach_instance", {
        nodeId: "instance-456",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("detach_instance", {
        nodeId: "instance-456",
      });
      expect(response.content[0].text).toContain("Detached instance");
      expect(response.content[0].text).toContain("Detached Frame");
      expect(response.content[0].text).toContain("FRAME");
    });

    it("requires nodeId parameter", async () => {
      await expect(callTool("detach_instance", {})).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node is not an instance"));

      const response = await callTool("detach_instance", {
        nodeId: "frame-789",
      });

      expect(response.content[0].text).toContain("Error detaching instance");
      expect(response.content[0].text).toContain("Node is not an instance");
    });
  });

  describe("create_component", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        id: "component-123",
        name: "My Component",
        key: "abc123def456",
      });
    });

    it("successfully creates a component from a frame", async () => {
      const response = await callTool("create_component", {
        nodeId: "frame-789",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("create_component", {
        nodeId: "frame-789",
      });
      expect(response.content[0].text).toContain("Created component");
      expect(response.content[0].text).toContain("My Component");
      expect(response.content[0].text).toContain("abc123def456");
    });

    it("requires nodeId parameter", async () => {
      await expect(callTool("create_component", {})).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Cannot convert this node type"));

      const response = await callTool("create_component", {
        nodeId: "text-123",
      });

      expect(response.content[0].text).toContain("Error creating component");
      expect(response.content[0].text).toContain("Cannot convert this node type");
    });
  });

  describe("create_component_set", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        id: "componentset-123",
        name: "Button",
        variantCount: 3,
      });
    });

    it("successfully creates a component set from multiple components", async () => {
      const response = await callTool("create_component_set", {
        nodeIds: ["comp-1", "comp-2", "comp-3"],
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("create_component_set", {
        nodeIds: ["comp-1", "comp-2", "comp-3"],
        name: undefined,
      });
      expect(response.content[0].text).toContain("Created component set");
      expect(response.content[0].text).toContain("Button");
      expect(response.content[0].text).toContain("3 variants");
    });

    it("accepts optional name parameter", async () => {
      const response = await callTool("create_component_set", {
        nodeIds: ["comp-1", "comp-2"],
        name: "Custom Button Set",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("create_component_set", {
        nodeIds: ["comp-1", "comp-2"],
        name: "Custom Button Set",
      });
    });

    it("requires nodeIds parameter", async () => {
      await expect(callTool("create_component_set", {})).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("coerces string nodeIds into an array", async () => {
      mockSendCommand.mockResolvedValue({ id: "set-1", name: "Component Set", variantCount: 1 });
      const response = await callTool("create_component_set", {
        nodeIds: "comp-1",
      });
      expect(mockSendCommand).toHaveBeenCalledWith("create_component_set", { nodeIds: ["comp-1"], name: undefined });
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Nodes must be components"));

      const response = await callTool("create_component_set", {
        nodeIds: ["frame-1", "frame-2"],
      });

      expect(response.content[0].text).toContain("Error creating component set");
      expect(response.content[0].text).toContain("Nodes must be components");
    });
  });

  describe("create_component_instance", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        id: "instance-123",
        name: "Button Instance",
        type: "INSTANCE",
      });
    });

    it("successfully creates a component instance", async () => {
      const response = await callTool("create_component_instance", {
        componentKey: "abc123",
        x: 100,
        y: 200,
      });

      expect(mockSendCommand).toHaveBeenCalledWith("create_component_instance", {
        componentKey: "abc123",
        x: 100,
        y: 200,
      });
    });

    it("requires all parameters", async () => {
      await expect(
        callTool("create_component_instance", {
          componentKey: "abc123",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Component not found"));

      const response = await callTool("create_component_instance", {
        componentKey: "invalid-key",
        x: 0,
        y: 0,
      });

      expect(response.content[0].text).toContain("Error creating component instance");
      expect(response.content[0].text).toContain("Component not found");
    });
  });

  describe("get_instance_overrides", () => {
    it("returns overrides for a given instance node ID", async () => {
      mockSendCommand.mockResolvedValue({
        success: true,
        message: JSON.stringify({
          instanceId: "inst-001",
          instanceName: "Button / Primary",
          mainComponentId: "comp-001",
          mainComponentName: "Button",
          componentProperties: {
            "Label#123": { type: "TEXT", value: "Click me" },
            "Disabled#456": { type: "BOOLEAN", value: false },
          },
          overrides: [],
        }),
      });

      const response = await callTool("get_instance_overrides", {
        nodeId: "inst-001",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("get_instance_overrides", {
        instanceNodeId: "inst-001",
      });
      expect(response.content[0].text).toContain("Successfully got instance overrides");
      expect(response.content[0].text).toContain("Button / Primary");
    });

    it("falls back to current selection when nodeId is omitted", async () => {
      mockSendCommand.mockResolvedValue({
        success: true,
        message: JSON.stringify({
          instanceId: "inst-sel",
          instanceName: "Card",
          mainComponentId: "comp-card",
          mainComponentName: "Card",
          componentProperties: {},
          overrides: [],
        }),
      });

      const response = await callTool("get_instance_overrides", {});

      expect(mockSendCommand).toHaveBeenCalledWith("get_instance_overrides", {
        instanceNodeId: null,
      });
      expect(response.content[0].text).toContain("Successfully got instance overrides");
    });

    it("handles node-not-found error gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node not found with ID: bad-id"));

      const response = await callTool("get_instance_overrides", {
        nodeId: "bad-id",
      });

      expect(response.content[0].text).toContain("Error getting instance overrides");
      expect(response.content[0].text).toContain("Node not found with ID: bad-id");
    });

    it("handles non-instance node error gracefully", async () => {
      mockSendCommand.mockRejectedValue(
        new Error('Node "Rectangle" (rect-001) is not a component instance (type: RECTANGLE)'),
      );

      const response = await callTool("get_instance_overrides", {
        nodeId: "rect-001",
      });

      expect(response.content[0].text).toContain("Error getting instance overrides");
      expect(response.content[0].text).toContain("is not a component instance");
    });
  });

  describe("set_instance_overrides", () => {
    it("applies overrides from source to target instances", async () => {
      mockSendCommand.mockResolvedValue({
        success: true,
        message: "Applied 2 properties to 2/2 instances",
        propertyCount: 2,
        results: [
          { nodeId: "inst-002", success: true },
          { nodeId: "inst-003", success: true },
        ],
      });

      const response = await callTool("set_instance_overrides", {
        sourceInstanceId: "inst-001",
        targetNodeIds: ["inst-002", "inst-003"],
      });

      expect(mockSendCommand).toHaveBeenCalledWith("set_instance_overrides", {
        sourceInstanceId: "inst-001",
        targetNodeIds: ["inst-002", "inst-003"],
      });
      expect(response.content[0].text).toContain("Successfully applied");
    });

    it("reports partial failure when some targets fail", async () => {
      mockSendCommand.mockResolvedValue({
        success: true,
        message: "Applied 2 properties to 1/2 instances",
        propertyCount: 2,
        results: [
          { nodeId: "inst-002", success: true },
          { nodeId: "rect-999", success: false, error: "Not a component instance (type: RECTANGLE)" },
        ],
      });

      const response = await callTool("set_instance_overrides", {
        sourceInstanceId: "inst-001",
        targetNodeIds: ["inst-002", "rect-999"],
      });

      expect(response.content[0].text).toContain("Successfully applied");
    });

    it("handles source node not found error gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Source node not found with ID: bad-src"));

      const response = await callTool("set_instance_overrides", {
        sourceInstanceId: "bad-src",
        targetNodeIds: ["inst-002"],
      });

      expect(response.content[0].text).toContain("Error");
      expect(response.content[0].text).toContain("Source node not found");
    });

    it("requires both sourceInstanceId and targetNodeIds", async () => {
      await expect(
        callTool("set_instance_overrides", {
          targetNodeIds: ["inst-002"],
        }),
      ).rejects.toThrow();

      await expect(
        callTool("set_instance_overrides", {
          sourceInstanceId: "inst-001",
        }),
      ).rejects.toThrow();
    });
  });
});
