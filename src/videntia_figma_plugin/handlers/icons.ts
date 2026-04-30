// Figma MCP plugin.

import { parseSvgRootStroke, propagateStrokeToShapes } from "../utils/svg";
import { debugLog } from "../utils/helpers";

// ---------------------------------------------------------------------------
// Variable color helpers (shared by createSvg and updateIcon)
// ---------------------------------------------------------------------------

/**
 * Resolve a color variable by Tailwind-style name (e.g. "gray-500") or exact
 * Figma variable name/path (e.g. "gray/500", "semantic/text/secondary").
 *
 * Resolution order:
 *   1. Exact match on variable name
 *   2. Tailwind normalised form: replace dashes with slashes
 *      so "gray-500" → "gray/500", "text-secondary" → "text/secondary"
 *   2b. Partial normalisation: only trailing digit segment "gray-500" → "gray/500"
 *   3. Case-insensitive exact match
 *   4. Suffix match: check if any variable name ends with "/<input>" or "/<normalized>"
 *      e.g. "text-secondary" matches "color/text/secondary"
 *      When multiple matches exist, the shortest name wins (most specific).
 *
 * Returns null if no COLOR variable is found.
 */
// NOTE: In batch contexts where many icon commands run in sequence, callers can
// pre-fetch the variable list once and pass it via `preloadedVars` to avoid
// a redundant getLocalVariablesAsync() call per action.
export async function resolveColorVariable(variableName: string, preloadedVars?: Variable[]): Promise<Variable | null> {
  const variables = preloadedVars !== undefined ? preloadedVars : await figma.variables.getLocalVariablesAsync();
  const colorVars = variables.filter(function (v) {
    return v.resolvedType === "COLOR";
  });

  // 1. Exact match
  const exact = colorVars.find(function (v) {
    return v.name === variableName;
  });
  if (exact !== undefined) return exact;

  // 2. Dash-to-slash normalisation: "gray-500" → "gray/500", "text-text-secondary" → "text/text/secondary"
  const normalized = variableName.split("-").join("/");
  if (normalized !== variableName) {
    const norm = colorVars.find(function (v) {
      return v.name === normalized;
    });
    if (norm !== undefined) return norm;
  }

  // 2b. Partial normalisation: only trailing digit segment "gray-500" → "gray/500"
  const trailingNorm = variableName.replace(/-(\d+)$/, "/$1");
  if (trailingNorm !== variableName && trailingNorm !== normalized) {
    const norm2 = colorVars.find(function (v) {
      return v.name === trailingNorm;
    });
    if (norm2 !== undefined) return norm2;
  }

  // 3. Case-insensitive fallback
  const lower = variableName.toLowerCase();
  const ci = colorVars.find(function (v) {
    return v.name.toLowerCase() === lower;
  });
  if (ci !== undefined) return ci;

  // 4. Suffix match: check if any variable name ends with "/<normalized>" or "/<exact>"
  //    e.g., "text/secondary" matches "color/text/secondary"
  var suffixExact = "/" + variableName;
  var suffixNorm = "/" + normalized;
  var suffixMatches: Variable[] = [];
  for (var si = 0; si < colorVars.length; si++) {
    var vName = colorVars[si].name;
    if (vName.length > suffixExact.length && vName.indexOf(suffixExact, vName.length - suffixExact.length) !== -1) {
      suffixMatches.push(colorVars[si]);
    } else if (
      suffixNorm !== suffixExact &&
      vName.length > suffixNorm.length &&
      vName.indexOf(suffixNorm, vName.length - suffixNorm.length) !== -1
    ) {
      suffixMatches.push(colorVars[si]);
    }
  }
  if (suffixMatches.length > 0) {
    // Pick the shortest name (most specific match); alphabetical tie-break for determinism
    var best = suffixMatches[0];
    for (var sj = 1; sj < suffixMatches.length; sj++) {
      if (
        suffixMatches[sj].name.length < best.name.length ||
        (suffixMatches[sj].name.length === best.name.length && suffixMatches[sj].name < best.name)
      ) {
        best = suffixMatches[sj];
      }
    }
    return best;
  }

  return null;
}

/**
 * Walk a node tree and bind `variable` to `strokes[0].color` on every leaf
 * that has strokes.  Groups and frames are traversed but not bound themselves
 * (they typically have no stroke).
 */
export function bindVariableToStrokes(node: SceneNode, variable: Variable): void {
  if ("children" in node) {
    const children = (node as ChildrenMixin).children;
    for (let i = 0; i < children.length; i++) {
      bindVariableToStrokes(children[i] as SceneNode, variable);
    }
    return;
  }

  if ("strokes" in node) {
    const geo = node as GeometryMixin;
    const currentStrokes = geo.strokes as ReadonlyArray<Paint>;
    if (currentStrokes.length > 0) {
      const updated: Paint[] = [...currentStrokes];
      updated[0] = figma.variables.setBoundVariableForPaint(updated[0] as SolidPaint, "color", variable);
      geo.strokes = updated;
    }
  }
}

// ---------------------------------------------------------------------------
// updateIcon
// ---------------------------------------------------------------------------

