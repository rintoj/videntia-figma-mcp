# Plugin freezes under concurrent agents

## Symptom

Several agents send commands to the same Figma file at once (seen with two agents
building screens in a large file, about 200 frames). The Videntia plugin stops
answering: every call times out, even a single `get_node_info`. It never recovers on
its own; the plugin has to be closed and reopened. `get_open_channels` still lists the
channel as connected the whole time.

## Root cause

The plugin main thread runs every command through one serial queue in
`src/videntia_figma_plugin/index.ts` (`enqueueCommand`). Before this fix that queue was
a bare promise chain:

```ts
const tail = commandQueue.then(() => handleCommand(...), () => handleCommand(...));
commandQueue = tail.catch(() => undefined);
```

It had no timeout of any kind. If one handler awaits a Figma API call that never
settles, every later command, from every agent, waits behind it forever. Known
candidates for a never-settling await: `setReactionsAsync` with a multi-action
reaction (documented hang), `loadFontAsync`, `exportAsync` on a heavy subtree, the
image readiness waits in `utils/image-readiness.ts`, and `getNodeByIdAsync` or page
loads on a very large file.

Concurrency makes it far more likely in two ways:

1. More commands in flight means more chances to hit a slow or hung call, and every
   agent shares the same single queue.
2. When the server gives up on a command (30s default in
   `src/videntia_figma_mcp/utils/websocket.ts`), it only rejects locally. The plugin
   was never told, so the abandoned command stayed queued and still ran later. Agents
   that retry after a timeout add more work to a queue that is already behind, so the
   backlog grows faster than it drains and every new call times out.

Why the channel looks alive: liveness is a WebSocket ping/pong between the relay
(`src/socket.ts`, heartbeat interval) and the plugin UI iframe. The iframe's browser
WebSocket answers pings by itself, independent of the plugin main thread, so a wedged
main thread still looks connected.

Proven vs hypothesized:

- Proven (unit test): a single never-settling command blocks every command queued after
  it, with the old dispatcher, indefinitely.
- Proven (code reading): no plugin side timeout, no cancel message, health only
  reflects the iframe socket.
- Hypothesized: which exact API call hung in the reported incident. The logs did not
  capture it. With this fix, `get_plugin_health` names it the next time.
- Not the cause: recent fixes #151 (no replay of writes after a drop), #153 (relay MCP
  session leak) and #156 (bounded activity log memory) do not touch the queue and do
  not fix this.

## What the fix changes

`src/videntia_figma_plugin/utils/command-scheduler.ts` replaces the promise chain:

- Commands still run one at a time (handlers share module level state, so parallel
  execution would race).
- Each command runs under a watchdog. The server now stamps `__deadlineMs` (its own
  timeout) on every command, and the watchdog is that plus 5s (minimum 30s, default
  180s when absent). When it fires, the caller gets an error and the queue moves on.
  JavaScript cannot cancel a pending await, so the abandoned command may still finish
  in the background; it is counted in `abandonedStillRunning`.
- A command that waited in the queue longer than its caller's timeout is dropped
  without executing, so the plugin no longer runs writes nobody is waiting for.
- The queue is capped at 40 waiting commands. Beyond that a call fails at once with
  "Plugin busy", naming the running command and its age.
- New read only tool `get_plugin_health` is answered outside the queue. It reports
  `state` (idle, running, busy), the running command and its age, queue depth and
  names, watchdog timeouts, dropped and rejected counts.
- Server timeout errors now name the command and point to `get_plugin_health`.

## How to reproduce

Automated: `bun test tests/unit/plugin/command-scheduler.test.ts`. The first test runs
the old dispatcher and shows a read never completes behind a hung command; the others
show the scheduler recovers.

Manual (old plugin build):

1. Open a large file (a few hundred frames) and run the plugin.
2. Start 3 or more agents on the same channel, each running `batch_actions` with 10 or
   more create and export actions in a loop.
3. Or, deterministically, send one `set_reactions` with two actions on one reaction
   (the schema blocks this, so send it through a raw socket client).
4. Every following call, including `get_node_info`, times out while
   `get_open_channels` still shows the channel.

## How to detect

Call `get_plugin_health`. `state: "busy"` with a large `running.ageMs` means a command is
stuck; `watchdogTimeouts` or `abandonedStillRunning` above zero means one hung earlier.
If `get_plugin_health` itself times out, the main thread is fully blocked (a
synchronous loop, not a pending await) and only a reopen helps.

## How to recover

- With the fix: wait for the watchdog (at most the caller's timeout plus 5s), then verify
  the state of anything the abandoned command touched before retrying it.
- If health does not answer: close and reopen the plugin in Figma.
- Keep it at 2 agents per file and batches of 6 actions or fewer on very large files.
