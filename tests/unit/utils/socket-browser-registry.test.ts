import { describe, it, expect } from "bun:test";
import {
  listBrowsers,
  resolveTarget,
  formatBrowserList,
  reserveBrowserChannel,
  RESERVED_BROWSER_CHANNEL,
  sanitizeIdentityValue,
  BROWSER_ID_MAX_LENGTH,
  BROWSER_LABEL_MAX_LENGTH,
  type BrowserClientLike,
} from "../../../src/socket-browser-registry";

const OPEN = 1;
const CLOSED = 3;

function browser(overrides: Partial<BrowserClientLike> = {}): BrowserClientLike {
  return { _isExtension: true, _browserId: "b1", _joinedAt: 1, readyState: OPEN, ...overrides };
}

describe("listBrowsers", () => {
  it("returns one entry per eligible browser", () => {
    const clients = [browser({ _browserId: "a", _browserLabel: "User A", _joinedAt: 10 })];
    expect(listBrowsers(clients)).toEqual([{ id: "a", label: "User A", joinedAt: 10 }]);
  });

  it("falls back to the id as label and 0 as joinedAt", () => {
    const clients = [browser({ _browserId: "a", _browserLabel: undefined, _joinedAt: undefined })];
    expect(listBrowsers(clients)).toEqual([{ id: "a", label: "a", joinedAt: 0 }]);
  });

  it("treats a blank label as absent", () => {
    expect(listBrowsers([browser({ _browserId: "a", _browserLabel: "" })])[0]?.label).toBe("a");
  });

  it("orders by joinedAt, then by id", () => {
    const clients = [
      browser({ _browserId: "z", _joinedAt: 5 }),
      browser({ _browserId: "b", _joinedAt: 1 }),
      browser({ _browserId: "a", _joinedAt: 1 }),
    ];
    expect(listBrowsers(clients).map((e) => e.id)).toEqual(["a", "b", "z"]);
  });

  it("ignores non-extension, id-less and non-open sockets", () => {
    const clients = [
      browser({ _isExtension: false, _browserId: "plugin" }),
      browser({ _browserId: undefined }),
      browser({ _browserId: "closed", readyState: CLOSED }),
      browser({ _browserId: "live" }),
    ];
    expect(listBrowsers(clients).map((e) => e.id)).toEqual(["live"]);
  });
});

