import vm from "node:vm";
import type { CdpTransport } from "./cdp-connection.js";
import { createChromeShim, type ChromeShim } from "./chrome-shim.js";
import { loadExtensionSources, type ExtensionSources } from "./extension-sources.js";

export interface CommandRouter {
  handle(command: string, params?: Record<string, unknown>): Promise<unknown>;
  shim: ChromeShim;
  dispose(): void;
}

export interface CommandRouterOptions {
  platform?: NodeJS.Platform;
  sources?: ExtensionSources;
}

const WINDOW_MIN_W = 500;

/** background.js opens its own relay socket at load; the driver owns the relay link, so it never connects. */
class InertWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = InertWebSocket.CONNECTING;
  send() {}
  close() {
    this.readyState = InertWebSocket.CLOSED;
  }
}

function toError(e: unknown): Error {
  if (e && typeof e === "object" && "message" in e) return new Error(String((e as Error).message));
  return new Error(String(e));
}

/**
 * Runs the extension's background.js (with the cdp.js/config.js it imports) in a VM
 * context whose `chrome` global is backed by CDP, and dispatches commands through its
 * own `handleBrowserCommand`. Results therefore have the extension's exact shapes.
 */
export async function createCommandRouter(
  transport: CdpTransport,
  options: CommandRouterOptions = {},
): Promise<CommandRouter> {
  const sources = options.sources ?? loadExtensionSources();
  const shim = createChromeShim(transport, { contentScript: sources.content });
  await shim.ready;

  const platform = options.platform ?? process.platform;
  const userAgent = platform === "darwin" ? "Mozilla/5.0 (Macintosh; Intel Mac OS X)" : "Mozilla/5.0 (X11; Linux)";

  const context: vm.Context = vm.createContext({
    chrome: shim.chrome,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    TextEncoder,
    TextDecoder,
    URL,
    btoa,
    atob,
    structuredClone,
    navigator: { userAgent },
    WebSocket: InertWebSocket,
    importScripts: (...names: string[]) => {
      for (const name of names) {
        const source = sources.importable[name];
        if (source === undefined) throw new Error(`importScripts: the driver does not bundle "${name}"`);
        vm.runInContext(source, context, { filename: name });
      }
    },
  });
  vm.runInContext(sources.background, context, { filename: "background.js" });

  const lookup = (name: string) => vm.runInContext(`typeof ${name} === "function" ? ${name} : undefined`, context);
  const dispatch = lookup("handleBrowserCommand");
  if (!dispatch) throw new Error("background.js does not define handleBrowserCommand; the driver cannot dispatch");

  const cdpApplyEmulation = lookup("cdpApplyEmulation");
  const cdpClearEmulation = lookup("cdpClearEmulation");
  const cdpMaybeDetach = lookup("cdpMaybeDetach");

  async function innerSize(tabId: number): Promise<{ w: number; h: number }> {
    const res = await shim.sendToTab(tabId, "Runtime.evaluate", {
      expression: "({ w: innerWidth, h: innerHeight })",
      returnByValue: true,
    });
    return res.result.value;
  }

  /**
   * The extension's resizeOrEmulate sizes the OS window from outerWidth - innerWidth;
   * headless Chrome reports outerWidth = 0, so the driver measures the window bounds over
   * CDP instead. Same rule as the extension: below 500px (or forceEmulation) use device
   * emulation, otherwise size the window so the viewport equals the frame.
   */
  async function resizeOrEmulate(tab: { id: number }, frameWidth: number, frameHeight: number, opts: any = {}) {
    const needsEmulation = opts?.forceEmulation === true || frameWidth < WINDOW_MIN_W;
    if (needsEmulation) {
      await cdpApplyEmulation(tab.id, {
        width: frameWidth,
        height: frameHeight,
        deviceScaleFactor: opts?.deviceScaleFactor ?? 2,
      });
      const { bounds } = await shim.getWindowBounds(tab.id);
      return { emulated: true, windowWidth: bounds.width, windowHeight: bounds.height };
    }
    await cdpClearEmulation(tab.id);
    await cdpMaybeDetach(tab.id);
    let windowWidth = 0;
    let windowHeight = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { windowId, bounds } = await shim.getWindowBounds(tab.id);
      const inner = await innerSize(tab.id);
      if (inner.w === frameWidth && inner.h === frameHeight) {
        windowWidth = bounds.width;
        windowHeight = bounds.height;
        break;
      }
      windowWidth = Math.floor(frameWidth + (bounds.width - inner.w));
      windowHeight = Math.floor(frameHeight + (bounds.height - inner.h));
      await shim.chrome.windows.update(windowId, { width: windowWidth, height: windowHeight });
    }
    const inner = await innerSize(tab.id);
    if (inner.w !== frameWidth || inner.h !== frameHeight) {
      throw new Error(
        `Could not size the viewport to ${frameWidth}x${frameHeight} (got ${inner.w}x${inner.h}); ` +
          "pass forceEmulation: true to emulate it instead",
      );
    }
    return { emulated: false, windowWidth, windowHeight };
  }
  context.__driverResizeOrEmulate = resizeOrEmulate;
  vm.runInContext("resizeOrEmulate = __driverResizeOrEmulate;", context);
  if (lookup("resizeOrEmulate") !== resizeOrEmulate) throw new Error("Could not install the driver's resizeOrEmulate");

  return {
    shim,
    async handle(command, params = {}) {
      try {
        return await dispatch(command, params);
      } catch (e) {
        throw toError(e);
      }
    },
    dispose() {
      shim.dispose();
    },
  };
}
