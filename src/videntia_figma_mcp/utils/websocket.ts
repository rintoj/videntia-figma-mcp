import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger";
import { serverUrl, defaultPort, WS_URL } from "../config/config";
import { FigmaCommand, FigmaResponse, CommandProgressUpdate, PendingRequest, BrowserCommand } from "../types";
import { interceptForCapture } from "./tool-capture";
import { BROWSER_READONLY_COMMANDS, READONLY_COMMANDS } from "./readonly-commands";
import { getRequestChannel, getRequestSessionId, setRequestChannel } from "./channel-context";

class ChannelValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelValidationError";
  }
}

/**
 * The plugin answering on a channel is attached to a DIFFERENT Figma file than the
 * one the relay advertises for that channel. Joining anyway is how a session ends up
 * silently writing into an unrelated document (node ids are unique only within a file).
 */
export class ChannelIdentityMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelIdentityMismatchError";
  }
}

/**
 * A command arrived with no channel to address it to, and this process is joined to
 * more than one. Guessing is what used to deliver commands into the wrong Figma file,
 * so the command is refused and the caller is told to name its channel.
 */
export class AmbiguousChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousChannelError";
  }
}

export type FileIdentity = { fileKey: string | null; rootId: string | null; fileName: string | null };

/**
 * Why a channel is (or is not) pinned to a document identity:
 * - "none"        the channel has not been joined
 * - "pending"     a join is in flight; the identity handshake itself is allowed through
 * - "verified"    the responding plugin's identity matched the channel's advertised identity
 * - "unverified"  identity could not be established on one or both sides (older plugin build,
 *                 unsaved file, or a failed `get_file_key` round trip). Commands go out UNPINNED,
 *                 which is the historical behaviour: never block a session we cannot reason about.
 * - "failed"      verification ran and MISMATCHED. Commands must be refused, never sent unpinned.
 */
type ChannelVerification = "none" | "pending" | "verified" | "unverified" | "failed";

/**
 * ONE WEBSOCKET PER CHANNEL.
 *
 * The relay lets a socket be a member of exactly one channel at a time — joining a
 * second silently evicts it from the first. The old transport therefore shared a single
 * socket across every channel and juggled re-joins around the eviction, which meant the
 * destination of a command was whatever channel that shared socket happened to be in
 * when `send` ran. Two agents (or a browser command interleaved with a Figma command)
 * raced on it, and commands landed in the wrong Figma file.
 *
 * Giving each channel its own connection removes the race by construction: a connection
 * joins its channel once and stays there, so a command for channel X is physically
 * incapable of being delivered to a peer on channel Y.
 */
interface ChannelConnection {
  channel: string;
  /** "figma" connections carry document identity and are subject to join verification. */
  kind: "figma" | "other";
  ws: WebSocket | null;
  /** In-flight connect, so concurrent commands do not open duplicate sockets. */
  connecting: Promise<void> | null;
  /** In-flight join/verify, for the same reason. */
  joining: Promise<void> | null;
  joined: boolean;
  /** True once this channel has completed a join at least once in this process. */
  everJoined: boolean;
  expectedFile: FileIdentity | null;
  verification: ChannelVerification;
  lastVerificationFailure: string | null;
  pending: Map<string, PendingRequest>;
  heartbeat: ReturnType<typeof setInterval> | null;
}

const connections = new Map<string, ChannelConnection>();

/**
 * The last Figma channel joined in this process. Used ONLY as the resolution fallback
 * when no channel is bound to the request and exactly one Figma channel is live; it is
 * never used to break a tie between two live channels (see `resolveFigmaChannel`).
 */
let lastJoinedFigmaChannel: string | null = null;

/**
 * The last Figma channel a join was ATTEMPTED on, successful or not. Diagnostics only:
 * it is what lets `getChannelVerification()` report a failure after a mismatch, which by
 * definition leaves no joined channel behind.
 */
let lastAttemptedFigmaChannel: string | null = null;

/**
 * Channels each MCP session has joined.
 *
 * The socket server runs ONE process serving every Claude session over SSE, so a
 * process-wide "channel joined" is shared by clients that have nothing to do with each
 * other. Keyed by session, one client's join can never re-point another's commands.
 * A session that joined two channels is recorded as such deliberately: from then on it
 * must name its channel, because within a session (parallel subagents) there is nothing
 * left to tell its callers apart.
 */
