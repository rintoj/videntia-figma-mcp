// ---------------------------------------------------------------------------
// Node Serializer — serialize Figma nodes to enriched FigmaNodeData format
// ---------------------------------------------------------------------------

import { gradientTransformToCssAngle } from "../../videntia_figma_mcp/utils/gradient-geometry";

// Build lookup maps for variables, text styles, and effect styles in parallel.
async function buildLookupMaps(): Promise<{
  variableMap: Map<string, string>;
  textStyleMap: Map<string, string>;
  effectStyleMap: Map<string, string>;
}> {
  const variableMap = new Map<string, string>();
  const textStyleMap = new Map<string, string>();
  const effectStyleMap = new Map<string, string>();

  const [localVarsResult, localStylesResult, localEffectsResult] = await Promise.all([
    figma.variables.getLocalVariablesAsync().catch(function () {
      return null;
    }),
    figma.getLocalTextStylesAsync().catch(function () {
      return null;
    }),
    figma.getLocalEffectStylesAsync().catch(function () {
      return null;
    }),
  ]);

  if (localVarsResult !== null) {
    for (const v of localVarsResult) {
      variableMap.set(v.id, v.name);
    }
  }
  if (localStylesResult !== null) {
    for (const s of localStylesResult) {
      textStyleMap.set(s.id, s.name);
    }
  }
  if (localEffectsResult !== null) {
    for (const s of localEffectsResult) {
      effectStyleMap.set(s.id, s.name);
    }
  }

  return { variableMap, textStyleMap, effectStyleMap };
}

// Convert Figma color {r,g,b,a} (0-1) to hex or rgba string
function colorToHex(color: RGBA): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  if (color.a !== undefined && color.a < 1) {
    return "rgba(" + r + "," + g + "," + b + "," + parseFloat(color.a.toFixed(2)) + ")";
  }
  return "#" + r.toString(16).padStart(2, "0") + g.toString(16).padStart(2, "0") + b.toString(16).padStart(2, "0");
}

// Resolve bound variables for a node
function resolveBindings(
  node: SceneNode,
  variableMap: Map<string, string>,
): Record<string, { id: string; name: string }> {
  const bindings: Record<string, { id: string; name: string }> = {};
  if (!("boundVariables" in node) || !(node as unknown as Record<string, unknown>)["boundVariables"]) {
    return bindings;
  }

  const bv = (node as unknown as Record<string, unknown>)["boundVariables"] as Record<string, unknown>;
  for (const field in bv) {
    if (!Object.prototype.hasOwnProperty.call(bv, field)) continue;
    const binding = bv[field];
    if (!binding) continue;
    if (Array.isArray(binding)) {
      for (let i = 0; i < binding.length; i++) {
        const b = binding[i] as Record<string, string>;
        if (b && b["id"]) {
          const name = variableMap.get(b["id"]);
          if (name) bindings[field + "/" + i] = { id: b["id"], name: name };
        }
      }
    } else {
      const bindingObj = binding as Record<string, string>;
      if (bindingObj["id"]) {
        const name = variableMap.get(bindingObj["id"]);
        if (name) bindings[field] = { id: bindingObj["id"], name: name };
      }
    }
  }
  return bindings;
}

const IMAGE_FILTER_KEYS = [
  "exposure",
  "contrast",
  "saturation",
  "temperature",
  "tint",
  "highlights",
  "shadows",
] as const;

/**
 * Copy an IMAGE paint's identity onto its serialized form: imageHash (+ legacy
 * imageRef), scaleMode, scalingFactor (TILE only), rotation (when non-zero),
 * imageTransform (CROP only) and the non-default image filters. Everything
 * set_image_fill writes therefore reads back.
 */
export function extractImagePaintFields(paint: ImagePaint, out: Record<string, unknown>): void {
  if (paint.imageHash) {
    out["imageRef"] = paint.imageHash;
    out["imageHash"] = paint.imageHash;
  }
  if (paint.scaleMode) out["scaleMode"] = paint.scaleMode;
  if (paint.scaleMode === "TILE" && typeof paint.scalingFactor === "number") {
    out["scalingFactor"] = paint.scalingFactor;
  }
  if (typeof paint.rotation === "number" && paint.rotation !== 0) out["rotation"] = paint.rotation;
  if (paint.scaleMode === "CROP" && Array.isArray(paint.imageTransform)) {
    out["imageTransform"] = paint.imageTransform.map(function (row) {
      return row.slice();
    });
  }
  if (paint.filters) {
    const filters: Record<string, number> = {};
    const source = paint.filters as Record<string, number | undefined>;
    for (const key of IMAGE_FILTER_KEYS) {
      const value = source[key];
      if (typeof value === "number" && value !== 0) filters[key] = value;
    }
    if (Object.keys(filters).length > 0) out["filters"] = filters;
  }
}

