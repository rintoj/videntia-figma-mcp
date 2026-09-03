import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger";
import { serverUrl, defaultPort, WS_URL, reconnectInterval } from "../config/config";
import {
  FigmaCommand,
  FigmaResponse,
  CommandProgressUpdate,
  PendingRequest,
  ProgressMessage,
  BrowserCommand,
} from "../types";

class ChannelValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelValidationError";
  }
}

// WebSocket connection and request tracking
let ws: WebSocket | null = null;
// The channel this SINGLE relay connection is actually joined to right now,
// server-confirmed. The server allows a socket to be a member of only one
// channel at a time — joining a new one silently evicts it from the previous
// one (see socket.ts's join handler) — so this must be one shared variable,
// not independent trackers per "kind" of channel (Figma file vs. "browser").
let currentChannel: string | null = null;
// The last Figma channel we successfully joined, kept across reconnects/across
// switches to the "browser" channel so we know what to silently rejoin before
// the next Figma command.
let lastChannelName: string | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

// Map of pending requests for promise tracking
const pendingRequests = new Map<string, PendingRequest>();

/**
 * Connects to the Figma server via WebSocket.
 * @param port - Optional port for the connection (defaults to defaultPort from config)
 */
export function connectToFigma(port: number = defaultPort) {
  // If already connected, do nothing
  if (ws && ws.readyState === WebSocket.OPEN) {
    logger.info("Already connected to Figma");
    return;
  }

  // If connection is in progress (CONNECTING state), wait
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    logger.info("Connection to Figma is already in progress");
    return;
  }

  // If there's an existing socket in a closing state, clean it up
  if (ws && (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED)) {
    ws.removeAllListeners();
    ws = null;
  }

  const wsUrl = serverUrl === "localhost" ? `${WS_URL}:${port}` : WS_URL;
  logger.info(`Connecting to Figma socket server at ${wsUrl}...`);

  try {
    ws = new WebSocket(wsUrl);

    // Add connection timeout
    const connectionTimeout = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.CONNECTING) {
        logger.error("Connection to Figma timed out");
        ws.terminate();
      }
    }, 10000); // 10 second connection timeout

    ws.on("open", () => {
      clearTimeout(connectionTimeout);
      logger.info("Connected to Figma socket server");
      // Reset channel on new connection
      currentChannel = null;

      // Heartbeat: without this, a half-dead loopback connection (peer gone but
      // no FIN/RST received) can sit in readyState OPEN indefinitely, so
      // in-flight commands silently time out instead of failing fast/reconnecting.
      let isAlive = true;
      ws!.on("pong", () => {
        isAlive = true;
      });
      heartbeatInterval = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (!isAlive) {
          logger.warn("Relay connection heartbeat missed; terminating stale socket");
          ws.terminate();
          return;
        }
        isAlive = false;
        ws.ping();
      }, 15000);
    });

    ws.on("message", (data: any) => {
      try {
        const json = JSON.parse(data) as ProgressMessage;

        // Handle relay-level errors (e.g. "You must join the channel first"). These carry
        // no request id to correlate against, so — since this connection only ever has one
        // command in flight at a time — reject the oldest pending request instead of letting
        // it silently sit until its 30s timeout fires.
        if ((json as any).type === "error") {
          const message = typeof (json as any).message === "string" ? (json as any).message : JSON.stringify(json);
          logger.error(`Relay error: ${message}`);
          const oldest = pendingRequests.entries().next();
          if (!oldest.done) {
            const [id, request] = oldest.value;
            clearTimeout(request.timeout);
            pendingRequests.delete(id);
            request.reject(new Error(message));
          }
          return;
        }

        // Handle peer disconnect notifications
        if (json.type === "channel_peer_disconnected") {
          if (json.remainingClients <= 1) {
            logger.warn(`Figma plugin disconnected from channel "${json.channel}". Clearing channel state.`);
            currentChannel = null;
          }
          return;
        }

        // Handle progress updates
        if (json.type === "progress_update") {
          const progressData = json.message.data as CommandProgressUpdate;
          const requestId = json.id || "";

          if (requestId && pendingRequests.has(requestId)) {
            const request = pendingRequests.get(requestId)!;

            // Update last activity timestamp
            request.lastActivity = Date.now();

            // Reset the timeout to prevent timeouts during long-running operations
            clearTimeout(request.timeout);

            // Create a new timeout
            request.timeout = setTimeout(() => {
              if (pendingRequests.has(requestId)) {
                logger.error(`Request ${requestId} timed out after extended period of inactivity`);
                pendingRequests.delete(requestId);
                request.reject(new Error("Request to Figma timed out"));
              }
            }, 60000); // 60 second timeout for inactivity

            // Log progress
            logger.info(
              `Progress update for ${progressData.commandType}: ${progressData.progress}% - ${progressData.message}`,
            );

            // For completed updates, we could resolve the request early if desired
            if (progressData.status === "completed" && progressData.progress === 100) {
              // Optionally resolve early with partial data
              // request.resolve(progressData.payload);
              // pendingRequests.delete(requestId);

              // Instead, just log the completion, wait for final result from Figma
              logger.info(`Operation ${progressData.commandType} completed, waiting for final result`);
            }
          }
          return;
        }

        // Handle regular responses
        const myResponse = json.message;
        logger.debug(`Received message: ${JSON.stringify(myResponse)}`);
        logger.log("myResponse" + JSON.stringify(myResponse));

        // Handle response to a request
        if (myResponse.id && pendingRequests.has(myResponse.id)) {
          const request = pendingRequests.get(myResponse.id)!;
          clearTimeout(request.timeout);

          if (myResponse.error) {
            logger.error(`Error from Figma: ${myResponse.error}`);
            request.reject(new Error(myResponse.error));
          } else if (myResponse.result) {
            request.resolve(myResponse.result);
          } else {
            logger.warn(`Received response without result or error for request ${myResponse.id}`);
            request.reject(new Error("Received invalid response from Figma plugin (no result or error field)"));
          }

          pendingRequests.delete(myResponse.id);
        } else {
          // Handle broadcast messages or events
          logger.info(`Received broadcast message: ${JSON.stringify(myResponse)}`);
        }
      } catch (error) {
        logger.error(`Error parsing message: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    ws.on("error", (error: Error) => {
      logger.error(`Socket error: ${error}`);
      // Don't attempt to reconnect here, let the close handler do it
    });

    ws.on("close", (code: number, reason: Buffer) => {
      clearTimeout(connectionTimeout);
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      logger.info(
        `Disconnected from Figma socket server with code ${code} and reason: ${reason || "No reason provided"}`,
      );
      ws = null;

      // Reject all pending requests
      for (const [id, request] of pendingRequests.entries()) {
        clearTimeout(request.timeout);
        request.reject(new Error(`Connection closed with code ${code}: ${reason || "No reason provided"}`));
        pendingRequests.delete(id);
      }

      // Attempt to reconnect with exponential backoff
      const backoff = Math.min(30000, reconnectInterval * Math.pow(1.5, Math.floor(Math.random() * 5))); // Max 30s
      logger.info(`Attempting to reconnect in ${backoff / 1000} seconds...`);
      setTimeout(() => connectToFigma(port), backoff);
    });
  } catch (error) {
    logger.error(`Failed to create WebSocket connection: ${error instanceof Error ? error.message : String(error)}`);
    // Attempt to reconnect after a delay
    setTimeout(() => connectToFigma(port), reconnectInterval);
  }
}

/**
 * Waits until the WebSocket is OPEN, initiating a connection if needed.
 */
async function waitForConnection(timeoutMs = 10000): Promise<void> {
  if (ws?.readyState === WebSocket.OPEN) return;
  connectToFigma();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((ws as WebSocket | null)?.readyState === WebSocket.OPEN) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Not connected to Figma");
}

/**
 * Join a specific channel in Figma.
 * @param channelName - Name of the channel to join
 * @returns Promise that resolves when successfully joined the channel
 */
export async function joinChannel(channelName: string): Promise<void> {
  await waitForConnection();

  // Validate the channel exists and has a Figma plugin connected
  try {
    const openChannels = await getOpenChannels();
    const match = openChannels.find((ch) => ch.channel === channelName);
    if (!match) {
      const available = openChannels
        .map((ch) => `  - ${ch.channel} (${ch.fileName ?? "unknown file"})${ch.hasPlugin ? "" : " [no plugin]"}`)
        .join("\n");
      throw new ChannelValidationError(
        `Invalid channel ID: "${channelName}". Channel not found.` +
          (openChannels.length > 0
            ? `\nAvailable channels:\n${available}`
            : "\nNo channels are currently available. Ensure the Claude MCP Plugin is open in Figma."),
      );
    }
    if (!match.hasPlugin) {
      const withPlugin = openChannels.filter((ch) => ch.hasPlugin);
      const pluginList = withPlugin.map((ch) => `  - ${ch.channel} (${ch.fileName ?? "unknown file"})`).join("\n");
      throw new ChannelValidationError(
        `Channel "${channelName}" exists but has no active Figma plugin connected.\n` +
          `The channel may be stale from a previous session. Open the Claude MCP Plugin in Figma and try again.\n` +
          (withPlugin.length > 0
            ? `\nChannels with an active plugin:\n${pluginList}`
            : "\nNo channels currently have an active Figma plugin."),
      );
    }
  } catch (error) {
    // If the error is our own validation error, re-throw it
    if (error instanceof ChannelValidationError) {
      throw error;
    }
    // If we can't reach the channels endpoint, log a warning but proceed with the join
    logger.warn(`Could not validate channel before joining: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    await sendCommandToFigma("join", { channel: channelName });
    currentChannel = channelName;
    lastChannelName = channelName;
    logger.info(`Joined channel: ${channelName}`);
  } catch (error) {
    logger.error(`Failed to join channel: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Get the current channel the connection is joined to.
 * @returns The current channel name or null if not connected to any channel
 */
export function getCurrentChannel(): string | null {
  return currentChannel;
}

/**
 * Get all open channels from the socket server via HTTP.
 * @returns A promise that resolves with an array of channel objects
 */
export async function getOpenChannels(): Promise<
  Array<{
    channel: string;
    clients: number;
    pluginClients: number;
    hasPlugin: boolean;
    extensionClients: number;
    hasExtension: boolean;
    fileName: string | null;
    joinedAt: number | null;
  }>
> {
  const httpUrl = serverUrl === "localhost" ? `http://localhost:${defaultPort}` : `https://${serverUrl}`;
  let response: Response;
  try {
    response = await fetch(`${httpUrl}/channels`, { signal: AbortSignal.timeout(10000) });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`Timed out fetching channels from ${httpUrl}/channels after 10s. Is the socket server running?`);
    }
    throw error;
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch channels: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<
    Array<{
      channel: string;
      clients: number;
      pluginClients: number;
      hasPlugin: boolean;
      extensionClients: number;
      hasExtension: boolean;
      fileName: string | null;
      joinedAt: number | null;
    }>
  >;
}

/**
 * Send a command to Figma via WebSocket.
 * @param command - The command to send
 * @param params - Additional parameters for the command
 * @param timeoutMs - Timeout in milliseconds before failing
 * @returns A promise that resolves with the Figma response
 */
export async function sendCommandToFigma<T = unknown>(
  command: FigmaCommand,
  params: unknown = {},
  timeoutMs: number = 30000,
): Promise<T> {
  await waitForConnection();

  // This connection can only be a member of one channel at a time — a browser
  // command (e.g. inject_figma_overlay) run in between may have switched it to
  // "browser", evicting it from our Figma channel. Rejoin transparently rather
  // than sending into a channel this socket is no longer actually a member of.
  if (command !== "join" && lastChannelName && currentChannel !== lastChannelName) {
    await _sendCommandToFigma("join", { channel: lastChannelName });
    currentChannel = lastChannelName;
  }

  try {
    return await _sendCommandToFigma<T>(command, params, timeoutMs);
  } catch (error) {
    // A drop mid-command rejects every pending request with "Connection closed ...".
    // "You must join the channel first" means we got evicted from this channel by an
    // interleaved command on the shared connection. Either way, if we know which channel
    // we were on, silently reconnect/rejoin + retry once instead of surfacing this to the
    // caller as a one-off failure.
    const recoverable =
      error instanceof Error &&
      (error.message.startsWith("Connection closed") || error.message === "You must join the channel first");
    if (recoverable && command !== "join" && lastChannelName) {
      logger.warn(`Relay connection dropped during "${command}"; reconnecting and retrying once.`);
      await waitForConnection();
      await _sendCommandToFigma("join", { channel: lastChannelName });
      currentChannel = lastChannelName;
      return await _sendCommandToFigma<T>(command, params, timeoutMs);
    }
    throw error;
  }
}

function _sendCommandToFigma<T = unknown>(
  command: FigmaCommand,
  params: unknown = {},
  timeoutMs: number = 30000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error("Not connected to Figma"));
      return;
    }

    // Check if we need a channel for this command
    const requiresChannel = command !== "join";
    if (requiresChannel && !currentChannel) {
      getOpenChannels()
        .then((channels) => {
          if (channels.length > 0) {
            const channelList = channels.map((ch) => `  - ${ch.channel} (${ch.fileName || "unknown file"})`).join("\n");
            reject(
              new Error(
                `No active Figma connection.\nAvailable channels:\n${channelList}\n\nUse join_channel with one of the above channel IDs to connect.`,
              ),
            );
          } else {
            reject(
              new Error(
                "No active Figma connection. No open channels found.\n" +
                  "Ensure the Claude MCP Plugin is running in Figma, then use get_open_channels and join_channel.",
              ),
            );
          }
        })
        .catch(() => {
          reject(
            new Error(
              "No active Figma connection. Could not fetch available channels.\n" +
                "Ensure the Claude MCP Plugin is running in Figma and use join_channel to reconnect.",
            ),
          );
        });
      return;
    }

    const id = uuidv4();
    const request = {
      id,
      type: command === "join" ? "join" : "message",
      ...(command === "join" ? { channel: (params as any).channel } : { channel: currentChannel }),
      message: {
        id,
        command,
        params: {
          ...(params as any),
          commandId: id, // Include the command ID in params
        },
      },
    };

    // Set timeout for request
    const timeout = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        logger.error(`Request ${id} to Figma timed out after ${timeoutMs / 1000} seconds`);
        reject(new Error("Request to Figma timed out"));
      }
    }, timeoutMs);

    // Store the promise callbacks to resolve/reject later
    pendingRequests.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timeout,
      lastActivity: Date.now(),
    });

    // Send the request
    logger.info(`Sending command to Figma: ${command}`);
    logger.debug(`Request details: ${JSON.stringify(request)}`);
    ws.send(JSON.stringify(request));
  }) as Promise<T>;
}

