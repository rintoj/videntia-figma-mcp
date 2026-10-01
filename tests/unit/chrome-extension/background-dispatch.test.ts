import { readFileSync } from "fs";
import { join } from "path";
import vm from "vm";

const EXT_DIR = join(__dirname, "../../../src/chrome_extension");
const listener = { addListener() {}, removeListener() {} };
const tab = { id: 1, windowId: 1, url: "https://example.com", title: "Example", status: "complete", groupId: -1 };

function loadServiceWorker() {
  const chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: listener,
    },
    action: { setBadgeText() {}, setIcon() {} },
    alarms: { create() {}, onAlarm: listener },
    runtime: { onInstalled: listener, onStartup: listener, onMessage: listener, lastError: undefined },
    tabs: {
      get: async () => tab,
      query: async () => [tab],
      create: async () => tab,
      update: async () => tab,
      remove: async () => {},
      goBack: async () => {},
      goForward: async () => {},
      group: async () => 7,
      sendMessage: (_id: number, _msg: unknown, cb: (r: unknown) => void) => cb({ found: true, x: 1, y: 1 }),
      captureVisibleTab: async () => "data:image/png;base64,AA",
      onUpdated: listener,
      onRemoved: listener,
    },
    tabGroups: { get: async () => ({}), update: async () => {} },
    windows: { create: async () => ({ id: 1, tabs: [tab] }), update: async () => {} },
    scripting: { executeScript: async () => [{ result: { w: 0, h: 0, maxW: 2000, maxH: 2000 } }] },
    debugger: {
      attach: async () => {},
      detach: async () => {},
      sendCommand: async () => ({}),
      getTargets: async () => [],
      onEvent: listener,
      onDetach: listener,
    },
  };
  class WebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 0;
    send() {}
    close() {}
  }
  const context: Record<string, unknown> = {
    chrome,
    WebSocket,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    navigator: { userAgent: "Mac" },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    crypto: globalThis.crypto,
    URL,
  };
  vm.createContext(context);
  context.importScripts = (...files: string[]) => {
    for (const f of files) vm.runInContext(readFileSync(join(EXT_DIR, f), "utf8"), context, { filename: f });
  };
  vm.runInContext(readFileSync(join(EXT_DIR, "background.js"), "utf8"), context, { filename: "background.js" });
  return context as { handleBrowserCommand: (c: string, p: object) => Promise<unknown> };
}

const COMMANDS = [
  ...new Set([...readFileSync(join(EXT_DIR, "background.js"), "utf8").matchAll(/case "([a-z_]+)":/g)].map((m) => m[1])),
];

describe("background.js service worker", () => {
  const sw = loadServiceWorker();

  it("loads its importScripts chain and exposes the dispatcher", () => {
    expect(typeof sw.handleBrowserCommand).toBe("function");
    expect(COMMANDS.length).toBeGreaterThanOrEqual(39);
  });

  it.each(COMMANDS)(
    "dispatches %s without a missing-global error",
    async (command) => {
      const params = {
        tabId: 1,
        url: "https://example.com",
        width: 800,
        height: 600,
        x: 1,
        y: 1,
        text: "hi",
        key: "Enter",
        expression: "1",
        requestId: "r1",
        origin: "https://example.com",
        selector: "body",
      };
      try {
        await sw.handleBrowserCommand(command, params);
      } catch (e) {
        const err = e as Error;
        expect(err.name).not.toBe("ReferenceError");
        expect(err.message).not.toMatch(/is not a function|is not defined/);
      }
    },
    10000,
  );

  it("rejects unknown commands", async () => {
    await expect(sw.handleBrowserCommand("nope", {})).rejects.toThrow("Unknown browser command: nope");
  });

  it("refuses close_tab without an explicit tabId", async () => {
    await expect(sw.handleBrowserCommand("close_tab", {})).rejects.toThrow(/explicit tabId/);
  });
});
