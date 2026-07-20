// cdp.js — Chrome DevTools Protocol session manager for the service worker.
// Owns debugger attach/detach state, viewport emulation, input dispatch,
// JS evaluation, and per-tab console/network capture buffers.
// Loaded via importScripts() in background.js; pure helpers are also exported
// for unit tests via module.exports.

const ATTACHED_TABS_KEY = "attachedDebuggerTabs";
const CONSOLE_BUFFER_MAX = 500;
const NETWORK_BUFFER_MAX = 300;
const EVAL_RESULT_MAX_CHARS = 100000;

// In-memory monitoring state — dies with the service worker, which is fine:
// the WebSocket keep-alive keeps the worker resident while a session is
// active, and buffers lazily re-create when debugger events wake the worker.
const monitoredTabs = new Set();
const consoleBuffers = new Map(); // tabId -> entry[]
const networkBuffers = new Map(); // tabId -> Map(requestId -> entry)

// --- Attach state (storage.session so emulation survives worker restarts) ---

async function getAttachedMap() {
  const store = await chrome.storage.session.get(ATTACHED_TABS_KEY);
  return store[ATTACHED_TABS_KEY] || {};
}

async function setAttachedMap(map) {
  await chrome.storage.session.set({ [ATTACHED_TABS_KEY]: map });
}

async function cdpEnsureAttached(tabId) {
  const attached = await getAttachedMap();
  if (attached[tabId]) return { newlyAttached: false };
  await chrome.debugger.attach({ tabId }, "1.3");
  attached[tabId] = { emulation: null };
  await setAttachedMap(attached);
  return { newlyAttached: true };
}

function cdpSend(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function cdpGetEmulation(tabId) {
  const attached = await getAttachedMap();
  const entry = attached[tabId];
  return entry && typeof entry === "object" ? entry.emulation || null : null;
}

async function cdpApplyEmulation(tabId, { width, height, deviceScaleFactor = 2 }) {
  await cdpEnsureAttached(tabId);
  await cdpSend(tabId, "Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor,
    mobile: true,
  });
  await cdpSend(tabId, "Emulation.setTouchEmulationEnabled", { enabled: true });
  const attached = await getAttachedMap();
  attached[tabId] = { emulation: { width, height, deviceScaleFactor } };
  await setAttachedMap(attached);
}

async function cdpClearEmulation(tabId) {
  const attached = await getAttachedMap();
  if (!attached[tabId]) return;
  try {
    await cdpSend(tabId, "Emulation.clearDeviceMetricsOverride");
  } catch {}
  if (typeof attached[tabId] === "object") {
    attached[tabId].emulation = null;
    await setAttachedMap(attached);
  }
}

async function cdpDetach(tabId) {
  const attached = await getAttachedMap();
  if (attached[tabId]) {
    try {
      await cdpSend(tabId, "Emulation.clearDeviceMetricsOverride");
    } catch {}
    try {
      await chrome.debugger.detach({ tabId });
    } catch {}
    delete attached[tabId];
    await setAttachedMap(attached);
  }
  cdpForgetTab(tabId);
}

// Detach only when nothing needs the session to persist (no emulation, no
// console/network monitoring). Used after one-shot operations like screenshots.
async function cdpMaybeDetach(tabId) {
  if (monitoredTabs.has(tabId)) return;
  const emulation = await cdpGetEmulation(tabId);
  if (emulation) return;
  await cdpDetach(tabId);
}

// Drop in-memory state without touching the debugger (tab closed / detached).
function cdpForgetTab(tabId) {
  monitoredTabs.delete(tabId);
  consoleBuffers.delete(tabId);
  networkBuffers.delete(tabId);
}

// --- Console / network monitoring ---

async function cdpEnsureMonitoring(tabId) {
  await cdpEnsureAttached(tabId);
  if (monitoredTabs.has(tabId)) return { startedNow: false };
  monitoredTabs.add(tabId);
  if (!consoleBuffers.has(tabId)) consoleBuffers.set(tabId, []);
  if (!networkBuffers.has(tabId)) networkBuffers.set(tabId, new Map());
  // Runtime.enable replays recently buffered console messages, so the first
  // read often backfills logs emitted before monitoring started.
  await cdpSend(tabId, "Runtime.enable");
  await cdpSend(tabId, "Log.enable");
  await cdpSend(tabId, "Page.enable");
  await cdpSend(tabId, "Network.enable", { maxPostDataSize: 65536 });
  return { startedNow: true };
}

function pushConsoleEntry(tabId, entry) {
  let buf = consoleBuffers.get(tabId);
  if (!buf) {
    buf = [];
    consoleBuffers.set(tabId, buf);
  }
  buf.push(entry);
  if (buf.length > CONSOLE_BUFFER_MAX) buf.splice(0, buf.length - CONSOLE_BUFFER_MAX);
}

