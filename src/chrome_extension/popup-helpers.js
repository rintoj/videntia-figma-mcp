// Pure helpers extracted from popup.js for unit testing.
// Loaded by popup.html as a <script> tag (attaches to self) and required by
// tests via CommonJS exports at the bottom.

/**
 * Map a popup blend mode name to the CSS state required on the overlay element.
 * Returns { mixBlendMode, isolation, pinnedOpacity }. When pinnedOpacity is true,
 * the caller should set opacity to 1 (difference/multiply/overlay only make
 * visual sense at full opacity — the popup slider still persists user intent).
 */
function blendModeToCss(mode) {
  if (mode === "normal" || mode == null) {
    return { mixBlendMode: "", isolation: "", pinnedOpacity: false };
  }
  const known = ["difference", "multiply", "overlay"];
  if (!known.includes(mode)) {
    return { mixBlendMode: "", isolation: "", pinnedOpacity: false };
  }
  return { mixBlendMode: mode, isolation: "isolate", pinnedOpacity: true };
}

/**
 * Convert a nudge direction + step into a {dx, dy} delta.
 * Unknown directions or non-positive steps return {dx: 0, dy: 0}.
 */
function nudgeDelta(direction, step) {
  if (typeof step !== "number" || !Number.isFinite(step) || step <= 0) {
    return { dx: 0, dy: 0 };
  }
  switch (direction) {
    case "left":  return { dx: -step, dy: 0 };
    case "right": return { dx:  step, dy: 0 };
    case "up":    return { dx: 0, dy: -step };
    case "down":  return { dx: 0, dy:  step };
    default:      return { dx: 0, dy: 0 };
  }
}

/**
 * Translate a keydown event into a popup action.
 * Returns null for unhandled keys (caller should not preventDefault).
 * - Arrow keys → { type: 'nudge', dx, dy } using step * (10 if shift else 1)
 * - 'd'/'D'   → { type: 'toggle-diff' }
 */
function keyboardAction(event, step) {
  const mult = event.shiftKey ? 10 : 1;
  const s = (typeof step === "number" && step > 0 ? step : 1) * mult;
  switch (event.key) {
    case "ArrowLeft":  return { type: "nudge", dx: -s, dy: 0 };
    case "ArrowRight": return { type: "nudge", dx:  s, dy: 0 };
    case "ArrowUp":    return { type: "nudge", dx: 0, dy: -s };
    case "ArrowDown":  return { type: "nudge", dx: 0, dy:  s };
    case "d":
    case "D":
      return { type: "toggle-diff" };
    default:
      return null;
  }
}

/**
 * Clamp opacity to [0, 1]. Accepts numbers; returns the fallback (default 0.6)
 * for non-numeric or NaN inputs.
 */
function clampOpacity(value, fallback = 0.6) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Decide which channel to auto-connect to on popup open.
 * Returns the existing channel id if still present in the list, otherwise the
 * first channel, otherwise null.
 */
function pickInitialChannel(channels, currentChannel) {
  if (!Array.isArray(channels) || channels.length === 0) return null;
  if (currentChannel && channels.some((c) => c.channel === currentChannel)) {
    return currentChannel;
  }
  return channels[0].channel;
}

/**
 * Extract a host label from a URL. Falls back to "—" if the URL is not
 * parseable (e.g. chrome://newtab or about:blank).
 */
function parseHostname(url, fallback = "—") {
  if (!url || typeof url !== "string") return fallback;
  try {
    return new URL(url).hostname || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Escape HTML so a user-controlled string (Figma node name) can be safely
 * inserted via innerHTML.
 */
function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

/**
 * Compute the chrome.windows.update target dimensions for "Match Design".
 * Caller passes the design frame size and the current browser-chrome overhead
 * (outerW-innerW, outerH-innerH). availW/H cap the result to the user's screen.
 */
function matchDesignWindowSize({ frameWidth, frameHeight, chromeOffsetW = 0, chromeOffsetH = 0, availW, availH }) {
  const w = frameWidth + chromeOffsetW;
  const h = frameHeight + chromeOffsetH;
  return {
    width:  availW ? Math.min(w, availW) : w,
    height: availH ? Math.min(h, availH) : h,
  };
}

/**
 * Decide what empty-state copy to show given connection + selection state.
 * Returns { desc, ctaEnabled, chipVisible, chipEmpty, chipName }.
 */
function emptyStateView({ connected, selectedNodeName }) {
  if (!connected) {
    return {
      desc: "Open Settings to connect to a Figma channel.",
      ctaEnabled: false,
      chipVisible: false,
      chipEmpty: true,
      chipName: "—",
    };
  }
  if (selectedNodeName) {
    return {
      desc: "Select a frame in Figma, then tap the button below to overlay it.",
      ctaEnabled: true,
      chipVisible: true,
      chipEmpty: false,
      chipName: selectedNodeName,
    };
  }
  return {
    desc: "Select a frame in Figma, then tap the button below to overlay it.",
    ctaEnabled: false,
    chipVisible: true,
    chipEmpty: true,
    chipName: "Nothing selected",
  };
}

// Browser surface (popup.html loads this before popup.js).
if (typeof self !== "undefined") {
  self.blendModeToCss = blendModeToCss;
  self.nudgeDelta = nudgeDelta;
  self.keyboardAction = keyboardAction;
  self.clampOpacity = clampOpacity;
  self.pickInitialChannel = pickInitialChannel;
  self.parseHostname = parseHostname;
  self.escapeHtml = escapeHtml;
  self.matchDesignWindowSize = matchDesignWindowSize;
  self.emptyStateView = emptyStateView;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    blendModeToCss,
    nudgeDelta,
    keyboardAction,
    clampOpacity,
    pickInitialChannel,
    parseHostname,
    escapeHtml,
    matchDesignWindowSize,
    emptyStateView,
  };
}
