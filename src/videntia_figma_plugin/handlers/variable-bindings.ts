/**
 * Variable bindings for node fields, paints (solid colors and gradient stops), effects,
 * text styles and effect styles. Backs bind_variable / unbind_variable and the optional
 * per-effect and per-stop variable params of set_effects, the effect style tools and
 * set_gradient_fill.
 */

const EFFECT_FIELDS: VariableBindableEffectField[] = ["color", "radius", "spread", "offsetX", "offsetY"];

const NODE_FIELDS: string[] = [
  "height",
  "width",
  "characters",
  "itemSpacing",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "paddingBottom",
  "visible",
  "cornerRadius",
  "topLeftRadius",
  "topRightRadius",
  "bottomLeftRadius",
  "bottomRightRadius",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "counterAxisSpacing",
  "strokeWeight",
  "strokeTopWeight",
  "strokeRightWeight",
  "strokeBottomWeight",
  "strokeLeftWeight",
  "opacity",
  "gridRowGap",
  "gridColumnGap",
];

const TEXT_FIELDS: string[] = [
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "paragraphSpacing",
  "paragraphIndent",
];

export const SUPPORTED_BIND_FIELDS =
  "Supported fields: fills/N/color and strokes/N/color (SOLID paints); fills/N/gradientStops/M/color and strokes/N/gradientStops/M/color (gradient paints); effects/N/color|radius|spread|offsetX|offsetY (on a node or an effect style); node fields " +
  NODE_FIELDS.join(", ") +
  "; text fields " +
  TEXT_FIELDS.join(", ") +
  " (on a text node or a text style).";

/** Per-effect variable params accepted by set_effects, create_effect_style and update_effect_style. */
export const EFFECT_VARIABLE_PARAMS: Array<[string, VariableBindableEffectField]> = [
  ["colorVariable", "color"],
  ["radiusVariable", "radius"],
  ["spreadVariable", "spread"],
  ["offsetXVariable", "offsetX"],
  ["offsetYVariable", "offsetY"],
];

export type PaintProp = "fills" | "strokes";

export type ParsedBindField =
  | { kind: "paint"; prop: PaintProp; index: number }
  | { kind: "gradientStop"; prop: PaintProp; index: number; stopIndex: number }
  | { kind: "effect"; index: number; field: VariableBindableEffectField }
  | { kind: "node"; field: string };

export interface VariableLookupCache {
  local?: Variable[];
}

