import { debugLog } from '../utils/helpers';

export async function setEffects(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const nodeId = params['nodeId'] as string | undefined;
  const effects = params['effects'] as unknown[] | undefined;

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  if (!effects || !Array.isArray(effects)) {
    throw new Error(
      'Missing or invalid effects parameter. Must be an array.',
    );
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!('effects' in node)) {
    throw new Error(`Node does not support effects: ${nodeId}`);
  }

  // GLASS effects only work on FRAME, COMPONENT, and INSTANCE nodes
  const hasGlass = (effects as Array<Record<string, unknown>>).some(
    (e) => e['type'] === 'GLASS',
  );
  if (hasGlass) {
    const frameTypes = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];
    if (!frameTypes.includes(node.type)) {
      throw new Error(
        `GLASS effect is only supported on frame-like nodes (FRAME, COMPONENT, INSTANCE). Got: ${node.type}`,
      );
    }
  }

  try {
    // Convert incoming effects to valid Figma effects
    const validEffects = (effects as Array<Record<string, unknown>>).map(
      (effect) => {
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
                effect['radius'] !== undefined
                  ? (effect['radius'] as number)
                  : 5,
              spread:
                effect['spread'] !== undefined
                  ? (effect['spread'] as number)
                  : 0,
              visible:
                effect['visible'] !== undefined
                  ? (effect['visible'] as boolean)
                  : true,
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
                effect['radius'] !== undefined
                  ? (effect['radius'] as number)
                  : 5,
              visible:
                effect['visible'] !== undefined
                  ? (effect['visible'] as boolean)
                  : true,
            } as BlurEffect;
          case 'NOISE': {
            const noiseEffect: Record<string, unknown> = {
              type: 'NOISE',
              noiseType:
                effect['noiseType'] !== undefined
                  ? effect['noiseType']
                  : 'MONOTONE',
              color:
                effect['color'] !== undefined
                  ? effect['color']
                  : { r: 0, g: 0, b: 0, a: 0.1 },
              noiseSize:
                effect['noiseSize'] !== undefined ? effect['noiseSize'] : 1,
              density:
                effect['density'] !== undefined ? effect['density'] : 0.5,
              blendMode:
                effect['blendMode'] !== undefined
                  ? effect['blendMode']
                  : 'NORMAL',
              visible:
                effect['visible'] !== undefined ? effect['visible'] : true,
            };
            if (
              effect['noiseType'] === 'DUOTONE' &&
              effect['secondaryColor'] !== undefined
            ) {
              noiseEffect['secondaryColor'] = effect['secondaryColor'];
            }
            if (
              effect['noiseType'] === 'MULTITONE' &&
              effect['opacity'] !== undefined
            ) {
              noiseEffect['opacity'] = effect['opacity'];
            }
            return noiseEffect as unknown as Effect;
          }
          case 'TEXTURE':
            return {
              type: 'TEXTURE',
              noiseSize:
                effect['noiseSize'] !== undefined ? effect['noiseSize'] : 1,
              radius:
                effect['radius'] !== undefined ? effect['radius'] : 0,
              clipToShape:
                effect['clipToShape'] !== undefined
                  ? effect['clipToShape']
                  : true,
              visible:
                effect['visible'] !== undefined ? effect['visible'] : true,
            } as unknown as Effect;
          case 'GLASS':
            return {
              type: 'GLASS',
              lightIntensity:
                effect['lightIntensity'] !== undefined
                  ? effect['lightIntensity']
                  : 0.5,
              lightAngle:
                effect['lightAngle'] !== undefined
                  ? effect['lightAngle']
                  : 0,
              refraction:
                effect['refraction'] !== undefined
                  ? effect['refraction']
                  : 0.5,
              depth:
                effect['depth'] !== undefined ? effect['depth'] : 0.5,
              dispersion:
                effect['dispersion'] !== undefined
                  ? effect['dispersion']
                  : 0,
              radius:
                effect['radius'] !== undefined ? effect['radius'] : 0,
              visible:
                effect['visible'] !== undefined ? effect['visible'] : true,
            } as unknown as Effect;
          default:
            throw new Error(`Unsupported effect type: ${effect['type']}`);
        }
      },
    );

    // Apply the effects to the node
    (node as BlendMixin).effects = validEffects;

    const effectNode = node as BlendMixin;
    return {
      id: node.id,
      name: node.name,
      effects: effectNode.effects,
    };
  } catch (error) {
    throw new Error(`Error setting effects: ${(error as Error).message}`);
  }
}

