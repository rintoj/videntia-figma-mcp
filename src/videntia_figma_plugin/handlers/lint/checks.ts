import type {
  Violation,
  ViolationDetails,
  ViolationSeverity,
  ViolationCategory,
  ActiveChecks,
  LintCategories,
  LintRuleId,
  LintScope,
  IgnoreSet,
  ScanInherited,
} from "./types";
import {
  addViolation,
  isFillBound,
  isScalarBound,
  isIconLike,
  isColorFill,
  isImageLayer,
  hasOnlyVectorChildren,
  hasVisibleBackgroundFill,
  paintBindingState,
  collectVectorLeaves,
  hasFillPaintStyle,
  hasStrokePaintStyle,
  hasTextStyle,
  hasEffectStyle,
  hasFontVariableBindings,
  readNodeIgnore,
  mergeIgnore,
  isSuppressed,
  countSuppressed,
  readInstanceOverrides,
  isPaintOverridden,
  isGradientFullyBound,
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

// ── Rules, suppression and instance paints ────────────────────────────────────
//
// Every violation carries a stable kebab-case `rule` id (LINT_RULE_IDS). A rule
// is suppressed for a node — and its whole subtree — by `ignoreNodeIds` (all
// rules), `ignoreRules` (rule ids or category names, scan-wide), shared plugin
// data `videntia` / `lint-ignore` ("*" or comma-separated rules) or a name token
// `[lint-ignore]` / `[lint-ignore:rule1,rule2]`. A suppressed item is excluded
// from category tallies (so from compliance) and counted in `suppressed`.
//
// Fill/stroke color rules (hardcoded-color, gradient-without-style,
// invisible-paint) skip paints inside an INSTANCE (the instance itself included)
// that are inherited from the main component; only paints listed as overridden
// (`fills`/`fillStyleId`, `strokes`/`strokeStyleId`) in the outermost enclosing
// instance's `overrides` are checked. The main component, when inside the linted
// subtree, is reported once like any other node. Other checks keep their
// instance behaviour.

// ── CLIPPED CONTENT (rule: clipped-content, category: clippedContent) ─────────
//
// A frame with clipsContent=true silently crops anything rendered past its
// bounds — drop shadows, glows, focus rings, outside strokes and overflowing
// children vanish without any bounding-box overflow being visible.
//
// For every clipping FRAME/COMPONENT/COMPONENT_SET/INSTANCE, each visible
// descendant (ABSOLUTE-positioned ones included) down to the next clipping
// container is measured by its render extent — absoluteBoundingBox expanded by:
//   - DROP_SHADOW:  offset ± (radius + spread)
//   - LAYER_BLUR:   radius on every side (INNER_SHADOW / BACKGROUND_BLUR: none)
//   - strokes:      strokeWeight (OUTSIDE) or strokeWeight / 2 (CENTER)
// Any side crossing the clipping bounds by more than 1px is reported HIGH, with
// the clipping ancestor, per-side px, and cause (effect vs the node's own bounds).
//
// Not reported (intentional crops):
//   - image layers (visible IMAGE fill or `Image/` name) overflowing via their bounds
//   - bounds overflow under a screen-level clip (the linted root, a page or
//     section child, or a `Screen/` frame) — screen content legitimately scrolls; only effect
//     clipping is reported there
// A nested clipping container is measured as a whole (bounds + own effects); its
// contents are checked against it when the scan reaches it. A node reported for
// bounds overflow is not descended into (its children are clipped as a consequence).
//
// Dedup with overflow: while clippedContent is enabled, the overflow rule skips
// direct children of a non-screen-level clipping container — clipped-content
// owns that case, so a carousel item is reported once.

type ClipSide = "top" | "right" | "bottom" | "left";
const CLIP_SIDES: ClipSide[] = ["top", "right", "bottom", "left"];
const CLIP_TOLERANCE = 1;

interface RenderExtent {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function isClippingContainer(node: SceneNode): boolean {
  let t = node.type;
  if (t !== "FRAME" && t !== "COMPONENT" && t !== "COMPONENT_SET" && t !== "INSTANCE") return false;
  try {
    return (node as FrameNode).clipsContent === true;
  } catch (_e) {
    return false;
  }
}

function readBBox(node: SceneNode): Rect | null {
  try {
    let b = (node as SceneNode & { absoluteBoundingBox?: Rect | null }).absoluteBoundingBox;
    return b ? b : null;
  } catch (_e) {
    return null;
  }
}

function readNumberProp(node: SceneNode, prop: string): number | null {
  try {
    let v = (node as unknown as Record<string, unknown>)[prop];
    return typeof v === "number" ? v : null;
  } catch (_e) {
    return null;
  }
}

export function computeRenderExtent(node: SceneNode, box: Rect): { extent: RenderExtent; sources: string[] } {
  let boxRight = box.x + box.width;
  let boxBottom = box.y + box.height;
  let extent: RenderExtent = { top: box.y, right: boxRight, bottom: boxBottom, left: box.x };
  let sources: string[] = [];

  let grow = (source: string, top: number, right: number, bottom: number, left: number) => {
    if (top < box.y || right > boxRight || bottom > boxBottom || left < box.x) {
      if (sources.indexOf(source) === -1) sources.push(source);
    }
    if (top < extent.top) extent.top = top;
    if (right > extent.right) extent.right = right;
    if (bottom > extent.bottom) extent.bottom = bottom;
    if (left < extent.left) extent.left = left;
  };

  let effects: ReadonlyArray<Effect> | null = null;
  try {
    effects = (node as BlendMixin).effects;
  } catch (_e) {}
  if (effects && Array.isArray(effects)) {
    for (let i = 0; i < effects.length; i++) {
      let ef = effects[i];
      if (!ef || ef.visible === false) continue;
      if (ef.type === "DROP_SHADOW") {
        let ds = ef as DropShadowEffect;
        let reach = (typeof ds.radius === "number" ? ds.radius : 0) + (typeof ds.spread === "number" ? ds.spread : 0);
        let ox = ds.offset && typeof ds.offset.x === "number" ? ds.offset.x : 0;
        let oy = ds.offset && typeof ds.offset.y === "number" ? ds.offset.y : 0;
        grow("DROP_SHADOW", box.y + oy - reach, boxRight + ox + reach, boxBottom + oy + reach, box.x + ox - reach);
      } else if (ef.type === "LAYER_BLUR") {
        let r = typeof (ef as BlurEffect).radius === "number" ? (ef as BlurEffect).radius : 0;
        grow("LAYER_BLUR", box.y - r, boxRight + r, boxBottom + r, box.x - r);
      }
    }
  }

  let strokes: ReadonlyArray<Paint> | null = null;
  try {
    strokes = (node as GeometryMixin).strokes;
  } catch (_e) {}
  let hasVisibleStroke = false;
  if (strokes && Array.isArray(strokes)) {
    for (let si = 0; si < strokes.length; si++) {
      if (strokes[si] && strokes[si].visible !== false) {
        hasVisibleStroke = true;
        break;
      }
    }
  }
  if (hasVisibleStroke) {
    let align = "";
    try {
      align = String((node as GeometryMixin & { strokeAlign?: string }).strokeAlign || "");
    } catch (_e) {}
    let factor = align === "OUTSIDE" ? 1 : align === "CENTER" ? 0.5 : 0;
    if (factor > 0) {
      let base = readNumberProp(node, "strokeWeight");
      // A LINE's stroke spreads across the line, not past its ends (caps aside), so an
      // axis-aligned line only widens on the sides perpendicular to it.
      let isLine = node.type === "LINE";
      let lineIsHorizontal = isLine && box.height < 1;
      let lineIsVertical = isLine && box.width < 1;
      let sideWeight = (prop: string) => {
        let horizontalSide = prop === "strokeLeftWeight" || prop === "strokeRightWeight";
        if ((lineIsHorizontal && horizontalSide) || (lineIsVertical && !horizontalSide)) return 0;
        let v = readNumberProp(node, prop);
        return (v !== null ? v : base !== null ? base : 0) * factor;
      };
      grow(
        align + " stroke",
        box.y - sideWeight("strokeTopWeight"),
        boxRight + sideWeight("strokeRightWeight"),
        boxBottom + sideWeight("strokeBottomWeight"),
        box.x - sideWeight("strokeLeftWeight"),
      );
    }
  }

  return { extent, sources };
}

export function checkClippedContent(
  clipNode: SceneNode,
  clipDepth: number,
  screenLevel: boolean,
  categories: LintCategories,
  violations: Violation[],
  violationsCappedRef: { value: boolean },
  scope?: LintScope,
  clipIgnore?: IgnoreSet | null,
): void {
  let clipBox = readBBox(clipNode);
  if (!clipBox) return;
  let children: ReadonlyArray<SceneNode> | null = null;
  try {
    children = (clipNode as ChildrenMixin).children;
  } catch (_e) {}
  if (!children) return;
  for (let i = 0; i < children.length; i++) {
    visitClippedDescendant(
      children[i],
      clipDepth + 1,
      clipNode,
      clipBox,
      screenLevel,
      categories,
      violations,
      violationsCappedRef,
      scope,
      clipIgnore || null,
    );
  }
}

function visitClippedDescendant(
  node: SceneNode,
  depth: number,
  clipNode: SceneNode,
  clipBox: Rect,
  screenLevel: boolean,
  categories: LintCategories,
  violations: Violation[],
  violationsCappedRef: { value: boolean },
  scope: LintScope | undefined,
  parentIgnore: IgnoreSet | null,
): void {
  if ((node as SceneNode & { visible?: boolean }).visible === false) return;
  if (depth > MAX_LINT_DEPTH) return;

  let ignore = parentIgnore && parentIgnore.all ? parentIgnore : mergeIgnore(parentIgnore, readNodeIgnore(node, scope));
  let suppressed = isSuppressed(ignore, scope, "clippedContent", "clipped-content");

  let nodeType = node.type;
  let reportedBounds = false;
  let box = readBBox(node);

  if (box) {
    let rendered = computeRenderExtent(node, box);
    let clipRight = clipBox.x + clipBox.width;
    let clipBottom = clipBox.y + clipBox.height;
    let extentOver: Record<ClipSide, number> = {
      top: clipBox.y - rendered.extent.top,
      right: rendered.extent.right - clipRight,
      bottom: rendered.extent.bottom - clipBottom,
      left: clipBox.x - rendered.extent.left,
    };
    let boundsOver: Record<ClipSide, number> = {
      top: clipBox.y - box.y,
      right: box.x + box.width - clipRight,
      bottom: box.y + box.height - clipBottom,
      left: clipBox.x - box.x,
    };

    // GROUP bounds are just the union of its children, which are checked individually.
    let ignoreBoundsCause = screenLevel || nodeType === "GROUP" || isImageLayer(node);

    let clippedSides: { top?: number; right?: number; bottom?: number; left?: number } = {};
    let sideLabels: string[] = [];
    let anyBounds = false;
    let anyEffect = false;
    let maxAmount = 0;
    for (let si = 0; si < CLIP_SIDES.length; si++) {
      let side = CLIP_SIDES[si];
      if (extentOver[side] <= CLIP_TOLERANCE) continue;
      let boundsCause = boundsOver[side] > CLIP_TOLERANCE;
      if (boundsCause && ignoreBoundsCause) continue;
      let amount = Math.ceil(extentOver[side] - 0.001);
      clippedSides[side] = amount;
      sideLabels.push(side + " " + amount + "px");
      if (amount > maxAmount) maxAmount = amount;
      if (boundsCause) anyBounds = true;
      else anyEffect = true;
    }

    if (suppressed) {
      if (sideLabels.length > 0) {
        countSuppressed(scope, "clipped-content");
        reportedBounds = anyBounds;
      }
    } else {
      categories.clippedContent.total++;
      if (sideLabels.length === 0) {
        categories.clippedContent.bound++;
      } else {
        categories.clippedContent.unbound++;
        let clipId = clipNode.id;
        let clipName = "";
        try {
          clipName = clipNode.name || "";
        } catch (_e) {}
        let sourceLabel = rendered.sources.length > 0 ? rendered.sources.join("/") : "Render extent";
        let what = anyBounds ? (anyEffect ? "Node bounds and " + sourceLabel : "Node bounds") : sourceLabel;
        let message =
          what +
          ' clipped by ancestor "' +
          clipName +
          '" (' +
          clipId +
          ", clipsContent=true) — crosses " +
          sideLabels.join(", ") +
          '. Fix: set_clips_content {nodeId: "' +
          clipId +
          '", clipsContent: false} on the ancestor, or add padding ≥ ' +
          maxAmount +
          "px on the clipped side" +
          (sideLabels.length > 1 ? "s" : "");
        let details: ViolationDetails = {
          overflowAmount: maxAmount,
          clippingNodeId: clipId,
          clippingNodeName: clipName,
          clippedSides: clippedSides,
          cause: anyBounds && anyEffect ? "bounds+effect" : anyBounds ? "bounds" : "effect",
          effectSources: rendered.sources,
        };
        addViolation(
          violations,
          violationsCappedRef,
          MAX_LINT_VIOLATIONS,
          node,
          depth,
          "HIGH",
          "clippedContent",
          "clipped-content",
          "clipsContent",
          message,
          details,
        );
        reportedBounds = anyBounds;
      }
    }
  }

  if (reportedBounds || isClippingContainer(node) || nodeType === "BOOLEAN_OPERATION") return;
  let kids: ReadonlyArray<SceneNode> | null = null;
  try {
    if ("children" in node) kids = (node as ChildrenMixin).children;
  } catch (_e) {}
  if (!kids) return;
  for (let k = 0; k < kids.length; k++) {
    visitClippedDescendant(
      kids[k],
      depth + 1,
      clipNode,
      clipBox,
      screenLevel,
      categories,
      violations,
      violationsCappedRef,
      scope,
      ignore,
    );
  }
}

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
  scope?: LintScope,
  inherited?: ScanInherited,
): void {
  // Skip invisible nodes
  if ((node as SceneNode & { visible?: boolean }).visible === false) return;

  // Depth limit to prevent stack overflow in deeply nested designs
  if (depth > MAX_LINT_DEPTH) return;

  totalNodesRef.value++;
  let nodeType = node.type;

  // Suppression inherited from ancestors plus this node's own lint-ignore markers
  let inheritedIgnore = inherited ? inherited.ignore : null;
  let ignore =
    inheritedIgnore && inheritedIgnore.all
      ? inheritedIgnore
      : mergeIgnore(inheritedIgnore, readNodeIgnore(node, scope));

  // Inside an instance, paints not overridden on the outermost instance are inherited
  let instanceOverrides = inherited ? inherited.instanceOverrides : null;
  if (!instanceOverrides && nodeType === "INSTANCE") instanceOverrides = readInstanceOverrides(node);

  let pass = (category: ViolationCategory, rule: LintRuleId) => {
    if (isSuppressed(ignore, scope, category, rule)) return;
    categories[category].total++;
    categories[category].bound++;
  };
  // tally=false: the violation does not own a category tally item (it annotates a passing or untallied check)
  let fail = (
    severity: ViolationSeverity,
    category: ViolationCategory,
    rule: LintRuleId,
    property: string,
    message: string,
    details?: ViolationDetails,
    tally?: boolean,
  ) => {
    if (isSuppressed(ignore, scope, category, rule)) {
      countSuppressed(scope, rule);
      return;
    }
    if (tally !== false) {
      categories[category].total++;
      categories[category].unbound++;
    }
    addViolation(
      violations,
      violationsCappedRef,
      MAX_LINT_VIOLATIONS,
      node,
      depth,
      severity,
      category,
      rule,
      property,
      message,
      details,
    );
  };

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
      if (rfSizingH === "FIXED") {
        pass("rootFrame", "root-frame-width-fixed");
      } else {
        fail(
          "CRITICAL",
          "rootFrame",
          "root-frame-width-fixed",
          "layoutSizingHorizontal",
          "Root frame width must be FIXED (currently: " +
            (rfSizingH !== null && rfSizingH !== undefined ? rfSizingH : "unknown") +
            ")",
        );
      }
    }

    // Check 2: width must match a standard device width
    if (rfDevice) {
      pass("rootFrame", "root-frame-device-width");
    } else {
      fail(
        "HIGH",
        "rootFrame",
        "root-frame-device-width",
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
      if (rfSizingV === "HUG") {
        pass("rootFrame", "root-frame-height-hug");
      } else {
        fail(
          "HIGH",
          "rootFrame",
          "root-frame-height-hug",
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

      if (rfMinHeightNum > 0) {
        pass("rootFrame", "root-frame-min-height");
        if (rfDevice && Math.abs(rfMinHeightNum - rfExpectedMinH) > DIM_TOL) {
          fail(
            "MEDIUM",
            "rootFrame",
            "root-frame-min-height",
            "minHeight",
            "Root frame minHeight (" +
              rfMinHeightNum +
              "px) does not match expected " +
              rfDevice.name +
              " height (" +
              rfExpectedMinH +
              "px)",
            undefined,
            false,
          );
        }
      } else {
        let rfMinHMsg = "Root frame minHeight not set";
        if (rfDevice) {
          rfMinHMsg += " — expected " + rfExpectedMinH + "px for " + rfDevice.name;
        } else {
          rfMinHMsg += " — set to the device viewport height";
        }
        fail("HIGH", "rootFrame", "root-frame-min-height", "minHeight", rfMinHMsg);
      }
    }
  }

  // ── SCREEN NAMING checks (any frame starting with "Screen/") ──
  if (chk.screenNaming && isScreenRoot) {
    if (SCREEN_NAME_PATTERN.test(nodeName)) {
      pass("screenNaming", "screen-naming");
    } else {
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
      fail("HIGH", "screenNaming", "screen-naming", "name", snMsg);
    }
  }

  // ── TEXT STYLE checks ──
  if (localInsideScreen && chk.textStyles && nodeType === "TEXT") {
    if (hasTextStyle(node)) {
      pass("typography", "missing-text-style");
      try {
        if ((node as TextNode).textStyleId === figma.mixed) {
          fail(
            "LOW",
            "typography",
            "mixed-text-style",
            "textStyleId",
            "Text style override present (mixed styles in segments)",
            undefined,
            false,
          );
        }
      } catch (_e) {}
    } else {
      fail("HIGH", "typography", "missing-text-style", "textStyleId", "Text node without textStyleId applied");
    }

    // Check for direct font variable bindings (CRITICAL)
    if (hasFontVariableBindings(node)) {
      fail(
        "CRITICAL",
        "typography",
        "font-variable-binding",
        "fontVariables",
        "Font variable bound directly to text (should use text style instead)",
        undefined,
        false,
      );
    }
  }

  // ── FILL / COLOR checks ──
  let fillsInherited = instanceOverrides !== null && !isPaintOverridden(instanceOverrides, node.id, "fills");
  if (localInsideScreen && chk.colors && !fillsInherited) {
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
          fail(
            "MEDIUM",
            catName,
            "invisible-paint",
            "fills[" + fi + "]",
            "Fill with 0% opacity (invisible) — should be removed",
          );
          continue;
        }

        let fillType = fills[fi].type;
        let isGradient = fillType !== "SOLID" && typeof fillType === "string" && fillType.indexOf("GRADIENT_") === 0;
        let fillRule: LintRuleId = isGradient ? "gradient-without-style" : "hardcoded-color";
        let fillBound = isFillBound(node, "fills", fi) || hasFillPaintStyle(node);
        if (fillBound) {
          pass(catName, fillRule);
        } else if (isGradient && isGradientFullyBound(fills[fi])) {
          // Every stop is bound to a COLOR variable — genuinely token-driven.
          pass(catName, fillRule);
        } else if (isGradient) {
          // EXEMPT from the HIGH bind-to-variable rule: setBoundVariableForPaint accepts
          // SolidPaint only; count as compliant and surface a LOW nudge.
          pass(catName, fillRule);
          fail(
            "LOW",
            catName,
            fillRule,
            "fills[" + fi + "]",
            "Gradient fill — setBoundVariableForPaint cannot bind a gradient paint. Optional: re-author with set_gradient_fill and a per-stop colorVariable, or centralise it with create_color_style + set_color_style_id.",
            undefined,
            false,
          );
        } else {
          fail(
            "HIGH",
            catName,
            fillRule,
            "fills[" + fi + "]",
            "Color using raw hex value (no variable or paint style bound)",
          );
        }
      }
    }
  }

  // ── STROKE checks ──
  let strokesInherited = instanceOverrides !== null && !isPaintOverridden(instanceOverrides, node.id, "strokes");
  if (localInsideScreen && chk.colors && !strokesInherited) {
    let strokes: ReadonlyArray<Paint> | null = null;
    if ("strokes" in node) {
      strokes = (node as GeometryMixin).strokes as ReadonlyArray<Paint>;
    }
    if (strokes && strokes !== (figma.mixed as unknown) && Array.isArray(strokes) && strokes.length > 0) {
      for (let si = 0; si < strokes.length; si++) {
        if (!isColorFill(strokes[si])) continue;

        // Check for zero-opacity stroke (invisible — should be removed)
        if (strokes[si].opacity === 0) {
          fail(
            "MEDIUM",
            "strokesBorders",
            "invisible-paint",
            "strokes[" + si + "]",
            "Stroke with 0% opacity (invisible) — should be removed",
          );
          continue;
        }

        let strokeBound = isFillBound(node, "strokes", si) || hasStrokePaintStyle(node);
        let strokeType = strokes[si].type;
        let strokeIsGradient =
          strokeType !== "SOLID" && typeof strokeType === "string" && strokeType.indexOf("GRADIENT_") === 0;
        if (strokeBound) {
          pass("strokesBorders", "hardcoded-color");
        } else if (strokeIsGradient && isGradientFullyBound(strokes[si])) {
          pass("strokesBorders", "hardcoded-color");
        } else if (strokeIsGradient) {
          // EXEMPT — see the gradient note in the FILL checks above.
          pass("strokesBorders", "hardcoded-color");
          fail(
            "LOW",
            "strokesBorders",
            "hardcoded-color",
            "strokes[" + si + "]",
            "Gradient stroke — setBoundVariableForPaint cannot bind a gradient paint. Optional: re-author with set_gradient_fill and a per-stop colorVariable, or centralise it with create_color_style + set_color_style_id.",
            undefined,
            false,
          );
        } else {
          fail(
            "HIGH",
            "strokesBorders",
            "hardcoded-color",
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
        if (isScalarBound(node, spacingProp)) {
          pass("spacing", "unbound-spacing");
        } else {
          fail(
            "MEDIUM",
            "spacing",
            "unbound-spacing",
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
          if (isScalarBound(node, paddingProps[ppi])) {
            pass("spacing", "unbound-spacing");
          } else {
            fail(
              "MEDIUM",
              "spacing",
              "unbound-spacing",
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
      if (
        isScalarBound(node, "topLeftRadius") ||
        isScalarBound(node, "topRightRadius") ||
        isScalarBound(node, "bottomLeftRadius") ||
        isScalarBound(node, "bottomRightRadius") ||
        isScalarBound(node, "cornerRadius")
      ) {
        pass("borderRadius", "unbound-radius");
      } else {
        fail(
          "MEDIUM",
          "borderRadius",
          "unbound-radius",
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
          if (isScalarBound(node, radiusProps[ri])) {
            pass("borderRadius", "unbound-radius");
          } else {
            fail(
              "MEDIUM",
              "borderRadius",
              "unbound-radius",
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
            "unbound-radius",
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
          "unbound-radius",
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
        if (hasEffectStyle(node)) {
          pass("effectStyles", "missing-effect-style");
        } else {
          let effectTypes: string[] = [];
          for (let eti = 0; eti < effects.length; eti++) {
            if (effects[eti].visible !== false && effectTypes.indexOf(effects[eti].type) === -1) {
              effectTypes.push(effects[eti].type);
            }
          }
          fail(
            "CRITICAL",
            "effectStyles",
            "missing-effect-style",
            "effectStyleId",
            // Blur is satisfiable via a named effect style (createEffectStyle
            // accepts BlurEffect) even though setBoundVariableForEffect does
            // not cover blur radius — so point at the fix that works.
            "Raw " +
              effectTypes.join("/") +
              " effect (no effect style applied) — create one with create_effect_style and apply it via set_effect_style_id",
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
        fail(
          "MEDIUM",
          "autoLayout",
          "no-auto-layout",
          "layoutMode",
          "Frame has " + childCount + " children but no auto-layout set",
          undefined,
          false,
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
          fail(
            "LOW",
            "autoLayout",
            "absolute-in-auto-layout",
            "layoutPositioning",
            "Auto-layout frame has " +
              absChildCount +
              " absolute-positioned " +
              (absChildCount === 1 ? "child" : "children") +
              " — verify intentional",
            undefined,
            false,
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
          "no-auto-layout",
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
          "hardcoded-color",
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
            "no-auto-layout",
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
    // Image crops are intentional; a clipping (non-screen) parent hands the case to clipped-content.
    let clipOwnsOverflow = chk.clippedContent && inherited !== undefined && inherited.clipCoversOverflow;
    let skipOv =
      ovPositioning === "ABSOLUTE" || nodeName.indexOf("Icon/") === 0 || isImageLayer(node) || clipOwnsOverflow;
    if (!skipOv) {
      let childBBox: Rect | null = null;
      try {
        childBBox = (node as SceneNode & { absoluteBoundingBox?: Rect }).absoluteBoundingBox as Rect;
      } catch (_e) {}
      if (childBBox && parentBBox) {
        let OV_TOL = 1;
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
          if (hasHOv) {
            let hAmt = Math.ceil(hOverflow);
            let hDetails: ViolationDetails = {
              axis: "horizontal",
              overflowAmount: hAmt,
              childRight: Math.round(childBBox.x + childBBox.width),
              parentRight: Math.round(parentBBox.x + parentBBox.width),
            };
            fail(
              "CRITICAL",
              "overflow",
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
            fail(
              "CRITICAL",
              "overflow",
              "overflow",
              "absoluteBoundingBox",
              "Vertical overflow: child extends " + vAmt + "px beyond parent bottom edge",
              vDetails,
              !hasHOv,
            );
          }
        } else {
          pass("overflow", "overflow");
        }
      }
    }
  }

  // ── CLIPPED CONTENT check (rule: clipped-content) ──
  let clipIsScreenLevel = false;
  let nodeClips = localInsideScreen && chk.clippedContent && isClippingContainer(node);
  if (nodeClips) {
    let clipParentType = parent !== null && parent !== undefined ? (parent as BaseNode).type : null;
    clipIsScreenLevel =
      clipParentType === null || clipParentType === "PAGE" || clipParentType === "SECTION" || isScreenRoot;
    checkClippedContent(node, depth, clipIsScreenLevel, categories, violations, violationsCappedRef, scope, ignore);
  }

  // ── Recurse into children ──
  if ("children" in node && (node as ChildrenMixin).children) {
    let nodeBBox: Rect | null = null;
    if (chk.overflow) {
      try {
        nodeBBox = (node as SceneNode & { absoluteBoundingBox?: Rect }).absoluteBoundingBox as Rect;
      } catch (_e) {}
    }
    let childInherited: ScanInherited = {
      ignore: ignore,
      instanceOverrides: instanceOverrides,
      clipCoversOverflow: nodeClips && !clipIsScreenLevel,
    };
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
        scope,
        childInherited,
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
