import { parse } from "@babel/parser";
import type * as t from "@babel/types";
import type { FigmaNodeData, FigmaNodeFill, FigmaNodeEffect } from "../types/index.js";
import {
  resolveTwSpacing,
  resolveTwColor,
  resolveTwFontSize,
  resolveTwBorderRadius,
  resolveTwShadow,
  resolveTwOpacity,
  resolveTwLineHeight,
  resolveTwLetterSpacing,
  resolveTwBlur,
  resolveTwBorderWidth,
} from "./tailwind-values.js";

/**
 * Parse JSX+Tailwind markup (as produced by convertToJsx) back into FigmaNodeData[].
 * Uses @babel/parser for robust AST-based parsing.
 */
export function parseJsx(jsx: string): FigmaNodeData[] {
  const trimmed = jsx.trim();
  if (!trimmed) return [];

  // Strip HTML comments (<!-- ... -->) which are invalid JSX
  const cleaned = trimmed.replace(/<!--[\s\S]*?-->/g, "");

  // Wrap in a fragment to make it a valid JSX expression
  const wrapped = `(<>${cleaned}</>)`;
  let ast;
  try {
    ast = parse(wrapped, {
      plugins: ["jsx"],
      sourceType: "module",
    });
  } catch (e) {
    throw new Error(`JSX parse error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Extract the JSXFragment from the ExpressionStatement
  const stmt = ast.program.body[0];
  if (!stmt || stmt.type !== "ExpressionStatement") return [];
  const expr = stmt.expression;
  if (!expr || expr.type !== "JSXFragment") return [];

  const nodes: FigmaNodeData[] = [];
  for (const child of expr.children) {
    if (child.type === "JSXElement") {
      nodes.push(jsxElementToNode(child, undefined, wrapped));
    }
    // Skip JSXText (whitespace), JSXExpressionContainer (comments), etc.
  }

  // Post-process: fix flex-1 children based on parent's layoutMode
  fixFlexChildren(nodes);

  return nodes;
}

/**
 * Post-process pass: resolve flex-1 children based on parent's layoutMode.
 * flex-1 fills along the parent's primary axis:
 *   VERTICAL parent → layoutSizingVertical = "FILL"
 *   HORIZONTAL parent (or default) → layoutSizingHorizontal = "FILL"
 */
function fixFlexChildren(nodes: FigmaNodeData[], parentLayoutMode?: string): void {
  for (const node of nodes) {
    if ((node as any)._flex1) {
      delete (node as any)._flex1;
      if (parentLayoutMode === "VERTICAL") {
        node.layoutSizingVertical = "FILL";
      } else {
        node.layoutSizingHorizontal = "FILL";
      }
    }
    if (node.children) {
      fixFlexChildren(node.children, node.layoutMode);
    }
  }
}

/**
 * Convert a Babel JSXElement AST node into a FigmaNodeData.
 */
function jsxElementToNode(el: t.JSXElement, parentType?: string, source?: string): FigmaNodeData {
  const tag = getTagName(el.openingElement);
  const attrs = extractAttributes(el.openingElement);
  const nodeType = tagToNodeType(tag, attrs, parentType);

  // Derive name for component types (they omit name= in JSX)
  let name: string;
  if (nodeType === "COMPONENT_SET" || nodeType === "COMPONENT" || nodeType === "INSTANCE") {
    if (attrs.componentName) {
      name = decodeEntities(attrs.componentName);
    } else if (nodeType === "COMPONENT_SET") {
      // Strip "Set" suffix from tag
      name = tag.endsWith("Set") ? tag.slice(0, -3) : tag;
    } else {
      name = tag;
    }
  } else {
    // data-name takes priority over name — enables the Icon/* placeholder pattern:
    //   <div data-name="Icon/save" className="w-[24px] h-[24px] shrink-0" />
    name = decodeEntities(attrs["data-name"] || attrs.name || HTML_TAG_NAMES[tag] || "Node");
  }

  const node: FigmaNodeData = {
    id: attrs.id || "",
    name,
    type: nodeType,
    visible: true,
  };

  // SVG: extract raw markup and skip child processing entirely
  if (tag === "svg" && source && el.start != null && el.end != null) {
    // Strip non-SVG attributes (name, id, className) that are Figma JSX metadata
    node.svgString = source.substring(el.start, el.end).replace(/\s+(?:name|id|className)="[^"]*"/g, "");
    if (attrs.width !== undefined) node.width = Number(attrs.width);
    if (attrs.height !== undefined) node.height = Number(attrs.height);
    return node;
  }

  // Apply component-specific attributes
  if (nodeType === "COMPONENT_SET" || nodeType === "COMPONENT" || nodeType === "INSTANCE") {
    applyComponentAttributes(node, tag, attrs, parentType);
  }

  // Parse children
  if (nodeType === "TEXT") {
    // Collect text content from children
    const textParts: string[] = [];
    for (const child of el.children) {
      if (child.type === "JSXText") {
        textParts.push(child.value);
      } else if (child.type === "JSXExpressionContainer" && child.expression.type === "StringLiteral") {
        textParts.push(child.expression.value);
      }
    }
    node.characters = decodeEntities(textParts.join("").trim());
  } else {
    // Container: parse child elements (thread nodeType as parentType)
    const children: FigmaNodeData[] = [];
    const textParts: string[] = [];
    for (const child of el.children) {
      if (child.type === "JSXElement") {
        children.push(jsxElementToNode(child, nodeType, source));
      } else if (child.type === "JSXText") {
        const trimmed = child.value.trim();
        if (trimmed) textParts.push(trimmed);
      } else if (child.type === "JSXExpressionContainer" && child.expression.type === "StringLiteral") {
        textParts.push(child.expression.value);
      }
    }
    if (children.length > 0) {
      node.children = children;
    } else if (textParts.length > 0 && (HTML_FRAME_TAGS.has(tag) || HTML_TEXT_TAGS.has(tag))) {
      // FRAME-type HTML tag with text children but no element children:
      // create a child TEXT node with the collected text
      const textContent = decodeEntities(textParts.join(" "));
      const { textClasses, frameClasses } = extractTextClasses(attrs.className || "");
      const childTextNode: FigmaNodeData = {
        id: "",
        name: "Text",
        type: "TEXT",
        visible: true,
        characters: textContent,
      };
      applyClassName(childTextNode, textClasses);
      // Override className to only have frame-related classes
      attrs.className = frameClasses;
      node.children = [childTextNode];
    }
  }

  applyClassName(node, attrs.className || "");
  applyStyleAttribute(node, attrs.style || "");

  // Icon/* frames are pure layout placeholders — strip any border-derived strokes.
  // A designer may write `border border-border-default` on the placeholder div for
  // visual alignment during authoring, but the stroke must not bleed into Figma.
  if (node.name.startsWith("Icon/")) {
    node.strokes = undefined;
    node.strokeWeight = undefined;
    node.strokeTopWeight = undefined;
    node.strokeBottomWeight = undefined;
    node.strokeLeftWeight = undefined;
    node.strokeRightWeight = undefined;
    if (node.bindings) {
      for (const key of Object.keys(node.bindings)) {
        if (key.startsWith("strokes/")) delete node.bindings[key];
      }
    }
  }

  // Apply HTML tag defaults (only set values that weren't already set by classes)
  applyHtmlTagDefaults(node, tag);

  // Infer layoutMode when alignment/flex properties are set but layoutMode isn't
  if (
    !node.layoutMode &&
    (node.primaryAxisAlignItems || node.counterAxisAlignItems || node.itemSpacing !== undefined || node.layoutWrap)
  ) {
    node.layoutMode = "HORIZONTAL";
  }

  // Auto-layout frames default to HUG sizing (matching Figma UI behavior)
  if (node.layoutMode) {
    if (!node.layoutSizingHorizontal) node.layoutSizingHorizontal = "HUG";
    if (!node.layoutSizingVertical) node.layoutSizingVertical = "HUG";
  }

  // Propagate text-related style properties from FRAME to child TEXT nodes
  propagateTextStyles(node);

  return node;
}

/**
 * Extract the tag name from a JSXOpeningElement.
 */
function getTagName(opening: t.JSXOpeningElement): string {
  if (opening.name.type === "JSXIdentifier") {
    return opening.name.name;
  }
  return "div";
}

/**
 * Extract attributes from a JSXOpeningElement into a flat Record.
 * Handles string literals, JSX expression containers (objects for style, booleans, etc.).
 */
function extractAttributes(opening: t.JSXOpeningElement): Record<string, string> {
  const attrs: Record<string, string> = {};

  for (const attr of opening.attributes) {
    if (attr.type !== "JSXAttribute" || attr.name.type !== "JSXIdentifier") continue;
    const name = attr.name.name;

    if (!attr.value) {
      // Boolean attribute (no value)
      attrs[name] = "true";
      continue;
    }

    if (attr.value.type === "StringLiteral") {
      attrs[name] = attr.value.value;
    } else if (attr.value.type === "JSXExpressionContainer") {
      const expr = attr.value.expression;
      if (name === "style" && expr.type === "ObjectExpression") {
        // style={{ key: "value", ... }} → serialize to our internal format
        attrs[name] = serializeStyleObject(expr);
      } else if (expr.type === "BooleanLiteral") {
        attrs[name] = String(expr.value);
      } else if (expr.type === "NumericLiteral") {
        attrs[name] = String(expr.value);
      } else if (expr.type === "StringLiteral") {
        attrs[name] = expr.value;
      } else if (expr.type === "ObjectExpression") {
        attrs[name] = serializeObjectExpression(expr);
      }
    }
  }

  return attrs;
}

/**
 * Serialize a Babel ObjectExpression (from style={{ ... }}) into the key: "value" format
 * expected by applyStyleAttribute's parseStyleEntries.
 */
function serializeStyleObject(obj: t.ObjectExpression): string {
  const parts: string[] = [];
  for (const prop of obj.properties) {
    if (prop.type !== "ObjectProperty") continue;
    const key =
      prop.key.type === "Identifier" ? prop.key.name : prop.key.type === "StringLiteral" ? prop.key.value : "";
    if (!key) continue;

    if (prop.value.type === "StringLiteral") {
      parts.push(`${key}: "${prop.value.value}"`);
    } else if (prop.value.type === "NumericLiteral") {
      parts.push(`${key}: "${prop.value.value}"`);
    } else if (prop.value.type === "TemplateLiteral" && prop.value.quasis.length === 1) {
      parts.push(`${key}: "${prop.value.quasis[0].value.cooked || prop.value.quasis[0].value.raw}"`);
    }
  }
  return parts.join(", ");
}

/**
 * Serialize a generic ObjectExpression for non-style attributes.
 */
function serializeObjectExpression(obj: t.ObjectExpression): string {
  const parts: string[] = [];
  for (const prop of obj.properties) {
    if (prop.type !== "ObjectProperty") continue;
    const key =
      prop.key.type === "Identifier" ? prop.key.name : prop.key.type === "StringLiteral" ? prop.key.value : "";
    if (!key) continue;
    if (prop.value.type === "StringLiteral") {
      parts.push(`${key}: "${prop.value.value}"`);
    } else if (prop.value.type === "NumericLiteral") {
      parts.push(`${key}: ${prop.value.value}`);
    } else if (prop.value.type === "BooleanLiteral") {
      parts.push(`${key}: ${prop.value.value}`);
    }
  }
  return parts.join(", ");
}

// Standard JSX attributes that do NOT indicate component properties.
// Includes all known metadata attrs to avoid false-positive INSTANCE detection.
const STANDARD_ATTRS = new Set([
  "id",
  "name",
  "className",
  "style",
  "componentName",
  "propertyNameMap",
  "propertyDefinitions",
  "width",
  "height",
  "variantProperties",
  "componentProperties",
  "componentSetName",
  "mainComponentName",
]);

function isPascalCase(tag: string): boolean {
  return /^[A-Z]/.test(tag);
}

// HTML tags that map to TEXT nodes
const HTML_TEXT_TAGS = new Set([
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "label",
  "small",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
]);

// HTML tags that map to FRAME nodes (explicitly named for clarity)
const HTML_FRAME_TAGS = new Set([
  "button",
  "input",
  "select",
  "textarea",
  "img",
  "section",
  "article",
  "nav",
  "header",
  "footer",
  "main",
  "aside",
  "form",
  "ul",
  "ol",
  "li",
  "table",
  "tr",
  "td",
  "th",
]);

// HTML tag default names
const HTML_TAG_NAMES: Record<string, string> = {
  button: "Button",
  input: "Input",
  select: "Select",
  textarea: "Textarea",
  img: "Image",
  section: "Section",
  article: "Article",
  nav: "Nav",
  header: "Header",
  footer: "Footer",
  main: "Main",
  aside: "Aside",
  form: "Form",
  ul: "List",
  ol: "List",
  li: "ListItem",
  table: "Table",
  tr: "Row",
  td: "Cell",
  th: "HeaderCell",
  p: "Text",
  h1: "H1",
  h2: "H2",
  h3: "H3",
  h4: "H4",
  h5: "H5",
  h6: "H6",
  a: "Link",
  label: "Label",
  small: "Small",
  strong: "Strong",
  em: "Em",
  b: "Bold",
  i: "Italic",
  u: "Underline",
  s: "Strikethrough",
};

// HTML tag defaults applied after className processing
interface HtmlTagDefaults {
  layoutMode?: "HORIZONTAL" | "VERTICAL";
  primaryAxisAlignItems?: "CENTER" | "MIN" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "CENTER" | "MIN" | "MAX" | "BASELINE";
  layoutSizingHorizontal?: "HUG" | "FILL" | "FIXED";
  layoutSizingVertical?: "HUG" | "FILL" | "FIXED";
  width?: number;
  height?: number;
  cornerRadius?: number;
  strokeWeight?: number;
  strokeColor?: string;
  fontSize?: number;
  fontWeight?: number;
  imageFill?: boolean;
}

const HTML_TAG_DEFAULTS: Record<string, HtmlTagDefaults> = {
  button: {
    layoutMode: "HORIZONTAL",
    primaryAxisAlignItems: "CENTER",
    counterAxisAlignItems: "CENTER",
    layoutSizingHorizontal: "HUG",
    layoutSizingVertical: "HUG",
  },
  input: {
    width: 240,
    height: 40,
    cornerRadius: 6,
    strokeWeight: 1,
    strokeColor: "#D1D5DB",
  },
  select: {
    width: 240,
    height: 40,
    cornerRadius: 6,
    strokeWeight: 1,
    strokeColor: "#D1D5DB",
  },
  textarea: {
    width: 240,
    height: 120,
    cornerRadius: 6,
    strokeWeight: 1,
    strokeColor: "#D1D5DB",
  },
  img: { width: 100, height: 100, imageFill: true },
  h1: { fontSize: 36, fontWeight: 800 },
  h2: { fontSize: 30, fontWeight: 700 },
  h3: { fontSize: 24, fontWeight: 600 },
  h4: { fontSize: 20, fontWeight: 600 },
  h5: { fontSize: 18, fontWeight: 600 },
  h6: { fontSize: 16, fontWeight: 600 },
};

// Text-related class prefixes and exact matches for extraction
const TEXT_CLASS_PREFIXES = ["text-", "font-", "leading-", "tracking-"];
const TEXT_CLASS_EXACT = new Set(["uppercase", "lowercase", "capitalize", "underline", "line-through"]);

function extractTextClasses(className: string): { textClasses: string; frameClasses: string } {
  const classes = className.split(/\s+/).filter(Boolean);
  const text: string[] = [];
  const frame: string[] = [];
  for (const cls of classes) {
    if (TEXT_CLASS_EXACT.has(cls) || TEXT_CLASS_PREFIXES.some((p) => cls.startsWith(p))) {
      text.push(cls);
    } else {
      frame.push(cls);
    }
  }
  return { textClasses: text.join(" "), frameClasses: frame.join(" ") };
}

function tagToNodeType(tag: string, attrs?: Record<string, string>, parentType?: string): string {
  if (HTML_TEXT_TAGS.has(tag)) return "TEXT";
  if (tag === "svg") return "SVG";
  if (HTML_FRAME_TAGS.has(tag)) return "FRAME";

  // Primary signal: componentName attr is only emitted by figma-to-jsx for component types.
  // This avoids false positives from PascalCase tags that happen to match (e.g. <DataSet>).
  const hasComponentName = attrs?.componentName !== undefined;

  if (isPascalCase(tag)) {
    // COMPONENT_SET: has propertyDefinitions, or tag ends with "Set" AND has componentName
    if ((attrs && attrs.propertyDefinitions !== undefined) || (tag.endsWith("Set") && hasComponentName)) {
      return "COMPONENT_SET";
    }
    // Tag ends with "Set" but no componentName — only treat as COMPONENT_SET
    // if it also has no name attr (component types omit name=)
    if (tag.endsWith("Set") && attrs && !attrs.name) {
      return "COMPONENT_SET";
    }
    // COMPONENT: direct child of COMPONENT_SET
    if (parentType === "COMPONENT_SET") {
      return "COMPONENT";
    }
    // INSTANCE: has non-standard attrs (booleans/strings that look like component props)
    if (attrs) {
      const hasComponentProps = Object.keys(attrs).some((k) => !STANDARD_ATTRS.has(k));
      if (hasComponentProps) return "INSTANCE";
    }
    // Bare PascalCase tag with componentName or without name attr → standalone COMPONENT
    if (hasComponentName || (attrs && !attrs.name)) {
      return "COMPONENT";
    }
  }

  return "FRAME";
}

/**
 * Parse a serialized object string (format: `key: "value", key2: true`) into a Record.
 * Only matches string values — non-string values are silently skipped.
 * This is safe because figma-to-jsx.ts only emits string values in nameMap.
 */
function parseNameMap(str: string): Record<string, string> {
  const map: Record<string, string> = {};
  const regex = /(\w+):\s*"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = regex.exec(str)) !== null) {
    map[match[1]] = match[2];
  }
  return map;
}

/** A single component property definition. */
type ComponentPropertyDef =
  | { type: "VARIANT"; options: string[]; default: string }
  | { type: "BOOLEAN"; default: boolean }
  | { type: "TEXT"; default: string }
  | { type: "INSTANCE_SWAP" };

/**
 * Parse propertyDefinitions serialized string into componentPropertyDefinitions.
 * Values with " | " → VARIANT with options array
 * "InstanceSwap" literal → INSTANCE_SWAP
 * Boolean literal → BOOLEAN with default
 * Other strings → TEXT with default
 */
function parsePropertyDefinitions(str: string, nameMap: Record<string, string>): Record<string, ComponentPropertyDef> {
  const defs: Record<string, ComponentPropertyDef> = {};
  // Match key: "string value" or key: true/false
  const regex = /(\w+):\s*(?:"((?:[^"\\]|\\.)*)"|(\btrue\b|\bfalse\b))/g;
  let match;
  while ((match = regex.exec(str)) !== null) {
    const camelKey = match[1];
    const originalKey = nameMap[camelKey] || camelKey;
    const strValue = match[2];
    const boolValue = match[3];

    if (boolValue !== undefined) {
      // Boolean property
      defs[originalKey] = { type: "BOOLEAN", default: boolValue === "true" };
    } else if (strValue === "InstanceSwap") {
      defs[originalKey] = { type: "INSTANCE_SWAP" };
    } else if (strValue && strValue.includes(" | ")) {
      // VARIANT with options
      const options = strValue.split(" | ");
      defs[originalKey] = { type: "VARIANT", options, default: options[0] };
    } else {
      // TEXT property
      defs[originalKey] = { type: "TEXT", default: strValue || "" };
    }
  }
  return defs;
}

/**
 * Apply component-specific JSX attributes onto FigmaNodeData fields.
 */
function applyComponentAttributes(
  node: FigmaNodeData,
  tag: string,
  attrs: Record<string, string>,
  parentType?: string,
): void {
  const nameMap = attrs.propertyNameMap ? parseNameMap(attrs.propertyNameMap) : {};

  if (node.type === "COMPONENT_SET") {
    // Parse propertyDefinitions
    if (attrs.propertyDefinitions) {
      node.componentPropertyDefinitions = parsePropertyDefinitions(attrs.propertyDefinitions, nameMap);
    }
  } else if (node.type === "COMPONENT") {
    // Only set componentSetName when this component is a child of a COMPONENT_SET
    if (parentType === "COMPONENT_SET") {
      node.componentSetName = attrs.componentName || (tag.endsWith("Set") ? tag.slice(0, -3) : tag);
    }
    const variantProps: Record<string, string> = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (STANDARD_ATTRS.has(key)) continue;
      const originalKey = nameMap[key] || key;
      variantProps[originalKey] = value;
    }
    if (Object.keys(variantProps).length > 0) {
      node.variantProperties = variantProps;
      // Derive name from variant props: "Key=value, Key2=value2"
      node.name = Object.entries(variantProps)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
    }
  } else if (node.type === "INSTANCE") {
    // Instance — set mainComponentName and parse component properties
    node.mainComponentName = attrs.componentName || tag;
    const compProps: Record<string, { type: "BOOLEAN"; value: boolean } | { type: "VARIANT"; value: string }> = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (STANDARD_ATTRS.has(key)) continue;
      const originalKey = nameMap[key] || key;
      if (value === "true" || value === "false") {
        compProps[originalKey] = { type: "BOOLEAN", value: value === "true" };
      } else {
        compProps[originalKey] = { type: "VARIANT", value };
      }
    }
    if (Object.keys(compProps).length > 0) {
      node.componentProperties = compProps;
    }
  }
}

/**
 * Propagate text-related style properties (color, fontFamily) from a FRAME parent
 * to its child TEXT nodes. These are stored as _styleColor / _styleFontFamily
 * by applyStyleAttribute when applied to non-TEXT nodes.
 */
function propagateTextStyles(node: FigmaNodeData): void {
  const color = (node as any)._styleColor;
  const fontFamily = (node as any)._styleFontFamily;
  if (!color && !fontFamily) return;

  // Clean up temporary properties
  delete (node as any)._styleColor;
  delete (node as any)._styleFontFamily;

  if (!node.children) return;
  for (const child of node.children) {
    if (child.type === "TEXT") {
      if (color && (!child.fills || child.fills.length === 0)) {
        child.fills = [{ type: "SOLID", color }];
      }
      if (fontFamily && !child.fontFamily) {
        child.fontFamily = fontFamily;
      }
    }
  }
}

function applyHtmlTagDefaults(node: FigmaNodeData, tag: string): void {
  const defaults = HTML_TAG_DEFAULTS[tag];
  if (!defaults) return;

  if (defaults.layoutMode && !node.layoutMode) node.layoutMode = defaults.layoutMode;
  if (defaults.primaryAxisAlignItems && !node.primaryAxisAlignItems)
    node.primaryAxisAlignItems = defaults.primaryAxisAlignItems;
  if (defaults.counterAxisAlignItems && !node.counterAxisAlignItems)
    node.counterAxisAlignItems = defaults.counterAxisAlignItems;
  if (defaults.layoutSizingHorizontal && !node.layoutSizingHorizontal)
    node.layoutSizingHorizontal = defaults.layoutSizingHorizontal;
  if (defaults.layoutSizingVertical && !node.layoutSizingVertical)
    node.layoutSizingVertical = defaults.layoutSizingVertical;

  // Dimension defaults only when no explicit sizing set
  if (defaults.width !== undefined && node.width === undefined && !node.layoutSizingHorizontal?.match(/HUG|FILL/)) {
    node.width = defaults.width;
    if (!node.layoutSizingHorizontal) node.layoutSizingHorizontal = "FIXED";
  }
  if (defaults.height !== undefined && node.height === undefined && !node.layoutSizingVertical?.match(/HUG|FILL/)) {
    node.height = defaults.height;
    if (!node.layoutSizingVertical) node.layoutSizingVertical = "FIXED";
  }

  if (defaults.cornerRadius !== undefined && node.cornerRadius === undefined) node.cornerRadius = defaults.cornerRadius;

  if (defaults.strokeWeight !== undefined && node.strokeWeight === undefined) {
    node.strokeWeight = defaults.strokeWeight;
    if (defaults.strokeColor && (!node.strokes || node.strokes.length === 0)) {
      node.strokes = [{ type: "SOLID", color: defaults.strokeColor }];
    }
  }

  if (defaults.fontSize !== undefined && node.fontSize === undefined) node.fontSize = defaults.fontSize;
  if (defaults.fontWeight !== undefined && node.fontWeight === undefined) node.fontWeight = defaults.fontWeight;

  if (defaults.imageFill && (!node.fills || !node.fills.some((f) => f.isImage))) {
    node.fills = node.fills || [];
    node.fills.push({ type: "IMAGE", isImage: true });
  }
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function denormalizeVarName(name: string): string {
  return name.replace(/-/g, "/");
}

// --- Tailwind class name → FigmaNodeData mapping ---

// Font weight Tailwind class → number
const FONT_WEIGHT_MAP: Record<string, number> = {
  "font-thin": 100,
  "font-extralight": 200,
  "font-light": 300,
  "font-normal": 400,
  "font-medium": 500,
  "font-semibold": 600,
  "font-bold": 700,
  "font-extrabold": 800,
  "font-black": 900,
};

function applyClassName(node: FigmaNodeData, className: string): void {
  if (!className) return;
  const classes = className.split(/\s+/).filter(Boolean);
  const isText = node.type === "TEXT";
  const bindings: Record<string, string> = node.bindings || {};

  // Collect deferred text- classes for disambiguation
  const deferredTextClasses: string[] = [];
  let hasFontSize = false;
  let hasIndividualTypography = false;

  // Gradient accumulator (per-stop opacity from Tailwind /N suffix is not yet
  // supported — Figma gradient stops use RGBA colors, not separate opacity)
  let gradientDir: string | undefined;
  let gradientFrom: { color: string } | undefined;
  let gradientVia: { color: string } | undefined;
  let gradientTo: { color: string } | undefined;

  // First pass: detect typography indicators
  for (const cls of classes) {
    if (/^text-\[\d+(\.\d+)?px\]$/.test(cls)) hasFontSize = true;
    // Check standard Tailwind font sizes: text-sm, text-lg, text-2xl, etc.
    const textMatch = cls.match(/^text-(.+)$/);
    if (textMatch && !textMatch[1].startsWith("[") && resolveTwFontSize(textMatch[1])) {
      hasFontSize = true;
      hasIndividualTypography = true;
    }
    if (cls.startsWith("font-") || cls.startsWith("leading-") || cls.startsWith("tracking-")) {
      hasIndividualTypography = true;
    }
  }

  for (const cls of classes) {
    // --- Layout ---
    if (cls === "flex") {
      node.layoutMode = node.layoutMode || "HORIZONTAL";
      continue;
    }
    if (cls === "flex-row") {
      node.layoutMode = "HORIZONTAL";
      continue;
    }
    if (cls === "flex-col") {
      node.layoutMode = "VERTICAL";
      continue;
    }
    if (cls === "relative") {
      /* non-layout container, no special prop */ continue;
    }
    if (cls === "justify-center") {
      node.primaryAxisAlignItems = "CENTER";
      continue;
    }
    if (cls === "justify-end") {
      node.primaryAxisAlignItems = "MAX";
      continue;
    }
    if (cls === "justify-between") {
      node.primaryAxisAlignItems = "SPACE_BETWEEN";
      continue;
    }
    if (cls === "items-center") {
      node.counterAxisAlignItems = "CENTER";
      continue;
    }
    if (cls === "items-end") {
      node.counterAxisAlignItems = "MAX";
      continue;
    }
    if (cls === "items-baseline") {
      node.counterAxisAlignItems = "BASELINE";
      continue;
    }
    if (cls === "flex-wrap") {
      node.layoutWrap = "WRAP";
      continue;
    }
    if (cls === "overflow-hidden") {
      node.clipsContent = true;
      continue;
    }
    if (cls === "absolute") {
      node.layoutPositioning = "ABSOLUTE";
      continue;
    }

    // left-[Npx] / top-[Npx]
    let m: RegExpMatchArray | null;
    if ((m = cls.match(/^left-\[(-?\d+(?:\.\d+)?)px\]$/))) {
      node.x = Number(m[1]);
      continue;
    }
    if ((m = cls.match(/^top-\[(-?\d+(?:\.\d+)?)px\]$/))) {
      node.y = Number(m[1]);
      continue;
    }

    // --- Gap ---
    if ((m = cls.match(/^gap-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.itemSpacing = Number(m[1]);
      continue;
    }
    if ((m = cls.match(/^gap-y-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.counterAxisSpacing = Number(m[1]);
      continue;
    }
    if ((m = cls.match(/^gap-x-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.counterAxisSpacing = Number(m[1]);
      continue;
    }
    // gap-{value/var}
    if ((m = cls.match(/^gap-y-(.+)$/)) && !m[1].startsWith("[")) {
      const value = m[1];
      const resolved = resolveTwSpacing(value);
      node.counterAxisSpacing = resolved ?? 0;
      bindings["counterAxisSpacing"] = denormalizeVarName(value);
      continue;
    }
    if ((m = cls.match(/^gap-x-(.+)$/)) && !m[1].startsWith("[")) {
      const value = m[1];
      const resolved = resolveTwSpacing(value);
      node.counterAxisSpacing = resolved ?? 0;
      bindings["counterAxisSpacing"] = denormalizeVarName(value);
      continue;
    }
    if ((m = cls.match(/^gap-(.+)$/)) && !m[1].startsWith("[")) {
      const value = m[1];
      const resolved = resolveTwSpacing(value);
      node.itemSpacing = resolved ?? 0;
      bindings["itemSpacing"] = denormalizeVarName(value);
      continue;
    }

    // --- Sizing ---
    if ((m = cls.match(/^w-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.width = Number(m[1]);
      node.layoutSizingHorizontal = "FIXED";
      continue;
    }
    if ((m = cls.match(/^h-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.height = Number(m[1]);
      node.layoutSizingVertical = "FIXED";
      continue;
    }
    if (cls === "flex-1") {
      // Mark for post-processing — correct axis depends on parent's layoutMode
      (node as any)._flex1 = true;
      continue;
    }
    if (cls === "h-full") {
      node.layoutSizingVertical = "FILL";
      continue;
    }
    if (cls === "w-full") {
      node.layoutSizingHorizontal = "FILL";
      continue;
    }
    if (cls === "w-auto" || cls === "w-fit") {
      node.layoutSizingHorizontal = "HUG";
      continue;
    }
    if (cls === "h-auto" || cls === "h-fit") {
      node.layoutSizingVertical = "HUG";
      continue;
    }
    if (cls === "w-screen") {
      node.width = 1440;
      node.layoutSizingHorizontal = "FIXED";
      continue;
    }
    if (cls === "h-screen") {
      node.height = 900;
      node.layoutSizingVertical = "FIXED";
      continue;
    }
    // w-{value} (standard Tailwind spacing)
    if ((m = cls.match(/^w-(.+)$/)) && !m[1].startsWith("[")) {
      const value = m[1];
      const resolved = resolveTwSpacing(value);
      if (resolved !== undefined) {
        node.width = resolved;
        node.layoutSizingHorizontal = "FIXED";
        continue;
      }
    }
    // h-{value} (standard Tailwind spacing)
    if ((m = cls.match(/^h-(.+)$/)) && !m[1].startsWith("[") && m[1] !== "full") {
      const value = m[1];
      const resolved = resolveTwSpacing(value);
      if (resolved !== undefined) {
        node.height = resolved;
        node.layoutSizingVertical = "FIXED";
        continue;
      }
    }

    // --- Padding ---
    if ((m = cls.match(/^p-\[(\d+(?:\.\d+)?)px\]$/))) {
      const v = Number(m[1]);
      node.paddingTop = v;
      node.paddingRight = v;
      node.paddingBottom = v;
      node.paddingLeft = v;
      continue;
    }
    if ((m = cls.match(/^px-\[(\d+(?:\.\d+)?)px\]$/))) {
      const v = Number(m[1]);
      node.paddingRight = v;
      node.paddingLeft = v;
      continue;
    }
    if ((m = cls.match(/^py-\[(\d+(?:\.\d+)?)px\]$/))) {
      const v = Number(m[1]);
      node.paddingTop = v;
      node.paddingBottom = v;
      continue;
    }
    if ((m = cls.match(/^pt-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.paddingTop = Number(m[1]);
      continue;
    }
    if ((m = cls.match(/^pr-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.paddingRight = Number(m[1]);
      continue;
    }
    if ((m = cls.match(/^pb-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.paddingBottom = Number(m[1]);
      continue;
    }
    if ((m = cls.match(/^pl-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.paddingLeft = Number(m[1]);
      continue;
    }
    // p-{value/var}
    if ((m = cls.match(/^p-(.+)$/)) && !m[1].startsWith("[")) {
      const value = m[1];
      const resolved = resolveTwSpacing(value);
      const v = resolved ?? 0;
      node.paddingTop = v;
      node.paddingRight = v;
      node.paddingBottom = v;
      node.paddingLeft = v;
      const varName = denormalizeVarName(value);
      bindings["paddingTop"] = varName;
      bindings["paddingRight"] = varName;
      bindings["paddingBottom"] = varName;
      bindings["paddingLeft"] = varName;
      continue;
    }
    if ((m = cls.match(/^px-(.+)$/)) && !m[1].startsWith("[")) {
      const value = m[1];
      const resolved = resolveTwSpacing(value);
      const v = resolved ?? 0;
      node.paddingRight = v;
      node.paddingLeft = v;
      const varName = denormalizeVarName(value);
      bindings["paddingLeft"] = varName;
      bindings["paddingRight"] = varName;
      continue;
    }
    if ((m = cls.match(/^py-(.+)$/)) && !m[1].startsWith("[")) {
      const value = m[1];
      const resolved = resolveTwSpacing(value);
      const v = resolved ?? 0;
      node.paddingTop = v;
      node.paddingBottom = v;
      const varName = denormalizeVarName(value);
      bindings["paddingTop"] = varName;
      bindings["paddingBottom"] = varName;
      continue;
    }
    if ((m = cls.match(/^pt-(.+)$/)) && !m[1].startsWith("[")) {
      const value = m[1];
      const resolved = resolveTwSpacing(value);
      node.paddingTop = resolved ?? 0;
      bindings["paddingTop"] = denormalizeVarName(value);
      continue;
    }
    if ((m = cls.match(/^pr-(.+)$/)) && !m[1].startsWith("[")) {
      const value = m[1];
      const resolved = resolveTwSpacing(value);
      node.paddingRight = resolved ?? 0;
      bindings["paddingRight"] = denormalizeVarName(value);
      continue;
    }
    if ((m = cls.match(/^pb-(.+)$/)) && !m[1].startsWith("[")) {
      const value = m[1];
      const resolved = resolveTwSpacing(value);
      node.paddingBottom = resolved ?? 0;
      bindings["paddingBottom"] = denormalizeVarName(value);
      continue;
    }
    if ((m = cls.match(/^pl-(.+)$/)) && !m[1].startsWith("[")) {
      const value = m[1];
      const resolved = resolveTwSpacing(value);
      node.paddingLeft = resolved ?? 0;
      bindings["paddingLeft"] = denormalizeVarName(value);
      continue;
    }

    // --- Background colors ---
    if (cls === "bg-cover") continue; // Image fill indicator (handled with bg-center)
    if (cls === "bg-center") {
      // Image fill
      if (!node.fills || !node.fills.some((f) => f.isImage)) {
        node.fills = node.fills || [];
        node.fills.push({ type: "IMAGE", isImage: true });
      }
      continue;
    }
    if ((m = cls.match(/^bg-\[(#[0-9a-fA-F]{3,8})\](?:\/(\d+))?$/))) {
      const color = m[1];
      const opacity = m[2] ? Number(m[2]) / 100 : undefined;
      const fill: FigmaNodeFill = { type: "SOLID", color };
      if (opacity !== undefined) fill.opacity = opacity;
      node.fills = node.fills || [];
      node.fills.push(fill);
      continue;
    }
    // --- Tailwind gradient classes (must come BEFORE catch-all bg-*) ---
    if ((m = cls.match(/^bg-gradient-to-(r|l|t|b|tr|tl|br|bl)$/))) {
      gradientDir = m[1];
      continue;
    }
    if ((m = cls.match(/^from-\[(#[0-9a-fA-F]{3,8})\](?:\/(\d+))?$/))) {
      gradientFrom = { color: m[1] };
      continue;
    }
    if ((m = cls.match(/^via-\[(#[0-9a-fA-F]{3,8})\](?:\/(\d+))?$/))) {
      gradientVia = { color: m[1] };
      continue;
    }
    if ((m = cls.match(/^to-\[(#[0-9a-fA-F]{3,8})\](?:\/(\d+))?$/))) {
      gradientTo = { color: m[1] };
      continue;
    }
    // Gradient variable bindings: from-{var}, via-{var}, to-{var}
    // Note: variable bindings for gradient stops are not yet supported —
    // the varName is not wired into node.bindings. Stored as placeholder color only.
    if ((m = cls.match(/^from-(.+)$/)) && !m[1].startsWith("[")) {
      gradientFrom = { color: "#000000" };
      continue;
    }
    if ((m = cls.match(/^via-(.+)$/)) && !m[1].startsWith("[")) {
      gradientVia = { color: "#000000" };
      continue;
    }
    if ((m = cls.match(/^to-(.+)$/)) && !m[1].startsWith("[")) {
      gradientTo = { color: "#000000" };
      continue;
    }

    // bg-{color/var}
    if ((m = cls.match(/^bg-(.+)$/)) && !m[1].startsWith("[")) {
      const name = m[1];
      const resolvedColor = resolveTwColor(name);
      const varName = denormalizeVarName(name);
      node.fills = node.fills || [];
      const idx = node.fills.length;
      node.fills.push({ type: "SOLID", color: resolvedColor ?? "#000000" });
      bindings[`fills/${idx}`] = varName;
      continue;
    }

    // --- Text colors ---
    if (isText && (m = cls.match(/^text-\[(#[0-9a-fA-F]{3,8})\](?:\/(\d+))?$/))) {
      const color = m[1];
      const opacity = m[2] ? Number(m[2]) / 100 : undefined;
      const fill: FigmaNodeFill = { type: "SOLID", color };
      if (opacity !== undefined) fill.opacity = opacity;
      node.fills = node.fills || [];
      node.fills.push(fill);
      continue;
    }

    // --- Strokes ---
    // Bare `border` → default 1px width
    if (cls === "border") {
      node.strokeWeight = 1;
      continue;
    }
    if ((m = cls.match(/^border-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.strokeWeight = Number(m[1]);
      continue;
    }
    // Standard border widths: border-0, border-2, border-4, border-8
    if ((m = cls.match(/^border-(\d+)$/))) {
      const resolved = resolveTwBorderWidth(m[1]);
      if (resolved !== undefined) {
        node.strokeWeight = resolved;
        continue;
      }
    }
    // Per-side borders: border-t, border-b, border-l, border-r (with optional width)
    if (
      (m = cls.match(/^border-(t|b|l|r)$/)) ||
      (m = cls.match(/^border-(t|b|l|r)-(\d+)$/)) ||
      (m = cls.match(/^border-(t|b|l|r)-\[(\d+(?:\.\d+)?)px\]$/))
    ) {
      const side = m[1];
      const weight = m[2] ? Number(m[2]) : 1;
      const fieldMap: Record<string, keyof FigmaNodeData> = {
        t: "strokeTopWeight",
        b: "strokeBottomWeight",
        l: "strokeLeftWeight",
        r: "strokeRightWeight",
      };
      (node as any)[fieldMap[side]] = weight;
      continue;
    }
    // Per-side border color: border-t-{color}, border-b-{color}, etc.
    // Note: Figma doesn't support per-side stroke colors — the color is applied
    // uniformly to all strokes. The side prefix is consumed to avoid falling through
    // to unrelated matchers, but the color applies to the whole border.
    if ((m = cls.match(/^border-(t|b|l|r)-\[(#[0-9a-fA-F]{3,8})\]$/))) {
      node.strokes = node.strokes || [];
      node.strokes.push({ type: "SOLID", color: m[2] });
      continue;
    }
    if ((m = cls.match(/^border-(t|b|l|r)-([a-zA-Z][\w-]*)$/)) && !m[2].startsWith("[")) {
      const name = m[2];
      const resolvedColor = resolveTwColor(name);
      if (resolvedColor) {
        node.strokes = node.strokes || [];
        const idx = node.strokes.length;
        node.strokes.push({ type: "SOLID", color: resolvedColor });
        bindings[`strokes/${idx}`] = denormalizeVarName(name);
        continue;
      }
    }
    if ((m = cls.match(/^border-\[(#[0-9a-fA-F]{3,8})\]$/))) {
      node.strokes = node.strokes || [];
      node.strokes.push({ type: "SOLID", color: m[1] });
      continue;
    }
    if ((m = cls.match(/^border-(.+)$/)) && !m[1].startsWith("[")) {
      const name = m[1];
      const resolvedColor = resolveTwColor(name);
      const varName = denormalizeVarName(name);
      node.strokes = node.strokes || [];
      const idx = node.strokes.length;
      node.strokes.push({ type: "SOLID", color: resolvedColor ?? "#000000" });
      bindings[`strokes/${idx}`] = varName;
      continue;
    }

    // --- Typography (text nodes only) ---
    if (isText) {
      // Font size: text-[Npx]
      if ((m = cls.match(/^text-\[(\d+(?:\.\d+)?)px\]$/))) {
        node.fontSize = Number(m[1]);
        continue;
      }

      // Text alignment
      if (cls === "text-center") {
        node.textAlignHorizontal = "CENTER";
        continue;
      }
      if (cls === "text-right") {
        node.textAlignHorizontal = "RIGHT";
        continue;
      }
      if (cls === "text-justify") {
        node.textAlignHorizontal = "JUSTIFIED";
        continue;
      }
      if (cls === "text-left") continue; // default alignment, no-op

      // Font weight
      if (FONT_WEIGHT_MAP[cls] !== undefined) {
        node.fontWeight = FONT_WEIGHT_MAP[cls];
        continue;
      }
      // Custom font weight: font-[N]
      if ((m = cls.match(/^font-\[(\d+)\]$/))) {
        node.fontWeight = Number(m[1]);
        continue;
      }

      // Line height: arbitrary values
      if ((m = cls.match(/^leading-\[(\d+(?:\.\d+)?)px\]$/))) {
        node.lineHeight = Number(m[1]);
        continue;
      }
      if ((m = cls.match(/^leading-\[(\d+(?:\.\d+)?)%\]$/))) {
        node.lineHeight = Number(m[1]);
        node.lineHeightUnit = "percent";
        continue;
      }
      // Standard line heights: leading-tight, leading-6, etc.
      if ((m = cls.match(/^leading-(.+)$/)) && !m[1].startsWith("[")) {
        const resolved = resolveTwLineHeight(m[1]);
        if (resolved) {
          node.lineHeight = resolved.value;
          if (resolved.unit === "percent") node.lineHeightUnit = "percent";
          continue;
        }
      }

      // Letter spacing: arbitrary values
      if ((m = cls.match(/^tracking-\[(-?\d+(?:\.\d+)?)px\]$/))) {
        node.letterSpacing = Number(m[1]);
        continue;
      }
      if ((m = cls.match(/^tracking-\[(-?\d+(?:\.\d+)?)em\]$/))) {
        node.letterSpacing = Number(m[1]) * 100;
        node.letterSpacingUnit = "percent";
        continue;
      }
      // Standard letter spacings: tracking-tight, tracking-wide, etc.
      if ((m = cls.match(/^tracking-(.+)$/)) && !m[1].startsWith("[")) {
        const resolved = resolveTwLetterSpacing(m[1]);
        if (resolved) {
          if (resolved.unit === "em") {
            node.letterSpacing = resolved.value * 100;
            node.letterSpacingUnit = "percent";
          } else {
            node.letterSpacing = resolved.value;
          }
          continue;
        }
      }

      // Font family
      if ((m = cls.match(/^font-\['(.+?)'\]$/))) {
        node.fontFamily = m[1].replace(/_/g, " ");
        continue;
      }

      // Text case
      if (cls === "uppercase") {
        node.textCase = "UPPER";
        continue;
      }
      if (cls === "lowercase") {
        node.textCase = "LOWER";
        continue;
      }
      if (cls === "capitalize") {
        node.textCase = "TITLE";
        continue;
      }

      // Text decoration
      if (cls === "underline") {
        node.textDecoration = "UNDERLINE";
        continue;
      }
      if (cls === "line-through") {
        node.textDecoration = "STRIKETHROUGH";
        continue;
      }

      // text-{name}: font size, color, text style, or fill variable binding
      if ((m = cls.match(/^text-(.+)$/)) && !m[1].startsWith("[")) {
        const name = m[1];
        // Skip alignment keywords already handled
        if (name === "center" || name === "right" || name === "justify" || name === "left") continue;

        // 1. Check standard Tailwind font size (sm, base, lg, xl, 2xl, etc.)
        const fontSizeMatch = resolveTwFontSize(name);
        if (fontSizeMatch) {
          node.fontSize = fontSizeMatch.fontSize;
          node.lineHeight = fontSizeMatch.lineHeight;
          hasFontSize = true;
          hasIndividualTypography = true;
          continue;
        }

        // 2. Check standard Tailwind color (white, black, red-500, etc.)
        const colorMatch = resolveTwColor(name);
        if (colorMatch) {
          node.fills = node.fills || [];
          const idx = node.fills.length;
          node.fills.push({ type: "SOLID", color: colorMatch });
          bindings[`fills/${idx}`] = denormalizeVarName(name);
          continue;
        }

        // 3. Disambiguate using the design-system's known semantic color namespaces.
        //    Names whose first path segment is a known color namespace (e.g. text/primary,
        //    semantic/error) are fill variable bindings.
        //    Everything else (e.g. body/md, heading/h1, card/foreground) may be a text style
        //    name or a font-size-dependent color binding — defer for later resolution.
        const denormalized = denormalizeVarName(name);
        const slashIdx = denormalized.indexOf("/");
        const firstSegment = slashIdx >= 0 ? denormalized.substring(0, slashIdx) : "";
        const slashCount = (denormalized.match(/\//g) || []).length;
        const isSemanticColorVar =
          slashCount === 1 &&
          (firstSegment === "text" ||
            firstSegment === "semantic" ||
            firstSegment === "background" ||
            firstSegment === "brand" ||
            firstSegment === "border" ||
            firstSegment === "interactive" ||
            firstSegment === "feedback" ||
            firstSegment === "surface" ||
            firstSegment === "utility" ||
            firstSegment === "chart");
        if (isSemanticColorVar) {
          // Semantic color variable → always create fill binding immediately
          node.fills = node.fills || [];
          const idx = node.fills.length;
          node.fills.push({ type: "SOLID", color: "#000000" });
          bindings[`fills/${idx}`] = denormalized;
        } else {
          // Potential text style name or font-size-dependent fill color — defer
          deferredTextClasses.push(name);
        }
        continue;
      }
    }

    // --- Corners ---
    // Bare `rounded` → DEFAULT = 4px
    if (cls === "rounded") {
      node.cornerRadius = resolveTwBorderRadius("DEFAULT")!;
      bindings["cornerRadius"] = "DEFAULT";
      continue;
    }
    if ((m = cls.match(/^rounded-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.cornerRadius = Number(m[1]);
      continue;
    }
    if ((m = cls.match(/^rounded-tl-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.topLeftRadius = Number(m[1]);
      continue;
    }
    if ((m = cls.match(/^rounded-tr-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.topRightRadius = Number(m[1]);
      continue;
    }
    if ((m = cls.match(/^rounded-br-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.bottomRightRadius = Number(m[1]);
      continue;
    }
    if ((m = cls.match(/^rounded-bl-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.bottomLeftRadius = Number(m[1]);
      continue;
    }
    // rounded-{value/var}
    if (
      (m = cls.match(/^rounded-(.+)$/)) &&
      !m[1].startsWith("[") &&
      !["tl-", "tr-", "bl-", "br-"].some((p) => m![1].startsWith(p))
    ) {
      const value = m[1];
      const resolved = resolveTwBorderRadius(value);
      node.cornerRadius = resolved ?? 0;
      bindings["cornerRadius"] = denormalizeVarName(value);
      continue;
    }

    // --- Effects ---
    if ((m = cls.match(/^blur-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.effects = node.effects || [];
      node.effects.push({ type: "LAYER_BLUR", radius: Number(m[1]) });
      continue;
    }
    if ((m = cls.match(/^backdrop-blur-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.effects = node.effects || [];
      node.effects.push({ type: "BACKGROUND_BLUR", radius: Number(m[1]) });
      continue;
    }
    // Standard blur: blur, blur-sm, blur-md, etc.
    if (cls === "blur") {
      const resolved = resolveTwBlur("DEFAULT");
      if (resolved !== undefined) {
        node.effects = node.effects || [];
        node.effects.push({ type: "LAYER_BLUR", radius: resolved });
        continue;
      }
    }
    if ((m = cls.match(/^blur-(.+)$/)) && !m[1].startsWith("[")) {
      const resolved = resolveTwBlur(m[1]);
      if (resolved !== undefined) {
        node.effects = node.effects || [];
        node.effects.push({ type: "LAYER_BLUR", radius: resolved });
        continue;
      }
    }
    if (cls === "backdrop-blur") {
      const resolved = resolveTwBlur("DEFAULT");
      if (resolved !== undefined) {
        node.effects = node.effects || [];
        node.effects.push({ type: "BACKGROUND_BLUR", radius: resolved });
        continue;
      }
    }
    if ((m = cls.match(/^backdrop-blur-(.+)$/)) && !m[1].startsWith("[")) {
      const resolved = resolveTwBlur(m[1]);
      if (resolved !== undefined) {
        node.effects = node.effects || [];
        node.effects.push({ type: "BACKGROUND_BLUR", radius: resolved });
        continue;
      }
    }

    // --- Shadows ---
    if (cls === "shadow") {
      const resolved = resolveTwShadow("DEFAULT");
      if (resolved) {
        node.effects = node.effects || [];
        node.effects.push(...resolved);
        continue;
      }
    }
    if ((m = cls.match(/^shadow-(.+)$/)) && !m[1].startsWith("[")) {
      const resolved = resolveTwShadow(m[1]);
      if (resolved) {
        node.effects = node.effects || [];
        node.effects.push(...resolved);
        continue;
      }
      // Unresolved shadow class → treat as effect style name
      node.effectStyleName = denormalizeVarName(m[1]);
      continue;
    }

    // --- Opacity ---
    if ((m = cls.match(/^opacity-\[(\d+(?:\.\d+)?)\]$/))) {
      node.opacity = Number(m[1]);
      continue;
    }
    // Standard opacity: opacity-50, opacity-75, etc.
    if ((m = cls.match(/^opacity-(\d+)$/))) {
      const resolved = resolveTwOpacity(m[1]);
      if (resolved !== undefined) {
        node.opacity = resolved;
        continue;
      }
    }
  }

  // Assemble gradient fill from accumulated gradient classes
  // Require at least from + to (2 stops) for a valid gradient
  if (gradientDir || gradientFrom || gradientVia || gradientTo) {
    const stops: Array<{ color: string; position: number }> = [];
    if (gradientFrom) stops.push({ color: gradientFrom.color, position: 0 });
    if (gradientVia) stops.push({ color: gradientVia.color, position: 0.5 });
    if (gradientTo) stops.push({ color: gradientTo.color, position: 1 });
    if (stops.length >= 2) {
      const gradientFill: FigmaNodeFill = {
        type: "GRADIENT_LINEAR",
        gradient: {
          type: "GRADIENT_LINEAR",
          stops,
          ...(gradientDir ? { direction: gradientDir } : {}),
        },
      };
      node.fills = node.fills || [];
      node.fills.push(gradientFill);
    }
  }

  // Process deferred text- classes (3+ segment names deferred from the class loop)
  if (isText && deferredTextClasses.length > 0) {
    for (const name of deferredTextClasses) {
      if (node.fontSize || hasIndividualTypography) {
        // Explicit font size was set → this is a fill color variable binding
        node.fills = node.fills || [];
        const idx = node.fills.length;
        node.fills.push({ type: "SOLID", color: "#000000" });
        bindings[`fills/${idx}`] = denormalizeVarName(name);
      } else {
        // No explicit font size → treat as named text style (last one wins)
        node.textStyleName = denormalizeVarName(name);
      }
    }
  }

  // Set bindings if any were accumulated
  if (Object.keys(bindings).length > 0) {
    node.bindings = bindings;
  }
}

// --- Style attribute parsing ---

function applyStyleAttribute(node: FigmaNodeData, styleStr: string): void {
  if (!styleStr) return;

  // Parse key: "value" pairs from the style object string
  const entries = parseStyleEntries(styleStr);

  for (const [key, value] of entries) {
    if (key === "boxShadow") {
      const effects = parseBoxShadow(value);
      node.effects = node.effects || [];
      node.effects.push(...effects);
    } else if (key === "background") {
      const fill = parseGradient(value);
      if (fill) {
        node.fills = node.fills || [];
        node.fills.push(fill);
      }
    } else if (key === "backgroundImage") {
      // url(...) reference
      const m = value.match(/^url\((.+?)\)$/);
      if (m) {
        const imageRef = m[1];
        // Find or create image fill
        if (node.fills) {
          const imageFill = node.fills.find((f) => f.isImage);
          if (imageFill) {
            imageFill.imageRef = imageRef;
          } else {
            node.fills.push({ type: "IMAGE", isImage: true, imageRef });
          }
        } else {
          node.fills = [{ type: "IMAGE", isImage: true, imageRef }];
        }
      }
    } else if (key === "transform") {
      const m = value.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
      if (m) {
        node.rotation = Number(m[1]);
      }
    } else if (key === "backgroundColor") {
      // Solid background color from style
      if (value !== "transparent") {
        node.fills = node.fills || [];
        node.fills.push({ type: "SOLID", color: value });
      }
    } else if (key === "color") {
      // Text color — applied to TEXT nodes or stored for propagation to child TEXT
      if (node.type === "TEXT") {
        node.fills = node.fills || [];
        node.fills.push({ type: "SOLID", color: value });
      } else {
        // Store for later propagation to child TEXT nodes
        (node as any)._styleColor = value;
      }
    } else if (key === "fontFamily") {
      if (node.type === "TEXT") {
        node.fontFamily = value;
      } else {
        (node as any)._styleFontFamily = value;
      }
    } else if (key === "borderColor") {
      node.strokes = node.strokes || [];
      node.strokes.push({ type: "SOLID", color: value });
    } else if (key === "borderRadius") {
      const m = value.match(/^(\d+(?:\.\d+)?)px$/);
      if (m) {
        node.cornerRadius = Number(m[1]);
      }
    } else if (key === "borderWidth") {
      const m = value.match(/^(\d+(?:\.\d+)?)px$/);
      if (m) {
        node.strokeWeight = Number(m[1]);
      }
    } else if (key === "flex") {
      const num = parseFloat(value);
      if (num >= 1) {
        (node as any)._flex1 = true;
      }
    } else if (key === "width") {
      const m = value.match(/^(\d+(?:\.\d+)?)px$/);
      if (m) {
        node.width = Number(m[1]);
        node.layoutSizingHorizontal = "FIXED";
      } else if (value === "100%") {
        node.layoutSizingHorizontal = "FILL";
      }
    } else if (key === "height") {
      const m = value.match(/^(\d+(?:\.\d+)?)px$/);
      if (m) {
        node.height = Number(m[1]);
        node.layoutSizingVertical = "FIXED";
      } else if (value === "100%") {
        node.layoutSizingVertical = "FILL";
      }
    } else if (key === "display") {
      if (value === "flex") {
        node.layoutMode = node.layoutMode || "HORIZONTAL";
      }
    } else if (key === "flexDirection") {
      if (value === "column") {
        node.layoutMode = "VERTICAL";
      } else if (value === "row") {
        node.layoutMode = "HORIZONTAL";
      }
    } else if (key === "justifyContent") {
      const map: Record<string, "CENTER" | "MIN" | "MAX" | "SPACE_BETWEEN"> = {
        center: "CENTER",
        "flex-start": "MIN",
        start: "MIN",
        "flex-end": "MAX",
        end: "MAX",
        "space-between": "SPACE_BETWEEN",
      };
      if (map[value]) node.primaryAxisAlignItems = map[value];
    } else if (key === "alignItems") {
      const map: Record<string, "CENTER" | "MIN" | "MAX" | "BASELINE"> = {
        center: "CENTER",
        "flex-start": "MIN",
        start: "MIN",
        "flex-end": "MAX",
        end: "MAX",
        baseline: "BASELINE",
      };
      if (map[value]) node.counterAxisAlignItems = map[value];
    } else if (key === "gap") {
      const m = value.match(/^(\d+(?:\.\d+)?)px$/);
      if (m) node.itemSpacing = Number(m[1]);
    } else if (key === "padding") {
      // Parse CSS shorthand: 1-4 values (supports px units and unitless 0)
      const vals = value.match(/(\d+(?:\.\d+)?)(?:px)?/g);
      if (vals) {
        const nums = vals.map((v) => Number(v.replace("px", ""))).filter((n) => !isNaN(n));
        if (nums.length === 1) {
          node.paddingTop = nums[0];
          node.paddingRight = nums[0];
          node.paddingBottom = nums[0];
          node.paddingLeft = nums[0];
        } else if (nums.length === 2) {
          node.paddingTop = nums[0];
          node.paddingBottom = nums[0];
          node.paddingRight = nums[1];
          node.paddingLeft = nums[1];
        } else if (nums.length === 3) {
          node.paddingTop = nums[0];
          node.paddingRight = nums[1];
          node.paddingLeft = nums[1];
          node.paddingBottom = nums[2];
        } else if (nums.length >= 4) {
          node.paddingTop = nums[0];
          node.paddingRight = nums[1];
          node.paddingBottom = nums[2];
          node.paddingLeft = nums[3];
        }
      }
    } else if (key === "paddingTop") {
      const m = value.match(/^(\d+(?:\.\d+)?)px$/);
      if (m) node.paddingTop = Number(m[1]);
    } else if (key === "paddingRight") {
      const m = value.match(/^(\d+(?:\.\d+)?)px$/);
      if (m) node.paddingRight = Number(m[1]);
    } else if (key === "paddingBottom") {
      const m = value.match(/^(\d+(?:\.\d+)?)px$/);
      if (m) node.paddingBottom = Number(m[1]);
    } else if (key === "paddingLeft") {
      const m = value.match(/^(\d+(?:\.\d+)?)px$/);
      if (m) node.paddingLeft = Number(m[1]);
    } else if (key === "opacity") {
      const num = parseFloat(value);
      if (!isNaN(num)) node.opacity = Math.min(1, Math.max(0, num));
    } else if (key === "overflow") {
      if (value === "hidden") node.clipsContent = true;
    } else if (key === "flexWrap") {
      if (value === "wrap") node.layoutWrap = "WRAP";
    } else if (key === "fontSize") {
      if (node.type === "TEXT") {
        const m = value.match(/^(\d+(?:\.\d+)?)px$/);
        if (m) node.fontSize = Number(m[1]);
      }
    } else if (key === "fontWeight") {
      if (node.type === "TEXT") {
        const num = parseInt(value, 10);
        if (!isNaN(num)) node.fontWeight = num;
      }
    } else if (key === "lineHeight") {
      if (node.type === "TEXT") {
        const m = value.match(/^(\d+(?:\.\d+)?)px$/);
        if (m) node.lineHeight = Number(m[1]);
      }
    } else if (key === "letterSpacing") {
      if (node.type === "TEXT") {
        const m = value.match(/^(-?\d+(?:\.\d+)?)px$/);
        if (m) node.letterSpacing = Number(m[1]);
      }
    } else if (key === "textAlign") {
      if (node.type === "TEXT") {
        const map: Record<string, "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED"> = {
          left: "LEFT",
          center: "CENTER",
          right: "RIGHT",
          justify: "JUSTIFIED",
        };
        if (map[value]) node.textAlignHorizontal = map[value];
      }
    } else if (key === "textTransform") {
      if (node.type === "TEXT") {
        const map: Record<string, "UPPER" | "LOWER" | "TITLE"> = {
          uppercase: "UPPER",
          lowercase: "LOWER",
          capitalize: "TITLE",
        };
        if (map[value]) node.textCase = map[value];
      }
    } else if (key === "borderStyle") {
      // no-op: Figma always uses solid borders
    } else if (key === "maxWidth" || key === "minWidth" || key === "maxHeight" || key === "minHeight") {
      const m = value.match(/^(\d+(?:\.\d+)?)px$/);
      if (m) (node as any)[key] = Number(m[1]);
    }
  }
}

/**
 * Convert a kebab-case CSS property name to camelCase.
 * e.g. "flex-direction" → "flexDirection", "background-color" → "backgroundColor"
 */
function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Detect whether a style string is CSS format (semicolons, unquoted values, kebab-case keys)
 * vs the JSX serialized format (key: "value" with double-quoted values).
 */
function isCssStyleString(styleStr: string): boolean {
  // CSS strings contain semicolons as delimiters
  if (styleStr.includes(";")) return true;
  // CSS strings have unquoted values — if no double-quoted values found, it's CSS
  if (!/:\s*"/.test(styleStr)) return true;
  return false;
}

function parseStyleEntries(styleStr: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];

  if (isCssStyleString(styleStr)) {
    // CSS string format: "display: flex; flex-direction: column; background-color: #0a0a0a;"
    // Use paren-depth-aware splitting to handle values like url(data:image/png;base64,...)
    const parts = splitBySemicolon(styleStr);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) continue;
      const key = kebabToCamel(trimmed.substring(0, colonIdx).trim());
      const value = trimmed.substring(colonIdx + 1).trim();
      if (key && value) {
        entries.push([key, value]);
      }
    }
  } else {
    // JSX serialized format: key: "value", key2: "value2"
    const regex = /(\w+):\s*"((?:[^"\\]|\\.)*)"/g;
    let match;
    while ((match = regex.exec(styleStr)) !== null) {
      entries.push([match[1], match[2]]);
    }
  }

  return entries;
}

function parseBoxShadow(value: string): FigmaNodeEffect[] {
  const effects: FigmaNodeEffect[] = [];

  // Split on ", " but not within rgba()
  const shadows = splitByComma(value);

  for (const shadow of shadows) {
    const trimmed = shadow.trim();
    const isInset = trimmed.startsWith("inset ");
    const rest = isInset ? trimmed.substring(6).trim() : trimmed;

    // Parse: Xpx Ypx Rpx Spx color
    const m = rest.match(
      /^(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(.+)$/,
    );
    if (m) {
      effects.push({
        type: isInset ? "INNER_SHADOW" : "DROP_SHADOW",
        offset: { x: Number(m[1]), y: Number(m[2]) },
        radius: Number(m[3]),
        spread: Number(m[4]),
        color: m[5],
      });
    }
  }

  return effects;
}

/**
 * Split a CSS string on semicolons, respecting parentheses depth.
 * This prevents splitting inside url(...), linear-gradient(...), etc.
 */
function splitBySemicolon(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === ";" && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());

  return parts;
}

function splitByComma(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());

  return parts;
}

function parseGradient(value: string): FigmaNodeFill | null {
  let m;
  if ((m = value.match(/^(linear|radial)-gradient\((.+)\)$/))) {
    const gradType = m[1] === "linear" ? "GRADIENT_LINEAR" : "GRADIENT_RADIAL";
    const stopsStr = m[2];

    // Parse stops: "color position%, color position%" (paren-aware split)
    const stops: Array<{ color: string; position: number }> = [];
    const stopParts = splitByComma(stopsStr);

    for (const part of stopParts) {
      const stopMatch = part.match(/^(.+?)\s+(\d+)%$/);
      if (stopMatch) {
        stops.push({
          color: stopMatch[1],
          position: Number(stopMatch[2]) / 100,
        });
      }
    }

    if (stops.length > 0) {
      return {
        type: gradType,
        gradient: { type: gradType, stops },
      };
    }
  }

  return null;
}
