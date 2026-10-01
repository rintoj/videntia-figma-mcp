/**
 * adapter-extension.js — Chrome extension implementation of BrowserAdapter.
 *
 * This adapter wraps chrome.* APIs and CDP operations to match the BrowserAdapter
 * interface, enabling the command handler to work in the extension environment.
 */

const PINNED_TAB_KEY = "pinnedTab";
const AGENT_GROUP_KEY = "agentTabGroup";
const AGENT_GROUP_TITLE = "Videntia";
const AGENT_GROUP_COLOR = "purple";
const WINDOW_MIN_W = 500;

// --- Helpers for tab management ---

async function getAgentGroupId() {
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

async function addTabToAgentGroup(tabId) {
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
    console.warn("[figma-overlay:adapter] tab grouping failed:", e.message);
    return null;
  }
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
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
    const listener = (id, info) => {
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

async function resizeOrEmulate(tab, frameWidth, frameHeight, opts = {}) {
  const [{ result: chromeOffset }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      w: window.outerWidth - window.innerWidth,
      h: window.outerHeight - window.innerHeight,
      maxW: window.screen.availWidth,
      maxH: window.screen.availHeight,
      availLeft: window.screen.availLeft ?? 0,
      availTop: window.screen.availTop ?? 0,
    }),
  });

  const outerW = frameWidth + chromeOffset.w;
  const outerH = frameHeight + chromeOffset.h;
  const needsEmulation = opts.forceEmulation === true || outerW < WINDOW_MIN_W;

  const winW = Math.floor(needsEmulation ? WINDOW_MIN_W : Math.min(outerW, chromeOffset.maxW));
  const winH = Math.floor(Math.min(outerH, chromeOffset.maxH));
  await chrome.windows.update(tab.windowId, {
    width: winW,
    height: winH,
    left: chromeOffset.availLeft,
    top: chromeOffset.availTop,
  });

  if (needsEmulation) {
    await cdpApplyEmulation(tab.id, {
      width: frameWidth,
      height: frameHeight,
      deviceScaleFactor: opts.deviceScaleFactor ?? 2,
    });
  } else {
    await cdpClearEmulation(tab.id);
    await cdpMaybeDetach(tab.id);
  }
  return { emulated: needsEmulation, windowWidth: winW, windowHeight: winH };
}

/**
 * Chrome extension implementation of BrowserAdapter.
 * Uses chrome.* APIs and imported CDP functions.
 */
const extensionAdapter = {
  tabs: {
    async list() {
      const tabs = await chrome.tabs.query({});
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

    async create(url, options = {}) {
      const validUrl = url || "about:blank";
      let tab;
      if (options.newWindow === true) {
        const win = await chrome.windows.create({ url: validUrl, focused: options.active !== false });
        tab = win.tabs?.[0] ?? (await chrome.tabs.query({ windowId: win.id }))[0];
        if (!tab) throw new Error("Failed to resolve the tab of the newly created window.");
      } else {
        tab = await chrome.tabs.create({ url: validUrl, active: options.active !== false });
      }

      const groupId = options.grouped === false || options.newWindow === true ? null : await addTabToAgentGroup(tab.id);
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

    async get(tabId) {
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

    async close(tabId) {
      await chrome.tabs.remove(tabId);
    },

    async update(tabId, options) {
      await chrome.tabs.update(tabId, options);
    },

    async goBack(tabId) {
      await chrome.tabs.goBack(tabId);
    },

    async goForward(tabId) {
      await chrome.tabs.goForward(tabId);
    },

    async query(filter) {
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
    async executeScript(tabId, func, args = []) {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func,
        args,
      });
      return result;
    },
  },

  async screenshot(tabId, options = {}) {
    let newlyAttached = false;
    try {
      const attached = await cdpEnsureAttached(tabId);
      newlyAttached = attached.newlyAttached;
      const result = await cdpSend(tabId, "Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: options.fullPage === true,
      });
      return { imageData: result.data, mimeType: "image/png" };
    } catch (e) {
      console.warn("[figma-overlay:adapter] debugger screenshot failed, falling back:", e.message);
      const tab = await chrome.tabs.get(tabId);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      return { imageData: dataUrl.replace("data:image/png;base64,", ""), mimeType: "image/png" };
    } finally {
      if (newlyAttached) {
        await cdpMaybeDetach(tabId);
      }
    }
  },

  async sendToContentScript(tabId, command, params) {
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
    ensureAttached: cdpEnsureAttached,
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
    async readConsoleBuffer(tabId, options) {
      return readConsoleBuffer(tabId, options);
    },
    async clearConsoleBuffer(tabId) {
      await clearConsoleBuffer(tabId);
    },
    async readNetworkBuffer(tabId, options) {
      return readNetworkBuffer(tabId, options);
    },
    async clearNetworkBuffer(tabId) {
      await clearNetworkBuffer(tabId);
    },
  },

  storage: {
    async resolveTargetTab(params) {
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
          throw new Error(`Tab ${params.tabId} not found: ${e.message}`);
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
    async update(windowId, options) {
      await chrome.windows.update(windowId, options);
    },
  },

  tabGroups: {
    async getAgentGroupId() {
      return getAgentGroupId();
    },
    async addTabToAgentGroup(tabId) {
      return addTabToAgentGroup(tabId);
    },
    async closeAgentGroup() {
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
