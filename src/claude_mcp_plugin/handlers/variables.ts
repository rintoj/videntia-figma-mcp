// Variable management handlers for the Claude Figma MCP plugin.
// Covers: variable CRUD, collections, mode management, color scales,
// audit, schema import/export, and theme application.

import { debugLog, sendProgressUpdate, generateCommandId } from '../utils/helpers';
import { formatVariableValue } from '../utils/color';
import type { RgbaColor, VariableResolvedType, VariableValue } from '../types';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

// Fetches both collections and variables in a single parallel round-trip,
// avoiding the 2× sequential IPC cost of calling each API separately.
async function fetchVariableData(): Promise<{
  collections: VariableCollection[];
  variables: Variable[];
}> {
  const [collections, variables] = await Promise.all([
    figma.variables.getLocalVariableCollectionsAsync(),
    figma.variables.getLocalVariablesAsync(),
  ]);
  return { collections, variables };
}

function findCollectionIn(
  collections: VariableCollection[],
  collectionIdOrName: string,
): VariableCollection {
  let collection = collections.find(c => c.id === collectionIdOrName);
  if (!collection) {
    collection = collections.find(c => c.name === collectionIdOrName);
  }
  if (!collection) {
    throw new Error(`Collection not found: ${collectionIdOrName}`);
  }
  return collection;
}

function findVariableIn(
  variables: Variable[],
  collections: VariableCollection[],
  variableIdOrName: string,
  collectionId?: string,
): Variable {
  let variable = variables.find(v => v.id === variableIdOrName);

  if (!variable && collectionId !== undefined && collectionId !== null) {
    const collection = findCollectionIn(collections, collectionId);
    variable = variables.find(
      v =>
        v.name === variableIdOrName &&
        v.variableCollectionId === collection.id,
    );
  }

  if (!variable) {
    throw new Error(`Variable not found: ${variableIdOrName}`);
  }

  return variable;
}

// Legacy single-arg helpers kept for callers that only need a collection
// and don't require variables in the same call.
export async function findCollection(
  collectionIdOrName: string,
): Promise<VariableCollection> {
  const collections =
    await figma.variables.getLocalVariableCollectionsAsync();
  return findCollectionIn(collections, collectionIdOrName);
}

async function findVariable(
  variableIdOrName: string,
  collectionId?: string,
): Promise<Variable> {
  const { collections, variables } = await fetchVariableData();
  return findVariableIn(variables, collections, variableIdOrName, collectionId);
}

function calculateColorScaleFigma(
  baseColor: RgbaColor,
  backgroundColor: RgbaColor,
): Record<string, RgbaColor> {
  const mixPercentages: Record<string, number> = {
    '50': 0.05,
    '100': 0.10,
    '200': 0.20,
    '300': 0.30,
    '400': 0.40,
    '500': 0.50,
    '600': 0.60,
    '700': 0.70,
    '800': 0.80,
    '900': 0.90,
  };

  const scale: Record<string, RgbaColor> = {};
  for (const level of Object.keys(mixPercentages)) {
    const mix = mixPercentages[level];
    const invMix = 1 - mix;
    scale[level] = {
      r: baseColor.r * mix + backgroundColor.r * invMix,
      g: baseColor.g * mix + backgroundColor.g * invMix,
      b: baseColor.b * mix + backgroundColor.b * invMix,
      a: 1.0,
    };
  }

  return scale;
}

function getStandardSchemaFigma(includeChartColors: boolean = false): string[] {
  const baseVariables = [
    // Surfaces
    'background',
    'foreground',
    'card',
    'card-foreground',
    'popover',
    'popover-foreground',
    // Brand
    'primary',
    'primary-foreground',
    'secondary',
    'secondary-foreground',
    'tertiary',
    'tertiary-foreground',
    'accent',
    'accent-foreground',
    // States
    'success',
    'success-foreground',
    'info',
    'info-foreground',
    'warning',
    'warning-foreground',
    'destructive',
    'destructive-foreground',
    // Interactive
    'link',
    'link-hover',
    // Feedback
    'overlay',
    'tooltip',
    'tooltip-foreground',
    'placeholder',
    'placeholder-foreground',
    // Utility
    'muted',
    'muted-foreground',
    'selected',
    'selected-foreground',
    'border',
    'input',
    'ring',
  ];

  const scaleColors = [
    'primary',
    'secondary',
    'accent',
    'success',
    'info',
    'warning',
    'destructive',
  ];
  const levels = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
  const scaleVariables: string[] = [];
  for (const color of scaleColors) {
    for (const level of levels) {
      scaleVariables.push(`${color}-${level}`);
    }
  }

  let allVariables = [...baseVariables, ...scaleVariables];

  if (includeChartColors) {
    allVariables.push(
      'chart-1',
      'chart-2',
      'chart-3',
      'chart-4',
      'chart-5',
      'chart-6',
      'chart-7',
      'chart-8',
    );
  }

  return allVariables;
}

function getDefaultDarkTheme(): Record<string, RgbaColor> {
  return {
    // Surfaces
    'background': { r: 0.059, g: 0.063, b: 0.067, a: 1.0 },
    'foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    'card': { r: 0.059, g: 0.063, b: 0.067, a: 1.0 },
    'card-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    'popover': { r: 0.059, g: 0.063, b: 0.067, a: 1.0 },
    'popover-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    // Brand colors
    'primary': { r: 0.639, g: 0.902, b: 0.208, a: 1.0 },
    'primary-foreground': { r: 0.090, g: 0.102, b: 0.067, a: 1.0 },
    'secondary': { r: 0.149, g: 0.153, b: 0.153, a: 1.0 },
    'secondary-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    'tertiary': { r: 0.059, g: 0.063, b: 0.067, a: 1.0 },
    'tertiary-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    'accent': { r: 0.149, g: 0.153, b: 0.153, a: 1.0 },
    'accent-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    // State colors
    'success': { r: 0.078, g: 0.325, b: 0.176, a: 1.0 },
    'success-foreground': { r: 0.576, g: 0.773, b: 0.655, a: 1.0 },
    'info': { r: 0.118, g: 0.251, b: 0.686, a: 1.0 },
    'info-foreground': { r: 0.576, g: 0.773, b: 0.992, a: 1.0 },
    'warning': { r: 0.863, g: 0.696, b: 0.149, a: 1.0 },
    'warning-foreground': { r: 0.090, g: 0.102, b: 0.067, a: 1.0 },
    'destructive': { r: 0.863, g: 0.149, b: 0.149, a: 1.0 },
    'destructive-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    // Interactive
    'link': { r: 0.576, g: 0.773, b: 0.992, a: 1.0 },
    'link-hover': { r: 0.384, g: 0.608, b: 0.929, a: 1.0 },
    // Feedback
    'overlay': { r: 0.000, g: 0.000, b: 0.000, a: 0.8 },
    'tooltip': { r: 0.059, g: 0.063, b: 0.067, a: 1.0 },
    'tooltip-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    'placeholder': { r: 0.450, g: 0.450, b: 0.450, a: 1.0 },
    'placeholder-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    // Utility
    'muted': { r: 0.149, g: 0.153, b: 0.153, a: 1.0 },
    'muted-foreground': { r: 0.639, g: 0.647, b: 0.655, a: 1.0 },
    'selected': { r: 0.149, g: 0.153, b: 0.153, a: 1.0 },
    'selected-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    'border': { r: 0.149, g: 0.153, b: 0.153, a: 1.0 },
    'input': { r: 0.149, g: 0.153, b: 0.153, a: 1.0 },
    'ring': { r: 0.639, g: 0.902, b: 0.208, a: 1.0 },
  };
}

