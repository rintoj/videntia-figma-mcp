/**
 * Compact, low-token renderers for Figma node data.
 *
 * These exist because the default JSX/Tailwind rendering (see figma-to-jsx.ts)
 * is extremely verbose — agents frequently call get_node_info purely to read
 * coordinates, and pay thousands of tokens of className strings for it.
 */

type AnyNode = Record<string, any>;

/** Round to at most 2 decimals and drop trailing zeros. */
function num(v: unknown): string {
  if (typeof v !== "number" || !isFinite(v)) return "-";
  return String(Math.round(v * 100) / 100);
}

/** Number of children a node has, whether expanded or collapsed. */
export function childCount(node: AnyNode): number {
  if (Array.isArray(node?.children)) return node.children.length;
  if (typeof node?._childCount === "number") return node._childCount;
  return 0;
}

/** Geometry-only projection of a node. */
export function extractGeometry(node: AnyNode, includeChildren: boolean, depth: number): AnyNode {
  const geo: AnyNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation ?? 0,
  };
  if (node.absoluteBoundingBox) geo.absoluteBoundingBox = node.absoluteBoundingBox;
  for (const key of Object.keys(geo)) {
    if (geo[key] === undefined) delete geo[key];
  }
  const count = childCount(node);
  if (includeChildren && depth > 0 && Array.isArray(node.children)) {
    geo.children = node.children.map((c: AnyNode) => extractGeometry(c, true, depth - 1));
  } else if (count > 0) {
    geo.childCount = count;
  }
  // A PAGE has no geometry at all; without the child count and backgrounds the
  // projection would be an empty shell that looks like a valid answer.
  if (!hasGeometry(node)) {
    geo.childCount = count;
    if (Array.isArray(node.backgrounds)) geo.backgrounds = node.backgrounds;
  }
  return geo;
}

/**
 * Terse one-token rendering of a paint list.
 *
 * `#ffffff` for a solid, `IMAGE(FILL)` / `IMAGE(TILE×0.5)` for an image paint, `GRADIENT_LINEAR` for a
 * gradient, a variable name when the paint is bound, `none` for an explicitly empty
 * paint list, and `MIXED` when the serializer reported mixed paints. Returns
 * undefined when the node does not support paints at all (nothing to say).
 */
function imagePaintToken(p: AnyNode): string {
  const mode = p.scaleMode ?? "FILL";
  const scale = mode === "TILE" && typeof p.scalingFactor === "number" ? `×${num(p.scalingFactor)}` : "";
  const extras: string[] = [];
  if (typeof p.rotation === "number" && p.rotation !== 0) extras.push(`rot=${num(p.rotation)}`);
  if (p.filters && typeof p.filters === "object") extras.push("filters");
  return `IMAGE(${mode}${scale}${extras.length ? "," + extras.join(",") : ""})`;
}

function paintToken(paints: unknown, boundName: string | undefined): string | undefined {
  if (!Array.isArray(paints)) return undefined;
  if (paints.length === 0) return "none";
  if (paints.length === 1 && (paints[0] as AnyNode)?.type === "MIXED") return "MIXED";
  const visible = paints.filter((p: AnyNode) => p?.visible !== false);
  if (visible.length === 0) return "hidden";
  const p = visible[0] as AnyNode;
  const base = boundName ?? (p?.isImage || p?.type === "IMAGE" ? imagePaintToken(p) : (p?.color ?? p?.type ?? "?"));
  const extra = visible.length > 1 ? `+${visible.length - 1}` : "";
  return `${base}${extra}`;
}

/**
 * How many prototype reactions a node carries.
 *
 * The serializer may send the full `reactions` array or just a `_reactionCount`
 * when the node was rendered compactly.
 */
export function reactionCount(node: AnyNode): number {
  if (Array.isArray(node?.reactions)) return node.reactions.length;
  if (typeof node?._reactionCount === "number") return node._reactionCount;
  return 0;
}

/** Whether a node carries any Figma Motion keyframe track or animation style. */
export function hasMotion(node: AnyNode): boolean {
  if (node?._hasMotion === true) return true;
  if (Array.isArray(node?.animationStyles) && node.animationStyles.length > 0) return true;
  const tracks = node?.manualKeyframeTracks;
  return typeof tracks === "object" && tracks !== null && Object.keys(tracks).length > 0;
}

