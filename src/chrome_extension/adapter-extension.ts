/**
 * adapter-extension.ts — Chrome extension implementation of BrowserAdapter.
 *
 * This adapter wraps chrome.* APIs and CDP operations to match the BrowserAdapter
 * interface, enabling the command handler to work in the extension environment.
 */

import { BrowserAdapter, BrowserTab } from "./commands";

const PINNED_TAB_KEY = "pinnedTab";
const AGENT_GROUP_KEY = "agentTabGroup";
const AGENT_GROUP_TITLE = "Videntia";
const AGENT_GROUP_COLOR = "purple";
const WINDOW_MIN_W = 500;

// Forward declarations for CDP functions (loaded via importScripts in background.js)
declare const cdpEnsureAttached: (tabId: number) => Promise<{ newlyAttached: boolean }>;
declare const cdpSend: (tabId: number, method: string, params?: any) => Promise<any>;
declare const cdpClick: (tabId: number, x: number, y: number, options?: any) => Promise<void>;
declare const cdpHover: (tabId: number, x: number, y: number) => Promise<void>;
declare const cdpScroll: (tabId: number, x: number, y: number, deltaX: number, deltaY: number) => Promise<void>;
declare const cdpTypeText: (tabId: number, text: string) => Promise<void>;
declare const cdpPressKey: (tabId: number, key: string, modifiers?: string[]) => Promise<void>;
declare const cdpEvaluate: (tabId: number, expression: string, options?: any) => Promise<any>;
declare const cdpQuerySelector: (tabId: number, selector: string) => Promise<number>;
declare const cdpFocusBackendNode: (tabId: number, nodeId: number) => Promise<void>;
declare const cdpResolveAXNode: (tabId: number, nodeId: number) => Promise<{ x: number; y: number }>;
declare const cdpHighlightNode: (tabId: number, config: any) => Promise<void>;
declare const cdpClearHighlight: (tabId: number) => Promise<void>;
declare const cdpGetAXTree: (tabId: number, options?: any) => Promise<any>;
declare const cdpApplyEmulation: (tabId: number, config: any) => Promise<void>;
declare const cdpClearEmulation: (tabId: number) => Promise<void>;
declare const cdpClearAllEmulation: (tabId: number) => Promise<void>;
declare const cdpMaybeDetach: (tabId: number) => Promise<void>;
declare const cdpReapplyOverrides: (tabId: number) => Promise<void>;
declare const cdpEnsureMonitoring: (tabId: number) => Promise<{ startedNow: boolean }>;
declare const cdpStartInterception: (tabId: number, patterns?: any, timeoutMs?: number) => Promise<void>;
declare const cdpStopInterception: (tabId: number) => Promise<void>;
declare const listPendingInterceptions: (tabId: number) => any[];
declare const cdpFulfillRequest: (tabId: number, requestId: string, options: any) => Promise<void>;
declare const cdpFailRequest: (tabId: number, requestId: string, errorReason?: string) => Promise<void>;
declare const cdpContinueRequest: (tabId: number, requestId: string, overrides?: any) => Promise<void>;
declare const cdpClearStorage: (tabId: number, origin: string, storageTypes?: string[]) => Promise<void>;
declare const cdpCaptureMhtml: (tabId: number) => Promise<string>;
declare const cdpSetEmulatedMedia: (tabId: number, config: any) => Promise<void>;
declare const cdpSetNetworkConditions: (tabId: number, conditions: any) => Promise<void>;
declare const cdpSetGeolocation: (tabId: number, geo: any) => Promise<void>;
declare const cdpSetTimezone: (tabId: number, timezoneId: string) => Promise<void>;
declare const cdpSetCpuThrottling: (tabId: number, rate: number) => Promise<void>;
declare const getTabState: (tabId: number) => Promise<any>;
declare const readConsoleBuffer: (tabId: number, options?: any) => Promise<any>;
declare const clearConsoleBuffer: (tabId: number) => Promise<void>;
declare const readNetworkBuffer: (tabId: number, options?: any) => Promise<any>;
declare const clearNetworkBuffer: (tabId: number) => Promise<void>;

// Helper for window resize calculation
async function getWindowOffset(tabId: number) {
  const [{ result: chromeOffset }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      w: window.outerWidth - window.innerWidth,
      h: window.outerHeight - window.innerHeight,
      maxW: window.screen.availWidth,
      maxH: window.screen.availHeight,
      availLeft: window.screen.availLeft ?? 0,
      availTop: window.screen.availTop ?? 0,
    }),
  });
  return chromeOffset;
}

async function waitForTabComplete(tabId: number, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearInterval(poll);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id: number, info: any) => {
      if (id === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    const poll = setInterval(() => {
      chrome.tabs
        .get(tabId)
        .then((t) => {
          if (t.status === "complete") finish();
        })
        .catch(finish);
    }, 500);
    const timer = setTimeout(finish, timeoutMs);
  });
}

