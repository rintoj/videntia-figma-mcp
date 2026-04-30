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

/**
 * Register all Figma tools to the MCP server
 * @param server - The MCP server instance
 */
export function registerTools(server: McpServer): void {
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
};
