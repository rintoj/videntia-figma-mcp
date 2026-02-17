import { Server, ServerWebSocket } from "bun";

// Enhanced logging system
const logger = {
  info: (message: string, ...args: any[]) => {
    console.log(`[INFO] ${message}`, ...args);
  },
  debug: (message: string, ...args: any[]) => {
    console.log(`[DEBUG] ${message}`, ...args);
  },
  warn: (message: string, ...args: any[]) => {
    console.warn(`[WARN] ${message}`, ...args);
  },
  error: (message: string, ...args: any[]) => {
    console.error(`[ERROR] ${message}`, ...args);
  }
};

// Store clients by channel
const channels = new Map<string, Set<ServerWebSocket<any>>>();

// Store metadata per channel (e.g. Figma file name)
const channelMetadata = new Map<string, { fileName?: string; joinedAt: number }>();

// WebSocket readyState constant (avoid depending on browser WebSocket global)
const WS_OPEN = 1;

// Keep track of channel statistics
const stats = {
  totalConnections: 0,
  activeConnections: 0,
  messagesSent: 0,
  messagesReceived: 0,
  errors: 0
};

function cleanupDeadConnections(): number {
  let removedCount = 0;
  for (const [channelName, clients] of channels) {
    const deadClients: ServerWebSocket<any>[] = [];
    for (const client of clients) {
      if (client.readyState !== WS_OPEN) {
        deadClients.push(client);
      }
    }
    for (const dead of deadClients) {
      clients.delete(dead);
      removedCount++;
    }
    if (clients.size === 0) {
      channels.delete(channelName);
      channelMetadata.delete(channelName);
      logger.info(`Removed stale channel: ${channelName}`);
    }
  }
  if (removedCount > 0) {
    logger.info(`Cleanup: removed ${removedCount} dead connection(s)`);
    // Decrement for zombie connections that died without triggering the close handler
    stats.activeConnections = Math.max(0, stats.activeConnections - removedCount);
  }
  return removedCount;
}

function handleConnection(ws: ServerWebSocket<any>) {
  // Track connection statistics
  stats.totalConnections++;
  stats.activeConnections++;
  
  // Assign a unique client ID for better tracking
  const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  ws.data = { clientId };
  
  // Don't add to clients immediately - wait for channel join
  logger.info(`New client connected: ${clientId}`);

  // Send welcome message to the new client
  try {
    ws.send(JSON.stringify({
      type: "system",
      message: "Please join a channel to start communicating with Figma",
    }));
  } catch (error) {
    logger.error(`Failed to send welcome message to client ${clientId}:`, error);
    stats.errors++;
  }

}