function getCategoryForVariable(name: string): string {
  if (/^(background|foreground|card|popover)/.test(name)) return 'surfaces';
  if (/^(primary|secondary|tertiary|accent)/.test(name)) return 'brand';
  if (/^(success|info|warning|destructive)/.test(name)) return 'states';
  if (/^(link)/.test(name)) return 'interactive';
  if (/^(overlay|tooltip|placeholder)/.test(name)) return 'feedback';
  if (/^(muted|selected|border|input|ring)/.test(name)) return 'utility';
  if (/^chart-/.test(name)) return 'chart';
  return 'unknown';
}

function getDescriptionForVariable(name: string): string {
  const descriptions: Record<string, string> = {
    background: 'Background color',
    foreground: 'Foreground text color',
    primary: 'Primary brand color',
    success: 'Success state color',
    info: 'Info state color',
    warning: 'Warning state color',
    destructive: 'Destructive/error state color',
  };

  if (name.endsWith('-foreground')) {
    const base = name.slice(0, -11);
    return `Text/icons for ${base}`;
  }

  if (/-\d+$/.test(name)) {
    return 'Color scale variant';
  }

  return descriptions[name] !== undefined ? descriptions[name] : 'Theme variable';
}

// ---------------------------------------------------------------------------
// Public handlers
// ---------------------------------------------------------------------------

export async function getVariables(): Promise<Record<string, unknown>> {
  const { variables, collections } = await fetchVariableData();

  return {
    variables: variables.map(v => ({
      id: v.id,
      name: v.name,
      key: v.key,
      type: v.resolvedType,
      description: v.description || '',
      collectionId: v.variableCollectionId,
      values: Object.entries(v.valuesByMode).map(([modeId, value]) => {
        const knownTypes: VariableResolvedType[] = ['COLOR', 'FLOAT', 'STRING', 'BOOLEAN'];
        const resolvedType = knownTypes.includes(v.resolvedType as VariableResolvedType)
          ? (v.resolvedType as VariableResolvedType)
          : 'STRING' as VariableResolvedType;
        return {
          modeId,
          value: formatVariableValue(value as VariableValue, resolvedType),
        };
      }),
    })),
    collections: collections.map(c => ({
      id: c.id,
      name: c.name,
      variableIds: c.variableIds,
      modes: c.modes.map(m => ({ id: m.modeId, name: m.name })),
    })),
  };
}

export async function getBoundVariables(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const nodeId = params['nodeId'] as string;

  if (!nodeId) {
    throw new Error('nodeId is required');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  const bindings: Array<Record<string, unknown>> = [];
  const variables = await figma.variables.getLocalVariablesAsync();
  const variableMap = new Map(variables.map(v => [v.id, v]));

  if ('boundVariables' in node && node.boundVariables) {
    for (const [field, binding] of Object.entries(
      node.boundVariables as Record<string, unknown>,
    )) {
      if (binding) {
        const processBinding = (
          b: Record<string, unknown>,
          fieldPath: string,
        ) => {
          if (b && b['id']) {
            const variableEntry = variableMap.get(b['id'] as string);
            bindings.push({
              field: fieldPath,
              variableId: b['id'],
              variableName: variableEntry !== undefined ? variableEntry.name : 'Unknown',
              variableType: variableEntry !== undefined ? variableEntry.resolvedType : 'Unknown',
            });
          }
        };

        if (Array.isArray(binding)) {
          binding.forEach((b: Record<string, unknown>, index: number) => {
            processBinding(b, `${field}/${index}`);
          });
        } else {
          processBinding(binding as Record<string, unknown>, field);
        }
      }
    }
  }

  return {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    bindings,
  };
}

export async function bindVariable(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const nodeId = params['nodeId'] as string;
  const variableId = params['variableId'] as string;
  const field = params['field'] as string;

  if (!nodeId || !variableId || !field) {
    throw new Error('nodeId, variableId, and field are required');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) {
    throw new Error(`Variable not found: ${variableId}`);
  }

  const fieldParts = field.split('/');

  try {
    if (fieldParts[0] === 'fills' && fieldParts.length >= 2) {
      const fillIndex = parseInt(fieldParts[1]);
      if (isNaN(fillIndex)) {
        throw new Error(`Invalid fill index: ${fieldParts[1]}`);
      }

      if ('fills' in node) {
        const nodeWithFills = node as GeometryMixin;
        const currentFills = nodeWithFills.fills;
        const fillsCopy: Paint[] =
          currentFills !== figma.mixed ? [...(currentFills as ReadonlyArray<Paint>)] : [];

        while (fillsCopy.length <= fillIndex) {
          fillsCopy.push({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } } as SolidPaint);
        }
        nodeWithFills.fills = fillsCopy;

        const updatedFills: Paint[] = [...(nodeWithFills.fills as ReadonlyArray<Paint>)];
        updatedFills[fillIndex] = figma.variables.setBoundVariableForPaint(
          updatedFills[fillIndex] as SolidPaint,
          'color',
          variable,
        );
        nodeWithFills.fills = updatedFills;
      }
    } else if (fieldParts[0] === 'strokes' && fieldParts.length >= 2) {
      const strokeIndex = parseInt(fieldParts[1]);
      if (isNaN(strokeIndex)) {
        throw new Error(`Invalid stroke index: ${fieldParts[1]}`);
      }

      if ('strokes' in node) {
        const nodeWithStrokes = node as MinimalStrokesMixin;
        const strokesCopy: Paint[] = [...nodeWithStrokes.strokes];

        while (strokesCopy.length <= strokeIndex) {
          strokesCopy.push({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } } as SolidPaint);
        }
        nodeWithStrokes.strokes = strokesCopy;

        const updatedStrokes: Paint[] = [...nodeWithStrokes.strokes];
        updatedStrokes[strokeIndex] = figma.variables.setBoundVariableForPaint(
          updatedStrokes[strokeIndex] as SolidPaint,
          'color',
          variable,
        );
        nodeWithStrokes.strokes = updatedStrokes;
      }
    } else {
      const propertyName = fieldParts[0] as VariableBindableNodeField;
      (node as SceneNode & { setBoundVariable: (field: VariableBindableNodeField, variable: Variable | null) => void }).setBoundVariable(
        propertyName,
        variable,
      );
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to bind variable: ${errMsg}. Make sure the variable type (${variable.resolvedType}) is compatible with the field "${field}"`,
    );
  }

  return {
    nodeId: node.id,
    nodeName: node.name,
    field,
    variableId: variable.id,
    variableName: variable.name,
    variableType: variable.resolvedType,
  };
}

export async function unbindVariable(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const nodeId = params['nodeId'] as string;
  const field = params['field'] as string;

  if (!nodeId || !field) {
    throw new Error('nodeId and field are required');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  const fieldParts = field.split('/');

  try {
    if (fieldParts[0] === 'fills' && fieldParts.length >= 2) {
      const fillIndex = parseInt(fieldParts[1]);
      if (isNaN(fillIndex)) {
        throw new Error(`Invalid fill index: ${fieldParts[1]}`);
      }

      if ('fills' in node) {
        const nodeWithFills = node as GeometryMixin;
        const currentFills = nodeWithFills.fills;
        if (currentFills !== figma.mixed && Array.isArray(currentFills)) {
          const fills: Paint[] = [...(currentFills as ReadonlyArray<Paint>)];
          const fillEntry = fills[fillIndex] as unknown as Record<string, unknown>;
          if (fillEntry && fillEntry['boundVariables']) {
            const newFill = Object.assign({}, fillEntry) as Record<string, unknown>;
            delete newFill['boundVariables'];
            fills[fillIndex] = newFill as unknown as Paint;
            nodeWithFills.fills = fills;
          }
        }
      }
    } else if (fieldParts[0] === 'strokes' && fieldParts.length >= 2) {
      const strokeIndex = parseInt(fieldParts[1]);
      if (isNaN(strokeIndex)) {
        throw new Error(`Invalid stroke index: ${fieldParts[1]}`);
      }

      if ('strokes' in node) {
        const nodeWithStrokes = node as MinimalStrokesMixin;
        const strokes: Paint[] = [...nodeWithStrokes.strokes];
        const strokeEntry = strokes[strokeIndex] as unknown as Record<string, unknown>;
        if (strokeEntry && strokeEntry['boundVariables']) {
          const newStroke = Object.assign({}, strokeEntry) as Record<string, unknown>;
          delete newStroke['boundVariables'];
          strokes[strokeIndex] = newStroke as unknown as Paint;
          nodeWithStrokes.strokes = strokes;
        }
      }
    } else {
      const propertyName = fieldParts[0] as VariableBindableNodeField;
      (node as SceneNode & { setBoundVariable: (field: VariableBindableNodeField, variable: Variable | null) => void }).setBoundVariable(
        propertyName,
        null,
      );
    }

    return {
      nodeId: node.id,
      nodeName: node.name,
      field,
      success: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to unbind variable: ${errMsg}`);
  }
}

