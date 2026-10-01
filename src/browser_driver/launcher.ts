import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Browser, computeExecutablePath, detectBrowserPlatform, install } from "@puppeteer/browsers";
import { expandHome } from "./utils.js";

export const DEFAULT_CHROME_BUILD = "145.0.7632.77";
export const CHROME_CACHE_DIR = expandHome("~/.cache/videntia/chrome");
const PUPPETEER_CACHE_DIR = expandHome("~/.cache/puppeteer");

export interface LauncherOptions {
  headful?: boolean;
  executablePath?: string;
  chromeVersion?: string;
  reduceMotion?: boolean;
  cdpUrl?: string;
  /** Skip downloading Chrome for Testing; fail if it is not already installed. */
  offline?: boolean;
}

export interface LaunchedBrowser {
  cdpUrl: string;
  /** Chrome's pid, or null when attached to an existing browser via --cdp-url. */
  pid: number | null;
  version: string;
  userDataDir: string | null;
  close(): Promise<void>;
}

export function chromeLaunchArgs(userDataDir: string, options: LauncherOptions = {}): string[] {
  const args = [
    `--user-data-dir=${userDataDir}`,
    "--remote-debugging-port=0",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--font-render-hinting=none",
    "--disable-gpu-vsync",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--no-first-run",
    "--no-default-browser-check",
    "--screen-info={0,0 7680x4320}",
    "about:blank",
  ];
  if (!options.headful) args.unshift("--headless=new");
  if (options.reduceMotion) args.unshift("--force-prefers-reduced-motion");
  return args;
}

/** Finds an installed Chrome for Testing build, installing it into ~/.cache/videntia/chrome unless offline. */
export async function resolveChromeExecutable(buildId: string, { offline = false } = {}): Promise<string> {
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error(`Chrome for Testing has no build for ${process.platform}/${process.arch}`);
  for (const cacheDir of [CHROME_CACHE_DIR, PUPPETEER_CACHE_DIR]) {
    const path = computeExecutablePath({ browser: Browser.CHROME, buildId, cacheDir, platform });
    if (existsSync(path)) return path;
  }
  if (offline) {
    throw new Error(
      `Chrome for Testing ${buildId} is not installed (looked in ${CHROME_CACHE_DIR} and ${PUPPETEER_CACHE_DIR})`,
    );
  }
  console.error(`[launcher] Installing Chrome for Testing ${buildId} into ${CHROME_CACHE_DIR}...`);
  const installed = await install({ browser: Browser.CHROME, buildId, cacheDir: CHROME_CACHE_DIR, platform });
  return installed.executablePath;
}

function waitForDevToolsUrl(proc: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => {
      reject(new Error(`Chrome did not print its DevTools URL within ${timeoutMs}ms:\n${stderr.slice(-2000)}`));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        proc.stderr?.off("data", onData);
        proc.stderr?.resume();
        resolve(match[1]!);
      }
    };
    proc.stderr?.on("data", onData);
    proc.once("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Failed to launch Chrome: ${e.message}`));
    });
    proc.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(`Chrome exited (code ${code}, signal ${signal}) before DevTools was ready:\n${stderr.slice(-2000)}`),
      );
    });
  });
}

async function browserVersion(cdpUrl: string): Promise<string> {
  try {
    const httpUrl = cdpUrl.replace(/^ws/, "http").replace(/\/devtools\/browser\/.*$/, "/json/version");
    const res = await fetch(httpUrl);
    const json = (await res.json()) as { Browser?: string };
    return json.Browser?.replace(/^.*\//, "") ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Resolves a `--cdp-url` that may be an http endpoint (http://host:port) to its browser websocket URL. */
async function resolveCdpUrl(cdpUrl: string): Promise<string> {
  if (/^wss?:\/\//.test(cdpUrl)) return cdpUrl;
  const res = await fetch(`${cdpUrl.replace(/\/$/, "")}/json/version`);
  const json = (await res.json()) as { webSocketDebuggerUrl?: string };
  if (!json.webSocketDebuggerUrl) throw new Error(`No webSocketDebuggerUrl at ${cdpUrl}/json/version`);
  return json.webSocketDebuggerUrl;
}

export async function launchChrome(options: LauncherOptions = {}): Promise<LaunchedBrowser> {
  if (options.cdpUrl) {
    const cdpUrl = await resolveCdpUrl(options.cdpUrl);
    return { cdpUrl, pid: null, userDataDir: null, version: await browserVersion(cdpUrl), close: async () => {} };
  }

  const executablePath =
    options.executablePath ??
    (await resolveChromeExecutable(options.chromeVersion ?? DEFAULT_CHROME_BUILD, { offline: options.offline }));
  const userDataDir = mkdtempSync(join(tmpdir(), "videntia-driver-"));
  const removeProfile = () => rmSync(userDataDir, { recursive: true, force: true });

  const proc = spawn(executablePath, chromeLaunchArgs(userDataDir, options), {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let cdpUrl: string;
  try {
    cdpUrl = await waitForDevToolsUrl(proc, 20000);
  } catch (e) {
    proc.kill("SIGKILL");
    removeProfile();
    throw e;
  }

  let closed = false;
  const exited = new Promise<void>((resolve) => {
    if (proc.exitCode !== null) resolve();
    else proc.once("exit", () => resolve());
  });

  return {
    cdpUrl,
    pid: proc.pid ?? null,
    userDataDir,
    version: await browserVersion(cdpUrl),
    async close() {
      if (closed) return;
      closed = true;
      if (proc.exitCode === null) {
        proc.kill("SIGTERM");
        const killed = await Promise.race([
          exited.then(() => true),
          new Promise((r) => setTimeout(() => r(false), 5000)),
        ]);
        if (!killed) {
          proc.kill("SIGKILL");
          await exited;
        }
      }
      removeProfile();
    },
  };
}
