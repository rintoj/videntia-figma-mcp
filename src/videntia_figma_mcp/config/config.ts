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
export const SERVER_INSTRUCTIONS = `# Figma channel (resolve once per session)
1. User gave a channel id: \`join_channel\` with it, skip discovery.
2. Else \`get_open_channels\`. Empty: report "No active Figma channels found. Ensure the WebSocket server is running and the Claude MCP Plugin is open in Figma." and stop. One: use it. Several: ask the user to pick by file name.
3. \`join_channel\`; on failure retry once, then report (socket server running? plugin open in Figma?) and stop.
4. Every Figma tool takes \`channel\`. One channel joined: optional. Several joined (other agents share this server, or you switched files): pass it on EVERY call, else the call is refused as "Ambiguous Figma channel" (node ids are not unique across files). Safest: always pass your joined channel. Commands go only to the named channel; there is no "last active" fallback.

# Name lookups
Pass names instead of ids, no lookup needed: \`bind_variable\` (variable name, e.g. "background/primary"); \`set_effect_style_id\`, \`set_color_style_id\`, \`update/delete_effect_style\`, \`update/delete_color_style\`, \`get_color_style\` (style name, e.g. "shadow/md"); \`apply_text_style\`, \`update/delete_text_style\`. Dashes become slashes ("color-primary" = "color/primary"). Prefer names.

# Browser tools (\`browser_*\`, \`get_browser_*\`, \`set_browser_viewport\`, overlay, diff)
- \`browser_id\`: call \`list_connected_browsers\` first (id + label \`Chrome-<id6>\`). Several connected: pass the same \`browser_id\` on every call for the whole workflow (tabs, pins, emulation, debugger sessions are per browser); omitting it is rejected as ambiguous. One connected: optional. "No browser with id X is connected" means stale: re-list.
- \`tab_id\`: tabs need not be focused or visible (CDP). Get one from \`browser_list_tabs\` or \`browser_create_tab\` (joins the "Videntia" group; pass \`new_window: true\` if you will resize to desktop widths, close those with \`browser_close_tab\`). Pass it on every call: omitted, commands go to the popup-pinned tab or the focused tab the user may be using.
- Leave Chrome's "is debugging this browser" infobar open; dismissing it detaches. Viewport emulation survives \`browser_navigate\`/back/forward, not user reloads. Clean up with \`browser_close_group\`.
`;
