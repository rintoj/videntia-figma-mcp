import { chromium } from "playwright";

export interface CaptureOptions {
  url: string;
  selector?: string;
  figmaId?: string;
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

    // Strategy 3: full viewport screenshot
    const screenshot = await page.screenshot({ fullPage: false });
    return { screenshot };
  } finally {
    await browser.close();
  }
}
