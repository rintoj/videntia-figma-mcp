import { z } from "zod";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma, getCurrentChannel, joinChannel } from "../utils/websocket.js";
import { captureUrl, type PageAction } from "../utils/screenshot.js";
import { diffImages } from "../utils/pixel-diff.js";
import { compareStyles, figmaNodeToStyles, COMPARABLE_STYLE_PROPERTIES } from "../utils/style-compare.js";
import { startSandpackServer } from "../utils/sandpack-server.js";
import { chromium } from "playwright";

interface CompareInput {
  nodeId: string;
  url: string;
  channel?: string;
  selector?: string;
  tolerance: number;
  mode: "screenshot" | "styles" | "both";
  actions?: PageAction[];
}

interface Job {
  status: "running" | "done" | "failed";
  startedAt: number;
  finishedAt?: number;
  result?: Record<string, unknown>;
  error?: string;
}

const jobs = new Map<string, Job>();
const JOB_TTL_MS = 10 * 60 * 1000;

function gcJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > JOB_TTL_MS) jobs.delete(id);
  }
}

interface FigmaChild {
  id?: string;
  name?: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  characters?: string;
  children?: FigmaChild[];
}

function extractRootNode(info: Record<string, unknown>): FigmaChild | null {
  const nodes = info["nodes"];
  if (Array.isArray(nodes) && nodes.length > 0) return nodes[0] as FigmaChild;
  const node = info["node"];
  if (node && typeof node === "object") return node as FigmaChild;
  if (info["id"]) return info as FigmaChild;
  return null;
}

function findFirstText(node: FigmaChild, maxLen = 60): string | undefined {
  if (node.type === "TEXT" && typeof node.characters === "string" && node.characters.trim().length > 0) {
    return node.characters.trim().slice(0, maxLen);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findFirstText(child, maxLen);
      if (found) return found;
    }
  }
  return undefined;
}

const SEMANTIC_TAG_MAP: Array<[RegExp, string]> = [
  [/\bheader\b/i, "header"],
  [/\bnav(igation)?\b/i, "nav"],
  [/\bfooter\b/i, "footer"],
  [/\bmain\b/i, "main"],
  [/\baside|sidebar\b/i, "aside"],
  [/\bsection\b/i, "section"],
  [/\barticle\b/i, "article"],
  [/\bbutton|btn\b/i, "button"],
  [/\bform\b/i, "form"],
  [/\bdialog|modal\b/i, '[role="dialog"]'],
];

