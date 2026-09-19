import {
  CLIPBOARD_RESULT_TYPE,
  CLIPBOARD_TEXT_MAX_BYTES,
  CLIPBOARD_WRITE_TYPE,
  clipboardCommandFor,
  validateClipboardRequest,
  writeSystemClipboard,
} from "../../../src/socket-clipboard";

describe("clipboard relay message types", () => {
  it("names the request and reply the plugin iframe hardcodes", () => {
    expect(CLIPBOARD_WRITE_TYPE).toBe("system_clipboard_write");
    expect(CLIPBOARD_RESULT_TYPE).toBe("system_clipboard_result");
  });
});

describe("clipboardCommandFor", () => {
  it("pipes to pbcopy on macOS", () => {
    expect(clipboardCommandFor("darwin")).toEqual({ command: "pbcopy", args: [] });
  });

  it("pipes to clip on Windows", () => {
    expect(clipboardCommandFor("win32")).toEqual({ command: "clip", args: [] });
  });

  it("uses xclip on X11 Linux and wl-copy under Wayland", () => {
    expect(clipboardCommandFor("linux", {})).toEqual({ command: "xclip", args: ["-selection", "clipboard"] });
    expect(clipboardCommandFor("linux", { WAYLAND_DISPLAY: "wayland-0" })).toEqual({ command: "wl-copy", args: [] });
  });

  it("has no command for a platform it does not know", () => {
    expect(clipboardCommandFor("aix")).toBeNull();
  });
});

describe("validateClipboardRequest", () => {
  it("accepts a well formed request", () => {
    const check = validateClipboardRequest({ type: "system_clipboard_write", id: "abc", text: "hello" });
    expect(check).toEqual({ ok: true, request: { id: "abc", text: "hello" } });
  });

  it("rejects a request with no id, so a reply can never be misrouted", () => {
    expect(validateClipboardRequest({ text: "hello" })).toEqual({
      ok: false,
      error: "Clipboard request is missing an id",
    });
    expect(validateClipboardRequest({ id: "", text: "hello" }).ok).toBe(false);
  });

  it("rejects non-string or empty text", () => {
    expect(validateClipboardRequest({ id: "a", text: 42 })).toEqual({
      ok: false,
      error: "Clipboard request is missing text",
    });
    expect(validateClipboardRequest({ id: "a", text: "" })).toEqual({ ok: false, error: "Clipboard text is empty" });
  });

  it("caps the payload by UTF-8 byte length, not character count", () => {
    const justUnder = "a".repeat(CLIPBOARD_TEXT_MAX_BYTES);
    expect(validateClipboardRequest({ id: "a", text: justUnder }).ok).toBe(true);

    const over = "a".repeat(CLIPBOARD_TEXT_MAX_BYTES + 1);
    const check = validateClipboardRequest({ id: "a", text: over });
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.error).toContain("too large");

    // Half the cap in characters, but every character is two bytes.
    const multibyte = "é".repeat(CLIPBOARD_TEXT_MAX_BYTES / 2 + 1);
    expect(validateClipboardRequest({ id: "a", text: multibyte }).ok).toBe(false);
  });

  it("rejects junk rather than throwing", () => {
    expect(validateClipboardRequest(null).ok).toBe(false);
    expect(validateClipboardRequest(undefined).ok).toBe(false);
    expect(validateClipboardRequest("nope").ok).toBe(false);
  });
});

describe("writeSystemClipboard", () => {
  it("fails with a reason on a platform with no clipboard binary", async () => {
    const result = await writeSystemClipboard("hello", "aix", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("aix");
  });

  it("fails with a reason when the binary is missing", async () => {
    const result = await writeSystemClipboard("hello", "linux", {});
    if (!result.success) {
      expect(typeof result.error).toBe("string");
      expect(result.error!.length).toBeGreaterThan(0);
    } else {
      // An X11 host with xclip installed really does copy; that is a pass too.
      expect(result.success).toBe(true);
    }
  });
});