function parseIndex(raw: string | undefined, label: string, field: string): number {
  if (raw === undefined) return 0;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid ${label} index "${raw}" in field "${field}". ${SUPPORTED_BIND_FIELDS}`);
  }
  return parseInt(raw, 10);
}

export function parseBindField(field: string): ParsedBindField {
  const parts = field.split("/");
  const head = parts[0];

  if (head === "fills" || head === "strokes") {
    const index = parseIndex(parts[1], head === "fills" ? "fill" : "stroke", field);
    if (parts.length <= 2 || (parts.length === 3 && parts[2] === "color")) {
      return { kind: "paint", prop: head, index };
    }
    if (parts.length === 5 && parts[2] === "gradientStops" && parts[4] === "color") {
      return { kind: "gradientStop", prop: head, index, stopIndex: parseIndex(parts[3], "gradient stop", field) };
    }
    throw new Error(`Unsupported field "${field}". ${SUPPORTED_BIND_FIELDS}`);
  }

  if (head === "effects") {
    const effectField = parts[2] as VariableBindableEffectField;
    if (parts.length !== 3 || EFFECT_FIELDS.indexOf(effectField) === -1) {
      throw new Error(
        `Unsupported effect field "${field}". Use effects/N/<field> where <field> is one of ${EFFECT_FIELDS.join(", ")}.`,
      );
    }
    return { kind: "effect", index: parseIndex(parts[1], "effect", field), field: effectField };
  }

  if (parts.length === 1 && (NODE_FIELDS.indexOf(head) !== -1 || TEXT_FIELDS.indexOf(head) !== -1)) {
    return { kind: "node", field: head };
  }

  throw new Error(`Unsupported field "${field}". ${SUPPORTED_BIND_FIELDS}`);
}

/** Resolve a variable by id, then exact name, then dash-to-slash normalized name. */
export async function resolveVariableByIdOrName(idOrName: string, cache?: VariableLookupCache): Promise<Variable> {
  const byId = await figma.variables.getVariableByIdAsync(idOrName);
  if (byId) return byId;
  const store = cache !== undefined ? cache : {};
  if (store.local === undefined) store.local = await figma.variables.getLocalVariablesAsync();
  const local = store.local;
  const normalized = idOrName.replace(/-/g, "/");
  const match =
    local.find(function (v) {
      return v.name === idOrName;
    }) ||
    (normalized !== idOrName
      ? local.find(function (v) {
          return v.name === normalized;
        })
      : undefined);
  if (!match) {
    throw new Error(`Variable not found: "${idOrName}". Pass a variable ID or name (e.g. "background/primary").`);
  }
  return match;
}

/** Find a local text or effect style by id, exact name, or dash-to-slash normalized name. */
export async function findLocalStyle(idOrName: string, type: "TEXT"): Promise<TextStyle | null>;
export async function findLocalStyle(idOrName: string, type: "EFFECT"): Promise<EffectStyle | null>;
export async function findLocalStyle(
  idOrName: string,
  type: "TEXT" | "EFFECT",
): Promise<TextStyle | EffectStyle | null> {
  const byId = await figma.getStyleByIdAsync(idOrName);
  if (byId && byId.type === type) return byId as TextStyle | EffectStyle;
  const styles: Array<TextStyle | EffectStyle> =
    type === "TEXT" ? await figma.getLocalTextStylesAsync() : await figma.getLocalEffectStylesAsync();
  const normalized = idOrName.replace(/-/g, "/");
  return (
    styles.find(function (s) {
      return s.name === idOrName;
    }) ||
    (normalized !== idOrName
      ? styles.find(function (s) {
          return s.name === normalized;
        })
      : undefined) ||
    null
  );
}

function isGradientPaint(paint: Paint): paint is GradientPaint {
  return paint.type.indexOf("GRADIENT_") === 0;
}

function assertVariableType(variable: Variable, expected: VariableResolvedDataType, target: string): void {
  if (variable.resolvedType !== expected) {
    throw new Error(`${target} needs a ${expected} variable, but "${variable.name}" is ${variable.resolvedType}.`);
  }
}

function readPaints(node: BaseNode, prop: PaintProp): Paint[] {
  if (!(prop in node)) {
    throw new Error(`Node "${node.name}" (${node.type}) does not support ${prop}.`);
  }
  const current = (node as unknown as Record<PaintProp, ReadonlyArray<Paint> | PluginAPI["mixed"]>)[prop];
  return current !== figma.mixed && Array.isArray(current) ? (current as ReadonlyArray<Paint>).slice() : [];
}

function writePaints(node: BaseNode, prop: PaintProp, paints: Paint[]): void {
  (node as unknown as Record<PaintProp, Paint[]>)[prop] = paints;
}

function gradientHint(prop: PaintProp, index: number, paint: GradientPaint): string {
  const last = paint.gradientStops.length - 1;
  return `${prop}/${index} is a ${paint.type} paint, which has no single color. Bind each stop with "${prop}/${index}/gradientStops/M/color" (M = 0..${last}).`;
}

/** Bind (or, with null, unbind) the color of a SOLID paint. */
export function bindPaintColor(node: BaseNode, prop: PaintProp, index: number, variable: Variable | null): void {
  const paints = readPaints(node, prop);
  if (variable === null) {
    const entry = paints[index];
    if (!entry) return;
    if (isGradientPaint(entry)) throw new Error(gradientHint(prop, index, entry));
    if (!(entry as SolidPaint).boundVariables) return;
    const unbound = Object.assign({}, entry) as unknown as Record<string, unknown>;
    delete unbound["boundVariables"];
    paints[index] = unbound as unknown as Paint;
    writePaints(node, prop, paints);
    return;
  }

  while (paints.length <= index) {
    paints.push({ type: "SOLID", color: { r: 0, g: 0, b: 0 } } as SolidPaint);
  }
  const paint = paints[index];
  if (isGradientPaint(paint)) throw new Error(gradientHint(prop, index, paint));
  if (paint.type !== "SOLID") {
    throw new Error(`${prop}/${index} is a ${paint.type} paint; only SOLID paints have a bindable color.`);
  }
  assertVariableType(variable, "COLOR", `${prop}/${index}/color`);
  paints[index] = figma.variables.setBoundVariableForPaint(paint, "color", variable);
  writePaints(node, prop, paints);
}

function stopWithBinding(stop: ColorStop, variable: Variable | null): ColorStop {
  const copy = Object.assign({}, stop) as unknown as Record<string, unknown>;
  const bound = Object.assign({}, stop.boundVariables || {}) as Record<string, VariableAlias>;
  if (variable) {
    bound["color"] = figma.variables.createVariableAlias(variable);
  } else {
    delete bound["color"];
  }
  if (Object.keys(bound).length > 0) copy["boundVariables"] = bound;
  else delete copy["boundVariables"];
  return copy as unknown as ColorStop;
}

/** Return a copy of a gradient's stops with stop `stopIndex` bound (or unbound with null). */
export function bindGradientStops(
  stops: ReadonlyArray<ColorStop>,
  stopIndex: number,
  variable: Variable | null,
  target: string,
): ColorStop[] {
  if (stopIndex >= stops.length) {
    throw new Error(
      `${target}: gradient stop ${stopIndex} does not exist (the gradient has ${stops.length} stops, 0..${stops.length - 1}).`,
    );
  }
  if (variable) assertVariableType(variable, "COLOR", target);
  return stops.map(function (stop, i) {
    return i === stopIndex ? stopWithBinding(stop, variable) : stop;
  });
}

/** Bind (or, with null, unbind) the color of one stop of a gradient paint. */
export function bindGradientStopColor(
  node: BaseNode,
  prop: PaintProp,
  index: number,
  stopIndex: number,
  variable: Variable | null,
): void {
  const paints = readPaints(node, prop);
  const paint = paints[index];
  const target = `${prop}/${index}/gradientStops/${stopIndex}/color`;
  if (!paint) {
    throw new Error(`${target}: ${prop}/${index} does not exist on "${node.name}" (it has ${paints.length} ${prop}).`);
  }
  if (!isGradientPaint(paint)) {
    throw new Error(
      `${target}: ${prop}/${index} is a ${paint.type} paint, not a gradient. Use "${prop}/${index}/color" for SOLID paints.`,
    );
  }
  const gradientStops = bindGradientStops(paint.gradientStops, stopIndex, variable, target);
  paints[index] = Object.assign({}, paint, { gradientStops }) as GradientPaint;
  writePaints(node, prop, paints);
}

function assertEffectFieldBindable(effect: Effect, field: VariableBindableEffectField, target: string): void {
  if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") return;
  if ((effect.type === "LAYER_BLUR" || effect.type === "BACKGROUND_BLUR") && field === "radius") return;
  const allowed = effect.type === "LAYER_BLUR" || effect.type === "BACKGROUND_BLUR" ? "radius" : "none";
  throw new Error(
    `${target}: "${field}" cannot be bound on a ${effect.type} effect. Bindable fields: DROP_SHADOW/INNER_SHADOW ${EFFECT_FIELDS.join(", ")}; LAYER_BLUR/BACKGROUND_BLUR radius; ${effect.type} ${allowed}.`,
  );
}

/** Bind (or unbind with null) one field on a single effect, returning the new effect. */
export function bindEffect(
  effect: Effect,
  field: VariableBindableEffectField,
  variable: Variable | null,
  target: string,
): Effect {
  assertEffectFieldBindable(effect, field, target);
  if (variable) assertVariableType(variable, field === "color" ? "COLOR" : "FLOAT", target);
  return figma.variables.setBoundVariableForEffect(effect, field, variable);
}

/** Return a copy of `effects` with effects[index].field bound (or unbound with null). */
export function bindEffectInList(
  effects: ReadonlyArray<Effect>,
  index: number,
  field: VariableBindableEffectField,
  variable: Variable | null,
  owner: string,
): Effect[] {
  const target = `effects/${index}/${field}`;
  if (index >= effects.length) {
    throw new Error(
      `${target}: ${owner} has ${effects.length} effect(s). Add the effect first (set_effects or update_effect_style), then bind it.`,
    );
  }
  const copy = effects.slice();
  copy[index] = bindEffect(copy[index], field, variable, target);
  return copy;
}

/**
 * Apply the optional per-effect variable params (colorVariable, radiusVariable, spreadVariable,
 * offsetXVariable, offsetYVariable) from a tool effect entry to a built Figma effect.
 */
export async function applyEffectVariables(
  effect: Effect,
  entry: Record<string, unknown>,
  target: string,
  cache: VariableLookupCache,
): Promise<Effect> {
  let result = effect;
  for (let i = 0; i < EFFECT_VARIABLE_PARAMS.length; i++) {
    const param = EFFECT_VARIABLE_PARAMS[i][0];
    const field = EFFECT_VARIABLE_PARAMS[i][1];
    const ref = entry[param];
    if (ref === undefined || ref === null || ref === "") continue;
    if (typeof ref !== "string") throw new Error(`${target}.${param} must be a variable name or id`);
    const variable = await resolveVariableByIdOrName(ref, cache);
    result = bindEffect(result, field, variable, `${target}.${param}`);
  }
  return result;
}

/** Normalize unknown thrown values to a message. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type BindTarget =
  | { kind: "node"; node: BaseNode }
  | { kind: "textStyle"; style: TextStyle }
  | { kind: "effectStyle"; style: EffectStyle };

async function resolveBindTarget(nodeId: string, parsed: ParsedBindField): Promise<BindTarget> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (node) return { kind: "node", node };

  if (parsed.kind === "effect") {
    const effectStyle = await findLocalStyle(nodeId, "EFFECT");
    if (effectStyle) return { kind: "effectStyle", style: effectStyle };
    throw new Error(`Node or effect style not found: ${nodeId}`);
  }

  const textStyle = await findLocalStyle(nodeId, "TEXT");
  if (textStyle) return { kind: "textStyle", style: textStyle };
  if (await findLocalStyle(nodeId, "EFFECT")) {
    throw new Error(
      `"${nodeId}" is an effect style; effect styles only accept effects/N/<field> where <field> is one of ${EFFECT_FIELDS.join(", ")}.`,
    );
  }
  throw new Error(`Node or text style not found: ${nodeId}`);
}

function bindOnTextStyle(style: TextStyle, field: string, variable: Variable | null): void {
  if (TEXT_FIELDS.indexOf(field) === -1) {
    throw new Error(`Text styles only accept the fields ${TEXT_FIELDS.join(", ")} (got "${field}").`);
  }
  try {
    (
      style as TextStyle & {
        setBoundVariable: (field: VariableBindableTextField, variable: Variable | null) => void;
      }
    ).setBoundVariable(field as VariableBindableTextField, variable);
  } catch (err) {
    if (variable === null) throw new Error(`Failed to unbind variable from text style: ${errorMessage(err)}`);
    throw new Error(
      `Failed to bind variable to text style: ${errorMessage(err)}. Field "${field}" must be one of: ${TEXT_FIELDS.join(", ")}. Variable type (${variable.resolvedType}) must also match the field's expected type (FLOAT for sizes/spacing, STRING for fontFamily/fontStyle).`,
    );
  }
}

