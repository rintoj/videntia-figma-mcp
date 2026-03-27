import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocumentTools } from "../../src/claude_figma_mcp/tools/document-tools";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

jest.mock("../../src/claude_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
  getOpenChannels: jest.fn().mockResolvedValue([]),
}));

describe("export_image_fill tool", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;
  let tmpDir: string;

  beforeEach(() => {
    server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });

    mockSendCommand = require("../../src/claude_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();

    toolHandlers = new Map();
    toolSchemas = new Map();

    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, description, schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });

    registerDocumentTools(server);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "export-image-fill-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function callTool(toolName: string, args: any = {}) {
    const schema = toolSchemas.get(toolName);
    const handler = toolHandlers.get(toolName);
    if (!schema || !handler) {
      throw new Error(`Tool ${toolName} not found`);
    }
    const validatedArgs = schema.parse(args);
    return await handler(validatedArgs, { meta: {} });
  }

  it("successfully exports an image fill to a file", async () => {
    const imageBase64 = Buffer.from("fake-png-data").toString("base64");
    mockSendCommand.mockResolvedValue({
      imageData: imageBase64,
      mimeType: "image/png",
      width: 100,
      height: 200,
      imageHash: "abc123",
      scaleMode: "FILL",
      fillIndex: 0,
    });

    const exportPath = path.join(tmpDir, "test-image.png");
    const response = await callTool("export_image_fill", {
      nodeId: "1:2",
      exportPath,
    });

    expect(response.content[0].text).toContain("Image fill exported to");
    expect(response.content[0].text).toContain("100x200px");
    expect(fs.existsSync(exportPath)).toBe(true);

    const written = fs.readFileSync(exportPath);
    expect(written.toString()).toBe("fake-png-data");
  });

  it("returns error when parent directory does not exist", async () => {
    const exportPath = path.join(tmpDir, "nonexistent-dir", "image.png");
    const response = await callTool("export_image_fill", {
      nodeId: "1:2",
      exportPath,
    });

    expect(response.content[0].text).toContain("Directory does not exist");
    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  it("returns error when exportPath is not absolute", async () => {
    const response = await callTool("export_image_fill", {
      nodeId: "1:2",
      exportPath: "relative/path/image.png",
    });

    expect(response.content[0].text).toContain("must be an absolute path");
    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  it("returns error when Figma command fails", async () => {
    mockSendCommand.mockRejectedValue(new Error("Node not found with ID: 99:99"));

    const exportPath = path.join(tmpDir, "image.png");
    const response = await callTool("export_image_fill", {
      nodeId: "99:99",
      exportPath,
    });

    expect(response.content[0].text).toContain("Error exporting image fill");
    expect(response.content[0].text).toContain("Node not found");
  });

  it("passes fillIndex parameter to Figma command", async () => {
    const imageBase64 = Buffer.from("image-data").toString("base64");
    mockSendCommand.mockResolvedValue({
      imageData: imageBase64,
      mimeType: "image/png",
      width: 50,
      height: 50,
      imageHash: "def456",
      scaleMode: "FIT",
      fillIndex: 2,
    });

    const exportPath = path.join(tmpDir, "fill2.png");
    await callTool("export_image_fill", {
      nodeId: "1:2",
      exportPath,
      fillIndex: 2,
    });

    expect(mockSendCommand).toHaveBeenCalledWith("export_image_fill", {
      nodeId: "1:2",
      fillIndex: 2,
    });
  });

  it("defaults fillIndex to 0", async () => {
    const imageBase64 = Buffer.from("data").toString("base64");
    mockSendCommand.mockResolvedValue({
      imageData: imageBase64,
      mimeType: "image/png",
      width: 10,
      height: 10,
      imageHash: "h",
      scaleMode: "FILL",
      fillIndex: 0,
    });

    const exportPath = path.join(tmpDir, "default.png");
    await callTool("export_image_fill", {
      nodeId: "1:2",
      exportPath,
    });

    expect(mockSendCommand).toHaveBeenCalledWith("export_image_fill", {
      nodeId: "1:2",
      fillIndex: 0,
    });
  });
});
