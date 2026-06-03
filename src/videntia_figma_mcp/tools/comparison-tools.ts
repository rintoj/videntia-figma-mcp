import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket.js";
import { captureUrl } from "../utils/screenshot.js";
import { diffImages } from "../utils/pixel-diff.js";
import { startSandpackServer } from "../utils/sandpack-server.js";

export function registerComparisonTools(server: McpServer): void {
  server.tool(
    "compare_figma_to_component",
    "Compare a Figma node to an inline React component. Claude provides a file map (path → content); the tool serves it locally and diffs against the Figma node export. npm packages are resolved via esm.sh CDN.",
    {
      nodeId: z.string().describe("Figma node ID to compare (e.g. '2824:12737')"),
      files: z
        .record(z.string(), z.string())
        .describe("File map: { '/App.tsx': '<tsx content>', '/Button.tsx': '...' }"),
      entry: z.string().default("/App.tsx").describe("Entry file path from the file map (default: /App.tsx)"),
      selector: z.string().optional().describe("CSS selector to crop to the matching element"),
      tolerance: z.number().min(0).max(1).default(0.1).describe("Pixel diff tolerance 0–1 (default 0.1)"),
    },
    async ({ nodeId, files, entry, selector, tolerance }) => {
      const sandpack = await startSandpackServer(files, entry);
      try {
        const figmaExport = (await sendCommandToFigma("export_node_as_image", {
          nodeId,
          format: "PNG",
          scale: 1,
        })) as { imageData: string };

        const referenceBuffer = Buffer.from(figmaExport.imageData, "base64");
        await new Promise((r) => setTimeout(r, 1000));

        const capture = await captureUrl({ url: sandpack.url, selector });
        const diff = await diffImages(referenceBuffer, capture.screenshot, { tolerance });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  nodeId,
                  entry,
                  selector: capture.selector ?? null,
                  match: diff.deviationPercent === 0,
                  mismatchedPixels: diff.mismatchedPixels,
                  totalPixels: diff.totalPixels,
                  deviationPercent: diff.deviationPercent,
                },
                null,
                2,
              ),
            },
            {
              type: "image",
              data: diff.diffPng.toString("base64"),
              mimeType: "image/png",
            },
          ],
        };
      } finally {
        sandpack.stop();
      }
    },
  );
}
