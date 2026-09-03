import { z } from "zod";

// Argumentos de línea de comandos
const args = process.argv.slice(2);
const serverArg = args.find((arg) => arg.startsWith("--server="));
const portArg = args.find((arg) => arg.startsWith("--port="));
const reconnectArg = args.find((arg) => arg.startsWith("--reconnect-interval="));
const figmaTokenArg = args.find((arg) => arg.startsWith("--figma-token="));

// When this process is the socket server itself (dist/socket.js), the embedded
// MCP must connect to its own local WS rather than the remote default.
const entry = process.argv[1] ?? "";
const isSocketProcess = entry.endsWith("socket.js") || entry.endsWith("socket.ts") || entry.endsWith("socket.cjs");

// Configuración de conexión extraída de argumentos CLI
export const serverUrl = serverArg ? serverArg.split("=")[1] : "localhost";
export const defaultPort = portArg ? parseInt(portArg.split("=")[1], 10) : 3055;
export const reconnectInterval = reconnectArg ? parseInt(reconnectArg.split("=")[1], 10) : 2000;

// Figma REST API token (from CLI arg or environment variable)
export const figmaAccessToken = figmaTokenArg ? figmaTokenArg.split("=")[1] : process.env.FIGMA_ACCESS_TOKEN || "";

// URL de WebSocket basada en el servidor (WS para localhost, WSS para remoto)
// Allow full override via FIGMA_SOCKET_URL env var (used in Docker)
export const WS_URL = process.env.FIGMA_SOCKET_URL
  ? process.env.FIGMA_SOCKET_URL
  : serverUrl === "localhost"
    ? `ws://${serverUrl}`
    : `wss://${serverUrl}`;

// Figma REST API base URL
export const FIGMA_API_BASE_URL = "https://api.figma.com/v1";

// Configuración del servidor MCP
export const SERVER_CONFIG = {
  name: "FigmaMCP",
  description: "Figma MCP - AI-powered design tool for Figma",
  version: "0.4.0",
};

// Server instructions sent to clients on initialization
export const SERVER_INSTRUCTIONS = `# Figma Channel Resolution (Auto-Discovery)

Before using any Figma tool that requires a channel, you MUST resolve the Figma channel first.

## Override: Explicit Channel ID

If the user provides a channel ID explicitly, use it directly with \`join_channel\`. Skip auto-discovery.

## Step 1: Discover Active Channels

Call \`get_open_channels\` with no parameters.

- **Empty list returned:** Report "No active Figma channels found. Ensure the WebSocket server is running and the Claude MCP Plugin is open in Figma." and stop.

## Step 2: Select Channel

- **1 channel available** → use it automatically, go to Step 3
- **Multiple channels** → ask the user to pick one from the list of file names, then go to Step 3

## Step 3: Join Channel

Call \`join_channel\` with the resolved channel ID.

- If it fails → retry once
- If still fails → report error with troubleshooting steps and stop:
  - Ensure the WebSocket server is running
  - Ensure the Claude MCP Plugin is open in Figma

## Notes

- Channel IDs are resolved dynamically each time via \`get_open_channels\`
- This resolution should happen once per session, not before every tool call

## Name-Based Lookups

Most tools that accept an ID also accept a **name** as an alternative. You do not need to fetch IDs first — just pass the name directly:

- **Variables**: \`bind_variable\` accepts variable name (e.g. \`"background/primary"\`) or ID
- **Styles**: \`set_effect_style_id\`, \`set_color_style_id\`, \`update_effect_style\`, \`delete_effect_style\`, \`update_color_style\`, \`delete_color_style\`, \`get_color_style\` all accept style name (e.g. \`"shadow/md"\`, \`"color/primary"\`) or ID
- **Text styles**: \`apply_text_style\`, \`update_text_style\`, \`delete_text_style\` accept style name or ID
- **Dash normalization**: Names with dashes are automatically converted to slashes (e.g. \`"color-primary"\` → \`"color/primary"\`)

Prefer using names over IDs — they are human-readable and don't require a prior lookup call.

# Browser Tools: Browser (Profile) Targeting

Several Chrome profiles can be connected to the relay at once, each running its own copy of the extension. Commands are routed per browser, so you MUST know which one you are driving:

1. Call \`list_connected_browsers\` FIRST in any browser workflow. It returns each connected browser's \`id\` and \`label\` (auto-generated \`Chrome-<id6>\`, editable in the extension popup).
2. When more than one browser is connected, pass \`browser_id\` to EVERY subsequent browser call (\`browser_*\`, \`get_browser_*\`, \`set_browser_viewport\`, overlay and diff tools). Omitting it makes the relay reject the command as ambiguous ("Multiple browsers are connected: … Pass browser_id to target one.").
3. When exactly one browser is connected, \`browser_id\` may be omitted — the relay delivers to that one browser.
4. Keep the SAME \`browser_id\` for a whole workflow: tab IDs, pinned tabs, viewport emulation, and debugger sessions are per-browser, so mixing ids mid-run targets a different profile's tabs.
5. A stale id (the profile disconnected) fails with \`No browser with id "X" is connected\` — re-run \`list_connected_browsers\` to refresh.

# Browser Tools: Tab Targeting

Browser tools (\`browser_*\`, \`get_browser_*\`, \`set_browser_viewport\`, overlay and diff tools) do NOT require the target tab to be focused or visible — screenshots, input, viewport emulation, and style reads all work on background tabs via the Chrome debugger.

For any multi-step browser workflow (visual QA, design diffing, form automation):

1. Call \`browser_list_tabs\` to find the target tab's ID, or \`browser_create_tab\` to open one (it returns the new tab ID and groups it in the "Videntia" tab group). If the workflow will resize the window (\`set_browser_viewport\` at desktop widths), pass \`new_window: true\` so resizes never disturb the user's own window; close such tabs with \`browser_close_tab\` (they are not part of the agent group).
2. Pass that \`tab_id\` to EVERY subsequent browser call. Never rely on the active-tab fallback — the user may be working in other tabs, and omitting \`tab_id\` routes commands to whichever tab happens to be focused (unless a tab was pinned via the extension popup).
3. The first debugger attach shows Chrome's "is debugging this browser" infobar — the user should leave it open; dismissing it detaches the session.
4. CDP viewport emulation (\`set_browser_viewport\` with mobile widths) persists across \`browser_navigate\`/\`browser_back\`/\`browser_forward\` automatically, but not across user-initiated reloads.
5. Call \`browser_close_group\` for end-of-session cleanup of agent-created tabs.
`;
