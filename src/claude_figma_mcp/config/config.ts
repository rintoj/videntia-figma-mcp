import { z } from "zod";

// Argumentos de línea de comandos
const args = process.argv.slice(2);
const serverArg = args.find(arg => arg.startsWith('--server='));
const portArg = args.find(arg => arg.startsWith('--port='));
const reconnectArg = args.find(arg => arg.startsWith('--reconnect-interval='));
const figmaTokenArg = args.find(arg => arg.startsWith('--figma-token='));

// Configuración de conexión extraída de argumentos CLI
export const serverUrl = serverArg ? serverArg.split('=')[1] : 'localhost';
export const defaultPort = portArg ? parseInt(portArg.split('=')[1], 10) : 3055;
export const reconnectInterval = reconnectArg ? parseInt(reconnectArg.split('=')[1], 10) : 2000;

// Figma REST API token (from CLI arg or environment variable)
export const figmaAccessToken = figmaTokenArg
  ? figmaTokenArg.split('=')[1]
  : process.env.FIGMA_ACCESS_TOKEN || '';

// URL de WebSocket basada en el servidor (WS para localhost, WSS para remoto)
export const WS_URL = serverUrl === 'localhost' ? `ws://${serverUrl}` : `wss://${serverUrl}`;

// Figma REST API base URL
export const FIGMA_API_BASE_URL = 'https://api.figma.com/v1';

// Configuración del servidor MCP
export const SERVER_CONFIG = {
  name: "ClaudeFigmaMCP",
  description: "Claude Figma MCP - AI-powered design tool for Figma",
  version: "0.4.0",
};