/**
 * Caller-facing INPUT WIDENING, applied identically to standalone and batched calls.
 *
 * WHAT REPLACED WHAT
 * ------------------
 * This is what is left of `normalize-batch-params.ts`, and the difference is the whole
 * point. The old module was a batch-only `command -> plugin wire shape` map: a SECOND
 * implementation of what each handler already does between parse and dispatch, which
 * drifted from the handlers twice (it aliased `set_effect_style_id` to `styleId` while
 * the handler sends `effectStyleId`; it missed `aspect_correct` when `set_gradient_fill`
 * gained it).
 *
 * All of that — defaults, coercions, renames onto the wire — is GONE. It now happens
 * exactly once, in the tool's own zod schema and its own handler, for both call paths
 * (see `tool-registry.ts` / `tool-capture.ts`).
 *
 * What survives is strictly smaller and structurally drift-proof: a table of EXTRA
 * SPELLINGS a caller may use for a parameter, mapped onto that tool's OWN schema
 * parameter name — never onto a plugin wire name. The wrapper folds the alias into the
 * canonical key and then the normal schema + handler run, so the two paths cannot
 * diverge. `tests/integration/batch-contract-parity.test.ts` asserts every target below
 * is a real key of that tool's schema, which is the exact failure that bit twice.
 */

import { normalizeNodeId } from "./figma-helpers";

/** command -> { alias spelling : the tool's own schema parameter name }. */
export const PARAM_ALIASES: Record<string, Record<string, string>> = {
  set_layout_mode: { direction: "mode" },
  set_line_height: { value: "height" },
  set_letter_spacing: { value: "spacing" },
  rename_node: { newName: "name" },
  rename_page: { newName: "name" },
  rename_variable: { variable: "id" },
  bind_variable: {
    variable: "variableId",
    variableName: "variableId",
    name: "variableId",
    property: "field",
    fieldName: "field",
    prop: "field",
  },
  unbind_variable: { property: "field" },
  apply_text_style: {
    styleName: "styleId",
    style: "styleId",
    textStyleId: "styleId",
    textStyle: "styleId",
    name: "styleId",
  },
  set_color_style_id: { styleName: "styleId", style: "styleId", colorStyleId: "styleId" },
  set_effect_style_id: { styleName: "effectStyleId", styleId: "effectStyleId", style: "effectStyleId" },
  set_image_fill: {
    path: "image_path",
    load_from_path: "image_path",
    imagePath: "image_path",
    url: "imageUrl",
    bytes: "imageBytes",
    tileScale: "scalingFactor",
    scale: "scalingFactor",
  },
  set_image_fill_from_path: { tileScale: "scalingFactor", scale: "scalingFactor" },
  set_gradient_fill: { aspectCorrect: "aspect_correct" },
  create_icon: { icon: "name", iconName: "name" },
  update_icon: { icon: "name", iconName: "name" },
  create_text: { characters: "text", content: "text" },
  create_rectangle: { fill: "fillColor", color: "fillColor", radius: "cornerRadius" },
  create_frame: { fill: "fillColor", mode: "layoutMode" },
  set_text_content: { characters: "text", content: "text" },
  set_fill_color: { fill: "color", hex: "color", alpha: "a", opacity: "a" },
  set_stroke_color: { stroke: "color", hex: "color", alpha: "a", opacity: "a" },
  set_paragraph_spacing: { value: "spacing" },
  set_text_decoration: { textDecoration: "decoration" },
  set_text_case: { case: "textCase" },
  set_text_wrap_style: { wrap: "textWrapStyle", wrapStyle: "textWrapStyle" },
  set_font_weight: { fontWeight: "weight" },
  set_font_name: { fontFamily: "family", fontStyle: "style" },
  set_item_spacing: { gap: "itemSpacing", spacing: "itemSpacing" },
  // `gap` is what every sibling layout tool calls this (set_gap, create_frame,
  // set_auto_layout). Undeclared here it was stripped by zod and the composite was
  // built with the house default instead of the caller's spacing.
  create_autolayout_frame: { gap: "itemSpacing" },
  create_card: { gap: "itemSpacing" },
  create_slot: { gap: "itemSpacing", mode: "layoutMode" },
  // `allowSideEffects`/`expectSideEffects` are the camelCase spellings a caller reaches
  // for; the tool's own parameters are snake_case like `return_state`.
  set_layout_sizing: {
    horizontal: "layoutSizingHorizontal",
    vertical: "layoutSizingVertical",
    allowSideEffects: "allow_side_effects",
    expectSideEffects: "expect_side_effects",
  },
  set_auto_layout: { allowSideEffects: "allow_side_effects", expectSideEffects: "expect_side_effects" },
  set_strict_mode: { allowSideEffects: "allow_side_effects", returnState: "return_state" },
  set_axis_align: { primary: "primaryAxisAlignItems", counter: "counterAxisAlignItems" },
  set_opacity: { alpha: "opacity" },
  set_rotation: { angle: "rotation", degrees: "rotation" },
  set_layer_order: { order: "position", index: "position" },
  create_ellipse: { fill: "fillColor", color: "fillColor", stroke: "strokeColor" },
  set_page_background: { alpha: "a", opacity: "a" },
  // `variableId` is what the other variable tools call this parameter, and it is the
  // first spelling a caller reaches for. Accepting it here means the caller never sees a
  // schema error that reads as if the VARIABLE were the problem.
  delete_variable: { variable: "id", name: "id", variableId: "id", variableName: "id" },
  delete_variables_batch: { variableIds: "ids", variables: "ids", names: "ids", variableId: "ids" },
  update_variable_value: { variable: "variableId", variableName: "variableId", id: "variableId" },
  delete_variable_collection: { collection: "id" },
  // `annotationId` was always a 0-based index, never an id.
  set_annotation: { annotationId: "index" },
  remove_annotation: { annotationId: "index" },
  get_annotations: { includeChildren: "include_children" },
};

