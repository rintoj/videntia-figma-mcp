// ---------------------------------------------------------------------------
// Node Serializer — serialize Figma nodes to enriched FigmaNodeData format
// ---------------------------------------------------------------------------

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
    figma.variables.getLocalVariablesAsync().catch(function () { return null; }),
    figma.getLocalTextStylesAsync().catch(function () { return null; }),
    figma.getLocalEffectStylesAsync().catch(function () { return null; }),
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
    return 'rgba(' + r + ',' + g + ',' + b + ',' + parseFloat(color.a.toFixed(2)) + ')';
  }
  return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
}

// Resolve bound variables for a node
function resolveBindings(node: SceneNode, variableMap: Map<string, string>): Record<string, string> {
  const bindings: Record<string, string> = {};
  if (!('boundVariables' in node) || !(node as unknown as Record<string, unknown>)['boundVariables']) {
    return bindings;
  }

  const bv = (node as unknown as Record<string, unknown>)['boundVariables'] as Record<string, unknown>;
  for (const field in bv) {
    if (!Object.prototype.hasOwnProperty.call(bv, field)) continue;
    const binding = bv[field];
    if (!binding) continue;
    if (Array.isArray(binding)) {
      for (let i = 0; i < binding.length; i++) {
        const b = binding[i] as Record<string, string>;
        if (b && b['id']) {
          const name = variableMap.get(b['id']);
          if (name) bindings[field + '/' + i] = name;
        }
      }
    } else {
      const bindingObj = binding as Record<string, string>;
      if (bindingObj['id']) {
        const name = variableMap.get(bindingObj['id']);
        if (name) bindings[field] = name;
      }
    }
  }
  return bindings;
}

// Extract simplified fills
function extractFills(node: SceneNode): Record<string, unknown>[] | undefined {
  if (!('fills' in node) || (node as GeometryMixin).fills === figma.mixed) return undefined;
  const fills = (node as GeometryMixin).fills as Paint[];
  if (!Array.isArray(fills) || fills.length === 0) return undefined;

  const result: Record<string, unknown>[] = [];
  for (const fill of fills) {
    if (fill.visible === false) continue;
    const f: Record<string, unknown> = { type: fill.type };
    if (fill.type === 'SOLID' && fill.color) {
      f['color'] = colorToHex(fill.color as RGBA);
      if (fill.opacity !== undefined && fill.opacity !== 1) f['opacity'] = fill.opacity;
    } else if (
      fill.type === 'GRADIENT_LINEAR' ||
      fill.type === 'GRADIENT_RADIAL' ||
      fill.type === 'GRADIENT_ANGULAR' ||
      fill.type === 'GRADIENT_DIAMOND'
    ) {
      const gradFill = fill as GradientPaint;
      if (gradFill.gradientStops) {
        f['gradient'] = {
          type: fill.type,
          stops: gradFill.gradientStops.map(function (s) {
            return {
              color: colorToHex(s.color),
              position: s.position,
            };
          }),
        };
      }
    } else if (fill.type === 'IMAGE') {
      f['isImage'] = true;
      const imgFill = fill as ImagePaint;
      if (imgFill.imageHash) f['imageRef'] = imgFill.imageHash;
    }
    result.push(f);
  }
  return result.length > 0 ? result : undefined;
}

// Extract simplified strokes
function extractStrokes(node: SceneNode): Record<string, unknown>[] | undefined {
  if (!('strokes' in node) || !Array.isArray((node as GeometryMixin).strokes) || (node as GeometryMixin).strokes.length === 0) {
    return undefined;
  }

  const result: Record<string, unknown>[] = [];
  for (const stroke of (node as GeometryMixin).strokes as Paint[]) {
    if (stroke.visible === false) continue;
    const s: Record<string, unknown> = { type: stroke.type };
    if (stroke.type === 'SOLID' && stroke.color) {
      s['color'] = colorToHex(stroke.color as RGBA);
      if (stroke.opacity !== undefined && stroke.opacity !== 1) s['opacity'] = stroke.opacity;
    }
    result.push(s);
  }
  return result.length > 0 ? result : undefined;
}