function bindOnNode(node: BaseNode, parsed: ParsedBindField, field: string, variable: Variable | null): void {
  if (parsed.kind === "paint") {
    bindPaintColor(node, parsed.prop, parsed.index, variable);
    return;
  }
  if (parsed.kind === "gradientStop") {
    bindGradientStopColor(node, parsed.prop, parsed.index, parsed.stopIndex, variable);
    return;
  }
  if (parsed.kind === "effect") {
    if (!("effects" in node)) {
      throw new Error(`Node "${node.name}" (${node.type}) does not support effects.`);
    }
    const effectNode = node as unknown as BlendMixin;
    effectNode.effects = bindEffectInList(
      effectNode.effects,
      parsed.index,
      parsed.field,
      variable,
      `node "${node.name}"`,
    );
    return;
  }
  const bindable = node as BaseNode & {
    setBoundVariable?: (field: VariableBindableNodeField, variable: Variable | null) => void;
  };
  if (typeof bindable.setBoundVariable !== "function") {
    throw new Error(`Node "${node.name}" (${node.type}) does not support variable bindings.`);
  }
  try {
    bindable.setBoundVariable(parsed.field as VariableBindableNodeField, variable);
  } catch (err) {
    if (variable === null) throw err;
    throw new Error(
      `Cannot bind "${variable.name}" (${variable.resolvedType}) to "${field}" on ${node.type} "${node.name}": ${errorMessage(err)}. The node type must have this field, and the variable type must match it (FLOAT for sizes, spacing, radius and opacity; BOOLEAN for visible; STRING for characters).`,
    );
  }
}

