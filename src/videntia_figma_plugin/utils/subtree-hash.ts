/**
 * Cheap, stable version hash of a node subtree.
 *
 * Used by `export_node_as_image` so the MCP server can tell whether a node has
 * changed since the last render and skip re-inlining an identical image. The
 * hash must change whenever anything *visible* changes (structure, geometry,
 * fills/strokes/effects, text) and stay stable otherwise.
 *
 * Deliberately conservative: anything the walker cannot read, or a subtree
 * bigger than NODE_BUDGET, yields `null` so the server treats it as a cache
 * MISS. A false miss costs one re-render; a false hit silently shows a stale
 * design, which is far worse.
 */

const NODE_BUDGET = 4000;

/** FNV-1a 32-bit, returned as 8 hex chars. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return ("00000000" + hash.toString(16)).slice(-8);
}

function num(value: unknown): string {
  return typeof value === "number" && isFinite(value) ? Math.round(value * 100) / 100 + "" : "";
}

function field(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (value === undefined) return "";
  return key + ":" + (typeof value === "number" ? num(value) : JSON.stringify(value)) + ";";
}

/**
 * Field-by-field signature of a paint list. Reads every visible property by name
 * (so it does not depend on the paint object's fields being enumerable) — in
 * particular the whole IMAGE identity: imageHash, scaleMode, scalingFactor,
 * imageTransform, rotation and filters.
 */
export function paintsSignature(paints: unknown): string {
  if (!Array.isArray(paints)) return "";
  const out: string[] = [];
  for (const raw of paints) {
    const p = (raw ?? {}) as Record<string, unknown>;
    let sig = "[" + String(p.type) + ";";
    for (const key of [
      "visible",
      "opacity",
      "blendMode",
      "color",
      "gradientStops",
      "gradientTransform",
      "imageHash",
      "scaleMode",
      "scalingFactor",
      "imageTransform",
      "rotation",
      "filters",
      "videoHash",
      "boundVariables",
    ]) {
      sig += field(p, key);
    }
    out.push(sig + "]");
  }
  return out.join("");
}

function serializeNode(node: BaseNode, parts: string[]): void {
  const anyNode = node as unknown as Record<string, unknown>;
  parts.push(node.id, node.type, String(anyNode.name ?? ""));

  // Geometry / layout
  const geometryKeys = [
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "opacity",
    "visible",
    "blendMode",
    "cornerRadius",
    "layoutMode",
    "primaryAxisAlignItems",
    "counterAxisAlignItems",
    "primaryAxisSizingMode",
    "counterAxisSizingMode",
    "itemSpacing",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "clipsContent",
    "topLeftRadius",
    "topRightRadius",
    "bottomLeftRadius",
    "bottomRightRadius",
    "cornerSmoothing",
    "layoutWrap",
    "layoutPositioning",
    "layoutSizingHorizontal",
    "layoutSizingVertical",
    "counterAxisSpacing",
    "isMask",
    "strokeTopWeight",
    "strokeRightWeight",
    "strokeBottomWeight",
    "strokeLeftWeight",
    "strokeCap",
    "strokeJoin",
    "pointCount",
    "innerRadius",
  ];
  for (const key of geometryKeys) {
    const value = anyNode[key];
    if (value === undefined) continue;
    parts.push(key + "=" + (typeof value === "number" ? num(value) : String(value)));
  }

  // Paints: an explicit, field-by-field signature (so image identity — imageHash,
  // scaleMode, scalingFactor, imageTransform, rotation, filters — is covered even if a
  // paint's fields are not enumerable) PLUS the raw JSON for anything not named here.
  // `backgrounds` is only read on pages — on frames it is a deprecated mirror of fills.
  for (const key of node.type === "PAGE" ? ["backgrounds"] : ["fills", "strokes"]) {
    const value = anyNode[key];
    if (value === undefined) continue;
    if (value === figma.mixed) {
      parts.push(key + "=mixed");
      continue;
    }
    parts.push(key + "=" + paintsSignature(value) + JSON.stringify(value));
  }
  const otherKeys = ["effects", "strokeWeight", "strokeAlign", "dashPattern", "arcData", "vectorPaths"];
  for (const key of otherKeys) {
    const value = anyNode[key];
    if (value === undefined || value === figma.mixed) continue;
    parts.push(key + "=" + JSON.stringify(value));
  }

  // Text content and typography
  if (node.type === "TEXT") {
    const text = node as TextNode;
    parts.push("chars=" + text.characters);
    parts.push("fontSize=" + String(text.fontSize as unknown));
    parts.push("fontName=" + JSON.stringify(text.fontName as unknown));
    parts.push("lineHeight=" + JSON.stringify(text.lineHeight as unknown));
    parts.push("letterSpacing=" + JSON.stringify(text.letterSpacing as unknown));
    parts.push("textAlignHorizontal=" + text.textAlignHorizontal);
    parts.push("textCase=" + String(text.textCase as unknown));
    parts.push("textDecoration=" + String(text.textDecoration as unknown));
    parts.push("textAlignVertical=" + text.textAlignVertical);
    parts.push("textAutoResize=" + text.textAutoResize);
    parts.push("paragraphSpacing=" + String(text.paragraphSpacing as unknown));
    // Mixed styling hides per-range changes behind figma.mixed — hash the segments.
    const anyMixed = [text.fontSize, text.fontName, text.fills, text.lineHeight, text.letterSpacing].some(
      (v) => v === figma.mixed,
    );
    if (anyMixed && typeof text.getStyledTextSegments === "function") {
      const segments = text.getStyledTextSegments(["fontSize", "fontName", "fills", "lineHeight", "letterSpacing"]);
      for (const seg of segments) {
        parts.push(
          "seg=" +
            seg.start +
            "-" +
            seg.end +
            ":" +
            String(seg.fontSize) +
            JSON.stringify(seg.fontName) +
            paintsSignature(seg.fills) +
            JSON.stringify(seg.lineHeight) +
            JSON.stringify(seg.letterSpacing),
        );
      }
    }
  }

  // Instances: the main component's version matters even if the instance
  // itself looks unchanged.
  const componentId = anyNode.mainComponentId;
  if (typeof componentId === "string") parts.push("main=" + componentId);
}

/**
 * Compute a subtree version hash, or `null` when it cannot be computed
 * (oversized subtree, or any error while walking).
 */
export function computeSubtreeHash(root: BaseNode): string | null {
  try {
    const parts: string[] = [];
    let visited = 0;
    const stack: BaseNode[] = [root];

    while (stack.length > 0) {
      const node = stack.pop() as BaseNode;
      visited++;
      if (visited > NODE_BUDGET) return null;

      serializeNode(node, parts);

      const children = (node as unknown as { children?: readonly BaseNode[] }).children;
      if (children && children.length) {
        parts.push("children=" + children.length);
        // Push in reverse so the pop order matches document order — the hash
        // must be order-sensitive (reordering siblings changes the render).
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
      }
      parts.push("|");
    }

    return fnv1a(parts.join(""));
  } catch {
    return null;
  }
}