function upsertNetworkEntry(tabId, requestId, patch) {
  let buf = networkBuffers.get(tabId);
  if (!buf) {
    buf = new Map();
    networkBuffers.set(tabId, buf);
  }
  const existing = buf.get(requestId) || {};
  buf.delete(requestId); // re-insert to keep most-recently-updated ordering stable
  buf.set(requestId, { ...existing, ...patch });
  if (buf.size > NETWORK_BUFFER_MAX) {
    const oldest = buf.keys().next().value;
    buf.delete(oldest);
  }
}

function readConsoleBuffer(tabId, opts = {}) {
  return filterConsoleEntries(consoleBuffers.get(tabId) || [], opts);
}

function readNetworkBuffer(tabId, opts = {}) {
  const buf = networkBuffers.get(tabId);
  return filterNetworkEntries(buf ? Array.from(buf.values()) : [], opts);
}

function clearConsoleBuffer(tabId) {
  if (consoleBuffers.has(tabId)) consoleBuffers.set(tabId, []);
}

function clearNetworkBuffer(tabId) {
  if (networkBuffers.has(tabId)) networkBuffers.set(tabId, new Map());
}

function onDebuggerEvent(source, method, params) {
  const tabId = source.tabId;
  if (tabId == null) return;
  // Re-mark as monitored if the worker restarted while the session stayed attached.
  monitoredTabs.add(tabId);

  switch (method) {
    case "Runtime.consoleAPICalled": {
      const frame = params.stackTrace?.callFrames?.[0];
      pushConsoleEntry(tabId, {
        kind: "console",
        level: params.type === "warning" ? "warn" : params.type,
        text: (params.args || []).map(previewRemoteObject).join(" "),
        source: frame ? `${frame.url}:${frame.lineNumber + 1}` : undefined,
        ts: Date.now(),
      });
      break;
    }
    case "Runtime.exceptionThrown": {
      const d = params.exceptionDetails || {};
      pushConsoleEntry(tabId, {
        kind: "exception",
        level: "error",
        text: d.exception?.description || d.text || "Uncaught exception",
        source: d.url ? `${d.url}:${(d.lineNumber ?? 0) + 1}` : undefined,
        ts: Date.now(),
      });
      break;
    }
    case "Log.entryAdded": {
      const e = params.entry || {};
      pushConsoleEntry(tabId, {
        kind: "log",
        level: e.level === "warning" ? "warn" : e.level,
        text: e.text || "",
        source: e.url,
        ts: Date.now(),
      });
      break;
    }
    case "Network.requestWillBeSent":
      upsertNetworkEntry(tabId, params.requestId, {
        url: params.request?.url,
        method: params.request?.method,
        resourceType: params.type,
        ts: Date.now(),
      });
      break;
    case "Network.responseReceived":
      upsertNetworkEntry(tabId, params.requestId, {
        status: params.response?.status,
        mimeType: params.response?.mimeType,
      });
      break;
    case "Network.loadingFailed":
      upsertNetworkEntry(tabId, params.requestId, {
        failed: true,
        errorText: params.errorText,
      });
      break;
    case "Network.loadingFinished":
      upsertNetworkEntry(tabId, params.requestId, {
        encodedDataLength: params.encodedDataLength,
      });
      break;
    case "Page.javascriptDialogOpening": {
      // Auto-handle so a dialog can never wedge the session: accept
      // beforeunload (lets navigation proceed), dismiss everything else.
      const accept = params.type === "beforeunload";
      cdpSend(tabId, "Page.handleJavaScriptDialog", { accept }).catch(() => {});
      pushConsoleEntry(tabId, {
        kind: "dialog",
        level: "warn",
        text: `Auto-${accept ? "accepted" : "dismissed"} ${params.type} dialog: ${params.message || ""}`,
        ts: Date.now(),
      });
      break;
    }
  }
}

// --- Input dispatch ---

async function cdpClick(tabId, x, y, { button = "left", clickCount = 1 } = {}) {
  await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
  await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, buttons: 1, clickCount });
  await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, buttons: 0, clickCount });
}

async function cdpHover(tabId, x, y) {
  await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
}

async function cdpScroll(tabId, x, y, deltaX, deltaY) {
  await cdpSend(tabId, "Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x,
    y,
    deltaX,
    deltaY,
  });
}

async function cdpTypeText(tabId, text) {
  await cdpSend(tabId, "Input.insertText", { text });
}

const KEY_DEFINITIONS = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  Space: { key: " ", code: "Space", keyCode: 32, text: " " },
};

