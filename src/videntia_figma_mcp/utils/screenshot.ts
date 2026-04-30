import { chromium } from "playwright";
import sharp from "sharp";
import { findNodeInPage } from "./find-node-in-page.js";

export interface CaptureOptions {
  url: string;
  selector?: string;
  figmaId?: string;
  referenceBuffer?: Buffer; // Figma export PNG — enables auto template matching
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface CaptureResult {
  screenshot: Buffer;
  selector?: string;
  region?: { x: number; y: number; width: number; height: number };
  matchConfidence?: number; // present when template matching was used
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

    // Strategy 1: explicit CSS selector
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

    // Strategy 2: data-figma-id attribute on DOM element
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

    // Strategy 3: template matching — slide Figma reference over full page screenshot
    if (options.referenceBuffer) {
      const fullPage = await page.screenshot({ fullPage: true });
      const match = await findNodeInPage(options.referenceBuffer, fullPage);
      if (match && match.confidence > 0.2) {
        // Crop the matched region from the full page screenshot
        const cropped = await sharp(fullPage)
          .extract({ left: match.x, top: match.y, width: match.width, height: match.height })
          .png()
          .toBuffer();
        return {
          screenshot: cropped,
          region: { x: match.x, y: match.y, width: match.width, height: match.height },
          matchConfidence: match.confidence,
        };
      }
    }

    // Strategy 4: full viewport fallback
    const screenshot = await page.screenshot({ fullPage: false });
    return { screenshot };
  } finally {
    await browser.close();
  }
}