export async function setEffectStyleId(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const nodeId = params['nodeId'] as string | undefined;
  const effectStyleId = params['effectStyleId'] as string | undefined;

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  if (!effectStyleId) {
    throw new Error('Missing effectStyleId parameter');
  }

  try {
    // Set up a manual timeout to detect long operations
    let timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => { /* placeholder */ }, 0);
    clearTimeout(timeoutId); // clear the placeholder immediately
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(
            'Timeout while setting effect style ID (8s). The operation took too long to complete.',
          ),
        );
      }, 8000);
    });

    debugLog(
      `Starting to set effect style ID ${effectStyleId} on node ${nodeId}...`,
    );

    // Get node and validate in a promise
    const nodePromise = (async () => {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }

      if (!('effectStyleId' in node)) {
        throw new Error(
          `Node with ID ${nodeId} does not support effect styles`,
        );
      }

      // Try to validate the effect style exists before applying
      debugLog(`Fetching effect styles to validate style ID: ${effectStyleId}`);
      const effectStyles = await figma.getLocalEffectStylesAsync();
      let foundStyle = effectStyles.find(
        (style) => style.id === effectStyleId,
      );

      // Fall back to name-based lookup (supports 'shadow/md' or 'shadow-md')
      if (!foundStyle) {
        const normalizedInput = effectStyleId.replace(/-/g, '/');
        foundStyle = effectStyles.find(
          (style) => style.name === effectStyleId || style.name === normalizedInput,
        );
      }

      if (!foundStyle) {
        throw new Error(
          `Effect style not found: "${effectStyleId}". Pass a style ID or name (e.g. "shadow/md"). Available styles: ${effectStyles.length}`,
        );
      }

      debugLog(`Effect style found, applying to node...`);

      // Apply the effect style to the node
      const effectNode = node as BlendMixin;
      await effectNode.setEffectStyleIdAsync(foundStyle.id);

      return {
        id: node.id,
        name: node.name,
        effectStyleId: effectNode.effectStyleId,
        appliedEffects: effectNode.effects,
      };
    })();

    // Race between the node operation and the timeout
    let result: Record<string, unknown>;
    try {
      result = await Promise.race([nodePromise, timeoutPromise]) as Record<string, unknown>;
    } finally {
      clearTimeout(timeoutId);
    }

    debugLog(`Successfully set effect style ID on node ${nodeId}`);
    return result;
  } catch (error) {
    const err = error as Error;
    console.error(`Error setting effect style ID: ${err.message || 'Unknown error'}`);
    console.error(
      `Stack trace: ${err.stack !== undefined ? err.stack : 'Not available'}`,
    );

    if (
      err.message.includes('timeout') ||
      err.message.includes('Timeout')
    ) {
      throw new Error(
        `The operation timed out after 8 seconds. This could happen with complex nodes or effects. Try with a simpler node or effect style.`,
      );
    } else if (
      err.message.includes('not found') &&
      err.message.includes('Node')
    ) {
      throw new Error(
        `Node with ID "${nodeId}" not found. Make sure the node exists in the current document.`,
      );
    } else if (
      err.message.includes('not found') &&
      err.message.includes('style')
    ) {
      throw new Error(
        `Effect style with ID "${effectStyleId}" not found. Make sure the style exists in your local styles.`,
      );
    } else if (err.message.includes('does not support')) {
      throw new Error(
        `The selected node type does not support effect styles. Only certain node types like frames, components, and instances can have effect styles.`,
      );
    } else {
      throw new Error(`Error setting effect style ID: ${err.message}`);
    }
  }
}

