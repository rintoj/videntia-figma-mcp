// SVG-related utility functions for the Claude Figma MCP plugin.

import type { SvgRootStroke } from '../types';
import { svgColorToFigmaRgb } from './color';

// ---------------------------------------------------------------------------
// Parse stroke attributes from the root <svg> element
// ---------------------------------------------------------------------------

/**
 * Extract stroke information declared on the root `<svg>` element.
 * Returns `null` when no root-level stroke is present (or it is `"none"`).
 */
export function parseSvgRootStroke(svgString: string): SvgRootStroke | null {
  const tagMatch = svgString.match(/<svg(\s[^>]*)?>/i);
  if (!tagMatch || !tagMatch[1]) return null;

  const svgAttrs = tagMatch[1];

  const strokeMatch = svgAttrs.match(/\bstroke\s*=\s*"([^"]*)"/);
  if (!strokeMatch || strokeMatch[1] === 'none' || strokeMatch[1] === '') {
    return null;
  }

  const strokeWidthMatch = svgAttrs.match(/\bstroke-width\s*=\s*"([^"]*)"/);
  const strokeOpacityMatch = svgAttrs.match(/\bstroke-opacity\s*=\s*"([^"]*)"/);

  return {
    color: strokeMatch[1],
    width: strokeWidthMatch ? parseFloat(strokeWidthMatch[1]) : 1,
    opacity: strokeOpacityMatch ? parseFloat(strokeOpacityMatch[1]) : 1,
  };
}

// ---------------------------------------------------------------------------
// Propagate root SVG stroke to descendant shape nodes
// ---------------------------------------------------------------------------

/**
 * Recursively apply a stroke paint to all shape-type descendants of `node`.
 * Skips nodes that already carry their own stroke so per-shape overrides are
 * preserved.
 *
 * `strokeInfo` is the parsed result from `parseSvgRootStroke`.
 */
export function propagateStrokeToShapes(
  node: SceneNode,
  strokeInfo: SvgRootStroke,
): void {
  const rgbColor = svgColorToFigmaRgb(strokeInfo.color);
  const strokePaint: SolidPaint = {
    type: 'SOLID',
    color: rgbColor,
    opacity: strokeInfo.opacity,
  };

  _propagate(node, strokePaint, strokeInfo.width);
}

// Internal recursive implementation that operates on already-resolved paint
// and weight values to avoid re-parsing on every recursive call.
function _propagate(
  node: SceneNode,
  strokePaint: SolidPaint,
  strokeWeight: number,
): void {
  const shapeTypes: NodeType[] = [
    'VECTOR',
    'BOOLEAN_OPERATION',
    'ELLIPSE',
    'STAR',
    'POLYGON',
    'LINE',
    'RECTANGLE',
  ];

  if (shapeTypes.indexOf(node.type) !== -1) {
    const strokeable = node as GeometryMixin;
    if (!strokeable.strokes || strokeable.strokes.length === 0) {
      strokeable.strokes = [strokePaint];
      if ('strokeWeight' in node) {
        (node as unknown as { strokeWeight: number }).strokeWeight = strokeWeight;
      }
    }
  }

  if ('children' in node) {
    const parent = node as ChildrenMixin;
    for (let i = 0; i < parent.children.length; i++) {
      _propagate(parent.children[i] as SceneNode, strokePaint, strokeWeight);
    }
  }
}
