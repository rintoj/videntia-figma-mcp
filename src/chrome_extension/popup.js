const WS_URL = 'ws://localhost:3055';
const CHANNELS_URL = 'http://localhost:3055/channels';

const logEl = document.getElementById('log');
function dbg(...args) {
  const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  console.log('[figma-overlay]', line);
  logEl.textContent += line + '\n';
  logEl.scrollTop = logEl.scrollHeight;
}

const channelSelect = document.getElementById('channelSelect');
const resizeWindowChk = document.getElementById('resizeWindow');
const refreshBtn = document.getElementById('refreshBtn');
const grabBtn = document.getElementById('grabBtn');
const clearBtn = document.getElementById('clearBtn');
const statusEl = document.getElementById('status');

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (type ? ` ${type}` : '');
}

async function loadChannels() {
  try {
    const res = await fetch(CHANNELS_URL);
    const list = await res.json();
    // Only show channels that have a Figma plugin connected (fileName present)
    const figmaChannels = list.filter(ch => ch.clients >= 1 && ch.fileName);

    channelSelect.innerHTML = '';
    if (figmaChannels.length === 0) {
      channelSelect.innerHTML = '<option value="">— no channels found —</option>';
      grabBtn.disabled = true;
      setStatus('No active Figma channels. Open the plugin in Figma.');
      return;
    }

    figmaChannels.forEach(ch => {
      const opt = document.createElement('option');
      opt.value = ch.channel;
      opt.textContent = ch.fileName ? `${ch.channel} (${ch.fileName})` : ch.channel;
      channelSelect.appendChild(opt);
    });

    grabBtn.disabled = false;
    setStatus('Select a channel and click Grab.');
  } catch {
    channelSelect.innerHTML = '<option value="">— server not running —</option>';
    grabBtn.disabled = true;
    setStatus('Cannot reach localhost:3055. Is the socket server running?', 'error');
  }
}

function sendViaWebSocket(channel, command, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const id = crypto.randomUUID();
    let joined = false;
    let settled = false;

    function settle(fn, val) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    }

    const timer = setTimeout(() => {
      dbg('TIMEOUT — joined:', joined, 'cmd:', command);
      ws.close();
      settle(reject, new Error(`Timed out waiting for Figma response (command: ${command})`));
    }, 15000);

    ws.onopen = () => {
      dbg('WS open, joining:', channel);
      ws.send(JSON.stringify({ type: 'join', channel, id }));
    };

    ws.onmessage = (evt) => {
      let data;
      try { data = JSON.parse(evt.data); } catch { return; }
      dbg('msg:', data.type, JSON.stringify(data).slice(0, 200));

      // Join confirmation: { type:'system', message:{ result:'Connected...' } }
      if (!joined && data.type === 'system' && typeof data.message === 'object' && data.message?.result) {
        joined = true;
        dbg('joined OK, sending:', command, id);
        ws.send(JSON.stringify({
          id,
          type: 'message',
          channel,
          message: { id, command, params: { ...params, commandId: id } },
        }));
        return;
      }

      // Command response: type is 'message' or 'broadcast'
      if ((data.type === 'message' || data.type === 'broadcast') && data.message?.id === id) {
        dbg('response for', command, 'error:', data.message.error ?? 'none');
        ws.close();
        if (data.message.error) {
          settle(reject, new Error(data.message.error));
        } else {
          settle(resolve, data.message.result);
        }
      }
    };

    ws.onerror = (e) => {
      dbg('WS error:', e.message || e.type);
      settle(reject, new Error('WebSocket error — is the socket server running on port 3055?'));
    };

    ws.onclose = (e) => {
      dbg('WS closed, code:', e.code, 'settled:', settled);
      if (!settled) {
        settle(reject, new Error('WebSocket closed before Figma responded (code ' + e.code + ')'));
      }
    };
  });
}

