// Figma MCP plugin.

import { parseSvgRootStroke, propagateStrokeToShapes } from "../utils/svg";
import { debugLog, parseNum } from "../utils/helpers";
import { resolveColorVariable, bindVariableToStrokes } from "./icons";

// Individual stroke weight properties exposed by FrameNode / ComponentNode
// but not typed in the public Figma plugin typings.
interface StrokeWeightMixin {
  strokeWeight: number;
  strokeTopWeight: number;
  strokeBottomWeight: number;
  strokeLeftWeight: number;
  strokeRightWeight: number;
}

// ---------------------------------------------------------------------------
// createEllipse
// ---------------------------------------------------------------------------

/**
 * Create an ellipse node in the Figma document.
 */
export async function createEllipse(params: Record<string, unknown>): Promise<unknown> {
  const paramsObj = params !== null && params !== undefined ? params : {};

  const x = paramsObj["x"] !== undefined ? (paramsObj["x"] as number) : 0;
  const y = paramsObj["y"] !== undefined ? (paramsObj["y"] as number) : 0;
  const width = paramsObj["width"] !== undefined ? (paramsObj["width"] as number) : 100;
  const height = paramsObj["height"] !== undefined ? (paramsObj["height"] as number) : 100;
  const name = paramsObj["name"] !== undefined ? (paramsObj["name"] as string) : "Ellipse";
  const parentId = paramsObj["parentId"] as string | undefined;
  const fillColor =
    paramsObj["fillColor"] !== undefined
      ? (paramsObj["fillColor"] as Record<string, unknown>)
      : ({ r: 0.8, g: 0.8, b: 0.8, a: 1 } as Record<string, unknown>);
  const strokeColor = paramsObj["strokeColor"] as Record<string, unknown> | undefined;
  const strokeWeight = paramsObj["strokeWeight"] as number | undefined;
  const layoutPositioning = paramsObj["layoutPositioning"] as string | undefined;

  // Create a new ellipse node
  const ellipse = figma.createEllipse();
  ellipse.name = name;

  // Position and size the ellipse
  ellipse.x = x;
  ellipse.y = y;
  ellipse.resize(width, height);

  // Set fill color if provided
  if (fillColor) {
    const fillStyle: SolidPaint = {
      type: "SOLID",
      color: {
        r: parseNum(fillColor["r"], 0),
        g: parseNum(fillColor["g"], 0),
        b: parseNum(fillColor["b"], 0),
      },
      opacity: parseNum(fillColor["a"], 1),
    };
    ellipse.fills = [fillStyle];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    const strokeStyle: SolidPaint = {
      type: "SOLID",
      color: {
        r: parseNum(strokeColor["r"], 0),
        g: parseNum(strokeColor["g"], 0),
        b: parseNum(strokeColor["b"], 0),
      },
      opacity: parseNum(strokeColor["a"], 1),
    };
    ellipse.strokes = [strokeStyle];

    if (strokeWeight !== undefined) {
      ellipse.strokeWeight = strokeWeight;
    }
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    (parentNode as ChildrenMixin).appendChild(ellipse);
  } else {
    figma.currentPage.appendChild(ellipse);
  }

  // Set layoutPositioning after appendChild (node must be attached first)
  if (layoutPositioning !== undefined) {
    (ellipse as unknown as { layoutPositioning: string }).layoutPositioning = layoutPositioning;
    // Re-apply coordinates — setting ABSOLUTE resets position within parent
    ellipse.x = x;
    ellipse.y = y;
  }

  return {
    id: ellipse.id,
    name: ellipse.name,
    type: ellipse.type,
    x: ellipse.x,
    y: ellipse.y,
    width: ellipse.width,
    height: ellipse.height,
  };
}

// ---------------------------------------------------------------------------
// createPolygon
// ---------------------------------------------------------------------------

/**
 * Create a polygon node in the Figma document.
 */
