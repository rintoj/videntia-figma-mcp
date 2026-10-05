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
  60s when absent). When it fires, the caller gets an error and the queue moves on.
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

## Heavy reads

A second failure mode looked like the freeze but was caused by a few oversized reads
starving everything else. With 8 concurrent agents the measured latency was p50 6.8s and
max 56s, and 84 of 240 commands timed out. One `get_content_tree` response was 2.1 MB,
and `scan_nodes_by_types` cost about 4.5 KB per node.

What changed:

- `get_content_tree` is capped at `maxNodes` 2000 and a byte budget of about 500 KB. When
  either limit is hit the response says `truncated` and carries a hint on how to narrow
  the read. The text inventory is opt-in instead of always included.
- `scan_nodes_by_types` defaults to depth 0, so a scan no longer walks whole subtrees
  unless asked.
- Lookup maps are cached, main components are memoized, and async node resolution runs
  with bounded concurrency of 8.
- The plugin scheduler has a heavy lane: only one heavy read runs at a time. Light reads
  may jump ahead of a queued heavy read, but never ahead of a write, so write ordering is
  preserved.
- Long traversals yield every ~1000 nodes so the plugin stays responsive.
- The plugin reports `queuedMs` on each response envelope. When a command waited more
  than 5s in the queue, the server adds a `warnings` entry ("Waited Xs in the plugin queue
  behind other commands; consider fewer concurrent agents or narrower reads").
- When a command fails with "Unable to establish connection to Figma", the server retries
  it once, but only if it is read-only (`isReadOnlyCall`). Writes fail as before so they
  are never applied twice.

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

## Follow-up: scans that never return (stress test on the Jarvis file)

**Symptom.** `scan_nodes_by_types` with `limit: 1` on three 2000+ node sections never
returned. The watchdog dropped them, the abandoned promises were still pending 12 minutes
later with the plugin idle, and after that every scan hung (even a trivial
`topLevelOnly` page scan), while `get_content_tree` at depth 1 (no `serializeNodes`) kept
working.

**Cause.** A Figma async API await that never settles (an inference from the live run:
the variable/style lookup load or `getMainComponentAsync`), combined with code that had no
timeout on those awaits. This PR's lookup-map cache made it worse: it cached the in-flight
promise, so every call inside the TTL awaited the same hung load, and a partial load
(one Figma call rejected) was cached as if it were complete. The bounded pool was not the
cause: each recursion level gets its own pool, so nested recursion cannot starve (a test
now proves it). Main had no timeouts either, so a hung Figma await already wedged the
plugin there; the shared hung promise is new in this PR.

**Fix.**

- `getLookupMaps` caches only a successfully settled, complete load. Concurrent callers
  share an in-flight load, but each waits at most 10s; on timeout or rejection the
  in-flight promise is dropped and the call serializes with empty maps plus a `warnings`
  entry (bindings by id only).
- Every `getMainComponentAsync` is capped at 5s and every `getNodeByIdAsync` in
  `serializeNodes` at 10s. A timed-out lookup is evicted from the per-call memo and
  reported in `warnings`; the node is returned without main-component info.
- The scan walk is iterative, yields every 1000 nodes, stops after 50000 visited nodes
  (`maxVisited`) or 5s before the command deadline, and then reports `totalExact: false`,
  `stopReason`, `visited` and `truncated: true`. `totalFound` is then a lower bound.
- The default plugin watchdog (no caller deadline) is 60s instead of 180s.
- `get_plugin_health` reports `healthy: true` again once any command completes normally
  after the most recent watchdog. `abandonedStillRunning` stays in the report as info,
  since an abandoned promise can never be cancelled and does not block the queue.

**Tests.** `tests/unit/handlers/serializer-hang.test.ts` reproduces the hung and rejected
lookup poisoning and the hung main-component lookup (all four fail against the previous
serializer), proves nested bounded recursion completes, and covers the scan caps.
`tests/unit/plugin/command-scheduler.test.ts` covers a light read running after a heavy
command is abandoned.

## Cooperative cancellation

`utils/cancellation.ts` + `utils/command-scheduler.ts`. Every scheduled command gets a cancel token.

- **What aborts it.** The watchdog firing, a server `cancel {id}` (sent by `sendCommandToFigma` when its own timeout fires; the UI forwards it to main as `cancel-command`), or a disconnect (below).
- **Reads only.** Only READ tokens are ever aborted. A write that has started always runs to completion. Nothing is resent; the existing read-only resend after a dropped socket is unchanged.
- **Not started means never started.** A command cancelled while queued, dropped past its deadline, or refused by the queue cap never runs.
- **Where walks stop.** Walks capture the token when they start (`getCommandSignal()`), because a later command replaces the module slot. They check it at each yield point (`createYielder`, every ~1000 nodes) and between awaited Figma calls, then throw `CancelledError`. That covers get_content_tree, the scan walk, the serializer recursion (a cancelled child is rethrown, not degraded to null), lint_frame (between its awaited steps, because the scan itself is synchronous), contrast_check_frame (every 1000 nodes and around the image fetch), search_nodes (between pages) and get_outline.
- **Health counters.** A read that stops this way frees its slot at once and is counted as `cancelled`, not `abandonedStillRunning`.
- **Uncancellable Figma promises.** A pending Figma API promise (getMainComponentAsync, exportAsync, loadFontAsync, getNodeByIdAsync) cannot be cancelled. If a command is cancelled while one is in flight, the promise is abandoned: it settles whenever Figma finishes and its result is ignored. The walk stops at its next check.

## Cancel on disconnect

- **The plugin's relay socket closes.** The UI posts `relay-disconnected` and the scheduler drops every queued command, reads and writes alike, because no one can receive their result. It aborts a running read. A running write finishes and its result is ignored.
- **One MCP client drops while the plugin stays up.** The relay stamps `clientId` on every command it forwards to the plugin. When that client's socket closes, the relay sends `client_gone {clientId}` and the same rules apply to that client's commands only.
- **Health counters.** These are `droppedOnDisconnect` (queued, never started) and `cancelledOnDisconnect` (running when the disconnect hit).

## Fast traversal and the two-step read

- **`figma.skipInvisibleInstanceChildren`.** It is ON for the read walks scan_nodes_by_types, get_outline, search_nodes, lint_frame, find_unbound, find_overlaps and contrast_check_frame. It is OFF for writes, for get_content_tree (hidden-node recovery depends on it) and for any call that passes `include_hidden: true` / `includeHidden` / `ignore_hidden: false`. **Behaviour change:** these scans no longer see invisible nodes inside instances.
- **Native type filtering.** The scan walk and search_nodes (when `types` is given) use `findAllWithCriteria({ types })`, one top-level child at a time, so the cap, deadline and cancel checks run between chunks. A single huge child is one native call and cannot be interrupted. lint_frame and contrast_check_frame keep their custom walks, because they need every node (lint) or ancestor-visibility pruning (contrast).
- **`loadAllPagesAsync`.** search_nodes now loads pages one at a time and stops loading once its limit is reached. setup_design_system no longer loads pages, because it only needs page names. get_local_components still loads every page, since it is document-wide by contract.
- **get_outline** gives a cheap, sparse outline at about 50 bytes per node. When get_content_tree truncates, its `hint` names get_outline and lists the top-level child ids (`topLevelIds`) to drill into. A paged get_nodes_info points to get_outline too.
