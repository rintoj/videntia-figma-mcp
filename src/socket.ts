import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WebSocketServer, WebSocket } from "ws";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { SERVER_CONFIG, SERVER_INSTRUCTIONS } from "./videntia_figma_mcp/config/config";
import { registerTools } from "./videntia_figma_mcp/tools";
import { registerPrompts } from "./videntia_figma_mcp/prompts";
import { register, verifyEmail, login } from './auth/accounts'
import { createToken, listTokens, revokeToken, validateKey } from './auth/tokens'
import { signJwt, verifyJwt, parseCookies } from './auth/session'
import { sendVerificationEmail } from './auth/email'

// Enhanced logging system
const logger = {
  info: (message: string, ...args: any[]) => console.log(`[INFO] ${message}`, ...args),
  debug: (message: string, ...args: any[]) => console.log(`[DEBUG] ${message}`, ...args),
  warn: (message: string, ...args: any[]) => console.warn(`[WARN] ${message}`, ...args),
  error: (message: string, ...args: any[]) => console.error(`[ERROR] ${message}`, ...args),
};

// ─── API key auth ─────────────────────────────────────────────────────────────

// API_KEY env var is now optional — used only as a local-dev fallback
function isAuthorized(req: http.IncomingMessage): boolean {
  const envKey = process.env.API_KEY
  const authHeader = req.headers["authorization"];
  const url = new URL(req.url ?? "/", "http://localhost");
  const keyFromQuery = url.searchParams.get("apiKey")
  const incomingKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : keyFromQuery

  if (!incomingKey) return false

  // Fallback: match env var (local dev only)
  if (envKey && incomingKey === envKey) return true

  // Primary: validate against DB
  return validateKey(incomingKey) !== null
}

function rejectUnauthorized(res: http.ServerResponse): void {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Unauthorized" }));
}

// ─── Session helpers ──────────────────────────────────────────────────────────

const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-secret-change-in-production'
if (!process.env.SESSION_SECRET) {
  logger.warn('SESSION_SECRET env var not set — using insecure default. Set it in production!')
}

function getSessionUser(req: http.IncomingMessage): { userId: string; email?: string } | null {
  const cookieHeader = req.headers['cookie'] ?? ''
  const cookies = parseCookies(cookieHeader)
  const token = cookies['session']
  if (!token) return null
  return verifyJwt(token, SESSION_SECRET)
}

