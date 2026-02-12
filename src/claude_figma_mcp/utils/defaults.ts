import { Color, ColorWithDefaults } from '../types/color';

export const FIGMA_DEFAULTS = {
  color: {
    opacity: 1,
  },
  stroke: {
    weight: 1,
  }
} as const;

export function applyDefault<T>(value: T | undefined, defaultValue: T): T {
  return value !== undefined ? value : defaultValue;
}

export function applyColorDefaults(color: Color): ColorWithDefaults {
  return {
    r: color.r,
    g: color.g,
    b: color.b,
    a: applyDefault(color.a, FIGMA_DEFAULTS.color.opacity)
  };
}