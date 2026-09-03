# Browser Control Tools

The Videntia Browser Connect extension (`src/chrome_extension/`, v1.2.0) exposes full
Chrome control to MCP. Commands travel over the WebSocket relay on the `"browser"`
channel and execute via `chrome.debugger` (CDP 1.3) — input events are real trusted
events, so clicks and typing work with React/Vue controlled inputs, hover styles, and
anything else that ignores synthetic events.

## Architecture

```
MCP Server ──ws──▶ Socket relay ──ws──▶ background.js (service worker)
                                          ├─ cdp.js      CDP session manager
                                          └─ content.js  DOM inspection commands
```

- **`src/videntia_figma_mcp/tools/browser-control-tools.ts`** — MCP tool definitions
  (all prefixed `browser_*`, plus `list_connected_browsers`).
- **`src/videntia_figma_mcp/tools/browser-channel.ts`** — the shared browser surface:
  `BROWSER_CHANNEL`, `browserIdSchema`, `tabIdSchema`, `listConnectedBrowsers()`, and
  `sendBrowserCommand()` (the single entry point every browser tool sends through).
- **`src/chrome_extension/background.js`** — WebSocket client + command dispatcher.
  Tab-independent commands (`list_tabs`, `create_tab`, `close_tab`, `close_group`)
  run directly; everything else resolves a target tab first.
- **`src/chrome_extension/cdp.js`** — Chrome DevTools Protocol session manager.
  Owns debugger attach/detach state, viewport emulation, input dispatch, JS
  evaluation, and per-tab console/network capture buffers. Pure helpers are
  exported via `module.exports` for unit tests (`tests/unit/chrome-extension/cdp.test.ts`).

### Multi-profile targeting (`browser_id`)

Several Chrome profiles can be connected at once — each runs its own copy of the
unpacked extension and registers as a separate browser on the `"browser"` channel with
its own **`browserId`**. Every browser tool therefore accepts an optional `browser_id`
that selects which one executes the command.

Routing lives in the relay, not in the MCP layer. `browser_id` travels as an
envelope-level `target` sibling of `channel` — never inside `message.params`, so the
extension's command handler never sees it:

```json
{ "id": "<uuid>", "type": "message", "channel": "browser", "target": "<browserId>",
  "message": { "id": "<uuid>", "command": "click", "params": { "commandId": "<uuid>" } } }
```

With no `browser_id` the envelope carries no `target` key at all, exactly as before.
The relay then decides:

| Situation | Outcome |
|---|---|
| `target` set, matching browser connected | delivered to that browser only |
| `target` set, unknown/stale | error: `No browser with id "X" is connected. Connected: <list>` |
| no `target`, exactly 1 browser | delivered normally (unchanged single-profile behaviour) |
| no `target`, 2+ browsers | error: `Multiple browsers are connected: <list>. Pass browser_id to target one.` |
| no `target`, channel also holds a Figma plugin | broadcast — a plugin-bearing channel is a Figma channel and is never routed |

Both errors surface verbatim as a failed tool call.