function nameToKebab(name: string): string {
  return name
    .replace(/[\/]+/g, "-")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function buildSelectorCandidates(node: FigmaChild, primaryText?: string): string[] {
  const candidates: string[] = [];
  if (node.id) candidates.push(`[data-figma-id="${node.id}"]`);
  if (node.name) {
    for (const [pattern, tag] of SEMANTIC_TAG_MAP) {
      if (pattern.test(node.name)) {
        candidates.push(tag);
        break;
      }
    }
    const kebab = nameToKebab(node.name);
    if (kebab.length > 0) candidates.push(`[class*="${kebab}"]`);
  }
  if (primaryText && primaryText.length <= 40) {
    const escaped = primaryText.replace(/"/g, '\\"');
    candidates.push(`:has-text("${escaped}")`);
  }
  return Array.from(new Set(candidates));
}

interface PlannedSection {
  nodeId: string;
  name: string | null;
  type: string | null;
  bbox: { x: number; y: number; width: number; height: number } | null;
  primaryText: string | null;
  selectorCandidates: string[];
  childCount: number;
}

function toBbox(node: FigmaChild): PlannedSection["bbox"] {
  if (
    typeof node.x === "number" &&
    typeof node.y === "number" &&
    typeof node.width === "number" &&
    typeof node.height === "number"
  ) {
    return { x: node.x, y: node.y, width: node.width, height: node.height };
  }
  return null;
}

function buildSections(root: FigmaChild, maxDepth: number): PlannedSection[] {
  const sections: PlannedSection[] = [];
  const SKIP_TYPES = new Set(["VECTOR", "BOOLEAN_OPERATION", "LINE", "ELLIPSE", "STAR", "POLYGON"]);
  const MIN_AREA = 400; // ignore tiny decorative elements

  function visit(node: FigmaChild, depth: number) {
    if (!Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (!child.id) continue;
      if (child.type && SKIP_TYPES.has(child.type)) continue;
      const bbox = toBbox(child);
      if (bbox && bbox.width * bbox.height < MIN_AREA) continue;

      const primaryText = findFirstText(child);
      sections.push({
        nodeId: child.id,
        name: child.name ?? null,
        type: child.type ?? null,
        bbox,
        primaryText: primaryText ?? null,
        selectorCandidates: buildSelectorCandidates(child, primaryText),
        childCount: Array.isArray(child.children) ? child.children.length : 0,
      });
      if (depth + 1 < maxDepth) visit(child, depth + 1);
    }
  }

  visit(root, 0);
  return sections;
}

async function runCompare(input: CompareInput): Promise<Record<string, unknown>> {
  const { nodeId, url, channel, selector, tolerance, mode, actions } = input;

  if (channel && getCurrentChannel() !== channel) {
    await joinChannel(channel);
  }

  const figmaExport = (await sendCommandToFigma("export_node_as_image", {
    nodeId,
    format: "PNG",
    scale: 1,
  })) as { imageData: string };

  const referenceBuffer = Buffer.from(figmaExport.imageData, "base64");
  const capture = await captureUrl({ url, selector, figmaId: nodeId, referenceBuffer, actions });

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
    figmaImageBase64: referenceBuffer.toString("base64"),
    webImageBase64: capture.screenshot.toString("base64"),
  };

  if (mode === "screenshot" || mode === "both") {
    const diff = await diffImages(referenceBuffer, capture.screenshot, { tolerance });
    result.mismatchedPixels = diff.mismatchedPixels;
    result.totalPixels = diff.totalPixels;
    result.deviationPercent = diff.deviationPercent;
    result.diffImageBase64 = diff.diffPng.toString("base64");
    result.match = diff.deviationPercent === 0;
  }

  if (mode === "styles" || mode === "both") {
    const nodeData = (await sendCommandToFigma("get_node_info", { nodeId })) as Record<string, unknown>;
    const figmaStyles = figmaNodeToStyles(nodeData);

    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      const targetSelector = capture.selector ?? "body";
      const computedStyles = await page.evaluate(
        ({ sel, props }: { sel: string; props: string[] }) => {
          const doc = (globalThis as unknown as { document: { querySelector: (s: string) => unknown } }).document;
          const win = globalThis as unknown as {
            getComputedStyle: (el: unknown) => { getPropertyValue: (p: string) => string };
          };
          const el = doc.querySelector(sel);
          if (!el) return {};
          const cs = win.getComputedStyle(el);
          return Object.fromEntries(
            props.map((p) => [p, cs.getPropertyValue(p.replace(/([A-Z])/g, "-$1").toLowerCase())]),
          );
        },
        { sel: targetSelector, props: [...COMPARABLE_STYLE_PROPERTIES] },
      );
      result.styleDeviations = compareStyles(figmaStyles, computedStyles as Record<string, string>);
    } finally {
      await browser.close();
    }
  }

  return result;
}

const compareInputSchema = {
  nodeId: z.string().describe("Figma node ID to compare (e.g. '2824:12737')"),
  url: z.string().describe("Target URL (any http/https URL, local dev server, staging, prod)"),
  channel: z
    .string()
    .optional()
    .describe("Figma channel ID to join before exporting (auto-joined if not already connected)"),
  selector: z.string().optional().describe("CSS selector to crop the page to the matching element"),
  tolerance: z.number().min(0).max(1).default(0.1).describe("Pixel diff tolerance 0–1 (default 0.1)"),
  mode: z.enum(["screenshot", "styles", "both"]).default("both").describe("Comparison mode"),
  actions: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("hover"), selector: z.string() }),
        z.object({ type: z.literal("click"), selector: z.string() }),
        z.object({ type: z.literal("wait"), ms: z.number() }),
        z.object({ type: z.literal("scroll"), selector: z.string() }),
      ]),
    )
    .optional()
    .describe("Interactions to perform before screenshot"),
};

