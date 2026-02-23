import type { Violation, LintCategories, LookupMaps } from './types';
import { colorDist, isSemanticMatch } from './helpers';
import {
  COLOR_EXACT_THRESHOLD,
  COLOR_NEAR_THRESHOLD,
  COLOR_SEMANTIC_BONUS,
  FLOAT_SEMANTIC_KEYWORDS,
  DEVICE_SIZES,
  DIM_TOLERANCE,
} from './constants';
import type { ColorVarEntry, FloatVarEntry } from './types';

// ── Color variable matching ───────────────────────────────────────────────────

export function findBestColorVar(
  rawColor: { r: number; g: number; b: number },
  category: string,
  colorVarEntries: ColorVarEntry[],
): ColorVarEntry | null {
  var bestEntry: ColorVarEntry | null = null;
  var bestEffDist = Infinity;
  for (var bfi = 0; bfi < colorVarEntries.length; bfi++) {
    var entry = colorVarEntries[bfi];
    var dist = colorDist(rawColor, entry.color);
    if (dist < COLOR_EXACT_THRESHOLD) return entry; // exact — stop immediately
    if (dist > COLOR_NEAR_THRESHOLD) continue;
    var rawEffDist = dist - (isSemanticMatch(entry.nameLower, category) ? COLOR_SEMANTIC_BONUS : 0);
    var effDist = rawEffDist < 0 ? 0 : rawEffDist;
    if (effDist < bestEffDist) {
      bestEffDist = effDist;
      bestEntry = entry;
    }
  }
  return bestEntry;
}

// ── Float variable matching ───────────────────────────────────────────────────

export function findBestFloatVar(
  rawValue: number,
  category: string,
  floatVarEntries: FloatVarEntry[],
): FloatVarEntry | null {
  // Zero special-case: only accept an exact zero-value variable
  if (rawValue === 0) {
    for (var zi = 0; zi < floatVarEntries.length; zi++) {
      if (floatVarEntries[zi].value === 0) return floatVarEntries[zi];
    }
    return null;
  }

  var kws = FLOAT_SEMANTIC_KEYWORDS[category];
  var bestSemantic: FloatVarEntry | null = null;
  var bestSemanticDist = Infinity;
  var bestAny: FloatVarEntry | null = null;
  var bestAnyDist = Infinity;

  for (var fli = 0; fli < floatVarEntries.length; fli++) {
    var entry = floatVarEntries[fli];
    var dist = Math.abs(rawValue - entry.value);

    var hasSemantic = false;
    if (kws) {
      for (var fki = 0; fki < kws.length; fki++) {
        if (entry.nameLower.indexOf(kws[fki]) !== -1) { hasSemantic = true; break; }
      }
    }

    if (hasSemantic && dist < bestSemanticDist) {
      bestSemanticDist = dist;
      bestSemantic = entry;
    }
    if (dist < bestAnyDist) {
      bestAnyDist = dist;
      bestAny = entry;
    }
  }

  // Accept a semantic match within ±30% of the raw value (or 4 units minimum)
  var semanticThreshold = Math.max(rawValue * 0.3, 4);
  if (bestSemantic && bestSemanticDist <= semanticThreshold) return bestSemantic;

  // Fall back to any variable within ±10% (or 2 units)
  var anyThreshold = Math.max(rawValue * 0.1, 2);
  if (bestAny && bestAnyDist <= anyThreshold) return bestAny;

  return null;
}

// ── Fix pass ──────────────────────────────────────────────────────────────────