**`"browser"` is a reserved channel name.** The plugin derives its channel from a slug of
the Figma file name, so a file called "Browser" would otherwise land on the very channel
the extension hardcodes. A shared channel is unroutable in both directions: the plugin
answers a browser command with `Command not permitted` under the *same* message id
(usually beating the extension's real reply), and untargeted Figma traffic is either
routed to the extension or duplicated across every connected browser. The relay therefore
moves any Figma-plugin join on `"browser"` to `"browser-figma"` (further collisions get
the usual `-2`, `-3` suffixes), and the plugin adopts the server-assigned name. The
plugin-bearing-channel broadcast rule above remains as a backstop.

**Labels.** Each browser gets an auto-generated label `Chrome-<first 6 chars of its id>`,
editable in the extension popup so profiles are recognizable ("Work", "Personal").

**Workflow.** Call `list_connected_browsers` first; if it reports more than one browser,
pin one `browser_id` and pass the SAME id to every browser call for the whole run —
tab IDs, pinned tabs, viewport emulation, and debugger sessions are all per-browser.
`diff_figma_to_browser` and `diff_figma_frame_to_page` issue many browser commands per
invocation and thread their `browser_id` through all of them, so one invocation always
stays on one profile.

### Deploying a multi-profile upgrade

The Chrome extension ships **unpacked** and is outside every build step, so upgrading is
a two-part operation:

```bash
bun run build && launchctl kickstart -k gui/$(id -u)/com.videntia.figma-socket
```

then **reload the unpacked extension in every profile** (chrome://extensions → Reload).
Skipping either half fails quietly rather than loudly: an out-of-date relay ignores the
`target` field and broadcasts to every connected browser, and an out-of-date extension
never registers a `browserId` for the relay to route to.

### Target tab resolution

Every tab-scoped command resolves its target in priority order:

1. **Explicit `tab_id`** from the caller.
2. **Pinned tab** — set via the extension popup, stored in `chrome.storage.session`.
   Prevents commands from leaking onto whichever tab happens to be focused.
3. **Active tab** of the focused window.

`browser_close_tab` is the exception: it *requires* an explicit `tab_id` — there is
deliberately no implicit fallback to the active tab.

### Debugger session lifecycle

- Attach state lives in `chrome.storage.session` so viewport emulation survives
  service-worker restarts; console/network buffers are in-memory (the WebSocket
  keep-alive keeps the worker resident while a session is active).
- The session is **shared**: one-shot operations (screenshots) detach afterwards
  only when no emulation or monitoring needs the attachment to persist.
- If the user cancels the debugger infobar, the extension cleans up its attach
  state automatically via `chrome.debugger.onDetach`.

### Agent tab group

Tabs created by `browser_create_tab` are collected into a purple **"Videntia"**
Chrome tab group (created on first use, requires the new `tabGroups` permission) so
agent-driven tabs stay visually separated from the user's own tabs. Opt out per tab
with `grouped: false`. `browser_close_group` closes the whole group in one shot for
end-of-session cleanup (no-op when no group exists).

## Interaction tools

Click/hover/type/scroll target elements by CSS selector (automatically scrolled into
view; stable selectors prefer `data-fig-id`, then `data-testid`) **or** by viewport
`x`/`y` coordinates. Input is dispatched with CDP `Input.*` events.

| Tool | Description | Parameters |
|------|-------------|------------|
| `browser_click` | Click an element or point (real trusted click) | `selector` or `x`+`y`, `button`, `click_count`, `tab_id`, `browser_id` |
| `browser_hover` | Move the mouse over an element/point — triggers `:hover`, tooltips, dropdowns | `selector` or `x`+`y`, `tab_id`, `browser_id` |
| `browser_type` | Type text (works with controlled inputs). `selector` focuses the element first; `clear_first` replaces its current value; without `selector`, types into the focused element | `text`, `selector`, `clear_first`, `tab_id`, `browser_id` |
| `browser_press_key` | Press a key with optional modifiers — Enter, Tab, Escape, arrows, `ctrl+a`, `meta+r`, … | `key`, `modifiers` (`alt`/`ctrl`/`meta`/`shift`), `tab_id`, `browser_id` |
| `browser_scroll` | Scroll by pixel delta via mouse-wheel event (positive `delta_y` = down). Pass `selector` or `x`/`y` to scroll inner containers | `delta_y`, `delta_x`, `selector`, `x`, `y`, `tab_id`, `browser_id` |
| `browser_evaluate_js` | Evaluate a JS expression in page context via `Runtime.evaluate` — awaits promises, returns by value, results capped at 100 KB | `expression`, `timeout_ms` (default 15000), `tab_id`, `browser_id` |

## Navigation & tab tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `browser_navigate` | Navigate to a URL and wait for load. Only http(s) and `about:blank` allowed; scheme defaults to `https://`. Viewport emulation is re-applied after the load | `url`, `tab_id`, `browser_id` |
| `browser_back` | Go back one history entry, wait for load to settle | `tab_id`, `browser_id` |
| `browser_forward` | Go forward one history entry, wait for load to settle | `tab_id`, `browser_id` |
| `browser_list_tabs` | List all open tabs — ID, URL, title, active state, pinned-for-session flag, agent-group membership | `browser_id` |
| `browser_create_tab` | Open a new tab (default `about:blank`), added to the "Videntia" agent group; `new_window` opens a dedicated window instead so viewport resizes never disturb the user's window. Returns the tab ID and window ID | `url`, `active` (default true), `grouped` (default true), `new_window` (default false), `browser_id` |
| `browser_close_tab` | Close a tab — explicit `tab_id` required | `tab_id`, `browser_id` |
| `browser_close_group` | Close the entire "Videntia" agent tab group | `browser_id` |
| `list_connected_browsers` | List every connected browser (Chrome profile) — `id`, `label`, `joinedAt` — so a workflow can pick one. Returns an empty list plus a hint when none are connected | — |

## Observability tools

Per-tab ring buffers are captured via the `Runtime`, `Log`, and `Network` CDP
domains. The **first call on a tab starts monitoring**.

| Tool | Description | Parameters |
|------|-------------|------------|
| `browser_read_console` | Read buffered console messages, uncaught exceptions, and auto-handled dialogs. Buffer: last 500 entries, **resets on navigation**; recent messages are usually backfilled on the first call | `pattern` (regex), `level` (`log`/`info`/`warn`/`error`/`debug`), `limit` (default 200), `clear`, `tab_id`, `browser_id` |
| `browser_read_network` | Read buffered requests — URL, method, resource type, status, MIME type, failures. Buffer: last 300 requests, **persists across navigations**; only requests made after monitoring starts are captured | `url_filter` (substring), `limit` (default 200), `clear`, `tab_id`, `browser_id` |

**JavaScript dialogs are auto-handled** — `beforeunload` prompts are accepted,
alerts/confirms/prompts are dismissed — and each handled dialog is logged into the
console buffer, so the agent never deadlocks on a modal.

## Viewport & screenshots (browser-tools.ts additions)

| Tool | Description | Parameters |
|------|-------------|------------|
| `set_browser_viewport` | Set viewport size. Widths below Chrome's ~500 px window minimum (or `force_emulation: true`) use CDP device emulation (`Emulation.setDeviceMetricsOverride` + touch) — a true mobile viewport like DevTools device mode. Larger sizes resize the OS window. Emulation resets on navigation, but `browser_navigate` re-applies it automatically | `width`, `height`, `device_scale_factor` (default 2), `force_emulation`, `tab_id`, `browser_id` |
| `reset_browser_viewport` | Clear CDP viewport emulation and detach the debugger from the tab | `tab_id`, `browser_id` |
| `get_browser_page_screenshot` | Now accepts `full_page: true` to capture the entire scrollable page beyond the viewport. Works on non-focused tabs (debugger-based capture) | `full_page`, `tab_id`, `browser_id` |

## Extension permission changes (v1.2.0)

`manifest.json` adds the `tabGroups` permission (agent tab group) alongside the
existing `activeTab`, `scripting`, `windows`, `tabs`, `alarms`, `debugger`, `storage`.

## Command wire protocol

MCP tool names map to `BrowserCommand` values (`src/videntia_figma_mcp/types/index.ts`)
dispatched on the `"browser"` channel: `click`, `hover`, `scroll`, `type_text`,
`press_key`, `evaluate_js`, `navigate`, `go_back`, `go_forward`, `list_tabs`,
`create_tab`, `close_tab`, `close_group`, `read_console`, `read_network`,
`set_viewport`, `reset_viewport`, plus the batched style reader
`get_computed_styles_batch` used by the diff tooling
(see [figma-browser-diff.md](figma-browser-diff.md)).

## Error handling

- Content-script commands on restricted URLs (`chrome://`, `file://`) fail with a
  descriptive "Content script unavailable" error suggesting a reload/navigation.
- `browser_evaluate_js` results are capped at 100 KB and normalized (promises
  awaited, remote objects previewed).
