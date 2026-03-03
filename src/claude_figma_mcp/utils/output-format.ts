import { z } from "zod";
import { sendCommandToFigma } from "./websocket.js";
import { convertToJsx } from "./figma-to-jsx.js";
import { filterNodeData, type NodeField } from "./figma-helpers.js";
import type { ReadMyDesignResult } from "../types/index.js";

/**
 * Shared Zod schema for the fields parameter.
 * Controls which properties appear in both JSON and JSX output.
 */
export const fieldsSchema = z.array(
  z.enum([
    "id", "name", "type", "fills", "strokes", "cornerRadius",
    "absoluteBoundingBox", "characters", "style", "children",
    "effects", "opacity", "blendMode", "constraints",
    "layoutMode", "padding", "itemSpacing", "componentProperties",
    "textStyleId", "effectStyleId", "mainComponentId", "bindingIds",
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
  .union([z.coerce.number().int().min(0), z.literal("all")])
  .optional()
  .describe(
    'Max depth of children to include. Default: 1 (direct children only). 0 = no children. Use "all" for unlimited depth.',
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
  const result = (await sendCommandToFigma("get_node_info", {
    nodeIds,
    depth,
  })) as ReadMyDesignResult;
  const selection = (result?.nodes ?? []).map((n) => filterNodeData(n, fields));
  return convertToJsx(selection);
}

