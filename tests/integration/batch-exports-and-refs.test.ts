import { z } from "zod";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import sharp from "sharp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../src/videntia_figma_mcp/tools";
import { clearToolRegistry } from "../../src/videntia_figma_mcp/utils/tool-registry";
import { clearExportCache } from "../../src/videntia_figma_mcp/utils/export-cache";
import { batchActions } from "../../src/videntia_figma_plugin/handlers/batch";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => {
  const { createCaptureAwareSend } = require("../helpers/capture-aware-websocket");
  return {
    sendCommandToFigma: createCaptureAwareSend(),
    sendCommandToChannel: jest.fn(),
    connectToFigma: jest.fn(),
    joinChannel: jest.fn(),
    getOpenChannels: jest.fn(async () => []),
    getCurrentChannel: jest.fn(() => "test-channel"),
  };
});

beforeAll(() => {
  (globalThis as any).figma = { ui: { postMessage: () => undefined } };
});
afterAll(() => {
  delete (globalThis as any).figma;
});

async function makePng(width: number, height: number, r = 10): Promise<string> {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r, g: 120, b: 200 } } })
    .png()
    .toBuffer();
  return buf.toString("base64");
}

/**
 * Runs every `batch_actions` dispatch through the REAL plugin batch handler, with a
 * fake per-command Figma. So $result resolution, sanitisation and error text are the
 * plugin's own.
 */
function fakePlugin(pngs: Record<string, string>) {
  const calls: { command: string; params: Record<string, unknown> }[] = [];
  let nextId = 100;
  const handle = async (command: string, params: Record<string, unknown>) => {
    calls.push({ command, params });
    switch (command) {
      case "export_node_as_image": {
        const id = String(params.nodeId);
        if (!pngs[id]) throw new Error(`Node not found with ID: ${id}`);
        return {
          nodeId: id,
          name: `Node ${id}`,
          format: "PNG",
          requestedScale: 1,
          actualScale: 1,
          originalWidth: 40,
          originalHeight: 20,
          exportedWidth: 40,
          exportedHeight: 20,
          subtreeHash: `hash-${id}`,
          mimeType: "image/png",
          imageData: pngs[id],
        };
      }
      case "export_image_fill":
        return { imageData: pngs[String(params.nodeId)], width: 40, height: 20, scaleMode: "FILL", fillIndex: 0 };
      case "create_frame":
      case "create_svg":
        return { id: `9:${nextId++}`, name: String(params.name ?? "Frame") };
      case "insert_child":
        return { parentId: params.parentId, childId: params.childId, index: params.index };
      case "rename_node":
        return { id: params.nodeId, name: params.name };
      default:
        return { ok: true };
    }
  };
  return { calls, handle };
}