/** Keys whose values are Figma node ids and therefore accept the URL "12-34" form. */
const NODE_ID_KEYS = ["nodeId", "parentId", "childId", "targetId", "sourceId", "instanceId", "componentId", "frameId"];

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function normalizeId(value: unknown): unknown {
  if (typeof value !== "string" || value.startsWith("$result[")) return value;
  return normalizeNodeId(value);
}

/**
 * Fold alias spellings onto their canonical parameter and normalise node ids.
 * Idempotent, never throws, and the canonical key always wins when both are supplied.
 * Runs on the way IN, before the tool's zod schema — in both call paths.
 */
export interface AliasOptions {
  /** True when the tool really has a `nodeId` parameter — gates the `id`/`node` salvage. */
  hasNodeId: boolean;
  /**
   * Parameters the tool declares under these exact names. The `id`/`node` salvage must
   * NOT consume a key the tool owns: `remove_animation_style` takes both `nodeId` and a
   * distinct `id` (the applied style), and the salvage silently deleted the latter, so
   * the tool could never receive it.
   */
  declaresId?: boolean;
  declaresNode?: boolean;
  /**
   * Re-validate a folded value against the canonical parameter's own zod type. The fold
   * happens after the SDK's parse, so without this an aliased value would skip the
   * coercions (enum casing, number coercion) its canonical spelling gets — and the two
   * spellings would put different bytes on the wire.
   */
  coerceField?: (key: string, value: unknown) => unknown;
}

/**
 * Fold alias spellings onto their canonical parameter and normalise node ids.
 * Idempotent, never throws, and the canonical key always wins when both are supplied.
 * Runs identically in both call paths, immediately before the tool's handler.
 */
