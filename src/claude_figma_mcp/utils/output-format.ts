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
  .describe('Output format. Always defaults to "jsx" which returns JSX+Tailwind markup. Use "json" only when you specifically need raw Figma node properties.');

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
export async function fetchSelectionAsJsx(): Promise<string> {
  const result = (await sendCommandToFigma("read_my_design", {})) as ReadMyDesignResult;
  const selection = result?.selection ?? [];
  return convertToJsx(selection);
}
