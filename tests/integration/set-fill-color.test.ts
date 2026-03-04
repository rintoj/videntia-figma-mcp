import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerModificationTools } from "../../src/claude_figma_mcp/tools/modification-tools";

jest.mock("../../src/claude_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn().mockResolvedValue({ name: "MockNode" }),
}));

describe("set_fill_color tool integration", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  let toolHandler: Function;
  let toolSchema: z.ZodObject<any>;

  beforeEach(() => {
    server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });

    mockSendCommand = require("../../src/claude_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();

    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, description, schema, handler] = args;
        if (name === "set_fill_color") {
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

  describe("opacity handling (the critical fix)", () => {
    it("defaults `a` to 1 when `a` is undefined", async () => {
      const response = await callToolWithValidation({
        nodeId: "nodeA",
        r: 0.2,
        g: 0.4,
        b: 0.6,
        // a is undefined
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      const [command, payload] = mockSendCommand.mock.calls[0];
      expect(command).toBe("set_fill_color");
      expect(payload).toEqual({
        nodeId: "nodeA",
        color: { r: 0.2, g: 0.4, b: 0.6, a: 1 },
      });

      expect(response.content[0].text).toContain("RGBA(0.2, 0.4, 0.6, 1)");
    });

    it("preserves `a = 0` when explicitly provided (the main bug fix)", async () => {
      const response = await callToolWithValidation({
        nodeId: "nodeB",
        r: 0.1,
        g: 0.3,
        b: 0.5,
        a: 0, // This should be preserved as 0, not converted to 1
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      const [command, payload] = mockSendCommand.mock.calls[0];
      expect(payload.color.a).toBe(0); // Critical: should be 0, not 1

      expect(response.content[0].text).toContain("RGBA(0.1, 0.3, 0.5, 0)");
    });

    it("preserves semi-transparent values", async () => {
      const response = await callToolWithValidation({
        nodeId: "nodeC",
        r: 1,
        g: 0,
        b: 0,
        a: 0.5,
      });

      const [command, payload] = mockSendCommand.mock.calls[0];
      expect(payload.color.a).toBe(0.5);
      expect(response.content[0].text).toContain("RGBA(1, 0, 0, 0.5)");
    });
  });

  describe("RGB component handling", () => {
    it("preserves pure black (0,0,0)", async () => {
      await callToolWithValidation({
        nodeId: "nodeD",
        r: 0,
        g: 0,
        b: 0,
        a: 1,
      });

      const [command, payload] = mockSendCommand.mock.calls[0];
      expect(payload.color.r).toBe(0);
      expect(payload.color.g).toBe(0);
      expect(payload.color.b).toBe(0);
    });

    it("preserves zero red component", async () => {
      await callToolWithValidation({
        nodeId: "nodeE1",
        r: 0,
        g: 0.5,
        b: 0.8,
        a: 1,
      });

      const [command, payload] = mockSendCommand.mock.calls[0];
      expect(payload.color.r).toBe(0);
      expect(payload.color.g).toBe(0.5);
    });

    it("preserves zero green component", async () => {
      await callToolWithValidation({
        nodeId: "nodeE2",
        r: 0.5,
        g: 0,
        b: 0.8,
        a: 1,
      });

      const [command, payload] = mockSendCommand.mock.calls[0];
      expect(payload.color.g).toBe(0);
    });

    it("preserves zero blue component", async () => {
      await callToolWithValidation({
        nodeId: "nodeE3",
        r: 0.5,
        g: 0.8,
        b: 0,
        a: 1,
      });

      const [command, payload] = mockSendCommand.mock.calls[0];
      expect(payload.color.b).toBe(0);
    });
  });

  describe("Zod validation (real validation layer)", () => {
    it("rejects undefined r component", async () => {
      const result = await callToolWithValidation({
        nodeId: "nodeF1",
        // r is missing
        g: 0.5,
        b: 0.8,
        a: 1,
      });

      // Error is returned in content (handler-level validation)
      expect(result.content[0].text).toContain("Error");
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects undefined g component", async () => {
      const result = await callToolWithValidation({
        nodeId: "nodeF2",
        r: 0.5,
        // g is missing
        b: 0.8,
        a: 1,
      });

      expect(result.content[0].text).toContain("Error");
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects undefined b component", async () => {
      const result = await callToolWithValidation({
        nodeId: "nodeF3",
        r: 0.5,
        g: 0.8,
        // b is missing
        a: 1,
      });

      expect(result.content[0].text).toContain("Error");
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects string r component", async () => {
      await expect(
        callToolWithValidation({
          nodeId: "nodeF4",
          r: "red", // Invalid type
          g: 0.5,
          b: 0.8,
          a: 1,
        }),
      ).rejects.toThrow();

      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects null g component", async () => {
      await expect(
        callToolWithValidation({
          nodeId: "nodeF5",
          r: 0.5,
          g: null, // Invalid type
          b: 0.8,
          a: 1,
        }),
      ).rejects.toThrow();

      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects boolean b component", async () => {
      await expect(
        callToolWithValidation({
          nodeId: "nodeF6",
          r: 0.5,
          g: 0.8,
          b: true, // Invalid type
          a: 1,
        }),
      ).rejects.toThrow();

      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects NaN values", async () => {
      await expect(
        callToolWithValidation({
          nodeId: "nodeF7",
          r: NaN, // Invalid value
          g: 0.5,
          b: 0.8,
          a: 1,
        }),
      ).rejects.toThrow();

      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects out-of-range values", async () => {
      await expect(
        callToolWithValidation({
          nodeId: "nodeF8",
          r: 1.5, // Out of 0-1 range
          g: 0.5,
          b: 0.8,
          a: 1,
        }),
      ).rejects.toThrow();

      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("rejects negative values", async () => {
      await expect(
        callToolWithValidation({
          nodeId: "nodeF9",
          r: -0.1, // Negative value
          g: 0.5,
          b: 0.8,
          a: 1,
        }),
      ).rejects.toThrow();

      expect(mockSendCommand).not.toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("handles transparent black correctly", async () => {
      const response = await callToolWithValidation({
        nodeId: "nodeG",
        r: 0,
        g: 0,
        b: 0,
        a: 0, // Transparent black
      });

      const [command, payload] = mockSendCommand.mock.calls[0];
      expect(payload.color).toEqual({ r: 0, g: 0, b: 0, a: 0 });
      expect(response.content[0].text).toContain("RGBA(0, 0, 0, 0)");
    });

    it("handles boundary values", async () => {
      const response = await callToolWithValidation({
        nodeId: "nodeH",
        r: 1,
        g: 1,
        b: 1,
        a: 1,
      });

      const [command, payload] = mockSendCommand.mock.calls[0];
      expect(payload.color).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    });

    it("accepts valid decimal values", async () => {
      await callToolWithValidation({
        nodeId: "nodeI",
        r: 0.123,
        g: 0.456,
        b: 0.789,
        a: 0.5,
      });

      const [command, payload] = mockSendCommand.mock.calls[0];
      expect(payload.color.r).toBeCloseTo(0.123);
      expect(payload.color.g).toBeCloseTo(0.456);
      expect(payload.color.b).toBeCloseTo(0.789);
      expect(payload.color.a).toBeCloseTo(0.5);
    });
  });

  describe("hex color support", () => {
    it("accepts 6-digit hex color", async () => {
      const response = await callToolWithValidation({
        nodeId: "nodeHex1",
        color: "#ff0000",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      const [command, payload] = mockSendCommand.mock.calls[0];
      expect(command).toBe("set_fill_color");
      expect(payload).toEqual({
        nodeId: "nodeHex1",
        color: "#ff0000",
      });
      expect(response.content[0].text).toContain("#ff0000");
    });

    it("accepts 3-digit hex shorthand", async () => {
      const response = await callToolWithValidation({
        nodeId: "nodeHex2",
        color: "#f00",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      const [, payload] = mockSendCommand.mock.calls[0];
      expect(payload.color).toBe("#f00");
    });

    it("accepts 8-digit hex with alpha", async () => {
      const response = await callToolWithValidation({
        nodeId: "nodeHex3",
        color: "#ff000080",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      const [, payload] = mockSendCommand.mock.calls[0];
      expect(payload.color).toBe("#ff000080");
    });

    it("accepts 4-digit hex shorthand with alpha", async () => {
      const response = await callToolWithValidation({
        nodeId: "nodeHex4",
        color: "#f008",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      const [, payload] = mockSendCommand.mock.calls[0];
      expect(payload.color).toBe("#f008");
    });

    it("rejects missing both color and r,g,b", async () => {
      const result = await callToolWithValidation({
        nodeId: "nodeHex5",
        // no color, no r,g,b
      });

      expect(result.content[0].text).toContain("Error");
      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it("prefers color over r,g,b when both provided", async () => {
      const response = await callToolWithValidation({
        nodeId: "nodeHex6",
        color: "#00ff00",
        r: 1,
        g: 0,
        b: 0,
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      const [, payload] = mockSendCommand.mock.calls[0];
      expect(payload.color).toBe("#00ff00");
    });
  });
});
