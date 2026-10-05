/**
 * Renders the plugin's get_design_context payload as compact, code-ready text
 * in one of three dialects: css, tailwind, jsx. Tokens are shown inline as
 * `{name = value}` so the caller can map them to CSS variables / theme keys.
 */

export type DesignContextFormat = "css" | "tailwind" | "jsx";

export interface ContextNode {
  id: string;
  name: string;
  type: string;
  hidden?: boolean;
  size?: { width?: number; height?: number; widthToken?: string; heightToken?: string };
  opacity?: number;
  layout?: Record<string, unknown>;
  sizing?: { horizontal?: string; vertical?: string };
  position?: { absolute: boolean; x?: number; y?: number };
  radius?: unknown;
  fills?: string[];
  stroke?: { paints: string[]; weight: unknown; align?: string };
  effects?: string[];
  text?: string;
  typography?: Record<string, unknown>;
  tokens?: Record<string, string>;
  component?: Record<string, unknown>;
  css?: Record<string, string>;
  childCount?: number;
  children?: ContextNode[];
}

const px = (v: unknown) => (typeof v === "number" ? `${v}px` : String(v));

/** Split "12 {space/md = 12}" → value 12 and token "space/md". */
function splitToken(v: unknown): { value: string; token?: string } {
  const s = String(v);
  const m = s.match(/^(.*?)\s*\{([^=}]+?)(?:\s*=\s*[^}]*)?\}$/);
  return m ? { value: m[1], token: m[2].trim() } : { value: s };
}

const cssVar = (token: string) => `var(--${token.replace(/[^a-zA-Z0-9-_]+/g, "-").toLowerCase()})`;

function cssValue(v: unknown, unit = true): string {
  const { value, token } = splitToken(v);
  const raw = unit && /^-?\d+(\.\d+)?$/.test(value) ? `${value}px` : value;
  return token ? `${cssVar(token)} /* ${raw} */` : raw;
}

/** CSS declarations for one node, derived from the structured context. */
export function nodeToCssDecls(n: ContextNode): Array<[string, string]> {
  const d: Array<[string, string]> = [];
  const l = n.layout;
  if (l) {
    d.push(["display", String(l.display)]);
    if (l.flexDirection) d.push(["flex-direction", String(l.flexDirection)]);
    if (l.justifyContent && l.justifyContent !== "flex-start") d.push(["justify-content", String(l.justifyContent)]);
    if (l.alignItems && l.alignItems !== "flex-start") d.push(["align-items", String(l.alignItems)]);
    if (l.flexWrap) d.push(["flex-wrap", String(l.flexWrap)]);
    if (l.gap !== undefined) d.push(["gap", cssValue(l.gap)]);
    if (Array.isArray(l.padding)) d.push(["padding", l.padding.map((p) => cssValue(p)).join(" ")]);
  }
  if (n.size) {
    const h = n.sizing?.horizontal;
    const v = n.sizing?.vertical;
    if (h === "FILL") d.push(["flex", "1 1 0"]);
    else if (h !== "HUG")
      d.push(["width", n.size.widthToken ? cssValue(`${n.size.width} {${n.size.widthToken}}`) : px(n.size.width)]);
    if (v === "FILL") d.push(["align-self", "stretch"]);
    else if (v !== "HUG")
      d.push(["height", n.size.heightToken ? cssValue(`${n.size.height} {${n.size.heightToken}}`) : px(n.size.height)]);
  }
  if (n.position?.absolute) {
    d.push(["position", "absolute"], ["left", px(n.position.x)], ["top", px(n.position.y)]);
  }
  if (n.radius !== undefined)
    d.push(["border-radius", Array.isArray(n.radius) ? n.radius.map(px).join(" ") : cssValue(n.radius)]);
  if (n.fills?.length) d.push(["background", n.fills.map((f) => cssValue(f, false)).join(", ")]);
  if (n.stroke) d.push(["border", `${px(n.stroke.weight)} solid ${cssValue(n.stroke.paints[0], false)}`]);
  if (n.effects?.length) {
    const shadows = n.effects.filter((e) => !/^(layer_blur|background_blur)/.test(e));
    if (shadows.length) d.push(["box-shadow", shadows.join(", ")]);
    const blur = n.effects.find((e) => e.startsWith("layer_blur"));
    if (blur) d.push(["filter", blur.replace("layer_blur", "blur")]);
    const bblur = n.effects.find((e) => e.startsWith("background_blur"));
    if (bblur) d.push(["backdrop-filter", bblur.replace("background_blur", "blur")]);
  }
  if (n.opacity !== undefined) d.push(["opacity", String(n.opacity)]);
  const t = n.typography;
  if (t) {
    if (t.fontFamily)
      d.push([
        "font-family",
        t.fontFamilyToken ? cssValue(`${t.fontFamily} {${t.fontFamilyToken}}`, false) : `"${t.fontFamily}"`,
      ]);
    if (t.fontSize !== undefined)
      d.push(["font-size", t.fontSizeToken ? cssValue(`${t.fontSize} {${t.fontSizeToken}}`) : px(t.fontSize)]);
    if (t.fontWeight !== undefined) d.push(["font-weight", String(t.fontWeight)]);
    if (t.lineHeight !== undefined)
      d.push(["line-height", typeof t.lineHeight === "number" ? px(t.lineHeight) : String(t.lineHeight)]);
    if (t.letterSpacing !== undefined)
      d.push(["letter-spacing", typeof t.letterSpacing === "number" ? px(t.letterSpacing) : String(t.letterSpacing)]);
    if (t.textAlign) d.push(["text-align", String(t.textAlign)]);
    if (t.textCase === "UPPER") d.push(["text-transform", "uppercase"]);
    if (t.textCase === "LOWER") d.push(["text-transform", "lowercase"]);
    if (t.color) d.push(["color", cssValue(Array.isArray(t.color) ? t.color[0] : t.color, false)]);
  }
  return d;
}

