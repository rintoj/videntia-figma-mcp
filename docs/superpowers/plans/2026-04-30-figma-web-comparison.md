# Figma-to-Web Comparison Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two MCP tools — `compare_figma_to_web` and `compare_figma_to_component` — that compare a Figma node against a live URL or inline component file map, returning a pixel diff image and style deviation report.

**Architecture:** Export the Figma node as a PNG via the existing `export_node_as_image` tool, capture a screenshot of the target (URL via Playwright, or inline files via Sandpack served locally), locate the matching region using a layered strategy (CSS selector → `data-figma-id` → full-viewport), then diff the two images with `pixelmatch` and compare computed CSS styles against Figma node properties.

**Tech Stack:** Playwright (browser automation + screenshots), pixelmatch + pngjs (pixel diff), `@codesandbox/sandpack-client` (in-browser bundler for inline file maps), Zod (parameter validation), TypeScript.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/videntia_figma_mcp/tools/comparison-tools.ts` | Register `compare_figma_to_web` and `compare_figma_to_component` MCP tools |
| Create | `src/videntia_figma_mcp/utils/screenshot.ts` | Launch Playwright, navigate to URL, capture + crop element screenshot |
| Create | `src/videntia_figma_mcp/utils/pixel-diff.ts` | Load two PNGs, run pixelmatch, write diff PNG, return stats |
| Create | `src/videntia_figma_mcp/utils/sandpack-server.ts` | Spin up a local Vite-based server from a file map, return URL, teardown |
| Create | `src/videntia_figma_mcp/utils/style-compare.ts` | Extract computed CSS from a Playwright element, diff against Figma node JSON |
| Modify | `src/videntia_figma_mcp/tools/index.ts` | Import and register `registerComparisonTools` |
| Create | `tests/unit/utils/pixel-diff.test.ts` | Unit tests for pixel diff utility |
| Create | `tests/unit/utils/style-compare.test.ts` | Unit tests for style comparison logic |
| Create | `tests/integration/comparison-tools.test.ts` | Integration tests for both MCP tools |

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime dependencies**

```bash
bun add playwright pixelmatch pngjs
bun add -d @types/pixelmatch @types/pngjs
```

- [ ] **Step 2: Install Playwright browsers**

```bash
bunx playwright install chromium
```

- [ ] **Step 3: Verify installation**

```bash
bun -e "import { chromium } from 'playwright'; console.log('ok')"
```

Expected output: `ok`

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: add playwright, pixelmatch, pngjs dependencies"
```

---

## Task 2: Pixel Diff Utility

**Files:**
- Create: `src/videntia_figma_mcp/utils/pixel-diff.ts`
- Create: `tests/unit/utils/pixel-diff.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/utils/pixel-diff.test.ts`:

```typescript
import { diffImages } from "../../../src/videntia_figma_mcp/utils/pixel-diff.js";
import * as fs from "fs";
import * as path from "path";

describe("diffImages", () => {
  it("returns zero mismatches for identical images", async () => {
    const img = fs.readFileSync(path.join(__dirname, "fixtures/red-10x10.png"));
    const result = await diffImages(img, img, { tolerance: 0.1 });
    expect(result.mismatchedPixels).toBe(0);
    expect(result.deviationPercent).toBe(0);
  });

  it("returns non-zero mismatches for different images", async () => {
    const red = fs.readFileSync(path.join(__dirname, "fixtures/red-10x10.png"));
    const blue = fs.readFileSync(path.join(__dirname, "fixtures/blue-10x10.png"));
    const result = await diffImages(red, blue, { tolerance: 0.1 });
    expect(result.mismatchedPixels).toBeGreaterThan(0);
    expect(result.deviationPercent).toBeGreaterThan(0);
    expect(result.diffPng).toBeInstanceOf(Buffer);
  });
});
```

- [ ] **Step 2: Create test fixtures**

```bash
mkdir -p tests/unit/utils/fixtures
```

Create `tests/unit/utils/fixtures/generate-fixtures.ts`:

