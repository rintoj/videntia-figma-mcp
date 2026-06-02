import { describe, it, expect } from "bun:test";

// config.js is a dual-mode module: it attaches to `self` for the browser
// (popup.html / background service worker) and exposes CommonJS exports for
// tests. We require it via the CJS path here.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const config = require("../../../src/chrome_extension/config.js");

const { SERVER_PRESETS, SERVER_DEFAULT, SERVER_STORAGE_KEY, toWsUrl, toChannelsUrl } = config;

describe("chrome extension / config", () => {
  describe("toWsUrl", () => {
    it("converts http:// to ws://", () => {
      expect(toWsUrl("http://localhost:3055")).toBe("ws://localhost:3055");
    });

    it("converts https:// to wss://", () => {
      expect(toWsUrl("https://figma-mcp.videntia.dev")).toBe("wss://figma-mcp.videntia.dev");
    });

    it("preserves path and port", () => {
      expect(toWsUrl("http://localhost:3055/socket")).toBe("ws://localhost:3055/socket");
      expect(toWsUrl("https://example.com:8443/ws")).toBe("wss://example.com:8443/ws");
    });

    it("leaves an already-ws URL unchanged", () => {
      expect(toWsUrl("ws://localhost:3055")).toBe("ws://localhost:3055");
      expect(toWsUrl("wss://example.com")).toBe("wss://example.com");
    });
  });

  describe("toChannelsUrl", () => {
    it("appends /channels to a bare URL", () => {
      expect(toChannelsUrl("http://localhost:3055")).toBe("http://localhost:3055/channels");
    });

    it("strips a single trailing slash before appending", () => {
      expect(toChannelsUrl("https://figma-mcp.videntia.dev/")).toBe("https://figma-mcp.videntia.dev/channels");
    });

    it("does not double-strip multiple trailing slashes", () => {
      // Regex strips only one trailing slash; protects against accidental over-stripping.
      expect(toChannelsUrl("http://localhost:3055//")).toBe("http://localhost:3055//channels");
    });
  });

  describe("SERVER_PRESETS", () => {
    it("contains at least production and localhost entries", () => {
      const ids = SERVER_PRESETS.map((p: { id: string }) => p.id);
      expect(ids).toContain("production");
      expect(ids).toContain("localhost");
    });

    it("each preset has id, label, and url", () => {
      for (const p of SERVER_PRESETS) {
        expect(typeof p.id).toBe("string");
        expect(typeof p.label).toBe("string");
        expect(typeof p.url).toBe("string");
        expect(p.url).toMatch(/^https?:\/\//);
      }
    });

    it("SERVER_DEFAULT is one of the preset URLs", () => {
      const urls = SERVER_PRESETS.map((p: { url: string }) => p.url);
      expect(urls).toContain(SERVER_DEFAULT);
    });

    it("production points to figma-mcp.videntia.dev over https", () => {
      const prod = SERVER_PRESETS.find((p: { id: string }) => p.id === "production");
      expect(prod?.url).toBe("https://figma-mcp.videntia.dev");
    });
  });

  describe("SERVER_STORAGE_KEY", () => {
    it("is a stable string so popup and background read the same key", () => {
      expect(typeof SERVER_STORAGE_KEY).toBe("string");
      expect(SERVER_STORAGE_KEY.length).toBeGreaterThan(0);
    });
  });
});