// 1. get_variable_collections
export async function getVariableCollections(): Promise<Record<string, unknown>> {
  const { collections, variables } = await fetchVariableData();

  return {
    collections: collections.map(c => {
      const collectionVariables = variables.filter(
        v => v.variableCollectionId === c.id,
      );
      return {
        id: c.id,
        name: c.name,
        modes: c.modes.map(m => m.name),
        variableCount: collectionVariables.length,
        defaultMode:
          c.modes[0] !== undefined && c.modes[0] !== null ? c.modes[0].name : 'Mode 1',
      };
    }),
  };
}

// 2. create_variable_collection
export async function createVariableCollection(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const name = params['name'] as string;
  const defaultMode = params['defaultMode'] as string | undefined;

  const collection = figma.variables.createVariableCollection(name);
  const mode = collection.modes[0];
  collection.renameMode(mode.modeId, defaultMode !== undefined && defaultMode !== null ? defaultMode : 'dark');

  return {
    collectionId: collection.id,
    name: collection.name,
    defaultMode: defaultMode !== undefined && defaultMode !== null ? defaultMode : 'dark',
    success: true,
  };
}

// 3. get_collection_info
export async function getCollectionInfo(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const { collections: _cols, variables: allVariables } = await fetchVariableData();
  const collection = findCollectionIn(_cols, collectionId);
  const collectionVariables = allVariables.filter(
    v => v.variableCollectionId === collection.id,
  );

  const baseCount = collectionVariables.filter(
    v => !/-\d+$/.test(v.name) && !v.name.startsWith('chart-'),
  ).length;
  const scaleCount = collectionVariables.filter(v =>
    /-(50|100|200|300|400|500|600|700|800|900)$/.test(v.name),
  ).length;
  const chartCount = collectionVariables.filter(v =>
    v.name.startsWith('chart-'),
  ).length;

  return {
    id: collection.id,
    name: collection.name,
    modes: collection.modes.map(m => m.name),
    defaultMode:
      collection.modes[0] !== undefined && collection.modes[0] !== null
        ? collection.modes[0].name
        : 'Mode 1',
    variableCount: collectionVariables.length,
    variablesByCategory: {
      base: baseCount,
      scales: scaleCount,
      chart: chartCount,
    },
  };
}

// 3b. rename_variable_collection
export async function renameVariableCollection(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const newName = params['newName'] as string;

  if (!newName) {
    throw new Error('Missing newName parameter');
  }

  const collection = await findCollection(collectionId);
  const oldName = collection.name;
  collection.name = newName;

  return {
    id: collection.id,
    oldName,
    newName: collection.name,
    success: true,
  };
}

// 3c. delete_variable_collection
export async function deleteVariableCollection(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;

  const { collections: _colsDvc, variables: allVariables } = await fetchVariableData();
  const collection = findCollectionIn(_colsDvc, collectionId);
  const collectionName = collection.name;
  const collectionIdValue = collection.id;
  const variableCount = allVariables.filter(
    v => v.variableCollectionId === collection.id,
  ).length;

  collection.remove();

  return {
    id: collectionIdValue,
    name: collectionName,
    variablesDeleted: variableCount,
    success: true,
  };
}

// 4. create_variable
export async function createVariable(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const name = params['name'] as string;
  const type = params['type'] as string | undefined;
  const value = params['value'] as RgbaColor | number | string | boolean;
  const mode = params['mode'] as string | undefined;

  const collection = await findCollection(collectionId);

  const variableType = (type !== undefined && type !== null ? type : 'COLOR') as VariableResolvedDataType;

  const variable = figma.variables.createVariable(name, collection, variableType);
  const targetMode =
    mode !== undefined && mode !== null
      ? collection.modes.find(m => m.name === mode)
      : null;
  const modeId =
    targetMode !== undefined && targetMode !== null
      ? targetMode.modeId
      : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  let variableValue: VariableValue;
  if (variableType === 'COLOR') {
    const colorValue = value as RgbaColor;
    variableValue = {
      r: colorValue.r,
      g: colorValue.g,
      b: colorValue.b,
      a: colorValue.a !== undefined ? colorValue.a : 1.0,
    };
  } else {
    variableValue = value as number | string | boolean;
  }

  variable.setValueForMode(modeId, variableValue);

  return {
    variableId: variable.id,
    name: variable.name,
    type: variable.resolvedType,
    success: true,
  };
}

