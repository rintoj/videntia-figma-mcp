import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket.js";
import { mcpBooleanSchema } from "../utils/mcp-boolean.js";
import { cursorSchema, paginate, pageNotice } from "../utils/output-format.js";
import {
  defaultExportPath,
  postProcessExport,
  sessionExportDir,
  writeExportToPath,
} from "../utils/export-image-post.js";
import { approximateImageTokens, exportCacheKey, getCachedExport, setCachedExport } from "../utils/export-cache.js";

/**
 * Outline projection of one content-tree node.
 *
 * Measured rationale: 186/186 `get_content_tree` calls in one production
 * session passed no projection at all (2,258 tokens mean). A never-used option
 * is a default problem, so the projection is now the default and the full tree
 * is opt-in via view:"full".
 */
function projectContentNode(node: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {
    id: node.id,
    name: node.name,
    type: node.type,
  };
  if (node.role !== undefined) out.role = node.role;
  if (node.text !== undefined && node.text !== "") out.text = node.text;
  if (node.boundVariables !== undefined) out.boundVariables = node.boundVariables;
  if (node.bindings !== undefined) out.bindings = node.bindings;
  if (Array.isArray(node.children)) {
    out.children = node.children.map(projectContentNode);
  } else if (
    "children" in node === false &&
    (node.type === "FRAME" || node.type === "GROUP" || node.type === "INSTANCE" || node.type === "COMPONENT")
  ) {
    // Container reached the depth cut-off: say so rather than implying it is a leaf.
    out.truncatedChildren = true;
  }
  return out;
}

