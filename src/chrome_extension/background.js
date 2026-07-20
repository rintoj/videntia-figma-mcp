// background.js — MV3 service worker
// Maintains a persistent WebSocket on the "browser" channel and dispatches
// incoming MCP commands to the active tab via content.js or Chrome APIs.

importScripts("config.js", "cdp.js");

const BROWSER_CHANNEL = "browser";
const RECONNECT_DELAY_MS = 3000;

let inboundWs = null;
let joined = false;
let currentWsUrl = null;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[SERVER_STORAGE_KEY]) {
    console.log("[figma-overlay:bg] Server config changed, reconnecting");
    if (inboundWs) {
      try {
        inboundWs.close();
      } catch {}
    }
    connectInbound();
  }
});

let lastBadge = null;
function setBadge(connected) {
  if (lastBadge === connected) return;
  lastBadge = connected;
  chrome.action.setBadgeText({ text: "" });
  const suffix = connected ? "" : "-off";
  chrome.action.setIcon(
    {
      path: {
        16: `icon16${suffix}.png`,
        48: `icon48${suffix}.png`,
        128: `icon128${suffix}.png`,
      },
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error("[figma-overlay:bg] setIcon error:", chrome.runtime.lastError.message);
      } else {
        console.log("[figma-overlay:bg] icon →", connected ? "connected" : "disconnected");
      }
    },
  );
}

// --- Keep-alive: Chrome MV3 won't kill a service worker with an open WS,
//     but we use an alarm as a safety net for the reconnect window.
chrome.alarms.create("ws-keepalive", { periodInMinutes: 0.4 }); // ~24s
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "ws-keepalive") connectInbound();
});

chrome.runtime.onInstalled.addListener(() => {
  setBadge(false);
  connectInbound();
});
chrome.runtime.onStartup.addListener(() => {
  setBadge(false);
  connectInbound();
});
setBadge(false);
connectInbound();

// --- Persistent inbound WebSocket ---