describe("resolveTarget", () => {
  it("broadcasts when no target is given and no eligible browser is connected", () => {
    expect(resolveTarget([]).kind).toBe("broadcast");
    expect(resolveTarget([browser({ _isExtension: false })]).kind).toBe("broadcast");
  });

  it("refuses an explicit target when no eligible browser is connected", () => {
    expect(resolveTarget([browser({ readyState: CLOSED })], "b1")).toEqual({ kind: "not-found", available: [] });
    expect(resolveTarget([], "b1")).toEqual({ kind: "not-found", available: [] });
  });

  it("resolves the only browser when no target is given", () => {
    const only = browser({ _browserId: "a" });
    expect(resolveTarget([only])).toEqual({ kind: "single", client: only });
  });

  it("resolves the only browser when its target is given", () => {
    const only = browser({ _browserId: "a" });
    expect(resolveTarget([only], "a")).toEqual({ kind: "single", client: only });
  });

  it("resolves an explicit target among several browsers", () => {
    const a = browser({ _browserId: "a", _joinedAt: 1 });
    const b = browser({ _browserId: "b", _joinedAt: 2 });
    expect(resolveTarget([a, b], "b")).toEqual({ kind: "single", client: b });
  });

  it("reports not-found for an unknown target", () => {
    const a = browser({ _browserId: "a", _browserLabel: "User A", _joinedAt: 1 });
    expect(resolveTarget([a], "nope")).toEqual({
      kind: "not-found",
      available: [{ id: "a", label: "User A", joinedAt: 1 }],
    });
  });

  it("reports not-found when the targeted socket is no longer open", () => {
    const a = browser({ _browserId: "a", _joinedAt: 1 });
    const gone = browser({ _browserId: "gone", readyState: CLOSED });
    const result = resolveTarget([a, gone], "gone");
    expect(result.kind).toBe("not-found");
    expect(result.kind === "not-found" && result.available.map((e) => e.id)).toEqual(["a"]);
  });

  it("reports ambiguous when several browsers are connected and no target is given", () => {
    const a = browser({ _browserId: "a", _joinedAt: 1 });
    const b = browser({ _browserId: "b", _joinedAt: 2 });
    const result = resolveTarget([a, b]);
    expect(result.kind).toBe("ambiguous");
    expect(result.kind === "ambiguous" && result.available.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("ignores a non-extension socket sharing the channel", () => {
    const mcp = browser({ _isExtension: false, _browserId: undefined });
    const only = browser({ _browserId: "a" });
    expect(resolveTarget([mcp, only])).toEqual({ kind: "single", client: only });
  });
});

describe("resolveTarget on a channel shared with a Figma plugin", () => {
  // Channel names are not reserved: the plugin slugs its file name, so a Figma
  // file called "Browser" joins the same channel the extension hardcodes.
  const plugin = (): BrowserClientLike => ({ _isPlugin: true, readyState: OPEN });

  it("broadcasts an untargeted send so the plugin still receives it", () => {
    expect(resolveTarget([plugin(), browser({ _browserId: "a" })])).toEqual({ kind: "broadcast" });
  });

  it("broadcasts even with several browsers rather than refusing the plugin's traffic", () => {
    const clients = [plugin(), browser({ _browserId: "a" }), browser({ _browserId: "b" })];
    expect(resolveTarget(clients)).toEqual({ kind: "broadcast" });
  });

  it("still honours an explicit target, which only a browser command ever carries", () => {
    const target = browser({ _browserId: "b" });
    expect(resolveTarget([plugin(), browser({ _browserId: "a" }), target], "b")).toEqual({
      kind: "single",
      client: target,
    });
  });

  it("ignores a plugin whose socket is already closed", () => {
    const only = browser({ _browserId: "a" });
    expect(resolveTarget([{ _isPlugin: true, readyState: CLOSED }, only])).toEqual({ kind: "single", client: only });
  });
});

describe("reserveBrowserChannel", () => {
  // The extension hardcodes "browser"; the plugin slugs its file name onto the
  // same namespace. Letting both occupy it makes untargeted routing ambiguous
  // between two protocols, so a plugin join is moved off it.
  it("moves a Figma plugin off the reserved browser channel", () => {
    expect(reserveBrowserChannel(RESERVED_BROWSER_CHANNEL, true)).toBe("browser-figma");
  });

  it("leaves the reserved channel alone for non-plugin joins (extension, MCP client)", () => {
    expect(reserveBrowserChannel(RESERVED_BROWSER_CHANNEL, false)).toBe(RESERVED_BROWSER_CHANNEL);
  });

  it("leaves every other channel untouched", () => {
    expect(reserveBrowserChannel("homevault", true)).toBe("homevault");
    expect(reserveBrowserChannel("browser2", true)).toBe("browser2");
    expect(reserveBrowserChannel("browser-figma", true)).toBe("browser-figma");
  });
});

describe("sanitizeIdentityValue", () => {
  it("rejects non-strings and blanks", () => {
    expect(sanitizeIdentityValue(undefined, 10)).toBeUndefined();
    expect(sanitizeIdentityValue(42, 10)).toBeUndefined();
    expect(sanitizeIdentityValue({ id: "x" }, 10)).toBeUndefined();
    expect(sanitizeIdentityValue("   ", 10)).toBeUndefined();
  });

  it("strips control characters so a client cannot forge log lines", () => {
    const forged = "abc\n[INFO] Routed message to browser evil";
    expect(sanitizeIdentityValue(forged, BROWSER_ID_MAX_LENGTH)).toBe("abc[INFO] Routed message to browser evil");
    expect(sanitizeIdentityValue("a\u0000b\u007Fc", 64)).toBe("abc");
  });

  it("truncates oversized values", () => {
    expect(sanitizeIdentityValue("x".repeat(5000), BROWSER_ID_MAX_LENGTH)).toHaveLength(BROWSER_ID_MAX_LENGTH);
    expect(sanitizeIdentityValue("y".repeat(5000), BROWSER_LABEL_MAX_LENGTH)).toHaveLength(BROWSER_LABEL_MAX_LENGTH);
  });

  it("trims and preserves an ordinary value", () => {
    expect(sanitizeIdentityValue("  User A  ", 64)).toBe("User A");
  });
});

describe("formatBrowserList", () => {
  it("renders id and label pairs", () => {
    expect(
      formatBrowserList([
        { id: "8f3a12", label: "User A", joinedAt: 1 },
        { id: "c1d0ff", label: "User B", joinedAt: 2 },
      ]),
    ).toBe("8f3a12 (User A), c1d0ff (User B)");
  });

  it("renders none for an empty list", () => {
    expect(formatBrowserList([])).toBe("none");
  });
});
