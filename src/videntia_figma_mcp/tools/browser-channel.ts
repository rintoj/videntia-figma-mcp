import { z } from "zod";
import { getOpenChannels, sendCommandToChannel } from "../utils/websocket.js";
import { BrowserCommand } from "../types/index.js";

/** Relay channel every browser command travels on. */
export const BROWSER_CHANNEL = "browser";

/**
 * Optional routing target identifying WHICH connected browser (Chrome profile)
 * should execute a browser command. Passed to the relay at envelope level; it
 * never reaches the extension's command params.
 */
export const browserIdSchema = z
  .string()
  .optional()
  .describe(
    "ID of the specific connected browser (Chrome profile) to target. Obtain IDs from list_connected_browsers. Required only when more than one browser is connected — with a single browser connected it can be omitted. When two or more browsers are connected and this is omitted, the relay rejects the command as ambiguous.",
  );

/** Optional Chrome tab to target within the selected browser. */
export const tabIdSchema = z
  .number()
  .int()
  .optional()
  .describe(
    "Optional Chrome tab ID to target. The tab does NOT need to be focused or visible — all browser tools work on background tabs via CDP. When omitted, the extension uses its pinned tab (set via the popup) or falls back to the active tab in the focused window; pass an explicit tab ID for any multi-step workflow so commands never leak onto whichever tab the user has focused. Use browser_list_tabs to discover tab IDs.",
  );

/** One connected browser (Chrome profile) as reported by the relay. */
export interface ConnectedBrowser {
  id: string;
  label: string;
  joinedAt: number;
}

/**
 * List the browsers currently connected to the relay's "browser" channel.
 * @returns Connected browsers, or an empty array when none are connected.
 */
export async function listConnectedBrowsers(): Promise<ConnectedBrowser[]> {
  const channels = await getOpenChannels();
  const entry = channels.find((ch) => ch.channel === BROWSER_CHANNEL);
  return entry?.browsers ?? [];
}

/**
 * Send a command to the browser channel, optionally routed to one specific
 * browser via `params.browserId`. Thin pass-through: all resolution policy
 * (unknown target, ambiguity when several browsers are connected) lives in the
 * relay, whose error is surfaced verbatim to the caller.
 */
export function sendBrowserCommand<T = unknown>(
  command: BrowserCommand,
  params: Record<string, unknown> = {},
  timeoutMs?: number,
): Promise<T> {
  return timeoutMs === undefined
    ? sendCommandToChannel<T>(BROWSER_CHANNEL, command, params)
    : sendCommandToChannel<T>(BROWSER_CHANNEL, command, params, timeoutMs);
}