const sessionJoins = new Map<string, Set<string>>();

function forgetChannelEverywhere(channel: string): void {
  for (const [sessionId, joined] of sessionJoins) {
    joined.delete(channel);
    if (joined.size === 0) sessionJoins.delete(sessionId);
  }
}

/** Port override supplied by `connectToFigma`. */
let activePort: number = defaultPort;

function socketUrl(): string {
  return serverUrl === "localhost" ? `${WS_URL}:${activePort}` : WS_URL;
}

function getConnection(channel: string, kind: "figma" | "other"): ChannelConnection {
  let conn = connections.get(channel);
  if (!conn) {
    conn = {
      channel,
      kind,
      ws: null,
      connecting: null,
      joining: null,
      joined: false,
      everJoined: false,
      expectedFile: null,
      verification: "none",
      lastVerificationFailure: null,
      pending: new Map(),
      heartbeat: null,
    };
    connections.set(channel, conn);
  }
  return conn;
}

/** Figma channels this process has joined and not since seen torn down. */
function liveFigmaChannels(): ChannelConnection[] {
  return [...connections.values()].filter((c) => c.kind === "figma" && c.everJoined && c.verification !== "failed");
}

function rejectAllPending(conn: ChannelConnection, reason: string): void {
  for (const [id, request] of conn.pending.entries()) {
    clearTimeout(request.timeout);
    request.reject(new Error(reason));
    conn.pending.delete(id);
  }
}

function teardown(conn: ChannelConnection, reason: string): void {
  if (conn.heartbeat) {
    clearInterval(conn.heartbeat);
    conn.heartbeat = null;
  }
  if (conn.ws) {
    conn.ws.removeAllListeners();
    try {
      conn.ws.terminate();
    } catch {
      /* already gone */
    }
    conn.ws = null;
  }
  conn.joined = false;
  conn.joining = null;
  conn.connecting = null;
  rejectAllPending(conn, reason);
}

