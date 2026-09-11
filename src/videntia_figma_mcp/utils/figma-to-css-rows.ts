import {
  CompareRow,
  compareColor,
  compareNumeric,
  compareString,
  figmaLetterSpacingPx,
  figmaLineHeightPx,
  hex,
  isTransparent,
  lh,
  normalizeFontWeight,
  primaryFontFamily,
  px,
  within,
} from "./normalize-style.js";

export interface FigmaPaint {
  type?: string;
  color?: { r: number; g: number; b: number; a?: number };
  opacity?: number;
}

export interface FigmaEffect {
  type?: string;
  visible?: boolean;
  color?: { r: number; g: number; b: number; a?: number };
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
}

export interface FigmaNodeLike {
  id?: string;
  name?: string;
  type?: string;
  characters?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  lineHeight?: number;
  lineHeightUnit?: string;
  letterSpacing?: number;
  letterSpacingUnit?: string;
  textAlignHorizontal?: string;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  cornerRadius?: number;
  opacity?: number;
  effects?: FigmaEffect[];
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
  gridRowGap?: number;
  gridColumnGap?: number;
  layoutMode?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  layoutWrap?: string;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  bindings?: Record<string, { id?: string; name?: string }>;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  children?: FigmaNodeLike[];
}

export interface BrowserRect {
  width?: number;
  height?: number;
}

const DEFAULT_PROPERTIES = [
  "font-size",
  "line-height",
  "font-weight",
  "font-family",
  "letter-spacing",
  "text-align",
  "color",
  "background-color",
  "border-color",
  "border-width",
  "border-radius",
  "width",
  "height",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "gap",
  "opacity",
  "box-shadow",
];

const DEFAULT_TOLERANCES: Record<string, number> = {
  "font-size": 0,
  "line-height": 0.5,
  "letter-spacing": 0.1,
  "border-width": 0.5,
  "border-radius": 0.5,
  width: 1,
  height: 1,
  "padding-top": 1,
  "padding-right": 1,
  "padding-bottom": 1,
  "padding-left": 1,
  gap: 1,
  opacity: 0.01,
  "box-shadow": 1,
};

// DFS — find first TEXT descendant (used when target is a container).
export function findFirstTextNode(node: FigmaNodeLike): FigmaNodeLike | null {
  if (node.type === "TEXT") return node;
  if (!node.children?.length) return null;
  for (const child of node.children) {
    const found = findFirstTextNode(child);
    if (found) return found;
  }
  return null;
}

function firstVisibleSolidFill(fills: FigmaPaint[] | undefined): FigmaPaint | null {
  if (!fills?.length) return null;
  for (const f of fills) {
    if (f.type && f.type !== "SOLID") continue;
    if (!f.color) continue;
    return f;
  }
  return null;
}

function fillHex(fill: FigmaPaint | null): string | null {
  if (!fill?.color) return null;
  return hex(fill.color);
}

// Render "token-name (#hex)" when the property is bound to a Figma variable —
// makes mismatch reports actionable ("use gold-200") instead of raw hex only.
function withTokenName(node: FigmaNodeLike | null | undefined, bindingKey: string, row: CompareRow): CompareRow {
  const name = node?.bindings?.[bindingKey]?.name;
  if (name && row.figma !== "—") {
    row.figma = `${name} (${row.figma})`;
  }
  return row;
}

function dropShadow(effects: FigmaEffect[] | undefined): FigmaEffect | null {
  if (!effects?.length) return null;
  for (const e of effects) {
    if (e.visible === false) continue;
    if (e.type === "DROP_SHADOW") return e;
  }
  return null;
}

function formatBoxShadow(e: FigmaEffect): string {
  const ox = e.offset?.x ?? 0;
  const oy = e.offset?.y ?? 0;
  const r = e.radius ?? 0;
  const s = e.spread ?? 0;
  const c = e.color ? (hex(e.color) ?? "") : "";
  return `${ox}px ${oy}px ${r}px ${s}px ${c}`.trim();
}

