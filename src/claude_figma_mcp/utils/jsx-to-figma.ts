import { parse } from "@babel/parser";
import type * as t from "@babel/types";
import type { FigmaNodeData, FigmaNodeFill, FigmaNodeEffect } from "../types/index.js";

/**
 * Parse JSX+Tailwind markup (as produced by convertToJsx) back into FigmaNodeData[].
 * Uses @babel/parser for robust AST-based parsing.
 */
export function parseJsx(jsx: string): FigmaNodeData[] {
  const trimmed = jsx.trim();
  if (!trimmed) return [];

  // Wrap in a fragment to make it a valid JSX expression
  const wrapped = `(<>${trimmed}</>)`;
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
      nodes.push(jsxElementToNode(child));
    }
    // Skip JSXText (whitespace), JSXExpressionContainer (comments), etc.
  }

  return nodes;
}

/**
 * Convert a Babel JSXElement AST node into a FigmaNodeData.
 */
function jsxElementToNode(el: t.JSXElement, parentType?: string): FigmaNodeData {
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
    name = decodeEntities(attrs.name || "Node");
  }

  const node: FigmaNodeData = {
    id: attrs.id || "",
    name,
    type: nodeType,
    visible: true,
  };

  // Apply SVG width/height
  if (tag === "svg") {
    if (attrs.width !== undefined) node.width = Number(attrs.width);
    if (attrs.height !== undefined) node.height = Number(attrs.height);
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
    for (const child of el.children) {
      if (child.type === "JSXElement") {
        children.push(jsxElementToNode(child, nodeType));
      }
      // Skip JSXText (whitespace), JSXExpressionContainer (comments)
    }
    if (children.length > 0) {
      node.children = children;
    }
  }

  applyClassName(node, attrs.className || "");
  applyStyleAttribute(node, attrs.style || "");
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
      prop.key.type === "Identifier"
        ? prop.key.name
        : prop.key.type === "StringLiteral"
          ? prop.key.value
          : "";
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
      prop.key.type === "Identifier"
        ? prop.key.name
        : prop.key.type === "StringLiteral"
          ? prop.key.value
          : "";
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
  "id", "name", "className", "style", "componentName", "propertyNameMap", "propertyDefinitions",
  "width", "height", "variantProperties", "componentProperties", "componentSetName", "mainComponentName",
]);

function isPascalCase(tag: string): boolean {
  return /^[A-Z]/.test(tag);
}

