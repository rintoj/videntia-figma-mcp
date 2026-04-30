import * as t from "@babel/types";
import type { FigmaNodeData } from "../types/index.js";
import { reverseTwBorderRadius } from "./tailwind-values.js";

const COMPONENT_TYPES = new Set(["COMPONENT", "COMPONENT_SET", "INSTANCE"]);

/**
 * Convert an array of Figma node data objects to JSX+Tailwind string.
 * Uses @babel/types for AST construction with a custom serializer for output.
 */
export function convertToJsx(nodes: FigmaNodeData[], indent = 0): string {
  return nodes
    .filter((n) => n.visible !== false)
    .map((n) => {
      const ast = nodeToAst(n);
      if (!ast) return "";
      return serializeJsxElement(ast, indent);
    })
    .join("\n");
}

/**
 * Normalize Figma variable names: replace `/` with `-`.
 */
function normalizeName(name: string): string {
  return name.replace(/\//g, "-");
}

/**
 * Convert a Figma name to PascalCase tag.
 * "Profile Avatar" → "ProfileAvatar", "icon/close" → "IconClose", "Button" → "Button"
 */
export function toPascalCase(name: string): string {
  return name
    .split(/[\s\/\-_]+/)
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/[^a-zA-Z0-9]/g, ""))
    .filter((s) => s.length > 0)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

/**
 * Convert a property name to camelCase.
 * "Show Icon" → "showIcon", "Size" → "size", "show-icon" → "showIcon"
 */