async function connectInbound() {
  if (inboundWs && (inboundWs.readyState === WebSocket.OPEN || inboundWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const serverUrl = await getServerUrl();
  currentWsUrl = toWsUrl(serverUrl);
  inboundWs = new WebSocket(currentWsUrl);
  joined = false;

  inboundWs.onopen = () => {
    console.log("[figma-overlay:bg] WS open →", currentWsUrl);
    inboundWs.send(JSON.stringify({ type: "join", channel: BROWSER_CHANNEL, clientType: "extension" }));
  };

  inboundWs.onmessage = async (evt) => {
    let data;
    try {
      data = JSON.parse(evt.data);
    } catch {
      return;
    }

    // Join confirmation
    if (!joined && data.type === "system" && typeof data.message === "object" && data.message?.result) {
      joined = true;
      setBadge(true);
      console.log("[figma-overlay:bg] Joined browser channel");
      return;
    }

    // Incoming command from MCP server
    if ((data.type === "message" || data.type === "broadcast") && data.message?.command) {
      const { id, command, params } = data.message;
      try {
        const result = await handleBrowserCommand(command, params ?? {});
        respond(id, { result });
      } catch (err) {
        respond(id, { error: err.message });
      }
    }
  };

  inboundWs.onclose = (e) => {
    inboundWs = null;
    joined = false;
    setBadge(false);
    console.warn(
      "[figma-overlay:bg] WS closed",
      { code: e?.code, reason: e?.reason },
      "reconnect in",
      RECONNECT_DELAY_MS,
      "ms",
    );
    setTimeout(connectInbound, RECONNECT_DELAY_MS);
  };

  inboundWs.onerror = (e) => {
    console.error("[figma-overlay:bg] WS error", e);
  };
}

function respond(id, payload) {
  if (!inboundWs || inboundWs.readyState !== WebSocket.OPEN) return;
  inboundWs.send(
    JSON.stringify({
      id,
      type: "message",
      channel: BROWSER_CHANNEL,
      message: { id, ...payload },
    }),
  );
}

// --- Tab resolution ---
//
// Priority: explicit params.tabId → pinned tab (storage.session) → active tab.
// This prevents commands from leaking onto whichever tab happens to be focused
// when the user has bound a specific tab to the Figma session.

const PINNED_TAB_KEY = "pinnedTab";

async function resolveTargetTab(params) {
  // 1. Explicit tabId from caller wins.
  if (params && typeof params.tabId === "number") {
    try {
      const tab = await chrome.tabs.get(params.tabId);
      if (tab) return tab;
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
      if (tab) return tab;
    } catch {
      // Pinned tab is gone — clear and fall through.
      await chrome.storage.session.remove(PINNED_TAB_KEY);
    }
  }

  // 3. Fallback: whatever is active in the focused window.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab found and no pinned tab configured");
  return tab;
}

// --- Command dispatcher ---

async function handleBrowserCommand(command, params) {
  // Tab-independent commands first — no target resolution needed.
  switch (command) {
    case "list_tabs":
      return listTabs();
    case "create_tab":
      return createTab(params);
    case "close_tab":
      return closeTab(params);
    case "close_group":
      return closeAgentGroup();
  }

  const tab = await resolveTargetTab(params);

  switch (command) {
    case "get_dom_nodes":
    case "get_computed_styles":
    case "get_computed_styles_batch":
    case "resolve_selector_at_point":
    case "collect_all_element_rects":
      return sendToContentScript(tab.id, command, params);

    case "inject_figma_overlay": {
      // Match the popup flow: resize window to the design width, or fall back
      // to debugger-based viewport emulation when below Chrome's window minimum.
      if (params?.width && params?.height) {
        try {
          await resizeOrEmulate(tab, params.width, params.height);
        } catch (e) {
          console.warn("[figma-overlay:bg] resize/emulate failed:", e.message);
        }
      }
      return sendToContentScript(tab.id, command, params);
    }

    case "clear_figma_overlay": {
      await cdpClearEmulation(tab.id);
      await cdpMaybeDetach(tab.id);
      return sendToContentScript(tab.id, command, params);
    }

    case "get_page_screenshot": {
      // Use chrome.debugger Page.captureScreenshot so the target tab does not
      // need to be focused. captureVisibleTab is bound to the active tab in
      // the given window and cannot screenshot background tabs.
      return captureScreenshotViaDebugger(tab, { fullPage: params?.fullPage === true });
    }

    case "set_viewport": {
      // First-class viewport control. Widths below Chrome's window minimum (or
      // forceEmulation) use CDP Emulation.setDeviceMetricsOverride — a true
      // mobile viewport with touch emulation. Note: emulation resets on
      // navigation; callers must re-apply after navigate.
      const width = Number(params?.width);
      const height = Number(params?.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error("set_viewport requires positive numeric width and height");
      }
      const result = await resizeOrEmulate(tab, width, height, {
        forceEmulation: params?.forceEmulation === true,
        deviceScaleFactor: typeof params?.deviceScaleFactor === "number" ? params.deviceScaleFactor : undefined,
      });
      return { success: true, tabId: tab.id, width, height, ...result };
    }

    case "reset_viewport": {
      await cdpClearEmulation(tab.id);
      await cdpMaybeDetach(tab.id);
      return { success: true, tabId: tab.id };
    }

    case "get_page_info":
      return { url: tab.url, title: tab.title, tabId: tab.id };

    // --- Interaction (CDP input) ---

    case "click": {
      await cdpEnsureAttached(tab.id);
      const point = await resolveInteractionPoint(tab, params);
      await cdpClick(tab.id, point.x, point.y, {
        button: params?.button || "left",
        clickCount: params?.clickCount || 1,
      });
      return { success: true, tabId: tab.id, ...point };
    }

    case "hover": {
      await cdpEnsureAttached(tab.id);
      const point = await resolveInteractionPoint(tab, params);
      await cdpHover(tab.id, point.x, point.y);
      return { success: true, tabId: tab.id, ...point };
    }

    case "scroll": {
      await cdpEnsureAttached(tab.id);
      let point;
      if (params?.selector || (typeof params?.x === "number" && typeof params?.y === "number")) {
        point = await resolveInteractionPoint(tab, params);
      } else {
        const center = await cdpEvaluate(tab.id, "({x: Math.round(innerWidth/2), y: Math.round(innerHeight/2)})");
        point = center.value;
      }
      const deltaX = Number(params?.deltaX) || 0;
      const deltaY = Number(params?.deltaY) || 0;
      await cdpScroll(tab.id, point.x, point.y, deltaX, deltaY);
      return { success: true, tabId: tab.id, ...point, deltaX, deltaY };
    }

    case "type_text": {
      await cdpEnsureAttached(tab.id);
      const clearFirst = params?.clearFirst === true;
      if (params?.selector) {
        const r = await sendToContentScript(tab.id, "prepare_element_for_interaction", {
          selector: params.selector,
          focus: true,
          select: clearFirst,
        });
        if (!r?.found) throw new Error(`No element matches selector: ${params.selector}`);
        if (clearFirst && !r.selected) await selectAllViaKeyboard(tab.id);
      } else if (clearFirst) {
        await selectAllViaKeyboard(tab.id);
      }
      if (typeof params?.text !== "string") throw new Error("type_text requires a text string");
      await cdpTypeText(tab.id, params.text);
      return { success: true, tabId: tab.id, typed: params.text.length };
    }

    case "press_key": {
      await cdpEnsureAttached(tab.id);
      if (!params?.key) throw new Error("press_key requires a key name");
      await cdpPressKey(tab.id, params.key, params.modifiers || []);
      return { success: true, tabId: tab.id, key: params.key };
    }

    case "evaluate_js": {
      await cdpEnsureAttached(tab.id);
      if (typeof params?.expression !== "string" || !params.expression.trim()) {
        throw new Error("evaluate_js requires a non-empty expression string");
      }
      const result = await cdpEvaluate(tab.id, params.expression, {
        timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
      });
      return { tabId: tab.id, ...result };
    }

    // --- Navigation ---

    case "navigate": {
      const url = validateNavigationUrl(params?.url);
      const emulation = await cdpGetEmulation(tab.id);
      await chrome.tabs.update(tab.id, { url });
      await waitForTabComplete(tab.id, 30000);
      // CDP device emulation does not reliably survive cross-page navigation.
      if (emulation) await cdpApplyEmulation(tab.id, emulation);
      const updated = await chrome.tabs.get(tab.id);
      return { success: true, tabId: tab.id, url: updated.url, title: updated.title };
    }

    case "go_back":
    case "go_forward": {
      try {
        if (command === "go_back") await chrome.tabs.goBack(tab.id);
        else await chrome.tabs.goForward(tab.id);
      } catch (e) {
        throw new Error(`Cannot ${command === "go_back" ? "go back" : "go forward"}: ${e.message}`);
      }
      await waitForTabComplete(tab.id, 15000);
      const emulation = await cdpGetEmulation(tab.id);
      if (emulation) await cdpApplyEmulation(tab.id, emulation);
      const updated = await chrome.tabs.get(tab.id);
      return { success: true, tabId: tab.id, url: updated.url, title: updated.title };
    }

    // --- Observability (console / network buffers) ---

    case "read_console": {
      const { startedNow } = await cdpEnsureMonitoring(tab.id);
      const data = readConsoleBuffer(tab.id, {
        pattern: params?.pattern,
        level: params?.level,
        limit: typeof params?.limit === "number" ? params.limit : undefined,
      });
      if (params?.clear === true) clearConsoleBuffer(tab.id);
      return { tabId: tab.id, monitoringJustStarted: startedNow, ...data };
    }

    case "read_network": {
      const { startedNow } = await cdpEnsureMonitoring(tab.id);
      const data = readNetworkBuffer(tab.id, {
        urlFilter: params?.urlFilter,
        limit: typeof params?.limit === "number" ? params.limit : undefined,
      });
      if (params?.clear === true) clearNetworkBuffer(tab.id);
      return { tabId: tab.id, monitoringJustStarted: startedNow, ...data };
    }

    default:
      throw new Error(`Unknown browser command: ${command}`);
  }
}

// --- Interaction helpers ---

async function resolveInteractionPoint(tab, params, { focus = false, select = false } = {}) {
  if (typeof params?.x === "number" && typeof params?.y === "number") {
    return { x: params.x, y: params.y };
  }
  if (params?.selector) {
    const r = await sendToContentScript(tab.id, "prepare_element_for_interaction", {
      selector: params.selector,
      focus,
      select,
    });
    if (!r?.found) throw new Error(r?.error || `No element matches selector: ${params.selector}`);
    return { x: r.x, y: r.y };
  }
  throw new Error("Provide either a selector or x/y coordinates");
}

async function selectAllViaKeyboard(tabId) {
  const isMac = /Mac/i.test(navigator.userAgent || "");
  await cdpPressKey(tabId, "a", [isMac ? "meta" : "ctrl"]);
}

function validateNavigationUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) throw new Error("navigate requires a url");
  let url = rawUrl.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
  const allowed = /^(https?:|about:blank$)/i;
  if (!allowed.test(url)) {
    throw new Error(`Refusing to navigate to "${url}" — only http(s) URLs and about:blank are allowed.`);
  }
  return url;
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
    // Poll as a safety net: "complete" may already have fired (fast pages,
    // about:blank) before the listener was registered.
    const poll = setInterval(() => {
      chrome.tabs
        .get(tabId)
        .then((t) => {
          if (t.status === "complete") finish();
        })
        .catch(finish); // tab closed mid-navigation
    }, 500);
    const timer = setTimeout(finish, timeoutMs);
  });
}

