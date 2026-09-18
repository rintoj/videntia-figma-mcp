import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerModificationTools } from "../../src/videntia_figma_mcp/tools/modification-tools";
import { MAX_IMAGE_FILE_BYTES } from "../../src/videntia_figma_mcp/utils/image-file-input";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

/** Smallest valid 1x1 PNG. */
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("set_image_fill_from_path tool", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "set-image-fill-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });

    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();
    mockSendCommand.mockResolvedValue({
      id: "1:2",
      name: "Hero",
      imageHash: "abc123",
      imageSize: { width: 1, height: 1 },
      scaleMode: "FILL",
    });

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

    registerModificationTools(server);
  });

  async function callTool(toolName: string, args: any) {
    const schema = toolSchemas.get(toolName);
    const handler = toolHandlers.get(toolName);
    if (!schema || !handler) {
      throw new Error(`Tool ${toolName} not found`);
    }
    return await handler(schema.parse(args), { meta: {} });
  }

  it("is registered on the server", () => {
    expect(toolHandlers.has("set_image_fill_from_path")).toBe(true);
  });

  it("reads a real image file and forwards base64 bytes to the plugin", async () => {
    const file = path.join(tmpDir, "tiny.png");
    fs.writeFileSync(file, Buffer.from(TINY_PNG_BASE64, "base64"));

    const response = await callTool("set_image_fill_from_path", {
      nodeId: "1:2",
      path: file,
      scaleMode: "FIT",
    });

    expect(mockSendCommand).toHaveBeenCalledTimes(1);
    const [command, params] = mockSendCommand.mock.calls[0];
    expect(command).toBe("set_image_fill");
    expect(params.nodeId).toBe("1:2");
    expect(params.scaleMode).toBe("FIT");
    expect(params.imageBytes).toBe(TINY_PNG_BASE64);
    // The file path must never be forwarded as bytes.
    expect(params.imageBytes).not.toContain(tmpDir);
    expect(response.content[0].text).toContain('Set image fill on "Hero"');
    expect(response.content[0].text).toContain("image/png");
  });

  it("rejects a relative path without calling the plugin", async () => {
    const response = await callTool("set_image_fill_from_path", { nodeId: "1:2", path: "./tiny.png" });
    expect(mockSendCommand).not.toHaveBeenCalled();
    expect(response.content[0].text).toContain("must be an absolute file path");
  });

  it("reports a missing file clearly", async () => {
    const missing = path.join(tmpDir, "nope.png");
    const response = await callTool("set_image_fill_from_path", { nodeId: "1:2", path: missing });
    expect(mockSendCommand).not.toHaveBeenCalled();
    expect(response.content[0].text).toContain("File does not exist");
    expect(response.content[0].text).toContain(missing);
  });

  it("rejects a non-image file by extension", async () => {
    const file = path.join(tmpDir, "notes.txt");
    fs.writeFileSync(file, "not an image");
    const response = await callTool("set_image_fill_from_path", { nodeId: "1:2", path: file });
    expect(mockSendCommand).not.toHaveBeenCalled();
    expect(response.content[0].text).toContain("Unsupported image type");
  });

  it("rejects a file with an image extension but non-image contents", async () => {
    const file = path.join(tmpDir, "fake.png");
    fs.writeFileSync(file, "this is definitely not a png");
    const response = await callTool("set_image_fill_from_path", { nodeId: "1:2", path: file });
    expect(mockSendCommand).not.toHaveBeenCalled();
    expect(response.content[0].text).toContain("not a readable image");
  });

  it("rejects an oversized file naming both the limit and the actual size", async () => {
    const file = path.join(tmpDir, "huge.png");
    const fd = fs.openSync(file, "w");
    // Sparse file: no real disk cost, but stat().size exceeds the ceiling.
    fs.ftruncateSync(fd, MAX_IMAGE_FILE_BYTES + 1024);
    fs.closeSync(fd);

    const response = await callTool("set_image_fill_from_path", { nodeId: "1:2", path: file });
    expect(mockSendCommand).not.toHaveBeenCalled();
    expect(response.content[0].text).toContain("too large");
    expect(response.content[0].text).toContain("20.00MB"); // the limit
    expect(response.content[0].text).toMatch(/20\.\d\dMB \(limit 20\.00MB\)/);
  });

  it("rejects a directory and an empty file", async () => {
    const dirResponse = await callTool("set_image_fill_from_path", { nodeId: "1:2", path: tmpDir });
    expect(dirResponse.content[0].text).toMatch(/directory|Unsupported image type/);

    const empty = path.join(tmpDir, "empty.png");
    fs.writeFileSync(empty, "");
    const emptyResponse = await callTool("set_image_fill_from_path", { nodeId: "1:2", path: empty });
    expect(emptyResponse.content[0].text).toContain("File is empty");
    expect(mockSendCommand).not.toHaveBeenCalled();
  });
});