// Parse a CSS box-shadow string into the same components for comparison.
// Best-effort: handles the common "Xpx Ypx Bpx [Spx] color" shape; ignores inset.
function parseBrowserBoxShadow(
  raw: string | undefined,
): { ox: number; oy: number; r: number; s: number; color: string | null } | null {
  if (!raw || raw === "none") return null;
  const first = raw.split(/,(?![^()]*\))/)[0]?.trim();
  if (!first) return null;
  const colorMatch = first.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/);
  const color = colorMatch ? hex(colorMatch[1]) : null;
  const rest = colorMatch ? first.replace(colorMatch[1], "") : first;
  const nums = rest.match(/-?\d*\.?\d+px/g) ?? [];
  const [ox = "0px", oy = "0px", r = "0px", s = "0px"] = nums;
  return {
    ox: px(ox) ?? 0,
    oy: px(oy) ?? 0,
    r: px(r) ?? 0,
    s: px(s) ?? 0,
    color,
  };
}

// Detect a border implemented as an inset box-shadow ring (Tailwind `inset-ring-*`,
// `ring-* ring-inset`): an inset shadow with zero offset/blur and a positive spread.
// getComputedStyle serializes as e.g. "rgb(226, 225, 223) 0px 0px 0px 1px inset".
export function parseInsetRing(raw: string | undefined): { spread: number; color: string | null } | null {
  if (!raw || raw === "none") return null;
  for (const segment of raw.split(/,(?![^()]*\))/)) {
    if (!/\binset\b/.test(segment)) continue;
    const colorMatch = segment.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/);
    const rest = colorMatch ? segment.replace(colorMatch[1], "") : segment;
    const nums = (rest.match(/-?\d*\.?\d+px/g) ?? []).map((n) => px(n) ?? 0);
    const [ox = 0, oy = 0, blur = 0, spread = 0] = nums;
    if (ox === 0 && oy === 0 && blur === 0 && spread > 0) {
      return { spread, color: colorMatch ? hex(colorMatch[1]) : null };
    }
  }
  return null;
}

export interface BuildRowsOptions {
  properties?: string[];
  toleranceOverrides?: Record<string, number>;
  // Emit auto-layout ↔ flexbox rows (layout-mode, justify-content, align-items, flex-wrap).
  layout?: boolean;
  // Computed layout styles of the element's parent (display, flex-direction,
  // justify-content, align-items, gap) — used for flex-centering equivalence.
  parentStyles?: Record<string, string>;
  // The element's class attribute — used to ground fix hints in real classes.
  className?: string;
}

export interface BuildRowsResult {
  rows: CompareRow[];
  warnings: string[];
  textNodeId?: string;
}

const PROP_ALIAS: Record<string, string> = {
  border: "border-width",
  padding: "padding-top",
};

// Figma auto-layout enums → CSS flexbox values.
const FIGMA_JUSTIFY: Record<string, string> = {
  MIN: "flex-start",
  CENTER: "center",
  MAX: "flex-end",
  SPACE_BETWEEN: "space-between",
};

const FIGMA_ALIGN: Record<string, string> = {
  MIN: "flex-start",
  CENTER: "center",
  MAX: "flex-end",
  BASELINE: "baseline",
};

// getComputedStyle keywords that resolve to the same rendered behavior.
function normalizeFlexValue(v: string | undefined, fallback: string): string {
  if (!v || v === "normal") return fallback;
  if (v === "start") return "flex-start";
  if (v === "end") return "flex-end";
  return v;
}

