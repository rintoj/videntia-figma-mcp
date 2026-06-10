import {
  CompareRow,
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

export interface BuildRowsOptions {
  properties?: string[];
  toleranceOverrides?: Record<string, number>;
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
        } else {
          rows.push(compareString(prop, figmaAlign, browserAlign));
        }
        break;
      }
      case "color": {
        if (figmaNode.type !== "TEXT" && !textNode) {
          rows.push({ property: prop, figma: "—", browser: "—", status: "—" });
          break;
        }
        const fill = firstVisibleSolidFill(textNode?.fills);
        const figmaColor = fillHex(fill);
        const browserColor = hex(computedStyles["color"]);
        rows.push(compareString(prop, figmaColor, browserColor));
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
          rows.push(compareString(prop, figmaBg, hex(browserBg)));
        }
        break;
      }
      case "border-color": {
        const fill = firstVisibleSolidFill(figmaNode.strokes);
        const figmaC = fillHex(fill);
        const browserC = hex(computedStyles["border-color"] ?? computedStyles["border-top-color"]);
        if (figmaC === null && browserC === null) {
          rows.push({ property: prop, figma: "—", browser: "—", status: "—" });
        } else {
          rows.push(compareString(prop, figmaC, browserC));
        }
        break;
      }
      case "border-width": {
        const figmaW = figmaNode.strokeWeight ?? null;
        const browserW = px(computedStyles["border-width"] ?? computedStyles["border-top-width"]);
        if (figmaW === null && (browserW === null || browserW === 0)) {
          rows.push({ property: prop, figma: "—", browser: browserW === null ? "—" : "0px", status: "—" });
        } else {
          rows.push(compareNumeric(prop, figmaW, browserW, tol(prop)));
        }
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
        rows.push(compareNumeric(prop, figmaW, browserW ?? null, tol(prop)));
        break;
      }
      case "height": {
        if (figmaNode.type === "TEXT" && !explicitProps) {
          rows.push({ property: prop, figma: "—", browser: "—", status: "—", note: "skipped for TEXT node" });
          break;
        }
        const figmaH = figmaNode.absoluteBoundingBox?.height ?? null;
        const browserH = rect?.height ?? px(computedStyles.height);
        rows.push(compareNumeric(prop, figmaH, browserH ?? null, tol(prop)));
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
          return f === browserShadow.color;
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

  if (isTextTarget && textNode && textNode !== figmaNode) {
    warnings.push(
      `text-style properties derived from first TEXT descendant ${textNode.id ?? "?"} (${textNode.name ?? ""})`,
    );
  }

  return { rows, warnings, textNodeId: textNode?.id };
}
