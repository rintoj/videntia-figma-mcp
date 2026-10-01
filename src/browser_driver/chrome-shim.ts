import type { CdpTransport } from "./cdp-connection.js";

/**
 * The subset of the `chrome.*` extension API that background.js, cdp.js and content.js
 * use, implemented over a CDP browser connection. Running the extension's own scripts
 * against this shim is what keeps the driver's command results identical to the
 * extension's: the command table, the CDP logic and the page-side logic are the same code.
 */

export const CONTENT_WORLD_NAME = "videntia-content";

type Listener = (...args: any[]) => unknown;

export interface ChromeEvent {
  addListener(fn: Listener): void;
  removeListener(fn: Listener): void;
  hasListener(fn: Listener): boolean;
  emit(...args: any[]): void;
}

function createEvent(): ChromeEvent {
  const listeners = new Set<Listener>();
  return {
    addListener: (fn) => void listeners.add(fn),
    removeListener: (fn) => void listeners.delete(fn),
    hasListener: (fn) => listeners.has(fn),
    emit: (...args) => {
      for (const fn of [...listeners]) {
        try {
          const r = fn(...args);
          if (r && typeof (r as Promise<unknown>).catch === "function") (r as Promise<unknown>).catch(() => {});
        } catch (e) {
          console.error("[chrome-shim] listener failed:", e);
        }
      }
    },
  };
}

interface TabRecord {
  tabId: number;
  targetId: string;
  sessionId: string;
  windowId: number;
  url: string;
  title: string;
  status: "loading" | "complete";
  groupId: number;
  debuggerSessionId: string | null;
}

export interface ChromeTab {
  id: number;
  url: string;
  title: string;
  active: boolean;
  windowId: number;
  status: "loading" | "complete";
  groupId: number;
  index: number;
  pinned: boolean;
}

function createStorageArea(onChanged: ChromeEvent, areaName: string) {
  const data = new Map<string, unknown>();
  const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  return {
    async get(keys?: string | string[] | Record<string, unknown> | null) {
      const out: Record<string, unknown> = {};
      if (keys == null) {
        for (const [k, v] of data) out[k] = clone(v);
      } else if (typeof keys === "string" || Array.isArray(keys)) {
        for (const k of typeof keys === "string" ? [keys] : keys) if (data.has(k)) out[k] = clone(data.get(k));
      } else {
        for (const [k, def] of Object.entries(keys)) out[k] = data.has(k) ? clone(data.get(k)) : def;
      }
      return out;
    },
    async set(items: Record<string, unknown>) {
      const changes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data.get(k), newValue: clone(v) };
        data.set(k, clone(v));
      }
      onChanged.emit(changes, areaName);
    },
    async remove(keys: string | string[]) {
      for (const k of typeof keys === "string" ? [keys] : keys) data.delete(k);
    },
    async clear() {
      data.clear();
    },
  };
}

export interface ChromeShim {
  chrome: any;
  /** Resolves once every page target that existed at startup is registered as a tab. */
  ready: Promise<void>;
  tabIdForTarget(targetId: string): number | undefined;
  targetIdForTab(tabId: number): string | undefined;
  /** Sends a CDP command on the driver's own (non-debugger) session for a tab. */
  sendToTab(tabId: number, method: string, params?: Record<string, unknown>): Promise<any>;
  getWindowBounds(tabId: number): Promise<{ windowId: number; bounds: any }>;
  dispose(): void;
}

