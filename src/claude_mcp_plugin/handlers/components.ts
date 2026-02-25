import { debugLog } from '../utils/helpers';

export async function getStyles(): Promise<Record<string, unknown>> {
  const styles = {
    colors: await figma.getLocalPaintStylesAsync(),
    texts: await figma.getLocalTextStylesAsync(),
    effects: await figma.getLocalEffectStylesAsync(),
    grids: await figma.getLocalGridStylesAsync(),
  };

  return {
    colors: styles.colors.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      paint: style.paints[0],
    })),
    texts: styles.texts.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      fontSize: style.fontSize,
      fontName: style.fontName,
    })),
    effects: styles.effects.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
    })),
    grids: styles.grids.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
    })),
  };
}

export async function getLocalComponents(): Promise<Record<string, unknown>> {
  await figma.loadAllPagesAsync();

  const components = figma.root.findAllWithCriteria({
    types: ['COMPONENT'],
  });

  return {
    count: components.length,
    components: components.map((component) => ({
      id: component.id,
      name: component.name,
      key: 'key' in component ? component.key : null,
    })),
  };
}

export async function createComponentInstance(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const componentKey = params['componentKey'] as string | undefined;
  const x = params['x'] !== undefined ? (params['x'] as number) : 0;
  const y = params['y'] !== undefined ? (params['y'] as number) : 0;
  const parentId = params['parentId'] as string | undefined;

  if (!componentKey) {
    throw new Error('Missing componentKey parameter');
  }

  try {
    let component: ComponentNode | null = null;

    // First, try to find as a local component by ID (format like "123:456")
    if (componentKey.includes(':')) {
      debugLog(`Trying to find local component with ID: ${componentKey}...`);
      const localNode = await figma.getNodeByIdAsync(componentKey);
      if (localNode !== null && localNode.type === 'COMPONENT') {
        component = localNode as ComponentNode;
        debugLog(`Found local component "${component.name}"`);
      }
    }

    // If not found locally, try to import as remote component by key
    if (!component) {
      debugLog(
        `Trying to import remote component with key: ${componentKey}...`,
      );
      try {
        component = await figma.importComponentByKeyAsync(componentKey);
        if (component) {
          debugLog(`Imported remote component "${component.name}"`);
        }
      } catch (importError) {
        const errMsg =
          importError instanceof Error
            ? importError.message
            : String(importError);
        console.error(`Failed to import remote component: ${errMsg}`);
        // Don't throw yet - provide helpful error message below
      }
    }

    if (!component) {
      throw new Error(
        `Component not found. For local components, use the component's node ID (e.g., "123:456"). For library components, use the component key. Key provided: "${componentKey}"`,
      );
    }

    // Create instance and set properties
    debugLog(`Creating instance of "${component.name}"...`);
    const instance = component.createInstance();
    instance.x = x;
    instance.y = y;

    // Add to parent or current page
    if (parentId !== undefined) {
      const parent = await figma.getNodeByIdAsync(parentId);
      if (!parent) {
        throw new Error(`Parent node with ID ${parentId} not found`);
      }
      if ('appendChild' in parent) {
        (parent as ChildrenMixin).appendChild(instance);
      } else {
        throw new Error(
          `Parent node "${parent.name}" cannot contain children (type: ${parent.type})`,
        );
      }
    } else {
      figma.currentPage.appendChild(instance);
    }

    debugLog(
      `Component instance "${instance.name}" created successfully at (${x}, ${y})`,
    );

    const mainComponent = instance.mainComponent;
    return {
      id: instance.id,
      name: instance.name,
      x: instance.x,
      y: instance.y,
      width: instance.width,
      height: instance.height,
      componentId: mainComponent !== null ? mainComponent.id : null,
      parentId:
        parentId !== undefined ? parentId : figma.currentPage.id,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error(`Error in createComponentInstance: ${errorMessage}`);
    throw new Error(
      errorMessage ||
        `Failed to create component instance for "${componentKey}"`,
    );
  }
}

export async function getRemoteComponents(): Promise<Record<string, unknown>> {
  try {
    // Check if figma.teamLibrary is available
    if (!figma.teamLibrary) {
      console.error('Error: figma.teamLibrary API is not available');
      throw new Error(
        'The figma.teamLibrary API is not available in this context',
      );
    }

    // Check if figma.teamLibrary.getAvailableComponentsAsync exists
    const teamLibraryAny = figma.teamLibrary as unknown as { getAvailableComponentsAsync?: () => Promise<unknown[]> };
    if (!teamLibraryAny.getAvailableComponentsAsync) {
      console.error(
        'Error: figma.teamLibrary.getAvailableComponentsAsync is not available',
      );
      throw new Error(
        'The getAvailableComponentsAsync method is not available',
      );
    }

    debugLog('Starting remote components retrieval...');

    // Set up a manual timeout to detect deadlocks
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(
            'Internal timeout while retrieving remote components (15s)',
          ),
        );
      }, 15000);
    });

    // Execute the request with a manual timeout.
    // `any[]` is required because @figma/plugin-typings does not expose a typed
    // return for getAvailableComponentsAsync (it is not in the public typings).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchPromise: Promise<any[]> = teamLibraryAny.getAvailableComponentsAsync();

    // Use Promise.race to implement the timeout
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let teamComponents: any[];
    try {
      teamComponents = await Promise.race([fetchPromise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }

    debugLog(`Retrieved ${teamComponents.length} remote components`);

    return {
      success: true,
      count: teamComponents.length,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      components: teamComponents.map((component: any) => ({
        key: component.key,
        name: component.name,
        description:
          component.description !== undefined ? component.description : '',
        libraryName: component.libraryName,
      })),
    };
  } catch (error) {
    const err = error as Error;
    console.error(
      `Detailed error retrieving remote components: ${err.message !== undefined ? err.message : 'Unknown error'}`,
    );
    console.error(
      `Stack trace: ${err.stack !== undefined ? err.stack : 'Not available'}`,
    );

    throw new Error(
      `Error retrieving remote components: ${err.message}`,
    );
  }
}