// --- Tab management ---

// Agent-created tabs are collected into a dedicated Chrome tab group (like the
// official Claude extension does) — a visible "these tabs are being driven"
// boundary in the tab strip, and a one-shot cleanup unit via close_group.
const AGENT_GROUP_KEY = "agentTabGroup";
const AGENT_GROUP_TITLE = "Videntia";
const AGENT_GROUP_COLOR = "purple";

async function getAgentGroupId() {
  const store = await chrome.storage.session.get(AGENT_GROUP_KEY);
  const groupId = store[AGENT_GROUP_KEY];
  if (typeof groupId !== "number") return null;
  try {
    await chrome.tabGroups.get(groupId); // throws if the user closed the group
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
    // Grouping is best-effort (e.g. fails while the user is dragging tabs) —
    // never let it break tab creation.
    console.warn("[figma-overlay:bg] tab grouping failed:", e.message);
    return null;
  }
}

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  const store = await chrome.storage.session.get(PINNED_TAB_KEY);
  const pinnedId = store[PINNED_TAB_KEY]?.tabId;
  const agentGroupId = await getAgentGroupId();
  return {
    agentGroupId,
    tabs: tabs.map((t) => ({
      tabId: t.id,
      url: t.url,
      title: t.title,
      active: t.active,
      windowId: t.windowId,
      pinnedForSession: t.id === pinnedId,
      inAgentGroup: agentGroupId != null && t.groupId === agentGroupId,
    })),
  };
}

