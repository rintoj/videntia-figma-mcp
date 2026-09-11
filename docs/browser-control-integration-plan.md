# Browser Control Integration Plan

> **Status (2026-07-18):** Phases 1–4 implemented on `feat/browser-control` (plus
> full-page screenshots and dialog auto-handling from Phase 5). Remaining Phase 5
> items: dedicated per-channel sockets, handshake auth token, origin allowlist.

Goal: give Claude Code full Chrome control (click, type, navigate, console, network, tabs, screenshots) through the **Videntia Browser Connect** extension, replicating what the official Claude-in-Chrome extension does — without needing Anthropic's extension installed.

## Part 1 — How Claude-in-Chrome actually works (investigation findings)

### Architecture (local path)

```
Claude Code CLI (mcp__claude-in-chrome__* tools, in-process MCP server)
        │
        │  Chrome native messaging (stdio, 4-byte LE length prefix + JSON)
        ▼
claude --chrome-native-host          ← Chrome spawns this via a 174-byte shell
(same CLI binary, special flag)         wrapper at ~/.claude/chrome/chrome-native-host
        ▲
        │  chrome.runtime.connectNative("com.anthropic.claude_code_browser_extension")
        │
Extension service worker (MV3, id fcoeoabgfenejglbffodgkkbkcdhcgfn)
        │
        │  chrome.debugger (CDP 1.3) + chrome.scripting.executeScript
        ▼
Web page / tab
```

- **Transport**: Chrome **native messaging**, not a local socket. The host manifest at
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_code_browser_extension.json`
  points at a wrapper that `exec`s the Claude CLI with `--chrome-native-host`. Chrome
  launches that process when the extension calls `connectNative`.
- **Handshake**: extension probes hosts (Desktop first, then Claude Code) with
  `{type:"ping"}` → `{type:"pong"}` (10s timeout), then `{type:"get_status"}`.
- **Protocol**: host pushes `{type:"tool_request", method:"execute_tool", params:{tool, client_id, args:{tabGroupId,…}}}`;
  extension replies `{type:"tool_response", result:{content}}` or `{…, error}`.
- **Auth**: no per-message token locally. Security = Chrome's `allowed_origins`
  allowlist (only the Anthropic extension ID may spawn the host) + the host being a
  locally installed signed binary.
- **Cloud path** (claude.ai web/mobile, no CLI): extension dials
  `wss://bridge.claudeusercontent.com` with OAuth2 PKCE (`chrome.identity.launchWebAuthFlow`)
  and a persisted `device_id` (stored in `~/.claude.json` → `chromeExtension.pairedDeviceId`).
  Same tool executor handles both transports.

### How operations are executed (the part worth copying)

Everything funnels into one executor using two mechanisms:

**A. `chrome.debugger` + CDP 1.3** (`chrome.debugger.sendCommand`):

| Capability | CDP command |
|---|---|
| Screenshot | `Page.captureScreenshot` (JPEG, adaptive quality 0.75→0.1, base64 size cap ~1.4M chars) |
| Click / mouse / scroll | `Input.dispatchMouseEvent` (incl. `mouseWheel`) |
| Keyboard / typing | `Input.dispatchKeyEvent`, `Input.insertText` |
| JS eval / DOM read | `Runtime.evaluate` (`returnByValue`, `awaitPromise`, `replMode`, 45s timeout) |
| Console capture | `Runtime.enable` + console events, buffered per tab |
| Network capture | `Network.enable {maxPostDataSize:65536}`, per-tab buffer, URL-substring filter |
| Dialogs / lifecycle | `Page.enable`, `Page.handleJavaScriptDialog`, `Page.frameNavigated`, beforeunload waiters |

**B. `chrome.scripting.executeScript`** — accessibility-tree extraction and DOM helpers
that don't need the debugger banner; the accessibility tree drives element targeting.

Manifest essentials: `debugger, scripting, tabs, tabGroups, activeTab, storage, alarms,
webNavigation, nativeMessaging` + `<all_urls>` host permissions. Debugger attach is
deduplicated and detached cleanly.