/**
 * Ensures the current WS connection has joined the given channel.
 * Used for non-Figma channels (e.g. "browser"). Idempotent per connection.
 *
 * The relay server allows a socket to be a member of only one channel at a
 * time (joining a new one silently evicts it from the previous one), so this
 * MUST check against the single shared `currentChannel`, not an independent
 * per-channel cache — otherwise a Figma-channel command in between two browser
 * commands leaves this connection evicted from "browser" while still
 * believing it's joined, and every subsequent browser command is rejected
 * server-side with "You must join the channel first" until it times out.
 */
async function ensureBrowserChannelJoined(channel: string): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("Not connected to WebSocket server. Ensure the socket server is running.");
  }
  if (currentChannel === channel) return;

  await new Promise<void>((resolve, reject) => {
    const onMsg = (raw: WebSocket.RawData) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.type === "system" && data.channel === channel && data.message?.result) {
          clearTimeout(timer);
          ws!.off("message", onMsg);
          currentChannel = channel;
          resolve();
        }
      } catch {}
    };
    const timer = setTimeout(() => {
      ws!.off("message", onMsg);
      reject(new Error(`Timed out joining channel "${channel}"`));
    }, 5000);
    ws!.on("message", onMsg);
    ws!.send(JSON.stringify({ type: "join", channel }));
  });
}