function setSessionCookie(res: http.ServerResponse, userId: string, email: string): void {
  const token = signJwt({ userId, email }, SESSION_SECRET)
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 24 * 3600}`)
}

function clearSessionCookie(res: http.ServerResponse): void {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
}

const MAX_BODY_BYTES = 64 * 1024 // 64 KB

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error('Request body too large'))
        return
      }
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

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

// Map sessionId → StreamableHTTPServerTransport for /mcp endpoint
const streamableTransports = new Map<string, StreamableHTTPServerTransport>();

const httpServer = http.createServer(async (reqOrig, res) => {
  let req: typeof reqOrig = reqOrig;
  const url = new URL(req.url ?? "/", `http://localhost`);

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, Mcp-Session-Id");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // ── Portal SPA (no auth required) ──────────────────────────────────────────
  if (url.pathname.startsWith('/portal')) {
    try {
      const html = readFileSync(join(process.cwd(), 'dist', 'portal', 'index.html'), 'utf-8')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    } catch {
      res.writeHead(503, { 'Content-Type': 'text/plain' })
      res.end('Portal not built yet. Run: bun run build:portal')
    }
    return
  }

  // ── Auth API (no bearer auth required) ────────────────────────────────────
  if (url.pathname.startsWith('/api/auth')) {
    res.setHeader('Content-Type', 'application/json')

    // POST /api/auth/register
    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      try {
        const { email, password } = JSON.parse(await readBody(req))
        if (!email || !password) throw new Error('email and password are required')
        const { verifyToken } = await register(email, password)
        await sendVerificationEmail(email, verifyToken)
        res.writeHead(200)
        res.end(JSON.stringify({ message: 'Registration successful. Check your email to verify your account.' }))
      } catch (err) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Registration failed' }))
      }
      return
    }

    // GET /api/auth/verify?token=
    if (url.pathname === '/api/auth/verify' && req.method === 'GET') {
      const token = url.searchParams.get('token') ?? ''
      try {
        await verifyEmail(token)
        res.writeHead(302, { Location: '/portal#/login?verified=1' })
        res.end()
      } catch {
        res.writeHead(302, { Location: '/portal#/login?error=invalid-token' })
        res.end()
      }
      return
    }

    // POST /api/auth/login
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      try {
        const { email, password } = JSON.parse(await readBody(req))
        const userId = await login(email, password)
        setSessionCookie(res, userId, email)
        res.writeHead(200)
        res.end(JSON.stringify({ message: 'Logged in' }))
      } catch (err) {
        res.writeHead(401)
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Login failed' }))
      }
      return
    }

    // POST /api/auth/logout
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      clearSessionCookie(res)
      res.writeHead(200)
      res.end(JSON.stringify({ message: 'Logged out' }))
      return
    }

    // GET /api/auth/me
    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      const user = getSessionUser(req)
      if (!user) { res.writeHead(401); res.end(JSON.stringify({ error: 'Not authenticated' })); return }
      res.writeHead(200)
      res.end(JSON.stringify({ userId: user.userId, email: user.email }))
      return
    }
  }

  // ── Token API (session auth required) ─────────────────────────────────────
  if (url.pathname.startsWith('/api/tokens')) {
    res.setHeader('Content-Type', 'application/json')
    const user = getSessionUser(req)
    if (!user) { res.writeHead(401); res.end(JSON.stringify({ error: 'Not authenticated' })); return }

    // GET /api/tokens
    if (url.pathname === '/api/tokens' && req.method === 'GET') {
      res.writeHead(200)
      res.end(JSON.stringify(listTokens(user.userId)))
      return
    }

    // POST /api/tokens
    if (url.pathname === '/api/tokens' && req.method === 'POST') {
      try {
        const { name } = JSON.parse(await readBody(req))
        if (!name) throw new Error('name is required')
        const { id, fullKey } = await createToken(user.userId, name)
        res.writeHead(201)
        res.end(JSON.stringify({ id, fullKey, message: 'Copy this key — it will not be shown again.' }))
      } catch (err) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to create token' }))
      }
      return
    }

    // DELETE /api/tokens/:id
    const tokenIdMatch = url.pathname.match(/^\/api\/tokens\/([^/]+)$/)
    if (tokenIdMatch && req.method === 'DELETE') {
      revokeToken(tokenIdMatch[1], user.userId)
      res.writeHead(200)
      res.end(JSON.stringify({ message: 'Token revoked' }))
      return
    }
  }

  // ── Bearer auth for MCP/WS/SSE endpoints ──────────────────────────────────
  if (!isAuthorized(req)) { rejectUnauthorized(res); return; }

  // Log all incoming requests for debugging
  logger.info(`${req.method} ${url.pathname} accept="${req.headers["accept"]}" origin="${req.headers["origin"] ?? ""}"`)

  // OAuth discovery endpoints — required by MCP clients that probe for auth (e.g. Replit).
  // We return minimal metadata indicating this server requires no authentication.
  // OAuth/OIDC discovery endpoints — return 404 to indicate no auth required
  if (url.pathname.startsWith("/.well-known/")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not configured" }));
    return;
  }

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

  // MCP Streamable HTTP: POST/GET /mcp (modern transport for Replit, Claude.ai, etc.)
  if (url.pathname === "/mcp") {
    // SDK 1.29+ uses Hono's getRequestListener to convert IncomingMessage → Web Request,
    // which reads rawHeaders (not the parsed headers object). Patch both to satisfy the
    // SDK's Accept header check when the client (e.g. Replit) omits the required values.
    const origAccept = req.headers["accept"] ?? "";
    if (!origAccept.includes("application/json") || !origAccept.includes("text/event-stream")) {
      const REQUIRED_ACCEPT = "application/json, text/event-stream";
      // Patch parsed headers
      try { Object.defineProperty(req.headers, "accept", { value: REQUIRED_ACCEPT, writable: true, configurable: true, enumerable: true }); }
      catch { req.headers["accept"] = REQUIRED_ACCEPT; }
      // Patch raw headers array used by Hono's Node→Web conversion
      const raw = req.rawHeaders;
      const idx = raw.findIndex((h, i) => i % 2 === 0 && h.toLowerCase() === "accept");
      if (idx >= 0) {
        raw[idx + 1] = REQUIRED_ACCEPT;
      } else {
        raw.push("Accept", REQUIRED_ACCEPT);
      }
    }

    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", async () => {
        try {
          logger.info(`/mcp raw body(${body.length}): ${body.substring(0, 200)}`);
          const parsedBody = JSON.parse(body);
          const sessionId = req.headers["mcp-session-id"] as string | undefined;
          let transport: StreamableHTTPServerTransport;

          if (sessionId && streamableTransports.has(sessionId)) {
            transport = streamableTransports.get(sessionId)!;
          } else if (!sessionId && isInitializeRequest(parsedBody)) {
            transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), enableJsonResponse: true });
            const mcpServer = createMcpServer();
            transport.onclose = () => {
              // Delay cleanup so follow-up requests (e.g. notifications/initialized) can still route here
              const sid = transport.sessionId;
              if (sid) setTimeout(() => streamableTransports.delete(sid), 60_000);
            };
            await mcpServer.connect(transport);
          } else {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Bad request: missing or invalid session" }));
            return;
          }

          logger.info(`/mcp body method="${parsedBody?.method}" id="${parsedBody?.id}"`);
          await transport.handleRequest(req, res, parsedBody);

          // sessionId is set by handleRequest after processing initialize
          if (isInitializeRequest(parsedBody) && transport.sessionId && !streamableTransports.has(transport.sessionId)) {
            streamableTransports.set(transport.sessionId, transport);
            logger.info(`Streamable MCP session stored: ${transport.sessionId}`);
          }
        } catch (err) {
          logger.error("Error handling /mcp POST:", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      });
      return;
    }

    if (req.method === "GET") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const transport = sessionId ? streamableTransports.get(sessionId) : undefined;
      if (!transport) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
        return;
      }
      await transport.handleRequest(req, res);
      return;
    }

    if (req.method === "DELETE") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const transport = sessionId ? streamableTransports.get(sessionId) : undefined;
      if (transport) {
        await transport.handleRequest(req, res);
        streamableTransports.delete(sessionId!);
      } else {
        res.writeHead(404); res.end();
      }
      return;
    }
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

wss.on("connection", (ws, req) => {
  if (!isAuthorized(req)) {
    ws.close(4401, "Unauthorized");
    return;
  }
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