export async function createPolygon(params: Record<string, unknown>): Promise<unknown> {
  const paramsObj = params !== null && params !== undefined ? params : {};

  const x = paramsObj["x"] !== undefined ? (paramsObj["x"] as number) : 0;
  const y = paramsObj["y"] !== undefined ? (paramsObj["y"] as number) : 0;
  const width = paramsObj["width"] !== undefined ? (paramsObj["width"] as number) : 100;
  const height = paramsObj["height"] !== undefined ? (paramsObj["height"] as number) : 100;
  const sides = paramsObj["sides"] !== undefined ? (paramsObj["sides"] as number) : 6;
  const name = paramsObj["name"] !== undefined ? (paramsObj["name"] as string) : "Polygon";
  const parentId = paramsObj["parentId"] as string | undefined;
  const fillColor = paramsObj["fillColor"] as Record<string, unknown> | undefined;
  const strokeColor = paramsObj["strokeColor"] as Record<string, unknown> | undefined;
  const strokeWeight = paramsObj["strokeWeight"] as number | undefined;

  // Create the polygon
  const polygon = figma.createPolygon();
  polygon.x = x;
  polygon.y = y;
  polygon.resize(width, height);
  polygon.name = name;

  // Set the number of sides
  if (sides >= 3) {
    polygon.pointCount = sides;
  }

  // Set fill color if provided
  if (fillColor) {
    const paintStyle: SolidPaint = {
      type: "SOLID",
      color: {
        r: parseNum(fillColor["r"], 0),
        g: parseNum(fillColor["g"], 0),
        b: parseNum(fillColor["b"], 0),
      },
      opacity: parseNum(fillColor["a"], 1),
    };
    polygon.fills = [paintStyle];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    const strokeStyle: SolidPaint = {
      type: "SOLID",
      color: {
        r: parseNum(strokeColor["r"], 0),
        g: parseNum(strokeColor["g"], 0),
        b: parseNum(strokeColor["b"], 0),
      },
      opacity: parseNum(strokeColor["a"], 1),
    };
    polygon.strokes = [strokeStyle];
  }

  // Set stroke weight if provided
  if (strokeWeight !== undefined) {
    polygon.strokeWeight = strokeWeight;
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    (parentNode as ChildrenMixin).appendChild(polygon);
  } else {
    figma.currentPage.appendChild(polygon);
  }

  return {
    id: polygon.id,
    name: polygon.name,
    type: polygon.type,
    x: polygon.x,
    y: polygon.y,
    width: polygon.width,
    height: polygon.height,
    pointCount: polygon.pointCount,
    fills: polygon.fills,
    strokes: polygon.strokes,
    strokeWeight: polygon.strokeWeight,
    parentId: polygon.parent ? polygon.parent.id : undefined,
  };
}

// ---------------------------------------------------------------------------
// createStar
// ---------------------------------------------------------------------------

/**
 * Create a star node in the Figma document.
 */
export async function createStar(params: Record<string, unknown>): Promise<unknown> {
  const paramsObj = params !== null && params !== undefined ? params : {};

  const x = paramsObj["x"] !== undefined ? (paramsObj["x"] as number) : 0;
  const y = paramsObj["y"] !== undefined ? (paramsObj["y"] as number) : 0;
  const width = paramsObj["width"] !== undefined ? (paramsObj["width"] as number) : 100;
  const height = paramsObj["height"] !== undefined ? (paramsObj["height"] as number) : 100;
  const points = paramsObj["points"] !== undefined ? (paramsObj["points"] as number) : 5;
  // innerRadius: proportion of the outer radius (default 0.5)
  const innerRadius = paramsObj["innerRadius"] !== undefined ? (paramsObj["innerRadius"] as number) : 0.5;
  const name = paramsObj["name"] !== undefined ? (paramsObj["name"] as string) : "Star";
  const parentId = paramsObj["parentId"] as string | undefined;
  const fillColor = paramsObj["fillColor"] as Record<string, unknown> | undefined;
  const strokeColor = paramsObj["strokeColor"] as Record<string, unknown> | undefined;
  const strokeWeight = paramsObj["strokeWeight"] as number | undefined;

  // Create the star
  const star = figma.createStar();
  star.x = x;
  star.y = y;
  star.resize(width, height);
  star.name = name;

  // Set the number of points
  if (points >= 3) {
    star.pointCount = points;
  }

  // Set the inner radius ratio
  if (innerRadius > 0 && innerRadius < 1) {
    star.innerRadius = innerRadius;
  }

  // Set fill color if provided
  if (fillColor) {
    const paintStyle: SolidPaint = {
      type: "SOLID",
      color: {
        r: parseNum(fillColor["r"], 0),
        g: parseNum(fillColor["g"], 0),
        b: parseNum(fillColor["b"], 0),
      },
      opacity: parseNum(fillColor["a"], 1),
    };
    star.fills = [paintStyle];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    const strokeStyle: SolidPaint = {
      type: "SOLID",
      color: {
        r: parseNum(strokeColor["r"], 0),
        g: parseNum(strokeColor["g"], 0),
        b: parseNum(strokeColor["b"], 0),
      },
      opacity: parseNum(strokeColor["a"], 1),
    };
    star.strokes = [strokeStyle];
  }

  // Set stroke weight if provided
  if (strokeWeight !== undefined) {
    star.strokeWeight = strokeWeight;
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    (parentNode as ChildrenMixin).appendChild(star);
  } else {
    figma.currentPage.appendChild(star);
  }

  return {
    id: star.id,
    name: star.name,
    type: star.type,
    x: star.x,
    y: star.y,
    width: star.width,
    height: star.height,
    pointCount: star.pointCount,
    innerRadius: star.innerRadius,
    fills: star.fills,
    strokes: star.strokes,
    strokeWeight: star.strokeWeight,
    parentId: star.parent ? star.parent.id : undefined,
  };
}

// ---------------------------------------------------------------------------
// createSvg
// ---------------------------------------------------------------------------

