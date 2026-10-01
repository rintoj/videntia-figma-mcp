import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connectCdp, type CdpTransport } from "../../src/browser_driver/cdp-connection";
import { createCommandRouter, type CommandRouter } from "../../src/browser_driver/command-router";
import {
  DEFAULT_CHROME_BUILD,
  launchChrome,
  resolveChromeExecutable,
  type LaunchedBrowser,
} from "../../src/browser_driver/launcher";
import { createRelayClient } from "../../src/browser_driver/relay-client";

/**
 * Real end-to-end run: launches headless Chrome for Testing, loads the extension's own
 * background.js/cdp.js/content.js through the driver, and drives a served fixture page.
 * Skipped (never faked) when Chrome for Testing is not installed and cannot be fetched.
 */
const chromePath = await resolveChromeExecutable(process.env.VIDENTIA_DRIVER_CHROME_BUILD ?? DEFAULT_CHROME_BUILD, {
  offline: true,
}).catch(() => null);
const skipReason = chromePath
  ? ""
  : `Chrome for Testing ${DEFAULT_CHROME_BUILD} is not installed (npx @puppeteer/browsers install chrome@${DEFAULT_CHROME_BUILD})`;
if (skipReason) console.warn(`[driver-smoke] skipped: ${skipReason}`);

const fixtureHtml = readFileSync(join(import.meta.dir, "../fixtures/simple-page.html"), "utf-8");

