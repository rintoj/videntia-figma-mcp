import { WebSocket } from "ws";

export interface RelayClientOptions {
  cdpUrl: string;
  relayUrl: string;
  browserId: string;
  browserLabel: string;
}

export interface CommandMessage {
  id: string;
  command: string;
  params?: any;
}

type CommandHandler = (cmd: CommandMessage) => Promise<any>;

export interface RelayClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onCommand(handler: CommandHandler): void;
  sendResponse(id: string, result?: any, error?: string): void;
}

/**
 * Creates a relay client that connects to the WebSocket relay and listens for
 * browser commands addressed to this driver's browserId.
 */
export function createRelayClient(options: RelayClientOptions): RelayClient {
  const { cdpUrl, relayUrl, browserId, browserLabel } = options;

  let ws: WebSocket | null = null;
  let commandHandler: CommandHandler | null = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 10;
  const BACKOFF_TIMES = [1000, 2000, 4000, 8000, 30000]; // ms, capped at 30s

  function getBackoffDelay(): number {
    if (reconnectAttempts >= BACKOFF_TIMES.length) {
      return BACKOFF_TIMES[BACKOFF_TIMES.length - 1];
    }
    return BACKOFF_TIMES[reconnectAttempts];
  }

  async function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log(`[relay] Connecting to ${relayUrl}...`);
        ws = new WebSocket(relayUrl);

        const timeout = setTimeout(() => {
          reject(new Error("Connection timeout"));
        }, 5000);

        ws.on("open", () => {
          clearTimeout(timeout);
          console.log("[relay] Connected to relay");
          reconnectAttempts = 0;

          // Send join message
          const joinMsg = {
            type: "join",
            channel: "browser",
            clientType: "driver",
            browserId,
            browserLabel,
          };

          console.log("[relay] Sending join message...");
          ws!.send(JSON.stringify(joinMsg));
        });

        ws.on("message", async (data) => {
          try {
            const msg = JSON.parse(data.toString());

            if (msg.type === "system") {
              // Join confirmation
              if (msg.message?.result) {
                console.log(`[relay] ${msg.message.result}`);
                resolve();
              } else if (msg.message?.error) {
                reject(new Error(`Join failed: ${msg.message.error}`));
              }
              return;
            }

            if (msg.type === "message" && msg.channel === "browser") {
              const command = msg.message;
              if (!command || !command.id) return;

              console.log(`[relay] Received command: ${command.command}`);

              try {
                if (!commandHandler) {
                  throw new Error("No command handler registered");
                }

                const result = await commandHandler(command);
                sendResponse(command.id, result);
              } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                sendResponse(command.id, undefined, errorMsg);
              }
            }
          } catch (error) {
            console.error("[relay] Message parsing error:", error);
          }
        });

        ws.on("error", (error) => {
          clearTimeout(timeout);
          console.error("[relay] WebSocket error:", error);
          reject(error);
        });

        ws.on("close", () => {
          console.log("[relay] Connection closed, attempting reconnect...");
          handleDisconnect();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function handleDisconnect(): Promise<void> {
    reconnectAttempts++;

    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[relay] Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) exceeded. Exiting.`,
      );
      process.exit(1);
    }

    const delay = getBackoffDelay();
    console.log(`[relay] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      await connect();
    } catch (error) {
      console.error("[relay] Reconnection failed:", error);
      await handleDisconnect();
    }
  }

  function disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (ws) {
        ws.close();
        ws = null;
      }
      resolve();
    });
  }

  function onCommand(handler: CommandHandler): void {
    commandHandler = handler;
  }

  function sendResponse(id: string, result?: any, error?: string): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error("[relay] Cannot send response: WebSocket not connected");
      return;
    }

    const message = {
      type: "message",
      channel: "browser",
      message: {
        id,
        ...(result !== undefined ? { result } : {}),
        ...(error ? { error } : {}),
      },
    };

    ws.send(JSON.stringify(message));
  }

  return {
    connect,
    disconnect,
    onCommand,
    sendResponse,
  };
}
