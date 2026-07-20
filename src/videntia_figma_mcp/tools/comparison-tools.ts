import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToChannel, sendCommandToFigma } from "../utils/websocket.js";
import { captureUrl } from "../utils/screenshot.js";
import { diffImages } from "../utils/pixel-diff.js";
import { startSandpackServer } from "../utils/sandpack-server.js";
import { buildRows, FigmaNodeLike, findFirstTextNode } from "../utils/figma-to-css-rows.js";
import { findNodeInPage } from "../utils/find-node-in-page.js";
import { auditFrame, DomRect, iou, MatchPair } from "../utils/frame-audit.js";
import { COLOR_DELTA_E_THRESHOLD, CompareRow } from "../utils/normalize-style.js";
import { deltaE76 } from "../utils/color-calculations.js";
import { suggestFix } from "../utils/fix-hints.js";

const BROWSER_CHANNEL = "browser";

// Index every node in a Figma tree by id for O(1) pair lookup.
function indexFigmaTree(root: FigmaNodeLike): Map<string, FigmaNodeLike> {
  const map = new Map<string, FigmaNodeLike>();
  const stack: FigmaNodeLike[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id) map.set(n.id, n);
    if (n.children?.length) stack.push(...n.children);
  }
  return map;
}

interface StyleMismatchRow {
  property: string;
  figma: string;
  browser: string;
  severity: "error" | "warn";
  note?: string;
  // Heuristic code-fix suggestion (Tailwind class swap when grounded in the element's classes).
  hint?: string;
}

interface NodeStyleMismatch {
  figmaId: string;
  figmaName?: string;
  figmaType?: string;
  selector: string | null;
  stale?: boolean;
  rows: StyleMismatchRow[];
}

const MAX_MISMATCH_NODES = 50;
const MAX_MISMATCH_ROWS = 200;

const COLOR_ROW_PROPERTIES = new Set(["color", "background-color", "border-color"]);
const SIX_DIGIT_HEX = /^#[0-9a-f]{6}$/;

// hex → variable-name index over the file's local COLOR variables (all modes).
function buildColorTokenIndex(variablesRaw: unknown): Map<string, string> {
  const index = new Map<string, string>();
  const vars = (variablesRaw as { variables?: Array<Record<string, any>> })?.variables;
  if (!Array.isArray(vars)) return index;
  for (const v of vars) {
    if (v?.type !== "COLOR" || !v.name || !Array.isArray(v.values)) continue;
    for (const entry of v.values) {
      const c = entry?.value;
      if (!c || typeof c.r !== "number") continue;
      const toHex2 = (n: number) =>
        Math.round(Math.max(0, Math.min(1, n)) * 255)
          .toString(16)
          .padStart(2, "0");
      const hexValue = `#${toHex2(c.r)}${toHex2(c.g)}${toHex2(c.b)}`;
      if (!index.has(hexValue)) index.set(hexValue, v.name);
    }
  }
  return index;
}

// Cap on styled-text-segment lookups per frame diff (2-3 round trips each).
const MAX_MIXED_TEXT_NODES = 10;

interface SegmentLike {
  characters?: string;
  start?: number;
  end?: number;
  [key: string]: unknown;
}

// Dominant value by character count across styled segments, plus a distribution
// note when more than one value is present ("mixed: 32px (78%), 48px (22%)").
function dominantSegmentValue<T>(
  segments: SegmentLike[],
  read: (s: SegmentLike) => T | undefined,
  format: (v: T) => string,
): { value: T; note?: string } | null {
  const counts = new Map<string, { value: T; chars: number }>();
  let total = 0;
  for (const s of segments) {
    const v = read(s);
    if (v === undefined) continue;
    const len = Math.max((s.end ?? 0) - (s.start ?? 0), s.characters?.length ?? 0);
    if (len <= 0) continue;
    const key = JSON.stringify(v);
    const entry = counts.get(key) ?? { value: v, chars: 0 };
    entry.chars += len;
    counts.set(key, entry);
    total += len;
  }
  if (counts.size === 0) return null;
  const sorted = [...counts.values()].sort((a, b) => b.chars - a.chars);
  const note =
    sorted.length > 1 && total > 0
      ? `mixed: ${sorted.map((e) => `${format(e.value)} (${Math.round((e.chars / total) * 100)}%)`).join(", ")}`
      : undefined;
  return { value: sorted[0].value, ...(note ? { note } : {}) };
}

