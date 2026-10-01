import { spawn } from "node:child_process";
import { findSync } from "node:fs";
import { parseArgs, parseDuration, expandHome } from "./utils.js";
import {
  launchChrome,
  findChromeExecutable,
  ensureChromeInstalled,
} from "./launcher.js";
import { createRelayClient } from "./relay-client.js";
import { createBrowserManager, listActiveDrivers, removeDriverState, readDriverState } from "./browser-manager.js";
import { createCdpAdapter } from "./cdp-adapter.js";
import { createCommandRouter } from "./command-router.js";

const DEFAULT_RELAY_URL = "ws://localhost:3055";
const DEFAULT_IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes

async function startDriver(parsedArgs: Record<string, string | boolean>): Promise<void> {
  const browserId = parsedArgs.id as string;
  if (!browserId) {
    console.error("Error: --id is required");
    process.exit(1);
  }

  const relayUrl = (parsedArgs.relay as string) || DEFAULT_RELAY_URL;
  const executablePath = parsedArgs.executable as string | undefined;
  const chromeVersion = parsedArgs["chrome-version"] as string | undefined;
  const headful = parsedArgs.headful === true;
  const reduceMotion = parsedArgs["reduce-motion"] === true;
  const cdpUrl = parsedArgs["cdp-url"] as string | undefined;

  let idleTimeout = DEFAULT_IDLE_TIMEOUT;
  if (parsedArgs["idle-timeout"]) {
    idleTimeout = parseDuration(parsedArgs["idle-timeout"] as string);
  }

  console.log(`[cli:start] Starting driver ${browserId}`);
  console.log(`[cli:start] Relay URL: ${relayUrl}`);
  console.log(`[cli:start] Idle timeout: ${idleTimeout}ms`);

  try {
    // Launch Chrome or attach to existing
    console.log("[cli:start] Launching Chrome...");
    const launchResult = await launchChrome({
      headful,
      executablePath,
      chromeVersion,
      reduceMotion,
      cdpUrl,
    });

    console.log(`[cli:start] Chrome launched: pid=${launchResult.pid}, cdpUrl=${launchResult.cdpUrl}`);

    // Create CDP adapter
    console.log("[cli:start] Creating CDP adapter...");
    const cdpAdapter = await createCdpAdapter(launchResult.cdpUrl);

    // Create relay client
    const browserLabel = `Chrome for Testing${chromeVersion ? ` ${chromeVersion}` : ""} · ${browserId}`;
    const relayClient = createRelayClient({
      cdpUrl: launchResult.cdpUrl,
      relayUrl,
      browserId,
      browserLabel,
    });

    // Create command router
    const commandRouter = createCommandRouter(cdpAdapter);

    // Hook relay client to router
    relayClient.onCommand(async (cmd) => {
      return commandRouter.handle(cmd);
    });

    // Connect to relay
    console.log("[cli:start] Connecting to relay...");
    await relayClient.connect();

    // Start browser manager
    console.log("[cli:start] Starting browser manager...");
    await createBrowserManager({
      browserId,
      pid: launchResult.pid,
      cdpUrl: launchResult.cdpUrl,
      relayClient,
      idleTimeout,
    });

    console.log(`[cli:start] Driver ${browserId} is running`);
  } catch (error) {
    console.error(`[cli:start] Failed to start driver: ${error}`);
    process.exit(1);
  }
}

async function stopDriver(parsedArgs: Record<string, string | boolean>): Promise<void> {
  const browserId = parsedArgs.id as string;
  if (!browserId) {
    console.error("Error: --id is required");
    process.exit(1);
  }

  console.log(`[cli:stop] Stopping driver ${browserId}...`);

  try {
    const state = await readDriverState(browserId);

    if (!state) {
      console.error(`Driver ${browserId} not found`);
      process.exit(1);
    }

    console.log(`[cli:stop] Found driver process: pid=${state.pid}`);

    try {
      process.kill(state.pid);
      console.log(`[cli:stop] Killed process ${state.pid}`);

      // Give it a moment to exit
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`[cli:stop] Error killing process: ${error}`);
    }

    // Clean up state file
    await removeDriverState(browserId);
    console.log(`[cli:stop] Removed state file for ${browserId}`);
  } catch (error) {
    console.error(`[cli:stop] Error: ${error}`);
    process.exit(1);
  }
}

async function listDrivers(): Promise<void> {
  console.log("[cli:list] Active drivers:");

  const drivers = await listActiveDrivers();

  if (drivers.length === 0) {
    console.log("  (none)");
    return;
  }

  for (const driver of drivers) {
    const status = driver.relayStatus;
    const uptime = driver.uptime;
    const ago = Math.round((Date.now() - driver.lastCommand) / 1000);

    console.log(`  ${driver.id}`);
    console.log(`    PID: ${driver.pid}`);
    console.log(`    Status: ${status}`);
    console.log(`    Uptime: ${uptime}s`);
    console.log(`    Last command: ${ago}s ago`);
    console.log(`    CDP URL: ${driver.cdpUrl}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage:");
    console.error("  videntia-browser-driver start --id <id> [options]");
    console.error("  videntia-browser-driver stop --id <id>");
    console.error("  videntia-browser-driver list");
    console.error("");
    console.error("Options for start:");
    console.error("  --relay <url>              Relay WebSocket URL (default: ws://localhost:3055)");
    console.error("  --executable <path>        Path to Chrome executable");
    console.error("  --chrome-version <v>       Chrome for Testing version (default: 127)");
    console.error("  --headful                  Run in headful mode (default: headless)");
    console.error("  --reduce-motion            Enable reduced motion media features");
    console.error("  --cdp-url <url>            Attach to existing browser at CDP URL");
    console.error("  --idle-timeout <duration>  Idle timeout (e.g., 30m, 5s, 1h)");
    process.exit(1);
  }

  const command = args[0];
  const commandArgs = args.slice(1);
  const parsedArgs = parseArgs(commandArgs);

  try {
    if (command === "start") {
      await startDriver(parsedArgs);
    } else if (command === "stop") {
      await stopDriver(parsedArgs);
    } else if (command === "list") {
      await listDrivers();
    } else {
      console.error(`Unknown command: ${command}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

main();
