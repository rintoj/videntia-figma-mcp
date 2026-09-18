import { z } from "zod";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import sharp from "sharp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocumentationTools } from "../../src/videntia_figma_mcp/tools/documentation-tools";
import { clearExportCache } from "../../src/videntia_figma_mcp/utils/export-cache";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

async function makePng(width: number, height: number): Promise<string> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
  return buf.toString("base64");
}

/**
 * Bug #40 — bulk_export_frames was missed when pagination and file-by-default
 * were added: it returned inline base64 for EVERY frame, with no limit/cursor
 * and no save path. These tests assert on the real payload.
 */
describe("bulk_export_frames (#40)", () => {
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;
  let tmpDir: string;

  beforeEach(() => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();
    clearExportCache();

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
    registerDocumentationTools(server);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bulk-export-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function callTool(name: string, args: any) {
    const schema = toolSchemas.get(name)!;
    const handler = toolHandlers.get(name)!;
    return await handler(schema.parse(args), { meta: {} });
  }

  function mockExports(frames: Array<{ id: string; name: string; data: string; hash?: string | null }>) {
    mockSendCommand.mockImplementation(async (command: string, params: any) => {
      if (command === "enumerate_all_frames") {
        return { totalFrames: frames.length, frames: frames.map((f) => ({ id: f.id })) };
      }
      const wanted: string[] = params.nodeIds;
      const selected = frames.filter((f) => wanted.includes(f.id));
      return {
        total: selected.length,
        succeeded: selected.length,
        failed: 0,
        exports: selected.map((f) => ({
          nodeId: f.id,
          name: f.name,
          format: params.format,
          width: 400,
          height: 300,
          data: f.data,
          subtreeHash: f.hash === undefined ? "h-" + f.id : f.hash,
        })),
      };
    });
  }

  it("writes every frame to disk by default and inlines nothing", async () => {
    const png = await makePng(400, 300);
    mockExports([
      { id: "1:1", name: "Home", data: png },
      { id: "1:2", name: "Settings", data: png },
    ]);

    const res = await callTool("bulk_export_frames", { nodeIds: ["1:1", "1:2"], out_dir: tmpDir });

    // No image blocks at all.
    expect(res.content.filter((c: any) => c.type === "image")).toHaveLength(0);
    expect(res.content).toHaveLength(1);

    const payload = JSON.parse(res.content[0].text);
    expect(payload.exports).toHaveLength(2);
    for (const row of payload.exports) {
      expect(row.path.startsWith(tmpDir)).toBe(true);
      expect(fs.existsSync(row.path)).toBe(true);
      expect(fs.statSync(row.path).size).toBeGreaterThan(0);
      expect(row.bytes).toBe(fs.statSync(row.path).size);
      expect(row.width).toBe(400);
      expect(row.height).toBe(300);
      expect(row.data).toBeUndefined();
    }
    // No base64 payload anywhere in the response text.
    expect(res.content[0].text).not.toContain(png.slice(0, 64));
  });

  it("pages the frame list with an unmistakable banner and a next_cursor", async () => {
    const png = await makePng(120, 90);
    const frames = Array.from({ length: 5 }, (_, i) => ({ id: `2:${i}`, name: `F${i}`, data: png }));
    mockExports(frames);

    const first = await callTool("bulk_export_frames", { limit: 2, out_dir: tmpDir });
    const p1 = JSON.parse(first.content[0].text);
    expect(p1.exports).toHaveLength(2);
    expect(p1.notice).toContain("showing 1-2 of 5");
    expect(p1.notice).toContain("PARTIAL page");
    expect(p1.next_cursor).toBe("2");

    const second = await callTool("bulk_export_frames", { limit: 2, cursor: p1.next_cursor, out_dir: tmpDir });
    const p2 = JSON.parse(second.content[0].text);
    expect(p2.notice).toContain("showing 3-4 of 5");
    expect(p2.exports.map((r: any) => r.nodeId)).toEqual(["2:2", "2:3"]);

    // Only the requested page is ever rendered — the plugin is asked for 2 ids.
    const exportCalls = mockSendCommand.mock.calls.filter((c) => c[0] === "bulk_export_frames");
    expect(exportCalls.every((c) => c[1].nodeIds.length === 2)).toBe(true);
  });

  it("says 'complete' when the whole list fits in one page", async () => {
    const png = await makePng(50, 50);
    mockExports([{ id: "3:1", name: "Only", data: png }]);
    const res = await callTool("bulk_export_frames", { out_dir: tmpDir });
    expect(JSON.parse(res.content[0].text).notice).toContain("complete — no further pages");
    expect(JSON.parse(res.content[0].text).next_cursor).toBeUndefined();
  });

  it("returns inline images only when inline: true", async () => {
    const png = await makePng(100, 80);
    mockExports([{ id: "4:1", name: "Card", data: png }]);
    const res = await callTool("bulk_export_frames", { nodeIds: ["4:1"], inline: true });
    const images = res.content.filter((c: any) => c.type === "image");
    expect(images).toHaveLength(1);
    expect(images[0].mimeType).toBe("image/png");
    expect(JSON.parse(res.content[0].text).exports[0].path).toBeUndefined();
  });

  it("declares every new param on the wire schema (zod strips undeclared keys)", async () => {
    const schema = toolSchemas.get("bulk_export_frames")!;
    const parsed = schema.parse({
      nodeIds: ["5:1"],
      format: "JPG",
      scale: 2,
      pageId: "0:1",
      out_dir: "/tmp/x",
      inline: true,
      limit: 3,
      cursor: "4",
      max_width: 500,
      max_height: 400,
      jpeg_quality: 70,
      allow_full_resolution: true,
      force_refresh: true,
    });
    for (const key of [
      "out_dir",
      "inline",
      "limit",
      "cursor",
      "max_width",
      "max_height",
      "jpeg_quality",
      "allow_full_resolution",
      "force_refresh",
    ]) {
      expect(parsed).toHaveProperty(key);
    }

    const png = await makePng(60, 60);
    mockExports([{ id: "5:1", name: "A", data: png }]);
    await callTool("bulk_export_frames", { nodeIds: ["5:1"], format: "JPG", scale: 2, out_dir: tmpDir });
    const wire = mockSendCommand.mock.calls.find((c) => c[0] === "bulk_export_frames")![1];
    expect(wire).toMatchObject({ nodeIds: ["5:1"], format: "JPG", scale: 2 });
  });

  it("clamps a fractional scale on the saved file", async () => {
    const png = await makePng(1000, 500);
    mockExports([{ id: "6:1", name: "Big", data: png }]);
    const res = await callTool("bulk_export_frames", { nodeIds: ["6:1"], scale: 0.5, out_dir: tmpDir });
    const row = JSON.parse(res.content[0].text).exports[0];
    const meta = await sharp(row.path).metadata();
    expect(meta.width).toBeLessThanOrEqual(500);
  });

  it("serves an unchanged frame from the session render cache", async () => {
    const png = await makePng(200, 150);
    mockExports([{ id: "7:1", name: "Stable", data: png }]);

    const first = await callTool("bulk_export_frames", { nodeIds: ["7:1"], out_dir: tmpDir });
    const firstRow = JSON.parse(first.content[0].text).exports[0];
    expect(firstRow.cached).toBe(false);

    const second = await callTool("bulk_export_frames", { nodeIds: ["7:1"], out_dir: tmpDir });
    const p2 = JSON.parse(second.content[0].text);
    expect(p2.exports[0].cached).toBe(true);
    expect(p2.exports[0].path).toBe(firstRow.path);
    expect(p2.cache_hits).toBe(1);

    const third = await callTool("bulk_export_frames", { nodeIds: ["7:1"], out_dir: tmpDir, force_refresh: true });
    expect(JSON.parse(third.content[0].text).exports[0].cached).toBe(false);
  });

  it("never caches a frame whose subtree hash is missing", async () => {
    const png = await makePng(80, 80);
    mockExports([{ id: "8:1", name: "NoHash", data: png, hash: null }]);
    await callTool("bulk_export_frames", { nodeIds: ["8:1"], out_dir: tmpDir });
    const second = await callTool("bulk_export_frames", { nodeIds: ["8:1"], out_dir: tmpDir });
    expect(JSON.parse(second.content[0].text).exports[0].cached).toBe(false);
  });

  it("reports per-frame failures without failing the page", async () => {
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "enumerate_all_frames") return { frames: [{ id: "9:1" }] };
      return {
        exports: [{ nodeId: "9:1", name: "Broken", format: "PNG", width: 0, height: 0, data: "", error: "boom" }],
      };
    });
    const res = await callTool("bulk_export_frames", { out_dir: tmpDir });
    expect(JSON.parse(res.content[0].text).exports[0].error).toBe("boom");
  });
});
