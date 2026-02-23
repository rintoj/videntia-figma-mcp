// Design-system handler functions for the Claude Figma MCP plugin.

import { debugLog, sendProgressUpdate, getFontStyle } from '../utils/helpers';
import { parseSvgRootStroke, propagateStrokeToShapes } from '../utils/svg';

// ---------------------------------------------------------------------------
// Internal helpers (shared by createFromData / setupDesignSystem)
// ---------------------------------------------------------------------------

/** Expand 3-char hex shorthand to 6-char (e.g. "fff" → "ffffff"). */
function expandHex(hex: string): string {
  if (hex.length === 3) {
    return hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  return hex;
}

/** Parse a CSS color string to a Figma `{r,g,b}` object (0–1 range). */
function parseColor(colorStr: string | undefined): RGB {
  if (!colorStr) return { r: 0, g: 0, b: 0 };

  if (colorStr.indexOf('rgba') === 0) {
    const m = colorStr.match(
      /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/,
    );
    if (m) {
      return {
        r: parseInt(m[1]) / 255,
        g: parseInt(m[2]) / 255,
        b: parseInt(m[3]) / 255,
      };
    }
  }

  if (colorStr.indexOf('rgb') === 0) {
    const m = colorStr.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (m) {
      return {
        r: parseInt(m[1]) / 255,
        g: parseInt(m[2]) / 255,
        b: parseInt(m[3]) / 255,
      };
    }
  }

  const hex = expandHex(colorStr.replace('#', ''));
  return {
    r: parseInt(hex.substring(0, 2), 16) / 255,
    g: parseInt(hex.substring(2, 4), 16) / 255,
    b: parseInt(hex.substring(4, 6), 16) / 255,
  };
}

/** Parse alpha channel from an rgba string (returns 1 for non-rgba). */
function parseOpacity(colorStr: string | undefined): number {
  if (!colorStr) return 1;
  if (colorStr.indexOf('rgba') === 0) {
    const m = colorStr.match(
      /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/,
    );
    if (m) return parseFloat(m[4]);
  }
  return 1;
}

/** Build a Figma paint from a serialised fill descriptor. */
function buildFigmaPaint(fillData: Record<string, unknown>): Paint {
  const gradient = fillData['gradient'] as Record<string, unknown> | undefined;
  if (gradient) {
    const rawStops = (gradient['stops'] as Array<Record<string, unknown>>) || [];
    const stops: ColorStop[] = rawStops.map((s) => {
      const color = s['color'] as string | undefined;
      return {
        color: Object.assign(parseColor(color), { a: parseOpacity(color) }) as RGBA,
        position: s['position'] as number,
      };
    });
    return {
      type: gradient['type'] as GradientPaint['type'],
      gradientStops: stops,
      gradientTransform: [[1, 0, 0], [0, 1, 0]] as Transform,
      visible: true,
    } as GradientPaint;
  }

  if (fillData['isImage']) {
    const paint: Record<string, unknown> = {
      type: 'IMAGE',
      visible: true,
      scaleMode: 'FILL',
    };
    if (fillData['imageRef']) {
      paint['imageHash'] = fillData['imageRef'];
    }
    return paint as unknown as Paint;
  }

  const color = fillData['color'] as string | undefined;
  const solidPaint: Record<string, unknown> = {
    type: 'SOLID',
    color: parseColor(color),
    visible: true,
  };
  const opacity = fillData['opacity'] as number | undefined;
  if (opacity !== undefined && opacity < 1) {
    solidPaint['opacity'] = opacity;
  }
  return solidPaint as unknown as SolidPaint;
}

/** Build a Figma effect from a serialised effect descriptor. */
function buildFigmaEffect(effectData: Record<string, unknown>): Effect {
  const type = effectData['type'] as string;

  if (type === 'DROP_SHADOW' || type === 'INNER_SHADOW') {
    const colorStr = effectData['color'] as string | undefined;
    const color: RGBA = colorStr
      ? Object.assign(parseColor(colorStr), { a: parseOpacity(colorStr) }) as RGBA
      : { r: 0, g: 0, b: 0, a: 0.25 };
    const rawOffset = effectData['offset'] as Record<string, number> | undefined;
    return {
      type: type as 'DROP_SHADOW' | 'INNER_SHADOW',
      color,
      offset: rawOffset !== undefined
        ? { x: rawOffset['x'] !== undefined ? rawOffset['x'] : 0, y: rawOffset['y'] !== undefined ? rawOffset['y'] : 0 }
        : { x: 0, y: 0 },
      radius: effectData['radius'] !== undefined ? (effectData['radius'] as number) : 0,
      spread: effectData['spread'] !== undefined ? (effectData['spread'] as number) : 0,
      visible:
        effectData['visible'] !== undefined ? (effectData['visible'] as boolean) : true,
      blendMode:
        effectData['blendMode'] !== undefined
          ? (effectData['blendMode'] as BlendMode)
          : ('NORMAL' as BlendMode),
    } as DropShadowEffect | InnerShadowEffect;
  }

  if (type === 'LAYER_BLUR' || type === 'BACKGROUND_BLUR') {
    return {
      type: type as 'LAYER_BLUR' | 'BACKGROUND_BLUR',
      radius: effectData['radius'] !== undefined ? (effectData['radius'] as number) : 0,
      visible:
        effectData['visible'] !== undefined ? (effectData['visible'] as boolean) : true,
    } as BlurEffect;
  }

  // Fallback for other effect types
  const effect: Record<string, unknown> = { type, visible: true };
  if (effectData['radius'] !== undefined) effect['radius'] = effectData['radius'];
  if (effectData['offset']) {
    const off = effectData['offset'] as Record<string, number>;
    effect['offset'] = { x: off['x'], y: off['y'] };
  }
  if (effectData['spread'] !== undefined) effect['spread'] = effectData['spread'];
  if (effectData['color']) {
    const colorStr = effectData['color'] as string;
    effect['color'] = Object.assign(parseColor(colorStr), { a: parseOpacity(colorStr) });
  }
  if (effectData['blendMode']) effect['blendMode'] = effectData['blendMode'];
  return effect as unknown as Effect;
}

/**
 * Build a valid Figma effect for use in effect styles.
 * Only supports DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, BACKGROUND_BLUR.
 */
function buildValidStyleEffect(
  effect: Record<string, unknown>,
): DropShadowEffect | InnerShadowEffect | BlurEffect {
  if (!effect['type']) {
    throw new Error('Each effect must have a type property');
  }

  switch (effect['type']) {
    case 'DROP_SHADOW':
    case 'INNER_SHADOW':
      return {
        type: effect['type'] as 'DROP_SHADOW' | 'INNER_SHADOW',
        color: (effect['color'] as RGBA) || { r: 0, g: 0, b: 0, a: 0.5 },
        offset: (effect['offset'] as Vector) || { x: 0, y: 0 },
        radius:
          effect['radius'] !== undefined ? (effect['radius'] as number) : 5,
        spread:
          effect['spread'] !== undefined ? (effect['spread'] as number) : 0,
        visible:
          effect['visible'] !== undefined ? (effect['visible'] as boolean) : true,
        blendMode:
          effect['blendMode'] !== undefined
            ? (effect['blendMode'] as BlendMode)
            : ('NORMAL' as BlendMode),
      } as DropShadowEffect | InnerShadowEffect;
    case 'LAYER_BLUR':
    case 'BACKGROUND_BLUR':
      return {
        type: effect['type'] as 'LAYER_BLUR' | 'BACKGROUND_BLUR',
        radius:
          effect['radius'] !== undefined ? (effect['radius'] as number) : 5,
        visible:
          effect['visible'] !== undefined ? (effect['visible'] as boolean) : true,
      } as BlurEffect;
    default:
      throw new Error(
        'Unsupported effect type for style: ' +
          String(effect['type']) +
          '. Supported: DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, BACKGROUND_BLUR',
      );
  }
}

/**
 * Minimal helper to set text node characters.
 * Font must already be loaded before calling this.
 */
async function setCharacters(node: TextNode, characters: string): Promise<void> {
  try {
    node.characters = characters;
  } catch (e) {
    console.warn('setCharacters: failed to set characters:', e);
  }
}

// ---------------------------------------------------------------------------
// createFromData
// ---------------------------------------------------------------------------

/**
 * Create or update Figma nodes from a serialised data array.
 * Each element in `data` describes a node tree with properties matching
 * the Figma node schema produced by `readMyDesign`.
 */
export async function createFromData(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const data = params['data'] as Array<Record<string, unknown>> | undefined;
  const parentId = params['parentId'] as string | undefined;
  const nextToId = params['nextToId'] as string | undefined;
  const xParam = params['x'] as number | undefined;
  const yParam = params['y'] as number | undefined;
  const replaceChildren =
    params['replaceChildren'] !== undefined
      ? (params['replaceChildren'] as boolean)
      : false;

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("create_from_data requires a non-empty 'data' array");
  }

  // Build variable name → variable object map (reverse of readMyDesign)
  const varNameMap = new Map<string, Variable>();
  try {
    const localVars = await figma.variables.getLocalVariablesAsync();
    for (const v of localVars) {
      varNameMap.set(v.name, v);
    }
  } catch (e) {
    console.warn('Failed to load local variables:', e);
  }

  // Build text style name → style object map
  const textStyleMap = new Map<string, TextStyle>();
  try {
    const localStyles = await figma.getLocalTextStylesAsync();
    for (const s of localStyles) {
      textStyleMap.set(s.name, s);
    }
  } catch (e) {
    console.warn('Failed to load local text styles:', e);
  }

  // Build effect style name → style object map
  const effectStyleMap = new Map<string, EffectStyle>();
  try {
    const localEffects = await figma.getLocalEffectStylesAsync();
    for (const s of localEffects) {
      effectStyleMap.set(s.name, s);
    }
  } catch (e) {
    console.warn('Failed to load local effect styles:', e);
  }

  // Resolve parent
  let parent: BaseNode & ChildrenMixin;
  if (parentId) {
    const resolved = await figma.getNodeByIdAsync(parentId);
    if (!resolved || !('appendChild' in resolved)) {
      throw new Error('Invalid parent node: ' + parentId);
    }
    parent = resolved as BaseNode & ChildrenMixin;
  } else {
    parent = figma.currentPage;
  }

  // Resolve positioning
  const GAP = 100;
  let resolvedX: number | undefined = xParam;
  let resolvedY: number | undefined = yParam;

  if (nextToId) {
    const refNode = await figma.getNodeByIdAsync(nextToId);
    if (!refNode) {
      throw new Error('nextToId node not found: ' + nextToId);
    }
    const ref = refNode as LayoutMixin;
    resolvedX = ref.x + ref.width + GAP;
    resolvedY = ref.y;
  } else if (
    resolvedX === undefined &&
    resolvedY === undefined &&
    !parentId
  ) {
    const children = (parent as PageNode).children;
    if (children.length > 0) {
      let maxRight = -Infinity;
      let topY = Infinity;
      for (const child of children) {
        const layout = child as LayoutMixin;
        const right = layout.x + layout.width;
        if (right > maxRight) maxRight = right;
        if (layout.y < topY) topY = layout.y;
      }
      resolvedX = maxRight + GAP;
      resolvedY = topY;
    } else {
      resolvedX = 0;
      resolvedY = 0;
    }
  }

  const createdNodes: Array<Record<string, unknown>> = [];

  // Build component lookup map once for INSTANCE resolution (avoids O(N*M) page scans)
  const componentLookup = new Map<string, ComponentNode>();
  const allPageComponents = figma.currentPage.findAll(
    (n) => n.type === 'COMPONENT',
  ) as ComponentNode[];
  for (const comp of allPageComponents) {
    componentLookup.set(comp.name, comp);
    if (comp.parent && comp.parent.type === 'COMPONENT_SET') {
      if (!componentLookup.has(comp.parent.name)) {
        componentLookup.set(comp.parent.name, comp);
      }
    }
  }

  // Recursive node creator
  async function createNode(
    nodeData: Record<string, unknown>,
    parentNode: BaseNode & ChildrenMixin,
    isRoot: boolean,
    rootX?: number,
    rootY?: number,
  ): Promise<SceneNode> {
    let node: SceneNode | null = null;
    let isUpdate = false;
    let skipChildRecursion = false;

    // CHECK: does nodeData.id reference an existing Figma node?
    if (nodeData['id']) {
      try {
        const existing = await figma.getNodeByIdAsync(
          nodeData['id'] as string,
        );
        if (existing) {
          const existingScene = existing as SceneNode;
          const existingType = existingScene.type;
          const jsxType = nodeData['type'] as string;

          const isTypeCompatible =
            existingType === jsxType ||
            (jsxType === 'FRAME' && existingType === 'COMPONENT') ||
            (jsxType === 'FRAME' && existingType === 'INSTANCE') ||
            (jsxType === 'COMPONENT' && existingType === 'FRAME');

          if (jsxType === 'COMPONENT_SET') {
            console.warn(
              'Cannot update COMPONENT_SET "' +
                String(existingScene.name) +
                '" in-place — creating new node',
            );
          } else if (jsxType === 'SVG') {
            console.warn(
              'Cannot update SVG node "' +
                String(existingScene.name) +
                '" in-place — creating new node',
            );
          } else if (!isTypeCompatible) {
            console.warn(
              'Type mismatch: JSX type "' +
                jsxType +
                '" does not match existing node type "' +
                existingType +
                '" for id "' +
                String(nodeData['id']) +
                '" — creating new node',
            );
          } else {
            node = existingScene;
            isUpdate = true;

            if (replaceChildren && 'children' in node) {
              const withChildren = node as SceneNode & ChildrenMixin;
              for (
                let i = withChildren.children.length - 1;
                i >= 0;
                i--
              ) {
                withChildren.children[i].remove();
              }
            }

            if (existing.type === 'TEXT') {
              const textNode = existing as TextNode;
              const family = nodeData['fontFamily'] !== undefined
                ? (nodeData['fontFamily'] as string)
                : 'Inter';
              const weight = nodeData['fontWeight'] !== undefined
                ? (nodeData['fontWeight'] as number)
                : 400;
              try {
                await figma.loadFontAsync({
                  family,
                  style: getFontStyle(weight),
                });
                textNode.fontName = { family, style: getFontStyle(weight) };
              } catch (e) {
                try {
                  await figma.loadFontAsync({
                    family: 'Inter',
                    style: 'Regular',
                  });
                  textNode.fontName = {
                    family: 'Inter',
                    style: 'Regular',
                  };
                } catch (e2) {
                  console.warn(
                    'Failed to load fallback font Inter Regular:',
                    e2,
                  );
                }
              }
              if (nodeData['characters']) {
                await setCharacters(
                  textNode,
                  nodeData['characters'] as string,
                );
              }
            }
          }
        }
      } catch (e) {
        console.warn(
          'Could not find node with id "' +
            String(nodeData['id']) +
            '" — creating new node',
        );
      }
    }

    const jsxType = nodeData['type'] as string;

    if (node === null && jsxType === 'TEXT') {
      const textNode = figma.createText();
      const family = nodeData['fontFamily'] !== undefined
        ? (nodeData['fontFamily'] as string)
        : 'Inter';
      const weight = nodeData['fontWeight'] !== undefined
        ? (nodeData['fontWeight'] as number)
        : 400;
      try {
        await figma.loadFontAsync({ family, style: getFontStyle(weight) });
        textNode.fontName = { family, style: getFontStyle(weight) };
      } catch (e) {
        try {
          await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
          textNode.fontName = { family: 'Inter', style: 'Regular' };
        } catch (e2) {
          console.warn('Failed to load fallback font Inter Regular:', e2);
        }
      }
      if (nodeData['characters']) {
        await setCharacters(textNode, nodeData['characters'] as string);
      }
      node = textNode;
    } else if (node === null && jsxType === 'COMPONENT') {
      const comp = figma.createComponent();
      comp.fills = [];
      node = comp;
    } else if (node === null && jsxType === 'COMPONENT_SET') {
      const tempFrame = figma.createFrame();
      tempFrame.name =
        nodeData['name'] !== undefined
          ? (nodeData['name'] as string)
          : 'ComponentSet';
      tempFrame.fills = [];
      parentNode.appendChild(tempFrame);

      try {
        const childComponents: ComponentNode[] = [];
        const childrenData =
          nodeData['children'] as Array<Record<string, unknown>> | undefined;
        if (childrenData && childrenData.length > 0) {
          for (const child of childrenData) {
            const childNode = await createNode(
              child,
              tempFrame as unknown as BaseNode & ChildrenMixin,
              false,
            );
            if (childNode && childNode.type === 'COMPONENT') {
              childComponents.push(childNode as ComponentNode);
            }
          }
        }

        if (childComponents.length > 0) {
          const set = figma.combineAsVariants(
            childComponents,
            parentNode as FrameNode,
          );
          set.name =
            nodeData['name'] !== undefined
              ? (nodeData['name'] as string)
              : 'ComponentSet';
          node = set;
        } else {
          const fallback = figma.createComponent();
          fallback.fills = [];
          parentNode.appendChild(fallback);
          node = fallback;
        }
      } finally {
        try {
          tempFrame.remove();
        } catch (_) {
          // ignore
        }
      }

      const propDefs = nodeData['componentPropertyDefinitions'] as
        | Record<string, Record<string, unknown>>
        | undefined;
      if (propDefs && node !== null && node.type === 'COMPONENT_SET') {
        const setNode = node as ComponentSetNode;
        for (const propName of Object.keys(propDefs)) {
          const def = propDefs[propName];
          if (def['type'] === 'VARIANT') continue;
          try {
            const defaultVal =
              def['default'] !== undefined
                ? def['default']
                : def['type'] === 'BOOLEAN'
                ? true
                : '';
            setNode.addComponentProperty(
              propName,
              def['type'] as ComponentPropertyType,
              defaultVal as string | boolean,
            );
          } catch (e) {
            console.warn(
              'Failed to add component property "' + propName + '":',
              e,
            );
          }
        }
      }

      skipChildRecursion = true;
    } else if (node === null && jsxType === 'INSTANCE') {
      const componentName =
        nodeData['mainComponentName'] !== undefined
          ? (nodeData['mainComponentName'] as string)
          : (nodeData['name'] as string);
      const sourceComponent =
        componentLookup.get(componentName) !== undefined
          ? componentLookup.get(componentName)
          : null;

      if (sourceComponent) {
        const instance = sourceComponent.createInstance();
        const compProps = nodeData['componentProperties'] as
          | Record<string, Record<string, unknown>>
          | undefined;
        if (compProps) {
          const propsToSet: Record<string, string | boolean> = {};
          for (const key of Object.keys(compProps)) {
            propsToSet[key] = compProps[key]['value'] as string | boolean;
          }
          try {
            instance.setProperties(propsToSet);
          } catch (e) {
            console.warn('Failed to set instance properties:', e);
          }
        }
        node = instance;
      } else {
        const fallback = figma.createFrame();
        fallback.fills = [];
        console.warn(
          'Component "' +
            componentName +
            '" not found — created frame as fallback',
        );
        node = fallback;
      }
    } else if (
      node === null &&
      jsxType === 'SVG' &&
      nodeData['svgString']
    ) {
      let svgCreatedFromString = false;
      let svgNode: FrameNode | SceneNode;
      try {
        svgNode = figma.createNodeFromSvg(nodeData['svgString'] as string);
        svgCreatedFromString = true;
      } catch (e) {
        console.warn('Failed to create SVG node, falling back to frame:', e);
        const frame = figma.createFrame();
        frame.fills = [];
        svgNode = frame;
      }
      svgNode.name =
        nodeData['name'] !== undefined
          ? (nodeData['name'] as string)
          : 'SVG';
      if (svgCreatedFromString) {
        const svgRootStroke = parseSvgRootStroke(
          nodeData['svgString'] as string,
        );
        if (svgRootStroke) {
          propagateStrokeToShapes(svgNode as SceneNode, svgRootStroke);
          if ('strokes' in svgNode) {
            (svgNode as GeometryMixin).strokes = [];
          }
        }
      }
      if (svgNode.parent !== parentNode) {
        parentNode.appendChild(svgNode as SceneNode);
      }
      if (isRoot && rootX !== undefined) (svgNode as LayoutMixin).x = rootX;
      if (isRoot && rootY !== undefined) (svgNode as LayoutMixin).y = rootY;
      if (
        nodeData['width'] !== undefined &&
        nodeData['height'] !== undefined
      ) {
        (svgNode as LayoutMixin & {
          resize: (w: number, h: number) => void;
        }).resize(
          nodeData['width'] as number,
          nodeData['height'] as number,
        );
      }
      return svgNode as SceneNode;
    } else if (
      node === null &&
      (jsxType === 'RECTANGLE' || jsxType === 'VECTOR' || jsxType === 'LINE')
    ) {
      node = figma.createRectangle();
    } else if (node === null) {
      // Known limitation: ELLIPSE, POLYGON, STAR, and other unsupported node types
      // fall through here and are silently created as FRAME. Callers that pass these
      // types will receive an empty frame without an error. Future work: add explicit
      // handlers for ellipses (figma.createEllipse), polygons, and stars.
      const frame = figma.createFrame();
      frame.fills = [];
      node = frame;
    }

    // node is guaranteed non-null from here
    const n = node as SceneNode;

    // Set name
    n.name =
      nodeData['name'] !== undefined
        ? (nodeData['name'] as string)
        : 'Node';

    // Append to parent FIRST (required for layout properties)
    if (!isUpdate && jsxType !== 'COMPONENT_SET') {
      if (n.parent !== parentNode) {
        parentNode.appendChild(n);
      }
    }

    // Set position for root nodes (skip for updated nodes)
    if (!isUpdate && isRoot && rootX !== undefined) {
      (n as LayoutMixin).x = rootX;
    }
    if (!isUpdate && isRoot && rootY !== undefined) {
      (n as LayoutMixin).y = rootY;
    }

    // Set layout mode FIRST (gate for other layout props)
    const layoutMode = nodeData['layoutMode'] as string | undefined;
    if (layoutMode && layoutMode !== 'NONE') {
      (n as AutoLayoutMixin).layoutMode =
        layoutMode as AutoLayoutMixin['layoutMode'];

      if (nodeData['primaryAxisAlignItems']) {
        (n as AutoLayoutMixin).primaryAxisAlignItems =
          nodeData['primaryAxisAlignItems'] as AutoLayoutMixin['primaryAxisAlignItems'];
      }
      if (nodeData['counterAxisAlignItems']) {
        (n as AutoLayoutMixin).counterAxisAlignItems =
          nodeData['counterAxisAlignItems'] as AutoLayoutMixin['counterAxisAlignItems'];
      }
      if (nodeData['itemSpacing'] !== undefined) {
        (n as AutoLayoutMixin).itemSpacing = nodeData['itemSpacing'] as number;
      }
      if (nodeData['counterAxisSpacing'] !== undefined) {
        (n as AutoLayoutMixin).counterAxisSpacing =
          nodeData['counterAxisSpacing'] as number;
      }
      if (nodeData['layoutWrap']) {
        (n as AutoLayoutMixin).layoutWrap =
          nodeData['layoutWrap'] as AutoLayoutMixin['layoutWrap'];
      }
      if (nodeData['paddingTop'] !== undefined) {
        (n as AutoLayoutMixin).paddingTop = nodeData['paddingTop'] as number;
      }
      if (nodeData['paddingRight'] !== undefined) {
        (n as AutoLayoutMixin).paddingRight =
          nodeData['paddingRight'] as number;
      }
      if (nodeData['paddingBottom'] !== undefined) {
        (n as AutoLayoutMixin).paddingBottom =
          nodeData['paddingBottom'] as number;
      }
      if (nodeData['paddingLeft'] !== undefined) {
        (n as AutoLayoutMixin).paddingLeft =
          nodeData['paddingLeft'] as number;
      }
    }

    // Clipping
    if (nodeData['clipsContent']) {
      (n as FrameNode).clipsContent = true;
    }

    // Sizing
    const nLayout = n as LayoutMixin;
    if (
      nodeData['width'] !== undefined &&
      nodeData['height'] !== undefined
    ) {
      (n as LayoutMixin & { resize: (w: number, h: number) => void }).resize(
        nodeData['width'] as number,
        nodeData['height'] as number,
      );
    } else if (nodeData['width'] !== undefined) {
      (n as LayoutMixin & { resize: (w: number, h: number) => void }).resize(
        nodeData['width'] as number,
        nLayout.height,
      );
    } else if (nodeData['height'] !== undefined) {
      (n as LayoutMixin & { resize: (w: number, h: number) => void }).resize(
        nLayout.width,
        nodeData['height'] as number,
      );
    }
    if (nodeData['layoutSizingHorizontal']) {
      ((n as unknown) as LayoutMixin).layoutSizingHorizontal =
        nodeData['layoutSizingHorizontal'] as LayoutMixin['layoutSizingHorizontal'];
    } else if (nodeData['layoutMode']) {
      ((n as unknown) as LayoutMixin).layoutSizingHorizontal = 'HUG';
    }
    if (nodeData['layoutSizingVertical']) {
      ((n as unknown) as LayoutMixin).layoutSizingVertical =
        nodeData['layoutSizingVertical'] as LayoutMixin['layoutSizingVertical'];
    } else if (nodeData['layoutMode']) {
      ((n as unknown) as LayoutMixin).layoutSizingVertical = 'HUG';
    }

    // Fills
    const fills = nodeData['fills'] as Array<Record<string, unknown>> | undefined;
    if (fills && fills.length > 0) {
      (n as GeometryMixin).fills = fills.map((f) => buildFigmaPaint(f));
    }

    // Strokes
    const strokes = nodeData['strokes'] as Array<Record<string, unknown>> | undefined;
    if (strokes && strokes.length > 0) {
      (n as GeometryMixin).strokes = strokes.map((s) => buildFigmaPaint(s));
    }
    if (nodeData['strokeWeight']) {
      (n as GeometryMixin).strokeWeight = nodeData['strokeWeight'] as number;
    }
    const hasIndividualStrokes =
      nodeData['strokeTopWeight'] !== undefined ||
      nodeData['strokeBottomWeight'] !== undefined ||
      nodeData['strokeLeftWeight'] !== undefined ||
      nodeData['strokeRightWeight'] !== undefined;
    if (hasIndividualStrokes) {
      const nGeom = n as IndividualStrokesMixin;
      nGeom.strokeTopWeight =
        nodeData['strokeTopWeight'] !== undefined
          ? (nodeData['strokeTopWeight'] as number)
          : 0;
      nGeom.strokeBottomWeight =
        nodeData['strokeBottomWeight'] !== undefined
          ? (nodeData['strokeBottomWeight'] as number)
          : 0;
      nGeom.strokeLeftWeight =
        nodeData['strokeLeftWeight'] !== undefined
          ? (nodeData['strokeLeftWeight'] as number)
          : 0;
      nGeom.strokeRightWeight =
        nodeData['strokeRightWeight'] !== undefined
          ? (nodeData['strokeRightWeight'] as number)
          : 0;
    }

    // Corner radius
    if (nodeData['cornerRadius']) {
      (n as CornerMixin).cornerRadius = nodeData['cornerRadius'] as number;
    }
    if (nodeData['topLeftRadius']) {
      (n as RectangleCornerMixin).topLeftRadius =
        nodeData['topLeftRadius'] as number;
    }
    if (nodeData['topRightRadius']) {
      (n as RectangleCornerMixin).topRightRadius =
        nodeData['topRightRadius'] as number;
    }
    if (nodeData['bottomRightRadius']) {
      (n as RectangleCornerMixin).bottomRightRadius =
        nodeData['bottomRightRadius'] as number;
    }
    if (nodeData['bottomLeftRadius']) {
      (n as RectangleCornerMixin).bottomLeftRadius =
        nodeData['bottomLeftRadius'] as number;
    }

    // Effects
    const effectsData = nodeData['effects'] as Array<Record<string, unknown>> | undefined;
    if (effectsData && effectsData.length > 0) {
      (n as BlendMixin).effects = effectsData.map((e) =>
        buildFigmaEffect(e),
      );
    }

    // Apply effect style if present
    if (nodeData['effectStyleName']) {
      const eStyle = effectStyleMap.get(nodeData['effectStyleName'] as string);
      if (eStyle) {
        await (n as BlendMixin).setEffectStyleIdAsync(eStyle.id);
      }
    }

    // Opacity
    if (nodeData['opacity'] !== undefined) {
      (n as BlendMixin).opacity = nodeData['opacity'] as number;
    }

    // Rotation
    if (nodeData['rotation']) {
      (n as LayoutMixin).rotation = nodeData['rotation'] as number;
    }

    // Text properties
    if (jsxType === 'TEXT') {
      const textN = n as TextNode;
      if (nodeData['fontSize']) textN.fontSize = nodeData['fontSize'] as number;
      if (nodeData['lineHeight'] !== undefined) {
        textN.lineHeight =
          nodeData['lineHeightUnit'] === 'percent'
            ? { value: nodeData['lineHeight'] as number, unit: 'PERCENT' }
            : { value: nodeData['lineHeight'] as number, unit: 'PIXELS' };
      }
      if (nodeData['letterSpacing'] !== undefined) {
        textN.letterSpacing =
          nodeData['letterSpacingUnit'] === 'percent'
            ? {
                value: nodeData['letterSpacing'] as number,
                unit: 'PERCENT',
              }
            : {
                value: nodeData['letterSpacing'] as number,
                unit: 'PIXELS',
              };
      }
      if (nodeData['textAlignHorizontal']) {
        textN.textAlignHorizontal =
          nodeData['textAlignHorizontal'] as TextNode['textAlignHorizontal'];
      }
      if (
        nodeData['textCase'] &&
        nodeData['textCase'] !== 'ORIGINAL'
      ) {
        textN.textCase = nodeData['textCase'] as TextNode['textCase'];
      }
      if (
        nodeData['textDecoration'] &&
        nodeData['textDecoration'] !== 'NONE'
      ) {
        textN.textDecoration =
          nodeData['textDecoration'] as TextNode['textDecoration'];
      }
      if (nodeData['textStyleName']) {
        const style = textStyleMap.get(nodeData['textStyleName'] as string);
        if (style) {
          await textN.setTextStyleIdAsync(style.id);
        }
      }
    }

    // Absolute positioning (after appendChild)
    if (nodeData['layoutPositioning'] === 'ABSOLUTE') {
      const nParent = n.parent;
      if (
        nParent &&
        'layoutMode' in nParent &&
        (nParent as AutoLayoutMixin).layoutMode !== 'NONE'
      ) {
        ((n as unknown) as LayoutMixin).layoutPositioning = 'ABSOLUTE';
      }
      if (nodeData['x'] !== undefined) {
        (n as LayoutMixin).x = nodeData['x'] as number;
      }
      if (nodeData['y'] !== undefined) {
        (n as LayoutMixin).y = nodeData['y'] as number;
      }
    }

    // Variable bindings (after properties are set)
    const bindings = nodeData['bindings'] as
      | Record<string, string>
      | undefined;
    if (bindings) {
      for (const field of Object.keys(bindings)) {
        const varName = bindings[field];
        const variable = varNameMap.get(varName);
        if (!variable) continue;

        if (
          field.indexOf('fills/') === 0 ||
          field.indexOf('strokes/') === 0
        ) {
          const parts = field.split('/');
          const prop = parts[0] as 'fills' | 'strokes';
          const idx = parseInt(parts[1]);
          const paints = [
            ...((n as GeometryMixin)[prop] as ReadonlyArray<Paint>),
          ];
          if (paints[idx]) {
            paints[idx] = figma.variables.setBoundVariableForPaint(
              paints[idx] as SolidPaint,
              'color',
              variable,
            );
            (n as GeometryMixin)[prop] = paints;
          }
        } else {
          try {
            (n as SceneNodeMixin).setBoundVariable(
              field as VariableBindableNodeField,
              variable,
            );
          } catch (e) {
            console.warn(
              'Failed to bind variable "' +
                varName +
                '" to field "' +
                field +
                '":',
              e,
            );
          }
        }
      }
    }

    // Recursively create children
    const skipChildrenForUpdate = isUpdate && !replaceChildren;
    const childrenData =
      nodeData['children'] as Array<Record<string, unknown>> | undefined;
    if (
      !skipChildRecursion &&
      !skipChildrenForUpdate &&
      childrenData &&
      childrenData.length > 0
    ) {
      for (const child of childrenData) {
        await createNode(child, n as unknown as BaseNode & ChildrenMixin, false);
      }
    }

    createdNodes.push({
      id: n.id,
      name: n.name,
      type: n.type,
      action: isUpdate ? 'updated' : 'created',
    });
    return n;
  }

  // Create each root node
  let xOffset = 0;
  for (let i = 0; i < data.length; i++) {
    const isExistingUpdate = data[i]['id']
      ? await figma.getNodeByIdAsync(data[i]['id'] as string).catch(() => null)
      : null;
    const node = await createNode(
      data[i],
      parent,
      true,
      resolvedX !== undefined ? resolvedX + xOffset : undefined,
      resolvedY,
    );
    if (!isExistingUpdate) {
      xOffset += ((node as LayoutMixin).width !== undefined ? (node as LayoutMixin).width : 100) + 40;
    }
  }

  return { createdNodes };
}