// Fill in fontSize/fontFamily/fontWeight on a TEXT node whose values were omitted by
// the serializer because the node has mixed styling. Mutates the node; returns notes.
async function resolveMixedTextStyles(textNode: FigmaNodeLike): Promise<string[]> {
  const notes: string[] = [];
  if (!textNode.id) return notes;

  const fetchSegments = async (property: string): Promise<SegmentLike[] | null> => {
    const raw = (await sendCommandToFigma("get_styled_text_segments", {
      nodeId: textNode.id,
      property,
    })) as { segments?: SegmentLike[] };
    return Array.isArray(raw?.segments) && raw.segments.length > 0 ? raw.segments : null;
  };

  try {
    if (textNode.fontSize === undefined) {
      const segments = await fetchSegments("fontSize");
      const dominant = segments
        ? dominantSegmentValue(
            segments,
            (s) => (typeof s.fontSize === "number" ? (s.fontSize as number) : undefined),
            (v) => `${v}px`,
          )
        : null;
      if (dominant) {
        textNode.fontSize = dominant.value;
        if (dominant.note) notes.push(`font-size ${dominant.note}`);
      }
    }
    if (textNode.fontFamily === undefined) {
      const segments = await fetchSegments("fontName");
      const dominant = segments
        ? dominantSegmentValue(
            segments,
            (s) => (s.fontName as { family?: string } | undefined)?.family,
            (v) => v,
          )
        : null;
      if (dominant) {
        textNode.fontFamily = dominant.value;
        if (dominant.note) notes.push(`font-family ${dominant.note}`);
      }
    }
    if (textNode.fontWeight === undefined) {
      const segments = await fetchSegments("fontWeight");
      const dominant = segments
        ? dominantSegmentValue(
            segments,
            (s) => (typeof s.fontWeight === "number" ? (s.fontWeight as number) : undefined),
            (v) => `${v}`,
          )
        : null;
      if (dominant) {
        textNode.fontWeight = dominant.value;
        if (dominant.note) notes.push(`font-weight ${dominant.note}`);
      }
    }
  } catch {
    // Segment lookup is best-effort — a failure just leaves the "—" rows in place.
  }
  return notes;
}

// A TEXT node with characters but no fontSize signals mixed styling collapsed by the
// serializer (figma.mixed values are omitted).
function isMixedTextNode(node: FigmaNodeLike | null): node is FigmaNodeLike {
  return !!node && node.type === "TEXT" && node.fontSize === undefined && !!node.characters;
}

// Attach "mixed: …" distribution notes ("font-size mixed: 32px (78%), 48px (22%)")
// to their corresponding compare rows.
function attachMixedNotes(rows: CompareRow[], notes: string[]): void {
  for (const note of notes) {
    const space = note.indexOf(" ");
    if (space === -1) continue;
    const prop = note.slice(0, space);
    const detail = note.slice(space + 1);
    const row = rows.find((r) => r.property === prop);
    if (row) row.note = row.note ? `${row.note}; ${detail}` : detail;
  }
}

// Nearest variable within the ΔE threshold, exact match first.
function nearestToken(hexValue: string, index: Map<string, string>): string | null {
  const exact = index.get(hexValue);
  if (exact) return exact;
  let bestName: string | null = null;
  let bestDelta = COLOR_DELTA_E_THRESHOLD;
  for (const [tokenHex, name] of index) {
    const d = deltaE76(hexValue, tokenHex);
    if (d <= bestDelta) {
      bestDelta = d;
      bestName = name;
    }
  }
  return bestName;
}

