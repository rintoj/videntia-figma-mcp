import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDesignContextTools } from "../../src/videntia_figma_mcp/tools/design-context-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
  getOpenChannels: jest.fn().mockResolvedValue([]),
}));

describe("design context tools", () => {
  let server: McpServer;
  let mockSend: jest.Mock;
  const handlers = new Map<string, Function>();
  const schemas = new Map<string, z.ZodObject<any>>();

  beforeEach(() => {
    handlers.clear();
    schemas.clear();
    server = new McpServer({ name: "t", version: "1" }, { capabilities: { tools: {} } });
    mockSend = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSend.mockReset();
    const orig = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        handlers.set(args[0], args[3]);
        schemas.set(args[0], z.object(args[2]));
      }
      return (orig as any)(...args);
    });
    registerDesignContextTools(server);
  });

  const call = (name: string, args: any) => handlers.get(name)!(schemas.get(name)!.parse(args), { meta: {} });

  const payload = {
    nodeId: "1:2",
    nodeName: "Card",
    nodesVisited: 2,
    truncated: false,
    maxDepth: 2,
    root: {
      id: "1:2",
      name: "Card",
      type: "FRAME",
      size: { width: 320, height: 200 },
      sizing: { horizontal: "FIXED", vertical: "HUG" },
      layout: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start",
        alignItems: "center",
        gap: "12 {space/md = 12}",
        padding: [16, 16, 16, 16],
      },
      radius: 8,
      fills: ["#ffffff {surface/card = #ffffff}"],
      css: { width: "320px", "mix-blend-mode": "multiply" },
      children: [
        {
          id: "1:3",
          name: "Title",
          type: "TEXT",
          text: "Hello",
          size: { width: 100, height: 20 },
          sizing: { horizontal: "HUG", vertical: "HUG" },
          typography: { fontFamily: "Inter", fontSize: 16, fontWeight: 600, color: "#111111" },
        },
        {
          id: "1:4",
          name: "Btn",
          type: "INSTANCE",
          component: { kind: "instance", mainComponent: "Size=sm", componentSet: "Button", props: { Size: "sm" } },
        },
      ],
    },
  };

  it("registers both tools", () => {
    expect([...handlers.keys()].sort()).toEqual(["get_design_context", "get_variables_used"]);
  });

  it("get_design_context sends normalised params and renders jsx by default", async () => {
    mockSend.mockResolvedValue(payload);
    const res = await call("get_design_context", { nodeId: "1-2" });
    expect(mockSend).toHaveBeenCalledWith(
      "get_design_context",
      { nodeId: "1:2", depth: 2, maxNodes: undefined, includeCss: true },
      60000,
    );
    const t = res.content[0].text;
    expect(t).toContain('data-fig-id="1:2"');
    expect(t).toContain('flexDirection: "column"');
    expect(t).toContain("var(--space-md)");
    expect(t).toContain("instance of Button / Size=sm");
    expect(t).toContain("mix-blend-mode: multiply");
    expect(t).not.toContain("width: 320px;"); // derived props are not repeated from getCSSAsync
  });

  it("renders css and tailwind", async () => {
    mockSend.mockResolvedValue(payload);
    const css = (await call("get_design_context", { nodeId: "1:2", format: "css" })).content[0].text;
    expect(css).toContain("gap: var(--space-md) /* 12px */;");
    expect(css).toContain("background: var(--surface-card) /* #ffffff */;");
    const tw = (await call("get_design_context", { nodeId: "1:2", format: "tailwind" })).content[0].text;
    expect(tw).toContain("flex flex-col items-center gap-[var(--space-md)] p-[16px]");
    expect(tw).toContain("text-[16px] font-[600]");
  });

  it("warns when truncated", async () => {
    mockSend.mockResolvedValue({ ...payload, truncated: true, maxNodes: 1 });
    const t = (await call("get_design_context", { nodeId: "1:2" })).content[0].text;
    expect(t).toContain("WARNING: node cap (1) reached");
  });

  it("get_variables_used renders variables and styles", async () => {
    mockSend.mockResolvedValue({
      nodeId: "1:2",
      nodeName: "Card",
      nodesVisited: 10,
      truncated: false,
      variables: [
        {
          id: "V:1",
          name: "surface/card",
          collection: "Theme",
          type: "COLOR",
          valuesByMode: { Light: "#ffffff", Dark: "#111111" },
          usageCount: 3,
          fields: ["fills[].color"],
          exampleNodeIds: ["1:2"],
        },
      ],
      styles: [{ id: "S:1", kind: "TEXT", name: "Body/MD", usageCount: 2, exampleNodeIds: ["1:3"] }],
    });
    const t = (await call("get_variables_used", { nodeId: "1:2" })).content[0].text;
    expect(mockSend).toHaveBeenCalledWith(
      "get_variables_used",
      { nodeId: "1:2", includeChildren: true, maxNodes: undefined },
      120000,
    );
    expect(t).toContain("| Theme | surface/card | COLOR | Light: #ffffff; Dark: #111111 | 3 |");
    expect(t).toContain("| TEXT | Body/MD | 2 | 1:3 |");
  });

  it("surfaces plugin errors", async () => {
    mockSend.mockRejectedValue(new Error("Node not found: 9:9"));
    const t = (await call("get_variables_used", { nodeId: "9:9" })).content[0].text;
    expect(t).toContain("Node not found: 9:9");
  });
});
