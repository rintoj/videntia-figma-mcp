import type { FigmaNodeData, FigmaNodeFill, FigmaNodeEffect } from "../types/index.js";

/**
 * Parse JSX+Tailwind markup (as produced by convertToJsx) back into FigmaNodeData[].
 */
export function parseJsx(jsx: string): FigmaNodeData[] {
  const trimmed = jsx.trim();
  if (!trimmed) return [];

  const nodes: FigmaNodeData[] = [];
  let pos = 0;
  let pendingExtras: PendingExtras = {};

  while (pos < trimmed.length) {
    // Skip whitespace
    while (pos < trimmed.length && /\s/.test(trimmed[pos])) pos++;
    if (pos >= trimmed.length) break;

    // Try to parse JSX comments (extra fills/strokes)
    const comment = tryParseJsxComment(trimmed, pos);
    if (comment) {
      const extras = parseExtraComment(comment.body);
      if (extras) {
        if (extras.fills) pendingExtras.fills = [...(pendingExtras.fills || []), ...extras.fills];
        if (extras.strokes) pendingExtras.strokes = [...(pendingExtras.strokes || []), ...extras.strokes];
      }
      pos = comment.pos;
      continue;
    }

    if (trimmed[pos] === "<") {
      const result = parseElement(trimmed, pos);
      if (pendingExtras.fills || pendingExtras.strokes) {
        applyPendingExtras(result.node, pendingExtras);
        pendingExtras = {};
      }
      nodes.push(result.node);
      pos = result.pos;
    } else {
      break; // Unexpected content
    }
  }

  return nodes;
}

// --- JSX comment parsing for extra fills/strokes ---

interface PendingExtras {
  fills?: FigmaNodeFill[];
  strokes?: Array<{ type: string; color?: string; opacity?: number }>;
}

/**
 * Try to parse a JSX comment at the given position: {/* ... *​/}
 * Returns the comment body and the new position, or null if not a comment.
 */
function tryParseJsxComment(input: string, pos: number): { body: string; pos: number } | null {
  if (input.substring(pos, pos + 3) !== "{/*") return null;
  const endMarker = "*/}";
  const endIdx = input.indexOf(endMarker, pos + 3);
  if (endIdx === -1) return null;
  const body = input.substring(pos + 3, endIdx).trim();
  return { body, pos: endIdx + endMarker.length };
}

/**
 * Parse an extra-fills or extra-strokes comment body.
 * Expected format: "Figma fills[1..n]: [...]" or "Figma strokes[1..n]: [...]"
 */
function parseExtraComment(body: string): PendingExtras | null {
  const fillsMatch = body.match(/^Figma fills\[1\.\.n\]:\s*(\[.+\])$/);
  if (fillsMatch) {
    try {
      const fills = JSON.parse(fillsMatch[1]) as FigmaNodeFill[];
      return { fills };
    } catch { return null; }
  }
  const strokesMatch = body.match(/^Figma strokes\[1\.\.n\]:\s*(\[.+\])$/);
  if (strokesMatch) {
    try {
      const strokes = JSON.parse(strokesMatch[1]) as Array<{ type: string; color?: string; opacity?: number }>;
      return { strokes };
    } catch { return null; }
  }
  return null;
}

/**
 * Apply pending extra fills/strokes to a node.
 */
function applyPendingExtras(node: FigmaNodeData, extras: PendingExtras): void {
  if (extras.fills) {
    node.fills = node.fills || [];
    node.fills.push(...extras.fills);
  }
  if (extras.strokes) {
    node.strokes = node.strokes || [];
    node.strokes.push(...extras.strokes);
  }
}

// --- Recursive descent parser ---

interface ParseResult {
  node: FigmaNodeData;
  pos: number;
}

