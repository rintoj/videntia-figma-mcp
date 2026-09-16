import { z } from "zod";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import sharp from "sharp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocumentTools } from "../../src/videntia_figma_mcp/tools/document-tools";
import { clearExportCache } from "../../src/videntia_figma_mcp/utils/export-cache";

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
    clearExportCache();
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

  async function mockExport(width: number, height: number, format = "PNG", subtreeHash: string | null = null) {
    mockSendCommand.mockResolvedValue({
      subtreeHash,
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

    const res = await callTool("export_node_as_image", { nodeId: "1:2", inline: true });

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

    const res = await callTool("export_node_as_image", { nodeId: "1:2", allow_full_resolution: true, inline: true });
    const image = res.content.find((c: any) => c.type === "image");
    const decoded = await sharp(Buffer.from(image.data, "base64")).metadata();
    expect(decoded.width).toBe(2000);
  });

  it("honors max_width", async () => {
    await mockExport(1000, 500);

    const res = await callTool("export_node_as_image", { nodeId: "1:2", max_width: 250, inline: true });
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
    const res = await callTool("export_node_as_image", { nodeId: "1:2", inline: true });
    expect(res.content[0].text).toContain("320x240px");
    expect(res.content[0].text).toContain("inline");
  });

  it("errors clearly when save_to_path is relative", async () => {
    await mockExport(100, 100);
    const res = await callTool("export_node_as_image", { nodeId: "1:2", save_to_path: "relative.png" });
    expect(res.content[0].text).toContain("absolute path");
  });

  describe("file-by-default, session cache and scale enforcement", () => {
    it("writes a session temp file by default and returns no inline image", async () => {
      await mockExport(400, 300);
      const res = await callTool("export_node_as_image", { nodeId: "1:2" });

      expect(res.content).toHaveLength(1);
      expect(res.content.find((c: any) => c.type === "image")).toBeUndefined();
      const meta = JSON.parse(res.content[0].text);
      expect(meta.cached).toBe(false);
      expect(path.isAbsolute(meta.path)).toBe(true);
      expect(fs.existsSync(meta.path)).toBe(true);
      fs.rmSync(meta.path, { force: true });
    });

    it("serves an identical re-export from cache when the subtree hash is unchanged", async () => {
      await mockExport(500, 500, "PNG", "abc12345");
      const first = JSON.parse((await callTool("export_node_as_image", { nodeId: "1:2" })).content[0].text);
      const second = JSON.parse((await callTool("export_node_as_image", { nodeId: "1:2" })).content[0].text);

      expect(first.cached).toBe(false);
      expect(second.cached).toBe(true);
      expect(second.path).toBe(first.path);
      expect(second.note).toContain("unchanged");
      fs.rmSync(first.path, { force: true });
    });

    it("re-renders when the subtree hash changes", async () => {
      await mockExport(500, 500, "PNG", "hash-one");
      const first = JSON.parse((await callTool("export_node_as_image", { nodeId: "1:2" })).content[0].text);
      await mockExport(500, 500, "PNG", "hash-two");
      const second = JSON.parse((await callTool("export_node_as_image", { nodeId: "1:2" })).content[0].text);

      expect(second.cached).toBe(false);
      fs.rmSync(first.path, { force: true });
    });

    it("never caches when the plugin could not compute a subtree hash", async () => {
      await mockExport(300, 300, "PNG", null);
      const first = JSON.parse((await callTool("export_node_as_image", { nodeId: "1:2" })).content[0].text);
      const second = JSON.parse((await callTool("export_node_as_image", { nodeId: "1:2" })).content[0].text);

      expect(first.cached).toBe(false);
      expect(second.cached).toBe(false);
      fs.rmSync(first.path, { force: true });
    });

    it("force_refresh bypasses a valid cache entry", async () => {
      await mockExport(300, 300, "PNG", "stable-hash");
      const first = JSON.parse((await callTool("export_node_as_image", { nodeId: "1:2" })).content[0].text);
      const refreshed = JSON.parse(
        (await callTool("export_node_as_image", { nodeId: "1:2", force_refresh: true })).content[0].text,
      );

      expect(refreshed.cached).toBe(false);
      fs.rmSync(first.path, { force: true });
    });

    it("re-renders when the cached file has been deleted", async () => {
      await mockExport(300, 300, "PNG", "stable-hash");
      const first = JSON.parse((await callTool("export_node_as_image", { nodeId: "1:2" })).content[0].text);
      fs.rmSync(first.path, { force: true });
      const second = JSON.parse((await callTool("export_node_as_image", { nodeId: "1:2" })).content[0].text);

      expect(second.cached).toBe(false);
      fs.rmSync(second.path, { force: true });
    });

    it("caches inline renders separately from file renders", async () => {
      await mockExport(200, 200, "PNG", "same-hash");
      await callTool("export_node_as_image", { nodeId: "1:2" });
      const inlineRes = await callTool("export_node_as_image", { nodeId: "1:2", inline: true });

      expect(inlineRes.content.find((c: any) => c.type === "image")).toBeDefined();
      expect(inlineRes.content[0].text).toContain("Cache MISS");

      const hit = await callTool("export_node_as_image", { nodeId: "1:2", inline: true });
      expect(hit.content[0].text).toContain("Cache HIT");
      expect(hit.content.find((c: any) => c.type === "image")).toBeDefined();
    });

    it("honours a fractional scale even when the export comes back full size", async () => {
      // Plugin ignored the scale: a 2000px node came back at 2000px.
      mockSendCommand.mockResolvedValue({
        imageData: await makePng(2000, 1000),
        mimeType: "image/png",
        requestedScale: 0.1,
        actualScale: 1,
        originalWidth: 2000,
        originalHeight: 1000,
        exportedWidth: 2000,
        exportedHeight: 1000,
        subtreeHash: null,
      });

      const outPath = path.join(tmpDir, "scaled.png");
      const meta = JSON.parse(
        (await callTool("export_node_as_image", { nodeId: "1:2", scale: 0.1, save_to_path: outPath })).content[0].text,
      );
      expect(meta.width).toBe(200);
      expect(meta.height).toBe(100);
    });

    it("defaults scale to 1 when not provided", async () => {
      await mockExport(100, 100);
      await callTool("export_node_as_image", { nodeId: "1:2", save_to_path: path.join(tmpDir, "s.png") });
      expect(mockSendCommand.mock.calls[0][1].scale).toBe(1);
    });
  });
});
