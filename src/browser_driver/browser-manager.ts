import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expandHome } from "./utils.js";
import type { RelayClient } from "./relay-client.js";

const STATE_DIR = expandHome("~/.cache/videntia/drivers");

export interface BrowserManagerOptions {
  browserId: string;
  pid: number;
  cdpUrl: string;
  relayClient: RelayClient;
  idleTimeout?: number; // milliseconds, default 30 minutes
}

export interface DriverState {
  id: string;
  pid: number;
  cdpUrl: string;
  relayStatus: "connected" | "connecting" | "disconnected";
  uptime: number; // seconds
  lastCommand: number; // timestamp
  createdAt: number; // timestamp
}

/**
 * Manages the Chrome process lifecycle, keep-alive, and state tracking.
 */
export async function createBrowserManager(options: BrowserManagerOptions): Promise<void> {
  const { browserId, pid, cdpUrl, relayClient, idleTimeout = 30 * 60 * 1000 } = options;

  // Ensure state directory exists
  await mkdir(STATE_DIR, { recursive: true });

  const stateFile = join(STATE_DIR, `${browserId}.json`);
  const startTime = Date.now();

  async function updateState(relayStatus: DriverState["relayStatus"]): Promise<void> {
    const state: DriverState = {
      id: browserId,
      pid,
      cdpUrl,
      relayStatus,
      uptime: Math.round((Date.now() - startTime) / 1000),
      lastCommand: Date.now(),
      createdAt: startTime,
    };

    try {
      await writeFile(stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      console.error(`[browser-manager] Failed to write state file: ${error}`);
    }
  }

  async function initialize(): Promise<void> {
    console.log(`[browser-manager] Initializing driver ${browserId}`);
    await updateState("connecting");

    // Start keep-alive timer
    const keepAliveInterval = setInterval(async () => {
      if (relayClient) {
        relayClient.sendResponse("keep-alive-" + Date.now());
      }
      await updateState("connected");
    }, 30000); // 30 seconds

    // Start idle timeout timer
    let idleTimer: NodeJS.Timeout | null = null;

    function resetIdleTimer(): void {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        console.log(
          `[browser-manager] Idle timeout (${idleTimeout}ms) reached, shutting down...`,
        );
        cleanup();
        process.exit(0);
      }, idleTimeout);
    }

    // Hook into relay client to track command activity
    const originalOnCommand = relayClient.onCommand.bind(relayClient);
    relayClient.onCommand = (handler) => {
      originalOnCommand((cmd) => {
        resetIdleTimer();
        return handler(cmd);
      });
    };

    resetIdleTimer();

    // Cleanup on exit
    async function cleanup(): Promise<void> {
      console.log(`[browser-manager] Cleaning up driver ${browserId}`);

      if (keepAliveInterval) clearInterval(keepAliveInterval);
      if (idleTimer) clearTimeout(idleTimer);

      try {
        await relayClient.disconnect();
      } catch (error) {
        console.error(`[browser-manager] Error disconnecting relay: ${error}`);
      }

      try {
        if (existsSync(stateFile)) {
          await unlink(stateFile);
        }
      } catch (error) {
        console.error(`[browser-manager] Error removing state file: ${error}`);
      }
    }

    // Handle process signals
    process.on("SIGINT", () => {
      console.log("[browser-manager] Received SIGINT");
      cleanup();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      console.log("[browser-manager] Received SIGTERM");
      cleanup();
      process.exit(0);
    });

    await updateState("connected");
    console.log(`[browser-manager] Driver ${browserId} initialized successfully`);
  }

  await initialize();
}

/**
 * Read the state of a driver by ID
 */
export async function readDriverState(browserId: string): Promise<DriverState | null> {
  const stateFile = join(STATE_DIR, `${browserId}.json`);

  if (!existsSync(stateFile)) {
    return null;
  }

  try {
    const data = await readFile(stateFile, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`[browser-manager] Error reading state file: ${error}`);
    return null;
  }
}

/**
 * List all active drivers
 */
export async function listActiveDrivers(): Promise<DriverState[]> {
  try {
    await mkdir(STATE_DIR, { recursive: true });

    if (!existsSync(STATE_DIR)) {
      return [];
    }

    const files = await import("node:fs/promises").then((fs) =>
      fs.readdir(STATE_DIR),
    );

    const drivers: DriverState[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      try {
        const data = await readFile(join(STATE_DIR, file), "utf-8");
        const state = JSON.parse(data);
        drivers.push(state);
      } catch (error) {
        console.error(`[browser-manager] Error reading ${file}: ${error}`);
      }
    }

    return drivers;
  } catch (error) {
    console.error(`[browser-manager] Error listing drivers: ${error}`);
    return [];
  }
}

/**
 * Remove a driver's state file
 */
export async function removeDriverState(browserId: string): Promise<void> {
  const stateFile = join(STATE_DIR, `${browserId}.json`);

  try {
    if (existsSync(stateFile)) {
      await unlink(stateFile);
    }
  } catch (error) {
    console.error(`[browser-manager] Error removing state file: ${error}`);
  }
}
