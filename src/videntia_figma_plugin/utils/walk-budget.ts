/**
 * Pure helpers that keep large tree walks from freezing the plugin:
 * a node/byte budget tracker and a cooperative yielder.
 */

export const DEFAULT_MAX_NODES = 2000;
export const DEFAULT_MAX_BYTES = 500 * 1024;
export const DEFAULT_YIELD_EVERY = 1000;

export interface WalkBudget {
  /** Account for one node with the given serialized size. Returns false once a limit is hit. */
  take(bytes: number): boolean;
  readonly nodes: number;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly reason: "maxNodes" | "maxBytes" | undefined;
}

export function createWalkBudget(maxNodes = DEFAULT_MAX_NODES, maxBytes = DEFAULT_MAX_BYTES): WalkBudget {
  let nodes = 0;
  let bytes = 0;
  let reason: "maxNodes" | "maxBytes" | undefined;
  return {
    take(size: number): boolean {
      if (reason) return false;
      if (nodes + 1 > maxNodes) {
        reason = "maxNodes";
        return false;
      }
      if (bytes + size > maxBytes) {
        reason = "maxBytes";
        return false;
      }
      nodes += 1;
      bytes += size;
      return true;
    },
    get nodes() {
      return nodes;
    },
    get bytes() {
      return bytes;
    },
    get truncated() {
      return reason !== undefined;
    },
    get reason() {
      return reason;
    },
  };
}

/** Estimate the JSON size of a node's own fields (children excluded). */
export function estimateNodeBytes(node: Record<string, unknown>): number {
  let size = 2;
  for (const key in node) {
    if (key === "children") continue;
    const v = node[key];
    if (v === undefined) continue;
    size += key.length + 4 + (typeof v === "string" ? v.length + 2 : JSON.stringify(v).length);
  }
  return size;
}

/** Returns a function that yields to the event loop once every `every` calls. */
export function createYielder(every = DEFAULT_YIELD_EVERY, sleep: () => Promise<void> = defaultSleep) {
  let count = 0;
  return async function tick(): Promise<void> {
    count += 1;
    if (count % every === 0) await sleep();
  };
}

function defaultSleep(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export function truncationHint(
  reason: "maxNodes" | "maxBytes" | undefined,
  maxNodes: number,
  maxBytes: number,
): string {
  const what = reason === "maxBytes" ? `maxBytes=${maxBytes}` : `maxNodes=${maxNodes}`;
  return `Output stopped at ${what}. Narrow the scope with a deeper nodeId, lower maxDepth, or raise maxNodes/maxBytes.`;
}
