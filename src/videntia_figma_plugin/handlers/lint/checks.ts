import type { Violation, ViolationDetails, ActiveChecks, LintCategories } from "./types";
import {
  addViolation,
  isFillBound,
  isScalarBound,
  isIconLike,
  isColorFill,
  hasOnlyVectorChildren,
  hasVisibleBackgroundFill,
  paintBindingState,
  collectVectorLeaves,
  hasFillPaintStyle,
  hasStrokePaintStyle,
  hasTextStyle,
  hasEffectStyle,
  hasFontVariableBindings,
} from "./helpers";
import {
  MAX_LINT_DEPTH,
  MAX_LINT_VIOLATIONS,
  DEVICE_SIZES,
  DIM_TOLERANCE,
  SCREEN_NAME_PATTERN,
  VALID_BREAKPOINTS,
  EDGE_FLUSH_TOLERANCE,
  RADIUS_HEIGHT_RATIO,
  CAPSULE_RATIO,
  FIXED_WIDTH_SLACK_TOLERANCE,
  FIXED_WIDTH_SLACK_MAX_WIDTH,
} from "./constants";

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
  insideScreen: boolean,
): void {
  // Skip invisible nodes
  if ((node as SceneNode & { visible?: boolean }).visible === false) return;

  // Depth limit to prevent stack overflow in deeply nested designs
  if (depth > MAX_LINT_DEPTH) return;

  totalNodesRef.value++;
  let nodeType = node.type;

  // Detect if this node is a Screen/ frame (screen root)
  let nodeName = "";
  try {
    nodeName = node.name || "";
  } catch (_e) {}
  let isScreenRoot = (nodeType === "FRAME" || nodeType === "COMPONENT") && nodeName.indexOf("Screen/") === 0;
  let localInsideScreen = insideScreen || isScreenRoot;

  // ── ROOT FRAME checks (screen root frame only, must be direct child of PAGE) ──
  let isPageChild = false;
  try {
    isPageChild = node.parent !== null && node.parent !== undefined && node.parent.type === "PAGE";
  } catch (_e) {}
  if (chk.rootFrame && isScreenRoot && isPageChild) {
    let DIM_TOL = DIM_TOLERANCE;

    let rfLayoutMode: string | null = null;
    try {
      rfLayoutMode = (node as FrameNode).layoutMode;
    } catch (_e) {}
    let rfHasLayout = rfLayoutMode && rfLayoutMode !== "NONE";

    let rfWidth = 0;
    try {
      rfWidth = (node as FrameNode).width;
    } catch (_e) {}

    // Detect device from width
    let rfDevice: (typeof DEVICE_SIZES)[0] | null = null;
    for (let rfdi = 0; rfdi < DEVICE_SIZES.length; rfdi++) {
      if (Math.abs(rfWidth - DEVICE_SIZES[rfdi].width) <= DIM_TOL) {
        rfDevice = DEVICE_SIZES[rfdi];
        break;
      }
    }

    if (rfHasLayout) {
      // Check 1: width sizing must be FIXED
      let rfSizingH: string | null = null;
      try {
        rfSizingH = (node as FrameNode).layoutSizingHorizontal;
      } catch (_e) {}
      categories.rootFrame.total++;
      if (rfSizingH === "FIXED") {
        categories.rootFrame.bound++;
      } else {
        categories.rootFrame.unbound++;
        addViolation(
          violations,
          violationsCappedRef,
          MAX_LINT_VIOLATIONS,
          node,
          depth,
          "CRITICAL",
          "rootFrame",
          "layoutSizingHorizontal",
          "Root frame width must be FIXED (currently: " +
            (rfSizingH !== null && rfSizingH !== undefined ? rfSizingH : "unknown") +
            ")",
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
        violations,
        violationsCappedRef,
        MAX_LINT_VIOLATIONS,
        node,
        depth,
        "HIGH",
        "rootFrame",
        "width",
        "Root frame width (" +
          rfWidth +
          "px) does not match a standard device width — expected: desktop=1440, tablet=768, mobile=375",
      );
    }

    if (rfHasLayout) {
      // Check 3: height sizing must be HUG
      let rfSizingV: string | null = null;
      try {
        rfSizingV = (node as FrameNode).layoutSizingVertical;
      } catch (_e) {}
      categories.rootFrame.total++;
      if (rfSizingV === "HUG") {
        categories.rootFrame.bound++;
      } else {
        categories.rootFrame.unbound++;
        addViolation(
          violations,
          violationsCappedRef,
          MAX_LINT_VIOLATIONS,
          node,
          depth,
          "HIGH",
          "rootFrame",
          "layoutSizingVertical",
          "Root frame height must be HUG (currently: " +
            (rfSizingV !== null && rfSizingV !== undefined ? rfSizingV : "unknown") +
            ") — use minHeight for the minimum height constraint",
        );
      }

      // Check 4: minHeight must be set (and should match device height)
      let rfMinHeight: number | null = null;
      try {
        rfMinHeight = (node as FrameNode).minHeight;
      } catch (_e) {}
      let rfMinHeightNum = rfMinHeight !== null && rfMinHeight !== undefined ? rfMinHeight : 0;
      let rfExpectedMinH = rfDevice ? rfDevice.minHeight : 0;

      categories.rootFrame.total++;
      if (rfMinHeightNum > 0) {
        categories.rootFrame.bound++;
        if (rfDevice && Math.abs(rfMinHeightNum - rfExpectedMinH) > DIM_TOL) {
          addViolation(
            violations,
            violationsCappedRef,
            MAX_LINT_VIOLATIONS,
            node,
            depth,
            "MEDIUM",
            "rootFrame",
            "minHeight",
            "Root frame minHeight (" +
              rfMinHeightNum +
              "px) does not match expected " +
              rfDevice.name +
              " height (" +
              rfExpectedMinH +
              "px)",
          );
        }
      } else {
        categories.rootFrame.unbound++;
        let rfMinHMsg = "Root frame minHeight not set";
        if (rfDevice) {
          rfMinHMsg += " — expected " + rfExpectedMinH + "px for " + rfDevice.name;
        } else {
          rfMinHMsg += " — set to the device viewport height";
        }
        addViolation(
          violations,
          violationsCappedRef,
          MAX_LINT_VIOLATIONS,
          node,
          depth,
          "HIGH",
          "rootFrame",
          "minHeight",
          rfMinHMsg,
        );
      }
    }
  }

  // ── SCREEN NAMING checks (any frame starting with "Screen/") ──
  if (chk.screenNaming && isScreenRoot) {
    categories.screenNaming.total++;

    if (SCREEN_NAME_PATTERN.test(nodeName)) {
      categories.screenNaming.bound++;
    } else {
      categories.screenNaming.unbound++;
      // Provide specific feedback about what's wrong
      let snMsg =
        'Screen name "' +
        nodeName +
        '" does not follow convention — expected: Screen/{Feature}@{Breakpoint}/{View}[/{State}]';

      if (nodeName.indexOf(" ") !== -1) {
        snMsg = 'Screen name "' + nodeName + '" contains spaces — use kebab-case (e.g. Step-1-Email)';
      } else {
        // Check for missing or invalid breakpoint
        let atIdx = nodeName.indexOf("@");
        if (atIdx === -1) {
          snMsg = 'Screen name "' + nodeName + '" missing breakpoint — append @sm, @md, or @lg to the feature name';
        } else {
          let afterAt = nodeName.substring(atIdx + 1);
          let slashIdx = afterAt.indexOf("/");
          let bp = slashIdx !== -1 ? afterAt.substring(0, slashIdx) : afterAt;
          let bpValid = false;
          for (let bpi = 0; bpi < VALID_BREAKPOINTS.length; bpi++) {
            if (bp === VALID_BREAKPOINTS[bpi]) {
              bpValid = true;
              break;
            }
          }
          if (!bpValid) {
            snMsg =
              'Screen name "' +
              nodeName +
              '" has invalid breakpoint "@' +
              bp +
              '" — use @sm (375), @md (768), or @lg (1440)';
          } else if (slashIdx === -1) {
            snMsg =
              'Screen name "' +
              nodeName +
              '" missing view segment after breakpoint — expected: Screen/{Feature}@{bp}/{View}';
          }
        }
      }
      addViolation(
        violations,
        violationsCappedRef,
        MAX_LINT_VIOLATIONS,
        node,
        depth,
        "HIGH",
        "screenNaming",
        "name",
        snMsg,
      );
    }
  }

  // ── TEXT STYLE checks ──
  if (localInsideScreen && chk.textStyles && nodeType === "TEXT") {
    categories.typography.total++;

    if (hasTextStyle(node)) {
      categories.typography.bound++;
      try {
        if ((node as TextNode).textStyleId === figma.mixed) {
          addViolation(
            violations,
            violationsCappedRef,
            MAX_LINT_VIOLATIONS,
            node,
            depth,
            "LOW",
            "typography",
            "textStyleId",
            "Text style override present (mixed styles in segments)",
          );
        }
      } catch (_e) {}
    } else {
      categories.typography.unbound++;
      addViolation(
        violations,
        violationsCappedRef,
        MAX_LINT_VIOLATIONS,
        node,
        depth,
        "HIGH",
        "typography",
        "textStyleId",
        "Text node without textStyleId applied",
      );
    }

    // Check for direct font variable bindings (CRITICAL)
    if (hasFontVariableBindings(node)) {
      addViolation(
        violations,
        violationsCappedRef,
        MAX_LINT_VIOLATIONS,
        node,
        depth,
        "CRITICAL",
        "typography",
        "fontVariables",
        "Font variable bound directly to text (should use text style instead)",
      );
    }
  }

  // ── FILL / COLOR checks ──
  if (localInsideScreen && chk.colors) {
    let fills: ReadonlyArray<Paint> | null = null;
    if ("fills" in node) {
      fills = (node as GeometryMixin).fills as ReadonlyArray<Paint>;
    }
    if (fills && fills !== (figma.mixed as unknown) && Array.isArray(fills)) {
      for (let fi = 0; fi < fills.length; fi++) {
        if (!isColorFill(fills[fi])) continue;

        let isIcon = isIconLike(node);
        let catName: "iconColors" | "backgroundFills" = isIcon ? "iconColors" : "backgroundFills";

        // Check for zero-opacity fill (invisible — should be removed)
        if (fills[fi].opacity === 0) {
          categories[catName].total++;
          categories[catName].unbound++;
          addViolation(
            violations,
            violationsCappedRef,
            MAX_LINT_VIOLATIONS,
            node,
            depth,
            "MEDIUM",
            catName,
            "fills[" + fi + "]",
            "Fill with 0% opacity (invisible) — should be removed",
          );
          continue;
        }

        categories[catName].total++;

        let fillBound = isFillBound(node, "fills", fi) || hasFillPaintStyle(node);
        if (fillBound) {
          categories[catName].bound++;
        } else {
          categories[catName].unbound++;
          let fillType = fills[fi].type;
          let isGradient = fillType !== "SOLID" && typeof fillType === "string" && fillType.indexOf("GRADIENT_") === 0;
          let fillMsg = isGradient
            ? "Gradient fill without a color style applied — create a color style with create_color_style and apply via set_color_style_id"
            : "Color using raw hex value (no variable or paint style bound)";
          addViolation(
            violations,
            violationsCappedRef,
            MAX_LINT_VIOLATIONS,
            node,
            depth,
            "HIGH",
            catName,
            "fills[" + fi + "]",
            fillMsg,
          );
        }
      }
    }
  }

  // ── STROKE checks ──
  if (localInsideScreen && chk.colors) {
    let strokes: ReadonlyArray<Paint> | null = null;
    if ("strokes" in node) {
      strokes = (node as GeometryMixin).strokes as ReadonlyArray<Paint>;
    }
    if (strokes && strokes !== (figma.mixed as unknown) && Array.isArray(strokes) && strokes.length > 0) {
      for (let si = 0; si < strokes.length; si++) {
        if (!isColorFill(strokes[si])) continue;

        // Check for zero-opacity stroke (invisible — should be removed)
        if (strokes[si].opacity === 0) {
          categories.strokesBorders.total++;
          categories.strokesBorders.unbound++;
          addViolation(
            violations,
            violationsCappedRef,
            MAX_LINT_VIOLATIONS,
            node,
            depth,
            "MEDIUM",
            "strokesBorders",
            "strokes[" + si + "]",
            "Stroke with 0% opacity (invisible) — should be removed",
          );
          continue;
        }

        categories.strokesBorders.total++;
        let strokeBound = isFillBound(node, "strokes", si) || hasStrokePaintStyle(node);
        if (strokeBound) {
          categories.strokesBorders.bound++;
        } else {
          categories.strokesBorders.unbound++;
          addViolation(
            violations,
            violationsCappedRef,
            MAX_LINT_VIOLATIONS,
            node,
            depth,
            "HIGH",
            "strokesBorders",
            "strokes[" + si + "]",
            "Stroke color using raw hex value (no variable or paint style bound)",
          );
        }
      }
    }
  }

  // ── SPACING checks (auto-layout frames) ──
  if (
    localInsideScreen &&
    chk.spacing &&
    (nodeType === "FRAME" || nodeType === "COMPONENT" || nodeType === "COMPONENT_SET" || nodeType === "INSTANCE")
  ) {
    let layoutMode: string | null = null;
    try {
      layoutMode = (node as FrameNode).layoutMode;
    } catch (_e) {}

    if (layoutMode && layoutMode !== "NONE") {
      // GRID frames keep a stale itemSpacing from before they became a grid; the
      // properties that actually render (and that accept variable bindings) are
      // gridRowGap/gridColumnGap. Checking itemSpacing there is pure noise.
      let spacingProps = layoutMode === "GRID" ? ["gridRowGap", "gridColumnGap"] : ["itemSpacing"];
      for (let si = 0; si < spacingProps.length; si++) {
        let spacingProp = spacingProps[si];
        let spacingVal = 0;
        try {
          spacingVal = (node as any)[spacingProp];
        } catch (_e) {}
        if (!(spacingVal > 0)) continue;
        categories.spacing.total++;
        if (isScalarBound(node, spacingProp)) {
          categories.spacing.bound++;
        } else {
          categories.spacing.unbound++;
          addViolation(
            violations,
            violationsCappedRef,
            MAX_LINT_VIOLATIONS,
            node,
            depth,
            "MEDIUM",
            "spacing",
            spacingProp,
            (layoutMode === "GRID" ? "Grid gap" : "Item spacing") +
              " using raw number (" +
              spacingVal +
              ") — no variable bound",
          );
        }
      }

      // Check padding
      let paddingProps = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
      for (let ppi = 0; ppi < paddingProps.length; ppi++) {
        let padVal = 0;
        try {
          padVal = (node as FrameNode)[paddingProps[ppi] as keyof FrameNode] as number;
        } catch (_e) {}
        if (padVal > 0) {
          categories.spacing.total++;
          if (isScalarBound(node, paddingProps[ppi])) {
            categories.spacing.bound++;
          } else {
            categories.spacing.unbound++;
            addViolation(
              violations,
              violationsCappedRef,
              MAX_LINT_VIOLATIONS,
              node,
              depth,
              "MEDIUM",
              "spacing",
              paddingProps[ppi],
              paddingProps[ppi] + " using raw number (" + padVal + ") — no variable bound",
            );
          }
        }
      }
    }
  }

  // ── BORDER RADIUS checks ──
  if (
    localInsideScreen &&
    chk.radius &&
    (nodeType === "FRAME" ||
      nodeType === "RECTANGLE" ||
      nodeType === "COMPONENT" ||
      nodeType === "INSTANCE" ||
      nodeType === "ELLIPSE")
  ) {
    let cornerRadius: number | symbol = 0;
    try {
      cornerRadius = (node as RectangleNode).cornerRadius;
    } catch (_e) {}

    if (cornerRadius && cornerRadius !== figma.mixed && (cornerRadius as number) > 0) {
      categories.borderRadius.total++;
      if (
        isScalarBound(node, "topLeftRadius") ||
        isScalarBound(node, "topRightRadius") ||
        isScalarBound(node, "bottomLeftRadius") ||
        isScalarBound(node, "bottomRightRadius") ||
        isScalarBound(node, "cornerRadius")
      ) {
        categories.borderRadius.bound++;
      } else {
        categories.borderRadius.unbound++;
        addViolation(
          violations,
          violationsCappedRef,
          MAX_LINT_VIOLATIONS,
          node,
          depth,
          "MEDIUM",
          "borderRadius",
          "cornerRadius",
          "Border radius using raw number (" + (cornerRadius as number) + ") — no variable bound",
        );
      }
    } else if (cornerRadius === figma.mixed) {
      // Individual corners set — check each
      let radiusProps = ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"];
      for (let ri = 0; ri < radiusProps.length; ri++) {
        let rVal = 0;
        try {
          rVal = (node as RectangleNode)[radiusProps[ri] as keyof RectangleNode] as number;
        } catch (_e) {}
        if (rVal > 0) {
          categories.borderRadius.total++;
          if (isScalarBound(node, radiusProps[ri])) {
            categories.borderRadius.bound++;
          } else {
            categories.borderRadius.unbound++;
            addViolation(
              violations,
              violationsCappedRef,
              MAX_LINT_VIOLATIONS,
              node,
              depth,
              "MEDIUM",
              "borderRadius",
              radiusProps[ri],
              radiusProps[ri] + " using raw number (" + rVal + ") — no variable bound",
            );
          }
        }
      }
    }
  }

  // ── CLIPPED CORNER check ──
  // A clipping child that paints a background and reaches its rounded parent's
  // edges will paint straight over the parent's corner curve. The parent still
  // reports a radius, so this only shows up in the render — worth flagging hard.
  if (localInsideScreen && chk.clippedCorners && parent !== null && parent !== undefined) {
    let clips = false;
    try {
      clips = (node as FrameNode).clipsContent === true;
    } catch (_e) {}

    if (clips && hasVisibleBackgroundFill(node)) {
      let parentRadius = effectiveCornerRadius(parent);
      let ownRadius = effectiveCornerRadius(node);
      if (parentRadius !== null && parentRadius > 0 && ownRadius !== null && ownRadius < parentRadius) {
        let pw = 0;
        let ph = 0;
        let nx = 0;
        let ny = 0;
        let nw = 0;
        let nh = 0;
        let measured = false;
        try {
          pw = (parent as FrameNode).width;
          ph = (parent as FrameNode).height;
          nx = (node as SceneNode & { x: number }).x;
          ny = (node as SceneNode & { y: number }).y;
          nw = (node as SceneNode & { width: number }).width;
          nh = (node as SceneNode & { height: number }).height;
          measured = true;
        } catch (_e) {}
        let tol = EDGE_FLUSH_TOLERANCE;
        let spansWidth = measured && nx <= tol && nx + nw >= pw - tol;
        let touchesTop = measured && ny <= tol;
        let touchesBottom = measured && ny + nh >= ph - tol;

        if (spansWidth && (touchesTop || touchesBottom)) {
          categories.borderRadius.total++;
          categories.borderRadius.unbound++;
          addViolation(
            violations,
            violationsCappedRef,
            MAX_LINT_VIOLATIONS,
            node,
            depth,
            "HIGH",
            "borderRadius",
            "cornerRadius",
            "Clipping child with cornerRadius " +
              ownRadius +
              " spans the edges of a parent with cornerRadius " +
              parentRadius +
              " — its square background paints over the parent's rounded corners. Bind the same radius token (" +
              parentRadius +
              ") on this node, or turn off its background fill",
          );
        }
      }
    }
  }

  // ── RADIUS PROPORTION check ──
  // A radius close to (but short of) half the height reads as a lens rather than
  // a rounded rectangle. True capsules are exempt — those are deliberate pills.
  if (localInsideScreen && chk.radiusProportion && nodeType !== "ELLIPSE") {
    let rpRadius = effectiveCornerRadius(node);
    let rpHeight = 0;
    try {
      rpHeight = (node as SceneNode & { height: number }).height;
    } catch (_e) {}

    if (rpRadius !== null && rpRadius > 0 && rpHeight > 0) {
      let capsuleThreshold = (rpHeight / 2) * CAPSULE_RATIO;
      // NOTE: a "*full" radius token cannot be recognised here — scanNode is
      // synchronous and variable names need an async lookup. The capsule
      // threshold covers the same intent geometrically.
      if (rpRadius > RADIUS_HEIGHT_RATIO * rpHeight && rpRadius < capsuleThreshold) {
        let rpPct = Math.round((rpRadius / rpHeight) * 100);
        addViolation(
          violations,
          violationsCappedRef,
          MAX_LINT_VIOLATIONS,
          node,
          depth,
          "MEDIUM",
          "borderRadius",
          "cornerRadius",
          "cornerRadius " +
            rpRadius +
            " is " +
            rpPct +
            "% of height " +
            Math.round(rpHeight) +
            " — reads as a lens, not a rounded rectangle",
        );
      }
    }
  }

  // ── EFFECT STYLE checks ──
  if (localInsideScreen && chk.effectStyles) {
    let effects: ReadonlyArray<Effect> | null = null;
    try {
      effects = (node as BlendMixin).effects;
    } catch (_e) {}
    if (effects && Array.isArray(effects) && effects.length > 0) {
      let hasVisibleEffects = false;
      for (let efi = 0; efi < effects.length; efi++) {
        if (effects[efi].visible !== false) {
          hasVisibleEffects = true;
          break;
        }
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
            violations,
            violationsCappedRef,
            MAX_LINT_VIOLATIONS,
            node,
            depth,
            "CRITICAL",
            "effectStyles",
            "effectStyleId",
            "Raw " + effectTypes.join("/") + " effect (no effect style applied)",
          );
        }
      }
    }
  }

  // ── AUTO-LAYOUT compliance ──
  if (
    localInsideScreen &&
    chk.autoLayout &&
    (nodeType === "FRAME" || nodeType === "COMPONENT" || nodeType === "COMPONENT_SET")
  ) {
    // Skip icon-like frames — they intentionally use absolute positioning for SVG paths
    let skipAutoLayoutCheck = isIconLike(node);

    let hasLayout = false;
    if ("layoutMode" in node) {
      const lm = (node as FrameNode).layoutMode;
      hasLayout = lm && lm !== "NONE" ? true : false;
    }

    if (!hasLayout && !skipAutoLayoutCheck) {
      let childCount = 0;
      if ("children" in node) {
        const childrenArr = (node as FrameNode).children;
        childCount = childrenArr ? childrenArr.length : 0;
      }
      if (childCount > 0) {
        addViolation(
          violations,
          violationsCappedRef,
          MAX_LINT_VIOLATIONS,
          node,
          depth,
          "MEDIUM",
          "autoLayout",
          "layoutMode",
          "Frame has " + childCount + " children but no auto-layout set",
        );
      }
    } else {
      let alChildren: ReadonlyArray<SceneNode> | null = null;
      if ("children" in node) {
        alChildren = (node as FrameNode).children;
      }
      if (alChildren && alChildren.length > 0) {
        let absChildCount = 0;
        for (let alci = 0; alci < alChildren.length; alci++) {
          const alChild = alChildren[alci];
          let alChildPos: string | null = null;
          if ("layoutPositioning" in alChild) {
            alChildPos = (alChild as SceneNode & { layoutPositioning?: string }).layoutPositioning as string;
          }
          if (alChildPos === "ABSOLUTE") {
            absChildCount++;
          }
        }
        if (absChildCount > 0) {
          addViolation(
            violations,
            violationsCappedRef,
            MAX_LINT_VIOLATIONS,
            node,
            depth,
            "LOW",
            "autoLayout",
            "layoutPositioning",
            "Auto-layout frame has " +
              absChildCount +
              " absolute-positioned " +
              (absChildCount === 1 ? "child" : "children") +
              " — verify intentional",
          );
        }
      }
    }
  }

  // ── CROSS-AXIS ALIGNMENT check ──
  // Content pinned to the start of a fixed cross-axis box leaves uneven space on
  // the far side. LOW severity: genuinely top-aligned lists are a real pattern.
  if (
    localInsideScreen &&
    chk.crossAxisAlign &&
    (nodeType === "FRAME" || nodeType === "COMPONENT" || nodeType === "COMPONENT_SET" || nodeType === "INSTANCE")
  ) {
    let caLayout: string | null = null;
    let caAlign: string | null = null;
    let caSizingH: string | null = null;
    let caSizingV: string | null = null;
    try {
      caLayout = (node as FrameNode).layoutMode;
      caAlign = (node as FrameNode).counterAxisAlignItems as string;
      caSizingH = (node as FrameNode).layoutSizingHorizontal;
      caSizingV = (node as FrameNode).layoutSizingVertical;
    } catch (_e) {}

    if ((caLayout === "HORIZONTAL" || caLayout === "VERTICAL") && caAlign === "MIN") {
      // The cross axis is the one the layout does NOT flow along.
      let crossFixed = caLayout === "HORIZONTAL" ? caSizingV === "FIXED" : caSizingH === "FIXED";
      let caChildCount = 0;
      if ("children" in node) {
        let caChildren = (node as FrameNode).children;
        caChildCount = caChildren ? caChildren.length : 0;
      }
      if (crossFixed && caChildCount > 0) {
        let caAxisWord = caLayout === "HORIZONTAL" ? "height" : "width";
        let caEdgeWord = caLayout === "HORIZONTAL" ? "top" : "left";
        addViolation(
          violations,
          violationsCappedRef,
          MAX_LINT_VIOLATIONS,
          node,
          depth,
          "LOW",
          "autoLayout",
          "counterAxisAlignItems",
          "counterAxisAlignItems MIN on a container with fixed " +
            caAxisWord +
            " — content is pinned to the " +
            caEdgeWord +
            " and leaves uneven space on the far side. Use CENTER, or let the " +
            caAxisWord +
            " hug its content",
        );
      }
    }
  }

  // ── ICON COLOR CONSISTENCY check ──
  // A recolour that only touched the first vector leaves the rest at the old
  // colour. The icon looks fixed at a glance, so only a count catches it.
  if (localInsideScreen && chk.iconColorConsistency && "children" in node) {
    let icChildren: ReadonlyArray<SceneNode> | null = null;
    try {
      icChildren = (node as FrameNode).children;
    } catch (_e) {}

    // Only report on the outermost icon container — nested SVG <g> groups are
    // icon-like too and would otherwise re-report the same mismatch.
    let icNestedInIcon = parent !== null && parent !== undefined && isIconLike(parent);

    if (
      !icNestedInIcon &&
      icChildren &&
      icChildren.length > 0 &&
      isIconLike(node) &&
      hasOnlyVectorChildren(icChildren)
    ) {
      let icLeaves: SceneNode[] = [];
      collectVectorLeaves(icChildren, icLeaves);

      let icTotal = 0;
      let icBound = 0;
      for (let ili = 0; ili < icLeaves.length; ili++) {
        let icState = paintBindingState(icLeaves[ili]);
        if (icState === null) continue;
        icTotal++;
        if (icState === true) icBound++;
      }

      if (icTotal > 1 && icBound > 0 && icBound < icTotal) {
        addViolation(
          violations,
          violationsCappedRef,
          MAX_LINT_VIOLATIONS,
          node,
          depth,
          "MEDIUM",
          "iconColors",
          "fills",
          "Icon is only partly token-bound — " +
            icBound +
            " of " +
            icTotal +
            " vector parts have a bound colour. The remaining " +
            (icTotal - icBound) +
            " still carry their original raw colour and will not follow a recolour",
        );
      }
    }
  }

  // ── FIXED-WIDTH SLACK check ──
  // A small, packed, fixed-width row whose children cannot grow into the extra
  // width just carries dead space on its right.
  if (
    localInsideScreen &&
    chk.fixedWidthSlack &&
    (nodeType === "FRAME" || nodeType === "COMPONENT" || nodeType === "INSTANCE")
  ) {
    let fwLayout: string | null = null;
    let fwSizingH: string | null = null;
    let fwPrimary: string | null = null;
    let fwWidth = 0;
    let fwPadL = 0;
    let fwPadR = 0;
    let fwGap = 0;
    try {
      fwLayout = (node as FrameNode).layoutMode;
      fwSizingH = (node as FrameNode).layoutSizingHorizontal;
      fwPrimary = (node as FrameNode).primaryAxisAlignItems as string;
      fwWidth = (node as SceneNode & { width: number }).width;
      fwPadL = (node as FrameNode).paddingLeft || 0;
      fwPadR = (node as FrameNode).paddingRight || 0;
      fwGap = (node as FrameNode).itemSpacing || 0;
    } catch (_e) {}

    // Tightly gated: only packed (MIN) horizontal rows. CENTER/SPACE_BETWEEN
    // distribute the slack deliberately, and wide containers are scaffolding.
    if (
      fwLayout === "HORIZONTAL" &&
      fwSizingH === "FIXED" &&
      fwPrimary === "MIN" &&
      fwWidth > 0 &&
      fwWidth <= FIXED_WIDTH_SLACK_MAX_WIDTH &&
      "children" in node
    ) {
      let fwChildren = (node as FrameNode).children;
      if (fwChildren && fwChildren.length > 0) {
        let fwContent = fwPadL + fwPadR + fwGap * (fwChildren.length - 1);
        let fwStretchy = false;
        for (let fwi = 0; fwi < fwChildren.length; fwi++) {
          let fwChild = fwChildren[fwi];
          if ((fwChild as SceneNode & { visible?: boolean }).visible === false) {
            fwStretchy = true; // hidden children make the measurement unreliable
            break;
          }
          let fwChildSizing: string | null = null;
          let fwChildPos: string | null = null;
          try {
            fwChildSizing = (fwChild as FrameNode).layoutSizingHorizontal;
            fwChildPos = (fwChild as SceneNode & { layoutPositioning?: string }).layoutPositioning as string;
          } catch (_e) {}
          // A FILL child already absorbs the extra width; an absolute child is
          // outside the flow entirely.
          if (fwChildSizing === "FILL" || fwChildPos === "ABSOLUTE") {
            fwStretchy = true;
            break;
          }
          try {
            fwContent += (fwChild as SceneNode & { width: number }).width;
          } catch (_e) {
            fwStretchy = true;
            break;
          }
        }

        let fwSlack = fwWidth - fwContent;
        if (!fwStretchy && fwSlack > FIXED_WIDTH_SLACK_TOLERANCE) {
          addViolation(
            violations,
            violationsCappedRef,
            MAX_LINT_VIOLATIONS,
            node,
            depth,
            "MEDIUM",
            "autoLayout",
            "layoutSizingHorizontal",
            "Fixed width " +
              Math.round(fwWidth) +
              " leaves " +
              Math.round(fwSlack) +
              "px of dead space after its packed content — let the width hug its content, or centre the children",
          );
        }
      }
    }
  }

  // ── OVERFLOW check ──
  if (localInsideScreen && !isScreenRoot && chk.overflow && parent !== null && parent !== undefined) {
    let ovPositioning: string | null = null;
    try {
      ovPositioning = (node as SceneNode & { layoutPositioning?: string }).layoutPositioning as string;
    } catch (_e) {}
    let ovName = "";
    try {
      ovName = node.name || "";
    } catch (_e) {}
    let skipOv = ovPositioning === "ABSOLUTE" || ovName.indexOf("Icon/") === 0 || ovName.indexOf("Image/") === 0;
    if (!skipOv) {
      let childBBox: Rect | null = null;
      try {
        childBBox = (node as SceneNode & { absoluteBoundingBox?: Rect }).absoluteBoundingBox as Rect;
      } catch (_e) {}
      if (childBBox && parentBBox) {
        let OV_TOL = 1;
        categories.overflow.total++;
        let hOverflow = childBBox.x + childBBox.width - (parentBBox.x + parentBBox.width);
        let hasHOv = hOverflow > OV_TOL;
        let hasVOv = false;
        let vOverflow = 0;
        let parentSizingV: string | null = null;
        try {
          parentSizingV = (parent as FrameNode).layoutSizingVertical;
        } catch (_e) {}
        if (parentSizingV === "FIXED") {
          vOverflow = childBBox.y + childBBox.height - (parentBBox.y + parentBBox.height);
          hasVOv = vOverflow > OV_TOL;
        }
        if (hasHOv || hasVOv) {
          categories.overflow.unbound++;
          if (hasHOv) {
            let hAmt = Math.ceil(hOverflow);
            let hDetails: ViolationDetails = {
              axis: "horizontal",
              overflowAmount: hAmt,
              childRight: Math.round(childBBox.x + childBBox.width),
              parentRight: Math.round(parentBBox.x + parentBBox.width),
            };
            addViolation(
              violations,
              violationsCappedRef,
              MAX_LINT_VIOLATIONS,
              node,
              depth,
              "CRITICAL",
              "overflow",
              "absoluteBoundingBox",
              "Horizontal overflow: child extends " + hAmt + "px beyond parent right edge",
              hDetails,
            );
          }
          if (hasVOv) {
            let vAmt = Math.ceil(vOverflow);
            let vDetails: ViolationDetails = {
              axis: "vertical",
              overflowAmount: vAmt,
              childBottom: Math.round(childBBox.y + childBBox.height),
              parentBottom: Math.round(parentBBox.y + parentBBox.height),
            };
            addViolation(
              violations,
              violationsCappedRef,
              MAX_LINT_VIOLATIONS,
              node,
              depth,
              "CRITICAL",
              "overflow",
              "absoluteBoundingBox",
              "Vertical overflow: child extends " + vAmt + "px beyond parent bottom edge",
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
  if ("children" in node && (node as ChildrenMixin).children) {
    let nodeBBox: Rect | null = null;
    if (chk.overflow) {
      try {
        nodeBBox = (node as SceneNode & { absoluteBoundingBox?: Rect }).absoluteBoundingBox as Rect;
      } catch (_e) {}
    }
    let nodeChildren = (node as ChildrenMixin).children;
    for (let ci = 0; ci < nodeChildren.length; ci++) {
      scanNode(
        nodeChildren[ci],
        depth + 1,
        node,
        nodeBBox,
        chk,
        categories,
        violations,
        violationsCappedRef,
        totalNodesRef,
        localInsideScreen,
      );
    }
  }
}

// Reads a node's effective corner radius. Returns the smallest of the four
// corners when they differ, since the smallest corner is the one that squares
// off a rounded parent.
function effectiveCornerRadius(node: SceneNode): number | null {
  let cr: number | symbol | undefined;
  try {
    cr = (node as RectangleNode).cornerRadius;
  } catch (_e) {
    return null;
  }
  if (typeof cr === "number") return cr;
  if (cr !== figma.mixed) return null;
  let corners = ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"];
  let min: number | null = null;
  for (let i = 0; i < corners.length; i++) {
    let v: unknown;
    try {
      v = (node as unknown as Record<string, unknown>)[corners[i]];
    } catch (_e) {
      return null;
    }
    if (typeof v !== "number") return null;
    if (min === null || v < min) min = v;
  }
  return min;
}
