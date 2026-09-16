/**
 * Shared param-normalisation layer for Figma commands.
 *
 * WHY THIS EXISTS
 * ---------------
 * Standalone MCP tools (e.g. `set_layout_mode`) declare a *caller-facing* zod schema
 * and then massage those params into the *plugin-facing* wire shape before calling
 * `sendCommandToFigma` (e.g. `mode` → `layoutMode`). `batch_actions` forwards each
 * action's `params` RAW to the plugin — bypassing every one of those schemas — so the
 * same call that works standalone fails inside a batch ("Missing gradientType", …).
 *
 * This module centralises that massaging as `command -> normalize(params)` so batch
 * actions accept the SAME param names and value formats as the standalone tools.
 *
 * Rules:
 *  - ALIAS, never break: both spellings are accepted; the canonical (plugin-facing)
 *    name always wins when both are present.
 *  - IDEMPOTENT: normalising already-canonical params is a no-op, so this can safely
 *    be applied on top of a standalone tool's output too.
 *  - Never throws — unknown commands pass through untouched.
 */

import { normalizeNodeId } from "./figma-helpers";

type Params = Record<string, unknown>;

/** Keys whose values are Figma node ids and therefore accept the URL "12-34" form. */
const NODE_ID_KEYS = ["nodeId", "parentId", "childId", "targetId", "sourceId", "instanceId", "componentId", "frameId"];

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/**
 * Moves `from` to `to` when `to` is absent. Returns whether anything moved.
 * The canonical key (`to`) always wins if the caller supplied both.
 */
function alias(params: Params, from: string, to: string): void {
  if (!isPresent(params[to]) && isPresent(params[from])) {
    params[to] = params[from];
    delete params[from];
  } else if (from !== to && from in params && isPresent(params[to])) {
    delete params[from];
  }
}

function upper(params: Params, key: string): void {
  if (typeof params[key] === "string") params[key] = (params[key] as string).toUpperCase();
}

function defaultTo(params: Params, key: string, value: unknown): void {
  if (params[key] === undefined || params[key] === null) params[key] = value;
}

function num(params: Params, key: string): void {
  const v = params[key];
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) params[key] = Number(v);
}

/**
 * Per-command normalisers. Each mutates (a copy of) the params in place.
 * Add a new entry whenever a standalone tool massages params before dispatch.
 */
