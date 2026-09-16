/**
 * Progressive tool discovery (see utils/tool-modes.ts for the why).
 *
 * Three tools replace 220-odd up-front JSON-Schemas:
 *   find_figma_tools(query)      -> names + one-liners (cheap, ~200 tokens)
 *   describe_figma_tools(names)  -> full JSON-Schema for the few you picked, AND
 *                                   promotes them into `tools/list` (list_changed)
 *   figma_call(tool, params)     -> invoke any registered tool by name right now,
 *                                   for clients that ignore `tools/list_changed`
 *
 * `batch_actions` is the fourth route and needs no promotion at all: it already
 * dispatches any document-acting tool by name with the SAME schema and the SAME
 * handler, so a one-action batch is a tool call.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import zodToJsonSchema from "zod-to-json-schema";
import {
  activateDeferredTool,
  getRegisteredTool,
  isSdkRegistered,
  listDeferredToolNames,
  listRegistryEntries,
} from "../utils/tool-registry.js";
import { oneLineSummary, resetToolIndex, searchTools } from "../utils/tool-search.js";
import { ENTRY_SURFACE_TOOLS, PROGRESSIVE_HINT, TOOL_CATEGORIES } from "../utils/tool-modes.js";
import { nonBatchableReason } from "../utils/pure-batch-actions.js";

/** Most tools one `describe_figma_tools` call will render. Keeps the reply bounded. */
export const MAX_DESCRIBE_NAMES = 12;

/**
 * Promote deferred tools into the MCP tool list and tell the client once.
 * Returns the names that were newly advertised.
 */
export function activateTools(server: McpServer, names: string[]): string[] {
  const activated: string[] = [];
  for (const name of names) {
    if (activateDeferredTool(name)) activated.push(name);
  }
  if (activated.length > 0) {
    try {
      // SDK 1.22: McpServer.sendToolListChanged() emits notifications/tools/list_changed
      // and is already guarded by an internal isConnected() check, so calling it before
      // connect (e.g. in unit tests) is a silent no-op. The catch is belt-and-braces for
      // older/other SDK builds that do throw.
      server.sendToolListChanged();
    } catch {
      /* not connected: the tool is still callable via figma_call / batch_actions */
    }
  }
  return activated;
}

/** How an agent can invoke a tool RIGHT NOW, without waiting for a client re-list. */
function callHint(name: string): string {
  const batchable = nonBatchableReason(name) === undefined;
  return batchable
    ? `figma_call({tool:"${name}",params:{…}}) or batch_actions({actions:[{action:"${name}",params:{…}}]})`
    : `figma_call({tool:"${name}",params:{…}})`;
}

/** Error text for a name that is not a registered tool at all. */
function unknownToolError(name: string): string {
  const near = searchTools(name, { limit: 5 })
    .map((h) => h.name)
    .filter((n) => n !== name);
  return (
    `No tool named '${name}' is registered on this server. ` +
    `This server uses progressive tool discovery — a tool missing from your tool list is NOT missing from the server. ` +
    `Call find_figma_tools({query:"${name.replace(/_/g, " ")}"}) to locate the right name, then describe_figma_tools first for its schema.` +
    (near.length > 0 ? ` Closest matches: ${near.join(", ")}.` : "")
  );
}

