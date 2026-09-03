// Shared server config — loaded by popup (<script>) and background (importScripts).

const SERVER_PRESETS = [
  { id: "localhost", label: "Localhost", url: "http://localhost:3055" },
  { id: "production", label: "Production", url: "https://figma-mcp.videntia.dev" },
];
const SERVER_DEFAULT = SERVER_PRESETS[0].url;
const SERVER_STORAGE_KEY = "serverConfig";

function toWsUrl(httpUrl) {
  return httpUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

function toChannelsUrl(httpUrl) {
  return httpUrl.replace(/\/$/, "") + "/channels";
}

async function getServerUrl() {
  const stored = (await chrome.storage.local.get(SERVER_STORAGE_KEY))[SERVER_STORAGE_KEY];
  return stored?.url || SERVER_DEFAULT;
}

async function setServerUrl(url) {
  await chrome.storage.local.set({ [SERVER_STORAGE_KEY]: { url } });
}

// --- Per-profile browser identity ---
//
// The relay needs a stable id per Chrome PROFILE so it can route a command to
// one browser instead of broadcasting to every connected extension.
//
// Storage area is deliberately chrome.storage.local:
//   - chrome.storage.sync is shared across every profile signed into the same
//     Google account, so both profiles would get the SAME id — defeating the
//     whole point.
//   - chrome.storage.session is cleared on browser restart, so the id would
//     not be stable across sessions.

const BROWSER_ID_STORAGE_KEY = "browserId";
const BROWSER_LABEL_STORAGE_KEY = "browserLabel";
const BROWSER_LABEL_MAX_LENGTH = 64;

function makeBrowserId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID.
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else if (i === 19) out += hex[(Math.random() * 4) | 8];
    else out += hex[(Math.random() * 16) | 0];
  }
  return out;
}

function defaultLabelFor(id) {
  return "Chrome-" + String(id || "").slice(0, 6);
}

function normalizeLabel(label, id) {
  if (typeof label !== "string") return defaultLabelFor(id);
  const trimmed = label.trim();
  if (!trimmed) return defaultLabelFor(id);
  return trimmed.slice(0, BROWSER_LABEL_MAX_LENGTH);
}

// Session fallback used when chrome.storage is unavailable or throwing — keeps
// the id stable for the life of the service worker so the socket can still join.
let ephemeralBrowserId = null;

function ephemeralIdentity() {
  if (!ephemeralBrowserId) ephemeralBrowserId = makeBrowserId();
  return { id: ephemeralBrowserId, label: defaultLabelFor(ephemeralBrowserId) };
}

async function getBrowserIdentity() {
  try {
    const stored = await chrome.storage.local.get([BROWSER_ID_STORAGE_KEY, BROWSER_LABEL_STORAGE_KEY]);
    let id = stored?.[BROWSER_ID_STORAGE_KEY];
    if (typeof id !== "string" || !id) {
      id = makeBrowserId();
      await chrome.storage.local.set({ [BROWSER_ID_STORAGE_KEY]: id });
    }
    return { id, label: normalizeLabel(stored?.[BROWSER_LABEL_STORAGE_KEY], id) };
  } catch (e) {
    // Never block the connection on storage failure.
    return ephemeralIdentity();
  }
}

async function setBrowserLabel(label) {
  const { id } = await getBrowserIdentity();
  const normalized = normalizeLabel(label, id);
  try {
    await chrome.storage.local.set({ [BROWSER_LABEL_STORAGE_KEY]: normalized });
  } catch {}
  return normalized;
}

if (typeof self !== "undefined") {
  self.SERVER_PRESETS = SERVER_PRESETS;
  self.SERVER_DEFAULT = SERVER_DEFAULT;
  self.SERVER_STORAGE_KEY = SERVER_STORAGE_KEY;
  self.toWsUrl = toWsUrl;
  self.toChannelsUrl = toChannelsUrl;
  self.getServerUrl = getServerUrl;
  self.setServerUrl = setServerUrl;
  self.BROWSER_ID_STORAGE_KEY = BROWSER_ID_STORAGE_KEY;
  self.BROWSER_LABEL_STORAGE_KEY = BROWSER_LABEL_STORAGE_KEY;
  self.BROWSER_LABEL_MAX_LENGTH = BROWSER_LABEL_MAX_LENGTH;
  self.makeBrowserId = makeBrowserId;
  self.defaultLabelFor = defaultLabelFor;
  self.normalizeLabel = normalizeLabel;
  self.getBrowserIdentity = getBrowserIdentity;
  self.setBrowserLabel = setBrowserLabel;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SERVER_PRESETS,
    SERVER_DEFAULT,
    SERVER_STORAGE_KEY,
    toWsUrl,
    toChannelsUrl,
    BROWSER_ID_STORAGE_KEY,
    BROWSER_LABEL_STORAGE_KEY,
    BROWSER_LABEL_MAX_LENGTH,
    makeBrowserId,
    defaultLabelFor,
    normalizeLabel,
    getBrowserIdentity,
    setBrowserLabel,
  };
}
