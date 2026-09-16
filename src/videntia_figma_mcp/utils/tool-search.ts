/**
 * Task-oriented search over the LIVE tool registry.
 *
 * THIS FILE OWNS THE INDEX, NOT THE RANKING.
 *
 * Every searchable token comes from what the tool itself declared — its name, its
 * description, its registrar category — so a tool added tomorrow is searchable the
 * moment it registers, with no list to update. The ranking (and the ONE hand-written
 * recall artefact, `TOOL_SYNONYMS`) lives in `tool-taxonomy.ts` and is shared with
 * every other consumer. There is deliberately no second synonym map and no second
 * scorer here: this repo has already been bitten twice by a hand-maintained lookup
 * that became a second source of truth and drifted.
 */

import { listRegistryEntries, RegisteredToolEntry } from "./tool-registry.js";
import { matchTools } from "./tool-taxonomy.js";

export interface ToolSearchHit {
  name: string;
  /** Registrar category (e.g. "text", "variable") — what `category:` filters on. */
  category: string;
  /** First sentence of the tool's description, hard-capped. */
  summary: string;
  score: number;
}

interface ToolIndex {
  entries: RegisteredToolEntry[];
  byName: Map<string, RegisteredToolEntry>;
  /** Name -> description text, widened with the registrar category so "color in the
   *  variable category" keeps working through the shared description signal. */
  descriptions: Record<string, string>;
}

let cache: { size: number; index: ToolIndex } | undefined;

/** Build (or reuse) the derived index over everything currently in the registry. */
export function buildToolIndex(): ToolIndex {
  const entries = listRegistryEntries();
  if (cache && cache.size === entries.length) return cache.index;

  const byName = new Map<string, RegisteredToolEntry>();
  const descriptions: Record<string, string> = {};
  for (const entry of entries) {
    byName.set(entry.name, entry);
    descriptions[entry.name] = `${entry.description} ${entry.category}`;
  }
  const index: ToolIndex = { entries, byName, descriptions };
  cache = { size: entries.length, index };
  return index;
}

/** Drop the memoised index (tests re-register the whole surface between cases). */
export function resetToolIndex(): void {
  cache = undefined;
}

/** First sentence of a description, capped so a result page stays cheap. */
export function oneLineSummary(description: string, max = 100): string {
  const firstSentence = description.split(/(?<=\.)\s/)[0] ?? description;
  const clean = firstSentence.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export interface SearchOptions {
  limit?: number;
  category?: string;
}

/**
 * Rank the registered tools against a free-text task description.
 *
 * Pure delegation: the candidate set and the description text come from the live
 * registry, the ordering comes from `matchTools` in `tool-taxonomy.ts`.
 */
export function searchTools(query: string, options: SearchOptions = {}): ToolSearchHit[] {
  const limit = Math.max(1, Math.min(options.limit ?? 8, 50));
  const index = buildToolIndex();

  const candidates = options.category ? index.entries.filter((e) => e.category === options.category) : index.entries;
  if (candidates.length === 0) return [];

  return matchTools(query, {
    toolNames: candidates.map((e) => e.name),
    descriptions: index.descriptions,
    limit,
  }).map((match) => {
    const entry = index.byName.get(match.name)!;
    return {
      name: entry.name,
      category: entry.category,
      summary: oneLineSummary(entry.description),
      score: match.score,
    };
  });
}