function handleMessage(conn: ChannelConnection, raw: WebSocket.RawData): void {
  let json: any;
  try {
    json = JSON.parse(raw.toString());
  } catch (error) {
    logger.error(`Error parsing message: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  // Relay-level errors (e.g. "You must join the channel first") carry no request id to
  // correlate against; this connection only ever has commands for ONE channel in flight,
  // so reject the oldest rather than letting it sit until its timeout fires.
  if (json.type === "error") {
    const message = typeof json.message === "string" ? json.message : JSON.stringify(json);
    logger.error(`Relay error on channel "${conn.channel}": ${message}`);
    const oldest = conn.pending.entries().next();
    if (!oldest.done) {
      const [id, request] = oldest.value;
      clearTimeout(request.timeout);
      conn.pending.delete(id);
      request.reject(new Error(message));
    }
    return;
  }

  if (json.type === "channel_peer_disconnected") {
    if (json.remainingClients <= 1) {
      logger.warn(`Peer disconnected from channel "${conn.channel}". Dropping its connection state.`);
      // Forget the channel entirely: it is no longer a candidate for implicit
      // resolution, and a reconnecting plugin must be re-joined (and re-verified).
      teardown(conn, `The plugin on channel "${conn.channel}" disconnected.`);
      conn.everJoined = false;
      conn.verification = "none";
      conn.expectedFile = null;
      connections.delete(conn.channel);
      forgetChannelEverywhere(conn.channel);
      if (lastJoinedFigmaChannel === conn.channel) lastJoinedFigmaChannel = null;
    }
    return;
  }

  if (json.type === "progress_update") {
    const progressData = json.message?.data as CommandProgressUpdate;
    const requestId = json.id || "";
    const request = requestId ? conn.pending.get(requestId) : undefined;
    if (request) {
      request.lastActivity = Date.now();
      clearTimeout(request.timeout);
      request.timeout = setTimeout(() => {
        if (conn.pending.has(requestId)) {
          logger.error(`Request ${requestId} timed out after extended period of inactivity`);
          conn.pending.delete(requestId);
          request.reject(new Error("Request to Figma timed out"));
        }
      }, 60000);
      logger.info(
        `Progress update for ${progressData?.commandType}: ${progressData?.progress}% - ${progressData?.message}`,
      );
    }
    return;
  }

  const response = json.message as FigmaResponse | undefined;
  if (!response) return;
  logger.debug(`Received message on "${conn.channel}": ${JSON.stringify(response)}`);

  const request = response.id ? conn.pending.get(response.id) : undefined;
  if (!request) {
    logger.info(`Received broadcast message on "${conn.channel}": ${JSON.stringify(response)}`);
    return;
  }

  clearTimeout(request.timeout);
  conn.pending.delete(response.id!);
  if ((response as any).error) {
    logger.error(`Error from Figma: ${(response as any).error}`);
    request.reject(new Error(String((response as any).error)));
  } else if ((response as any).result !== undefined) {
    request.resolve((response as any).result);
  } else {
    request.reject(new Error("Received invalid response from Figma plugin (no result or error field)"));
  }
}

/** Open (or reuse) this channel's socket and resolve once it is OPEN. */
function ensureSocket(conn: ChannelConnection, timeoutMs = 10000): Promise<void> {
  if (conn.ws && conn.ws.readyState === WebSocket.OPEN) return Promise.resolve();
  if (conn.connecting) return conn.connecting;

  conn.connecting = new Promise<void>((resolve, reject) => {
    const url = socketUrl();
    logger.info(`Opening socket for channel "${conn.channel}" at ${url}`);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      conn.connecting = null;
      reject(new Error(`Failed to open socket: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    conn.ws = ws;

    const connectionTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        logger.error(`Connection for channel "${conn.channel}" timed out`);
        ws.terminate();
      }
    }, timeoutMs);

    let opened = false;
    const onOpen = () => {
      if (opened) return;
      opened = true;
      clearTimeout(connectionTimeout);
      conn.connecting = null;
      conn.joined = false;
      logger.info(`Socket open for channel "${conn.channel}"`);

      // Heartbeat: a half-dead loopback connection (peer gone, no FIN/RST) can sit in
      // readyState OPEN indefinitely, so in-flight commands silently time out instead
      // of failing fast. Unref'd so an idle channel never keeps the process alive.
      let isAlive = true;
      ws.on("pong", () => {
        isAlive = true;
      });
      const beat = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (!isAlive) {
          logger.warn(`Channel "${conn.channel}" heartbeat missed; terminating stale socket`);
          ws.terminate();
          return;
        }
        isAlive = false;
        ws.ping();
      }, 15000);
      (beat as unknown as { unref?: () => void }).unref?.();
      conn.heartbeat = beat;

      resolve();
    };

    ws.on("open", onOpen);
    // A socket that is ALREADY open never fires "open" (a reused/fake transport, or a
    // connection that completed between construction and listener attachment).
    if (ws.readyState === WebSocket.OPEN) queueMicrotask(onOpen);

    ws.on("message", (data: WebSocket.RawData) => handleMessage(conn, data));

    ws.on("error", (error: Error) => {
      logger.error(`Socket error on channel "${conn.channel}": ${error}`);
    });

    ws.on("close", (code: number, reasonBuf: Buffer) => {
      clearTimeout(connectionTimeout);
      const reason = reasonBuf?.toString() || "No reason provided";
      if (conn.heartbeat) {
        clearInterval(conn.heartbeat);
        conn.heartbeat = null;
      }
      if (conn.ws === ws) {
        conn.ws = null;
        conn.joined = false;
        conn.joining = null;
      }
      const stillConnecting = conn.connecting;
      conn.connecting = null;
      logger.info(`Channel "${conn.channel}" socket closed (${code}): ${reason}`);
      rejectAllPending(conn, `Connection closed with code ${code}: ${reason}`);
      if (stillConnecting) reject(new Error(`Connection closed with code ${code}: ${reason}`));
      // No background reconnect loop: the next command for this channel reconnects and
      // re-joins (and, for Figma channels, RE-VERIFIES) lazily.
    });
  });

  return conn.connecting;
}

/**
 * The identity a channel ADVERTISES on the relay, as reported by `/channels`.
 * Null when the relay could not be reached or knows nothing about the channel.
 */