const NORMALIZERS: Record<string, (p: Params) => void> = {
  set_layout_mode: (p) => {
    alias(p, "mode", "layoutMode");
    alias(p, "direction", "layoutMode");
    upper(p, "layoutMode");
    upper(p, "wrap");
    upper(p, "gridAutoTracks");
    upper(p, "gridItemsPositioning");
    alias(p, "rows", "gridRowCount");
    alias(p, "columns", "gridColumnCount");
  },

  set_auto_layout: (p) => {
    alias(p, "mode", "layoutMode");
    upper(p, "layoutMode");
  },

  set_line_height: (p) => {
    alias(p, "height", "lineHeight");
    alias(p, "value", "lineHeight");
    num(p, "lineHeight");
    upper(p, "unit");
    defaultTo(p, "unit", "PIXELS");
  },

  set_letter_spacing: (p) => {
    alias(p, "spacing", "letterSpacing");
    alias(p, "value", "letterSpacing");
    num(p, "letterSpacing");
    upper(p, "unit");
    defaultTo(p, "unit", "PIXELS");
  },

  set_font_size: (p) => {
    alias(p, "size", "fontSize");
    num(p, "fontSize");
  },

  rename_node: (p) => {
    // Standalone takes `name`; callers coming from rename_variable habits send newName.
    alias(p, "newName", "name");
  },

  rename_variable: (p) => {
    alias(p, "id", "variableId");
    alias(p, "variable", "variableId");
    alias(p, "name", "newName");
  },

  rename_variable_collection: (p) => {
    alias(p, "id", "collectionId");
    alias(p, "name", "newName");
  },

  rename_page: (p) => {
    alias(p, "newName", "name");
  },

  bind_variable: (p) => {
    // The plugin resolves an id OR a name from the single `variableId` param, so
    // every name-shaped spelling folds into it.
    alias(p, "variable", "variableId");
    alias(p, "variableName", "variableId");
    alias(p, "name", "variableId");
    alias(p, "property", "field");
    alias(p, "fieldName", "field");
    alias(p, "prop", "field");
  },

  unbind_variable: (p) => {
    alias(p, "property", "field");
  },

  apply_text_style: (p) => {
    // The plugin resolves an id OR a name from the single `styleId` param.
    alias(p, "styleName", "styleId");
    alias(p, "style", "styleId");
    alias(p, "textStyleId", "styleId");
    alias(p, "textStyle", "styleId");
    alias(p, "name", "styleId");
  },

  set_color_style_id: (p) => {
    alias(p, "styleName", "styleId");
    alias(p, "style", "styleId");
    alias(p, "colorStyleId", "styleId");
  },

  set_effect_style_id: (p) => {
    // The plugin handler reads `effectStyleId` — NOT `styleId`. Aliasing to `styleId`
    // here was the direct cause of "Missing effectStyleId parameter" in batch.
    alias(p, "styleName", "effectStyleId");
    alias(p, "styleId", "effectStyleId");
    alias(p, "style", "effectStyleId");
  },

  set_image_fill: (p) => {
    // A local file path is a first-class source standalone; fold every spelling into
    // the single canonical key so batch-tools can read the file server-side.
    alias(p, "path", "image_path");
    alias(p, "load_from_path", "image_path");
    alias(p, "imagePath", "image_path");
    alias(p, "url", "imageUrl");
    alias(p, "bytes", "imageBytes");
    upper(p, "scaleMode");
    defaultTo(p, "scaleMode", "FILL");
  },

  set_gradient_fill: (p) => {
    alias(p, "type", "gradientType");
    upper(p, "gradientType");
    defaultTo(p, "gradientType", "LINEAR");
    defaultTo(p, "angle", 0);
    defaultTo(p, "opacity", 1);
    // Standalone defaults aspect_correct to true and sends it explicitly; mirror that
    // so a batched gradient lands identically. The string "false" comes from callers
    // that stringify booleans.
    alias(p, "aspectCorrect", "aspect_correct");
    if (p.aspect_correct === "false") p.aspect_correct = false;
    if (p.aspect_correct === "true") p.aspect_correct = true;
    defaultTo(p, "aspect_correct", true);
    // Standalone, `stops` goes through coerceArray + zod. Batch forwards params
    // raw, so mirror the same coercions here: a JSON-encoded array, and the
    // `colors: ["#a", "#b"]` shorthand agents reach for inside a batch.
    if (typeof p.stops === "string") {
      try {
        const parsed = JSON.parse(p.stops as string);
        if (Array.isArray(parsed)) p.stops = parsed;
      } catch {
        // leave as-is; the plugin reports a precise error
      }
    }
    if (!Array.isArray(p.stops) && Array.isArray(p.colors)) {
      const colors = p.colors as unknown[];
      p.stops = colors.map((color, i) => ({
        color,
        position: colors.length > 1 ? i / (colors.length - 1) : 0,
      }));
      delete p.colors;
    }
    if (Array.isArray(p.stops)) {
      p.stops = (p.stops as unknown[]).map((stop, i, all) => {
        // A bare colour (string or {r,g,b}) with no wrapper is the most common
        // batch shape; give it an evenly-spaced position.
        if (typeof stop === "string") {
          return { color: stop, position: all.length > 1 ? i / (all.length - 1) : 0 };
        }
        if (stop !== null && typeof stop === "object") {
          const o = { ...(stop as Record<string, unknown>) };
          if (o.color === undefined && o.hex !== undefined) o.color = o.hex;
          if (o.color === undefined && o.r !== undefined) {
            o.color = { r: o.r, g: o.g, b: o.b, ...(o.a !== undefined ? { a: o.a } : {}) };
            delete o.r;
            delete o.g;
            delete o.b;
            delete o.a;
          }
          if (o.position === undefined && o.offset !== undefined) o.position = o.offset;
          if (o.position === undefined) o.position = all.length > 1 ? i / (all.length - 1) : 0;
          if (typeof o.position === "string" && !Number.isNaN(Number(o.position))) o.position = Number(o.position);
          return o;
        }
        return stop;
      });
    }
  },

  set_corner_radius: (p) => {
    num(p, "radius");
    // Accept the object form {topLeft, topRight, bottomRight, bottomLeft} as well as
    // the standalone [tl, tr, br, bl] boolean array.
    const corners = p.corners;
    if (corners !== null && typeof corners === "object" && !Array.isArray(corners)) {
      const c = corners as Record<string, unknown>;
      p.corners = [c.topLeft !== false, c.topRight !== false, c.bottomRight !== false, c.bottomLeft !== false];
    }
    defaultTo(p, "corners", [true, true, true, true]);
  },

  create_text: (p) => {
    alias(p, "characters", "text");
    alias(p, "content", "text");
    defaultTo(p, "fontSize", 14);
    defaultTo(p, "fontFamily", "Inter");
    defaultTo(p, "fontWeight", 400);
    defaultTo(p, "fontColor", { r: 0, g: 0, b: 0, a: 1 });
    defaultTo(p, "name", typeof p.text === "string" && p.text ? p.text : "Text");
  },

  create_rectangle: (p) => {
    alias(p, "fill", "fillColor");
    alias(p, "color", "fillColor");
    alias(p, "radius", "cornerRadius");
    defaultTo(p, "name", "Rectangle");
  },

  create_frame: (p) => {
    alias(p, "fill", "fillColor");
    alias(p, "mode", "layoutMode");
    upper(p, "layoutMode");
    defaultTo(p, "name", "Frame");
  },

  set_text_content: (p) => {
    alias(p, "characters", "text");
    alias(p, "content", "text");
  },

  set_fill_color: (p) => {
    alias(p, "fill", "color");
    alias(p, "hex", "color");
  },

  set_stroke_color: (p) => {
    alias(p, "stroke", "color");
    alias(p, "hex", "color");
  },

  resize_node: (p) => {
    num(p, "width");
    num(p, "height");
  },

  move_node: (p) => {
    num(p, "x");
    num(p, "y");
  },

  // --- Added from the standalone-zod vs plugin-handler contract audit -------------
  // Each of these standalone tools RENAMES a param before putting it on the wire, so
  // the documented (caller-facing) spelling was rejected inside a batch.

  set_paragraph_spacing: (p) => {
    alias(p, "spacing", "paragraphSpacing");
    alias(p, "value", "paragraphSpacing");
    num(p, "paragraphSpacing");
  },

  set_text_decoration: (p) => {
    alias(p, "decoration", "textDecoration");
    upper(p, "textDecoration");
  },

  set_text_case: (p) => {
    alias(p, "case", "textCase");
    upper(p, "textCase");
  },

  set_text_wrap_style: (p) => {
    alias(p, "wrap", "textWrapStyle");
    alias(p, "wrapStyle", "textWrapStyle");
    upper(p, "textWrapStyle");
  },

  set_font_weight: (p) => {
    alias(p, "fontWeight", "weight");
    num(p, "weight");
  },

  set_font_name: (p) => {
    alias(p, "fontFamily", "family");
    alias(p, "fontStyle", "style");
  },

  set_padding: (p) => {
    // The plugin accepts both spellings, but fold the shorthand here so the wire
    // payload is identical to the standalone tool's.
    alias(p, "top", "paddingTop");
    alias(p, "right", "paddingRight");
    alias(p, "bottom", "paddingBottom");
    alias(p, "left", "paddingLeft");
    const all = p.padding;
    if (typeof all === "number" || (typeof all === "string" && all.trim() !== "" && !Number.isNaN(Number(all)))) {
      const v = Number(all);
      for (const k of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]) defaultTo(p, k, v);
      delete p.padding;
    }
    for (const k of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]) num(p, k);
  },

  set_item_spacing: (p) => {
    alias(p, "gap", "itemSpacing");
    alias(p, "spacing", "itemSpacing");
    alias(p, "rowGap", "gridRowGap");
    alias(p, "columnGap", "gridColumnGap");
    for (const k of ["itemSpacing", "counterAxisSpacing", "gridRowGap", "gridColumnGap"]) num(p, k);
  },

  set_layout_sizing: (p) => {
    alias(p, "horizontal", "layoutSizingHorizontal");
    alias(p, "vertical", "layoutSizingVertical");
    upper(p, "layoutSizingHorizontal");
    upper(p, "layoutSizingVertical");
  },

  set_axis_align: (p) => {
    alias(p, "primary", "primaryAxisAlignItems");
    alias(p, "counter", "counterAxisAlignItems");
    upper(p, "primaryAxisAlignItems");
    upper(p, "counterAxisAlignItems");
  },

  set_opacity: (p) => {
    alias(p, "alpha", "opacity");
    num(p, "opacity");
  },

  // Variable/collection commands whose standalone schema uses a bare `id`.
  delete_variable: (p) => {
    alias(p, "id", "variableId");
    alias(p, "variable", "variableId");
    alias(p, "name", "variableId");
  },

  update_variable_value: (p) => {
    alias(p, "id", "variableId");
    alias(p, "variable", "variableId");
    alias(p, "variableName", "variableId");
  },

  delete_variable_collection: (p) => {
    alias(p, "id", "collectionId");
    alias(p, "collection", "collectionId");
  },

  add_chart_colors: (p) => {
    alias(p, "id", "collectionId");
  },

  add_mode_to_collection: (p) => {
    alias(p, "id", "collectionId");
    alias(p, "name", "modeName");
  },

  delete_mode: (p) => {
    alias(p, "id", "collectionId");
    alias(p, "name", "modeName");
  },

  rename_mode: (p) => {
    alias(p, "id", "collectionId");
    alias(p, "oldName", "modeName");
    alias(p, "newName", "newModeName");
  },
};

