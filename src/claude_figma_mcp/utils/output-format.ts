import { z } from "zod";
import { sendCommandToFigma } from "./websocket.js";
import { convertToJsx } from "./figma-to-jsx.js";
import type { ReadMyDesignResult } from "../types/index.js";

/**
 * Shared Zod schema for the output_format parameter.
 * Defaults to "jsx" so tools return JSX+Tailwind by default.
 */
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
  .union([z.number().int().min(0), z.literal("all")])
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
 * Fetch specific nodes by ID through the read_my_design pipeline and convert to JSX.
 */
export async function fetchNodesAsJsx(nodeIds: string[], depth?: number): Promise<string> {
  const result = (await sendCommandToFigma("read_my_design", {
    nodeIds,
    depth,
  })) as ReadMyDesignResult;
  const selection = result?.selection ?? [];
  return convertToJsx(selection);
}

/**
 * Fetch the current Figma selection through the read_my_design pipeline and convert to JSX.
 */
export async function fetchSelectionAsJsx(depth?: number): Promise<string> {
  const result = (await sendCommandToFigma("read_my_design", {
    depth,
  })) as ReadMyDesignResult;
  const selection = result?.selection ?? [];
  return convertToJsx(selection);
}