async function getAdvertisedIdentity(
  channelName: string,
): Promise<{ fileKey: string | null; fileName: string | null } | null> {
  try {
    const channels = await getOpenChannels();
    const match = channels.find((ch) => ch.channel === channelName);
    if (!match) return null;
    return { fileKey: match.fileKey ?? null, fileName: match.fileName ?? null };
  } catch (error) {
    logger.warn(
      `Could not read advertised identity for channel "${channelName}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function describeFile(identity: { fileKey?: string | null; fileName?: string | null } | null): string {
  if (!identity) return "unknown";
  return identity.fileName ?? identity.fileKey ?? "unknown";
}

/**
 * Compare what the relay says a channel is, against what the plugin that actually
 * answered on it says it is. `fileKey` wins when both sides have one (it survives
 * renames); `fileName` is the fallback. When neither side has a usable discriminator
 * the result is "indeterminate" — we do NOT block a session we cannot reason about
 * (same principle as assertExpectedDocument in the plugin's document-guard).
 */
export function compareChannelIdentity(
  advertised: { fileKey?: string | null; fileName?: string | null } | null,
  responder: { fileKey?: string | null; fileName?: string | null } | null,
): { status: "match" | "mismatch" | "indeterminate"; discriminator: "fileKey" | "fileName" | null; reason?: string } {
  if (!advertised)
    return { status: "indeterminate", discriminator: null, reason: "the relay reported no identity for this channel" };
  if (!responder) return { status: "indeterminate", discriminator: null, reason: "the plugin reported no identity" };

  if (advertised.fileKey && responder.fileKey) {
    return advertised.fileKey === responder.fileKey
      ? { status: "match", discriminator: "fileKey" }
      : { status: "mismatch", discriminator: "fileKey" };
  }
  if (advertised.fileName && responder.fileName) {
    return advertised.fileName === responder.fileName
      ? { status: "match", discriminator: "fileName" }
      : { status: "mismatch", discriminator: "fileName" };
  }
  return {
    status: "indeterminate",
    discriminator: null,
    reason: "neither side reported a fileKey or fileName to compare",
  };
}

function buildMismatchMessage(
  channelName: string,
  advertised: { fileKey?: string | null; fileName?: string | null } | null,
  responder: { fileKey?: string | null; fileName?: string | null } | null,
): string {
  return (
    `Channel "${channelName}" is registered to "${describeFile(advertised)}" but the plugin answering on it ` +
    `is attached to "${describeFile(responder)}". Node IDs are not unique across files, so this session was NOT ` +
    `joined. Close and re-run the Videntia plugin in the intended Figma file (Plugins › Claude MCP Plugin), ` +
    `then re-run get_open_channels and join_channel.`
  );
}

/**
 * THE one verified join path for a Figma channel. Every code path that brings a Figma
 * channel online must go through this — a join that skips verification reintroduces the
 * cross-file bug it exists to prevent.
 */
async function joinAndVerify(conn: ChannelConnection): Promise<void> {
  const channelName = conn.channel;
  const advertised = await getAdvertisedIdentity(channelName);

  await sendOnConnection(conn, "join", { channel: channelName }, 10000, { join: true });
  conn.joined = true;
  conn.everJoined = true;
  // Cleared first so a failed capture can never leave a previous identity stamped on
  // this channel's commands.
  conn.expectedFile = null;
  conn.verification = "pending";
  conn.lastVerificationFailure = null;

  let responder: FileIdentity | null = null;
  try {
    const identity =
      (await sendOnConnection<{ fileKey?: string | null; rootId?: string | null; fileName?: string | null }>(
        conn,
        "get_file_key",
        {},
        10000,
      )) ?? {};
    responder = {
      fileKey: identity.fileKey ?? null,
      rootId: identity.rootId ?? null,
      fileName: identity.fileName ?? null,
    };
  } catch (error) {
    // An older plugin build may not implement get_file_key, and the round trip can time
    // out. Fall back to UNPINNED commands rather than blocking the session outright —
    // but leave expectedFile null so nothing is pinned to a value we never confirmed.
    logger.warn(
      `Could not capture file identity for channel "${channelName}": ${error instanceof Error ? error.message : String(error)}`,
    );
    conn.verification = "unverified";
    logger.info(`Joined channel: ${channelName}`);
    return;
  }

  const verdict = compareChannelIdentity(advertised, responder);
  if (verdict.status === "mismatch") {
    const message = buildMismatchMessage(channelName, advertised, responder);
    conn.verification = "failed";
    conn.lastVerificationFailure = message;
    conn.expectedFile = null;
    conn.joined = false;
    conn.everJoined = false;
    forgetChannelEverywhere(channelName);
    if (lastJoinedFigmaChannel === channelName) lastJoinedFigmaChannel = null;
    teardown(conn, message);
    logger.error(message);
    throw new ChannelIdentityMismatchError(message);
  }

  if (verdict.status === "indeterminate") {
    logger.warn(
      `Could not verify that channel "${channelName}" belongs to the file answering on it (${verdict.reason}). Proceeding unverified.`,
    );
  }

  conn.expectedFile = responder;
  conn.verification = verdict.status === "match" ? "verified" : "unverified";
  logger.info(
    `Channel ${channelName} is file "${responder.fileName}" (fileKey=${responder.fileKey}), verified by ${verdict.discriminator ?? "nothing"}`,
  );
  logger.info(`Joined channel: ${channelName}`);
}

/** Bring a Figma channel's connection up and joined, at most once concurrently. */
function ensureFigmaChannelReady(conn: ChannelConnection): Promise<void> {
  if (conn.verification === "failed") {
    return Promise.reject(
      new Error(
        conn.lastVerificationFailure ??
          `Channel "${conn.channel}" failed document-identity verification. Re-run get_open_channels and join_channel.`,
      ),
    );
  }
  if (conn.ws?.readyState === WebSocket.OPEN && conn.joined) return Promise.resolve();
  if (conn.joining) return conn.joining;

  conn.joining = (async () => {
    await ensureSocket(conn);
    await joinAndVerify(conn);
  })().finally(() => {
    conn.joining = null;
  });
  return conn.joining;
}

/** Bring a non-Figma channel (the Chrome extension's "browser" channel) up and joined. */
function ensureOtherChannelReady(conn: ChannelConnection): Promise<void> {
  if (conn.ws?.readyState === WebSocket.OPEN && conn.joined) return Promise.resolve();
  if (conn.joining) return conn.joining;

  conn.joining = (async () => {
    await ensureSocket(conn);
    await new Promise<void>((resolve, reject) => {
      const ws = conn.ws!;
      const onMsg = (raw: WebSocket.RawData) => {
        try {
          const data = JSON.parse(raw.toString());
          if (data.type === "system" && data.channel === conn.channel && data.message?.result) {
            clearTimeout(timer);
            ws.off("message", onMsg);
            conn.joined = true;
            conn.everJoined = true;
            resolve();
          }
        } catch {
          /* not our message */
        }
      };
      const timer = setTimeout(() => {
        ws.off("message", onMsg);
        reject(new Error(`Timed out joining channel "${conn.channel}"`));
      }, 5000);
      ws.on("message", onMsg);
      ws.send(JSON.stringify({ type: "join", channel: conn.channel }));
    });
  })().finally(() => {
    conn.joining = null;
  });
  return conn.joining;
}

/**
 * Kept for the server entry point. Connections are now opened lazily, per channel, so
 * there is nothing to dial before a channel is known; this only records a port override.
 */
export function connectToFigma(port: number = defaultPort) {
  activePort = port;
  logger.info(`Figma socket transport configured for port ${activePort} (connections open per channel on demand)`);
}

/**
 * Join a specific Figma channel and bind the current tool invocation to it.
 * @param channelName - Name of the channel to join
 */
export async function joinChannel(channelName: string): Promise<void> {
  // Validate the channel exists and has a Figma plugin connected.
  try {
    const openChannels = await getOpenChannels();
    const match = openChannels.find((ch) => ch.channel === channelName);
    if (!match) {
      const available = openChannels
        .map((ch) => `  - ${ch.channel} (${ch.fileName ?? "unknown file"})${ch.hasPlugin ? "" : " [no plugin]"}`)
        .join("\n");
      throw new ChannelValidationError(
        `Invalid channel ID: "${channelName}". Channel not found.` +
          (openChannels.length > 0
            ? `\nAvailable channels:\n${available}`
            : "\nNo channels are currently available. Ensure the Claude MCP Plugin is open in Figma."),
      );
    }
    if (!match.hasPlugin) {
      const withPlugin = openChannels.filter((ch) => ch.hasPlugin);
      const pluginList = withPlugin.map((ch) => `  - ${ch.channel} (${ch.fileName ?? "unknown file"})`).join("\n");
      throw new ChannelValidationError(
        `Channel "${channelName}" exists but has no active Figma plugin connected.\n` +
          `The channel may be stale from a previous session. Open the Claude MCP Plugin in Figma and try again.\n` +
          (withPlugin.length > 0
            ? `\nChannels with an active plugin:\n${pluginList}`
            : "\nNo channels currently have an active Figma plugin."),
      );
    }
  } catch (error) {
    if (error instanceof ChannelValidationError) throw error;
    logger.warn(`Could not validate channel before joining: ${error instanceof Error ? error.message : String(error)}`);
  }

  lastAttemptedFigmaChannel = channelName;
  const conn = getConnection(channelName, "figma");
  // A previous failure must not permanently poison an explicit re-join attempt.
  if (conn.verification === "failed") {
    conn.verification = "none";
    conn.lastVerificationFailure = null;
  }

  try {
    await ensureFigmaChannelReady(conn);
  } catch (error) {
    if (error instanceof ChannelIdentityMismatchError) throw error;
    logger.error(`Failed to join channel: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }

  lastJoinedFigmaChannel = channelName;
  const sessionId = getRequestSessionId();
  if (sessionId) {
    const joined = sessionJoins.get(sessionId) ?? new Set<string>();
    joined.add(channelName);
    sessionJoins.set(sessionId, joined);
  }
  // Bind the REST of this tool invocation to the channel it just joined, so a caller
  // that joins and then acts in the same call cannot be re-pointed by a parallel agent.
  setRequestChannel(channelName);
}

/**
 * Resolve which channel THIS command is addressed to.
 *
 * Order: the channel bound to the request (an explicit `channel` argument, or the one
 * `join_channel` bound during this same invocation) → the only live Figma channel →
 * refusal. It never picks a winner between two live channels: that guess is exactly how
 * commands used to land in the wrong document.
 */
async function resolveFigmaChannel(): Promise<string> {
  const explicit = getRequestChannel();
  if (explicit) return explicit;

  const describe = (channels: string[]) =>
    channels
      .map((name) => `  - ${name} (${connections.get(name)?.expectedFile?.fileName ?? "unknown file"})`)
      .join("\n");
  const ambiguous = (channels: string[], scope: string) =>
    new AmbiguousChannelError(
      `Ambiguous Figma channel: ${scope} is joined to ${channels.length} channels, and this command named none of them.\n` +
        `Node IDs are not unique across Figma files, so the command was NOT sent rather than guessed at.\n` +
        `Joined channels:\n${describe(channels)}\n\n` +
        `Pass \`channel: "<name>"\` on this tool call — every Figma tool accepts it.`,
    );

  // A session's OWN joins come first: another client of this shared server joining a
  // different file must never re-point this one's commands.
  const sessionId = getRequestSessionId();
  const mine = sessionId ? [...(sessionJoins.get(sessionId) ?? [])] : [];
  if (mine.length === 1) return mine[0];
  if (mine.length > 1) throw ambiguous(mine, "this MCP session");

  const live = liveFigmaChannels();
  if (live.length === 1) return live[0].channel;
  if (live.length > 1)
    throw ambiguous(
      live.map((c) => c.channel),
      "this MCP process",
    );

  if (lastJoinedFigmaChannel) return lastJoinedFigmaChannel;

  // Nothing joined: report what is out there.
  try {
    const channels = await getOpenChannels();
    if (channels.length > 0) {
      const channelList = channels.map((ch) => `  - ${ch.channel} (${ch.fileName || "unknown file"})`).join("\n");
      throw new Error(
        `No active Figma connection.\nAvailable channels:\n${channelList}\n\nUse join_channel with one of the above channel IDs to connect.`,
      );
    }
    throw new Error(
      "No active Figma connection. No open channels found.\n" +
        "Ensure the Claude MCP Plugin is running in Figma, then use get_open_channels and join_channel.",
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("No active Figma connection")) throw error;
    throw new Error(
      "No active Figma connection. Could not fetch available channels.\n" +
        "Ensure the Claude MCP Plugin is running in Figma and use join_channel to reconnect.",
    );
  }
}

/**
 * Get the channel the current request would be routed to, without sending anything.
 * Null when nothing is joined; when several channels are joined and the request named
 * none, it reports null rather than guessing.
 */
export function getCurrentChannel(): string | null {
  const explicit = getRequestChannel();
  if (explicit) return explicit;
  const sessionId = getRequestSessionId();
  const mine = sessionId ? [...(sessionJoins.get(sessionId) ?? [])] : [];
  if (mine.length === 1) return mine[0];
  if (mine.length > 1) return null;
  const live = liveFigmaChannels();
  if (live.length === 1) return live[0].channel;
  if (live.length > 1) return null;
  return lastJoinedFigmaChannel;
}

/** Every Figma channel this process currently holds a joined connection to. */
export function getJoinedChannels(): string[] {
  return liveFigmaChannels().map((c) => c.channel);
}

/**
 * Identity of the Figma document behind the channel this request resolves to.
 * Null when no channel is resolvable or the plugin did not report one.
 */
export function getExpectedFile(): FileIdentity | null {
  const channel = getCurrentChannel();
  if (!channel) return null;
  return connections.get(channel)?.expectedFile ?? null;
}

/**
 * Whether the resolved channel's document identity was verified against the identity the
 * relay advertises for it. Exposed for tests and diagnostics.
 */
export function getChannelVerification(): { state: ChannelVerification; failure: string | null } {
  const channel = getRequestChannel() ?? getCurrentChannel() ?? lastAttemptedFigmaChannel;
  const conn = channel ? connections.get(channel) : undefined;
  if (!conn) return { state: "none", failure: null };
  return { state: conn.verification, failure: conn.lastVerificationFailure };
}

/**
 * Get all open channels from the socket server via HTTP.
 */
export async function getOpenChannels(): Promise<
  Array<{
    channel: string;
    clients: number;
    pluginClients: number;
    hasPlugin: boolean;
    extensionClients: number;
    hasExtension: boolean;
    fileName: string | null;
    fileKey: string | null;
    joinedAt: number | null;
    browsers?: { id: string; label: string; joinedAt: number }[];
  }>
> {
  const httpUrl = serverUrl === "localhost" ? `http://localhost:${activePort}` : `https://${serverUrl}`;
  let response: Response;
  try {
    response = await fetch(`${httpUrl}/channels`, { signal: AbortSignal.timeout(10000) });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`Timed out fetching channels from ${httpUrl}/channels after 10s. Is the socket server running?`);
    }
    throw error;
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch channels: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<
    Array<{
      channel: string;
      clients: number;
      pluginClients: number;
      hasPlugin: boolean;
      extensionClients: number;
      hasExtension: boolean;
      fileName: string | null;
      fileKey: string | null;
      joinedAt: number | null;
      browsers?: { id: string; label: string; joinedAt: number }[];
    }>
  >;
}

