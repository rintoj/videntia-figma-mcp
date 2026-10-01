import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CdpEventListener, CdpTransport } from "../../src/browser_driver/cdp-connection";
import { main } from "../../src/browser_driver/cli";
import { createCommandRouter, type CommandRouter } from "../../src/browser_driver/command-router";
import {
  listDriverStates,
  readDriverState,
  removeDriverState,
  writeDriverState,
  type DriverState,
} from "../../src/browser_driver/driver-state";
import { createRelayClient, JoinRefusedError, responseEnvelope } from "../../src/browser_driver/relay-client";
import { parseArgs, parseDuration } from "../../src/browser_driver/utils";

/**
 * Unit tests of the driver against a scripted CDP transport. The router runs the
 * extension's real background.js + cdp.js, so these pin down which CDP calls each
 * command makes and that results keep the extension's shapes. The real-browser run
 * lives in driver-smoke.test.ts.
 */

type Call = { method: string; params: any; sessionId?: string };

const CHROME_HEIGHT = 80;

function createFakeCdp() {
  const calls: Call[] = [];
  const listeners = new Set<CdpEventListener>();
  const targets = new Map<string, { targetId: string; type: string; url: string; title: string }>([
    ["T1", { targetId: "T1", type: "page", url: "https://example.test/", title: "Example" }],
  ]);
  const sessionTarget = new Map<string, string>();
  const driverSession = new Map<string, string>();
  const history = new Map<string, { id: number; url: string }[]>([["T1", [{ id: 1, url: "https://example.test/" }]]]);
  const bounds = { left: 0, top: 0, width: 800, height: 600 };
  const contentCalls: any[] = [];
  let contentResponse: (msg: any) => any = (msg) => ({ echo: msg.command });
  let sessionCounter = 0;

  const emit = (method: string, params: any, sessionId?: string) => {
    for (const l of listeners) l(method, params, sessionId);
  };
  const loadLater = (targetId: string) => {
    const sid = driverSession.get(targetId)!;
    setTimeout(() => {
      emit("Page.frameStartedLoading", { frameId: targetId }, sid);
      emit("Page.loadEventFired", { timestamp: 1 }, sid);
    }, 5);
  };

  const handlers: Record<string, (p: any, sid?: string) => any> = {
    "Target.getTargets": () => ({ targetInfos: [...targets.values()] }),
    "Target.getTargetInfo": (p) => {
      const t = targets.get(p.targetId);
      if (!t) throw new Error("No target with given id found");
      return { targetInfo: { ...t } };
    },
    "Target.attachToTarget": (p) => {
      const sessionId = `S${++sessionCounter}`;
      sessionTarget.set(sessionId, p.targetId);
      if (!driverSession.has(p.targetId)) driverSession.set(p.targetId, sessionId);
      return { sessionId };
    },
    "Target.createTarget": (p) => {
      const targetId = `T${targets.size + 1}`;
      targets.set(targetId, { targetId, type: "page", url: p.url, title: p.url });
      history.set(targetId, [{ id: 1, url: p.url }]);
      return { targetId };
    },
    "Target.closeTarget": (p) => {
      targets.delete(p.targetId);
      setTimeout(() => emit("Target.targetDestroyed", { targetId: p.targetId }), 0);
      return { success: true };
    },
    "Browser.getWindowForTarget": () => ({ windowId: 7, bounds: { ...bounds } }),
    "Browser.setWindowBounds": (p) => {
      Object.assign(bounds, p.bounds);
      return {};
    },
    "Page.navigate": (p, sid) => {
      const targetId = sessionTarget.get(sid!)!;
      Object.assign(targets.get(targetId)!, { url: p.url, title: "Navigated" });
      history.get(targetId)!.push({ id: history.get(targetId)!.length + 1, url: p.url });
      loadLater(targetId);
      return { frameId: targetId, loaderId: "L1" };
    },
    "Page.getNavigationHistory": (_p, sid) => {
      const entries = history.get(sessionTarget.get(sid!)!)!;
      return { currentIndex: entries.length - 1, entries };
    },
    "Page.getFrameTree": (_p, sid) => ({ frameTree: { frame: { id: sessionTarget.get(sid!) } } }),
    "Page.createIsolatedWorld": () => ({ executionContextId: 99 }),
    "Accessibility.getFullAXTree": () => ({
      nodes: [
        { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Example" }, childIds: ["2"] },
        { nodeId: "2", parentId: "1", role: { value: "button" }, name: { value: "Go" }, backendDOMNodeId: 12 },
        { nodeId: "3", parentId: "1", ignored: true },
      ],
    }),
    "Runtime.evaluate": (p) => {
      if (p.contextId === 99) {
        if (p.expression.startsWith("typeof globalThis.__videntiaContent")) return { result: { value: true } };
        const match = p.expression.match(/^globalThis\.__videntiaContent\.dispatch\((.*)\)$/s);
        if (match) {
          const msg = JSON.parse(match[1]);
          contentCalls.push(msg);
          return { result: { value: { response: contentResponse(msg) } } };
        }
        return { result: { value: undefined } };
      }
      if (p.expression === "({ w: innerWidth, h: innerHeight })") {
        return { result: { value: { w: bounds.width, h: bounds.height - CHROME_HEIGHT } } };
      }
      return { result: { type: "number", value: 2, description: "2" } };
    },
  };

  const transport: CdpTransport = {
    async send(method, params = {}, sessionId) {
      calls.push({ method, params, sessionId });
      const handler = handlers[method];
      return handler ? handler(params, sessionId) : {};
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {},
  };

  return {
    transport,
    calls,
    contentCalls,
    emit,
    driverSession,
    setContentResponse: (fn: (msg: any) => any) => {
      contentResponse = fn;
    },
    callsOf: (method: string) => calls.filter((c) => c.method === method),
  };
}

describe("command router (extension background.js over a CDP shim)", () => {
  let cdp: ReturnType<typeof createFakeCdp>;
  let router: CommandRouter;

  beforeEach(async () => {
    cdp = createFakeCdp();
    router = await createCommandRouter(cdp.transport, { platform: "linux" });
  });
  afterEach(() => router.dispose());

  it("maps existing page targets to small integer tab ids", async () => {
    expect(await router.handle("list_tabs")).toEqual({
      agentGroupId: null,
      tabs: [
        {
          tabId: 1,
          url: "https://example.test/",
          title: "Example",
          active: true,
          windowId: 7,
          pinnedForSession: false,
          inAgentGroup: false,
        },
      ],
    });
  });

  it("rejects unknown commands instead of faking success", async () => {
    await expect(router.handle("set_window_title", {})).rejects.toThrow("Unknown browser command: set_window_title");
  });

  it("create_tab opens a grouped target, waits for load and close_group closes it", async () => {
    const created: any = await router.handle("create_tab", { url: "https://example.test/next" });
    expect(created).toEqual({
      success: true,
      tabId: 2,
      windowId: 7,
      url: "https://example.test/next",
      title: "Navigated",
      groupId: 1,
    });
    expect(cdp.callsOf("Target.createTarget")[0]!.params).toMatchObject({ url: "about:blank", newWindow: false });
    expect(cdp.callsOf("Page.navigate")[0]!.params).toEqual({ url: "https://example.test/next" });

    const list: any = await router.handle("list_tabs");
    expect(list.agentGroupId).toBe(1);
    expect(list.tabs.find((t: any) => t.tabId === 2)).toMatchObject({ active: true, inAgentGroup: true });

    expect(await router.handle("close_group")).toEqual({ success: true, closed: 1 });
    expect(cdp.callsOf("Target.closeTarget")[0]!.params).toEqual({ targetId: "T2" });
  });

  it("create_tab and navigate refuse non-http urls exactly like the extension", async () => {
    await expect(router.handle("create_tab", { url: "file:///etc/passwd" })).rejects.toThrow(/only http\(s\) URLs/);
    await expect(router.handle("navigate", { tabId: 1, url: "javascript:alert(1)" })).rejects.toThrow(
      /only http\(s\) URLs/,
    );
  });

  it("close_tab requires an explicit tabId", async () => {
    await expect(router.handle("close_tab", {})).rejects.toThrow(/requires an explicit tabId/);
    expect(await router.handle("close_tab", { tabId: 1 })).toEqual({ success: true, tabId: 1 });
    await expect(router.handle("get_page_info", { tabId: 1 })).rejects.toThrow(/Tab 1 not found/);
  });

  it("set_viewport sizes the window so the viewport equals a desktop frame", async () => {
    const res = await router.handle("set_viewport", { tabId: 1, width: 1440, height: 900 });
    expect(res).toEqual({
      success: true,
      tabId: 1,
      width: 1440,
      height: 900,
      emulated: false,
      windowWidth: 1440,
      windowHeight: 900 + CHROME_HEIGHT,
    });
    expect(cdp.callsOf("Browser.setWindowBounds")[0]!.params).toEqual({
      windowId: 7,
      bounds: { windowState: "normal", width: 1440, height: 900 + CHROME_HEIGHT },
    });
    expect(cdp.callsOf("Emulation.setDeviceMetricsOverride")).toHaveLength(0);
  });

  it("set_viewport emulates frames below the 500px window minimum on a debugger session", async () => {
    const res: any = await router.handle("set_viewport", { tabId: 1, width: 375, height: 812 });
    expect(res).toMatchObject({ success: true, tabId: 1, width: 375, height: 812, emulated: true });
    const [override] = cdp.callsOf("Emulation.setDeviceMetricsOverride");
    expect(override!.params).toEqual({ width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    expect(override!.sessionId).not.toBe(cdp.driverSession.get("T1"));
  });

  it("navigate, go_back and go_forward re-apply viewport emulation", async () => {
    await router.handle("set_viewport", { tabId: 1, width: 390, height: 844 });
    expect(cdp.callsOf("Emulation.setDeviceMetricsOverride")).toHaveLength(1);

    const nav = await router.handle("navigate", { tabId: 1, url: "https://example.test/b" });
    expect(nav).toEqual({ success: true, tabId: 1, url: "https://example.test/b", title: "Navigated" });
    expect(cdp.callsOf("Emulation.setDeviceMetricsOverride")).toHaveLength(2);
    expect(cdp.callsOf("Emulation.setDeviceMetricsOverride")[1]!.params).toMatchObject({ width: 390, height: 844 });

    await expect(router.handle("go_forward", { tabId: 1 })).rejects.toThrow(
      "Cannot go forward: Cannot find a next page in history.",
    );
  });

  it("emulate applies media overrides and reports the tab's override state", async () => {
    const res: any = await router.handle("emulate", { tabId: 1, colorScheme: "dark", timezone: "Asia/Kolkata" });
    expect(res).toMatchObject({ success: true, tabId: 1, timezone: "Asia/Kolkata" });
    expect(cdp.callsOf("Emulation.setEmulatedMedia")[0]!.params.features).toContainEqual({
      name: "prefers-color-scheme",
      value: "dark",
    });
    expect(cdp.callsOf("Emulation.setTimezoneOverride")[0]!.params).toEqual({ timezoneId: "Asia/Kolkata" });
  });

  it("get_page_info reads the live target, not a placeholder", async () => {
    expect(await router.handle("get_page_info", { tabId: 1 })).toEqual({
      url: "https://example.test/",
      title: "Example",
      tabId: 1,
    });
  });

  it("evaluate_js returns the extension's normalized result", async () => {
    expect(await router.handle("evaluate_js", { tabId: 1, expression: "1+1" })).toEqual({
      tabId: 1,
      type: "number",
      value: 2,
    });
  });

  it("get_ax_tree flattens Accessibility.getFullAXTree", async () => {
    expect(await router.handle("get_ax_tree", { tabId: 1 })).toEqual({
      tabId: 1,
      count: 2,
      nodes: [
        { axId: "1", role: "RootWebArea", name: "Example", backendDOMNodeId: null, depth: 0 },
        { axId: "2", role: "button", name: "Go", backendDOMNodeId: 12, depth: 1 },
      ],
    });
  });

  it("read_console starts monitoring and buffers console events from the debugger session", async () => {
    const first: any = await router.handle("read_console", { tabId: 1 });
    expect(first).toEqual({ tabId: 1, monitoringJustStarted: true, total: 0, entries: [] });
    const enabled = cdp.calls.filter((c) => ["Runtime.enable", "Log.enable", "Network.enable"].includes(c.method));
    expect(enabled.map((c) => c.method)).toEqual(["Runtime.enable", "Log.enable", "Network.enable"]);
    const debuggerSession = enabled[0]!.sessionId!;

    cdp.emit("Runtime.consoleAPICalled", { type: "warning", args: [{ type: "string", value: "hi" }] }, debuggerSession);
    cdp.emit(
      "Runtime.consoleAPICalled",
      { type: "log", args: [{ type: "string", value: "ignored" }] },
      cdp.driverSession.get("T1"),
    );
    const second: any = await router.handle("read_console", { tabId: 1 });
    expect(second.monitoringJustStarted).toBe(false);
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0]).toMatchObject({ kind: "console", level: "warn", text: "hi" });

    cdp.emit(
      "Network.requestWillBeSent",
      { requestId: "r1", request: { url: "https://x.test/a", method: "GET" }, type: "XHR" },
      debuggerSession,
    );
    cdp.emit(
      "Network.responseReceived",
      { requestId: "r1", response: { status: 204, mimeType: "text/plain" } },
      debuggerSession,
    );
    const net: any = await router.handle("read_network", { tabId: 1 });
    expect(net.requests[0]).toMatchObject({ url: "https://x.test/a", method: "GET", status: 204, resourceType: "XHR" });
  });

  it("page-side commands go to content.js in an isolated world and keep its result", async () => {
    cdp.setContentResponse((msg) => ({ selector: msg.params.selector, tag: "button", styles: { color: "red" } }));
    const res = await router.handle("get_computed_styles", { tabId: 1, selector: ".cta" });
    expect(res).toEqual({ selector: ".cta", tag: "button", styles: { color: "red" } });
    expect(cdp.contentCalls[0]).toEqual({ command: "get_computed_styles", params: { tabId: 1, selector: ".cta" } });
    expect(cdp.callsOf("Page.createIsolatedWorld")[0]!.params).toEqual({
      frameId: "T1",
      worldName: "videntia-content",
    });

    cdp.setContentResponse(() => ({ error: "No element matches: .gone" }));
    await expect(router.handle("get_computed_styles", { tabId: 1, selector: ".gone" })).rejects.toThrow(
      "No element matches: .gone",
    );
  });

  it("inject_figma_overlay resizes to the frame before handing off to content.js", async () => {
    cdp.setContentResponse((msg) => ({ success: true, width: msg.params.width, height: msg.params.height }));
    const res = await router.handle("inject_figma_overlay", { tabId: 1, imageData: "AA==", width: 1200, height: 700 });
    expect(res).toEqual({ success: true, width: 1200, height: 700 });
    expect(cdp.callsOf("Browser.setWindowBounds")[0]!.params.bounds).toMatchObject({
      width: 1200,
      height: 700 + CHROME_HEIGHT,
    });
  });
});

describe("relay client", () => {
  type Relay = { port: number; joins: any[]; replies: any[]; sockets: any[]; stop(): void };

  function startRelay(onJoin: (ws: any, data: any) => void = confirmJoin): Relay {
    const joins: any[] = [];
    const replies: any[] = [];
    const sockets: any[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("no", { status: 400 })),
      websocket: {
        open: (ws) => void sockets.push(ws),
        message(ws, raw) {
          const data = JSON.parse(String(raw));
          if (data.type === "join") {
            joins.push(data);
            onJoin(ws, data);
          } else replies.push(data);
        },
      },
    });
    return { port: server.port!, joins, replies, sockets, stop: () => server.stop(true) };
  }

  function confirmJoin(ws: any, data: any) {
    ws.send(JSON.stringify({ type: "system", message: `Joined channel: ${data.channel}`, channel: data.channel }));
    ws.send(
      JSON.stringify({
        type: "system",
        message: { result: `Connected to channel: ${data.channel}` },
        channel: data.channel,
      }),
    );
  }

  const waitFor = async (cond: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error("timed out waiting");
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  it("joins as a driver and answers commands with the extension's envelope", async () => {
    const relay = startRelay();
    const client = createRelayClient({
      relayUrl: `ws://127.0.0.1:${relay.port}`,
      browserId: "cft-slot-3",
      browserLabel: "Chrome for Testing 145 · cft-slot-3",
      onCommand: async (command, params) => {
        if (command === "fail") throw new Error("nope");
        return { command, params };
      },
    });
    try {
      await client.start();
      expect(client.status).toBe("connected");
      expect(relay.joins[0]).toEqual({
        type: "join",
        channel: "browser",
        clientType: "driver",
        browserId: "cft-slot-3",
        browserLabel: "Chrome for Testing 145 · cft-slot-3",
      });
      const ws = relay.sockets[0];
      ws.send(
        JSON.stringify({
          type: "broadcast",
          sender: "User",
          channel: "browser",
          message: { id: "a", command: "ping", params: { x: 1 } },
        }),
      );
      ws.send(JSON.stringify({ type: "broadcast", channel: "browser", message: { id: "b", command: "fail" } }));
      ws.send(
        JSON.stringify({
          type: "broadcast",
          channel: "browser",
          message: { id: "c", result: "a reply, not a command" },
        }),
      );
      await waitFor(() => relay.replies.length >= 2);
      expect(relay.replies).toContainEqual(responseEnvelope("a", { result: { command: "ping", params: { x: 1 } } }));
      expect(relay.replies).toContainEqual({
        id: "b",
        type: "message",
        channel: "browser",
        message: { id: "b", error: "nope" },
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(relay.replies).toHaveLength(2);
    } finally {
      client.stop();
      relay.stop();
    }
  });

  it("fails fast without retrying when the relay refuses the join", async () => {
    const relay = startRelay((ws) =>
      ws.send(JSON.stringify({ type: "error", message: "Browser driver requires browserId" })),
    );
    const client = createRelayClient({
      relayUrl: `ws://127.0.0.1:${relay.port}`,
      browserId: "x",
      browserLabel: "x",
      onCommand: async () => null,
      backoffMs: [1],
    });
    try {
      await expect(client.start()).rejects.toBeInstanceOf(JoinRefusedError);
      expect(relay.joins).toHaveLength(1);
    } finally {
      client.stop();
      relay.stop();
    }
  });

  it("rejoins after the relay drops the connection", async () => {
    const relay = startRelay();
    const statuses: string[] = [];
    const client = createRelayClient({
      relayUrl: `ws://127.0.0.1:${relay.port}`,
      browserId: "x",
      browserLabel: "x",
      onCommand: async () => null,
      onStatus: (s) => statuses.push(s),
      backoffMs: [10],
    });
    try {
      await client.start();
      relay.sockets[0].close();
      await waitFor(() => relay.joins.length === 2 && client.status === "connected");
      expect(statuses).toEqual(["connecting", "connected", "connecting", "connected"]);
    } finally {
      client.stop();
      relay.stop();
    }
  });

  it("gives up after maxAttempts when the relay is unreachable", async () => {
    const relay = startRelay();
    const port = relay.port;
    relay.stop();
    const client = createRelayClient({
      relayUrl: `ws://127.0.0.1:${port}`,
      browserId: "x",
      browserLabel: "x",
      onCommand: async () => null,
      maxAttempts: 2,
      backoffMs: [5],
    });
    await expect(client.start()).rejects.toThrow();
    expect(client.status).toBe("disconnected");
  });
});

describe("driver state, cli and argument parsing", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "driver-state-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const state = (patch: Partial<DriverState> = {}): DriverState => ({
    id: "slot-1",
    pid: process.pid,
    chromePid: null,
    cdpUrl: "ws://127.0.0.1:1/devtools/browser/x",
    relayUrl: "ws://localhost:3055",
    relayStatus: "connected",
    userDataDir: null,
    startedAt: 1,
    lastCommandAt: null,
    ...patch,
  });

  it("only removes a state file owned by the given pid", () => {
    writeDriverState(state(), dir);
    removeDriverState("slot-1", process.pid + 1, dir);
    expect(readDriverState("slot-1", dir)?.pid).toBe(process.pid);
    removeDriverState("slot-1", process.pid, dir);
    expect(readDriverState("slot-1", dir)).toBeNull();
  });

  it("lists drivers with liveness", () => {
    writeDriverState(state(), dir);
    writeDriverState(state({ id: "slot-2", pid: 2 ** 22 + 12345 }), dir);
    expect(listDriverStates(dir).map((d) => [d.id, d.alive])).toEqual([
      ["slot-1", true],
      ["slot-2", false],
    ]);
  });

  it("rejects ids that would escape the state directory", () => {
    expect(() => writeDriverState(state({ id: "../evil" }), dir)).toThrow(/Invalid driver id/);
  });

  it("stop cleans up the state file of a driver that is no longer running", async () => {
    writeFileSync(join(dir, "dead.json"), JSON.stringify(state({ id: "dead", pid: 2 ** 22 + 54321 })));
    expect(await main(["stop", "--id", "dead"], dir)).toBe(0);
    expect(readDriverState("dead", dir)).toBeNull();
    expect(await main(["stop", "--id", "missing"], dir)).toBe(1);
    expect(await main(["start"], dir)).toBe(2);
  });

  it("parses --key value, --key=value and boolean flags", () => {
    expect(
      parseArgs(["start", "--id", "a", "--relay=ws://h:1", "--headful", "--idle-timeout", "5m"], new Set(["headful"])),
    ).toEqual({
      _: ["start"],
      id: "a",
      relay: "ws://h:1",
      headful: true,
      "idle-timeout": "5m",
    });
    expect(parseArgs(["--headful", "start"], new Set(["headful"]))).toEqual({ _: ["start"], headful: true });
  });

  it("parses durations", () => {
    expect(parseDuration("30m")).toBe(1_800_000);
    expect(parseDuration("1.5s")).toBe(1500);
    expect(parseDuration("250ms")).toBe(250);
    expect(parseDuration("0")).toBe(0);
    expect(() => parseDuration("30")).toThrow(/needs a unit/);
    expect(() => parseDuration("soon")).toThrow(/Invalid duration/);
  });
});
