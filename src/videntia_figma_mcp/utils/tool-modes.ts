/**
 * Progressive tool discovery — which of this server's ~233 tools are advertised
 * up front.
 *
 * WHY
 * ---
 * Every tool this server registers is serialised as a JSON-Schema into every agent
 * session's `tools/list`. At 233 tools that is ~120k tokens of context spent before
 * a single call is made, and a typical session uses fewer than ten of them. So the
 * default is now a small ENTRY SURFACE plus two discovery tools; everything else is
 * still fully present in the internal registry (`utils/tool-registry.ts`) and is
 * reachable immediately via `batch_actions` / `figma_call`, or can be promoted into
 * `tools/list` on demand via `describe_figma_tools` / `load_figma_tools`.
 *
 * OPT OUT: set `VIDENTIA_FIGMA_TOOLS=all` to get the pre-0.8 behaviour where every
 * tool is registered up front.
 */

/**
 * The tools always advertised in progressive mode. Tuned here and nowhere else.
 *
 * Rationale for each: `figma_connect` (nothing works without a channel), the three
 * discovery tools, `get_capabilities` (explains the whole mechanism), `batch_actions`
 * (can already invoke ANY of the hidden document tools by name with identical
 * params), and the three reads an agent almost always starts from.
 */
export const ENTRY_SURFACE_TOOLS: readonly string[] = [
  "figma_connect",
  "find_figma_tools",
  "describe_figma_tools",
  "load_figma_tools",
  "figma_call",
  "get_capabilities",
  "batch_actions",
  "get_node_info",
  "get_content_tree",
  "export_node_as_image",
];

/** One line, repeated in every entry-surface tool description, so no agent misses it. */
export const PROGRESSIVE_HINT =
  "Most of this server's tools are hidden behind progressive discovery: use find_figma_tools(query) to locate one, describe_figma_tools(names) for its full schema, then call it via figma_call or batch_actions.";

/** Canonical category names, one per registrar in tools/index.ts. */
export const TOOL_CATEGORIES = [
  "document",
  "creation",
  "modification",
  "text",
  "component",
  "variable",
  "batch",
  "icon",
  "comparison",
  "documentation",
  "browser",
  "browser-control",
  "composite",
  "verification",
  "capability",
  "discovery",
] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/** Friendly spellings accepted in `VIDENTIA_FIGMA_TOOLS`, folded to a real category. */
export const CATEGORY_ALIASES: Record<string, ToolCategory> = {
  tokens: "variable",
  variables: "variable",
  read: "document",
  reads: "document",
  write: "modification",
  writes: "modification",
  create: "creation",
  components: "component",
  icons: "icon",
  browsercontrol: "browser-control",
  browser_control: "browser-control",
  docs: "documentation",
  verify: "verification",
};

export type ToolMode = { kind: "all" } | { kind: "progressive" } | { kind: "categories"; categories: ToolCategory[] };

export interface ResolvedToolMode {
  mode: ToolMode;
  /** Human-readable rendering of the mode, e.g. "progressive" / "categories: text, variable". */
  label: string;
  /** Non-fatal problem with the env value; the mode falls back to `all`. */
  warning?: string;
}

export const TOOL_MODE_ENV_VAR = "VIDENTIA_FIGMA_TOOLS";

/**
 * Parse `VIDENTIA_FIGMA_TOOLS`. Unset/empty => progressive (the default).
 * An unrecognised value NEVER throws: it falls back to `all` with a warning, because
 * a typo in an env var must not take a working MCP server down.
 */
export function resolveToolMode(raw: string | undefined): ResolvedToolMode {
  const value = (raw ?? "").trim();
  if (value === "") return { mode: { kind: "progressive" }, label: "progressive" };

  const lower = value.toLowerCase();
  if (lower === "all") return { mode: { kind: "all" }, label: "all" };
  if (lower === "progressive") return { mode: { kind: "progressive" }, label: "progressive" };

  const requested = lower
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const categories: ToolCategory[] = [];
  const unknown: string[] = [];
  for (const part of requested) {
    const canonical = (TOOL_CATEGORIES as readonly string[]).includes(part)
      ? (part as ToolCategory)
      : CATEGORY_ALIASES[part];
    if (canonical) {
      if (!categories.includes(canonical)) categories.push(canonical);
    } else {
      unknown.push(part);
    }
  }

  if (unknown.length > 0 || categories.length === 0) {
    return {
      mode: { kind: "all" },
      label: "all",
      warning:
        `${TOOL_MODE_ENV_VAR}="${value}" is not a valid mode ` +
        `(expected "progressive", "all", or a comma-separated list of: ${TOOL_CATEGORIES.join(", ")}` +
        `${unknown.length > 0 ? `; unrecognised: ${unknown.join(", ")}` : ""}). ` +
        `Falling back to "all" (every tool registered).`,
    };
  }

  return { mode: { kind: "categories", categories }, label: `categories: ${categories.join(", ")}` };
}

/**
 * The gate handed to the tool registry: does this tool reach the MCP SDK's tool list?
 * Discovery + entry surface are ALWAYS advertised in category mode too — otherwise a
 * narrowed server would have no way to reach the tools it excluded.
 */
export function makeRegistrationGate(mode: ToolMode): (name: string, category: string) => boolean {
  if (mode.kind === "all") return () => true;
  if (mode.kind === "progressive") return (name) => ENTRY_SURFACE_TOOLS.includes(name);
  const wanted = new Set<string>(mode.categories);
  return (name, category) => ENTRY_SURFACE_TOOLS.includes(name) || wanted.has(category);
}

/** The label of the mode this process resolved, for get_capabilities. */
let activeModeLabel = "progressive";
export function setActiveToolModeLabel(label: string): void {
  activeModeLabel = label;
}
export function getActiveToolModeLabel(): string {
  return activeModeLabel;
}
