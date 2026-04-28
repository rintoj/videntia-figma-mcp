# HGraph Figma MCP

A Model Context Protocol (MCP) server that lets Claude Desktop, Claude Code, Cursor, and other AI tools interact directly with Figma.

```
AI Tool  ↔  MCP Server  ↔  WebSocket Server  ↔  Figma Plugin
```

---

## Setup

### Prerequisites

- [Figma Desktop](https://www.figma.com/downloads/)
- An AI client: [Claude Desktop](https://claude.ai/download), [Claude Code](https://docs.anthropic.com/en/docs/claude-code), or [Cursor](https://cursor.com/downloads)

---

### Step 1 — Install the Figma Plugin

1. Download the latest `hgraph-figma-plugin-vX.Y.Z.zip` from the [Releases](../../releases/latest) page
2. Unzip it anywhere on your computer
3. Open Figma Desktop
4. Go to **Menu → Plugins → Development → Import plugin from manifest...**
5. Select `manifest.json` from the unzipped folder

---

### Step 2 — Configure MCP

#### Claude Code

```bash
claude mcp add hgraph-figma-mcp -- npx -y @hgraph/figma-mcp
```

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hgraph-figma-mcp": {
      "command": "npx",
      "args": ["-y", "@hgraph/figma-mcp"]
    }
  }
}
```

#### Cursor

Go to **Settings → Tools & Integrations → New MCP Server** and add:

```json
{
  "mcpServers": {
    "hgraph-figma-mcp": {
      "command": "npx",
      "args": ["-y", "@hgraph/figma-mcp"]
    }
  }
}
```

#### Replit

Replit Agent connects to MCP servers via a **remote URL** (SSE), not a local command. This requires a hosted HTTP/SSE endpoint of the MCP server.

> **Note:** A hosted SSE endpoint is not yet available. If you need Replit support, please [open an issue](../../issues) — enough demand will prioritise it.

Once a hosted endpoint exists, the setup will be:

1. Go to **Replit → Tools → Integrations → MCP Servers**
2. Click **Add MCP server**
3. Enter name `hgraph-figma-mcp` and the server URL (e.g. `https://figma-mcp.videntia.dev/sse`)
4. Click **Test & Save**

---

### Step 3 — Start the Socket Server

The socket server relays messages between your AI tool and Figma.

**Option A — Hosted (default, no setup needed)**
A server is already running at `figma-mcp.videntia.dev`. The plugin connects to it automatically.

**Option B — Docker (self-hosted)**

```bash
docker compose up -d
```

**Option C — Bun (self-hosted)**

```bash
bun run socket
```

When self-hosting, point the plugin to `localhost` instead:

```bash
# Claude Code
claude mcp add hgraph-figma-mcp -- npx -y @hgraph/figma-mcp --server=localhost
```

---

### Step 4 — Connect to Figma

1. In Figma, run: **Plugins → Development → Figma MCP**
2. The plugin shows a **Channel ID**
3. Ask Claude: _"Connect to Figma channel abc123"_

---

## Local Development

### Requirements

- [Bun](https://bun.sh) runtime

### Install and build

```bash
git clone https://github.com/hgraph/hgraph-figma-mcp.git
cd hgraph-figma-mcp
bun install
bun run build
```

`bun run build` does two things:

1. Regenerates `src/hgraph_figma_plugin/code.js` from TypeScript source (what Figma loads)
2. Builds the MCP server into `dist/` (what Claude connects to)

### Development workflow

```bash
bun run dev          # Watch mode — rebuilds on file changes
bun run socket       # Start local WebSocket server (port 3055)
bun test --watch     # Run tests in watch mode
```

### Point Claude Code at your local build

```bash
claude mcp add hgraph-figma-mcp -s user -- node /absolute/path/to/hgraph-figma-mcp/dist/hgraph_figma_mcp/server.js
```

For Claude Desktop / Cursor, update the config to use `node` instead of `npx`:

```json
{
  "mcpServers": {
    "hgraph-figma-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/hgraph-figma-mcp/dist/hgraph_figma_mcp/server.js"]
    }
  }
}
```

### After making plugin changes

Reload the plugin in Figma (close and reopen from the Plugins menu) to pick up the new `code.js`.

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

Full command reference: see [docs/](docs/)

---

## Project Files

### manifest.json files

This project contains two `manifest.json` files with different purposes:

| File | Purpose |
|------|---------|
| `manifest.json` (root) | **DXT manifest** — packages the MCP server as a Claude Desktop extension (`dxt_version: "0.1"`). Used by `bun run build:dxt`. |
| `src/hgraph_figma_plugin/manifest.json` | **Figma plugin manifest** — tells Figma how to load the plugin (`code.js` + `ui.html`). Import this when installing the plugin in Figma. |

---

## Troubleshooting

| Problem                             | Fix                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Can't connect to WebSocket          | Start the socket server (`bun run socket` or `docker compose up -d`)                                                                     |
| Plugin not found                    | Re-import `src/hgraph_figma_plugin/manifest.json` via Figma → Plugins → Development                                                      |
| MCP not available in Claude Desktop | Restart Claude after editing the config file                                                                                             |
| Font not found                      | Use `load_font_async` to verify font availability                                                                                        |
| `set_image_fill` fails              | Only `images.unsplash.com` and `picsum.photos` are allowed by default; add your domain to `src/hgraph_figma_plugin/manifest.json → networkAccess.allowedDomains` |
| Timeout on complex operations       | Retry; large documents take longer                                                                                                       |

---

## License

MIT — see [LICENSE](LICENSE)
