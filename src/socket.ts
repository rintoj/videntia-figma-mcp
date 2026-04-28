import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { SERVER_CONFIG, SERVER_INSTRUCTIONS } from "./videntia_figma_mcp/config/config";
import { registerTools } from "./videntia_figma_mcp/tools";
import { registerPrompts } from "./videntia_figma_mcp/prompts";

// Enhanced logging system
const logger = {
  info: (message: string, ...args: any[]) => console.log(`[INFO] ${message}`, ...args),
  debug: (message: string, ...args: any[]) => console.log(`[DEBUG] ${message}`, ...args),
  warn: (message: string, ...args: any[]) => console.warn(`[WARN] ${message}`, ...args),
  error: (message: string, ...args: any[]) => console.error(`[ERROR] ${message}`, ...args),
};

// ─── Figma relay state ────────────────────────────────────────────────────────

const channels = new Map<string, Set<WebSocket>>();
const channelMetadata = new Map<string, { fileName?: string; joinedAt: number }>();
const stats = { totalConnections: 0, activeConnections: 0, messagesSent: 0, messagesReceived: 0, errors: 0 };

function cleanupDeadConnections(): number {
  let removed = 0;
  for (const [name, clients] of channels) {
    const dead = [...clients].filter((c) => c.readyState !== WebSocket.OPEN);
    dead.forEach((c) => clients.delete(c));
    removed += dead.length;
    if (clients.size === 0) {
      channels.delete(name);
      channelMetadata.delete(name);
      logger.info(`Removed stale channel: ${name}`);
    }
  }
  if (removed > 0) {
    stats.activeConnections = Math.max(0, stats.activeConnections - removed);
    logger.info(`Cleanup: removed ${removed} dead connection(s)`);
  }
  return removed;
}

function handleWebSocketMessage(ws: WebSocket, raw: string) {
  const clientId: string = (ws as any)._clientId ?? "unknown";
  stats.messagesReceived++;
  const data = JSON.parse(raw);

  if (data.type === "join") {
    let channelName: string = data.channel;
    if (!channelName) {
      ws.send(JSON.stringify({ type: "error", message: "Channel name is required" }));
      return;
    }

    // Remove stale channels with same fileName
    if (data.fileName) {
      for (const [existing, clients] of channels) {
        if (existing === channelName) continue;
        if (channelMetadata.get(existing)?.fileName === data.fileName) {
          clients.forEach((c) => c.close(1000, "Replaced by new connection"));
          channels.delete(existing);
          channelMetadata.delete(existing);
          logger.info(`Removed stale channel ${existing} for file "${data.fileName}"`);
        }
      }
    }

    // Deduplicate channel name
    if (data.fileName && channels.has(channelName)) {
      const existingMeta = channelMetadata.get(channelName);
      if (existingMeta?.fileName && existingMeta.fileName !== data.fileName) {
        let counter = 2;
        let candidate = channelName;
        while (channels.has(candidate) && channelMetadata.get(candidate)?.fileName !== data.fileName) {
          candidate = `${channelName}-${counter++}`;
        }
        channelName = candidate;
      }
    }

    if (!channels.has(channelName)) channels.set(channelName, new Set());
    const channelClients = channels.get(channelName)!;
    channelClients.add(ws);
    (ws as any)._channel = channelName;
    logger.info(`Client ${clientId} joined channel: ${channelName}`);

    if (!channelMetadata.has(channelName)) {
      channelMetadata.set(channelName, { fileName: data.fileName, joinedAt: Date.now() });
    } else if (data.fileName) {
      channelMetadata.get(channelName)!.fileName = data.fileName;
    }

    ws.send(JSON.stringify({ type: "system", message: `Joined channel: ${channelName}`, channel: channelName }));
    ws.send(JSON.stringify({ type: "system", message: { id: data.id, result: `Connected to channel: ${channelName}` }, channel: channelName }));
    stats.messagesSent += 2;

    channelClients.forEach((c) => {
      if (c !== ws && c.readyState === WebSocket.OPEN) {
        c.send(JSON.stringify({ type: "system", event: "client_connected", message: "A new client has joined the channel", channel: channelName, clients: channelClients.size }));
        stats.messagesSent++;
      }
    });
    return;
  }

  if (data.type === "message") {
    const channelName: string = data.channel;
    const channelClients = channels.get(channelName);
    if (!channelClients?.has(ws)) {
      ws.send(JSON.stringify({ type: "error", message: "You must join the channel first" }));
      return;
    }
    let broadcastCount = 0;
    channelClients.forEach((c) => {
      if (c !== ws && c.readyState === WebSocket.OPEN) {
        c.send(JSON.stringify({ type: "broadcast", message: data.message, sender: "User", channel: channelName }));
        stats.messagesSent++;
        broadcastCount++;
      }
    });
    if (broadcastCount === 0) {
      ws.send(JSON.stringify({ type: "broadcast", message: { id: data.message?.id, error: "No Figma plugin is connected on this channel." }, channel: channelName }));
      stats.messagesSent++;
    }
    logger.info(`Broadcasted message to ${broadcastCount} peer(s) in channel ${channelName}`);
    return;
  }

  if (data.type === "progress_update") {
    const channelClients = channels.get(data.channel);
    channelClients?.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) { c.send(JSON.stringify(data)); stats.messagesSent++; }
    });
  }
}

