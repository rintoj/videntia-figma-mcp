import type { Violation, ViolationDetails, ActiveChecks, LintCategories } from './types';
import {
  addViolation,
  isFillBound,
  isScalarBound,
  isIconLike,
  isColorFill,
  hasFillPaintStyle,
  hasStrokePaintStyle,
  hasTextStyle,
  hasEffectStyle,
  hasFontVariableBindings,
} from './helpers';
import { MAX_LINT_DEPTH, MAX_LINT_VIOLATIONS, DEVICE_SIZES, DIM_TOLERANCE } from './constants';

export function scanNode(
  node: SceneNode,
  depth: number,
  parent: SceneNode | null,
  parentBBox: Rect | null,
  chk: ActiveChecks,
  categories: LintCategories,
  violations: Violation[],
  violationsCappedRef: { value: boolean },
  totalNodesRef: { value: number },
): void {
  // Skip invisible nodes
  if ((node as SceneNode & { visible?: boolean }).visible === false) return;

  // Depth limit to prevent stack overflow in deeply nested designs
  if (depth > MAX_LINT_DEPTH) return;

  totalNodesRef.value++;
  let nodeType = node.type;

  // ── ROOT FRAME checks (depth === 0 only) ──
  if (chk.rootFrame && depth === 0 && (nodeType === 'FRAME' || nodeType === 'COMPONENT')) {
    let DIM_TOL = DIM_TOLERANCE;

    let rfLayoutMode: string | null = null;
    try { rfLayoutMode = (node as FrameNode).layoutMode; } catch (_e) {}
    let rfHasLayout = rfLayoutMode && rfLayoutMode !== 'NONE';

    let rfWidth = 0;
    try { rfWidth = (node as FrameNode).width; } catch (_e) {}

    // Detect device from width
    let rfDevice: typeof DEVICE_SIZES[0] | null = null;
    for (let rfdi = 0; rfdi < DEVICE_SIZES.length; rfdi++) {
      if (Math.abs(rfWidth - DEVICE_SIZES[rfdi].width) <= DIM_TOL) {
        rfDevice = DEVICE_SIZES[rfdi];
        break;
      }
    }

    if (rfHasLayout) {
      // Check 1: width sizing must be FIXED
      let rfSizingH: string | null = null;
      try { rfSizingH = (node as FrameNode).layoutSizingHorizontal; } catch (_e) {}
      categories.rootFrame.total++;
      if (rfSizingH === 'FIXED') {
        categories.rootFrame.bound++;
      } else {
        categories.rootFrame.unbound++;
        addViolation(
          violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
          node, depth, 'CRITICAL', 'rootFrame', 'layoutSizingHorizontal',
          'Root frame width must be FIXED (currently: ' + (rfSizingH !== null && rfSizingH !== undefined ? rfSizingH : 'unknown') + ')',
        );
      }
    }

    // Check 2: width must match a standard device width
    categories.rootFrame.total++;
    if (rfDevice) {
      categories.rootFrame.bound++;
    } else {
      categories.rootFrame.unbound++;
      addViolation(
        violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
        node, depth, 'HIGH', 'rootFrame', 'width',
        'Root frame width (' + rfWidth + 'px) does not match a standard device width — expected: desktop=1440, tablet=768, mobile=375',
      );
    }

    if (rfHasLayout) {
      // Check 3: height sizing must be HUG
      let rfSizingV: string | null = null;
      try { rfSizingV = (node as FrameNode).layoutSizingVertical; } catch (_e) {}
      categories.rootFrame.total++;
      if (rfSizingV === 'HUG') {
        categories.rootFrame.bound++;
      } else {
        categories.rootFrame.unbound++;
        addViolation(
          violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
          node, depth, 'HIGH', 'rootFrame', 'layoutSizingVertical',
          'Root frame height must be HUG (currently: ' + (rfSizingV !== null && rfSizingV !== undefined ? rfSizingV : 'unknown') + ') — use minHeight for the minimum height constraint',
        );
      }

      // Check 4: minHeight must be set (and should match device height)
      let rfMinHeight: number | null = null;
      try { rfMinHeight = (node as FrameNode).minHeight; } catch (_e) {}
      let rfMinHeightNum = (rfMinHeight !== null && rfMinHeight !== undefined) ? rfMinHeight : 0;
      let rfExpectedMinH = rfDevice ? rfDevice.minHeight : 0;

      categories.rootFrame.total++;
      if (rfMinHeightNum > 0) {
        categories.rootFrame.bound++;
        if (rfDevice && Math.abs(rfMinHeightNum - rfExpectedMinH) > DIM_TOL) {
          addViolation(
            violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
            node, depth, 'MEDIUM', 'rootFrame', 'minHeight',
            'Root frame minHeight (' + rfMinHeightNum + 'px) does not match expected ' + rfDevice.name + ' height (' + rfExpectedMinH + 'px)',
          );
        }
      } else {
        categories.rootFrame.unbound++;
        let rfMinHMsg = 'Root frame minHeight not set';
        if (rfDevice) {
          rfMinHMsg += ' — expected ' + rfExpectedMinH + 'px for ' + rfDevice.name;
        } else {
          rfMinHMsg += ' — set to the device viewport height';
        }
        addViolation(
          violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
          node, depth, 'HIGH', 'rootFrame', 'minHeight', rfMinHMsg,
        );
      }
    }
  }

  // ── TEXT STYLE checks ──
  if (chk.textStyles && nodeType === 'TEXT') {
    categories.typography.total++;

    if (hasTextStyle(node)) {
      categories.typography.bound++;
      try {
        if ((node as TextNode).textStyleId === figma.mixed) {
          addViolation(
            violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
            node, depth, 'LOW', 'typography', 'textStyleId', 'Text style override present (mixed styles in segments)',
          );
        }
      } catch (_e) {}
    } else {
      categories.typography.unbound++;
      addViolation(
        violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
        node, depth, 'HIGH', 'typography', 'textStyleId', 'Text node without textStyleId applied',
      );
    }

    // Check for direct font variable bindings (CRITICAL)
    if (hasFontVariableBindings(node)) {
      addViolation(
        violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
        node, depth, 'CRITICAL', 'typography', 'fontVariables', 'Font variable bound directly to text (should use text style instead)',
      );
    }
  }

  // ── FILL / COLOR checks ──
  if (chk.colors) {
    let fills: ReadonlyArray<Paint> | null = null;
    if ('fills' in node) { fills = (node as GeometryMixin).fills as ReadonlyArray<Paint>; }
    if (fills && fills !== (figma.mixed as unknown) && Array.isArray(fills)) {
      for (let fi = 0; fi < fills.length; fi++) {
        if (!isColorFill(fills[fi])) continue;

        let isIcon = isIconLike(node);
        let catName: 'iconColors' | 'backgroundFills' = isIcon ? 'iconColors' : 'backgroundFills';
        categories[catName].total++;

        let fillBound = isFillBound(node, 'fills', fi) || hasFillPaintStyle(node);
        if (fillBound) {
          categories[catName].bound++;
        } else {
          categories[catName].unbound++;
          addViolation(
            violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
            node, depth, 'HIGH', catName, 'fills[' + fi + ']', 'Color using raw hex value (no variable or paint style bound)',
          );
        }
      }
    }
  }

  // ── STROKE checks ──
  if (chk.colors) {
    let strokes: ReadonlyArray<Paint> | null = null;
    if ('strokes' in node) { strokes = (node as GeometryMixin).strokes as ReadonlyArray<Paint>; }
    if (strokes && strokes !== (figma.mixed as unknown) && Array.isArray(strokes) && strokes.length > 0) {
      for (let si = 0; si < strokes.length; si++) {
        if (!isColorFill(strokes[si])) continue;

        categories.strokesBorders.total++;
        let strokeBound = isFillBound(node, 'strokes', si) || hasStrokePaintStyle(node);
        if (strokeBound) {
          categories.strokesBorders.bound++;
        } else {
          categories.strokesBorders.unbound++;
          addViolation(
            violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
            node, depth, 'HIGH', 'strokesBorders', 'strokes[' + si + ']', 'Stroke color using raw hex value (no variable or paint style bound)',
          );
        }
      }
    }
  }

  // ── SPACING checks (auto-layout frames) ──
  if (chk.spacing && (nodeType === 'FRAME' || nodeType === 'COMPONENT' || nodeType === 'COMPONENT_SET' || nodeType === 'INSTANCE')) {
    let layoutMode: string | null = null;
    try { layoutMode = (node as FrameNode).layoutMode; } catch (_e) {}

    if (layoutMode && layoutMode !== 'NONE') {
      // Check itemSpacing
      let itemSpacing = 0;
      try { itemSpacing = (node as FrameNode).itemSpacing; } catch (_e) {}
      if (itemSpacing > 0) {
        categories.spacing.total++;
        if (isScalarBound(node, 'itemSpacing')) {
          categories.spacing.bound++;
        } else {
          categories.spacing.unbound++;
          addViolation(
            violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
            node, depth, 'MEDIUM', 'spacing', 'itemSpacing', 'Item spacing using raw number (' + itemSpacing + ') — no variable bound',
          );
        }
      }

      // Check padding
      let paddingProps = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'];
      for (let ppi = 0; ppi < paddingProps.length; ppi++) {
        let padVal = 0;
        try { padVal = (node as FrameNode)[paddingProps[ppi] as keyof FrameNode] as number; } catch (_e) {}
        if (padVal > 0) {
          categories.spacing.total++;
          if (isScalarBound(node, paddingProps[ppi])) {
            categories.spacing.bound++;
          } else {
            categories.spacing.unbound++;
            addViolation(
              violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
              node, depth, 'MEDIUM', 'spacing', paddingProps[ppi], paddingProps[ppi] + ' using raw number (' + padVal + ') — no variable bound',
            );
          }
        }
      }
    }
  }

  // ── BORDER RADIUS checks ──
  if (chk.radius && (nodeType === 'FRAME' || nodeType === 'RECTANGLE' || nodeType === 'COMPONENT' || nodeType === 'INSTANCE' || nodeType === 'ELLIPSE')) {
    let cornerRadius: number | symbol = 0;
    try { cornerRadius = (node as RectangleNode).cornerRadius; } catch (_e) {}

    if (cornerRadius && cornerRadius !== figma.mixed && (cornerRadius as number) > 0) {
      categories.borderRadius.total++;
      if (
        isScalarBound(node, 'topLeftRadius') ||
        isScalarBound(node, 'topRightRadius') ||
        isScalarBound(node, 'bottomLeftRadius') ||
        isScalarBound(node, 'bottomRightRadius') ||
        isScalarBound(node, 'cornerRadius')
      ) {
        categories.borderRadius.bound++;
      } else {
        categories.borderRadius.unbound++;
        addViolation(
          violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
          node, depth, 'MEDIUM', 'borderRadius', 'cornerRadius', 'Border radius using raw number (' + (cornerRadius as number) + ') — no variable bound',
        );
      }
    } else if (cornerRadius === figma.mixed) {
      // Individual corners set — check each
      let radiusProps = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'];
      for (let ri = 0; ri < radiusProps.length; ri++) {
        let rVal = 0;
        try { rVal = (node as RectangleNode)[radiusProps[ri] as keyof RectangleNode] as number; } catch (_e) {}
        if (rVal > 0) {
          categories.borderRadius.total++;
          if (isScalarBound(node, radiusProps[ri])) {
            categories.borderRadius.bound++;
          } else {
            categories.borderRadius.unbound++;
            addViolation(
              violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
              node, depth, 'MEDIUM', 'borderRadius', radiusProps[ri], radiusProps[ri] + ' using raw number (' + rVal + ') — no variable bound',
            );
          }
        }
      }
    }
  }

  // ── EFFECT STYLE checks ──
  if (chk.effectStyles) {
    let effects: ReadonlyArray<Effect> | null = null;
    try { effects = (node as BlendMixin).effects; } catch (_e) {}
    if (effects && Array.isArray(effects) && effects.length > 0) {
      let hasVisibleEffects = false;
      for (let efi = 0; efi < effects.length; efi++) {
        if (effects[efi].visible !== false) { hasVisibleEffects = true; break; }
      }
      if (hasVisibleEffects) {
        categories.effectStyles.total++;
        if (hasEffectStyle(node)) {
          categories.effectStyles.bound++;
        } else {
          categories.effectStyles.unbound++;
          let effectTypes: string[] = [];
          for (let eti = 0; eti < effects.length; eti++) {
            if (effects[eti].visible !== false && effectTypes.indexOf(effects[eti].type) === -1) {
              effectTypes.push(effects[eti].type);
            }
          }
          addViolation(
            violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
            node, depth, 'CRITICAL', 'effectStyles', 'effectStyleId', 'Raw ' + effectTypes.join('/') + ' effect (no effect style applied)',
          );
        }
      }
    }
  }

  // ── AUTO-LAYOUT compliance ──
  if (chk.autoLayout && (nodeType === 'FRAME' || nodeType === 'COMPONENT' || nodeType === 'COMPONENT_SET')) {
    let hasLayout = false;
    if ('layoutMode' in node) {
      const lm = (node as FrameNode).layoutMode;
      hasLayout = lm && lm !== 'NONE' ? true : false;
    }

    if (!hasLayout) {
      let childCount = 0;
      if ('children' in node) {
        const childrenArr = (node as FrameNode).children;
        childCount = childrenArr ? childrenArr.length : 0;
      }
      if (childCount > 0) {
        addViolation(
          violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
          node, depth, 'MEDIUM', 'autoLayout', 'layoutMode', 'Frame has ' + childCount + ' children but no auto-layout set',
        );
      }
    } else {
      let alChildren: ReadonlyArray<SceneNode> | null = null;
      if ('children' in node) { alChildren = (node as FrameNode).children; }
      if (alChildren && alChildren.length > 0) {
        let absChildCount = 0;
        for (let alci = 0; alci < alChildren.length; alci++) {
          const alChild = alChildren[alci];
          let alChildPos: string | null = null;
          if ('layoutPositioning' in alChild) { alChildPos = (alChild as SceneNode & { layoutPositioning?: string }).layoutPositioning as string; }
          if (alChildPos === 'ABSOLUTE') {
            absChildCount++;
          }
        }
        if (absChildCount > 0) {
          addViolation(
            violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
            node, depth, 'LOW', 'autoLayout', 'layoutPositioning',
            'Auto-layout frame has ' + absChildCount + ' absolute-positioned ' + (absChildCount === 1 ? 'child' : 'children') + ' — verify intentional',
          );
        }
      }
    }
  }

  // ── OVERFLOW check ──
  if (chk.overflow && parent !== null && parent !== undefined && depth > 1) {
    let ovPositioning: string | null = null;
    try { ovPositioning = (node as SceneNode & { layoutPositioning?: string }).layoutPositioning as string; } catch (_e) {}
    let ovName = '';
    try { ovName = node.name || ''; } catch (_e) {}
    let skipOv = ovPositioning === 'ABSOLUTE' ||
                 ovName.indexOf('Icon/') === 0 ||
                 ovName.indexOf('Image/') === 0;
    if (!skipOv) {
      let childBBox: Rect | null = null;
      try { childBBox = (node as SceneNode & { absoluteBoundingBox?: Rect }).absoluteBoundingBox as Rect; } catch (_e) {}
      if (childBBox && parentBBox) {
        let OV_TOL = 1;
        categories.overflow.total++;
        let hOverflow = (childBBox.x + childBBox.width) - (parentBBox.x + parentBBox.width);
        let hasHOv = hOverflow > OV_TOL;
        let hasVOv = false;
        let vOverflow = 0;
        let parentSizingV: string | null = null;
        try { parentSizingV = (parent as FrameNode).layoutSizingVertical; } catch (_e) {}
        if (parentSizingV === 'FIXED') {
          vOverflow = (childBBox.y + childBBox.height) - (parentBBox.y + parentBBox.height);
          hasVOv = vOverflow > OV_TOL;
        }
        if (hasHOv || hasVOv) {
          categories.overflow.unbound++;
          if (hasHOv) {
            let hAmt = Math.ceil(hOverflow);
            let hDetails: ViolationDetails = {
              axis: 'horizontal',
              overflowAmount: hAmt,
              childRight: Math.round(childBBox.x + childBBox.width),
              parentRight: Math.round(parentBBox.x + parentBBox.width),
            };
            addViolation(
              violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
              node, depth, 'CRITICAL', 'overflow', 'absoluteBoundingBox',
              'Horizontal overflow: child extends ' + hAmt + 'px beyond parent right edge',
              hDetails,
            );
          }
          if (hasVOv) {
            let vAmt = Math.ceil(vOverflow);
            let vDetails: ViolationDetails = {
              axis: 'vertical',
              overflowAmount: vAmt,
              childBottom: Math.round(childBBox.y + childBBox.height),
              parentBottom: Math.round(parentBBox.y + parentBBox.height),
            };
            addViolation(
              violations, violationsCappedRef, MAX_LINT_VIOLATIONS,
              node, depth, 'CRITICAL', 'overflow', 'absoluteBoundingBox',
              'Vertical overflow: child extends ' + vAmt + 'px beyond parent bottom edge',
              vDetails,
            );
          }
        } else {
          categories.overflow.bound++;
        }
      }
    }
  }

  // ── Recurse into children ──
  if ('children' in node && (node as ChildrenMixin).children) {
    let nodeBBox: Rect | null = null;
    if (chk.overflow) {
      try { nodeBBox = (node as SceneNode & { absoluteBoundingBox?: Rect }).absoluteBoundingBox as Rect; } catch (_e) {}
    }
    let nodeChildren = (node as ChildrenMixin).children;
    for (let ci = 0; ci < nodeChildren.length; ci++) {
      scanNode(nodeChildren[ci], depth + 1, node, nodeBBox, chk, categories, violations, violationsCappedRef, totalNodesRef);
    }
  }
}
