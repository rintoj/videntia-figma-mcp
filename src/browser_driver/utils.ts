import { homedir } from "node:os";

/**
 * Expand ~ to the user's home directory
 */
export function expandHome(path: string): string {
  if (path.startsWith("~")) {
    return path.replace("~", homedir());
  }
  return path;
}

/**
 * Parse command-line arguments into key-value pairs
 */
export function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const key = arg.slice(2);

      // Check if next arg is a value or another flag
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        result[key] = args[i + 1];
        i++;
      } else {
        result[key] = true;
      }
    }
  }

  return result;
}

/**
 * Parse a duration string like "30m" or "5s" into milliseconds
 */
export function parseDuration(durationStr: string): number {
  const match = durationStr.match(/^(\d+)([smh])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${durationStr}. Expected format: <number>[s|m|h]`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown time unit: ${unit}`);
  }
}
