import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocumentTools } from "../../src/videntia_figma_mcp/tools/document-tools";
import type { GetDesignSystemResult } from "../../src/videntia_figma_mcp/types/index";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
  getOpenChannels: jest.fn().mockResolvedValue([]),
}));

describe("get_design_system tool", () => {
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
        const [name, description, schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });

    registerDocumentTools(server);
  });

  async function callTool(toolName: string, args: any = {}) {
    const schema = toolSchemas.get(toolName);
    const handler = toolHandlers.get(toolName);
    if (!schema || !handler) {
      throw new Error(`Tool ${toolName} not found`);
    }
    const validatedArgs = schema.parse(args);
    return await handler(validatedArgs, { meta: {} });
  }

  function makeResult(overrides?: Partial<GetDesignSystemResult>): GetDesignSystemResult {
    return {
      pages: [
        { id: "page:1", name: "Screens" },
        { id: "page:2", name: "Components" },
        { id: "page:3", name: "Draft" },
      ],
      variables: [
        {
          id: "v:1",
          name: "background/primary",
          description: "Main app background",
          resolvedType: "COLOR",
          collectionName: "Colors",
          values: [{ modeId: "m1", modeName: "Light", value: { r: 1, g: 1, b: 1, a: 1 } }],
        },
        {
          id: "v:2",
          name: "text/primary",
          description: "Main body text",
          resolvedType: "COLOR",
          collectionName: "Colors",
          values: [{ modeId: "m1", modeName: "Light", value: { r: 0, g: 0, b: 0, a: 1 } }],
        },
        {
          id: "v:3",
          name: "space/4",
          description: "Default spacing",
          resolvedType: "FLOAT",
          collectionName: "Spacing",
          values: [{ modeId: "m1", modeName: "Default", value: 16 }],
        },
        {
          id: "v:4",
          name: "radius/md",
          description: "Medium rounding",
          resolvedType: "FLOAT",
          collectionName: "Radius",
          values: [{ modeId: "m1", modeName: "Default", value: 8 }],
        },
      ],
      textStyles: [
        {
          id: "ts:1",
          name: "heading/h1",
          fontSize: 32,
          fontName: { family: "Inter", style: "Bold" },
          lineHeight: { unit: "AUTO" },
        },
      ],
      effectStyles: [
        {
          id: "es:1",
          name: "shadow/md",
          description: "Medium elevation",
          effects: [],
        },
      ],
      ...overrides,
    };
  }

  it("is registered as a tool", () => {
    expect(toolHandlers.has("get_design_system")).toBe(true);
  });

  it("returns formatted markdown with variable categories", async () => {
    mockSendCommand.mockResolvedValue(makeResult());

    const response = await callTool("get_design_system");
    const text = response.content[0].text;

    expect(text).toContain("# Design System");
    expect(text).toContain("## Color Variables");
    expect(text).toContain("## Spacing Variables");
    expect(text).toContain("## Radius Variables");
    expect(text).toContain("## Text Styles");
    expect(text).toContain("## Effect Styles");
  });

  it("includes variable IDs in output", async () => {
    mockSendCommand.mockResolvedValue(makeResult());

    const response = await callTool("get_design_system");
    const text = response.content[0].text;

    expect(text).toContain("v:1");
    expect(text).toContain("v:2");
    expect(text).toContain("v:3");
    expect(text).toContain("v:4");
    expect(text).toContain("ts:1");
    expect(text).toContain("es:1");
  });

  it("derives correct Tailwind classes for color variables", async () => {
    mockSendCommand.mockResolvedValue(makeResult());

    const response = await callTool("get_design_system");
    const text = response.content[0].text;

    expect(text).toContain("bg-background-primary");
    expect(text).toContain("text-text-primary");
  });

  it("derives correct Tailwind classes for spacing and radius", async () => {
    mockSendCommand.mockResolvedValue(makeResult());

    const response = await callTool("get_design_system");
    const text = response.content[0].text;

    expect(text).toContain("p-space-4");
    expect(text).toContain("gap-space-4");
    expect(text).toContain("rounded-radius-md");
  });

  it("derives correct Tailwind classes for text and effect styles", async () => {
    mockSendCommand.mockResolvedValue(makeResult());

    const response = await callTool("get_design_system");
    const text = response.content[0].text;

    expect(text).toContain("text-heading-h1");
    expect(text).toContain("shadow-shadow-md");
  });

  it("groups variables by category correctly", async () => {
    mockSendCommand.mockResolvedValue(makeResult());

    const response = await callTool("get_design_system");
    const text = response.content[0].text;

    // Color section should have color vars but not spacing/radius
    const colorSection = text.split("## Spacing Variables")[0];
    expect(colorSection).toContain("background/primary");
    expect(colorSection).not.toContain("space/4");
    expect(colorSection).not.toContain("radius/md");
  });

  it("handles empty design system", async () => {
    mockSendCommand.mockResolvedValue({
      pages: [],
      variables: [],
      textStyles: [],
      effectStyles: [],
    });

    const response = await callTool("get_design_system");
    const text = response.content[0].text;

    expect(text).toContain("No color variables found.");
    expect(text).toContain("No spacing variables found.");
    expect(text).toContain("No radius variables found.");
    expect(text).toContain("No text styles found.");
    expect(text).toContain("No effect styles found.");
  });

  it("handles errors gracefully", async () => {
    mockSendCommand.mockRejectedValue(new Error("Connection failed"));

    const response = await callTool("get_design_system");
    const text = response.content[0].text;

    expect(text).toContain("Error getting design system: Connection failed");
  });

  it("sends command with 60s timeout", async () => {
    mockSendCommand.mockResolvedValue(makeResult());

    await callTool("get_design_system");

    expect(mockSendCommand).toHaveBeenCalledWith("get_design_system", {}, 60000);
  });

  it("includes font info in text styles table", async () => {
    mockSendCommand.mockResolvedValue(makeResult());

    const response = await callTool("get_design_system");
    const text = response.content[0].text;

    expect(text).toContain("Inter Bold");
    expect(text).toContain("32");
  });

  it("handles semantic subtle variables correctly", async () => {
    mockSendCommand.mockResolvedValue(
      makeResult({
        variables: [
          {
            id: "v:10",
            name: "semantic/success/subtle",
            description: "Success bg",
            resolvedType: "COLOR",
            collectionName: "Colors",
            values: [{ modeId: "m1", modeName: "Light", value: { r: 0.9, g: 1, b: 0.9, a: 1 } }],
          },
          {
            id: "v:11",
            name: "semantic/error",
            description: "Error text",
            resolvedType: "COLOR",
            collectionName: "Colors",
            values: [{ modeId: "m1", modeName: "Light", value: { r: 1, g: 0, b: 0, a: 1 } }],
          },
        ],
      }),
    );

    const response = await callTool("get_design_system");
    const text = response.content[0].text;

    expect(text).toContain("bg-semantic-success-subtle");
    expect(text).toContain("text-semantic-error");
  });

  it("derives purpose from TOKEN_PURPOSE_MAP when Figma description is empty", async () => {
    mockSendCommand.mockResolvedValue(
      makeResult({
        variables: [
          {
            id: "v:20",
            name: "background/primary",
            description: "",
            resolvedType: "COLOR",
            collectionName: "Colors",
            values: [{ modeId: "m1", modeName: "Light", value: { r: 1, g: 1, b: 1, a: 1 } }],
          },
        ],
        textStyles: [
          {
            id: "ts:20",
            name: "text/heading/h1",
            fontSize: 24,
            fontName: { family: "Manrope", style: "Bold" },
            lineHeight: { unit: "PERCENT", value: 130 },
          },
        ],
        effectStyles: [
          {
            id: "es:20",
            name: "shadow/lg",
            description: "",
            effects: [],
          },
        ],
      }),
    );

    const response = await callTool("get_design_system");
    const text = response.content[0].text;

    // Should derive purpose from the map, not show "-"
    expect(text).toContain("Main app background, root screen fill");
    expect(text).toContain("Page titles, primary screen headings");
    expect(text).toContain("Modals, dialogs, bottom sheets");
  });

  it("prefers Figma description over map when both exist", async () => {
    mockSendCommand.mockResolvedValue(
      makeResult({
        variables: [
          {
            id: "v:30",
            name: "background/primary",
            description: "Custom description from Figma",
            resolvedType: "COLOR",
            collectionName: "Colors",
            values: [{ modeId: "m1", modeName: "Light", value: { r: 1, g: 1, b: 1, a: 1 } }],
          },
        ],
      }),
    );

    const response = await callTool("get_design_system");
    const text = response.content[0].text;

    expect(text).toContain("Custom description from Figma");
    expect(text).not.toContain("Main app background, root screen fill");
  });
});
