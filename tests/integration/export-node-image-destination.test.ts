import { z } from "zod";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import sharp from "sharp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocumentTools } from "../../src/videntia_figma_mcp/tools/document-tools";
import { clearExportCache } from "../../src/videntia_figma_mcp/utils/export-cache";
import {
  clearToolRegistry,
  getRegisteredTool,
  instrumentToolRegistry,
} from "../../src/videntia_figma_mcp/utils/tool-registry";

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

describe("export_node_as_image destination parameters", () => {
  let mockSendCommand: jest.Mock;
  let tmpDir: string;
  let schema: z.ZodObject<any>;
  let handler: (args: any, extra: unknown) => Promise<any>;

  beforeEach(() => {
    clearToolRegistry();
    const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    instrumentToolRegistry(server);
    registerDocumentTools(server);
    const entry = getRegisteredTool("export_node_as_image")!;
    schema = entry.schema;
    handler = entry.handler as typeof handler;

    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();
    clearExportCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "figma-export-dest-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    clearToolRegistry();
  });

  async function callTool(args: any) {
    return await handler(schema.parse(args), { meta: {} });
  }

  async function mockExport(name = "Hero Card") {
    mockSendCommand.mockResolvedValue({
      subtreeHash: "hash-1",
      name,
      imageData: await makePng(200, 100),
      mimeType: "image/png",
      requestedScale: 1,
      actualScale: 1,
      originalWidth: 200,
      originalHeight: 100,
      exportedWidth: 200,
      exportedHeight: 100,
    });
  }

  it("writes into output_directory with a name derived from node name, id and format", async () => {
    await mockExport();
    const dir = path.join(tmpDir, "renders");
    const res = await callTool({ nodeId: "1:2", output_directory: dir });
    const payload = JSON.parse(res.content[0].text);

    expect(path.dirname(payload.path)).toBe(dir);
    expect(path.basename(payload.path)).toBe("Hero-Card-1-2@1x.png");
    expect(fs.existsSync(payload.path)).toBe(true);
  });

  it("honours an explicit filename and appends the format extension when missing", async () => {
    await mockExport();
    const res = await callTool({ nodeId: "1:2", output_directory: tmpDir, filename: "card" });
    const payload = JSON.parse(res.content[0].text);

    expect(payload.path).toBe(path.join(tmpDir, "card.png"));
    expect(fs.existsSync(payload.path)).toBe(true);
  });

  it("keeps an explicit extension that already matches the format", async () => {
    await mockExport();
    const res = await callTool({ nodeId: "1:2", output_directory: tmpDir, filename: "card.png" });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.path).toBe(path.join(tmpDir, "card.png"));
  });

  it("gives save_to_path precedence and warns that output_directory was ignored", async () => {
    await mockExport();
    const outPath = path.join(tmpDir, "exact.png");
    const res = await callTool({
      nodeId: "1:2",
      save_to_path: outPath,
      output_directory: path.join(tmpDir, "ignored"),
      filename: "ignored.png",
    });
    const payload = JSON.parse(res.content[0].text);

    expect(payload.path).toBe(outPath);
    expect(payload.warnings.join(" ")).toContain("save_to_path takes precedence");
    expect(fs.existsSync(path.join(tmpDir, "ignored"))).toBe(false);
  });

  it("rejects a relative output_directory and a filename with path separators", async () => {
    await mockExport();
    const relative = await callTool({ nodeId: "1:2", output_directory: "renders" });
    expect(relative.content[0].text).toContain("output_directory must be an absolute path");

    const nested = await callTool({ nodeId: "1:2", output_directory: tmpDir, filename: "a/b.png" });
    expect(nested.content[0].text).toContain("without path separators");
  });

  it("does not serve a different destination from the session cache", async () => {
    await mockExport();
    const first = JSON.parse((await callTool({ nodeId: "1:2", output_directory: tmpDir })).content[0].text);
    const otherDir = path.join(tmpDir, "second");
    const second = JSON.parse((await callTool({ nodeId: "1:2", output_directory: otherDir })).content[0].text);

    expect(second.cached).toBe(false);
    expect(path.dirname(second.path)).toBe(otherDir);
    expect(second.path).not.toBe(first.path);
  });

  it("ERRORS on an unknown parameter instead of silently dropping it", () => {
    expect(() => schema.parse({ nodeId: "1:2", output_dir: "/tmp/x" })).toThrow();
    expect(() => schema.parse({ nodeId: "1:2", output_directory: "/tmp/x" })).not.toThrow();
  });
});
