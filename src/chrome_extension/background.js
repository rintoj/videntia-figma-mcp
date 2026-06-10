// background.js — MV3 service worker
// Maintains a persistent WebSocket on the "browser" channel and dispatches
// incoming MCP commands to the active tab via content.js or Chrome APIs.

importScripts('config.js');

const BROWSER_CHANNEL = 'browser';
const RECONNECT_DELAY_MS = 3000;

let inboundWs = null;
let joined = false;
let currentWsUrl = null;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SERVER_STORAGE_KEY]) {
    console.log('[figma-overlay:bg] Server config changed, reconnecting');
    if (inboundWs) {
      try { inboundWs.close(); } catch {}
    }
    connectInbound();
  }
});

let lastBadge = null;
function setBadge(connected) {
  if (lastBadge === connected) return;
  lastBadge = connected;
  chrome.action.setBadgeText({ text: '' });
  const suffix = connected ? '' : '-off';
  chrome.action.setIcon({
    path: {
      16:  `icon16${suffix}.png`,
      48:  `icon48${suffix}.png`,
      128: `icon128${suffix}.png`,
    },
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('[figma-overlay:bg] setIcon error:', chrome.runtime.lastError.message);
    } else {
      console.log('[figma-overlay:bg] icon →', connected ? 'connected' : 'disconnected');
    }
  });
}

// --- Keep-alive: Chrome MV3 won't kill a service worker with an open WS,
//     but we use an alarm as a safety net for the reconnect window.
chrome.alarms.create('ws-keepalive', { periodInMinutes: 0.4 }); // ~24s
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'ws-keepalive') connectInbound();
});

chrome.runtime.onInstalled.addListener(() => { setBadge(false); connectInbound(); });
chrome.runtime.onStartup.addListener(() => { setBadge(false); connectInbound(); });
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
    console.log('[figma-overlay:bg] WS open →', currentWsUrl);
    inboundWs.send(JSON.stringify({ type: 'join', channel: BROWSER_CHANNEL }));
  };

  inboundWs.onmessage = async (evt) => {
    let data;
    try { data = JSON.parse(evt.data); } catch { return; }

    // Join confirmation
    if (!joined && data.type === 'system' && typeof data.message === 'object' && data.message?.result) {
      joined = true;
      setBadge(true);
      console.log('[figma-overlay:bg] Joined browser channel');
      return;
    }

    // Incoming command from MCP server
    if ((data.type === 'message' || data.type === 'broadcast') && data.message?.command) {
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
    console.warn('[figma-overlay:bg] WS closed', { code: e?.code, reason: e?.reason }, 'reconnect in', RECONNECT_DELAY_MS, 'ms');
    setTimeout(connectInbound, RECONNECT_DELAY_MS);
  };

  inboundWs.onerror = (e) => {
    console.error('[figma-overlay:bg] WS error', e);
  };

}

function respond(id, payload) {
  if (!inboundWs || inboundWs.readyState !== WebSocket.OPEN) return;
  inboundWs.send(JSON.stringify({
    id,
    type: 'message',
    channel: BROWSER_CHANNEL,
    message: { id, ...payload },
  }));
}

// --- Tab resolution ---
//
// Priority: explicit params.tabId → pinned tab (storage.session) → active tab.
// This prevents commands from leaking onto whichever tab happens to be focused
// when the user has bound a specific tab to the Figma session.

const PINNED_TAB_KEY = 'pinnedTab';

