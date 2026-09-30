import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  createSessionRegistry,
  openSseSession,
  DEFAULT_MCP_SESSION_IDLE_MS,
  parseIdleMs,
  type ClosableTransport,
} from "../../src/socket-mcp-sessions";

class FakeTransport implements ClosableTransport {
  closeCalls = 0;
  onclose?: () => void;
  constructor(private readonly fail = false) {}
  async close() {
    this.closeCalls++;
    // Mirrors SSEServerTransport: close() always fires onclose.
    this.onclose?.();
    if (this.fail) throw new Error("boom");
  }
}

function setup() {
  let clock = 1_000;
  const errors: string[] = [];
  const registry = createSessionRegistry<FakeTransport>({
    now: () => clock,
    onCloseError: (id) => errors.push(id),
  });
  return {
    registry,
    errors,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("session registry close", () => {
  it("removes the session and closes its transport once", async () => {
    const { registry } = setup();
    const t = new FakeTransport();
    registry.add("a", t);
    await registry.close("a");
    expect(registry.size).toBe(0);
    expect(t.closeCalls).toBe(1);
  });

  it("does not recurse when onclose calls close again", async () => {
    const { registry } = setup();
    const t = new FakeTransport();
    t.onclose = () => void registry.close("a");
    registry.add("a", t);
    await registry.close("a");
    expect(t.closeCalls).toBe(1);
  });

  it("ignores a second close and unknown ids", async () => {
    const { registry } = setup();
    const t = new FakeTransport();
    registry.add("a", t);
    await registry.close("a");
    await registry.close("a");
    await registry.close("missing");
    expect(t.closeCalls).toBe(1);
  });

  it("still removes the session when close throws", async () => {
    const { registry, errors } = setup();
    registry.add("a", new FakeTransport(true));
    await registry.close("a");
    expect(registry.size).toBe(0);
    expect(errors).toEqual(["a"]);
  });

  it("forget removes without closing", () => {
    const { registry } = setup();
    const t = new FakeTransport();
    registry.add("a", t);
    registry.forget("a");
    expect(registry.size).toBe(0);
    expect(t.closeCalls).toBe(0);
  });
});

describe("session registry idle sweep", () => {
  it("evicts sessions unused for longer than the timeout", async () => {
    const { registry, advance } = setup();
    const t = new FakeTransport();
    registry.add("a", t);
    advance(1_001);
    expect(await registry.sweepIdle(1_000)).toBe(1);
    expect(registry.size).toBe(0);
    expect(t.closeCalls).toBe(1);
  });

  it("keeps sessions touched within the timeout", async () => {
    const { registry, advance } = setup();
    registry.add("a", new FakeTransport());
    advance(900);
    registry.touch("a");
    advance(900);
    expect(await registry.sweepIdle(1_000)).toBe(0);
    expect(registry.size).toBe(1);
  });

  it("never evicts a session with a request or stream in flight", async () => {
    const { registry, advance } = setup();
    registry.add("a", new FakeTransport());
    registry.begin("a");
    advance(10_000);
    expect(await registry.sweepIdle(1_000)).toBe(0);
    registry.end("a");
    advance(500);
    expect(await registry.sweepIdle(1_000)).toBe(0);
    advance(600);
    expect(await registry.sweepIdle(1_000)).toBe(1);
  });

  it("does nothing for a session already deleted", async () => {
    const { registry, advance } = setup();
    const t = new FakeTransport();
    registry.add("a", t);
    registry.forget("a");
    advance(5_000);
    expect(await registry.sweepIdle(1_000)).toBe(0);
    expect(t.closeCalls).toBe(0);
  });
});

describe("session registry closeAll", () => {
  it("closes every session even when one close throws", async () => {
    const { registry, errors } = setup();
    const ok1 = new FakeTransport();
    const ok2 = new FakeTransport();
    registry.add("a", ok1);
    registry.add("b", new FakeTransport(true));
    registry.add("c", ok2);
    await registry.closeAll();
    expect(registry.size).toBe(0);
    expect(ok1.closeCalls + ok2.closeCalls).toBe(2);
    expect(errors).toEqual(["b"]);
  });
});

describe("parseIdleMs", () => {
  it("uses a positive override", () => {
    expect(parseIdleMs("60000")).toBe(60_000);
  });

  it.each([undefined, "", "abc", "0", "-5"])("falls back to 30 min for %p", (raw) => {
    expect(parseIdleMs(raw)).toBe(DEFAULT_MCP_SESSION_IDLE_MS);
  });
});

describe("openSseSession", () => {
  // Bun 1.3 never emitted "close" on an SSE response when the client went away;
  // this fake response never does either, so only the req "close" path can clean up.
  function fakeSse() {
    const req = new EventEmitter() as unknown as IncomingMessage;
    const res = Object.assign(new EventEmitter(), {
      writeHead: () => res,
      write: () => true,
      end: () => undefined,
    }) as unknown as ServerResponse;
    return { req, res };
  }
  const fakeServer = () => ({ connect: (t: Transport) => t.start() });

  it("removes the session when req closes even if res never does", async () => {
    const registry = createSessionRegistry<SSEServerTransport>();
    const closed: string[] = [];
    const { req, res } = fakeSse();
    const transport = await openSseSession(req, res, registry, fakeServer, (id) => closed.push(id));
    expect(registry.has(transport.sessionId)).toBe(true);

    req.emit("close");
    await new Promise((r) => setTimeout(r, 0));
    expect(registry.size).toBe(0);
    expect(closed).toEqual([transport.sessionId]);
  });

  it("reports the close once when req and res both close", async () => {
    const registry = createSessionRegistry<SSEServerTransport>();
    const closed: string[] = [];
    const { req, res } = fakeSse();
    await openSseSession(req, res, registry, fakeServer, (id) => closed.push(id));

    res.emit("close");
    req.emit("close");
    await new Promise((r) => setTimeout(r, 0));
    expect(registry.size).toBe(0);
    expect(closed).toHaveLength(1);
  });
});
