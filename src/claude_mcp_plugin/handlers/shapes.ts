// Shape creation handler functions for the Claude Figma MCP plugin.

import { parseSvgRootStroke, propagateStrokeToShapes } from '../utils/svg';
import { debugLog, parseNum } from '../utils/helpers';

// ---------------------------------------------------------------------------
// createEllipse
// ---------------------------------------------------------------------------

/**
 * Create an ellipse node in the Figma document.
 */
export async function createEllipse(params: Record<string, unknown>): Promise<unknown> {
  const paramsObj = params !== null && params !== undefined ? params : {};

  const x = paramsObj['x'] !== undefined ? (paramsObj['x'] as number) : 0;
  const y = paramsObj['y'] !== undefined ? (paramsObj['y'] as number) : 0;
  const width = paramsObj['width'] !== undefined ? (paramsObj['width'] as number) : 100;
  const height = paramsObj['height'] !== undefined ? (paramsObj['height'] as number) : 100;
  const name = paramsObj['name'] !== undefined ? (paramsObj['name'] as string) : 'Ellipse';
  const parentId = paramsObj['parentId'] as string | undefined;
  const fillColor =
    paramsObj['fillColor'] !== undefined
      ? (paramsObj['fillColor'] as Record<string, unknown>)
      : ({ r: 0.8, g: 0.8, b: 0.8, a: 1 } as Record<string, unknown>);
  const strokeColor = paramsObj['strokeColor'] as Record<string, unknown> | undefined;
  const strokeWeight = paramsObj['strokeWeight'] as number | undefined;
  const layoutPositioning = paramsObj['layoutPositioning'] as string | undefined;

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
      type: 'SOLID',
      color: {
        r: parseNum(fillColor['r'], 0),
        g: parseNum(fillColor['g'], 0),
        b: parseNum(fillColor['b'], 0),
      },
      opacity: parseNum(fillColor['a'], 1),
    };
    ellipse.fills = [fillStyle];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    const strokeStyle: SolidPaint = {
      type: 'SOLID',
      color: {
        r: parseNum(strokeColor['r'], 0),
        g: parseNum(strokeColor['g'], 0),
        b: parseNum(strokeColor['b'], 0),
      },
      opacity: parseNum(strokeColor['a'], 1),
    };
    ellipse.strokes = [strokeStyle];

    if (strokeWeight) {
      ellipse.strokeWeight = strokeWeight;
    }
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!('appendChild' in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    (parentNode as ChildrenMixin).appendChild(ellipse);
  } else {
    figma.currentPage.appendChild(ellipse);
  }

  // Set layoutPositioning after appendChild (node must be attached first)
  if (layoutPositioning !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ellipse as any).layoutPositioning = layoutPositioning;
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

  const x = paramsObj['x'] !== undefined ? (paramsObj['x'] as number) : 0;
  const y = paramsObj['y'] !== undefined ? (paramsObj['y'] as number) : 0;
  const width = paramsObj['width'] !== undefined ? (paramsObj['width'] as number) : 100;
  const height = paramsObj['height'] !== undefined ? (paramsObj['height'] as number) : 100;
  const sides = paramsObj['sides'] !== undefined ? (paramsObj['sides'] as number) : 6;
  const name = paramsObj['name'] !== undefined ? (paramsObj['name'] as string) : 'Polygon';
  const parentId = paramsObj['parentId'] as string | undefined;
  const fillColor = paramsObj['fillColor'] as Record<string, unknown> | undefined;
  const strokeColor = paramsObj['strokeColor'] as Record<string, unknown> | undefined;
  const strokeWeight = paramsObj['strokeWeight'] as number | undefined;

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
      type: 'SOLID',
      color: {
        r: parseNum(fillColor['r'], 0),
        g: parseNum(fillColor['g'], 0),
        b: parseNum(fillColor['b'], 0),
      },
      opacity: parseNum(fillColor['a'], 1),
    };
    polygon.fills = [paintStyle];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    const strokeStyle: SolidPaint = {
      type: 'SOLID',
      color: {
        r: parseNum(strokeColor['r'], 0),
        g: parseNum(strokeColor['g'], 0),
        b: parseNum(strokeColor['b'], 0),
      },
      opacity: parseNum(strokeColor['a'], 1),
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
    if (!('appendChild' in parentNode)) {
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

  const x = paramsObj['x'] !== undefined ? (paramsObj['x'] as number) : 0;
  const y = paramsObj['y'] !== undefined ? (paramsObj['y'] as number) : 0;
  const width = paramsObj['width'] !== undefined ? (paramsObj['width'] as number) : 100;
  const height = paramsObj['height'] !== undefined ? (paramsObj['height'] as number) : 100;
  const points = paramsObj['points'] !== undefined ? (paramsObj['points'] as number) : 5;
  // innerRadius: proportion of the outer radius (default 0.5)
  const innerRadius =
    paramsObj['innerRadius'] !== undefined ? (paramsObj['innerRadius'] as number) : 0.5;
  const name = paramsObj['name'] !== undefined ? (paramsObj['name'] as string) : 'Star';
  const parentId = paramsObj['parentId'] as string | undefined;
  const fillColor = paramsObj['fillColor'] as Record<string, unknown> | undefined;
  const strokeColor = paramsObj['strokeColor'] as Record<string, unknown> | undefined;
  const strokeWeight = paramsObj['strokeWeight'] as number | undefined;

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
      type: 'SOLID',
      color: {
        r: parseNum(fillColor['r'], 0),
        g: parseNum(fillColor['g'], 0),
        b: parseNum(fillColor['b'], 0),
      },
      opacity: parseNum(fillColor['a'], 1),
    };
    star.fills = [paintStyle];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    const strokeStyle: SolidPaint = {
      type: 'SOLID',
      color: {
        r: parseNum(strokeColor['r'], 0),
        g: parseNum(strokeColor['g'], 0),
        b: parseNum(strokeColor['b'], 0),
      },
      opacity: parseNum(strokeColor['a'], 1),
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
    if (!('appendChild' in parentNode)) {
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

  const svgString = paramsObj['svgString'] as string | undefined;
  const x = paramsObj['x'] !== undefined ? (paramsObj['x'] as number) : 0;
  const y = paramsObj['y'] !== undefined ? (paramsObj['y'] as number) : 0;
  const name = paramsObj['name'] as string | undefined;
  const parentId = paramsObj['parentId'] as string | undefined;
  const flatten =
    paramsObj['flatten'] !== undefined ? (paramsObj['flatten'] as boolean) : false;

  if (!svgString) {
    throw new Error('Missing svgString parameter');
  }

  // Validate SVG string - must start with <svg or <?xml
  const trimmedSvg = svgString.trim();
  if (!trimmedSvg.startsWith('<svg') && !trimmedSvg.startsWith('<?xml')) {
    throw new Error('Invalid SVG: must start with <svg or <?xml declaration');
  }

  debugLog(`createSvg: Creating SVG node, flatten=${flatten}`);

  // Create node from SVG string
  let svgNode: FrameNode | VectorNode;
  try {
    svgNode = figma.createNodeFromSvg(svgString);
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
  const rootStroke = parseSvgRootStroke(svgString);
  if (rootStroke) {
    propagateStrokeToShapes(svgNode as SceneNode, rootStroke);
    // Clear any stroke that was incorrectly placed on the root frame
    if ('strokes' in svgNode) {
      (svgNode as GeometryMixin).strokes = [];
    }
  }

  // Flatten to single vector if requested
  if (flatten && 'children' in svgNode && (svgNode as FrameNode).children.length > 0) {
    try {
      const flattened = figma.flatten([svgNode as FrameNode]);
      svgNode = flattened as unknown as VectorNode;
      if (name) {
        svgNode.name = name;
      }
      debugLog('createSvg: Flattened SVG to single vector');
    } catch (flattenError) {
      console.warn(`createSvg: Could not flatten SVG: ${flattenError}`);
      // Continue with unflattened node
    }
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!('appendChild' in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    (parentNode as ChildrenMixin).appendChild(svgNode as SceneNode);

    // Icon/* frames are layout-only placeholder containers.
    // After inserting the SVG, clear any stroke that bled through from the JSX
    // border classes, and resize the SVG node to fill the parent frame exactly.
    const parentFrame = parentNode as FrameNode;
    if (parentFrame.name && parentFrame.name.indexOf('Icon/') === 0) {
      parentFrame.strokes = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (parentFrame as any).strokeWeight = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (parentFrame as any).strokeTopWeight = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (parentFrame as any).strokeBottomWeight = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (parentFrame as any).strokeLeftWeight = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (parentFrame as any).strokeRightWeight = 0;

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

  return {
    id: svgNode.id,
    name: svgNode.name,
    type: svgNode.type,
    x: svgNode.x,
    y: svgNode.y,
    width: svgNode.width,
    height: svgNode.height,
    childCount: 'children' in svgNode ? (svgNode as FrameNode).children.length : 0,
    parentId: svgNode.parent ? svgNode.parent.id : undefined,
  };
}

// ---------------------------------------------------------------------------
// createVector
// ---------------------------------------------------------------------------

/**
 * Create a vector node with custom paths in the Figma document.
 */
export async function createVector(params: Record<string, unknown>): Promise<unknown> {
  const paramsObj = params !== null && params !== undefined ? params : {};

  const x = paramsObj['x'] !== undefined ? (paramsObj['x'] as number) : 0;
  const y = paramsObj['y'] !== undefined ? (paramsObj['y'] as number) : 0;
  const width = paramsObj['width'] !== undefined ? (paramsObj['width'] as number) : 100;
  const height = paramsObj['height'] !== undefined ? (paramsObj['height'] as number) : 100;
  const name = paramsObj['name'] !== undefined ? (paramsObj['name'] as string) : 'Vector';
  const parentId = paramsObj['parentId'] as string | undefined;
  const vectorPaths =
    paramsObj['vectorPaths'] !== undefined
      ? (paramsObj['vectorPaths'] as Array<Record<string, unknown>>)
      : [];
  const fillColor = paramsObj['fillColor'] as Record<string, unknown> | undefined;
  const strokeColor = paramsObj['strokeColor'] as Record<string, unknown> | undefined;
  const strokeWeight = paramsObj['strokeWeight'] as number | undefined;

  // Create the vector
  const vector = figma.createVector();
  vector.x = x;
  vector.y = y;
  vector.resize(width, height);
  vector.name = name;

  // Set vector paths if provided
  if (vectorPaths && vectorPaths.length > 0) {
    vector.vectorPaths = vectorPaths.map(path => {
      return {
        windingRule:
          path['windingRule'] !== undefined
            ? (path['windingRule'] as VectorPath['windingRule'])
            : 'EVENODD',
        data: path['data'] !== undefined ? (path['data'] as string) : '',
      };
    });
  }

  // Set fill color if provided
  if (fillColor) {
    const paintStyle: SolidPaint = {
      type: 'SOLID',
      color: {
        r: parseNum(fillColor['r'], 0),
        g: parseNum(fillColor['g'], 0),
        b: parseNum(fillColor['b'], 0),
      },
      opacity: parseNum(fillColor['a'], 1),
    };
    vector.fills = [paintStyle];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    const strokeStyle: SolidPaint = {
      type: 'SOLID',
      color: {
        r: parseNum(strokeColor['r'], 0),
        g: parseNum(strokeColor['g'], 0),
        b: parseNum(strokeColor['b'], 0),
      },
      opacity: parseNum(strokeColor['a'], 1),
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
    if (!('appendChild' in parentNode)) {
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

  const x1 = paramsObj['x1'] !== undefined ? (paramsObj['x1'] as number) : 0;
  const y1 = paramsObj['y1'] !== undefined ? (paramsObj['y1'] as number) : 0;
  const x2 = paramsObj['x2'] !== undefined ? (paramsObj['x2'] as number) : 100;
  const y2 = paramsObj['y2'] !== undefined ? (paramsObj['y2'] as number) : 0;
  const name = paramsObj['name'] !== undefined ? (paramsObj['name'] as string) : 'Line';
  const parentId = paramsObj['parentId'] as string | undefined;
  const strokeColor =
    paramsObj['strokeColor'] !== undefined
      ? (paramsObj['strokeColor'] as Record<string, unknown>)
      : ({ r: 0, g: 0, b: 0, a: 1 } as Record<string, unknown>);
  const strokeWeight =
    paramsObj['strokeWeight'] !== undefined ? (paramsObj['strokeWeight'] as number) : 1;
  // strokeCap: can be "NONE", "ROUND", "SQUARE", "ARROW_LINES", or "ARROW_EQUILATERAL"
  const strokeCap =
    paramsObj['strokeCap'] !== undefined ? (paramsObj['strokeCap'] as string) : 'NONE';

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
      windingRule: 'NONZERO',
      data: pathData,
    },
  ];

  // Set stroke color
  const strokeStyle: SolidPaint = {
    type: 'SOLID',
    color: {
      r: parseNum(strokeColor['r'], 0),
      g: parseNum(strokeColor['g'], 0),
      b: parseNum(strokeColor['b'], 0),
    },
    opacity: parseNum(strokeColor['a'], 1),
  };
  line.strokes = [strokeStyle];

  // Set stroke weight
  line.strokeWeight = strokeWeight;

  // Set stroke cap style if supported
  const validStrokeCaps = ['NONE', 'ROUND', 'SQUARE', 'ARROW_LINES', 'ARROW_EQUILATERAL'];
  if (validStrokeCaps.includes(strokeCap)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (line as any).strokeCap = strokeCap;
  }

  // Set fill to none (transparent) as lines typically don't have fills
  line.fills = [];

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!('appendChild' in parentNode)) {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    strokeCap: (line as any).strokeCap,
    strokes: line.strokes,
    vectorPaths: line.vectorPaths,
    parentId: line.parent ? line.parent.id : undefined,
  };
}
