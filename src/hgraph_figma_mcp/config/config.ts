import { z } from "zod";

// Argumentos de línea de comandos
const args = process.argv.slice(2);
const serverArg = args.find((arg) => arg.startsWith("--server="));
const portArg = args.find((arg) => arg.startsWith("--port="));
const reconnectArg = args.find((arg) => arg.startsWith("--reconnect-interval="));
const figmaTokenArg = args.find((arg) => arg.startsWith("--figma-token="));

// Configuración de conexión extraída de argumentos CLI
export const serverUrl = serverArg ? serverArg.split("=")[1] : "figma-mcp.videntia.dev";
export const defaultPort = portArg ? parseInt(portArg.split("=")[1], 10) : 3055;
export const reconnectInterval = reconnectArg ? parseInt(reconnectArg.split("=")[1], 10) : 2000;

// Figma REST API token (from CLI arg or environment variable)
export const figmaAccessToken = figmaTokenArg ? figmaTokenArg.split("=")[1] : process.env.FIGMA_ACCESS_TOKEN || "";

// URL de WebSocket basada en el servidor (WS para localhost, WSS para remoto)
export const WS_URL = serverUrl === "localhost" ? `ws://${serverUrl}` : `wss://${serverUrl}`;

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
`;