async function createTab(params) {
  const url = params?.url ? validateNavigationUrl(params.url) : "about:blank";
  let tab;
  if (params?.newWindow === true) {
    const win = await chrome.windows.create({ url, focused: params?.active !== false });
    tab = win.tabs?.[0] ?? (await chrome.tabs.query({ windowId: win.id }))[0];
    if (!tab) throw new Error("Failed to resolve the tab of the newly created window.");
  } else {
    tab = await chrome.tabs.create({ url, active: params?.active !== false });
  }
  // Tab groups are per-window: joining the existing agent group would move the
  // tab back into the group's window, defeating newWindow. A dedicated window
  // is already visually separated, so skip grouping there.
  const groupId =
    params?.grouped === false || params?.newWindow === true ? null : await addTabToAgentGroup(tab.id);
  await waitForTabComplete(tab.id, 20000);
  const updated = await chrome.tabs.get(tab.id);
  return {
    success: true,
    tabId: updated.id,
    windowId: updated.windowId,
    url: updated.url,
    title: updated.title,
    groupId,
  };
}

async function closeAgentGroup() {
  const groupId = await getAgentGroupId();
  if (groupId == null) return { success: true, closed: 0, note: "No agent tab group exists." };
  const tabs = await chrome.tabs.query({ groupId });
  const ids = tabs.map((t) => t.id).filter((id) => typeof id === "number");
  if (ids.length) await chrome.tabs.remove(ids);
  await chrome.storage.session.remove(AGENT_GROUP_KEY);
  return { success: true, closed: ids.length };
}