export function registerDocumentationTools(server: McpServer): void {
  server.tool(
    "enumerate_all_frames",
    "List all frames across all pages (or a specific page) with metadata: name, size, position, prototype links, annotations, and child count. Use this as the starting point for documentation workflows.",
    {
      pageId: z.string().optional().describe("Scope to a specific page ID. Omit to scan all pages."),
      topLevelOnly: z
        .boolean()
        .optional()
        .default(true)
        .describe("Only return top-level frames (direct children of pages). Set false to include nested frames."),
      includeComponents: z
        .boolean()
        .optional()
        .default(false)
        .describe("Also include COMPONENT and COMPONENT_SET nodes."),
    },
    async ({ pageId, topLevelOnly, includeComponents }) => {
      try {
        const result = await sendCommandToFigma<Record<string, unknown>>("enumerate_all_frames", {
          pageId,
          topLevelOnly,
          includeComponents,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error enumerating frames: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "bulk_export_frames",
    "Export multiple frames as images. BY DEFAULT every frame is WRITTEN TO A FILE and only {nodeId,name,path,width,height,bytes} is returned — no inline base64. " +
      "Pass `inline: true` ONLY when you genuinely need to SEE the pixels in this conversation (this multiplies the single most expensive operation in the server by N frames). " +
      "Results are PAGED: `limit` frames per call (default 10), follow `next_cursor` for the rest. " +
      "Unchanged frames are served from the session render cache (bypass with `force_refresh: true`). " +
      "If no nodeIds are provided, exports all top-level frames on the current page (or specified page).",
    {
      nodeIds: z
        .array(z.string())
        .optional()
        .describe("List of frame/node IDs to export. Omit to export all top-level frames on the page."),
      format: z.enum(["PNG", "JPG", "SVG", "PDF"]).optional().default("PNG").describe("Export format."),
      scale: z.coerce
        .number()
        .min(0.1)
        .max(4)
        .optional()
        .default(1)
        .describe("Export scale factor (1 = 1x, 2 = 2x, etc.). Values above 1 multiply the pixel and byte cost."),
      pageId: z.string().optional().describe("Page to export from when nodeIds is omitted."),
      out_dir: z
        .string()
        .optional()
        .describe(
          "Absolute directory to write the exports into. Created if missing. Defaults to this session's export directory.",
        ),
      inline: mcpBooleanSchema
        .optional()
        .describe(
          "Return the pixels inline in this conversation instead of writing files. VERY expensive — one image per frame.",
        ),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(10)
        .describe("Max frames exported per call (default 10). Remaining frames are PAGED via next_cursor."),
      cursor: cursorSchema,
      max_width: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe("Downscale each exported image so its width is at most this many pixels (raster formats only)."),
      max_height: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe("Downscale each exported image so its height is at most this many pixels (raster formats only)."),
      jpeg_quality: z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("JPEG encode quality 1-100 — format 'JPG' only."),
      allow_full_resolution: mcpBooleanSchema
        .optional()
        .describe("Return inline images at full resolution, bypassing the default 1200px longest-edge cap."),
      force_refresh: mcpBooleanSchema
        .optional()
        .describe("Bypass the session render cache and force a fresh export of every frame on this page."),
    },
    async ({
      nodeIds,
      format,
      scale,
      pageId,
      out_dir,
      inline,
      limit,
      cursor,
      max_width,
      max_height,
      jpeg_quality,
      allow_full_resolution,
      force_refresh,
    }) => {
      try {
        const resolvedFormat = (format || "PNG").toUpperCase();
        const resolvedScale = scale ?? 1;
        const wantsInline = inline === true;

        // Resolve the full frame list FIRST so pagination happens before any
        // rendering — exporting a whole board in one plugin round trip is what
        // produced the "Request to Figma timed out" failures.
        let allIds: string[];
        if (nodeIds && nodeIds.length > 0) {
          allIds = nodeIds;
        } else {
          const listed = (await sendCommandToFigma<{ frames?: Array<{ id: string }> }>("enumerate_all_frames", {
            pageId,
            topLevelOnly: true,
            includeComponents: true,
          })) as { frames?: Array<{ id: string }> };
          allIds = (listed?.frames ?? []).map((f) => f.id);
        }

        const page = paginate(allIds, cursor, limit ?? 10);
        const notice = pageNotice("Frames exported", page);

        if (page.items.length === 0) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ exports: [], notice }, null, 2) }],
          };
        }

        const result = (await sendCommandToFigma<Record<string, unknown>>("bulk_export_frames", {
          nodeIds: page.items,
          format: resolvedFormat,
          scale: resolvedScale,
          pageId,
        })) as {
          exports?: Array<{
            nodeId: string;
            name: string;
            format: string;
            width: number;
            height: number;
            data: string;
            subtreeHash?: string | null;
            error?: string;
          }>;
        };

        const exportsIn = result?.exports ?? [];
        const targetDir = out_dir ?? (await sessionExportDir());
        if (out_dir) {
          const path = await import("path");
          const fs = await import("fs");
          if (!path.isAbsolute(out_dir)) throw new Error(`out_dir must be an absolute path, got: ${out_dir}`);
          fs.mkdirSync(out_dir, { recursive: true });
        }

        const rows: Array<Record<string, unknown>> = [];
        const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
        let cacheHits = 0;
        let tokensSaved = 0;

        for (const item of exportsIn) {
          if (item.error || !item.data) {
            rows.push({ nodeId: item.nodeId, name: item.name, error: item.error || "empty export" });
            continue;
          }

          const cacheKey = exportCacheKey({
            nodeId: item.nodeId,
            scale: resolvedScale,
            format: resolvedFormat,
            subtreeHash: item.subtreeHash,
            maxWidth: max_width,
            maxHeight: max_height,
            jpegQuality: jpeg_quality,
            allowFullResolution: allow_full_resolution === true,
            inline: wantsInline,
          });
          const cached = force_refresh === true ? undefined : getCachedExport(cacheKey);

          if (cached) {
            cacheHits++;
            tokensSaved += cached.approxTokens;
            if (cached.path && !wantsInline) {
              rows.push({
                nodeId: item.nodeId,
                name: item.name,
                path: cached.path,
                width: cached.width,
                height: cached.height,
                bytes: cached.bytes,
                format: cached.format,
                cached: true,
              });
              continue;
            }
            if (cached.base64 && wantsInline) {
              rows.push({
                nodeId: item.nodeId,
                name: item.name,
                width: cached.width,
                height: cached.height,
                bytes: cached.bytes,
                format: cached.format,
                cached: true,
                inline: true,
              });
              images.push({
                type: "image",
                data: cached.base64,
                mimeType: cached.mimeType || "image/png",
              });
              continue;
            }
          }

          const longestSourceEdge = Math.max(item.width || 0, item.height || 0);
          const hardMaxEdge =
            resolvedScale < 1 && longestSourceEdge > 0
              ? Math.max(1, Math.round(longestSourceEdge * resolvedScale))
              : undefined;

          const processed = await postProcessExport({
            base64: item.data,
            format: resolvedFormat,
            maxWidth: max_width,
            maxHeight: max_height,
            allowFullResolution: allow_full_resolution === true || !wantsInline,
            jpegQuality: jpeg_quality,
            hardMaxEdge,
          });

          const width = processed.width ?? item.width;
          const height = processed.height ?? item.height;
          const approxTokens = approximateImageTokens(width, height);

          if (!wantsInline) {
            const pathMod = await import("path");
            const defaultPath = await defaultExportPath(item.nodeId, resolvedScale, resolvedFormat);
            const targetPath = pathMod.join(targetDir, pathMod.basename(defaultPath));
            const written = await writeExportToPath(targetPath, processed.base64);
            setCachedExport(cacheKey, {
              path: written.path,
              contentHash: written.sha256,
              width,
              height,
              bytes: written.bytes,
              format: resolvedFormat,
              approxTokens,
            });
            rows.push({
              nodeId: item.nodeId,
              name: item.name,
              path: written.path,
              width,
              height,
              bytes: written.bytes,
              format: resolvedFormat,
              cached: false,
            });
            continue;
          }

          const mimeType = resolvedFormat === "JPG" ? "image/jpeg" : "image/png";
          setCachedExport(cacheKey, {
            base64: processed.base64,
            mimeType,
            width,
            height,
            bytes: processed.bytes,
            format: resolvedFormat,
            approxTokens,
          });
          rows.push({
            nodeId: item.nodeId,
            name: item.name,
            width,
            height,
            bytes: processed.bytes,
            format: resolvedFormat,
            cached: false,
            inline: true,
          });
          images.push({ type: "image", data: processed.base64, mimeType });
        }

        const summary = {
          format: resolvedFormat,
          scale: resolvedScale,
          out_dir: wantsInline ? undefined : targetDir,
          total_frames: page.total,
          exported_this_page: rows.length,
          cache_hits: cacheHits,
          approx_tokens_saved_by_cache: tokensSaved,
          next_cursor: page.nextCursor,
          notice,
          note: wantsInline
            ? "Inline mode: one image per frame in this conversation. Omit inline to get file paths instead (far cheaper)."
            : "Images were written to disk; no pixels are inlined. Pass inline: true only if you must see them here.",
          exports: rows,
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }, ...images],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error bulk exporting frames: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "get_content_tree",
    'Extract the content tree from a frame, page, or node — text content with inferred semantic roles (heading, subheading, body, cta, label, hint), component types, and layout containers, plus a flat text inventory for copy auditing. Returns a SHALLOW, PROJECTED tree by default (maxDepth 2, outline view) — pass view:"full" and a larger maxDepth for everything.',
    {
      nodeId: z
        .string()
        .optional()
        .describe("Root node ID to extract content from. Omit to extract from all top-level frames on the page."),
      pageId: z.string().optional().describe("Page to extract from when nodeId is omitted."),
      maxDepth: z.coerce
        .number()
        .min(1)
        .max(20)
        .optional()
        .default(2)
        .describe(
          "Maximum depth to traverse the node tree. Default: 2 (was 5) — deeper levels are collapsed to a child count, not silently dropped. Raise it when you actually need the deep structure.",
        ),
      view: z
        .enum(["outline", "full"])
        .optional()
        .default("outline")
        .describe(
          'Projection. "outline" (default) keeps id/name/type/role/text/bound variables and drops geometry, font metrics and image markers. "full" returns every field the plugin produced.',
        ),
      includeImages: mcpBooleanSchema
        .optional()
        .default(false)
        .describe("Include image fill indicators in the output."),
      text_limit: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Max text-inventory entries per page. Default: 100. Remaining entries are PAGED via next_cursor."),
      cursor: cursorSchema,
    },
    async ({ nodeId, pageId, maxDepth, includeImages, view, text_limit, cursor }) => {
      try {
        const result = await sendCommandToFigma<Record<string, unknown>>("get_content_tree", {
          nodeId,
          pageId,
          maxDepth,
          includeImages,
        });

        const tree = (result?.tree as any[]) ?? [];
        const projected = view === "full" ? tree : tree.map(projectContentNode);
        const inventory = (result?.textInventory as any[]) ?? [];
        const page = paginate(inventory, cursor, text_limit ?? 100);

        const notices: string[] = [
          `get_content_tree: view=${view}, maxDepth=${maxDepth}.`,
          view === "full"
            ? "Tree is the FULL plugin projection."
            : 'Tree is the OUTLINE projection: id, name, type, role, text and bound variables only. Node geometry (width/height), font size/weight and image-fill markers are OMITTED — pass view:"full" for them.',
          `Nodes deeper than maxDepth=${maxDepth} are NOT included; a node cut off there carries "truncatedChildren": true. Raise maxDepth (max 20) to see them.`,
          pageNotice("textInventory", page),
        ];

        const payload: Record<string, unknown> = {
          _notice: notices,
          nodeCount: result?.nodeCount,
          view,
          maxDepth,
          tree: projected,
          textInventory: page.items,
          textInventoryTotal: page.total,
        };
        if (page.nextCursor !== undefined) payload.next_cursor = page.nextCursor;

        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting content tree: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "get_frame_documentation",
    "Get a complete documentation packet for one or more frames: metadata, all annotations (recursively from every child node), all comments anchored to or positioned within the frame, and prototype navigation links. Use this to generate per-screen documentation without multiple round-trips.",
    {
      nodeId: z.string().optional().describe("Single frame/node ID to document. Ignored if nodeIds is provided."),
      nodeIds: z
        .array(z.string())
        .optional()
        .describe("Multiple frame/node IDs to document in one call. Takes precedence over nodeId."),
      includeResolved: z.boolean().optional().default(false).describe("Include resolved comments (default: false)."),
    },
    async ({ nodeId, nodeIds, includeResolved }) => {
      try {
        const ids = nodeIds ?? (nodeId ? [nodeId] : []);
        if (ids.length === 0) {
          return { content: [{ type: "text", text: "Provide nodeId or nodeIds" }] };
        }
        const result = await sendCommandToFigma<Record<string, unknown>>("get_frame_documentation", {
          nodeIds: ids,
          includeResolved,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting frame documentation: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}
