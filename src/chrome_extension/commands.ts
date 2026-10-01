/**
 * commands.ts — Command handler for browser control.
 *
 * This module exports a pure command dispatcher that accepts an adapter interface.
 * The same handler is used by both the Chrome extension (via adapter-extension.ts)
 * and the headless driver (via adapter-driver.ts), enabling code reuse without
 * tight coupling to Chrome APIs.
 *
 * All 36+ browser commands are implemented here, accepting adapter functions instead
 * of calling chrome.* APIs directly. Tab resolution is handled by the caller.
 */

/**
 * Adapter interface for browser operations.
 * Implementations wrap chrome.* APIs (extension) or CDP/puppeteer (driver).
 */
export interface BrowserAdapter {
  // Tab management
  tabs: {
    list(): Promise<BrowserTab[]>;
    create(url: string, options?: { active?: boolean; newWindow?: boolean; grouped?: boolean }): Promise<BrowserTab>;
    get(tabId: number): Promise<BrowserTab>;
    close(tabId: number): Promise<void>;
    update(tabId: number, options: { url?: string }): Promise<void>;
    goBack(tabId: number): Promise<void>;
    goForward(tabId: number): Promise<void>;
    query(filter: any): Promise<BrowserTab[]>;
  };

  // Scripting
  scripting: {
    executeScript(tabId: number, func: Function, args?: any[]): Promise<any>;
  };

  // Screenshot
  screenshot(tabId: number, options?: { fullPage?: boolean }): Promise<Screenshot>;

  // Content script messaging
  sendToContentScript(tabId: number, command: string, params: any): Promise<any>;

  // CDP operations
  cdp: {
    ensureAttached(tabId: number): Promise<{ newlyAttached: boolean }>;
    send(tabId: number, method: string, params?: any): Promise<any>;
    click(tabId: number, x: number, y: number, options?: any): Promise<void>;
    hover(tabId: number, x: number, y: number): Promise<void>;
    scroll(tabId: number, x: number, y: number, deltaX: number, deltaY: number): Promise<void>;
    typeText(tabId: number, text: string): Promise<void>;
    pressKey(tabId: number, key: string, modifiers?: string[]): Promise<void>;
    evaluate(tabId: number, expression: string, options?: any): Promise<any>;
    querySelector(tabId: number, selector: string): Promise<number>;
    focusBackendNode(tabId: number, nodeId: number): Promise<void>;
    resolveAXNode(tabId: number, nodeId: number): Promise<{ x: number; y: number }>;
    highlightNode(tabId: number, config: any): Promise<void>;
    clearHighlight(tabId: number): Promise<void>;
    getAXTree(tabId: number, options?: any): Promise<any>;
    applyEmulation(tabId: number, config: any): Promise<void>;
    clearEmulation(tabId: number): Promise<void>;
    clearAllEmulation(tabId: number): Promise<void>;
    maybeDetach(tabId: number): Promise<void>;
    reapplyOverrides(tabId: number): Promise<void>;
    ensureMonitoring(tabId: number): Promise<{ startedNow: boolean }>;
    startInterception(tabId: number, patterns?: any, timeoutMs?: number): Promise<void>;
    stopInterception(tabId: number): Promise<void>;
    listPendingInterceptions(tabId: number): Promise<any[]>;
    fulfillRequest(tabId: number, requestId: string, options: any): Promise<void>;
    failRequest(tabId: number, requestId: string, errorReason?: string): Promise<void>;
    continueRequest(tabId: number, requestId: string, overrides?: any): Promise<void>;
    clearStorage(tabId: number, origin: string, storageTypes?: string[]): Promise<void>;
    captureMhtml(tabId: number): Promise<string>;
    setEmulatedMedia(tabId: number, config: any): Promise<void>;
    setNetworkConditions(tabId: number, conditions: any): Promise<void>;
    setGeolocation(tabId: number, geo: any): Promise<void>;
    setTimezone(tabId: number, timezoneId: string): Promise<void>;
    setCpuThrottling(tabId: number, rate: number): Promise<void>;
    getTabState(tabId: number): Promise<any>;
  };

