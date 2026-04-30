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

async function runCompare(input: CompareInput): Promise<Record<string, unknown>> {
  const { nodeId, url, channel, selector, tolerance, mode, actions } = input;

  if (channel && getCurrentChannel() !== channel) {
    await joinChannel(channel);
  }

  const figmaExport = await sendCommandToFigma("export_node_as_image", {
    nodeId,
    format: "PNG",
    scale: 1,
  }) as { imageData: string };

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
    const nodeData = await sendCommandToFigma("get_node_info", { nodeId }) as Record<string, unknown>;
    const figmaStyles = figmaNodeToStyles(nodeData);

    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      const targetSelector = capture.selector ?? "body";
      const computedStyles = await page.evaluate(({ sel, props }: { sel: string; props: string[] }) => {
        const el = document.querySelector(sel);
        if (!el) return {};
        const cs = window.getComputedStyle(el);
        return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p.replace(/([A-Z])/g, "-$1").toLowerCase())]));
      }, { sel: targetSelector, props: [...COMPARABLE_STYLE_PROPERTIES] });
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
  channel: z.string().optional().describe("Figma channel ID to join before exporting (auto-joined if not already connected)"),
  selector: z.string().optional().describe("CSS selector to crop the page to the matching element"),
  tolerance: z.number().min(0).max(1).default(0.1).describe("Pixel diff tolerance 0–1 (default 0.1)"),
  mode: z.enum(["screenshot", "styles", "both"]).default("both").describe("Comparison mode"),
  actions: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("hover"), selector: z.string() }),
    z.object({ type: z.literal("click"), selector: z.string() }),
    z.object({ type: z.literal("wait"), ms: z.number() }),
    z.object({ type: z.literal("scroll"), selector: z.string() }),
  ])).optional().describe("Interactions to perform before screenshot"),
};

export function registerComparisonTools(server: McpServer): void {
  function buildResultContent(result: Record<string, unknown>) {
    const { diffImageBase64, figmaImageBase64, webImageBase64, ...rest } = result;
    const content: Array<Record<string, unknown>> = [
      { type: "text", text: JSON.stringify(rest, null, 2) },
    ];
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
    "compare_figma_to_web",
    "Compare a Figma node to a live URL (synchronous). Exports the node, screenshots the URL, returns pixel diff and style deviations. Use this only for fast pages — for slow pages (Replit, etc.) use start_compare_figma_to_web + get_compare_result to avoid client-side 30s timeouts.",
    compareInputSchema,
    async (input) => {
      const result = await runCompare(input as CompareInput);
      return { content: buildResultContent(result) as any };
    }
  );

  server.tool(
    "start_compare_figma_to_web",
    "Async variant of compare_figma_to_web. Returns { jobId } immediately; poll get_compare_result with the jobId until status is 'done' or 'failed'. Use this for slow pages (Replit cold starts, staging environments) where the synchronous tool would exceed the client's 30s request timeout.",
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
        }
      );
      return {
        content: [{ type: "text", text: JSON.stringify({ jobId, status: "running" }, null, 2) }],
      };
    }
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
            }, null, 2),
          }, {
            type: "image",
            data: diff.diffPng.toString("base64"),
            mimeType: "image/png",
          }],
        };
      } finally {
        sandpack.stop();
      }
    }
  );
}
