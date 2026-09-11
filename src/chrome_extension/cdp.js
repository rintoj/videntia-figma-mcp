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

// Full per-tab override state. Was `{ emulation }` only — extended for
// browser_emulate (media/network/geolocation/timezone/cpu) — so every writer
// MUST merge via updateTabState rather than replacing the tab's entry wholesale,
// or it silently drops sibling override state (this bit cdpApplyEmulation
// before the extension: it used to overwrite the whole entry with just
// `{ emulation }`).
const DEFAULT_TAB_STATE = { emulation: null, media: null, network: null, geolocation: null, timezone: null, cpu: null };

async function getTabState(tabId) {
  const attached = await getAttachedMap();
  const entry = attached[tabId];
  return entry && typeof entry === "object" ? { ...DEFAULT_TAB_STATE, ...entry } : null;
}

async function updateTabState(tabId, patch) {
  const attached = await getAttachedMap();
  const current = attached[tabId] && typeof attached[tabId] === "object" ? attached[tabId] : {};
  attached[tabId] = { ...DEFAULT_TAB_STATE, ...current, ...patch };
  await setAttachedMap(attached);
  return attached[tabId];
}

async function cdpEnsureAttached(tabId) {
  const attached = await getAttachedMap();
  if (attached[tabId]) return { newlyAttached: false };
  await chrome.debugger.attach({ tabId }, "1.3");
  attached[tabId] = { ...DEFAULT_TAB_STATE };
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
  await updateTabState(tabId, { emulation: { width, height, deviceScaleFactor } });
}

async function cdpClearEmulation(tabId) {
  const attached = await getAttachedMap();
  if (!attached[tabId]) return;
  try {
    await cdpSend(tabId, "Emulation.clearDeviceMetricsOverride");
  } catch {}
  await updateTabState(tabId, { emulation: null });
}

// --- Emulation: media features, network, geolocation, timezone, CPU ---