async function grabFromFigma() {
  const channel = channelSelect.value;
  if (!channel) return;

  grabBtn.disabled = true;
  setStatus('Fetching selection…', 'loading');

  try {
    // Single round-trip: get selection + export in the plugin
    const exportResult = await sendViaWebSocket(channel, 'export_selection_as_image', { scale: 2 });
    const { imageData, mimeType, exportedWidth, exportedHeight } = exportResult;
    if (!imageData) throw new Error('No image data returned');

    // Step 3: optionally resize window to frame dimensions
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (resizeWindowChk.checked) {
      // Measure browser chrome offset (title bar, bookmarks bar, etc.) from the tab
      const [{ result: chromeOffset }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          w: window.outerWidth - window.innerWidth,
          h: window.outerHeight - window.innerHeight,
        }),
      });
      const maxW = window.screen.availWidth;
      const maxH = window.screen.availHeight;
      const fw = exportResult.originalWidth;
      const fh = exportResult.originalHeight;
      const outerW = fw + chromeOffset.w;
      const outerH = fh + chromeOffset.h;

      // Chrome refuses to shrink the OS window below ~500px (~400 on Win/Linux).
      // For sub-minimum frames, attach the debugger and emulate the viewport via
      // Emulation.setDeviceMetricsOverride — same mechanism DevTools Device Mode uses.
      const WINDOW_MIN_W = 500;
      const needsEmulation = outerW < WINDOW_MIN_W;

      const windowOuterW = needsEmulation
        ? WINDOW_MIN_W
        : (outerW <= maxW ? outerW : maxW);
      const windowOuterH = outerH <= maxH ? outerH : maxH;
      await chrome.windows.update(tab.windowId, { width: windowOuterW, height: windowOuterH });
      dbg('chrome offset', chromeOffset.w, 'x', chromeOffset.h, '→ window', windowOuterW, 'x', windowOuterH);

      if (needsEmulation) {
        await attachDebuggerAndEmulate(tab.id, fw, fh);
        dbg('debugger emulation', fw, 'x', fh, 'on tab', tab.id);
      } else {
        await detachDebuggerIfAttached(tab.id);
      }
    }

    // Step 4: inject overlay into active tab
    const { originalWidth, originalHeight } = exportResult;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectOverlay,
      args: [imageData, mimeType, originalWidth, originalHeight],
    });

    setStatus(`Overlay injected (${originalWidth}×${originalHeight}px)`, 'success');
  } catch (err) {
    setStatus(err.message, 'error');
  }

  grabBtn.disabled = false;
}

async function clearOverlay() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      if (window.__figmaOverlayCleanup) { try { window.__figmaOverlayCleanup(); } catch {} window.__figmaOverlayCleanup = null; }
      document.getElementById('__figma_overlay__')?.remove();
      document.getElementById('__figma_overlay___controls')?.remove();
    },
  });
  await detachDebuggerIfAttached(tab.id);
  setStatus('Overlay cleared.');
}

const ATTACHED_TABS_KEY = 'attachedDebuggerTabs';

async function attachDebuggerAndEmulate(tabId, width, height) {
  const target = { tabId };
  const attached = (await chrome.storage.session.get(ATTACHED_TABS_KEY))[ATTACHED_TABS_KEY] || {};
  if (!attached[tabId]) {
    try {
      await chrome.debugger.attach(target, '1.3');
    } catch (e) {
      // "Another debugger is already attached" — likely DevTools open
      throw new Error('Cannot emulate viewport: ' + (e.message || e) +
        '. Close DevTools on this tab and retry.');
    }
    attached[tabId] = true;
    await chrome.storage.session.set({ [ATTACHED_TABS_KEY]: attached });
  }
  await chrome.debugger.sendCommand(target, 'Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await chrome.debugger.sendCommand(target, 'Emulation.setTouchEmulationEnabled', {
    enabled: true,
  });
}

async function detachDebuggerIfAttached(tabId) {
  const attached = (await chrome.storage.session.get(ATTACHED_TABS_KEY))[ATTACHED_TABS_KEY] || {};
  if (!attached[tabId]) return;
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Emulation.clearDeviceMetricsOverride');
  } catch {}
  try {
    await chrome.debugger.detach({ tabId });
  } catch {}
  delete attached[tabId];
  await chrome.storage.session.set({ [ATTACHED_TABS_KEY]: attached });
}

