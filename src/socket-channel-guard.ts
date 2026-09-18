/**
 * Whether a message must be rejected because the channel has no client capable
 * of executing it.
 *
 * A write issued against a channel whose Figma plugin has gone away (the user
 * closed the plugin, or the channel is left over from a previous session) used
 * to be broadcast to whatever non-plugin clients remained — another MCP session,
 * a stale relay socket — and then silently time out, or, mid-batch, half-apply.
 * Nothing but a plugin can execute a Figma command, so the relay fails the
 * command immediately instead.
 *
 * Channels serving the Chrome extension are exempt: there the executing peer is
 * an extension, not a plugin. So is a message sent BY a plugin or extension —
 * those are replies travelling back to the waiting MCP client.
 */
export interface ChannelPeer {
  _isPlugin?: boolean;
  _isExtension?: boolean;
  /** Identity the plugin socket reported at join time, stamped by the relay. */
  _fileName?: string;
  _fileKey?: string;
}

/** The file a channel is registered to. */
export interface ChannelFile {
  fileName?: string;
  fileKey?: string;
}

export function isStaleChannelSend(sender: ChannelPeer, peers: Iterable<ChannelPeer>): boolean {
  if (sender._isPlugin || sender._isExtension) return false;
  for (const peer of peers) {
    if (peer._isPlugin || peer._isExtension) return false;
  }
  return true;
}

export function staleChannelError(channelName: string): string {
  return (
    `Channel "${channelName}" has no plugin attached — reopen the Claude MCP Plugin in Figma ` +
    `(Plugins › Claude MCP Plugin) for that file, then re-run get_open_channels and join_channel. ` +
    `No changes were applied.`
  );
}

/**
 * Whether a plugin peer belongs to the file the channel is registered to.
 *
 * Deliberately lenient in one direction: when either side carries no
 * discriminator at all (an older plugin build that reports neither fileKey nor
 * fileName, or a channel that was never claimed), the peer is treated as a
 * match rather than locked out. A mismatch is only ever declared on evidence.
 */
export function peerMatchesChannelFile(peer: ChannelPeer, channel: ChannelFile): boolean {
  if (peer._fileKey && channel.fileKey) return peer._fileKey === channel.fileKey;
  if (peer._fileName && channel.fileName) return peer._fileName === channel.fileName;
  return true;
}

/**
 * Split a channel's plugin peers into those that belong to the channel's
 * registered file and those that do not. A command must only ever be routed to
 * the matching ones — routing to a plugin in a different Figma file applies the
 * write to the wrong document, and nothing downstream can tell.
 */
export function partitionPluginPeers<T extends ChannelPeer>(
  peers: Iterable<T>,
  channel: ChannelFile,
): { plugins: T[]; matching: T[]; mismatched: T[] } {
  const plugins: T[] = [];
  const matching: T[] = [];
  const mismatched: T[] = [];
  for (const peer of peers) {
    if (!peer._isPlugin) continue;
    plugins.push(peer);
    if (peerMatchesChannelFile(peer, channel)) matching.push(peer);
    else mismatched.push(peer);
  }
  return { plugins, matching, mismatched };
}

/** Label a file identity for an error message. */
function describeFile(identity: ChannelFile | ChannelPeer | undefined): string {
  if (!identity) return "unknown";
  const named = (identity as ChannelFile).fileName ?? (identity as ChannelPeer)._fileName;
  const keyed = (identity as ChannelFile).fileKey ?? (identity as ChannelPeer)._fileKey;
  return named ?? keyed ?? "unknown";
}

/**
 * Error for a channel that HAS a plugin attached, but none belonging to the file
 * the channel is registered to — the exact shape of the incident this guards:
 * a channel advertised as one file, answered by the plugin of another.
 */
export function channelFileMismatchError(
  channelName: string,
  channel: ChannelFile | undefined,
  attached: ChannelPeer | ChannelFile | undefined,
): string {
  return (
    `Channel "${channelName}" is registered to the Figma file "${describeFile(channel)}", but the plugin ` +
    `attached to it is running in "${describeFile(attached)}". Refusing to run the command: it would have ` +
    `been applied to the wrong file. Close and re-run the Videntia plugin in "${describeFile(channel)}", ` +
    `then re-run get_open_channels and join_channel. No changes were applied.`
  );
}

export type ChannelSendDecision<T> = { kind: "deliver"; recipients: T[] } | { kind: "refuse"; error: string };

/**
 * Decide who, among a channel's peers, may receive a Figma command.
 *
 * Plugin peers in a different file than the channel is registered to are never
 * a legitimate target: node ids are unique only within a file, so their replies
 * apply the write to the wrong document and still report success. When the
 * channel has plugin peers but not one of them matches, the command is refused
 * outright rather than broadcast in the hope that the right one answers first.
 */
export function decideChannelSend<T extends ChannelPeer>(
  channelName: string,
  peers: Iterable<T>,
  channel: ChannelFile,
): ChannelSendDecision<T> {
  const all = [...peers];
  const { plugins, mismatched } = partitionPluginPeers(all, channel);
  if (plugins.length > 0 && plugins.length === mismatched.length) {
    return { kind: "refuse", error: channelFileMismatchError(channelName, channel, mismatched[0]) };
  }
  const blocked = new Set<T>(mismatched);
  return { kind: "deliver", recipients: all.filter((peer) => !blocked.has(peer)) };
}
