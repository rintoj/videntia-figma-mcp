import { z } from "zod";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import sharp from "sharp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocumentTools } from "../../src/videntia_figma_mcp/tools/document-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
  getOpenChannels: jest.fn(),
}));

async function makePng(width: number, height: number): Promise<string> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
  return buf.toString("base64");
}

describe("export_node_as_image token-efficiency options", () => {
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;
  let tmpDir: string;

  beforeEach(() => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();

    toolHandlers = new Map();
    toolSchemas = new Map();
    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, _description, schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });

    registerDocumentTools(server);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "figma-export-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function callTool(toolName: string, args: any) {
    const schema = toolSchemas.get(toolName)!;
    const handler = toolHandlers.get(toolName)!;
    return await handler(schema.parse(args), { meta: {} });
  }

  async function mockExport(width: number, height: number, format = "PNG") {
    mockSendCommand.mockResolvedValue({
      imageData: await makePng(width, height),
      mimeType: format === "JPG" ? "image/jpeg" : "image/png",
      requestedScale: 1,
      actualScale: 1,
      originalWidth: width,
      originalHeight: height,
      exportedWidth: width,
      exportedHeight: height,
    });
  }

  it("writes to save_to_path and returns metadata only (no inline image)", async () => {
    await mockExport(400, 300);
    const outPath = path.join(tmpDir, "frame.png");

    const res = await callTool("export_node_as_image", { nodeId: "1:2", save_to_path: outPath });

    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    const meta = JSON.parse(res.content[0].text);
    expect(meta).toMatchObject({ path: outPath, width: 400, height: 300, format: "PNG" });
    expect(meta.bytes).toBeGreaterThan(0);
    expect(fs.existsSync(outPath)).toBe(true);
    expect(fs.statSync(outPath).size).toBe(meta.bytes);
  });

  it("keeps full resolution when saving to disk", async () => {
    await mockExport(3000, 1000);
    const outPath = path.join(tmpDir, "big.png");

    const res = await callTool("export_node_as_image", { nodeId: "1:2", save_to_path: outPath });
    const meta = JSON.parse(res.content[0].text);
    expect(meta.width).toBe(3000);
  });

  it("caps inline returns at 1200px on the longest edge by default", async () => {
    await mockExport(3000, 1500);

    const res = await callTool("export_node_as_image", { nodeId: "1:2" });

    const summary = res.content[0].text;
    expect(summary).toContain("1200x600px");
    expect(summary).toMatch(/KB/);
    const image = res.content.find((c: any) => c.type === "image");
    const decoded = await sharp(Buffer.from(image.data, "base64")).metadata();
    expect(decoded.width).toBe(1200);
    expect(decoded.height).toBe(600);
  });

  it("returns full resolution inline when allow_full_resolution is set", async () => {
    await mockExport(2000, 500);

    const res = await callTool("export_node_as_image", { nodeId: "1:2", allow_full_resolution: true });
    const image = res.content.find((c: any) => c.type === "image");
    const decoded = await sharp(Buffer.from(image.data, "base64")).metadata();
    expect(decoded.width).toBe(2000);
  });

  it("honors max_width", async () => {
    await mockExport(1000, 500);

    const res = await callTool("export_node_as_image", { nodeId: "1:2", max_width: 250 });
    const image = res.content.find((c: any) => c.type === "image");
    const decoded = await sharp(Buffer.from(image.data, "base64")).metadata();
    expect(decoded.width).toBe(250);
    expect(decoded.height).toBe(125);
  });

  it("crops to region", async () => {
    await mockExport(800, 600);
    const outPath = path.join(tmpDir, "crop.png");

    const res = await callTool("export_node_as_image", {
      nodeId: "1:2",
      save_to_path: outPath,
      region: { x: 100, y: 50, width: 200, height: 150 },
    });
    const meta = JSON.parse(res.content[0].text);
    expect(meta).toMatchObject({ width: 200, height: 150 });
  });

  it("re-encodes JPG at jpeg_quality without touching the video quality param", async () => {
    await mockExport(600, 400, "JPG");
    const lowPath = path.join(tmpDir, "low.jpg");
    const highPath = path.join(tmpDir, "high.jpg");

    const low = JSON.parse(
      (
        await callTool("export_node_as_image", {
          nodeId: "1:2",
          format: "jpg",
          jpeg_quality: 20,
          save_to_path: lowPath,
        })
      ).content[0].text,
    );
    await mockExport(600, 400, "JPG");
    const high = JSON.parse(
      (
        await callTool("export_node_as_image", {
          nodeId: "1:2",
          format: "jpg",
          jpeg_quality: 95,
          save_to_path: highPath,
        })
      ).content[0].text,
    );

    expect(low.bytes).toBeLessThan(high.bytes);
    // video quality enum still passed straight through, untouched
    expect(mockSendCommand.mock.calls[0][1].quality).toBeUndefined();
  });

  it("always reports width/height/bytes in the inline summary", async () => {
    await mockExport(320, 240);
    const res = await callTool("export_node_as_image", { nodeId: "1:2" });
    expect(res.content[0].text).toContain("320x240px");
    expect(res.content[0].text).toContain("save_to_path");
  });

  it("errors clearly when save_to_path is relative", async () => {
    await mockExport(100, 100);
    const res = await callTool("export_node_as_image", { nodeId: "1:2", save_to_path: "relative.png" });
    expect(res.content[0].text).toContain("absolute path");
  });
});