/**
 * Create a Figma node from an SVG string.
 * Propagates root-level stroke attributes to individual shape descendants,
 * and optionally flattens the result into a single vector node.
 */
export async function createSvg(params: Record<string, unknown>): Promise<unknown> {
  const paramsObj = params !== null && params !== undefined ? params : {};

  const svgString = paramsObj["svgString"] as string | undefined;
  const x = paramsObj["x"] !== undefined ? (paramsObj["x"] as number) : 0;
  const y = paramsObj["y"] !== undefined ? (paramsObj["y"] as number) : 0;
  const name = paramsObj["name"] as string | undefined;
  const parentId = paramsObj["parentId"] as string | undefined;
  const flatten = paramsObj["flatten"] !== undefined ? (paramsObj["flatten"] as boolean) : false;
  const colorVariable = paramsObj["colorVariable"] as string | undefined;

  if (!svgString) {
    throw new Error("Missing svgString parameter");
  }

  // Strip any leading HTML comments (e.g. Lucide license headers) before validating
  const cleanSvg = svgString.replace(/^<!--[\s\S]*?-->\s*/m, "").trim();
  if (!cleanSvg.startsWith("<svg") && !cleanSvg.startsWith("<?xml")) {
    throw new Error("Invalid SVG: must start with <svg or <?xml declaration");
  }

  debugLog(`createSvg: Creating SVG node, flatten=${flatten}`);

  // Create node from SVG string
  let svgNode: FrameNode | VectorNode;
  try {
    svgNode = figma.createNodeFromSvg(cleanSvg);
  } catch (parseError) {
    const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
    console.error(`createSvg: Failed to parse SVG: ${errorMsg}`);
    throw new Error(`Failed to parse SVG: ${errorMsg}`);
  }

  // Position the node
  svgNode.x = x;
  svgNode.y = y;

  // Set name if provided
  if (name) {
    svgNode.name = name;
  }

  // If the root <svg> element carries a stroke, propagate it to individual vector
  // children rather than leaving it on the root frame, which does not render strokes
  // the same way as SVG shape nodes do.
  const rootStroke = parseSvgRootStroke(cleanSvg);
  if (rootStroke) {
    propagateStrokeToShapes(svgNode as SceneNode, rootStroke);
    // Clear any stroke that was incorrectly placed on the root frame
    if ("strokes" in svgNode) {
      (svgNode as GeometryMixin).strokes = [];
    }
  }

  // Flatten to single vector if requested (must happen before variable binding,
  // because flatten discards bound variables on child strokes)
  if (flatten && "children" in svgNode && (svgNode as FrameNode).children.length > 0) {
    try {
      const flattened = figma.flatten([svgNode as FrameNode]);
      svgNode = flattened as unknown as VectorNode;
      if (name) {
        svgNode.name = name;
      }
      debugLog("createSvg: Flattened SVG to single vector");
    } catch (flattenError) {
      console.warn(`createSvg: Could not flatten SVG: ${flattenError}`);
      // Continue with unflattened node
    }
  }

  // Bind color variable to all child strokes if requested (after flatten so bindings persist)
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

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    (parentNode as ChildrenMixin).appendChild(svgNode as SceneNode);

    // Icon/* frames are layout-only placeholder containers.
    // After inserting the SVG, clear any stroke that bled through from the JSX
    // border classes, and resize the SVG node to fill the parent frame exactly.
    const parentFrame = parentNode as FrameNode;
    if (parentFrame.name && parentFrame.name.indexOf("Icon/") === 0) {
      parentFrame.strokes = [];
      const frameWithStrokes = parentFrame as unknown as StrokeWeightMixin;
      frameWithStrokes.strokeWeight = 0;
      frameWithStrokes.strokeTopWeight = 0;
      frameWithStrokes.strokeBottomWeight = 0;
      frameWithStrokes.strokeLeftWeight = 0;
      frameWithStrokes.strokeRightWeight = 0;

      const parentW = parentFrame.width !== undefined ? parentFrame.width : 0;
      const parentH = parentFrame.height !== undefined ? parentFrame.height : 0;
      if (parentW > 0 && parentH > 0 && svgNode.resize) {
        svgNode.resize(parentW, parentH);
        svgNode.x = 0;
        svgNode.y = 0;
      }
    }
  } else {
    figma.currentPage.appendChild(svgNode as SceneNode);
  }

  debugLog(`createSvg: Created SVG node "${svgNode.name}" (${svgNode.id})`);

  var result: Record<string, unknown> = {
    id: svgNode.id,
    name: svgNode.name,
    type: svgNode.type,
    x: svgNode.x,
    y: svgNode.y,
    width: svgNode.width,
    height: svgNode.height,
    childCount: "children" in svgNode ? (svgNode as FrameNode).children.length : 0,
    parentId: svgNode.parent ? svgNode.parent.id : undefined,
  };
  if (colorVariableBound !== undefined) {
    result["colorVariableBound"] = colorVariableBound;
  }
  if (colorVariableWarning !== undefined) {
    result["colorVariableWarning"] = colorVariableWarning;
  }
  return result;
}

