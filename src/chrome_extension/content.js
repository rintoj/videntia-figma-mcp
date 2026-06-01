// content.js — injected into every page, handles browser inspection commands

const SAFE_ATTRS = new Set([
  'id', 'class', 'href', 'src', 'alt', 'type', 'role', 'aria-label',
  'data-testid', 'placeholder', 'name', 'value', 'disabled', 'checked',
  'for', 'action', 'method', 'target', 'rel',
]);

const CURATED_STYLES = [
  'color', 'background-color', 'background-image',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border', 'border-radius', 'border-color', 'border-width',
  'display', 'position', 'width', 'height', 'max-width', 'min-height',
  'opacity', 'box-shadow', 'text-decoration', 'text-align', 'white-space',
  'flex-direction', 'align-items', 'justify-content', 'gap', 'flex-wrap',
  'grid-template-columns', 'grid-template-rows',
  'z-index', 'overflow', 'cursor', 'visibility',
];

function getDomNodes({ selector = 'body', depth = 3, includeText = true, includeAttributes = true }) {
  const MAX_NODES = 500;
  const MAX_TEXT = 200;
  let nodeCount = 0;

  function serialize(el, d) {
    if (!el || nodeCount >= MAX_NODES || d <= 0) return null;
    nodeCount++;

    const node = { tag: el.tagName?.toLowerCase() ?? '#unknown' };

    if (includeAttributes && el.attributes) {
      const attrs = {};
      for (const attr of el.attributes) {
        if (SAFE_ATTRS.has(attr.name)) attrs[attr.name] = attr.value;
      }
      if (Object.keys(attrs).length) node.attributes = attrs;
    }

    if (includeText) {
      const parts = [];
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const t = child.textContent.trim();
          if (t) parts.push(t);
        }
      }
      if (parts.length) node.text = parts.join(' ').slice(0, MAX_TEXT);
    }

    try {
      const r = el.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        node.rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      }
    } catch {}

    if (d > 1 && el.children?.length) {
      const children = [];
      for (const child of el.children) {
        const s = serialize(child, d - 1);
        if (s) children.push(s);
      }
      if (children.length) node.children = children;
    }

    return node;
  }

  try {
    const roots = Array.from(document.querySelectorAll(selector));
    return {
      selector,
      matched: roots.length,
      truncated: false,
      nodes: roots.map(el => serialize(el, depth)).filter(Boolean),
      nodeCount,
    };
  } catch (e) {
    return { error: `Selector error: ${e.message}` };
  }
}

function getComputedStyles({ selector, properties }) {
  try {
    const el = document.querySelector(selector);
    if (!el) return { error: `No element matches: ${selector}` };

    const computed = window.getComputedStyle(el);
    const props = (properties?.length) ? properties : CURATED_STYLES;
    const styles = {};
    for (const prop of props) {
      const val = computed.getPropertyValue(prop).trim();
      if (val) styles[prop] = val;
    }

    return {
      selector,
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      className: el.className || undefined,
      styles,
    };
  } catch (e) {
    return { error: e.message };
  }
}

function injectOverlay({ imageData, mimeType = 'image/png', width, height, opacity = 0.5, cropTop = 0, cropBottom = 0, offsetX = 0, offsetY = 0, blendMode = false }) {
  console.log('[figma-overlay] inject', { width, height, opacity, cropTop, cropBottom, offsetX, offsetY, blendMode });
  const OVERLAY_ID = '__figma_overlay__';
  if (window.__figmaOverlayCleanup) { try { window.__figmaOverlayCleanup(); } catch {} }
  document.getElementById(OVERLAY_ID)?.remove();
  document.getElementById(OVERLAY_ID + '_controls')?.remove();

  const src = `data:${mimeType};base64,${imageData}`;

  const visibleHeight = Math.max(0, height - cropTop - cropBottom);
  const cropped = cropTop > 0 || cropBottom > 0;

  const wrap = document.createElement('div');
  wrap.id = OVERLAY_ID;
  Object.assign(wrap.style, {
    position: 'absolute', top: `${offsetY}px`, left: `${offsetX}px`,
    width: `${width}px`,
    ...(cropped ? { height: `${visibleHeight}px`, overflow: 'hidden' } : {}),
    zIndex: '2147483646',
    userSelect: 'none', pointerEvents: 'none',
    opacity: String(opacity),
  });

  const img = document.createElement('img');
  img.src = src;
  Object.assign(img.style, {
    display: 'block', width: '100%', height: 'auto',
    ...(cropTop > 0 ? { marginTop: `-${cropTop}px` } : {}),
    imageRendering: 'crisp-edges', pointerEvents: 'none',
  });
  wrap.appendChild(img);
  document.body.appendChild(wrap);

  const controls = document.createElement('div');
  controls.id = OVERLAY_ID + '_controls';
  Object.assign(controls.style, {
    position: 'fixed', bottom: '20px', right: '20px', zIndex: '2147483647',
    display: 'flex', alignItems: 'center', gap: '8px',
    background: 'rgba(20,20,20,0.88)', backdropFilter: 'blur(8px)',
    borderRadius: '20px', padding: '6px 12px', fontFamily: 'sans-serif',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  });

  const label = document.createElement('span');
  label.textContent = 'Figma';
  Object.assign(label.style, { color: '#888', fontSize: '11px' });

  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = '100';
  slider.value = String(Math.round(opacity * 100));
  Object.assign(slider.style, { width: '72px', cursor: 'pointer', accentColor: '#6b6bff' });
  slider.addEventListener('input', () => { wrap.style.opacity = String(slider.value / 100); });

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
    wrap.style.mixBlendMode = blendOn ? 'difference' : '';
    wrap.style.isolation = blendOn ? 'isolate' : '';
    wrap.style.opacity = blendOn ? '1' : String(opacity);
    blendBtn.style.background = blendOn ? '#6b6bff' : 'none';
    blendBtn.style.color = blendOn ? '#fff' : '#888';
  };
  blendBtn.addEventListener('click', toggleBlend);
  if (blendMode) toggleBlend();

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  Object.assign(closeBtn.style, { ...btnStyle, fontSize: '13px' });
  const onClose = () => {
    wrap.remove();
    controls.remove();
    document.removeEventListener('keydown', onKey, true);
    try { chrome.runtime?.sendMessage({ type: 'detachDebugger' }); } catch {}
  };
  closeBtn.addEventListener('click', onClose);

  let dx = offsetX, dy = offsetY;
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

  controls.append(label, slider, blendBtn, closeBtn);
  document.documentElement.appendChild(controls);

  return { success: true, width, height };
}

function clearOverlay() {
  if (window.__figmaOverlayCleanup) { try { window.__figmaOverlayCleanup(); } catch {} window.__figmaOverlayCleanup = null; }
  document.getElementById('__figma_overlay__')?.remove();
  document.getElementById('__figma_overlay___controls')?.remove();
  return { success: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  try {
    switch (msg.command) {
      case 'get_dom_nodes':       sendResponse(getDomNodes(msg.params ?? {})); break;
      case 'get_computed_styles': sendResponse(getComputedStyles(msg.params ?? {})); break;
      case 'inject_figma_overlay': sendResponse(injectOverlay(msg.params ?? {})); break;
      case 'clear_figma_overlay': sendResponse(clearOverlay()); break;
      default: sendResponse({ error: `Unknown command: ${msg.command}` });
    }
  } catch (e) {
    sendResponse({ error: e.message });
  }
  return true;
});
