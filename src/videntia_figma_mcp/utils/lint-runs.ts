/**
 * Tiny in-process record of recent `lint_frame` runs, keyed by node id.
 *
 * Measured rationale: across one production session `lint_frame` was called 136
 * times and re-emitted the same ~18 pre-existing violations every time. Stable
 * violation ids make a delta possible; this store is the other half — it
 * remembers the id set of the previous run so a follow-up call can report
 * "3 new, 15 unchanged, 0 resolved" instead of 18 rows.
 *
 * Deliberately in-process and bounded: it is a per-session convenience, not a
 * durable cache. A missing entry degrades to a full report (and says so).
 */

export interface LintRun {
  runId: string;
  nodeId: string;
  ids: Set<string>;
  at: number;
}

/** Max distinct nodes tracked; oldest entries are evicted beyond this. */
const MAX_NODES = 50;
/** Runs retained per node (most recent first). */
const MAX_RUNS_PER_NODE = 5;

const runsByNode = new Map<string, LintRun[]>();
let counter = 0;

/** Record the violation-id set of a completed run. Returns the new run id. */
export function recordLintRun(nodeId: string, ids: Set<string>): string {
  counter += 1;
  const runId = `R${counter}-${Date.now().toString(36)}`;
  const list = runsByNode.get(nodeId) ?? [];
  list.unshift({ runId, nodeId, ids: new Set(ids), at: Date.now() });
  runsByNode.set(nodeId, list.slice(0, MAX_RUNS_PER_NODE));

  if (runsByNode.size > MAX_NODES) {
    const oldest = [...runsByNode.entries()].sort((a, b) => (a[1][0]?.at ?? 0) - (b[1][0]?.at ?? 0))[0];
    if (oldest) runsByNode.delete(oldest[0]);
  }
  return runId;
}

/**
 * Look up a previous run for `nodeId`.
 * `since` is either a run id or the literal "last" (the most recent prior run).
 * The run just recorded for this call is not yet stored when this is consulted.
 */
export function getLintRun(nodeId: string, since: string): LintRun | undefined {
  const list = runsByNode.get(nodeId);
  if (!list || list.length === 0) return undefined;
  if (since === "last") return list[0];
  return list.find((r) => r.runId === since);
}

/** Test helper — drop all recorded runs. */
export function clearLintRuns(): void {
  runsByNode.clear();
  counter = 0;
}