// Reduce buildRows output to mismatches only (❌ rows and explicit warns).
function toMismatchRows(rows: CompareRow[], className?: string): StyleMismatchRow[] {
  return rows
    .filter((r) => r.status === "❌" || r.severity === "warn")
    .map((r) => {
      const hint = suggestFix(r, { className });
      return {
        property: r.property,
        figma: r.figma,
        browser: r.browser,
        severity: r.severity ?? "error",
        ...(r.note ? { note: r.note } : {}),
        ...(hint ? { hint } : {}),
      };
    });
}

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

      // Serializer omits fontSize/fontFamily/fontWeight when a TEXT node has mixed
      // styling — recover the dominant values from styled segments.
      let mixedNotes: string[] = [];
      const mixedTarget = findFirstTextNode(figmaNode);
      if (isMixedTextNode(mixedTarget)) {
        mixedNotes = await resolveMixedTextStyles(mixedTarget);
      }

      let resolvedSelector = css_selector;
      let matchedVia: "explicit" | "fig-id" | "image-template" = "explicit";
      let matchRegion: { x: number; y: number; w: number; h: number; confidence: number } | undefined;

      // Deterministic path: an app annotated with data-fig-id resolves without CV.
      if (!resolvedSelector) {
        const figIdSelector = `[data-fig-id="${figma_node_id}"]`;
        try {
          const probe = (await sendCommandToChannel(BROWSER_CHANNEL, "get_computed_styles_batch", {
            selectors: [figIdSelector],
            properties: ["display"],
          })) as { results?: Array<{ found: boolean }> };
          if (probe?.results?.[0]?.found) {
            resolvedSelector = figIdSelector;
            matchedVia = "fig-id";
          }
        } catch {
          // Extension without batch support — fall through to image-template matching.
        }
      }

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

      // Preferred path: one batched call returns styles, rect, parent layout styles,
      // and class in a single round trip.
      let computedStyles: Record<string, string> = {};
      let parentStyles: Record<string, string> | undefined;
      let className: string | undefined;
      let rect: { width?: number; height?: number } | undefined;
      let batchSucceeded = false;

      try {
        const batchRaw = (await sendCommandToChannel(BROWSER_CHANNEL, "get_computed_styles_batch", {
          selectors: [finalSelector],
          ...(properties ? { properties } : {}),
          includeParent: true,
          includeClass: true,
        })) as {
          results?: Array<{
            selector: string;
            found: boolean;
            rect?: { width: number; height: number };
            styles?: Record<string, string>;
            parentStyles?: Record<string, string>;
            className?: string;
          }>;
          error?: string;
        };
        const entry = batchRaw?.results?.[0];
        if (entry?.found && entry.styles) {
          computedStyles = entry.styles;
          parentStyles = entry.parentStyles;
          className = entry.className;
          if (entry.rect && typeof entry.rect.width === "number") {
            rect = { width: entry.rect.width, height: entry.rect.height };
          }
          batchSucceeded = true;
        }
      } catch {
        // Older extension without the batch command — fall through to legacy path.
      }

      if (!batchSucceeded) {
        const computedRaw = (await sendCommandToChannel(BROWSER_CHANNEL, "get_computed_styles", {
          selector: finalSelector,
          properties,
        })) as Record<string, unknown>;

        // Browser may return either { styles: {...} } or { selector, count, styles }.
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
      }

      const {
        rows,
        warnings: rowWarnings,
        textNodeId,
      } = buildRows(figmaNode, computedStyles, rect, {
        properties,
        toleranceOverrides: tolerance_overrides,
        layout: true,
        parentStyles,
        className,
      });
      attachMixedNotes(rows, mixedNotes);

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
      include_style_diff: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "After matching, fetch computed styles for matched pairs in one batch and return per-node style mismatch rows (mismatches only).",
        ),
      max_style_nodes: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .default(100)
        .describe("Cap on matched pairs to style-diff (default 100). Larger/shallower nodes are prioritized."),
      properties: z
        .array(z.string())
        .optional()
        .describe("CSS properties to diff per pair (defaults to the standard property set)."),
      annotation_map: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Emit an annotationMap: ready-to-apply data-fig-id suggestions for geometry-matched pairs (figmaId → selector/tag/confidence) plus unmatched Figma nodes that need manual mapping.",
        ),
      include_token_suggestions: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "For mismatching color rows, look up the nearest Figma color variable to the browser value and annotate the row (e.g. 'browser ≈ neutral-300'). Adds one variables fetch.",
        ),
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
      include_style_diff,
      max_style_nodes,
      properties,
      annotation_map,
      include_token_suggestions,
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

      // Optional second stage: one batched computed-styles fetch, then a per-pair
      // property diff. Output contains mismatch rows only.
      let styleDiff:
        | {
            summary: {
              pairs: number;
              pairsWithStyleData: number;
              nodesWithMismatches: number;
              totalMismatchRows: number;
              truncated: boolean;
            };
            mismatches: NodeStyleMismatch[];
          }
        | undefined;

      if (include_style_diff && audit.matched.length > 0) {
        const domByIdx = new Map(collected.nodes.map((d) => [d.idx, d]));
        const pairArea = (p: MatchPair) => {
          const r = domByIdx.get(p.domIdx)?.rect;
          return r ? r.w * r.h : 0;
        };
        const pairDepth = (p: MatchPair) => domByIdx.get(p.domIdx)?.depth ?? 99;

        // The root pair is implicit in the audit (pre-matched, never emitted) but its
        // own layout properties matter — include it explicitly.
        const rootDom = collected.nodes[0];
        const rootPair: MatchPair | null =
          frameNode.id && rootDom
            ? {
                figmaId: frameNode.id,
                figmaName: frameNode.name,
                figmaType: frameNode.type,
                selector: rootDom.selector ?? rootSelectorResolved ?? null,
                domIdx: rootDom.idx,
                tag: rootDom.tag,
                cost: 0,
                iou: 1,
              }
            : null;

        // Prioritize shallower, larger nodes — they carry the layout structure.
        const withSelector = audit.matched.filter((p) => p.selector);
        const capped = [
          ...(rootPair?.selector ? [rootPair] : []),
          ...[...withSelector].sort((a, b) => pairDepth(a) - pairDepth(b) || pairArea(b) - pairArea(a)),
        ].slice(0, max_style_nodes);
        if (withSelector.length < audit.matched.length) {
          warnings.push(`${audit.matched.length - withSelector.length} matched pairs skipped (no selector)`);
        }

        const batch = (await sendCommandToChannel(BROWSER_CHANNEL, "get_computed_styles_batch", {
          selectors: capped.map((p) => p.selector),
          ...(properties ? { properties } : {}),
          includeParent: true,
          includeClass: true,
        })) as {
          dpr?: number;
          truncated?: boolean;
          results?: Array<{
            selector: string;
            found: boolean;
            rect?: { x: number; y: number; width: number; height: number };
            styles?: Record<string, string>;
            parentStyles?: Record<string, string>;
            className?: string;
          }>;
          error?: string;
        };

        if (batch.error || !batch.results) {
          warnings.push(`style diff skipped: ${batch.error ?? "no batch results"}`);
        } else {
          const resultBySelector = new Map(batch.results.map((r) => [r.selector, r]));
          const nodeById = indexFigmaTree(frameNode);
          const mismatches: NodeStyleMismatch[] = [];
          let pairsWithStyleData = 0;
          let totalRows = 0;
          let truncatedOutput = batch.truncated === true;

          let mixedTextBudget = MAX_MIXED_TEXT_NODES;

          for (const pair of capped) {
            const res = resultBySelector.get(pair.selector as string);
            const figmaNode = nodeById.get(pair.figmaId);
            if (!res?.found || !res.styles || !figmaNode) continue;
            pairsWithStyleData++;

            // Recover dominant styles for mixed-styling TEXT nodes (bounded round trips).
            let mixedNotes: string[] = [];
            const mixedText = findFirstTextNode(figmaNode);
            if (isMixedTextNode(mixedText) && mixedTextBudget > 0) {
              mixedTextBudget--;
              mixedNotes = await resolveMixedTextStyles(mixedText);
            }

            // Selector staleness: the DOM may have changed between rect collection
            // and the batch fetch — flag pairs whose element moved substantially.
            const auditRect = domByIdx.get(pair.domIdx)?.rect;
            const freshRect = res.rect ? { x: res.rect.x, y: res.rect.y, w: res.rect.width, h: res.rect.height } : null;
            const stale = auditRect && freshRect ? iou(auditRect, freshRect) < 0.5 : false;

            const { rows } = buildRows(
              figmaNode,
              res.styles,
              res.rect ? { width: res.rect.width, height: res.rect.height } : undefined,
              { properties, layout: true, parentStyles: res.parentStyles, className: res.className },
            );
            attachMixedNotes(rows, mixedNotes);
            const mismatchRows = toMismatchRows(rows, res.className);
            if (mismatchRows.length === 0) continue;

            if (mismatches.length >= MAX_MISMATCH_NODES || totalRows + mismatchRows.length > MAX_MISMATCH_ROWS) {
              truncatedOutput = true;
              break;
            }
            totalRows += mismatchRows.length;
            mismatches.push({
              figmaId: pair.figmaId,
              figmaName: pair.figmaName,
              figmaType: pair.figmaType,
              selector: pair.selector,
              ...(stale ? { stale: true } : {}),
              rows: mismatchRows,
            });
          }

          // Optional: name the browser-side color when it matches a known variable.
          if (include_token_suggestions && mismatches.length > 0) {
            try {
              const variablesRaw = await sendCommandToFigma("get_variables", {});
              const tokenIndex = buildColorTokenIndex(variablesRaw);
              if (tokenIndex.size > 0) {
                for (const m of mismatches) {
                  for (const row of m.rows) {
                    if (!COLOR_ROW_PROPERTIES.has(row.property) || !SIX_DIGIT_HEX.test(row.browser)) continue;
                    const token = nearestToken(row.browser, tokenIndex);
                    if (token) {
                      row.note = row.note ? `${row.note}; browser ≈ ${token}` : `browser ≈ ${token}`;
                    }
                  }
                }
              }
            } catch (err) {
              warnings.push(`token suggestions skipped: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          mismatches.sort((a, b) => b.rows.length - a.rows.length);
          styleDiff = {
            summary: {
              pairs: capped.length,
              pairsWithStyleData,
              nodesWithMismatches: mismatches.length,
              totalMismatchRows: totalRows,
              truncated: truncatedOutput,
            },
            mismatches,
          };
        }
      }

      // Optional annotation plan: geometry-matched pairs become ready-to-apply
      // data-fig-id suggestions (the match already names the selector), unmatched
      // Figma nodes are listed for manual mapping.
      let annotationMap:
        | {
            suggested: Array<{
              figmaId: string;
              name?: string;
              type?: string;
              text?: string;
              selector: string | null;
              tag: string;
              cost: number;
              iou: number;
              apply: string;
            }>;
            unmatched: Record<string, { name?: string; type?: string; text?: string }>;
          }
        | undefined;
      if (annotation_map) {
        const nodeById = indexFigmaTree(frameNode);
        const nodeText = (id: string): string | undefined => {
          const chars = nodeById.get(id)?.characters;
          return chars ? chars.slice(0, 80) : undefined;
        };

        const suggested = audit.matched
          .filter((p) => p.matchedBy !== "fig-id" && p.selector)
          .sort((a, b) => a.cost - b.cost)
          .slice(0, 100)
          .map((p) => ({
            figmaId: p.figmaId,
            name: p.figmaName,
            type: p.figmaType,
            ...(nodeText(p.figmaId) ? { text: nodeText(p.figmaId) } : {}),
            selector: p.selector,
            tag: p.tag,
            cost: p.cost,
            iou: p.iou,
            apply: `add data-fig-id="${p.figmaId}" to <${p.tag}> at ${p.selector}`,
          }));

        const unmatched: Record<string, { name?: string; type?: string; text?: string }> = {};
        for (const f of audit.unmatchedFigma.slice(0, 100)) {
          unmatched[f.id] = {
            name: f.name,
            type: f.type,
            ...(nodeText(f.id) ? { text: nodeText(f.id) } : {}),
          };
        }

        annotationMap = { suggested, unmatched };
      }

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
                ...(styleDiff ? { styleDiff } : {}),
                ...(annotationMap ? { annotationMap } : {}),
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
