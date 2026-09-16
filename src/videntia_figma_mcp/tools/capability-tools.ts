import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpBooleanSchema } from "../utils/mcp-boolean.js";
import { sendCommandToFigma, getCurrentChannel } from "../utils/websocket.js";
import { MANIFEST_SECTIONS, ManifestEntry } from "../utils/capabilities-manifest.js";

/**
 * Read the tool names the MCP server actually has registered. Derived, not
 * hardcoded, so the manifest cannot drift from the real surface (bug #45).
 */
export function listRegisteredToolNames(server: McpServer): string[] {
  const registry = (server as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools;
  if (!registry || typeof registry !== "object") return [];
  return Object.keys(registry).sort();
}

/**
 * Live session modes. Strict mode and the return_state default live in the
 * plugin (videntia_figma_plugin/utils/write-verify.ts), so this asks for them
 * with a no-argument `set_strict_mode`, which reports the current state without
 * changing it. Unreachable plugin => reported as unknown, never guessed.
 */
export async function readSessionModes(): Promise<{
  strict: boolean | "unknown";
  returnState: boolean | "unknown";
  connected: boolean;
  note?: string;
}> {
  try {
    const result = (await sendCommandToFigma("set_strict_mode", {})) as {
      strict?: boolean;
      returnState?: boolean;
    };
    return {
      strict: typeof result?.strict === "boolean" ? result.strict : "unknown",
      returnState: typeof result?.returnState === "boolean" ? result.returnState : "unknown",
      connected: true,
    };
  } catch (error) {
    return {
      strict: "unknown",
      returnState: "unknown",
      connected: false,
      note: `Could not read live session modes from the Figma plugin: ${
        error instanceof Error ? error.message : String(error)
      }. Strict mode DEFAULTS ON.`,
    };
  }
}

function renderEntries(title: string, entries: ManifestEntry[]): string[] {
  const lines = [`### ${title}`, ""];
  for (const entry of entries) {
    lines.push(`- **${entry.summary}**`);
    lines.push(`  - ${entry.detail}`);
    if (entry.tools && entry.tools.length > 0) {
      lines.push(`  - tools: ${entry.tools.map((t) => `\`${t}\``).join(", ")}`);
    }
  }
  lines.push("");
  return lines;
}

/**
 * get_capabilities (#45) - read-only, cheap, server-side.
 *
 * It needs NO Figma write roundtrip: the tool list is read off this MCP
 * server's own registry and the prose comes from utils/capabilities-manifest.ts.
 * The only network touch is an optional, read-only `set_strict_mode` with no
 * arguments to report the live session modes, and that degrades to "unknown"
 * when the plugin is not connected. So it is registered with the MCP registrar
 * only - no FigmaCommand union entry, no ALLOWED_COMMANDS / READONLY_COMMANDS
 * entry, no plugin switch case.
 */
export function registerCapabilityTools(server: McpServer): void {
  server.tool(
    "get_capabilities",
    "Read-only manifest of this server's capabilities and limitations. Call it ONCE at the start of a session instead of discovering the same constraints by trial and error: hard Figma platform limits that cannot be worked around, capabilities agents commonly assume are missing but which exist (bulk/plural tools, disk-based image export and import, one-call frame+layout creation, return_state), preconditions that cause a write to be silently discarded, the live list of registered tool names, and the current session modes (strict, return_state).",
    {
      section: z
        .enum(["all", "platformLimits", "existingCapabilities", "writePreconditions", "tools"])
        .optional()
        .describe("Limit the manifest to one section (default: all)"),
      include_tools: mcpBooleanSchema
        .optional()
        .describe("Include the full list of registered tool names (default: true)"),
    },
    async ({ section, include_tools }: { section?: string; include_tools?: boolean }) => {
      const wantTools = include_tools !== false;
      const modes = await readSessionModes();
      const toolNames = listRegisteredToolNames(server);

      const lines: string[] = ["# Capabilities & Limitations Manifest", ""];

      lines.push("### Session modes (live)");
      lines.push(`- strict mode: ${String(modes.strict)} (defaults ON)`);
      lines.push(`- return_state default: ${String(modes.returnState)}`);
      lines.push(`- Figma plugin connected: ${modes.connected ? "yes" : "no"}`);
      lines.push(`- channel: ${getCurrentChannel() ?? "none"}`);
      if (modes.note) lines.push(`- note: ${modes.note}`);
      lines.push("");

      for (const s of MANIFEST_SECTIONS) {
        if (section && section !== "all" && section !== s.key) continue;
        lines.push(...renderEntries(s.title, s.entries as unknown as ManifestEntry[]));
      }

      if (wantTools && (!section || section === "all" || section === "tools")) {
        lines.push(`### Registered tools (${toolNames.length}, derived from the live registry)`, "");
        lines.push(toolNames.join(", "));
        lines.push("");
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
