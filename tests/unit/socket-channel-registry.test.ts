import {
  applyJoinMetadata,
  describeChannels,
  fileLabel,
  leaveChannelIn,
  resolveJoinChannelName,
  type ChannelMeta,
  type RegistryPeer,
} from "../../src/socket-channel-registry";

type Peer = RegistryPeer & { id: string };

const OPEN = 1;

function peer(id: string, extra: Partial<Peer> = {}): Peer {
  return { id, readyState: OPEN, ...extra };
}

function relay(entries: Array<[string, Peer[]]>, meta: Array<[string, ChannelMeta]>) {
  const channels = new Map<string, Set<Peer>>(entries.map(([name, peers]) => [name, new Set(peers)]));
  const metadata = new Map<string, ChannelMeta>(meta);
  return { channels, metadata };
}

describe("channel metadata lifecycle", () => {
  it("drops the metadata entry when the last client leaves the channel", () => {
    const plugin = peer("plugin", { _isPlugin: true, _fileName: "Claude Figma MCP" });
    const { channels, metadata } = relay(
      [["claudefigmam", [plugin]]],
      [["claudefigmam", { fileName: "Claude Figma MCP", fileKey: "AAA", joinedAt: 1 }]],
    );

    expect(leaveChannelIn(channels, metadata, "claudefigmam", plugin)).toBe(true);
    expect(channels.has("claudefigmam")).toBe(false);
    expect(metadata.has("claudefigmam")).toBe(false);
  });

  it("keeps the channel and its metadata while other clients remain", () => {
    const plugin = peer("plugin", { _isPlugin: true });
    const mcp = peer("mcp");
    const { channels, metadata } = relay(
      [["design", [plugin, mcp]]],
      [["design", { fileName: "Design", joinedAt: 1 }]],
    );

    expect(leaveChannelIn(channels, metadata, "design", plugin)).toBe(false);
    expect(metadata.get("design")?.fileName).toBe("Design");
  });

  it("no longer advertises a channel whose last client left", () => {
    const plugin = peer("plugin", { _isPlugin: true, _fileName: "Claude Figma MCP" });
    const { channels, metadata } = relay(
      [["claudefigmam", [plugin]]],
      [["claudefigmam", { fileName: "Claude Figma MCP", joinedAt: 1 }]],
    );

    expect(describeChannels(channels, metadata).map((c) => c.channel)).toEqual(["claudefigmam"]);
    leaveChannelIn(channels, metadata, "claudefigmam", plugin);
    expect(describeChannels(channels, metadata)).toEqual([]);
  });

  it("describes a live channel with its plugin count and registered file", () => {
    const { channels, metadata } = relay(
      [["design", [peer("plugin", { _isPlugin: true }), peer("mcp")]]],
      [["design", { fileName: "Design", fileKey: "KEY", joinedAt: 7 }]],
    );
    const [entry] = describeChannels(channels, metadata);
    expect(entry).toMatchObject({
      channel: "design",
      clients: 2,
      pluginClients: 1,
      hasPlugin: true,
      hasExtension: false,
      fileName: "Design",
      fileKey: "KEY",
      joinedAt: 7,
    });
  });

  it("survives the extension-supersede re-registration path", () => {
    // The extension reconnects: its previous socket is dropped, which empties and
    // deletes the channel, and the relay then re-registers the same set. The
    // metadata it captured first must come back with it.
    const stale = peer("ext-old", { _isExtension: true });
    const { channels, metadata } = relay([["browser", [stale]]], [["browser", { fileName: "Browser", joinedAt: 3 }]]);

    const channelClients = channels.get("browser")!;
    const captured = metadata.get("browser");
    leaveChannelIn(channels, metadata, "browser", stale);
    expect(metadata.has("browser")).toBe(false);

    if (!channels.has("browser")) {
      channels.set("browser", channelClients);
      if (captured) metadata.set("browser", captured);
    }
    channelClients.add(peer("ext-new", { _isExtension: true }));

    expect(describeChannels(channels, metadata)[0]).toMatchObject({
      channel: "browser",
      fileName: "Browser",
      joinedAt: 3,
      hasExtension: true,
    });
  });
});

