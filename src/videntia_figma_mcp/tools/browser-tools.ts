import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendCommandToChannel, sendCommandToFigma } from "../utils/websocket.js";

const BROWSER_CHANNEL = "browser";

const tabIdSchema = z
  .number()
  .int()
  .optional()
  .describe(
    "Optional Chrome tab ID to target. When omitted, the extension uses its pinned tab (set via the popup) or falls back to the active tab in the focused window. Use get_browser_page_info to discover tab IDs.",
  );

export function registerBrowserTools(server: McpServer): void {
  server.tool(
    "get_browser_page_info",
    "Get the URL, title, and tab ID of the target browser tab. Returns the active tab by default; pass tab_id to target a specific tab. Requires the Figma Overlay Chrome extension to be installed and connected.",
    {
      tab_id: tabIdSchema,
    },
    async ({ tab_id }) => {
      const result = await sendCommandToChannel<{ url: string; title: string; tabId: number }>(
        BROWSER_CHANNEL,
        "get_page_info",
        { tabId: tab_id },
      );
      return {
        content: [{ type: "text", text: `URL: ${result.url}\nTitle: ${result.title}\nTab ID: ${result.tabId}` }],
      };
    },
  );

  server.tool(
    "get_browser_page_screenshot",
    "Take a screenshot of the visible area of a browser tab. Targets the pinned/active tab by default, or pass tab_id to screenshot a specific (even non-focused) tab. Returns a PNG image. Requires the Figma Overlay Chrome extension.",
    {
      tab_id: tabIdSchema,
    },
    async ({ tab_id }) => {
      const result = await sendCommandToChannel<{ imageData: string; mimeType: string }>(
        BROWSER_CHANNEL,
        "get_page_screenshot",
        { tabId: tab_id },
      );
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
    },
    async ({ selector, depth, include_text, include_attributes, tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "get_dom_nodes", {
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
    },
    async ({ selector, properties, tab_id }) => {
      const result = await sendCommandToChannel(BROWSER_CHANNEL, "get_computed_styles", {
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
    },
    async ({ opacity, scale, cropTop, cropBottom, offsetX, offsetY, blendMode, tab_id }) => {
      const exported = await sendCommandToFigma<{
        imageData: string;
        mimeType: string;
        originalWidth: number;
        originalHeight: number;
        name?: string;
      }>("export_selection_as_image", { scale });

      await sendCommandToChannel(BROWSER_CHANNEL, "inject_figma_overlay", {
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

      const browserInfo = await sendCommandToChannel<{ url: string; title: string; tabId: number }>(
        BROWSER_CHANNEL,
        "get_page_info",
        { tabId: tab_id },
      );

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
    "clear_browser_overlay",
    "Remove the Figma overlay from a browser tab. Targets the pinned/active tab by default, or pass tab_id to clear a specific tab.",
    {
      tab_id: tabIdSchema,
    },
    async ({ tab_id }) => {
      await sendCommandToChannel(BROWSER_CHANNEL, "clear_figma_overlay", { tabId: tab_id });
      return { content: [{ type: "text", text: "Overlay cleared." }] };
    },
  );
}
