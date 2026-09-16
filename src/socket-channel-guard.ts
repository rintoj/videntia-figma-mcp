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