describe("resolveJoinChannelName", () => {
  const registered: ChannelMeta = { fileName: "Harnesshub", fileKey: "HARNESS", joinedAt: 1 };

  it("renames a plugin from a different file onto a suffixed channel", () => {
    const metadata = new Map<string, ChannelMeta>([["shared", registered]]);
    const resolved = resolveJoinChannelName(metadata, "shared", { fileName: "Claude Figma MCP", fileKey: "CLAUDE" });
    expect(resolved).toBe("shared-2");
  });

  it("renames even when the registered channel has no live members", () => {
    // The pre-fix hole: the rename only ran when `channels.has(name)` was true,
    // so a momentarily empty channel could be taken over by a different file.
    const metadata = new Map<string, ChannelMeta>([["shared", registered]]);
    const channels = new Map<string, Set<Peer>>(); // nothing live at all
    expect(channels.has("shared")).toBe(false);
    expect(resolveJoinChannelName(metadata, "shared", { fileName: "Other", fileKey: "OTHER" })).toBe("shared-2");
  });

  it("keeps the channel name when the SAME file reconnects", () => {
    const metadata = new Map<string, ChannelMeta>([["shared", registered]]);
    expect(resolveJoinChannelName(metadata, "shared", { fileKey: "HARNESS" })).toBe("shared");
    expect(resolveJoinChannelName(metadata, "shared", { fileName: "Harnesshub", fileKey: "HARNESS" })).toBe("shared");
  });

  it("walks past occupied suffixes until it finds a free or matching one", () => {
    const metadata = new Map<string, ChannelMeta>([
      ["shared", registered],
      ["shared-2", { fileName: "Second", fileKey: "SECOND", joinedAt: 1 }],
    ]);
    expect(resolveJoinChannelName(metadata, "shared", { fileName: "Third", fileKey: "THIRD" })).toBe("shared-3");
    expect(resolveJoinChannelName(metadata, "shared", { fileKey: "SECOND" })).toBe("shared-2");
  });

  it("claims an unregistered channel as-is", () => {
    expect(resolveJoinChannelName(new Map(), "fresh", { fileName: "Fresh" })).toBe("fresh");
  });
});

describe("applyJoinMetadata", () => {
  it("registers a brand new channel", () => {
    const metadata = new Map<string, ChannelMeta>();
    const { meta, repointRejected } = applyJoinMetadata(metadata, "design", { fileName: "Design", fileKey: "K" }, 5);
    expect(repointRejected).toBe(false);
    expect(meta).toEqual({ fileName: "Design", fileKey: "K", joinedAt: 5 });
  });

  it("refuses to repoint a registered channel at a different file", () => {
    const metadata = new Map<string, ChannelMeta>([["design", { fileName: "Design", fileKey: "K", joinedAt: 1 }]]);
    const { meta, repointRejected } = applyJoinMetadata(metadata, "design", { fileName: "Other", fileKey: "OTHER" });
    expect(repointRejected).toBe(true);
    expect(meta.fileName).toBe("Design");
    expect(meta.fileKey).toBe("K");
  });

  it("refines the same file's identity on reconnect", () => {
    const metadata = new Map<string, ChannelMeta>([["design", { fileName: "Design", fileKey: "K", joinedAt: 1 }]]);
    const { repointRejected } = applyJoinMetadata(metadata, "design", { fileName: "Design v2", fileKey: "K" });
    expect(repointRejected).toBe(false);
    expect(metadata.get("design")).toMatchObject({ fileName: "Design v2", fileKey: "K" });
  });

  it("will not let a keyed join claim a name-only registration", () => {
    // File names collide across distinct files, so a fileName-only registration
    // is never assumed to be the same file as a fileKey-identified join.
    const metadata = new Map<string, ChannelMeta>([["design", { fileName: "Design", joinedAt: 1 }]]);
    const { repointRejected } = applyJoinMetadata(metadata, "design", { fileName: "Design", fileKey: "K" });
    expect(repointRejected).toBe(true);
    expect(metadata.get("design")?.fileKey).toBeUndefined();
  });

  it("leaves a registration untouched when the joiner carries no identity", () => {
    const metadata = new Map<string, ChannelMeta>([["design", { fileName: "Design", joinedAt: 1 }]]);
    applyJoinMetadata(metadata, "design", {});
    expect(metadata.get("design")?.fileName).toBe("Design");
  });
});

describe("fileLabel", () => {
  it("prefers the file name, falls back to the key, then to unknown", () => {
    expect(fileLabel({ fileName: "Design", fileKey: "K" })).toBe("Design");
    expect(fileLabel({ fileKey: "K" })).toBe("K");
    expect(fileLabel(undefined)).toBe("unknown");
  });
});