const TW_ALIGN: Record<string, string> = {
  "flex-start": "start",
  center: "center",
  "flex-end": "end",
  "space-between": "between",
  baseline: "baseline",
};

function twArbitrary(prefix: string, v: unknown, unit = true): string {
  const { value, token } = splitToken(v);
  if (token) return `${prefix}-[${cssVar(token)}]`;
  const raw = unit && /^-?\d+(\.\d+)?$/.test(value) ? `${value}px` : value;
  return `${prefix}-[${raw.replace(/\s+/g, "_")}]`;
}

/** Tailwind classes for one node (arbitrary values; tokens become CSS variables). */
export function nodeToTailwind(n: ContextNode): string[] {
  const c: string[] = [];
  const l = n.layout;
  if (l) {
    c.push(l.display === "grid" ? "grid" : "flex");
    if (l.flexDirection === "column") c.push("flex-col");
    if (l.justifyContent && l.justifyContent !== "flex-start")
      c.push(`justify-${TW_ALIGN[String(l.justifyContent)] ?? l.justifyContent}`);
    if (l.alignItems && l.alignItems !== "flex-start")
      c.push(`items-${TW_ALIGN[String(l.alignItems)] ?? l.alignItems}`);
    if (l.flexWrap) c.push("flex-wrap");
    if (l.gap !== undefined) c.push(twArbitrary("gap", l.gap));
    if (Array.isArray(l.padding)) {
      const [t, r, b, lf] = l.padding;
      if (t === b && r === lf && t === r) c.push(twArbitrary("p", t));
      else if (t === b && r === lf) c.push(twArbitrary("py", t), twArbitrary("px", r));
      else c.push(twArbitrary("pt", t), twArbitrary("pr", r), twArbitrary("pb", b), twArbitrary("pl", lf));
    }
  }
  if (n.size) {
    if (n.sizing?.horizontal === "FILL") c.push("flex-1");
    else if (n.sizing?.horizontal !== "HUG")
      c.push(twArbitrary("w", n.size.widthToken ? `${n.size.width} {${n.size.widthToken}}` : n.size.width));
    if (n.sizing?.vertical === "FILL") c.push("self-stretch");
    else if (n.sizing?.vertical !== "HUG")
      c.push(twArbitrary("h", n.size.heightToken ? `${n.size.height} {${n.size.heightToken}}` : n.size.height));
  }
  if (n.position?.absolute) c.push("absolute", twArbitrary("left", n.position.x), twArbitrary("top", n.position.y));
  if (n.radius !== undefined)
    c.push(Array.isArray(n.radius) ? `rounded-[${n.radius.map(px).join("_")}]` : twArbitrary("rounded", n.radius));
  if (n.fills?.length) c.push(twArbitrary("bg", n.fills[0], false));
  if (n.stroke) c.push(twArbitrary("border", n.stroke.weight), twArbitrary("border", n.stroke.paints[0], false));
  if (n.effects?.length)
    c.push(
      `shadow-[${n.effects
        .filter((e) => !e.includes("blur("))
        .join(",")
        .replace(/\s+/g, "_")}]`,
    );
  if (n.opacity !== undefined) c.push(`opacity-[${n.opacity}]`);
  const t = n.typography;
  if (t) {
    if (t.fontFamily) c.push(`font-['${String(t.fontFamily).replace(/\s+/g, "_")}']`);
    if (t.fontSize !== undefined)
      c.push(twArbitrary("text", t.fontSizeToken ? `${t.fontSize} {${t.fontSizeToken}}` : t.fontSize));
    if (t.fontWeight !== undefined) c.push(`font-[${t.fontWeight}]`);
    if (t.lineHeight !== undefined) c.push(twArbitrary("leading", t.lineHeight));
    if (t.letterSpacing !== undefined) c.push(twArbitrary("tracking", t.letterSpacing));
    if (t.textAlign) c.push(`text-${t.textAlign === "justified" ? "justify" : t.textAlign}`);
    if (t.textCase === "UPPER") c.push("uppercase");
    if (t.color) c.push(twArbitrary("text", Array.isArray(t.color) ? t.color[0] : t.color, false));
  }
  return c.filter((x) => !x.includes("[undefined") && !x.includes("[mixed"));
}

