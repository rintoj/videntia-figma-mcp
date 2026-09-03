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
 * With no eligible browser present the channel is not a multi-profile browser
 * channel at all (every Figma/plugin channel lands here), so the caller keeps
 * its existing broadcast behaviour. Otherwise an explicit `target` must match a
 * live browser, and an omitted `target` only resolves when a single browser is
 * connected — never guess between profiles.
 */
export function resolveTarget(clients: Iterable<BrowserClientLike>, target?: string): TargetResolution {
  const all = [...clients];
  const eligible = all.filter(isEligible);
  if (eligible.length === 0) return { kind: "broadcast" };

  if (target) {
    const match = eligible.find((c) => c._browserId === target);
    if (match) return { kind: "single", client: match };
    return { kind: "not-found", available: listBrowsers(all) };
  }

  if (eligible.length === 1) return { kind: "single", client: eligible[0]! };
  return { kind: "ambiguous", available: listBrowsers(all) };
}

/** Renders browser entries for error messages: `8f3a12 (User A), c1d0ff (User B)`. */
export function formatBrowserList(entries: BrowserEntry[]): string {
  if (entries.length === 0) return "none";
  return entries.map((e) => `${e.id} (${e.label})`).join(", ");
}