describe("batch_actions: exports, $result references and icons", () => {
  let mockSend: jest.Mock;
  const handlers = new Map<string, Function>();
  const schemas = new Map<string, z.ZodObject<any>>();
  let tmpDir: string;
  let plugin: ReturnType<typeof fakePlugin>;

  beforeEach(async () => {
    handlers.clear();
    schemas.clear();
    const server = new McpServer({ name: "test", version: "1.0.0" }, { capabilities: { tools: {} } });
    mockSend = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSend.mockReset();
    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        handlers.set(args[0], args[3]);
        schemas.set(args[0], z.object(args[2]));
      }
      return (originalTool as any)(...args);
    });
    clearToolRegistry();
    registerTools(server);
    clearExportCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "batch-exports-"));

    plugin = fakePlugin({ "1:1": await makePng(40, 20, 10), "2:2": await makePng(40, 20, 240) });
    mockSend.mockImplementation(async (command: string, params: any) => {
      if (command === "batch_actions") return batchActions(params, plugin.handle);
      return {};
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    clearToolRegistry();
  });

  async function callBatch(args: any) {
    const res = await handlers.get("batch_actions")!(schemas.get("batch_actions")!.parse(args), { meta: {} });
    return res.content[0].text as string;
  }

  it("writes batched exports to save_to_path / output_directory and reports the file digest", async () => {
    const target = path.join(tmpDir, "a.png");
    const text = await callBatch({
      actions: [
        { action: "export_node_as_image", params: { nodeId: "1:1", save_to_path: target } },
        { action: "export_node_as_image", params: { nodeId: "2:2", output_directory: tmpDir, filename: "b" } },
      ],
    });

    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target).toString("base64")).toBe(await makePng(40, 20, 10));
    expect(fs.existsSync(path.join(tmpDir, "b.png"))).toBe(true);
    expect(text).toContain("Batch completed: 2/2 succeeded");
    expect(text).toMatch(/\| 0 \| export_node_as_image \| OK \| \{"path":"[^"]*a\.png","width":40,"height":20/);
    expect(text).toMatch(/\| 1 \| export_node_as_image \| OK \| \{"path":"[^"]*b\.png"/);
    expect(text).not.toContain("undefined");
    // The destination never reaches the plugin; it is honoured server-side.
    const sent = plugin.calls.filter((c) => c.command === "export_node_as_image");
    expect(sent.every((c) => c.params.save_to_path === undefined)).toBe(true);
  });

  describe("export cache inside a batch", () => {
    // The fake plugin always reports the same subtree hash for a node, like a real
    // plugin would for an image fill whose first render came out blank.
    async function standaloneExport(nodeId: string, target: string) {
      const res = await handlers.get("export_node_as_image")!(
        schemas.get("export_node_as_image")!.parse({ nodeId, save_to_path: target }),
        { meta: {} },
      );
      return JSON.parse(res.content[0].text as string);
    }

    beforeEach(() => {
      mockSend.mockImplementation(async (command: string, params: any) => {
        if (command === "batch_actions") return batchActions(params, plugin.handle);
        if (command === "export_node_as_image") return plugin.handle(command, params);
        return {};
      });
    });

    it("never serves a cached render to a batched export that follows a mutation", async () => {
      const target = path.join(tmpDir, "n.png");
      const first = await standaloneExport("1:1", target);
      expect(first.cached).toBe(false);

      // The node changes in Figma; the (stale) subtree hash stays the same.
      const fresh = await makePng(40, 20, 99);
      const pngs = { "1:1": fresh, "2:2": await makePng(40, 20, 240) };
      plugin = fakePlugin(pngs);

      const text = await callBatch({
        actions: [
          { action: "rename_node", params: { nodeId: "1:1", name: "Renamed" } },
          { action: "export_node_as_image", params: { nodeId: "1:1", save_to_path: target } },
        ],
      });
      expect(text).toMatch(/\| 1 \| export_node_as_image \| OK \| \{"path":"[^"]*n\.png"[^|]*"cached":false/);
      expect(fs.readFileSync(target).toString("base64")).toBe(fresh);

      // ...and the post-mutation render is not recorded, so the next standalone export
      // re-renders instead of pinning what the batch saw.
      const after = await standaloneExport("1:1", target);
      expect(after.cached).toBe(false);
    });

    it("skips the cache read for a batched export even with no mutation, but still records it", async () => {
      const target = path.join(tmpDir, "m.png");
      await standaloneExport("1:1", target);
      const text = await callBatch({
        actions: [{ action: "export_node_as_image", params: { nodeId: "1:1", save_to_path: target } }],
      });
      expect(text).toMatch(/"cached":false/);
      const after = await standaloneExport("1:1", target);
      expect(after.cached).toBe(true);
    });
  });

  it("rejects inline: true inside a batch instead of reporting a silent OK", async () => {
    const text = await callBatch({
      actions: [{ action: "export_node_as_image", params: { nodeId: "1:1", inline: true } }],
    });
    expect(text).toContain("| 0 | export_node_as_image | FAIL |");
    expect(text).toContain("cannot run inside batch_actions");
    expect(plugin.calls).toHaveLength(0);
  });

  it("writes a batched export_image_fill to its exportPath", async () => {
    const target = path.join(tmpDir, "fill.png");
    const text = await callBatch({
      actions: [{ action: "export_image_fill", params: { nodeId: "1:1", exportPath: target } }],
    });
    expect(fs.existsSync(target)).toBe(true);
    expect(text).toContain("| 0 | export_image_fill | OK |");
  });

  it("refuses bulk_export_frames with a reason", async () => {
    const text = await callBatch({ actions: [{ action: "bulk_export_frames", params: { out_dir: tmpDir } }] });
    expect(text).toContain("| 0 | bulk_export_frames | FAIL |");
    expect(text).toContain("cannot run inside batch_actions");
  });

  it("fails an action whose $result path names a missing key instead of dropping the reference", async () => {
    const text = await callBatch({
      actions: [
        { action: "create_frame", params: { name: "Parent", x: 0, y: 0, width: 10, height: 10 } },
        {
          action: "create_frame",
          params: { name: "Child", x: 0, y: 0, width: 5, height: 5, parentId: "$result[0].nodeIdTypo" },
        },
      ],
    });
    expect(text).toContain("| 1 | create_frame | FAIL |");
    expect(text).toContain("no 'nodeIdTypo' field. Available keys: id, name");
    // The child was never created on the page as a stray node.
    expect(plugin.calls.filter((c) => c.command === "create_frame")).toHaveLength(1);
  });

  it("rejects a forward $result reference before dispatch", async () => {
    const text = await callBatch({
      actions: [
        { action: "rename_node", params: { nodeId: "$result[1].id", name: "X" } },
        { action: "create_frame", params: { name: "F", x: 0, y: 0, width: 5, height: 5 } },
      ],
    });
    expect(text).toContain("| 0 | rename_node | FAIL |");
    expect(text).toContain("has not run yet");
    expect(plugin.calls.map((c) => c.command)).toEqual(["create_frame"]);
  });

  it("rejects a reference to an action that failed server-side instead of passing it through", async () => {
    const text = await callBatch({
      actions: [
        { action: "create_icon", params: { parentId: "1:1", name: "definitely-not-an-icon-zz", size: 16 } },
        { action: "rename_node", params: { nodeId: "$result[0].id", name: "X" } },
      ],
    });
    expect(text).toContain("| 1 | rename_node | FAIL |");
    expect(text).toContain("refers to action #0 (create_icon), which failed");
    expect(plugin.calls).toHaveLength(0);
  });

  it("maps caller indices through create_icon expansion and reports rows by caller index", async () => {
    const text = await callBatch({
      actions: [
        { action: "create_icon", params: { parentId: "1:1", icon: "CheckIcon", size: 16, index: 0 } },
        { action: "create_icon", params: { parentId: "1:1", iconName: "lucide:circle-check", size: 16 } },
        { action: "rename_node", params: { nodeId: "$result[1].id", name: "Renamed" } },
      ],
    });
    expect(plugin.calls.map((c) => c.command)).toEqual(["create_svg", "insert_child", "create_svg", "rename_node"]);
    const svgs = plugin.calls.filter((c) => c.command === "create_svg");
    expect(svgs.map((c) => c.params.name)).toEqual(["check", "circle-check"]);
    // $result[1] is the SECOND icon (9:101), not the first icon's insert_child step.
    expect(plugin.calls[3].params.nodeId).toBe("9:101");
    expect(text).toContain("| 0 | create_icon | OK | id=9:100");
    expect(text).toContain("| 1 | create_icon | OK | id=9:101");
    expect(text).toContain("| 2 | rename_node | OK | id=9:101");
    expect(text).toContain("Batch completed: 3/3 succeeded");
  });

  it("reports create_icon as partially committed when only its insert_child step fails", async () => {
    const handle = plugin.handle;
    plugin.handle = async (command: string, params: Record<string, unknown>) => {
      if (command === "insert_child") throw new Error("Index out of range");
      return handle(command, params);
    };
    mockSend.mockImplementation(async (command: string, params: any) => {
      if (command === "batch_actions") return batchActions(params, plugin.handle);
      return {};
    });
    const text = await callBatch({
      actions: [{ action: "create_icon", params: { parentId: "1:1", icon: "check", size: 16, index: 99 } }],
    });
    expect(text).toContain("| 0 | create_icon | FAIL |");
    expect(text).not.toContain("No actions were committed");
    expect(text).toContain("#0 (partially)");
    const manifest = JSON.parse(text.split("```json\n")[1].split("\n```")[0]);
    expect(manifest[0]).toMatchObject({ committed: true, partial: true, nodeId: "9:100", success: false });
  });

  it("explains an unknown brand icon instead of 'Icon \"\" not found'", async () => {
    const text = await callBatch({
      actions: [{ action: "create_icon", params: { parentId: "1:1", icon: "github", size: 16 } }],
    });
    expect(text).toContain('Icon "github" not found');
    expect(text).toContain("create_svg");
  });
});
