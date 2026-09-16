/**
 * The single source of truth for "what does tool X accept, and what does it put on
 * the wire" — captured at REGISTRATION time, for every tool, with zero per-tool edits.
 *
 * WHY A WRAPPER AND NOT `_registeredTools`
 * ----------------------------------------
 * The MCP SDK's `server._registeredTools[name].inputSchema` does expose a re-parseable
 * `ZodObject`, but it exposes no way back to the ORIGINAL handler in a form we can
 * invoke with already-parsed args plus the `extra` argument the SDK supplies. So
 * `server.tool` is wrapped once, before any tool registers, and both the raw zod shape
 * and the handler are recorded here. Everything still flows through to the real SDK
 * registration — this only observes.
 *
 * `batch_actions` then parses each action with the SAME schema and runs the SAME
 * handler in capture mode (see `tool-capture.ts`), which is what makes a batched
 * action's wire payload identical to the standalone one by construction. The old
 * hand-maintained alias map (`normalize-batch-params.ts`) is gone.
 */

import { z, ZodRawShape } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { aliasKeysFor, applyParamAliases, PARAM_ALIASES, widenEnumCasing } from "./param-aliases.js";

export interface RegisteredToolEntry {
  name: string;
  /** The raw zod shape the tool declared — re-assembled into an object schema. */
  schema: z.ZodObject<ZodRawShape>;
  /** The tool's own handler, invoked with ALREADY-PARSED args. */
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
}

const registry = new Map<string, RegisteredToolEntry>();

/** Look up a tool by its MCP name. */
export function getRegisteredTool(name: string): RegisteredToolEntry | undefined {
  return registry.get(name);
}

/** Every tool name captured by the wrapper, sorted. */
export function listCapturedToolNames(): string[] {
  return [...registry.keys()].sort();
}

/** Test/bootstrap helper — drop everything captured so far. */
export function clearToolRegistry(): void {
  registry.clear();
}

/**
 * Wrap `server.tool` so every `(name, description, shape, handler)` registration is
 * recorded here as well as with the SDK. Must be called BEFORE `registerTools`.
 * Idempotent: wrapping an already-wrapped server is a no-op.
 */
export function instrumentToolRegistry(server: McpServer): McpServer {
  const marked = server as unknown as { __videntiaToolRegistryInstrumented?: boolean };
  if (marked.__videntiaToolRegistryInstrumented) return server;
  marked.__videntiaToolRegistryInstrumented = true;

  const original = server.tool.bind(server);
  (server as unknown as { tool: (...args: unknown[]) => unknown }).tool = (...args: unknown[]) => {
    // The only registration form this codebase uses that carries a param schema is
    // tool(name, description, shape, handler). Anything else (zero-arg tools) passes
    // straight through unrecorded — it has no params to keep in parity.
    if (args.length === 4 && typeof args[0] === "string" && typeof args[3] === "function") {
      const name = args[0] as string;
      const rawShape = args[2] as ZodRawShape;
      const handler = args[3] as RegisteredToolEntry["handler"];
      if (rawShape && typeof rawShape === "object" && !Array.isArray(rawShape)) {
        // Declare the tool's alias spellings so zod does not strip them before the
        // wrapper can fold them in. Doing it HERE means standalone and batch accept
        // exactly the same input — the widening is not a batch-only concession.
        const shape: ZodRawShape = {};
        for (const key of Object.keys(rawShape)) {
          shape[key] = widenEnumCasing(rawShape[key]);
        }
        for (const alias of aliasKeysFor(name)) {
          const canonical = PARAM_ALIASES[name][alias];
          if (!(alias in shape)) {
            shape[alias] = z
              .unknown()
              .optional()
              .describe(`Alias for \`${canonical}\`.`) as unknown as ZodRawShape[string];
          }
          // A caller who spells the alias supplies the canonical parameter by proxy, but
          // the fold happens AFTER zod (the SDK owns the parse). So the canonical key is
          // relaxed to optional here, and "which one is missing" is reported by the
          // handler or the plugin instead of by zod. Without this, `rename_node` would
          // accept `newName` in a batch and reject it standalone — exactly the
          // asymmetry this refactor exists to remove.
          const target = shape[canonical] as { isOptional?: () => boolean; optional?: () => unknown } | undefined;
          if (target && typeof target.isOptional === "function" && !target.isOptional() && target.optional) {
            shape[canonical] = target.optional() as ZodRawShape[string];
          }
        }

        // `id` / `node` are what callers reach for when the tool's own parameter is
        // `nodeId`. Declaring them keeps zod from stripping the value before the
        // wrapper can salvage it — again, identically in both call paths.
        const hasNodeId = "nodeId" in rawShape;
        if (hasNodeId) {
          const nodeIdType = shape.nodeId as { isOptional?: () => boolean; optional?: () => unknown };
          if (typeof nodeIdType?.isOptional === "function" && !nodeIdType.isOptional() && nodeIdType.optional) {
            shape.nodeId = nodeIdType.optional() as ZodRawShape[string];
          }
          for (const salvage of ["id", "node"]) {
            if (salvage in shape) continue;
            shape[salvage] = z.unknown().optional().describe("Alias for `nodeId`.") as unknown as ZodRawShape[string];
          }
        }

        // Run a folded alias value through its canonical parameter's own zod type, so
        // `wrap: "balance"` reaches the wire as `BALANCE` exactly like `textWrapStyle`
        // would. A value the type rejects is passed through untouched and the handler
        // (or the plugin) reports it.
        const coerceField = (key: string, value: unknown): unknown => {
          const type = rawShape[key] as { safeParse?: (v: unknown) => { success: boolean; data?: unknown } };
          if (typeof type?.safeParse !== "function") return value;
          const widened = shape[key] as typeof type;
          const result = widened.safeParse!(value);
          return result.success ? result.data : value;
        };

        // Fold aliases in, then run the tool's real handler. Batch runs this SAME
        // wrapped handler, so neither path can see a different parameter contract.
        const wrapped: RegisteredToolEntry["handler"] = (parsedArgs, extra) =>
          handler(
            applyParamAliases(name, (parsedArgs ?? {}) as Record<string, unknown>, { hasNodeId, coerceField }),
            extra,
          );

        registry.set(name, { name, schema: z.object(shape), handler: wrapped });
        args = [args[0], args[1], shape, wrapped];
      }
    }
    return (original as (...a: unknown[]) => unknown)(...args);
  };

  return server;
}
