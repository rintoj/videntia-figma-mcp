import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendCommandToFigma } from "../utils/websocket.js";
import { browserIdSchema, sendBrowserCommand, tabIdSchema } from "./browser-channel.js";

export function registerBrowserTools(server: McpServer): void {
  server.tool(
    "get_browser_page_info",
    "Get the URL, title, and tab ID of the target browser tab. Returns the active tab by default; pass tab_id to target a specific tab. Requires the Figma Overlay Chrome extension to be installed and connected.",
    {
      tab_id: tabIdSchema,
      browser_id: browserIdSchema,
    },
    async ({ tab_id, browser_id }) => {
      const result = await sendBrowserCommand<{ url: string; title: string; tabId: number }>("get_page_info", {
        browserId: browser_id,
        tabId: tab_id,
      });
      return {
        content: [{ type: "text", text: `URL: ${result.url}\nTitle: ${result.title}\nTab ID: ${result.tabId}` }],
      };
    },
  );

  server.tool(
    "get_browser_page_screenshot",
    "Take a screenshot of a browser tab. Uses debugger-based capture, so the tab does NOT need to be focused — pass tab_id to screenshot a background tab while the user works elsewhere. Targets the pinned/active tab when tab_id is omitted. Set full_page to capture beyond the viewport (entire scrollable page). Returns a PNG image. Requires the Figma Overlay Chrome extension.",
    {
      full_page: z
        .boolean()
        .optional()
        .default(false)
        .describe("Capture the full scrollable page instead of just the visible viewport."),
      tab_id: tabIdSchema,
      browser_id: browserIdSchema,
    },
    async ({ full_page, tab_id, browser_id }) => {
      const result = await sendBrowserCommand<{ imageData: string; mimeType: string }>("get_page_screenshot", {
        browserId: browser_id,
        tabId: tab_id,
        fullPage: full_page,
      });
      return {
        content: [{ type: "image", data: result.imageData, mimeType: result.mimeType }],
      };
    },
  );

  server.tool(
    "get_browser_dom_nodes",
    "Get serialized DOM nodes from a browser tab. Returns tag names, attributes, text content, bounding rects, and children. Targets the pinned/active tab by default, or pass tab_id to target a specific tab. Requires the Figma Overlay Chrome extension.",
    {
      selector: z
        .string()
        .optional()
        .default("body")
        .describe("CSS selector to scope the query (e.g. 'body', '#app', '.container', 'main'). Defaults to 'body'."),
      depth: z.coerce
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .default(3)
        .describe("How many levels of children to include (1–10, default 3)."),
      include_text: z
        .boolean()
        .optional()
        .default(true)
        .describe("Include text content of nodes (truncated to 200 chars each)."),
      include_attributes: z
        .boolean()
        .optional()
        .default(true)
        .describe("Include element attributes (id, class, href, src, role, aria-label, etc.)."),
      tab_id: tabIdSchema,
      browser_id: browserIdSchema,
    },
    async ({ selector, depth, include_text, include_attributes, tab_id, browser_id }) => {
      const result = await sendBrowserCommand("get_dom_nodes", {
        browserId: browser_id,
        selector,
        depth,
        includeText: include_text,
        includeAttributes: include_attributes,
        tabId: tab_id,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "get_browser_computed_styles",
    "Get computed CSS styles for a DOM element in a browser tab. Useful for comparing implemented styles against Figma design specs. Targets the pinned/active tab by default, or pass tab_id to target a specific tab. Requires the Figma Overlay Chrome extension.",
    {
      selector: z
        .string()
        .describe(
          "CSS selector identifying the element (e.g. 'h1', '#hero-button', '.nav-item:first-child'). Should match one element.",
        ),
      properties: z
        .array(z.string())
        .optional()
        .describe(
          "Specific CSS property names to return (e.g. ['color', 'font-size', 'padding']). Omit for a curated set covering color, typography, spacing, layout, and effects.",
        ),
      tab_id: tabIdSchema,
      browser_id: browserIdSchema,
    },
    async ({ selector, properties, tab_id, browser_id }) => {
      const result = await sendBrowserCommand("get_computed_styles", {
        browserId: browser_id,
        selector,
        properties,
        tabId: tab_id,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "overlay_figma_selection_in_browser",
    "Export the currently selected Figma frame and inject it as a semi-transparent overlay in a browser tab. Targets the pinned/active tab by default, or pass tab_id to overlay a specific tab. Useful for design vs implementation comparison. Requires both the Figma plugin and Chrome extension to be connected.",
    {
      opacity: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .default(0.5)
        .describe("Overlay opacity from 0 (invisible) to 1 (fully opaque). Defaults to 0.5."),
      scale: z
        .number()
        .optional()
        .default(2)
        .describe("Export scale factor for image quality. Defaults to 2 (retina)."),
      cropTop: z
        .number()
        .min(0)
        .optional()
        .default(0)
        .describe(
          "Pixels to crop from the top of the Figma image (design-space px). Use to skip iOS status bar / browser address bar baked into mobile frames.",
        ),
      cropBottom: z
        .number()
        .min(0)
        .optional()
        .default(0)
        .describe("Pixels to crop from the bottom of the Figma image (design-space px)."),
      offsetX: z
        .number()
        .optional()
        .default(0)
        .describe("Horizontal offset in CSS px applied to the overlay position."),
      offsetY: z.number().optional().default(0).describe("Vertical offset in CSS px applied to the overlay position."),
      blendMode: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "When true, overlay starts with difference blend mode enabled — pixel-perfect matches render black, mismatches render bright. Useful for autonomous visual diffing without human eyeballing.",
        ),
      tab_id: tabIdSchema,
      browser_id: browserIdSchema,
    },
    async ({ opacity, scale, cropTop, cropBottom, offsetX, offsetY, blendMode, tab_id, browser_id }) => {
      const exported = await sendCommandToFigma<{
        imageData: string;
        mimeType: string;
        originalWidth: number;
        originalHeight: number;
        name?: string;
      }>("export_selection_as_image", { scale });

      await sendBrowserCommand("inject_figma_overlay", {
        browserId: browser_id,
        imageData: exported.imageData,
        mimeType: exported.mimeType,
        width: exported.originalWidth,
        height: exported.originalHeight,
        opacity,
        cropTop,
        cropBottom,
        offsetX,
        offsetY,
        blendMode,
        tabId: tab_id,
      });

      const browserInfo = await sendBrowserCommand<{ url: string; title: string; tabId: number }>("get_page_info", {
        browserId: browser_id,
        tabId: tab_id,
      });

      return {
        content: [
          {
            type: "text",
            text: [
              `Overlay injected: "${exported.name ?? "selection"}" (${exported.originalWidth}×${exported.originalHeight}px) at ${Math.round(opacity * 100)}% opacity.`,
              `Browser: ${browserInfo.title} — ${browserInfo.url} (tab ${browserInfo.tabId})`,
              exported.name && !browserInfo.url.toLowerCase().includes(exported.name.toLowerCase().replace(/\s+/g, ""))
                ? `⚠️ The Figma frame name "${exported.name}" may not match the current browser page — verify you're on the right page before comparing.`
                : `✓ Ready to compare.`,
            ].join("\n"),
          },
        ],
      };
    },
  );

  server.tool(
    "set_browser_viewport",
    "Set the browser viewport size. Widths below Chrome's ~500px window minimum (or force_emulation) use CDP device emulation (Emulation.setDeviceMetricsOverride with touch) — a true mobile viewport, like DevTools device mode. Larger sizes resize the OS window. CDP emulation does not reliably survive cross-page navigation, but it is automatically re-applied after every browser_navigate/browser_back/browser_forward — no manual re-apply needed. For other overrides (color scheme, network throttling, geolocation, timezone, CPU throttling), use browser_emulate instead. Requires the Figma Overlay Chrome extension; no Figma plugin needed.",
    {
      width: z.number().int().min(1).describe("Viewport width in CSS px (e.g. 390 for iPhone-class mobile)."),
      height: z.number().int().min(1).describe("Viewport height in CSS px (e.g. 844)."),
      device_scale_factor: z
        .number()
        .min(1)
        .max(4)
        .optional()
        .describe("Device pixel ratio for emulated viewports (default 2). Ignored when the window is simply resized."),
      force_emulation: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Use CDP emulation even for widths ≥ 500px (e.g. to emulate a tablet with touch instead of resizing the window).",
        ),
      tab_id: tabIdSchema,
      browser_id: browserIdSchema,
    },
    async ({ width, height, device_scale_factor, force_emulation, tab_id, browser_id }) => {
      const result = await sendBrowserCommand<{
        emulated: boolean;
        windowWidth: number;
        windowHeight: number;
        tabId: number;
      }>("set_viewport", {
        browserId: browser_id,
        width,
        height,
        deviceScaleFactor: device_scale_factor,
        forceEmulation: force_emulation,
        tabId: tab_id,
      });
      return {
        content: [
          {
            type: "text",
            text: result.emulated
              ? `Viewport emulated at ${width}×${height} via CDP (tab ${result.tabId}). Touch enabled — automatically re-applied after navigation. Use reset_browser_viewport to restore.`
              : `Window resized to ${width}×${height} (tab ${result.tabId}).`,
          },
        ],
      };
    },
  );

  server.tool(
    "reset_browser_viewport",
    "Clear CDP viewport emulation set by set_browser_viewport (or by a narrow overlay) and detach the debugger from the tab.",
    {
      tab_id: tabIdSchema,
      browser_id: browserIdSchema,
    },
    async ({ tab_id, browser_id }) => {
      await sendBrowserCommand("reset_viewport", { browserId: browser_id, tabId: tab_id });
      return { content: [{ type: "text", text: "Viewport emulation cleared." }] };
    },
  );

  server.tool(
    "clear_browser_overlay",
    "Remove the Figma overlay from a browser tab. Targets the pinned/active tab by default, or pass tab_id to clear a specific tab.",
    {
      tab_id: tabIdSchema,
      browser_id: browserIdSchema,
    },
    async ({ tab_id, browser_id }) => {
      await sendBrowserCommand("clear_figma_overlay", { browserId: browser_id, tabId: tab_id });
      return { content: [{ type: "text", text: "Overlay cleared." }] };
    },
  );

  server.tool(
    "browser_emulate",
    "Apply one or more device/environment overrides to a browser tab in a single call: viewport, color scheme, reduced motion, network throttling, CPU throttling, geolocation, and timezone. All specified overrides are automatically re-applied after browser_navigate/browser_back/browser_forward. Distinct from set_browser_viewport, which only handles viewport and keeps working unchanged — use that for viewport-only needs, this for anything broader (e.g. diffing a Figma frame that targets a specific breakpoint AND dark mode AND a throttled connection in one shot). Use browser_clear_emulation to remove all overrides at once.",
    {
      viewport: z
        .object({
          width: z.number().int().min(1).describe("Viewport width in CSS px."),
          height: z.number().int().min(1).describe("Viewport height in CSS px."),
          device_scale_factor: z.number().min(1).max(4).optional().describe("Device pixel ratio (default 2)."),
        })
        .optional()
        .describe("Emulated viewport size and pixel ratio, via CDP device metrics override (touch enabled)."),
      color_scheme: z.enum(["light", "dark", "no-preference"]).optional().describe("Override prefers-color-scheme."),
      reduced_motion: z.boolean().optional().describe("Override prefers-reduced-motion (true = reduce)."),
      cpu_throttling_rate: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .describe("CPU slowdown multiplier (1 = no throttling, 4 = 4x slower, etc.)."),
      network_conditions: z
        .union([
          z.enum(["offline", "slow-3g", "fast-3g", "slow-4g", "fast-4g", "no-throttling"]),
          z.object({
            latency: z.number().min(0).describe("Round-trip latency in ms."),
            download_throughput: z.number().describe("Download speed in bytes/sec."),
            upload_throughput: z.number().describe("Upload speed in bytes/sec."),
          }),
        ])
        .optional()
        .describe(
          "Named network-throttling preset (approximate — mirrors Chrome DevTools' own published preset values, which shift between Chrome versions), or a custom {latency, download_throughput, upload_throughput} object for precise/reproducible testing.",
        ),
      geolocation: z
        .object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
          accuracy: z.number().min(0).optional().describe("Accuracy radius in meters (default 100)."),
        })
        .nullable()
        .optional()
        .describe("Override geolocation. Pass null to clear just this override."),
      timezone: z
        .string()
        .nullable()
        .optional()
        .describe("IANA timezone id (e.g. 'America/Los_Angeles'). Pass null to clear just this override."),
      tab_id: tabIdSchema,
      browser_id: browserIdSchema,
    },
    async ({
      viewport,
      color_scheme,
      reduced_motion,
      cpu_throttling_rate,
      network_conditions,
      geolocation,
      timezone,
      tab_id,
      browser_id,
    }) => {
      const result = await sendBrowserCommand("emulate", {
        browserId: browser_id,
        viewport: viewport
          ? { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.device_scale_factor }
          : undefined,
        colorScheme: color_scheme,
        reducedMotion: reduced_motion,
        cpuThrottlingRate: cpu_throttling_rate,
        networkConditions:
          network_conditions && typeof network_conditions === "object"
            ? {
                latency: network_conditions.latency,
                downloadThroughput: network_conditions.download_throughput,
                uploadThroughput: network_conditions.upload_throughput,
              }
            : network_conditions,
        geolocation,
        timezone,
        tabId: tab_id,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "browser_clear_emulation",
    "Clear every override applied by browser_emulate (viewport, color scheme, reduced motion, network throttling, CPU throttling, geolocation, timezone) in one call, and detach the debugger if nothing else needs the session.",
    { tab_id: tabIdSchema, browser_id: browserIdSchema },
    async ({ tab_id, browser_id }) => {
      await sendBrowserCommand("clear_emulation", { browserId: browser_id, tabId: tab_id });
      return { content: [{ type: "text", text: "All emulation overrides cleared." }] };
    },
  );
}