## Part 2 — Where Videntia stands today

Extension: `src/chrome_extension/` (MV3, no bundler). Already working:

- **Transport**: persistent WebSocket to the relay (`src/socket.ts`, port 3055),
  channel `"browser"`, `clientType:"extension"` tag, 3s reconnect + `chrome.alarms`
  keep-alive, badge state.
- **Protocol**: `{id, command, params}` request → `{id, result|error}` response,
  matched in `utils/websocket.ts` `pendingRequests`; MCP tools call
  `sendCommandToChannel("browser", …)`.
- **Capabilities (read-only)**: CDP screenshot (`Page.captureScreenshot` with
  `captureVisibleTab` fallback), DOM serialization, computed styles (batched),
  selector resolution (`buildStableSelector`), Figma overlay injection, viewport
  emulation (`Emulation.setDeviceMetricsOverride`).
- **Tab targeting**: explicit `tabId` → pinned tab (popup) → active tab.
- **Permissions already granted**: `debugger, scripting, tabs, windows, storage,
  alarms, activeTab` + `<all_urls>` — nothing new needed in the manifest except
  possibly `webNavigation`.

**Missing**: click, type, hover, scroll, key press, navigate, JS eval, console capture,
network capture, tab create/close/list, full-page screenshot, dialog handling.

## Part 3 — Integration plan

### Decision: keep the WebSocket transport (don't adopt native messaging)

Native messaging is how Anthropic solved "Chrome must launch a trusted local process
with zero config." Videntia already has an equivalent, working trusted channel: the
launchd-managed socket server on 3055 that the extension dials out to. Switching to
native messaging would add install complexity (host manifest registration, wrapper
binary, per-browser manifests) for no capability gain — **all capabilities come from
CDP inside the extension, which is transport-agnostic**. What we replicate is the
executor layer, not the transport.

Optional hardening later (Phase 5): a shared-secret token on the `join` handshake,
mirroring the spirit of `allowed_origins`.

### Phase 1 — Interaction primitives (extension: `background.js`)

New commands handled in the service worker via a shared CDP session manager:

- `browser_click` — `Input.dispatchMouseEvent` (mousePressed/mouseReleased at x,y;
  accept either coordinates or a `selector` resolved via content script → rect center).
- `browser_type` — `Input.insertText` for text; `Input.dispatchKeyEvent` for special
  keys (Enter, Tab, Escape, arrows) with a key-name → keycode map.
- `browser_hover` / `browser_scroll` — `Input.dispatchMouseEvent` (mouseMoved /
  mouseWheel with deltaX/Y).
- `browser_press_key` — modifier-aware `Input.dispatchKeyEvent`.
- `browser_evaluate_js` — `Runtime.evaluate` with `returnByValue:true`,
  `awaitPromise:true`, timeout, and result-size cap.

Refactor: extract a `cdp.js` module (importScripts) with `attach(tabId)`,
`send(tabId, method, params)`, `detach(tabId)` — reusing the existing
`attachedDebuggerTabs` session tracking so emulation + input share one attach.

### Phase 2 — Navigation & tab management

- `browser_navigate` — `chrome.tabs.update({url})` + wait for
  `chrome.tabs.onUpdated` status `complete` (with timeout); **re-apply viewport
  emulation after navigation** (known CDP reset, already noted in
  `browser-tools.ts:217`).
- `browser_go_back` / `browser_go_forward` — `chrome.tabs.goBack/goForward`.
- `browser_list_tabs` — `chrome.tabs.query({})` → id/url/title/active/pinned.
- `browser_create_tab` / `browser_close_tab` — `chrome.tabs.create/remove`.
- Fix the existing gap: `get_page_info` claims tab discovery but returns one tab —
  point it at `browser_list_tabs`.

### Phase 3 — Observability (console + network)

Persistent per-tab ring buffers in the service worker (session storage or in-memory
with size caps):

- On first attach per tab: `Runtime.enable`, `Log.enable`, `Network.enable
  {maxPostDataSize:65536}`.
