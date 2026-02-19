import { z } from "zod";

// Argumentos de línea de comandos
const args = process.argv.slice(2);
const serverArg = args.find((arg) => arg.startsWith("--server="));
const portArg = args.find((arg) => arg.startsWith("--port="));
const reconnectArg = args.find((arg) => arg.startsWith("--reconnect-interval="));
const figmaTokenArg = args.find((arg) => arg.startsWith("--figma-token="));

// Configuración de conexión extraída de argumentos CLI
export const serverUrl = serverArg ? serverArg.split("=")[1] : "localhost";
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
  name: "ClaudeFigmaMCP",
  description: "Claude Figma MCP - AI-powered design tool for Figma",
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

## Step 2: Match Stored Preference

Read \`docs/figma-mcp.md\` from the project root.

### If file exists

1. Parse YAML frontmatter for the \`figma_file\` value
2. Match \`figma_file\` against the channel list (case-insensitive \`fileName\` comparison)
3. **Match found** → use that channel, go to Step 3
4. **No match** → show the active channels and ask the user to pick one, then update \`docs/figma-mcp.md\` with the chosen file name

### If file does not exist (first run)

- **1 channel available** → ask user to confirm: "Found Figma file '{fileName}'. Use this?"
  - Yes → write \`docs/figma-mcp.md\`, continue
  - No → ask the user which file to use
- **Multiple channels** → ask the user to pick one from the list of file names
- Write \`docs/figma-mcp.md\` with the chosen file name:

\`\`\`yaml
---
figma_file: "Chosen File Name"
---
\`\`\`

## Step 3: Join Channel

Call \`join_channel\` with the resolved channel ID.

- If it fails → retry once
- If still fails → report error with troubleshooting steps and stop:
  - Ensure the WebSocket server is running
  - Ensure the Claude MCP Plugin is open in Figma

## Notes

- \`docs/figma-mcp.md\` stores only the **file name** (stable), never the channel ID (ephemeral)
- \`docs/figma-mcp.md\` belongs in the \`docs/\` folder and is safe to commit
- Channel IDs are resolved dynamically each time via \`get_open_channels\`
- This resolution should happen once per session, not before every tool call
`;
