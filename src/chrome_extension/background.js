// background.js — MV3 service worker
// Maintains a persistent WebSocket on the "browser" channel and dispatches
// incoming MCP commands to the active tab via content.js or Chrome APIs.

importScripts("config.js", "cdp.js", "commands.js", "adapter-extension.js");

const BROWSER_CHANNEL = "browser";
const RECONNECT_DELAY_MS = 3000;

let inboundWs = null;
let joined = false;
let currentWsUrl = null;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[SERVER_STORAGE_KEY] || changes[BROWSER_LABEL_STORAGE_KEY])) {
    // Re-joining is how a renamed browser gets its new label to the relay.
    console.log("[figma-overlay:bg] Server/identity config changed, reconnecting");
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

  // Both awaits happen BEFORE the socket is constructed: the relay rejects an
  // extension join without a browserId, so the identity must be in hand at
  // join time — never sent late.
  const [serverUrl, identity] = await Promise.all([getServerUrl(), getBrowserIdentity()]);
  // A second connectInbound() may have raced through the await above and already
  // created a socket. Re-check so we don't clobber inboundWs with a duplicate —
  // the clobbered-but-still-CONNECTING socket is what caused the "Failed to
  // execute 'send' on 'WebSocket': Still in CONNECTING state" errors.
  if (inboundWs && (inboundWs.readyState === WebSocket.OPEN || inboundWs.readyState === WebSocket.CONNECTING)) {
    return;
  }
  currentWsUrl = toWsUrl(serverUrl);
  // Capture the socket in a local so every handler acts on ITS OWN instance,
  // never the mutable global (which a later reconnect may have reassigned).
  const ws = new WebSocket(currentWsUrl);
  inboundWs = ws;
  joined = false;

  ws.onopen = () => {
    // A newer socket superseded this one during the reconnect window — abandon it.
    if (inboundWs !== ws) {
      try {
        ws.close();
      } catch {}
      return;
    }
    console.log("[figma-overlay:bg] WS open →", currentWsUrl, "as", identity.label, `(${identity.id})`);
    ws.send(
      JSON.stringify({
        type: "join",
        channel: BROWSER_CHANNEL,
        clientType: "extension",
        browserId: identity.id,
        browserLabel: identity.label,
      }),
    );
  };

  ws.onmessage = async (evt) => {
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
        const result = await commandHandler(command, params ?? {});
        respond(id, { result });
      } catch (err) {
        respond(id, { error: err.message });
      }
    }
  };

  ws.onclose = (e) => {
    // Only tear down global state if this is still the active socket; a superseded
    // orphan closing must not null out the live connection or double-schedule.
    if (inboundWs !== ws) return;
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

  ws.onerror = (e) => {
    // Transient connect/reconnect blips surface here (e.g. the socket server
    // restarting). Log at warn — the onclose handler drives the actual reconnect.
    console.warn("[figma-overlay:bg] WS error (will reconnect)", e?.type || e);
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

// Note: Tab resolution and command dispatch are now in commands.ts and adapter-extension.ts
const PINNED_TAB_KEY = "pinnedTab";

// --- Command dispatcher (using extracted handler) ---

const commandHandler = createCommandHandler(extensionAdapter);

// Note: All helper functions (interaction, tab management, screenshots, viewport)
// are now in commands.ts and adapter-extension.ts

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