async function closeTab(params) {
  if (typeof params?.tabId !== "number") {
    throw new Error("close_tab requires an explicit tabId — refusing to close an implicit target tab.");
  }
  await chrome.tabs.remove(params.tabId);
  return { success: true, tabId: params.tabId };
}

// --- Screenshot via debugger (works on non-focused tabs) ---

async function captureScreenshotViaDebugger(tab, { fullPage = false } = {}) {
  let newlyAttached = false;
  try {
    ({ newlyAttached } = await cdpEnsureAttached(tab.id));
    const result = await cdpSend(tab.id, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: fullPage,
    });
    return { imageData: result.data, mimeType: "image/png" };
  } catch (e) {
    // Fall back to captureVisibleTab if debugger attach fails (e.g. user
    // declined the debugger warning bar).
    console.warn("[figma-overlay:bg] debugger screenshot failed, falling back:", e.message);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    return { imageData: dataUrl.replace("data:image/png;base64,", ""), mimeType: "image/png" };
  } finally {
    // Only detach if we attached just for this screenshot — preserve the
    // session when emulation or console/network monitoring is in use.
    if (newlyAttached) {
      await cdpMaybeDetach(tab.id);
    }
  }
}

// --- Viewport resize / debugger emulation ---

const WINDOW_MIN_W = 500;

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
  // Pin to the work area's origin so the resized window stays on-screen —
  // Chrome rejects bounds that fall >50% off-screen.
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "detachDebugger") {
    const tabId = msg.tabId ?? sender.tab?.id;
    if (tabId != null) cdpDetach(tabId).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg?.type === "pinTab") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        sendResponse({ ok: false, error: "No active tab to pin" });
        return;
      }
      const pinned = { tabId: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title };
      await chrome.storage.session.set({ [PINNED_TAB_KEY]: pinned });
      sendResponse({ ok: true, pinned });
    })();
    return true;
  }

  if (msg?.type === "unpinTab") {
    (async () => {
      await chrome.storage.session.remove(PINNED_TAB_KEY);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg?.type === "getPinnedTab") {
    (async () => {
      const store = await chrome.storage.session.get(PINNED_TAB_KEY);
      sendResponse({ pinned: store[PINNED_TAB_KEY] || null });
    })();
    return true;
  }
});

// Clear pinned tab if it gets closed.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const store = await chrome.storage.session.get(PINNED_TAB_KEY);
  const pinned = store[PINNED_TAB_KEY];
  if (pinned && pinned.tabId === tabId) {
    await chrome.storage.session.remove(PINNED_TAB_KEY);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  cdpDetach(tabId);
  clearOverlayStateForTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    clearOverlayStateForTab(tabId);
    // Fresh page, fresh console. Network history is kept (entries carry URLs
    // and the buffer is capped) so cross-navigation requests stay inspectable.
    clearConsoleBuffer(tabId);
  }
});

async function clearOverlayStateForTab(tabId) {
  const all = (await chrome.storage.session.get("overlayState"))["overlayState"] || {};
  if (all[tabId]) {
    delete all[tabId];
    await chrome.storage.session.set({ overlayState: all });
  }
}

function sendToContentScript(tabId, command, params) {
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
}