  // Buffer access
  buffers: {
    readConsoleBuffer(tabId: number, options?: any): Promise<any>;
    clearConsoleBuffer(tabId: number): Promise<void>;
    readNetworkBuffer(tabId: number, options?: any): Promise<any>;
    clearNetworkBuffer(tabId: number): Promise<void>;
  };

  // Storage & utilities
  storage: {
    resolveTargetTab(params: any): Promise<BrowserTab>;
  };

  // Window management (extension-specific; no-op in driver)
  windows?: {
    update(windowId: number, options: any): Promise<void>;
  };

  // Tab grouping (extension-specific; no-op in driver)
  tabGroups?: {
    getAgentGroupId(): Promise<number | null>;
    addTabToAgentGroup(tabId: number): Promise<number | null>;
    closeAgentGroup(): Promise<{ closed: number }>;
  };
}

export interface BrowserTab {
  id: number;
  url?: string;
  title?: string;
  active?: boolean;
  windowId?: number;
  status?: string;
  groupId?: number;
}

export interface Screenshot {
  imageData: string;
  mimeType: string;
}

/**
 * Create a command handler that dispatches browser commands.
 * The handler receives an adapter and returns an async function that processes commands.
 *
 * @param adapter - Implementation of BrowserAdapter (extension or driver)
 * @returns Async function (command: string, params: any) => Promise<any>
 */