// Auto-layout ↔ flexbox rows. Only meaningful when the Figma node uses auto-layout;
// layoutMode NONE/undefined is skipped entirely to avoid noise on absolute frames.
function buildLayoutRows(figmaNode: FigmaNodeLike, computedStyles: Record<string, string>): CompareRow[] {
  const mode = figmaNode.layoutMode;
  if (mode !== "HORIZONTAL" && mode !== "VERTICAL" && mode !== "GRID") return [];

  // Without the computed display value (e.g. caller restricted `properties`),
  // layout comparison would be guesswork — skip rather than emit false errors.
  const display = computedStyles["display"];
  if (display === undefined) return [];

  const rows: CompareRow[] = [];
  const isFlex = display.includes("flex");
  const isGrid = display.includes("grid");

  if (mode === "GRID") {
    // Figma grid auto-layout — alignment maps to grid placement, not flex alignment,
    // so only the mode itself is compared here (gaps are handled by the gap rows).
    return [
      isGrid
        ? { property: "layout-mode", figma: "grid", browser: display, status: "✓" }
        : {
            property: "layout-mode",
            figma: "grid",
            browser: display,
            status: "❌",
            severity: isFlex ? "warn" : "error",
            ...(isFlex ? { note: "flex implementation of a grid (auto-layout) design" } : {}),
          },
    ];
  }
  const figmaDirection = mode === "HORIZONTAL" ? "row" : "column";
  const figmaLayout = `flex ${figmaDirection}`;

  if (isGrid) {
    // Grid can legitimately implement an auto-layout design; compare gap only.
    rows.push({
      property: "layout-mode",
      figma: figmaLayout,
      browser: display,
      status: "❌",
      severity: "warn",
      note: "grid implementation of a flex (auto-layout) design — gap compared, alignment skipped",
    });
    return rows;
  }

  const flexDirection = computedStyles["flex-direction"] || "row";
  if (!isFlex || flexDirection !== figmaDirection) {
    rows.push({
      property: "layout-mode",
      figma: figmaLayout,
      browser: isFlex ? `flex ${flexDirection}` : display || "—",
      status: "❌",
      severity: "error",
    });
  } else {
    rows.push({ property: "layout-mode", figma: figmaLayout, browser: `flex ${flexDirection}`, status: "✓" });
  }

  if (figmaNode.primaryAxisAlignItems !== undefined) {
    const figmaJ = FIGMA_JUSTIFY[figmaNode.primaryAxisAlignItems];
    const browserJ = normalizeFlexValue(computedStyles["justify-content"], "flex-start");
    if (figmaJ) {
      rows.push({
        property: "justify-content",
        figma: figmaJ,
        browser: browserJ,
        status: figmaJ === browserJ ? "✓" : "❌",
        severity: figmaJ === browserJ ? undefined : "error",
      });
    }
  }

  if (figmaNode.counterAxisAlignItems !== undefined) {
    const figmaA = FIGMA_ALIGN[figmaNode.counterAxisAlignItems];
    const browserARaw = computedStyles["align-items"];
    const browserA = normalizeFlexValue(browserARaw, "stretch");
    if (figmaA) {
      // CSS default (normal/stretch) with Figma MIN both render children from the
      // start edge when children are hug-sized — treat as match with a note.
      const defaultEquivalent = figmaA === "flex-start" && browserA === "stretch";
      const match = figmaA === browserA || defaultEquivalent;
      rows.push({
        property: "align-items",
        figma: figmaA,
        browser: browserA,
        status: match ? "✓" : "❌",
        severity: match ? undefined : "error",
        ...(defaultEquivalent ? { note: "CSS default stretch ≈ Figma MIN for hug-sized children" } : {}),
      });
    }
  }

  const figmaWraps = figmaNode.layoutWrap === "WRAP";
  const browserWrap = computedStyles["flex-wrap"] ?? "nowrap";
  const browserWraps = browserWrap === "wrap" || browserWrap === "wrap-reverse";
  if (figmaWraps !== browserWraps) {
    rows.push({
      property: "flex-wrap",
      figma: figmaWraps ? "wrap" : "nowrap",
      browser: browserWrap,
      status: "❌",
      severity: "error",
    });
  } else if (figmaWraps) {
    rows.push({ property: "flex-wrap", figma: "wrap", browser: browserWrap, status: "✓" });
  }

  return rows;
}

