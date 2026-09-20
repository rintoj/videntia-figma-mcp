import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPrototypeTools } from "../../src/videntia_figma_mcp/tools/prototype-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("prototype tools integration", () => {
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
        const [name, , schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });

    registerPrototypeTools(server);
  });

  async function callTool(toolName: string, args: any) {
    const schema = toolSchemas.get(toolName);
    const handler = toolHandlers.get(toolName);
    if (!schema || !handler) throw new Error(`Tool ${toolName} not found`);
    return await handler(schema.parse(args), { meta: {} });
  }

  it("registers every prototype tool", () => {
    for (const name of [
      "get_reactions",
      "get_frame_animations",
      "map_prototype_flows",
      "add_prototype_link",
      "set_reactions",
      "remove_prototype_link",
    ]) {
      expect(toolHandlers.has(name)).toBe(true);
    }
  });

  describe("get_reactions", () => {
    // The plugin returns `actions` (an ARRAY). The old renderer read
    // `reaction.action` (singular), so every line printed
    // "unknown -> unknown (dest: -)". The previous test mocked a shape the
    // plugin never produces, which is why it never caught this.
    const realisticResponse = {
      nodeCount: 1,
      nodesWithReactions: 1,
      reactions: [
        {
          nodeId: "btn-1",
          nodeName: "CTA Button",
          reactionCount: 1,
          reactions: [
            {
              trigger: { type: "ON_CLICK" },
              actions: [
                {
                  type: "NODE",
                  destinationId: "frame-2",
                  destinationName: "Checkout",
                  navigation: "NAVIGATE",
                  transitionType: "SMART_ANIMATE",
                  duration: 300,
                  easing: { type: "EASE_OUT" },
                },
              ],
            },
          ],
        },
      ],
    };

    it("renders the real trigger, action and destination", async () => {
      mockSendCommand.mockResolvedValue(realisticResponse);

      const response = await callTool("get_reactions", { nodeIds: ["btn-1"] });
      const text = response.content[0].text;

      expect(text).toContain("ON_CLICK");
      expect(text).toContain("Checkout");
      expect(text).toContain("SMART_ANIMATE");
      expect(text).toContain("300ms");
      // The regression itself: no placeholder output.
      expect(text).not.toContain("unknown → unknown");
      expect(text).not.toContain("dest: -");
    });

    it("renders EVERY action of a multi-action reaction", async () => {
      mockSendCommand.mockResolvedValue({
        nodeCount: 1,
        nodesWithReactions: 1,
        reactions: [
          {
            nodeId: "btn-1",
            nodeName: "Submit",
            reactionCount: 1,
            reactions: [
              {
                trigger: { type: "ON_CLICK" },
                actions: [
                  { type: "SET_VARIABLE", destinationId: undefined },
                  { type: "NODE", destinationId: "frame-9", destinationName: "Success", navigation: "NAVIGATE" },
                ],
              },
            ],
          },
        ],
      });

      const text = (await callTool("get_reactions", { nodeIds: ["btn-1"] })).content[0].text;
      expect(text).toContain("SET_VARIABLE");
      expect(text).toContain("Success");
    });

    it("reports an AFTER_TIMEOUT delay in milliseconds", async () => {
      mockSendCommand.mockResolvedValue({
        nodeCount: 1,
        nodesWithReactions: 1,
        reactions: [
          {
            nodeId: "splash",
            nodeName: "Splash",
            reactionCount: 1,
            reactions: [
              {
                trigger: { type: "AFTER_TIMEOUT", timeout: 2000 },
                actions: [{ type: "NODE", destinationId: "home", destinationName: "Home" }],
              },
            ],
          },
        ],
      });

      const text = (await callTool("get_reactions", { nodeIds: ["splash"] })).content[0].text;
      expect(text).toContain("after 2000ms");
    });

    it("coerces a string nodeIds into an array", async () => {
      mockSendCommand.mockResolvedValue({ nodeCount: 0, nodesWithReactions: 0, reactions: [] });
      await callTool("get_reactions", { nodeIds: "btn-1" });
      expect(mockSendCommand).toHaveBeenCalledWith("get_reactions", { nodeIds: ["btn-1"] });
    });

    it("requires nodeIds", async () => {
      await expect(callTool("get_reactions", {})).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Nodes not found"));
      const text = (await callTool("get_reactions", { nodeIds: ["nope"] })).content[0].text;
      expect(text).toContain("Error getting reactions");
      expect(text).toContain("Nodes not found");
    });
  });

  describe("add_prototype_link", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        nodeName: "CTA",
        destinationName: "Checkout",
        trigger: "ON_CLICK",
        navigation: "NAVIGATE",
        reactionCount: 1,
      });
    });

    it("forwards the full transition surface", async () => {
      await callTool("add_prototype_link", {
        nodeId: "btn-1",
        destinationId: "frame-2",
        transitionType: "PUSH",
        transitionDuration: 250,
        transitionEasing: "GENTLE",
        direction: "LEFT",
        matchLayers: true,
        preserveScrollPosition: true,
      });

      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("add_prototype_link");
      expect(params).toMatchObject({
        nodeId: "btn-1",
        destinationId: "frame-2",
        transitionType: "PUSH",
        transitionDuration: 250,
        transitionEasing: "GENTLE",
        direction: "LEFT",
        matchLayers: true,
        preserveScrollPosition: true,
      });
    });

    it("rejects an unknown transition type instead of writing it", async () => {
      await expect(
        callTool("add_prototype_link", {
          nodeId: "btn-1",
          destinationId: "frame-2",
          transitionType: "DISOLVE", // typo
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects an unknown easing type", async () => {
      await expect(
        callTool("add_prototype_link", {
          nodeId: "btn-1",
          destinationId: "frame-2",
          transitionEasing: "EASE_SIDEWAYS",
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("accepts the triggers the old enum omitted", async () => {
      await callTool("add_prototype_link", {
        nodeId: "btn-1",
        destinationId: "frame-2",
        trigger: "ON_KEY_DOWN",
        keyCodes: [13],
      });
      expect(mockSendCommand).toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Node not found"));
      const text = (await callTool("add_prototype_link", { nodeId: "x", destinationId: "y" })).content[0].text;
      expect(text).toContain("Error adding prototype link");
    });
  });

  describe("set_reactions", () => {
    it("forwards a multi-action reaction", async () => {
      mockSendCommand.mockResolvedValue({ nodeName: "Submit", reactionCount: 1, replacedCount: 2 });

      const response = await callTool("set_reactions", {
        nodeId: "btn-1",
        reactions: [
          {
            trigger: { type: "ON_CLICK" },
            actions: [
              { type: "SET_VARIABLE", variableId: "var-1" },
              {
                type: "NODE",
                destinationId: "frame-2",
                navigation: "NAVIGATE",
                transition: { type: "DISSOLVE", duration: 200, easing: { type: "LINEAR" } },
              },
            ],
          },
        ],
      });

      const [, params] = mockSendCommand.mock.calls[0];
      expect(params.reactions[0].actions).toHaveLength(2);
      expect(params.reactions[0].actions[1].transition.duration).toBe(200);
      expect(response.content[0].text).toContain("replaced 2");
    });

    it("accepts an empty array to clear reactions", async () => {
      mockSendCommand.mockResolvedValue({ nodeName: "Btn", reactionCount: 0, replacedCount: 3 });
      await callTool("set_reactions", { nodeId: "btn-1", reactions: [] });
      expect(mockSendCommand).toHaveBeenCalledWith("set_reactions", { nodeId: "btn-1", reactions: [] });
    });

    it("rejects a reaction with no actions", async () => {
      await expect(
        callTool("set_reactions", {
          nodeId: "btn-1",
          reactions: [{ trigger: { type: "ON_CLICK" }, actions: [] }],
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });
  });

  describe("remove_prototype_link", () => {
    it("forwards the destination filter", async () => {
      mockSendCommand.mockResolvedValue({ nodeName: "CTA", removedCount: 1, remainingCount: 0 });
      await callTool("remove_prototype_link", { nodeId: "btn-1", destinationId: "frame-2" });
      expect(mockSendCommand).toHaveBeenCalledWith("remove_prototype_link", {
        nodeId: "btn-1",
        destinationId: "frame-2",
      });
    });

    it("omits the filter when clearing every reaction", async () => {
      mockSendCommand.mockResolvedValue({ nodeName: "CTA", removedCount: 3, remainingCount: 0 });
      await callTool("remove_prototype_link", { nodeId: "btn-1" });
      expect(mockSendCommand).toHaveBeenCalledWith("remove_prototype_link", {
        nodeId: "btn-1",
        destinationId: undefined,
      });
    });
  });

  describe("map_prototype_flows", () => {
    it("forwards optional pageId", async () => {
      mockSendCommand.mockResolvedValue({ nodes: [], edges: [], entryPoints: [] });
      await callTool("map_prototype_flows", { pageId: "page-1" });
      expect(mockSendCommand).toHaveBeenCalledWith("map_prototype_flows", { pageId: "page-1" });
    });

    it("works without pageId", async () => {
      mockSendCommand.mockResolvedValue({ nodes: [], edges: [], entryPoints: [] });
      await callTool("map_prototype_flows", {});
      expect(mockSendCommand).toHaveBeenCalledWith("map_prototype_flows", { pageId: undefined });
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("boom"));
      const text = (await callTool("map_prototype_flows", {})).content[0].text;
      expect(text).toContain("Error mapping prototype flows");
    });
  });

  describe("get_frame_animations", () => {
    it("forwards the nodeId", async () => {
      mockSendCommand.mockResolvedValue({ animations: [] });
      await callTool("get_frame_animations", { nodeId: "frame-1" });
      expect(mockSendCommand).toHaveBeenCalledWith("get_frame_animations", { nodeId: "frame-1" });
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("boom"));
      const text = (await callTool("get_frame_animations", { nodeId: "x" })).content[0].text;
      expect(text).toContain("Error getting frame animations");
    });
  });
});
