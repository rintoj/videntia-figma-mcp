import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToChannel, sendCommandToFigma } from "../utils/websocket.js";
import { captureUrl } from "../utils/screenshot.js";
import { diffImages } from "../utils/pixel-diff.js";
import { startSandpackServer } from "../utils/sandpack-server.js";
import { buildRows, FigmaNodeLike } from "../utils/figma-to-css-rows.js";

const BROWSER_CHANNEL = "browser";

function unwrapNode(raw: unknown, nodeId: string): FigmaNodeLike | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id === "string") return obj as FigmaNodeLike;
  // get_node_info returns { nodes: [...] } or a map.
  if (Array.isArray((obj as any).nodes)) {
    const arr = (obj as any).nodes as FigmaNodeLike[];
    return arr.find((n) => n?.id === nodeId) ?? arr[0] ?? null;
  }
  if ((obj as any)[nodeId] && typeof (obj as any)[nodeId] === "object") {
    return (obj as any)[nodeId] as FigmaNodeLike;
  }
  // Single-node shape under `node`.
  if ((obj as any).node && typeof (obj as any).node === "object") {
    return (obj as any).node as FigmaNodeLike;
  }
  return null;
}

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

  server.tool(
    "diff_figma_to_browser",
    "Diff a Figma node's visual properties against the computed CSS of a DOM element in the active browser tab. Returns a per-property row with ✓ / ❌ / — status. Requires the Figma plugin and Chrome extension to be connected.",
    {
      figma_node_id: z
        .string()
        .describe(
          "Figma node ID (e.g. '123:456'). If a container, its first TEXT descendant supplies text-style properties.",
        ),
      css_selector: z
        .string()
        .describe(
          "CSS selector identifying the DOM element to compare against (e.g. '.pricing-card__title'). Should match a single element.",
        ),
      properties: z
        .array(z.string())
        .optional()
        .describe(
          "CSS properties to diff. Defaults to a 14-property MVP set covering typography, color, border, layout, and effects.",
        ),
      tolerance_overrides: z
        .record(z.string(), z.number())
        .optional()
        .describe("Per-property numeric tolerance overrides (e.g. { 'line-height': 1 })."),
    },
    async ({ figma_node_id, css_selector, properties, tolerance_overrides }) => {
      const warnings: string[] = [];

      const nodeInfoRaw = await sendCommandToFigma("get_node_info", { nodeIds: [figma_node_id], depth: 2 });
      const figmaNode = unwrapNode(nodeInfoRaw, figma_node_id);
      if (!figmaNode) {
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: `No Figma node found for id ${figma_node_id}` }, null, 2) },
          ],
        };
      }

      const computedRaw = (await sendCommandToChannel(BROWSER_CHANNEL, "get_computed_styles", {
        selector: css_selector,
        properties,
      })) as Record<string, unknown>;

      // Browser may return either { styles: {...} } or { selector, count, styles }.
      let computedStyles: Record<string, string> = {};
      let count: number | undefined;
      if (computedRaw && typeof computedRaw === "object") {
        const s = (computedRaw as any).styles;
        if (s && typeof s === "object") computedStyles = s as Record<string, string>;
        else computedStyles = computedRaw as Record<string, string>;
        if (typeof (computedRaw as any).count === "number") count = (computedRaw as any).count;
      }
      if (count !== undefined && count > 1) {
        warnings.push(`selector matched ${count} elements — diffing first`);
      }

      let rect: { width?: number; height?: number } | undefined;
      try {
        const domRaw = (await sendCommandToChannel(BROWSER_CHANNEL, "get_dom_nodes", {
          selector: css_selector,
          depth: 1,
          includeText: false,
          includeAttributes: false,
        })) as any;
        const first = Array.isArray(domRaw?.nodes) ? domRaw.nodes[0] : (domRaw?.node ?? domRaw);
        const r = first?.rect ?? first?.boundingRect ?? first?.boundingClientRect;
        if (r && typeof r.width === "number" && typeof r.height === "number") {
          rect = { width: r.width, height: r.height };
        }
      } catch (err) {
        warnings.push(`could not read bounding rect: ${err instanceof Error ? err.message : String(err)}`);
      }

      const {
        rows,
        warnings: rowWarnings,
        textNodeId,
      } = buildRows(figmaNode, computedStyles, rect, {
        properties,
        toleranceOverrides: tolerance_overrides,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                selector: css_selector,
                nodeId: figma_node_id,
                matchedVia: "explicit",
                textNodeId,
                rows,
                warnings: [...warnings, ...rowWarnings],
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