// Injected into the page — must be self-contained (no closure refs)
function injectOverlay(imageData, mimeType, imgW, imgH) {
  const OVERLAY_ID = '__figma_overlay__';
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) existing.remove();

  const src = `data:${mimeType};base64,${imageData}`;

  // Overlay image — absolute so it scrolls with the page
  const wrap = document.createElement('div');
  wrap.id = OVERLAY_ID;
  Object.assign(wrap.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: `${imgW}px`,
    zIndex: '2147483646',
    userSelect: 'none',
    pointerEvents: 'none',
  });

  const img = document.createElement('img');
  img.src = src;
  Object.assign(img.style, {
    display: 'block',
    width: '100%',
    height: 'auto',
    imageRendering: 'crisp-edges',
    pointerEvents: 'none',
  });

  wrap.appendChild(img);
  document.body.appendChild(wrap);

  // Controls — anchored to viewport via <html>, immune to body transforms/overflow
  const controls = document.createElement('div');
  controls.id = OVERLAY_ID + '_controls';
  Object.assign(controls.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'rgba(20,20,20,0.88)',
    backdropFilter: 'blur(8px)',
    borderRadius: '20px',
    padding: '6px 12px',
    fontFamily: 'sans-serif',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  });

  const label = document.createElement('span');
  label.textContent = 'Figma';
  Object.assign(label.style, { color: '#888', fontSize: '11px' });

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '10';
  slider.max = '100';
  slider.value = '50';
  Object.assign(slider.style, { width: '72px', cursor: 'pointer', accentColor: '#6b6bff' });

  const btnStyle = {
    background: 'none', border: 'none', color: '#888',
    cursor: 'pointer', fontSize: '11px', padding: '2px 6px', lineHeight: '1',
    borderRadius: '4px',
  };

  const blendBtn = document.createElement('button');
  blendBtn.textContent = 'diff';
  blendBtn.title = 'Toggle difference blend mode (D)';
  Object.assign(blendBtn.style, btnStyle);
  let blendOn = false;
  const toggleBlend = () => {
    blendOn = !blendOn;
    img.style.mixBlendMode = blendOn ? 'difference' : '';
    wrap.style.background = blendOn ? '#fff' : '';
    blendBtn.style.background = blendOn ? '#6b6bff' : 'none';
    blendBtn.style.color = blendOn ? '#fff' : '#888';
  };
  blendBtn.addEventListener('click', toggleBlend);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  Object.assign(closeBtn.style, { ...btnStyle, fontSize: '13px' });

  wrap.style.opacity = '0.5';

  controls.append(label, slider, blendBtn, closeBtn);
  document.documentElement.appendChild(controls);

  slider.addEventListener('input', () => {
    wrap.style.opacity = (slider.value / 100).toString();
  });

  let dx = 0, dy = 0;
  const applyPos = () => { wrap.style.left = `${dx}px`; wrap.style.top = `${dy}px`; };
  const onKey = (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.target?.isContentEditable) return;
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case 'ArrowLeft':  dx -= step; applyPos(); break;
      case 'ArrowRight': dx += step; applyPos(); break;
      case 'ArrowUp':    dy -= step; applyPos(); break;
      case 'ArrowDown':  dy += step; applyPos(); break;
      case 'd': case 'D': toggleBlend(); break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);
  window.__figmaOverlayCleanup = () => document.removeEventListener('keydown', onKey, true);

  closeBtn.addEventListener('click', () => {
    wrap.remove();
    controls.remove();
    if (window.__figmaOverlayCleanup) { try { window.__figmaOverlayCleanup(); } catch {} window.__figmaOverlayCleanup = null; }
    try { chrome.runtime?.sendMessage({ type: 'detachDebugger' }); } catch {}
  });
}

async function checkBrowserStatus() {
  const el = document.getElementById('browserStatus');
  const dot = document.getElementById('bridgeDot');
  const set = (text, color) => {
    el.textContent = text;
    el.style.color = color;
    if (dot) dot.style.background = color;
  };
  try {
    const res = await fetch('http://localhost:3055/channels');
    const channels = await res.json();
    const ch = channels.find(c => c.channel === 'browser');
    if (ch && ch.clients >= 1) {
      set('Claude bridge: connected', '#4caf50');
    } else {
      set('Claude bridge: disconnected', '#707070');
    }
  } catch {
    set('Claude bridge: server offline', '#ef4444');
  }
}

refreshBtn.addEventListener('click', () => { loadChannels(); checkBrowserStatus(); });
grabBtn.addEventListener('click', grabFromFigma);
clearBtn.addEventListener('click', clearOverlay);

loadChannels();
checkBrowserStatus();
