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

function buildStableSelector(el) {
  if (!el || el.nodeType !== 1) return null;
  if (el.getAttribute && el.getAttribute('data-testid')) {
    return `[data-testid="${cssEscape(el.getAttribute('data-testid'))}"]`;
  }
  if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) {
    return `#${el.id}`;
  }
  const path = [];
  let node = el;
  const MAX_DEPTH = 6;
  while (node && node.nodeType === 1 && path.length < MAX_DEPTH) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') {
      path.unshift(tag);
      break;
    }
    if (node.getAttribute && node.getAttribute('data-testid')) {
      path.unshift(`[data-testid="${cssEscape(node.getAttribute('data-testid'))}"]`);
      break;
    }
    if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
      path.unshift(`#${node.id}`);
      break;
    }
    const parent = node.parentElement;
    if (!parent) {
      path.unshift(tag);
      break;
    }
    const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
    if (siblings.length === 1) {
      path.unshift(tag);
    } else {
      const idx = Array.from(parent.children).indexOf(node) + 1;
      path.unshift(`${tag}:nth-child(${idx})`);
    }
    node = parent;
  }
  return path.join(' > ');
}

function cssEscape(s) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^A-Za-z0-9_-]/g, '\\$&');
}

function collectAllElementRects({ root = 'body', maxNodes = 1500, includeZeroRect = false } = {}) {
  const rootEl = document.querySelector(root);
  if (!rootEl) return { error: `No element matches: ${root}` };

  const out = [];
  let truncated = false;
  // Track which original-tree parent each emitted node's logical parent was. When we
  // skip a zero-rect element we attach its children to its nearest visible ancestor.
  function visit(el, parentIdx, depth) {
    if (out.length >= maxNodes) {
      truncated = true;
      return;
    }
    const r = el.getBoundingClientRect();
    const visible = !(r.width === 0 && r.height === 0);
    let myIdx = parentIdx;
    if (visible || includeZeroRect) {
      myIdx = out.length;
      out.push({
        idx: myIdx,
        parent: parentIdx,
        tag: el.tagName ? el.tagName.toLowerCase() : '#unknown',
        id: el.id || null,
        testId: el.getAttribute ? el.getAttribute('data-testid') : null,
        depth,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        selector: buildStableSelector(el),
        text: (() => {
          let t = '';
          for (const child of el.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
              const piece = child.textContent.trim();
              if (piece) t += (t ? ' ' : '') + piece;
              if (t.length > 80) break;
            }
          }
          return t.slice(0, 80) || null;
        })(),
      });
    }
    for (const child of el.children) visit(child, myIdx, depth + 1);
  }

  visit(rootEl, -1, 0);
  return { root, nodes: out, truncated, dpr: window.devicePixelRatio || 1 };
}

function resolveSelectorAtPoint({ x, y, imagePixels = false }) {
  const dpr = window.devicePixelRatio || 1;
  const cssX = imagePixels ? x / dpr : x;
  const cssY = imagePixels ? y / dpr : y;
  const el = document.elementFromPoint(cssX, cssY);
  if (!el) {
    return { selector: null, x: cssX, y: cssY, dpr, tag: null };
  }
  const selector = buildStableSelector(el);
  return {
    selector,
    x: cssX,
    y: cssY,
    dpr,
    tag: el.tagName ? el.tagName.toLowerCase() : null,
    id: el.id || null,
    testId: el.getAttribute ? el.getAttribute('data-testid') : null,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  try {
    switch (msg.command) {
      case 'get_dom_nodes':       sendResponse(getDomNodes(msg.params ?? {})); break;
      case 'get_computed_styles': sendResponse(getComputedStyles(msg.params ?? {})); break;
      case 'inject_figma_overlay': sendResponse(injectOverlay(msg.params ?? {})); break;
      case 'clear_figma_overlay': sendResponse(clearOverlay()); break;
      case 'resolve_selector_at_point': sendResponse(resolveSelectorAtPoint(msg.params ?? {})); break;
      case 'collect_all_element_rects': sendResponse(collectAllElementRects(msg.params ?? {})); break;
      default: sendResponse({ error: `Unknown command: ${msg.command}` });
    }
  } catch (e) {
    sendResponse({ error: e.message });
  }
  return true;
});
