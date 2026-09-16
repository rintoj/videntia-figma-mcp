import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerModificationTools } from "../../src/videntia_figma_mcp/tools/modification-tools";
import { registerCreationTools } from "../../src/videntia_figma_mcp/tools/creation-tools";
import { registerVariableTools } from "../../src/videntia_figma_mcp/tools/variable-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

/**
 * One colour contract, asserted on the ACTUAL wire payload.
 *
 * Zod silently strips undeclared keys, so a union that accepts hex OR an
 * object must DECLARE both — otherwise the object form is dropped before the
 * handler runs and the tool reports a success that wrote nothing.
 */
describe("unified color contract", () => {
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();
    mockSendCommand.mockResolvedValue({ name: "Node", id: "1:1", stopsCount: 2 });

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
    registerModificationTools(server);
    registerCreationTools(server);
    registerVariableTools(server);
  });

  async function callTool(toolName: string, args: any) {
    const schema = toolSchemas.get(toolName)!;
    const handler = toolHandlers.get(toolName)!;
    return await handler(schema.parse(args), { meta: {} });
  }

  const wire = () => mockSendCommand.mock.calls[0][1];

  describe("set_fill_color", () => {
    it("still forwards a hex string verbatim", async () => {
      await callTool("set_fill_color", { nodeId: "1:1", color: "#ff0000" });
      expect(wire().color).toBe("#ff0000");
    });

    it("accepts an {r,g,b,a} object instead of rejecting it", async () => {
      await callTool("set_fill_color", { nodeId: "1:1", color: { r: 1, g: 0, b: 0, a: 1 } });
      expect(wire().color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    });

    it("accepts 0-255 channels", async () => {
      await callTool("set_fill_color", { nodeId: "1:1", color: { r: 255, g: 128, b: 0 } });
      expect(wire().color.r).toBe(1);
      expect(wire().color.g).toBeCloseTo(128 / 255);
    });

    it("accepts an array", async () => {
      await callTool("set_fill_color", { nodeId: "1:1", color: [0, 255, 0] });
      expect(wire().color).toEqual({ r: 0, g: 1, b: 0, a: 1 });
    });

    it("accepts 0-255 flat r,g,b channels", async () => {
      await callTool("set_fill_color", { nodeId: "1:1", r: 255, g: 0, b: 0 });
      expect(wire().color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    });
  });

  describe("set_stroke_color", () => {
    it("accepts an object color", async () => {
      await callTool("set_stroke_color", { nodeId: "1:1", color: { r: 0, g: 0, b: 255 } });
      expect(wire().color).toEqual({ r: 0, g: 0, b: 1, a: 1 });
    });
  });

  describe("set_gradient_fill", () => {
    it("accepts a hex string at stops[].color", async () => {
      await callTool("set_gradient_fill", {
        nodeId: "1:1",
        type: "LINEAR",
        stops: [
          { color: "#ff0000", position: 0 },
          { color: "#0000ff", position: 1 },
        ],
      });
      expect(wire().stops[0].color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
      expect(wire().stops[1].color).toEqual({ r: 0, g: 0, b: 1, a: 1 });
      expect(wire().stops[0].position).toBe(0);
    });

    it("still accepts object stops", async () => {
      await callTool("set_gradient_fill", {
        nodeId: "1:1",
        type: "LINEAR",
        stops: [
          { color: { r: 1, g: 1, b: 1 }, position: 0 },
          { color: { r: 0, g: 0, b: 0 }, position: 1 },
        ],
      });
      expect(wire().stops[0].color).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    });
  });

  describe("create_frame / create_rectangle", () => {
    it("create_frame accepts a string fillColor", async () => {
      await callTool("create_frame", { x: 0, y: 0, width: 10, height: 10, fillColor: "#ff0000" });
      expect(wire().fillColor).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    });

    it("create_frame still accepts an object fillColor", async () => {
      await callTool("create_frame", { x: 0, y: 0, width: 10, height: 10, fillColor: { r: 0, g: 1, b: 0 } });
      expect(wire().fillColor).toEqual({ r: 0, g: 1, b: 0, a: 1 });
    });

    it("create_rectangle accepts 0-255 channels", async () => {
      await callTool("create_rectangle", { x: 0, y: 0, width: 10, height: 10, fillColor: { r: 255, g: 0, b: 0 } });
      expect(wire().fillColor).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    });
  });

  describe("create_color_style", () => {
    it("accepts a hex color and a hex gradient stop", async () => {
      await callTool("create_color_style", { name: "brand/blue", color: "#0000ff" });
      expect(wire().color).toBe("#0000ff");
    });
  });

  describe("calculate_contrast_ratio", () => {
    it("accepts hex strings (58 measured failures)", async () => {
      const res = await callTool("calculate_contrast_ratio", { foreground: "#ffffff", background: "#000000" });
      expect(res.content[0].text).toContain("21.00:1");
      expect(res.content[0].text).not.toContain("NaN");
    });

    it("accepts 0-255 objects (90 measured failures)", async () => {
      const res = await callTool("calculate_contrast_ratio", {
        foreground: { r: 255, g: 255, b: 255 },
        background: { r: 0, g: 0, b: 0 },
      });
      expect(res.content[0].text).toContain("21.00:1");
    });

    it("still accepts 0-1 objects", async () => {
      const res = await callTool("calculate_contrast_ratio", {
        foreground: { r: 1, g: 1, b: 1 },
        background: { r: 0, g: 0, b: 0 },
      });
      expect(res.content[0].text).toContain("21.00:1");
    });

    it("never reports NaN for a bad value — it errors", async () => {
      const res = await callTool("calculate_contrast_ratio", { foreground: "not-a-color", background: "#000" });
      expect(res.content[0].text).not.toContain("NaN");
      expect(res.content[0].text).toContain("Invalid color");
    });

    it("makes no Figma round trip (pure server-side)", async () => {
      await callTool("calculate_contrast_ratio", { foreground: "#fff", background: "#000" });
      expect(mockSendCommand).not.toHaveBeenCalled();
    });
  });

  describe("calculate_contrast_ratios (vectorized)", () => {
    it("evaluates many pairs in one call with no Figma round trip", async () => {
      const res = await callTool("calculate_contrast_ratios", {
        pairs: [
          { label: "body", foreground: "#ffffff", background: "#000000" },
          { label: "muted", foreground: { r: 255, g: 255, b: 255 }, background: { r: 0, g: 0, b: 0 } },
          { label: "low", foreground: "#777777", background: "#808080" },
        ],
      });
      expect(mockSendCommand).not.toHaveBeenCalled();
      const text = res.content[0].text;
      expect(text).toContain("3 pairs");
      expect(text).toContain("body");
      expect(text).toContain("21.00:1");
      expect(text).not.toContain("NaN");
    });

    it("reports a per-row error without aborting the rest", async () => {
      const res = await callTool("calculate_contrast_ratios", {
        pairs: [
          { foreground: "bogus", background: "#000" },
          { foreground: "#fff", background: "#000" },
        ],
      });
      const text = res.content[0].text;
      expect(text).toContain("Invalid color");
      expect(text).toContain("21.00:1");
    });
  });

  describe("create_variable COLOR values", () => {
    it("accepts hex, 0-1 and 0-255 forms and normalizes them", async () => {
      for (const value of ["#ff0000", { r: 1, g: 0, b: 0 }, { r: 255, g: 0, b: 0 }, [1, 0, 0]]) {
        mockSendCommand.mockClear();
        await callTool("create_variable", {
          collectionId: "c1",
          name: "brand/primary",
          type: "COLOR",
          value,
        });
        const payload = mockSendCommand.mock.calls[0][1];
        expect(payload.value).toEqual({ r: 1, g: 0, b: 0, a: 1 });
      }
    });
  });
});