// ---------------------------------------------------------------------------
// createVector
// ---------------------------------------------------------------------------

/**
 * Create a vector node with custom paths in the Figma document.
 */
export async function createVector(params: Record<string, unknown>): Promise<unknown> {
  const paramsObj = params !== null && params !== undefined ? params : {};

  const x = paramsObj["x"] !== undefined ? (paramsObj["x"] as number) : 0;
  const y = paramsObj["y"] !== undefined ? (paramsObj["y"] as number) : 0;
  const width = paramsObj["width"] !== undefined ? (paramsObj["width"] as number) : 100;
  const height = paramsObj["height"] !== undefined ? (paramsObj["height"] as number) : 100;
  const name = paramsObj["name"] !== undefined ? (paramsObj["name"] as string) : "Vector";
  const parentId = paramsObj["parentId"] as string | undefined;
  const vectorPaths =
    paramsObj["vectorPaths"] !== undefined ? (paramsObj["vectorPaths"] as Array<Record<string, unknown>>) : [];
  const fillColor = paramsObj["fillColor"] as Record<string, unknown> | undefined;
  const strokeColor = paramsObj["strokeColor"] as Record<string, unknown> | undefined;
  const strokeWeight = paramsObj["strokeWeight"] as number | undefined;

  // Create the vector
  const vector = figma.createVector();
  vector.x = x;
  vector.y = y;
  vector.resize(width, height);
  vector.name = name;

  // Set vector paths if provided
  if (vectorPaths && vectorPaths.length > 0) {
    vector.vectorPaths = vectorPaths.map((path) => {
      return {
        windingRule: path["windingRule"] !== undefined ? (path["windingRule"] as VectorPath["windingRule"]) : "EVENODD",
        data: path["data"] !== undefined ? (path["data"] as string) : "",
      };
    });
  }

  // Set fill color if provided
  if (fillColor) {
    const paintStyle: SolidPaint = {
      type: "SOLID",
      color: {
        r: parseNum(fillColor["r"], 0),
        g: parseNum(fillColor["g"], 0),
        b: parseNum(fillColor["b"], 0),
      },
      opacity: parseNum(fillColor["a"], 1),
    };
    vector.fills = [paintStyle];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    const strokeStyle: SolidPaint = {
      type: "SOLID",
      color: {
        r: parseNum(strokeColor["r"], 0),
        g: parseNum(strokeColor["g"], 0),
        b: parseNum(strokeColor["b"], 0),
      },
      opacity: parseNum(strokeColor["a"], 1),
    };
    vector.strokes = [strokeStyle];
  }

  // Set stroke weight if provided
  if (strokeWeight !== undefined) {
    vector.strokeWeight = strokeWeight;
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    (parentNode as ChildrenMixin).appendChild(vector);
  } else {
    figma.currentPage.appendChild(vector);
  }

  return {
    id: vector.id,
    name: vector.name,
    type: vector.type,
    x: vector.x,
    y: vector.y,
    width: vector.width,
    height: vector.height,
    vectorNetwork: vector.vectorNetwork,
    fills: vector.fills,
    strokes: vector.strokes,
    strokeWeight: vector.strokeWeight,
    parentId: vector.parent ? vector.parent.id : undefined,
  };
}

// ---------------------------------------------------------------------------
// createLine
// ---------------------------------------------------------------------------

/**
 * Create a straight line as a vector node in the Figma document.
 * The line is drawn from (x1, y1) to (x2, y2) in the canvas coordinate space.
 */