// 5. create_variables_batch
export async function createVariablesBatch(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const variableDefs = params['variables'] as Array<Record<string, unknown>>;
  const mode = params['mode'] as string | undefined;

  const collection = await findCollection(collectionId);
  const targetMode =
    mode !== undefined && mode !== null
      ? collection.modes.find(m => m.name === mode)
      : null;
  const modeId =
    targetMode !== undefined && targetMode !== null
      ? targetMode.modeId
      : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  const created: string[] = [];
  const failed: string[] = [];
  const variableIds: string[] = [];
  const errors: Array<{ name: string; error: string }> = [];

  for (const varDef of variableDefs) {
    try {
      const variableType = (
        varDef['type'] !== undefined && varDef['type'] !== null ? varDef['type'] : 'COLOR'
      ) as VariableResolvedDataType;
      const variable = figma.variables.createVariable(
        varDef['name'] as string,
        collection,
        variableType,
      );

      let variableValue: VariableValue;
      if (variableType === 'COLOR') {
        const colorValue = varDef['value'] as RgbaColor;
        variableValue = {
          r: colorValue.r,
          g: colorValue.g,
          b: colorValue.b,
          a: colorValue.a !== undefined ? colorValue.a : 1.0,
        };
      } else {
        variableValue = varDef['value'] as number | string | boolean;
      }

      variable.setValueForMode(modeId, variableValue);
      created.push(varDef['name'] as string);
      variableIds.push(variable.id);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      failed.push(varDef['name'] as string);
      errors.push({ name: varDef['name'] as string, error: errMsg });
    }
  }

  return {
    created: created.length,
    failed: failed.length,
    variableIds,
    errors,
  };
}

// 6. update_variable_value
export async function updateVariableValue(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const variableId = params['variableId'] as string;
  const collectionId = params['collectionId'] as string | undefined;
  const value = params['value'];
  const mode = params['mode'] as string | undefined;

  // Single parallel fetch — avoids the sequential findVariable() + getVariableCollectionByIdAsync() round-trip
  const { collections, variables } = await fetchVariableData();
  const variable = findVariableIn(variables, collections, variableId, collectionId);
  const collection = findCollectionIn(collections, variable.variableCollectionId);

  const targetMode =
    mode !== undefined && mode !== null
      ? collection.modes.find(m => m.name === mode)
      : null;
  const modeId =
    targetMode !== undefined && targetMode !== null
      ? targetMode.modeId
      : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  const variableType = variable.resolvedType;
  let variableValue: VariableValue;

  if (variableType === 'COLOR') {
    if (typeof value !== 'object' || (value as RgbaColor).r === undefined) {
      throw new Error(
        `Expected color value with r, g, b properties for COLOR variable "${variable.name}"`,
      );
    }
    const colorValue = value as RgbaColor;
    variableValue = {
      r: colorValue.r,
      g: colorValue.g,
      b: colorValue.b,
      a: colorValue.a !== undefined ? colorValue.a : 1.0,
    };
  } else if (variableType === 'FLOAT') {
    if (typeof value !== 'number') {
      throw new Error(
        `Expected number value for FLOAT variable "${variable.name}", got ${typeof value}`,
      );
    }
    variableValue = value;
  } else if (variableType === 'STRING') {
    if (typeof value !== 'string') {
      throw new Error(
        `Expected string value for STRING variable "${variable.name}", got ${typeof value}`,
      );
    }
    variableValue = value;
  } else if (variableType === 'BOOLEAN') {
    if (typeof value !== 'boolean') {
      throw new Error(
        `Expected boolean value for BOOLEAN variable "${variable.name}", got ${typeof value}`,
      );
    }
    variableValue = value;
  } else {
    throw new Error(`Unsupported variable type: ${variableType}`);
  }

  variable.setValueForMode(modeId, variableValue);

  return {
    variableId: variable.id,
    name: variable.name,
    type: variableType,
    updated: true,
  };
}

// 7. rename_variable
export async function renameVariable(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const variableId = params['variableId'] as string;
  const collectionId = params['collectionId'] as string | undefined;
  const newName = params['newName'] as string;

  const variable = await findVariable(variableId, collectionId);
  const oldName = variable.name;

  variable.name = newName;

  return {
    variableId: variable.id,
    oldName,
    newName: variable.name,
    success: true,
  };
}

// 8. delete_variable
export async function deleteVariable(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const variableId = params['variableId'] as string;
  const collectionId = params['collectionId'] as string | undefined;

  const variable = await findVariable(variableId, collectionId);
  const name = variable.name;
  const id = variable.id;

  variable.remove();

  return {
    variableId: id,
    name,
    deleted: true,
  };
}

// 9. delete_variables_batch
export async function deleteVariablesBatch(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const variableIds = params['variableIds'] as string[];
  const collectionId = params['collectionId'] as string | undefined;

  let deleted = 0;
  let failed = 0;
  const errors: Array<{ variableId: string; error: string }> = [];

  // Fetch once — avoids N×2 Figma IPC calls (one fetchVariableData per loop iter)
  const { collections, variables } = await fetchVariableData();

  for (const varId of variableIds) {
    try {
      const variable = findVariableIn(variables, collections, varId, collectionId);
      variable.remove();
      deleted++;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      failed++;
      errors.push({ variableId: varId, error: errMsg });
    }
  }

  return {
    deleted,
    failed,
    errors,
  };
}

// 10. audit_collection
export async function auditCollection(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const includeChartColors = params['includeChartColors'] as boolean | undefined;
  const customSchema = params['customSchema'] as string[] | undefined;

  const { collections: _cols, variables: allVariables } = await fetchVariableData();
  const collection = findCollectionIn(_cols, collectionId);
  const collectionVariables = allVariables.filter(
    v => v.variableCollectionId === collection.id,
  );

  const standardVariables =
    customSchema !== undefined && customSchema !== null
      ? customSchema
      : getStandardSchemaFigma(includeChartColors === true);
  const existingNames = collectionVariables.map(v => v.name);
  const expectedCount = includeChartColors === true ? 110 : 102;

  const existingSet = new Set(existingNames);
  const standardSet = new Set(standardVariables);
  const missing = standardVariables.filter(name => !existingSet.has(name));
  const nonStandard = existingNames.filter(name => !standardSet.has(name));

  const compliancePercentage = (
    ((existingNames.length - nonStandard.length) / expectedCount) *
    100
  ).toFixed(1);

  return {
    status:
      missing.length === 0 && nonStandard.length === 0
        ? 'Complete'
        : 'Incomplete',
    totalVariables: existingNames.length,
    expectedVariables: expectedCount,
    compliancePercentage: parseFloat(compliancePercentage),
    missing: {
      count: missing.length,
      variables: missing,
    },
    nonStandard: {
      count: nonStandard.length,
      variables: nonStandard.map(name => ({
        name,
        recommendation:
          'Review if needed or remove if not in standard schema',
        action: 'review',
      })),
    },
    existing: {
      count: existingNames.length,
      variables: existingNames,
    },
  };
}