/**
 * What to do after a send failed:
 * - "retry": the command never reached the peer (the relay refused it), or it is a read,
 *   so resending is harmless.
 * - "unsafe": the connection dropped mid-flight on a write — the peer may already have
 *   applied it, and resending would apply it twice.
 * - "rethrow": any other error.
 */
function classifyDrop(error: unknown, readOnly: boolean): "retry" | "unsafe" | "rethrow" {
  if (!(error instanceof Error)) return "rethrow";
  if (error.message === "You must join the channel first") return "retry";
  if (error.message.startsWith("Connection closed")) return readOnly ? "retry" : "unsafe";
  return "rethrow";
}

/**
 * Send a command to the Figma plugin on the channel THIS request is addressed to.
 */
export async function sendCommandToFigma<T = unknown>(
  command: FigmaCommand,
  params: unknown = {},
  timeoutMs: number = 30000,
): Promise<T> {
  // Capture mode (batch_actions): record what this handler WOULD send and hand back a
  // placeholder instead of touching the socket. See utils/tool-capture.ts.
  const captured = interceptForCapture(command, params);
  if (captured) return captured.value as T;

  const channel = await resolveFigmaChannel();
  const conn = getConnection(channel, "figma");
  await ensureFigmaChannelReady(conn);

  try {
    return await sendOnConnection<T>(conn, command, params, timeoutMs);
  } catch (error) {
    const drop = classifyDrop(error, READONLY_COMMANDS.has(command));
    if (drop === "retry") {
      // Reconnect + re-join (which RE-VERIFIES the document identity) and retry once.
      logger.warn(`Channel "${channel}" dropped during "${command}"; reconnecting and retrying once.`);
      teardown(conn, "reconnecting");
      await ensureFigmaChannelReady(conn);
      return await sendOnConnection<T>(conn, command, params, timeoutMs);
    }
    if (drop === "unsafe") {
      teardown(conn, "reconnecting");
      throw new Error(
        `Connection to the Figma plugin dropped during "${command}". It may already have been applied — ` +
          `verify the file state (e.g. get_node_info) before retrying.`,
      );
    }
    throw error;
  }
}

