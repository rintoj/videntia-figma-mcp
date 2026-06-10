import { describe, it, expect } from "bun:test";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const helpers = require("../../../src/chrome_extension/popup-helpers.js");

const {
  blendModeToCss,
  nudgeDelta,
  keyboardAction,
  clampOpacity,
  pickInitialChannel,
  parseHostname,
  escapeHtml,
  matchDesignWindowSize,
  emptyStateView,
} = helpers;

describe("popup-helpers / blendModeToCss", () => {
  it("normal mode clears mix-blend and isolation", () => {
    expect(blendModeToCss("normal")).toEqual({ mixBlendMode: "", isolation: "", pinnedOpacity: false });
  });

  it("difference, multiply, overlay all isolate and pin opacity", () => {
    for (const mode of ["difference", "multiply", "overlay"]) {
      expect(blendModeToCss(mode)).toEqual({ mixBlendMode: mode, isolation: "isolate", pinnedOpacity: true });
    }
  });

  it("unknown mode is treated as normal (no surprise CSS)", () => {
    expect(blendModeToCss("plasma")).toEqual({ mixBlendMode: "", isolation: "", pinnedOpacity: false });
  });

  it("null/undefined is treated as normal", () => {
    expect(blendModeToCss(null)).toEqual({ mixBlendMode: "", isolation: "", pinnedOpacity: false });
    expect(blendModeToCss(undefined)).toEqual({ mixBlendMode: "", isolation: "", pinnedOpacity: false });
  });
});

describe("popup-helpers / nudgeDelta", () => {
  it("translates each direction with the given step", () => {
    expect(nudgeDelta("left", 4)).toEqual({ dx: -4, dy: 0 });
    expect(nudgeDelta("right", 4)).toEqual({ dx: 4, dy: 0 });
    expect(nudgeDelta("up", 4)).toEqual({ dx: 0, dy: -4 });
    expect(nudgeDelta("down", 4)).toEqual({ dx: 0, dy: 4 });
  });

  it("unknown direction returns zero delta", () => {
    expect(nudgeDelta("diagonal", 4)).toEqual({ dx: 0, dy: 0 });
    expect(nudgeDelta(undefined, 4)).toEqual({ dx: 0, dy: 0 });
  });

  it("invalid step returns zero delta", () => {
    expect(nudgeDelta("left", 0)).toEqual({ dx: 0, dy: 0 });
    expect(nudgeDelta("left", -2)).toEqual({ dx: 0, dy: 0 });
    expect(nudgeDelta("left", NaN)).toEqual({ dx: 0, dy: 0 });
    expect(nudgeDelta("left", "4" as any)).toEqual({ dx: 0, dy: 0 });
  });
});

describe("popup-helpers / keyboardAction", () => {
  const ev = (key: string, shift = false) => ({ key, shiftKey: shift }) as any;

  it("arrow keys produce nudge actions using step", () => {
    expect(keyboardAction(ev("ArrowLeft"), 1)).toEqual({ type: "nudge", dx: -1, dy: 0 });
    expect(keyboardAction(ev("ArrowRight"), 4)).toEqual({ type: "nudge", dx: 4, dy: 0 });
    expect(keyboardAction(ev("ArrowUp"), 8)).toEqual({ type: "nudge", dx: 0, dy: -8 });
    expect(keyboardAction(ev("ArrowDown"), 1)).toEqual({ type: "nudge", dx: 0, dy: 1 });
  });

  it("shift multiplies step by 10", () => {
    expect(keyboardAction(ev("ArrowLeft", true), 1)).toEqual({ type: "nudge", dx: -10, dy: 0 });
    expect(keyboardAction(ev("ArrowDown", true), 4)).toEqual({ type: "nudge", dx: 0, dy: 40 });
  });

  it("d/D returns toggle-diff", () => {
    expect(keyboardAction(ev("d"), 1)).toEqual({ type: "toggle-diff" });
    expect(keyboardAction(ev("D"), 1)).toEqual({ type: "toggle-diff" });
  });

  it("other keys return null", () => {
    expect(keyboardAction(ev("a"), 1)).toBeNull();
    expect(keyboardAction(ev("Enter"), 1)).toBeNull();
    expect(keyboardAction(ev(" "), 1)).toBeNull();
  });

  it("non-positive step still works at the default of 1", () => {
    expect(keyboardAction(ev("ArrowRight"), 0)).toEqual({ type: "nudge", dx: 1, dy: 0 });
    expect(keyboardAction(ev("ArrowRight"), undefined as any)).toEqual({ type: "nudge", dx: 1, dy: 0 });
  });
});