export function registerComparisonTools(server: McpServer): void {
  function buildResultContent(result: Record<string, unknown>) {
    const { diffImageBase64, figmaImageBase64, webImageBase64, ...rest } = result;
    const content: Array<Record<string, unknown>> = [{ type: "text", text: JSON.stringify(rest, null, 2) }];
    if (typeof figmaImageBase64 === "string") {
      content.push({ type: "text", text: "Figma reference:" });
      content.push({ type: "image", data: figmaImageBase64, mimeType: "image/png" });
    }
    if (typeof webImageBase64 === "string") {
      content.push({ type: "text", text: "Web screenshot:" });
      content.push({ type: "image", data: webImageBase64, mimeType: "image/png" });
    }
    if (typeof diffImageBase64 === "string") {
      content.push({ type: "text", text: "Pixel diff:" });
      content.push({ type: "image", data: diffImageBase64, mimeType: "image/png" });
    }
    return content;
  }

  server.tool(
    "plan_figma_comparison",
    "Decompose a Figma node into logical sections for compare_figma_to_web. Returns each child with bbox, primary text, and a ranked list of CSS selector candidates (data-figma-id, semantic tag, text anchor, name-derived class). Call this BEFORE compare_figma_to_web on any page-level or multi-section node — comparing the whole page produces useless diffs.",
    {
      nodeId: z.string().describe("Figma node ID to decompose (e.g. '2824:12737')"),
      channel: z
        .string()
        .optional()
        .describe("Figma channel ID to join before reading (auto-joined if not already connected)"),
      maxDepth: z
        .number()
        .int()
        .min(1)
        .max(3)
        .default(1)
        .describe("How deep to walk children (default 1: immediate children only)"),
    },
    async ({ nodeId, channel, maxDepth }) => {
      if (channel && getCurrentChannel() !== channel) {
        await joinChannel(channel);
      }
      const info = (await sendCommandToFigma("get_node_info", { nodeId, depth: maxDepth + 1 })) as Record<
        string,
        unknown
      >;
      const root = extractRootNode(info);
      if (!root) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Node not found", nodeId }, null, 2) }] };
      }
      const sections = buildSections(root, maxDepth);
      const payload = {
        nodeId: root.id ?? nodeId,
        name: root.name ?? null,
        type: root.type ?? null,
        sectionCount: sections.length,
        sections,
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    },
  );

  server.tool(
    "start_compare_figma_to_web",
    "Compare a Figma node to a live URL. Exports the node, screenshots the URL, and returns a jobId immediately; poll get_compare_result with the jobId until status is 'done' or 'failed'. For page-level or multi-section nodes, run plan_figma_comparison FIRST to get section-level selectors — whole-page comparisons produce noisy, low-signal diffs.",
    compareInputSchema,
    async (input) => {
      gcJobs();
      const jobId = randomUUID();
      jobs.set(jobId, { status: "running", startedAt: Date.now() });
      void runCompare(input as CompareInput).then(
        (result) => {
          jobs.set(jobId, { status: "done", startedAt: jobs.get(jobId)!.startedAt, finishedAt: Date.now(), result });
        },
        (err) => {
          jobs.set(jobId, {
            status: "failed",
            startedAt: jobs.get(jobId)!.startedAt,
            finishedAt: Date.now(),
            error: err instanceof Error ? err.message : String(err),
          });
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify({ jobId, status: "running" }, null, 2) }],
      };
    },
  );

  server.tool(
    "get_compare_result",
    "Poll a job started by start_compare_figma_to_web. Returns { status: 'running' | 'done' | 'failed', result?, error?, elapsedMs }. Jobs expire 10 minutes after completion.",
    {
      jobId: z.string().describe("Job ID returned by start_compare_figma_to_web"),
    },
    async ({ jobId }) => {
      const job = jobs.get(jobId);
      if (!job) {
        return {
          content: [{ type: "text", text: JSON.stringify({ status: "not_found", jobId }, null, 2) }],
        };
      }
      const elapsedMs = (job.finishedAt ?? Date.now()) - job.startedAt;
      if (job.status === "done" && job.result) {
        const meta = { jobId, status: job.status, elapsedMs };
        const merged = { ...meta, ...job.result };
        return { content: buildResultContent(merged) as any };
      }
      const payload: Record<string, unknown> = { jobId, status: job.status, elapsedMs };
      if (job.error) payload.error = job.error;
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    },
  );

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