export async function detachInstance(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const nodeId = params['nodeId'] as string | undefined;

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    if (node.type !== 'INSTANCE') {
      throw new Error(
        `Node with ID ${nodeId} is not an INSTANCE. Only component instances can be detached.`,
      );
    }

    const detached = (node as InstanceNode).detachInstance();

    return {
      id: detached.id,
      name: detached.name,
      type: detached.type,
    };
  } catch (error) {
    throw new Error(
      `Error detaching instance: ${(error as Error).message}`,
    );
  }
}

export async function createComponent(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const nodeId = params['nodeId'] as string | undefined;

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    const convertibleTypes = [
      'FRAME',
      'GROUP',
      'RECTANGLE',
      'ELLIPSE',
      'POLYGON',
      'STAR',
      'VECTOR',
      'TEXT',
      'LINE',
    ];
    if (!convertibleTypes.includes(node.type)) {
      throw new Error(
        `Node with ID ${nodeId} is of type ${node.type} and cannot be converted to a component. Only FRAME, GROUP, and shape nodes can be converted.`,
      );
    }

    const component = figma.createComponentFromNode(
      node as FrameNode | GroupNode | RectangleNode | EllipseNode | PolygonNode | StarNode | VectorNode | TextNode | LineNode,
    );

    return {
      id: component.id,
      name: component.name,
      key: component.key,
    };
  } catch (error) {
    throw new Error(
      `Error creating component: ${(error as Error).message}`,
    );
  }
}

export async function createComponentSet(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const nodeIds = params['nodeIds'] as string[] | undefined;
  const name = params['name'] as string | undefined;

  if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length < 1) {
    throw new Error(
      'Must provide at least one nodeId to create a component set',
    );
  }

  try {
    const components: ComponentNode[] = [];
    for (const nodeId of nodeIds) {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }

      if (node.type === 'COMPONENT') {
        components.push(node as ComponentNode);
      } else if (node.type === 'FRAME' || node.type === 'GROUP') {
        const component = figma.createComponentFromNode(
          node as FrameNode | GroupNode,
        );
        components.push(component);
      } else {
        throw new Error(
          `Node with ID ${nodeId} is of type ${node.type}. Only COMPONENT, FRAME, or GROUP nodes can be used in a component set.`,
        );
      }
    }

    const parent = components[0].parent;
    const componentSet = figma.combineAsVariants(components, parent as BaseNode & ChildrenMixin);

    if (name !== undefined) {
      componentSet.name = name;
    }

    return {
      id: componentSet.id,
      name: componentSet.name,
      variantCount: components.length,
    };
  } catch (error) {
    throw new Error(
      `Error creating component set: ${(error as Error).message}`,
    );
  }
}

export async function addComponentProperty(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const nodeId = params['nodeId'] as string | undefined;
  const propertyName = params['propertyName'] as string | undefined;
  const type = params['type'] as string | undefined;
  const defaultValue = params['defaultValue'];

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }
  if (!propertyName) {
    throw new Error('Missing propertyName parameter');
  }
  if (!type) {
    throw new Error('Missing type parameter');
  }

  const validTypes = ['BOOLEAN', 'TEXT', 'INSTANCE_SWAP', 'VARIANT'];
  if (!validTypes.includes(type)) {
    throw new Error(
      `Invalid type: ${type}. Must be one of: ${validTypes.join(', ')}`,
    );
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
      throw new Error(
        `Node must be a COMPONENT or COMPONENT_SET, got: ${node.type}`,
      );
    }

    // Determine default value based on type
    let actualDefaultValue: unknown = defaultValue;
    if (type === 'BOOLEAN' && actualDefaultValue === undefined) {
      actualDefaultValue = true;
    } else if (type === 'TEXT' && actualDefaultValue === undefined) {
      actualDefaultValue = '';
    } else if (type === 'VARIANT' && actualDefaultValue === undefined) {
      actualDefaultValue = 'Default';
    } else if (type === 'INSTANCE_SWAP' && actualDefaultValue === undefined) {
      throw new Error(
        'INSTANCE_SWAP type requires a defaultValue (component key)',
      );
    }

    const componentNode = node as ComponentNode | ComponentSetNode;
    const fullPropertyName = componentNode.addComponentProperty(
      propertyName,
      type as ComponentPropertyType,
      actualDefaultValue as string | boolean,
    );

    return {
      nodeId: node.id,
      nodeName: node.name,
      propertyName: fullPropertyName,
      type: type,
      defaultValue: actualDefaultValue,
    };
  } catch (error) {
    throw new Error(
      `Error adding component property: ${(error as Error).message}`,
    );
  }
}