describe("popup-helpers / clampOpacity", () => {
  it("clamps to [0, 1]", () => {
    expect(clampOpacity(0)).toBe(0);
    expect(clampOpacity(1)).toBe(1);
    expect(clampOpacity(0.5)).toBe(0.5);
    expect(clampOpacity(-0.2)).toBe(0);
    expect(clampOpacity(1.7)).toBe(1);
  });

  it("falls back for non-numeric inputs", () => {
    expect(clampOpacity(undefined)).toBe(0.6);
    expect(clampOpacity(NaN)).toBe(0.6);
    expect(clampOpacity("0.5" as any)).toBe(0.6);
    expect(clampOpacity(undefined, 0.9)).toBe(0.9);
  });
});

describe("popup-helpers / pickInitialChannel", () => {
  const chans = [{ channel: "a" }, { channel: "b" }, { channel: "c" }];

  it("returns null on empty input", () => {
    expect(pickInitialChannel([], null)).toBeNull();
    expect(pickInitialChannel(undefined as any, null)).toBeNull();
  });

  it("keeps the current channel if still listed", () => {
    expect(pickInitialChannel(chans, "b")).toBe("b");
  });

  it("falls back to first when current is missing or unknown", () => {
    expect(pickInitialChannel(chans, null)).toBe("a");
    expect(pickInitialChannel(chans, "z")).toBe("a");
  });
});

describe("popup-helpers / parseHostname", () => {
  it("extracts hostname from a normal URL", () => {
    expect(parseHostname("https://figma-mcp.videntia.dev/path")).toBe("figma-mcp.videntia.dev");
    expect(parseHostname("http://localhost:3055")).toBe("localhost");
  });

  it("falls back when URL is unparseable or missing", () => {
    expect(parseHostname("chrome://newtab")).toBe("newtab");
    expect(parseHostname("not a url")).toBe("—");
    expect(parseHostname("")).toBe("—");
    expect(parseHostname(undefined as any)).toBe("—");
    expect(parseHostname(undefined as any, "n/a")).toBe("n/a");
  });
});

describe("popup-helpers / escapeHtml", () => {
  it("escapes the dangerous five characters", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
    expect(escapeHtml("A & \"B\" & 'C'")).toBe("A &amp; &quot;B&quot; &amp; &#39;C&#39;");
  });

  it("handles null/undefined as empty string", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("leaves safe text alone", () => {
    expect(escapeHtml("Pricing / Desktop")).toBe("Pricing / Desktop");
  });
});

describe("popup-helpers / matchDesignWindowSize", () => {
  it("adds chrome offset to frame dimensions", () => {
    expect(matchDesignWindowSize({ frameWidth: 1440, frameHeight: 900, chromeOffsetW: 0, chromeOffsetH: 80 })).toEqual({
      width: 1440,
      height: 980,
    });
  });

  it("caps to availW/H so we don't request bigger than the screen", () => {
    expect(
      matchDesignWindowSize({
        frameWidth: 2560,
        frameHeight: 1600,
        chromeOffsetW: 0,
        chromeOffsetH: 80,
        availW: 1920,
        availH: 1080,
      }),
    ).toEqual({ width: 1920, height: 1080 });
  });

  it("defaults chrome offsets to 0", () => {
    expect(matchDesignWindowSize({ frameWidth: 800, frameHeight: 600 })).toEqual({ width: 800, height: 600 });
  });
});

describe("popup-helpers / emptyStateView", () => {
  it("not connected → settings prompt, CTA disabled, chip hidden", () => {
    const v = emptyStateView({ connected: false, selectedNodeName: null });
    expect(v.desc).toContain("Settings");
    expect(v.ctaEnabled).toBe(false);
    expect(v.chipVisible).toBe(false);
  });

  it("connected + selection → CTA enabled, chip shows name", () => {
    const v = emptyStateView({ connected: true, selectedNodeName: "Pricing/Desktop" });
    expect(v.desc).toContain("Select a frame");
    expect(v.ctaEnabled).toBe(true);
    expect(v.chipVisible).toBe(true);
    expect(v.chipEmpty).toBe(false);
    expect(v.chipName).toBe("Pricing/Desktop");
  });

  it("connected + no selection → CTA disabled, chip shows empty placeholder", () => {
    const v = emptyStateView({ connected: true, selectedNodeName: null });
    expect(v.ctaEnabled).toBe(false);
    expect(v.chipVisible).toBe(true);
    expect(v.chipEmpty).toBe(true);
    expect(v.chipName).toBe("Nothing selected");
  });
});
