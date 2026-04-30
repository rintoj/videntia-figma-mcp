import { chromium, type Page } from "playwright";
import sharp from "sharp";
import { findNodeInPage } from "./find-node-in-page.js";

export type PageAction =
  | { type: "hover"; selector: string }
  | { type: "click"; selector: string }
  | { type: "wait"; ms: number }
  | { type: "scroll"; selector: string };

export interface CaptureOptions {
  url: string;
  selector?: string;
  figmaId?: string;
  referenceBuffer?: Buffer;
  actions?: PageAction[]; // interactions to perform before screenshot
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface CaptureResult {
  screenshot: Buffer;
  selector?: string;
  region?: { x: number; y: number; width: number; height: number };
  matchConfidence?: number;
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
    // Allow JS frameworks (React, Vue, etc.) time to render after network idle
    await page.waitForTimeout(1500);

    // Run pre-screenshot interactions (hover, click, wait, scroll)
    if (options.actions?.length) {
      await runActions(page, options.actions);
    }

    // Strategy 1: explicit CSS selector
    if (options.selector) {
      const element = page.locator(options.selector).first();
      const screenshot = await element.screenshot();
      const box = await element.boundingBox();
      return { screenshot, selector: options.selector, region: box ?? undefined };
    }

    // Strategy 2: data-figma-id attribute
    if (options.figmaId) {
      const element = page.locator(`[data-figma-id="${options.figmaId}"]`).first();
      if (await element.count() > 0) {
        const screenshot = await element.screenshot();
        const box = await element.boundingBox();
        return {
          screenshot,
          selector: `[data-figma-id="${options.figmaId}"]`,
          region: box ?? undefined,
        };
      }
    }

    // Strategy 3: template matching across full page
    if (options.referenceBuffer) {
      const fullPage = await page.screenshot({ fullPage: true });
      const match = await findNodeInPage(options.referenceBuffer, fullPage);
      if (match && match.confidence > 0.2) {
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

async function runActions(page: Page, actions: PageAction[]): Promise<void> {
  for (const action of actions) {
    switch (action.type) {
      case "hover":
        await page.locator(action.selector).first().hover();
        await page.waitForTimeout(500); // allow animations to settle
        break;
      case "click":
        await page.locator(action.selector).first().click();
        await page.waitForTimeout(300);
        break;
      case "wait":
        await page.waitForTimeout(action.ms);
        break;
      case "scroll":
        await page.locator(action.selector).first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        break;
    }
  }
}
