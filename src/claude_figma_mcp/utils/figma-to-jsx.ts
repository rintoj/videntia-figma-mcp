import type { FigmaNodeData } from "../types/index.js";

/**
 * Convert an array of Figma node data objects to JSX+Tailwind string.
 */
export function convertToJsx(nodes: FigmaNodeData[], indent = 0): string {
  return nodes
    .filter((n) => n.visible !== false)
    .map((n) => nodeToJsx(n, indent))
    .join("\n");
}

/**
 * Normalize Figma variable names: replace `/` with `-`.
 */
function normalizeName(name: string): string {
  return name.replace(/\//g, "-");
}

/**
 * Map font weight number to Tailwind class name.
 */
function fontWeightClass(weight: number): string {
  const map: Record<number, string> = {
    100: "font-thin",
    200: "font-extralight",
    300: "font-light",
    400: "font-normal",
    500: "font-medium",
    600: "font-semibold",
    700: "font-bold",
    800: "font-extrabold",
    900: "font-black",
  };
  return map[weight] || `font-[${weight}]`;
}

/**
 * Build the Tailwind className string for a node.
 */
function buildTailwindClasses(node: FigmaNodeData): string[] {
  const classes: string[] = [];
  const isText = node.type === "TEXT";
  const bindings = node.bindings || {};

  // --- Layout ---
  if (node.layoutMode === "HORIZONTAL") {
    classes.push("flex", "flex-row");
  } else if (node.layoutMode === "VERTICAL") {
    classes.push("flex", "flex-col");
  } else if (!isText && node.children && node.children.length > 0) {
    classes.push("relative");
  }

  // Primary axis alignment (omit MIN = justify-start, the default)
  if (node.layoutMode && node.layoutMode !== "NONE") {
    if (node.primaryAxisAlignItems === "CENTER") classes.push("justify-center");
    else if (node.primaryAxisAlignItems === "MAX") classes.push("justify-end");
    else if (node.primaryAxisAlignItems === "SPACE_BETWEEN") classes.push("justify-between");

    // Counter axis alignment (omit MIN = items-start / items-stretch, the default)
    if (node.counterAxisAlignItems === "CENTER") classes.push("items-center");
    else if (node.counterAxisAlignItems === "MAX") classes.push("items-end");
    else if (node.counterAxisAlignItems === "BASELINE") classes.push("items-baseline");

    // Wrap
    if (node.layoutWrap === "WRAP") classes.push("flex-wrap");
  }

  // Item spacing (gap)
  if (node.layoutMode && node.layoutMode !== "NONE" && node.itemSpacing !== undefined && node.itemSpacing > 0) {
    if (bindings["itemSpacing"]) {
      classes.push(`gap-${normalizeName(bindings["itemSpacing"])}`);
    } else {
      classes.push(`gap-[${node.itemSpacing}px]`);
    }
  }

  // Cross-axis spacing (gap-x/gap-y in wrapped layouts)
  if (node.layoutMode && node.layoutMode !== "NONE" && node.layoutWrap === "WRAP" && node.counterAxisSpacing !== undefined && node.counterAxisSpacing > 0) {
    const crossGapDir = node.layoutMode === "HORIZONTAL" ? "gap-y" : "gap-x";
    if (bindings["counterAxisSpacing"]) {
      classes.push(`${crossGapDir}-${normalizeName(bindings["counterAxisSpacing"])}`);
    } else {
      classes.push(`${crossGapDir}-[${node.counterAxisSpacing}px]`);
    }
  }

  // Clip content
  if (node.clipsContent) classes.push("overflow-hidden");

  // Absolute positioning
  if (node.layoutPositioning === "ABSOLUTE") {
    classes.push("absolute");
    if (node.x !== undefined) classes.push(`left-[${node.x}px]`);
    if (node.y !== undefined) classes.push(`top-[${node.y}px]`);
  }

  // --- Sizing ---
  if (node.layoutSizingHorizontal === "FIXED" && node.width !== undefined) {
    classes.push(`w-[${node.width}px]`);
  } else if (node.layoutSizingHorizontal === "FILL") {
    classes.push("flex-1");
  }
  // HUG = omit (natural behavior)

  if (node.layoutSizingVertical === "FIXED" && node.height !== undefined) {
    classes.push(`h-[${node.height}px]`);
  } else if (node.layoutSizingVertical === "FILL") {
    // Use flex-1 only if not already added by horizontal fill
    if (node.layoutSizingHorizontal !== "FILL") {
      classes.push("flex-1");
    } else {
      classes.push("h-full");
    }
  }

  // --- Padding ---
  const pt = node.paddingTop ?? 0;
  const pr = node.paddingRight ?? 0;
  const pb = node.paddingBottom ?? 0;
  const pl = node.paddingLeft ?? 0;
  const hasPadding = pt > 0 || pr > 0 || pb > 0 || pl > 0;

  if (hasPadding) {
    if (pt === pr && pr === pb && pb === pl) {
      if (bindings["paddingTop"]) {
        classes.push(`p-${normalizeName(bindings["paddingTop"])}`);
      } else {
        classes.push(`p-[${pt}px]`);
      }
    } else if (pt === pb && pl === pr) {
      if (bindings["paddingLeft"]) {
        classes.push(`px-${normalizeName(bindings["paddingLeft"])}`);
      } else {
        classes.push(`px-[${pl}px]`);
      }
      if (bindings["paddingTop"]) {
        classes.push(`py-${normalizeName(bindings["paddingTop"])}`);
      } else {
        classes.push(`py-[${pt}px]`);
      }
    } else {
      if (pt > 0) classes.push(bindings["paddingTop"] ? `pt-${normalizeName(bindings["paddingTop"])}` : `pt-[${pt}px]`);
      if (pr > 0) classes.push(bindings["paddingRight"] ? `pr-${normalizeName(bindings["paddingRight"])}` : `pr-[${pr}px]`);
      if (pb > 0) classes.push(bindings["paddingBottom"] ? `pb-${normalizeName(bindings["paddingBottom"])}` : `pb-[${pb}px]`);
      if (pl > 0) classes.push(bindings["paddingLeft"] ? `pl-${normalizeName(bindings["paddingLeft"])}` : `pl-[${pl}px]`);
    }
  }

  // --- Colors ---
  const fillBinding = bindings["fills/0"];
  const firstFill = node.fills && node.fills.length > 0 ? node.fills[0] : undefined;

  if (firstFill) {
    const fillOpacitySuffix =
      !fillBinding && firstFill.opacity !== undefined && firstFill.opacity < 1
        ? `/${Math.round(firstFill.opacity * 100)}`
        : "";

    if (isText) {
      if (fillBinding) {
        classes.push(`text-${normalizeName(fillBinding)}`);
      } else if (firstFill.color) {
        classes.push(`text-[${firstFill.color}]${fillOpacitySuffix}`);
      }
    } else {
      if (firstFill.isImage) {
        classes.push("bg-cover", "bg-center");
      } else if (!firstFill.gradient) {
        if (fillBinding) {
          classes.push(`bg-${normalizeName(fillBinding)}`);
        } else if (firstFill.color) {
          classes.push(`bg-[${firstFill.color}]${fillOpacitySuffix}`);
        }
      }
    }
  }

  // Strokes
  const strokeBinding = bindings["strokes/0"];
  const firstStroke = node.strokes && node.strokes.length > 0 ? node.strokes[0] : undefined;

  if (firstStroke) {
    if (node.strokeWeight) {
      classes.push(`border-[${node.strokeWeight}px]`);
    }
    if (strokeBinding) {
      classes.push(`border-${normalizeName(strokeBinding)}`);
    } else if (firstStroke.color) {
      classes.push(`border-[${firstStroke.color}]`);
    }
  }

  // --- Typography ---
  if (isText) {
    if (node.textStyleName) {
      // Text style covers font size, weight, line height, letter spacing, font family
      classes.push(`text-${normalizeName(node.textStyleName)}`);
    } else {
      // Individual typography properties
      if (node.fontSize) classes.push(`text-[${node.fontSize}px]`);
      if (node.fontWeight !== undefined && node.fontWeight !== 400) {
        classes.push(fontWeightClass(node.fontWeight));
      }
      if (node.lineHeight !== undefined) {
        if (node.lineHeightUnit === "percent") {
          classes.push(`leading-[${node.lineHeight}%]`);
        } else {
          classes.push(`leading-[${node.lineHeight}px]`);
        }
      }
      if (node.letterSpacing !== undefined && node.letterSpacing !== 0) {
        if (node.letterSpacingUnit === "percent") {
          classes.push(`tracking-[${node.letterSpacing / 100}em]`);
        } else {
          classes.push(`tracking-[${node.letterSpacing}px]`);
        }
      }
      if (node.fontFamily && node.fontFamily !== "Inter") {
        classes.push(`font-['${node.fontFamily.replace(/ /g, "_")}']`);
      }
    }

    // Text alignment (not covered by text style)
    if (node.textAlignHorizontal === "CENTER") classes.push("text-center");
    else if (node.textAlignHorizontal === "RIGHT") classes.push("text-right");
    else if (node.textAlignHorizontal === "JUSTIFIED") classes.push("text-justify");

    // Text case
    if (node.textCase === "UPPER") classes.push("uppercase");
    else if (node.textCase === "LOWER") classes.push("lowercase");
    else if (node.textCase === "TITLE") classes.push("capitalize");

    // Text decoration
    if (node.textDecoration === "UNDERLINE") classes.push("underline");
    else if (node.textDecoration === "STRIKETHROUGH") classes.push("line-through");
  }

  // --- Corners ---
  const crBinding = bindings["cornerRadius"];
  if (node.cornerRadius !== undefined && node.cornerRadius > 0) {
    if (crBinding) {
      classes.push(`rounded-${normalizeName(crBinding)}`);
    } else {
      classes.push(`rounded-[${node.cornerRadius}px]`);
    }
  } else if (
    node.topLeftRadius !== undefined ||
    node.topRightRadius !== undefined ||
    node.bottomRightRadius !== undefined ||
    node.bottomLeftRadius !== undefined
  ) {
    if (node.topLeftRadius) classes.push(`rounded-tl-[${node.topLeftRadius}px]`);
    if (node.topRightRadius) classes.push(`rounded-tr-[${node.topRightRadius}px]`);
    if (node.bottomRightRadius) classes.push(`rounded-br-[${node.bottomRightRadius}px]`);
    if (node.bottomLeftRadius) classes.push(`rounded-bl-[${node.bottomLeftRadius}px]`);
  }

  // --- Blur effects as classes ---
  if (node.effects) {
    for (const effect of node.effects) {
      if (effect.type === "LAYER_BLUR" && effect.radius !== undefined) {
        classes.push(`blur-[${effect.radius}px]`);
      } else if (effect.type === "BACKGROUND_BLUR" && effect.radius !== undefined) {
        classes.push(`backdrop-blur-[${effect.radius}px]`);
      }
    }
  }

  // --- Opacity ---
  if (node.opacity !== undefined && node.opacity !== 1) {
    classes.push(`opacity-[${node.opacity}]`);
  }

  return classes;
}

/**
 * Build the style attribute object for properties not representable in Tailwind.
 */
function buildStyleAttribute(node: FigmaNodeData): Record<string, string> | null {
  const style: Record<string, string> = {};

  // Shadows → boxShadow
  if (node.effects) {
    const shadows: string[] = [];
    for (const effect of node.effects) {
      if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
        const inset = effect.type === "INNER_SHADOW" ? "inset " : "";
        const x = effect.offset?.x ?? 0;
        const y = effect.offset?.y ?? 0;
        const r = effect.radius ?? 0;
        const s = effect.spread ?? 0;
        const color = effect.color || "rgba(0,0,0,0.25)";
        // Convert hex color to rgba if needed
        const rgba = hexToRgba(color);
        shadows.push(`${inset}${x}px ${y}px ${r}px ${s}px ${rgba}`);
      }
    }
    if (shadows.length > 0) {
      style.boxShadow = shadows.join(", ");
    }
  }

  // Gradient fills → background
  const firstFill = node.fills && node.fills.length > 0 ? node.fills[0] : undefined;
  if (firstFill?.gradient) {
    const g = firstFill.gradient;
    const stops = g.stops.map((s) => `${s.color} ${Math.round(s.position * 100)}%`).join(", ");
    if (g.type === "GRADIENT_LINEAR") {
      style.background = `linear-gradient(${stops})`;
    } else if (g.type === "GRADIENT_RADIAL") {
      style.background = `radial-gradient(${stops})`;
    }
    // GRADIENT_ANGULAR and GRADIENT_DIAMOND have no CSS equivalent
  }

  // Image fills → backgroundImage
  if (firstFill?.isImage && firstFill.imageRef) {
    style.backgroundImage = `url(${firstFill.imageRef})`;
  }

  // Rotation
  if (node.rotation !== undefined && node.rotation !== 0) {
    style.transform = `rotate(${node.rotation}deg)`;
  }

  return Object.keys(style).length > 0 ? style : null;
}

