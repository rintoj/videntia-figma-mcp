import { connectCdp } from "./cdp-connection.js";
import { createCommandRouter } from "./command-router.js";
import {
  DEFAULT_STATE_DIR,
  isProcessAlive,
  listDriverStates,
  readDriverState,
  removeDriverState,
  stateFilePath,
  writeDriverState,
  type DriverState,
} from "./driver-state.js";
import { launchChrome, type LaunchedBrowser } from "./launcher.js";
import { createRelayClient } from "./relay-client.js";
import { parseArgs, parseDuration, type ParsedArgs } from "./utils.js";

const DEFAULT_RELAY_URL = "ws://localhost:3055";
const DEFAULT_IDLE_TIMEOUT = "30m";
const BOOLEAN_FLAGS = new Set(["headful", "reduce-motion", "offline", "json", "help"]);

const USAGE = `Usage:
  videntia-browser-driver start --id <id> [options]
  videntia-browser-driver stop --id <id>
  videntia-browser-driver list [--json]

Options for start:
  --relay <url>              Relay WebSocket URL (default: ${DEFAULT_RELAY_URL})
  --executable <path>        Chrome/Chromium executable instead of Chrome for Testing
  --chrome-version <build>   Chrome for Testing build id (default: pinned build)
  --cdp-url <url>            Attach to a running browser (ws://… or http://host:port)
  --headful                  Show the browser window
  --reduce-motion            Force prefers-reduced-motion: reduce
  --offline                  Never download Chrome for Testing
  --idle-timeout <duration>  Exit after no commands for this long, 0 disables (default: ${DEFAULT_IDLE_TIMEOUT})`;

const log = (...args: unknown[]) => console.error("[browser-driver]", ...args);

async function start(args: ParsedArgs, stateDir: string): Promise<number> {
  const id = typeof args.id === "string" ? args.id : "";
  if (!id) {
    console.error("start requires --id <id>");
    return 2;
  }
  stateFilePath(id, stateDir);
  const existing = readDriverState(id, stateDir);
  if (existing && isProcessAlive(existing.pid)) {
    console.error(`A driver with id "${id}" is already running (pid ${existing.pid}). Stop it first.`);
    return 1;
  }
  const relayUrl = typeof args.relay === "string" ? args.relay : DEFAULT_RELAY_URL;
  const idleTimeoutMs = parseDuration(
    typeof args["idle-timeout"] === "string" ? args["idle-timeout"] : DEFAULT_IDLE_TIMEOUT,
  );

  let browser: LaunchedBrowser | null = null;
  let shuttingDown = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let state: DriverState | null = null;
  let relay: ReturnType<typeof createRelayClient> | null = null;
  let disposeRouter: () => void = () => {};
  let closeTransport: () => void = () => {};

  const shutdown = async (code: number, reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`shutting down (${reason})`);
    if (idleTimer) clearTimeout(idleTimer);
    relay?.stop();
    disposeRouter();
    closeTransport();
    try {
      await browser?.close();
    } catch (e) {
      log("error closing Chrome:", e);
    }
    removeDriverState(id, process.pid, stateDir);
    process.exit(code);
  };
  process.once("SIGINT", () => void shutdown(0, "SIGINT"));
  process.once("SIGTERM", () => void shutdown(0, "SIGTERM"));
  process.once("SIGHUP", () => void shutdown(0, "SIGHUP"));

  const resetIdle = () => {
    if (!idleTimeoutMs) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => void shutdown(0, `idle for ${args["idle-timeout"] ?? DEFAULT_IDLE_TIMEOUT}`),
      idleTimeoutMs,
    );
  };
  const saveState = (patch: Partial<DriverState>) => {
    if (!state || shuttingDown) return;
    state = { ...state, ...patch };
    writeDriverState(state, stateDir);
  };

  try {
    browser = await launchChrome({
      headful: args.headful === true,
      executablePath: typeof args.executable === "string" ? args.executable : undefined,
      chromeVersion: typeof args["chrome-version"] === "string" ? args["chrome-version"] : undefined,
      cdpUrl: typeof args["cdp-url"] === "string" ? args["cdp-url"] : undefined,
      reduceMotion: args["reduce-motion"] === true,
      offline: args.offline === true,
    });
    log(`Chrome ${browser.version} at ${browser.cdpUrl}`);
    const transport = await connectCdp(browser.cdpUrl);
    closeTransport = () => transport.close();
    transport.onEvent((method) => {
      if (method === "Driver.connectionClosed") void shutdown(1, "lost the CDP connection to Chrome");
    });
    const router = await createCommandRouter(transport);
    disposeRouter = () => router.dispose();

    state = {
      id,
      pid: process.pid,
      chromePid: browser.pid,
      cdpUrl: browser.cdpUrl,
      relayUrl,
      relayStatus: "connecting",
      userDataDir: browser.userDataDir,
      startedAt: Date.now(),
      lastCommandAt: null,
    };
    writeDriverState(state, stateDir);

    relay = createRelayClient({
      relayUrl,
      browserId: id,
      browserLabel: `Chrome for Testing ${browser.version} · ${id}`,
      onCommand: (command, params) => {
        resetIdle();
        saveState({ lastCommandAt: Date.now() });
        return router.handle(command, params);
      },
      onStatus: (relayStatus) => saveState({ relayStatus }),
      onGiveUp: (e) => void shutdown(1, `relay unreachable: ${e.message}`),
    });
    await relay.start();
    resetIdle();
    log(`driver "${id}" joined ${relayUrl} (pid ${process.pid})`);
    return -1;
  } catch (e) {
    log(`failed to start: ${e instanceof Error ? e.message : e}`);
    await shutdown(1, "startup failed");
    return 1;
  }
}