export function applyParamAliases(
  command: string,
  params: Record<string, unknown>,
  options: AliasOptions = { hasNodeId: true },
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...params };

  for (const [from, to] of Object.entries(PARAM_ALIASES[command] ?? {})) {
    if (!(from in out)) continue;
    if (!isPresent(out[to]) && isPresent(out[from])) {
      out[to] = options.coerceField ? options.coerceField(to, out[from]) : out[from];
    }
    delete out[from];
  }

  // A bare `id`/`node` is what callers reach for when the tool's own parameter is
  // `nodeId`. Only for tools that HAVE a `nodeId` — elsewhere `id` means a variable,
  // collection or mode and must be left alone.
  if (options.hasNodeId && !isPresent(out.nodeId)) {
    if (isPresent(out.node) && !options.declaresNode) out.nodeId = out.node;
    else if (isPresent(out.id) && !options.declaresId) out.nodeId = out.id;
  }
  if (options.hasNodeId) {
    if (!options.declaresNode) delete out.node;
    if (!options.declaresId) delete out.id;
  }

  for (const key of NODE_ID_KEYS) {
    const v = out[key];
    // A stringified `undefined`/`null` is a marshalling accident upstream, not an id —
    // dropping it surfaces "missing nodeId" instead of "Node with ID undefined not found".
    if (v === "undefined" || v === "null") {
      delete out[key];
      continue;
    }
    if (v !== undefined) out[key] = normalizeId(v);
  }
  if (Array.isArray(out.nodeIds)) out.nodeIds = out.nodeIds.map(normalizeId);

  // Keys the SDK's parse filled in as `undefined` are noise on the wire and can shadow a
  // real value in a handler that spreads params. Drop them, exactly as zod would.
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }

  return out;
}

/** Every alias spelling a tool accepts, for schema augmentation and tests. */
export function aliasKeysFor(command: string): string[] {
  return Object.keys(PARAM_ALIASES[command] ?? {});
}

/**
 * Make every ALL-CAPS zod enum in a schema accept any casing.
 *
 * WHY STRUCTURAL AND NOT A TABLE: the old batch normaliser hand-listed 17 keys to
 * uppercase (`layoutMode`, `textCase`, `scaleMode`, …). Every enum it forgot was a
 * batch call that failed where the standalone call worked, or vice versa. Detecting
 * "the enum's own members are uppercase, so the caller's lowercase spelling is
 * unambiguous" needs no list and cannot fall behind a newly added enum.
 *
 * Applied once at registration, so standalone and batched calls are equally forgiving.
 */
export function widenEnumCasing<T>(schema: T): T {
  const def = (
    schema as { _def?: { typeName?: string; innerType?: unknown; type?: unknown; schema?: unknown; values?: unknown } }
  )._def;
  if (!def) return schema;

  if (def.typeName === "ZodEnum" && Array.isArray(def.values)) {
    const values = def.values as string[];
    const allUpper = values.length > 0 && values.every((v) => typeof v === "string" && v === v.toUpperCase());
    if (!allUpper) return schema;
    const lookup = new Map(values.map((v) => [v.toUpperCase(), v]));
    return zPreprocess((input: unknown) => {
      if (typeof input !== "string") return input;
      return lookup.get(input.toUpperCase()) ?? input;
    }, schema) as T;
  }

  // Unwrap the containers a tool parameter is realistically built from. Anything else
  // is returned untouched — widening is best-effort and must never change validity.
  for (const key of ["innerType", "type", "schema"] as const) {
    const inner = def[key];
    if (inner && typeof inner === "object" && "_def" in (inner as object)) {
      const widened = widenEnumCasing(inner);
      if (widened !== inner) {
        (def as Record<string, unknown>)[key] = widened;
      }
    }
  }
  return schema;
}

// Imported lazily to keep this module free of a hard zod dependency at the top, where
// it is only ever used for plain object shuffling.
import { z } from "zod";
function zPreprocess(fn: (input: unknown) => unknown, schema: unknown) {
  return z.preprocess(fn, schema as z.ZodTypeAny);
}