async function cdpSetEmulatedMedia(tabId, { colorScheme, reducedMotion } = {}) {
  await cdpEnsureAttached(tabId);
  const features = [];
  if (colorScheme !== undefined && colorScheme !== null) {
    features.push({ name: "prefers-color-scheme", value: colorScheme });
  }
  if (reducedMotion !== undefined && reducedMotion !== null) {
    features.push({ name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" });
  }
  await cdpSend(tabId, "Emulation.setEmulatedMedia", { features });
  await updateTabState(tabId, {
    media: { colorScheme: colorScheme ?? null, reducedMotion: reducedMotion ?? null },
  });
}

async function cdpClearEmulatedMedia(tabId) {
  try {
    await cdpSend(tabId, "Emulation.setEmulatedMedia", { features: [] });
  } catch {}
  await updateTabState(tabId, { media: null });
}

// CDP has no built-in named network-throttling presets — these mirror Chrome
// DevTools' own published preset values (approximate; Chrome adjusts them
// between versions). Pass a custom {latency, downloadThroughput,
// uploadThroughput} object instead for precise/reproducible testing.
const NETWORK_PRESETS = {
  offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
  "slow-3g": { offline: false, latency: 400, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (250 * 1024) / 8 },
  "fast-3g": {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  },
  "slow-4g": {
    offline: false,
    latency: 562,
    downloadThroughput: (1.4 * 1024 * 1024) / 8,
    uploadThroughput: (700 * 1024) / 8,
  },
  "fast-4g": {
    offline: false,
    latency: 165,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (3 * 1024 * 1024) / 8,
  },
};

function resolveNetworkConditionsParams(conditions) {
  if (typeof conditions === "string") {
    if (conditions === "no-throttling") {
      return { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
    }
    const preset = NETWORK_PRESETS[conditions];
    if (!preset) {
      throw new Error(
        `Unknown network preset "${conditions}". Use one of: ${Object.keys(NETWORK_PRESETS).join(", ")}, no-throttling, or a custom {latency, downloadThroughput, uploadThroughput} object.`,
      );
    }
    return preset;
  }
  if (conditions && typeof conditions === "object") {
    return {
      offline: conditions.offline === true,
      latency: typeof conditions.latency === "number" ? conditions.latency : 0,
      downloadThroughput: typeof conditions.downloadThroughput === "number" ? conditions.downloadThroughput : -1,
      uploadThroughput: typeof conditions.uploadThroughput === "number" ? conditions.uploadThroughput : -1,
    };
  }
  throw new Error("networkConditions must be a preset name or a {latency, downloadThroughput, uploadThroughput} object");
}

async function cdpSetNetworkConditions(tabId, conditions) {
  await cdpEnsureAttached(tabId);
  const params = resolveNetworkConditionsParams(conditions);
  await cdpSend(tabId, "Network.emulateNetworkConditions", params);
  await updateTabState(tabId, { network: conditions });
}

async function cdpClearNetworkConditions(tabId) {
  try {
    await cdpSend(tabId, "Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  } catch {}
  await updateTabState(tabId, { network: null });
}

async function cdpSetGeolocation(tabId, geo) {
  await cdpEnsureAttached(tabId);
  if (!geo) {
    try {
      await cdpSend(tabId, "Emulation.clearGeolocationOverride");
    } catch {}
    await updateTabState(tabId, { geolocation: null });
    return;
  }
  const { latitude, longitude, accuracy = 100 } = geo;
  await cdpSend(tabId, "Emulation.setGeolocationOverride", { latitude, longitude, accuracy });
  await updateTabState(tabId, { geolocation: { latitude, longitude, accuracy } });
}

async function cdpSetTimezone(tabId, timezoneId) {
  await cdpEnsureAttached(tabId);
  await cdpSend(tabId, "Emulation.setTimezoneOverride", { timezoneId: timezoneId || "" });
  await updateTabState(tabId, { timezone: timezoneId || null });
}

async function cdpSetCpuThrottling(tabId, rate) {
  await cdpEnsureAttached(tabId);
  const effectiveRate = typeof rate === "number" && rate > 0 ? rate : 1;
  await cdpSend(tabId, "Emulation.setCPUThrottlingRate", { rate: effectiveRate });
  await updateTabState(tabId, { cpu: effectiveRate !== 1 ? effectiveRate : null });
}

// Clears every override type — no single CDP call does this, each override
// domain has its own clear method.
async function cdpClearAllEmulation(tabId) {
  await cdpClearEmulation(tabId);
  await cdpClearEmulatedMedia(tabId);
  await cdpClearNetworkConditions(tabId);
  await cdpSetGeolocation(tabId, null);
  await cdpSetTimezone(tabId, null);
  try {
    await cdpSend(tabId, "Emulation.setCPUThrottlingRate", { rate: 1 });
  } catch {}
  await updateTabState(tabId, { cpu: null });
}

// Re-applies every active override after a navigation. CDP overrides
// (viewport emulation included) do not reliably survive cross-page loads.
async function cdpReapplyOverrides(tabId) {
  const state = await getTabState(tabId);
  if (!state) return;
  if (state.emulation) await cdpApplyEmulation(tabId, state.emulation);
  if (state.media) await cdpSetEmulatedMedia(tabId, state.media);
  if (state.network) await cdpSetNetworkConditions(tabId, state.network);
  if (state.geolocation) await cdpSetGeolocation(tabId, state.geolocation);
  if (state.timezone) await cdpSetTimezone(tabId, state.timezone);
  if (state.cpu) await cdpSetCpuThrottling(tabId, state.cpu);
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
  interceptingTabs.delete(tabId);
  for (const [requestId, entry] of pendingInterceptions) {
    if (entry.tabId === tabId) {
      clearTimeout(entry.timeoutHandle);
      pendingInterceptions.delete(requestId);
    }
  }
}

// --- Accessibility tree + backend-node resolution (browser_snapshot) ---

async function cdpGetAXTree(tabId, { depth } = {}) {
  await cdpEnsureAttached(tabId);
  await cdpSend(tabId, "Accessibility.enable");
  const params = {};
  if (typeof depth === "number") params.depth = depth;
  const res = await cdpSend(tabId, "Accessibility.getFullAXTree", params);
  return res.nodes || [];
}

// Depth is derived from the AXNode parent chain (the raw tree has no depth field).
function flattenAXNodes(nodes, { includeIgnored = false } = {}) {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const depthCache = new Map();
  function getDepth(node) {
    if (depthCache.has(node.nodeId)) return depthCache.get(node.nodeId);
    let d = 0;
    let cur = node;
    const seen = new Set();
    while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId)) {
      seen.add(cur.parentId);
      d++;
      cur = byId.get(cur.parentId);
    }
    depthCache.set(node.nodeId, d);
    return d;
  }
  const out = [];
  for (const node of nodes) {
    if (!includeIgnored && node.ignored) continue;
    out.push({
      axId: node.nodeId,
      role: node.role && node.role.value != null ? node.role.value : null,
      name: node.name && node.name.value != null ? node.name.value : "",
      backendDOMNodeId: node.backendDOMNodeId ?? null,
      depth: getDepth(node),
    });
  }
  return out;
}

// AXNode -> viewport click coordinates: scroll into view, read the box model,
// clamp to viewport bounds — mirrors content.js's prepareElementForInteraction
// clamping so out-of-viewport CDP input events (which silently hit nothing)
// can't happen via this path either.
async function cdpResolveAXNode(tabId, backendDOMNodeId) {
  await cdpEnsureAttached(tabId);
  // Defensive: the CDP spec says DOM.getBoxModel/scrollIntoViewIfNeeded don't
  // require a prior DOM.enable when addressing by backendNodeId, but enabling
  // is idempotent and cheap — safer than assuming that holds across all
  // Chrome versions without a live test to confirm it.
  try {
    await cdpSend(tabId, "DOM.enable");
  } catch {}
  try {
    await cdpSend(tabId, "DOM.scrollIntoViewIfNeeded", { backendNodeId: backendDOMNodeId });
  } catch {}
  const { model } = await cdpSend(tabId, "DOM.getBoxModel", { backendNodeId: backendDOMNodeId });
  if (!model || !Array.isArray(model.content) || model.content.length < 8) {
    throw new Error(
      `No box model for backendDOMNodeId ${backendDOMNodeId} — the element may be hidden, detached, or the snapshot is stale (take a fresh browser_snapshot).`,
    );
  }
  const xs = [model.content[0], model.content[2], model.content[4], model.content[6]];
  const ys = [model.content[1], model.content[3], model.content[5], model.content[7]];
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;

  const metrics = await cdpSend(tabId, "Page.getLayoutMetrics", {});
  const viewport = metrics.cssLayoutViewport || metrics.layoutViewport || {};
  const vw = Math.round(viewport.clientWidth || centerX + 1);
  const vh = Math.round(viewport.clientHeight || centerY + 1);
  const x = Math.min(Math.max(Math.round(centerX), 1), Math.max(vw - 1, 1));
  const y = Math.min(Math.max(Math.round(centerY), 1), Math.max(vh - 1, 1));
  return { x, y };
}

async function cdpFocusBackendNode(tabId, backendNodeId) {
  await cdpEnsureAttached(tabId);
  try {
    await cdpSend(tabId, "DOM.enable");
  } catch {}
  try {
    await cdpSend(tabId, "DOM.scrollIntoViewIfNeeded", { backendNodeId });
  } catch {}
  await cdpSend(tabId, "DOM.focus", { backendNodeId });
}

// --- Overlay highlight (browser_highlight_node) ---

const DEFAULT_HIGHLIGHT_CONFIG = {
  contentColor: { r: 111, g: 168, b: 220, a: 0.35 },
  paddingColor: { r: 147, g: 196, b: 125, a: 0.4 },
  borderColor: { r: 255, g: 229, b: 153, a: 0.5 },
  marginColor: { r: 246, g: 178, b: 107, a: 0.4 },
  showInfo: true,
};

// Resolves a CSS selector to a DOM-domain nodeId (not backendNodeId) — this is
// sufficient because Overlay.highlightNode accepts nodeId, backendNodeId, OR
// objectId interchangeably, so no extra DOM.describeNode round trip is needed.
async function cdpQuerySelector(tabId, selector) {
  await cdpEnsureAttached(tabId);
  try {
    await cdpSend(tabId, "DOM.enable");
  } catch {}
  const { root } = await cdpSend(tabId, "DOM.getDocument", { depth: -1, pierce: false });
  const { nodeId } = await cdpSend(tabId, "DOM.querySelector", { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error(`No element matches selector: ${selector}`);
  return nodeId;
}

async function cdpHighlightNode(tabId, { backendDOMNodeId, nodeId, highlightConfig } = {}) {
  await cdpEnsureAttached(tabId);
  await cdpSend(tabId, "Overlay.enable");
  const target = nodeId != null ? { nodeId } : { backendNodeId: backendDOMNodeId };
  await cdpSend(tabId, "Overlay.highlightNode", {
    ...target,
    highlightConfig: { ...DEFAULT_HIGHLIGHT_CONFIG, ...(highlightConfig || {}) },
  });
}

async function cdpClearHighlight(tabId) {
  try {
    await cdpSend(tabId, "Overlay.hideHighlight");
  } catch {}
}

// --- Fetch domain interception (browser_intercept_*) ---
//
// Once Fetch.enable is on, EVERY matching request stalls until explicitly
// resolved — an unhandled paused request can wedge the whole page (the most
// common real-world bug in CDP request interception). Every paused request
// gets a hard timeout that auto-continues it unmodified if the MCP client
// never resolves it, mirroring the auto-handled-dialog safety net below for
// Page.javascriptDialogOpening.

const interceptingTabs = new Set();
const pendingInterceptions = new Map(); // requestId -> {tabId, url, method, resourceType, receivedAt, timeoutHandle}
const DEFAULT_INTERCEPT_TIMEOUT_MS = 8000;
const interceptTimeoutByTab = new Map(); // tabId -> timeoutMs

async function cdpStartInterception(tabId, patterns, timeoutMs) {
  await cdpEnsureAttached(tabId);
  const effectiveTimeout = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : DEFAULT_INTERCEPT_TIMEOUT_MS;
  interceptTimeoutByTab.set(tabId, effectiveTimeout);
  const cdpPatterns =
    Array.isArray(patterns) && patterns.length > 0
      ? patterns.map((p) => ({
          urlPattern: p.urlPattern,
          resourceType: p.resourceType,
          requestStage: p.requestStage || "Request",
        }))
      : [{ urlPattern: "*", requestStage: "Request" }];
  await cdpSend(tabId, "Fetch.enable", { patterns: cdpPatterns });
  interceptingTabs.add(tabId);
}

async function cdpStopInterception(tabId) {
  interceptingTabs.delete(tabId);
  interceptTimeoutByTab.delete(tabId);
  // Auto-continue anything still pending for this tab before disabling, so
  // nothing is left hanging.
  for (const [requestId, entry] of pendingInterceptions) {
    if (entry.tabId !== tabId) continue;
    clearTimeout(entry.timeoutHandle);
    pendingInterceptions.delete(requestId);
    try {
      await cdpSend(tabId, "Fetch.continueRequest", { requestId });
    } catch {}
  }
  try {
    await cdpSend(tabId, "Fetch.disable");
  } catch {}
}

function listPendingInterceptions(tabId) {
  const out = [];
  for (const [requestId, entry] of pendingInterceptions) {
    if (entry.tabId !== tabId) continue;
    out.push({
      requestId,
      url: entry.url,
      method: entry.method,
      resourceType: entry.resourceType,
      pendingMs: Date.now() - entry.receivedAt,
    });
  }
  return out;
}

function resolvePendingInterception(requestId) {
  const entry = pendingInterceptions.get(requestId);
  if (entry) {
    clearTimeout(entry.timeoutHandle);
    pendingInterceptions.delete(requestId);
  }
  return entry;
}

function requirePendingInterception(requestId) {
  const entry = pendingInterceptions.get(requestId);
  if (!entry) {
    throw new Error(`No pending intercepted request with id "${requestId}" (it may have already timed out and auto-continued).`);
  }
  return entry;
}

// btoa() alone mangles multi-byte characters; unescape() (the classic
// btoa-safe-for-UTF8 workaround) is legacy and not guaranteed present in a
// service worker's restricted global scope. TextEncoder is a standard global
// available in Worker contexts, so route through it instead.
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function cdpFulfillRequest(tabId, requestId, { responseCode = 200, responseHeaders, body } = {}) {
  requirePendingInterception(requestId);
  resolvePendingInterception(requestId);
  const params = { requestId, responseCode };
  if (responseHeaders && typeof responseHeaders === "object") {
    params.responseHeaders = Object.entries(responseHeaders).map(([name, value]) => ({ name, value: String(value) }));
  }
  if (body !== undefined && body !== null) {
    params.body = utf8ToBase64(String(body));
  }
  await cdpSend(tabId, "Fetch.fulfillRequest", params);
}

async function cdpFailRequest(tabId, requestId, errorReason) {
  requirePendingInterception(requestId);
  resolvePendingInterception(requestId);
  await cdpSend(tabId, "Fetch.failRequest", { requestId, errorReason: errorReason || "Failed" });
}

async function cdpContinueRequest(tabId, requestId, overrides = {}) {
  requirePendingInterception(requestId);
  resolvePendingInterception(requestId);
  const params = { requestId };
  if (overrides.url) params.url = overrides.url;
  if (overrides.method) params.method = overrides.method;
  if (overrides.headers && typeof overrides.headers === "object") {
    params.headers = Object.entries(overrides.headers).map(([name, value]) => ({ name, value: String(value) }));
  }
  if (overrides.postData !== undefined) params.postData = overrides.postData;
  await cdpSend(tabId, "Fetch.continueRequest", params);
}

// --- Storage clear (browser_clear_storage) ---

const ALL_STORAGE_TYPES =
  "appcache,cookies,file_systems,indexeddb,local_storage,shader_cache,websql,cache_storage,interest_groups,shared_storage";

async function cdpClearStorage(tabId, origin, storageTypes) {
  await cdpEnsureAttached(tabId);
  await cdpSend(tabId, "Storage.clearDataForOrigin", {
    origin,
    storageTypes: storageTypes || ALL_STORAGE_TYPES,
  });
}

// --- MHTML page snapshot (browser_capture_mhtml) ---

async function cdpCaptureMhtml(tabId) {
  await cdpEnsureAttached(tabId);
  try {
    await cdpSend(tabId, "Page.enable"); // idempotent — cheap even if monitoring already enabled it
  } catch {}
  const res = await cdpSend(tabId, "Page.captureSnapshot", { format: "mhtml" });
  return res.data;
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
    case "Fetch.requestPaused": {
      const requestId = params.requestId;
      const timeoutMs = interceptTimeoutByTab.get(tabId) || DEFAULT_INTERCEPT_TIMEOUT_MS;
      const timeoutHandle = setTimeout(() => {
        pendingInterceptions.delete(requestId);
        cdpSend(tabId, "Fetch.continueRequest", { requestId }).catch(() => {});
        pushConsoleEntry(tabId, {
          kind: "intercept-timeout",
          level: "warn",
          text: `Fetch interception for ${params.request?.method || "GET"} ${params.request?.url || requestId} timed out after ${timeoutMs}ms and was auto-continued unmodified.`,
          ts: Date.now(),
        });
      }, timeoutMs);
      pendingInterceptions.set(requestId, {
        tabId,
        url: params.request?.url,
        method: params.request?.method,
        resourceType: params.resourceType,
        receivedAt: Date.now(),
        timeoutHandle,
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
    flattenAXNodes,
    resolveNetworkConditionsParams,
  };
}
