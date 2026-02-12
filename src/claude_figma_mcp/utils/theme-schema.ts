/**
 * Standard theme variable schema definition
 * Based on figma-theme-variables-guide.md
 */

import { RGBAColor } from './color-calculations.js';

export interface VariableDefinition {
  name: string;
  category: string;
  description: string;
  defaultValue?: RGBAColor;
}

export interface SchemaCategory {
  name: string;
  count: number;
  variables: string[];
}

export interface ThemeSchema {
  version: string;
  totalVariables: number;
  categories: {
    [key: string]: SchemaCategory;
  };
}

/**
 * Default color values for dark theme (reference implementation)
 */
export const DEFAULT_DARK_THEME: Record<string, RGBAColor> = {
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

/**
 * Chart colors (optional)
 */
export const DEFAULT_CHART_COLORS: Record<string, RGBAColor> = {
  'chart-1': { r: 0.639, g: 0.902, b: 0.208, a: 1.0 },
  'chart-2': { r: 0.118, g: 0.251, b: 0.686, a: 1.0 },
  'chart-3': { r: 0.863, g: 0.696, b: 0.149, a: 1.0 },
  'chart-4': { r: 0.863, g: 0.149, b: 0.149, a: 1.0 },
  'chart-5': { r: 0.576, g: 0.773, b: 0.992, a: 1.0 },
  'chart-6': { r: 0.078, g: 0.325, b: 0.176, a: 1.0 },
  'chart-7': { r: 0.980, g: 0.588, b: 0.118, a: 1.0 },
  'chart-8': { r: 0.639, g: 0.384, b: 0.863, a: 1.0 },
};

/**
 * Standard schema definition (102 variables without charts, 110 with charts)
 */
export function getStandardSchema(includeChartColors: boolean = false): ThemeSchema {
  const schema: ThemeSchema = {
    version: '1.2',
    totalVariables: includeChartColors ? 114 : 106,
    categories: {
      surfaces: {
        name: 'Surfaces',
        count: 6,
        variables: [
          'background', 'foreground',
          'card', 'card-foreground',
          'popover', 'popover-foreground'
        ]
      },
      brand: {
        name: 'Brand Colors',
        count: 8,
        variables: [
          'primary', 'primary-foreground',
          'secondary', 'secondary-foreground',
          'tertiary', 'tertiary-foreground',
          'accent', 'accent-foreground'
        ]
      },
      states: {
        name: 'State Colors',
        count: 8,
        variables: [
          'success', 'success-foreground',
          'info', 'info-foreground',
          'warning', 'warning-foreground',
          'destructive', 'destructive-foreground'
        ]
      },
      interactive: {
        name: 'Interactive Colors',
        count: 2,
        variables: ['link', 'link-hover']
      },
      feedback: {
        name: 'Feedback Colors',
        count: 5,
        variables: [
          'overlay', 'tooltip', 'tooltip-foreground',
          'placeholder', 'placeholder-foreground'
        ]
      },
      utility: {
        name: 'Utility Colors',
        count: 7,
        variables: [
          'muted', 'muted-foreground',
          'selected', 'selected-foreground',
          'border', 'input', 'ring'
        ]
      },
      scales: {
        name: 'Color Scales',
        count: 70,
        variables: generateScaleVariableNames()
      }
    }
  };

  if (includeChartColors) {
    schema.categories.chart = {
      name: 'Chart Colors',
      count: 8,
      variables: ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'chart-7', 'chart-8']
    };
  }

  return schema;
}

/**
 * Generate all scale variable names
 */
function generateScaleVariableNames(): string[] {
  const scaleColors = ['primary', 'secondary', 'accent', 'success', 'info', 'warning', 'destructive'];
  const levels = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
  const names: string[] = [];

  for (const color of scaleColors) {
    for (const level of levels) {
      names.push(`${color}-${level}`);
    }
  }

  return names;
}

/**
 * Get all standard variable names as a flat array
 */
export function getAllStandardVariableNames(includeChartColors: boolean = false): string[] {
  const schema = getStandardSchema(includeChartColors);
  const allNames: string[] = [];

  for (const category of Object.values(schema.categories)) {
    allNames.push(...category.variables);
  }

  return allNames;
}

/**
 * Get variable category by name
 */
export function getVariableCategory(variableName: string): string {
  const schema = getStandardSchema(true);

  for (const [categoryKey, category] of Object.entries(schema.categories)) {
    if (category.variables.includes(variableName)) {
      return categoryKey;
    }
  }

  return 'unknown';
}

/**
 * Check if variable is a scale variable
 */
export function isScaleVariable(variableName: string): boolean {
  return /^(primary|secondary|accent|success|info|warning|destructive)-(50|100|200|300|400|500|600|700|800|900)$/.test(variableName);
}

/**
 * Get base color name from scale variable
 */
export function getBaseColorFromScale(scaleVariableName: string): string | null {
  const match = scaleVariableName.match(/^(primary|secondary|accent|success|info|warning|destructive)-\d+$/);
  return match ? match[1] : null;
}

/**
 * Get scale level from scale variable
 */
export function getScaleLevelFromVariable(scaleVariableName: string): number | null {
  const match = scaleVariableName.match(/-(50|100|200|300|400|500|600|700|800|900)$/);
  return match ? parseInt(match[1]) : null;
}

/**
 * Get all variable names for a color scale
 */
export function getScaleVariableNames(colorName: string): string[] {
  const levels = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
  return levels.map(level => `${colorName}-${level}`);
}

/**
 * Check if variable name is standard
 */
export function isStandardVariable(variableName: string, includeChartColors: boolean = false): boolean {
  const standardNames = getAllStandardVariableNames(includeChartColors);
  return standardNames.includes(variableName);
}

/**
 * Get standard order for variables
 */
export function getStandardVariableOrder(includeChartColors: boolean = false): string[] {
  const order: string[] = [];

  // Background & surface colors
  order.push('background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground');

  // Primary and its scale
  order.push('primary', 'primary-foreground');
  order.push(...getScaleVariableNames('primary'));

  // Secondary and its scale
  order.push('secondary', 'secondary-foreground');
  order.push(...getScaleVariableNames('secondary'));

  // Tertiary and foreground
  order.push('tertiary', 'tertiary-foreground');

  // Accent and its scale
  order.push('accent', 'accent-foreground');
  order.push(...getScaleVariableNames('accent'));

  // Success and its scale
  order.push('success', 'success-foreground');
  order.push(...getScaleVariableNames('success'));

  // Info and its scale
  order.push('info', 'info-foreground');
  order.push(...getScaleVariableNames('info'));

  // Warning and its scale
  order.push('warning', 'warning-foreground');
  order.push(...getScaleVariableNames('warning'));

  // Destructive and its scale
  order.push('destructive', 'destructive-foreground');
  order.push(...getScaleVariableNames('destructive'));

  // Interactive colors
  order.push('link', 'link-hover');

  // Overlay & feedback colors
  order.push('overlay', 'tooltip', 'tooltip-foreground', 'placeholder', 'placeholder-foreground');

  // Utility colors
  order.push('muted', 'muted-foreground', 'selected', 'selected-foreground', 'border', 'input', 'ring');

  // Chart colors (if included)
  if (includeChartColors) {
    order.push('chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'chart-7', 'chart-8');
  }

  return order;
}
