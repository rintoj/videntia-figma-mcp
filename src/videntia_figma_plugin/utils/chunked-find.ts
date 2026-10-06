/**
 * Size-aware, cancellable "find all nodes of these types" walk.
 *
 * `findAllWithCriteria` is fast (no per-node JS callback) but it is one
 * synchronous native call: on a 20k-node subtree it blocks the plugin main
 * thread for seconds, during which cancel, the watchdog and health probes are
 * all ignored. This walk is a hybrid:
 *
 * - it descends depth-first (pre-order, the same order findAllWithCriteria
 *   returns) through the tree with an explicit stack;
 * - for each container it cheaply counts descendants, stopping at
 *   `smallSubtree`; a subtree under that size goes to ONE native call;
 * - a larger container is not handed to the native call, its children are
 *   pushed and walked instead.
 *
 * Every unit of work (a visit, a counted descendant, a native-call result)
 * counts toward a budget; once `yieldEvery` units are spent the walk yields to
 * the event loop and checks the cancel token and the deadline. The longest
 * synchronous stretch is therefore bounded by about
 * `yieldEvery + 2 * smallSubtree` node touches, no matter how big the tree is.
 *
 * `figma.skipInvisibleInstanceChildren` is honoured implicitly: both
 * `children` and `findAllWithCriteria` already omit what the flag hides.
 */

import { type CancelSignal, NEVER_CANCELLED, throwIfCancelled } from "./cancellation";

export const DEFAULT_SMALL_SUBTREE = 2000;
export const DEFAULT_CHUNK_WORK = 1000;

export interface ChunkedFindOptions {
  types: readonly string[];
  signal?: CancelSignal;
  /** Epoch ms after which the walk stops with stopReason "deadline". */
  stopAt?: number;
  /** Stop once this many nodes have been visited (stopReason "maxVisited"). */
  maxVisited?: number;
  /** Subtrees with fewer descendants than this go to one native call. */
  smallSubtree?: number;
  /** Work units between yields. */
  yieldEvery?: number;
  sleep?: () => Promise<void>;
  now?: () => number;
  /**
   * Called for each node whose type matches, in document pre-order. Return
   * false to stop the walk (stopReason "limit").
   */
  onMatch: (node: SceneNode) => boolean | void;
  /** Test hook: the work done in each synchronous stretch between yields. */
  onChunk?: (work: number) => void;
}

export interface ChunkedFindResult {
  visited: number;
  stopReason?: "maxVisited" | "deadline" | "limit";
  nativeCalls: number;
  yields: number;
}

type Kids = { children?: readonly SceneNode[]; findAllWithCriteria?: unknown };

function kidsOf(n: unknown): readonly SceneNode[] | undefined {
  const c = (n as Kids).children;
  return Array.isArray(c) || (c && typeof (c as { length?: unknown }).length === "number") ? c : undefined;
}

/**
 * Count descendants of `node`, stopping as soon as the count reaches `cap`.
 * Returns the exact count when below cap, else `cap`.
 */
export function countDescendants(node: unknown, cap: number): number {
  let count = 0;
  const stack: unknown[] = [node];
  while (stack.length > 0) {
    const kids = kidsOf(stack.pop());
    if (!kids) continue;
    for (let i = 0; i < kids.length; i++) {
      if (++count >= cap) return cap;
      stack.push(kids[i]);
    }
  }
  return count;
}

const defaultSleep = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Walk `roots` (and their subtrees) in pre-order, reporting type matches.
 * The roots themselves are visited and matched.
 */
export async function chunkedFindByTypes(
  roots: readonly SceneNode[],
  opts: ChunkedFindOptions,
): Promise<ChunkedFindResult> {
  const signal = opts.signal ?? NEVER_CANCELLED;
  const small = opts.smallSubtree ?? DEFAULT_SMALL_SUBTREE;
  const every = opts.yieldEvery ?? DEFAULT_CHUNK_WORK;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? (() => Date.now());
  const maxVisited = opts.maxVisited ?? Infinity;
  const types = opts.types;
  const criteria = { types: types as NodeType[] } as Parameters<ChildrenMixin["findAllWithCriteria"]>[0];

  let visited = 0;
  let work = 0;
  let nativeCalls = 0;
  let yields = 0;
  let stopReason: ChunkedFindResult["stopReason"];

  const maybeYield = async (): Promise<boolean> => {
    if (work < every) return true;
    if (opts.onChunk) opts.onChunk(work);
    work = 0;
    throwIfCancelled(signal);
    await sleep();
    yields++;
    throwIfCancelled(signal);
    if (opts.stopAt !== undefined && now() >= opts.stopAt) {
      stopReason = "deadline";
      return false;
    }
    return true;
  };

  const stack: SceneNode[] = [];
  for (let i = roots.length - 1; i >= 0; i--) stack.push(roots[i]);
  throwIfCancelled(signal);

  outer: while (stack.length > 0) {
    if (visited >= maxVisited) {
      stopReason = "maxVisited";
      break;
    }
    if (opts.stopAt !== undefined && now() >= opts.stopAt) {
      stopReason = "deadline";
      break;
    }
    const n = stack.pop() as SceneNode;
    visited++;
    work++;
    if (types.includes(n.type) && opts.onMatch(n) === false) {
      stopReason = "limit";
      break;
    }
    const kids = kidsOf(n);
    if (kids && kids.length > 0) {
      const native = (n as unknown as Kids).findAllWithCriteria;
      const hasNative = typeof native === "function";
      const size = hasNative ? countDescendants(n, small) : small;
      if (hasNative) work += size;
      if (hasNative && size < small) {
        // Small enough: one bounded native call.
        throwIfCancelled(signal);
        nativeCalls++;
        const found = (n as unknown as ChildrenMixin).findAllWithCriteria(criteria);
        visited += size;
        work += found.length;
        for (const f of found) {
          if (opts.onMatch(f as SceneNode) === false) {
            stopReason = "limit";
            break outer;
          }
        }
      } else {
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      }
    }
    if (!(await maybeYield())) break;
  }
  if (opts.onChunk && work > 0) opts.onChunk(work);
  return { visited, stopReason, nativeCalls, yields };
}
