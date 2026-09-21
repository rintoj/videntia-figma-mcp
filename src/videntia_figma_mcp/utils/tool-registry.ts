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
import { runWithChannel } from "./channel-context.js";

export interface RegisteredToolEntry {
  name: string;
  /** The one-line description the tool declared. Used by `find_figma_tools`. */
  description: string;
  /** Registrar-derived category (e.g. "text", "variable"). Set by `setRegistrationCategory`. */
  category: string;
  /** The raw zod shape the tool declared — re-assembled into an object schema. */
  schema: z.ZodObject<ZodRawShape>;
  /** The tool's own handler, invoked with ALREADY-PARSED args. */
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
}

const registry = new Map<string, RegisteredToolEntry>();

/**
 * Tools whose schema rejects unknown parameters instead of letting zod strip them.
 *
 * Zod's default `strip` mode makes a misspelled or unsupported parameter a SILENT
 * no-op: `export_node_as_image` accepted `output_directory` for months and wrote the
 * file somewhere else entirely. For tools where a dropped parameter changes where
 * real side effects land, the call must fail loudly instead.
 */
export const STRICT_PARAM_TOOLS = new Set<string>(["export_node_as_image", "set_auto_layout"]);

/** Swap the SDK's own parsed schema for the strict one, for allowlisted tools. */
function enforceStrictSchema(server: McpServer, name: string, strict: z.ZodObject<ZodRawShape>): void {
  if (!STRICT_PARAM_TOOLS.has(name)) return;
  const registered = (server as unknown as { _registeredTools?: Record<string, { inputSchema?: unknown }> })
    ._registeredTools;
  const entry = registered?.[name];
  if (entry && entry.inputSchema) entry.inputSchema = strict;
}

/**
 * Progressive-discovery support.
 *
 * The registry already sees EVERY tool. That makes it the natural place to gate which
 * of them are additionally handed to the MCP SDK (and therefore billed to every agent
 * session as a JSON-Schema in `tools/list`). A gate that returns false still records
 * the tool here in full, so `find_figma_tools`, `describe_figma_tools`, `figma_call`
 * and `batch_actions` all keep working on it — it is simply not advertised up front.
 */
type RegistrationGate = (name: string, category: string) => boolean;
let registrationGate: RegistrationGate = () => true;
let currentCategory = "uncategorized";
/** Deferred tools: name -> a thunk that performs the real SDK registration. */
const deferred = new Map<string, () => void>();
const sdkRegistered = new Set<string>();

/** Install the gate deciding which tools reach the SDK. Call before `registerTools`. */
export function setRegistrationGate(gate: RegistrationGate): void {
  registrationGate = gate;
}

/** Tag subsequent registrations with a category. Called around each registrar. */
export function setRegistrationCategory(category: string): void {
  currentCategory = category;
}

/** Every recorded entry (all tools, registered with the SDK or not). */
export function listRegistryEntries(): RegisteredToolEntry[] {
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Tool names recorded but NOT (yet) advertised to the MCP client. */
export function listDeferredToolNames(): string[] {
  return [...deferred.keys()].sort();
}

/** True when the tool has been handed to the SDK and appears in `tools/list`. */
export function isSdkRegistered(name: string): boolean {
  return sdkRegistered.has(name);
}

/**
 * Advertise a previously deferred tool to the MCP client. Returns true when this call
 * actually registered it (so the caller knows whether to emit `tools/list_changed`).
 */
export function activateDeferredTool(name: string): boolean {
  const thunk = deferred.get(name);
  if (!thunk) return false;
  deferred.delete(name);
  thunk();
  sdkRegistered.add(name);
  return true;
}

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
  deferred.clear();
  sdkRegistered.clear();
  registrationGate = () => true;
  currentCategory = "uncategorized";
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

        // Every tool accepts `channel`: the Figma channel this ONE call is addressed to.
        // One MCP process serves every agent sharing a client session, so a
        // module-level "current channel" is shared mutable state that parallel agents
        // clobber — and a clobbered channel delivers reads and writes into the wrong
        // Figma file. Declaring it here means no per-tool edits and no way for a tool to
        // opt out. It is stripped before the handler runs (handlers never see it) and is
        // instead bound to the async context the transport reads (see channel-context.ts).
        if (!("channel" in shape)) {
          shape.channel = z
            .string()
            .optional()
            .describe(
              "Figma channel to address this call to. Defaults to the session's joined channel. REQUIRED when more than one channel is joined in this process.",
            ) as unknown as ZodRawShape[string];
        }

        // Fold aliases in, then run the tool's real handler. Batch runs this SAME
        // wrapped handler, so neither path can see a different parameter contract.
        const wrapped: RegisteredToolEntry["handler"] = (parsedArgs, extra) => {
          const { channel, ...rest } = (parsedArgs ?? {}) as Record<string, unknown>;
          const target = typeof channel === "string" && channel.length > 0 ? channel : undefined;
          // The socket server hosts one MCP server per SSE/HTTP session inside a SINGLE
          // process, so the session id is what separates one client's joined channel
          // from another's. Absent (stdio) it falls back to process-wide resolution.
          const sessionId = (extra as { sessionId?: unknown } | undefined)?.sessionId;
          return runWithChannel(target, typeof sessionId === "string" ? sessionId : undefined, () =>
            handler(applyParamAliases(name, rest, { hasNodeId, coerceField }), extra),
          );
        };

        const category = currentCategory;
        const schema = STRICT_PARAM_TOOLS.has(name) ? z.object(shape).strict() : z.object(shape);
        registry.set(name, {
          name,
          description: typeof args[1] === "string" ? args[1] : "",
          category,
          schema,
          handler: wrapped,
        });
        const finalArgs = [args[0], args[1], shape, wrapped];
        if (!registrationGate(name, category)) {
          // Recorded, reachable, but not advertised. Keep the exact SDK call around so
          // `describe_figma_tools` / `load_figma_tools` can perform it verbatim later.
          deferred.set(name, () => {
            const out = (original as (...a: unknown[]) => unknown)(...finalArgs);
            enforceStrictSchema(server, name, schema);
            return out;
          });
          return undefined;
        }
        sdkRegistered.add(name);
        const out = (original as (...a: unknown[]) => unknown)(...finalArgs);
        enforceStrictSchema(server, name, schema);
        return out;
      }
    }
    return (original as (...a: unknown[]) => unknown)(...args);
  };

  return server;
}
