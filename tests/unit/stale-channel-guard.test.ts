import { isStaleChannelSend, staleChannelError } from "../../src/socket-channel-guard";

const mcp = {};
const plugin = { _isPlugin: true };
const extension = { _isExtension: true };

describe("stale channel guard", () => {
  it("rejects an MCP write into a channel with no plugin left", () => {
    expect(isStaleChannelSend(mcp, [])).toBe(true);
  });

  it("rejects when the only peers are other non-plugin clients", () => {
    // The pre-fix failure mode: the message broadcast to a second MCP session,
    // broadcastCount > 0, and the real command silently timed out.
    expect(isStaleChannelSend(mcp, [{}, {}])).toBe(true);
  });

  it("allows a write when a plugin is attached", () => {
    expect(isStaleChannelSend(mcp, [plugin])).toBe(false);
    expect(isStaleChannelSend(mcp, [{}, plugin])).toBe(false);
  });

  it("does not interfere with the browser channel", () => {
    expect(isStaleChannelSend(mcp, [extension])).toBe(false);
    // A reply travelling back from the extension or plugin is never a stale send.
    expect(isStaleChannelSend(extension, [])).toBe(false);
    expect(isStaleChannelSend(plugin, [])).toBe(false);
  });

  it("produces an actionable error naming the channel and the recovery step", () => {
    const message = staleChannelError("home-vault");
    expect(message).toContain('"home-vault"');
    expect(message).toContain("no plugin attached");
    expect(message).toContain("reopen the Claude MCP Plugin in Figma");
    expect(message).toContain("No changes were applied");
  });
});