async function stop(args: ParsedArgs, stateDir: string): Promise<number> {
  const id = typeof args.id === "string" ? args.id : "";
  if (!id) {
    console.error("stop requires --id <id>");
    return 2;
  }
  const state = readDriverState(id, stateDir);
  if (!state) {
    console.error(`No driver with id "${id}"`);
    return 1;
  }
  if (!isProcessAlive(state.pid)) {
    removeDriverState(id, undefined, stateDir);
    console.log(`Driver "${id}" was not running; removed its stale state file`);
    return 0;
  }
  process.kill(state.pid, "SIGTERM");
  const deadline = Date.now() + 10000;
  while (isProcessAlive(state.pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  if (isProcessAlive(state.pid)) {
    process.kill(state.pid, "SIGKILL");
    if (state.chromePid && isProcessAlive(state.chromePid)) process.kill(state.chromePid, "SIGKILL");
  }
  removeDriverState(id, undefined, stateDir);
  console.log(`Stopped driver "${id}"`);
  return 0;
}

function list(args: ParsedArgs, stateDir: string): number {
  const drivers = listDriverStates(stateDir);
  if (args.json === true) {
    console.log(JSON.stringify(drivers, null, 2));
    return 0;
  }
  if (!drivers.length) {
    console.log("No drivers");
    return 0;
  }
  for (const d of drivers) {
    const last = d.lastCommandAt ? `${Math.round((Date.now() - d.lastCommandAt) / 1000)}s ago` : "never";
    console.log(
      `${d.id}\t${d.alive ? d.relayStatus : "dead"}\tpid ${d.pid}\tchrome ${d.chromePid ?? "attached"}\tlast command ${last}`,
    );
  }
  return 0;
}

/** Returns an exit code, or -1 when `start` leaves the driver running. */
export async function main(argv: string[], stateDir = DEFAULT_STATE_DIR): Promise<number> {
  const args = parseArgs(argv, BOOLEAN_FLAGS);
  const [command] = args._;
  try {
    if (command === "start") return await start(args, stateDir);
    if (command === "stop") return await stop(args, stateDir);
    if (command === "list") return list(args, stateDir);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  console.error(USAGE);
  return command === undefined || args.help === true ? 0 : 2;
}