// 11. validate_color_contrast
export async function validateColorContrast(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const mode = params['mode'] as string | undefined;
  const standard = params['standard'] as string | undefined;

  const { collections: _cols, variables: allVariables } = await fetchVariableData();
  const collection = findCollectionIn(_cols, collectionId);
  const collectionVariables = allVariables.filter(
    v => v.variableCollectionId === collection.id,
  );

  const targetMode =
    mode !== undefined && mode !== null
      ? collection.modes.find(m => m.name === mode)
      : null;
  const modeId =
    targetMode !== undefined && targetMode !== null
      ? targetMode.modeId
      : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  function getLuminance(color: RgbaColor): number {
    const linearize = (val: number) =>
      val <= 0.03928
        ? val / 12.92
        : Math.pow((val + 0.055) / 1.055, 2.4);
    const r = linearize(color.r);
    const g = linearize(color.g);
    const b = linearize(color.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function getContrastRatio(fg: RgbaColor, bg: RgbaColor): number {
    const lum1 = getLuminance(fg);
    const lum2 = getLuminance(bg);
    const lighter = Math.max(lum1, lum2);
    const darker = Math.min(lum1, lum2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  const pairs: Array<Record<string, unknown>> = [];
  const fgSuffix = '-foreground';
  const varByName = new Map(collectionVariables.map(v => [v.name, v]));

  for (const variable of collectionVariables) {
    if (variable.name.endsWith(fgSuffix)) {
      const baseName = variable.name.slice(0, -fgSuffix.length);
      const baseVariable = varByName.get(baseName);

      if (baseVariable) {
        const fgValue = variable.valuesByMode[modeId];
        const bgValue = baseVariable.valuesByMode[modeId];

        if (
          fgValue !== undefined &&
          fgValue !== null &&
          bgValue !== undefined &&
          bgValue !== null &&
          typeof fgValue === 'object' &&
          typeof bgValue === 'object'
        ) {
          const ratio = getContrastRatio(fgValue as RgbaColor, bgValue as RgbaColor);
          const minRatio = standard === 'AAA' ? 7.0 : 4.5;
          const pass = ratio >= minRatio;

          pairs.push({
            foreground: variable.name,
            background: baseVariable.name,
            ratio: parseFloat(ratio.toFixed(2)),
            pass,
            level: standard !== undefined && standard !== null ? standard : 'AA',
            recommendation: pass
              ? `Meets ${standard} standards`
              : `Increase contrast - needs ${minRatio}:1 for ${standard} normal text`,
          });
        }
      }
    }
  }

  const passed = pairs.filter(p => p['pass']).length;
  const failed = pairs.filter(p => !p['pass']).length;

  return {
    totalPairs: pairs.length,
    passed,
    failed,
    pairs,
  };
}

// 12. suggest_missing_variables
export async function suggestMissingVariables(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const useDefaults = params['useDefaults'];

  const { collections: _cols, variables: allVariables } = await fetchVariableData();
  const collection = findCollectionIn(_cols, collectionId);
  const collectionVariables = allVariables.filter(
    v => v.variableCollectionId === collection.id,
  );

  const standardVariables = getStandardSchemaFigma(false);
  const existingNames = collectionVariables.map(v => v.name);
  const existingNamesSet = new Set(existingNames);
  const missing = standardVariables.filter(name => !existingNamesSet.has(name));

  const defaultTheme = getDefaultDarkTheme();
  const backgroundColor = defaultTheme['background'];

  const suggestions = missing.map(name => {
    let suggestedValue: RgbaColor | null =
      useDefaults !== false
        ? (defaultTheme[name] !== undefined ? defaultTheme[name] : null)
        : null;

    if (
      useDefaults !== false &&
      (suggestedValue === null || suggestedValue === undefined) &&
      /-(50|100|200|300|400|500|600|700|800|900)$/.test(name)
    ) {
      const parts = name.split('-');
      const baseName = parts[0];
      const level = parts[1];
      const baseColor = defaultTheme[baseName];

      if (baseColor !== undefined) {
        const scale = calculateColorScaleFigma(baseColor, backgroundColor);
        suggestedValue = scale[level] !== undefined ? scale[level] : null;
      }
    }

    return {
      name,
      category: getCategoryForVariable(name),
      suggestedValue,
      description: getDescriptionForVariable(name),
    };
  });

  return {
    missingCount: missing.length,
    suggestions,
  };
}

// 13. apply_default_theme
export async function applyDefaultTheme(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const overwriteExisting = params['overwriteExisting'] as boolean | undefined;
  const includeChartColors = params['includeChartColors'] as boolean | undefined;

  const { collections: _cols, variables: allVariables } = await fetchVariableData();
  const collection = findCollectionIn(_cols, collectionId);
  const collectionVariables = allVariables.filter(
    v => v.variableCollectionId === collection.id,
  );
  const existingNames = new Set(collectionVariables.map(v => v.name));

  // Build a Map for O(1) lookups during overwrite passes.
  const varByName = new Map<string, Variable>();
  for (const v of collectionVariables) {
    varByName.set(v.name, v);
  }

  const defaultTheme = getDefaultDarkTheme();
  const backgroundColor = defaultTheme['background'];
  const modeId = collection.modes[0].modeId;

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const [name, value] of Object.entries(defaultTheme)) {
    if (existingNames.has(name)) {
      if (overwriteExisting === true) {
        const variable = varByName.get(name);
        if (variable !== undefined) {
          variable.setValueForMode(modeId, value);
        }
        updated++;
      } else {
        skipped++;
      }
    } else {
      const variable = figma.variables.createVariable(name, collection, 'COLOR');
      variable.setValueForMode(modeId, value);
      varByName.set(name, variable);
      created++;
    }
  }

  const scaleColors = [
    'primary',
    'secondary',
    'accent',
    'success',
    'info',
    'warning',
    'destructive',
  ];
  for (const colorName of scaleColors) {
    const baseColor = defaultTheme[colorName];
    if (baseColor !== undefined) {
      const scale = calculateColorScaleFigma(baseColor, backgroundColor);

      for (const [level, value] of Object.entries(scale)) {
        const varName = `${colorName}-${level}`;

        if (existingNames.has(varName)) {
          if (overwriteExisting === true) {
            const variable = varByName.get(varName);
            if (variable !== undefined) {
              variable.setValueForMode(modeId, value);
            }
            updated++;
          } else {
            skipped++;
          }
        } else {
          const variable = figma.variables.createVariable(varName, collection, 'COLOR');
          variable.setValueForMode(modeId, value);
          varByName.set(varName, variable);
          created++;
        }
      }
    }
  }

  if (includeChartColors === true) {
    const chartColors: RgbaColor[] = [
      { r: 0.639, g: 0.902, b: 0.208, a: 1.0 },
      { r: 0.118, g: 0.251, b: 0.686, a: 1.0 },
      { r: 0.863, g: 0.696, b: 0.149, a: 1.0 },
      { r: 0.863, g: 0.149, b: 0.149, a: 1.0 },
      { r: 0.576, g: 0.773, b: 0.992, a: 1.0 },
      { r: 0.078, g: 0.325, b: 0.176, a: 1.0 },
      { r: 0.980, g: 0.588, b: 0.118, a: 1.0 },
      { r: 0.639, g: 0.384, b: 0.863, a: 1.0 },
    ];

    for (let i = 0; i < chartColors.length; i++) {
      const varName = `chart-${i + 1}`;

      if (existingNames.has(varName)) {
        if (overwriteExisting === true) {
          const variable = collectionVariables.find(v => v.name === varName);
          if (variable !== undefined) {
            variable.setValueForMode(modeId, chartColors[i]);
          }
          updated++;
        } else {
          skipped++;
        }
      } else {
        const variable = figma.variables.createVariable(varName, collection, 'COLOR');
        variable.setValueForMode(modeId, chartColors[i]);
        created++;
      }
    }
  }

  return {
    created,
    updated,
    skipped,
    success: true,
    message: `Applied default ${includeChartColors === true ? 'dark theme with chart colors' : 'dark theme'} - ${created + updated} variables`,
  };
}

// 14. create_color_scale_set
export async function createColorScaleSet(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const colorName = params['colorName'] as string;
  const baseColor = params['baseColor'] as RgbaColor;
  const foregroundColor = params['foregroundColor'] as RgbaColor;
  const backgroundColor = params['backgroundColor'] as RgbaColor;
  const mode = params['mode'] as string | undefined;

  const collection = await findCollection(collectionId);
  const targetMode =
    mode !== undefined && mode !== null
      ? collection.modes.find(m => m.name === mode)
      : null;
  const modeId =
    targetMode !== undefined && targetMode !== null
      ? targetMode.modeId
      : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  const created: string[] = [];

  const baseVar = figma.variables.createVariable(colorName, collection, 'COLOR');
  baseVar.setValueForMode(modeId, baseColor);
  created.push(colorName);

  const fgVar = figma.variables.createVariable(
    `${colorName}-foreground`,
    collection,
    'COLOR',
  );
  fgVar.setValueForMode(modeId, foregroundColor);
  created.push(`${colorName}-foreground`);

  const scale = calculateColorScaleFigma(baseColor, backgroundColor);
  const scaleVars: string[] = [];

  for (const [level, value] of Object.entries(scale)) {
    const varName = `${colorName}-${level}`;
    const variable = figma.variables.createVariable(varName, collection, 'COLOR');
    variable.setValueForMode(modeId, value);
    created.push(varName);
    scaleVars.push(varName);
  }

  return {
    created: created.length,
    variables: {
      base: colorName,
      foreground: `${colorName}-foreground`,
      scale: scaleVars,
    },
    success: true,
  };
}

// 15. apply_custom_palette
export async function applyCustomPalette(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const palette = params['palette'] as Record<
    string,
    { base: RgbaColor; foreground: RgbaColor }
  >;
  const backgroundColor = params['backgroundColor'] as RgbaColor;
  const regenerateScales = params['regenerateScales'];

  const { collections: _cols, variables: allVariables } = await fetchVariableData();
  const collection = findCollectionIn(_cols, collectionId);
  const collectionVariables = allVariables.filter(
    v => v.variableCollectionId === collection.id,
  );
  const modeId = collection.modes[0].modeId;

  // Build a map for O(1) lookups instead of repeated O(n) find() calls.
  const varByName = new Map<string, Variable>();
  for (const v of collectionVariables) {
    varByName.set(v.name, v);
  }

  let baseColorsUpdated = 0;
  let foregroundsUpdated = 0;
  let scalesRegenerated = 0;

  for (const [colorName, colors] of Object.entries(palette)) {
    let baseVar = varByName.get(colorName);
    if (baseVar === undefined) {
      baseVar = figma.variables.createVariable(colorName, collection, 'COLOR');
      varByName.set(colorName, baseVar);
    }
    baseVar.setValueForMode(modeId, colors.base);
    baseColorsUpdated++;

    const fgKey = `${colorName}-foreground`;
    let fgVar = varByName.get(fgKey);
    if (fgVar === undefined) {
      fgVar = figma.variables.createVariable(fgKey, collection, 'COLOR');
      varByName.set(fgKey, fgVar);
    }
    fgVar.setValueForMode(modeId, colors.foreground);
    foregroundsUpdated++;

    if (regenerateScales !== false) {
      const scale = calculateColorScaleFigma(colors.base, backgroundColor);

      for (const [level, value] of Object.entries(scale)) {
        const varName = `${colorName}-${level}`;
        let scaleVar = varByName.get(varName);

        if (scaleVar === undefined) {
          scaleVar = figma.variables.createVariable(varName, collection, 'COLOR');
          varByName.set(varName, scaleVar);
        }
        scaleVar.setValueForMode(modeId, value);
        scalesRegenerated++;
      }
    }
  }

  return {
    baseColorsUpdated,
    foregroundsUpdated,
    scalesRegenerated,
    success: true,
  };
}

// 16. reorder_variables
export async function reorderVariables(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;

  await findCollection(collectionId);

  return {
    reordered: 0,
    success: true,
    message:
      'Variable reordering is not supported by Figma Plugin API. Variables are ordered alphabetically by Figma.',
  };
}

// 17. generate_audit_report
export async function generateAuditReport(
  params: Record<string, unknown>,
): Promise<unknown> {
  const collectionId = params['collectionId'] as string;
  const includeChartColors = params['includeChartColors'] as boolean | undefined;
  const format = params['format'] as string | undefined;

  const auditData = (await auditCollection({
    collectionId,
    includeChartColors,
  })) as {
    status: string;
    totalVariables: number;
    expectedVariables: number;
    compliancePercentage: number;
    missing: { count: number; variables: string[] };
    nonStandard: { count: number; variables: Array<{ name: string; recommendation: string }> };
  };

  if (format === 'json') {
    return auditData;
  }

  const lines: string[] = [];
  lines.push('=== THEME COLLECTION AUDIT REPORT ===');
  lines.push('');
  lines.push(`Status: ${auditData.status}`);
  lines.push(
    `Total Variables: ${auditData.totalVariables} / ${auditData.expectedVariables} expected`,
  );
  lines.push(`Compliance: ${auditData.compliancePercentage}%`);
  lines.push('');

  if (auditData.missing.count > 0) {
    lines.push(`MISSING VARIABLES (${auditData.missing.count}):`);
    auditData.missing.variables.forEach(name => {
      lines.push(`  - ${name}`);
    });
    lines.push('');
  }

  if (auditData.nonStandard.count > 0) {
    lines.push(`NON-STANDARD VARIABLES (${auditData.nonStandard.count}):`);
    auditData.nonStandard.variables.forEach(item => {
      lines.push(`  - ${item.name} (${item.recommendation})`);
    });
    lines.push('');
  }

  lines.push('RECOMMENDATIONS:');
  if (auditData.missing.count > 0) {
    lines.push(
      `1. Add ${auditData.missing.count} missing variables to reach ${auditData.expectedVariables}-variable standard`,
    );
  }
  if (auditData.nonStandard.count > 0) {
    lines.push(
      `2. Review ${auditData.nonStandard.count} non-standard variables (rename/remove)`,
    );
  }
  lines.push('3. Validate color contrast for all foreground variants');

  return lines.join('\n');
}

// 18. export_collection_schema
export async function exportCollectionSchema(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const mode = params['mode'] as string | undefined;
  const includeMetadata = params['includeMetadata'];

  const { collections: _cols, variables: allVariables } = await fetchVariableData();
  const collection = findCollectionIn(_cols, collectionId);
  const collectionVariables = allVariables.filter(
    v => v.variableCollectionId === collection.id,
  );

  const targetMode =
    mode !== undefined && mode !== null
      ? collection.modes.find(m => m.name === mode)
      : null;
  const modeId =
    targetMode !== undefined && targetMode !== null
      ? targetMode.modeId
      : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  const schema: Record<string, unknown> = {
    schema_version: '1.2',
    variables: {},
  };

  if (includeMetadata !== false) {
    schema['collection'] = {
      name: collection.name,
      modes: collection.modes.map(m => m.name),
      exportedMode:
        mode !== undefined && mode !== null
          ? mode
          : collection.modes[0].name,
      variableCount: collectionVariables.length,
    };
  }

  const variablesMap: Record<string, unknown> = {};

  for (const variable of collectionVariables) {
    const value = variable.valuesByMode[modeId];

    if (value !== undefined && value !== null && typeof value === 'object') {
      variablesMap[variable.name] = {
        type: 'COLOR',
        value,
        category: getCategoryForVariable(variable.name),
      };
    }
  }

  schema['variables'] = variablesMap;

  return schema;
}

// 19. import_collection_schema
export async function importCollectionSchema(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const schema = params['schema'] as {
    variables: Record<string, { value: VariableValue }>;
  };
  const mode = params['mode'] as string | undefined;
  const overwriteExisting = params['overwriteExisting'] as boolean | undefined;

  if (!schema || typeof schema !== 'object' || typeof schema.variables !== 'object') {
    throw new Error('Invalid schema: expected an object with a "variables" map');
  }

  const MAX_IMPORT_VARIABLES = 1000;
  const entries = Object.entries(schema.variables);
  if (entries.length > MAX_IMPORT_VARIABLES) {
    throw new Error(
      `Schema contains ${entries.length} variables, which exceeds the maximum of ${MAX_IMPORT_VARIABLES} per import`,
    );
  }

  const { collections: _cols, variables: allVariables } = await fetchVariableData();
  const collection = findCollectionIn(_cols, collectionId);
  const collectionVariables = allVariables.filter(
    v => v.variableCollectionId === collection.id,
  );
  // Map for O(1) lookup and direct variable access — replaces Set + find() O(n)
  const varByName = new Map(collectionVariables.map(v => [v.name, v]));

  const targetMode =
    mode !== undefined && mode !== null
      ? collection.modes.find(m => m.name === mode)
      : null;
  const modeId =
    targetMode !== undefined && targetMode !== null
      ? targetMode.modeId
      : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ name: string; error: string }> = [];

  for (const [name, varData] of entries) {
    try {
      // Validate name: must be a non-empty string with no control characters or
      // path separators (protects against prototype pollution and API misuse).
      if (typeof name !== 'string' || name.length === 0 || name.length > 256 || /[\x00-\x1f/\\]/.test(name)) {
        failed++;
        errors.push({ name, error: 'Invalid variable name' });
        continue;
      }
      if (!varData || typeof varData !== 'object' || !('value' in varData)) {
        failed++;
        errors.push({ name, error: 'Missing or invalid value' });
        continue;
      }
      // Validate that value is an RGBA color object {r, g, b, a} with numeric components.
      const colorValue = varData.value;
      if (
        colorValue === null ||
        colorValue === undefined ||
        typeof colorValue !== 'object' ||
        typeof colorValue['r'] !== 'number' ||
        typeof colorValue['g'] !== 'number' ||
        typeof colorValue['b'] !== 'number' ||
        typeof colorValue['a'] !== 'number'
      ) {
        failed++;
        errors.push({ name, error: 'Variable value must be an RGBA color object {r, g, b, a}' });
        continue;
      }

      if (varByName.has(name)) {
        if (overwriteExisting === true) {
          const variable = varByName.get(name);
          if (variable !== undefined) {
            variable.setValueForMode(modeId, varData.value);
          }
          updated++;
        } else {
          skipped++;
        }
      } else {
        const variable = figma.variables.createVariable(name, collection, 'COLOR');
        variable.setValueForMode(modeId, varData.value);
        imported++;
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      failed++;
      errors.push({ name, error: errMsg });
    }
  }

  return {
    imported,
    updated,
    skipped,
    failed,
    errors,
  };
}

// 20. create_all_scales
export async function createAllScales(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const baseColors = params['baseColors'] as Record<string, RgbaColor>;
  const backgroundColor = params['backgroundColor'] as RgbaColor;

  const collection = await findCollection(collectionId);
  const modeId = collection.modes[0].modeId;

  let created = 0;
  const scales: Record<string, number> = {};

  for (const [colorName, baseColor] of Object.entries(baseColors)) {
    const scale = calculateColorScaleFigma(baseColor, backgroundColor);
    let scaleCount = 0;

    for (const [level, value] of Object.entries(scale)) {
      const varName = `${colorName}-${level}`;
      const variable = figma.variables.createVariable(varName, collection, 'COLOR');
      variable.setValueForMode(modeId, value);
      scaleCount++;
      created++;
    }

    scales[colorName] = scaleCount;
  }

  return {
    created,
    scales,
    success: true,
  };
}

// 21. fix_collection_to_standard
export async function fixCollectionToStandard(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const preserveCustom = params['preserveCustom'] as boolean | undefined;
  const addChartColorsFlag = params['addChartColors'] as boolean | undefined;
  const useDefaultValues = params['useDefaultValues'];
  const dryRun = params['dryRun'] as boolean | undefined;

  const auditResult = (await auditCollection({
    collectionId,
    includeChartColors: addChartColorsFlag,
  })) as {
    missing: { count: number; variables: string[] };
    nonStandard: {
      count: number;
      variables: Array<{ name: string }>;
    };
    totalVariables: number;
    compliancePercentage: number;
    status: string;
  };

  const analysis = {
    missingBefore: auditResult.missing.count,
    nonStandardBefore: auditResult.nonStandard.count,
    totalBefore: auditResult.totalVariables,
  };

  if (dryRun === true) {
    return {
      analysis,
      actions: {
        variablesAdded: auditResult.missing.count,
        variablesRenamed: 0,
        variablesRemoved: preserveCustom === true ? 0 : auditResult.nonStandard.count,
        variablesPreserved: preserveCustom === true ? auditResult.nonStandard.count : 0,
      },
      result: {
        totalVariables:
          auditResult.totalVariables +
          auditResult.missing.count -
          (preserveCustom === true ? 0 : auditResult.nonStandard.count),
        compliance: '100%',
        status: 'Complete (Dry Run)',
      },
      dryRun: true,
    };
  }

  let variablesAdded = 0;
  let variablesRemoved = 0;

  if (useDefaultValues !== false && auditResult.missing.count > 0) {
    const result = (await applyDefaultTheme({
      collectionId,
      overwriteExisting: false,
      includeChartColors: addChartColorsFlag,
    })) as { created: number };
    variablesAdded = result.created;
  }

  if (preserveCustom !== true && auditResult.nonStandard.count > 0) {
    const result = (await deleteVariablesBatch({
      variableIds: auditResult.nonStandard.variables.map(v => v.name),
      collectionId,
    })) as { deleted: number };
    variablesRemoved = result.deleted;
  }

  const finalAudit = (await auditCollection({
    collectionId,
    includeChartColors: addChartColorsFlag,
  })) as {
    totalVariables: number;
    compliancePercentage: number;
    status: string;
  };

  return {
    analysis,
    actions: {
      variablesAdded,
      variablesRenamed: 0,
      variablesRemoved,
      variablesPreserved: preserveCustom === true ? auditResult.nonStandard.count : 0,
    },
    result: {
      totalVariables: finalAudit.totalVariables,
      compliance: `${finalAudit.compliancePercentage}%`,
      status: finalAudit.status,
    },
    success: true,
  };
}

// 22. add_chart_colors
export async function addChartColors(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const chartColorsParam = params['chartColors'] as RgbaColor[] | undefined;

  const collection = await findCollection(collectionId);
  const modeId = collection.modes[0].modeId;

  const defaultChartColors: RgbaColor[] = [
    { r: 0.639, g: 0.902, b: 0.208, a: 1.0 },
    { r: 0.118, g: 0.251, b: 0.686, a: 1.0 },
    { r: 0.863, g: 0.696, b: 0.149, a: 1.0 },
    { r: 0.863, g: 0.149, b: 0.149, a: 1.0 },
    { r: 0.576, g: 0.773, b: 0.992, a: 1.0 },
    { r: 0.078, g: 0.325, b: 0.176, a: 1.0 },
    { r: 0.980, g: 0.588, b: 0.118, a: 1.0 },
    { r: 0.639, g: 0.384, b: 0.863, a: 1.0 },
  ];

  const colors =
    chartColorsParam !== undefined && chartColorsParam !== null
      ? chartColorsParam
      : defaultChartColors;
  const created: string[] = [];

  for (let i = 0; i < Math.min(colors.length, 8); i++) {
    const varName = `chart-${i + 1}`;
    const variable = figma.variables.createVariable(varName, collection, 'COLOR');
    variable.setValueForMode(modeId, colors[i]);
    created.push(varName);
  }

  return {
    created: created.length,
    chartColors: created,
    success: true,
  };
}

// -------------------------------------------------------------------------
// Mode management handlers
// -------------------------------------------------------------------------

export async function addModeToCollection(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const modeName = params['modeName'] as string;

  const collection = await findCollection(collectionId);

  const newModeId = collection.addMode(modeName);

  const newMode = collection.modes.find(m => m.modeId === newModeId);

  return {
    collectionId: collection.id,
    collectionName: collection.name,
    modeId: newModeId,
    modeName: newMode !== undefined && newMode !== null ? newMode.name : modeName,
    totalModes: collection.modes.length,
    success: true,
  };
}

export async function renameMode(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const oldModeName = params['oldModeName'] as string;
  const newModeName = params['newModeName'] as string;

  const collection = await findCollection(collectionId);

  const mode = collection.modes.find(m => m.name === oldModeName);
  if (!mode) {
    throw new Error(`Mode "${oldModeName}" not found in collection`);
  }

  collection.renameMode(mode.modeId, newModeName);

  return {
    collectionId: collection.id,
    collectionName: collection.name,
    modeId: mode.modeId,
    oldName: oldModeName,
    newName: newModeName,
    success: true,
  };
}

export async function deleteMode(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const modeName = params['modeName'] as string;

  const collection = await findCollection(collectionId);

  if (collection.modes.length <= 1) {
    throw new Error('Cannot delete the last mode in a collection');
  }

  const mode = collection.modes.find(m => m.name === modeName);
  if (!mode) {
    throw new Error(`Mode "${modeName}" not found in collection`);
  }

  collection.removeMode(mode.modeId);

  return {
    collectionId: collection.id,
    collectionName: collection.name,
    deletedMode: modeName,
    remainingModes: collection.modes.map(m => m.name),
    success: true,
  };
}

export async function duplicateModeValues(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionId = params['collectionId'] as string;
  const sourceMode = params['sourceMode'] as string;
  const targetMode = params['targetMode'] as string;
  const transformColors = params['transformColors'] as
    | { brightness_adjustment?: number }
    | undefined;

  const collection = await findCollection(collectionId);

  const sourceModeObj = collection.modes.find(m => m.name === sourceMode);
  const targetModeObj = collection.modes.find(m => m.name === targetMode);

  if (!sourceModeObj) {
    throw new Error(`Source mode "${sourceMode}" not found`);
  }
  if (!targetModeObj) {
    throw new Error(`Target mode "${targetMode}" not found`);
  }

  const sourceModeId = sourceModeObj.modeId;
  const targetModeId = targetModeObj.modeId;

  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(
    v => v.variableCollectionId === collection.id,
  );

  let copied = 0;
  let transformed = 0;

  for (const variable of collectionVariables) {
    try {
      const sourceValue = variable.valuesByMode[sourceModeId];

      if (sourceValue === undefined) {
        continue;
      }

      let targetValue: VariableValue = sourceValue as VariableValue;

      if (
        transformColors !== undefined &&
        transformColors !== null &&
        variable.resolvedType === 'COLOR' &&
        typeof sourceValue === 'object'
      ) {
        const brightnessAdj =
          transformColors.brightness_adjustment !== undefined
            ? transformColors.brightness_adjustment
            : 0;

        if (brightnessAdj !== 0) {
          const colorSource = sourceValue as RgbaColor;
          targetValue = {
            r: Math.max(0, Math.min(1, colorSource.r + brightnessAdj)),
            g: Math.max(0, Math.min(1, colorSource.g + brightnessAdj)),
            b: Math.max(0, Math.min(1, colorSource.b + brightnessAdj)),
            a: colorSource.a !== undefined ? colorSource.a : 1,
          };
          transformed++;
        }
      }

      variable.setValueForMode(targetModeId, targetValue);
      copied++;
    } catch (error) {
      debugLog(`Error copying variable ${variable.name}:`, error);
    }
  }

  return {
    collectionId: collection.id,
    collectionName: collection.name,
    sourceMode,
    targetMode,
    variablesCopied: copied,
    variablesTransformed: transformed,
    success: true,
  };
}