async function getAgentGroupId(): Promise<number | null> {
  const store = await chrome.storage.session.get(AGENT_GROUP_KEY);
  const groupId = store[AGENT_GROUP_KEY];
  if (typeof groupId !== "number") return null;
  try {
    await chrome.tabGroups.get(groupId);
    return groupId;
  } catch {
    await chrome.storage.session.remove(AGENT_GROUP_KEY);
    return null;
  }
}

async function addTabToAgentGroup(tabId: number): Promise<number | null> {
  try {
    const existing = await getAgentGroupId();
    const groupId = await chrome.tabs.group({
      tabIds: [tabId],
      ...(existing != null ? { groupId: existing } : {}),
    });
    if (existing == null) {
      await chrome.tabGroups.update(groupId, { title: AGENT_GROUP_TITLE, color: AGENT_GROUP_COLOR });
      await chrome.storage.session.set({ [AGENT_GROUP_KEY]: groupId });
    }
    return groupId;
  } catch (e) {
    console.warn("[figma-overlay:adapter] tab grouping failed:", (e as Error).message);
    return null;
  }
}

/**
 * Chrome extension implementation of BrowserAdapter.
 * Uses chrome.* APIs and imported CDP functions.
 */
export const extensionAdapter: BrowserAdapter = {
  tabs: {
    async list(): Promise<BrowserTab[]> {
      const tabs = await chrome.tabs.query({});
      const store = await chrome.storage.session.get(PINNED_TAB_KEY);
      const pinnedId = store[PINNED_TAB_KEY]?.tabId;
      const agentGroupId = await getAgentGroupId();
      return tabs.map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        active: t.active,
        windowId: t.windowId,
        status: t.status,
        groupId: t.groupId,
      }));
    },

    async create(url: string, options?: { active?: boolean; newWindow?: boolean; grouped?: boolean }): Promise<BrowserTab> {
      const validUrl = url || "about:blank";
      let tab;
      if (options?.newWindow === true) {
        const win = await chrome.windows.create({ url: validUrl, focused: options?.active !== false });
        tab = win.tabs?.[0] ?? (await chrome.tabs.query({ windowId: win.id }))[0];
        if (!tab) throw new Error("Failed to resolve the tab of the newly created window.");
      } else {
        tab = await chrome.tabs.create({ url: validUrl, active: options?.active !== false });
      }

      const groupId = options?.grouped === false || options?.newWindow === true ? null : await addTabToAgentGroup(tab.id);
      await waitForTabComplete(tab.id, 20000);
      const updated = await chrome.tabs.get(tab.id);
      return {
        id: updated.id,
        url: updated.url,
        title: updated.title,
        active: updated.active,
        windowId: updated.windowId,
        status: updated.status,
        groupId: updated.groupId,
      };
    },

    async get(tabId: number): Promise<BrowserTab> {
      const tab = await chrome.tabs.get(tabId);
      return {
        id: tab.id,
        url: tab.url,
        title: tab.title,
        active: tab.active,
        windowId: tab.windowId,
        status: tab.status,
        groupId: tab.groupId,
      };
    },

    async close(tabId: number): Promise<void> {
      await chrome.tabs.remove(tabId);
    },

    async update(tabId: number, options: { url?: string }): Promise<void> {
      await chrome.tabs.update(tabId, options);
    },

    async goBack(tabId: number): Promise<void> {
      await chrome.tabs.goBack(tabId);
    },

    async goForward(tabId: number): Promise<void> {
      await chrome.tabs.goForward(tabId);
    },

    async query(filter: any): Promise<BrowserTab[]> {
      const tabs = await chrome.tabs.query(filter);
      return tabs.map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        active: t.active,
        windowId: t.windowId,
        status: t.status,
        groupId: t.groupId,
      }));
    },
  },

  scripting: {
    async executeScript(tabId: number, func: Function, args?: any[]): Promise<any> {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: func as any,
        args: args || [],
      });
      return result;
    },
  },

  async screenshot(tabId: number, options?: { fullPage?: boolean }): Promise<any> {
    let newlyAttached = false;
    try {
      const attached = await cdpEnsureAttached(tabId);
      newlyAttached = attached.newlyAttached;
      const result = await cdpSend(tabId, "Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: options?.fullPage === true,
      });
      return { imageData: result.data, mimeType: "image/png" };
    } catch (e) {
      console.warn("[figma-overlay:adapter] debugger screenshot failed, falling back:", (e as Error).message);
      const tab = await chrome.tabs.get(tabId);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      return { imageData: dataUrl.replace("data:image/png;base64,", ""), mimeType: "image/png" };
    } finally {
      if (newlyAttached) {
        await cdpMaybeDetach(tabId);
      }
    }
  },

  async sendToContentScript(tabId: number, command: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { command, params }, (response) => {
        if (chrome.runtime.lastError) {
          reject(
            new Error(
              `Content script unavailable: ${chrome.runtime.lastError.message}. ` +
                "Try reloading the page or navigating away from a restricted URL (chrome://, file://).",
            ),
          );
          return;
        }
        if (response?.error) reject(new Error(response.error));
        else resolve(response);
      });
    });
  },

  cdp: {
    ensureAttached,
    send: cdpSend,
    click: cdpClick,
    hover: cdpHover,
    scroll: cdpScroll,
    typeText: cdpTypeText,
    pressKey: cdpPressKey,
    evaluate: cdpEvaluate,
    querySelector: cdpQuerySelector,
    focusBackendNode: cdpFocusBackendNode,
    resolveAXNode: cdpResolveAXNode,
    highlightNode: cdpHighlightNode,
    clearHighlight: cdpClearHighlight,
    getAXTree: cdpGetAXTree,
    applyEmulation: cdpApplyEmulation,
    clearEmulation: cdpClearEmulation,
    clearAllEmulation: cdpClearAllEmulation,
    maybeDetach: cdpMaybeDetach,
    reapplyOverrides: cdpReapplyOverrides,
    ensureMonitoring: cdpEnsureMonitoring,
    startInterception: cdpStartInterception,
    stopInterception: cdpStopInterception,
    listPendingInterceptions,
    fulfillRequest: cdpFulfillRequest,
    failRequest: cdpFailRequest,
    continueRequest: cdpContinueRequest,
    clearStorage: cdpClearStorage,
    captureMhtml: cdpCaptureMhtml,
    setEmulatedMedia: cdpSetEmulatedMedia,
    setNetworkConditions: cdpSetNetworkConditions,
    setGeolocation: cdpSetGeolocation,
    setTimezone: cdpSetTimezone,
    setCpuThrottling: cdpSetCpuThrottling,
    getTabState,
  },

  buffers: {
    async readConsoleBuffer(tabId: number, options?: any): Promise<any> {
      return readConsoleBuffer(tabId, options);
    },
    async clearConsoleBuffer(tabId: number): Promise<void> {
      await clearConsoleBuffer(tabId);
    },
    async readNetworkBuffer(tabId: number, options?: any): Promise<any> {
      return readNetworkBuffer(tabId, options);
    },
    async clearNetworkBuffer(tabId: number): Promise<void> {
      await clearNetworkBuffer(tabId);
    },
  },

  storage: {
    async resolveTargetTab(params: any): Promise<BrowserTab> {
      // 1. Explicit tabId from caller wins.
      if (params && typeof params.tabId === "number") {
        try {
          const tab = await chrome.tabs.get(params.tabId);
          if (tab) {
            return {
              id: tab.id,
              url: tab.url,
              title: tab.title,
              active: tab.active,
              windowId: tab.windowId,
              status: tab.status,
              groupId: tab.groupId,
            };
          }
        } catch (e) {
          throw new Error(`Tab ${params.tabId} not found: ${(e as Error).message}`);
        }
      }

      // 2. Pinned tab (set via popup) wins over focus.
      const store = await chrome.storage.session.get(PINNED_TAB_KEY);
      const pinned = store[PINNED_TAB_KEY];
      if (pinned && typeof pinned.tabId === "number") {
        try {
          const tab = await chrome.tabs.get(pinned.tabId);
          if (tab) {
            return {
              id: tab.id,
              url: tab.url,
              title: tab.title,
              active: tab.active,
              windowId: tab.windowId,
              status: tab.status,
              groupId: tab.groupId,
            };
          }
        } catch {
          await chrome.storage.session.remove(PINNED_TAB_KEY);
        }
      }

      // 3. Fallback: whatever is active in the focused window.
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error("No active tab found and no pinned tab configured");
      return {
        id: tab.id,
        url: tab.url,
        title: tab.title,
        active: tab.active,
        windowId: tab.windowId,
        status: tab.status,
        groupId: tab.groupId,
      };
    },
  },

  windows: {
    async update(windowId: number, options: any): Promise<void> {
      await chrome.windows.update(windowId, options);
    },
  },

  tabGroups: {
    async getAgentGroupId(): Promise<number | null> {
      return getAgentGroupId();
    },
    async addTabToAgentGroup(tabId: number): Promise<number | null> {
      return addTabToAgentGroup(tabId);
    },
    async closeAgentGroup(): Promise<{ closed: number }> {
      const groupId = await getAgentGroupId();
      if (groupId == null) return { closed: 0 };
      const tabs = await chrome.tabs.query({ groupId });
      const ids = tabs.map((t) => t.id).filter((id) => typeof id === "number");
      if (ids.length) await chrome.tabs.remove(ids);
      await chrome.storage.session.remove(AGENT_GROUP_KEY);
      return { closed: ids.length };
    },
  },
};
