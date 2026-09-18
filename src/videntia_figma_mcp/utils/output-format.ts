import { z } from "zod";
import { sendCommandToFigma } from "./websocket.js";
import { convertToJsx } from "./figma-to-jsx.js";
import { filterNodeData, type NodeField } from "./figma-helpers.js";
import type { NodeListResult } from "../types/index.js";

/**
 * Shared Zod schema for the fields parameter.
 * Controls which properties appear in both JSON and JSX output.
 */
export const fieldsSchema = z.array(
  z.enum([
    "id",
    "name",
    "type",
    "fills",
    "strokes",
    "cornerRadius",
    "absoluteBoundingBox",
    "characters",
    "style",
    "children",
    "effects",
    "opacity",
    "blendMode",
    "constraints",
    "layoutMode",
    "padding",
    "itemSpacing",
    "componentProperties",
    "textStyleId",
    "effectStyleId",
    "mainComponentId",
    "bindingIds",
  ]),
);

/** Fields that contain raw IDs — stripped by default, included only when explicitly requested. */
export const ID_FIELDS = ["textStyleId", "effectStyleId", "mainComponentId", "bindingIds"] as const;

export const outputFormatSchema = z
  .enum(["jsx", "json"])
  .optional()
  .default("jsx")
  .describe(
    'Output format. Always defaults to "jsx" which returns JSX+Tailwind markup. Use "json" only when you specifically need raw Figma node properties.',
  );

/**
 * Shared Zod schema for the depth parameter.
 * Accepts a non-negative integer or the literal string "all" for unlimited depth.
 */
export const depthSchema = z
  .union([z.literal("all"), z.coerce.number().int().min(0)])
  .optional()
  .describe(
    'Max depth of children to include. Default: 1 (direct children only). 0 = no children. Use "all" for unlimited depth (warning: may timeout on large documents with deep nesting).',
  );

/**
 * Resolve the depth parameter: "all" → undefined (no limit), missing → 1 (default).
 */
export function resolveDepth(depth: number | "all" | undefined): number | undefined {
  if (depth === "all") return undefined;
  if (depth === undefined) return 1;
  return depth;
}

/**
 * Fetch specific nodes by ID and convert to JSX.
 */
export async function fetchNodesAsJsx(nodeIds: string[], depth?: number, fields?: NodeField[]): Promise<string> {
  const effectiveDepth = depth !== undefined ? depth : 1;
  const result = (await sendCommandToFigma("get_node_info", {
    nodeIds,
    depth: effectiveDepth,
  })) as NodeListResult;
  const selection = (result?.nodes ?? []).map((n) => filterNodeData(n, fields));
  return convertToJsx(selection);
}

/**
 * Output format for node-reading tools, extended with a terse "compact" mode:
 * one line per node (name/type/id/geometry/key styles), no className strings.
 */
export const nodeOutputFormatSchema = z
  .enum(["jsx", "json", "compact"])
  .optional()
  .default("jsx")
  .describe(
    'Output format. Defaults to "jsx" (JSX+Tailwind markup). Use "compact" for a terse one-line-per-node listing (far fewer tokens), or "json" for raw Figma node properties.',
  );

/** Alias parameter so callers can pass `format: "compact"` directly. */
export const nodeFormatAliasSchema = z
  .enum(["jsx", "json", "compact"])
  .optional()
  .describe('Alias for output_format. When set, overrides output_format. Use "compact" for terse output.');

/**
 * Like {@link nodeOutputFormatSchema} but defaulting to "compact".
 *
 * Measured rationale: across one production session, 99% of `get_nodes_info`
 * calls and 60% of `search_nodes` calls passed no projection at all, paying the
 * full JSX/Tailwind rendering every time. A never-used option is a default
 * problem, not a discipline problem — so the cheap rendering is now the default
 * and full detail is opt-in.
 */
export const compactDefaultOutputFormatSchema = z
  .enum(["jsx", "json", "compact"])
  .optional()
  .default("compact")
  .describe(
    'Output format. Defaults to "compact" (one terse line per node — far fewer tokens). Pass "jsx" for JSX+Tailwind markup or "json" for raw Figma node properties.',
  );

/** Notice appended whenever the compact projection is in effect, so a reduced response is never mistaken for a full one. */
export const COMPACT_DEFAULT_NOTICE =
  'Output is the COMPACT projection (default): one line per node with name, type, id, geometry and key style tokens. Full node properties (fills, effects, constraints, componentProperties, className markup) are OMITTED. Pass output_format:"jsx" or output_format:"json" for the complete representation.';

/**
 * Shared cursor parameter for paged list reads.
 * Opaque to callers but is simply a numeric offset into the result list.
 */
export const cursorSchema = z
  .union([z.coerce.number().int().min(0), z.string()])
  .optional()
  .describe(
    "Opaque pagination cursor from a previous response's next_cursor. Omit for the first page. Large results are PAGED, not truncated — follow next_cursor until it is absent.",
  );

/** Parse a cursor (number or numeric string) into a zero-based offset. */
export function parseCursor(cursor: number | string | undefined): number {
  if (cursor === undefined) return 0;
  const n = typeof cursor === "number" ? cursor : Number.parseInt(cursor, 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export interface PageInfo<T> {
  items: T[];
  offset: number;
  total: number;
  nextCursor?: string;
}

/** Slice `items` into one page starting at `cursor`. */
export function paginate<T>(items: T[], cursor: number | string | undefined, limit: number): PageInfo<T> {
  const offset = parseCursor(cursor);
  const page = items.slice(offset, offset + limit);
  const end = offset + page.length;
  return {
    items: page,
    offset,
    total: items.length,
    nextCursor: end < items.length ? String(end) : undefined,
  };
}

/** Human-readable, unmistakable page banner. Always states what is missing and how to get it. */
export function pageNotice(label: string, page: PageInfo<unknown>): string {
  const end = page.offset + page.items.length;
  if (page.nextCursor === undefined && page.offset === 0) {
    return `${label}: ${page.total} of ${page.total} (complete — no further pages).`;
  }
  const remaining = page.total - end;
  return (
    `${label}: showing ${page.offset + 1}-${end} of ${page.total} — this is a PARTIAL page, not the full result.` +
    (page.nextCursor !== undefined
      ? ` ${remaining} more remain; re-call with cursor:"${page.nextCursor}" for the next page. next_cursor: ${page.nextCursor}`
      : " This is the last page.")
  );
}