function parseElement(input: string, pos: number): ParseResult {
  // Expect '<'
  if (input[pos] !== "<") throw new Error(`Expected '<' at position ${pos}`);
  pos++; // skip '<'

  // Parse tag name
  const tagStart = pos;
  while (pos < input.length && /[a-zA-Z0-9]/.test(input[pos])) pos++;
  const tag = input.substring(tagStart, pos);

  // Parse attributes
  const attrResult = parseAttributes(input, pos);
  pos = attrResult.pos;
  const attrs = attrResult.attrs;

  // Determine node type from tag
  const nodeType = tagToNodeType(tag);

  // Build the base node
  const node: FigmaNodeData = {
    id: attrs.id || "",
    name: decodeEntities(attrs.name || "Node"),
    type: nodeType,
    visible: true,
  };

  // Apply SVG width/height
  if (tag === "svg") {
    if (attrs.width !== undefined) node.width = Number(attrs.width);
    if (attrs.height !== undefined) node.height = Number(attrs.height);
  }

  // Check for self-closing
  pos = skipWhitespace(input, pos);
  if (input[pos] === "/" && input[pos + 1] === ">") {
    pos += 2; // skip '/>'
    applyClassName(node, attrs.className || "");
    applyStyleAttribute(node, attrs.style || "");
    return { node, pos };
  }

  // Expect '>'
  if (input[pos] !== ">") throw new Error(`Expected '>' at position ${pos}, got '${input[pos]}'`);
  pos++; // skip '>'

  // Parse children / text content
  if (nodeType === "TEXT") {
    // Text node: content up to closing tag
    const closeTag = `</${tag}>`;
    const closeIdx = input.indexOf(closeTag, pos);
    if (closeIdx === -1) throw new Error(`Missing closing tag </${tag}>`);
    const rawText = input.substring(pos, closeIdx).trim();
    node.characters = decodeEntities(rawText);
    pos = closeIdx + closeTag.length;
  } else {
    // Container: parse child elements
    const children: FigmaNodeData[] = [];
    let childPendingExtras: PendingExtras = {};
    while (true) {
      pos = skipWhitespace(input, pos);
      if (pos >= input.length) break;

      // Check for closing tag
      if (input[pos] === "<" && input[pos + 1] === "/") {
        // Closing tag
        const closeTag = `</${tag}>`;
        const closeIdx = input.indexOf(closeTag, pos);
        if (closeIdx === pos) {
          pos = closeIdx + closeTag.length;
          break;
        }
        // Might be a different closing tag (error), skip
        pos = input.indexOf(">", pos) + 1;
        break;
      }

      // Try to parse JSX comments (extra fills/strokes)
      const childComment = tryParseJsxComment(input, pos);
      if (childComment) {
        const extras = parseExtraComment(childComment.body);
        if (extras) {
          if (extras.fills) childPendingExtras.fills = [...(childPendingExtras.fills || []), ...extras.fills];
          if (extras.strokes) childPendingExtras.strokes = [...(childPendingExtras.strokes || []), ...extras.strokes];
        }
        pos = childComment.pos;
        continue;
      }

      if (input[pos] === "<") {
        const childResult = parseElement(input, pos);
        if (childPendingExtras.fills || childPendingExtras.strokes) {
          applyPendingExtras(childResult.node, childPendingExtras);
          childPendingExtras = {};
        }
        children.push(childResult.node);
        pos = childResult.pos;
      } else {
        // Skip unexpected text content in containers
        while (pos < input.length && input[pos] !== "<") pos++;
      }
    }
    if (children.length > 0) {
      node.children = children;
    }
  }

  applyClassName(node, attrs.className || "");
  applyStyleAttribute(node, attrs.style || "");
  return { node, pos };
}

function parseAttributes(input: string, pos: number): { attrs: Record<string, string>; pos: number } {
  const attrs: Record<string, string> = {};

  while (pos < input.length) {
    pos = skipWhitespace(input, pos);
    if (pos >= input.length) break;

    // End of attributes
    if (input[pos] === ">" || (input[pos] === "/" && input[pos + 1] === ">")) break;

    // Parse attribute name
    const nameStart = pos;
    while (pos < input.length && /[a-zA-Z0-9_-]/.test(input[pos])) pos++;
    const attrName = input.substring(nameStart, pos);
    if (!attrName) break;

    pos = skipWhitespace(input, pos);
    if (input[pos] !== "=") {
      // Boolean attribute
      attrs[attrName] = "true";
      continue;
    }
    pos++; // skip '='

    pos = skipWhitespace(input, pos);

    if (input[pos] === '"') {
      // String attribute: "value"
      pos++; // skip opening quote
      const valueStart = pos;
      while (pos < input.length && input[pos] !== '"') pos++;
      attrs[attrName] = input.substring(valueStart, pos);
      pos++; // skip closing quote
    } else if (input[pos] === "{" && input[pos + 1] === "{") {
      // JSX style attribute: style={{ key: "value", ... }}
      pos += 2; // skip '{{'
      const styleStart = pos;
      let depth = 1;
      while (pos < input.length) {
        if (input[pos] === "{") depth++;
        else if (input[pos] === "}") {
          depth--;
          if (depth === 0) break;
        }
        pos++;
      }
      // pos is at the first '}' of '}}'
      attrs[attrName] = input.substring(styleStart, pos).trim();
      pos++; // skip first '}'
      if (pos < input.length && input[pos] === "}") pos++; // skip second '}'
    } else if (input[pos] === "{") {
      // JSX expression attribute: {value}
      pos++; // skip '{'
      let depth = 1;
      const valueStart = pos;
      while (pos < input.length && depth > 0) {
        if (input[pos] === "{") depth++;
        else if (input[pos] === "}") depth--;
        if (depth > 0) pos++;
      }
      attrs[attrName] = input.substring(valueStart, pos).trim();
      pos++; // skip '}'
    }
  }

  return { attrs, pos };
}

