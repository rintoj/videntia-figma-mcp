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
  let bestEntry: ColorVarEntry | null = null;
  let bestEffDist = Infinity;
  for (let bfi = 0; bfi < colorVarEntries.length; bfi++) {
    let entry = colorVarEntries[bfi];
    let dist = colorDist(rawColor, entry.color);
    if (dist < COLOR_EXACT_THRESHOLD) return entry; // exact — stop immediately
    if (dist > COLOR_NEAR_THRESHOLD) continue;
    let rawEffDist = dist - (isSemanticMatch(entry.nameLower, category) ? COLOR_SEMANTIC_BONUS : 0);
    let effDist = rawEffDist < 0 ? 0 : rawEffDist;
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
    for (let zi = 0; zi < floatVarEntries.length; zi++) {
      if (floatVarEntries[zi].value === 0) return floatVarEntries[zi];
    }
    return null;
  }

  let kws = FLOAT_SEMANTIC_KEYWORDS[category];
  let bestSemantic: FloatVarEntry | null = null;
  let bestSemanticDist = Infinity;
  let bestAny: FloatVarEntry | null = null;
  let bestAnyDist = Infinity;

  for (let fli = 0; fli < floatVarEntries.length; fli++) {
    let entry = floatVarEntries[fli];
    let dist = Math.abs(rawValue - entry.value);

    let hasSemantic = false;
    if (kws) {
      for (let fki = 0; fki < kws.length; fki++) {
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
  let semanticThreshold = Math.max(rawValue * 0.3, 4);
  if (bestSemantic && bestSemanticDist <= semanticThreshold) return bestSemantic;

  // Fall back to any variable within ±10% (or 2 units)
  let anyThreshold = Math.max(rawValue * 0.1, 2);
  if (bestAny && bestAnyDist <= anyThreshold) return bestAny;

  return null;
}

// ── Fix pass ──────────────────────────────────────────────────────────────────

export async function applyFixes(
  violations: Violation[],
  categories: LintCategories,
  maps: LookupMaps,
): Promise<void> {
  let DEVICE_FIX_SPECS = DEVICE_SIZES;
  let DIM_TOL = DIM_TOLERANCE;

  // Cache last resolved node to avoid redundant getNodeByIdAsync calls
  let lastFixNodeId: string | null = null;
  let lastFixNode: BaseNode | null = null;

  for (let fxi = 0; fxi < violations.length; fxi++) {
    let fv = violations[fxi];
    fv.fixed = false;

    let fvCat = fv.category;
    let isRootFrameViol  = fvCat === 'rootFrame';
    let isColorViol      = fvCat === 'backgroundFills' || fvCat === 'iconColors' || fvCat === 'strokesBorders';
    let isSpacingViol    = fvCat === 'spacing';
    let isRadiusViol     = fvCat === 'borderRadius';
    let isTypographyViol = fvCat === 'typography';
    if (!isRootFrameViol && !isColorViol && !isSpacingViol && !isRadiusViol && !isTypographyViol) continue;

    // Resolve node (cached per nodeId)
    let fixNode: BaseNode | null = null;
    if (fv.nodeId === lastFixNodeId) {
      fixNode = lastFixNode;
    } else {
      try { fixNode = await figma.getNodeByIdAsync(fv.nodeId); } catch (_e) {}
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
        } catch (_e) {}

      } else if (fv.property === 'layoutSizingVertical') {
        try {
          (fixNode as FrameNode).layoutSizingVertical = 'HUG';
          fv.fixed = true;
          fv.fixedWith = 'layoutSizingVertical = HUG';
          categories.rootFrame.unbound = Math.max(0, categories.rootFrame.unbound - 1);
          categories.rootFrame.bound++;
        } catch (_e) {}

      } else if (fv.property === 'minHeight') {
        try {
          let fwWidth = (fixNode as FrameNode).width !== undefined ? (fixNode as FrameNode).width : 0;
          let fwExpected = 0;
          for (let fwdi = 0; fwdi < DEVICE_FIX_SPECS.length; fwdi++) {
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
        } catch (_e) {}
      }

    // ── Color / fill / stroke fixes ──
    } else if (isColorViol) {
      let propPartsMatch = fv.property.match(/^(fills|strokes)\[(\d+)\]$/);
      if (propPartsMatch) {
        let propName = propPartsMatch[1] as 'fills' | 'strokes';
        let propIdx  = parseInt(propPartsMatch[2], 10);
        try {
          let paints = (fixNode as GeometryMixin)[propName] as ReadonlyArray<Paint>;
          if (paints && Array.isArray(paints) && paints.length > propIdx) {
            let paint = paints[propIdx];

            // Fix zero-opacity fills/strokes by removing them
            let paintOpacity = paint ? paint.opacity : undefined;
            if (paintOpacity !== null && paintOpacity !== undefined && paintOpacity === 0) {
              let paintsCopy = (paints as Paint[]).slice();
              paintsCopy.splice(propIdx, 1);
              (fixNode as GeometryMixin)[propName] = paintsCopy as any;
              fv.fixed = true;
              fv.fixedWith = 'removed 0% opacity ' + propName.slice(0, -1);
              let colorCats = categories as unknown as Record<string, import('./types').CategoryStats>;
              colorCats[fvCat].unbound = Math.max(0, colorCats[fvCat].unbound - 1);
              colorCats[fvCat].total = Math.max(0, colorCats[fvCat].total - 1);
              // Adjust indices for subsequent violations on the same node/property
              for (let adjIdx = fxi + 1; adjIdx < violations.length; adjIdx++) {
                let adjV = violations[adjIdx];
                if (adjV.nodeId === fv.nodeId) {
                  let adjMatch = adjV.property.match(/^(fills|strokes)\[(\d+)\]$/);
                  if (adjMatch && adjMatch[1] === propName) {
                    let adjPropIdx = parseInt(adjMatch[2], 10);
                    if (adjPropIdx > propIdx) {
                      adjV.property = propName + '[' + (adjPropIdx - 1) + ']';
                    }
                  }
                }
              }
              continue;
            }

            if (paint && paint.type === 'SOLID' && (paint as SolidPaint).color) {
              let bestEntry = findBestColorVar((paint as SolidPaint).color, fvCat, maps.colorVarEntries);
              if (bestEntry) {
                let varObj = maps.variableMap[bestEntry.id];
                if (varObj) {
                  let paintsCopy = (paints as Paint[]).slice();
                  paintsCopy[propIdx] = figma.variables.setBoundVariableForPaint(paintsCopy[propIdx] as SolidPaint, 'color', varObj);
                  (fixNode as GeometryMixin)[propName] = paintsCopy as any;
                  fv.fixed = true;
                  fv.fixedWith = varObj.name;
                  let colorCats = categories as unknown as Record<string, import('./types').CategoryStats>;
                  colorCats[fvCat].unbound = Math.max(0, colorCats[fvCat].unbound - 1);
                  colorCats[fvCat].bound++;
                }
              }
            }
          }
        } catch (_e) {}
      }

    // ── Spacing fixes ──
    } else if (isSpacingViol) {
      let spacingProp = fv.property;
      try {
        let rawSpacing = (fixNode as FrameNode)[spacingProp as keyof FrameNode] as number;
        if (typeof rawSpacing === 'number') {
          let bestSpacingVar = findBestFloatVar(rawSpacing, 'spacing', maps.floatVarEntries);
          if (bestSpacingVar) {
            let spacingVarObj = maps.variableMap[bestSpacingVar.id];
            if (spacingVarObj) {
              (fixNode as SceneNode & { setBoundVariable(field: string, variable: Variable): void }).setBoundVariable(spacingProp, spacingVarObj);
              fv.fixed = true;
              fv.fixedWith = spacingVarObj.name;
              categories.spacing.unbound = Math.max(0, categories.spacing.unbound - 1);
              categories.spacing.bound++;
            }
          }
        }
      } catch (_e) {}

    // ── Border radius fixes ──
    } else if (isRadiusViol) {
      let radiusProp = fv.property;
      try {
        let rawRadius = (fixNode as RectangleNode)[radiusProp as keyof RectangleNode] as number;
        if (typeof rawRadius === 'number') {
          let bestRadiusVar = findBestFloatVar(rawRadius, 'borderRadius', maps.floatVarEntries);
          if (bestRadiusVar) {
            let radiusVarObj = maps.variableMap[bestRadiusVar.id];
            if (radiusVarObj) {
              (fixNode as SceneNode & { setBoundVariable(field: string, variable: Variable): void }).setBoundVariable(radiusProp, radiusVarObj);
              fv.fixed = true;
              fv.fixedWith = radiusVarObj.name;
              categories.borderRadius.unbound = Math.max(0, categories.borderRadius.unbound - 1);
              categories.borderRadius.bound++;
            }
          }
        }
      } catch (_e) {}

    // ── Typography fixes ──
    } else if (isTypographyViol && fv.property === 'textStyleId') {
      try {
        let tnFontName = (fixNode as TextNode).fontName;
        let tnFontSize = (fixNode as TextNode).fontSize;
        if (tnFontName && tnFontName !== figma.mixed && tnFontSize && tnFontSize !== figma.mixed) {
          let fn = tnFontName as FontName;
          let fs = tnFontSize as number;
          let tsKey = fn.family.toLowerCase() + '|' + fn.style.toLowerCase() + '|' + Math.round(fs);
          let matchingStyle = maps.textStyleExactMap[tsKey];
          if (matchingStyle) {
            (fixNode as TextNode).textStyleId = matchingStyle.id;
            fv.fixed = true;
            fv.fixedWith = matchingStyle.name;
            categories.typography.unbound = Math.max(0, categories.typography.unbound - 1);
            categories.typography.bound++;
          } else {
            let bestFontSizeVar = findBestFloatVar(fs, 'typography', maps.floatVarEntries);
            if (bestFontSizeVar) {
              let fontSizeVarObj = maps.variableMap[bestFontSizeVar.id];
              if (fontSizeVarObj) {
                (fixNode as SceneNode & { setBoundVariable(field: string, variable: Variable): void }).setBoundVariable('fontSize', fontSizeVarObj);
                fv.message = fv.message + ' (fontSize bound to ' + fontSizeVarObj.name + ')';
                // Do NOT set fv.fixed = true — text style violation still pending
              }
            }
          }
        }
      } catch (_e) {}
    }
  }
}