export async function createLine(params: Record<string, unknown>): Promise<unknown> {
  const paramsObj = params !== null && params !== undefined ? params : {};

  const x1 = paramsObj["x1"] !== undefined ? (paramsObj["x1"] as number) : 0;
  const y1 = paramsObj["y1"] !== undefined ? (paramsObj["y1"] as number) : 0;
  const x2 = paramsObj["x2"] !== undefined ? (paramsObj["x2"] as number) : 100;
  const y2 = paramsObj["y2"] !== undefined ? (paramsObj["y2"] as number) : 0;
  const name = paramsObj["name"] !== undefined ? (paramsObj["name"] as string) : "Line";
  const parentId = paramsObj["parentId"] as string | undefined;
  const strokeColor =
    paramsObj["strokeColor"] !== undefined
      ? (paramsObj["strokeColor"] as Record<string, unknown>)
      : ({ r: 0, g: 0, b: 0, a: 1 } as Record<string, unknown>);
  const strokeWeight = paramsObj["strokeWeight"] !== undefined ? (paramsObj["strokeWeight"] as number) : 1;
  // strokeCap: can be "NONE", "ROUND", "SQUARE", "ARROW_LINES", or "ARROW_EQUILATERAL"
  const strokeCap = paramsObj["strokeCap"] !== undefined ? (paramsObj["strokeCap"] as string) : "NONE";

  // Create a vector node to represent the line
  const line = figma.createVector();
  line.name = name;

  // Position the line at the starting point
  line.x = x1;
  line.y = y1;

  // Calculate the vector size
  const lineWidth = Math.abs(x2 - x1);
  const lineHeight = Math.abs(y2 - y1);
  line.resize(lineWidth > 0 ? lineWidth : 1, lineHeight > 0 ? lineHeight : 1);

  // Create vector path data for a straight line
  // SVG path data format: M (move to) starting point, L (line to) ending point
  const dx = x2 - x1;
  const dy = y2 - y1;

  // Calculate relative endpoint coordinates in the vector's local coordinate system
  const endX = dx > 0 ? lineWidth : 0;
  const endY = dy > 0 ? lineHeight : 0;
  const startX = dx > 0 ? 0 : lineWidth;
  const startY = dy > 0 ? 0 : lineHeight;

  // Generate SVG path data for the line
  const pathData = `M ${startX} ${startY} L ${endX} ${endY}`;

  // Set vector paths
  line.vectorPaths = [
    {
      windingRule: "NONZERO",
      data: pathData,
    },
  ];

  // Set stroke color
  const strokeStyle: SolidPaint = {
    type: "SOLID",
    color: {
      r: parseNum(strokeColor["r"], 0),
      g: parseNum(strokeColor["g"], 0),
      b: parseNum(strokeColor["b"], 0),
    },
    opacity: parseNum(strokeColor["a"], 1),
  };
  line.strokes = [strokeStyle];

  // Set stroke weight
  line.strokeWeight = strokeWeight;

  // Set stroke cap style if supported
  const validStrokeCaps = ["NONE", "ROUND", "SQUARE", "ARROW_LINES", "ARROW_EQUILATERAL"];
  if (validStrokeCaps.includes(strokeCap)) {
    (line as unknown as { strokeCap: string }).strokeCap = strokeCap;
  }

  // Set fill to none (transparent) as lines typically don't have fills
  line.fills = [];

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    (parentNode as ChildrenMixin).appendChild(line);
  } else {
    figma.currentPage.appendChild(line);
  }

  return {
    id: line.id,
    name: line.name,
    type: line.type,
    x: line.x,
    y: line.y,
    width: line.width,
    height: line.height,
    strokeWeight: line.strokeWeight,
    strokeCap: (line as unknown as { strokeCap: string }).strokeCap,
    strokes: line.strokes,
    vectorPaths: line.vectorPaths,
    parentId: line.parent ? line.parent.id : undefined,
  };
}

// ---------------------------------------------------------------------------
// Orthogonal connector helpers
// ---------------------------------------------------------------------------

type ConnectorPoint = { x: number; y: number };
type RoutingSide = "RIGHT" | "LEFT" | "BOTTOM" | "TOP";

interface RouteResult {
  points: ConnectorPoint[];
  startSide: RoutingSide;
  endSide: RoutingSide;
}

/** Returns the attachment point on an edge given a 0–1 offset along that edge. */
function getEdgePoint(bounds: Rect, side: RoutingSide, offset: number): ConnectorPoint {
  const t = Math.max(0, Math.min(1, offset));
  switch (side) {
    case "TOP":    return { x: bounds.x + bounds.width * t,  y: bounds.y };
    case "BOTTOM": return { x: bounds.x + bounds.width * t,  y: bounds.y + bounds.height };
    case "LEFT":   return { x: bounds.x,                     y: bounds.y + bounds.height * t };
    case "RIGHT":  return { x: bounds.x + bounds.width,      y: bounds.y + bounds.height * t };
  }
}

