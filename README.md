# Videntia Figma MCP

![Videntia Figma MCP](docs/banner.jpg)

A Model Context Protocol (MCP) server that lets Claude Desktop, Claude Code, Cursor, and other AI tools interact directly with Figma.

```
AI Tool  ↔  MCP Server  ↔  WebSocket Server  ↔  Figma Plugin
```

---

## Self-Hosted Setup (Local, macOS)

Runs MCP + WebSocket on `localhost:3055` via launchd. No external dependency.

### Prerequisites

- [Bun](https://bun.sh) runtime
- [Figma Desktop](https://www.figma.com/downloads/) (browser Figma cannot load dev plugins)
- Google Chrome (for the browser-connect extension)
- An AI client: [Claude Desktop](https://claude.ai/download), [Claude Code](https://docs.anthropic.com/en/docs/claude-code), or [Cursor](https://cursor.com/downloads)

---

### Step 1 — Clone & Build

```bash
git clone https://github.com/rintoj/videntia-figma-mcp.git
cd videntia-figma-mcp
bun install
bun run build
```

`bun run build` produces:

- `dist/socket.js` — local socket + SSE server (port 3055)
- `src/videntia_figma_plugin/code.js` — Figma plugin runtime

---

### Step 2 — Start the Socket Server via launchd

A plist template ships at `scripts/videntia-figma-mcp.socket.plist` with `$BUN_PATH` and `$PROJECT_PATH` placeholders. Substitute and install:

```bash
export BUN_PATH=$(which bun)
export PROJECT_PATH=$(pwd)
envsubst < scripts/videntia-figma-mcp.socket.plist \
  > ~/Library/LaunchAgents/videntia-figma-mcp.socket.plist
launchctl load -w ~/Library/LaunchAgents/videntia-figma-mcp.socket.plist
```

Verify:

```bash
lsof -iTCP:3055 -sTCP:LISTEN                                                       # bun listening
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3055/sse --max-time 2    # 200
tail -f ~/Library/Logs/videntia-figma-mcp-socket.log                               # runtime logs
```

After future `bun run build` cycles, reload:

```bash
launchctl kickstart -k gui/$(id -u)/videntia-figma-mcp.socket
```

Stop / uninstall:

```bash
launchctl unload ~/Library/LaunchAgents/videntia-figma-mcp.socket.plist
```

> The template's `PATH` targets Apple Silicon Homebrew (`/opt/homebrew/bin`). `$BUN_PATH` is absolute so non-Homebrew Bun installs still work; edit the `PATH` key only if your runtime shells out to other binaries.

---

### Step 3 — Load the Figma Plugin

1. Open **Figma Desktop** (browser Figma cannot load dev plugins).
2. Top menu → **Plugins → Development → Import plugin from manifest...**
3. Select `src/videntia_figma_plugin/manifest.json` from this repo.
4. Run it: **Plugins → Development → Videntia Figma MCP**.
5. In the plugin window, ensure the WebSocket URL is `ws://localhost:3055`, then click **Connect / Join Channel**.
6. The plugin displays a **Channel ID** — Claude auto-discovers it via `get_open_channels`.

After every `bun run build`, close and reopen the plugin so Figma reloads `code.js`.

---

### Step 4 — Load the Chrome Extension

The extension exposes browser DOM/screenshot/console tools and overlays Figma frames on any webpage.

1. Open Chrome → navigate to `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select the `src/chrome_extension/` directory from this repo.
5. Pin **Videntia Browser Connect** from the puzzle-piece menu.
6. Click the extension icon → confirm it targets `http://localhost:3055`. Open any tab to start exposing it to Claude.

After pulling extension changes, hit the **Reload** button on the extension card in `chrome://extensions`.

---

### Step 5 — Configure `.mcp.json`

Create `.mcp.json` at your project root (or any directory where you want the MCP available):

```json
{
  "mcpServers": {
    "videntia-figma": {
      "type": "sse",
      "url": "http://localhost:3055/sse"
    }
  }
}
```

In Claude Code, run `/mcp` → **Reconnect**. Status should flip to `connected` and tools become available.

For **Claude Desktop**, edit `~/Library/Application Support/Claude/claude_desktop_config.json` with the same `mcpServers` block (restart Claude after saving).
For **Cursor**, paste the block into **Settings → Tools & Integrations → New MCP Server**.

---

## Hosted Setup (Alternative)

A managed MCP runs at `https://figma-mcp.videntia.dev/sse` if you do not want to host locally.

```bash
claude mcp add --transport sse videntia-figma-mcp https://figma-mcp.videntia.dev/sse
```

Or `.mcp.json`:

```json
{
  "mcpServers": {
    "videntia-figma": {
      "type": "sse",
      "url": "https://figma-mcp.videntia.dev/sse"
    }
  }
}
```

The Figma plugin then connects to `wss://figma-mcp.videntia.dev` automatically — skip steps 2 and 4 above.

---

## Local Development

Self-Hosted Setup above covers install + build. Common dev commands:

```bash
bun run dev          # Watch mode — rebuilds on file changes
bun run socket       # Run socket server in foreground (alternative to launchd)
bun test --watch     # Run tests in watch mode
```

After plugin or socket changes:

```bash
bun run build && launchctl kickstart -k gui/$(id -u)/videntia-figma-mcp.socket
```

Then close and reopen the plugin in Figma so it reloads `code.js`.

### Tests

```bash
bun test                  # All tests
bun run test:coverage     # Coverage report
bun run test:integration  # Integration tests
```

### Type checking and linting

```bash
bun run lint     # Type-check + format check
bun run format   # Auto-fix formatting
```

---

## Capabilities

| Category      | What you can do                                             |
| ------------- | ----------------------------------------------------------- |
| Document      | Read selections, inspect nodes, export assets, manage pages |
| Creation      | Frames, shapes, text, SVGs, components                      |
| Modification  | Colors, fills, strokes, effects, auto-layout, corner radius |
| Text          | Font, size, weight, spacing, line height, text styles       |
| Components    | Create, instance, variants, properties, overrides           |
| Variables     | Collections, tokens, modes (Light/Dark), color scales       |
| Design system | Spacing, typography, radius, full system initialization     |
| Prototyping   | Reactions, connections, connector styles                    |
| Accessibility | WCAG contrast validation, color audit                       |
| Icons         | Search, create, and update Lucide icons                     |
| Batch         | Execute multiple commands in a single round-trip            |

Full reference: **[docs/tools.md](docs/tools.md)** — all 167 tools with parameters.

JSX output format: **[docs/jsx-syntax-reference.md](docs/jsx-syntax-reference.md)**

---

## Project Files

### manifest.json files

This project contains two `manifest.json` files with different purposes:

| File | Purpose |
|------|---------|
| `manifest.json` (root) | **DXT manifest** — packages the MCP server as a Claude Desktop extension (`dxt_version: "0.1"`). Used by `bun run build:dxt`. |
| `src/videntia_figma_plugin/manifest.json` | **Figma plugin manifest** — tells Figma how to load the plugin (`code.js` + `ui.html`). Import this when installing the plugin in Figma. |

### Documentation

| File | Contents |
|------|---------|
| [`docs/tools.md`](docs/tools.md) | Complete reference for all 167 MCP tools |
| [`docs/jsx-syntax-reference.md`](docs/jsx-syntax-reference.md) | JSX + Tailwind output format used by `get_selection`, `get_node_info`, etc. |

---

## Troubleshooting

| Problem                             | Fix                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Can't connect to WebSocket          | Check launchd: `lsof -iTCP:3055 -sTCP:LISTEN`. Reload: `launchctl kickstart -k gui/$(id -u)/videntia-figma-mcp.socket`. Foreground fallback: `bun run socket` |
| Plugin not found                    | Re-import `src/videntia_figma_plugin/manifest.json` via Figma → Plugins → Development                                                      |
| MCP not available in Claude Desktop | Restart Claude after editing the config file                                                                                             |
| Font not found                      | Use `load_font_async` to verify font availability                                                                                        |
| `set_image_fill` fails              | Only `images.unsplash.com` and `picsum.photos` are allowed by default; add your domain to `src/videntia_figma_plugin/manifest.json → networkAccess.allowedDomains` |
| Timeout on complex operations       | Retry; large documents take longer                                                                                                       |

---

## License

MIT — see [LICENSE](LICENSE)