// Extract simplified fills.
// Returns a single [{type:"MIXED"}] entry when the node has mixed fills, an array
// (possibly empty) when the node supports fills, and undefined only when the node has
// no fills property at all.
// Invisible paints are KEPT (flagged visible:false) — dropping them made it impossible
// to tell "this node has a hidden fill" from "this node was never serialized".
export function extractFills(node: SceneNode): Record<string, unknown>[] | undefined {
  if (!("fills" in node)) return undefined;
  if ((node as GeometryMixin).fills === figma.mixed) return [{ type: "MIXED" }];
  const fills = (node as GeometryMixin).fills as Paint[];
  if (!Array.isArray(fills)) return undefined;

  const result: Record<string, unknown>[] = [];
  for (const fill of fills) {
    const f: Record<string, unknown> = { type: fill.type };
    if (fill.visible === false) f["visible"] = false;
    if (fill.opacity !== undefined && fill.opacity !== 1) f["opacity"] = fill.opacity;
    if (fill.blendMode && fill.blendMode !== "NORMAL" && fill.blendMode !== "PASS_THROUGH") {
      f["blendMode"] = fill.blendMode;
    }
    if (fill.type === "SOLID" && fill.color) {
      f["color"] = colorToHex(fill.color as RGBA);
    } else if (
      fill.type === "GRADIENT_LINEAR" ||
      fill.type === "GRADIENT_RADIAL" ||
      fill.type === "GRADIENT_ANGULAR" ||
      fill.type === "GRADIENT_DIAMOND"
    ) {
      const gradFill = fill as GradientPaint;
      if (gradFill.gradientStops) {
        const gradient: Record<string, unknown> = {
          type: fill.type,
          stops: gradFill.gradientStops.map(function (s) {
            return {
              color: colorToHex(s.color),
              position: s.position,
            };
          }),
        };
        if (fill.type === "GRADIENT_LINEAR") {
          const size = node as unknown as { width?: number; height?: number };
          const angle = gradientTransformToCssAngle(gradFill.gradientTransform, size.width, size.height);
          if (angle !== null) gradient["angle"] = angle;
        }
        f["gradient"] = gradient;
      }
    } else if (fill.type === "IMAGE") {
      f["isImage"] = true;
      const imgFill = fill as ImagePaint;
      // imageRef is the legacy key (consumed by figma-to-jsx); imageHash is the
      // Figma API name and is what set_image_fill round-trips on.
      extractImagePaintFields(imgFill, f);
    }
    result.push(f);
  }
  return result;
}

// Extract simplified strokes — same contract as extractFills.
export function extractStrokes(node: SceneNode): Record<string, unknown>[] | undefined {
  if (!("strokes" in node)) return undefined;
  const raw = (node as GeometryMixin).strokes;
  if ((raw as unknown) === figma.mixed) return [{ type: "MIXED" }];
  if (!Array.isArray(raw)) return undefined;

  const result: Record<string, unknown>[] = [];
  for (const stroke of raw as Paint[]) {
    const s: Record<string, unknown> = { type: stroke.type };
    if (stroke.visible === false) s["visible"] = false;
    if (stroke.opacity !== undefined && stroke.opacity !== 1) s["opacity"] = stroke.opacity;
    if (stroke.blendMode && stroke.blendMode !== "NORMAL" && stroke.blendMode !== "PASS_THROUGH") {
      s["blendMode"] = stroke.blendMode;
    }
    if (stroke.type === "SOLID" && stroke.color) {
      s["color"] = colorToHex(stroke.color as RGBA);
    } else if (stroke.type === "IMAGE") {
      s["isImage"] = true;
      const imgStroke = stroke as ImagePaint;
      extractImagePaintFields(imgStroke, s);
    }
    result.push(s);
  }
  // Empty stroke lists are omitted (unlike fills) to keep JSON reads terse.
  return result.length > 0 ? result : undefined;
}

