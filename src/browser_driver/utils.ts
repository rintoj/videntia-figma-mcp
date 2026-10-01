import { homedir } from "node:os";

export function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? homedir() + path.slice(1) : path;
}

export type ParsedArgs = { _: string[]; [key: string]: string | boolean | string[] };

/** Parses `--key value`, `--key=value` and bare `--flag` arguments; positionals go to `_`. */
export function parseArgs(args: string[], booleanFlags: ReadonlySet<string> = new Set()): ParsedArgs {
  const result: ParsedArgs = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) {
      result._.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      result[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = args[i + 1];
    if (!booleanFlags.has(key) && next !== undefined && !next.startsWith("--")) {
      result[key] = next;
      i++;
    } else {
      result[key] = true;
    }
  }
  return result;
}

/** "500ms", "30s", "30m", "1h" → milliseconds; "0" disables. */
export function parseDuration(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  if (!match) throw new Error(`Invalid duration "${value}". Use e.g. 30s, 30m, 1h`);
  const n = parseFloat(match[1]!);
  const unit = match[2] ?? (n === 0 ? "ms" : undefined);
  if (!unit) throw new Error(`Duration "${value}" needs a unit (ms, s, m or h)`);
  const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit as "ms" | "s" | "m" | "h"];
  return Math.round(n * factor);
}