export function createCommandHandler(adapter: BrowserAdapter) {
  /**
   * Main command dispatcher
   */
  return async (command: string, params: any = {}) => {
    // Tab-independent commands first — no target resolution needed.
    switch (command) {
      case "list_tabs":
        return listTabsCmd(adapter, params);
      case "create_tab":
        return createTabCmd(adapter, params);
      case "close_tab":
        return closeTabCmd(adapter, params);
      case "close_group":
        return closeGroupCmd(adapter, params);
    }

    // All other commands require a target tab
    const tab = await adapter.storage.resolveTargetTab(params);

    switch (command) {
      case "get_dom_nodes":
      case "get_computed_styles":
      case "get_computed_styles_batch":
      case "resolve_selector_at_point":
      case "collect_all_element_rects":
        return adapter.sendToContentScript(tab.id, command, params);

      case "inject_figma_overlay": {
        if (params?.width && params?.height) {
          try {
            await resizeOrEmulate(adapter, tab, params.width, params.height);
          } catch (e) {
            console.warn("[figma-overlay:commands] resize/emulate failed:", (e as Error).message);
          }
        }
        return adapter.sendToContentScript(tab.id, command, params);
      }

      case "clear_figma_overlay": {
        await adapter.cdp.clearEmulation(tab.id);
        await adapter.cdp.maybeDetach(tab.id);
        return adapter.sendToContentScript(tab.id, command, params);
      }

      case "get_page_screenshot": {
        return adapter.screenshot(tab.id, { fullPage: params?.fullPage === true });
      }

      case "set_viewport": {
        const width = Number(params?.width);
        const height = Number(params?.height);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          throw new Error("set_viewport requires positive numeric width and height");
        }
        const result = await resizeOrEmulate(adapter, tab, width, height, {
          forceEmulation: params?.forceEmulation === true,
          deviceScaleFactor: typeof params?.deviceScaleFactor === "number" ? params.deviceScaleFactor : undefined,
        });
        return { success: true, tabId: tab.id, width, height, ...result };
      }

      case "reset_viewport": {
        await adapter.cdp.clearEmulation(tab.id);
        await adapter.cdp.maybeDetach(tab.id);
        return { success: true, tabId: tab.id };
      }

      case "emulate": {
        await adapter.cdp.ensureAttached(tab.id);
        const p = params || {};
        if (p.viewport && typeof p.viewport.width === "number" && typeof p.viewport.height === "number") {
          await adapter.cdp.applyEmulation(tab.id, {
            width: p.viewport.width,
            height: p.viewport.height,
            deviceScaleFactor: p.viewport.deviceScaleFactor,
          });
        }
        if (p.colorScheme !== undefined || p.reducedMotion !== undefined) {
          await adapter.cdp.setEmulatedMedia(tab.id, { colorScheme: p.colorScheme, reducedMotion: p.reducedMotion });
        }
        if (p.networkConditions !== undefined) {
          await adapter.cdp.setNetworkConditions(tab.id, p.networkConditions);
        }
        if (p.geolocation !== undefined) {
          await adapter.cdp.setGeolocation(tab.id, p.geolocation);
        }
        if (p.timezone !== undefined) {
          await adapter.cdp.setTimezone(tab.id, p.timezone);
        }
        if (p.cpuThrottlingRate !== undefined) {
          await adapter.cdp.setCpuThrottling(tab.id, p.cpuThrottlingRate);
        }
        const state = await adapter.cdp.getTabState(tab.id);
        return { success: true, tabId: tab.id, ...state };
      }

      case "clear_emulation": {
        await adapter.cdp.clearAllEmulation(tab.id);
        await adapter.cdp.maybeDetach(tab.id);
        return { success: true, tabId: tab.id };
      }

      case "get_page_info":
        return { url: tab.url, title: tab.title, tabId: tab.id };

      // --- Interaction (CDP input) ---

      case "click": {
        await adapter.cdp.ensureAttached(tab.id);
        const point = await resolveInteractionPoint(adapter, tab, params);
        await adapter.cdp.click(tab.id, point.x, point.y, {
          button: params?.button || "left",
          clickCount: params?.clickCount || 1,
        });
        return { success: true, tabId: tab.id, ...point };
      }

      case "hover": {
        await adapter.cdp.ensureAttached(tab.id);
        const point = await resolveInteractionPoint(adapter, tab, params);
        await adapter.cdp.hover(tab.id, point.x, point.y);
        return { success: true, tabId: tab.id, ...point };
      }

      case "scroll": {
        await adapter.cdp.ensureAttached(tab.id);
        let point;
        if (
          params?.selector ||
          typeof params?.backendDOMNodeId === "number" ||
          (typeof params?.x === "number" && typeof params?.y === "number")
        ) {
          point = await resolveInteractionPoint(adapter, tab, params);
        } else {
          const center = await adapter.cdp.evaluate(tab.id, "({x: Math.round(innerWidth/2), y: Math.round(innerHeight/2)})");
          point = center.value;
        }
        const deltaX = Number(params?.deltaX) || 0;
        const deltaY = Number(params?.deltaY) || 0;
        await adapter.cdp.scroll(tab.id, point.x, point.y, deltaX, deltaY);
        return { success: true, tabId: tab.id, ...point, deltaX, deltaY };
      }

      case "type_text": {
        await adapter.cdp.ensureAttached(tab.id);
        const clearFirst = params?.clearFirst === true;
        if (params?.selector) {
          const r = await adapter.sendToContentScript(tab.id, "prepare_element_for_interaction", {
            selector: params.selector,
            focus: true,
            select: clearFirst,
          });
          if (!r?.found) throw new Error(`No element matches selector: ${params.selector}`);
          if (clearFirst && !r.selected) await selectAllViaKeyboard(adapter, tab.id);
        } else if (typeof params?.backendDOMNodeId === "number") {
          await adapter.cdp.focusBackendNode(tab.id, params.backendDOMNodeId);
          if (clearFirst) await selectAllViaKeyboard(adapter, tab.id);
        } else if (clearFirst) {
          await selectAllViaKeyboard(adapter, tab.id);
        }
        if (typeof params?.text !== "string") throw new Error("type_text requires a text string");
        await adapter.cdp.typeText(tab.id, params.text);
        return { success: true, tabId: tab.id, typed: params.text.length };
      }

      case "press_key": {
        await adapter.cdp.ensureAttached(tab.id);
        if (!params?.key) throw new Error("press_key requires a key name");
        await adapter.cdp.pressKey(tab.id, params.key, params.modifiers || []);
        return { success: true, tabId: tab.id, key: params.key };
      }

      case "evaluate_js": {
        await adapter.cdp.ensureAttached(tab.id);
        if (typeof params?.expression !== "string" || !params.expression.trim()) {
          throw new Error("evaluate_js requires a non-empty expression string");
        }
        const result = await adapter.cdp.evaluate(tab.id, params.expression, {
          timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
        });
        return { tabId: tab.id, ...result };
      }

      // --- Navigation ---

      case "navigate": {
        const url = validateNavigationUrl(params?.url);
        await adapter.tabs.update(tab.id, { url });
        await waitForTabComplete(adapter, tab.id, 30000);
        await adapter.cdp.reapplyOverrides(tab.id);
        const updated = await adapter.tabs.get(tab.id);
        return { success: true, tabId: tab.id, url: updated.url, title: updated.title };
      }

      case "go_back":
      case "go_forward": {
        try {
          if (command === "go_back") await adapter.tabs.goBack(tab.id);
          else await adapter.tabs.goForward(tab.id);
        } catch (e) {
          throw new Error(`Cannot ${command === "go_back" ? "go back" : "go forward"}: ${(e as Error).message}`);
        }
        await waitForTabComplete(adapter, tab.id, 15000);
        await adapter.cdp.reapplyOverrides(tab.id);
        const updated = await adapter.tabs.get(tab.id);
        return { success: true, tabId: tab.id, url: updated.url, title: updated.title };
      }

      // --- Observability (console / network buffers) ---

      case "read_console": {
        const { startedNow } = await adapter.cdp.ensureMonitoring(tab.id);
        const data = await adapter.buffers.readConsoleBuffer(tab.id, {
          pattern: params?.pattern,
          level: params?.level,
          limit: typeof params?.limit === "number" ? params.limit : undefined,
        });
        if (params?.clear === true) await adapter.buffers.clearConsoleBuffer(tab.id);
        return { tabId: tab.id, monitoringJustStarted: startedNow, ...data };
      }

      case "read_network": {
        const { startedNow } = await adapter.cdp.ensureMonitoring(tab.id);
        const data = await adapter.buffers.readNetworkBuffer(tab.id, {
          urlFilter: params?.urlFilter,
          limit: typeof params?.limit === "number" ? params.limit : undefined,
        });
        if (params?.clear === true) await adapter.buffers.clearNetworkBuffer(tab.id);
        return { tabId: tab.id, monitoringJustStarted: startedNow, ...data };
      }

      // --- Accessibility-tree snapshot + element highlighting ---

      case "get_ax_tree": {
        const rawNodes = await adapter.cdp.getAXTree(tab.id, { depth: params?.depth });
        const nodes = flattenAXNodes(rawNodes, { includeIgnored: params?.includeIgnored === true });
        return { tabId: tab.id, count: nodes.length, nodes };
      }

      case "highlight_node": {
        let nodeId;
        if (params?.selector) {
          nodeId = await adapter.cdp.querySelector(tab.id, params.selector);
        } else if (typeof params?.backendDOMNodeId !== "number") {
          throw new Error("highlight_node requires a selector or backendDOMNodeId");
        }
        await adapter.cdp.highlightNode(tab.id, {
          nodeId,
          backendDOMNodeId: params?.backendDOMNodeId,
          highlightConfig: params?.highlightConfig,
        });
        return { success: true, tabId: tab.id };
      }

      case "clear_highlight": {
        await adapter.cdp.clearHighlight(tab.id);
        return { success: true, tabId: tab.id };
      }

      // --- Fetch domain interception ---

      case "intercept_start": {
        await adapter.cdp.startInterception(tab.id, params?.patterns, params?.timeoutMs);
        return { success: true, tabId: tab.id };
      }

      case "intercept_stop": {
        await adapter.cdp.stopInterception(tab.id);
        return { success: true, tabId: tab.id };
      }

      case "list_pending_requests": {
        const requests = adapter.cdp.listPendingInterceptions(tab.id);
        return { tabId: tab.id, requests };
      }

      case "fulfill_request": {
        if (!params?.requestId) throw new Error("fulfill_request requires requestId");
        await adapter.cdp.fulfillRequest(tab.id, params.requestId, {
          responseCode: params.responseCode,
          responseHeaders: params.responseHeaders,
          body: params.body,
        });
        return { success: true, tabId: tab.id, requestId: params.requestId };
      }

      case "fail_request": {
        if (!params?.requestId) throw new Error("fail_request requires requestId");
        await adapter.cdp.failRequest(tab.id, params.requestId, params.errorReason);
        return { success: true, tabId: tab.id, requestId: params.requestId };
      }

      case "continue_request": {
        if (!params?.requestId) throw new Error("continue_request requires requestId");
        await adapter.cdp.continueRequest(tab.id, params.requestId, params.overrides || {});
        return { success: true, tabId: tab.id, requestId: params.requestId };
      }

      // --- Storage / page snapshot ---

      case "clear_storage": {
        if (!params?.origin) throw new Error("clear_storage requires an origin");
        await adapter.cdp.clearStorage(tab.id, params.origin, params.storageTypes);
        return { success: true, tabId: tab.id, origin: params.origin };
      }

      case "capture_mhtml": {
        const data = await adapter.cdp.captureMhtml(tab.id);
        return { tabId: tab.id, mimeType: "multipart/related", data };
      }

      default:
        throw new Error(`Unknown browser command: ${command}`);
    }
  };
}

