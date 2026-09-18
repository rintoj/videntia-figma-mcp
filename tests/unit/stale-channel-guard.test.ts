import {
  isStaleChannelSend,
  staleChannelError,
  peerMatchesChannelFile,
  partitionPluginPeers,
  decideChannelSend,
  channelFileMismatchError,
} from "../../src/socket-channel-guard";

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

describe("channel file mismatch guard", () => {
  const channel = { fileName: "Claude Figma MCP", fileKey: "CLAUDE" };
  const rightPlugin = { _isPlugin: true, _fileName: "Claude Figma MCP", _fileKey: "CLAUDE" };
  const wrongPlugin = { _isPlugin: true, _fileName: "Harnesshub", _fileKey: "HARNESS" };
  const legacyPlugin = { _isPlugin: true }; // older build: reports no identity
  const mcpSession = {};

  it("matches a plugin on fileKey, and on fileName when no key is shared", () => {
    expect(peerMatchesChannelFile(rightPlugin, channel)).toBe(true);
    expect(peerMatchesChannelFile(wrongPlugin, channel)).toBe(false);
    expect(
      peerMatchesChannelFile({ _isPlugin: true, _fileName: "Claude Figma MCP" }, { fileName: "Claude Figma MCP" }),
    ).toBe(true);
    expect(peerMatchesChannelFile({ _isPlugin: true, _fileName: "Harnesshub" }, { fileName: "Claude Figma MCP" })).toBe(
      false,
    );
  });

  it("treats a plugin with no discriminator as a match (older builds keep working)", () => {
    expect(peerMatchesChannelFile(legacyPlugin, channel)).toBe(true);
    expect(peerMatchesChannelFile(wrongPlugin, {})).toBe(true);
    const decision = decideChannelSend("claudefigmam", [legacyPlugin], channel);
    expect(decision.kind).toBe("deliver");
    expect(decision.kind === "deliver" && decision.recipients).toEqual([legacyPlugin]);
  });

  it("splits plugin peers into matching and mismatched, ignoring non-plugins", () => {
    const { plugins, matching, mismatched } = partitionPluginPeers(
      [mcpSession, rightPlugin, wrongPlugin, extension],
      channel,
    );
    expect(plugins).toEqual([rightPlugin, wrongPlugin]);
    expect(matching).toEqual([rightPlugin]);
    expect(mismatched).toEqual([wrongPlugin]);
  });

  it("refuses a command when the only plugin on the channel belongs to another file", () => {
    // The live incident: channel advertised as "Claude Figma MCP", answered by
    // the Harnesshub plugin, seven agents' work written to the wrong document.
    const decision = decideChannelSend("claudefigmam", [mcpSession, wrongPlugin], channel);
    expect(decision.kind).toBe("refuse");
    expect(decision.kind === "refuse" && decision.error).toContain('"claudefigmam"');
    expect(decision.kind === "refuse" && decision.error).toContain("Claude Figma MCP");
    expect(decision.kind === "refuse" && decision.error).toContain("Harnesshub");
  });

  it("delivers normally when the attached plugin matches the channel's file", () => {
    const decision = decideChannelSend("claudefigmam", [mcpSession, rightPlugin], channel);
    expect(decision.kind).toBe("deliver");
    expect(decision.kind === "deliver" && decision.recipients).toEqual([mcpSession, rightPlugin]);
  });

  it("routes only to the matching plugin when both are attached", () => {
    const decision = decideChannelSend("claudefigmam", [wrongPlugin, rightPlugin], channel);
    expect(decision.kind === "deliver" && decision.recipients).toEqual([rightPlugin]);
  });

  it("does not interfere with channels that have no plugin at all", () => {
    expect(decideChannelSend("browser", [extension], {}).kind).toBe("deliver");
    expect(decideChannelSend("empty", [], channel).kind).toBe("deliver");
  });

  it("names the channel, both files and the recovery step in the mismatch error", () => {
    const message = channelFileMismatchError("claudefigmam", channel, wrongPlugin);
    expect(message).toContain('"claudefigmam"');
    expect(message).toContain('"Claude Figma MCP"');
    expect(message).toContain('"Harnesshub"');
    expect(message).toContain("Close and re-run the Videntia plugin");
    expect(message).toContain("No changes were applied");
  });
});
