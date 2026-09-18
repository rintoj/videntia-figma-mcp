import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocumentTools } from "../../src/videntia_figma_mcp/tools/document-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
  getOpenChannels: jest.fn().mockResolvedValue([]),
}));

/**
 * Bug #13: `get_node_info` must return fills (and the sibling paint/effect
 * properties) as structured data through the FULL tool pipeline — not just from
 * the serializer. Every assertion here inspects the actual returned payload;
 * "the tool returned successfully" is explicitly not good enough.
 */
describe("get_node_info returns paint data end to end (bug #13)", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  const toolHandlers = new Map<string, Function>();
  const toolSchemas = new Map<string, z.ZodObject<any>>();

  beforeEach(() => {
    server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();
    toolHandlers.clear();
    toolSchemas.clear();

    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, , schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });

    registerDocumentTools(server);
  });

  async function callTool(toolName: string, args: any = {}) {
    const schema = toolSchemas.get(toolName)!;
    const handler = toolHandlers.get(toolName)!;
    return await handler(schema.parse(args), { meta: {} });
  }

  const text = (res: any) => res.content[0].text as string;

  function respondWith(fills: unknown, extra: Record<string, unknown> = {}) {
    mockSendCommand.mockResolvedValue({
      count: 1,
      nodes: [
        {
          id: "1:1",
          name: "Hero",
          type: "FRAME",
          visible: true,
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          ...(fills === undefined ? {} : { fills }),
          ...extra,
        },
      ],
    });
  }

  it("json output contains the SOLID fill with its hex colour", async () => {
    respondWith([{ type: "SOLID", color: "#ffffff" }]);
    const parsed = JSON.parse(text(await callTool("get_node_info", { nodeId: "1:1", output_format: "json" })));
    expect(parsed[0].fills).toEqual([{ type: "SOLID", color: "#ffffff" }]);
  });

  it("json output contains the IMAGE fill with scaleMode and imageHash", async () => {
    respondWith([{ type: "IMAGE", isImage: true, imageRef: "abc", imageHash: "abc", scaleMode: "FILL" }]);
    const parsed = JSON.parse(text(await callTool("get_node_info", { nodeId: "1:1", output_format: "json" })));
    expect(parsed[0].fills[0]).toMatchObject({ type: "IMAGE", scaleMode: "FILL", imageHash: "abc" });
  });

  it("json output keeps ALL fills when a node has several", async () => {
    respondWith([
      { type: "SOLID", color: "#ff0000" },
      { type: "IMAGE", isImage: true, imageHash: "abc", scaleMode: "FIT" },
    ]);
    const parsed = JSON.parse(text(await callTool("get_node_info", { nodeId: "1:1", output_format: "json" })));
    expect(parsed[0].fills).toHaveLength(2);
    expect(parsed[0].fills[1].scaleMode).toBe("FIT");
  });

  it("json output preserves an explicitly empty fill list", async () => {
    respondWith([]);
    const parsed = JSON.parse(text(await callTool("get_node_info", { nodeId: "1:1", output_format: "json" })));
    expect(parsed[0].fills).toEqual([]);
  });

  it('fields: ["fills"] returns an object that ACTUALLY HAS a fills key', async () => {
    respondWith([{ type: "IMAGE", isImage: true, imageHash: "abc", scaleMode: "FILL" }]);
    const parsed = JSON.parse(
      text(await callTool("get_node_info", { nodeId: "1:1", output_format: "json", fields: ["fills"] })),
    );
    expect(Object.keys(parsed[0])).toContain("fills");
    expect(parsed[0].fills[0].imageHash).toBe("abc");
  });

  it("compact output renders fills tersely for solid, image and empty", async () => {
    respondWith([{ type: "SOLID", color: "#ffffff" }]);
    expect(text(await callTool("get_node_info", { nodeId: "1:1", output_format: "compact" }))).toContain(
      "fill=#ffffff",
    );

    respondWith([{ type: "IMAGE", isImage: true, imageHash: "abc", scaleMode: "FILL" }]);
    const img = text(await callTool("get_node_info", { nodeId: "1:1", output_format: "compact" }));
    expect(img).toContain("fill=IMAGE(FILL)");
    expect(img).not.toContain("imageHash");

    respondWith([]);
    expect(text(await callTool("get_node_info", { nodeId: "1:1", output_format: "compact" }))).toContain("fill=none");
  });

  it("json output also carries strokes, strokeWeight and effects", async () => {
    respondWith([{ type: "SOLID", color: "#ffffff" }], {
      strokes: [{ type: "SOLID", color: "#000000" }],
      strokeWeight: 2,
      effects: [{ type: "DROP_SHADOW", color: "#00000080", offset: { x: 0, y: 2 }, radius: 4 }],
    });
    const parsed = JSON.parse(text(await callTool("get_node_info", { nodeId: "1:1", output_format: "json" })));
    expect(parsed[0].strokes[0].color).toBe("#000000");
    expect(parsed[0].strokeWeight).toBe(2);
    expect(parsed[0].effects[0]).toMatchObject({ type: "DROP_SHADOW", radius: 4 });
  });

  it("jsx output still renders the fill as a Tailwind background", async () => {
    respondWith([{ type: "SOLID", color: "#ffffff" }]);
    expect(text(await callTool("get_node_info", { nodeId: "1:1" }))).toContain("bg-[#ffffff]");
  });
});