async function resolveTargetTab(params) {
  // 1. Explicit tabId from caller wins.
  if (params && typeof params.tabId === 'number') {
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
  if (pinned && typeof pinned.tabId === 'number') {
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
  if (!tab) throw new Error('No active tab found and no pinned tab configured');
  return tab;
}

// --- Command dispatcher ---

async function handleBrowserCommand(command, params) {
  const tab = await resolveTargetTab(params);

  switch (command) {
    case 'get_dom_nodes':
    case 'get_computed_styles':
    case 'resolve_selector_at_point':
    case 'collect_all_element_rects':
      return sendToContentScript(tab.id, command, params);

    case 'inject_figma_overlay': {
      // Match the popup flow: resize window to the design width, or fall back
      // to debugger-based viewport emulation when below Chrome's window minimum.
      if (params?.width && params?.height) {
        try {
          await resizeOrEmulate(tab, params.width, params.height);
        } catch (e) {
          console.warn('[figma-overlay:bg] resize/emulate failed:', e.message);
        }
      }
      return sendToContentScript(tab.id, command, params);
    }

    case 'clear_figma_overlay': {
      await detachDebuggerForTab(tab.id);
      return sendToContentScript(tab.id, command, params);
    }

    case 'get_page_screenshot': {
      // Use chrome.debugger Page.captureScreenshot so the target tab does not
      // need to be focused. captureVisibleTab is bound to the active tab in
      // the given window and cannot screenshot background tabs.
      return captureScreenshotViaDebugger(tab);
    }

    case 'get_page_info':
      return { url: tab.url, title: tab.title, tabId: tab.id };

    default:
      throw new Error(`Unknown browser command: ${command}`);
  }
}

// --- Screenshot via debugger (works on non-focused tabs) ---

async function captureScreenshotViaDebugger(tab) {
  const target = { tabId: tab.id };
  const store = await chrome.storage.session.get(ATTACHED_TABS_KEY);
  const attached = store[ATTACHED_TABS_KEY] || {};
  const alreadyAttached = !!attached[tab.id];

  try {
    if (!alreadyAttached) {
      await chrome.debugger.attach(target, '1.3');
    }
    const result = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    return { imageData: result.data, mimeType: 'image/png' };
  } catch (e) {
    // Fall back to captureVisibleTab if debugger attach fails (e.g. user
    // declined the debugger warning bar).
    console.warn('[figma-overlay:bg] debugger screenshot failed, falling back:', e.message);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { imageData: dataUrl.replace('data:image/png;base64,', ''), mimeType: 'image/png' };
  } finally {
    // Only detach if we attached just for this screenshot — preserve the
    // attachment when viewport emulation is in use.
    if (!alreadyAttached) {
      try { await chrome.debugger.detach(target); } catch {}
    }
  }
}

// --- Viewport resize / debugger emulation ---

const WINDOW_MIN_W = 500;
const ATTACHED_TABS_KEY = 'attachedDebuggerTabs';

async function resizeOrEmulate(tab, frameWidth, frameHeight) {
  const [{ result: chromeOffset }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      w: window.outerWidth - window.innerWidth,
      h: window.outerHeight - window.innerHeight,
      maxW: window.screen.availWidth,
      maxH: window.screen.availHeight,
    }),
  });

  const outerW = frameWidth + chromeOffset.w;
  const outerH = frameHeight + chromeOffset.h;
  const needsEmulation = outerW < WINDOW_MIN_W;

  const winW = needsEmulation
    ? WINDOW_MIN_W
    : Math.min(outerW, chromeOffset.maxW);
  const winH = Math.min(outerH, chromeOffset.maxH);
  await chrome.windows.update(tab.windowId, { width: winW, height: winH });

  if (needsEmulation) {
    await attachDebuggerAndEmulate(tab.id, frameWidth, frameHeight);
  } else {
    await detachDebuggerForTab(tab.id);
  }
}

async function attachDebuggerAndEmulate(tabId, width, height) {
  const target = { tabId };
  const store = await chrome.storage.session.get(ATTACHED_TABS_KEY);
  const attached = store[ATTACHED_TABS_KEY] || {};
  if (!attached[tabId]) {
    await chrome.debugger.attach(target, '1.3');
    attached[tabId] = true;
    await chrome.storage.session.set({ [ATTACHED_TABS_KEY]: attached });
  }
  await chrome.debugger.sendCommand(target, 'Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 2, mobile: true,
  });
  await chrome.debugger.sendCommand(target, 'Emulation.setTouchEmulationEnabled', {
    enabled: true,
  });
}

async function detachDebuggerForTab(tabId) {
  const store = await chrome.storage.session.get(ATTACHED_TABS_KEY);
  const attached = store[ATTACHED_TABS_KEY] || {};
  if (!attached[tabId]) return;
  try { await chrome.debugger.sendCommand({ tabId }, 'Emulation.clearDeviceMetricsOverride'); } catch {}
  try { await chrome.debugger.detach({ tabId }); } catch {}
  delete attached[tabId];
  await chrome.storage.session.set({ [ATTACHED_TABS_KEY]: attached });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'detachDebugger') {
    const tabId = msg.tabId ?? sender.tab?.id;
    if (tabId != null) detachDebuggerForTab(tabId).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg?.type === 'pinTab') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        sendResponse({ ok: false, error: 'No active tab to pin' });
        return;
      }
      const pinned = { tabId: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title };
      await chrome.storage.session.set({ [PINNED_TAB_KEY]: pinned });
      sendResponse({ ok: true, pinned });
    })();
    return true;
  }

  if (msg?.type === 'unpinTab') {
    (async () => {
      await chrome.storage.session.remove(PINNED_TAB_KEY);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg?.type === 'getPinnedTab') {
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
  detachDebuggerForTab(tabId);
  clearOverlayStateForTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    clearOverlayStateForTab(tabId);
  }
});

async function clearOverlayStateForTab(tabId) {
  const all = (await chrome.storage.session.get('overlayState'))['overlayState'] || {};
  if (all[tabId]) {
    delete all[tabId];
    await chrome.storage.session.set({ overlayState: all });
  }
}

function sendToContentScript(tabId, command, params) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { command, params }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(
          `Content script unavailable: ${chrome.runtime.lastError.message}. ` +
          'Try reloading the page or navigating away from a restricted URL (chrome://, file://).'
        ));
        return;
      }
      if (response?.error) reject(new Error(response.error));
      else resolve(response);
    });
  });
}