/**
 * Convert hex color to rgba string.
 */
function hexToRgba(hex: string): string {
  if (hex.startsWith("rgba") || hex.startsWith("rgb")) return hex;
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},1)`;
}

/**
 * Escape special characters in JSX text content.
 */
function escapeJsx(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Format a style object as a JSX style attribute string.
 */
function formatStyleAttr(style: Record<string, string>): string {
  const entries = Object.entries(style)
    .map(([k, v]) => `${k}: "${v}"`)
    .join(", ");
  return `style={{ ${entries} }}`;
}

/**
 * Determine the JSX element tag for a Figma node type.
 */
function getTag(node: FigmaNodeData): string {
  if (node.type === "TEXT") return "span";
  if (node.type === "VECTOR" || node.type === "LINE") return "svg";
  return "div";
}

/**
 * Convert a single node to JSX string.
 */
function nodeToJsx(node: FigmaNodeData, indent: number): string {
  if (node.visible === false) return "";

  const pad = "  ".repeat(indent);
  const tag = getTag(node);
  const classes = buildTailwindClasses(node);
  const style = buildStyleAttribute(node);

  // Build attribute parts
  const attrs: string[] = [];
  attrs.push(`id="${node.id}"`);
  attrs.push(`name="${escapeJsx(node.name)}"`);

  if (classes.length > 0) {
    attrs.push(`className="${classes.join(" ")}"`);
  }
  if (style) {
    attrs.push(formatStyleAttr(style));
  }

  const attrStr = attrs.join(" ");

  // SVG self-closing for vectors/lines
  if (tag === "svg") {
    const w = node.width ?? 0;
    const h = node.height ?? 0;
    return `${pad}<svg ${attrStr} width="${w}" height="${h}" />`;
  }

  // Text node
  if (node.type === "TEXT") {
    const text = node.characters ? escapeJsx(node.characters) : "";
    return `${pad}<${tag} ${attrStr}>\n${pad}  ${text}\n${pad}</${tag}>`;
  }

  // Container node
  if (node.children && node.children.length > 0) {
    const childrenJsx = node.children
      .filter((c) => c.visible !== false)
      .map((c) => nodeToJsx(c, indent + 1))
      .filter((s) => s.length > 0)
      .join("\n");
    return `${pad}<${tag} ${attrStr}>\n${childrenJsx}\n${pad}</${tag}>`;
  }

  // Empty container / leaf
  return `${pad}<${tag} ${attrStr} />`;
}