/** Short style descriptors for one node — the handful of properties agents actually read. */
function styleTokens(node: AnyNode): string[] {
  const parts: string[] = [];
  const bindings = node.bindings ?? {};
  const bindName = (k: string): string | undefined => {
    const b = bindings[k];
    if (!b) return undefined;
    return typeof b === "string" ? b : b.name;
  };

  if (node.layoutMode && node.layoutMode !== "NONE") {
    let l = `layout=${node.layoutMode}`;
    if (node.itemSpacing !== undefined) l += ` gap=${num(node.itemSpacing)}`;
    parts.push(l);
  }
  const fillToken = paintToken(node.fills, bindName("fills/0"));
  if (fillToken) parts.push(`fill=${fillToken}`);
  // Pages have `backgrounds`, never `fills` — reporting it is the difference between a
  // useful PAGE line and an empty shell.
  const bgToken = paintToken(node.backgrounds, bindName("backgrounds/0"));
  if (bgToken) parts.push(`background=${bgToken}`);
  const strokeToken = paintToken(node.strokes, bindName("strokes/0"));
  if (strokeToken) {
    parts.push(`stroke=${strokeToken}`);
    if (node.strokeWeight !== undefined) parts.push(`strokeWeight=${num(node.strokeWeight)}`);
  }
  if (node.cornerRadius !== undefined) parts.push(`radius=${bindName("topLeftRadius") ?? num(node.cornerRadius)}`);
  if (node.opacity !== undefined && node.opacity !== 1) parts.push(`opacity=${num(node.opacity)}`);
  if (node.textStyleName) parts.push(`textStyle=${node.textStyleName}`);
  else if (node.style?.fontSize !== undefined) {
    parts.push(`font=${num(node.style.fontSize)}/${node.style.fontWeight ?? "-"}`);
  }
  if (node.effectStyleName) parts.push(`effect=${node.effectStyleName}`);
  if (node.slotProperty) parts.push(`slot=${String(node.slotProperty).replace(/#[\d:]+$/, "")}`);
  // Interactions and motion are otherwise invisible to a read: an agent had to
  // already suspect they existed and call get_reactions / get_motion_info to
  // find out. One token each is enough to make them discoverable.
  if (reactionCount(node) > 0) parts.push(`reactions=${reactionCount(node)}`);
  if (hasMotion(node)) parts.push("motion=yes");
  if (Array.isArray(node.limitViolations) && node.limitViolations.length > 0) {
    parts.push(`violations=${node.limitViolations.join(",")}`);
  }
  return parts;
}

/** True when the node reports any positional geometry (PAGE and DOCUMENT do not). */
export function hasGeometry(node: AnyNode): boolean {
  return ["x", "y", "width", "height"].some((k) => typeof node?.[k] === "number" && isFinite(node[k]));
}

/**
 * One line per node: `name [TYPE] id x,y wxh · style tokens`.
 * Children are rendered indented beneath their parent.
 *
 * Nodes with no geometry (PAGE, DOCUMENT) render `children=N` in place of the
 * coordinates — an all-`-` geometry line reads like a valid but empty node, which is the
 * single worst thing a read can return.
 */
export function formatCompact(nodes: AnyNode[], indent = 0): string {
  const lines: string[] = [];
  for (const node of nodes ?? []) {
    if (!node) continue;
    const pad = "  ".repeat(indent);
    const geo = hasGeometry(node)
      ? `${num(node.x)},${num(node.y)} ${num(node.width)}x${num(node.height)}`
      : `children=${childCount(node)}`;
    const bits = styleTokens(node);
    if (node.rotation) bits.unshift(`rotation=${num(node.rotation)}`);
    if (typeof node.characters === "string") {
      const text = node.characters.length > 60 ? `${node.characters.slice(0, 60)}…` : node.characters;
      bits.push(`text=${JSON.stringify(text)}`);
    }
    const suffix = bits.length > 0 ? ` · ${bits.join(" ")}` : "";
    lines.push(`${pad}${node.name} [${node.type}] ${node.id} ${geo}${suffix}`);
    if (Array.isArray(node.children) && node.children.length > 0) {
      lines.push(formatCompact(node.children, indent + 1));
    }
  }
  return lines.filter(Boolean).join("\n");
}

/** One line per node, no recursion: name, type, child count, key styles. */
export function formatSummary(nodes: AnyNode[]): string {
  const lines: string[] = [];
  for (const node of nodes ?? []) {
    if (!node) continue;
    const bits = styleTokens(node);
    const suffix = bits.length > 0 ? ` · ${bits.join(" ")}` : "";
    lines.push(`${node.name} [${node.type}] ${node.id} children=${childCount(node)}${suffix}`);
  }
  return lines.join("\n");
}

/**
 * Stable, deterministic violation id derived from nodeId + rule + field.
 * Stable across runs so two lint reports can be diffed by id.
 * (FNV-1a 32-bit — no crypto dependency, adequate for a short diff key.)
 */
export function violationId(parts: Array<string | undefined>): string {
  const input = parts.map((p) => p ?? "").join(" ");
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `V-${hash.toString(16).padStart(8, "0")}`;
}