// Extract simplified effects
function extractEffects(node: SceneNode): Record<string, unknown>[] | undefined {
  if (!('effects' in node) || !Array.isArray((node as BlendMixin).effects) || (node as BlendMixin).effects.length === 0) {
    return undefined;
  }

  const result: Record<string, unknown>[] = [];
  for (const effect of (node as BlendMixin).effects as Effect[]) {
    if (effect.visible === false) continue;
    const e: Record<string, unknown> = { type: effect.type };
    const shadowEffect = effect as DropShadowEffect;
    const blurEffect = effect as BlurEffectBase;
    if (shadowEffect.color) e['color'] = colorToHex(shadowEffect.color);
    if (shadowEffect.offset) e['offset'] = { x: shadowEffect.offset.x, y: shadowEffect.offset.y };
    if (blurEffect.radius !== undefined) e['radius'] = blurEffect.radius;
    if (shadowEffect.spread !== undefined) e['spread'] = shadowEffect.spread;
    result.push(e);
  }
  return result.length > 0 ? result : undefined;
}

// Map font style string to numeric weight
function getFontWeight(style: string): number {
  const s = style.toLowerCase();
  if (s.includes('thin') || s.includes('hairline')) return 100;
  if (s.includes('extralight') || s.includes('ultra light') || s.includes('extra light')) return 200;
  if (s.includes('light')) return 300;
  if (s.includes('medium')) return 500;
  if (s.includes('semibold') || s.includes('semi bold') || s.includes('demibold') || s.includes('demi bold')) return 600;
  if (s.includes('extrabold') || s.includes('extra bold') || s.includes('ultra bold')) return 800;
  if (s.includes('black') || s.includes('heavy')) return 900;
  if (s.includes('bold')) return 700;
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
  if (node.visible === false) return null;

  const info: Record<string, unknown> = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
  };

  // Position and size
  if ('width' in node) info['width'] = (node as LayoutMixin).width;
  if ('height' in node) info['height'] = (node as LayoutMixin).height;
  if ('x' in node) info['x'] = (node as LayoutMixin).x;
  if ('y' in node) info['y'] = (node as LayoutMixin).y;

  // Layout properties
  if ('layoutMode' in node && (node as FrameNode).layoutMode) {
    info['layoutMode'] = (node as FrameNode).layoutMode;
  }
  if ('layoutSizingHorizontal' in node) info['layoutSizingHorizontal'] = (node as FrameNode).layoutSizingHorizontal;
  if ('layoutSizingVertical' in node) info['layoutSizingVertical'] = (node as FrameNode).layoutSizingVertical;
  if ('primaryAxisAlignItems' in node) info['primaryAxisAlignItems'] = (node as FrameNode).primaryAxisAlignItems;
  if ('counterAxisAlignItems' in node) info['counterAxisAlignItems'] = (node as FrameNode).counterAxisAlignItems;
  if ('itemSpacing' in node && (node as FrameNode).itemSpacing !== undefined) info['itemSpacing'] = (node as FrameNode).itemSpacing;
  if ('counterAxisSpacing' in node && (node as FrameNode).counterAxisSpacing !== undefined) info['counterAxisSpacing'] = (node as FrameNode).counterAxisSpacing;
  if ('layoutWrap' in node) info['layoutWrap'] = (node as FrameNode).layoutWrap;
  if ('paddingTop' in node) info['paddingTop'] = (node as FrameNode).paddingTop;
  if ('paddingRight' in node) info['paddingRight'] = (node as FrameNode).paddingRight;
  if ('paddingBottom' in node) info['paddingBottom'] = (node as FrameNode).paddingBottom;
  if ('paddingLeft' in node) info['paddingLeft'] = (node as FrameNode).paddingLeft;
  if ('clipsContent' in node) info['clipsContent'] = (node as FrameNode).clipsContent;
  if ('layoutPositioning' in node) info['layoutPositioning'] = (node as FrameNode).layoutPositioning;

  // Fills
  const fills = extractFills(node);
  if (fills) info['fills'] = fills;

  // Strokes
  const strokes = extractStrokes(node);
  if (strokes) info['strokes'] = strokes;
  if ('strokeWeight' in node && 'strokes' in node && (node as GeometryMixin).strokes.length > 0 && (node as GeometryMixin).strokeWeight !== figma.mixed) {
    info['strokeWeight'] = (node as GeometryMixin).strokeWeight;
  }

  // Corner radius
  if ('cornerRadius' in node) {
    const radiusNode = node as CornerMixin;
    if (radiusNode.cornerRadius !== figma.mixed) {
      if (radiusNode.cornerRadius > 0) info['cornerRadius'] = radiusNode.cornerRadius;
    } else {
      const rectNode = node as RectangleCornerMixin;
      if (rectNode.topLeftRadius > 0) info['topLeftRadius'] = rectNode.topLeftRadius;
      if (rectNode.topRightRadius > 0) info['topRightRadius'] = rectNode.topRightRadius;
      if (rectNode.bottomRightRadius > 0) info['bottomRightRadius'] = rectNode.bottomRightRadius;
      if (rectNode.bottomLeftRadius > 0) info['bottomLeftRadius'] = rectNode.bottomLeftRadius;
    }
  }

  // Effects
  const effects = extractEffects(node);
  if (effects) info['effects'] = effects;

  // Resolve effect style name
  const blendNode = node as unknown as Record<string, unknown>;
  if (blendNode['effectStyleId'] && blendNode['effectStyleId'] !== '' && blendNode['effectStyleId'] !== figma.mixed) {
    const esName = maps.effectStyleMap.get(blendNode['effectStyleId'] as string);
    if (esName) info['effectStyleName'] = esName;
  }

  // Text properties
  if (node.type === 'TEXT') {
    const textNode = node as TextNode;
    info['characters'] = textNode.characters;

    if (textNode.fontName !== figma.mixed) {
      info['fontFamily'] = (textNode.fontName as FontName).family;
      info['fontWeight'] = getFontWeight((textNode.fontName as FontName).style);
    }
    if (textNode.fontSize !== figma.mixed) info['fontSize'] = textNode.fontSize;
    if (textNode.lineHeight !== figma.mixed && (textNode.lineHeight as LineHeight).unit !== 'AUTO') {
      const lh = textNode.lineHeight as { readonly value: number; readonly unit: 'PIXELS' | 'PERCENT' };
      info['lineHeight'] = lh.value;
      if (lh.unit === 'PERCENT') info['lineHeightUnit'] = 'percent';
    }
    if (textNode.letterSpacing !== figma.mixed && (textNode.letterSpacing as LetterSpacing).value !== 0) {
      info['letterSpacing'] = (textNode.letterSpacing as LetterSpacing).value;
      if ((textNode.letterSpacing as LetterSpacing).unit === 'PERCENT') info['letterSpacingUnit'] = 'percent';
    }
    if (textNode.textAlignHorizontal) info['textAlignHorizontal'] = textNode.textAlignHorizontal;
    if (textNode.textCase !== figma.mixed && textNode.textCase !== 'ORIGINAL') {
      info['textCase'] = textNode.textCase;
    }
    if (textNode.textDecoration !== figma.mixed && textNode.textDecoration !== 'NONE') {
      info['textDecoration'] = textNode.textDecoration;
    }

    // Resolve text style name
    if (textNode.textStyleId && textNode.textStyleId !== '' && textNode.textStyleId !== figma.mixed) {
      const styleName = maps.textStyleMap.get(textNode.textStyleId as string);
      if (styleName) info['textStyleName'] = styleName;
    }
  }

  // Appearance
  if ('opacity' in node && (node as BlendMixin).opacity !== undefined && (node as BlendMixin).opacity !== 1) {
    info['opacity'] = (node as BlendMixin).opacity;
  }
  if ('rotation' in node && (node as LayoutMixin).rotation !== 0) {
    info['rotation'] = (node as LayoutMixin).rotation;
  }

  // Variable bindings
  const bindings = resolveBindings(node, maps.variableMap);
  if (Object.keys(bindings).length > 0) info['bindings'] = bindings;

  // Component/instance metadata
  if (node.type === 'COMPONENT_SET') {
    const csNode = node as ComponentSetNode;
    if (csNode.componentPropertyDefinitions) {
      const defs: Record<string, unknown> = {};
      for (const key in csNode.componentPropertyDefinitions) {
        if (!Object.prototype.hasOwnProperty.call(csNode.componentPropertyDefinitions, key)) continue;
        const def = csNode.componentPropertyDefinitions[key];
        // Strip #ID suffix from keys (e.g. "Size#123:0" -> "Size")
        const cleanKey = key.replace(/#[\d:]+$/, '');
        if (def.type === 'VARIANT') {
          defs[cleanKey] = { type: 'VARIANT', options: (def.variantOptions !== null && def.variantOptions !== undefined) ? def.variantOptions : [] };
        } else if (def.type === 'BOOLEAN') {
          defs[cleanKey] = { type: 'BOOLEAN', default: def.defaultValue };
        } else if (def.type === 'TEXT') {
          defs[cleanKey] = { type: 'TEXT', default: def.defaultValue };
        } else if (def.type === 'INSTANCE_SWAP') {
          defs[cleanKey] = { type: 'INSTANCE_SWAP' };
        }
      }
      if (Object.keys(defs).length > 0) info['componentPropertyDefinitions'] = defs;
    }
  } else if (node.type === 'COMPONENT') {
    const compNode = node as ComponentNode;
    if (compNode.parent && compNode.parent.type === 'COMPONENT_SET') {
      info['componentSetName'] = compNode.parent.name;
      const variantProps: Record<string, string> = {};
      const parts = compNode.name.split(',');
      for (const part of parts) {
        const eqIdx = part.indexOf('=');
        if (eqIdx !== -1) {
          const k = part.substring(0, eqIdx).trim();
          const v = part.substring(eqIdx + 1).trim();
          if (k) variantProps[k] = v;
        }
      }
      if (Object.keys(variantProps).length > 0) info['variantProperties'] = variantProps;
    }
  } else if (node.type === 'INSTANCE') {
    const instanceNode = node as InstanceNode;
    if (instanceNode.componentProperties) {
      const props: Record<string, unknown> = {};
      for (const key in instanceNode.componentProperties) {
        if (!Object.prototype.hasOwnProperty.call(instanceNode.componentProperties, key)) continue;
        const prop = instanceNode.componentProperties[key];
        const cleanKey = key.replace(/#[\d:]+$/, '');
        props[cleanKey] = { type: prop.type, value: prop.value };
      }
      if (Object.keys(props).length > 0) info['componentProperties'] = props;
    }
    // Resolve main component name
    try {
      const mainComp = await instanceNode.getMainComponentAsync();
      if (mainComp) {
        if (mainComp.parent && mainComp.parent.type === 'COMPONENT_SET') {
          info['mainComponentName'] = mainComp.parent.name;
        } else {
          info['mainComponentName'] = mainComp.name;
        }
      }
    } catch (_e) {
      // Main component may not be available (e.g. external library)
    }
  }

  // Children (respect depth limit)
  if ('children' in node && (node as ChildrenMixin).children.length > 0) {
    if (maxDepth === undefined || currentDepth < maxDepth) {
      const childResults = await Promise.all(
        (node as ChildrenMixin).children.map(function (child) {
          try {
            return processNode(child as SceneNode, currentDepth + 1, maxDepth, maps);
          } catch (_e) {
            return Promise.resolve(null);
          }
        }),
      );
      const childInfos = childResults.filter(
        function (c): c is Record<string, unknown> { return c !== null; },
      );
      if (childInfos.length > 0) info['children'] = childInfos;
    } else {
      info['_childCount'] = (node as ChildrenMixin).children.length;
    }
  }

  return info;
}

/**
 * Serialize Figma nodes into enriched FigmaNodeData format.
 * Accepts nodeIds (specific nodes) or falls back to current selection.
 */
export async function serializeNodes(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeIds = (params !== null && params !== undefined) ? (params['nodeIds'] as string[] | undefined) : undefined;
  const nodeId = (params !== null && params !== undefined) ? (params['nodeId'] as string | undefined) : undefined;
  const depth = (params !== null && params !== undefined) ? (params['depth'] as number | undefined) : undefined;

  const maps = await buildLookupMaps();

  // Determine which nodes to process
  let nodesToProcess: SceneNode[];

  if (nodeIds && Array.isArray(nodeIds) && nodeIds.length > 0) {
    nodesToProcess = [];
    for (const id of nodeIds) {
      const node = await figma.getNodeByIdAsync(id);
      if (node) nodesToProcess.push(node as SceneNode);
    }
    if (nodesToProcess.length === 0) throw new Error('None of the provided node IDs were found');
  } else if (nodeId) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) throw new Error('Node with ID ' + nodeId + ' not found');
    nodesToProcess = [node as SceneNode];
  } else {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      throw new Error('No nodes selected. Please select nodes in Figma first.');
    }
    nodesToProcess = selection as SceneNode[];
  }

  const result: Record<string, unknown>[] = [];
  for (const node of nodesToProcess) {
    const processed = await processNode(node, 0, depth, maps);
    if (processed) result.push(processed);
  }

  return {
    selectionCount: nodesToProcess.length,
    selection: result,
  };
}
