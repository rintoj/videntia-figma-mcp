import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendCommandToChannel } from "../utils/websocket.js";

const BROWSER_CHANNEL = "browser";

const tabIdSchema = z
  .number()
  .int()
  .optional()
  .describe(
    "Optional Chrome tab ID to target. The tab does NOT need to be focused or visible — all browser tools work on background tabs via CDP. When omitted, the extension uses its pinned tab (set via the popup) or falls back to the active tab in the focused window; pass an explicit tab ID for any multi-step workflow so commands never leak onto whichever tab the user has focused. Use browser_list_tabs to discover tab IDs.",
  );

const selectorSchema = z
  .string()
  .optional()
  .describe(
    "CSS selector of the target element. The element is scrolled into view and its center is used as the interaction point. Prefer [data-fig-id] / [data-testid] selectors from get_browser_dom_nodes.",
  );

const backendDOMNodeIdSchema = z
  .number()
  .int()
  .optional()
  .describe(
    "backendDOMNodeId of the target element, from a prior browser_snapshot call. More robust than a CSS selector for elements with no stable attribute (icon-only buttons, dynamically generated lists, third-party widgets) — resolved via the accessibility tree instead of DOM structure.",
  );

const coordSchema = (axis: string) =>
  z.number().optional().describe(`${axis} coordinate in CSS px (viewport-relative). Alternative to selector.`);

function requirePoint(
  selector: string | undefined,
  backendDOMNodeId: number | undefined,
  x: number | undefined,
  y: number | undefined,
): void {
  if (!selector && typeof backendDOMNodeId !== "number" && (typeof x !== "number" || typeof y !== "number")) {
    throw new Error("Provide a selector, backend_dom_node_id, or both x and y coordinates.");
  }
}

function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