function computeOrthogonalRoute(
  startBounds: Rect,
  endBounds: Rect,
  routingStyle: string,
  exitSide?: string,
  entrySide?: string,
  exitOffset: number = 0.5,
  entryOffset: number = 0.5,
  waypoints?: ConnectorPoint[],
): RouteResult {
  const validSides = ["TOP", "BOTTOM", "LEFT", "RIGHT"];
  const dx = (endBounds.x + endBounds.width / 2) - (startBounds.x + startBounds.width / 2);
  const dy = (endBounds.y + endBounds.height / 2) - (startBounds.y + startBounds.height / 2);

  let startSide: RoutingSide;
  if (exitSide && validSides.includes(exitSide)) {
    startSide = exitSide as RoutingSide;
  } else {
    const useHoriz =
      routingStyle === "HORIZONTAL_FIRST" ||
      (routingStyle !== "VERTICAL_FIRST" && Math.abs(dx) >= Math.abs(dy));
    if (useHoriz) startSide = dx >= 0 ? "RIGHT" : "LEFT";
    else           startSide = dy >= 0 ? "BOTTOM" : "TOP";
  }

  let endSide: RoutingSide;
  if (entrySide && validSides.includes(entrySide)) {
    endSide = entrySide as RoutingSide;
  } else {
    const opposites: Record<RoutingSide, RoutingSide> = {
      RIGHT: "LEFT", LEFT: "RIGHT", BOTTOM: "TOP", TOP: "BOTTOM",
    };
    endSide = opposites[startSide];
  }

  const startPoint = getEdgePoint(startBounds, startSide, exitOffset);
  const endPoint   = getEdgePoint(endBounds,   endSide,   entryOffset);

  if (waypoints && waypoints.length > 0) {
    return { points: [startPoint, ...waypoints, endPoint], startSide, endSide };
  }

  const isHorizExit = startSide === "LEFT" || startSide === "RIGHT";

  if (isHorizExit) {
    if (Math.abs(startPoint.y - endPoint.y) < 0.5) {
      return { points: [startPoint, endPoint], startSide, endSide };
    }
    const midX = (startPoint.x + endPoint.x) / 2;
    return {
      points: [
        startPoint,
        { x: midX, y: startPoint.y },
        { x: midX, y: endPoint.y },
        endPoint,
      ],
      startSide,
      endSide,
    };
  } else {
    if (Math.abs(startPoint.x - endPoint.x) < 0.5) {
      return { points: [startPoint, endPoint], startSide, endSide };
    }
    const midY = (startPoint.y + endPoint.y) / 2;
    return {
      points: [
        startPoint,
        { x: startPoint.x, y: midY },
        { x: endPoint.x,   y: midY },
        endPoint,
      ],
      startSide,
      endSide,
    };
  }
}

// ---------------------------------------------------------------------------
// createOrthogonalConnector
// ---------------------------------------------------------------------------

export async function createOrthogonalConnector(params: Record<string, unknown>): Promise<unknown> {
  const startNodeId = params["startNodeId"] as string;
  const endNodeId = params["endNodeId"] as string;
  const name = (params["name"] as string) || "Connector";
  const parentId = params["parentId"] as string | undefined;
  const strokeColorParam =
    (params["strokeColor"] as Record<string, unknown>) || { r: 0.2, g: 0.2, b: 0.2, a: 1 };
  const strokeWeight = params["strokeWeight"] !== undefined ? (params["strokeWeight"] as number) : 1.5;
  const startCap = (params["startCap"] as string) || "NONE";
  const endCap = (params["endCap"] as string) || "ARROW_LINES";
  const routingStyle = (params["routingStyle"] as string) || "AUTO";
  const cornerRadius = params["cornerRadius"] !== undefined ? (params["cornerRadius"] as number) : 0;
  const exitSide = params["exitSide"] as string | undefined;
  const entrySide = params["entrySide"] as string | undefined;
  const exitOffset = params["exitOffset"] !== undefined ? (params["exitOffset"] as number) : 0.5;
  const entryOffset = params["entryOffset"] !== undefined ? (params["entryOffset"] as number) : 0.5;
  const waypointsRaw = params["waypoints"] as Array<Record<string, number>> | undefined;
  const waypoints: ConnectorPoint[] | undefined = waypointsRaw
    ? waypointsRaw.map(w => ({ x: w["x"] ?? 0, y: w["y"] ?? 0 }))
    : undefined;

  const startNode = await figma.getNodeByIdAsync(startNodeId) as SceneNode | null;
  const endNode = await figma.getNodeByIdAsync(endNodeId) as SceneNode | null;

  if (!startNode) throw new Error(`Start node not found: ${startNodeId}`);
  if (!endNode) throw new Error(`End node not found: ${endNodeId}`);

  const startBounds = startNode.absoluteBoundingBox;
  const endBounds = endNode.absoluteBoundingBox;

  if (!startBounds) throw new Error("Cannot get bounding box for start node");
  if (!endBounds) throw new Error("Cannot get bounding box for end node");

  const route = computeOrthogonalRoute(
    startBounds, endBounds, routingStyle,
    exitSide, entrySide, exitOffset, entryOffset, waypoints,
  );
  const points = route.points;

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const bboxWidth = Math.max(maxX - minX, 1);
  const bboxHeight = Math.max(maxY - minY, 1);

  const localPoints = points.map(p => ({ x: p.x - minX, y: p.y - minY }));

  const validCaps = ["NONE", "ROUND", "SQUARE", "ARROW_LINES", "ARROW_EQUILATERAL"];
  const resolvedStartCap = validCaps.includes(startCap) ? startCap : "NONE";
  const resolvedEndCap = validCaps.includes(endCap) ? endCap : "ARROW_LINES";

  const vertices = localPoints.map((p, i) => {
    const v: Record<string, unknown> = { x: p.x, y: p.y };
    if (i === 0) v["strokeCap"] = resolvedStartCap;
    if (i === localPoints.length - 1) v["strokeCap"] = resolvedEndCap;
    if (cornerRadius > 0 && i > 0 && i < localPoints.length - 1) {
      v["cornerRadius"] = cornerRadius;
    }
    return v;
  });

  const segments: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < localPoints.length - 1; i++) {
    segments.push({ start: i, end: i + 1 });
  }

  const vector = figma.createVector();
  vector.name = name;
  vector.x = minX;
  vector.y = minY;
  vector.resize(bboxWidth, bboxHeight);

  await (vector as unknown as {
    setVectorNetworkAsync: (network: Record<string, unknown>) => Promise<void>;
  }).setVectorNetworkAsync({
    vertices,
    segments,
    regions: [],
  });

  vector.fills = [];
  vector.strokes = [
    {
      type: "SOLID",
      color: {
        r: parseNum(strokeColorParam["r"], 0.2),
        g: parseNum(strokeColorParam["g"], 0.2),
        b: parseNum(strokeColorParam["b"], 0.2),
      },
      opacity: parseNum(strokeColorParam["a"], 1),
    } as SolidPaint,
  ];
  vector.strokeWeight = strokeWeight;
  vector.strokeJoin = "MITER";

  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) throw new Error(`Parent node not found: ${parentId}`);
    if (!("appendChild" in parentNode)) throw new Error(`Parent does not support children: ${parentId}`);
    (parentNode as ChildrenMixin).appendChild(vector);
    const parentBounds = (parentNode as SceneNode).absoluteBoundingBox;
    if (parentBounds) {
      vector.x = minX - parentBounds.x;
      vector.y = minY - parentBounds.y;
    }
  } else {
    figma.currentPage.appendChild(vector);
  }

  return {
    id: vector.id,
    name: vector.name,
    type: vector.type,
    x: vector.x,
    y: vector.y,
    width: vector.width,
    height: vector.height,
    startSide: route.startSide,
    endSide: route.endSide,
    waypointCount: points.length,
    parentId: vector.parent ? vector.parent.id : undefined,
  };
}