export function createChromeShim(transport: CdpTransport, options: { contentScript: string }): ChromeShim {
  const contentScriptSource = options.contentScript;
  const tabs = new Map<number, TabRecord>();
  const byTarget = new Map<string, TabRecord>();
  const registering = new Map<string, Promise<TabRecord | null>>();
  const sessions = new Map<string, { rec: TabRecord; kind: "driver" | "debugger" }>();
  const groups = new Map<number, { title?: string; color?: string }>();
  let nextTabId = 1;
  let nextGroupId = 1;
  let activeTabId: number | null = null;
  let lastError: { message: string } | undefined;

  const storageOnChanged = createEvent();
  const tabsOnUpdated = createEvent();
  const tabsOnRemoved = createEvent();
  const debuggerOnEvent = createEvent();
  const debuggerOnDetach = createEvent();

  function requireTab(tabId: number): TabRecord {
    const rec = tabs.get(tabId);
    if (!rec) throw new Error(`No tab with id: ${tabId}.`);
    return rec;
  }

  function toTab(rec: TabRecord): ChromeTab {
    return {
      id: rec.tabId,
      url: rec.url,
      title: rec.title,
      active: rec.tabId === activeTabId,
      windowId: rec.windowId,
      status: rec.status,
      groupId: rec.groupId,
      index: [...tabs.keys()].indexOf(rec.tabId),
      pinned: false,
    };
  }

  function setStatus(rec: TabRecord, status: TabRecord["status"]) {
    if (rec.status === status) return;
    rec.status = status;
    tabsOnUpdated.emit(rec.tabId, { status }, toTab(rec));
  }

  async function refreshInfo(rec: TabRecord) {
    try {
      const { targetInfo } = await transport.send("Target.getTargetInfo", { targetId: rec.targetId });
      rec.url = targetInfo.url;
      rec.title = targetInfo.title || targetInfo.url;
    } catch {}
  }

  function registerTarget(targetId: string): Promise<TabRecord | null> {
    const existing = byTarget.get(targetId);
    if (existing) return Promise.resolve(existing);
    const inflight = registering.get(targetId);
    if (inflight) return inflight;
    const p = (async () => {
      try {
        const { targetInfo } = await transport.send("Target.getTargetInfo", { targetId });
        if (targetInfo.type !== "page") return null;
        const { sessionId } = await transport.send("Target.attachToTarget", { targetId, flatten: true });
        let windowId = 0;
        try {
          windowId = (await transport.send("Browser.getWindowForTarget", { targetId })).windowId;
        } catch {}
        const rec: TabRecord = {
          tabId: nextTabId++,
          targetId,
          sessionId,
          windowId,
          url: targetInfo.url,
          title: targetInfo.title || targetInfo.url,
          status: "complete",
          groupId: -1,
          debuggerSessionId: null,
        };
        sessions.set(sessionId, { rec, kind: "driver" });
        tabs.set(rec.tabId, rec);
        byTarget.set(targetId, rec);
        if (activeTabId == null) activeTabId = rec.tabId;
        await transport.send("Page.enable", {}, sessionId);
        return rec;
      } catch {
        return null;
      } finally {
        registering.delete(targetId);
      }
    })();
    registering.set(targetId, p);
    return p;
  }

  function forgetTab(rec: TabRecord, reason: string) {
    if (!tabs.has(rec.tabId)) return;
    tabs.delete(rec.tabId);
    byTarget.delete(rec.targetId);
    sessions.delete(rec.sessionId);
    if (rec.debuggerSessionId) {
      sessions.delete(rec.debuggerSessionId);
      rec.debuggerSessionId = null;
      debuggerOnDetach.emit({ tabId: rec.tabId }, reason);
    }
    if (rec.groupId !== -1 && ![...tabs.values()].some((t) => t.groupId === rec.groupId)) groups.delete(rec.groupId);
    if (activeTabId === rec.tabId) activeTabId = tabs.size ? [...tabs.keys()][tabs.size - 1]! : null;
    tabsOnRemoved.emit(rec.tabId, { windowId: rec.windowId, isWindowClosing: false });
  }

  const unsubscribe = transport.onEvent((method, params, sessionId) => {
    if (method === "Target.targetCreated" && params.targetInfo?.type === "page") {
      void registerTarget(params.targetInfo.targetId);
      return;
    }
    if (method === "Target.targetInfoChanged") {
      const rec = byTarget.get(params.targetInfo?.targetId);
      if (rec) {
        rec.url = params.targetInfo.url;
        rec.title = params.targetInfo.title || params.targetInfo.url;
      }
      return;
    }
    if (method === "Target.targetDestroyed") {
      const rec = byTarget.get(params.targetId);
      if (rec) forgetTab(rec, "target_closed");
      return;
    }
    if (method === "Target.detachedFromTarget") {
      const entry = sessions.get(params.sessionId);
      if (entry?.kind === "debugger") {
        sessions.delete(params.sessionId);
        entry.rec.debuggerSessionId = null;
        debuggerOnDetach.emit({ tabId: entry.rec.tabId }, "target_closed");
      }
      return;
    }
    if (!sessionId) return;
    const entry = sessions.get(sessionId);
    if (!entry) return;
    const { rec } = entry;
    if (entry.kind === "debugger") {
      debuggerOnEvent.emit({ tabId: rec.tabId }, method, params);
      return;
    }
    const isMainFrame = params.frameId === rec.targetId || params.frame?.id === rec.targetId;
    switch (method) {
      case "Page.frameStartedLoading":
        if (isMainFrame) setStatus(rec, "loading");
        break;
      case "Page.frameNavigated":
        if (isMainFrame && !params.frame.parentId) {
          rec.url = params.frame.url + (params.frame.urlFragment || "");
          if (params.type === "BackForwardCacheRestore") void refreshInfo(rec).then(() => setStatus(rec, "complete"));
        }
        break;
      case "Page.frameStoppedLoading":
        if (isMainFrame) void refreshInfo(rec).then(() => setStatus(rec, "complete"));
        break;
      case "Page.navigatedWithinDocument":
        if (isMainFrame) {
          rec.url = params.url;
          setStatus(rec, "complete");
        }
        break;
      case "Page.loadEventFired":
        void refreshInfo(rec).then(() => setStatus(rec, "complete"));
        break;
      case "Page.javascriptDialogOpening":
        if (!rec.debuggerSessionId) {
          transport
            .send("Page.handleJavaScriptDialog", { accept: params.type === "beforeunload" }, rec.sessionId)
            .catch(() => {});
        }
        break;
    }
  });

  const ready = (async () => {
    await transport.send("Target.setDiscoverTargets", { discover: true });
    const { targetInfos } = await transport.send("Target.getTargets");
    for (const info of targetInfos as any[]) if (info.type === "page") await registerTarget(info.targetId);
  })();

  async function navigate(rec: TabRecord, url: string) {
    setStatus(rec, "loading");
    rec.url = url;
    const res = await transport.send("Page.navigate", { url }, rec.sessionId);
    if (!res.loaderId || res.errorText) {
      await refreshInfo(rec);
      setStatus(rec, "complete");
    }
  }

  async function createTab(url: string, { active, newWindow }: { active: boolean; newWindow: boolean }) {
    const { targetId } = await transport.send("Target.createTarget", {
      url: "about:blank",
      newWindow,
      background: !active,
    });
    const rec = await registerTarget(targetId);
    if (!rec) throw new Error("Failed to attach to the newly created tab.");
    if (active) {
      activeTabId = rec.tabId;
      await transport.send("Target.activateTarget", { targetId }).catch(() => {});
    }
    if (url && url !== "about:blank") await navigate(rec, url);
    return rec;
  }

  async function goHistory(rec: TabRecord, delta: number) {
    const { currentIndex, entries } = await transport.send("Page.getNavigationHistory", {}, rec.sessionId);
    const entry = entries[currentIndex + delta];
    if (!entry) throw new Error("Cannot find a next page in history.");
    setStatus(rec, "loading");
    await transport.send("Page.navigateToHistoryEntry", { entryId: entry.id }, rec.sessionId);
  }

  async function evaluateInContentWorld(rec: TabRecord, expression: string): Promise<any> {
    const { frameTree } = await transport.send("Page.getFrameTree", {}, rec.sessionId);
    const { executionContextId } = await transport.send(
      "Page.createIsolatedWorld",
      { frameId: frameTree.frame.id, worldName: CONTENT_WORLD_NAME },
      rec.sessionId,
    );
    const res = await transport.send(
      "Runtime.evaluate",
      { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true },
      rec.sessionId,
    );
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(d.exception?.description || d.text || "Script failed");
    }
    return res.result?.value;
  }

  function contentBootstrap(): string {
    return `(() => {
  if (globalThis.__videntiaContent) return;
  let listener = null;
  const chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } } } };
${contentScriptSource}
;globalThis.__videntiaContent = {
    dispatch(msg) {
      let response;
      let responded = false;
      listener(msg, {}, (r) => { response = r; responded = true; });
      return responded ? { response } : { noResponse: true };
    },
  };
})()`;
  }

  async function sendToContentScript(rec: TabRecord, message: unknown) {
    if (!contentScriptSource) throw new Error("Content script source not loaded");
    const loaded = await evaluateInContentWorld(rec, "typeof globalThis.__videntiaContent === 'object'");
    if (!loaded) await evaluateInContentWorld(rec, contentBootstrap());
    const out = await evaluateInContentWorld(rec, `globalThis.__videntiaContent.dispatch(${JSON.stringify(message)})`);
    if (!out || out.noResponse) throw new Error("Could not establish connection. Receiving end does not exist.");
    return out.response;
  }

  const chrome: any = {
    runtime: {
      id: "videntia-browser-driver",
      get lastError() {
        return lastError;
      },
      onMessage: createEvent(),
      onInstalled: createEvent(),
      onStartup: createEvent(),
    },
    action: {
      setBadgeText: async () => {},
      setIcon: (_details: unknown, cb?: () => void) => {
        cb?.();
      },
    },
    alarms: { create: () => {}, onAlarm: createEvent() },
    storage: {
      session: createStorageArea(storageOnChanged, "session"),
      local: createStorageArea(storageOnChanged, "local"),
      onChanged: storageOnChanged,
    },
    tabs: {
      onUpdated: tabsOnUpdated,
      onRemoved: tabsOnRemoved,
      async get(tabId: number) {
        const rec = requireTab(tabId);
        await refreshInfo(rec);
        return toTab(rec);
      },
      async query(q: Record<string, any> = {}) {
        const activeWindow = activeTabId != null ? tabs.get(activeTabId)?.windowId : undefined;
        await Promise.all([...tabs.values()].map(refreshInfo));
        return [...tabs.values()]
          .filter((rec) => (q.active === undefined ? true : (rec.tabId === activeTabId) === q.active))
          .filter((rec) => (q.currentWindow ? rec.windowId === activeWindow : true))
          .filter((rec) => (q.windowId === undefined ? true : rec.windowId === q.windowId))
          .filter((rec) => (q.groupId === undefined ? true : rec.groupId === q.groupId))
          .map(toTab);
      },
      async create({ url, active }: { url?: string; active?: boolean }) {
        return toTab(await createTab(url || "about:blank", { active: active !== false, newWindow: false }));
      },
      async remove(ids: number | number[]) {
        for (const id of Array.isArray(ids) ? ids : [ids]) {
          const rec = requireTab(id);
          await transport.send("Target.closeTarget", { targetId: rec.targetId });
          forgetTab(rec, "target_closed");
        }
      },
      async update(tabId: number, props: { url?: string; active?: boolean }) {
        const rec = requireTab(tabId);
        if (props.active) activeTabId = tabId;
        if (props.url) await navigate(rec, props.url);
        return toTab(rec);
      },
      async goBack(tabId: number) {
        await goHistory(requireTab(tabId), -1);
      },
      async goForward(tabId: number) {
        await goHistory(requireTab(tabId), 1);
      },
      async group({ tabIds, groupId }: { tabIds: number | number[]; groupId?: number }) {
        const id = groupId ?? nextGroupId++;
        if (groupId != null && !groups.has(groupId)) throw new Error(`No group with id: ${groupId}.`);
        if (!groups.has(id)) groups.set(id, {});
        for (const tabId of Array.isArray(tabIds) ? tabIds : [tabIds]) requireTab(tabId).groupId = id;
        return id;
      },
      sendMessage(tabId: number, message: unknown, callback: (response?: unknown) => void) {
        const done = (response?: unknown, error?: string) => {
          lastError = error ? { message: error } : undefined;
          try {
            callback(response);
          } finally {
            lastError = undefined;
          }
        };
        const rec = tabs.get(tabId);
        if (!rec) return done(undefined, `No tab with id: ${tabId}.`);
        sendToContentScript(rec, message).then(
          (response) => done(response),
          (e) => done(undefined, e?.message || String(e)),
        );
      },
      async captureVisibleTab(windowId: number, opts: { format?: string } = {}) {
        const rec = [...tabs.values()].find((t) => t.windowId === windowId && t.tabId === activeTabId);
        if (!rec) throw new Error(`No active tab in window ${windowId}`);
        const format = opts.format === "jpeg" ? "jpeg" : "png";
        const { data } = await transport.send("Page.captureScreenshot", { format }, rec.sessionId);
        return `data:image/${format};base64,${data}`;
      },
    },
    tabGroups: {
      async get(groupId: number) {
        const g = groups.get(groupId);
        if (!g) throw new Error(`No group with id: ${groupId}.`);
        return { id: groupId, ...g };
      },
      async update(groupId: number, props: { title?: string; color?: string }) {
        const g = groups.get(groupId);
        if (!g) throw new Error(`No group with id: ${groupId}.`);
        Object.assign(g, props);
        return { id: groupId, ...g };
      },
    },
    windows: {
      async create({ url, focused }: { url?: string; focused?: boolean }) {
        const rec = await createTab(url || "about:blank", { active: focused !== false, newWindow: true });
        return { id: rec.windowId, tabs: [toTab(rec)] };
      },
      async update(windowId: number, opts: { width?: number; height?: number; left?: number; top?: number }) {
        const bounds: Record<string, number | string> = { windowState: "normal" };
        for (const k of ["left", "top", "width", "height"] as const)
          if (typeof opts[k] === "number") bounds[k] = opts[k]!;
        await transport.send("Browser.setWindowBounds", { windowId, bounds });
        return { id: windowId };
      },
    },
    scripting: {
      async executeScript({
        target,
        func,
        args = [],
      }: {
        target: { tabId: number };
        func: Function;
        args?: unknown[];
      }) {
        const rec = requireTab(target.tabId);
        const result = await evaluateInContentWorld(rec, `(${func.toString()})(...${JSON.stringify(args)})`);
        return [{ frameId: 0, result }];
      },
    },
    debugger: {
      onEvent: debuggerOnEvent,
      onDetach: debuggerOnDetach,
      async attach({ tabId }: { tabId: number }, _version: string) {
        const rec = requireTab(tabId);
        if (rec.debuggerSessionId)
          throw new Error(`Another debugger is already attached to the tab with id: ${tabId}.`);
        const { sessionId } = await transport.send("Target.attachToTarget", { targetId: rec.targetId, flatten: true });
        rec.debuggerSessionId = sessionId;
        sessions.set(sessionId, { rec, kind: "debugger" });
      },
      async detach({ tabId }: { tabId: number }) {
        const rec = requireTab(tabId);
        const sessionId = rec.debuggerSessionId;
        if (!sessionId) throw new Error(`Debugger is not attached to the tab with id: ${tabId}.`);
        rec.debuggerSessionId = null;
        sessions.delete(sessionId);
        await transport.send("Target.detachFromTarget", { sessionId }).catch(() => {});
      },
      async sendCommand({ tabId }: { tabId: number }, method: string, params: Record<string, unknown> = {}) {
        const rec = requireTab(tabId);
        if (!rec.debuggerSessionId) throw new Error(`Debugger is not attached to the tab with id: ${tabId}.`);
        return transport.send(method, params, rec.debuggerSessionId);
      },
    },
  };

  return {
    chrome,
    ready,
    tabIdForTarget: (targetId) => byTarget.get(targetId)?.tabId,
    targetIdForTab: (tabId) => tabs.get(tabId)?.targetId,
    sendToTab: (tabId, method, params = {}) => transport.send(method, params, requireTab(tabId).sessionId),
    async getWindowBounds(tabId) {
      const rec = requireTab(tabId);
      const res = await transport.send("Browser.getWindowForTarget", { targetId: rec.targetId });
      rec.windowId = res.windowId;
      return { windowId: res.windowId, bounds: res.bounds };
    },
    dispose() {
      unsubscribe();
    },
  };
}