export function registerDiscoveryTools(server: McpServer): void {
  server.tool(
    "find_figma_tools",
    `Search this server's FULL tool catalogue by task ("center text", "set a shadow", "create a design token", "export a screenshot", "check contrast") and get back matching tool NAMES with a one-line summary each — no schemas, so it is cheap. ${PROGRESSIVE_HINT}`,
    {
      query: z.string().describe("What you are trying to do, in plain words. e.g. 'center text in a frame'"),
      limit: z.number().int().min(1).max(50).optional().describe("Max results (default 8)"),
      category: z
        .enum(TOOL_CATEGORIES as unknown as [string, ...string[]])
        .optional()
        .describe("Restrict the search to one tool category"),
    },
    async ({ query, limit, category }: { query: string; limit?: number; category?: string }) => {
      const hits = searchTools(query, { limit, category });
      const lines: string[] = [];
      if (hits.length === 0) {
        lines.push(`No tools matched "${query}". Try fewer/other words, or get_capabilities for the full picture.`);
      } else {
        lines.push(`${hits.length} tool(s) for "${query}":`, "");
        for (const hit of hits) {
          const advertised = isSdkRegistered(hit.name) ? "" : " [not in your tool list yet]";
          lines.push(`- ${hit.name} (${hit.category})${advertised}: ${hit.summary}`);
        }
        lines.push(
          "",
          `To act NOW without waiting for anything: ${callHint(hits[0].name)}.`,
          `For full parameters: describe_figma_tools({names:["${hits[0].name}"]}) — that also adds them to your tool list.`,
        );
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.tool(
    "describe_figma_tools",
    `Return the FULL parameter schema (JSON-Schema) and description for up to ${MAX_DESCRIBE_NAMES} named tools, and add them to your tool list (notifications/tools/list_changed). This is the "pay only for what you use" step of progressive discovery — find_figma_tools first to get the names.`,
    {
      names: z
        .array(z.string())
        .min(1)
        .max(MAX_DESCRIBE_NAMES)
        .describe(`Tool names from find_figma_tools (max ${MAX_DESCRIBE_NAMES})`),
      register: z.boolean().optional().describe("Also advertise these tools in tools/list (default true)"),
    },
    async ({ names, register }: { names: string[]; register?: boolean }) => {
      const sections: string[] = [];
      const found: string[] = [];
      for (const name of names) {
        const entry = getRegisteredTool(name);
        if (!entry) {
          sections.push(`## ${name}\n\nERROR: ${unknownToolError(name)}`);
          continue;
        }
        found.push(name);
        const schema = zodToJsonSchema(entry.schema, { $refStrategy: "none" });
        sections.push(
          [
            `## ${name}  (category: ${entry.category})`,
            "",
            entry.description,
            "",
            `Invoke: ${callHint(name)}`,
            "",
            "```json",
            JSON.stringify(schema, null, 2),
            "```",
          ].join("\n"),
        );
      }
      const activated = register === false ? [] : activateTools(server, found);
      const header =
        activated.length > 0
          ? `Added to your tool list (tools/list_changed sent): ${activated.join(", ")}. If your client does not re-list, call them with figma_call instead.\n`
          : "";
      return { content: [{ type: "text", text: `${header}${sections.join("\n\n")}` }] };
    },
  );

  server.tool(
    "load_figma_tools",
    "Advertise the named tools in your tool list (notifications/tools/list_changed) without printing their schemas. Use when you already know the exact tool names; otherwise use describe_figma_tools.",
    {
      names: z.array(z.string()).min(1).max(50).describe("Exact tool names to advertise"),
    },
    async ({ names }: { names: string[] }) => {
      const unknown = names.filter((n) => !getRegisteredTool(n));
      const activated = activateTools(
        server,
        names.filter((n) => !unknown.includes(n)),
      );
      const already = names.filter((n) => !unknown.includes(n) && !activated.includes(n));
      const lines = [
        activated.length > 0 ? `Advertised: ${activated.join(", ")}` : "Advertised: (none)",
        already.length > 0 ? `Already in your tool list: ${already.join(", ")}` : "",
        unknown.length > 0 ? `Unknown: ${unknown.join(", ")} — ${unknownToolError(unknown[0])}` : "",
      ].filter(Boolean);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.tool(
    "figma_call",
    `Invoke ANY of this server's tools by name, including ones not in your tool list. Params are validated with that tool's real schema and run through its real handler, so the result is identical to calling it directly. ${PROGRESSIVE_HINT}`,
    {
      tool: z.string().describe("Tool name, exactly as find_figma_tools reported it"),
      params: z.record(z.unknown()).optional().describe("That tool's parameters (see describe_figma_tools)"),
    },
    async ({ tool, params }: { tool: string; params?: Record<string, unknown> }, extra: unknown) => {
      const entry = getRegisteredTool(tool);
      if (!entry) {
        return { content: [{ type: "text" as const, text: unknownToolError(tool) }], isError: true };
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = entry.schema.parse(params ?? {}) as Record<string, unknown>;
      } catch (error) {
        const detail =
          error instanceof z.ZodError
            ? error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")
            : error instanceof Error
              ? error.message
              : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Invalid params for '${tool}' (same schema as the standalone tool): ${detail}. ` +
                `Received: ${JSON.stringify(params ?? {})}. ` +
                `Call describe_figma_tools({names:["${tool}"]}) for the full schema.`,
            },
          ],
          isError: true,
        };
      }
      return (await entry.handler(parsed, extra)) as { content: { type: "text"; text: string }[] };
    },
  );
}

/**
 * A compact, always-accurate description of the discovery surface, embedded in
 * get_capabilities so an agent that never calls find_figma_tools still learns it exists.
 */
export function describeProgressiveMode(modeLabel: string): string[] {
  const hidden = listDeferredToolNames();
  const total = listRegistryEntries().length;
  const lines = [
    "### Progressive tool discovery",
    "",
    `- mode: **${modeLabel}** (env \`VIDENTIA_FIGMA_TOOLS\`; set it to \`all\` to advertise every tool up front, as before)`,
    `- tools on this server: ${total}; advertised in your tool list: ${total - hidden.length}; discoverable on demand: ${hidden.length}`,
  ];
  if (hidden.length > 0) {
    lines.push(
      `- A tool missing from your tool list is NOT missing from the server. Find it: \`find_figma_tools({query:"center text"})\` → names + one-liners. Get its schema (and add it to your tool list): \`describe_figma_tools({names:[...]})\`. Call it immediately without re-listing: \`figma_call({tool,params})\` or \`batch_actions({actions:[{action,params}]})\`.`,
      `- entry surface: ${ENTRY_SURFACE_TOOLS.join(", ")}`,
    );
  }
  lines.push("");
  return lines;
}

export { resetToolIndex };
