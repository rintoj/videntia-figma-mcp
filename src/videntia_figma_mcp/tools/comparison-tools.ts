import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToChannel, sendCommandToFigma } from "../utils/websocket.js";
import { captureUrl } from "../utils/screenshot.js";
import { diffImages } from "../utils/pixel-diff.js";
import { startSandpackServer } from "../utils/sandpack-server.js";
import { buildRows, FigmaNodeLike } from "../utils/figma-to-css-rows.js";
import { findNodeInPage } from "../utils/find-node-in-page.js";
import { auditFrame, DomRect } from "../utils/frame-audit.js";

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
        .optional()
        .describe(
          "CSS selector identifying the DOM element to compare against (e.g. '.pricing-card__title'). If omitted, the element is auto-located by exporting the Figma node as an image and template-matching it against a page screenshot.",
        ),
      min_confidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .default(0.7)
        .describe(
          "When auto-locating, surface a low-confidence warning if the image-template match score falls below this threshold (default 0.7).",
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
    async ({ figma_node_id, css_selector, properties, tolerance_overrides, min_confidence }) => {
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

      let resolvedSelector = css_selector;
      let matchedVia: "explicit" | "image-template" = "explicit";
      let matchRegion: { x: number; y: number; w: number; h: number; confidence: number } | undefined;

      if (!resolvedSelector) {
        matchedVia = "image-template";
        try {
          const figmaExport = (await sendCommandToFigma("export_node_as_image", {
            nodeId: figma_node_id,
            format: "PNG",
            scale: 1,
          })) as { imageData: string };
          const referenceBuffer = Buffer.from(figmaExport.imageData, "base64");

          const pageShot = (await sendCommandToChannel(BROWSER_CHANNEL, "get_page_screenshot", {})) as {
            imageData: string;
          };
          const pageBuffer = Buffer.from(pageShot.imageData, "base64");

          const match = await findNodeInPage(referenceBuffer, pageBuffer);
          if (!match) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error:
                        "Could not locate the Figma node in the current browser viewport. Pass css_selector explicitly.",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          matchRegion = {
            x: match.x,
            y: match.y,
            w: match.width,
            h: match.height,
            confidence: match.confidence,
          };
          if (match.confidence < (min_confidence ?? 0.7)) {
            warnings.push(`image-template confidence ${match.confidence} below threshold ${min_confidence ?? 0.7}`);
          }

          const cx = match.x + match.width / 2;
          const cy = match.y + match.height / 2;
          const resolved = (await sendCommandToChannel(BROWSER_CHANNEL, "resolve_selector_at_point", {
            x: cx,
            y: cy,
            imagePixels: true,
          })) as { selector: string | null; tag?: string };
          if (!resolved?.selector) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error: "Found the node in the screenshot but no DOM element resolved at its center.",
                      matchRegion,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }
          resolvedSelector = resolved.selector;
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { error: `Auto-locate failed: ${err instanceof Error ? err.message : String(err)}` },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      }

      const finalSelector = resolvedSelector as string;
      const computedRaw = (await sendCommandToChannel(BROWSER_CHANNEL, "get_computed_styles", {
        selector: finalSelector,
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
          selector: finalSelector,
          depth: 1,
          includeText: false,
          includeAttributes: false,
        })) as { nodes?: Array<Record<string, unknown>>; node?: Record<string, unknown> } & Record<string, unknown>;
        const first = (Array.isArray(domRaw?.nodes) ? domRaw.nodes[0] : (domRaw?.node ?? domRaw)) as
          | Record<string, unknown>
          | undefined;
        const r = (first?.rect ?? first?.boundingRect ?? first?.boundingClientRect) as
          | { width?: number; height?: number }
          | undefined;
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
                selector: finalSelector,
                nodeId: figma_node_id,
                matchedVia,
                matchRegion,
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

  server.tool(
    "diff_figma_frame_to_page",
    "Audit an entire Figma frame against the live DOM in the active browser tab. Matches every Figma descendant to a DOM element using hierarchical Hungarian assignment over bounding boxes, then returns matched pairs and unmatched buckets. Requires the Figma plugin and Chrome extension to be connected.",
    {
      frame_node_id: z.string().describe("Figma frame node ID to audit (e.g. '123:456')."),
      root_selector: z
        .string()
        .optional()
        .describe(
          "CSS selector for the DOM root (defaults to auto-locate via image template, then 'body' as fallback).",
        ),
      max_cost: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .default(0.15)
        .describe("Skip matches whose normalized cost (center+size, scaled by frame diag) exceeds this. Default 0.15."),
      min_iou: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .default(0.05)
        .describe("Skip matches whose IoU is below this. Default 0.05."),
      max_nodes: z
        .number()
        .int()
        .min(50)
        .max(5000)
        .optional()
        .default(1500)
        .describe("Cap on DOM nodes collected from the page (default 1500)."),
      crop_top: z
        .number()
        .min(0)
        .optional()
        .default(0)
        .describe(
          "Pixels to strip from the top of the Figma frame before matching (design-space px). Use to skip iOS status bar / browser address bar baked into mobile frames.",
        ),
      crop_bottom: z
        .number()
        .min(0)
        .optional()
        .default(0)
        .describe("Pixels to strip from the bottom of the Figma frame before matching."),
      include_zero_rect: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include hidden / zero-size DOM nodes in the matching pool. Default false."),
    },
    async ({
      frame_node_id,
      root_selector,
      max_cost,
      min_iou,
      max_nodes,
      crop_top,
      crop_bottom,
      include_zero_rect,
    }) => {
      const warnings: string[] = [];
      const nodeInfoRaw = await sendCommandToFigma("get_node_info", { nodeIds: [frame_node_id], depth: 20 });
      const frameNode = unwrapNode(nodeInfoRaw, frame_node_id);
      if (!frameNode) {
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: `No Figma node found for id ${frame_node_id}` }, null, 2) },
          ],
        };
      }

      let rootSelectorResolved = root_selector;
      let matchedVia: "explicit" | "image-template" | "fallback-body" = "explicit";
      if (!rootSelectorResolved) {
        try {
          const figmaExport = (await sendCommandToFigma("export_node_as_image", {
            nodeId: frame_node_id,
            format: "PNG",
            scale: 1,
          })) as { imageData: string };
          const refBuf = Buffer.from(figmaExport.imageData, "base64");
          const shot = (await sendCommandToChannel(BROWSER_CHANNEL, "get_page_screenshot", {})) as {
            imageData: string;
          };
          const pageBuf = Buffer.from(shot.imageData, "base64");
          const match = await findNodeInPage(refBuf, pageBuf);
          if (match) {
            const cx = match.x + match.width / 2;
            const cy = match.y + match.height / 2;
            const resolved = (await sendCommandToChannel(BROWSER_CHANNEL, "resolve_selector_at_point", {
              x: cx,
              y: cy,
              imagePixels: true,
            })) as { selector: string | null };
            if (resolved?.selector) {
              rootSelectorResolved = resolved.selector;
              matchedVia = "image-template";
            }
          }
        } catch (err) {
          warnings.push(`auto-locate failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!rootSelectorResolved) {
          rootSelectorResolved = "body";
          matchedVia = "fallback-body";
          warnings.push("could not auto-locate frame root — falling back to 'body'");
        }
      }

      const collected = (await sendCommandToChannel(BROWSER_CHANNEL, "collect_all_element_rects", {
        root: rootSelectorResolved,
        maxNodes: max_nodes,
        includeZeroRect: include_zero_rect,
      })) as { nodes?: DomRect[]; truncated?: boolean; error?: string };

      if (collected.error || !collected.nodes) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: collected.error ?? "no DOM nodes returned", warnings }, null, 2),
            },
          ],
        };
      }
      if (collected.truncated) warnings.push(`DOM walk truncated at ${max_nodes} nodes`);

      const audit = auditFrame(frameNode, 0, collected.nodes, {
        maxCost: max_cost,
        minIou: min_iou,
        cropTop: crop_top,
        cropBottom: crop_bottom,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                frameNodeId: frame_node_id,
                rootSelector: rootSelectorResolved,
                matchedVia,
                summary: {
                  matched: audit.matched.length,
                  unmatchedFigma: audit.unmatchedFigma.length,
                  unmatchedDom: audit.unmatchedDom.length,
                  domNodes: collected.nodes.length,
                },
                matched: audit.matched,
                unmatchedFigma: audit.unmatchedFigma.map((f) => ({
                  id: f.id,
                  name: f.name,
                  type: f.type,
                  rect: f.rect,
                })),
                unmatchedDom: audit.unmatchedDom.slice(0, 50).map((d) => ({
                  selector: d.selector,
                  tag: d.tag,
                  rect: d.rect,
                })),
                warnings,
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
