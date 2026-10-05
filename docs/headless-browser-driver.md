# Headless browser driver (Chrome for Testing backend)

> **In plain words:** today every browser tool (`browser_*`, `diff_figma_frame_to_page`, the overlay) runs through the Videntia Browser Connect extension inside a person's own Chrome. This doc adds a second way to answer the same commands: a small Node process that drives a pinned **Chrome for Testing** directly over the DevTools Protocol and joins the relay as just another browser. Nothing above the relay changes. The extension stays for hand-run reviews; automated pipelines (the agent-tools factory) use the driver.

Status: in progress · 2026-10-01 — relay `clientType: "driver"` + `kind` and the driver (`src/browser_driver/`, own command router) have landed. Step 1 (shared `commands.js`/adapter extraction from `background.js`) is NOT done: a first attempt broke the MV3 worker (duplicate top-level `const`s across `importScripts` files, stubbed helpers shadowing `cdp.js`) and was reverted. Redo it behind a VM smoke test that loads `background.js` with a mocked `chrome`.

## 1. Why

The Jarvis factory ran waves 1–15 with `/visual-qa` on the owner's primary Chrome through the extension. Findings from that run (agent-tools `docs/factory/improvement-backlog.md`, items 21 and "Outside agent-tools"):

- Only **13 of 69** visual-QA sessions reached a verdict; median 94 tool calls, max 270.
- Failure causes were mostly the browser link, not the comparison:
  - extension not connected although preflight passed;
  - the same Chrome registered twice, so diffs refused with "multiple browsers connected";
  - one shared browser, so a machine-wide lock (`~/.cache/videntia-vqa.lock`) let only one UI review run at a time while up to 4 slots built in parallel.
- Rendering depends on the person's browser: zoom, other extensions, fonts, profile state, Chrome auto-updates.
- Branded Chrome 137+ ignores `--load-extension`, so the extension can't be loaded into a fresh automation browser without switching to Chromium or Chrome for Testing anyway.

What is worth keeping is the **comparison logic**: `data-fig-id` pairing, batched computed-style diff, overlay, viewport sync to Figma frame sizes. That logic lives in the MCP server and in the page-side scripts, not in the extension's transport.

## 2. Goals and non-goals

**Goals**
- Same command set and same results as the extension for every `browser` channel command.
- One isolated browser per pipeline slot, started and stopped by the pipeline, with its own `browser_id`.
- Pinned Chrome version, clean profile, headless by default, deterministic rendering.
- Zero changes to MCP tool definitions, skills or commands that call them.

**Non-goals**
- Replacing the extension. It remains the way a person reviews in their own browser.
- Figma-side changes. The Figma plugin channel is unchanged.
- Remote/cloud browsers (possible later; the driver only needs a CDP endpoint).

## 3. Current architecture (what we build on)

```
MCP tool  ──sendBrowserCommand(cmd, params{browserId})──▶  relay (socket.ts, :3055)
                                                              │  channel "browser", routed by browserId
                                                              ▼
                                         extension background.js  switch(cmd)
                                           ├─ content.js   (DOM, computed styles, rects, overlay)
                                           ├─ cdp.js       (chrome.debugger: viewport, input, eval, console, network, intercept)
                                           └─ chrome.tabs / scripting / windows / storage
```

- `tools/browser-channel.ts`: `sendBrowserCommand` is a thin pass-through; routing policy lives in the relay.
- `socket.ts` / `socket-browser-registry.ts`: a client that joins with `{ type: "join", channel: "browser", clientType: "extension", browserId, browserLabel }` becomes a routable browser. Messages carry an optional `target` (the `browserId`).
- `chrome_extension/background.js` (877 lines) dispatches ~36 commands: `list_tabs`, `create_tab`, `close_tab`, `close_group`, `get_dom_nodes`, `get_computed_styles`, `get_computed_styles_batch`, `resolve_selector_at_point`, `collect_all_element_rects`, `inject_figma_overlay`, `clear_figma_overlay`, `get_page_screenshot`, `set_viewport`, `reset_viewport`, `emulate`, `clear_emulation`, `get_page_info`, `click`, `hover`, `scroll`, `type_text`, `press_key`, `evaluate_js`, `navigate`, `go_back`, `go_forward`, `read_console`, `read_network`, `get_ax_tree`, `highlight_node`, `clear_highlight`, `intercept_start`, `intercept_stop`, `list_pending_requests`, `fulfill_request`, `fail_request`, `continue_request`, `clear_storage`, `capture_mhtml`.
- `content.js` (503 lines) does page-side work, reached through `chrome.runtime.onMessage` (line 469).
- `cdp.js` (909 lines) already speaks CDP through `chrome.debugger.sendCommand`; state is kept in `chrome.storage.session`.

## 4. Design

### 4.1 Shape

A new package `src/browser_driver/` (Node/Bun, TypeScript) producing a CLI `videntia-browser-driver`:

