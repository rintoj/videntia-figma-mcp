import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket.js";
import { captureUrl } from "../utils/screenshot.js";
import { diffImages } from "../utils/pixel-diff.js";
import { compareStyles, figmaNodeToStyles, COMPARABLE_STYLE_PROPERTIES } from "../utils/style-compare.js";
import { startSandpackServer } from "../utils/sandpack-server.js";
import { chromium } from "playwright";

export function registerComparisonTools(server: McpServer): void {
  server.tool(
    "compare_figma_to_web",
    "Compare a Figma node to a live URL. Exports the node as PNG, screenshots the URL (cropping to a CSS selector or data-figma-id attribute if provided), and returns a pixel diff report with style deviations.",
    {
      nodeId: z.string().describe("Figma node ID to compare (e.g. '2824:12737')"),
      url: z.string().describe("Target URL (any http/https URL, local dev server, staging, prod)"),
      selector: z.string().optional().describe("CSS selector to crop the page to the matching element"),
      tolerance: z.number().min(0).max(1).default(0.1).describe("Pixel diff tolerance 0–1 (default 0.1)"),
      mode: z.enum(["screenshot", "styles", "both"]).default("both").describe("Comparison mode"),
    },
    async ({ nodeId, url, selector, tolerance, mode }) => {
      const figmaExport = await sendCommandToFigma("export_node_as_image", {
        nodeId,
        format: "PNG",
        scale: 1,
      }) as { imageData: string };

      const referenceBuffer = Buffer.from(figmaExport.imageData, "base64");
      const capture = await captureUrl({ url, selector, figmaId: nodeId, referenceBuffer });

      const result: Record<string, unknown> = {
        nodeId,
        url,
        selector: capture.selector ?? null,
        matchRegion: capture.region ?? null,
        matchConfidence: capture.matchConfidence ?? null,
        locateStrategy: capture.selector
          ? "selector"
          : capture.matchConfidence !== undefined
          ? "template-match"
          : "full-viewport",
      };

      if (mode === "screenshot" || mode === "both") {
        const diff = await diffImages(referenceBuffer, capture.screenshot, { tolerance });
        result.mismatchedPixels = diff.mismatchedPixels;
        result.totalPixels = diff.totalPixels;
        result.deviationPercent = diff.deviationPercent;
        result.diffImagePath = diff.diffImagePath;
        result.match = diff.deviationPercent === 0;
      }

      if (mode === "styles" || mode === "both") {
        const nodeData = await sendCommandToFigma("get_node_info", { nodeId }) as Record<string, unknown>;
        const figmaStyles = figmaNodeToStyles(nodeData);

        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage();
          await page.goto(url, { waitUntil: "networkidle" });
          const targetSelector = capture.selector ?? "body";
          const computedStyles = await page.evaluate((sel: string, props: string[]) => {
            const el = document.querySelector(sel);
            if (!el) return {};
            const cs = window.getComputedStyle(el);
            return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p.replace(/([A-Z])/g, "-$1").toLowerCase())]));
          }, targetSelector, [...COMPARABLE_STYLE_PROPERTIES]);
          result.styleDeviations = compareStyles(figmaStyles, computedStyles as Record<string, string>);
        } finally {
          await browser.close();
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "compare_figma_to_component",
    "Compare a Figma node to an inline React component. Claude provides a file map (path → content); the tool serves it locally and diffs against the Figma node export. npm packages are resolved via esm.sh CDN.",
    {
      nodeId: z.string().describe("Figma node ID to compare (e.g. '2824:12737')"),
      files: z.record(z.string(), z.string()).describe("File map: { '/App.tsx': '<tsx content>', '/Button.tsx': '...' }"),
      entry: z.string().default("/App.tsx").describe("Entry file path from the file map (default: /App.tsx)"),
      selector: z.string().optional().describe("CSS selector to crop to the matching element"),
      tolerance: z.number().min(0).max(1).default(0.1).describe("Pixel diff tolerance 0–1 (default 0.1)"),
    },
    async ({ nodeId, files, entry, selector, tolerance }) => {
      const sandpack = await startSandpackServer(files, entry);
      try {
        const figmaExport = await sendCommandToFigma("export_node_as_image", {
          nodeId,
          format: "PNG",
          scale: 1,
        }) as { imageData: string };

        const referenceBuffer = Buffer.from(figmaExport.imageData, "base64");
        await new Promise((r) => setTimeout(r, 1000));

        const capture = await captureUrl({ url: sandpack.url, selector });
        const diff = await diffImages(referenceBuffer, capture.screenshot, { tolerance });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              nodeId,
              entry,
              selector: capture.selector ?? null,
              match: diff.deviationPercent === 0,
              mismatchedPixels: diff.mismatchedPixels,
              totalPixels: diff.totalPixels,
              deviationPercent: diff.deviationPercent,
              diffImagePath: diff.diffImagePath,
            }, null, 2),
          }],
        };
      } finally {
        sandpack.stop();
      }
    }
  );
}