/**
 * Put one command on a channel's own socket.
 *
 * The envelope's `channel` is always this connection's channel — there is no shared
 * "current channel" left for it to drift from.
 */
function sendOnConnection<T = unknown>(
  conn: ChannelConnection,
  command: FigmaCommand | BrowserCommand | "join",
  params: unknown = {},
  timeoutMs: number = 30000,
  options: { join?: boolean; target?: string } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ws = conn.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error("Not connected to Figma"));
      return;
    }

    // Defence in depth: a channel whose identity verification FAILED must never be
    // talked to, pinned or unpinned.
    if (!options.join && conn.kind === "figma" && conn.verification === "failed") {
      reject(
        new Error(
          conn.lastVerificationFailure ??
            "The last channel join failed document-identity verification. Re-run get_open_channels and join_channel.",
        ),
      );
      return;
    }

    const id = uuidv4();
    const stamped = conn.kind === "figma" && !options.join && command !== "get_file_key";
    const request = {
      id,
      type: options.join ? "join" : "message",
      channel: conn.channel,
      ...(options.target ? { target: options.target } : {}),
      message: {
        id,
        command,
        params: {
          ...(params as any),
          commandId: id,
          // Pin this command to the channel AND document it was addressed to. The plugin
          // refuses it outright on mismatch instead of applying it to a same-numbered
          // node in a different file (see the plugin's document-guard).
          ...(stamped ? { __expectedChannel: conn.channel } : {}),
          ...(stamped && conn.expectedFile ? { __expectedFile: conn.expectedFile } : {}),
        },
      },
    };

    const timeout = setTimeout(() => {
      if (conn.pending.has(id)) {
        conn.pending.delete(id);
        logger.error(`Request ${id} to Figma timed out after ${timeoutMs / 1000} seconds`);
        reject(new Error("Request to Figma timed out"));
      }
    }, timeoutMs);

    conn.pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timeout,
      lastActivity: Date.now(),
    });

    logger.info(`Sending "${command}" on channel "${conn.channel}"`);
    logger.debug(`Request details: ${JSON.stringify(request)}`);
    ws.send(JSON.stringify(request));
  });
}

