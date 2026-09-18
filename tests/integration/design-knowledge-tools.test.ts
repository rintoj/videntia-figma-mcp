import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDesignKnowledgeTool } from "../../src/videntia_figma_mcp/tools/design-knowledge-tools";

const EXPECTED_IDS = [
  "anti-ai-slop",
  "typography",
  "color",
  "motion",
  "icons",
  "craft-details",
  "skill",
  "depth-elevation",
  "spacing-radius",
  "auto-layout",
  "components",
  "design-system-usage",
  "build-workflow",
];

interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

describe("get_design_knowledge tool", () => {
  let handler: (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;
  let schema: z.ZodObject<{ module: z.ZodEnum<[string, ...string[]]> }>;
  let description: string;

  beforeAll(() => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      const [, desc, shape, fn] = args;
      description = desc;
      schema = z.object(shape) as typeof schema;
      handler = fn;
      return (originalTool as any)(...args);
    });
    registerDesignKnowledgeTool(server);
  });

  it("exposes exactly the registered modules in the schema enum", () => {
    expect([...schema.shape.module.options].sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("documents every module id in the parameter description", () => {
    const paramDescription = schema.shape.module.description ?? "";
    for (const id of EXPECTED_IDS) {
      expect(paramDescription).toContain(id);
    }
    expect(description.length).toBeGreaterThan(0);
  });

  it.each(EXPECTED_IDS)("returns non-empty content for '%s'", async (id) => {
    const result = await handler(schema.parse({ module: id }), {});
    expect(result.isError).toBeUndefined();
    expect(result.content[0].type).toBe("text");
    const text = result.content[0].text;
    expect(text.startsWith("# ")).toBe(true);
    expect(text.length).toBeGreaterThan(200);
    const heading = text.split("\n")[0];
    expect(text.indexOf(heading, heading.length)).toBe(-1);
  });

  it.each(["nope", "", "Typography", " typography ", 42])("rejects invalid module %p", (value) => {
    expect(schema.safeParse({ module: value }).success).toBe(false);
  });

  it("rejects a missing module param", () => {
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("returns an error listing available modules when the handler receives an unknown id", async () => {
    const result = await handler({ module: "nope" }, {});
    expect(result.isError).toBe(true);
    for (const id of EXPECTED_IDS) {
      expect(result.content[0].text).toContain(id);
    }
  });
});
