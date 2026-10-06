/**
 * Cancellable "find all nodes of these types" walk that never pre-counts.
 *
 * `findAllWithCriteria` is fast (no per-node JS callback), but it is one
 * synchronous native call. Every JS `.children` access crosses from plugin JS
 * into Figma's node tree and is the expensive part, so this walk touches as
 * few nodes from JS as possible:
 *
 * - it walks depth-first (pre-order, the same order findAllWithCriteria
 *   returns) with an explicit stack;
 * - for each node it reads ONE structural signal, its direct child count;
 * - a node with more direct children than `descendAbove` is descended (its
 *   children are pushed), anything smaller goes to ONE native call;
 * - adaptive budget: each native call is timed; when one takes longer than
 *   `nativeBudgetMs`, its remaining siblings are descended one level instead
 *   of handed to the native call whole. No node counting happens in JS.
 *
 * JS node accesses are therefore O(native calls + children of descended
 * containers), not O(nodes). The walk yields between native calls (and every
 * `yieldEvery` JS visits) to check the cancel token and the deadline.
 *
 * `figma.skipInvisibleInstanceChildren` is honoured implicitly: both
 * `children` and `findAllWithCriteria` already omit what the flag hides.
 */

import { type CancelSignal, NEVER_CANCELLED, throwIfCancelled } from "./cancellation";

/** Nodes with more direct children than this are descended, not sent native. */
export const DEFAULT_DESCEND_ABOVE = 1000;
/** A native call slower than this makes its remaining siblings descend a level. */
export const DEFAULT_NATIVE_BUDGET_MS = 200;
/** JS visits between yields. */
export const DEFAULT_CHUNK_WORK = 500;

export interface ChunkedFindOptions {
  types: readonly string[];
  signal?: CancelSignal;
  /** Epoch ms after which the walk stops with stopReason "deadline". */
  stopAt?: number;
  /** Stop once this many nodes have been visited (stopReason "maxVisited"). */
  maxVisited?: number;
  /** Direct-child count above which a node is descended instead of sent native. */
  descendAbove?: number;
  /** Time budget per native call (ms) for the adaptive descent. */
  nativeBudgetMs?: number;
  /** JS visits between yields. */
  yieldEvery?: number;
  sleep?: () => Promise<void>;
  now?: () => number;
  /**
   * Called for each node whose type matches, in document pre-order. Return
   * false to stop the walk (stopReason "limit").
   */
  onMatch: (node: SceneNode) => boolean | void;
}

export interface ChunkedFindResult {
  /** Nodes visited from JS plus nodes returned by native calls (a lower bound). */
  visited: number;
  stopReason?: "maxVisited" | "deadline" | "limit";
  nativeCalls: number;
  /** Nodes whose `.children` were read from JS. */
  jsVisits: number;
  yields: number;
}

type Kids = { children?: readonly SceneNode[]; findAllWithCriteria?: unknown };

function kidsOf(n: unknown): readonly SceneNode[] | undefined {
  const c = (n as Kids).children;
  return Array.isArray(c) || (c && typeof (c as { length?: unknown }).length === "number") ? c : undefined;
}

const defaultSleep = () => new Promise<void>((r) => setTimeout(r, 0));

/** Shared by siblings: set when one of them had a slow native call. */
interface SiblingGroup {
  slow: boolean;
}

/**
 * Walk `roots` (and their subtrees) in pre-order, reporting type matches.
 * The roots themselves are visited and matched.
 */
export async function chunkedFindByTypes(
  roots: readonly SceneNode[],
  opts: ChunkedFindOptions,
): Promise<ChunkedFindResult> {
  const signal = opts.signal ?? NEVER_CANCELLED;
  const descendAbove = opts.descendAbove ?? DEFAULT_DESCEND_ABOVE;
  const budget = opts.nativeBudgetMs ?? DEFAULT_NATIVE_BUDGET_MS;
  const every = opts.yieldEvery ?? DEFAULT_CHUNK_WORK;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? (() => Date.now());
  const maxVisited = opts.maxVisited ?? Infinity;
  const types = opts.types;
  const criteria = { types: types as NodeType[] } as Parameters<ChildrenMixin["findAllWithCriteria"]>[0];

  let visited = 0;
  let jsVisits = 0;
  let sinceYield = 0;
  let nativeCalls = 0;
  let yields = 0;
  let stopReason: ChunkedFindResult["stopReason"];

  const pastDeadline = () => opts.stopAt !== undefined && now() >= opts.stopAt;
  const doYield = async (): Promise<boolean> => {
    sinceYield = 0;
    throwIfCancelled(signal);
    await sleep();
    yields++;
    throwIfCancelled(signal);
    if (pastDeadline()) {
      stopReason = "deadline";
      return false;
    }
    return true;
  };

  const rootGroup: SiblingGroup = { slow: false };
  const stack: Array<{ node: SceneNode; group: SiblingGroup }> = [];
  for (let i = roots.length - 1; i >= 0; i--) stack.push({ node: roots[i], group: rootGroup });
  throwIfCancelled(signal);

  outer: while (stack.length > 0) {
    if (visited >= maxVisited) {
      stopReason = "maxVisited";
      break;
    }
    if (pastDeadline()) {
      stopReason = "deadline";
      break;
    }
    const { node: n, group } = stack.pop() as { node: SceneNode; group: SiblingGroup };
    visited++;
    jsVisits++;
    sinceYield++;
    if (types.includes(n.type) && opts.onMatch(n) === false) {
      stopReason = "limit";
      break;
    }
    const kids = kidsOf(n);
    if (kids && kids.length > 0) {
      const hasNative = typeof (n as unknown as Kids).findAllWithCriteria === "function";
      if (hasNative && kids.length <= descendAbove && !group.slow) {
        // One native call for the whole subtree, timed for the adaptive budget.
        throwIfCancelled(signal);
        nativeCalls++;
        const t0 = now();
        const found = (n as unknown as ChildrenMixin).findAllWithCriteria(criteria);
        if (now() - t0 > budget) group.slow = true;
        visited += found.length;
        for (const f of found) {
          if (opts.onMatch(f as SceneNode) === false) {
            stopReason = "limit";
            break outer;
          }
        }
        if (!(await doYield())) break;
        continue;
      }
      const childGroup: SiblingGroup = { slow: false };
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i], group: childGroup });
    }
    if (sinceYield >= every && !(await doYield())) break;
  }
  return { visited, stopReason, nativeCalls, jsVisits, yields };
}