function keyToDefinition(name) {
  if (KEY_DEFINITIONS[name]) return KEY_DEFINITIONS[name];
  if (typeof name === "string" && name.length === 1) {
    const upper = name.toUpperCase();
    return {
      key: name,
      code: /[a-zA-Z]/.test(name) ? `Key${upper}` : /[0-9]/.test(name) ? `Digit${name}` : "",
      keyCode: upper.charCodeAt(0),
      text: name,
    };
  }
  throw new Error(
    `Unknown key "${name}". Use a single character or one of: ${Object.keys(KEY_DEFINITIONS).join(", ")}`,
  );
}

const MODIFIER_BITS = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, shift: 8 };

function modifiersToBitmask(modifiers = []) {
  let mask = 0;
  for (const m of modifiers) {
    const bit = MODIFIER_BITS[String(m).toLowerCase()];
    if (bit === undefined) throw new Error(`Unknown modifier "${m}". Use alt, ctrl, meta, or shift.`);
    mask |= bit;
  }
  return mask;
}

async function cdpPressKey(tabId, keyName, modifiers = []) {
  const def = keyToDefinition(keyName);
  const mask = modifiersToBitmask(modifiers);
  const base = {
    modifiers: mask,
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: def.keyCode,
    nativeVirtualKeyCode: def.keyCode,
  };
  // Text is suppressed when a non-shift modifier is held (matches real key events).
  const emitsText = def.text && (mask & ~8) === 0;
  await cdpSend(tabId, "Input.dispatchKeyEvent", {
    ...base,
    type: emitsText ? "keyDown" : "rawKeyDown",
    ...(emitsText ? { text: def.text, unmodifiedText: def.text } : {}),
  });
  await cdpSend(tabId, "Input.dispatchKeyEvent", { ...base, type: "keyUp" });
}

// --- JS evaluation ---

async function cdpEvaluate(tabId, expression, { timeoutMs = 15000 } = {}) {
  const res = await cdpSend(tabId, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
    timeout: timeoutMs,
  });
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error(`JS exception: ${(d.exception?.description || d.text || "unknown").slice(0, 2000)}`);
  }
  return normalizeEvalResult(res.result);
}

function normalizeEvalResult(result) {
  if (!result) return { type: "undefined", value: undefined };
  if (result.value === undefined) {
    return { type: result.type, value: undefined, description: result.description };
  }
  let serialized;
  try {
    serialized = JSON.stringify(result.value);
  } catch {
    serialized = String(result.value);
  }
  if (serialized && serialized.length > EVAL_RESULT_MAX_CHARS) {
    return { type: result.type, value: serialized.slice(0, EVAL_RESULT_MAX_CHARS), truncated: true };
  }
  return { type: result.type, value: result.value };
}

// --- Pure helpers (unit-tested) ---

function previewRemoteObject(o) {
  if (!o) return "";
  if (o.type === "string") return o.value ?? "";
  if (o.value !== undefined) {
    try {
      return JSON.stringify(o.value).slice(0, 500);
    } catch {
      return String(o.value);
    }
  }
  if (o.description) return o.description.slice(0, 500);
  return o.type || "";
}

function filterConsoleEntries(entries, { pattern, level, limit = 200 } = {}) {
  let out = entries;
  if (level) out = out.filter((e) => e.level === level);
  if (pattern) {
    let re;
    try {
      re = new RegExp(pattern);
    } catch {
      re = null; // invalid regex — degrade to a literal substring match rather than failing the read
    }
    out = re
      ? out.filter((e) => re.test(e.text || ""))
      : out.filter((e) => (e.text || "").includes(pattern));
  }
  return { total: out.length, entries: out.slice(-limit) };
}

function filterNetworkEntries(entries, { urlFilter, limit = 200 } = {}) {
  let out = entries;
  if (urlFilter) out = out.filter((e) => (e.url || "").includes(urlFilter));
  return { total: out.length, requests: out.slice(-limit) };
}

// --- Event wiring (service worker only) ---

if (typeof chrome !== "undefined" && chrome.debugger?.onEvent) {
  chrome.debugger.onEvent.addListener(onDebuggerEvent);
  chrome.debugger.onDetach.addListener(async (source) => {
    // User clicked "Cancel" on the debugger infobar or the target went away.
    if (source.tabId == null) return;
    const attached = await getAttachedMap();
    if (attached[source.tabId]) {
      delete attached[source.tabId];
      await setAttachedMap(attached);
    }
    cdpForgetTab(source.tabId);
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    KEY_DEFINITIONS,
    keyToDefinition,
    modifiersToBitmask,
    previewRemoteObject,
    filterConsoleEntries,
    filterNetworkEntries,
    normalizeEvalResult,
  };
}