export function registerBrowserControlTools(server: McpServer): void {
  server.tool(
    "browser_click",
    "Click an element or point in a browser tab via CDP input events (real trusted clicks). Target by CSS selector (scrolled into view automatically), backend_dom_node_id (from browser_snapshot), or viewport x/y coordinates. Requires the Videntia Browser Connect extension.",
    {
      selector: selectorSchema,
      backend_dom_node_id: backendDOMNodeIdSchema,
      x: coordSchema("X"),
      y: coordSchema("Y"),
      button: z.enum(["left", "middle", "right"]).optional().default("left").describe("Mouse button."),
      click_count: z
        .number()
        .int()
        .min(1)
        .max(3)
        .optional()
        .default(1)
        .describe("1 = single click, 2 = double click, 3 = triple click (selects a paragraph)."),
      tab_id: tabIdSchema,
    },
    async ({ selector, backend_dom_node_id, x, y, button, click_count, tab_id }) => {
      requirePoint(selector, backend_dom_node_id, x, y);
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "click", {
        selector,
        backendDOMNodeId: backend_dom_node_id,
        x,
        y,
        button,
        clickCount: click_count,
        tabId: tab_id,
      });
      return textResult(result);
    },
  );

  server.tool(
    "browser_hover",
    "Move the mouse over an element or point in a browser tab (triggers :hover styles, tooltips, dropdown menus). Target by CSS selector, backend_dom_node_id (from browser_snapshot), or viewport x/y coordinates.",
    {
      selector: selectorSchema,
      backend_dom_node_id: backendDOMNodeIdSchema,
      x: coordSchema("X"),
      y: coordSchema("Y"),
      tab_id: tabIdSchema,
    },
    async ({ selector, backend_dom_node_id, x, y, tab_id }) => {
      requirePoint(selector, backend_dom_node_id, x, y);
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "hover", {
        selector,
        backendDOMNodeId: backend_dom_node_id,
        x,
        y,
        tabId: tab_id,
      });
      return textResult(result);
    },
  );

  server.tool(
    "browser_type",
    "Type text into a browser tab via CDP (real trusted input, works with React/Vue controlled inputs). Pass selector or backend_dom_node_id (from browser_snapshot) to focus an element first; set clear_first to replace its current value. Without either, types into whatever currently has focus. Use browser_press_key for Enter/Tab/etc.",
    {
      text: z.string().describe("Text to type. Inserted as-is; no special-key interpretation."),
      selector: selectorSchema,
      backend_dom_node_id: backendDOMNodeIdSchema,
      clear_first: z
        .boolean()
        .optional()
        .default(false)
        .describe("Select the element's existing content first so the typed text replaces it."),
      tab_id: tabIdSchema,
    },
    async ({ text, selector, backend_dom_node_id, clear_first, tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "type_text", {
        text,
        selector,
        backendDOMNodeId: backend_dom_node_id,
        clearFirst: clear_first,
        tabId: tab_id,
      });
      return textResult(result);
    },
  );

  server.tool(
    "browser_press_key",
    "Press a keyboard key (with optional modifiers) in a browser tab. Use for Enter, Tab, Escape, arrows, shortcuts like ctrl+a / meta+r.",
    {
      key: z
        .string()
        .describe(
          "Key name: a single character, or Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown, Space.",
        ),
      modifiers: z
        .array(z.enum(["alt", "ctrl", "meta", "shift"]))
        .optional()
        .describe("Modifier keys held during the press."),
      tab_id: tabIdSchema,
    },
    async ({ key, modifiers, tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "press_key", { key, modifiers, tabId: tab_id });
      return textResult(result);
    },
  );

  server.tool(
    "browser_scroll",
    "Scroll a browser tab by a pixel delta using a mouse-wheel event. Positive delta_y scrolls down. Optionally scroll over a specific element (for inner scroll containers) via selector, backend_dom_node_id, or x/y.",
    {
      delta_y: z.number().describe("Vertical scroll amount in px (positive = down, negative = up)."),
      delta_x: z.number().optional().default(0).describe("Horizontal scroll amount in px."),
      selector: selectorSchema,
      backend_dom_node_id: backendDOMNodeIdSchema,
      x: coordSchema("X"),
      y: coordSchema("Y"),
      tab_id: tabIdSchema,
    },
    async ({ delta_y, delta_x, selector, backend_dom_node_id, x, y, tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "scroll", {
        deltaY: delta_y,
        deltaX: delta_x,
        selector,
        backendDOMNodeId: backend_dom_node_id,
        x,
        y,
        tabId: tab_id,
      });
      return textResult(result);
    },
  );

  server.tool(
    "browser_navigate",
    "Navigate a browser tab to a URL and wait for the page to finish loading. Only http(s) URLs and about:blank are allowed. Viewport emulation set via set_browser_viewport is re-applied automatically after the load.",
    {
      url: z.string().describe("Destination URL. Scheme defaults to https:// when omitted."),
      tab_id: tabIdSchema,
    },
    async ({ url, tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "navigate", { url, tabId: tab_id }, 45000);
      return textResult(result);
    },
  );

  server.tool(
    "browser_back",
    "Go back one entry in a browser tab's history and wait for the load to settle.",
    { tab_id: tabIdSchema },
    async ({ tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "go_back", { tabId: tab_id }, 30000);
      return textResult(result);
    },
  );

  server.tool(
    "browser_forward",
    "Go forward one entry in a browser tab's history and wait for the load to settle.",
    { tab_id: tabIdSchema },
    async ({ tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "go_forward", { tabId: tab_id }, 30000);
      return textResult(result);
    },
  );

  server.tool(
    "browser_list_tabs",
    "List all open Chrome tabs with tab ID, URL, title, active state, whether the tab is pinned for this session via the extension popup, and whether it belongs to the agent tab group.",
    {},
    async () => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "list_tabs", {});
      return textResult(result);
    },
  );

  server.tool(
    "browser_create_tab",
    "Open a new Chrome tab, optionally at a URL, and wait for it to load. By default the tab is added to the \"Videntia\" agent tab group so agent-driven tabs stay visually separated from the user's own tabs. Set new_window to open a dedicated window instead — use this before viewport testing, so window resizes (set_browser_viewport) never disturb the user's own window. Returns the new tab's ID (and windowId) for use with other browser tools.",
    {
      url: z.string().optional().describe("URL to open (defaults to about:blank)."),
      active: z.boolean().optional().default(true).describe("Focus the new tab/window (default true)."),
      grouped: z
        .boolean()
        .optional()
        .default(true)
        .describe("Add the tab to the agent tab group (default true). Set false for a plain ungrouped tab."),
      new_window: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Open the tab in a new dedicated Chrome window, isolating window resizes from the user's tabs. Such tabs are not added to the agent tab group (groups are per-window) — close them with browser_close_tab.",
        ),
    },
    async ({ url, active, grouped, new_window }) => {
      const result = await sendCommandToChannel(
        BROWSER_CHANNEL,
        "create_tab",
        { url, active, grouped, newWindow: new_window },
        45000,
      );
      return textResult(result);
    },
  );

  server.tool(
    "browser_close_group",
    'Close the entire "Videntia" agent tab group — every tab this session created via browser_create_tab — in one shot. Safe when no group exists (no-op). Use for end-of-session cleanup.',
    {},
    async () => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "close_group", {});
      return textResult(result);
    },
  );

  server.tool(
    "browser_close_tab",
    "Close a Chrome tab. Requires an explicit tab_id — there is deliberately no implicit fallback to the active tab.",
    {
      tab_id: z.number().int().describe("ID of the tab to close (required)."),
    },
    async ({ tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "close_tab", { tabId: tab_id });
      return textResult(result);
    },
  );

  server.tool(
    "browser_evaluate_js",
    "Evaluate a JavaScript expression in a browser tab's page context via CDP Runtime.evaluate (awaits promises, returns by value, results capped at 100KB). Use for reading page state or one-off DOM operations not covered by other tools.",
    {
      expression: z.string().describe("JavaScript expression. Wrap object literals in parentheses: '({a: 1})'."),
      timeout_ms: z.number().int().min(100).max(45000).optional().describe("Evaluation timeout in ms (default 15000)."),
      tab_id: tabIdSchema,
    },
    async ({ expression, timeout_ms, tab_id }) => {
      const result = await sendCommandToChannel(
        BROWSER_CHANNEL,
        "evaluate_js",
        { expression, timeoutMs: timeout_ms, tabId: tab_id },
        (timeout_ms ?? 15000) + 15000,
      );
      return textResult(result);
    },
  );

  server.tool(
    "browser_read_console",
    "Read buffered console messages, uncaught exceptions, and auto-handled dialogs from a browser tab. The first call starts monitoring (recent messages are usually backfilled); the buffer holds the last 500 entries and resets on navigation.",
    {
      pattern: z.string().optional().describe("Regex to filter message text (e.g. '\\[MyApp\\]' or 'error')."),
      level: z
        .enum(["log", "info", "warn", "error", "debug"])
        .optional()
        .describe("Only return entries at this level."),
      limit: z.number().int().min(1).max(500).optional().describe("Max entries to return (default 200, newest kept)."),
      clear: z.boolean().optional().default(false).describe("Clear the buffer after reading."),
      tab_id: tabIdSchema,
    },
    async ({ pattern, level, limit, clear, tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "read_console", {
        pattern,
        level,
        limit,
        clear,
        tabId: tab_id,
      });
      return textResult(result);
    },
  );

  server.tool(
    "browser_read_network",
    "Read buffered network requests (URL, method, resource type, status, MIME type, failures) from a browser tab. The first call starts monitoring — only requests made after that are captured. Buffer holds the last 300 requests across navigations.",
    {
      url_filter: z.string().optional().describe("Substring to match against request URLs (e.g. '/api/')."),
      limit: z.number().int().min(1).max(300).optional().describe("Max requests to return (default 200, newest kept)."),
      clear: z.boolean().optional().default(false).describe("Clear the buffer after reading."),
      tab_id: tabIdSchema,
    },
    async ({ url_filter, limit, clear, tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "read_network", {
        urlFilter: url_filter,
        limit,
        clear,
        tabId: tab_id,
      });
      return textResult(result);
    },
  );

  server.tool(
    "browser_snapshot",
    "Get an accessibility-tree snapshot of a browser tab: a flattened list of {ax_id, role, name, backend_dom_node_id, depth} for every element, in document order. More robust than CSS selectors for elements with no stable attribute (icon-only buttons, dynamically generated lists, third-party widgets) — pass an entry's backend_dom_node_id to browser_click/browser_hover/browser_type/browser_scroll/browser_highlight_node as an alternative to selector.",
    {
      depth: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Max accessibility-tree depth to return (omit for unlimited)."),
      include_ignored: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include accessibility-ignored nodes (hidden/presentational elements). Default false."),
      tab_id: tabIdSchema,
    },
    async ({ depth, include_ignored, tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "get_ax_tree", {
        depth,
        includeIgnored: include_ignored,
        tabId: tab_id,
      });
      return textResult(result);
    },
  );

  server.tool(
    "browser_highlight_node",
    "Draw a native DevTools-style highlight box (content/padding/border/margin) around an element in a browser tab, without injecting anything into the page DOM. Useful for visually confirming which element a browser_snapshot backend_dom_node_id or selector actually resolved to. Target by selector or backend_dom_node_id. Call browser_clear_highlight to remove it. Distinct from overlay_figma_selection_in_browser, which onion-skins a full Figma frame image over the page for design-vs-implementation comparison.",
    {
      selector: selectorSchema,
      backend_dom_node_id: backendDOMNodeIdSchema,
      tab_id: tabIdSchema,
    },
    async ({ selector, backend_dom_node_id, tab_id }) => {
      if (!selector && typeof backend_dom_node_id !== "number") {
        throw new Error("Provide a selector or backend_dom_node_id.");
      }
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "highlight_node", {
        selector,
        backendDOMNodeId: backend_dom_node_id,
        tabId: tab_id,
      });
      return textResult(result);
    },
  );

  server.tool(
    "browser_clear_highlight",
    "Remove the highlight box drawn by browser_highlight_node from a browser tab.",
    { tab_id: tabIdSchema },
    async ({ tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "clear_highlight", { tabId: tab_id });
      return textResult(result);
    },
  );

  const requestPatternSchema = z.object({
    url_pattern: z
      .string()
      .optional()
      .describe("Glob-style URL pattern to match (e.g. '*/api/*', '*.png'). Omit to match all URLs."),
    resource_type: z
      .enum([
        "Document",
        "Stylesheet",
        "Image",
        "Media",
        "Font",
        "Script",
        "TextTrack",
        "XHR",
        "Fetch",
        "Prefetch",
        "EventSource",
        "WebSocket",
        "Manifest",
        "SignedExchange",
        "Ping",
        "CSPViolationReport",
        "Preflight",
        "Other",
      ])
      .optional()
      .describe("Only intercept this resource type. Omit to match all types."),
  });

  server.tool(
    "browser_intercept_start",
    "Start intercepting network requests in a browser tab matching one or more URL patterns — each matching request pauses until resolved via browser_fulfill_request, browser_fail_request, or browser_continue_request. SAFETY: any request left unresolved auto-continues unmodified after timeout_ms (default 8000) and logs a warning to browser_read_console, so interception can never wedge the page. Does not affect browser_read_network, which keeps working normally alongside interception. Call browser_intercept_stop when done.",
    {
      patterns: z
        .array(requestPatternSchema)
        .optional()
        .describe("Patterns to intercept (OR'd together). Omit to intercept every request."),
      timeout_ms: z
        .number()
        .int()
        .min(500)
        .max(60000)
        .optional()
        .describe("Auto-continue timeout per paused request in ms (default 8000)."),
      tab_id: tabIdSchema,
    },
    async ({ patterns, timeout_ms, tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "intercept_start", {
        patterns: patterns?.map((p) => ({
          urlPattern: p.url_pattern,
          resourceType: p.resource_type,
        })),
        timeoutMs: timeout_ms,
        tabId: tab_id,
      });
      return textResult(result);
    },
  );

  server.tool(
    "browser_intercept_stop",
    "Stop network interception in a browser tab. Any still-pending paused requests are auto-continued unmodified before disabling, so nothing is left hanging.",
    { tab_id: tabIdSchema },
    async ({ tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "intercept_stop", { tabId: tab_id });
      return textResult(result);
    },
  );

  server.tool(
    "browser_list_pending_requests",
    "List currently-paused intercepted requests (from browser_intercept_start) awaiting resolution in a browser tab, with how long each has been pending.",
    { tab_id: tabIdSchema },
    async ({ tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "list_pending_requests", { tabId: tab_id });
      return textResult(result);
    },
  );

  server.tool(
    "browser_fulfill_request",
    "Resolve a paused intercepted request (from browser_intercept_start) with a custom response — for mocking API responses, simulating errors, or stripping an auth wall. request_id comes from the requestPaused entry surfaced via browser_list_pending_requests.",
    {
      request_id: z.string().describe("ID of the paused request, from browser_list_pending_requests."),
      response_code: z
        .number()
        .int()
        .optional()
        .default(200)
        .describe("HTTP status code to respond with (default 200)."),
      response_headers: z
        .record(z.string(), z.string())
        .optional()
        .describe("Response headers as a plain object (e.g. {'Content-Type': 'application/json'})."),
      body: z.string().optional().describe("Response body as a plain string (encoded to base64 automatically)."),
      tab_id: tabIdSchema,
    },
    async ({ request_id, response_code, response_headers, body, tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "fulfill_request", {
        requestId: request_id,
        responseCode: response_code,
        responseHeaders: response_headers,
        body,
        tabId: tab_id,
      });
      return textResult(result);
    },
  );

  server.tool(
    "browser_fail_request",
    "Resolve a paused intercepted request (from browser_intercept_start) by failing it — for simulating network errors (e.g. offline, connection reset).",
    {
      request_id: z.string().describe("ID of the paused request, from browser_list_pending_requests."),
      error_reason: z
        .enum([
          "Failed",
          "Aborted",
          "TimedOut",
          "AccessDenied",
          "ConnectionClosed",
          "ConnectionReset",
          "ConnectionRefused",
          "ConnectionAborted",
          "ConnectionFailed",
          "NameNotResolved",
          "InternetDisconnected",
          "AddressUnreachable",
          "BlockedByClient",
          "BlockedByResponse",
        ])
        .optional()
        .default("Failed")
        .describe("CDP network error reason (default 'Failed')."),
      tab_id: tabIdSchema,
    },
    async ({ request_id, error_reason, tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "fail_request", {
        requestId: request_id,
        errorReason: error_reason,
        tabId: tab_id,
      });
      return textResult(result);
    },
  );

  server.tool(
    "browser_continue_request",
    "Resolve a paused intercepted request (from browser_intercept_start) by letting it proceed, optionally with URL/method/headers/body overrides.",
    {
      request_id: z.string().describe("ID of the paused request, from browser_list_pending_requests."),
      url: z.string().optional().describe("Override the request URL."),
      method: z.string().optional().describe("Override the HTTP method."),
      headers: z.record(z.string(), z.string()).optional().describe("Override request headers as a plain object."),
      post_data: z.string().optional().describe("Override the request body (plain string)."),
      tab_id: tabIdSchema,
    },
    async ({ request_id, url, method, headers, post_data, tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "continue_request", {
        requestId: request_id,
        overrides: { url, method, headers, postData: post_data },
        tabId: tab_id,
      });
      return textResult(result);
    },
  );

  server.tool(
    "browser_clear_storage",
    "Clear browser storage (cookies, localStorage, IndexedDB, cache, etc.) for an origin in a browser tab — useful for resetting to a clean state before a diff run. origin must be a plain security origin (e.g. 'https://example.com'), not a full URL with a path.",
    {
      origin: z.string().describe("Security origin to clear, e.g. 'https://example.com'."),
      storage_types: z
        .array(
          z.enum([
            "appcache",
            "cookies",
            "file_systems",
            "indexeddb",
            "local_storage",
            "shader_cache",
            "websql",
            "cache_storage",
            "interest_groups",
            "shared_storage",
          ]),
        )
        .optional()
        .describe("Specific storage types to clear. Omit to clear everything."),
      tab_id: tabIdSchema,
    },
    async ({ origin, storage_types, tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "clear_storage", {
        origin,
        storageTypes: storage_types?.join(","),
        tabId: tab_id,
      });
      return textResult(result);
    },
  );

  server.tool(
    "browser_capture_mhtml",
    "Capture a full-page MHTML snapshot of a browser tab — a single portable archive with all resources (images, stylesheets, fonts) inlined, viewable offline. WARNING: on media-heavy pages this can be tens of MB — the entire page's resources are embedded, unlike a screenshot. Prefer get_browser_page_screenshot for routine visual checks; use this only when you need an offline-viewable archive (e.g. attaching repro evidence to a diff report).",
    { tab_id: tabIdSchema },
    async ({ tab_id }) => {
      const result = await sendCommandToChannel<{ data: string }>(BROWSER_CHANNEL, "capture_mhtml", { tabId: tab_id });
      return {
        content: [
          {
            type: "text" as const,
            text: `MHTML snapshot captured (${result.data.length} chars, base64-ish MHTML text).`,
          },
        ],
      };
    },
  );
}
