const {
  KEY_DEFINITIONS,
  keyToDefinition,
  modifiersToBitmask,
  previewRemoteObject,
  filterConsoleEntries,
  filterNetworkEntries,
  normalizeEvalResult,
} = require("../../../src/chrome_extension/cdp.js");

describe("keyToDefinition", () => {
  it("resolves named keys", () => {
    expect(keyToDefinition("Enter")).toEqual({ key: "Enter", code: "Enter", keyCode: 13, text: "\r" });
    expect(keyToDefinition("Escape").keyCode).toBe(27);
    expect(keyToDefinition("ArrowDown").code).toBe("ArrowDown");
  });

  it("resolves single characters with text payload", () => {
    expect(keyToDefinition("a")).toEqual({ key: "a", code: "KeyA", keyCode: 65, text: "a" });
    expect(keyToDefinition("A").keyCode).toBe(65);
    expect(keyToDefinition("5")).toEqual(expect.objectContaining({ code: "Digit5", keyCode: 53 }));
  });

  it("throws on unknown multi-character names", () => {
    expect(() => keyToDefinition("SuperKey")).toThrow(/Unknown key/);
  });

  it("covers every named key with a keyCode", () => {
    for (const def of Object.values(KEY_DEFINITIONS) as any[]) {
      expect(typeof def.keyCode).toBe("number");
      expect(def.key).toBeTruthy();
    }
  });
});

describe("modifiersToBitmask", () => {
  it("maps CDP modifier bits (alt=1, ctrl=2, meta=4, shift=8)", () => {
    expect(modifiersToBitmask([])).toBe(0);
    expect(modifiersToBitmask(["alt"])).toBe(1);
    expect(modifiersToBitmask(["ctrl"])).toBe(2);
    expect(modifiersToBitmask(["meta"])).toBe(4);
    expect(modifiersToBitmask(["shift"])).toBe(8);
    expect(modifiersToBitmask(["ctrl", "shift"])).toBe(10);
  });

  it("accepts aliases case-insensitively", () => {
    expect(modifiersToBitmask(["Cmd"])).toBe(4);
    expect(modifiersToBitmask(["CONTROL"])).toBe(2);
  });

  it("throws on unknown modifiers", () => {
    expect(() => modifiersToBitmask(["hyper"])).toThrow(/Unknown modifier/);
  });
});

describe("previewRemoteObject", () => {
  it("returns strings verbatim", () => {
    expect(previewRemoteObject({ type: "string", value: "hello" })).toBe("hello");
  });

  it("serializes primitives and objects", () => {
    expect(previewRemoteObject({ type: "number", value: 42 })).toBe("42");
    expect(previewRemoteObject({ type: "object", value: { a: 1 } })).toBe('{"a":1}');
  });

  it("falls back to description then type", () => {
    expect(previewRemoteObject({ type: "function", description: "function foo() {}" })).toBe("function foo() {}");
    expect(previewRemoteObject({ type: "undefined" })).toBe("undefined");
    expect(previewRemoteObject(null)).toBe("");
  });
});

describe("filterConsoleEntries", () => {
  const entries = [
    { level: "log", text: "[App] booted" },
    { level: "error", text: "[App] failed to fetch" },
    { level: "warn", text: "deprecated API" },
    { level: "error", text: "TypeError: x is undefined" },
  ];

  it("filters by level", () => {
    const { total, entries: out } = filterConsoleEntries(entries, { level: "error" });
    expect(total).toBe(2);
    expect(out.map((e: any) => e.text)).toEqual(["[App] failed to fetch", "TypeError: x is undefined"]);
  });

  it("filters by regex pattern", () => {
    const { total } = filterConsoleEntries(entries, { pattern: "\\[App\\]" });
    expect(total).toBe(2);
  });

  it("combines level and pattern and applies the limit keeping newest", () => {
    const { entries: out } = filterConsoleEntries(entries, { level: "error", limit: 1 });
    expect(out).toEqual([{ level: "error", text: "TypeError: x is undefined" }]);
  });

  it("handles empty input", () => {
    expect(filterConsoleEntries([], {})).toEqual({ total: 0, entries: [] });
  });
});

describe("filterNetworkEntries", () => {
  const requests = [
    { url: "https://api.example.com/api/users", status: 200 },
    { url: "https://cdn.example.com/app.js", status: 200 },
    { url: "https://api.example.com/api/orders", status: 500 },
  ];

  it("filters by URL substring", () => {
    const { total, requests: out } = filterNetworkEntries(requests, { urlFilter: "/api/" });
    expect(total).toBe(2);
    expect(out.every((r: any) => r.url.includes("/api/"))).toBe(true);
  });

  it("applies the limit keeping newest", () => {
    const { requests: out } = filterNetworkEntries(requests, { limit: 1 });
    expect(out).toEqual([{ url: "https://api.example.com/api/orders", status: 500 }]);
  });
});

describe("normalizeEvalResult", () => {
  it("returns plain values", () => {
    expect(normalizeEvalResult({ type: "number", value: 7 })).toEqual({ type: "number", value: 7 });
  });

  it("keeps type/description for by-reference results", () => {
    expect(normalizeEvalResult({ type: "function", description: "fn" })).toEqual({
      type: "function",
      value: undefined,
      description: "fn",
    });
  });

  it("truncates oversized values", () => {
    const big = "x".repeat(200001);
    const out = normalizeEvalResult({ type: "string", value: big });
    expect(out.truncated).toBe(true);
    expect((out.value as string).length).toBeLessThanOrEqual(100000);
  });

  it("handles missing result", () => {
    expect(normalizeEvalResult(undefined)).toEqual({ type: "undefined", value: undefined });
  });
});