export async function applyFixes(
  violations: Violation[],
  categories: LintCategories,
  maps: LookupMaps,
): Promise<void> {
  var DEVICE_FIX_SPECS = DEVICE_SIZES;
  var DIM_TOL = DIM_TOLERANCE;

  // Cache last resolved node to avoid redundant getNodeByIdAsync calls
  var lastFixNodeId: string | null = null;
  var lastFixNode: BaseNode | null = null;

  for (var fxi = 0; fxi < violations.length; fxi++) {
    var fv = violations[fxi];
    fv.fixed = false;

    var fvCat = fv.category;
    var isRootFrameViol  = fvCat === 'rootFrame';
    var isColorViol      = fvCat === 'backgroundFills' || fvCat === 'iconColors' || fvCat === 'strokesBorders';
    var isSpacingViol    = fvCat === 'spacing';
    var isRadiusViol     = fvCat === 'borderRadius';
    var isTypographyViol = fvCat === 'typography';
    if (!isRootFrameViol && !isColorViol && !isSpacingViol && !isRadiusViol && !isTypographyViol) continue;

    // Resolve node (cached per nodeId)
    var fixNode: BaseNode | null = null;
    if (fv.nodeId === lastFixNodeId) {
      fixNode = lastFixNode;
    } else {
      try { fixNode = await figma.getNodeByIdAsync(fv.nodeId); } catch (e) {}
      lastFixNodeId = fv.nodeId;
      lastFixNode = fixNode;
    }
    if (!fixNode) continue;

    // ── Root frame sizing fixes ──
    if (isRootFrameViol) {
      if (fv.property === 'layoutSizingHorizontal') {
        try {
          (fixNode as FrameNode).layoutSizingHorizontal = 'FIXED';
          fv.fixed = true;
          fv.fixedWith = 'layoutSizingHorizontal = FIXED';
          categories.rootFrame.unbound = Math.max(0, categories.rootFrame.unbound - 1);
          categories.rootFrame.bound++;
        } catch (e) {}

      } else if (fv.property === 'layoutSizingVertical') {
        try {
          (fixNode as FrameNode).layoutSizingVertical = 'HUG';
          fv.fixed = true;
          fv.fixedWith = 'layoutSizingVertical = HUG';
          categories.rootFrame.unbound = Math.max(0, categories.rootFrame.unbound - 1);
          categories.rootFrame.bound++;
        } catch (e) {}

      } else if (fv.property === 'minHeight') {
        try {
          var fwWidth = (fixNode as FrameNode).width !== undefined ? (fixNode as FrameNode).width : 0;
          var fwExpected = 0;
          for (var fwdi = 0; fwdi < DEVICE_FIX_SPECS.length; fwdi++) {
            if (Math.abs(fwWidth - DEVICE_FIX_SPECS[fwdi].width) <= DIM_TOL) {
              fwExpected = DEVICE_FIX_SPECS[fwdi].minHeight;
              break;
            }
          }
          if (fwExpected > 0) {
            (fixNode as FrameNode).minHeight = fwExpected;
            fv.fixed = true;
            fv.fixedWith = 'minHeight = ' + fwExpected + 'px';
            categories.rootFrame.unbound = Math.max(0, categories.rootFrame.unbound - 1);
            categories.rootFrame.bound++;
          }
        } catch (e) {}
      }

    // ── Color / fill / stroke fixes ──
    } else if (isColorViol) {
      var propPartsMatch = fv.property.match(/^(fills|strokes)\[(\d+)\]$/);
      if (propPartsMatch) {
        var propName = propPartsMatch[1] as 'fills' | 'strokes';
        var propIdx  = parseInt(propPartsMatch[2], 10);
        try {
          var paints = (fixNode as GeometryMixin)[propName] as ReadonlyArray<Paint>;
          if (paints && Array.isArray(paints) && paints.length > propIdx) {
            var paint = paints[propIdx];
            if (paint && paint.type === 'SOLID' && (paint as SolidPaint).color) {
              var bestEntry = findBestColorVar((paint as SolidPaint).color, fvCat, maps.colorVarEntries);
              if (bestEntry) {
                var varObj = maps.variableMap[bestEntry.id];
                if (varObj) {
                  var paintsCopy = (paints as Paint[]).slice();
                  paintsCopy[propIdx] = figma.variables.setBoundVariableForPaint(paintsCopy[propIdx] as SolidPaint, 'color', varObj);
                  (fixNode as GeometryMixin)[propName] = paintsCopy as any;
                  fv.fixed = true;
                  fv.fixedWith = varObj.name;
                  var colorCats = categories as unknown as Record<string, import('./types').CategoryStats>;
                  colorCats[fvCat].unbound = Math.max(0, colorCats[fvCat].unbound - 1);
                  colorCats[fvCat].bound++;
                }
              }
            }
          }
        } catch (e) {}
      }

    // ── Spacing fixes ──
    } else if (isSpacingViol) {
      var spacingProp = fv.property;
      try {
        var rawSpacing = (fixNode as FrameNode)[spacingProp as keyof FrameNode] as number;
        if (typeof rawSpacing === 'number') {
          var bestSpacingVar = findBestFloatVar(rawSpacing, 'spacing', maps.floatVarEntries);
          if (bestSpacingVar) {
            var spacingVarObj = maps.variableMap[bestSpacingVar.id];
            if (spacingVarObj) {
              (fixNode as SceneNode & { setBoundVariable(field: string, variable: Variable): void }).setBoundVariable(spacingProp, spacingVarObj);
              fv.fixed = true;
              fv.fixedWith = spacingVarObj.name;
              categories.spacing.unbound = Math.max(0, categories.spacing.unbound - 1);
              categories.spacing.bound++;
            }
          }
        }
      } catch (e) {}

    // ── Border radius fixes ──
    } else if (isRadiusViol) {
      var radiusProp = fv.property;
      try {
        var rawRadius = (fixNode as RectangleNode)[radiusProp as keyof RectangleNode] as number;
        if (typeof rawRadius === 'number') {
          var bestRadiusVar = findBestFloatVar(rawRadius, 'borderRadius', maps.floatVarEntries);
          if (bestRadiusVar) {
            var radiusVarObj = maps.variableMap[bestRadiusVar.id];
            if (radiusVarObj) {
              (fixNode as SceneNode & { setBoundVariable(field: string, variable: Variable): void }).setBoundVariable(radiusProp, radiusVarObj);
              fv.fixed = true;
              fv.fixedWith = radiusVarObj.name;
              categories.borderRadius.unbound = Math.max(0, categories.borderRadius.unbound - 1);
              categories.borderRadius.bound++;
            }
          }
        }
      } catch (e) {}

    // ── Typography fixes ──
    } else if (isTypographyViol && fv.property === 'textStyleId') {
      try {
        var tnFontName = (fixNode as TextNode).fontName;
        var tnFontSize = (fixNode as TextNode).fontSize;
        if (tnFontName && tnFontName !== figma.mixed && tnFontSize && tnFontSize !== figma.mixed) {
          var fn = tnFontName as FontName;
          var fs = tnFontSize as number;
          var tsKey = fn.family.toLowerCase() + '|' + fn.style.toLowerCase() + '|' + Math.round(fs);
          var matchingStyle = maps.textStyleExactMap[tsKey];
          if (matchingStyle) {
            (fixNode as TextNode).textStyleId = matchingStyle.id;
            fv.fixed = true;
            fv.fixedWith = matchingStyle.name;
            categories.typography.unbound = Math.max(0, categories.typography.unbound - 1);
            categories.typography.bound++;
          } else {
            var bestFontSizeVar = findBestFloatVar(fs, 'typography', maps.floatVarEntries);
            if (bestFontSizeVar) {
              var fontSizeVarObj = maps.variableMap[bestFontSizeVar.id];
              if (fontSizeVarObj) {
                (fixNode as SceneNode & { setBoundVariable(field: string, variable: Variable): void }).setBoundVariable('fontSize', fontSizeVarObj);
                fv.message = fv.message + ' (fontSize bound to ' + fontSizeVarObj.name + ')';
                // Do NOT set fv.fixed = true — text style violation still pending
              }
            }
          }
        }
      } catch (e) {}
    }
  }
}