```typescript
import { PNG } from "pngjs";
import * as fs from "fs";

function solidPng(r: number, g: number, b: number, file: string) {
  const png = new PNG({ width: 10, height: 10 });
  for (let i = 0; i < 10 * 10; i++) {
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = 255;
  }
  fs.writeFileSync(file, PNG.sync.write(png));
}

solidPng(255, 0, 0, "tests/unit/utils/fixtures/red-10x10.png");
solidPng(0, 0, 255, "tests/unit/utils/fixtures/blue-10x10.png");
console.log("fixtures created");
```

```bash
bun run tests/unit/utils/fixtures/generate-fixtures.ts
```

- [ ] **Step 3: Run test to verify it fails**

```bash
bun test tests/unit/utils/pixel-diff.test.ts
```

Expected: FAIL — `Cannot find module '../../../src/videntia_figma_mcp/utils/pixel-diff.js'`

- [ ] **Step 4: Implement pixel-diff utility**

Create `src/videntia_figma_mcp/utils/pixel-diff.ts`:

```typescript
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

export interface DiffOptions {
  tolerance: number; // 0–1, maps to pixelmatch threshold
}

export interface DiffResult {
  mismatchedPixels: number;
  totalPixels: number;
  deviationPercent: number;
  diffPng: Buffer;
  diffImagePath: string;
}

export async function diffImages(
  referenceBuffer: Buffer,
  actualBuffer: Buffer,
  options: DiffOptions
): Promise<DiffResult> {
  const ref = PNG.sync.read(referenceBuffer);
  const act = PNG.sync.read(actualBuffer);

  const width = Math.min(ref.width, act.width);
  const height = Math.min(ref.height, act.height);

  // Resize to same dimensions if needed
  const refData = resizeImageData(ref, width, height);
  const actData = resizeImageData(act, width, height);

  const diffPng = new PNG({ width, height });
  const mismatchedPixels = pixelmatch(
    refData,
    actData,
    diffPng.data,
    width,
    height,
    { threshold: options.tolerance }
  );

  const totalPixels = width * height;
  const diffBuffer = PNG.sync.write(diffPng);
  const diffImagePath = path.join(os.tmpdir(), `figma-diff-${Date.now()}.png`);
  fs.writeFileSync(diffImagePath, diffBuffer);

  return {
    mismatchedPixels,
    totalPixels,
    deviationPercent: parseFloat(((mismatchedPixels / totalPixels) * 100).toFixed(2)),
    diffPng: diffBuffer,
    diffImagePath,
  };
}

function resizeImageData(png: PNG, width: number, height: number): Buffer {
  if (png.width === width && png.height === height) {
    return png.data as unknown as Buffer;
  }
  // Crop to target dimensions (top-left crop)
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * png.width + x) * 4;
      const dstIdx = (y * width + x) * 4;
      data[dstIdx] = png.data[srcIdx];
      data[dstIdx + 1] = png.data[srcIdx + 1];
      data[dstIdx + 2] = png.data[srcIdx + 2];
      data[dstIdx + 3] = png.data[srcIdx + 3];
    }
  }
  return data;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun test tests/unit/utils/pixel-diff.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/videntia_figma_mcp/utils/pixel-diff.ts tests/unit/utils/pixel-diff.test.ts tests/unit/utils/fixtures/
git commit -m "feat: add pixel diff utility"
```

---

## Task 3: Screenshot Utility

**Files:**
- Create: `src/videntia_figma_mcp/utils/screenshot.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/utils/screenshot.test.ts`:

```typescript
import { captureUrl } from "../../../src/videntia_figma_mcp/utils/screenshot.js";

describe("captureUrl", () => {
  it("returns a PNG buffer for a valid URL", async () => {
    const result = await captureUrl({
      url: "data:text/html,<div style='width:100px;height:100px;background:red'></div>",
    });
    expect(result.screenshot).toBeInstanceOf(Buffer);
    expect(result.screenshot.length).toBeGreaterThan(0);
  }, 30000);

  it("crops to selector when provided", async () => {
    const result = await captureUrl({
      url: "data:text/html,<div id='box' style='width:50px;height:50px;background:blue'></div>",
      selector: "#box",
    });
    expect(result.screenshot).toBeInstanceOf(Buffer);
    expect(result.selector).toBe("#box");
  }, 30000);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/unit/utils/screenshot.test.ts
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement screenshot utility**

Create `src/videntia_figma_mcp/utils/screenshot.ts`:

```typescript
import { chromium } from "playwright";