function headerComment(n: ContextNode): string[] {
  const out: string[] = [];
  const comp = n.component;
  if (comp?.kind === "instance") {
    const props = Object.entries((comp.props as Record<string, unknown>) ?? {})
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ");
    out.push(
      `instance of ${comp.componentSet ? `${comp.componentSet} / ` : ""}${comp.mainComponent}${comp.remote ? " (library)" : ""}${props ? ` | ${props}` : ""}`,
    );
  } else if (comp) {
    out.push(`${comp.kind}${comp.variant ? ` ${JSON.stringify(comp.variant)}` : ""}`);
  }
  if (n.tokens)
    out.push(
      `tokens: ${Object.entries(n.tokens)
        .map(([k, v]) => `${k} → ${v}`)
        .join("; ")}`,
    );
  if (n.childCount) out.push(`${n.childCount} children not expanded (raise depth)`);
  return out;
}

const tagFor = (n: ContextNode) => (n.type === "TEXT" ? "span" : n.component?.kind === "instance" ? "Instance" : "div");

function renderJsx(n: ContextNode, indent: string, out: string[]): void {
  for (const h of headerComment(n)) out.push(`${indent}{/* ${h} */}`);
  const tag = tagFor(n);
  const style = nodeToCssDecls(n)
    .map(
      ([k, v]) =>
        `${k.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())}: ${JSON.stringify(v.replace(/ \/\*.*\*\//, ""))}`,
    )
    .join(", ");
  const attrs = `data-fig-id="${n.id}" data-name=${JSON.stringify(n.name)}${style ? ` style={{ ${style} }}` : ""}`;
  if (n.text !== undefined) {
    out.push(`${indent}<${tag} ${attrs}>${n.text.replace(/[{}<>]/g, (ch) => `{"${ch}"}`)}</${tag}>`);
  } else if (n.children?.length) {
    out.push(`${indent}<${tag} ${attrs}>`);
    for (const c of n.children) renderJsx(c, indent + "  ", out);
    out.push(`${indent}</${tag}>`);
  } else out.push(`${indent}<${tag} ${attrs} />`);
}

function renderCss(n: ContextNode, out: string[]): void {
  for (const h of headerComment(n)) out.push(`/* ${h} */`);
  const decls = nodeToCssDecls(n);
  out.push(`/* ${n.name} (${n.type} ${n.id})${n.text !== undefined ? ` "${n.text.slice(0, 60)}"` : ""} */`);
  out.push(`[data-fig-id="${n.id}"] {`);
  for (const [k, v] of decls) out.push(`  ${k}: ${v};`);
  out.push("}");
  for (const c of n.children ?? []) renderCss(c, out);
}

function renderTailwind(n: ContextNode, indent: string, out: string[]): void {
  for (const h of headerComment(n)) out.push(`${indent}{/* ${h} */}`);
  const tag = tagFor(n);
  const cls = nodeToTailwind(n).join(" ");
  const attrs = `data-fig-id="${n.id}"${cls ? ` className="${cls}"` : ""}`;
  if (n.text !== undefined)
    out.push(`${indent}<${tag} ${attrs}>${n.text.replace(/[{}<>]/g, (ch) => `{"${ch}"}`)}</${tag}>`);
  else if (n.children?.length) {
    out.push(`${indent}<${tag} ${attrs}>`);
    for (const c of n.children) renderTailwind(c, indent + "  ", out);
    out.push(`${indent}</${tag}>`);
  } else out.push(`${indent}<${tag} ${attrs} />`);
}