// ---------------------------------------------------------------------------
// getDesignSystem
// ---------------------------------------------------------------------------

/**
 * Return a snapshot of the design system: variables, text styles, effect
 * styles, and pages from the current Figma document.
 */
export async function getDesignSystem(): Promise<Record<string, unknown>> {
  const results = await Promise.all([
    figma.variables.getLocalVariablesAsync(),
    figma.variables.getLocalVariableCollectionsAsync(),
    figma.getLocalTextStylesAsync(),
    figma.getLocalEffectStylesAsync(),
  ]);

  const allVariables = results[0];
  const allCollections = results[1];
  const textStyles = results[2];
  const effectStyles = results[3];

  // Build collection lookup
  const collectionMap: Record<string, VariableCollection> = {};
  for (let ci = 0; ci < allCollections.length; ci++) {
    const col = allCollections[ci];
    collectionMap[col.id] = col;
  }

  // Map variables with collection info and mode values
  const variables: Array<Record<string, unknown>> = [];
  for (let vi = 0; vi < allVariables.length; vi++) {
    const v = allVariables[vi];
    const collection = collectionMap[v.variableCollectionId];
    const collectionName =
      collection !== undefined ? collection.name : '';
    const modes = collection !== undefined ? collection.modes : [];

    const values: Array<Record<string, unknown>> = [];
    for (let mi = 0; mi < modes.length; mi++) {
      const mode = modes[mi];
      const rawValue = v.valuesByMode[mode.modeId];
      let resolvedValue: unknown = rawValue;

      if (
        rawValue !== null &&
        rawValue !== undefined &&
        typeof rawValue === 'object' &&
        (rawValue as unknown as Record<string, unknown>)['type'] === 'VARIABLE_ALIAS'
      ) {
        const aliasId = (rawValue as unknown as Record<string, unknown>)['id'] as string;
        const aliasVar = figma.variables.getVariableById(aliasId);
        resolvedValue =
          aliasVar !== null && aliasVar !== undefined
            ? aliasVar.name
            : aliasId;
      }

      values.push({
        modeId: mode.modeId,
        modeName: mode.name,
        value: resolvedValue,
      });
    }

    variables.push({
      id: v.id,
      name: v.name,
      description: v.description !== undefined ? v.description : '',
      resolvedType: v.resolvedType,
      collectionName,
      values,
    });
  }

  // Map text styles
  const mappedTextStyles: Array<Record<string, unknown>> = [];
  for (let ti = 0; ti < textStyles.length; ti++) {
    const ts = textStyles[ti];
    mappedTextStyles.push({
      id: ts.id,
      name: ts.name,
      fontSize: ts.fontSize,
      fontName:
        ts.fontName !== null && ts.fontName !== undefined
          ? { family: ts.fontName.family, style: ts.fontName.style }
          : { family: '', style: '' },
      lineHeight: ts.lineHeight,
    });
  }

  // Map effect styles
  const mappedEffectStyles: Array<Record<string, unknown>> = [];
  for (let ei = 0; ei < effectStyles.length; ei++) {
    const es = effectStyles[ei];
    const mappedEffects: Array<Record<string, unknown>> = [];
    if (es.effects && es.effects.length > 0) {
      for (let efi = 0; efi < es.effects.length; efi++) {
        const eff = es.effects[efi];
        const mappedEff: Record<string, unknown> = {
          type: eff.type,
          visible: eff.visible,
        };
        if ('color' in eff && eff.color) {
          const c = eff.color as RGBA;
          mappedEff['color'] = { r: c.r, g: c.g, b: c.b, a: c.a };
        }
        if ('offset' in eff && eff.offset) {
          const off = eff.offset as Vector;
          mappedEff['offset'] = { x: off.x, y: off.y };
        }
        if ('radius' in eff && eff.radius !== undefined) {
          mappedEff['radius'] = eff.radius;
        }
        if ('spread' in eff && eff.spread !== undefined) {
          mappedEff['spread'] = eff.spread;
        }
        mappedEffects.push(mappedEff);
      }
    }
    mappedEffectStyles.push({
      id: es.id,
      name: es.name,
      description: es.description !== undefined ? es.description : '',
      effects: mappedEffects,
    });
  }

  // Map pages
  const pages: Array<Record<string, unknown>> = [];
  for (let pi = 0; pi < figma.root.children.length; pi++) {
    const pg = figma.root.children[pi];
    pages.push({ id: pg.id, name: pg.name });
  }

  return {
    pages,
    variables,
    textStyles: mappedTextStyles,
    effectStyles: mappedEffectStyles,
  };
}