export interface CaptureOptions {
  url: string;
  selector?: string;        // CSS selector to crop to
  figmaId?: string;         // data-figma-id attribute to search
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface CaptureResult {
  screenshot: Buffer;
  selector?: string;
  region?: { x: number; y: number; width: number; height: number };
}

export async function captureUrl(options: CaptureOptions): Promise<CaptureResult> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({
      width: options.viewportWidth ?? 1440,
      height: options.viewportHeight ?? 900,
    });
    await page.goto(options.url, { waitUntil: "networkidle" });

    // Strategy 1: explicit selector
    if (options.selector) {
      const element = page.locator(options.selector).first();
      const screenshot = await element.screenshot();
      const box = await element.boundingBox();
      return {
        screenshot,
        selector: options.selector,
        region: box ?? undefined,
      };
    }

    // Strategy 2: data-figma-id attribute
    if (options.figmaId) {
      const element = page.locator(`[data-figma-id="${options.figmaId}"]`).first();
      const count = await element.count();
      if (count > 0) {
        const screenshot = await element.screenshot();
        const box = await element.boundingBox();
        return {
          screenshot,
          selector: `[data-figma-id="${options.figmaId}"]`,
          region: box ?? undefined,
        };
      }
    }

    // Strategy 3: full page screenshot
    const screenshot = await page.screenshot({ fullPage: false });
    return { screenshot };
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/unit/utils/screenshot.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/videntia_figma_mcp/utils/screenshot.ts tests/unit/utils/screenshot.test.ts
git commit -m "feat: add playwright screenshot utility"
```

---

## Task 4: Style Comparison Utility

**Files:**
- Create: `src/videntia_figma_mcp/utils/style-compare.ts`
- Create: `tests/unit/utils/style-compare.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/utils/style-compare.test.ts`:

```typescript
import { compareStyles } from "../../../src/videntia_figma_mcp/utils/style-compare.js";

describe("compareStyles", () => {
  it("returns no deviations when styles match", () => {
    const figmaStyles = { fontSize: "16px", color: "rgba(0, 0, 0, 1)" };
    const computedStyles = { fontSize: "16px", color: "rgba(0, 0, 0, 1)" };
    const result = compareStyles(figmaStyles, computedStyles);
    expect(result).toHaveLength(0);
  });

  it("returns deviation when values differ", () => {
    const figmaStyles = { fontSize: "16px" };
    const computedStyles = { fontSize: "15px" };
    const result = compareStyles(figmaStyles, computedStyles);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ property: "fontSize", figma: "16px", actual: "15px" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/unit/utils/style-compare.test.ts
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement style-compare utility**

Create `src/videntia_figma_mcp/utils/style-compare.ts`:

```typescript
export interface StyleDeviation {
  property: string;
  figma: string;
  actual: string;
}

// Properties to extract from computed styles for comparison
export const COMPARABLE_STYLE_PROPERTIES = [
  "fontSize",
  "fontFamily",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "color",
  "backgroundColor",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "width",
  "height",
  "borderRadius",
  "borderWidth",
  "borderColor",
  "opacity",
] as const;

export function compareStyles(
  figmaStyles: Record<string, string>,
  computedStyles: Record<string, string>
): StyleDeviation[] {
  const deviations: StyleDeviation[] = [];
  for (const [property, figmaValue] of Object.entries(figmaStyles)) {
    const actualValue = computedStyles[property];
    if (actualValue !== undefined && normalizeValue(actualValue) !== normalizeValue(figmaValue)) {
      deviations.push({ property, figma: figmaValue, actual: actualValue });
    }
  }
  return deviations;
}

export function figmaNodeToStyles(node: Record<string, unknown>): Record<string, string> {
  const styles: Record<string, string> = {};
  if (node.fontSize) styles.fontSize = `${node.fontSize}px`;
  if (node.fontName && typeof node.fontName === "object") {
    const fn = node.fontName as { family?: string; style?: string };
    if (fn.family) styles.fontFamily = fn.family;
    if (fn.style) styles.fontWeight = fontStyleToWeight(fn.style);
  }
  if (node.lineHeight && typeof node.lineHeight === "object") {
    const lh = node.lineHeight as { value?: number; unit?: string };
    if (lh.unit === "PIXELS" && lh.value) styles.lineHeight = `${lh.value}px`;
    if (lh.unit === "PERCENT" && lh.value) styles.lineHeight = `${lh.value}%`;
  }
  if (node.width) styles.width = `${node.width}px`;
  if (node.height) styles.height = `${node.height}px`;
  if (node.cornerRadius) styles.borderRadius = `${node.cornerRadius}px`;
  if (node.opacity !== undefined) styles.opacity = String(node.opacity);
  return styles;
}

function fontStyleToWeight(style: string): string {
  const map: Record<string, string> = {
    Thin: "100", ExtraLight: "200", Light: "300", Regular: "400",
    Medium: "500", SemiBold: "600", Bold: "700", ExtraBold: "800", Black: "900",
  };
  return map[style] ?? "400";
}

function normalizeValue(val: string): string {
  return val.trim().toLowerCase().replace(/\s+/g, " ");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/unit/utils/style-compare.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/videntia_figma_mcp/utils/style-compare.ts tests/unit/utils/style-compare.test.ts
git commit -m "feat: add style comparison utility"
```

---

## Task 5: Sandpack Local Server (for inline file maps)

**Files:**
- Create: `src/videntia_figma_mcp/utils/sandpack-server.ts`

- [ ] **Step 1: Install dependency**

```bash
bun add vite @vitejs/plugin-react
```

- [ ] **Step 2: Implement sandpack-server utility**

Create `src/videntia_figma_mcp/utils/sandpack-server.ts`:

```typescript
import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

export interface FileMap {
  [filePath: string]: string; // e.g. "/App.tsx": "<tsx content>"
}

export interface SandpackServerResult {
  url: string;
  stop: () => void;
}

// Spins up a minimal HTML server that loads files from a CDN-based React runtime.
// Local imports are resolved from the provided file map served as virtual files.
export async function startSandpackServer(
  files: FileMap,
  entry: string
): Promise<SandpackServerResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "figma-compare-"));

  // Write all files to tmpDir
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(tmpDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  // Write a minimal index.html that imports the entry via esm.sh shim
  const entryContent = files[entry] ?? "";
  const indexHtml = buildIndexHtml(entryContent, entry, files);
  fs.writeFileSync(path.join(tmpDir, "index.html"), indexHtml);

  // Serve the tmpDir over HTTP
  const server = http.createServer((req, res) => {
    const filePath = path.join(tmpDir, req.url === "/" ? "/index.html" : req.url!);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      const mimeTypes: Record<string, string> = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".ts": "application/javascript",
        ".tsx": "application/javascript",
        ".css": "text/css",
      };
      res.writeHead(200, { "Content-Type": mimeTypes[ext] ?? "text/plain" });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => {
      server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

function buildIndexHtml(entryContent: string, entry: string, files: FileMap): string {
  // Use esm.sh to resolve react + react-dom; inline file map as importmap
  const imports: Record<string, string> = {
    react: "https://esm.sh/react@18",
    "react-dom": "https://esm.sh/react-dom@18",
    "react-dom/client": "https://esm.sh/react-dom@18/client",
  };

  // Local files mapped to relative URLs
  for (const filePath of Object.keys(files)) {
    imports[filePath.replace(/^\//, "./")] = filePath;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <script type="importmap">${JSON.stringify({ imports })}</script>
  <script src="https://esm.sh/tsx@4/dist/esm/browser.js" type="module"></script>
</head>
<body>
  <div id="root"></div>
  <script type="text/tsx">
    import React from "react";
    import { createRoot } from "react-dom/client";
    ${entryContent}
    createRoot(document.getElementById("root")).render(React.createElement(App));
  </script>
</body>
</html>`;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/videntia_figma_mcp/utils/sandpack-server.ts
git commit -m "feat: add sandpack-style local server for inline file maps"
```

---

## Task 6: Comparison MCP Tools

**Files:**
- Create: `src/videntia_figma_mcp/tools/comparison-tools.ts`
- Modify: `src/videntia_figma_mcp/tools/index.ts`

- [ ] **Step 1: Write failing integration test**

Create `tests/integration/comparison-tools.test.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerComparisonTools } from "../../src/videntia_figma_mcp/tools/comparison-tools.js";

// Mock sendCommandToFigma so tests don't need a live Figma connection
jest.mock("../../src/videntia_figma_mcp/utils/websocket.js", () => ({
  sendCommandToFigma: jest.fn().mockResolvedValue({
    imageData: "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==",
    format: "PNG",
    nodeId: "1:1",
  }),
}));

describe("compare_figma_to_web", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerComparisonTools(server);
  });

  it("registers compare_figma_to_web tool", () => {
    const tools = (server as any)._registeredTools;
    expect(tools["compare_figma_to_web"]).toBeDefined();
  });

  it("registers compare_figma_to_component tool", () => {
    const tools = (server as any)._registeredTools;
    expect(tools["compare_figma_to_component"]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/integration/comparison-tools.test.ts
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement comparison-tools.ts**

Create `src/videntia_figma_mcp/tools/comparison-tools.ts`:

```typescript
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
      // Export Figma node as PNG
      const figmaExport = await sendCommandToFigma("export_node_as_image", {
        nodeId,
        format: "PNG",
        scale: 1,
      }) as { imageData: string };

      const referenceBuffer = Buffer.from(figmaExport.imageData, "base64");

      // Capture target URL
      const capture = await captureUrl({ url, selector, figmaId: nodeId });

      const result: Record<string, unknown> = {
        nodeId,
        url,
        selector: capture.selector ?? null,
        matchRegion: capture.region ?? null,
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
        // Get Figma node JSON for style extraction
        const nodeData = await sendCommandToFigma("get_node_info", { nodeId }) as Record<string, unknown>;
        const figmaStyles = figmaNodeToStyles(nodeData);

        // Extract computed styles from page
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
      const server = await startSandpackServer(files, entry);
      try {
        // Export Figma node as PNG
        const figmaExport = await sendCommandToFigma("export_node_as_image", {
          nodeId,
          format: "PNG",
          scale: 1,
        }) as { imageData: string };

        const referenceBuffer = Buffer.from(figmaExport.imageData, "base64");

        // Wait a moment for the server to be ready
        await new Promise((r) => setTimeout(r, 1000));

        const capture = await captureUrl({ url: server.url, selector });

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
        server.stop();
      }
    }
  );
}
```

- [ ] **Step 4: Register in tools/index.ts**

Edit `src/videntia_figma_mcp/tools/index.ts` — add after the last import:

```typescript
import { registerComparisonTools } from "./comparison-tools.js";
```

Add inside `registerTools()`:

```typescript
registerComparisonTools(server);
```

Add to the exports at the bottom:

```typescript
export { registerComparisonTools };
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun test tests/integration/comparison-tools.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/videntia_figma_mcp/tools/comparison-tools.ts src/videntia_figma_mcp/tools/index.ts tests/integration/comparison-tools.test.ts
git commit -m "feat: add compare_figma_to_web and compare_figma_to_component MCP tools"
```

---

## Task 7: Build and Verify

**Files:** None new

- [ ] **Step 1: Run full test suite**

```bash
bun test
```

Expected: All tests pass (no regressions)

- [ ] **Step 2: Build**

```bash
bun run build
```

Expected: Build completes with no errors

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: verify build passes with comparison tools"
```

---

## Usage Examples

### Compare Figma node to a live URL

```
compare_figma_to_web({
  nodeId: "2824:12737",
  url: "https://566df474-7bc8-4b5c-af73-9af705abe7fb-00-25jltzzbmwgqy.picard.replit.dev",
  selector: "#hero-section",
  tolerance: 0.1,
  mode: "both"
})
```

### Compare Figma node to inline React component

```
compare_figma_to_component({
  nodeId: "2824:12737",
  files: {
    "/App.tsx": "export default function App() { return <div>Hello</div> }",
    "/Button.tsx": "export function Button({ label }) { return <button>{label}</button> }"
  },
  entry: "/App.tsx"
})
```

### Annotate DOM for zero-config matching

Add `data-figma-id` to React components:
```tsx
<section data-figma-id="2824:12737">...</section>
```
Then call `compare_figma_to_web` with only `nodeId` + `url` — no selector needed.
