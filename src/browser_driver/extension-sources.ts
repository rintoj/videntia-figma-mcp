import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EXTENSION_SCRIPT_FILES = ["background.js", "cdp.js", "config.js", "content.js"] as const;

export interface ExtensionSources {
  background: string;
  content: string;
  /** What background.js may pull in via importScripts. */
  importable: Record<string, string>;
}

/**
 * The extension's own scripts, read at runtime so the driver runs exactly the code the
 * extension runs: `src/chrome_extension/` in a checkout, `dist/browser-driver-scripts/`
 * (copied by build:driver) next to the bundle. Read as files rather than Bun text
 * imports, which replace the module in Bun's registry and break `require` of cdp.js.
 */
export function loadExtensionSources(here = dirname(fileURLToPath(import.meta.url))): ExtensionSources {
  const candidates = [join(here, "browser-driver-scripts"), join(here, "../chrome_extension")];
  const dir = candidates.find((d) => EXTENSION_SCRIPT_FILES.every((f) => existsSync(join(d, f))));
  if (!dir) throw new Error(`Extension scripts not found; looked in ${candidates.join(", ")}`);
  const read = (f: string) => readFileSync(join(dir, f), "utf-8");
  return {
    background: read("background.js"),
    content: read("content.js"),
    importable: { "config.js": read("config.js"), "cdp.js": read("cdp.js") },
  };
}
