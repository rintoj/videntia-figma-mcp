const STATE_KEY = 'overlayState';

let serverUrl = SERVER_DEFAULT;   // hydrated from chrome.storage on init
let activeTabName = 'overlay';    // 'overlay' | 'settings'

// ---- DOM refs ----
const tabs = document.querySelectorAll('.tab');
const emptyState = document.getElementById('emptyState');
const filledState = document.getElementById('filledState');
const settingsPanel = document.getElementById('settingsPanel');
const presetRow = document.getElementById('presetRow');
const serverUrlInput = document.getElementById('serverUrlInput');
const overlayCta = document.getElementById('overlayCta');
const addSelectedBtn = document.getElementById('addSelectedBtn');
const opacitySlider = document.getElementById('opacitySlider');
const opacityValue = document.getElementById('opacityValue');
const segs = document.querySelectorAll('.seg');
const chips = document.querySelectorAll('.chip');
const nudgeBtns = document.querySelectorAll('.nudge-btn[data-dir]');
const resetBtn = document.getElementById('resetBtn');
const matchBtn = document.getElementById('matchBtn');
const sizeInfoText = document.getElementById('sizeInfoText');
const emptyDesc = document.getElementById('emptyDesc');
const selectionInfo = document.getElementById('selectionInfo');
const selectionInfoName = document.getElementById('selectionInfoName');
const figmaLayerName = document.getElementById('figmaLayerName');
const figmaEye = document.getElementById('figmaEye');
const figmaRemove = document.getElementById('figmaRemove');
const statusEl = document.getElementById('status');
const closeBtn = document.getElementById('closeBtn');
const connIcon = document.getElementById('connIcon');
const connChannel = document.getElementById('connChannel');
const channelPicker = document.getElementById('channelPicker');
const connBtn = document.getElementById('connBtn');
const connBtnLabel = document.getElementById('connBtnLabel');

// ---- Local state ----
const state = {
  channel: null,
  channels: [],
  serverUp: false,
  hasOverlay: false,
  figmaVisible: true,
  pageVisible: true,
  opacity: 0.6,
  blend: 'difference',          // 'normal' | 'difference' | 'multiply' | 'overlay'
  offsetX: 0,
  offsetY: 0,
  step: 1,                      // 1 | 4 | 8
  frameName: null,
  frameWidth: null,
  frameHeight: null,
  browserWidth: null,
  browserHeight: null,
  tabId: null,
  hostname: '—',
  selectedNodeName: null,         // current Figma selection (live)
};

function setStatus(msg, type = '') {
  statusEl.textContent = msg || '';
  statusEl.className = 'status' + (type ? ` ${type}` : '');
}

function updateScreenUI() {
  const onOverlay = activeTabName === 'overlay';
  emptyState.classList.toggle('hidden', !onOverlay || state.hasOverlay);
  filledState.classList.toggle('hidden', !onOverlay || !state.hasOverlay);
  settingsPanel.classList.toggle('hidden', activeTabName !== 'settings');
}

function updateOpacityUI() {
  const pct = Math.round(state.opacity * 100);
  opacitySlider.value = pct;
  opacitySlider.style.setProperty('--fill', `${pct}%`);
  opacityValue.textContent = `${pct}%`;
}

function updateBlendUI() {
  segs.forEach(s => s.classList.toggle('active', s.dataset.mode === state.blend));
}

function updateStepUI() {
  chips.forEach(c => c.classList.toggle('active', Number(c.dataset.step) === state.step));
}

function updateEmptyUI() {
  // Always render the selection chip so the layout doesn't jump.
  selectionInfo.classList.remove('hidden');

  if (!state.channel) {
    emptyDesc.textContent = 'Open Settings to connect to a Figma channel.';
    overlayCta.disabled = true;
    selectionInfo.classList.add('invisible');
    selectionInfoName.textContent = '—';
    return;
  }

  emptyDesc.textContent = 'Select a frame in Figma, then tap the button below to overlay it.';
  overlayCta.disabled = !state.selectedNodeName;
  selectionInfo.classList.remove('invisible');

  if (state.selectedNodeName) {
    selectionInfo.classList.remove('empty');
    selectionInfoName.textContent = state.selectedNodeName;
  } else {
    selectionInfo.classList.add('empty');
    selectionInfoName.textContent = 'Nothing selected';
  }
}

