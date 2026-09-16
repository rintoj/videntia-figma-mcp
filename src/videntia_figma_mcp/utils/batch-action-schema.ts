/**
 * The `batch_actions` action schema — published so callers can SEE the shape.
 *
 * WHY THIS EXISTS
 * ---------------
 * The single largest source of batch rejections was not a bad parameter but a bad
 * *envelope*: 200 zod "Required at actions[N].action" errors, because the action
 * shape is invisible from the tool description and callers guess `type:` (the
 * spelling almost every other tool-calling schema uses) or write the command's
 * params flat next to the action name.
 *
 * So this schema is deliberately forgiving about the envelope while staying strict
 * about what reaches the plugin:
 *  - `type` is accepted as an alias for `action`;
 *  - params written FLAT alongside `action` are folded into `params`.
 * Once the envelope is understood, the action is parsed by its STANDALONE tool's own
 * zod schema and built by that tool's own handler (see `utils/tool-registry.ts` and
 * `utils/tool-capture.ts`), so a batched action accepts exactly what the standalone
 * tool accepts — by construction, not by a parallel alias map.
 */

import { z } from "zod";

/** Envelope keys that are never part of a command's own params. */
const ENVELOPE_KEYS = new Set(["action", "type", "params", "command", "name_"]);

/**
 * Normalises one raw action entry into `{action, params}`.
 * Runs as a zod `preprocess`, i.e. BEFORE validation — which matters, because zod
 * strips undeclared keys and cannot rescue a key it has already thrown away.
 */
function normalizeActionEnvelope(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;

  // `action` wins; `type` and `command` are the common guesses.
  const action = raw.action ?? raw.type ?? raw.command;

  const declared = raw.params;
  const params: Record<string, unknown> =
    declared !== null && typeof declared === "object" && !Array.isArray(declared)
      ? { ...(declared as Record<string, unknown>) }
      : {};

  // Fold flat params in. An explicitly declared `params` entry always wins.
  for (const key of Object.keys(raw)) {
    if (ENVELOPE_KEYS.has(key)) continue;
    if (!(key in params)) params[key] = raw[key];
  }

  return { action, params };
}

export const batchActionSchema = z.preprocess(
  normalizeActionEnvelope,
  z.object({
    action: z
      .string()
      .describe(
        "Command name — the SAME name as the standalone MCP tool (e.g. 'clone_node', 'set_fill_color', 'apply_text_style'). Alias: 'type'.",
      ),
    params: z
      .record(z.unknown())
      .optional()
      .default({})
      .describe(
        "Parameters for the command — the SAME parameter names the standalone tool documents (names are accepted wherever the standalone tool accepts them). May also be written flat next to `action`.",
      ),
  }),
);

export type BatchActionInput = { action: string; params: Record<string, unknown> };

/** Human/agent-readable description of the envelope, served by get_schema_definition. */
export const BATCH_ACTION_SCHEMA_DOC = {
  tool: "batch_actions",
  shape: {
    actions: "Array<{ action: string; params?: object }> (required, min 1)",
    stopOnError: "boolean (optional, default false) — abort remaining actions after the first failure",
    checkpoint: "boolean (optional, default true) — commit an undo checkpoint before the batch",
  },
  action: {
    action: "string — the command name, identical to the standalone MCP tool name",
    params: "object — the command's parameters, identical to the standalone tool's parameters",
  },
  aliases: {
    action: ["type", "command"],
    params: "params written flat alongside `action` are folded into `params` automatically",
  },
  parameterContract:
    "A batched action takes EXACTLY what the equivalent standalone tool takes. Human-readable names are resolved server-side just as they are standalone: apply_text_style accepts styleName, set_color_style_id/set_effect_style_id accept styleName, bind_variable accepts variableName, create_icon/update_icon accept a Lucide icon `name` + `size` + `color` (the SVG is generated server-side). Figma URL-style node ids ('65-7554') are accepted anywhere an id is.",
  resultReferences: {
    syntax: "$result[N] | $result[N].field | $result[N].children[0].name",
    indexing:
      "N is the index of the action as YOU listed it in `actions` — unaffected by actions that expand internally (create_icon) or by automatic chunking of long batches.",
  },
  example: {
    actions: [
      { action: "clone_node", params: { nodeId: "1:23" } },
      { action: "rename_node", params: { nodeId: "$result[0].id", name: "Copy" } },
      { action: "apply_text_style", params: { nodeId: "1:24", styleName: "body/md" } },
      { action: "bind_variable", params: { nodeId: "1:24", variableName: "text/primary", field: "fills/0/color" } },
      { action: "update_icon", params: { nodeId: "1:25", name: "check", size: 16, color: "#00aa00" } },
    ],
    stopOnError: true,
  },
  commonMistakes: [
    "Writing { type: 'set_fill_color', ... } — accepted now, but `action` is canonical.",
    "Omitting the `action` key entirely (e.g. { set_fill_color: {...} }) — not supported.",
    "Assuming batch needs IDs where the standalone tool takes a name — it does not; names work in both.",
  ],
};