```
videntia-browser-driver
  ├─ relay client     joins the relay as a browser peer (same join message)
  ├─ chrome launcher  starts Chrome for Testing (or attaches to --cdp-url)
  ├─ command router   same switch as background.js, same params and result shapes
  ├─ page runtime     content.js injected into every page
  └─ cdp core         cdp.js logic with the transport swapped to a puppeteer-core CDPSession
```

```
MCP tool ──▶ relay ──┬──▶ extension (person's Chrome)        browserId "chrome-ab12…"
                     └──▶ browser-driver ──CDP──▶ Chrome for Testing (slot 3)  browserId "cft-slot-3"
```

### 4.2 Relay join

The driver sends the same join message. Two options:

1. `clientType: "extension"`: no relay change; the driver is indistinguishable.
2. **Recommended:** `clientType: "driver"` and teach `socket.ts` (lines 171–278) to treat `"extension" | "driver"` as browser peers. `list_connected_browsers` then shows `kind: "driver"` so callers and preflight can tell them apart, and the relay can apply driver-specific policy (e.g. no "multiple browsers" ambiguity error when a `target` is given).

`browserId` is set by the caller (`--id cft-slot-3`), stable for the driver's lifetime. `browserLabel` = `Chrome for Testing <version> · <id>`.

### 4.3 Command mapping

| Extension mechanism | Driver mechanism |
|---|---|
| `chrome.tabs.create/remove/query/get/update` | `Target.createTarget` / `closeTarget` / `getTargets`; tab id = target id (map to small integers if callers assume numbers) |
| `chrome.tabGroups`, `tabs.group`, `close_group` | in-memory group set; `close_group` closes its targets |
| `chrome.windows.*` | no-op (one window per browser) |
| `chrome.tabs.captureVisibleTab` | `Page.captureScreenshot`; full page with `captureBeyondViewport: true` |
| `chrome.scripting.executeScript` + `content.js` | `content.js` injected with `Page.addScriptToEvaluateOnNewDocument` and on existing pages with `Runtime.evaluate`; commands called through `Runtime.callFunctionOn` (see 4.4) |
| `cdp.js` via `chrome.debugger.sendCommand` | same module, transport replaced by `CDPSession.send`; debugger attach/detach becomes session create/close |
| `chrome.storage.session` (attach/emulation state) | in-memory map per target |
| `navigate` / `go_back` / `go_forward` | `Page.navigate` + wait for `Page.loadEventFired`; `Page.navigateToHistoryEntry`; re-apply viewport emulation after navigation (same as extension) |
| `set_viewport` / `emulate` | `Emulation.setDeviceMetricsOverride`, `setUserAgentOverride`, `setEmulatedMedia` |
| `click` / `hover` / `type_text` / `press_key` / `scroll` | `Input.dispatchMouseEvent` / `dispatchKeyEvent` / `insertText` (already in `cdp.js`) |
| `read_console` / `read_network` | `Runtime.consoleAPICalled`, `Log.entryAdded`, `Network.*` buffers (already in `cdp.js`) |
| `intercept_*`, `fulfill/fail/continue_request` | `Fetch.enable` / `fulfillRequest` / `failRequest` / `continueRequest` (already in `cdp.js`) |
| `get_ax_tree` | `Accessibility.getFullAXTree` |
| `capture_mhtml` | `Page.captureSnapshot { format: "mhtml" }` |
| `clear_storage` | `Storage.clearDataForOrigin` |

### 4.4 Sharing code with the extension

Results must match between backends, so page-side and CDP logic is shared, not rewritten:

- **`content.js`**: refactor into a pure module `page-runtime.js` exposing `handle(msg) → result`. The extension keeps a thin `chrome.runtime.onMessage` wrapper; the driver injects the module and calls `window.__videntia.handle(msg)` through `Runtime.callFunctionOn`.
- **`cdp.js`**: parameterise the transport: `createCdp({ send(method, params), on(event, fn), state })`. The extension passes a `chrome.debugger` adapter and `chrome.storage.session` state; the driver passes a `CDPSession` and an in-memory store. `cdp.js` already exports pure helpers for tests, so this is an extraction, not a rewrite.
- **`background.js` switch**: extract the command table into `commands.js` with an adapter interface (`tabs`, `scripting`, `screenshot`, `cdp`). Both backends implement the adapter.

Result: one command table, one page runtime, one CDP core, two adapters.

### 4.5 Chrome launcher