function updateLayerUI() {
  figmaLayerName.textContent = state.frameName
    ? `Figma · ${state.frameName}`
    : 'Figma · —';
  figmaEye.classList.toggle('on', state.figmaVisible);
}

function updateFrameUI() {
  const fw = state.frameWidth;
  const fh = state.frameHeight;
  const bw = state.browserWidth;
  const bh = state.browserHeight;
  if (bw && bh && fw && fh) {
    sizeInfoText.textContent = `Browser ${bw}×${bh}  ·  Design ${fw}×${fh}`;
  } else if (bw && bh) {
    sizeInfoText.textContent = `Browser ${bw}×${bh}`;
  } else if (fw && fh) {
    sizeInfoText.textContent = `Design ${fw}×${fh}`;
  } else {
    sizeInfoText.textContent = 'Browser  — × —';
  }
  matchBtn.disabled = !(fw && fh);
}

function updateConnectionUI() {
  if (!state.serverUp) {
    connIcon.className = 'conn-icon err';
    connChannel.textContent = 'server offline';
    connChannel.classList.add('muted');
    connChannel.style.display = '';
    channelPicker.style.display = 'none';
    connBtn.disabled = true;
    connBtnLabel.textContent = 'Connect';
    return;
  }
  if (state.channel) {
    connIcon.className = 'conn-icon';
    connChannel.style.display = '';
    connChannel.textContent = state.channel;
    connChannel.classList.remove('muted');
    channelPicker.style.display = 'none';
    connBtn.disabled = false;
    connBtnLabel.textContent = 'Disconnect';
  } else if (state.channels.length === 0) {
    connIcon.className = 'conn-icon off';
    connChannel.style.display = '';
    connChannel.textContent = 'no figma channels';
    connChannel.classList.add('muted');
    channelPicker.style.display = 'none';
    connBtn.disabled = true;
    connBtnLabel.textContent = 'Connect';
  } else {
    connIcon.className = 'conn-icon off';
    connChannel.style.display = 'none';
    channelPicker.style.display = '';
    connBtn.disabled = !channelPicker.value;
    connBtnLabel.textContent = 'Connect';
  }
}

function refreshUI() {
  updateScreenUI();
  updateOpacityUI();
  updateBlendUI();
  updateStepUI();
  updateLayerUI();
  updateFrameUI();
  updateConnectionUI();
  updateEmptyUI();
}

async function refreshSelectedNodeName() {
  if (!state.channel) {
    state.selectedNodeName = null;
    updateEmptyUI();
    return;
  }
  try {
    const result = await sendViaWebSocket(state.channel, 'get_selection', { depth: 0 });
    const node = result?.nodes?.[0];
    state.selectedNodeName = node?.name || null;
  } catch {
    state.selectedNodeName = null;
  }
  updateEmptyUI();
}

// ---- Channels ----

async function loadChannels() {
  try {
    const res = await fetch(toChannelsUrl(serverUrl));
    const list = await res.json();
    state.serverUp = true;
    state.channels = list.filter(ch => ch.clients >= 1 && ch.fileName);
    channelPicker.innerHTML = '<option value="">— pick channel —</option>' +
      state.channels.map(ch =>
        `<option value="${ch.channel}">${ch.channel}${ch.fileName ? ` (${ch.fileName})` : ''}</option>`
      ).join('');
    if (state.channels.length === 1 && !state.channel) {
      channelPicker.value = state.channels[0].channel;
    }
  } catch {
    state.serverUp = false;
    state.channels = [];
  }
  refreshUI();
}

// ---- WS round-trip ----