// ─── MCP server factory ───────────────────────────────────────────────────────

function createMcpServer() {
  const server = new McpServer(SERVER_CONFIG, { instructions: SERVER_INSTRUCTIONS });
  registerTools(server);
  registerPrompts(server);
  return server;
}

// ─── HTTP server (shared) ─────────────────────────────────────────────────────

const PORT = 3055;

// Map sessionId → SSEServerTransport for routing POST /message requests
const sseTransports = new Map<string, SSEServerTransport>();

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost`);

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // Status
  if (url.pathname === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "running", uptime: process.uptime(), stats }));
    return;
  }

  // Channels
  if (url.pathname === "/channels") {
    cleanupDeadConnections();
    const list = [...channels.entries()].map(([name, clients]) => ({
      channel: name, clients: clients.size,
      fileName: channelMetadata.get(name)?.fileName ?? null,
      joinedAt: channelMetadata.get(name)?.joinedAt ?? null,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(list));
    return;
  }

  // MCP SSE: GET /sse → open SSE stream
  if (url.pathname === "/sse" && req.method === "GET") {
    const transport = new SSEServerTransport("/message", res);
    const mcpServer = createMcpServer();
    sseTransports.set(transport.sessionId, transport);
    transport.onclose = () => { sseTransports.delete(transport.sessionId); logger.info(`MCP session closed: ${transport.sessionId}`); };
    await mcpServer.connect(transport);
    logger.info(`MCP session started: ${transport.sessionId}`);
    return;
  }

  // MCP SSE: POST /message → deliver JSON-RPC message to session
  if (url.pathname === "/message" && req.method === "POST") {
    const sessionId = url.searchParams.get("sessionId");
    const transport = sessionId ? sseTransports.get(sessionId) : undefined;
    if (!transport) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }
    await transport.handlePostMessage(req, res);
    return;
  }

  // Default
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Claude to Figma WebSocket server running. Try connecting with a WebSocket client.");
});

// ─── WebSocket server (attached to same http server) ─────────────────────────

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  stats.totalConnections++;
  stats.activeConnections++;
  const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  (ws as any)._clientId = clientId;
  logger.info(`New client connected: ${clientId}`);

  ws.send(JSON.stringify({ type: "system", message: "Please join a channel to start communicating with Figma" }));
  stats.messagesSent++;

  ws.on("message", (raw) => {
    try { handleWebSocketMessage(ws, raw.toString()); }
    catch (err) {
      stats.errors++;
      logger.error("Error handling message:", err);
      ws.send(JSON.stringify({ type: "error", message: `Error processing message: ${err instanceof Error ? err.message : String(err)}` }));
    }
  });

  ws.on("close", (code, reason) => {
    logger.info(`Client ${clientId} disconnected: ${code} ${reason || ""}`);
    const channelName: string | undefined = (ws as any)._channel;
    if (channelName) {
      const clients = channels.get(channelName);
      if (clients) {
        clients.delete(ws);
        clients.forEach((c) => {
          if (c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify({ type: "system", event: "client_disconnected", message: "A client has left the channel", channel: channelName, clients: clients.size }));
            stats.messagesSent++;
          }
        });
        if (clients.size === 0) { channels.delete(channelName); channelMetadata.delete(channelName); }
      }
    }
    stats.activeConnections = Math.max(0, stats.activeConnections - 1);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  logger.info(`Claude to Figma WebSocket server running on port ${PORT}`);
  logger.info(`Status endpoint available at http://localhost:${PORT}/status`);
  logger.info(`Channels endpoint available at http://localhost:${PORT}/channels`);
  logger.info(`MCP SSE endpoint: http://localhost:${PORT}/sse`);
});

// Periodic cleanup
const CLEANUP_INTERVAL_MS = 30_000;
const STATS_LOG_INTERVAL_MS = 5 * 60_000;
let lastStatsLog = Date.now();
setInterval(() => {
  const removed = cleanupDeadConnections();
  const now = Date.now();
  if (removed > 0 || now - lastStatsLog >= STATS_LOG_INTERVAL_MS) {
    logger.info("Server stats:", { channels: channels.size, ...stats });
    lastStatsLog = now;
  }
}, CLEANUP_INTERVAL_MS);