/**
 * Send a command to an explicit channel (not a Figma document channel).
 * Used for the Chrome extension's "browser" channel.
 *
 * @param browserId - Optional routing target. May also be supplied as
 * `params.browserId`. When set it is emitted as an envelope-level `target`
 * sibling of `channel`; the relay routes to that client and rejects unknown or
 * ambiguous targets itself.
 */
export async function sendCommandToChannel<T = unknown>(
  targetChannel: string,
  command: BrowserCommand,
  params: unknown = {},
  timeoutMs: number = 30000,
  browserId?: string,
): Promise<T> {
  const conn = getConnection(targetChannel, "other");
  await ensureOtherChannelReady(conn);

  // `browserId` is a ROUTING hint, not a command param: it is lifted out of params into
  // an envelope-level `target` so the extension's command handler never sees it.
  const { browserId: paramsBrowserId, ...restParams } = (params ?? {}) as Record<string, unknown>;
  const target = browserId ?? (typeof paramsBrowserId === "string" ? paramsBrowserId : undefined);

  const send = () =>
    sendOnConnection<T>(conn, command, restParams, timeoutMs, { target }).catch((error) => {
      if (error instanceof Error && error.message === "Request to Figma timed out") {
        throw new Error(
          `Browser command "${command}" timed out after ${timeoutMs / 1000}s. Is the Chrome extension connected?`,
        );
      }
      throw error;
    });

  try {
    return await send();
  } catch (error) {
    const drop = classifyDrop(error, BROWSER_READONLY_COMMANDS.has(command));
    if (drop === "retry") {
      logger.warn(`Channel "${targetChannel}" dropped during browser command "${command}"; retrying once.`);
      teardown(conn, "reconnecting");
      await ensureOtherChannelReady(conn);
      return await send();
    }
    if (drop === "unsafe") {
      teardown(conn, "reconnecting");
      throw new Error(
        `Connection to the Chrome extension dropped during browser command "${command}". It may already have ` +
          `been applied — check the page state before retrying.`,
      );
    }
    throw error;
  }
}

/** Test helper: drop every connection and all channel state. */
export function resetChannelConnections(): void {
  for (const conn of connections.values()) teardown(conn, "reset");
  connections.clear();
  lastJoinedFigmaChannel = null;
  lastAttemptedFigmaChannel = null;
  sessionJoins.clear();
}