function tagToNodeType(tag: string, attrs?: Record<string, string>, parentType?: string): string {
  if (tag === "span") return "TEXT";
  if (tag === "svg") return "VECTOR";

  // Primary signal: componentName attr is only emitted by figma-to-jsx for component types.
  // This avoids false positives from PascalCase tags that happen to match (e.g. <DataSet>).
  const hasComponentName = attrs?.componentName !== undefined;

  if (isPascalCase(tag)) {
    // COMPONENT_SET: has propertyDefinitions, or tag ends with "Set" AND has componentName
    if ((attrs && attrs.propertyDefinitions !== undefined) ||
        (tag.endsWith("Set") && hasComponentName)) {
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
      const hasComponentProps = Object.keys(attrs).some(k => !STANDARD_ATTRS.has(k));
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
function parsePropertyDefinitions(
  str: string,
  nameMap: Record<string, string>,
): Record<string, ComponentPropertyDef> {
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
    if (cls.startsWith("font-") || cls.startsWith("leading-") || cls.startsWith("tracking-")) {
      hasIndividualTypography = true;
    }
  }

  for (const cls of classes) {
    // --- Layout ---
    if (cls === "flex") continue; // paired with flex-row/flex-col
    if (cls === "flex-row") { node.layoutMode = "HORIZONTAL"; continue; }
    if (cls === "flex-col") { node.layoutMode = "VERTICAL"; continue; }
    if (cls === "relative") { /* non-layout container, no special prop */ continue; }
    if (cls === "justify-center") { node.primaryAxisAlignItems = "CENTER"; continue; }
    if (cls === "justify-end") { node.primaryAxisAlignItems = "MAX"; continue; }
    if (cls === "justify-between") { node.primaryAxisAlignItems = "SPACE_BETWEEN"; continue; }
    if (cls === "items-center") { node.counterAxisAlignItems = "CENTER"; continue; }
    if (cls === "items-end") { node.counterAxisAlignItems = "MAX"; continue; }
    if (cls === "items-baseline") { node.counterAxisAlignItems = "BASELINE"; continue; }
    if (cls === "flex-wrap") { node.layoutWrap = "WRAP"; continue; }
    if (cls === "overflow-hidden") { node.clipsContent = true; continue; }
    if (cls === "absolute") { node.layoutPositioning = "ABSOLUTE"; continue; }

    // left-[Npx] / top-[Npx]
    let m: RegExpMatchArray | null;
    if ((m = cls.match(/^left-\[(-?\d+(?:\.\d+)?)px\]$/))) {
      node.x = Number(m[1]); continue;
    }
    if ((m = cls.match(/^top-\[(-?\d+(?:\.\d+)?)px\]$/))) {
      node.y = Number(m[1]); continue;
    }

    // --- Gap ---
    if ((m = cls.match(/^gap-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.itemSpacing = Number(m[1]); continue;
    }
    if ((m = cls.match(/^gap-y-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.counterAxisSpacing = Number(m[1]); continue;
    }
    if ((m = cls.match(/^gap-x-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.counterAxisSpacing = Number(m[1]); continue;
    }
    // gap-{var}
    if ((m = cls.match(/^gap-y-(.+)$/)) && !m[1].startsWith("[")) {
      node.counterAxisSpacing = 0; // Placeholder value; real value comes from variable
      bindings["counterAxisSpacing"] = denormalizeVarName(m[1]); continue;
    }
    if ((m = cls.match(/^gap-x-(.+)$/)) && !m[1].startsWith("[")) {
      node.counterAxisSpacing = 0;
      bindings["counterAxisSpacing"] = denormalizeVarName(m[1]); continue;
    }
    if ((m = cls.match(/^gap-(.+)$/)) && !m[1].startsWith("[")) {
      node.itemSpacing = 0;
      bindings["itemSpacing"] = denormalizeVarName(m[1]); continue;
    }

    // --- Sizing ---
    if ((m = cls.match(/^w-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.width = Number(m[1]); node.layoutSizingHorizontal = "FIXED"; continue;
    }
    if ((m = cls.match(/^h-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.height = Number(m[1]); node.layoutSizingVertical = "FIXED"; continue;
    }
    if (cls === "flex-1") {
      // flex-1 means FILL on whichever axis hasn't been set yet
      if (!node.layoutSizingHorizontal || node.layoutSizingHorizontal !== "FIXED") {
        node.layoutSizingHorizontal = "FILL";
      } else {
        node.layoutSizingVertical = "FILL";
      }
      continue;
    }
    if (cls === "h-full") {
      node.layoutSizingVertical = "FILL"; continue;
    }

    // --- Padding ---
    if ((m = cls.match(/^p-\[(\d+(?:\.\d+)?)px\]$/))) {
      const v = Number(m[1]);
      node.paddingTop = v; node.paddingRight = v; node.paddingBottom = v; node.paddingLeft = v;
      continue;
    }
    if ((m = cls.match(/^px-\[(\d+(?:\.\d+)?)px\]$/))) {
      const v = Number(m[1]);
      node.paddingRight = v; node.paddingLeft = v; continue;
    }
    if ((m = cls.match(/^py-\[(\d+(?:\.\d+)?)px\]$/))) {
      const v = Number(m[1]);
      node.paddingTop = v; node.paddingBottom = v; continue;
    }
    if ((m = cls.match(/^pt-\[(\d+(?:\.\d+)?)px\]$/))) { node.paddingTop = Number(m[1]); continue; }
    if ((m = cls.match(/^pr-\[(\d+(?:\.\d+)?)px\]$/))) { node.paddingRight = Number(m[1]); continue; }
    if ((m = cls.match(/^pb-\[(\d+(?:\.\d+)?)px\]$/))) { node.paddingBottom = Number(m[1]); continue; }
    if ((m = cls.match(/^pl-\[(\d+(?:\.\d+)?)px\]$/))) { node.paddingLeft = Number(m[1]); continue; }
    // p-{var}
    if ((m = cls.match(/^p-(.+)$/)) && !m[1].startsWith("[")) {
      const varName = denormalizeVarName(m[1]);
      node.paddingTop = 0; node.paddingRight = 0; node.paddingBottom = 0; node.paddingLeft = 0;
      bindings["paddingTop"] = varName;
      bindings["paddingRight"] = varName;
      bindings["paddingBottom"] = varName;
      bindings["paddingLeft"] = varName;
      continue;
    }
    if ((m = cls.match(/^px-(.+)$/)) && !m[1].startsWith("[")) {
      const varName = denormalizeVarName(m[1]);
      node.paddingRight = 0; node.paddingLeft = 0;
      bindings["paddingLeft"] = varName;
      bindings["paddingRight"] = varName;
      continue;
    }
    if ((m = cls.match(/^py-(.+)$/)) && !m[1].startsWith("[")) {
      const varName = denormalizeVarName(m[1]);
      node.paddingTop = 0; node.paddingBottom = 0;
      bindings["paddingTop"] = varName;
      bindings["paddingBottom"] = varName;
      continue;
    }
    if ((m = cls.match(/^pt-(.+)$/)) && !m[1].startsWith("[")) {
      bindings["paddingTop"] = denormalizeVarName(m[1]); node.paddingTop = 0; continue;
    }
    if ((m = cls.match(/^pr-(.+)$/)) && !m[1].startsWith("[")) {
      bindings["paddingRight"] = denormalizeVarName(m[1]); node.paddingRight = 0; continue;
    }
    if ((m = cls.match(/^pb-(.+)$/)) && !m[1].startsWith("[")) {
      bindings["paddingBottom"] = denormalizeVarName(m[1]); node.paddingBottom = 0; continue;
    }
    if ((m = cls.match(/^pl-(.+)$/)) && !m[1].startsWith("[")) {
      bindings["paddingLeft"] = denormalizeVarName(m[1]); node.paddingLeft = 0; continue;
    }

    // --- Background colors ---
    if (cls === "bg-cover") continue; // Image fill indicator (handled with bg-center)
    if (cls === "bg-center") {
      // Image fill
      if (!node.fills || !node.fills.some(f => f.isImage)) {
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
      gradientDir = m[1]; continue;
    }
    if ((m = cls.match(/^from-\[(#[0-9a-fA-F]{3,8})\](?:\/(\d+))?$/))) {
      gradientFrom = { color: m[1] }; continue;
    }
    if ((m = cls.match(/^via-\[(#[0-9a-fA-F]{3,8})\](?:\/(\d+))?$/))) {
      gradientVia = { color: m[1] }; continue;
    }
    if ((m = cls.match(/^to-\[(#[0-9a-fA-F]{3,8})\](?:\/(\d+))?$/))) {
      gradientTo = { color: m[1] }; continue;
    }
    // Gradient variable bindings: from-{var}, via-{var}, to-{var}
    // Note: variable bindings for gradient stops are not yet supported —
    // the varName is not wired into node.bindings. Stored as placeholder color only.
    if ((m = cls.match(/^from-(.+)$/)) && !m[1].startsWith("[")) {
      gradientFrom = { color: "#000000" }; continue;
    }
    if ((m = cls.match(/^via-(.+)$/)) && !m[1].startsWith("[")) {
      gradientVia = { color: "#000000" }; continue;
    }
    if ((m = cls.match(/^to-(.+)$/)) && !m[1].startsWith("[")) {
      gradientTo = { color: "#000000" }; continue;
    }

    // bg-{var}
    if ((m = cls.match(/^bg-(.+)$/)) && !m[1].startsWith("[")) {
      const varName = denormalizeVarName(m[1]);
      node.fills = node.fills || [];
      const idx = node.fills.length;
      node.fills.push({ type: "SOLID", color: "#000000" });
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
    if ((m = cls.match(/^border-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.strokeWeight = Number(m[1]); continue;
    }
    if ((m = cls.match(/^border-\[(#[0-9a-fA-F]{3,8})\]$/))) {
      node.strokes = node.strokes || [];
      node.strokes.push({ type: "SOLID", color: m[1] });
      continue;
    }
    if ((m = cls.match(/^border-(.+)$/)) && !m[1].startsWith("[")) {
      const varName = denormalizeVarName(m[1]);
      node.strokes = node.strokes || [];
      const idx = node.strokes.length;
      node.strokes.push({ type: "SOLID", color: "#000000" });
      bindings[`strokes/${idx}`] = varName;
      continue;
    }

    // --- Typography (text nodes only) ---
    if (isText) {
      // Font size: text-[Npx]
      if ((m = cls.match(/^text-\[(\d+(?:\.\d+)?)px\]$/))) {
        node.fontSize = Number(m[1]); continue;
      }

      // Text alignment
      if (cls === "text-center") { node.textAlignHorizontal = "CENTER"; continue; }
      if (cls === "text-right") { node.textAlignHorizontal = "RIGHT"; continue; }
      if (cls === "text-justify") { node.textAlignHorizontal = "JUSTIFIED"; continue; }

      // Font weight
      if (FONT_WEIGHT_MAP[cls] !== undefined) {
        node.fontWeight = FONT_WEIGHT_MAP[cls]; continue;
      }
      // Custom font weight: font-[N]
      if ((m = cls.match(/^font-\[(\d+)\]$/))) {
        node.fontWeight = Number(m[1]); continue;
      }

      // Line height
      if ((m = cls.match(/^leading-\[(\d+(?:\.\d+)?)px\]$/))) {
        node.lineHeight = Number(m[1]); continue;
      }
      if ((m = cls.match(/^leading-\[(\d+(?:\.\d+)?)%\]$/))) {
        node.lineHeight = Number(m[1]); node.lineHeightUnit = "percent"; continue;
      }

      // Letter spacing
      if ((m = cls.match(/^tracking-\[(-?\d+(?:\.\d+)?)px\]$/))) {
        node.letterSpacing = Number(m[1]); continue;
      }
      if ((m = cls.match(/^tracking-\[(-?\d+(?:\.\d+)?)em\]$/))) {
        node.letterSpacing = Number(m[1]) * 100; node.letterSpacingUnit = "percent"; continue;
      }

      // Font family
      if ((m = cls.match(/^font-\['(.+?)'\]$/))) {
        node.fontFamily = m[1].replace(/_/g, " "); continue;
      }

      // Text case
      if (cls === "uppercase") { node.textCase = "UPPER"; continue; }
      if (cls === "lowercase") { node.textCase = "LOWER"; continue; }
      if (cls === "capitalize") { node.textCase = "TITLE"; continue; }

      // Text decoration
      if (cls === "underline") { node.textDecoration = "UNDERLINE"; continue; }
      if (cls === "line-through") { node.textDecoration = "STRIKETHROUGH"; continue; }

      // text-{name}: either text style or fill variable binding
      if ((m = cls.match(/^text-(.+)$/)) && !m[1].startsWith("[")) {
        const name = m[1];
        // Skip alignment keywords already handled
        if (name === "center" || name === "right" || name === "justify") continue;
        // Disambiguate: if individual typography props exist (fontSize set), it's a fill binding
        // If no individual typography, it's a textStyleName
        if (hasFontSize || hasIndividualTypography) {
          // Fill variable binding
          node.fills = node.fills || [];
          const idx = node.fills.length;
          node.fills.push({ type: "SOLID", color: "#000000" });
          bindings[`fills/${idx}`] = denormalizeVarName(name);
        } else {
          deferredTextClasses.push(name);
        }
        continue;
      }
    }

    // --- Corners ---
    if ((m = cls.match(/^rounded-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.cornerRadius = Number(m[1]); continue;
    }
    if ((m = cls.match(/^rounded-tl-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.topLeftRadius = Number(m[1]); continue;
    }
    if ((m = cls.match(/^rounded-tr-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.topRightRadius = Number(m[1]); continue;
    }
    if ((m = cls.match(/^rounded-br-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.bottomRightRadius = Number(m[1]); continue;
    }
    if ((m = cls.match(/^rounded-bl-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.bottomLeftRadius = Number(m[1]); continue;
    }
    // rounded-{var}
    if ((m = cls.match(/^rounded-(.+)$/)) && !m[1].startsWith("[") && !["tl-", "tr-", "bl-", "br-"].some(p => m![1].startsWith(p))) {
      node.cornerRadius = 0;
      bindings["cornerRadius"] = denormalizeVarName(m[1]);
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

    // --- Opacity ---
    if ((m = cls.match(/^opacity-\[(\d+(?:\.\d+)?)\]$/))) {
      node.opacity = Number(m[1]); continue;
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

  // Process deferred text- classes
  if (isText && deferredTextClasses.length > 0) {
    for (const name of deferredTextClasses) {
      if (node.fontSize || hasIndividualTypography) {
        // Fill variable binding
        node.fills = node.fills || [];
        const idx = node.fills.length;
        node.fills.push({ type: "SOLID", color: "#000000" });
        bindings[`fills/${idx}`] = denormalizeVarName(name);
      } else {
        // Text style name
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
          const imageFill = node.fills.find(f => f.isImage);
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
    }
  }
}

function parseStyleEntries(styleStr: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  // Match key: "value" patterns, handling nested parens/commas in values
  const regex = /(\w+):\s*"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = regex.exec(styleStr)) !== null) {
    entries.push([match[1], match[2]]);
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
    const m = rest.match(/^(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(.+)$/);
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