// Private helper: build a valid Figma effect object for style operations
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
          effect['visible'] !== undefined
            ? (effect['visible'] as boolean)
            : true,
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
          effect['visible'] !== undefined
            ? (effect['visible'] as boolean)
            : true,
      } as BlurEffect;
    default:
      throw new Error(
        `Unsupported effect type for style: ${effect['type']}. Supported: DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, BACKGROUND_BLUR`,
      );
  }
}

export async function createEffectStyle(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const name = params['name'] as string | undefined;
  const effects = params['effects'] as unknown[] | undefined;
  const description = params['description'] as string | undefined;

  if (!name) {
    throw new Error('Missing required parameter: name');
  }

  if (!effects || !Array.isArray(effects) || effects.length === 0) {
    throw new Error(
      'Missing required parameter: effects (must be a non-empty array)',
    );
  }

  try {
    const validEffects = (effects as Array<Record<string, unknown>>).map(
      buildValidStyleEffect,
    );

    const effectStyle = figma.createEffectStyle();
    effectStyle.name = name;
    effectStyle.effects = validEffects;
    if (description !== undefined) {
      effectStyle.description = description;
    }

    return {
      id: effectStyle.id,
      name: effectStyle.name,
      key: effectStyle.key,
      effects: effectStyle.effects,
    };
  } catch (error) {
    throw new Error(
      `Error creating effect style: ${(error as Error).message}`,
    );
  }
}

export async function updateEffectStyle(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const styleId = params['styleId'] as string | undefined;
  const name = params['name'] as string | undefined;
  const effects = params['effects'] as unknown[] | undefined;
  const description = params['description'] as string | undefined;

  if (!styleId) {
    throw new Error('Missing required parameter: styleId');
  }

  try {
    let style = await figma.getStyleByIdAsync(styleId);
    if (!style || style.type !== 'EFFECT') {
      const normalizedInput = styleId.replace(/-/g, '/');
      const allStyles = await figma.getLocalEffectStylesAsync();
      style = allStyles.find(function(s) { return s.name === styleId || s.name === normalizedInput; }) as EffectStyle | null;
    }
    if (!style || style.type !== 'EFFECT') {
      throw new Error(`Effect style not found: "${styleId}". Pass a style ID or name (e.g. "shadow/md").`);
    }

    const effectStyle = style as EffectStyle;
    const updatedProperties: string[] = [];

    if (name !== undefined) {
      effectStyle.name = name;
      updatedProperties.push('name');
    }

    if (description !== undefined) {
      effectStyle.description = description;
      updatedProperties.push('description');
    }

    if (effects !== undefined) {
      if (!Array.isArray(effects) || effects.length === 0) {
        throw new Error('effects must be a non-empty array');
      }

      effectStyle.effects = (effects as Array<Record<string, unknown>>).map(
        buildValidStyleEffect,
      );
      updatedProperties.push('effects');
    }

    return {
      id: effectStyle.id,
      name: effectStyle.name,
      key: effectStyle.key,
      effects: effectStyle.effects,
      updatedProperties,
    };
  } catch (error) {
    throw new Error(
      `Error updating effect style: ${(error as Error).message}`,
    );
  }
}

export async function deleteEffectStyle(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const styleId = params['styleId'] as string | undefined;

  if (!styleId) {
    throw new Error('Missing required parameter: styleId');
  }

  try {
    let style = await figma.getStyleByIdAsync(styleId);
    if (!style || style.type !== 'EFFECT') {
      const normalizedInput = styleId.replace(/-/g, '/');
      const allStyles = await figma.getLocalEffectStylesAsync();
      style = allStyles.find(function(s) { return s.name === styleId || s.name === normalizedInput; }) as EffectStyle | null;
    }
    if (!style || style.type !== 'EFFECT') {
      throw new Error(`Effect style not found: "${styleId}". Pass a style ID or name (e.g. "shadow/md").`);
    }

    const styleName = style.name;
    const styleIdCopy = style.id;

    style.remove();

    return {
      id: styleIdCopy,
      name: styleName,
    };
  } catch (error) {
    throw new Error(
      `Error deleting effect style: ${(error as Error).message}`,
    );
  }
}
