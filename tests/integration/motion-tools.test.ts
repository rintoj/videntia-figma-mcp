import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMotionTools } from "../../src/videntia_figma_mcp/tools/motion-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("motion tools integration", () => {
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

    registerMotionTools(server);
  });

  async function callTool(toolName: string, args: any) {
    const schema = toolSchemas.get(toolName);
    const handler = toolHandlers.get(toolName);
    if (!schema || !handler) throw new Error(`Tool ${toolName} not found`);
    return await handler(schema.parse(args), { meta: {} });
  }

  it("registers every motion tool", () => {
    for (const name of [
      "get_motion_info",
      "list_animation_styles",
      "apply_animation_style",
      "remove_animation_style",
      "set_keyframe_track",
      "remove_keyframe_track",
      "set_timeline_duration",
      "animate_node",
    ]) {
      expect(toolHandlers.has(name)).toBe(true);
    }
  });

  describe("get_motion_info", () => {
    const response = {
      motionSupported: true,
      playheadPositionMs: 500,
      nodeCount: 1,
      nodesWithMotion: 1,
      nodes: [
        {
          nodeId: "1:2",
          nodeName: "Hero",
          nodeType: "FRAME",
          timelines: [{ id: "tl-1", durationMs: 1000 }],
          animationStyles: [{ id: "as-1", name: "Fade", styleId: "S:1" }],
          manualKeyframeTracks: [{ field: "OPACITY", keyframeCount: 2, positions: [0, 200] }],
          hasMotion: true,
        },
      ],
    };

    it("renders a compact line per track by default", async () => {
      mockSendCommand.mockResolvedValue(response);
      const text = (await callTool("get_motion_info", { nodeIds: ["1:2"] })).content[0].text;

      expect(text).toContain("Hero");
      expect(text).toContain("OPACITY: 2 keyframe(s) @ [0, 200]ms");
      expect(text).toContain("playhead=500ms");
      // Compact must not be a raw dump.
      expect(text).not.toContain('"nodeType"');
    });

    it("returns the raw structure for output_format json", async () => {
      mockSendCommand.mockResolvedValue(response);
      const text = (await callTool("get_motion_info", { nodeIds: ["1:2"], output_format: "json" })).content[0].text;
      expect(JSON.parse(text).nodes[0].nodeName).toBe("Hero");
    });

    it("reports an actionable reason when Motion is unavailable", async () => {
      mockSendCommand.mockResolvedValue({
        motionSupported: false,
        nodeCount: 1,
        nodesWithMotion: 0,
        nodes: [],
        reason: "The Figma Motion API is not available in this editor.",
      });
      const text = (await callTool("get_motion_info", { nodeIds: ["1:2"] })).content[0].text;
      expect(text).toContain("motion unavailable");
      expect(text).toContain("not available in this editor");
    });

    it("coerces a single nodeId string", async () => {
      mockSendCommand.mockResolvedValue({ motionSupported: true, nodeCount: 0, nodesWithMotion: 0, nodes: [] });
      await callTool("get_motion_info", { nodeIds: "1:2" });
      expect(mockSendCommand).toHaveBeenCalledWith("get_motion_info", { nodeIds: ["1:2"] });
    });
  });

  describe("set_keyframe_track", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        nodeName: "Hero",
        field: "OPACITY",
        keyframeCount: 2,
        warnings: [],
      });
    });

    it("forwards a property-shorthand field and ms positions", async () => {
      await callTool("set_keyframe_track", {
        nodeId: "1:2",
        field: "OPACITY",
        keyframes: [
          { timelinePosition: 0, value: 0 },
          { timelinePosition: 200, value: 1, easing: "EASE_OUT" },
        ],
      });

      const [command, params] = mockSendCommand.mock.calls[0];
      expect(command).toBe("set_keyframe_track");
      expect(params.field).toBe("OPACITY");
      expect(params.keyframes[1]).toMatchObject({ timelinePosition: 200, value: 1, easing: "EASE_OUT" });
    });

    it("accepts the indexed fills/strokes/effects field form", async () => {
      await callTool("set_keyframe_track", {
        nodeId: "1:2",
        field: { type: "INDEXED_ITEM", collection: "effects", index: 0, field: "RADIUS" },
        keyframes: [{ timelinePosition: 0, value: 4 }],
      });
      expect(mockSendCommand.mock.calls[0][1].field).toMatchObject({ collection: "effects", index: 0 });
    });

    it("rejects an unknown property name", async () => {
      await expect(
        callTool("set_keyframe_track", {
          nodeId: "1:2",
          field: "OPACTIY", // typo
          keyframes: [{ timelinePosition: 0, value: 0 }],
        }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects an empty keyframes array", async () => {
      await expect(
        callTool("set_keyframe_track", { nodeId: "1:2", field: "OPACITY", keyframes: [] }),
      ).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("surfaces plugin warnings in the result", async () => {
      mockSendCommand.mockResolvedValue({
        nodeName: "Hero",
        field: "OPACITY",
        keyframeCount: 1,
        warnings: ["The node reports no timeline after writing this track."],
      });
      const text = (
        await callTool("set_keyframe_track", {
          nodeId: "1:2",
          field: "OPACITY",
          keyframes: [{ timelinePosition: 0, value: 0 }],
        })
      ).content[0].text;
      expect(text).toContain("Warnings:");
      expect(text).toContain("no timeline");
    });
  });

  describe("animate_node", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        nodeName: "Card",
        preset: "fade-in",
        durationMs: 200,
        easing: "EASE_OUT",
        applied: { OPACITY: "2 keyframe(s)", timelineDuration: "200ms" },
        warnings: [],
      });
    });

    it("forwards the preset and overrides", async () => {
      await callTool("animate_node", {
        nodeId: "1:2",
        preset: "slide-up",
        duration: 300,
        delay: 40,
        distance: 12,
      });
      expect(mockSendCommand).toHaveBeenCalledWith("animate_node", {
        nodeId: "1:2",
        preset: "slide-up",
        duration: 300,
        delay: 40,
        easing: undefined,
        distance: 12,
      });
    });

    it("rejects an unknown preset", async () => {
      await expect(callTool("animate_node", { nodeId: "1:2", preset: "fade-sideways" })).rejects.toThrow();
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("reports what was applied", async () => {
      const text = (await callTool("animate_node", { nodeId: "1:2", preset: "fade-in" })).content[0].text;
      expect(text).toContain("fade-in");
      expect(text).toContain("200ms");
      expect(text).toContain("OPACITY");
    });

    it("accepts a physical spring easing override", async () => {
      await callTool("animate_node", {
        nodeId: "1:2",
        preset: "scale-in",
        easing: { type: "CUSTOM_SPRING", easingFunctionSpring: { mass: 1, stiffness: 100, damping: 10 } },
      });
      expect(mockSendCommand.mock.calls[0][1].easing).toMatchObject({ type: "CUSTOM_SPRING" });
    });
  });

  describe("apply_animation_style", () => {
    it("forwards a style name and ms durations", async () => {
      mockSendCommand.mockResolvedValue({
        nodeName: "Hero",
        styleName: "Fade",
        appliedStyleId: "as-1",
        warnings: [],
      });
      await callTool("apply_animation_style", {
        nodeId: "1:2",
        style: "Fade",
        duration: 240,
        timelineOffset: 40,
      });
      expect(mockSendCommand).toHaveBeenCalledWith("apply_animation_style", {
        nodeId: "1:2",
        style: "Fade",
        duration: 240,
        timelineOffset: 40,
        props: undefined,
      });
    });

    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("no animation style named Foo"));
      const text = (await callTool("apply_animation_style", { nodeId: "1:2", style: "Foo" })).content[0].text;
      expect(text).toContain("Error applying animation style");
    });
  });

  describe("set_timeline_duration", () => {
    it("forwards duration in ms and an optional timelineId", async () => {
      mockSendCommand.mockResolvedValue({ nodeName: "Hero", timelineId: "tl-1", durationMs: 1000 });
      await callTool("set_timeline_duration", { nodeId: "1:2", duration: 1000 });
      expect(mockSendCommand).toHaveBeenCalledWith("set_timeline_duration", {
        nodeId: "1:2",
        duration: 1000,
        timelineId: undefined,
      });
    });

    it("surfaces the no-timeline limitation", async () => {
      mockSendCommand.mockRejectedValue(new Error('node "Hero" has no timeline'));
      const text = (await callTool("set_timeline_duration", { nodeId: "1:2", duration: 500 })).content[0].text;
      expect(text).toContain("Error setting timeline duration");
      expect(text).toContain("no timeline");
    });
  });

  describe("remove_keyframe_track / remove_animation_style", () => {
    it("removes a track", async () => {
      mockSendCommand.mockResolvedValue({ nodeName: "Hero", field: "OPACITY" });
      const text = (await callTool("remove_keyframe_track", { nodeId: "1:2", field: "OPACITY" })).content[0].text;
      expect(text).toContain("Removed the OPACITY keyframe track");
    });

    it("removes an applied style", async () => {
      mockSendCommand.mockResolvedValue({ nodeName: "Hero", remainingCount: 0 });
      const text = (await callTool("remove_animation_style", { nodeId: "1:2", id: "as-1" })).content[0].text;
      expect(text).toContain("Removed animation style");
    });
  });
});
