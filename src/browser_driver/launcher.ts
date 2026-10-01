import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandHome } from "./utils.js";

export interface LaunchResult {
  pid: number;
  cdpUrl: string;
}

export interface LauncherOptions {
  headful?: boolean;
  executablePath?: string;
  chromeVersion?: string;
  reduceMotion?: boolean;
  cdpUrl?: string;
}

const DEFAULT_CHROME_VERSION = "127";
const CHROME_CACHE_DIR = expandHome("~/.cache/videntia/chrome");

/**
 * Ensure Chrome for Testing is installed at ~/.cache/videntia/chrome/<version>
 */
export async function ensureChromeInstalled(version: string): Promise<string> {
  const chromePath = join(CHROME_CACHE_DIR, version);

  if (existsSync(chromePath)) {
    console.log(`[launcher] Chrome ${version} already installed at ${chromePath}`);
    return chromePath;
  }

  console.log(`[launcher] Installing Chrome for Testing version ${version}...`);

  try {
    // Use @puppeteer/browsers to install Chrome
    const result = spawnSync("npx", ["@puppeteer/browsers", "install", `chrome@${version}`], {
      cwd: CHROME_CACHE_DIR,
      stdio: "inherit",
      env: { ...process.env, PUPPETEER_CACHE_DIR: CHROME_CACHE_DIR },
    });

    if (result.status !== 0) {
      throw new Error(`Chrome installation failed with code ${result.status}`);
    }

    console.log(`[launcher] Chrome ${version} installed successfully`);
    return chromePath;
  } catch (error) {
    throw new Error(`Failed to install Chrome for Testing: ${error}`);
  }
}

/**
 * Find the Chrome executable within the installed version directory
 */
export function findChromeExecutable(chromePath: string): string {
  const possiblePaths = [
    join(chromePath, "chrome-linux64", "chrome"),
    join(chromePath, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
    join(chromePath, "chrome-win64", "chrome.exe"),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  throw new Error(`Chrome executable not found in ${chromePath}`);
}

/**
 * Launch Chrome for Testing with debugging port
 */
export async function launchChrome(options: LauncherOptions): Promise<LaunchResult> {
  // If attaching to existing browser
  if (options.cdpUrl) {
    console.log(`[launcher] Attaching to existing browser at ${options.cdpUrl}`);
    return { pid: -1, cdpUrl: options.cdpUrl };
  }

  const userDataDir = mkdtempSync(join(tmpdir(), "videntia-driver-"));
  console.log(`[launcher] User data directory: ${userDataDir}`);

  let executablePath = options.executablePath;
  if (!executablePath) {
    const version = options.chromeVersion || DEFAULT_CHROME_VERSION;
    const chromePath = await ensureChromeInstalled(version);
    executablePath = findChromeExecutable(chromePath);
  }

  console.log(`[launcher] Using executable: ${executablePath}`);

  const launchArgs = [
    options.headful ? "--headless=false" : "--headless=new",
    `--user-data-dir=${userDataDir}`,
    "--remote-debugging-port=0",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--font-render-hinting=none",
    "--disable-gpu-vsync",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--no-first-run",
    "--no-default-browser-check",
  ];

  if (options.reduceMotion) {
    launchArgs.push("--force-prefers-reduced-motion");
  }

  console.log(`[launcher] Launching with args: ${launchArgs.join(" ")}`);

  return new Promise((resolve, reject) => {
    const proc = spawn(executablePath!, launchArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    let portFound = false;
    let debuggingUrl = "";

    const timeout = setTimeout(() => {
      if (!portFound) {
        proc.kill();
        reject(new Error("Chrome launch timeout: debugging port not found within 10s"));
      }
    }, 10000);

    proc.stderr?.on("data", (data) => {
      const stderr = data.toString();
      console.log(`[launcher:stderr] ${stderr}`);

      // Parse the debugging port from stderr
      // Chrome outputs: "DevTools listening on ws://127.0.0.1:PORT"
      if (!portFound) {
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          debuggingUrl = match[1];
          portFound = true;
          clearTimeout(timeout);
          console.log(`[launcher] Chrome debugging port: ${debuggingUrl}`);
          resolve({
            pid: proc.pid!,
            cdpUrl: debuggingUrl,
          });
        }
      }
    });

    proc.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to launch Chrome: ${error.message}`));
    });

    proc.on("exit", (code) => {
      if (!portFound) {
        clearTimeout(timeout);
        reject(new Error(`Chrome exited with code ${code} before debugging port was found`));
      }
    });
  });
}