// --- Helper functions (used by command handler) ---

async function listTabsCmd(adapter: BrowserAdapter, params: any) {
  const tabs = await adapter.tabs.list();
  return { tabs };
}

async function createTabCmd(adapter: BrowserAdapter, params: any) {
  const url = params?.url ? validateNavigationUrl(params.url) : "about:blank";
  const tab = await adapter.tabs.create(url, {
    active: params?.active !== false,
    newWindow: params?.newWindow === true,
    grouped: params?.grouped !== false && params?.newWindow !== true,
  });
  await waitForTabComplete(adapter, tab.id, 20000);
  const updated = await adapter.tabs.get(tab.id);
  return {
    success: true,
    tabId: updated.id,
    windowId: updated.windowId,
    url: updated.url,
    title: updated.title,
  };
}

async function closeTabCmd(adapter: BrowserAdapter, params: any) {
  if (typeof params?.tabId !== "number") {
    throw new Error("close_tab requires an explicit tabId — refusing to close an implicit target tab.");
  }
  await adapter.tabs.close(params.tabId);
  return { success: true, tabId: params.tabId };
}

async function closeGroupCmd(adapter: BrowserAdapter, params: any) {
  if (!adapter.tabGroups) return { success: true, closed: 0, note: "Tab grouping not available" };
  const result = await adapter.tabGroups.closeAgentGroup();
  return { success: true, ...result };
}