/**
 * Extract a PAGE's canvas `backgrounds` using the same shape as `extractFills`.
 * Pages have no `fills`, so this is the only paint information they can report.
 */
export function extractBackgrounds(node: SceneNode): Record<string, unknown>[] | undefined {
  const bg = (node as unknown as Record<string, unknown>)["backgrounds"];
  if (!Array.isArray(bg)) return undefined;
  // Reuse the fill serializer by presenting the backgrounds as a fills-bearing node.
  return extractFills({ fills: bg } as unknown as SceneNode);
}

// Extract simplified effects — same contract as extractFills.
export function extractEffects(node: SceneNode): Record<string, unknown>[] | undefined {
  if (!("effects" in node) || !Array.isArray((node as BlendMixin).effects)) {
    return undefined;
  }

  const result: Record<string, unknown>[] = [];
  for (const effect of (node as BlendMixin).effects as Effect[]) {
    const e: Record<string, unknown> = { type: effect.type };
    if (effect.visible === false) e["visible"] = false;
    const shadowEffect = effect as DropShadowEffect;
    const blurEffect = effect as BlurEffectBase;
    if (shadowEffect.color) e["color"] = colorToHex(shadowEffect.color);
    if (shadowEffect.offset) e["offset"] = { x: shadowEffect.offset.x, y: shadowEffect.offset.y };
    if (blurEffect.radius !== undefined) e["radius"] = blurEffect.radius;
    if (shadowEffect.spread !== undefined) e["spread"] = shadowEffect.spread;
    if (shadowEffect.blendMode && shadowEffect.blendMode !== "NORMAL") e["blendMode"] = shadowEffect.blendMode;
    result.push(e);
  }
  // Empty effect lists are omitted (unlike fills) to keep JSON reads terse.
  return result.length > 0 ? result : undefined;
}

// Map font style string to numeric weight
function getFontWeight(style: string): number {
  const s = style.toLowerCase();
  if (s.includes("thin") || s.includes("hairline")) return 100;
  if (s.includes("extralight") || s.includes("ultra light") || s.includes("extra light")) return 200;
  if (s.includes("light")) return 300;
  if (s.includes("medium")) return 500;
  if (s.includes("semibold") || s.includes("semi bold") || s.includes("demibold") || s.includes("demi bold"))
    return 600;
  if (s.includes("extrabold") || s.includes("extra bold") || s.includes("ultra bold")) return 800;
  if (s.includes("black") || s.includes("heavy")) return 900;
  if (s.includes("bold")) return 700;
  return 400;
}

interface LookupMaps {
  variableMap: Map<string, string>;
  textStyleMap: Map<string, string>;
  effectStyleMap: Map<string, string>;
}

