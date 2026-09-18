import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerVariableTools } from "../../src/videntia_figma_mcp/tools/variable-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

const LIMIT_MESSAGE =
  'Mode limit reached: collection "Design Tokens" already has 1 mode, and Figma refused to add "Dark".';

describe("create_complete_design_system mode refusals", () => {
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockReset();

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
    registerVariableTools(server);

    mockSendCommand.mockImplementation(async (command: string, params: any) => {
      switch (command) {
        case "create_variable_collection":
          return { collectionId: "col-1", success: true };
        case "add_mode_to_collection":
          if (params.modeName === "Dark") throw new Error(LIMIT_MESSAGE);
          return { modeId: "m-2", modeName: params.modeName, success: true };
        case "apply_default_theme":
          return { created: 10 };
        case "create_spacing_system":
          return { primitiveCount: 5 };
        case "create_typography_system":
        case "create_radius_system":
          return { totalVariables: 3 };
        default:
          return {};
      }
    });
  });

  async function callTool(toolName: string, args: any) {
    const schema = toolSchemas.get(toolName)!;
    const handler = toolHandlers.get(toolName)!;
    return await handler(schema.parse(args), { meta: {} });
  }

  it("skips a refused mode, continues, and reports it", async () => {
    const response = await callTool("create_complete_design_system", {
      modes: ["Light", "Dark", "High Contrast"],
    });
    const text: string = response.content[0].text;

    expect(text).toContain("Complete Design System Created!");
    expect(text).toContain("Modes: Light, High Contrast");
    expect(text).toContain("Skipped Modes (1):");
    expect(text).toContain(`- Dark: ${LIMIT_MESSAGE}`);

    const commands = mockSendCommand.mock.calls.map((c) => c[0]);
    expect(commands).toEqual(
      expect.arrayContaining(["create_spacing_system", "create_typography_system", "create_radius_system"]),
    );
    expect(commands).not.toContain("duplicate_mode_values");
  });

  it("omits the skipped section when every mode is added", async () => {
    const response = await callTool("create_complete_design_system", { modes: ["Light", "High Contrast"] });
    const text: string = response.content[0].text;
    expect(text).toContain("Modes: Light, High Contrast");
    expect(text).not.toContain("Skipped Modes");
  });
});
