import puppeteer from "puppeteer-core";
import type { Browser, Page } from "puppeteer-core";

export interface BrowserTab {
  tabId: number;
  url: string;
  title: string;
  active: boolean;
  groupId?: string;
}

export interface CdpAdapter {
  tabs: {
    list(): Promise<BrowserTab[]>;
    create(url: string): Promise<BrowserTab>;
    close(id: number): Promise<void>;
    query(filter: any): Promise<BrowserTab[]>;
    get(id: number): Promise<BrowserTab>;
  };
  scripting: {
    executeScript(tabId: number, code: string): Promise<any>;
  };
  screenshot(tabId: number, fullPage?: boolean): Promise<{ imageData: string; mimeType: string }>;
}

/**
 * Creates a CDP adapter that manages Chrome through puppeteer and exposes
 * a browser-like interface compatible with the command handler.
 */
export async function createCdpAdapter(cdpUrl: string): Promise<CdpAdapter> {
  console.log(`[cdp-adapter] Connecting to Chrome at ${cdpUrl}`);

  const browser: Browser = await puppeteer.connect({
    browserWSEndpoint: cdpUrl,
  });

  // Map target IDs to sequential tab IDs for caller compatibility
  const targetIdToTabId = new Map<string, number>();
  const tabIdToTargetId = new Map<number, string>();
  let nextTabId = 1;

  // In-memory state storage (replacement for chrome.storage.session)
  const sessionState = new Map<string, any>();

  function getOrCreateTabId(targetId: string): number {
    if (!targetIdToTabId.has(targetId)) {
      const tabId = nextTabId++;
      targetIdToTabId.set(targetId, tabId);
      tabIdToTargetId.set(tabId, targetId);
    }
    return targetIdToTabId.get(targetId)!;
  }

  async function listPages(): Promise<Page[]> {
    return browser.pages();
  }

  async function getPageByTabId(tabId: number): Promise<Page | null> {
    const targetId = tabIdToTargetId.get(tabId);
    if (!targetId) return null;

    const pages = await listPages();
    return pages.find((p) => (p.target() as any).targetId() === targetId) || null;
  }

  const adapter: CdpAdapter = {
    tabs: {
      async list(): Promise<BrowserTab[]> {
        const pages = await listPages();
        const tabs: BrowserTab[] = [];

        for (const page of pages) {
          const target = page.target() as any;
          const targetId = target.targetId() || target._targetId || "";
          const tabId = getOrCreateTabId(targetId);

          tabs.push({
            tabId,
            url: page.url(),
            title: await page.title(),
            active: false, // Puppeteer doesn't expose "active" concept
          });
        }

        return tabs;
      },

      async create(url: string): Promise<BrowserTab> {
        console.log(`[cdp-adapter] Creating tab with URL: ${url}`);
        const page = await browser.newPage();
        await page.goto(url);

        const target = page.target() as any;
        const targetId = target.targetId() || target._targetId || "";
        const tabId = getOrCreateTabId(targetId);

        return {
          tabId,
          url: page.url(),
          title: await page.title(),
          active: true,
        };
      },

      async close(id: number): Promise<void> {
        console.log(`[cdp-adapter] Closing tab ${id}`);
        const page = await getPageByTabId(id);
        if (page) {
          await page.close();
          tabIdToTargetId.delete(id);
        }
      },

      async query(filter: any): Promise<BrowserTab[]> {
        // Simplified query: just list all and let the caller filter
        return adapter.tabs.list();
      },

      async get(id: number): Promise<BrowserTab> {
        const page = await getPageByTabId(id);
        if (!page) {
          throw new Error(`Tab ${id} not found`);
        }

        return {
          tabId: id,
          url: page.url(),
          title: await page.title(),
          active: true,
        };
      },
    },

    scripting: {
      async executeScript(tabId: number, code: string): Promise<any> {
        const page = await getPageByTabId(tabId);
        if (!page) {
          throw new Error(`Tab ${tabId} not found`);
        }

        console.log(`[cdp-adapter] Executing script on tab ${tabId}`);
        return page.evaluate((code as any) as () => unknown, ...[]);
      },
    },

    async screenshot(tabId: number, fullPage = false): Promise<{ imageData: string; mimeType: string }> {
      const page = await getPageByTabId(tabId);
      if (!page) {
        throw new Error(`Tab ${tabId} not found`);
      }

      console.log(`[cdp-adapter] Taking screenshot of tab ${tabId} (fullPage=${fullPage})`);

      const imageBuffer = await page.screenshot({
        fullPage: fullPage,
        type: "png",
      });

      const imageData = (imageBuffer as Buffer).toString("base64");

      return {
        imageData,
        mimeType: "image/png",
      };
    },
  };

  return adapter;
}