// ---------------------------------------------------------------------------
// setupDesignSystem
// ---------------------------------------------------------------------------

/**
 * Create or update an entire design system in a single call.
 * Supports variable collections, text styles, effect styles, and pages.
 */
export async function setupDesignSystem(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const inputCollections =
    params !== null &&
    params !== undefined &&
    Array.isArray(params['collections']) &&
    (params['collections'] as unknown[]).length > 0
      ? (params['collections'] as Array<Record<string, unknown>>)
      : [];
  const inputTextStyles =
    params !== null && params !== undefined && params['textStyles']
      ? (params['textStyles'] as Array<Record<string, unknown>>)
      : [];
  const inputEffectStyles =
    params !== null && params !== undefined && params['effectStyles']
      ? (params['effectStyles'] as Array<Record<string, unknown>>)
      : [];

  const varResult: Record<string, unknown> = {
    created: 0,
    updated: 0,
    failed: 0,
    errors: [] as Array<Record<string, unknown>>,
  };
  const tsResult: Record<string, unknown> = {
    created: 0,
    updated: 0,
    failed: 0,
    errors: [] as Array<Record<string, unknown>>,
  };
  const esResult: Record<string, unknown> = {
    created: 0,
    updated: 0,
    failed: 0,
    errors: [] as Array<Record<string, unknown>>,
  };
  const createdCollections: Array<Record<string, unknown>> = [];

  // --- Variables (multiple collections) ---
  if (inputCollections.length > 0) {
    const allLocalCollections =
      await figma.variables.getLocalVariableCollectionsAsync();
    const allLocalVars = await figma.variables.getLocalVariablesAsync();

    for (let colIdx = 0; colIdx < inputCollections.length; colIdx++) {
      const colDef = inputCollections[colIdx];
      const colName =
        colDef['name'] !== undefined
          ? (colDef['name'] as string)
          : 'Design Tokens';
      const colVars =
        colDef['variables'] !== undefined &&
        Array.isArray(colDef['variables'])
          ? (colDef['variables'] as Array<Record<string, unknown>>)
          : [];

      let targetCollection: VariableCollection | null = null;
      for (let ci = 0; ci < allLocalCollections.length; ci++) {
        if (allLocalCollections[ci].name === colName) {
          targetCollection = allLocalCollections[ci];
          break;
        }
      }
      if (!targetCollection) {
        targetCollection = figma.variables.createVariableCollection(colName);
        allLocalCollections.push(targetCollection);
      }
      createdCollections.push({
        id: targetCollection.id,
        name: colName,
      });
      const defaultModeId = targetCollection.modes[0].modeId;

      const varByName: Record<string, Variable> = {};
      for (let evi = 0; evi < allLocalVars.length; evi++) {
        const ev = allLocalVars[evi];
        if (
          targetCollection !== null &&
          ev.variableCollectionId === targetCollection.id
        ) {
          varByName[ev.name] = ev;
        }
      }

      for (let vi = 0; vi < colVars.length; vi++) {
        const vDef = colVars[vi];
        try {
          const existing = varByName[vDef['name'] as string];
          if (existing) {
            existing.setValueForMode(defaultModeId, vDef['value'] as VariableValue);
            if (vDef['description'] !== undefined) {
              existing.description = vDef['description'] as string;
            }
            (varResult['updated'] as number);
            varResult['updated'] = (varResult['updated'] as number) + 1;
          } else {
            const resolvedType: VariableResolvedDataType =
              vDef['type'] === 'COLOR' ? 'COLOR' : 'FLOAT';
            const newVar = figma.variables.createVariable(
              vDef['name'] as string,
              targetCollection as VariableCollection,
              resolvedType,
            );
            newVar.setValueForMode(defaultModeId, vDef['value'] as VariableValue);
            if (vDef['description'] !== undefined) {
              newVar.description = vDef['description'] as string;
            }
            varByName[vDef['name'] as string] = newVar;
            allLocalVars.push(newVar);
            varResult['created'] = (varResult['created'] as number) + 1;
          }
        } catch (e) {
          varResult['failed'] = (varResult['failed'] as number) + 1;
          (varResult['errors'] as Array<Record<string, unknown>>).push({
            name: colName + '/' + String(vDef['name']),
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }

  // --- Text Styles ---
  if (inputTextStyles.length > 0) {
    const existingTextStyles = await figma.getLocalTextStylesAsync();
    const tsByName: Record<string, TextStyle> = {};
    for (let eti = 0; eti < existingTextStyles.length; eti++) {
      tsByName[existingTextStyles[eti].name] = existingTextStyles[eti];
    }

    for (let ti = 0; ti < inputTextStyles.length; ti++) {
      const tsDef = inputTextStyles[ti];
      try {
        const fontFamily =
          tsDef['fontFamily'] !== undefined
            ? (tsDef['fontFamily'] as string)
            : 'Inter';
        const fontStyle =
          tsDef['fontStyle'] !== undefined
            ? (tsDef['fontStyle'] as string)
            : 'Regular';
        await figma.loadFontAsync({ family: fontFamily, style: fontStyle });

        const existingTs = tsByName[tsDef['name'] as string];
        if (existingTs) {
          existingTs.fontName = { family: fontFamily, style: fontStyle };
          existingTs.fontSize = tsDef['fontSize'] as number;
          if (tsDef['lineHeight'] !== undefined) {
            existingTs.lineHeight =
              tsDef['lineHeight'] as TextStyle['lineHeight'];
          }
          if (tsDef['letterSpacing'] !== undefined) {
            existingTs.letterSpacing =
              tsDef['letterSpacing'] as TextStyle['letterSpacing'];
          }
          if (tsDef['description'] !== undefined) {
            existingTs.description = tsDef['description'] as string;
          }
          tsResult['updated'] = (tsResult['updated'] as number) + 1;
        } else {
          const newTs = figma.createTextStyle();
          newTs.name = tsDef['name'] as string;
          newTs.fontName = { family: fontFamily, style: fontStyle };
          newTs.fontSize = tsDef['fontSize'] as number;
          if (tsDef['lineHeight'] !== undefined) {
            newTs.lineHeight = tsDef['lineHeight'] as TextStyle['lineHeight'];
          }
          if (tsDef['letterSpacing'] !== undefined) {
            newTs.letterSpacing =
              tsDef['letterSpacing'] as TextStyle['letterSpacing'];
          }
          if (tsDef['description'] !== undefined) {
            newTs.description = tsDef['description'] as string;
          }
          tsByName[tsDef['name'] as string] = newTs;
          tsResult['created'] = (tsResult['created'] as number) + 1;
        }
      } catch (e) {
        tsResult['failed'] = (tsResult['failed'] as number) + 1;
        (tsResult['errors'] as Array<Record<string, unknown>>).push({
          name: tsDef['name'],
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  // --- Effect Styles ---
  if (inputEffectStyles.length > 0) {
    const existingEffectStyles = await figma.getLocalEffectStylesAsync();
    const esByName: Record<string, EffectStyle> = {};
    for (let eei = 0; eei < existingEffectStyles.length; eei++) {
      esByName[existingEffectStyles[eei].name] = existingEffectStyles[eei];
    }

    for (let ei = 0; ei < inputEffectStyles.length; ei++) {
      const esDef = inputEffectStyles[ei];
      try {
        if (
          !esDef['effects'] ||
          !Array.isArray(esDef['effects']) ||
          (esDef['effects'] as unknown[]).length === 0
        ) {
          throw new Error('effects must be a non-empty array');
        }
        const validEffects = (
          esDef['effects'] as Array<Record<string, unknown>>
        ).map(buildValidStyleEffect);

        const existingEs = esByName[esDef['name'] as string];
        if (existingEs) {
          existingEs.effects = validEffects;
          if (esDef['description'] !== undefined) {
            existingEs.description = esDef['description'] as string;
          }
          esResult['updated'] = (esResult['updated'] as number) + 1;
        } else {
          const newEs = figma.createEffectStyle();
          newEs.name = esDef['name'] as string;
          newEs.effects = validEffects;
          if (esDef['description'] !== undefined) {
            newEs.description = esDef['description'] as string;
          }
          esByName[esDef['name'] as string] = newEs;
          esResult['created'] = (esResult['created'] as number) + 1;
        }
      } catch (e) {
        esResult['failed'] = (esResult['failed'] as number) + 1;
        (esResult['errors'] as Array<Record<string, unknown>>).push({
          name: esDef['name'],
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  // Clean up empty error arrays
  if ((varResult['errors'] as unknown[]).length === 0) {
    delete varResult['errors'];
  }
  if ((tsResult['errors'] as unknown[]).length === 0) {
    delete tsResult['errors'];
  }
  if ((esResult['errors'] as unknown[]).length === 0) {
    delete esResult['errors'];
  }

  // --- Pages: ensure required pages exist ---
  const requiredPages =
    params !== null &&
    params !== undefined &&
    Array.isArray(params['pages']) &&
    (params['pages'] as unknown[]).length > 0
      ? (params['pages'] as string[])
      : ['Screens', 'Components', 'Draft'];

  await figma.loadAllPagesAsync();
  const existingPages = figma.root.children;

  const existingPageNames: Record<string, PageNode> = {};
  for (let epi = 0; epi < existingPages.length; epi++) {
    existingPageNames[existingPages[epi].name.toLowerCase()] =
      existingPages[epi];
  }

  const firstRequired = requiredPages[0];
  if (
    existingPages.length === 1 &&
    existingPages[0].name === 'Page 1' &&
    existingPages[0].children.length === 0 &&
    !existingPageNames[firstRequired.toLowerCase()]
  ) {
    existingPages[0].name = firstRequired;
    existingPageNames[firstRequired.toLowerCase()] = existingPages[0];
  }

  for (let rpi = 0; rpi < requiredPages.length; rpi++) {
    const reqName = requiredPages[rpi];
    if (!existingPageNames[reqName.toLowerCase()]) {
      const newPage = figma.createPage();
      newPage.name = reqName;
      existingPageNames[reqName.toLowerCase()] = newPage;
    }
  }

  const finalPages: Array<Record<string, unknown>> = [];
  const allPages = figma.root.children;
  for (let fpi = 0; fpi < allPages.length; fpi++) {
    finalPages.push({ id: allPages[fpi].id, name: allPages[fpi].name });
  }

  return {
    collections: createdCollections,
    pages: finalPages,
    variables: varResult,
    textStyles: tsResult,
    effectStyles: esResult,
  };
}
