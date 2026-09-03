import { describe, it, expect, beforeEach } from "bun:test";

// config.js is a dual-mode module: it attaches to `self` for the browser
// (popup.html / background service worker) and exposes CommonJS exports for
// tests. We require it via the CJS path here.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const config = require("../../../src/chrome_extension/config.js");

const {
  BROWSER_ID_STORAGE_KEY,
  BROWSER_LABEL_STORAGE_KEY,
  BROWSER_LABEL_MAX_LENGTH,
  makeBrowserId,
  defaultLabelFor,
  normalizeLabel,
  getBrowserIdentity,
  setBrowserLabel,
} = config;

type Store = Record<string, unknown>;

function installFakeStorage(initial: Store = {}) {
  const store: Store = { ...initial };
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Store = {};
          for (const k of list) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (items: Store) => {
          Object.assign(store, items);
        },
      },
    },
  };
  return store;
}

function installThrowingStorage() {
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async () => {
          throw new Error("storage unavailable");
        },
        set: async () => {
          throw new Error("storage unavailable");
        },
      },
    },
  };
}

describe("chrome extension / browser identity", () => {
  beforeEach(() => {
    installFakeStorage();
  });

  describe("storage keys", () => {
    it("are stable strings so popup and background read the same keys", () => {
      expect(typeof BROWSER_ID_STORAGE_KEY).toBe("string");
      expect(BROWSER_ID_STORAGE_KEY.length).toBeGreaterThan(0);
      expect(typeof BROWSER_LABEL_STORAGE_KEY).toBe("string");
      expect(BROWSER_LABEL_STORAGE_KEY.length).toBeGreaterThan(0);
      expect(BROWSER_ID_STORAGE_KEY).not.toBe(BROWSER_LABEL_STORAGE_KEY);
    });
  });

  describe("makeBrowserId", () => {
    it("returns a uuid-shaped string", () => {
      expect(makeBrowserId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it("returns a different id on each call", () => {
      expect(makeBrowserId()).not.toBe(makeBrowserId());
    });
  });

  describe("defaultLabelFor", () => {
    it("uses the first six characters of the id", () => {
      expect(defaultLabelFor("abcdef12-3456-7890-abcd-ef1234567890")).toBe("Chrome-abcdef");
    });

    it("tolerates a short id", () => {
      expect(defaultLabelFor("ab")).toBe("Chrome-ab");
    });
  });

  describe("normalizeLabel", () => {
    const id = "abcdef12-3456-7890-abcd-ef1234567890";

    it("trims surrounding whitespace", () => {
      expect(normalizeLabel("  User A  ", id)).toBe("User A");
    });

    it("falls back to the default label for an empty string", () => {
      expect(normalizeLabel("", id)).toBe("Chrome-abcdef");
    });

    it("falls back to the default label for whitespace-only input", () => {
      expect(normalizeLabel("   \t ", id)).toBe("Chrome-abcdef");
    });

    it("falls back to the default label for non-string input", () => {
      expect(normalizeLabel(undefined, id)).toBe("Chrome-abcdef");
      expect(normalizeLabel(null, id)).toBe("Chrome-abcdef");
      expect(normalizeLabel(42, id)).toBe("Chrome-abcdef");
    });

    it("truncates an over-long label", () => {
      const long = "x".repeat(500);
      expect(normalizeLabel(long, id).length).toBe(BROWSER_LABEL_MAX_LENGTH);
    });

    it("never returns a blank string", () => {
      for (const input of ["", "   ", undefined, null, {}]) {
        expect(normalizeLabel(input, id).trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe("getBrowserIdentity", () => {
    it("generates and persists an id on first run", async () => {
      const store = installFakeStorage();
      const { id, label } = await getBrowserIdentity();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
      expect(store[BROWSER_ID_STORAGE_KEY]).toBe(id);
      expect(label).toBe(defaultLabelFor(id));
    });

    it("reuses the same id on a subsequent call", async () => {
      installFakeStorage();
      const first = await getBrowserIdentity();
      const second = await getBrowserIdentity();
      expect(second.id).toBe(first.id);
    });

    it("returns the stored label, normalized", async () => {
      installFakeStorage({
        [BROWSER_ID_STORAGE_KEY]: "abcdef12-3456-7890-abcd-ef1234567890",
        [BROWSER_LABEL_STORAGE_KEY]: "  User A  ",
      });
      const { id, label } = await getBrowserIdentity();
      expect(id).toBe("abcdef12-3456-7890-abcd-ef1234567890");
      expect(label).toBe("User A");
    });

    it("mints exactly one id when concurrent callers race the first run", async () => {
      // background.js calls getBrowserIdentity() from the top-level connect, the
      // keep-alive alarm and onStartup; a losing racer that minted its own id
      // would join under an id the popup and relay never agree on.
      const store = installFakeStorage();
      const [a, b, c] = await Promise.all([getBrowserIdentity(), getBrowserIdentity(), getBrowserIdentity()]);
      expect(a.id).toBe(b.id);
      expect(b.id).toBe(c.id);
      expect(store[BROWSER_ID_STORAGE_KEY]).toBe(a.id);
      expect(await getBrowserIdentity()).toMatchObject({ id: a.id });
    });

    it("falls back to a stable ephemeral identity when storage throws", async () => {
      installThrowingStorage();
      const first = await getBrowserIdentity();
      const second = await getBrowserIdentity();
      expect(typeof first.id).toBe("string");
      expect(first.id.length).toBeGreaterThan(0);
      expect(first.label).toBe(defaultLabelFor(first.id));
      expect(second.id).toBe(first.id);
    });
  });

  describe("setBrowserLabel", () => {
    it("persists a normalized label", async () => {
      const store = installFakeStorage({ [BROWSER_ID_STORAGE_KEY]: "abcdef12-3456-7890-abcd-ef1234567890" });
      const saved = await setBrowserLabel("  User B  ");
      expect(saved).toBe("User B");
      expect(store[BROWSER_LABEL_STORAGE_KEY]).toBe("User B");
    });

    it("persists the default label when given a blank value", async () => {
      const store = installFakeStorage({ [BROWSER_ID_STORAGE_KEY]: "abcdef12-3456-7890-abcd-ef1234567890" });
      await setBrowserLabel("   ");
      expect(store[BROWSER_LABEL_STORAGE_KEY]).toBe("Chrome-abcdef");
    });
  });
});
