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

  if (blendMode === true || (typeof blendMode === 'string' && blendMode && blendMode !== 'normal')) {
    wrap.style.mixBlendMode = blendMode === true ? 'difference' : blendMode;
    wrap.style.isolation = 'isolate';
    wrap.style.opacity = '1';
  }

  window.__figmaOverlayCleanup = () => {};

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
