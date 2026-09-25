/**
 * Verification tools (§7) — mechanical checks that were previously done by
 * hand (and therefore inconsistently): resolved-backdrop contrast sweeps,
 * sibling overlap detection, write-landed assertions, unbound-token rollups
 * and cross-collection token collisions.
 *
 * The Figma plugin returns raw data; the arithmetic lives in
 * ../utils/verification-math.ts so it is unit-testable.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket.js";
import { mcpBooleanSchema } from "../utils/mcp-boolean.js";
import { normalizeNodeId } from "../utils/figma-helpers.js";
import {
  sweepContrast,
  findOverlappingSiblings,
  diffNodeState,
  findTokenCollisions,
  type TextSample,
  type ContrastFinding,
  type ContrastSegmentFinding,
  type OverlapNode,
  type VariableRecord,
} from "../utils/verification-math.js";
import { decodeBackdropImages } from "../utils/image-backdrop.js";

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

function errorText(prefix: string, error: unknown) {
  return text(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);
}

export function registerVerificationTools(server: McpServer): void {
  // ── contrast_check_frame ───────────────────────────────────────────────────
  server.tool(
    "contrast_check_frame",
    "Sweep EVERY text node in a frame for WCAG contrast against its RESOLVED backdrop: the page background, every ancestor (opacity, clipping) and the sibling shapes painted beneath the text (e.g. a button's rectangle), composited in paint order with gradients sampled at several points across the text box — the worst point wins. Mixed-style text is scored per styled segment, each against its own large-text threshold (WCAG: ≥24px, or ≥18.67px at weight ≥700). IMAGE backdrops and image text fills are SAMPLED from the image pixels (scaleMode FILL/FIT/CROP/TILE, worst of a grid of points across the text box); image filters are not simulated and are noted as approximate. VIDEO/pattern paints, or images that could not be fetched/decoded or exceed the byte budget, are reported as INDETERMINATE (not pass, not fail) with the reason. Use this instead of eyeballing colours.",
    {
      nodeId: z.string().describe("Frame (or any container) to sweep"),
      include_hidden: mcpBooleanSchema.optional().describe("Include invisible nodes (default: false)"),
      failures_only: mcpBooleanSchema
        .optional()
        .describe(
          "Report only nodes failing the standard in the table (default: false). Indeterminate nodes are always listed in their own section.",
        ),
      standard: z.enum(["AA", "AAA"]).optional().describe("Standard used for the pass/fail verdict (default: AA)"),
    },
    async ({ nodeId, include_hidden, failures_only, standard }) => {
      try {
        const raw = await sendCommandToFigma<{
          nodeId: string;
          nodeName: string;
          nodesScanned: number;
          truncated: boolean;
          samples: TextSample[];
          images?: Record<string, { base64?: string; error?: string }>;
        }>("contrast_check_frame", { nodeId: normalizeNodeId(nodeId), include_hidden: include_hidden === true }, 60000);

        const images = await decodeBackdropImages(raw.images);
        const report = sweepContrast(raw.samples || [], images);
        const imageTotal = images.size;
        const imageFailed = Array.from(images.values()).filter((v) => typeof v === "string").length;
        const useAAA = standard === "AAA";
        const fails = (f: ContrastFinding | ContrastSegmentFinding) => (useAAA ? !f.passAAA : !f.passAA);
        const failing = report.findings.filter(fails);
        const unresolved = report.findings.filter((f) => f.indeterminate && !fails(f));
        const scored = report.findings.filter((f) => !unresolved.includes(f));
        const shown = failures_only ? failing : scored;

        const lines: string[] = [];
        lines.push(`# Contrast Sweep: ${raw.nodeName}`);
        lines.push(
          `**Text nodes:** ${report.total} | **Failing ${useAAA ? "AAA" : "AA"}:** ${failing.length} | **Indeterminate:** ${unresolved.length} | **Nodes scanned:** ${raw.nodesScanned}${imageTotal > 0 ? ` | **Images sampled:** ${imageTotal - imageFailed}/${imageTotal}` : ""}`,
        );
        if (raw.truncated) lines.push("> Traversal was truncated — the frame exceeds the scan cap.");
        lines.push("");
        const verdict = failing.length === 0 ? "PASS" : "FAIL";
        lines.push(
          `**Verdict:** ${verdict}${unresolved.length > 0 ? ` (${unresolved.length} indeterminate — verify visually)` : ""}`,
        );
        lines.push("");

        if (shown.length === 0) {
          lines.push("_No text nodes to report._");
        } else {
          lines.push("| Node | Text | Size | FG | BG | Ratio | Req | Status |");
          lines.push("|------|------|------|----|----|-------|-----|--------|");
          for (const f of shown) {
            const req = useAAA ? f.requiredAAA : f.requiredAA;
            const preview = f.text.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 32);
            const seg = f.segments ? ` [${f.segments.length} segs]` : "";
            lines.push(
              `| ${f.nodeName} (${f.nodeId}) | ${preview}${seg} | ${f.fontSize}${f.isLargeText ? " lg" : ""} | ${f.foreground} | ${f.background} | ${f.ratio}:1 | ${req}:1 | ${fails(f) ? "**FAIL**" : "PASS"} |`,
            );
          }
        }

        const segmented = [...shown, ...unresolved].filter((f) => f.segments && (fails(f) || f.indeterminate));
        if (segmented.length > 0) {
          lines.push("");
          lines.push("## Segments (chars start-end fg/bg ratio)");
          for (const f of segmented) {
            const segs = f.segments || [];
            const parts = segs.slice(0, 8).map((s) => {
              const status = s.indeterminate ? "?" : fails(s) ? "FAIL" : "ok";
              return `${s.start}-${s.end} ${s.foreground}/${s.background} ${s.ratio}:1 ${status}`;
            });
            if (segs.length > 8) parts.push(`…${segs.length - 8} more`);
            lines.push(`- ${f.nodeName} (${f.nodeId}): ${parts.join(" · ")}`);
          }
        }

        if (unresolved.length > 0) {
          lines.push("");
          lines.push(`## Indeterminate (${unresolved.length}) — verify with export_node_as_image`);
          for (const f of unresolved) {
            const est = f.foreground !== "—" ? `; est. ${f.ratio}:1 ignoring it` : "";
            lines.push(`- ${f.nodeName} (${f.nodeId}): ${f.indeterminate}${est}`);
          }
        }

        const noted = [...shown, ...unresolved].filter((f) => f.note);
        if (noted.length > 0) {
          lines.push("");
          lines.push("## Notes");
          for (const f of noted) lines.push(`- ${f.nodeName} (${f.nodeId}): ${f.note}`);
        }
        return text(lines.join("\n"));
      } catch (error) {
        return errorText("Error running contrast sweep", error);
      }
    },
  );

  // ── find_overlaps ──────────────────────────────────────────────────────────
  server.tool(
    "find_overlaps",
    "Report sibling nodes inside a frame whose bounding boxes intersect — captions painted over screenshots, labels colliding with frame-name labels, and similar layering mistakes that are otherwise only caught by eye.",
    {
      frameId: z.string().describe("Frame (or any container) to check"),
      ignore_hidden: mcpBooleanSchema.optional().describe("Skip invisible nodes (default: true)"),
      tolerance: z
        .number()
        .optional()
        .describe("Pixels of intersection to forgive before an overlap is reported (default: 0.5)"),
      min_overlap_ratio: z
        .number()
        .optional()
        .describe("Minimum overlap area as a fraction of the smaller node's area, 0-1 (default: 0)"),
      limit: z.number().optional().describe("Maximum overlapping pairs to report (default: 100)"),
    },
    async ({ frameId, ignore_hidden, tolerance, min_overlap_ratio, limit }) => {
      try {
        const raw = await sendCommandToFigma<{
          nodeId: string;
          nodeName: string;
          nodesScanned: number;
          nodes: OverlapNode[];
        }>("find_overlaps", { frameId: normalizeNodeId(frameId), ignore_hidden: ignore_hidden !== false }, 60000);

        const pairs = findOverlappingSiblings(raw.nodes || [], {
          tolerance: tolerance,
          ignoreHidden: ignore_hidden !== false,
          minOverlapRatio: min_overlap_ratio,
        });
        const capped = pairs.slice(0, limit ?? 100);

        const lines: string[] = [];
        lines.push(`# Overlapping Siblings: ${raw.nodeName}`);
        lines.push(`**Nodes scanned:** ${raw.nodesScanned} | **Overlapping pairs:** ${pairs.length}`);
        lines.push("");
        if (capped.length === 0) {
          lines.push("No sibling overlaps detected.");
        } else {
          lines.push("| Parent | Node A | Node B | Overlap (w×h) | % of smaller |");
          lines.push("|--------|--------|--------|---------------|--------------|");
          for (const p of capped) {
            lines.push(
              `| ${p.parentName ?? "—"} | ${p.a.nodeName} (${p.a.nodeId}) | ${p.b.nodeName} (${p.b.nodeId}) | ${Math.round(p.overlap.width)}×${Math.round(p.overlap.height)} | ${Math.round(p.overlapRatio * 100)}% |`,
            );
          }
          if (pairs.length > capped.length) lines.push(`\n_${pairs.length - capped.length} more pairs not shown._`);
        }
        return text(lines.join("\n"));
      } catch (error) {
        return errorText("Error finding overlaps", error);
      }
    },
  );

  // ── assert_node_state ──────────────────────────────────────────────────────
  server.tool(
    "assert_node_state",
    "Verify that a write actually landed. Reads the node back and diffs the given expected properties against the actual ones, tolerating float rounding and accepting colours as hex or RGBA. Use after any mutation you need to be certain about instead of eyeballing a get_node_info dump.",
    {
      nodeId: z.string().describe("Node to verify"),
      expected: z
        .record(z.any())
        .describe(
          'Property → expected value, e.g. {"width": 320, "cornerRadius": 12, "fill": "#0A84FF", "name": "Card"}. Only the listed properties are compared. "fill"/"stroke" compare the first solid paint.',
        ),
      tolerance: z.number().optional().describe("Numeric tolerance for float comparisons (default: 0.01)"),
    },
    async ({ nodeId, expected, tolerance }) => {
      try {
        const raw = await sendCommandToFigma<{
          nodeId: string;
          nodeName: string;
          nodeType: string;
          expected: Record<string, unknown>;
          actual: Record<string, unknown>;
        }>("assert_node_state", { nodeId: normalizeNodeId(nodeId), expected }, 30000);

        const report = diffNodeState(expected as Record<string, unknown>, raw.actual || {}, tolerance ?? 0.01);

        const lines: string[] = [];
        lines.push(`# Assert Node State: ${raw.nodeName} (${raw.nodeId})`);
        lines.push(`**Result:** ${report.matched ? "PASS — all assertions hold" : "FAIL — the write did not land"}`);
        lines.push("");
        lines.push("| Property | Expected | Actual | |");
        lines.push("|----------|----------|--------|--|");
        for (const f of report.fields) {
          const fmt = (v: unknown) =>
            v === undefined ? "_(absent)_" : typeof v === "object" ? JSON.stringify(v) : String(v);
          lines.push(`| ${f.field} | ${fmt(f.expected)} | ${fmt(f.actual)} | ${f.match ? "ok" : "**MISMATCH**"} |`);
        }
        return text(lines.join("\n"));
      } catch (error) {
        return errorText("Error asserting node state", error);
      }
    },
  );

  // ── find_unbound ───────────────────────────────────────────────────────────
  server.tool(
    "find_unbound",
    "List every fill, stroke, radius, spacing, typography and effect still on a raw value inside a frame, GROUPED BY ROLE. A focused alternative to parsing a full lint_frame report when all you want is the token-binding backlog. Honours the same suppression rules as lint_frame.",
    {
      frameId: z.string().describe("Frame (or any container) to scan"),
      ignore_rules: z
        .array(z.string())
        .optional()
        .describe('Rules to excuse, e.g. ["backgroundFills", "radius"] or "*"'),
      limit_per_role: z.number().optional().describe("Maximum entries listed per role (default: 25)"),
    },
    async ({ frameId, ignore_rules, limit_per_role }) => {
      try {
        const raw = await sendCommandToFigma<{
          nodeId: string;
          nodeName: string;
          totalNodes: number;
          totalUnbound: number;
          suppressed: number;
          capped: boolean;
          groups: Record<
            string,
            Array<{
              nodeId: string;
              nodeName: string;
              nodeType: string;
              property: string;
              severity: string;
              message: string;
            }>
          >;
        }>("find_unbound", { frameId: normalizeNodeId(frameId), ignore_rules }, 60000);

        const perRole = limit_per_role ?? 25;
        const lines: string[] = [];
        lines.push(`# Unbound Values: ${raw.nodeName}`);
        lines.push(
          `**Nodes scanned:** ${raw.totalNodes} | **Unbound:** ${raw.totalUnbound} | **Suppressed:** ${raw.suppressed}`,
        );
        if (raw.capped) lines.push("> Violation cap reached — results are partial.");
        lines.push("");

        const roles = Object.keys(raw.groups || {}).sort();
        if (roles.length === 0) {
          lines.push("Everything is bound to a token. Nothing to do.");
        }
        for (const role of roles) {
          const entries = raw.groups[role];
          lines.push(`## ${role} (${entries.length})`);
          lines.push("");
          for (const e of entries.slice(0, perRole)) {
            lines.push(`- \`${e.property}\` on **${e.nodeName}** (${e.nodeId}, ${e.nodeType}) — ${e.message}`);
          }
          if (entries.length > perRole) lines.push(`- _…${entries.length - perRole} more_`);
          lines.push("");
        }
        return text(lines.join("\n"));
      } catch (error) {
        return errorText("Error finding unbound values", error);
      }
    },
  );

  // ── check_token_collisions ─────────────────────────────────────────────────
  server.tool(
    "check_token_collisions",
    "Detect the same token name defined in MORE THAN ONE variable collection with DIFFERENT values (e.g. theme/radius/3xl = 28 vs Radius/radius/3xl = 24). A node bound to the wrong duplicate looks plausible and is silently wrong, so run this before trusting any binding audit.",
    {
      include_identical: mcpBooleanSchema
        .optional()
        .describe("Also list names duplicated across collections with the SAME value (default: false)"),
      name_filter: z.string().optional().describe("Only report tokens whose name contains this substring"),
    },
    async ({ include_identical, name_filter }) => {
      try {
        const raw = await sendCommandToFigma<{
          collections: number;
          variables: number;
          records: VariableRecord[];
        }>("check_token_collisions", {}, 60000);

        let collisions = findTokenCollisions(raw.records || [], { includeIdentical: include_identical === true });
        if (name_filter) {
          const needle = name_filter.toLowerCase();
          collisions = collisions.filter((c) => c.token.indexOf(needle) !== -1);
        }

        const lines: string[] = [];
        lines.push("# Token Collisions");
        lines.push(
          `**Collections:** ${raw.collections} | **Variables:** ${raw.variables} | **Colliding names:** ${collisions.length}`,
        );
        lines.push("");
        lines.push(`**Verdict:** ${collisions.length === 0 ? "PASS — no conflicting duplicates" : "FAIL"}`);
        lines.push("");
        if (collisions.length === 0) {
          lines.push("No token name is defined with differing values across collections.");
        } else {
          for (const c of collisions) {
            lines.push(`## \`${c.token}\` — ${c.distinctValues} distinct values (${c.resolvedTypes.join(", ")})`);
            lines.push("");
            lines.push("| Collection | Variable | Value |");
            lines.push("|------------|----------|-------|");
            for (const d of c.definitions) {
              lines.push(`| ${d.collectionName} | ${d.fullName} (${d.variableId}) | ${d.valueLabel} |`);
            }
            lines.push("");
          }
        }
        return text(lines.join("\n"));
      } catch (error) {
        return errorText("Error checking token collisions", error);
      }
    },
  );
}