// ---------------------------------------------------------------------------
// createFanConnectors
// ---------------------------------------------------------------------------

function autoExitSide(sourceBounds: Rect, targetBounds: Rect): RoutingSide {
  const dx = (targetBounds.x + targetBounds.width / 2) - (sourceBounds.x + sourceBounds.width / 2);
  const dy = (targetBounds.y + targetBounds.height / 2) - (sourceBounds.y + sourceBounds.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "RIGHT" : "LEFT";
  return dy >= 0 ? "BOTTOM" : "TOP";
}

export async function createFanConnectors(params: Record<string, unknown>): Promise<unknown> {
  const sourceNodeId = params["sourceNodeId"] as string;
  const targetNodeIds = params["targetNodeIds"] as string[];
  const exitSideParam = params["exitSide"] as string | undefined;
  const entrySideParam = params["entrySide"] as string | undefined;
  const entryOffset = params["entryOffset"] !== undefined ? (params["entryOffset"] as number) : 0.5;
  const strokeColorParam =
    (params["strokeColor"] as Record<string, unknown>) || { r: 0.2, g: 0.2, b: 0.2, a: 1 };
  const strokeWeight = params["strokeWeight"] !== undefined ? (params["strokeWeight"] as number) : 1.5;
  const startCap = (params["startCap"] as string) || "NONE";
  const endCap = (params["endCap"] as string) || "ARROW_LINES";
  const cornerRadius = params["cornerRadius"] !== undefined ? (params["cornerRadius"] as number) : 0;
  const parentId = params["parentId"] as string | undefined;
  const baseName = (params["name"] as string) || "Connector";

  if (!Array.isArray(targetNodeIds) || targetNodeIds.length === 0) {
    throw new Error("targetNodeIds must be a non-empty array");
  }

  const sourceNode = await figma.getNodeByIdAsync(sourceNodeId) as SceneNode | null;
  if (!sourceNode) throw new Error(`Source node not found: ${sourceNodeId}`);
  const sourceBounds = sourceNode.absoluteBoundingBox;
  if (!sourceBounds) throw new Error("Cannot get bounding box for source node");

  let parentNode: ChildrenMixin | null = null;
  let parentBounds: Rect | null = null;
  if (parentId) {
    const p = await figma.getNodeByIdAsync(parentId);
    if (!p) throw new Error(`Parent node not found: ${parentId}`);
    if (!("appendChild" in p)) throw new Error(`Parent does not support children: ${parentId}`);
    parentNode = p as unknown as ChildrenMixin;
    parentBounds = (p as SceneNode).absoluteBoundingBox;
  }

  const targets: Array<{ id: string; bounds: Rect; originalIndex: number }> = [];
  for (let i = 0; i < targetNodeIds.length; i++) {
    const id = targetNodeIds[i];
    const node = await figma.getNodeByIdAsync(id) as SceneNode | null;
    if (!node) throw new Error(`Target node not found: ${id}`);
    const bounds = node.absoluteBoundingBox;
    if (!bounds) throw new Error(`Cannot get bounding box for target: ${id}`);
    targets.push({ id, bounds, originalIndex: i });
  }

  const validSides = ["TOP", "BOTTOM", "LEFT", "RIGHT"];
  const validCaps = ["NONE", "ROUND", "SQUARE", "ARROW_LINES", "ARROW_EQUILATERAL"];
  const resolvedStartCap = validCaps.includes(startCap) ? startCap : "NONE";
  const resolvedEndCap = validCaps.includes(endCap) ? endCap : "ARROW_LINES";
  const strokeStyle: SolidPaint = {
    type: "SOLID",
    color: {
      r: parseNum(strokeColorParam["r"], 0.2),
      g: parseNum(strokeColorParam["g"], 0.2),
      b: parseNum(strokeColorParam["b"], 0.2),
    },
    opacity: parseNum(strokeColorParam["a"], 1),
  };

  type Assignment = {
    target: typeof targets[0];
    exitSide: RoutingSide;
    exitOffset: number;
  };
  const assignments: Assignment[] = [];

  if (exitSideParam && validSides.includes(exitSideParam)) {
    const forcedSide = exitSideParam as RoutingSide;
    const n = targets.length;
    targets.forEach((t, i) => {
      assignments.push({ target: t, exitSide: forcedSide, exitOffset: (i + 1) / (n + 1) });
    });
  } else {
    const sideGroups: Record<RoutingSide, typeof targets> = {
      RIGHT: [], LEFT: [], BOTTOM: [], TOP: [],
    };
    for (const t of targets) {
      sideGroups[autoExitSide(sourceBounds, t.bounds)].push(t);
    }

    for (const side of ["RIGHT", "LEFT", "BOTTOM", "TOP"] as RoutingSide[]) {
      const group = sideGroups[side];
      if (group.length === 0) continue;

      const isVerticalEdge = side === "RIGHT" || side === "LEFT";
      group.sort((a, b) => {
        const aPos = isVerticalEdge
          ? a.bounds.y + a.bounds.height / 2
          : a.bounds.x + a.bounds.width / 2;
        const bPos = isVerticalEdge
          ? b.bounds.y + b.bounds.height / 2
          : b.bounds.x + b.bounds.width / 2;
        return aPos - bPos;
      });

      const m = group.length;
      group.forEach((t, i) => {
        assignments.push({ target: t, exitSide: side, exitOffset: (i + 1) / (m + 1) });
      });
    }
  }

  const resultMap: Record<number, { id: string; name: string; targetId: string; exitSide: string; exitOffset: number }> = {};

  for (const assign of assignments) {
    const { target, exitSide, exitOffset: exitOff } = assign;

    const route = computeOrthogonalRoute(
      sourceBounds, target.bounds, "AUTO",
      exitSide, entrySideParam,
      exitOff, entryOffset,
      undefined,
    );

    const pts = route.points;
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const bboxWidth = Math.max(Math.max(...xs) - minX, 1);
    const bboxHeight = Math.max(Math.max(...ys) - minY, 1);
    const localPts = pts.map(p => ({ x: p.x - minX, y: p.y - minY }));

    const vertices = localPts.map((p, vi) => {
      const v: Record<string, unknown> = { x: p.x, y: p.y };
      if (vi === 0) v["strokeCap"] = resolvedStartCap;
      if (vi === localPts.length - 1) v["strokeCap"] = resolvedEndCap;
      if (cornerRadius > 0 && vi > 0 && vi < localPts.length - 1) v["cornerRadius"] = cornerRadius;
      return v;
    });
    const segments: Array<{ start: number; end: number }> = [];
    for (let s = 0; s < localPts.length - 1; s++) segments.push({ start: s, end: s + 1 });

    const label = target.originalIndex + 1;
    const vector = figma.createVector();
    vector.name = targetNodeIds.length === 1 ? baseName : `${baseName} ${label}`;
    vector.x = minX;
    vector.y = minY;
    vector.resize(bboxWidth, bboxHeight);

    await (vector as unknown as {
      setVectorNetworkAsync: (network: Record<string, unknown>) => Promise<void>;
    }).setVectorNetworkAsync({ vertices, segments, regions: [] });

    vector.fills = [];
    vector.strokes = [strokeStyle];
    vector.strokeWeight = strokeWeight;
    vector.strokeJoin = "MITER";

    if (parentNode) {
      parentNode.appendChild(vector);
      if (parentBounds) {
        vector.x = minX - parentBounds.x;
        vector.y = minY - parentBounds.y;
      }
    } else {
      figma.currentPage.appendChild(vector);
    }

    resultMap[target.originalIndex] = {
      id: vector.id,
      name: vector.name,
      targetId: target.id,
      exitSide,
      exitOffset: exitOff,
    };
  }

  const connectors = targetNodeIds.map((_, i) => resultMap[i]);

  return {
    createdCount: connectors.length,
    connectors,
  };
}
