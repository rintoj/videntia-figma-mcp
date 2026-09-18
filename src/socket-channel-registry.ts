/**
 * Pure channel bookkeeping for the relay: which channel a joining client lands
 * in, what file a channel is registered to, and what `/channels` advertises.
 *
 * Kept free of `ws` imports so it can be unit tested with plain objects — the
 * relay in `src/socket.ts` owns the sockets, this module owns the decisions.
 */
import { isSameFile } from "./socket-channel-identity";
import { listBrowsers } from "./socket-browser-registry";

export interface FileIdentity {
  fileName?: string;
  fileKey?: string;
}

export interface ChannelMeta extends FileIdentity {
  joinedAt: number;
}

/** Minimal shape of a relay socket, as far as channel bookkeeping cares. */
export interface RegistryPeer extends FileIdentity {
  readyState?: number;
  _isPlugin?: boolean;
  _isExtension?: boolean;
  _fileName?: string;
  _fileKey?: string;
}

export type ChannelMap<S> = Map<string, Set<S>>;
export type MetadataMap = Map<string, ChannelMeta>;

/** A channel is "claimed" by a file once it carries any file discriminator. */
export function isClaimed(meta: ChannelMeta | FileIdentity | undefined): boolean {
  return !!(meta && (meta.fileName || meta.fileKey));
}

/** Human-readable label for a channel's registered (or a peer's stamped) file. */
export function fileLabel(identity: FileIdentity | undefined): string {
  return identity?.fileName ?? identity?.fileKey ?? "unknown";
}

/**
 * Remove a socket from a channel, dropping the channel AND its metadata once no
 * clients remain. Leaving the metadata behind is what let `/channels` keep
 * advertising a long-dead channel under the file name it used to serve — a
 * caller then joined it and its commands were answered by a plugin in a
 * different file.
 *
 * Returns true when the channel was dropped entirely.
 */
export function leaveChannelIn<S>(channels: ChannelMap<S>, metadata: MetadataMap, channelName: string, ws: S): boolean {
  const clients = channels.get(channelName);
  if (!clients) return false;
  clients.delete(ws);
  if (clients.size > 0) return false;
  channels.delete(channelName);
  metadata.delete(channelName);
  return true;
}

/**
 * Pick the channel name a joining plugin should land in.
 *
 * The decision consults the REGISTERED metadata, not live membership: a channel
 * whose plugin socket has momentarily gone away is still registered to its file,
 * and a plugin from a different file must not be allowed to take the name over.
 * Re-joining for the same file always keeps the requested name (the normal
 * plugin-reconnect path).
 */
export function resolveJoinChannelName(metadata: MetadataMap, requested: string, identity: FileIdentity): string {
  const fits = (name: string): boolean => {
    const meta = metadata.get(name);
    return !isClaimed(meta) || isSameFile(meta!, identity);
  };
  if (!isClaimed(identity) || fits(requested)) return requested;
  let counter = 2;
  for (;;) {
    const candidate = `${requested}-${counter++}`;
    if (fits(candidate)) return candidate;
  }
}

/**
 * Record a join against a channel's metadata.
 *
 * A join may CLAIM an unclaimed channel and may refine its own identity (adding
 * a fileKey to a fileName-only registration), but it may never repoint a channel
 * at a different file — that silent repoint is how a channel came to advertise
 * one file while serving another.
 */
export function applyJoinMetadata(
  metadata: MetadataMap,
  channelName: string,
  identity: FileIdentity,
  now: number = Date.now(),
): { meta: ChannelMeta; repointRejected: boolean } {
  const existing = metadata.get(channelName);
  if (!existing) {
    const meta: ChannelMeta = { fileName: identity.fileName, fileKey: identity.fileKey, joinedAt: now };
    metadata.set(channelName, meta);
    return { meta, repointRejected: false };
  }
  if (!isClaimed(identity)) return { meta: existing, repointRejected: false };
  if (isClaimed(existing) && !isSameFile(existing, identity)) {
    return { meta: existing, repointRejected: true };
  }
  if (identity.fileName) existing.fileName = identity.fileName;
  if (identity.fileKey) existing.fileKey = identity.fileKey;
  return { meta: existing, repointRejected: false };
}

export interface ChannelDescription {
  channel: string;
  clients: number;
  pluginClients: number;
  hasPlugin: boolean;
  extensionClients: number;
  hasExtension: boolean;
  browsers: ReturnType<typeof listBrowsers>;
  fileName: string | null;
  fileKey: string | null;
  joinedAt: number | null;
}

/** What `/channels` advertises. Only live channels are ever listed. */
export function describeChannels<S extends RegistryPeer>(
  channels: ChannelMap<S>,
  metadata: MetadataMap,
): ChannelDescription[] {
  return [...channels.entries()].map(([name, clients]) => {
    const clientArr = [...clients];
    const pluginClients = clientArr.filter((c) => c._isPlugin).length;
    const extensionClients = clientArr.filter((c) => c._isExtension).length;
    const meta = metadata.get(name);
    return {
      channel: name,
      clients: clients.size,
      pluginClients,
      hasPlugin: pluginClients > 0,
      extensionClients,
      hasExtension: extensionClients > 0,
      browsers: listBrowsers(clientArr as unknown as any[]),
      fileName: meta?.fileName ?? null,
      fileKey: meta?.fileKey ?? null,
      joinedAt: meta?.joinedAt ?? null,
    };
  });
}
