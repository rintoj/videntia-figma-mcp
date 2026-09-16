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
import { registerBrowserTools } from "./browser-tools.js";
import { registerBrowserControlTools } from "./browser-control-tools.js";
import { registerVerificationTools } from "./verification-tools.js";
import { registerCompositeTools } from "./composite-tools.js";
import { registerCapabilityTools } from "./capability-tools.js";
import { instrumentToolRegistry } from "../utils/tool-registry.js";

/**
 * Register all Figma tools to the MCP server
 * @param server - The MCP server instance
 */
export function registerTools(server: McpServer): void {
  // Record every tool's zod shape + handler as they register, so `batch_actions` can
  // parse and run a batched action through the SAME schema and the SAME handler the
  // standalone call uses. Must happen before the first registration.
  instrumentToolRegistry(server);

  // Register all tool categories
  registerDocumentTools(server);
  registerCreationTools(server);
  registerModificationTools(server);
  registerTextTools(server);
  registerComponentTools(server);
  registerVariableTools(server);
  registerBatchTools(server);
  registerIconTools(server);
  registerComparisonTools(server);
  registerDocumentationTools(server);
  registerBrowserTools(server);
  registerBrowserControlTools(server);
  registerCompositeTools(server);
  registerVerificationTools(server);
  // Registered last so the derived tool list in get_capabilities sees every tool.
  registerCapabilityTools(server);
}

// Export all tool registration functions for individual usage if needed
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
  registerBrowserTools,
  registerBrowserControlTools,
  registerCompositeTools,
  registerVerificationTools,
  registerCapabilityTools,
};
