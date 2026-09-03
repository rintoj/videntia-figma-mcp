// Routing policy for the "browser" channel, where several Chrome profiles (one
// extension instance each) can be joined at once. Every browser announces a
// per-profile `browserId` on join; commands carry an optional `target` that
// selects exactly one of them. Kept free of `ws` imports so it stays unit
// testable with plain objects.

/** WebSocket-shaped client, narrowed to the fields routing actually reads. */
export type BrowserClientLike = {
  _browserId?: string;
  _browserLabel?: string;
  _isExtension?: boolean;
  _isPlugin?: boolean;
  _joinedAt?: number;
  readyState: number;
};

/** A connected browser profile as reported to callers (`/channels`, errors). */
export type BrowserEntry = { id: string; label: string; joinedAt: number };

/** `WebSocket.OPEN`, inlined so this module stays dependency-free. */
const OPEN = 1;

function isEligible(client: BrowserClientLike): boolean {
  return client._isExtension === true && !!client._browserId && client.readyState === OPEN;
}

/**
 * Lists the browser profiles eligible for routing, in a stable order (oldest
 * join first, ties broken by id) so error text and API output never churn.
 * `label` falls back to the id and `joinedAt` to 0 when the join omitted them.
 */
export function listBrowsers(clients: Iterable<BrowserClientLike>): BrowserEntry[] {
  const entries: BrowserEntry[] = [];
  for (const client of clients) {
    if (!isEligible(client)) continue;
    const id = client._browserId!;
    entries.push({ id, label: client._browserLabel || id, joinedAt: client._joinedAt ?? 0 });
  }
  return entries.sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
}

/** Outcome of resolving a command's `target` against the channel's clients. */
export type TargetResolution =
  | { kind: "broadcast" }
  | { kind: "single"; client: BrowserClientLike }
  | { kind: "not-found"; available: BrowserEntry[] }
  | { kind: "ambiguous"; available: BrowserEntry[] };

/**
 * Decides who a channel message should be delivered to.
 *
 * An explicit `target` is a hard routing contract: it must match a live browser
 * or the message is refused — never silently broadcast, which would hand the
 * command to whatever else shares the channel and stall until the timeout.
 * With no target and no eligible browser the channel is not a multi-profile
 * browser channel at all (every Figma/plugin channel lands here), so the caller
 * keeps its existing broadcast behaviour. With no target and several browsers
 * connected the send is ambiguous — never guess between profiles.
 *
 * A channel that holds a Figma plugin is a Figma channel, never a browser
 * channel, so an untargeted send there always broadcasts. Channel names are not
 * reserved: the plugin derives its channel from a slugged file name, so a file
 * called "Browser" joins the very channel the extension hardcodes. Without this
 * guard a plugin sharing that channel would have every untargeted Figma command
 * routed away to the extension (which ignores it) and hang until the timeout.
 */
export function resolveTarget(clients: Iterable<BrowserClientLike>, target?: string): TargetResolution {
  const all = [...clients];
  const eligible = all.filter(isEligible);

  if (target) {
    const match = eligible.find((c) => c._browserId === target);
    if (match) return { kind: "single", client: match };
    return { kind: "not-found", available: listBrowsers(all) };
  }

  const hasPlugin = all.some((c) => c._isPlugin === true && c.readyState === OPEN);
  if (hasPlugin) return { kind: "broadcast" };

  if (eligible.length === 0) return { kind: "broadcast" };
  if (eligible.length === 1) return { kind: "single", client: eligible[0]! };
  return { kind: "ambiguous", available: listBrowsers(all) };
}

// --- Channel reservation ------------------------------------------------------

/** The channel the Chrome extension hardcodes; no Figma plugin may occupy it. */
export const RESERVED_BROWSER_CHANNEL = "browser";

/**
 * Keeps Figma plugins off the reserved browser channel.
 *
 * Channel names are otherwise unreserved: the plugin derives its channel from a
 * slugged file name, so a file called "Browser" lands on the very channel the
 * extension uses. Sharing it makes every untargeted send ambiguous between two
 * unrelated protocols — the plugin answers a browser command with
 * "Command not permitted" under the *same* message id, racing (and usually
 * beating) the extension's real reply, and an untargeted Figma command is
 * either routed to the extension or duplicated across every connected browser.
 * Moving the plugin to its own channel removes the overlap at the source; the
 * caller's existing dedup pass resolves any collision on the new name.
 *
 * @param channelName - Channel the client asked to join.
 * @param isPluginJoin - Whether the join carries Figma file identity.
 * @returns The channel to actually join.
 */
export function reserveBrowserChannel(channelName: string, isPluginJoin: boolean): string {
  if (!isPluginJoin || channelName !== RESERVED_BROWSER_CHANNEL) return channelName;
  return `${RESERVED_BROWSER_CHANNEL}-figma`;
}

/** Renders browser entries for error messages: `8f3a12 (User A), c1d0ff (User B)`. */
export function formatBrowserList(entries: BrowserEntry[]): string {
  if (entries.length === 0) return "none";
  return entries.map((e) => `${e.id} (${e.label})`).join(", ");
}

// --- Identity input validation ----------------------------------------------
//
// `browserId`, `browserLabel` and a message's `target` all arrive from whatever
// client opened the socket, so none of them may be trusted. They end up stored
// on the socket, in `/channels` responses, in server log lines and in error text
// echoed back to other clients; an unbounded or control-character-laden value
// would inflate every one of those and let a client smuggle newlines into logs.

/** Max accepted length of a `browserId` and of a message's routing `target`. */
export const BROWSER_ID_MAX_LENGTH = 128;
/** Max accepted length of a `browserLabel` (matches the extension's own cap). */
export const BROWSER_LABEL_MAX_LENGTH = 64;

const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]", "g");

/**
 * Normalizes an untrusted identity string: non-strings become `undefined`,
 * control characters are stripped, and the value is trimmed then truncated to
 * `maxLength`. An empty result is reported as `undefined` so callers treat
 * "absent" and "blank" identically.
 */
export function sanitizeIdentityValue(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(CONTROL_CHARS, "").trim().slice(0, maxLength);
  return cleaned || undefined;
}