const server = Bun.serve({
  port: 3055,
  // uncomment this to allow connections in windows wsl
  // hostname: "0.0.0.0",
  fetch(req: Request, server: Server<any>) {
    const url = new URL(req.url);
    
    // Log incoming requests
    logger.debug(`Received ${req.method} request to ${url.pathname}`);
    
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // Handle status endpoint
    if (url.pathname === "/status") {
      return new Response(JSON.stringify({
        status: "running",
        uptime: process.uptime(),
        stats
      }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    // Handle channels endpoint - list all active channels with metadata
    if (url.pathname === "/channels") {
      cleanupDeadConnections();
      const channelList = Array.from(channels.entries()).map(([name, clients]) => ({
        channel: name,
        clients: clients.size,
        fileName: channelMetadata.get(name)?.fileName ?? null,
        joinedAt: channelMetadata.get(name)?.joinedAt ?? null,
      }));
      return new Response(JSON.stringify(channelList), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Handle WebSocket upgrade
    try {
      const success = server.upgrade(req, {
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      });

      if (success) {
        return; // Upgraded to WebSocket
      }
    } catch (error) {
      logger.error("Failed to upgrade WebSocket connection:", error);
      stats.errors++;
      return new Response("Failed to upgrade to WebSocket", { status: 500 });
    }

    // Return response for non-WebSocket requests
    return new Response("Claude to Figma WebSocket server running. Try connecting with a WebSocket client.", {
      headers: {
        "Content-Type": "text/plain",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
  websocket: {
    idleTimeout: 60,
    sendPings: true,
    open: handleConnection,
    message(ws: ServerWebSocket<any>, message: string | Buffer) {
      try {
        stats.messagesReceived++;
        const clientId = ws.data?.clientId || "unknown";
        
        logger.debug(`Received message from client ${clientId}:`, typeof message === 'string' ? message : '<binary>');
        const data = JSON.parse(message as string);

        if (data.type === "join") {
          const channelName = data.channel;
          if (!channelName || typeof channelName !== "string") {
            logger.warn(`Client ${clientId} attempted to join without a valid channel name`);
            ws.send(JSON.stringify({
              type: "error",
              message: "Channel name is required"
            }));
            stats.messagesSent++;
            return;
          }

          // Remove stale channels with the same fileName (plugin reconnected with new channel ID)
          if (data.fileName) {
            for (const [existingChannel, existingClients] of channels) {
              if (existingChannel === channelName) continue;
              const meta = channelMetadata.get(existingChannel);
              if (meta?.fileName === data.fileName) {
                const hasActiveClient = Array.from(existingClients).some(
                  (c) => c.readyState === WS_OPEN,
                );
                if (!hasActiveClient) {
                  channels.delete(existingChannel);
                  channelMetadata.delete(existingChannel);
                  logger.info(
                    `Removed stale channel ${existingChannel} for file "${data.fileName}" (replaced by ${channelName})`,
                  );
                }
              }
            }
          }

          // Create channel if it doesn't exist
          if (!channels.has(channelName)) {
            logger.info(`Creating new channel: ${channelName}`);
            channels.set(channelName, new Set());
          }

          // Add client to channel
          const channelClients = channels.get(channelName)!;
          channelClients.add(ws);
          ws.data.channel = channelName;
          logger.info(`Client ${clientId} joined channel: ${channelName}`);

          // Store channel metadata (file name from Figma plugin)
          if (!channelMetadata.has(channelName)) {
            channelMetadata.set(channelName, {
              fileName: data.fileName || undefined,
              joinedAt: Date.now(),
            });
          } else if (data.fileName) {
            const existing = channelMetadata.get(channelName)!;
            existing.fileName = data.fileName;
          }

          // Notify client they joined successfully
          try {
            ws.send(JSON.stringify({
              type: "system",
              message: `Joined channel: ${channelName}`,
              channel: channelName
            }));
            stats.messagesSent++;

            ws.send(JSON.stringify({
              type: "system",
              message: {
                id: data.id,
                result: "Connected to channel: " + channelName,
              },
              channel: channelName
            }));
            stats.messagesSent++;
            
            logger.debug(`Connection confirmation sent to client ${clientId} for channel ${channelName}`);
          } catch (error) {
            logger.error(`Failed to send join confirmation to client ${clientId}:`, error);
            stats.errors++;
          }

          // Notify other clients in channel
          try {
            let notificationCount = 0;
            channelClients.forEach((client) => {
              if (client !== ws && client.readyState === WS_OPEN) {
                client.send(JSON.stringify({
                  type: "system",
                  message: "A new client has joined the channel",
                  channel: channelName
                }));
                stats.messagesSent++;
                notificationCount++;
              }
            });
            if (notificationCount > 0) {
              logger.debug(`Notified ${notificationCount} other clients in channel ${channelName}`);
            }
          } catch (error) {
            logger.error(`Error notifying channel about new client:`, error);
            stats.errors++;
          }
          
          return;
        }

        // Handle regular messages
        if (data.type === "message") {
          const channelName = data.channel;
          if (!channelName || typeof channelName !== "string") {
            logger.warn(`Client ${clientId} sent message without a valid channel name`);
            ws.send(JSON.stringify({
              type: "error",
              message: "Channel name is required"
            }));
            stats.messagesSent++;
            return;
          }

          const channelClients = channels.get(channelName);
          if (!channelClients || !channelClients.has(ws)) {
            logger.warn(`Client ${clientId} attempted to send to channel ${channelName} without joining first`);
            ws.send(JSON.stringify({
              type: "error",
              message: "You must join the channel first"
            }));
            stats.messagesSent++;
            return;
          }

          // Broadcast to all OTHER clients in the channel (not the sender)
          try {
            let broadcastCount = 0;
            channelClients.forEach((client) => {
              // Only send to other clients, not back to the sender
              if (client !== ws && client.readyState === WS_OPEN) {
                logger.debug(`Broadcasting message to peer in channel ${channelName}`);
                client.send(JSON.stringify({
                  type: "broadcast",
                  message: data.message,
                  sender: "User",
                  channel: channelName
                }));
                stats.messagesSent++;
                broadcastCount++;
              }
            });
            logger.info(`Broadcasted message to ${broadcastCount} peer(s) in channel ${channelName}`);

            if (broadcastCount === 0) {
              logger.warn(`No recipients for message in channel ${channelName}`);
              try {
                ws.send(JSON.stringify({
                  type: "broadcast",
                  message: {
                    id: data.message?.id,
                    error: "No Figma plugin is connected on this channel. The plugin may have been closed or reloaded."
                  },
                  channel: channelName
                }));
                stats.messagesSent++;
              } catch (sendError) {
                logger.error(`Failed to send no-recipient error:`, sendError);
                stats.errors++;
              }
            }
          } catch (error) {
            logger.error(`Error broadcasting message to channel ${channelName}:`, error);
            stats.errors++;
          }
        }
        
        // Handle progress updates
        if (data.type === "progress_update") {
          const channelName = data.channel;
          if (!channelName || typeof channelName !== "string") {
            logger.warn(`Client ${clientId} sent progress update without a valid channel name`);
            return;
          }

          const channelClients = channels.get(channelName);
          if (!channelClients) {
            logger.warn(`Progress update for non-existent channel: ${channelName}`);
            return;
          }

          logger.debug(`Progress update for command ${data.id} in channel ${channelName}: ${data.message?.data?.status || 'unknown'} - ${data.message?.data?.progress || 0}%`);
          
          // Broadcast progress update to all clients in the channel
          try {
            channelClients.forEach((client) => {
              if (client.readyState === WS_OPEN) {
                client.send(JSON.stringify(data));
                stats.messagesSent++;
              }
            });
          } catch (error) {
            logger.error(`Error broadcasting progress update:`, error);
            stats.errors++;
          }
        }
        
      } catch (err) {
        stats.errors++;
        logger.error("Error handling message:", err);
        try {
          // Send error back to client
          ws.send(JSON.stringify({
            type: "error",
            message: "Error processing your message: " + (err instanceof Error ? err.message : String(err))
          }));
          stats.messagesSent++;
        } catch (sendError) {
          logger.error("Failed to send error message to client:", sendError);
        }
      }
    },
    close(ws: ServerWebSocket<any>, code: number, reason: string) {
      const clientId = ws.data?.clientId || "unknown";
      logger.info(`WebSocket closed for client ${clientId}: Code ${code}, Reason: ${reason || 'No reason provided'}`);

      // Remove client from their channel
      const channelName = ws.data?.channel;
      if (channelName) {
        const clients = channels.get(channelName);
        if (clients) {
          clients.delete(ws);
          logger.debug(`Removed client ${clientId} from channel ${channelName}`);
          if (clients.size === 0) {
            channels.delete(channelName);
            channelMetadata.delete(channelName);
            logger.info(`Removed empty channel: ${channelName}`);
          }
        }
      }

      stats.activeConnections = Math.max(0, stats.activeConnections - 1);
    },
    drain(ws: ServerWebSocket<any>) {
      const clientId = ws.data?.clientId || "unknown";
      logger.debug(`WebSocket backpressure relieved for client ${clientId}`);
    }
  }
});

logger.info(`Claude to Figma WebSocket server running on port ${server.port}`);
logger.info(`Status endpoint available at http://localhost:${server.port}/status`);
logger.info(`Channels endpoint available at http://localhost:${server.port}/channels`);

// Periodic cleanup of dead connections and stats logging
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