/**
 * Replace an existing SVG icon node in-place while preserving its position
 * and parent slot.
 */
export async function updateIcon(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params !== null && params !== undefined ? (params["nodeId"] as string | undefined) : undefined;
  const svgString = params !== null && params !== undefined ? (params["svgString"] as string | undefined) : undefined;
  const name = params !== null && params !== undefined ? (params["name"] as string | undefined) : undefined;
  const colorVariable =
    params !== null && params !== undefined ? (params["colorVariable"] as string | undefined) : undefined;

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!svgString) {
    throw new Error("Missing svgString parameter");
  }

  // Strip any leading content before <svg (e.g. license comments)
  const svgStart = svgString.indexOf("<svg");
  const cleanedSvg = svgStart > 0 ? svgString.slice(svgStart) : svgString;

  const trimmedSvg = cleanedSvg.trim();
  if (trimmedSvg.indexOf("<svg") !== 0 && trimmedSvg.indexOf("<?xml") !== 0) {
    throw new Error("Invalid SVG: must start with <svg or <?xml declaration");
  }

  // Get the existing node to read its parent and position
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error("Node not found with ID: " + nodeId);
  }

  const parent = (node as SceneNode).parent;
  if (!parent) {
    throw new Error("Node has no parent");
  }

  // Parent must support child insertion; bail out early to avoid losing the node
  if (!("insertChild" in parent) && !("appendChild" in parent)) {
    throw new Error("Parent node does not support child insertion");
  }

  // Find the current index within the parent's children
  let index = -1;
  if ("children" in parent) {
    const children = (parent as ChildrenMixin).children;
    for (let i = 0; i < children.length; i++) {
      if (children[i].id === nodeId) {
        index = i;
        break;
      }
    }
  }

  // Capture original position for free-positioned nodes (non-Icon/* parents)
  const sceneNode = node as SceneNode;
  const origX = "x" in sceneNode && (sceneNode as LayoutMixin).x !== undefined ? (sceneNode as LayoutMixin).x : 0;
  const origY = "y" in sceneNode && (sceneNode as LayoutMixin).y !== undefined ? (sceneNode as LayoutMixin).y : 0;

  // Remove the old node
  (node as SceneNode).remove();

  // Create the replacement SVG node
  let svgNode = figma.createNodeFromSvg(cleanedSvg);
  (svgNode as LayoutMixin).x = origX;
  (svgNode as LayoutMixin).y = origY;
  if (name) {
    svgNode.name = name;
  }

  // Propagate root-level stroke to individual shape children (same logic as createSvg)
  const rootStroke = parseSvgRootStroke(cleanedSvg);
  if (rootStroke) {
    propagateStrokeToShapes(svgNode as SceneNode, rootStroke);
    if ("strokes" in svgNode) {
      (svgNode as GeometryMixin).strokes = [];
    }
  }

  // Bind color variable to all strokes if requested
  var colorVariableBound: boolean | undefined = undefined;
  var colorVariableWarning: string | undefined = undefined;
  if (colorVariable !== undefined && colorVariable !== null && colorVariable !== "") {
    const variable = await resolveColorVariable(colorVariable);
    if (variable !== null) {
      bindVariableToStrokes(svgNode as SceneNode, variable);
      colorVariableBound = true;
    } else {
      colorVariableBound = false;
      colorVariableWarning =
        'Variable "' + colorVariable + '" not found. Check that the variable exists in your Figma file.';
    }
  }

  debugLog("updateIcon: inserting replacement SVG node");

  // Insert at the original position, or append if no index was found
  if ("insertChild" in parent && index >= 0) {
    (parent as ChildrenMixin & { insertChild: (index: number, child: SceneNode) => void }).insertChild(
      index,
      svgNode as SceneNode,
    );
  } else {
    (parent as ChildrenMixin).appendChild(svgNode as SceneNode);
  }

  // If placed inside an Icon/* placeholder frame, resize to fill it exactly
  const parentNode = parent as BaseNode;
  if (parentNode.name && parentNode.name.indexOf("Icon/") === 0) {
    if ("strokes" in parent) {
      (parent as GeometryMixin).strokes = [];
    }
    const parentLayout = parent as LayoutMixin;
    const parentW = parentLayout.width !== undefined ? parentLayout.width : 0;
    const parentH = parentLayout.height !== undefined ? parentLayout.height : 0;
    if (parentW > 0 && parentH > 0 && "resize" in svgNode) {
      (svgNode as LayoutMixin & { resize: (w: number, h: number) => void }).resize(parentW, parentH);
      (svgNode as LayoutMixin).x = 0;
      (svgNode as LayoutMixin).y = 0;
    }
  }

  var result: Record<string, unknown> = {
    id: svgNode.id,
    name: svgNode.name,
    parentId: svgNode.parent !== null && svgNode.parent !== undefined ? svgNode.parent.id : undefined,
    index,
  };
  if (colorVariableBound !== undefined) {
    result["colorVariableBound"] = colorVariableBound;
  }
  if (colorVariableWarning !== undefined) {
    result["colorVariableWarning"] = colorVariableWarning;
  }
  return result;
}