/**
 * Normalise one batch action's params into the plugin-facing wire shape.
 *
 * Applied by `batch_actions` before dispatch so a batched action behaves exactly like
 * the equivalent standalone tool call. Safe to call on already-canonical params.
 */
export function normalizeCommandParams(command: string, params: Params | undefined | null): Params {
  const out: Params = { ...(params ?? {}) };

  // Universal: Figma URL-style node ids ("65-7554") → API form ("65:7554").
  for (const key of NODE_ID_KEYS) {
    const v = out[key];
    // A stringified `undefined`/`null` is a marshalling accident upstream, not an id —
    // dropping it surfaces "missing nodeId" instead of "Node with ID undefined not found".
    if (v === "undefined" || v === "null") {
      delete out[key];
      continue;
    }
    if (typeof v === "string" && !v.startsWith("$result[")) out[key] = normalizeNodeId(v);
  }
  if (Array.isArray(out.nodeIds)) {
    out.nodeIds = out.nodeIds.map((v) => (typeof v === "string" && !v.startsWith("$result[") ? normalizeNodeId(v) : v));
  }

  const normalizer = NORMALIZERS[command];
  if (normalizer) {
    try {
      normalizer(out);
    } catch {
      // Normalisation is best-effort — never block an action from reaching the plugin.
    }
  }

  // A bare `id`/`node` is what callers reach for when the command's own param is
  // `nodeId` — one source of "Node with ID undefined not found", where the real id sat
  // in a key the plugin never read. Runs AFTER the per-command normaliser so commands
  // whose `id` means a variable/collection/mode have already claimed it.
  if (!isPresent(out.nodeId) && !isPresent(out.variableId) && !isPresent(out.collectionId)) {
    if (isPresent(out.node)) alias(out, "node", "nodeId");
    else if (isPresent(out.id)) alias(out, "id", "nodeId");
    if (typeof out.nodeId === "string" && !out.nodeId.startsWith("$result[")) {
      out.nodeId = normalizeNodeId(out.nodeId);
    }
  }

  return out;
}

/** Commands this layer knows how to normalise (exported for tests/introspection). */
export const NORMALIZED_COMMANDS = Object.keys(NORMALIZERS);
