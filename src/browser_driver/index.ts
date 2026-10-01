#!/usr/bin/env node

/**
 * Headless browser driver for Videntia
 *
 * Launches Chrome for Testing and connects it to the relay as a browser peer.
 * Supports starting, stopping, and listing driver instances.
 */

// Export main APIs
export type { LaunchResult, LauncherOptions } from "./launcher.js";
export { ensureChromeInstalled, findChromeExecutable, launchChrome } from "./launcher.js";

export type { RelayClientOptions, RelayClient } from "./relay-client.js";
export { createRelayClient } from "./relay-client.js";

export type { BrowserTab, CdpAdapter } from "./cdp-adapter.js";
export { createCdpAdapter } from "./cdp-adapter.js";

export type { DriverState, BrowserManagerOptions } from "./browser-manager.js";
export {
  createBrowserManager,
  listActiveDrivers,
  readDriverState,
  removeDriverState,
} from "./browser-manager.js";

export { createCommandRouter } from "./command-router.js";

export { expandHome, parseArgs, parseDuration } from "./utils.js";

// CLI is invoked from this file
import("./cli.js").catch((error) => {
  console.error("Failed to load CLI:", error);
  process.exit(1);
});