async function resolveInteractionPoint(adapter: BrowserAdapter, tab: BrowserTab, params: any) {
  if (typeof params?.x === "number" && typeof params?.y === "number") {
    return { x: params.x, y: params.y };
  }
  if (typeof params?.backendDOMNodeId === "number") {
    return await adapter.cdp.resolveAXNode(tab.id, params.backendDOMNodeId);
  }
  if (params?.selector) {
    const r = await adapter.sendToContentScript(tab.id, "prepare_element_for_interaction", {
      selector: params.selector,
    });
    if (!r?.found) throw new Error(r?.error || `No element matches selector: ${params.selector}`);
    return { x: r.x, y: r.y };
  }
  throw new Error("Provide a selector, backendDOMNodeId, or x/y coordinates");
}

async function selectAllViaKeyboard(adapter: BrowserAdapter, tabId: number) {
  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent || "");
  await adapter.cdp.pressKey(tabId, "a", [isMac ? "meta" : "ctrl"]);
}

function validateNavigationUrl(rawUrl: string) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) throw new Error("navigate requires a url");
  let url = rawUrl.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
  const allowed = /^(https?:|about:blank$)/i;
  if (!allowed.test(url)) {
    throw new Error(`Refusing to navigate to "${url}" — only http(s) URLs and about:blank are allowed.`);
  }
  return url;
}

function waitForTabComplete(adapter: BrowserAdapter, tabId: number, timeoutMs = 30000): Promise<void> {
  // This is a promise that resolves when the tab is done loading.
  // In the extension, this uses chrome.tabs.onUpdated.
  // In the driver, this would poll the page ready state.
  // For now, we keep it as a no-op that resolves immediately.
  return Promise.resolve();
}

function flattenAXNodes(nodes: any, options: any = {}): any[] {
  // Simple flattening of AX tree nodes for now.
  // Full implementation would recursively flatten and filter based on options.
  return nodes || [];
}
