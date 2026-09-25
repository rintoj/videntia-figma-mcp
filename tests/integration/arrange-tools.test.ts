import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCreationTools } from "../../src/videntia_figma_mcp/tools/creation-tools";
import { registerModificationTools } from "../../src/videntia_figma_mcp/tools/modification-tools";
import { ALLOWED_COMMANDS } from "../../src/videntia_figma_plugin/ui/constants";
import { matchTools } from "../../src/videntia_figma_mcp/utils/tool-taxonomy";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("rotation, layer order, ellipse and position docs", () => {
  let mockSendCommand: jest.Mock;
  let handlers: Map<string, Function>;
  let schemas: Map<string, z.ZodObject<any>>;
  let descriptions: Map<string, string>;

  beforeEach(() => {
    const server = new McpServer({ name: "test", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockReset();
    handlers = new Map();
    schemas = new Map();
    descriptions = new Map();
    const original = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, description, schema, handler] = args;
        handlers.set(name, handler);
        schemas.set(name, z.object(schema));
        descriptions.set(name, description);
      }
      return (original as any)(...args);
    });
    registerCreationTools(server);
    registerModificationTools(server);
  });

  async function call(name: string, args: any) {
    return handlers.get(name)!(schemas.get(name)!.parse(args), { meta: {} });
  }

  it("set_rotation forwards degrees, relative and origin", async () => {
    mockSendCommand.mockResolvedValue({ name: "Box", rotation: 30, origin: "center", x: 1, y: 2 });
    const res = await call("set_rotation", { nodeId: "1-2", rotation: "30", relative: true });
    expect(mockSendCommand).toHaveBeenCalledWith("set_rotation", {
      nodeId: "1:2",
      rotation: 30,
      relative: true,
      origin: undefined,
    });
    expect(res.content[0].text).toContain('Rotated "Box" to 30°');
  });

  it("set_layer_order accepts a named position or an index", async () => {
    mockSendCommand.mockResolvedValue({ name: "A", previousIndex: 0, index: 3, childCount: 4, parentId: "p" });
    const res = await call("set_layer_order", { nodeId: "1:2", position: "front" });
    expect(mockSendCommand).toHaveBeenCalledWith("set_layer_order", { nodeId: "1:2", position: "front" });
    expect(res.content[0].text).toContain("moved from index 0 to 3 of 4");
    await call("set_layer_order", { nodeId: "1:2", position: "2" });
    expect(mockSendCommand).toHaveBeenLastCalledWith("set_layer_order", { nodeId: "1:2", position: 2 });
    expect(() => schemas.get("set_layer_order")!.parse({ nodeId: "1:2", position: "top" })).toThrow();
  });

  it("create_ellipse is registered and converts hex colours", async () => {
    mockSendCommand.mockResolvedValue({ id: "9:9", name: "Dot", width: 20, height: 20, x: 4, y: 5 });
    const res = await call("create_ellipse", { x: 4, y: 5, width: 20, height: 20, fillColor: "#ff0000", name: "Dot" });
    const [command, params] = mockSendCommand.mock.calls[0];
    expect(command).toBe("create_ellipse");
    expect(params.fillColor).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(res.content[0].text).toContain('Created ellipse "Dot" with ID: 9:9 20x20 at (4, 5)');
  });

  it("create_text forwards an exact fontStyle", async () => {
    mockSendCommand.mockResolvedValue({ id: "1:1", name: "T" });
    await call("create_text", { x: 0, y: 0, text: "Hi", fontFamily: "General Sans", fontStyle: "Semibold Italic" });
    expect(mockSendCommand.mock.calls[0][1].fontStyle).toBe("Semibold Italic");
  });

  it("create results report parent-relative and absolute placement", async () => {
    mockSendCommand.mockResolvedValue({
      id: "5:5",
      name: "F",
      x: 10,
      y: 20,
      absoluteX: 110,
      absoluteY: 220,
      parentId: "1:1",
    });
    const res = await call("create_frame", { x: 10, y: 20, parentId: "1:1" });
    expect(res.content[0].text).toContain("at (10, 20) in parent 1:1, absolute (110, 220)");
  });

  it("documents x/y as parent-relative everywhere and index 0 as the back of the stack", () => {
    for (const tool of [
      "create_rectangle",
      "create_frame",
      "create_text",
      "create_ellipse",
      "create_svg",
      "move_node",
    ]) {
      const shape = schemas.get(tool)!.shape as Record<string, z.ZodTypeAny>;
      expect(shape.x.description).toContain("RELATIVE TO THE PARENT");
      expect(shape.x.description).toContain("move_node_absolute");
      expect(shape.x.description).not.toMatch(/on the canvas \(or/);
    }
    expect((schemas.get("create_section")!.shape as any).x.description).toContain("inside a SECTION");
    expect(descriptions.get("insert_child")).toContain("index 0 is the bottom of the stack");
    expect((schemas.get("insert_child")!.shape as any).index.description).not.toContain("0 = front");
  });

  it("the new commands are allowed by the plugin UI", () => {
    for (const cmd of ["set_rotation", "set_layer_order", "create_ellipse"]) {
      expect(ALLOWED_COMMANDS.has(cmd)).toBe(true);
    }
  });

  it("recall words find the new tools", () => {
    const names = [...handlers.keys()];
    const top = (q: string) =>
      matchTools(q, { toolNames: names })
        .slice(0, 3)
        .map((m: any) => m.name ?? m.tool ?? m);
    expect(top("rotate a node").join(" ")).toContain("set_rotation");
    expect(top("bring to front").join(" ")).toContain("set_layer_order");
    expect(top("z-index").join(" ")).toContain("set_layer_order");
    expect(top("draw a circle").join(" ")).toContain("create_ellipse");
  });
});
