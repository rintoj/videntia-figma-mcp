import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBrowserControlTools } from "../../src/videntia_figma_mcp/tools/browser-control-tools";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  sendCommandToChannel: jest.fn(),
  joinChannel: jest.fn(),
  getOpenChannels: jest.fn().mockResolvedValue([]),
}));

describe("browser control tools", () => {
  let server: McpServer;
  let mockSendToChannel: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });

    const ws = require("../../src/videntia_figma_mcp/utils/websocket");
    mockSendToChannel = ws.sendCommandToChannel;
    mockSendToChannel.mockClear();
    mockSendToChannel.mockResolvedValue({ success: true });

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

    registerBrowserControlTools(server);
  });

  async function callTool(toolName: string, args: any = {}) {
    const schema = toolSchemas.get(toolName);
    const handler = toolHandlers.get(toolName);
    if (!schema || !handler) throw new Error(`Tool ${toolName} not found`);
    const validatedArgs = schema.parse(args);
    return await handler(validatedArgs, { meta: {} });
  }

  it("registers all browser control tools", () => {
    const expected = [
      "browser_click",
      "browser_hover",
      "browser_type",
      "browser_press_key",
      "browser_scroll",
      "browser_navigate",
      "browser_back",
      "browser_forward",
      "browser_list_tabs",
      "browser_create_tab",
      "browser_close_tab",
      "browser_close_group",
      "browser_evaluate_js",
      "browser_read_console",
      "browser_read_network",
      "browser_snapshot",
      "browser_highlight_node",
      "browser_clear_highlight",
      "browser_intercept_start",
      "browser_intercept_stop",
      "browser_list_pending_requests",
      "browser_fulfill_request",
      "browser_fail_request",
      "browser_continue_request",
      "browser_clear_storage",
      "browser_capture_mhtml",
    ];
    for (const name of expected) {
      expect(toolHandlers.has(name)).toBe(true);
    }
  });

  describe("browser_click", () => {
    it("sends the click command with a selector", async () => {
      await callTool("browser_click", { selector: "[data-testid='submit']" });
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "click", {
        selector: "[data-testid='submit']",
        x: undefined,
        y: undefined,
        button: "left",
        clickCount: 1,
        tabId: undefined,
      });
    });

    it("sends the click command with coordinates and click_count", async () => {
      await callTool("browser_click", { x: 120, y: 340, click_count: 2, tab_id: 7 });
      expect(mockSendToChannel).toHaveBeenCalledWith(
        "browser",
        "click",
        expect.objectContaining({ x: 120, y: 340, clickCount: 2, tabId: 7 }),
      );
    });

    it("rejects when neither selector nor coordinates are given", async () => {
      await expect(callTool("browser_click", {})).rejects.toThrow(/selector, backend_dom_node_id, or both x and y/);
      expect(mockSendToChannel).not.toHaveBeenCalled();
    });

    it("rejects when only one coordinate is given", async () => {
      await expect(callTool("browser_click", { x: 100 })).rejects.toThrow(
        /selector, backend_dom_node_id, or both x and y/,
      );
    });
  });

  describe("browser_hover", () => {
    it("requires a target like click does", async () => {
      await expect(callTool("browser_hover", {})).rejects.toThrow(/selector, backend_dom_node_id, or both x and y/);
    });
  });

  describe("browser_type", () => {
    it("maps clear_first to clearFirst on the wire", async () => {
      await callTool("browser_type", { text: "hello", selector: "#name", clear_first: true });
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "type_text", {
        text: "hello",
        selector: "#name",
        clearFirst: true,
        tabId: undefined,
      });
    });

    it("requires text", async () => {
      await expect(callTool("browser_type", { selector: "#name" })).rejects.toThrow();
    });
  });

  describe("browser_press_key", () => {
    it("passes key and modifiers through", async () => {
      await callTool("browser_press_key", { key: "Enter", modifiers: ["shift"] });
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "press_key", {
        key: "Enter",
        modifiers: ["shift"],
        tabId: undefined,
      });
    });

    it("rejects unknown modifiers at the schema layer", async () => {
      await expect(callTool("browser_press_key", { key: "a", modifiers: ["hyper"] })).rejects.toThrow();
    });
  });

  describe("browser_scroll", () => {
    it("maps delta_x/delta_y to wire casing", async () => {
      await callTool("browser_scroll", { delta_y: 500, delta_x: -20 });
      expect(mockSendToChannel).toHaveBeenCalledWith(
        "browser",
        "scroll",
        expect.objectContaining({ deltaY: 500, deltaX: -20 }),
      );
    });
  });

  describe("browser_navigate", () => {
    it("uses an extended timeout for navigation", async () => {
      await callTool("browser_navigate", { url: "https://example.com" });
      expect(mockSendToChannel).toHaveBeenCalledWith(
        "browser",
        "navigate",
        { url: "https://example.com", tabId: undefined },
        45000,
      );
    });
  });

  describe("browser_close_tab", () => {
    it("requires an explicit tab_id", async () => {
      await expect(callTool("browser_close_tab", {})).rejects.toThrow();
      expect(mockSendToChannel).not.toHaveBeenCalled();
    });

    it("closes the given tab", async () => {
      await callTool("browser_close_tab", { tab_id: 42 });
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "close_tab", { tabId: 42 });
    });
  });

  describe("browser_evaluate_js", () => {
    it("passes the expression and derives the transport timeout", async () => {
      await callTool("browser_evaluate_js", { expression: "document.title", timeout_ms: 5000 });
      expect(mockSendToChannel).toHaveBeenCalledWith(
        "browser",
        "evaluate_js",
        { expression: "document.title", timeoutMs: 5000, tabId: undefined },
        20000,
      );
    });
  });

  describe("browser_read_console", () => {
    it("maps filter params to the wire", async () => {
      mockSendToChannel.mockResolvedValueOnce({ tabId: 1, total: 0, entries: [] });
      await callTool("browser_read_console", { pattern: "\\[App\\]", level: "error", clear: true, limit: 50 });
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "read_console", {
        pattern: "\\[App\\]",
        level: "error",
        limit: 50,
        clear: true,
        tabId: undefined,
      });
    });
  });

  describe("browser_read_network", () => {
    it("maps url_filter to urlFilter", async () => {
      mockSendToChannel.mockResolvedValueOnce({ tabId: 1, total: 0, requests: [] });
      await callTool("browser_read_network", { url_filter: "/api/", clear: false });
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "read_network", {
        urlFilter: "/api/",
        limit: undefined,
        clear: false,
        tabId: undefined,
      });
    });
  });

  describe("browser_list_tabs", () => {
    it("sends list_tabs with no params", async () => {
      mockSendToChannel.mockResolvedValueOnce({ tabs: [] });
      await callTool("browser_list_tabs", {});
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "list_tabs", {});
    });
  });

  describe("browser_create_tab", () => {
    it("defaults active and grouped to true and uses an extended timeout", async () => {
      mockSendToChannel.mockResolvedValueOnce({ success: true, tabId: 9 });
      await callTool("browser_create_tab", { url: "https://example.com" });
      expect(mockSendToChannel).toHaveBeenCalledWith(
        "browser",
        "create_tab",
        { url: "https://example.com", active: true, grouped: true, newWindow: false },
        45000,
      );
    });

    it("can opt out of the agent tab group", async () => {
      mockSendToChannel.mockResolvedValueOnce({ success: true, tabId: 9 });
      await callTool("browser_create_tab", { grouped: false });
      expect(mockSendToChannel).toHaveBeenCalledWith(
        "browser",
        "create_tab",
        expect.objectContaining({ grouped: false }),
        45000,
      );
    });

    it("can open the tab in a dedicated new window", async () => {
      mockSendToChannel.mockResolvedValueOnce({ success: true, tabId: 9, windowId: 4 });
      await callTool("browser_create_tab", { url: "https://example.com", new_window: true });
      expect(mockSendToChannel).toHaveBeenCalledWith(
        "browser",
        "create_tab",
        expect.objectContaining({ newWindow: true }),
        45000,
      );
    });
  });

  describe("browser_close_group", () => {
    it("sends close_group with no params", async () => {
      mockSendToChannel.mockResolvedValueOnce({ success: true, closed: 3 });
      await callTool("browser_close_group", {});
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "close_group", {});
    });
  });

  describe("browser_snapshot", () => {
    it("maps depth and include_ignored to the wire and defaults include_ignored to false", async () => {
      mockSendToChannel.mockResolvedValueOnce({ nodes: [] });
      await callTool("browser_snapshot", { depth: 3 });
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "get_ax_tree", {
        depth: 3,
        includeIgnored: false,
        tabId: undefined,
      });
    });

    it("rejects a negative depth at the schema layer", async () => {
      await expect(callTool("browser_snapshot", { depth: -1 })).rejects.toThrow();
    });
  });

  describe("browser_highlight_node", () => {
    it("sends highlight_node with a selector", async () => {
      await callTool("browser_highlight_node", { selector: "#hero" });
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "highlight_node", {
        selector: "#hero",
        backendDOMNodeId: undefined,
        tabId: undefined,
      });
    });

    it("sends highlight_node with a backend_dom_node_id", async () => {
      await callTool("browser_highlight_node", { backend_dom_node_id: 55 });
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "highlight_node", {
        selector: undefined,
        backendDOMNodeId: 55,
        tabId: undefined,
      });
    });

    it("rejects when neither selector nor backend_dom_node_id are given", async () => {
      await expect(callTool("browser_highlight_node", {})).rejects.toThrow(/selector or backend_dom_node_id/);
      expect(mockSendToChannel).not.toHaveBeenCalled();
    });
  });

  describe("browser_clear_highlight", () => {
    it("sends clear_highlight", async () => {
      await callTool("browser_clear_highlight", { tab_id: 3 });
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "clear_highlight", { tabId: 3 });
    });
  });

  describe("browser_intercept_start", () => {
    it("maps patterns and timeout_ms to the wire", async () => {
      await callTool("browser_intercept_start", {
        patterns: [{ url_pattern: "*/api/*", resource_type: "XHR" }],
        timeout_ms: 5000,
      });
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "intercept_start", {
        patterns: [{ urlPattern: "*/api/*", resourceType: "XHR" }],
        timeoutMs: 5000,
        tabId: undefined,
      });
    });

    it("rejects an unknown resource_type at the schema layer", async () => {
      await expect(
        callTool("browser_intercept_start", { patterns: [{ resource_type: "NotAType" }] }),
      ).rejects.toThrow();
    });

    it("rejects a timeout_ms below the minimum", async () => {
      await expect(callTool("browser_intercept_start", { timeout_ms: 10 })).rejects.toThrow();
    });
  });

  describe("browser_intercept_stop", () => {
    it("sends intercept_stop", async () => {
      await callTool("browser_intercept_stop", {});
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "intercept_stop", { tabId: undefined });
    });
  });

  describe("browser_list_pending_requests", () => {
    it("sends list_pending_requests", async () => {
      mockSendToChannel.mockResolvedValueOnce({ pending: [] });
      await callTool("browser_list_pending_requests", { tab_id: 9 });
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "list_pending_requests", { tabId: 9 });
    });
  });

  describe("browser_fulfill_request", () => {
    it("maps request_id/response fields to the wire with default status 200", async () => {
      await callTool("browser_fulfill_request", {
        request_id: "req-1",
        response_headers: { "Content-Type": "application/json" },
        body: '{"ok":true}',
      });
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "fulfill_request", {
        requestId: "req-1",
        responseCode: 200,
        responseHeaders: { "Content-Type": "application/json" },
        body: '{"ok":true}',
        tabId: undefined,
      });
    });

    it("requires request_id", async () => {
      await expect(callTool("browser_fulfill_request", {})).rejects.toThrow();
    });
  });

  describe("browser_fail_request", () => {
    it("defaults error_reason to Failed", async () => {
      await callTool("browser_fail_request", { request_id: "req-2" });
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "fail_request", {
        requestId: "req-2",
        errorReason: "Failed",
        tabId: undefined,
      });
    });

    it("rejects an unknown error_reason", async () => {
      await expect(
        callTool("browser_fail_request", { request_id: "req-2", error_reason: "TotallyBroken" }),
      ).rejects.toThrow();
    });
  });

  describe("browser_continue_request", () => {
    it("wraps overrides and maps post_data to postData", async () => {
      await callTool("browser_continue_request", {
        request_id: "req-3",
        url: "https://example.com/mocked",
        method: "POST",
        headers: { Authorization: "Bearer xyz" },
        post_data: "a=1",
      });
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "continue_request", {
        requestId: "req-3",
        overrides: {
          url: "https://example.com/mocked",
          method: "POST",
          headers: { Authorization: "Bearer xyz" },
          postData: "a=1",
        },
        tabId: undefined,
      });
    });

    it("requires request_id", async () => {
      await expect(callTool("browser_continue_request", {})).rejects.toThrow();
    });
  });

  describe("browser_clear_storage", () => {
    it("joins storage_types into a comma-separated string", async () => {
      await callTool("browser_clear_storage", {
        origin: "https://example.com",
        storage_types: ["cookies", "local_storage"],
      });
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "clear_storage", {
        origin: "https://example.com",
        storageTypes: "cookies,local_storage",
        tabId: undefined,
      });
    });

    it("requires origin", async () => {
      await expect(callTool("browser_clear_storage", {})).rejects.toThrow();
    });

    it("rejects an unknown storage type", async () => {
      await expect(
        callTool("browser_clear_storage", { origin: "https://example.com", storage_types: ["not_a_type"] }),
      ).rejects.toThrow();
    });
  });

  describe("browser_capture_mhtml", () => {
    it("reports the captured snapshot's character length", async () => {
      mockSendToChannel.mockResolvedValueOnce({ data: "abcde" });
      const result = await callTool("browser_capture_mhtml", { tab_id: 4 });
      expect(mockSendToChannel).toHaveBeenCalledWith("browser", "capture_mhtml", { tabId: 4 });
      expect(result.content[0].text).toMatch(/MHTML snapshot captured \(5 chars/);
    });
  });
});