- `chrome.debugger.onEvent` listener buffers `Runtime.consoleAPICalled`,
  `Runtime.exceptionThrown`, `Log.entryAdded`, `Network.requestWillBeSent`,
  `Network.responseReceived`, `Network.loadingFailed`.
- Commands: `browser_read_console {tabId, pattern?, clear?}` and
  `browser_read_network {tabId, urlFilter?, clear?}` — filter server-side in the
  extension so large buffers never cross the wire.
- Cap: ~500 console entries / ~300 requests per tab, cleared on navigation commit
  (configurable `preserve` flag).

### Phase 4 — MCP tool surface (`src/videntia_figma_mcp/tools/browser-tools.ts`)

Register new tools mirroring the wire commands (Zod schemas, `tab_id` optional with
pinned/active fallback):

`browser_click`, `browser_type`, `browser_press_key`, `browser_scroll`,
`browser_hover`, `browser_navigate`, `browser_back`, `browser_forward`,
`browser_list_tabs`, `browser_create_tab`, `browser_close_tab`,
`browser_evaluate_js`, `browser_read_console`, `browser_read_network`.

Plumbing checklist per tool (per project guide):
1. Tool in `browser-tools.ts` → `sendCommandToChannel("browser", …)`.
2. Handler in `background.js` `handleBrowserCommand`.
3. `BrowserCommand` union in `types/index.ts:196`.
4. `ALLOWED_COMMANDS` in `src/videntia_figma_plugin/ui/constants.ts` — **N/A for
   browser commands** (that allowlist gates the Figma plugin UI); verify browser
   channel has no equivalent gate, add one if Phase 5 lands.
5. Read-only classification: `browser_list_tabs`, `browser_read_console`,
   `browser_read_network` are read-only; interaction tools are not.
6. Integration tests (mock `sendCommandToChannel`) + unit tests for key-map and
   buffer filtering.

### Phase 5 — Robustness & security (follow-up)

- **Channel churn fix**: the shared MCP socket ping-pongs between the Figma channel
  and `"browser"` (`websocket.ts:365-389, 528-539`). With interactive flows this
  rejoin dance will be hit constantly — move to **two dedicated sockets** (one per
  channel) or teach the relay multi-channel membership.
- **Full-page screenshot**: `captureBeyondViewport:true` variant + adaptive JPEG
  quality like Anthropic's (0.75→0.1 under a base64 size cap).
- **Dialog safety**: `Page.enable` + auto-report (or auto-dismiss policy) for
  `Page.javascriptDialogOpening` so an alert can't wedge the session.
- **Handshake auth**: optional shared token in the `join` message, checked by
  `socket.ts` for `clientType:"extension"` (config via extension popup).
- **Permission gating** (mirrors Claude's site-gating): optional per-origin allowlist
  in extension storage; interaction commands refused on non-allowlisted origins.

### Suggested order & effort

| Phase | Scope | Est. |
|---|---|---|
| 1 | CDP input primitives + `cdp.js` refactor | 1 day |
| 2 | Navigation + tabs | 0.5 day |
| 3 | Console + network buffers | 1 day |
| 4 | MCP tools + types + tests | 1 day |
| 5 | Channel-churn fix, security, polish | 1–2 days |

## Unresolved questions

1. **Element targeting**: coordinates-only (Claude's model: screenshot → click x,y),
   selector-based (`browser_click {selector}` resolved via content script), or both?
   Recommend **both** — selector-first is more reliable for `data-fig-id` workflows.
2. **Channel churn fix timing**: do it upfront (Phase 0) or after capabilities land?
   Interactive sequences will stress the rejoin logic immediately — recommend early.
3. **Origin allowlist**: needed, or is this a personal/dev tool where `<all_urls>`
   control is acceptable?
4. **Accessibility-tree reader** (Claude's `read_page` equivalent): worth adding as a
   Phase 3.5 (`chrome.scripting` based), or is the existing `get_dom_nodes` enough?