function tagToNodeType(tag: string): string {
  if (tag === "span") return "TEXT";
  if (tag === "svg") return "VECTOR";
  return "FRAME";
}

function skipWhitespace(input: string, pos: number): number {
  while (pos < input.length && /\s/.test(input[pos])) pos++;
  return pos;
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

  // Gradient accumulator
  let gradientDir: string | undefined;
  let gradientFrom: { color: string; opacity?: number; varName?: string } | undefined;
  let gradientVia: { color: string; opacity?: number; varName?: string } | undefined;
  let gradientTo: { color: string; opacity?: number; varName?: string } | undefined;

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
      node.fills = [fill];
      continue;
    }
    // --- Tailwind gradient classes (must come BEFORE catch-all bg-*) ---
    if ((m = cls.match(/^bg-gradient-to-(r|l|t|b|tr|tl|br|bl)$/))) {
      gradientDir = m[1]; continue;
    }
    if ((m = cls.match(/^from-\[(#[0-9a-fA-F]{3,8})\](?:\/(\d+))?$/))) {
      gradientFrom = { color: m[1], opacity: m[2] ? Number(m[2]) / 100 : undefined }; continue;
    }
    if ((m = cls.match(/^via-\[(#[0-9a-fA-F]{3,8})\](?:\/(\d+))?$/))) {
      gradientVia = { color: m[1], opacity: m[2] ? Number(m[2]) / 100 : undefined }; continue;
    }
    if ((m = cls.match(/^to-\[(#[0-9a-fA-F]{3,8})\](?:\/(\d+))?$/))) {
      gradientTo = { color: m[1], opacity: m[2] ? Number(m[2]) / 100 : undefined }; continue;
    }
    // Gradient variable bindings: from-{var}, via-{var}, to-{var}
    if ((m = cls.match(/^from-(.+)$/)) && !m[1].startsWith("[")) {
      gradientFrom = { color: "#000000", varName: denormalizeVarName(m[1]) }; continue;
    }
    if ((m = cls.match(/^via-(.+)$/)) && !m[1].startsWith("[")) {
      gradientVia = { color: "#000000", varName: denormalizeVarName(m[1]) }; continue;
    }
    if ((m = cls.match(/^to-(.+)$/)) && !m[1].startsWith("[")) {
      gradientTo = { color: "#000000", varName: denormalizeVarName(m[1]) }; continue;
    }

    // bg-{var}
    if ((m = cls.match(/^bg-(.+)$/)) && !m[1].startsWith("[")) {
      const varName = denormalizeVarName(m[1]);
      node.fills = [{ type: "SOLID", color: "#000000" }];
      bindings["fills/0"] = varName;
      continue;
    }

    // --- Text colors ---
    if (isText && (m = cls.match(/^text-\[(#[0-9a-fA-F]{3,8})\](?:\/(\d+))?$/))) {
      const color = m[1];
      const opacity = m[2] ? Number(m[2]) / 100 : undefined;
      const fill: FigmaNodeFill = { type: "SOLID", color };
      if (opacity !== undefined) fill.opacity = opacity;
      node.fills = [fill];
      continue;
    }

    // --- Strokes ---
    if ((m = cls.match(/^border-\[(\d+(?:\.\d+)?)px\]$/))) {
      node.strokeWeight = Number(m[1]); continue;
    }
    if ((m = cls.match(/^border-\[(#[0-9a-fA-F]{3,8})\]$/))) {
      node.strokes = [{ type: "SOLID", color: m[1] }]; continue;
    }
    if ((m = cls.match(/^border-(.+)$/)) && !m[1].startsWith("[")) {
      const varName = denormalizeVarName(m[1]);
      node.strokes = [{ type: "SOLID", color: "#000000" }];
      bindings["strokes/0"] = varName;
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
          node.fills = [{ type: "SOLID", color: "#000000" }];
          bindings["fills/0"] = denormalizeVarName(name);
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
  if (gradientDir || gradientFrom || gradientVia || gradientTo) {
    const stops: Array<{ color: string; position: number }> = [];
    if (gradientFrom) stops.push({ color: gradientFrom.color, position: 0 });
    if (gradientVia) stops.push({ color: gradientVia.color, position: 0.5 });
    if (gradientTo) stops.push({ color: gradientTo.color, position: 1 });
    if (stops.length > 0) {
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
        node.fills = [{ type: "SOLID", color: "#000000" }];
        bindings["fills/0"] = denormalizeVarName(name);
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
        node.fills = [fill];
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
