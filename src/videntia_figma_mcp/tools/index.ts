import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocumentTools } from "./document-tools.js";
import { registerCreationTools } from "./creation-tools.js";
import { registerModificationTools } from "./modification-tools.js";
import { registerTextTools } from "./text-tools.js";
import { registerComponentTools } from "./component-tools.js";
import { registerVariableTools } from "./variable-tools.js";
import { registerBatchTools } from "./batch-tools.js";
import { registerIconTools } from "./icon-tools.js";
import { registerComparisonTools } from "./comparison-tools.js";
import { registerDocumentationTools } from "./documentation-tools.js";
import { registerPrototypeTools } from "./prototype-tools.js";
import { registerBrowserTools } from "./browser-tools.js";
import { registerBrowserControlTools } from "./browser-control-tools.js";
import { registerDesignKnowledgeTool } from "./design-knowledge-tools.js";
import { registerVerificationTools } from "./verification-tools.js";
import { registerCompositeTools } from "./composite-tools.js";
import { registerCapabilityTools } from "./capability-tools.js";
import { registerDiscoveryTools } from "./discovery-tools.js";
import { instrumentToolRegistry, setRegistrationCategory, setRegistrationGate } from "../utils/tool-registry.js";
import {
  getActiveToolModeLabel,
  makeRegistrationGate,
  resolveToolMode,
  setActiveToolModeLabel,
  TOOL_MODE_ENV_VAR,
} from "../utils/tool-modes.js";
import { resetToolIndex } from "../utils/tool-search.js";

/**
 * Register all Figma tools to the MCP server
 * @param server - The MCP server instance
 */
export function registerTools(server: McpServer): void {
  // Record every tool's zod shape + handler as they register, so `batch_actions` can
  // parse and run a batched action through the SAME schema and the SAME handler the
  // standalone call uses. Must happen before the first registration.
  instrumentToolRegistry(server);

  // Decide which of those recorded tools are additionally advertised to the MCP
  // client. Everything stays in the registry either way — see utils/tool-modes.ts.
  const resolved = resolveToolMode(process.env[TOOL_MODE_ENV_VAR]);
  if (resolved.warning) {
    // Never crash on a bad env value; degrade to the pre-progressive behaviour.
    process.stderr.write(`[videntia-figma-mcp] ${resolved.warning}\n`);
  }
  setActiveToolModeLabel(resolved.label);
  setRegistrationGate(makeRegistrationGate(resolved.mode));
  resetToolIndex();

  const categories: [string, (s: McpServer) => void][] = [
    ["document", registerDocumentTools],
    ["creation", registerCreationTools],
    ["modification", registerModificationTools],
    ["text", registerTextTools],
    ["component", registerComponentTools],
    ["variable", registerVariableTools],
    ["batch", registerBatchTools],
    ["icon", registerIconTools],
    ["comparison", registerComparisonTools],
    ["documentation", registerDocumentationTools],
    ["prototype", registerPrototypeTools],
    ["browser", registerBrowserTools],
    ["browser-control", registerBrowserControlTools],
    ["composite", registerCompositeTools],
    ["verification", registerVerificationTools],
    ["design-knowledge", registerDesignKnowledgeTool],
    // Registered last so the derived tool list in get_capabilities sees every tool.
    ["discovery", registerDiscoveryTools],
    ["capability", registerCapabilityTools],
  ];

  for (const [category, register] of categories) {
    setRegistrationCategory(category);
    register(server);
  }
  setRegistrationCategory("uncategorized");
  resetToolIndex();
}

// Export all tool registration functions for individual usage if needed
export { getActiveToolModeLabel };

export {
  registerDocumentTools,
  registerCreationTools,
  registerModificationTools,
  registerTextTools,
  registerComponentTools,
  registerVariableTools,
  registerBatchTools,
  registerIconTools,
  registerComparisonTools,
  registerDocumentationTools,
  registerPrototypeTools,
  registerBrowserTools,
  registerBrowserControlTools,
  registerDesignKnowledgeTool,
  registerCompositeTools,
  registerVerificationTools,
  registerCapabilityTools,
  registerDiscoveryTools,
};