export async function bindVariable(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params["nodeId"] as string;
  const variableId = params["variableId"] as string;
  const field = params["field"] as string;

  if (!nodeId || !variableId || !field) {
    throw new Error("nodeId, variableId, and field are required");
  }

  const parsed = parseBindField(field);
  const target = await resolveBindTarget(nodeId, parsed);
  const variable = await resolveVariableByIdOrName(variableId);
  const variableInfo = { variableId: variable.id, variableName: variable.name, variableType: variable.resolvedType };

  if (target.kind === "textStyle") {
    bindOnTextStyle(target.style, field, variable);
    return Object.assign(
      { styleId: target.style.id, styleName: target.style.name, name: target.style.name, field },
      variableInfo,
    );
  }

  if (target.kind === "effectStyle" && parsed.kind === "effect") {
    const style = target.style;
    style.effects = bindEffectInList(
      style.effects,
      parsed.index,
      parsed.field,
      variable,
      `effect style "${style.name}"`,
    );
    return Object.assign({ styleId: style.id, styleName: style.name, name: style.name, field }, variableInfo);
  }

  const node = (target as { node: BaseNode }).node;
  bindOnNode(node, parsed, field, variable);
  return Object.assign({ nodeId: node.id, name: node.name, field }, variableInfo);
}

export async function unbindVariable(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params["nodeId"] as string;
  const field = params["field"] as string;

  if (!nodeId || !field) {
    throw new Error("nodeId and field are required");
  }

  const parsed = parseBindField(field);
  const target = await resolveBindTarget(nodeId, parsed);

  if (target.kind === "textStyle") {
    bindOnTextStyle(target.style, field, null);
    return { styleId: target.style.id, styleName: target.style.name, name: target.style.name, field, success: true };
  }

  if (target.kind === "effectStyle" && parsed.kind === "effect") {
    const style = target.style;
    style.effects = bindEffectInList(style.effects, parsed.index, parsed.field, null, `effect style "${style.name}"`);
    return { styleId: style.id, styleName: style.name, name: style.name, field, success: true };
  }

  const node = (target as { node: BaseNode }).node;
  try {
    bindOnNode(node, parsed, field, null);
  } catch (err) {
    throw new Error(`Failed to unbind variable: ${errorMessage(err)}`);
  }
  return { nodeId: node.id, name: node.name, field, success: true };
}