export interface DesignContextPayload {
  nodeId: string;
  nodeName: string;
  nodesVisited: number;
  truncated: boolean;
  depthTruncated?: boolean;
  maxDepth?: number;
  maxNodes?: number;
  cssUnavailable?: number;
  root?: ContextNode;
}

/** Collect each node's getCSSAsync result where it adds properties we did not derive. */
function figmaCssSupplement(n: ContextNode, out: string[]): void {
  if (n.css) {
    const ours = new Set(nodeToCssDecls(n).map(([k]) => k));
    const extra = Object.entries(n.css).filter(([k]) => !ours.has(k));
    if (extra.length) out.push(`${n.id}: ${extra.map(([k, v]) => `${k}: ${v}`).join("; ")}`);
  }
  for (const c of n.children ?? []) figmaCssSupplement(c, out);
}

export function formatDesignContext(p: DesignContextPayload, format: DesignContextFormat = "jsx"): string {
  const lines: string[] = [];
  lines.push(`# Design context: ${p.nodeName} (${p.nodeId})`);
  lines.push(
    `nodes=${p.nodesVisited} depth=${p.maxDepth ?? "?"} truncated=${p.truncated}${p.depthTruncated ? " depthTruncated=true" : ""}${p.cssUnavailable ? ` cssUnavailable=${p.cssUnavailable}` : ""}`,
  );
  if (p.truncated)
    lines.push(`WARNING: node cap (${p.maxNodes}) reached, output is partial. Narrow nodeId or raise maxNodes.`);
  lines.push(
    "Tokens appear as var(--token) with the resolved value; `{/* … */}` lines carry component and extra-token info.",
  );
  lines.push("");
  if (!p.root) return lines.join("\n");
  const body: string[] = [];
  if (format === "css") renderCss(p.root, body);
  else if (format === "tailwind") renderTailwind(p.root, "", body);
  else renderJsx(p.root, "", body);
  lines.push("```" + (format === "css" ? "css" : "tsx"), ...body, "```");
  const supp: string[] = [];
  figmaCssSupplement(p.root, supp);
  if (supp.length) {
    lines.push("", "## Extra properties from Figma getCSSAsync", ...supp);
  }
  return lines.join("\n");
}

// ── get_variables_used ─────────────────────────────────────────────────────

export interface VariablesUsedPayload {
  nodeId: string;
  nodeName: string;
  nodesVisited: number;
  truncated: boolean;
  maxNodes?: number;
  variables: Array<{
    id: string;
    name: string | null;
    collection: string | null;
    type: string | null;
    valuesByMode: Record<string, string>;
    missing?: boolean;
    usageCount: number;
    fields: string[];
    exampleNodeIds: string[];
  }>;
  styles: Array<{
    id: string;
    kind: string;
    name: string | null;
    remote?: boolean | null;
    missing?: boolean;
    usageCount: number;
    exampleNodeIds: string[];
  }>;
}

export function formatVariablesUsed(p: VariablesUsedPayload): string {
  const lines: string[] = [];
  lines.push(`# Variables used: ${p.nodeName} (${p.nodeId})`);
  lines.push(
    `nodes=${p.nodesVisited} truncated=${p.truncated} variables=${p.variables.length} styles=${p.styles.length}`,
  );
  if (p.truncated)
    lines.push(`WARNING: node cap (${p.maxNodes}) reached, counts are partial. Raise maxNodes for a full sweep.`);
  lines.push("", "## Variables");
  if (!p.variables.length) lines.push("None.");
  else {
    lines.push("| Collection | Name | Type | Values by mode | Uses | Fields | Example nodes |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const v of p.variables) {
      const vals = Object.entries(v.valuesByMode)
        .map(([m, x]) => `${m}: ${x}`)
        .join("; ");
      lines.push(
        `| ${v.collection ?? "?"} | ${v.missing ? `(missing ${v.id})` : v.name} | ${v.type ?? "?"} | ${vals || "-"} | ${v.usageCount} | ${v.fields.join(", ")} | ${v.exampleNodeIds.join(", ")} |`,
      );
    }
  }
  lines.push("", "## Styles");
  if (!p.styles.length) lines.push("None.");
  else {
    lines.push("| Kind | Name | Uses | Example nodes |");
    lines.push("|---|---|---|---|");
    for (const s of p.styles)
      lines.push(
        `| ${s.kind} | ${s.missing ? `(missing ${s.id})` : `${s.name}${s.remote ? " (library)" : ""}`} | ${s.usageCount} | ${s.exampleNodeIds.join(", ")} |`,
      );
  }
  return lines.join("\n");
}
