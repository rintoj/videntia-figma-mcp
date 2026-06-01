// Shared server config — loaded by popup (<script>) and background (importScripts).

const SERVER_PRESETS = [
  { id: 'production', label: 'Production', url: 'https://figma-mcp.videntia.dev' },
  { id: 'localhost',  label: 'Localhost',  url: 'http://localhost:3055' },
];
const SERVER_DEFAULT = SERVER_PRESETS[0].url;
const SERVER_STORAGE_KEY = 'serverConfig';

function toWsUrl(httpUrl) {
  return httpUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
}

function toChannelsUrl(httpUrl) {
  return httpUrl.replace(/\/$/, '') + '/channels';
}

async function getServerUrl() {
  const stored = (await chrome.storage.local.get(SERVER_STORAGE_KEY))[SERVER_STORAGE_KEY];
  return stored?.url || SERVER_DEFAULT;
}

async function setServerUrl(url) {
  await chrome.storage.local.set({ [SERVER_STORAGE_KEY]: { url } });
}

if (typeof self !== 'undefined') {
  self.SERVER_PRESETS = SERVER_PRESETS;
  self.SERVER_DEFAULT = SERVER_DEFAULT;
  self.SERVER_STORAGE_KEY = SERVER_STORAGE_KEY;
  self.toWsUrl = toWsUrl;
  self.toChannelsUrl = toChannelsUrl;
  self.getServerUrl = getServerUrl;
  self.setServerUrl = setServerUrl;
}