// Main recursive node processor
async function processNode(
  node: SceneNode,
  currentDepth: number,
  maxDepth: number | undefined,
  maps: LookupMaps,
): Promise<Record<string, unknown> | null> {
  // Hidden descendants are skipped; a hidden node requested directly is still reported (visible: false).
  if (node.visible === false && currentDepth > 0) return null;

  const info: Record<string, unknown> = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
  };

  // Position and size
  if ("width" in node) info["width"] = (node as LayoutMixin).width;
  if ("height" in node) info["height"] = (node as LayoutMixin).height;
  if ("x" in node) info["x"] = (node as LayoutMixin).x;
  if ("y" in node) info["y"] = (node as LayoutMixin).y;
  if ("absoluteBoundingBox" in node) {
    const bbox = (node as any).absoluteBoundingBox;
    if (bbox) info["absoluteBoundingBox"] = { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
  }

  // Layout properties
  if ("layoutMode" in node) {
    // Emit "NONE" explicitly so consumers can distinguish non-auto-layout from not-serialized.
    info["layoutMode"] = (node as FrameNode).layoutMode;
  }
  if ("layoutSizingHorizontal" in node) info["layoutSizingHorizontal"] = (node as FrameNode).layoutSizingHorizontal;
  if ("layoutSizingVertical" in node) info["layoutSizingVertical"] = (node as FrameNode).layoutSizingVertical;
  if ("primaryAxisAlignItems" in node) info["primaryAxisAlignItems"] = (node as FrameNode).primaryAxisAlignItems;
  if ("counterAxisAlignItems" in node) info["counterAxisAlignItems"] = (node as FrameNode).counterAxisAlignItems;
  // Still emitted for GRID frames (where it is stale) so consumers keep a complete
  // picture — read gridRowGap/gridColumnGap below instead when layoutMode is GRID.
  if ("itemSpacing" in node && (node as FrameNode).itemSpacing !== undefined)
    info["itemSpacing"] = (node as FrameNode).itemSpacing;
  if ("counterAxisSpacing" in node && (node as FrameNode).counterAxisSpacing !== undefined)
    info["counterAxisSpacing"] = (node as FrameNode).counterAxisSpacing;
  // Grid auto-layout keeps itemSpacing at a stale value; the real gaps live here.
  if ((node as FrameNode).layoutMode === "GRID") {
    const grid = node as FrameNode & {
      gridRowGap?: number;
      gridColumnGap?: number;
      gridRowCount?: number;
      gridColumnCount?: number;
    };
    if (grid.gridRowGap !== undefined) info["gridRowGap"] = grid.gridRowGap;
    if (grid.gridColumnGap !== undefined) info["gridColumnGap"] = grid.gridColumnGap;
    if (grid.gridRowCount !== undefined) info["gridRowCount"] = grid.gridRowCount;
    if (grid.gridColumnCount !== undefined) info["gridColumnCount"] = grid.gridColumnCount;
    const trackSizes = function (tracks: ReadonlyArray<GridTrackSize> | undefined) {
      return Array.isArray(tracks)
        ? tracks.map(function (t) {
            return t.type === "HUG" || t.value === undefined ? { type: t.type } : { type: t.type, value: t.value };
          })
        : undefined;
    };
    const rowSizes = trackSizes(grid.gridRowSizes);
    const columnSizes = trackSizes(grid.gridColumnSizes);
    if (rowSizes) info["gridRowSizes"] = rowSizes;
    if (columnSizes) info["gridColumnSizes"] = columnSizes;
  }
  // Cell placement for direct children of a GRID frame (absolute children have no cell).
  const gridParent = node.parent as (BaseNode & { layoutMode?: string }) | null;
  if (
    gridParent &&
    gridParent.layoutMode === "GRID" &&
    (node as SceneNode & { layoutPositioning?: string }).layoutPositioning !== "ABSOLUTE" &&
    typeof (node as LayoutMixin).gridRowAnchorIndex === "number"
  ) {
    const cell = node as LayoutMixin;
    info["gridRowAnchorIndex"] = cell.gridRowAnchorIndex;
    info["gridColumnAnchorIndex"] = cell.gridColumnAnchorIndex;
    info["gridRowSpan"] = cell.gridRowSpan;
    info["gridColumnSpan"] = cell.gridColumnSpan;
    info["gridChildHorizontalAlign"] = cell.gridChildHorizontalAlign;
    info["gridChildVerticalAlign"] = cell.gridChildVerticalAlign;
  }
  if ("layoutWrap" in node) info["layoutWrap"] = (node as FrameNode).layoutWrap;
  if ("paddingTop" in node) info["paddingTop"] = (node as FrameNode).paddingTop;
  if ("paddingRight" in node) info["paddingRight"] = (node as FrameNode).paddingRight;
  if ("paddingBottom" in node) info["paddingBottom"] = (node as FrameNode).paddingBottom;
  if ("paddingLeft" in node) info["paddingLeft"] = (node as FrameNode).paddingLeft;
  if ("clipsContent" in node) info["clipsContent"] = (node as FrameNode).clipsContent;
  if ("layoutPositioning" in node) info["layoutPositioning"] = (node as FrameNode).layoutPositioning;
  if ("layoutAlign" in node) {
    const la = (node as SceneNode & { layoutAlign: string }).layoutAlign;
    if (la && la !== "INHERIT" && la !== "STRETCH") info["layoutAlign"] = la;
  }
  if ("constraints" in node) {
    const c = (node as SceneNode & ConstraintMixin).constraints;
    if (c) info["constraints"] = { horizontal: c.horizontal, vertical: c.vertical };
  }

  // Fills — always emitted when the node supports fills, including as an empty
  // array, so "no fill" is distinguishable from "not serialized".
  const fills = extractFills(node);
  if (fills !== undefined) info["fills"] = fills;

  // Pages carry their canvas colour on `backgrounds`, not `fills` — without this a PAGE
  // serializes with no paint information at all and renders as an empty shell.
  const backgrounds = extractBackgrounds(node);
  if (backgrounds !== undefined) info["backgrounds"] = backgrounds;

  // Strokes
  const strokes = extractStrokes(node);
  if (strokes !== undefined) info["strokes"] = strokes;
  if ("strokeWeight" in node && (node as GeometryMixin).strokeWeight !== figma.mixed) {
    const sw = (node as GeometryMixin).strokeWeight;
    if (typeof sw === "number" && sw > 0) info["strokeWeight"] = sw;
  }

  // Corner radius
  if ("cornerRadius" in node) {
    const radiusNode = node as CornerMixin;
    if (radiusNode.cornerRadius !== figma.mixed) {
      if (radiusNode.cornerRadius > 0) info["cornerRadius"] = radiusNode.cornerRadius;
    } else {
      const rectNode = node as RectangleCornerMixin;
      if (rectNode.topLeftRadius > 0) info["topLeftRadius"] = rectNode.topLeftRadius;
      if (rectNode.topRightRadius > 0) info["topRightRadius"] = rectNode.topRightRadius;
      if (rectNode.bottomRightRadius > 0) info["bottomRightRadius"] = rectNode.bottomRightRadius;
      if (rectNode.bottomLeftRadius > 0) info["bottomLeftRadius"] = rectNode.bottomLeftRadius;
    }
  }

  // Effects
  const effects = extractEffects(node);
  if (effects !== undefined) info["effects"] = effects;

  // Resolve effect style
  const blendNode = node as unknown as Record<string, unknown>;
  if (blendNode["effectStyleId"] && blendNode["effectStyleId"] !== "" && blendNode["effectStyleId"] !== figma.mixed) {
    info["effectStyleId"] = blendNode["effectStyleId"];
    const esName = maps.effectStyleMap.get(blendNode["effectStyleId"] as string);
    if (esName) info["effectStyleName"] = esName;
  }

  // Text properties
  if (node.type === "TEXT") {
    const textNode = node as TextNode;
    info["characters"] = textNode.characters;

    if (textNode.fontName !== figma.mixed) {
      info["fontFamily"] = (textNode.fontName as FontName).family;
      info["fontWeight"] = getFontWeight((textNode.fontName as FontName).style);
    }
    if (textNode.fontSize !== figma.mixed) info["fontSize"] = textNode.fontSize;
    if (textNode.lineHeight !== figma.mixed && (textNode.lineHeight as LineHeight).unit !== "AUTO") {
      const lh = textNode.lineHeight as { readonly value: number; readonly unit: "PIXELS" | "PERCENT" };
      info["lineHeight"] = lh.value;
      if (lh.unit === "PERCENT") info["lineHeightUnit"] = "percent";
    }
    if (textNode.letterSpacing !== figma.mixed && (textNode.letterSpacing as LetterSpacing).value !== 0) {
      info["letterSpacing"] = (textNode.letterSpacing as LetterSpacing).value;
      if ((textNode.letterSpacing as LetterSpacing).unit === "PERCENT") info["letterSpacingUnit"] = "percent";
    }
    if (textNode.textAlignHorizontal) info["textAlignHorizontal"] = textNode.textAlignHorizontal;
    if (textNode.textAlignVertical) info["textAlignVertical"] = textNode.textAlignVertical;
    if (textNode.textCase !== figma.mixed && textNode.textCase !== "ORIGINAL") {
      info["textCase"] = textNode.textCase;
    }
    if (textNode.textDecoration !== figma.mixed && textNode.textDecoration !== "NONE") {
      info["textDecoration"] = textNode.textDecoration;
    }
    // Wrapping behaviour: WIDTH_AND_HEIGHT = single line, HEIGHT = wraps at fixed width, NONE = fixed box.
    if (textNode.textAutoResize) info["textAutoResize"] = textNode.textAutoResize;
    if (textNode.textTruncation) info["textTruncation"] = textNode.textTruncation;
    if (typeof textNode.maxLines === "number") info["maxLines"] = textNode.maxLines;

    // Resolve text style
    if (textNode.textStyleId && textNode.textStyleId !== "" && textNode.textStyleId !== figma.mixed) {
      info["textStyleId"] = textNode.textStyleId;
      const styleName = maps.textStyleMap.get(textNode.textStyleId as string);
      if (styleName) info["textStyleName"] = styleName;
    }
  }

  // Appearance
  if ("opacity" in node && (node as BlendMixin).opacity !== undefined && (node as BlendMixin).opacity !== 1) {
    info["opacity"] = (node as BlendMixin).opacity;
  }
  if ("rotation" in node && (node as LayoutMixin).rotation !== 0) {
    info["rotation"] = (node as LayoutMixin).rotation;
  }

  // Variable bindings
  const bindings = resolveBindings(node, maps.variableMap);
  if (Object.keys(bindings).length > 0) info["bindings"] = bindings;

  // Component/instance metadata
  if (node.type === "COMPONENT_SET") {
    try {
      const csNode = node as ComponentSetNode;
      if (csNode.componentPropertyDefinitions) {
        const defs: Record<string, unknown> = {};
        for (const key in csNode.componentPropertyDefinitions) {
          if (!Object.prototype.hasOwnProperty.call(csNode.componentPropertyDefinitions, key)) continue;
          const def = csNode.componentPropertyDefinitions[key];
          // Strip #ID suffix from keys (e.g. "Size#123:0" -> "Size")
          const cleanKey = key.replace(/#[\d:]+$/, "");
          if (def.type === "VARIANT") {
            defs[cleanKey] = {
              type: "VARIANT",
              options: def.variantOptions !== null && def.variantOptions !== undefined ? def.variantOptions : [],
            };
          } else if (def.type === "BOOLEAN") {
            defs[cleanKey] = { type: "BOOLEAN", default: def.defaultValue };
          } else if (def.type === "TEXT") {
            defs[cleanKey] = { type: "TEXT", default: def.defaultValue };
          } else if (def.type === "INSTANCE_SWAP") {
            defs[cleanKey] = { type: "INSTANCE_SWAP" };
          } else if ((def.type as string) === "SLOT") {
            defs[cleanKey] = { type: "SLOT", slotSettings: def.slotSettings };
          }
        }
        if (Object.keys(defs).length > 0) info["componentPropertyDefinitions"] = defs;
      }
    } catch (_e) {
      // Component set may have existing errors — skip property extraction
    }
  } else if (node.type === "COMPONENT") {
    const compNode = node as ComponentNode;
    if (compNode.parent && compNode.parent.type === "COMPONENT_SET") {
      info["componentSetName"] = compNode.parent.name;
      const variantProps: Record<string, string> = {};
      const parts = compNode.name.split(",");
      for (const part of parts) {
        const eqIdx = part.indexOf("=");
        if (eqIdx !== -1) {
          const k = part.substring(0, eqIdx).trim();
          const v = part.substring(eqIdx + 1).trim();
          if (k) variantProps[k] = v;
        }
      }
      if (Object.keys(variantProps).length > 0) info["variantProperties"] = variantProps;
    }
  } else if (node.type === "INSTANCE") {
    const instanceNode = node as InstanceNode;
    try {
      if (instanceNode.componentProperties) {
        const props: Record<string, unknown> = {};
        for (const key in instanceNode.componentProperties) {
          if (!Object.prototype.hasOwnProperty.call(instanceNode.componentProperties, key)) continue;
          const prop = instanceNode.componentProperties[key];
          const cleanKey = key.replace(/#[\d:]+$/, "");
          props[cleanKey] = { type: prop.type, value: prop.value };
        }
        if (Object.keys(props).length > 0) info["componentProperties"] = props;
      }
    } catch (_e) {
      // Component set may have existing errors — skip property extraction
    }
    // Resolve main component
    try {
      const mainComp = await instanceNode.getMainComponentAsync();
      if (mainComp) {
        info["mainComponentId"] = mainComp.id;
        if (mainComp.parent && mainComp.parent.type === "COMPONENT_SET") {
          info["mainComponentName"] = mainComp.parent.name;
        } else {
          info["mainComponentName"] = mainComp.name;
        }
      }
    } catch (_e) {
      // Main component may not be available (e.g. external library)
    }
  }

  if (node.type === "SLOT") {
    const slotNode = node as SlotNode;
    const refs = slotNode.componentPropertyReferences as Record<string, string> | null;
    const refValues = refs ? Object.values(refs) : [];
    if (refValues.length > 0) info["slotProperty"] = refValues[0];
    try {
      if (slotNode.limitViolations.length > 0) info["limitViolations"] = slotNode.limitViolations.slice();
    } catch (_e) {
      // limitViolations is only meaningful inside a component or instance
    }
  }

  // Children (respect depth limit)
  if ("children" in node && (node as ChildrenMixin).children.length > 0) {
    if (maxDepth === undefined || currentDepth < maxDepth) {
      const childResults = await Promise.all(
        (node as ChildrenMixin).children.map(function (child) {
          return processNode(child as SceneNode, currentDepth + 1, maxDepth, maps).catch(function () {
            return null;
          });
        }),
      );
      const childInfos = childResults.filter(function (c): c is Record<string, unknown> {
        return c !== null;
      });
      if (childInfos.length > 0) info["children"] = childInfos;
      // Always report the true count — expanded children can be fewer (hidden/failed).
      info["_childCount"] = (node as ChildrenMixin).children.length;
    } else {
      info["_childCount"] = (node as ChildrenMixin).children.filter(function (c) {
        return (c as SceneNode).visible !== false;
      }).length;
    }
  }

  // Interactions and motion are otherwise invisible to a read — an agent had to
  // already suspect they existed and call get_reactions / get_motion_info.
  // These two cheap flags make them discoverable from get_node_info.
  if ("reactions" in node) {
    const reactions = (node as unknown as { reactions?: unknown[] }).reactions;
    if (Array.isArray(reactions) && reactions.length > 0) {
      info["_reactionCount"] = reactions.length;
    }
  }
  if (nodeHasMotion(node)) {
    info["_hasMotion"] = true;
  }

  return info;
}

/**
 * Whether a node carries any Motion data.
 *
 * Guarded because Motion is a Beta API: on an editor without it these
 * properties simply do not exist, and reading them must not throw.
 */
function nodeHasMotion(node: BaseNode): boolean {
  try {
    const motionNode = node as unknown as {
      animationStyles?: unknown[];
      manualKeyframeTracks?: Record<string, unknown>;
    };
    if (Array.isArray(motionNode.animationStyles) && motionNode.animationStyles.length > 0) return true;
    const tracks = motionNode.manualKeyframeTracks;
    return typeof tracks === "object" && tracks !== null && Object.keys(tracks).length > 0;
  } catch {
    return false;
  }
}

/**
 * Serialize Figma nodes into enriched FigmaNodeData format.
 * Accepts nodeIds (specific nodes) or falls back to current selection.
 */
export async function serializeNodes(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeIds = params !== null && params !== undefined ? (params["nodeIds"] as string[] | undefined) : undefined;
  const nodeId = params !== null && params !== undefined ? (params["nodeId"] as string | undefined) : undefined;
  const depth = params !== null && params !== undefined ? (params["depth"] as number | undefined) : undefined;

  const maps = await buildLookupMaps();

  // Determine which nodes to process
  let nodesToProcess: SceneNode[];

  if (nodeIds && Array.isArray(nodeIds) && nodeIds.length > 0) {
    nodesToProcess = [];
    for (const id of nodeIds) {
      const node = await figma.getNodeByIdAsync(id);
      if (node) nodesToProcess.push(node as SceneNode);
    }
    if (nodesToProcess.length === 0) throw new Error("None of the provided node IDs were found");
  } else if (nodeId) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) throw new Error("Node with ID " + nodeId + " not found");
    nodesToProcess = [node as SceneNode];
  } else {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      throw new Error("No nodes selected. Please select nodes in Figma first.");
    }
    nodesToProcess = selection as SceneNode[];
  }

  const processed = await Promise.all(
    nodesToProcess.map(function (node) {
      return processNode(node, 0, depth, maps);
    }),
  );
  const result = processed.filter(function (n) {
    return n !== null;
  }) as Record<string, unknown>[];

  return {
    count: result.length,
    nodes: result,
  };
}
