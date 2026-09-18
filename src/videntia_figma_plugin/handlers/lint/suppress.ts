/**
 * Lint suppression and node roles (§8).
 *
 * Two independent mechanisms, both applied as a POST-FILTER over the
 * violations produced by `scanNode`, so the traversal itself is untouched:
 *
 * 1. `ignore_rules` — a run-scoped list passed to lint_frame.
 * 2. Per-node annotations, inherited by descendants, expressed either as
 *    plugin data or as a suffix on the node name:
 *      • pluginData "lint.ignore" / "lintIgnore" = "backgroundFills,radius"
 *      • pluginData "lint.role"   / "lintRole"   = "artwork" | "ui"
 *      • name suffix  "[lint-ignore: backgroundFills, radius]"
 *      • name suffix  "Lint/ignore: backgroundFills"
 *      • name suffix  "[role: artwork]"
 *
 * Suppressed violations are removed from the verdict but REPORTED SEPARATELY
 * (`summary.suppressed`, `suppressedViolations`) so an accepted exception
 * stays visible instead of silently disappearing.
 */

import type { Violation, ViolationCategory } from "./types";

export type NodeRole = "ui" | "artwork";

/** Categories that assert "this value must come from a design token". */
export const TOKEN_BINDING_CATEGORIES: ViolationCategory[] = [
  "backgroundFills",
  "iconColors",
  "strokesBorders",
  "borderRadius",
  "spacing",
  "typography",
  "effectStyles",
];

/** Check-name → categories, so `ignore_rules: ["colors"]` works too. */
const CHECK_TO_CATEGORIES: Record<string, ViolationCategory[]> = {
  colors: ["backgroundFills", "iconColors", "strokesBorders"],
  spacing: ["spacing"],
  radius: ["borderRadius"],
  textStyles: ["typography"],
  effectStyles: ["effectStyles"],
  autoLayout: ["autoLayout"],
  overflow: ["overflow"],
  screenNaming: ["screenNaming"],
  rootFrame: ["rootFrame"],
};

export interface NodeAnnotations {
  ignore: string[];
  role: NodeRole | null;
}

const IGNORE_BRACKET = /\[\s*lint[-_ ]?ignore\s*:\s*([^\]]*)\]/i;
const IGNORE_PATH = /lint\/ignore\s*:\s*([A-Za-z0-9_*,\s.-]+)/i;
const ROLE_BRACKET = /\[\s*(?:lint[-_ ]?)?role\s*:\s*([A-Za-z]+)\s*\]/i;
const ROLE_PATH = /lint\/role\s*:\s*([A-Za-z]+)/i;

function splitRules(raw: string): string[] {
  return String(raw || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function normaliseRole(raw: string | null | undefined): NodeRole | null {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "artwork" || v === "art" || v === "illustration" || v === "logo") return "artwork";
  if (v === "ui") return "ui";
  return null;
}

function readPluginData(node: BaseNode, key: string): string {
  try {
    const fn = (node as unknown as { getPluginData?: (k: string) => string }).getPluginData;
    if (typeof fn !== "function") return "";
    return fn.call(node, key) || "";
  } catch (_e) {
    return "";
  }
}

/** Annotations declared directly on one node (no inheritance). */
export function readNodeAnnotations(node: BaseNode): NodeAnnotations {
  const ignore: string[] = [];
  let role: NodeRole | null = null;

  const pdIgnore = readPluginData(node, "lint.ignore") || readPluginData(node, "lintIgnore");
  if (pdIgnore) ignore.push(...splitRules(pdIgnore));

  role = normaliseRole(readPluginData(node, "lint.role") || readPluginData(node, "lintRole"));

  let name = "";
  try {
    name = node.name || "";
  } catch (_e) {}
  if (name) {
    const bracket = name.match(IGNORE_BRACKET);
    if (bracket) ignore.push(...splitRules(bracket[1]));
    else {
      const path = name.match(IGNORE_PATH);
      if (path) ignore.push(...splitRules(path[1]));
    }
    if (!role) {
      const rb = name.match(ROLE_BRACKET) || name.match(ROLE_PATH);
      if (rb) role = normaliseRole(rb[1]);
    }
  }

  return { ignore, role };
}

/** Annotations for a node merged with everything inherited from its ancestors. */
export function resolveInheritedAnnotations(node: BaseNode, maxDepth = 60): NodeAnnotations {
  const ignore: string[] = [];
  let role: NodeRole | null = null;
  let current: BaseNode | null = node;
  let guard = 0;
  while (current && current.type !== "DOCUMENT" && guard++ < maxDepth) {
    const own = readNodeAnnotations(current);
    for (const rule of own.ignore) if (ignore.indexOf(rule) === -1) ignore.push(rule);
    // Nearest declaration wins; an inner `[role: ui]` re-enables linting.
    if (role === null && own.role !== null) role = own.role;
    current = current.parent;
  }
  return { ignore, role };
}

function ruleMatchesViolation(rule: string, violation: Violation): boolean {
  const r = rule.trim().toLowerCase();
  if (r === "*" || r === "all") return true;

  // "category:property" — exact, e.g. backgroundFills:fills[0]
  const colon = r.indexOf(":");
  if (colon > 0) {
    const cat = r.slice(0, colon);
    const prop = r.slice(colon + 1);
    return cat === violation.category.toLowerCase() && prop === String(violation.property).toLowerCase();
  }

  if (r === violation.category.toLowerCase()) return true;

  const mapped = CHECK_TO_CATEGORIES[rule.trim()] || CHECK_TO_CATEGORIES[r];
  if (mapped && mapped.indexOf(violation.category) !== -1) return true;

  // Bare property prefix, e.g. "fills" or "cornerRadius"
  return String(violation.property).toLowerCase().indexOf(r) === 0;
}

export interface SuppressionOutcome {
  kept: Violation[];
  suppressed: Violation[];
}

/**
 * Split violations into kept vs suppressed.
 * `annotationsByNodeId` supplies the inherited per-node annotations (resolved
 * asynchronously by the caller, which has document access).
 */
export function applySuppressions(
  violations: Violation[],
  globalIgnoreRules: string[],
  annotationsByNodeId: Record<string, NodeAnnotations>,
): SuppressionOutcome {
  const kept: Violation[] = [];
  const suppressed: Violation[] = [];

  for (const violation of violations) {
    const annotations = annotationsByNodeId[violation.nodeId] || { ignore: [], role: null };
    let reason: string | null = null;

    for (const rule of globalIgnoreRules) {
      if (ruleMatchesViolation(rule, violation)) {
        reason = 'ignore_rules: "' + rule + '"';
        break;
      }
    }
    if (!reason) {
      for (const rule of annotations.ignore) {
        if (ruleMatchesViolation(rule, violation)) {
          reason = 'node annotation: "' + rule + '"';
          break;
        }
      }
    }
    if (!reason && annotations.role === "artwork" && TOKEN_BINDING_CATEGORIES.indexOf(violation.category) !== -1) {
      reason = "role: artwork (bespoke artwork cannot bind to tokens)";
    }

    if (reason) {
      const copy: Violation = { ...violation, suppressed: true, suppressedBy: reason };
      suppressed.push(copy);
    } else {
      kept.push(violation);
    }
  }

  return { kept, suppressed };
}

export function parseIgnoreRules(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((r) => String(r)).filter((r) => r.length > 0);
  return splitRules(String(raw));
}
