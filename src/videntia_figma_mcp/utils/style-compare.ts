export interface StyleDeviation {
  property: string;
  figma: string;
  actual: string;
}

export const COMPARABLE_STYLE_PROPERTIES = [
  "fontSize",
  "fontFamily",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "color",
  "backgroundColor",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "width",
  "height",
  "borderRadius",
  "borderWidth",
  "borderColor",
  "opacity",
] as const;

export function compareStyles(
  figmaStyles: Record<string, string>,
  computedStyles: Record<string, string>,
): StyleDeviation[] {
  const deviations: StyleDeviation[] = [];
  for (const [property, figmaValue] of Object.entries(figmaStyles)) {
    const actualValue = computedStyles[property];
    if (actualValue !== undefined && normalizeValue(actualValue) !== normalizeValue(figmaValue)) {
      deviations.push({ property, figma: figmaValue, actual: actualValue });
    }
  }
  return deviations;
}

export function figmaNodeToStyles(node: Record<string, unknown>): Record<string, string> {
  const styles: Record<string, string> = {};
  if (node.fontSize) styles.fontSize = `${node.fontSize}px`;
  if (node.fontName && typeof node.fontName === "object") {
    const fn = node.fontName as { family?: string; style?: string };
    if (fn.family) styles.fontFamily = fn.family;
    if (fn.style) styles.fontWeight = fontStyleToWeight(fn.style);
  }
  if (node.lineHeight && typeof node.lineHeight === "object") {
    const lh = node.lineHeight as { value?: number; unit?: string };
    if (lh.unit === "PIXELS" && lh.value) styles.lineHeight = `${lh.value}px`;
    if (lh.unit === "PERCENT" && lh.value) styles.lineHeight = `${lh.value}%`;
  }
  if (node.width) styles.width = `${node.width}px`;
  if (node.height) styles.height = `${node.height}px`;
  if (node.cornerRadius) styles.borderRadius = `${node.cornerRadius}px`;
  if (node.opacity !== undefined) styles.opacity = String(node.opacity);
  return styles;
}

function fontStyleToWeight(style: string): string {
  const map: Record<string, string> = {
    Thin: "100",
    ExtraLight: "200",
    Light: "300",
    Regular: "400",
    Medium: "500",
    SemiBold: "600",
    Bold: "700",
    ExtraBold: "800",
    Black: "900",
  };
  return map[style] ?? "400";
}

function normalizeValue(val: string): string {
  return val.trim().toLowerCase().replace(/\s+/g, " ");
}