export async function editComponentProperty(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const nodeId = params['nodeId'] as string | undefined;
  const propertyName = params['propertyName'] as string | undefined;
  const newName = params['newName'] as string | undefined;
  const newDefaultValue = params['newDefaultValue'];
  const preferredValues = params['preferredValues'];

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }
  if (!propertyName) {
    throw new Error('Missing propertyName parameter');
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
      throw new Error(
        `Node must be a COMPONENT or COMPONENT_SET, got: ${node.type}`,
      );
    }

    // Build the update object with only provided fields
    const updateObj: Record<string, unknown> = {};
    if (newName !== undefined) {
      updateObj['name'] = newName;
    }
    if (newDefaultValue !== undefined) {
      updateObj['defaultValue'] = newDefaultValue;
    }
    if (preferredValues !== undefined) {
      updateObj['preferredValues'] = preferredValues;
    }

    if (Object.keys(updateObj).length === 0) {
      throw new Error(
        'Must provide at least one of: newName, newDefaultValue, or preferredValues',
      );
    }

    const componentNode = node as ComponentNode | ComponentSetNode;
    const updatedPropertyName = componentNode.editComponentProperty(
      propertyName,
      updateObj as Parameters<typeof componentNode.editComponentProperty>[1],
    );

    return {
      nodeId: node.id,
      nodeName: node.name,
      oldPropertyName: propertyName,
      newPropertyName: updatedPropertyName,
      updates: updateObj,
    };
  } catch (error) {
    throw new Error(
      `Error editing component property: ${(error as Error).message}`,
    );
  }
}

export async function deleteComponentProperty(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const nodeId = params['nodeId'] as string | undefined;
  const propertyName = params['propertyName'] as string | undefined;

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }
  if (!propertyName) {
    throw new Error('Missing propertyName parameter');
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
      throw new Error(
        `Node must be a COMPONENT or COMPONENT_SET, got: ${node.type}`,
      );
    }

    const componentNode = node as ComponentNode | ComponentSetNode;
    componentNode.deleteComponentProperty(propertyName);

    return {
      nodeId: node.id,
      nodeName: node.name,
      deletedPropertyName: propertyName,
    };
  } catch (error) {
    throw new Error(
      `Error deleting component property: ${(error as Error).message}`,
    );
  }
}

export async function setComponentPropertyReferences(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const nodeId = params['nodeId'] as string | undefined;
  const references = params['references'];

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }
  if (!references || typeof references !== 'object') {
    throw new Error(
      'Missing or invalid references parameter (must be an object)',
    );
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    if (!('componentPropertyReferences' in node)) {
      throw new Error(
        `Node does not support componentPropertyReferences. It must be a sublayer of a component.`,
      );
    }

    // Set the references
    // For boolean visibility: { visible: "PropertyName#123:456" }
    // For text content: { characters: "TextProperty#123:456" }
    // For instance swap: { mainComponent: "SwapProperty#123:456" }
    type ComponentPropertyRefs = { [nodeProperty in 'visible' | 'characters' | 'mainComponent']?: string } | null;
    (node as SceneNodeMixin).componentPropertyReferences =
      references as ComponentPropertyRefs;

    const refNode = node as SceneNodeMixin;
    return {
      nodeId: node.id,
      nodeName: node.name,
      references: refNode.componentPropertyReferences,
    };
  } catch (error) {
    throw new Error(
      `Error setting component property references: ${(error as Error).message}`,
    );
  }
}

export async function getComponentProperties(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const nodeId = params['nodeId'] as string | undefined;

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }

    if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
      throw new Error(
        `Node must be a COMPONENT or COMPONENT_SET, got: ${node.type}`,
      );
    }

    const componentNode = node as ComponentNode | ComponentSetNode;
    const definitions =
      componentNode.componentPropertyDefinitions !== undefined
        ? componentNode.componentPropertyDefinitions
        : {};

    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      properties: definitions,
    };
  } catch (error) {
    throw new Error(
      `Error getting component properties: ${(error as Error).message}`,
    );
  }
}