/**
 * Send a command to an explicit channel (not currentChannel).
 * Used for non-Figma channels such as "browser".
 */
export async function sendCommandToChannel<T = unknown>(
  targetChannel: string,
  command: BrowserCommand,
  params: unknown = {},
  timeoutMs: number = 30000,
): Promise<T> {
  await waitForConnection();
  await ensureBrowserChannelJoined(targetChannel);

  try {
    return await _sendCommandToChannel<T>(targetChannel, command, params, timeoutMs);
  } catch (error) {
    const recoverable =
      error instanceof Error &&
      (error.message.startsWith("Connection closed") || error.message === "You must join the channel first");
    if (recoverable) {
      logger.warn(`Relay connection dropped during browser command "${command}"; reconnecting and retrying once.`);
      await waitForConnection();
      await ensureBrowserChannelJoined(targetChannel);
      return await _sendCommandToChannel<T>(targetChannel, command, params, timeoutMs);
    }
    throw error;
  }
}

function _sendCommandToChannel<T = unknown>(
  targetChannel: string,
  command: BrowserCommand,
  params: unknown,
  timeoutMs: number,
): Promise<T> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Not connected to WebSocket server."));
  }

  return new Promise<T>((resolve, reject) => {
    const id = uuidv4();

    const timeout = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(
          new Error(
            `Browser command "${command}" timed out after ${timeoutMs / 1000}s. Is the Chrome extension connected?`,
          ),
        );
      }
    }, timeoutMs);

    pendingRequests.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timeout,
      lastActivity: Date.now(),
    });

    const request = {
      id,
      type: "message",
      channel: targetChannel,
      message: { id, command, params: { ...(params as any), commandId: id } },
    };

    logger.info(`Sending browser command: ${command}`);
    ws!.send(JSON.stringify(request));
  }) as Promise<T>;
}