function sendViaWebSocket(channel, command, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(toWsUrl(serverUrl));
    const id = crypto.randomUUID();
    let joined = false;
    let settled = false;
    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    };
    const timer = setTimeout(() => {
      ws.close();
      settle(reject, new Error(`Timed out waiting for Figma (${command})`));
    }, 15000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', channel, id }));
    ws.onmessage = (evt) => {
      let data;
      try { data = JSON.parse(evt.data); } catch { return; }
      if (!joined && data.type === 'system' && data.message?.result) {
        joined = true;
        ws.send(JSON.stringify({
          id, type: 'message', channel,
          message: { id, command, params: { ...params, commandId: id } },
        }));
        return;
      }
      if ((data.type === 'message' || data.type === 'broadcast') && data.message?.id === id) {
        ws.close();
        if (data.message.error) settle(reject, new Error(data.message.error));
        else settle(resolve, data.message.result);
      }
    };
    ws.onerror = () => settle(reject, new Error('Cannot reach socket server'));
    ws.onclose = (e) => {
      if (!settled) settle(reject, new Error(`Connection closed (${e.code})`));
    };
  });
}

// ---- Tab helpers ----

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToTab(tab, command, params = {}) {
  try {
    return await chrome.tabs.sendMessage(tab.id, { command, params });
  } catch {
    return null;
  }
}

async function sendToTabStrict(tab, command, params = {}) {
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { command, params });
    return res;
  } catch (err) {
    throw new Error(
      `Content script unreachable on this tab. ` +
      `Reload the page (or navigate away from chrome:// / file:// URLs) and try again.`
    );
  }
}

// Runs in page context — keep self-contained.
function applyOverlayPatch(patch) {
  const el = document.getElementById('__figma_overlay__');
  if (!el) return { ok: false };
  if (patch.opacity != null) el.style.opacity = String(patch.opacity);
  if (patch.blend != null) {
    if (patch.blend === 'normal') {
      el.style.mixBlendMode = '';
      el.style.isolation = '';
    } else {
      el.style.mixBlendMode = patch.blend;
      el.style.isolation = 'isolate';
    }
  }
  if (patch.offsetX != null) el.style.left = `${patch.offsetX}px`;
  if (patch.offsetY != null) el.style.top = `${patch.offsetY}px`;
  if (patch.visible != null) el.style.display = patch.visible ? '' : 'none';
  return { ok: true };
}

function applyPageVisibility(visible) {
  const ID = '__figma_overlay_pagesheet__';
  document.getElementById(ID)?.remove();
  if (!visible) {
    const sheet = document.createElement('div');
    sheet.id = ID;
    Object.assign(sheet.style, {
      position: 'fixed', inset: '0',
      background: '#ffffff',
      zIndex: '2147483645',
      pointerEvents: 'none',
    });
    document.documentElement.appendChild(sheet);
  }
  return { ok: true };
}

function readViewportDims() {
  return {
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    outerW: window.outerWidth,
    outerH: window.outerHeight,
  };
}

async function patchOverlay(patch) {
  const tab = await activeTab();
  if (!tab) return;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: applyOverlayPatch,
    args: [patch],
  });
  await persistState(tab.id);
}

async function refreshBrowserDims() {
  const tab = await activeTab();
  if (!tab) return;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readViewportDims,
    });
    state.browserWidth = result.innerW;
    state.browserHeight = result.innerH;
    state._chromeW = result.outerW - result.innerW;
    state._chromeH = result.outerH - result.innerH;
    updateFrameUI();
  } catch {}
}

// ---- Persistence ----

async function persistState(tabId) {
  const all = (await chrome.storage.session.get(STATE_KEY))[STATE_KEY] || {};
  all[tabId] = {
    hasOverlay: state.hasOverlay,
    figmaVisible: state.figmaVisible,
    pageVisible: state.pageVisible,
    opacity: state.opacity,
    blend: state.blend,
    offsetX: state.offsetX,
    offsetY: state.offsetY,
    step: state.step,
    frameName: state.frameName,
    frameWidth: state.frameWidth,
    frameHeight: state.frameHeight,
    channel: state.channel,
  };
  await chrome.storage.session.set({ [STATE_KEY]: all });
}

