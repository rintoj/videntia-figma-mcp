import { LINT_RULE_IDS, LINT_CATEGORY_NAMES, LINT_IGNORE_NAMESPACE, LINT_IGNORE_KEY } from "./constants";
import { normalizeLintNodeId } from "./helpers";

/**
 * Writes (or clears) the persistent lint suppression on a node: shared plugin data
 * `videntia` / `lint-ignore` = "*" or comma-separated rule ids / category names.
 * lint_frame honors it for the node and its whole subtree. Replaces any existing value.
 */
export async function setLintIgnore(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const rawId = params ? params["nodeId"] : undefined;
  if (typeof rawId !== "string" || rawId.trim() === "") throw new Error("Missing nodeId parameter");
  const nodeId = normalizeLintNodeId(rawId);

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error("Node not found: " + nodeId.substring(0, 50));
  if (node.type === "DOCUMENT") throw new Error("Cannot set lint-ignore on the DOCUMENT node");

  const clear = params["clear"] === true;
  let value = "";
  if (!clear) {
    const rules = params["rules"];
    if (rules === undefined || rules === null || rules === "*") {
      value = "*";
    } else {
      const list = typeof rules === "string" ? rules.split(",") : Array.isArray(rules) ? rules : null;
      if (!list) throw new Error('rules must be "*" or an array of rule ids / category names');
      const cleaned: string[] = [];
      const unknown: string[] = [];
      for (let i = 0; i < list.length; i++) {
        const r = typeof list[i] === "string" ? (list[i] as string).trim() : "";
        if (r === "") continue;
        if (r === "*") {
          cleaned.length = 0;
          cleaned.push("*");
          break;
        }
        if ((LINT_RULE_IDS as string[]).indexOf(r) === -1 && (LINT_CATEGORY_NAMES as string[]).indexOf(r) === -1) {
          unknown.push(r);
        } else if (cleaned.indexOf(r) === -1) {
          cleaned.push(r);
        }
      }
      if (unknown.length > 0) {
        throw new Error(
          "Unknown lint rule(s): " + unknown.join(", ") + ". Valid rule ids: " + LINT_RULE_IDS.join(", "),
        );
      }
      if (cleaned.length === 0) throw new Error('rules must contain at least one rule id, or be "*"');
      value = cleaned.join(",");
    }
  }

  node.setSharedPluginData(LINT_IGNORE_NAMESPACE, LINT_IGNORE_KEY, value);

  return {
    id: node.id,
    name: node.name,
    lintIgnore: value === "" ? null : value,
    cleared: clear,
  };
}
