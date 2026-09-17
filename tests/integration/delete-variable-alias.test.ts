import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerVariableTools } from "../../src/videntia_figma_mcp/tools/variable-tools";
import {
  instrumentToolRegistry,
  getRegisteredTool,
  clearToolRegistry,
} from "../../src/videntia_figma_mcp/utils/tool-registry";
import { PARAM_ALIASES } from "../../src/videntia_figma_mcp/utils/param-aliases";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

/**
 * `delete_variable` declared only `id`, so a caller using `variableId` — the spelling
 * every other variable tool uses — had the value stripped by zod and got an error that
 * read as if the VARIABLE were missing. The alias must be accepted on the standalone
 * call and the batched one alike (both go through the same wrapped handler).
 */
describe("delete_variable / delete_variables_batch param aliases", () => {
  let mockSendCommand: jest.Mock;

  beforeEach(() => {
    clearToolRegistry();
    const server = instrumentToolRegistry(
      new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } }),
    );
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();
    mockSendCommand.mockResolvedValue({ variableId: "VariableID:1:1", deleted: 1 });
    registerVariableTools(server);
  });

  afterEach(() => clearToolRegistry());

  async function callTool(name: string, args: unknown) {
    const entry = getRegisteredTool(name)!;
    expect(entry).toBeDefined();
    return entry.handler(entry.schema.parse(args) as any, { meta: {} } as any);
  }

  const wire = () => mockSendCommand.mock.calls[0][1];

  it("declares variableId as an alias of id", () => {
    expect(PARAM_ALIASES.delete_variable.variableId).toBe("id");
    expect(PARAM_ALIASES.delete_variables_batch.variableIds).toBe("ids");
  });

  it("accepts variableId and puts it on the wire", async () => {
    await callTool("delete_variable", { variableId: "VariableID:1:1" });
    expect(wire().variableId).toBe("VariableID:1:1");
  });

  it("still accepts the canonical id", async () => {
    await callTool("delete_variable", { id: "VariableID:1:1" });
    expect(wire().variableId).toBe("VariableID:1:1");
  });

  it("accepts a variable NAME with no collection", async () => {
    await callTool("delete_variable", { variableId: "color/primary" });
    expect(wire().variableId).toBe("color/primary");
  });

  it("reports a missing identifier as a PARAMETER problem, not a data problem", async () => {
    const result: any = await callTool("delete_variable", {});
    const text = result.content[0].text as string;
    expect(text).toMatch(/Missing variable identifier/);
    expect(text).toMatch(/variableId/);
    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  it("accepts variableIds on the batch tool", async () => {
    await callTool("delete_variables_batch", { variableIds: ["VariableID:1:1", "color/primary"] });
    expect(wire().variableIds).toEqual(["VariableID:1:1", "color/primary"]);
  });

  it("reports an empty batch as a PARAMETER problem", async () => {
    const result: any = await callTool("delete_variables_batch", { ids: [] });
    expect(result.content[0].text).toMatch(/Missing variable identifiers/);
    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  it("every alias target is a real key of the tool's schema", () => {
    for (const command of ["delete_variable", "delete_variables_batch"]) {
      const entry = getRegisteredTool(command)!;
      const shape = (entry.schema as z.ZodObject<any>).shape;
      for (const target of Object.values(PARAM_ALIASES[command])) {
        expect(Object.keys(shape)).toContain(target);
      }
    }
  });
});