async function restoreState(tabId) {
  const all = (await chrome.storage.session.get(STATE_KEY))[STATE_KEY] || {};
  const saved = all[tabId];
  if (!saved) return;
  Object.assign(state, saved);
}

// ---- Grab from Figma ----

async function grabFromFigma() {
  if (!state.channel) {
    setStatus('Pick a channel and connect first.', 'error');
    return;
  }
  setStatus('Fetching selection…');
  try {
    const result = await sendViaWebSocket(state.channel, 'export_selection_as_image', { scale: 2 });
    const { imageData, mimeType, originalWidth, originalHeight, name: nodeName } = result;
    if (!imageData) throw new Error('No image data returned');

    const tab = await activeTab();
    const injectResult = await sendToTabStrict(tab, 'inject_figma_overlay', {
      imageData, mimeType,
      width: originalWidth, height: originalHeight,
      opacity: state.opacity,
      blendMode: state.blend !== 'normal' ? state.blend : null,
      offsetX: state.offsetX, offsetY: state.offsetY,
    });
    if (!injectResult || injectResult.error) {
      throw new Error(injectResult?.error || 'Overlay injection returned no result');
    }

    state.hasOverlay = true;
    state.figmaVisible = true;
    state.frameName = nodeName || `${originalWidth}×${originalHeight}`;
    state.frameWidth = originalWidth;
    state.frameHeight = originalHeight;
    await persistState(tab.id);
    await refreshBrowserDims();
    refreshUI();
    setStatus(`Overlaid ${originalWidth}×${originalHeight}px`, 'success');
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

async function removeOverlay() {
  const tab = await activeTab();
  if (tab) {
    await sendToTab(tab, 'clear_figma_overlay');
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: applyPageVisibility,
      args: [true],
    });
  }
  state.hasOverlay = false;
  state.frameName = null;
  state.frameWidth = null;
  state.frameHeight = null;
  state.pageVisible = true;
  state.offsetX = 0;
  state.offsetY = 0;
  if (tab) await persistState(tab.id);
  refreshUI();
  setStatus('Overlay removed.');
}

// ---- Nudge ----

async function nudge(dx, dy) {
  state.offsetX += dx;
  state.offsetY += dy;
  if (state.hasOverlay) {
    await patchOverlay({ offsetX: state.offsetX, offsetY: state.offsetY });
  }
}

// ---- Match Design (resize window) ----

async function matchDesign() {
  if (!state.frameWidth || !state.frameHeight) return;
  const tab = await activeTab();
  if (!tab) return;
  await refreshBrowserDims();
  const chromeW = state._chromeW || 0;
  const chromeH = state._chromeH || 0;
  try {
    await chrome.windows.update(tab.windowId, {
      width: state.frameWidth + chromeW,
      height: state.frameHeight + chromeH,
      state: 'normal',
    });
    setStatus(`Resized to ${state.frameWidth}×${state.frameHeight}.`, 'success');
    setTimeout(refreshBrowserDims, 200);
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

// ---- Event wiring ----

overlayCta.addEventListener('click', () => grabFromFigma());
addSelectedBtn.addEventListener('click', () => grabFromFigma());
figmaRemove.addEventListener('click', () => removeOverlay());

opacitySlider.addEventListener('input', async () => {
  state.opacity = Number(opacitySlider.value) / 100;
  updateOpacityUI();
  if (state.hasOverlay) {
    if (state.blend === 'normal') {
      await patchOverlay({ opacity: state.opacity });
    } else {
      await persistState((await activeTab()).id);
    }
  }
});

segs.forEach(seg => {
  seg.addEventListener('click', async () => {
    state.blend = seg.dataset.mode;
    updateBlendUI();
    if (state.hasOverlay) {
      const patch = { blend: state.blend };
      if (state.blend === 'normal') patch.opacity = state.opacity;
      await patchOverlay(patch);
    }
  });
});

chips.forEach(chip => {
  chip.addEventListener('click', () => {
    state.step = Number(chip.dataset.step);
    updateStepUI();
  });
});

nudgeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const dir = btn.dataset.dir;
    const s = state.step;
    if (dir === 'left') nudge(-s, 0);
    if (dir === 'right') nudge(s, 0);
    if (dir === 'up') nudge(0, -s);
    if (dir === 'down') nudge(0, s);
  });
});