- Binary: Chrome for Testing installed with `npx @puppeteer/browsers install chrome@<pinned>` into `~/.cache/videntia/chrome/<version>`; version pinned in the driver's config. `--executable` overrides it (e.g. Chromium).
- Flags: `--headless=new`, `--user-data-dir=<temp per instance>`, `--remote-debugging-port=0` (read the port from stderr), `--hide-scrollbars`, `--force-device-scale-factor=1` (overridden per viewport), `--font-render-hinting=none`, `--disable-gpu-vsync`, `--disable-background-timer-throttling`, `--disable-renderer-backgrounding`, `--no-first-run`, `--no-default-browser-check`.
- Animations: optional `--reduce-motion` sets `Emulation.setEmulatedMedia({ features: [{ name: "prefers-reduced-motion", value: "reduce" }] })` for stable diffs.
- Fonts: document that diffs need the project's web fonts loaded (wait for `document.fonts.ready` before screenshots and style reads, as the extension should too).
- `--headful` for debugging; `--cdp-url` to attach to an already running browser instead of launching.
- Lifecycle: the driver owns the browser; on exit (SIGINT/SIGTERM/relay loss beyond retry) it closes Chrome and removes the temp profile.

### 4.6 CLI

```
videntia-browser-driver start --id cft-slot-3 [--relay ws://localhost:3055] [--headful]
                              [--executable <path>] [--chrome-version <v>] [--cdp-url <url>]
                              [--reduce-motion] [--idle-timeout 30m]
videntia-browser-driver stop  --id cft-slot-3
videntia-browser-driver list
```

- Writes a pid/state file in `~/.cache/videntia/drivers/<id>.json` (pid, CDP port, relay status) so `stop`/`list` work across processes.
- Reconnects to the relay with backoff; exits non-zero after N failed attempts so a supervisor sees it.
- `--idle-timeout` shuts down after no commands for the given time.

## 5. Use from agent-tools (factory)

- **Dispatcher:** for each UI task slot, run `videntia-browser-driver start --id cft-slot-<N>` before the review and `stop` on teardown; pass `FACTORY_BROWSER_ID=cft-slot-<N>` to the run.
- **`/visual-qa`:** in factory mode, use `FACTORY_BROWSER_ID` (a driver) and drop the machine-wide `videntia-vqa.lock`; the primary-Chrome path stays for non-factory runs. The current "fallback (owner-configured only)" section becomes the default for factory mode.
- **`/factory-preflight --ui`:** `list_connected_browsers` must show the slot's driver with `kind: "driver"`, plus a smoke command (`create_tab about:blank` → `evaluate_js 1+1` → `close_tab`).
- **Skills unchanged:** `screen-build`, `make-responsive`, `design-validate`, `browser`, `review-screen` keep calling the same tools; they just get a driver `browser_id` when run by the factory.

## 6. Testing

- Run the existing integration suites (`tests/integration/diff-figma-to-browser.test.ts`, `frame-style-diff.test.ts`, `comparison-tools.test.ts`, `browser-id-routing.test.ts`) against both backends via a backend matrix.
- **Parity test:** for a fixed fixture page and Figma frame, `diff_figma_frame_to_page` results from the extension (Chromium with the extension loaded) and the driver must match within tolerance (positions ±1 px, colors exact, font metrics exact).
- Unit tests for the adapter layer (tab id mapping, emulation re-apply after navigate, intercept flow).
- Concurrency: 4 drivers, 4 parallel visual-QA runs, no cross-talk.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Headless rendering differs from headful (fonts, scrollbars, DPR) | `--headless=new` (same renderer), fixed flags (4.5), wait for fonts; parity test sets tolerances once |
| Callers assume numeric tab ids | map target ids to integers in the driver |
| Relay ambiguity rules assume one person's browsers | `clientType: "driver"`; explicit `target` always routes; preflight fails on unknown ids |
| Memory with 4 browsers + 4 stacks on a 24 GB Mac | headless, one tab per run, `--idle-timeout`, stop on teardown |
| Refactoring `content.js`/`cdp.js` breaks the extension | extraction behind adapters with existing extension tests run before and after |
| Chrome for Testing version drift | pinned version in config; bump deliberately and re-run the parity test |

## 8. Plan

1. **Extract** `commands.js`, `page-runtime.js` and the transport-agnostic `cdp.js` from the extension; extension behaviour unchanged (existing tests green).
2. **Relay:** accept `clientType: "driver"`; expose `kind` in `list_connected_browsers`.
3. **Driver:** launcher, relay client, adapter, CLI (`start`/`stop`/`list`).
4. **Parity and integration tests** across both backends.
5. **agent-tools:** dispatcher starts/stops a driver per UI slot; `/visual-qa` factory mode uses it and drops the global lock; preflight checks it.

Rough size: driver 600–900 lines plus the extraction; 1–2 days of work, most of it in steps 1 and 4.

## 9. Open questions

- `clientType: "driver"` vs reusing `"extension"`: recommended `"driver"`.
- Chromium vs Chrome for Testing as the default binary (Chromium has no testing banner, irrelevant headless; Chrome for Testing has versioned, reproducible downloads): recommended Chrome for Testing.
- Should the driver also be usable by `chrome-devtools-mcp` for flow tests (same browser for flow and visual QA), or keep them separate? Recommended: separate for now.
