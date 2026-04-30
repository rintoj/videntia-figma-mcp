/**
 * Manual end-to-end test for compare_figma_to_web pipeline.
 * Requires: socket server running (bun run socket) + Figma plugin open.
 * Usage: bun run scripts/test-comparison.ts
 */
import { sendCommandToFigma, joinChannel } from "../src/videntia_figma_mcp/utils/websocket.js";
import { captureUrl } from "../src/videntia_figma_mcp/utils/screenshot.js";
import { diffImages } from "../src/videntia_figma_mcp/utils/pixel-diff.js";
import { compareStyles, figmaNodeToStyles } from "../src/videntia_figma_mcp/utils/style-compare.js";
import * as fs from "fs";
import * as path from "path";

const TARGET_URL = "https://566df474-7bc8-4b5c-af73-9af705abe7fb-00-25jltzzbmwgqy.picard.replit.dev/";
const NODE_ID = "2824:13560";
const OUT_DIR = "/tmp/figma-compare-test";

fs.mkdirSync(OUT_DIR, { recursive: true });

console.log("=== Figma-to-Web Comparison Test ===");
console.log(`Node: ${NODE_ID}`);
console.log(`URL:  ${TARGET_URL}\n`);

// Step 0: Join channel
console.log("Joining Figma channel...");
await joinChannel("homevaulttea");
console.log("✓ Joined channel: homevaulttea\n");

// Step 1: Export Figma node as PNG via WebSocket
console.log("Exporting Figma node...");
const figmaExport = await sendCommandToFigma("export_node_as_image", {
  nodeId: NODE_ID,
  format: "PNG",
  scale: 1,
}) as { imageData: string };

const referenceBuffer = Buffer.from(figmaExport.imageData, "base64");
const refPath = path.join(OUT_DIR, "reference.png");
fs.writeFileSync(refPath, referenceBuffer);
console.log(`✓ Figma export saved: ${refPath} (${referenceBuffer.length} bytes)`);

// Step 2: Get node JSON for style comparison
console.log("Fetching node properties...");
const nodeData = await sendCommandToFigma("get_node_info", { nodeId: NODE_ID }) as Record<string, unknown>;
const figmaStyles = figmaNodeToStyles(nodeData);
console.log(`✓ Figma styles extracted:`, figmaStyles);

// Step 3: Screenshot target URL
console.log("\nScreenshotting target URL (with template matching)...");
const capture = await captureUrl({
  url: TARGET_URL,
  figmaId: NODE_ID,
  referenceBuffer,
  viewportWidth: 1440,
  viewportHeight: 900,
});
const actualPath = path.join(OUT_DIR, "actual.png");
fs.writeFileSync(actualPath, capture.screenshot);
console.log(`✓ Screenshot saved: ${actualPath}`);
console.log(`  Strategy: ${capture.selector ? "selector" : capture.matchConfidence !== undefined ? "template-match" : "full viewport"}`);
if (capture.matchConfidence !== undefined) console.log(`  Confidence: ${(capture.matchConfidence * 100).toFixed(1)}%`);
if (capture.region) {
  const r = capture.region;
  console.log(`  Region: x=${r.x} y=${r.y} w=${r.width} h=${r.height}`);
}

// Step 4: Pixel diff
console.log("\nRunning pixel diff...");
const diff = await diffImages(referenceBuffer, capture.screenshot, { tolerance: 0.1 });
const diffCopyPath = path.join(OUT_DIR, "diff.png");
fs.copyFileSync(diff.diffImagePath, diffCopyPath);

const matchLabel =
  diff.deviationPercent === 0 ? "✅ EXACT MATCH" :
  diff.deviationPercent < 5   ? "⚠️  CLOSE (< 5%)" :
                                 "❌ MISMATCH";

console.log(`✓ Pixel diff complete:`);
console.log(`  Mismatched pixels: ${diff.mismatchedPixels.toLocaleString()} / ${diff.totalPixels.toLocaleString()}`);
console.log(`  Deviation:         ${diff.deviationPercent}%`);
console.log(`  Result:            ${matchLabel}`);

// Step 5: Style comparison (if selector found)
if (capture.selector) {
  console.log("\nComparing styles...");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(TARGET_URL, { waitUntil: "networkidle" });
  const computedStyles = await page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return {};
    const cs = window.getComputedStyle(el);
    const props = ["font-size", "font-family", "font-weight", "line-height", "color", "background-color", "width", "height", "padding-top", "padding-bottom", "border-radius", "opacity"];
    return Object.fromEntries(props.map(p => [p, cs.getPropertyValue(p)]));
  }, capture.selector);
  await browser.close();
  const deviations = compareStyles(figmaStyles, computedStyles as Record<string, string>);
  if (deviations.length === 0) {
    console.log("  ✅ All styles match");
  } else {
    console.log(`  ⚠️  ${deviations.length} style deviation(s):`);
    for (const d of deviations) {
      console.log(`    ${d.property}: figma="${d.figma}" actual="${d.actual}"`);
    }
  }
}

console.log(`\n📁 Output files in ${OUT_DIR}:`);
console.log("   reference.png — Figma node export");
console.log("   actual.png    — Web screenshot");
console.log("   diff.png      — Pixel diff (red = mismatch)");