export function buildRows(
  figmaNode: FigmaNodeLike,
  computedStyles: Record<string, string>,
  rect: BrowserRect | undefined,
  options: BuildRowsOptions = {},
): BuildRowsResult {
  const warnings: string[] = [];
  const explicitProps = options.properties !== undefined;
  const props = (options.properties ?? DEFAULT_PROPERTIES).map((p) => PROP_ALIAS[p] ?? p);
  const tols = { ...DEFAULT_TOLERANCES, ...(options.toleranceOverrides ?? {}) };

  const textNode = findFirstTextNode(figmaNode);
  const containerHasNoText = !textNode;
  const isTextTarget = figmaNode.type === "TEXT" || !!textNode;

  const figmaFontSize = textNode?.fontSize ?? null;
  const browserFontSizePx = px(computedStyles["font-size"]);

  const rows: CompareRow[] = [];

  const tol = (prop: string) => tols[prop] ?? 0;

  for (const prop of props) {
    switch (prop) {
      case "font-size": {
        if (containerHasNoText && figmaNode.type !== "TEXT") {
          rows.push({ property: prop, figma: "—", browser: "—", status: "—" });
          break;
        }
        rows.push(compareNumeric(prop, figmaFontSize, browserFontSizePx, tol(prop)));
        break;
      }
      case "line-height": {
        const figmaLh = figmaLineHeightPx(textNode?.lineHeight, textNode?.lineHeightUnit, figmaFontSize);
        const browserLh = lh(computedStyles["line-height"], browserFontSizePx);
        if (figmaLh === null && browserLh === null) {
          rows.push({ property: prop, figma: "—", browser: "—", status: "—" });
        } else {
          rows.push(compareNumeric(prop, figmaLh, browserLh, tol(prop)));
        }
        break;
      }
      case "font-weight": {
        const figmaW = textNode?.fontWeight ?? null;
        const browserW = normalizeFontWeight(computedStyles["font-weight"]);
        rows.push(compareNumeric(prop, figmaW, browserW, 0, (n) => `${n}`));
        break;
      }
      case "font-family": {
        const figmaF = primaryFontFamily(textNode?.fontFamily);
        const browserF = primaryFontFamily(computedStyles["font-family"]);
        rows.push(compareString(prop, figmaF, browserF));
        break;
      }
      case "letter-spacing": {
        const figmaLs = figmaLetterSpacingPx(textNode?.letterSpacing, textNode?.letterSpacingUnit, figmaFontSize);
        const browserLsRaw = computedStyles["letter-spacing"];
        const browserLs = browserLsRaw === "normal" || browserLsRaw === undefined ? 0 : px(browserLsRaw);
        rows.push(compareNumeric(prop, figmaLs ?? 0, browserLs, tol(prop)));
        break;
      }
      case "text-align": {
        // CSS logical values: `start` is equivalent to `left` in LTR, `end` to `right`.
        const normalizeAlign = (v: string | null | undefined): string | null => {
          if (!v) return null;
          const s = v.toLowerCase();
          if (s === "start") return "left";
          if (s === "end") return "right";
          return s;
        };
        const figmaAlign = normalizeAlign(textNode?.textAlignHorizontal);
        const browserAlign = normalizeAlign(computedStyles["text-align"]);
        if (figmaAlign === null) {
          rows.push({ property: prop, figma: "—", browser: browserAlign ?? "—", status: "—" });
          break;
        }
        // Figma CENTER is visually equivalent to text-align:left when the element (or
        // its parent) horizontally centers content via flexbox.
        if (figmaAlign === "center" && browserAlign === "left") {
          const centersHorizontally = (s: Record<string, string> | undefined): boolean => {
            if (!s) return false;
            const display = s["display"] ?? "";
            if (!display.includes("flex")) return false;
            const direction = s["flex-direction"] ?? "row";
            const isRow = direction.startsWith("row");
            const value = normalizeFlexValue(
              isRow ? s["justify-content"] : s["align-items"],
              isRow ? "flex-start" : "stretch",
            );
            return value === "center";
          };
          if (centersHorizontally(computedStyles) || centersHorizontally(options.parentStyles)) {
            rows.push({
              property: prop,
              figma: figmaAlign,
              browser: browserAlign,
              status: "✓",
              note: "centered via flex, not text-align",
            });
            break;
          }
        }
        rows.push(compareString(prop, figmaAlign, browserAlign));
        break;
      }
      case "color": {
        if (figmaNode.type !== "TEXT" && !textNode) {
          rows.push({ property: prop, figma: "—", browser: "—", status: "—" });
          break;
        }
        const fill = firstVisibleSolidFill(textNode?.fills);
        const figmaColor = fillHex(fill);
        rows.push(withTokenName(textNode, "fills/0", compareColor(prop, figmaColor, computedStyles["color"])));
        break;
      }
      case "background-color": {
        if (figmaNode.type === "TEXT") {
          rows.push({ property: prop, figma: "—", browser: "—", status: "—" });
          break;
        }
        const fill = firstVisibleSolidFill(figmaNode.fills);
        const figmaBg = fillHex(fill);
        const browserBg = computedStyles["background-color"];
        if (figmaBg === null && (browserBg === undefined || isTransparent(browserBg))) {
          rows.push({ property: prop, figma: "—", browser: "transparent", status: "—" });
        } else {
          rows.push(withTokenName(figmaNode, "fills/0", compareColor(prop, figmaBg, browserBg)));
        }
        break;
      }
      case "border-color": {
        const fill = firstVisibleSolidFill(figmaNode.strokes);
        const figmaC = fillHex(fill);
        const browserC = hex(computedStyles["border-color"] ?? computedStyles["border-top-color"]);
        if (figmaC === null && browserC === null) {
          rows.push({ property: prop, figma: "—", browser: "—", status: "—" });
          break;
        }
        // Border realized as an inset box-shadow ring — compare against the ring color.
        const borderWidth = px(computedStyles["border-width"] ?? computedStyles["border-top-width"]);
        if (figmaC !== null && (borderWidth === null || borderWidth === 0)) {
          const ring = parseInsetRing(computedStyles["box-shadow"]);
          if (ring) {
            const ringRow = compareColor(prop, figmaC, ring.color);
            ringRow.note = ringRow.note
              ? `${ringRow.note}; border implemented as inset box-shadow ring`
              : "border implemented as inset box-shadow ring";
            rows.push(withTokenName(figmaNode, "strokes/0", ringRow));
            break;
          }
        }
        rows.push(withTokenName(figmaNode, "strokes/0", compareColor(prop, figmaC, browserC)));
        break;
      }
      case "border-width": {
        const figmaW = figmaNode.strokeWeight ?? null;
        const browserW = px(computedStyles["border-width"] ?? computedStyles["border-top-width"]);
        if (figmaW === null && (browserW === null || browserW === 0)) {
          rows.push({ property: prop, figma: "—", browser: browserW === null ? "—" : "0px", status: "—" });
          break;
        }
        // Border realized as an inset box-shadow ring — compare stroke weight to ring spread.
        if (figmaW !== null && figmaW > 0 && (browserW === null || browserW === 0)) {
          const ring = parseInsetRing(computedStyles["box-shadow"]);
          if (ring) {
            rows.push({
              property: prop,
              figma: `${figmaW}px`,
              browser: `${ring.spread}px (ring)`,
              status: within(figmaW, ring.spread, tol(prop)) ? "✓" : "❌",
              note: "border implemented as inset box-shadow ring",
            });
            break;
          }
        }
        rows.push(compareNumeric(prop, figmaW, browserW, tol(prop)));
        break;
      }
      case "border-radius": {
        const figmaR = figmaNode.cornerRadius ?? null;
        const browserR = px(computedStyles["border-radius"] ?? computedStyles["border-top-left-radius"]);
        rows.push(compareNumeric(prop, figmaR, browserR, tol(prop)));
        break;
      }
      case "width": {
        // Figma TEXT nodes store the container width; browsers shrink-to-fit by default,
        // producing noisy false negatives. Skip unless the caller explicitly listed width.
        if (figmaNode.type === "TEXT" && !explicitProps) {
          rows.push({ property: prop, figma: "—", browser: "—", status: "—", note: "skipped for TEXT node" });
          break;
        }
        const figmaW = figmaNode.absoluteBoundingBox?.width ?? null;
        const browserW = rect?.width ?? px(computedStyles.width);
        const widthRow = compareNumeric(prop, figmaW, browserW ?? null, tol(prop));
        // Hug-sized nodes derive width from content — a small delta is expected, not a bug.
        if (widthRow.status === "❌" && figmaNode.layoutSizingHorizontal === "HUG") {
          widthRow.severity = "warn";
          widthRow.note = "hug-content: browser width driven by content";
        }
        rows.push(widthRow);
        break;
      }
      case "height": {
        if (figmaNode.type === "TEXT" && !explicitProps) {
          rows.push({ property: prop, figma: "—", browser: "—", status: "—", note: "skipped for TEXT node" });
          break;
        }
        const figmaH = figmaNode.absoluteBoundingBox?.height ?? null;
        const browserH = rect?.height ?? px(computedStyles.height);
        const heightRow = compareNumeric(prop, figmaH, browserH ?? null, tol(prop));
        if (heightRow.status === "❌" && figmaNode.layoutSizingVertical === "HUG") {
          heightRow.severity = "warn";
          heightRow.note = "hug-content: browser height driven by content";
        }
        rows.push(heightRow);
        break;
      }
      case "padding-top":
      case "padding-right":
      case "padding-bottom":
      case "padding-left": {
        const figmaKey = (
          {
            "padding-top": "paddingTop",
            "padding-right": "paddingRight",
            "padding-bottom": "paddingBottom",
            "padding-left": "paddingLeft",
          } as const
        )[prop as "padding-top" | "padding-right" | "padding-bottom" | "padding-left"];
        const figmaP = (figmaNode[figmaKey] ?? null) as number | null;
        const browserP = px(computedStyles[prop]);
        rows.push(compareNumeric(prop, figmaP, browserP, tol(prop)));
        break;
      }
      case "gap": {
        // GRID auto-layout ignores itemSpacing (it keeps whatever value the frame had
        // before it became a grid) — the live gaps are gridRowGap/gridColumnGap, which
        // map to CSS row-gap/column-gap independently.
        if (figmaNode.layoutMode === "GRID") {
          // `gap` shorthand is "<row> <column>", or a single value applying to both.
          const shorthand = (computedStyles["gap"] ?? "").trim().split(/\s+/).filter(Boolean);
          const axes = [
            {
              property: "row-gap",
              figma: figmaNode.gridRowGap ?? null,
              raw: computedStyles["row-gap"] ?? shorthand[0],
            },
            {
              property: "column-gap",
              figma: figmaNode.gridColumnGap ?? null,
              raw: computedStyles["column-gap"] ?? shorthand[1] ?? shorthand[0],
            },
          ];
          for (const axis of axes) {
            const browserG = axis.raw === "normal" || axis.raw === undefined ? null : px(axis.raw);
            if (axis.figma === null && browserG === null) continue;
            rows.push(compareNumeric(axis.property, axis.figma, browserG, tol("gap")));
          }
          break;
        }
        const figmaG = figmaNode.itemSpacing ?? null;
        const browserGRaw = computedStyles["gap"] ?? computedStyles["row-gap"];
        const browserG = browserGRaw === "normal" ? null : px(browserGRaw);
        rows.push(compareNumeric("gap", figmaG, browserG, tol(prop)));
        break;
      }
      case "opacity": {
        const figmaO = figmaNode.opacity ?? null;
        const browserO = computedStyles["opacity"] !== undefined ? parseFloat(computedStyles["opacity"]) : null;
        rows.push(
          compareNumeric(
            prop,
            figmaO,
            Number.isFinite(browserO as number) ? (browserO as number) : null,
            tol(prop),
            (n) => n.toFixed(2),
          ),
        );
        break;
      }
      case "box-shadow": {
        const figmaShadow = dropShadow(figmaNode.effects);
        const browserShadow = parseBrowserBoxShadow(computedStyles["box-shadow"]);
        if (!figmaShadow && !browserShadow) {
          rows.push({ property: prop, figma: "—", browser: "—", status: "—" });
          break;
        }
        if (!figmaShadow || !browserShadow) {
          rows.push({
            property: prop,
            figma: figmaShadow ? formatBoxShadow(figmaShadow) : "—",
            browser: browserShadow
              ? `${browserShadow.ox}px ${browserShadow.oy}px ${browserShadow.r}px ${browserShadow.s}px ${browserShadow.color ?? ""}`.trim()
              : "—",
            status: "—",
          });
          break;
        }
        const t = tol(prop);
        const offsetMatch =
          Math.abs((figmaShadow.offset?.x ?? 0) - browserShadow.ox) <= t &&
          Math.abs((figmaShadow.offset?.y ?? 0) - browserShadow.oy) <= t;
        const radiusMatch = Math.abs((figmaShadow.radius ?? 0) - browserShadow.r) <= t;
        const spreadMatch = Math.abs((figmaShadow.spread ?? 0) - browserShadow.s) <= t;
        const colorMatch = (() => {
          const f = figmaShadow.color ? hex(figmaShadow.color) : null;
          return compareColor(prop, f, browserShadow.color).status === "✓";
        })();
        rows.push({
          property: prop,
          figma: formatBoxShadow(figmaShadow),
          browser:
            `${browserShadow.ox}px ${browserShadow.oy}px ${browserShadow.r}px ${browserShadow.s}px ${browserShadow.color ?? ""}`.trim(),
          status: offsetMatch && radiusMatch && spreadMatch && colorMatch ? "✓" : "❌",
        });
        break;
      }
      default: {
        const browser = computedStyles[prop];
        rows.push({
          property: prop,
          figma: "—",
          browser: browser ?? "—",
          status: "—",
          note: "unsupported property",
        });
        break;
      }
    }
  }

  if (options.layout) {
    rows.push(...buildLayoutRows(figmaNode, computedStyles));
  }

  if (isTextTarget && textNode && textNode !== figmaNode) {
    warnings.push(
      `text-style properties derived from first TEXT descendant ${textNode.id ?? "?"} (${textNode.name ?? ""})`,
    );
  }

  return { rows, warnings, textNodeId: textNode?.id };
}