export function toCamelCase(name: string): string {
  const parts = name
    .split(/[\s\-_]+/)
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/[^a-zA-Z0-9]/g, ""))
    .filter((s) => s.length > 0);
  if (parts.length === 0) return name;
  return parts
    .map((s, i) => (i === 0 ? s.charAt(0).toLowerCase() + s.slice(1) : s.charAt(0).toUpperCase() + s.slice(1)))
    .join("");
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
function buildTailwindClasses(node: FigmaNodeData, parentLayoutMode?: string): string[] {
  const classes: string[] = [];
  const isText = node.type === "TEXT";
  // Normalize bindings: { id, name } → name string, or keep as-is if already a string
  const rawBindings = node.bindings || {};
  const bindings: Record<string, string> = {};
  for (const [key, val] of Object.entries(rawBindings)) {
    bindings[key] = typeof val === "object" && val !== null && "name" in val ? (val as any).name : String(val);
  }

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

    // Counter axis alignment (omit undefined = stretch, the CSS default)
    if (node.counterAxisAlignItems === "MIN") classes.push("items-start");
    else if (node.counterAxisAlignItems === "CENTER") classes.push("items-center");
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
  if (
    node.layoutMode &&
    node.layoutMode !== "NONE" &&
    node.layoutWrap === "WRAP" &&
    node.counterAxisSpacing !== undefined &&
    node.counterAxisSpacing > 0
  ) {
    const crossGapDir = node.layoutMode === "HORIZONTAL" ? "gap-y" : "gap-x";
    if (bindings["counterAxisSpacing"]) {
      classes.push(`${crossGapDir}-${normalizeName(bindings["counterAxisSpacing"])}`);
    } else {
      classes.push(`${crossGapDir}-[${node.counterAxisSpacing}px]`);
    }
  }

  // Child self-alignment (layoutAlign overrides parent's cross-axis alignment)
  if (node.layoutAlign === "MIN") classes.push("self-start");
  else if (node.layoutAlign === "CENTER") classes.push("self-center");
  else if (node.layoutAlign === "MAX") classes.push("self-end");
  // STRETCH and INHERIT are defaults — omit

  // Clip content
  if (node.clipsContent) classes.push("overflow-hidden");

  // Absolute positioning
  if (node.layoutPositioning === "ABSOLUTE") {
    classes.push("absolute");
    if (node.x !== undefined) classes.push(`left-[${node.x}px]`);
    if (node.y !== undefined) classes.push(`top-[${node.y}px]`);
  }

  // --- Sizing ---
  // Cross-axis FILL is the CSS flexbox default (align-items: stretch) — omit it.
  // Primary-axis FILL = flex-1. w-full/h-full only when explicitly needed.
  const isCrossAxisH = parentLayoutMode === "VERTICAL";   // horizontal is cross-axis of vertical parent
  const isCrossAxisV = parentLayoutMode === "HORIZONTAL"; // vertical is cross-axis of horizontal parent

  if (node.layoutSizingHorizontal === "FIXED" && node.width !== undefined) {
    classes.push(`w-[${node.width}px]`);
  } else if (node.layoutSizingHorizontal === "FILL") {
    if (isCrossAxisH) {
      // Cross-axis FILL in a vertical parent: w-full needed because parent may use items-start
      classes.push("w-full");
    } else {
      classes.push("flex-1");
    }
  }
  // HUG = omit (natural behavior)

  if (node.layoutSizingVertical === "FIXED" && node.height !== undefined) {
    classes.push(`h-[${node.height}px]`);
  } else if (node.layoutSizingVertical === "FILL") {
    if (isCrossAxisV) {
      // Cross-axis FILL in a horizontal parent: h-full needed because parent may use items-start
      classes.push("h-full");
    } else if (node.layoutSizingHorizontal === "FILL" && !isCrossAxisH) {
      // Both axes FILL: horizontal already emitted flex-1, use h-full for vertical
      classes.push("h-full");
    } else {
      classes.push("flex-1");
    }
  }

  // --- Padding ---
  const pt = node.paddingTop ?? 0;
  const pr = node.paddingRight ?? 0;
  const pb = node.paddingBottom ?? 0;
  const pl = node.paddingLeft ?? 0;
  // A side is "active" if it has a non-zero value OR a token binding (binding overrides zero raw value)
  const ptActive = pt > 0 || !!bindings["paddingTop"];
  const prActive = pr > 0 || !!bindings["paddingRight"];
  const pbActive = pb > 0 || !!bindings["paddingBottom"];
  const plActive = pl > 0 || !!bindings["paddingLeft"];
  const hasPadding = ptActive || prActive || pbActive || plActive;

  if (hasPadding) {
    if (pt === pr && pr === pb && pb === pl) {
      // Uniform: prefer paddingTop binding (or any available binding) as shorthand
      const uniBinding = bindings["paddingTop"] || bindings["paddingRight"] || bindings["paddingBottom"] || bindings["paddingLeft"];
      classes.push(uniBinding ? `p-${normalizeName(uniBinding)}` : `p-[${pt}px]`);
    } else if (pt === pb && pl === pr) {
      // Symmetric: px + py
      if (plActive) {
        classes.push(bindings["paddingLeft"] ? `px-${normalizeName(bindings["paddingLeft"])}` : `px-[${pl}px]`);
      }
      if (ptActive) {
        classes.push(bindings["paddingTop"] ? `py-${normalizeName(bindings["paddingTop"])}` : `py-[${pt}px]`);
      }
    } else {
      // Individual sides — emit a class for each active side
      if (ptActive) classes.push(bindings["paddingTop"] ? `pt-${normalizeName(bindings["paddingTop"])}` : `pt-[${pt}px]`);
      if (prActive) classes.push(bindings["paddingRight"] ? `pr-${normalizeName(bindings["paddingRight"])}` : `pr-[${pr}px]`);
      if (pbActive) classes.push(bindings["paddingBottom"] ? `pb-${normalizeName(bindings["paddingBottom"])}` : `pb-[${pb}px]`);
      if (plActive) classes.push(bindings["paddingLeft"] ? `pl-${normalizeName(bindings["paddingLeft"])}` : `pl-[${pl}px]`);
    }
  }

  // --- Colors (all fills) ---
  let hasImageClass = false;
  if (node.fills && node.fills.length > 0) {
    for (let i = 0; i < node.fills.length; i++) {
      const fill = node.fills[i];
      const fillBinding = bindings[`fills/${i}`];
      const fillOpacitySuffix =
        !fillBinding && fill.opacity !== undefined && fill.opacity < 1 ? `/${Math.round(fill.opacity * 100)}` : "";

      if (isText) {
        if (fillBinding) {
          classes.push(`text-${normalizeName(fillBinding)}`);
        } else if (fill.color) {
          classes.push(`text-[${fill.color}]${fillOpacitySuffix}`);
        }
      } else {
        if (fill.isImage) {
          if (!hasImageClass) {
            classes.push("bg-cover", "bg-center");
            hasImageClass = true;
          }
        } else if (fill.gradient) {
          // Linear gradient WITH direction → Tailwind classes
          if (fill.gradient.type === "GRADIENT_LINEAR" && fill.gradient.direction) {
            classes.push(`bg-gradient-to-${fill.gradient.direction}`);
            const stops = fill.gradient.stops;
            if (stops.length >= 1) classes.push(`from-[${stops[0].color}]`);
            if (stops.length === 3) classes.push(`via-[${stops[1].color}]`);
            if (stops.length >= 2) classes.push(`to-[${stops[stops.length - 1].color}]`);
          }
          // Other gradients (no direction, radial, angular, diamond) → handled by buildStyleAttribute
        } else {
          const isVector = node.type === "VECTOR";
          if (fillBinding) {
            classes.push(`${isVector ? "fill" : "bg"}-${normalizeName(fillBinding)}`);
          } else if (fill.color) {
            classes.push(`${isVector ? "fill" : "bg"}-[${fill.color}]${fillOpacitySuffix}`);
          }
        }
      }
    }
  }

  // Strokes (all strokes)
  if (node.strokes && node.strokes.length > 0) {
    if (node.strokeWeight) {
      classes.push(`border-[${node.strokeWeight}px]`);
    }
    for (let i = 0; i < node.strokes.length; i++) {
      const stroke = node.strokes[i];
      const strokeBinding = bindings[`strokes/${i}`];
      if (strokeBinding) {
        classes.push(`border-${normalizeName(strokeBinding)}`);
      } else if (stroke.color) {
        classes.push(`border-[${stroke.color}]`);
      }
    }
  }

  // --- Typography ---
  if (isText) {
    if (node.textStyleName) {
      // Text style covers font size, weight, line height, letter spacing, font family
      classes.push(`text-${normalizeName(node.textStyleName)}`);
    } else {
      // Individual typography properties — prefer token bindings over raw values
      if (node.fontSize) {
        if (bindings["fontSize/0"]) {
          classes.push(`text-${normalizeName(bindings["fontSize/0"])}`);
        } else {
          classes.push(`text-[${node.fontSize}px]`);
        }
      }
      if (node.fontWeight !== undefined && node.fontWeight !== 400) {
        if (bindings["fontWeight/0"]) {
          classes.push(`font-${normalizeName(bindings["fontWeight/0"])}`);
        } else {
          classes.push(fontWeightClass(node.fontWeight));
        }
      }
      if (node.lineHeight !== undefined) {
        if (bindings["lineHeight/0"]) {
          classes.push(`leading-${normalizeName(bindings["lineHeight/0"])}`);
        } else if (node.lineHeightUnit === "percent") {
          classes.push(`leading-[${node.lineHeight}%]`);
        } else {
          classes.push(`leading-[${node.lineHeight}px]`);
        }
      }
      if (node.letterSpacing !== undefined && node.letterSpacing !== 0) {
        if (bindings["letterSpacing/0"]) {
          classes.push(`tracking-${normalizeName(bindings["letterSpacing/0"])}`);
        } else if (node.letterSpacingUnit === "percent") {
          classes.push(`tracking-[${node.letterSpacing / 100}em]`);
        } else {
          classes.push(`tracking-[${node.letterSpacing}px]`);
        }
      }
      if (node.fontFamily && node.fontFamily !== "Inter") {
        if (bindings["fontFamily/0"]) {
          classes.push(`font-${normalizeName(bindings["fontFamily/0"])}`);
        } else {
          classes.push(`font-['${node.fontFamily.replace(/ /g, "_")}']`);
        }
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
  if (node.type === "ELLIPSE") {
    classes.push("rounded-full");
  }
  const crBinding = bindings["cornerRadius"];
  if (node.type === "ELLIPSE") {
    classes.push("rounded-full");
  } else if (node.cornerRadius !== undefined && node.cornerRadius > 0) {
    if (crBinding) {
      classes.push(`rounded-${normalizeName(crBinding)}`);
    } else {
      const namedClass = reverseTwBorderRadius(node.cornerRadius);
      classes.push(namedClass ?? `rounded-[${node.cornerRadius}px]`);
    }
  } else if (
    node.topLeftRadius !== undefined ||
    node.topRightRadius !== undefined ||
    node.bottomRightRadius !== undefined ||
    node.bottomLeftRadius !== undefined
  ) {
    const tlBinding = bindings["topLeftRadius"];
    const trBinding = bindings["topRightRadius"];
    const brBinding = bindings["bottomRightRadius"];
    const blBinding = bindings["bottomLeftRadius"];
    // If all four corners have the same binding, collapse to a single rounded- class
    if (tlBinding && tlBinding === trBinding && trBinding === brBinding && brBinding === blBinding) {
      classes.push(`rounded-${normalizeName(tlBinding)}`);
    } else {
      if (node.topLeftRadius) classes.push(tlBinding ? `rounded-tl-${normalizeName(tlBinding)}` : `rounded-tl-[${node.topLeftRadius}px]`);
      if (node.topRightRadius) classes.push(trBinding ? `rounded-tr-${normalizeName(trBinding)}` : `rounded-tr-[${node.topRightRadius}px]`);
      if (node.bottomRightRadius) classes.push(brBinding ? `rounded-br-${normalizeName(brBinding)}` : `rounded-br-[${node.bottomRightRadius}px]`);
      if (node.bottomLeftRadius) classes.push(blBinding ? `rounded-bl-${normalizeName(blBinding)}` : `rounded-bl-[${node.bottomLeftRadius}px]`);
    }
  }

  // --- Effect style as class ---
  if (node.effectStyleName) {
    classes.push(`shadow-${normalizeName(node.effectStyleName)}`);
  }

  // --- Blur effects as classes ---
  if (node.effects && !node.effectStyleName) {
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
    const opacityVal = parseFloat(node.opacity.toPrecision(4));
    classes.push(`opacity-[${opacityVal}]`);
  }

  return classes;
}

/**
 * Build the style attribute object for properties not representable in Tailwind.
 */
function buildStyleAttribute(node: FigmaNodeData): Record<string, string> | null {
  const style: Record<string, string> = {};

  // Shadows → boxShadow (skip if effect style name is present)
  if (node.effects && !node.effectStyleName) {
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

  // Gradient fills → background (skip linear gradients with direction — already emitted as Tailwind)
  const gradientFill = node.fills?.find(
    (f) => f.gradient && !(f.gradient.type === "GRADIENT_LINEAR" && f.gradient.direction),
  );
  if (gradientFill?.gradient) {
    const g = gradientFill.gradient;
    const stops = g.stops.map((s) => `${s.color} ${Math.round(s.position * 100)}%`).join(", ");
    if (g.type === "GRADIENT_LINEAR") {
      style.background = `linear-gradient(${stops})`;
    } else if (g.type === "GRADIENT_RADIAL") {
      style.background = `radial-gradient(${stops})`;
    }
    // GRADIENT_ANGULAR and GRADIENT_DIAMOND have no CSS equivalent
  }

  // Image fills → backgroundImage
  const firstImageFill = node.fills?.find((f) => f.isImage);
  if (firstImageFill?.imageRef) {
    style.backgroundImage = `url(${firstImageFill.imageRef})`;
  }

  // SVG fill → fill CSS property (not bg-)
  if (node.type === "VECTOR" || node.type === "LINE") {
    const solidFill = node.fills?.find((f) => !f.isImage && !f.gradient && f.color);
    if (solidFill?.color) {
      style.fill = solidFill.color;
    }
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
 * Build a JSX style attribute AST node from a style object.
 */
function buildStyleAstAttr(style: Record<string, string>): t.JSXAttribute {
  const properties = Object.entries(style).map(([key, value]) =>
    t.objectProperty(t.identifier(key), t.stringLiteral(value)),
  );
  return t.jsxAttribute(t.jsxIdentifier("style"), t.jsxExpressionContainer(t.objectExpression(properties)));
}

/**
 * Check if a node is a component type (COMPONENT, COMPONENT_SET, or INSTANCE).
 */
function isComponentType(type: string): boolean {
  return COMPONENT_TYPES.has(type);
}

/**
 * Determine the JSX element tag for a Figma node type.
 */
function getTag(node: FigmaNodeData): string {
  if (node.type === "TEXT") return "span";
  if (node.type === "VECTOR" || node.type === "LINE") return "svg";

  // Component types get PascalCase tags
  if (node.type === "COMPONENT_SET") {
    return toPascalCase(node.name) + "Set";
  }
  if (node.type === "COMPONENT") {
    if (node.componentSetName) {
      return toPascalCase(node.componentSetName);
    }
    return toPascalCase(node.name);
  }
  if (node.type === "INSTANCE") {
    if (node.mainComponentName) {
      return toPascalCase(node.mainComponentName);
    }
    return toPascalCase(node.name);
  }

  return "div";
}

/**
 * Get the original name used to derive the tag (for componentName attribute).
 */
function getOriginalNameForTag(node: FigmaNodeData): string {
  if (node.type === "COMPONENT_SET") return node.name;
  if (node.type === "COMPONENT") {
    return node.componentSetName || node.name;
  }
  if (node.type === "INSTANCE") {
    return node.mainComponentName || node.name;
  }
  return node.name;
}

/**
 * Build a Babel ObjectExpression AST node from a JS object.
 */
function buildObjectExpr(obj: Record<string, unknown>): t.ObjectExpression {
  const properties = Object.entries(obj).map(([key, value]) => {
    let valueNode: t.Expression;
    if (typeof value === "string") valueNode = t.stringLiteral(value);
    else if (typeof value === "boolean") valueNode = t.booleanLiteral(value);
    else if (typeof value === "number") valueNode = t.numericLiteral(value);
    else valueNode = t.stringLiteral(JSON.stringify(value));
    return t.objectProperty(t.identifier(key), valueNode);
  });
  return t.objectExpression(properties);
}

/**
 * Build component-specific JSX attributes for COMPONENT_SET, COMPONENT, and INSTANCE nodes.
 */
function buildComponentAstAttrs(node: FigmaNodeData): t.JSXAttribute[] {
  const attrs: t.JSXAttribute[] = [];

  // componentName — emitted when the PascalCase tag differs from the original Figma name
  const originalName = getOriginalNameForTag(node);
  const tag = getTag(node);
  const expectedTag = node.type === "COMPONENT_SET" ? toPascalCase(originalName) + "Set" : toPascalCase(originalName);
  if (expectedTag === tag && toPascalCase(originalName) !== originalName) {
    attrs.push(t.jsxAttribute(t.jsxIdentifier("componentName"), t.stringLiteral(escapeJsx(originalName))));
  }

  // propertyDefinitions for COMPONENT_SET
  if (node.type === "COMPONENT_SET" && node.componentPropertyDefinitions) {
    const defs: Record<string, unknown> = {};
    const nameMap: Record<string, string> = {};
    for (const [key, def] of Object.entries(node.componentPropertyDefinitions) as Array<[string, any]>) {
      const camelKey = toCamelCase(key);
      if (def.type === "VARIANT" && def.options) {
        defs[camelKey] = (def.options as string[]).join(" | ");
      } else if (def.type === "BOOLEAN") {
        defs[camelKey] = def.default ?? true;
      } else if (def.type === "TEXT") {
        defs[camelKey] = def.default ?? "";
      } else if (def.type === "INSTANCE_SWAP") {
        defs[camelKey] = "InstanceSwap";
      }
      if (camelKey !== key) nameMap[camelKey] = key;
    }
    if (Object.keys(defs).length > 0) {
      attrs.push(
        t.jsxAttribute(t.jsxIdentifier("propertyDefinitions"), t.jsxExpressionContainer(buildObjectExpr(defs))),
      );
    }
    if (Object.keys(nameMap).length > 0) {
      attrs.push(
        t.jsxAttribute(t.jsxIdentifier("propertyNameMap"), t.jsxExpressionContainer(buildObjectExpr(nameMap))),
      );
    }
  }

  // Variant properties for COMPONENT in a set
  if (node.type === "COMPONENT" && node.variantProperties) {
    const nameMap: Record<string, string> = {};
    for (const [key, value] of Object.entries(node.variantProperties)) {
      const camelKey = toCamelCase(key);
      attrs.push(t.jsxAttribute(t.jsxIdentifier(camelKey), t.stringLiteral(escapeJsx(value))));
      if (camelKey !== key) nameMap[camelKey] = key;
    }
    if (Object.keys(nameMap).length > 0) {
      attrs.push(
        t.jsxAttribute(t.jsxIdentifier("propertyNameMap"), t.jsxExpressionContainer(buildObjectExpr(nameMap))),
      );
    }
  }

  // Instance component properties
  if (node.type === "INSTANCE" && node.componentProperties) {
    const nameMap: Record<string, string> = {};
    for (const [key, prop] of Object.entries(node.componentProperties) as Array<[string, any]>) {
      const camelKey = toCamelCase(key);
      if (prop.type === "BOOLEAN") {
        attrs.push(t.jsxAttribute(t.jsxIdentifier(camelKey), t.jsxExpressionContainer(t.booleanLiteral(prop.value))));
      } else if (prop.type === "TEXT") {
        attrs.push(t.jsxAttribute(t.jsxIdentifier(camelKey), t.stringLiteral(escapeJsx(String(prop.value)))));
      } else if (prop.type === "VARIANT") {
        attrs.push(t.jsxAttribute(t.jsxIdentifier(camelKey), t.stringLiteral(escapeJsx(String(prop.value)))));
      }
      // Skip INSTANCE_SWAP — not useful as text
      if (camelKey !== key && prop.type !== "INSTANCE_SWAP") {
        nameMap[camelKey] = key;
      }
    }
    if (Object.keys(nameMap).length > 0) {
      attrs.push(
        t.jsxAttribute(t.jsxIdentifier("propertyNameMap"), t.jsxExpressionContainer(buildObjectExpr(nameMap))),
      );
    }
  }

  return attrs;
}

/**
 * Build a Babel JSX AST node from a FigmaNodeData.
 */
function nodeToAst(node: FigmaNodeData, parentLayoutMode?: string): t.JSXElement | null {
  if (node.visible === false) return null;

  const tag = getTag(node);
  const classes = buildTailwindClasses(node, parentLayoutMode);
  const style = buildStyleAttribute(node);
  const isComponent = isComponentType(node.type);

  // Build AST attributes
  const attrs: t.JSXAttribute[] = [];
  attrs.push(t.jsxAttribute(t.jsxIdentifier("id"), t.stringLiteral(node.id)));

  if (!isComponent) {
    attrs.push(t.jsxAttribute(t.jsxIdentifier("name"), t.stringLiteral(escapeJsx(node.name))));
  }

  if (isComponent) {
    attrs.push(...buildComponentAstAttrs(node));
  }

  if (classes.length > 0) {
    attrs.push(t.jsxAttribute(t.jsxIdentifier("className"), t.stringLiteral(classes.join(" "))));
  }

  if (style) {
    attrs.push(buildStyleAstAttr(style));
  }

  // ID fields (only present when explicitly requested via fields)
  if (node.textStyleId) {
    attrs.push(t.jsxAttribute(t.jsxIdentifier("textStyleId"), t.stringLiteral(node.textStyleId)));
  }
  if (node.effectStyleId) {
    attrs.push(t.jsxAttribute(t.jsxIdentifier("effectStyleId"), t.stringLiteral(node.effectStyleId)));
  }
  if (node.mainComponentId) {
    attrs.push(t.jsxAttribute(t.jsxIdentifier("mainComponentId"), t.stringLiteral(node.mainComponentId)));
  }
  // Binding IDs (when bindingIds requested, bindings are { id, name } objects)
  if (node.bindings) {
    const bindingEntries = Object.entries(node.bindings);
    const hasIdBindings = bindingEntries.length > 0 && typeof bindingEntries[0][1] === "object";
    if (hasIdBindings) {
      const idMap: Record<string, string> = {};
      for (const [key, val] of bindingEntries) {
        if (typeof val === "object" && val !== null && "id" in val) {
          idMap[key] = (val as any).id;
        }
      }
      if (Object.keys(idMap).length > 0) {
        attrs.push(t.jsxAttribute(t.jsxIdentifier("bindingIds"), t.stringLiteral(JSON.stringify(idMap))));
      }
    }
  }

  // SVG: add width/height
  if (tag === "svg") {
    const w = node.width ?? 0;
    const h = node.height ?? 0;
    attrs.push(t.jsxAttribute(t.jsxIdentifier("width"), t.stringLiteral(String(w))));
    attrs.push(t.jsxAttribute(t.jsxIdentifier("height"), t.stringLiteral(String(h))));
  }

  // Check for truncated children (depth limit reached)
  const hasVisibleChildren = node.children && node.children.filter((c) => c.visible !== false).length > 0;
  const isTruncated = !hasVisibleChildren && node._childCount !== undefined && node._childCount > 0;

  const isSelfClosing =
    tag === "svg" ||
    (node.type !== "TEXT" && !hasVisibleChildren && !isTruncated);

  const opening = t.jsxOpeningElement(t.jsxIdentifier(tag), attrs, isSelfClosing);
  const closing = isSelfClosing ? null : t.jsxClosingElement(t.jsxIdentifier(tag));

  let children: t.JSXElement["children"] = [];

  if (!isSelfClosing) {
    if (node.type === "TEXT") {
      const text = node.characters ? escapeJsx(node.characters) : "";
      children = [t.jsxText(text)];
    } else if (isTruncated) {
      // Emit a truncation comment placeholder — handled by the serializer
      children = [t.jsxText(`__TRUNCATED__${node._childCount}`)];
    } else if (node.children) {
      for (const child of node.children) {
        if (child.visible === false) continue;
        const childAst = nodeToAst(child, node.layoutMode);
        if (childAst) children.push(childAst);
      }
    }
  }

  return t.jsxElement(opening, closing, children, isSelfClosing);
}

// --- AST Serializers ---

/**
 * Serialize a JSXElement AST node to a JSX string with proper indentation.
 */
function serializeJsxElement(el: t.JSXElement, indent: number): string {
  const pad = "  ".repeat(indent);
  const tagName = (el.openingElement.name as t.JSXIdentifier).name;
  const attrStr = el.openingElement.attributes
    .filter((a): a is t.JSXAttribute => a.type === "JSXAttribute")
    .map((a) => serializeJsxAttribute(a))
    .join(" ");

  const attrPart = attrStr ? ` ${attrStr}` : "";

  if (el.openingElement.selfClosing) {
    return `${pad}<${tagName}${attrPart} />`;
  }

  // Text element (only JSXText children)
  const textChildren = el.children.filter((c): c is t.JSXText => c.type === "JSXText");
  if (textChildren.length > 0 && el.children.every((c) => c.type === "JSXText")) {
    const text = textChildren.map((c) => c.value).join("");
    // Handle truncation comment
    const truncMatch = text.match(/^__TRUNCATED__(\d+)$/);
    if (truncMatch) {
      const count = truncMatch[1];
      return `${pad}<${tagName}${attrPart}>\n${pad}  {/* ${count} children — use depth="all" or a higher depth to expand */}\n${pad}</${tagName}>`;
    }
    return `${pad}<${tagName}${attrPart}>\n${pad}  ${text}\n${pad}</${tagName}>`;
  }

  // Container with child elements
  const childrenJsx = el.children
    .filter((c): c is t.JSXElement => c.type === "JSXElement")
    .map((c) => serializeJsxElement(c, indent + 1))
    .filter((s) => s.length > 0)
    .join("\n");

  return `${pad}<${tagName}${attrPart}>\n${childrenJsx}\n${pad}</${tagName}>`;
}

/**
 * Serialize a JSXAttribute AST node to a JSX attribute string.
 */
function serializeJsxAttribute(attr: t.JSXAttribute): string {
  const name = (attr.name as t.JSXIdentifier).name;
  if (!attr.value) return name;

  if (attr.value.type === "StringLiteral") {
    return `${name}="${attr.value.value}"`;
  }

  if (attr.value.type === "JSXExpressionContainer") {
    const expr = attr.value.expression;
    if (expr.type === "BooleanLiteral") {
      return `${name}={${expr.value}}`;
    }
    if (expr.type === "NumericLiteral") {
      return `${name}={${expr.value}}`;
    }
    if (expr.type === "ObjectExpression") {
      return `${name}=${serializeObjectExpr(expr)}`;
    }
  }

  return name;
}

/**
 * Serialize an ObjectExpression AST node to a JSX inline object string.
 */
function serializeObjectExpr(obj: t.ObjectExpression): string {
  const entries = obj.properties
    .map((p) => {
      if (p.type !== "ObjectProperty") return "";
      const key = p.key.type === "Identifier" ? p.key.name : (p.key as t.StringLiteral).value;
      const val = p.value as t.Expression;
      if (val.type === "StringLiteral") return `${key}: "${val.value}"`;
      if (val.type === "BooleanLiteral") return `${key}: ${val.value}`;
      if (val.type === "NumericLiteral") return `${key}: ${val.value}`;
      if (val.type === "NullLiteral") return `${key}: null`;
      return `${key}: undefined`;
    })
    .filter(Boolean);
  return `{{ ${entries.join(", ")} }}`;
}