resetBtn.addEventListener('click', async () => {
  state.offsetX = 0;
  state.offsetY = 0;
  if (state.hasOverlay) {
    await patchOverlay({ offsetX: 0, offsetY: 0 });
  }
});

matchBtn.addEventListener('click', () => matchDesign());

figmaEye.addEventListener('click', async () => {
  if (!state.hasOverlay) return;
  state.figmaVisible = !state.figmaVisible;
  await patchOverlay({ visible: state.figmaVisible });
  updateLayerUI();
});

channelPicker.addEventListener('change', () => {
  connBtn.disabled = !channelPicker.value;
});

connBtn.addEventListener('click', async () => {
  if (state.channel) {
    await removeOverlay();
    state.channel = null;
    await persistState((await activeTab()).id);
    setStatus('Disconnected.');
  } else if (channelPicker.value) {
    state.channel = channelPicker.value;
    await persistState((await activeTab()).id);
    setStatus(`Connected to ${state.channel}.`, 'success');
  }
  refreshUI();
});

closeBtn.addEventListener('click', () => window.close());

// ---- Tabs ----

function showTab(name) {
  activeTabName = name;
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  updateScreenUI();
}

tabs.forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

// ---- Settings ----

function renderPresets() {
  presetRow.innerHTML = '';
  for (const p of SERVER_PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'preset' + (p.url === serverUrl ? ' active' : '');
    btn.textContent = p.label;
    btn.addEventListener('click', () => updateServerUrl(p.url));
    presetRow.appendChild(btn);
  }
}

async function updateServerUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return;
  serverUrl = trimmed;
  serverUrlInput.value = trimmed;
  renderPresets();
  await setServerUrl(trimmed);
  setStatus(`Server set to ${trimmed}.`, 'success');
  await loadChannels();
}

serverUrlInput.addEventListener('change', () => updateServerUrl(serverUrlInput.value));
serverUrlInput.addEventListener('blur', () => updateServerUrl(serverUrlInput.value));

// ---- Keyboard shortcuts ----

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

  const mult = e.shiftKey ? 10 : 1;
  const s = state.step * mult;

  if (e.key === 'ArrowLeft')  { e.preventDefault(); nudge(-s, 0); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); nudge(s, 0);  return; }
  if (e.key === 'ArrowUp')    { e.preventDefault(); nudge(0, -s); return; }
  if (e.key === 'ArrowDown')  { e.preventDefault(); nudge(0, s);  return; }

  if (e.key === 'd' || e.key === 'D') {
    e.preventDefault();
    state.blend = state.blend === 'difference' ? 'normal' : 'difference';
    updateBlendUI();
    if (state.hasOverlay) {
      const patch = { blend: state.blend };
      if (state.blend === 'normal') patch.opacity = state.opacity;
      patchOverlay(patch);
    }
  }
});

// ---- Init ----

(async () => {
  serverUrl = await getServerUrl();
  serverUrlInput.value = serverUrl;
  renderPresets();

  const tab = await activeTab();
  if (tab) {
    state.tabId = tab.id;
    try { state.hostname = new URL(tab.url).hostname || '—'; } catch {}
    await restoreState(tab.id);
  }
  await loadChannels();

  if (!state.channel && state.channels.length > 0) {
    state.channel = state.channels[0].channel;
    if (state.tabId != null) await persistState(state.tabId);
  }

  await refreshBrowserDims();
  refreshUI();
  refreshSelectedNodeName();
})();

window.addEventListener('focus', () => refreshSelectedNodeName());