function pngSize(base64: string): { width: number; height: number } {
  const buf = Buffer.from(base64, "base64");
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe.skipIf(!chromePath)("browser driver end-to-end (headless Chrome for Testing)", () => {
  let server: ReturnType<typeof Bun.serve>;
  let browser: LaunchedBrowser;
  let transport: CdpTransport;
  let router: CommandRouter;
  let pageUrl: string;
  let tabId: number;

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch: (req) =>
        new URL(req.url).pathname === "/other"
          ? new Response('<meta name="viewport" content="width=device-width"><title>Other</title><p>other</p>', {
              headers: { "content-type": "text/html" },
            })
          : new Response(fixtureHtml, { headers: { "content-type": "text/html" } }),
    });
    pageUrl = `http://127.0.0.1:${server.port}/`;
    browser = await launchChrome({ executablePath: chromePath! });
    transport = await connectCdp(browser.cdpUrl);
    router = await createCommandRouter(transport);
  }, 60000);

  afterAll(async () => {
    router?.dispose();
    transport?.close();
    await browser?.close();
    server?.stop(true);
  });

  it("create_tab returns a small integer tab id and the loaded page", async () => {
    const res: any = await router.handle("create_tab", { url: pageUrl });
    expect(res.success).toBe(true);
    expect(Number.isInteger(res.tabId)).toBe(true);
    expect(res.tabId).toBeLessThan(10);
    expect(res.url).toBe(pageUrl);
    expect(res.title).toBe("Driver Fixture");
    expect(typeof res.groupId).toBe("number");
    tabId = res.tabId;

    const list: any = await router.handle("list_tabs", {});
    const entry = list.tabs.find((t: any) => t.tabId === tabId);
    expect(entry).toMatchObject({ url: pageUrl, active: true, inAgentGroup: true });
  });

  it("evaluate_js runs in the page", async () => {
    expect(await router.handle("evaluate_js", { tabId, expression: "1 + 1" })).toEqual({
      tabId,
      type: "number",
      value: 2,
    });
    await expect(router.handle("evaluate_js", { tabId, expression: "throw new Error('boom')" })).rejects.toThrow(
      /boom/,
    );
  });

  it("get_computed_styles uses the extension's content script", async () => {
    const res: any = await router.handle("get_computed_styles", { tabId, selector: '[data-fig-id="1:4"]' });
    expect(res).toMatchObject({ selector: '[data-fig-id="1:4"]', tag: "button", className: "cta" });
    expect(res.styles["background-color"]).toBe("rgb(37, 99, 235)");
    expect(res.styles["border-radius"]).toBe("8px");

    const batch: any = await router.handle("get_computed_styles_batch", {
      tabId,
      selectors: ['[data-fig-id="1:3"]', ".missing"],
      properties: ["font-size", "font-weight"],
    });
    expect(batch.results[0]).toMatchObject({ found: true, styles: { "font-size": "24px", "font-weight": "700" } });
    expect(batch.results[1]).toMatchObject({ found: false });

    await expect(router.handle("get_computed_styles", { tabId, selector: ".missing" })).rejects.toThrow(
      /No element matches/,
    );
  });

  it("get_dom_nodes, collect_all_element_rects and resolve_selector_at_point return page data", async () => {
    const rects: any = await router.handle("collect_all_element_rects", { tabId });
    expect(rects.nodes.length).toBeGreaterThan(3);
    const at: any = await router.handle("resolve_selector_at_point", { tabId, x: 60, y: 40 });
    expect(at.selector).toBeTruthy();
    const dom: any = await router.handle("get_dom_nodes", { tabId, selector: ".card", depth: 1 });
    expect(JSON.stringify(dom)).toContain("data-fig-id");
  });

  it("click and type_text dispatch real input events", async () => {
    const click: any = await router.handle("click", { tabId, selector: '[data-fig-id="1:4"]' });
    expect(click.success).toBe(true);
    expect(((await router.handle("evaluate_js", { tabId, expression: "document.title" })) as any).value).toBe(
      "clicked",
    );
    await router.handle("type_text", { tabId, selector: "#name", text: "Ada" });
    expect(
      ((await router.handle("evaluate_js", { tabId, expression: "document.getElementById('name').value" })) as any)
        .value,
    ).toBe("Ada");
  });

  it("set_viewport sizes a desktop viewport and emulates a mobile one", async () => {
    const desktop: any = await router.handle("set_viewport", { tabId, width: 1280, height: 800 });
    expect(desktop).toMatchObject({ success: true, tabId, width: 1280, height: 800, emulated: false });
    expect(
      ((await router.handle("evaluate_js", { tabId, expression: "[innerWidth, innerHeight]" })) as any).value,
    ).toEqual([1280, 800]);

    const mobile: any = await router.handle("set_viewport", { tabId, width: 375, height: 667 });
    expect(mobile).toMatchObject({ success: true, emulated: true });
    expect(
      ((await router.handle("evaluate_js", { tabId, expression: "[innerWidth, devicePixelRatio]" })) as any).value,
    ).toEqual([375, 2]);
  });

  it("navigate, go_back and go_forward keep the emulated viewport", async () => {
    const nav: any = await router.handle("navigate", { tabId, url: `${pageUrl}other` });
    expect(nav).toMatchObject({ success: true, tabId, url: `${pageUrl}other`, title: "Other" });
    expect(((await router.handle("evaluate_js", { tabId, expression: "innerWidth" })) as any).value).toBe(375);
    const back: any = await router.handle("go_back", { tabId });
    expect(back).toMatchObject({ success: true, tabId, url: pageUrl });
    expect(["clicked", "Driver Fixture"]).toContain(back.title);
    expect(((await router.handle("evaluate_js", { tabId, expression: "innerWidth" })) as any).value).toBe(375);
    const fwd: any = await router.handle("go_forward", { tabId });
    expect(fwd.url).toBe(`${pageUrl}other`);
    await router.handle("go_back", { tabId });
  });

  it("get_page_screenshot captures the emulated viewport at its device scale", async () => {
    const shot: any = await router.handle("get_page_screenshot", { tabId });
    expect(shot.mimeType).toBe("image/png");
    expect(pngSize(shot.imageData)).toEqual({ width: 750, height: 1334 });
  });

  it("get_page_info, get_ax_tree and read_console return live data", async () => {
    const info: any = await router.handle("get_page_info", { tabId });
    expect(info).toEqual({ url: pageUrl, title: info.title, tabId });
    expect(["clicked", "Driver Fixture"]).toContain(info.title);
    const ax: any = await router.handle("get_ax_tree", { tabId });
    expect(ax.count).toBeGreaterThan(0);
    expect(JSON.stringify(ax.nodes)).toContain("Continue");

    await router.handle("read_console", { tabId });
    await router.handle("evaluate_js", { tabId, expression: "console.warn('driver-smoke-marker')" });
    await new Promise((r) => setTimeout(r, 200));
    const logs: any = await router.handle("read_console", { tabId, pattern: "driver-smoke-marker" });
    expect(logs.entries[0]).toMatchObject({ kind: "console", level: "warn", text: "driver-smoke-marker" });
  });

  it("inject_figma_overlay and clear_figma_overlay run the content script overlay", async () => {
    const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const injected: any = await router.handle("inject_figma_overlay", {
      tabId,
      imageData: pixel,
      width: 375,
      height: 667,
    });
    expect(injected).toMatchObject({ success: true, width: 375, height: 667 });
    expect(
      (
        (await router.handle("evaluate_js", {
          tabId,
          expression: "!!document.getElementById('__figma_overlay__')",
        })) as any
      ).value,
    ).toBe(true);
    expect(await router.handle("clear_figma_overlay", { tabId })).toEqual({ success: true });
    expect(
      (
        (await router.handle("evaluate_js", {
          tabId,
          expression: "!!document.getElementById('__figma_overlay__')",
        })) as any
      ).value,
    ).toBe(false);
  });

  it("answers a command that arrives through the relay with the extension's envelope", async () => {
    const replies: any[] = [];
    let driverSocket: any = null;
    const relay = Bun.serve({
      port: 0,
      fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("no")),
      websocket: {
        message(ws, raw) {
          const data = JSON.parse(String(raw));
          if (data.type === "join") {
            driverSocket = ws;
            ws.send(
              JSON.stringify({ type: "system", message: `Joined channel: ${data.channel}`, channel: data.channel }),
            );
            ws.send(
              JSON.stringify({
                type: "system",
                message: { result: `Connected to channel: ${data.channel}` },
                channel: data.channel,
              }),
            );
          } else replies.push(data);
        },
      },
    });
    const client = createRelayClient({
      relayUrl: `ws://127.0.0.1:${relay.port}`,
      browserId: "smoke",
      browserLabel: "smoke",
      onCommand: (command, params) => router.handle(command, params),
    });
    try {
      await client.start();
      driverSocket.send(
        JSON.stringify({
          type: "broadcast",
          sender: "User",
          channel: "browser",
          message: { id: "r1", command: "evaluate_js", params: { tabId, expression: "6 * 7" } },
        }),
      );
      for (let i = 0; i < 50 && !replies.length; i++) await new Promise((r) => setTimeout(r, 50));
      expect(replies[0]).toEqual({
        id: "r1",
        type: "message",
        channel: "browser",
        message: { id: "r1", result: { tabId, type: "number", value: 42 } },
      });
    } finally {
      client.stop();
      relay.stop(true);
    }
  });

  it("close_tab closes the tab and later commands on it fail", async () => {
    expect(await router.handle("close_tab", { tabId })).toEqual({ success: true, tabId });
    await expect(router.handle("evaluate_js", { tabId, expression: "1" })).rejects.toThrow(/not found/);
  });
});
