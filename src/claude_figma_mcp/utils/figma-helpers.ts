/**
 * Utilidades para el procesamiento de nodos y respuestas de Figma
 */

/**
 * Convierte un color RGBA a formato hexadecimal.
 * @param color - El color en formato RGBA con valores entre 0 y 1
 * @returns El color en formato hexadecimal (#RRGGBBAA)
 */
export function rgbaToHex(color: any): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = Math.round(color.a * 255);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}${a === 255 ? "" : a.toString(16).padStart(2, "0")}`;
}

/**
 * Default fields to include when no specific fields are requested.
 * This provides a good balance between useful information and response size.
 */
export const DEFAULT_NODE_FIELDS = [
  "id",
  "name",
  "type",
  "fills",
  "strokes",
  "cornerRadius",
  "absoluteBoundingBox",
  "characters",
  "style",
] as const;

/**
 * All available fields that can be requested from a Figma node.
 */
export type NodeField =
  | "id"
  | "name"
  | "type"
  | "fills"
  | "strokes"
  | "cornerRadius"
  | "absoluteBoundingBox"
  | "characters"
  | "style"
  | "children"
  | "effects"
  | "opacity"
  | "blendMode"
  | "constraints"
  | "layoutMode"
  | "padding"
  | "itemSpacing"
  | "componentProperties";

/**
 * Filtra un nodo de Figma para reducir su complejidad y tamaño.
 * Convierte colores a formato hexadecimal y elimina datos innecesarios.
 * @param node - El nodo de Figma a filtrar
 * @param fields - Optional array of fields to include. If not specified, uses DEFAULT_NODE_FIELDS
 * @returns El nodo filtrado o null si debe ser ignorado
 */
export function filterFigmaNode(node: any, fields?: NodeField[]): any {
  // Skip VECTOR type nodes
  if (node.type === "VECTOR") {
    return null;
  }

  // Use provided fields or default fields
  const requestedFields = fields || (DEFAULT_NODE_FIELDS as unknown as NodeField[]);
  const fieldSet = new Set(requestedFields);

  const filtered: any = {};

  // Always include id, name, type as base fields (unless explicitly excluded by providing fields without them)
  if (fieldSet.has("id")) {
    filtered.id = node.id;
  }
  if (fieldSet.has("name")) {
    filtered.name = node.name;
  }
  if (fieldSet.has("type")) {
    filtered.type = node.type;
  }

  if (fieldSet.has("fills") && node.fills && node.fills.length > 0) {
    filtered.fills = node.fills.map((fill: any) => {
      const processedFill = { ...fill };

      // Remove boundVariables and imageRef
      delete processedFill.boundVariables;
      delete processedFill.imageRef;

      // Process gradientStops if present
      if (processedFill.gradientStops) {
        processedFill.gradientStops = processedFill.gradientStops.map((stop: any) => {
          const processedStop = { ...stop };
          // Convert color to hex if present
          if (processedStop.color) {
            processedStop.color = rgbaToHex(processedStop.color);
          }
          // Remove boundVariables
          delete processedStop.boundVariables;
          return processedStop;
        });
      }

      // Convert solid fill colors to hex
      if (processedFill.color) {
        processedFill.color = rgbaToHex(processedFill.color);
      }

      return processedFill;
    });
  }

  if (fieldSet.has("strokes") && node.strokes && node.strokes.length > 0) {
    filtered.strokes = node.strokes.map((stroke: any) => {
      const processedStroke = { ...stroke };
      // Remove boundVariables
      delete processedStroke.boundVariables;
      // Convert color to hex if present
      if (processedStroke.color) {
        processedStroke.color = rgbaToHex(processedStroke.color);
      }
      return processedStroke;
    });
  }

  if (fieldSet.has("cornerRadius") && node.cornerRadius !== undefined) {
    filtered.cornerRadius = node.cornerRadius;
  }

  if (fieldSet.has("absoluteBoundingBox") && node.absoluteBoundingBox) {
    filtered.absoluteBoundingBox = node.absoluteBoundingBox;
  }

  if (fieldSet.has("characters") && node.characters) {
    filtered.characters = node.characters;
  }

  if (fieldSet.has("style") && node.style) {
    filtered.style = {
      fontFamily: node.style.fontFamily,
      fontStyle: node.style.fontStyle,
      fontWeight: node.style.fontWeight,
      fontSize: node.style.fontSize,
      textAlignHorizontal: node.style.textAlignHorizontal,
      letterSpacing: node.style.letterSpacing,
      lineHeightPx: node.style.lineHeightPx,
    };
  }

  // Additional optional fields
  if (fieldSet.has("effects") && node.effects) {
    filtered.effects = node.effects;
  }

  if (fieldSet.has("opacity") && node.opacity !== undefined) {
    filtered.opacity = node.opacity;
  }

  if (fieldSet.has("blendMode") && node.blendMode) {
    filtered.blendMode = node.blendMode;
  }

  if (fieldSet.has("constraints") && node.constraints) {
    filtered.constraints = node.constraints;
  }

  if (fieldSet.has("layoutMode") && node.layoutMode) {
    filtered.layoutMode = node.layoutMode;
  }

  if (fieldSet.has("padding")) {
    if (node.paddingLeft !== undefined) filtered.paddingLeft = node.paddingLeft;
    if (node.paddingRight !== undefined) filtered.paddingRight = node.paddingRight;
    if (node.paddingTop !== undefined) filtered.paddingTop = node.paddingTop;
    if (node.paddingBottom !== undefined) filtered.paddingBottom = node.paddingBottom;
  }

  if (fieldSet.has("itemSpacing") && node.itemSpacing !== undefined) {
    filtered.itemSpacing = node.itemSpacing;
  }

  if (fieldSet.has("componentProperties") && node.componentProperties) {
    filtered.componentProperties = node.componentProperties;
  }

  // Children is special - recursively filter with the same fields
  if (fieldSet.has("children") && node.children) {
    filtered.children = node.children
      .map((child: any) => filterFigmaNode(child, fields))
      .filter((child: any) => child !== null); // Remove null children (VECTOR nodes)
  }

  return filtered;
}

/**
 * Field → FigmaNodeData property mapping for JSX filtering.
 * Structural fields (id, name, type, visible, _childCount, bindings) are always kept.
 */
const FIELD_PROPERTY_MAP: Record<NodeField, string[]> = {
  id: [],
  name: [],
  type: [],
  fills: ["fills"],
  strokes: ["strokes", "strokeWeight"],
  cornerRadius: ["cornerRadius", "topLeftRadius", "topRightRadius", "bottomRightRadius", "bottomLeftRadius"],
  absoluteBoundingBox: ["x", "y", "width", "height"],
  characters: [
    "characters", "fontFamily", "fontSize", "fontWeight", "lineHeight", "lineHeightUnit",
    "letterSpacing", "letterSpacingUnit", "textAlignHorizontal", "textCase", "textDecoration", "textStyleName",
  ],
  children: ["children"],
  effects: ["effects", "effectStyleName"],
  opacity: ["opacity", "rotation"],
  blendMode: [],
  constraints: [],
  style: [],
  layoutMode: [
    "layoutMode", "layoutSizingHorizontal", "layoutSizingVertical",
    "primaryAxisAlignItems", "counterAxisAlignItems", "layoutWrap", "clipsContent", "layoutPositioning",
  ],
  padding: ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
  itemSpacing: ["itemSpacing", "counterAxisSpacing"],
  componentProperties: [
    "componentPropertyDefinitions", "variantProperties", "componentSetName", "componentProperties", "mainComponentName",
  ],
};

/** Structural properties always kept regardless of fields filter. */
const STRUCTURAL_PROPS = new Set(["id", "name", "type", "visible", "_childCount", "bindings", "svgString"]);

/**
 * Filter FigmaNodeData properties based on requested fields.
 * Used to strip properties before JSX conversion.
 * When fields is undefined, returns node unchanged (no filtering).
 */
export function filterNodeData<T extends Record<string, any>>(node: T, fields?: NodeField[]): T {
  if (!fields || !node) return node;

  // Build set of allowed properties
  const allowedProps = new Set<string>(STRUCTURAL_PROPS);
  for (const field of fields) {
    const props = FIELD_PROPERTY_MAP[field];
    if (props) {
      for (const p of props) allowedProps.add(p);
    }
  }

  const filtered: any = {};
  for (const key of Object.keys(node)) {
    if (!allowedProps.has(key)) continue;
    if (key === "children" && Array.isArray(node[key])) {
      filtered[key] = node[key].map((child: any) => filterNodeData(child, fields));
    } else {
      filtered[key] = node[key];
    }
  }
  return filtered as T;
}

/**
 * Process a Figma response node for logging purposes.
 * @param result - The result to process
 * @returns The original result without modifications
 */
export function processFigmaNodeResponse(result: unknown): any {
  if (!result || typeof result !== "object") {
    return result;
  }

  // Check if this looks like a node response
  const resultObj = result as Record<string, unknown>;
  if ("id" in resultObj && typeof resultObj.id === "string") {
    // It appears to be a node response, log the details
    console.info(`Processed Figma node: ${resultObj.name || "Unknown"} (ID: ${resultObj.id})`);

    if ("x" in resultObj && "y" in resultObj) {
      console.debug(`Node position: (${resultObj.x}, ${resultObj.y})`);
    }

    if ("width" in resultObj && "height" in resultObj) {
      console.debug(`Node dimensions: ${resultObj.width}×${resultObj.height}`);
    }
  }

  return result;
}
