import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerModificationTools } from "../../src/videntia_figma_mcp/tools/modification-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("effect and gradient variable params", () => {
  let mockSendCommand: jest.Mock;
  const toolHandlers = new Map<string, Function>();
  const toolSchemas = new Map<string, z.ZodObject<any>>();

  beforeAll(() => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
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
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
  });

  beforeEach(() => {
    mockSendCommand.mockReset();
  });

  async function callTool(toolName: string, args: any) {
    return await toolHandlers.get(toolName)!(toolSchemas.get(toolName)!.parse(args), { meta: {} });
  }

  const variableParams = {
    colorVariable: "shadow/color",
    radiusVariable: "shadow/blur",
    spreadVariable: "shadow/spread",
    offsetXVariable: "shadow/x",
    offsetYVariable: "shadow/y",
  };

  it("set_effects forwards per-effect variable params", async () => {
    mockSendCommand.mockResolvedValue({ name: "Card", effects: [] });
    await callTool("set_effects", { nodeId: "1-2", effects: [{ type: "DROP_SHADOW", ...variableParams }] });
    expect(mockSendCommand).toHaveBeenCalledWith("set_effects", {
      nodeId: "1:2",
      effects: [{ type: "DROP_SHADOW", ...variableParams }],
    });
  });

  it.each(["create_effect_style", "update_effect_style"])("%s forwards per-effect variable params", async (tool) => {
    mockSendCommand.mockResolvedValue({ id: "S:1,", name: "shadow/md" });
    const args = { name: "shadow/md", styleId: "shadow/md", effects: [{ type: "DROP_SHADOW", colorVariable: "ring" }] };
    await callTool(tool, args);
    expect(mockSendCommand).toHaveBeenCalledWith(
      tool,
      expect.objectContaining({ effects: [{ type: "DROP_SHADOW", colorVariable: "ring" }] }),
    );
  });

  it("set_gradient_fill accepts a stop with only colorVariable", async () => {
    mockSendCommand.mockResolvedValue({ id: "1:2", name: "Hero", gradientType: "LINEAR", stopsCount: 2 });
    await callTool("set_gradient_fill", {
      nodeId: "1:2",
      type: "LINEAR",
      stops: [
        { colorVariable: "brand/primary", position: 0 },
        { color: { r: 1, g: 1, b: 1 }, position: 1 },
      ],
    });
    expect(mockSendCommand).toHaveBeenCalledWith(
      "set_gradient_fill",
      expect.objectContaining({
        stops: [
          { colorVariable: "brand/primary", position: 0 },
          { color: { r: 1, g: 1, b: 1 }, position: 1 },
        ],
      }),
    );
  });

  it("set_gradient_fill rejects a stop with neither color nor colorVariable", async () => {
    await expect(
      callTool("set_gradient_fill", {
        nodeId: "1:2",
        type: "LINEAR",
        stops: [{ position: 0 }, { color: { r: 1, g: 1, b: 1 }, position: 1 }],
      }),
    ).rejects.toThrow("Each stop needs a color or a colorVariable");
    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  it("bind_variable forwards effect and gradient stop fields and reports style targets", async () => {
    mockSendCommand.mockResolvedValue({
      styleId: "S:1,",
      name: "shadow/md",
      field: "effects/0/color",
      variableName: "shadow/color",
      variableType: "COLOR",
    });
    const res = await callTool("bind_variable", {
      nodeId: "shadow/md",
      variableId: "shadow/color",
      field: "effects/0/color",
    });
    expect(mockSendCommand).toHaveBeenCalledWith("bind_variable", {
      nodeId: "shadow/md",
      variableId: "shadow/color",
      field: "effects/0/color",
    });
    expect(res.content[0].text).toContain('on style "shadow/md"');
  });

  it("unbind_variable forwards gradient stop fields", async () => {
    mockSendCommand.mockResolvedValue({ nodeId: "1:2", name: "Hero", field: "fills/0/gradientStops/1/color" });
    await callTool("unbind_variable", { nodeId: "1-2", field: "fills/0/gradientStops/1/color" });
    expect(mockSendCommand).toHaveBeenCalledWith("unbind_variable", {
      nodeId: "1:2",
      field: "fills/0/gradientStops/1/color",
    });
  });
});
