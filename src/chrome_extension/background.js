// background.js — MV3 service worker
// Maintains a persistent WebSocket on the "browser" channel and dispatches
// incoming MCP commands to the active tab via content.js or Chrome APIs.

const WS_URL = 'ws://localhost:3055';
const BROWSER_CHANNEL = 'browser';
const RECONNECT_DELAY_MS = 3000;

let inboundWs = null;
let joined = false;

function setBadge(connected) {
  chrome.action.setBadgeText({ text: ' ' });
  chrome.action.setBadgeBackgroundColor({ color: connected ? '#4caf50' : '#e53935' });
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

function connectInbound() {
  if (inboundWs && (inboundWs.readyState === WebSocket.OPEN || inboundWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  inboundWs = new WebSocket(WS_URL);
  joined = false;

  inboundWs.onopen = () => {
    inboundWs.send(JSON.stringify({ type: 'join', channel: BROWSER_CHANNEL }));
    setBadge(false);
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

  inboundWs.onclose = () => {
    inboundWs = null;
    joined = false;
    setBadge(false);
    console.log('[figma-overlay:bg] WS closed, reconnecting in', RECONNECT_DELAY_MS, 'ms');
    setTimeout(connectInbound, RECONNECT_DELAY_MS);
  };

  inboundWs.onerror = () => {
    // onclose will fire after onerror; reconnect handled there
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

// --- Command dispatcher ---

async function handleBrowserCommand(command, params) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab found');

  switch (command) {
    case 'get_dom_nodes':
    case 'get_computed_styles':
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
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      return { imageData: dataUrl.replace('data:image/png;base64,', ''), mimeType: 'image/png' };
    }

    case 'get_page_info':
      return { url: tab.url, title: tab.title, tabId: tab.id };

    default:
      throw new Error(`Unknown browser command: ${command}`);
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
});

chrome.tabs.onRemoved.addListener((tabId) => { detachDebuggerForTab(tabId); });

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
