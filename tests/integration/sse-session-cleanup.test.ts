import http from "node:http";
import type { AddressInfo } from "node:net";
import type { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createSessionRegistry, openSseSession } from "../../src/socket-mcp-sessions";

async function waitFor(check: () => boolean, timeoutMs = 1_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function readSessionId(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  let text = "";
  while (!text.includes("sessionId=")) {
    const { value } = await reader.read();
    text += new TextDecoder().decode(value);
  }
  return /sessionId=([\w-]+)/.exec(text)![1];
}

describe("SSE session cleanup", () => {
  const sessions = createSessionRegistry<SSEServerTransport>();
  const closed: string[] = [];
  const fakeServer = () => ({ connect: (t: Transport) => t.start() });
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/sse") {
        await openSseSession(req, res, sessions, fakeServer, (id) => closed.push(id));
        return;
      }
      const transport = sessions.get(url.searchParams.get("sessionId") ?? "");
      if (!transport) {
        res.writeHead(404).end();
        return;
      }
      await transport.handlePostMessage(req, res);
    });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await sessions.closeAll();
    server.close();
  });

  it("removes the session when the client aborts", async () => {
    const abort = new AbortController();
    const res = await fetch(`${base}/sse`, { signal: abort.signal });
    const sessionId = await readSessionId(res);
    expect(sessions.has(sessionId)).toBe(true);

    const post = await fetch(`${base}/message?sessionId=${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(post.status).toBe(202);

    abort.abort();
    await waitFor(() => !sessions.has(sessionId));
    expect(closed).toContain(sessionId);

    const stale = await fetch(`${base}/message?sessionId=${sessionId}`, { method: "POST", body: "{}" });
    expect(stale.status).toBe(404);
  });

  it("logs a session close once when the server closes it", async () => {
    const abort = new AbortController();
    const res = await fetch(`${base}/sse`, { signal: abort.signal });
    const sessionId = await readSessionId(res);
    await sessions.close(sessionId);
    abort.abort();
    await new Promise((r) => setTimeout(r, 100));
    expect(closed.filter((id) => id === sessionId)).toHaveLength(1);
    expect(sessions.size).toBe(0);
  });
});
