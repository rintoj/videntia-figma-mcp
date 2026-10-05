import {
  debugLog,
  sendProgressUpdate,
  uniqBy,
  delay,
  generateCommandId,
  parseNum,
  loadTextNodeFonts,
  describeError,
  absolutePosition,
} from "../utils/helpers";
import {
  fontStyleCandidates,
  matchFontStyle,
  listFontStylesForFamily,
  resolveAndLoadFontStyle,
  resolveAndLoadFontWeight,
  styleNameForWeight,
} from "../utils/font-style";
import { guardParentSize, resolveSideEffectAllowance, resolveStrict, snapshotParentSize } from "../utils/write-verify";
import { resolveColor } from "./fills";
import { resolveColorVariable } from "./icons";
import { validateGridTrackSizes, assertTrackSizesFit, applyGridTrackSizes, serializeGridTrackSizes } from "./layout";

// ---------------------------------------------------------------------------
// Text alignment helpers
// ---------------------------------------------------------------------------

const TEXT_ALIGN_HORIZONTAL = ["LEFT", "CENTER", "RIGHT", "JUSTIFIED"] as const;
const TEXT_ALIGN_VERTICAL = ["TOP", "CENTER", "BOTTOM"] as const;

function readTextAlign<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
  command: string,
): T | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`Invalid ${label} for ${command}: ${String(value)} (expected ${allowed.join(", ")})`);
  }
  return value as T;
}

// Font style resolution lives in utils/font-style (shared with composites and
// design-system); re-exported here for existing callers.
export { fontStyleCandidates, resolveAndLoadFontStyle };

// ---------------------------------------------------------------------------
// setCharacters helpers
// ---------------------------------------------------------------------------

const getDelimiterPos = (
  str: string,
  delimiter: string,
  startIdx: number = 0,
  endIdx: number = str.length,
): Array<[number, number]> => {
  const indices: Array<[number, number]> = [];
  let temp = startIdx;
  for (let i = startIdx; i < endIdx; i++) {
    if (str[i] === delimiter && i + startIdx !== endIdx && temp !== i + startIdx) {
      indices.push([temp, i + startIdx]);
      temp = i + startIdx + 1;
    }
  }
  if (temp !== endIdx) {
    indices.push([temp, endIdx]);
  }
  return indices.filter(Boolean) as Array<[number, number]>;
};

const buildLinearOrder = (node: TextNode): Array<{ family: string; style: string; delimiter: string }> => {
  const fontTree: Array<{
    start: number;
    delimiter: string;
    family: string;
    style: string;
  }> = [];
  const newLinesPos = getDelimiterPos(node.characters, "\n");
  newLinesPos.forEach(([newLinesRangeStart, newLinesRangeEnd]) => {
    const newLinesRangeFont = node.getRangeFontName(newLinesRangeStart, newLinesRangeEnd);
    if (newLinesRangeFont === figma.mixed) {
      const spacesPos = getDelimiterPos(node.characters, " ", newLinesRangeStart, newLinesRangeEnd);
      spacesPos.forEach(([spacesRangeStart, spacesRangeEnd]) => {
        const spacesRangeFont = node.getRangeFontName(spacesRangeStart, spacesRangeEnd);
        if (spacesRangeFont === figma.mixed) {
          const firstCharFont = node.getRangeFontName(spacesRangeStart, spacesRangeStart + 1);
          fontTree.push({
            start: spacesRangeStart,
            delimiter: " ",
            family: (firstCharFont as FontName).family,
            style: (firstCharFont as FontName).style,
          });
        } else {
          fontTree.push({
            start: spacesRangeStart,
            delimiter: " ",
            family: (spacesRangeFont as FontName).family,
            style: (spacesRangeFont as FontName).style,
          });
        }
      });
    } else {
      fontTree.push({
        start: newLinesRangeStart,
        delimiter: "\n",
        family: (newLinesRangeFont as FontName).family,
        style: (newLinesRangeFont as FontName).style,
      });
    }
  });
  return fontTree
    .sort((a, b) => +a.start - +b.start)
    .map(({ family, style, delimiter }) => ({ family, style, delimiter }));
};

const setCharactersWithStrictMatchFont = async (
  node: TextNode,
  characters: string,
  fallbackFont: FontName,
): Promise<boolean> => {
  const fontHashTree: Record<string, string> = {};
  for (let i = 1; i < node.characters.length; i++) {
    const startIdx = i - 1;
    const startCharFont = node.getRangeFontName(startIdx, i) as FontName;
    const startCharFontVal = `${startCharFont.family}::${startCharFont.style}`;
    while (i < node.characters.length) {
      i++;
      const charFont = node.getRangeFontName(i - 1, i) as FontName;
      if (startCharFontVal !== `${charFont.family}::${charFont.style}`) {
        break;
      }
    }
    fontHashTree[`${startIdx}_${i}`] = startCharFontVal;
  }
  await figma.loadFontAsync(fallbackFont);
  node.fontName = fallbackFont;
  node.characters = characters;
  debugLog(fontHashTree);
  await Promise.all(
    Object.keys(fontHashTree).map(async (range) => {
      debugLog(range, fontHashTree[range]);
      const [start, end] = range.split("_");
      const [family, style] = fontHashTree[range].split("::");
      const matchedFont: FontName = { family, style };
      await figma.loadFontAsync(matchedFont);
      return node.setRangeFontName(Number(start), Number(end), matchedFont);
    }),
  );
  return true;
};

const setCharactersWithSmartMatchFont = async (
  node: TextNode,
  characters: string,
  fallbackFont: FontName,
): Promise<boolean> => {
  const rangeTree = buildLinearOrder(node);
  const fontsToLoad = uniqBy(
    rangeTree,
    ({ family, style }: { family: string; style: string }) => `${family}::${style}`,
  ).map(({ family, style }: { family: string; style: string }) => ({
    family,
    style,
  }));

  await Promise.all([...fontsToLoad, fallbackFont].map((f) => figma.loadFontAsync(f)));

  node.fontName = fallbackFont;
  node.characters = characters;

  let prevPos = 0;
  rangeTree.forEach(({ family, style, delimiter }: { family: string; style: string; delimiter: string }) => {
    if (prevPos < node.characters.length) {
      const delimeterPos = node.characters.indexOf(delimiter, prevPos);
      const endPos = delimeterPos > prevPos ? delimeterPos : node.characters.length;
      const matchedFont: FontName = { family, style };
      node.setRangeFontName(prevPos, endPos, matchedFont);
      prevPos = endPos + 1;
    }
  });
  return true;
};

interface SetCharactersOptions {
  fallbackFont?: FontName;
  smartStrategy?: "prevail" | "strict" | "experimental";
}

export const setCharacters = async (
  node: TextNode,
  characters: string,
  options?: SetCharactersOptions,
): Promise<boolean> => {
  const fallbackFont: FontName =
    options !== null && options !== undefined && options.fallbackFont !== null && options.fallbackFont !== undefined
      ? options.fallbackFont
      : { family: "Inter", style: "Regular" };
  try {
    if (node.fontName === figma.mixed) {
      const smartStrategy = options !== null && options !== undefined ? options.smartStrategy : undefined;
      if (smartStrategy === "prevail") {
        const fontHashTree: Record<string, number> = {};
        for (let i = 1; i < node.characters.length; i++) {
          const charFont = node.getRangeFontName(i - 1, i) as FontName;
          const key = `${charFont.family}::${charFont.style}`;
          fontHashTree[key] = fontHashTree[key] ? fontHashTree[key] + 1 : 1;
        }
        const prevailedTreeItem = Object.entries(fontHashTree).sort((a, b) => b[1] - a[1])[0];
        const [family, style] = prevailedTreeItem[0].split("::");
        const prevailedFont: FontName = { family, style };
        await figma.loadFontAsync(prevailedFont);
        node.fontName = prevailedFont;
      } else if (smartStrategy === "strict") {
        return setCharactersWithStrictMatchFont(node, characters, fallbackFont);
      } else if (smartStrategy === "experimental") {
        return setCharactersWithSmartMatchFont(node, characters, fallbackFont);
      } else {
        const firstCharFont = node.getRangeFontName(0, 1) as FontName;
        await figma.loadFontAsync(firstCharFont);
        node.fontName = firstCharFont;
      }
    } else {
      await figma.loadFontAsync({
        family: (node.fontName as FontName).family,
        style: (node.fontName as FontName).style,
      });
    }
  } catch (err) {
    const fontFamily =
      typeof node.fontName === "object" && "family" in node.fontName ? (node.fontName as FontName).family : "";
    const fontStyle =
      typeof node.fontName === "object" && "style" in node.fontName ? (node.fontName as FontName).style : "";
    console.warn(
      `Failed to load "${fontFamily} ${fontStyle}" font and replaced with fallback "${fallbackFont.family} ${fallbackFont.style}"`,
      err,
    );
    await figma.loadFontAsync(fallbackFont);
    node.fontName = fallbackFont;
  }
  try {
    node.characters = characters;
    return true;
  } catch (err) {
    console.warn("Failed to set characters. Skipped.", err);
    return false;
  }
};

// ---------------------------------------------------------------------------
// Public: createText
// ---------------------------------------------------------------------------

export async function createText(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const x = safeParams.x !== undefined ? (safeParams.x as number) : 0;
  const y = safeParams.y !== undefined ? (safeParams.y as number) : 0;
  const text = safeParams.text !== undefined ? (safeParams.text as string) : "Text";
  const fontSize = safeParams.fontSize !== undefined ? (safeParams.fontSize as number) : 14;
  const fontFamily = safeParams.fontFamily !== undefined ? (safeParams.fontFamily as string) : "Inter";
  const fontWeight = safeParams.fontWeight !== undefined ? (safeParams.fontWeight as number) : 400;
  const fontColor =
    safeParams.fontColor !== null && safeParams.fontColor !== undefined
      ? (safeParams.fontColor as { r: number; g: number; b: number; a: number })
      : { r: 0, g: 0, b: 0, a: 1 };
  const name = safeParams.name !== undefined ? (safeParams.name as string) : "Text";
  const parentId = safeParams.parentId !== undefined ? (safeParams.parentId as string) : undefined;
  const rawWidth = safeParams.width !== null && safeParams.width !== undefined ? Number(safeParams.width) : undefined;
  if (rawWidth !== undefined && !(rawWidth > 0)) {
    throw new Error(`Invalid width for create_text: ${String(safeParams.width)} (must be a number > 0)`);
  }
  const width = rawWidth;
  const requestedAutoResize =
    safeParams.textAutoResize !== null && safeParams.textAutoResize !== undefined
      ? (safeParams.textAutoResize as string)
      : undefined;
  if (
    requestedAutoResize !== undefined &&
    requestedAutoResize !== "NONE" &&
    requestedAutoResize !== "HEIGHT" &&
    requestedAutoResize !== "WIDTH_AND_HEIGHT"
  ) {
    throw new Error(
      `Invalid textAutoResize for create_text: ${requestedAutoResize} (expected NONE, HEIGHT or WIDTH_AND_HEIGHT)`,
    );
  }
  // A width without an explicit mode means "wrap at this width": fixed width, height grows.
  const textAutoResize: "NONE" | "HEIGHT" | "WIDTH_AND_HEIGHT" | undefined =
    requestedAutoResize !== undefined
      ? (requestedAutoResize as "NONE" | "HEIGHT" | "WIDTH_AND_HEIGHT")
      : width !== undefined
        ? "HEIGHT"
        : undefined;
  const textAlignHorizontal = readTextAlign(
    safeParams.textAlignHorizontal,
    TEXT_ALIGN_HORIZONTAL,
    "textAlignHorizontal",
    "create_text",
  );
  const textAlignVertical = readTextAlign(
    safeParams.textAlignVertical,
    TEXT_ALIGN_VERTICAL,
    "textAlignVertical",
    "create_text",
  );

  // Resolve the face BEFORE creating the node: a failure here must not leave a
  // stray Figtree/Inter Regular text node behind. The old code swallowed the
  // load error, so a missing 600/700 face silently produced Regular text AND
  // dropped the requested fontSize (it was assigned after the throwing line).
  const requestedFontStyle =
    typeof safeParams.fontStyle === "string" && safeParams.fontStyle.trim() !== ""
      ? safeParams.fontStyle.trim()
      : styleNameForWeight(fontWeight);
  const resolvedStyle = await resolveAndLoadFontStyle(fontFamily, requestedFontStyle, "create_text");

  const textNode = figma.createText();
  textNode.x = x;
  textNode.y = y;
  textNode.name = name;
  textNode.fontName = { family: fontFamily, style: resolvedStyle };
  const requestedFontSize = Number(fontSize);
  if (!isFinite(requestedFontSize) || requestedFontSize <= 0) {
    throw new Error(`create_text: invalid fontSize ${JSON.stringify(fontSize)} — expected a positive number.`);
  }
  textNode.fontSize = requestedFontSize;
  await setCharacters(textNode, text, { fallbackFont: { family: fontFamily, style: resolvedStyle } });
  // setCharacters can replace the font when the node had mixed fonts; re-assert
  // the caller's intent so a success response is never a lie about either field.
  textNode.fontName = { family: fontFamily, style: resolvedStyle };
  textNode.fontSize = requestedFontSize;

  const paintStyle: SolidPaint = {
    type: "SOLID",
    color: {
      r: parseNum(fontColor.r, 0),
      g: parseNum(fontColor.g, 0),
      b: parseNum(fontColor.b, 0),
    },
    opacity: parseNum(fontColor.a, 1),
  };
  textNode.fills = [paintStyle];

  if (parentId !== null && parentId !== undefined) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    (parentNode as ChildrenMixin).appendChild(textNode);
  } else {
    figma.currentPage.appendChild(textNode);
  }

  // Resize after appending (so the parent's auto layout sees the final node), then
  // set textAutoResize last — resize() on a TEXT node forces textAutoResize to NONE.
  if (width !== undefined) {
    textNode.resize(width, Math.max(textNode.height, 1));
  }
  if (textAutoResize !== undefined) {
    textNode.textAutoResize = textAutoResize;
  }
  if (textAlignHorizontal !== undefined) {
    textNode.textAlignHorizontal = textAlignHorizontal;
  }
  if (textAlignVertical !== undefined) {
    textNode.textAlignVertical = textAlignVertical;
  }
  // Every field must be plain JSON. `fontSize` / `fontName` read back as `figma.mixed`
  // (a Symbol) on multi-style text, and `fills` is a live readonly proxy — returning
  // either across the plugin sandbox boundary fails the whole response with
  // "Cannot unwrap symbol", which is why `$result[N].id` could not resolve for a
  // batched create_text even though `id` itself was present.
  const resolvedFontSize = textNode.fontSize;
  const resolvedFontName = textNode.fontName;

  return {
    id: textNode.id,
    name: textNode.name,
    x: textNode.x,
    y: textNode.y,
    ...absolutePosition(textNode),
    width: textNode.width,
    height: textNode.height,
    textAutoResize: textNode.textAutoResize,
    textAlignHorizontal: textNode.textAlignHorizontal,
    textAlignVertical: textNode.textAlignVertical,
    characters: textNode.characters,
    fontSize: typeof resolvedFontSize === "number" ? resolvedFontSize : "MIXED",
    fontWeight: fontWeight,
    fontColor: { r: paintStyle.color.r, g: paintStyle.color.g, b: paintStyle.color.b, a: paintStyle.opacity },
    fontName:
      resolvedFontName !== null && typeof resolvedFontName === "object"
        ? { family: (resolvedFontName as FontName).family, style: (resolvedFontName as FontName).style }
        : "MIXED",
    fills: [{ type: "SOLID", color: { ...paintStyle.color }, opacity: paintStyle.opacity }],
    parentId: textNode.parent ? textNode.parent.id : undefined,
  };
}

// ---------------------------------------------------------------------------
// Public: setTextContent
// ---------------------------------------------------------------------------

export async function setTextContent(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const text = safeParams.text;

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (text === undefined) {
    throw new Error("Missing text parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    await setCharacters(node as TextNode, text as string);

    return {
      id: node.id,
      name: node.name,
      characters: (node as TextNode).characters,
      fontName: (node as TextNode).fontName,
    };
  } catch (error) {
    throw new Error(describeError(error));
  }
}

// ---------------------------------------------------------------------------
// Internal: collectNodesToProcess
// ---------------------------------------------------------------------------

interface NodeToProcess {
  node: SceneNode;
  parentPath: string[];
  depth: number;
}

async function collectNodesToProcess(
  node: SceneNode,
  parentPath: string[] = [],
  depth: number = 0,
  nodesToProcess: NodeToProcess[] = [],
): Promise<void> {
  if (node.visible === false) return;

  const nodePath = [...parentPath, node.name || `Unnamed ${node.type}`];

  nodesToProcess.push({ node, parentPath: nodePath, depth });

  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children) {
      await collectNodesToProcess(child as SceneNode, nodePath, depth + 1, nodesToProcess);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal: processTextNode
// ---------------------------------------------------------------------------

interface SafeTextNode {
  id: string;
  name: string;
  type: string;
  characters: string;
  fontSize: number;
  fontFamily: string;
  fontStyle: string;
  x: number;
  y: number;
  width: number;
  height: number;
  path: string;
  depth: number;
}

async function processTextNode(node: SceneNode, parentPath: string[], depth: number): Promise<SafeTextNode | null> {
  if (node.type !== "TEXT") return null;

  const textNode = node as TextNode;

  try {
    let fontFamily = "";
    let fontStyle = "";

    if (textNode.fontName) {
      if (typeof textNode.fontName === "object") {
        if ("family" in textNode.fontName) fontFamily = (textNode.fontName as FontName).family;
        if ("style" in textNode.fontName) fontStyle = (textNode.fontName as FontName).style;
      }
    }

    const safeTextNode: SafeTextNode = {
      id: textNode.id,
      name: textNode.name || "Text",
      type: textNode.type,
      characters: textNode.characters,
      fontSize: typeof textNode.fontSize === "number" ? textNode.fontSize : 0,
      fontFamily,
      fontStyle,
      x: typeof textNode.x === "number" ? textNode.x : 0,
      y: typeof textNode.y === "number" ? textNode.y : 0,
      width: typeof textNode.width === "number" ? textNode.width : 0,
      height: typeof textNode.height === "number" ? textNode.height : 0,
      path: parentPath.join(" > "),
      depth,
    };

    return safeTextNode;
  } catch (nodeErr) {
    console.error("Error processing text node:", nodeErr);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal: findTextNodes
// ---------------------------------------------------------------------------

async function findTextNodes(
  node: SceneNode,
  parentPath: string[] = [],
  depth: number = 0,
  textNodes: SafeTextNode[] = [],
): Promise<void> {
  if (node.visible === false) return;

  const nodePath = [...parentPath, node.name || `Unnamed ${node.type}`];

  if (node.type === "TEXT") {
    const textNode = node as TextNode;
    try {
      let fontFamily = "";
      let fontStyle = "";

      if (textNode.fontName) {
        if (typeof textNode.fontName === "object") {
          if ("family" in textNode.fontName) fontFamily = (textNode.fontName as FontName).family;
          if ("style" in textNode.fontName) fontStyle = (textNode.fontName as FontName).style;
        }
      }

      const safeTextNode: SafeTextNode = {
        id: textNode.id,
        name: textNode.name || "Text",
        type: textNode.type,
        characters: textNode.characters,
        fontSize: typeof textNode.fontSize === "number" ? textNode.fontSize : 0,
        fontFamily,
        fontStyle,
        x: typeof textNode.x === "number" ? textNode.x : 0,
        y: typeof textNode.y === "number" ? textNode.y : 0,
        width: typeof textNode.width === "number" ? textNode.width : 0,
        height: typeof textNode.height === "number" ? textNode.height : 0,
        path: nodePath.join(" > "),
        depth,
      };

      textNodes.push(safeTextNode);
    } catch (nodeErr) {
      console.error("Error processing text node:", nodeErr);
    }
  }

  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children) {
      await findTextNodes(child as SceneNode, nodePath, depth + 1, textNodes);
    }
  }
}

// ---------------------------------------------------------------------------
// Public: scanTextNodes
// ---------------------------------------------------------------------------

export async function scanTextNodes(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string;
  const useChunking = safeParams.useChunking !== undefined ? (safeParams.useChunking as boolean) : true;
  const chunkSize = safeParams.chunkSize !== undefined ? (safeParams.chunkSize as number) : 10;
  const commandId =
    safeParams.commandId !== null && safeParams.commandId !== undefined
      ? (safeParams.commandId as string)
      : generateCommandId();

  debugLog(`Starting to scan text nodes from node ID: ${nodeId}`);

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    console.error(`Node with ID ${nodeId} not found`);
    sendProgressUpdate(commandId, "scan_text_nodes", "error", 0, 0, 0, `Node with ID ${nodeId} not found`, {
      error: `Node not found: ${nodeId}`,
    });
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  if (!useChunking) {
    const textNodes: SafeTextNode[] = [];
    try {
      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "started",
        0,
        1,
        0,
        `Starting scan of node "${node.name || nodeId}" without chunking`,
        null,
      );

      await findTextNodes(node as SceneNode, [], 0, textNodes);

      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "completed",
        100,
        textNodes.length,
        textNodes.length,
        `Scan complete. Found ${textNodes.length} text nodes.`,
        { textNodes },
      );

      return {
        success: true,
        message: `Scanned ${textNodes.length} text nodes.`,
        count: textNodes.length,
        textNodes,
        commandId,
      };
    } catch (error) {
      console.error("Error scanning text nodes:", error);

      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "error",
        0,
        0,
        0,
        `Error scanning text nodes: ${(error as Error).message}`,
        { error: (error as Error).message },
      );

      throw new Error(`Error scanning text nodes: ${describeError(error)}`);
    }
  }

  debugLog(`Using chunked scanning with chunk size: ${chunkSize}`);

  const nodesToProcess: NodeToProcess[] = [];

  sendProgressUpdate(
    commandId,
    "scan_text_nodes",
    "started",
    0,
    0,
    0,
    `Starting chunked scan of node "${node.name || nodeId}"`,
    { chunkSize },
  );

  await collectNodesToProcess(node as SceneNode, [], 0, nodesToProcess);

  const totalNodes = nodesToProcess.length;
  debugLog(`Found ${totalNodes} total nodes to process`);

  const totalChunks = Math.ceil(totalNodes / chunkSize);
  debugLog(`Will process in ${totalChunks} chunks`);

  sendProgressUpdate(
    commandId,
    "scan_text_nodes",
    "in_progress",
    5,
    totalNodes,
    0,
    `Found ${totalNodes} nodes to scan. Will process in ${totalChunks} chunks.`,
    { totalNodes, totalChunks, chunkSize },
  );

  const allTextNodes: SafeTextNode[] = [];
  let processedNodes = 0;
  let chunksProcessed = 0;

  for (let i = 0; i < totalNodes; i += chunkSize) {
    const chunkEnd = Math.min(i + chunkSize, totalNodes);
    debugLog(`Processing chunk ${chunksProcessed + 1}/${totalChunks} (nodes ${i} to ${chunkEnd - 1})`);

    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "in_progress",
      Math.round(5 + (chunksProcessed / totalChunks) * 90),
      totalNodes,
      processedNodes,
      `Processing chunk ${chunksProcessed + 1}/${totalChunks}`,
      {
        currentChunk: chunksProcessed + 1,
        totalChunks,
        textNodesFound: allTextNodes.length,
      },
    );

    const chunkNodes = nodesToProcess.slice(i, chunkEnd);
    const chunkTextNodes: SafeTextNode[] = [];

    for (const nodeInfo of chunkNodes) {
      if (nodeInfo.node.type === "TEXT") {
        try {
          const textNodeInfo = await processTextNode(nodeInfo.node, nodeInfo.parentPath, nodeInfo.depth);
          if (textNodeInfo) {
            chunkTextNodes.push(textNodeInfo);
          }
        } catch (error) {
          console.error(`Error processing text node: ${(error as Error).message}`);
        }
      }

      await delay(5);
    }

    allTextNodes.push(...chunkTextNodes);
    processedNodes += chunkNodes.length;
    chunksProcessed++;

    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "in_progress",
      Math.round(5 + (chunksProcessed / totalChunks) * 90),
      totalNodes,
      processedNodes,
      `Processed chunk ${chunksProcessed}/${totalChunks}. Found ${allTextNodes.length} text nodes so far.`,
      {
        currentChunk: chunksProcessed,
        totalChunks,
        processedNodes,
        textNodesFound: allTextNodes.length,
        chunkResult: chunkTextNodes,
      },
    );

    if (i + chunkSize < totalNodes) {
      await delay(50);
    }
  }

  sendProgressUpdate(
    commandId,
    "scan_text_nodes",
    "completed",
    100,
    totalNodes,
    processedNodes,
    `Scan complete. Found ${allTextNodes.length} text nodes.`,
    { textNodes: allTextNodes, processedNodes, chunks: chunksProcessed },
  );

  return {
    success: true,
    message: `Chunked scan complete. Found ${allTextNodes.length} text nodes.`,
    totalNodes: allTextNodes.length,
    processedNodes,
    chunks: chunksProcessed,
    textNodes: allTextNodes,
    commandId,
  };
}

// ---------------------------------------------------------------------------
// Public: setMultipleTextContents
// ---------------------------------------------------------------------------

interface TextReplacement {
  nodeId: string;
  text: string;
}

export async function setMultipleTextContents(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const text = safeParams.text as TextReplacement[] | undefined;
  const commandId =
    safeParams.commandId !== null && safeParams.commandId !== undefined
      ? (safeParams.commandId as string)
      : generateCommandId();

  if (!nodeId || !text || !Array.isArray(text)) {
    const errorMsg = "Missing required parameters: nodeId and text array";

    sendProgressUpdate(commandId, "set_multiple_text_contents", "error", 0, 0, 0, errorMsg, { error: errorMsg });

    throw new Error(errorMsg);
  }

  debugLog(`Starting text replacement for node: ${nodeId} with ${text.length} text replacements`);

  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "started",
    0,
    text.length,
    0,
    `Starting text replacement for ${text.length} nodes`,
    { totalReplacements: text.length },
  );

  const results: Array<{
    success: boolean;
    nodeId: string;
    originalText?: string;
    translatedText?: string;
    error?: string;
  }> = [];
  let successCount = 0;
  let failureCount = 0;

  const CHUNK_SIZE = 5;
  const chunks: TextReplacement[][] = [];

  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }

  debugLog(`Split ${text.length} replacements into ${chunks.length} chunks`);

  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "in_progress",
    5,
    text.length,
    0,
    `Preparing to replace text in ${text.length} nodes using ${chunks.length} chunks`,
    {
      totalReplacements: text.length,
      chunks: chunks.length,
      chunkSize: CHUNK_SIZE,
    },
  );

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    debugLog(`Processing chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length} replacements`);

    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "in_progress",
      Math.round(5 + (chunkIndex / chunks.length) * 90),
      text.length,
      successCount + failureCount,
      `Processing text replacements chunk ${chunkIndex + 1}/${chunks.length}`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
      },
    );

    const chunkPromises = chunk.map(async (replacement) => {
      if (!replacement.nodeId || replacement.text === undefined) {
        console.error("Missing nodeId or text for replacement");
        return {
          success: false,
          nodeId: replacement.nodeId !== null && replacement.nodeId !== undefined ? replacement.nodeId : "unknown",
          error: "Missing nodeId or text in replacement entry",
        };
      }

      try {
        debugLog(`Attempting to replace text in node: ${replacement.nodeId}`);

        const textNode = await figma.getNodeByIdAsync(replacement.nodeId);

        if (!textNode) {
          console.error(`Text node not found: ${replacement.nodeId}`);
          return {
            success: false,
            nodeId: replacement.nodeId,
            error: `Node not found: ${replacement.nodeId}`,
          };
        }

        if (textNode.type !== "TEXT") {
          console.error(`Node is not a text node: ${replacement.nodeId} (type: ${textNode.type})`);
          return {
            success: false,
            nodeId: replacement.nodeId,
            error: `Node is not a text node: ${replacement.nodeId} (type: ${textNode.type})`,
          };
        }

        const originalText = (textNode as TextNode).characters;
        debugLog(`Original text: "${originalText}"`);
        debugLog(`Will translate to: "${replacement.text}"`);

        let originalFills: readonly Paint[] | undefined;
        try {
          originalFills = JSON.parse(JSON.stringify((textNode as TextNode).fills));
          (textNode as TextNode).fills = [
            {
              type: "SOLID",
              color: { r: 1, g: 0.5, b: 0 },
              opacity: 0.3,
            },
          ];
        } catch (highlightErr) {
          console.error(`Error highlighting text node: ${(highlightErr as Error).message}`);
        }

        await setTextContent({
          nodeId: replacement.nodeId,
          text: replacement.text,
        });

        if (originalFills !== null && originalFills !== undefined) {
          try {
            await delay(500);
            (textNode as TextNode).fills = originalFills as Paint[];
          } catch (restoreErr) {
            console.error(`Error restoring fills: ${(restoreErr as Error).message}`);
          }
        }

        debugLog(`Successfully replaced text in node: ${replacement.nodeId}`);
        return {
          success: true,
          nodeId: replacement.nodeId,
          originalText,
          translatedText: replacement.text,
        };
      } catch (error) {
        console.error(`Error replacing text in node ${replacement.nodeId}: ${(error as Error).message}`);
        return {
          success: false,
          nodeId: replacement.nodeId,
          error: `Error applying replacement: ${(error as Error).message}`,
        };
      }
    });

    const chunkResults = await Promise.all(chunkPromises);

    chunkResults.forEach((result) => {
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
      results.push(result);
    });

    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "in_progress",
      Math.round(5 + ((chunkIndex + 1) / chunks.length) * 90),
      text.length,
      successCount + failureCount,
      `Completed chunk ${chunkIndex + 1}/${chunks.length}. ${successCount} successful, ${failureCount} failed so far.`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
        chunkResults,
      },
    );

    if (chunkIndex < chunks.length - 1) {
      debugLog("Pausing between chunks to avoid overloading Figma...");
      await delay(1000);
    }
  }

  debugLog(`Replacement complete: ${successCount} successful, ${failureCount} failed`);

  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "completed",
    100,
    text.length,
    successCount + failureCount,
    `Text replacement complete: ${successCount} successful, ${failureCount} failed`,
    {
      totalReplacements: text.length,
      replacementsApplied: successCount,
      replacementsFailed: failureCount,
      completedInChunks: chunks.length,
      results,
    },
  );

  return {
    success: successCount > 0,
    nodeId,
    replacementsApplied: successCount,
    replacementsFailed: failureCount,
    totalReplacements: text.length,
    results,
    completedInChunks: chunks.length,
    commandId,
  };
}

// ---------------------------------------------------------------------------
// Public: setAutoLayout
// ---------------------------------------------------------------------------

export async function setAutoLayout(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  // Accept both 'layoutMode' (internal) and 'mode' (MCP tool alias)
  const layoutMode = (safeParams.layoutMode !== undefined ? safeParams.layoutMode : safeParams.mode) as
    | string
    | undefined;
  // Accept both full names and shorthand aliases from MCP tool
  const paddingTop = (safeParams.paddingTop !== undefined ? safeParams.paddingTop : safeParams.top) as
    | number
    | undefined;
  const paddingBottom = (safeParams.paddingBottom !== undefined ? safeParams.paddingBottom : safeParams.bottom) as
    | number
    | undefined;
  const paddingLeft = (safeParams.paddingLeft !== undefined ? safeParams.paddingLeft : safeParams.left) as
    | number
    | undefined;
  const paddingRight = (safeParams.paddingRight !== undefined ? safeParams.paddingRight : safeParams.right) as
    | number
    | undefined;
  const itemSpacing = (safeParams.itemSpacing !== undefined ? safeParams.itemSpacing : safeParams.gap) as
    | number
    | undefined;
  const primaryAxisAlignItems = safeParams.primaryAxisAlignItems as string | undefined;
  const counterAxisAlignItems = safeParams.counterAxisAlignItems as string | undefined;
  const layoutWrap = (safeParams.layoutWrap !== undefined ? safeParams.layoutWrap : safeParams.wrap) as
    | string
    | undefined;
  const strokesIncludedInLayout = safeParams.strokesIncludedInLayout as boolean | undefined;
  const clipsContent = safeParams.clipsContent as boolean | undefined;
  const layoutSizingHorizontal = (
    safeParams.layoutSizingHorizontal !== undefined ? safeParams.layoutSizingHorizontal : safeParams.horizontal
  ) as string | undefined;
  const layoutSizingVertical = (
    safeParams.layoutSizingVertical !== undefined ? safeParams.layoutSizingVertical : safeParams.vertical
  ) as string | undefined;

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (!layoutMode) {
    throw new Error("Missing layoutMode parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("layoutMode" in node)) {
    throw new Error(`Node does not support auto layout: ${nodeId}`);
  }

  const frameNode = node as FrameNode;
  const gridRowSizes = validateGridTrackSizes(
    safeParams.gridRowSizes !== undefined ? safeParams.gridRowSizes : safeParams.rowSizes,
    "rowSizes",
  );
  const gridColumnSizes = validateGridTrackSizes(
    safeParams.gridColumnSizes !== undefined ? safeParams.gridColumnSizes : safeParams.columnSizes,
    "columnSizes",
  );
  if (layoutMode !== "GRID" && (gridRowSizes || gridColumnSizes)) {
    throw new Error(`rowSizes/columnSizes apply to GRID mode only (mode is ${layoutMode}). No changes were made.`);
  }
  if (layoutMode === "GRID") {
    const rowsParam = (safeParams.gridRowCount !== undefined ? safeParams.gridRowCount : safeParams.rows) as
      | number
      | undefined;
    const columnsParam = (
      safeParams.gridColumnCount !== undefined ? safeParams.gridColumnCount : safeParams.columns
    ) as number | undefined;
    assertTrackSizesFit(frameNode, gridRowSizes, rowsParam, "rowSizes");
    assertTrackSizesFit(frameNode, gridColumnSizes, columnsParam, "columnSizes");
  }

  // Snapshot every child's sizing BEFORE touching layoutMode. Figma resets a
  // child's layoutGrow/layoutAlign/layoutSizing* (collapsing fixed-size buttons
  // to ~20px and body frames to their hug height) as a side effect of the
  // parent gaining or changing auto layout — damage the caller never asked for.
  interface ChildSizingSnapshot {
    id: string;
    name: string;
    horizontal?: string;
    vertical?: string;
    width: number;
    height: number;
  }
  // Bug #9: writing layoutSizing* on this frame can make ITS auto-layout parent
  // recompute a hug size and silently shrink. Snapshot before any mutation.
  const parentSnapshot = snapshotParentSize(frameNode.parent);

  const childSnapshots: ChildSizingSnapshot[] = [];
  if ("children" in frameNode) {
    const kids = frameNode.children;
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[i] as SceneNode & { layoutSizingHorizontal?: string; layoutSizingVertical?: string };
      childSnapshots.push({
        id: kid.id,
        name: kid.name,
        horizontal: "layoutSizingHorizontal" in kid ? (kid.layoutSizingHorizontal as string) : undefined,
        vertical: "layoutSizingVertical" in kid ? (kid.layoutSizingVertical as string) : undefined,
        width: "width" in kid ? (kid as SceneNode & { width: number }).width : 0,
        height: "height" in kid ? (kid as SceneNode & { height: number }).height : 0,
      });
    }
  }

  // Capture before mutating: drives whether we touch layoutSizing* below, and
  // guards against reassigning layoutMode to its current value — Figma resets
  // layoutSizingHorizontal/Vertical (and thus item spacing/padding rendering)
  // as a side effect of ANY layoutMode write, even a same-value one.
  const wasAutoLayout = frameNode.layoutMode !== "NONE";

  if (layoutMode === "NONE") {
    if (frameNode.layoutMode !== "NONE") {
      frameNode.layoutMode = "NONE";
    }
  } else {
    // Mode must be assigned before the grid track counts — they are only writable
    // once the frame is actually a grid.
    if (frameNode.layoutMode !== layoutMode) {
      frameNode.layoutMode = layoutMode as "HORIZONTAL" | "VERTICAL" | "GRID";
    }

    if (paddingTop !== undefined) frameNode.paddingTop = paddingTop;
    if (paddingBottom !== undefined) frameNode.paddingBottom = paddingBottom;
    if (paddingLeft !== undefined) frameNode.paddingLeft = paddingLeft;
    if (paddingRight !== undefined) frameNode.paddingRight = paddingRight;

    if (layoutMode === "GRID") {
      // itemSpacing is inert on grids, and flex alignment/wrap do not apply —
      // gaps live on gridRowGap/gridColumnGap and alignment maps to placement.
      // Accept both full names and the MCP tool's shorthand aliases, as above.
      const gridRowCount = (safeParams.gridRowCount !== undefined ? safeParams.gridRowCount : safeParams.rows) as
        | number
        | undefined;
      const gridColumnCount = (
        safeParams.gridColumnCount !== undefined ? safeParams.gridColumnCount : safeParams.columns
      ) as number | undefined;
      const gridRowGap = (safeParams.gridRowGap !== undefined ? safeParams.gridRowGap : safeParams.rowGap) as
        | number
        | undefined;
      const gridColumnGap = (
        safeParams.gridColumnGap !== undefined ? safeParams.gridColumnGap : safeParams.columnGap
      ) as number | undefined;
      const gridAutoTracks = safeParams.gridAutoTracks as string | undefined;
      const gridItemsPositioning = safeParams.gridItemsPositioning as string | undefined;

      // gridAutoTracks must be set before gridRowCount/gridColumnCount when set
      // to "ROWS": Figma throws if you write gridRowCount while auto-tracking
      // rows, since the count becomes automatically managed.
      if (gridAutoTracks !== undefined) frameNode.gridAutoTracks = gridAutoTracks as "NONE" | "ROWS";
      if (gridItemsPositioning !== undefined) {
        frameNode.gridItemsPositioning = gridItemsPositioning as "MANUAL" | "ROW_AUTO_FLOW";
      }
      if (gridRowCount !== undefined) frameNode.gridRowCount = gridRowCount;
      if (gridColumnCount !== undefined) frameNode.gridColumnCount = gridColumnCount;
      // Track sizes index into the tracks, so they go after the counts.
      applyGridTrackSizes(frameNode, gridRowSizes, gridColumnSizes);

      // `gap` is the CSS shorthand: it sets both axes unless a per-axis value wins.
      if (itemSpacing !== undefined) {
        frameNode.gridRowGap = itemSpacing;
        frameNode.gridColumnGap = itemSpacing;
      }
      if (gridRowGap !== undefined) frameNode.gridRowGap = gridRowGap;
      if (gridColumnGap !== undefined) frameNode.gridColumnGap = gridColumnGap;
    } else {
      if (itemSpacing !== undefined) frameNode.itemSpacing = itemSpacing;

      if (primaryAxisAlignItems !== undefined) {
        frameNode.primaryAxisAlignItems = primaryAxisAlignItems as "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
      }

      if (counterAxisAlignItems !== undefined) {
        frameNode.counterAxisAlignItems = counterAxisAlignItems as "MIN" | "CENTER" | "MAX" | "BASELINE";
      }

      if (layoutWrap !== undefined) {
        frameNode.layoutWrap = layoutWrap as "NO_WRAP" | "WRAP";
      }
    }

    if (strokesIncludedInLayout !== undefined) {
      frameNode.strokesIncludedInLayout = strokesIncludedInLayout;
    }

    // Only touch layoutSizing* when the caller explicitly asked for it, or when
    // this frame is newly gaining auto-layout (was NONE before this call) and
    // therefore has no meaningful existing sizing state to preserve. Applying a
    // default on every call — including ones that only touch padding/spacing —
    // silently overwrites whatever set_layout_sizing had already set.
    if (layoutSizingHorizontal !== null && layoutSizingHorizontal !== undefined) {
      frameNode.layoutSizingHorizontal = layoutSizingHorizontal as "FIXED" | "HUG" | "FILL";
    } else if (!wasAutoLayout) {
      // FILL is only valid for children of auto-layout frames; default to FIXED otherwise.
      const parentIsAutoLayout =
        frameNode.parent !== null &&
        frameNode.parent !== undefined &&
        "layoutMode" in frameNode.parent &&
        (frameNode.parent as FrameNode).layoutMode !== "NONE";
      frameNode.layoutSizingHorizontal = parentIsAutoLayout ? "FILL" : "FIXED";
    }

    if (layoutSizingVertical !== null && layoutSizingVertical !== undefined) {
      frameNode.layoutSizingVertical = layoutSizingVertical as "FIXED" | "HUG" | "FILL";
    } else if (!wasAutoLayout) {
      frameNode.layoutSizingVertical = "HUG";
    }
  }

  // Clipping is independent of auto layout, so it applies for every mode including NONE.
  if (clipsContent !== undefined) {
    frameNode.clipsContent = clipsContent;
  }

  // Restore each child's pre-call sizing. `preserveChildSizing: false` opts out
  // for callers who genuinely want Figma's defaults.
  const childWarnings: string[] = [];
  if (safeParams.preserveChildSizing !== false && childSnapshots.length > 0) {
    for (let i = 0; i < childSnapshots.length; i++) {
      const snap = childSnapshots[i];
      const kid = (frameNode.children as readonly SceneNode[])[i] as SceneNode & {
        layoutSizingHorizontal?: string;
        layoutSizingVertical?: string;
        width?: number;
        height?: number;
      };
      if (!kid || kid.id !== snap.id) continue;
      const axes: Array<["layoutSizingHorizontal" | "layoutSizingVertical", string | undefined, number]> = [
        ["layoutSizingHorizontal", snap.horizontal, snap.width],
        ["layoutSizingVertical", snap.vertical, snap.height],
      ];
      for (let a = 0; a < axes.length; a++) {
        const [prop, wanted, originalSize] = axes[a];
        if (wanted === undefined || !(prop in kid)) continue;
        if ((kid as unknown as Record<string, unknown>)[prop] === wanted) continue;
        try {
          (kid as unknown as Record<string, unknown>)[prop] = wanted;
        } catch {
          // fall through to the warning below
        }
        const actual = (kid as unknown as Record<string, unknown>)[prop];
        if (actual !== wanted) {
          childWarnings.push(
            `set_auto_layout changed child "${snap.name}" (${snap.id}) ${prop} from ${wanted} to ` +
              `${String(actual)} and Figma refused to restore it — this frame's layout forces it. ` +
              `Original size was ${snap.width}x${snap.height}; resize_node it if that matters.`,
          );
        }
      }
    }
  }

  const parentReport = guardParentSize(parentSnapshot, {
    label: "set_auto_layout",
    strict: resolveStrict(safeParams),
    childName: frameNode.name,
    allowSideEffects: resolveSideEffectAllowance(safeParams),
  });
  const allWarnings = childWarnings.concat(parentReport.warnings);

  return {
    id: frameNode.id,
    name: frameNode.name,
    ...(allWarnings.length > 0
      ? { success: childWarnings.length === 0 && parentReport.noops.length === 0 ? true : false, warnings: allWarnings }
      : {}),
    ...(parentReport.acknowledged !== undefined && parentReport.acknowledged.length > 0
      ? { acknowledgedSideEffects: parentReport.acknowledged }
      : {}),
    layoutMode: frameNode.layoutMode,
    paddingTop: frameNode.paddingTop,
    paddingBottom: frameNode.paddingBottom,
    paddingLeft: frameNode.paddingLeft,
    paddingRight: frameNode.paddingRight,
    itemSpacing: frameNode.itemSpacing,
    primaryAxisAlignItems: frameNode.primaryAxisAlignItems,
    counterAxisAlignItems: frameNode.counterAxisAlignItems,
    layoutWrap: frameNode.layoutWrap,
    ...(frameNode.layoutMode === "GRID"
      ? {
          gridRowCount: frameNode.gridRowCount,
          gridColumnCount: frameNode.gridColumnCount,
          gridRowGap: frameNode.gridRowGap,
          gridColumnGap: frameNode.gridColumnGap,
          gridAutoTracks: frameNode.gridAutoTracks,
          gridItemsPositioning: frameNode.gridItemsPositioning,
          ...(gridRowSizes ? { gridRowSizes: serializeGridTrackSizes(frameNode.gridRowSizes) } : {}),
          ...(gridColumnSizes ? { gridColumnSizes: serializeGridTrackSizes(frameNode.gridColumnSizes) } : {}),
        }
      : {}),
    strokesIncludedInLayout: frameNode.strokesIncludedInLayout,
    clipsContent: frameNode.clipsContent,
    layoutSizingHorizontal: frameNode.layoutSizingHorizontal,
    layoutSizingVertical: frameNode.layoutSizingVertical,
  };
}

// ---------------------------------------------------------------------------
// Public: setFontName
// ---------------------------------------------------------------------------

export async function setFontName(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const family = safeParams.family as string | undefined;
  const rawStyle =
    safeParams.style !== null && safeParams.style !== undefined ? (safeParams.style as string) : "Regular";
  if (!nodeId || !family) {
    throw new Error("Missing nodeId or font family");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  // Try every spelling of the requested face ("SemiBold" AND "Semi Bold", …) and
  // use whichever the family actually ships; error naming the real styles if none.
  const style = await resolveAndLoadFontStyle(family, rawStyle, "set_font_name");
  (node as TextNode).fontName = { family, style };
  return {
    id: node.id,
    name: node.name,
    fontName: (node as TextNode).fontName,
    requestedStyle: rawStyle,
    resolvedStyle: style,
  };
}

// ---------------------------------------------------------------------------
// Public: setFontSize
// ---------------------------------------------------------------------------

export async function setFontSize(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const fontSize = safeParams.fontSize;

  if (!nodeId || fontSize === undefined) {
    throw new Error("Missing nodeId or fontSize");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    await figma.loadFontAsync((node as TextNode).fontName as FontName);
    (node as TextNode).fontSize = fontSize as number;
    return {
      id: node.id,
      name: node.name,
      fontSize: (node as TextNode).fontSize,
    };
  } catch (error) {
    throw new Error(describeError(error));
  }
}

// ---------------------------------------------------------------------------
// Public: setFontWeight
// ---------------------------------------------------------------------------

export async function setFontWeight(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const weight = safeParams.weight;

  if (!nodeId || weight === undefined) {
    throw new Error("Missing nodeId or weight");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    // When the node has mixed fonts across segments, fontName returns figma.mixed.
    // Fall back to the font of the first character range.
    const rawFontName = (node as TextNode).fontName;
    const family =
      rawFontName === figma.mixed ? ((node as TextNode).getRangeFontName(0, 1) as FontName) : (rawFontName as FontName);
    const resolvedFamily = (family as FontName).family;
    // Match the weight against the family's real style names ("Semi Bold",
    // "SemiBold", "Semibold", "DemiBold" all mean 600).
    const style = await resolveAndLoadFontWeight(
      resolvedFamily,
      weight as number,
      `set_font_weight (weight ${weight})`,
    );
    (node as TextNode).fontName = { family: resolvedFamily, style };
    return {
      id: node.id,
      name: node.name,
      fontName: (node as TextNode).fontName,
      weight,
    };
  } catch (error) {
    throw new Error(describeError(error));
  }
}

// ---------------------------------------------------------------------------
// Public: setLetterSpacing
// ---------------------------------------------------------------------------

export async function setLetterSpacing(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const letterSpacing = safeParams.letterSpacing;
  const unit = safeParams.unit !== null && safeParams.unit !== undefined ? (safeParams.unit as string) : "PIXELS";

  if (!nodeId || letterSpacing === undefined) {
    throw new Error("Missing nodeId or letterSpacing");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    const lsFontName = (node as TextNode).fontName;
    const lsFont =
      lsFontName === figma.mixed ? ((node as TextNode).getRangeFontName(0, 1) as FontName) : (lsFontName as FontName);
    await figma.loadFontAsync(lsFont);
    (node as TextNode).letterSpacing = {
      value: letterSpacing as number,
      unit: unit as LetterSpacing["unit"],
    };
    return {
      id: node.id,
      name: node.name,
      letterSpacing: (node as TextNode).letterSpacing,
    };
  } catch (error) {
    throw new Error(describeError(error));
  }
}

// ---------------------------------------------------------------------------
// Public: setLineHeight
// ---------------------------------------------------------------------------

export async function setLineHeight(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const lineHeight = safeParams.lineHeight;
  const unit = safeParams.unit !== null && safeParams.unit !== undefined ? (safeParams.unit as string) : "PIXELS";

  if (!nodeId || lineHeight === undefined) {
    throw new Error("Missing nodeId or lineHeight");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    const lhFontName = (node as TextNode).fontName;
    const lhFont =
      lhFontName === figma.mixed ? ((node as TextNode).getRangeFontName(0, 1) as FontName) : (lhFontName as FontName);
    await figma.loadFontAsync(lhFont);
    (node as TextNode).lineHeight = {
      value: lineHeight as number,
      unit: unit as LineHeight["unit"],
    };
    return {
      id: node.id,
      name: node.name,
      lineHeight: (node as TextNode).lineHeight,
    };
  } catch (error) {
    throw new Error(describeError(error));
  }
}

// ---------------------------------------------------------------------------
// Public: setParagraphSpacing
// ---------------------------------------------------------------------------

export async function setParagraphSpacing(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const paragraphSpacing = safeParams.paragraphSpacing;

  if (!nodeId || paragraphSpacing === undefined) {
    throw new Error("Missing nodeId or paragraphSpacing");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    const psFontName = (node as TextNode).fontName;
    const psFont =
      psFontName === figma.mixed ? ((node as TextNode).getRangeFontName(0, 1) as FontName) : (psFontName as FontName);
    await figma.loadFontAsync(psFont);
    (node as TextNode).paragraphSpacing = paragraphSpacing as number;
    return {
      id: node.id,
      name: node.name,
      paragraphSpacing: (node as TextNode).paragraphSpacing,
    };
  } catch (error) {
    throw new Error(describeError(error));
  }
}

// ---------------------------------------------------------------------------
// Public: setTextCase
// ---------------------------------------------------------------------------

export async function setTextCase(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const textCase = safeParams.textCase;

  if (!nodeId || textCase === undefined) {
    throw new Error("Missing nodeId or textCase");
  }

  if (!["ORIGINAL", "UPPER", "LOWER", "TITLE"].includes(textCase as string)) {
    throw new Error("Invalid textCase value. Must be one of: ORIGINAL, UPPER, LOWER, TITLE");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    const tcFontName = (node as TextNode).fontName;
    const tcFont =
      tcFontName === figma.mixed ? ((node as TextNode).getRangeFontName(0, 1) as FontName) : (tcFontName as FontName);
    await figma.loadFontAsync(tcFont);
    (node as TextNode).textCase = textCase as TextCase;
    return {
      id: node.id,
      name: node.name,
      textCase: (node as TextNode).textCase,
    };
  } catch (error) {
    throw new Error(describeError(error));
  }
}

// ---------------------------------------------------------------------------
// Public: setTextWrapStyle
// ---------------------------------------------------------------------------

export async function setTextWrapStyle(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const textWrapStyle = safeParams.textWrapStyle;

  if (!nodeId || textWrapStyle === undefined) {
    throw new Error("Missing nodeId or textWrapStyle");
  }

  if (!["AUTO", "BALANCE", "PRETTY"].includes(textWrapStyle as string)) {
    throw new Error("Invalid textWrapStyle value. Must be one of: AUTO, BALANCE, PRETTY");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    const twsFontName = (node as TextNode).fontName;
    const twsFont =
      twsFontName === figma.mixed ? ((node as TextNode).getRangeFontName(0, 1) as FontName) : (twsFontName as FontName);
    await figma.loadFontAsync(twsFont);
    (node as TextNode).textWrapStyle = textWrapStyle as TextWrapStyle;
    return {
      id: node.id,
      name: node.name,
      textWrapStyle: (node as TextNode).textWrapStyle,
    };
  } catch (error) {
    throw new Error(describeError(error));
  }
}

// ---------------------------------------------------------------------------
// Public: setTextAlign
// ---------------------------------------------------------------------------

export async function setTextAlign(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const ids: string[] = [];
  const pushId = (value: unknown) => {
    if (typeof value === "string" && value && !ids.includes(value)) ids.push(value);
  };
  pushId(safeParams.nodeId);
  if (Array.isArray(safeParams.nodeIds)) safeParams.nodeIds.forEach(pushId);
  else pushId(safeParams.nodeIds);
  if (ids.length === 0) {
    throw new Error("set_text_align requires nodeId or nodeIds (at least one TEXT node)");
  }

  const horizontal = readTextAlign(
    safeParams.textAlignHorizontal ?? safeParams.horizontal ?? safeParams.align,
    TEXT_ALIGN_HORIZONTAL,
    "horizontal",
    "set_text_align",
  );
  const vertical = readTextAlign(
    safeParams.textAlignVertical ?? safeParams.vertical,
    TEXT_ALIGN_VERTICAL,
    "vertical",
    "set_text_align",
  );
  if (horizontal === undefined && vertical === undefined) {
    throw new Error("set_text_align requires horizontal and/or vertical alignment");
  }

  const results: Array<Record<string, unknown>> = [];
  for (const id of ids) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) {
      results.push({ nodeId: id, success: false, error: `Node not found with ID: ${id}` });
      continue;
    }
    if (node.type !== "TEXT") {
      results.push({
        nodeId: id,
        name: node.name,
        success: false,
        error: `Node is not a text node (type ${node.type})`,
      });
      continue;
    }
    const textNode = node as TextNode;
    try {
      await loadTextNodeFonts(textNode);
      if (horizontal !== undefined) textNode.textAlignHorizontal = horizontal;
      if (vertical !== undefined) textNode.textAlignVertical = vertical;
      const entry: Record<string, unknown> = {
        nodeId: id,
        name: textNode.name,
        success: true,
        textAlignHorizontal: textNode.textAlignHorizontal,
        textAlignVertical: textNode.textAlignVertical,
        textAutoResize: textNode.textAutoResize,
      };
      if (horizontal !== undefined && textNode.textAutoResize === "WIDTH_AND_HEIGHT") {
        entry.note =
          "Text hugs its content (textAutoResize WIDTH_AND_HEIGHT), so horizontal alignment has no visible effect until it has a fixed width or FILL sizing.";
      }
      results.push(entry);
    } catch (error) {
      results.push({
        nodeId: id,
        name: textNode.name,
        success: false,
        error: `Error setting text alignment: ${(error as Error).message}`,
      });
    }
  }

  const updated = results.filter((r) => r.success === true).length;
  return {
    success: updated === results.length,
    updated,
    failed: results.length - updated,
    results,
  };
}

// ---------------------------------------------------------------------------
// Public: setTextDecoration
// ---------------------------------------------------------------------------

export async function setTextDecoration(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const textDecoration = safeParams.textDecoration;

  if (!nodeId || textDecoration === undefined) {
    throw new Error("Missing nodeId or textDecoration");
  }

  if (!["NONE", "UNDERLINE", "STRIKETHROUGH"].includes(textDecoration as string)) {
    throw new Error("Invalid textDecoration value. Must be one of: NONE, UNDERLINE, STRIKETHROUGH");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    const tdFontName = (node as TextNode).fontName;
    const tdFont =
      tdFontName === figma.mixed ? ((node as TextNode).getRangeFontName(0, 1) as FontName) : (tdFontName as FontName);
    await figma.loadFontAsync(tdFont);
    (node as TextNode).textDecoration = textDecoration as TextDecoration;
    return {
      id: node.id,
      name: node.name,
      textDecoration: (node as TextNode).textDecoration,
    };
  } catch (error) {
    throw new Error(describeError(error));
  }
}

// ---------------------------------------------------------------------------
// Public: setTextRangeStyle
// ---------------------------------------------------------------------------

const RANGE_STYLE_PROPERTIES = [
  "color",
  "colorVariable",
  "fontFamily",
  "fontStyle",
  "fontWeight",
  "fontSize",
  "textStyle",
  "textDecoration",
  "letterSpacing",
  "lineHeight",
];
const RANGE_FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const RANGE_TEXT_DECORATIONS = ["NONE", "UNDERLINE", "STRIKETHROUGH"];

interface FontRun {
  start: number;
  end: number;
  font: FontName;
}

interface PreparedTextRange {
  start: number;
  end: number;
  color?: { r: number; g: number; b: number; a: number };
  variable?: Variable;
  textStyle?: TextStyle;
  fontFamily?: string;
  fontStyle?: string;
  fontSize?: number;
  textDecoration?: TextDecoration;
  letterSpacing?: LetterSpacing;
  lineHeight?: LineHeight;
}

interface RangeStyleLookups {
  variable(ref: string): Promise<Variable | null>;
  textStyle(ref: string): Promise<TextStyle | null>;
}

function isSet(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fontKey(font: FontName): string {
  return font.family + "::" + font.style;
}

/** Contiguous runs of one font inside [start, end). Scans per character only when the range is mixed. */
function getFontRuns(node: TextNode, start: number, end: number): FontRun[] {
  const whole = node.getRangeFontName(start, end);
  if (whole !== figma.mixed) {
    return [{ start, end, font: whole as FontName }];
  }
  const runs: FontRun[] = [];
  for (let i = start; i < end; i++) {
    const font = node.getRangeFontName(i, i + 1) as FontName;
    const last = runs.length > 0 ? runs[runs.length - 1] : undefined;
    if (last !== undefined && fontKey(last.font) === fontKey(font)) {
      last.end = i + 1;
    } else {
      runs.push({ start: i, end: i + 1, font: { family: font.family, style: font.style } });
    }
  }
  return runs;
}

function overrideFont(font: FontName, range: PreparedTextRange): FontName {
  return {
    family: range.fontFamily !== undefined ? range.fontFamily : font.family,
    style: range.fontStyle !== undefined ? range.fontStyle : font.style,
  };
}

/** overrideFont, with the style mapped onto the target family's real spelling. */
async function resolveOverrideFont(font: FontName, range: PreparedTextRange): Promise<FontName> {
  const target = overrideFont(font, range);
  const matched = matchFontStyle(target.style, await listFontStylesForFamily(target.family));
  return matched !== undefined ? { family: target.family, style: matched } : target;
}

function toFiniteNumber(value: unknown, label: string): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!isFinite(n)) {
    throw new Error(`${label} must be a number`);
  }
  return n;
}

function parseRangeLetterSpacing(value: unknown, label: string): LetterSpacing {
  if (typeof value === "object" && value !== null) {
    const spacing = value as Record<string, unknown>;
    const unit = isSet(spacing.unit) ? spacing.unit : "PIXELS";
    if (unit !== "PIXELS" && unit !== "PERCENT") {
      throw new Error(`${label}.unit must be PIXELS or PERCENT`);
    }
    return { value: toFiniteNumber(spacing.value, `${label}.value`), unit };
  }
  return { value: toFiniteNumber(value, label), unit: "PIXELS" };
}

function parseRangeLineHeight(value: unknown, label: string): LineHeight {
  if (
    value === "AUTO" ||
    (typeof value === "object" && value !== null && (value as { unit?: unknown }).unit === "AUTO")
  ) {
    return { unit: "AUTO" };
  }
  return parseRangeLetterSpacing(value, label);
}

/** Resolve a text style by id, exact name, or dash-to-slash normalized name. */
async function findTextStyle(ref: string, localStyles?: TextStyle[]): Promise<TextStyle | null> {
  let byId: BaseStyle | null = null;
  try {
    byId = await figma.getStyleByIdAsync(ref);
  } catch (_error) {
    byId = null;
  }
  if (byId && byId.type === "TEXT") {
    return byId as TextStyle;
  }
  const styles = localStyles !== undefined ? localStyles : await figma.getLocalTextStylesAsync();
  const exact = styles.find((s) => s.name === ref);
  if (exact) return exact;
  const normalized = ref.replace(/-/g, "/");
  if (normalized !== ref) {
    const match = styles.find((s) => s.name === normalized);
    if (match) return match;
  }
  return null;
}

function createRangeStyleLookups(): RangeStyleLookups {
  let localVariables: Variable[] | undefined;
  let localTextStyles: TextStyle[] | undefined;
  return {
    async variable(ref: string): Promise<Variable | null> {
      try {
        const byId = await figma.variables.getVariableByIdAsync(ref);
        if (byId && byId.resolvedType === "COLOR") return byId;
      } catch (_error) {
        // Not a variable id; fall back to name resolution.
      }
      if (localVariables === undefined) {
        localVariables = await figma.variables.getLocalVariablesAsync();
      }
      return resolveColorVariable(ref, localVariables);
    },
    async textStyle(ref: string): Promise<TextStyle | null> {
      if (localTextStyles === undefined) {
        localTextStyles = await figma.getLocalTextStylesAsync();
      }
      return findTextStyle(ref, localTextStyles);
    },
  };
}

async function prepareTextRange(
  raw: unknown,
  index: number,
  length: number,
  lookups: RangeStyleLookups,
): Promise<PreparedTextRange> {
  const label = `ranges[${index}]`;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} must be an object with start, end and at least one style property`);
  }
  const r = raw as Record<string, unknown>;
  const start = toFiniteNumber(r.start, `${label}.start`);
  const end = toFiniteNumber(r.end, `${label}.end`);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > length) {
    throw new Error(
      `${label}: invalid range [${String(r.start)}, ${String(r.end)}) — need integers with 0 <= start < end <= ${length} (text length)`,
    );
  }
  if (!RANGE_STYLE_PROPERTIES.some((key) => isSet(r[key]))) {
    throw new Error(`${label} sets no style; pass at least one of: ${RANGE_STYLE_PROPERTIES.join(", ")}`);
  }

  const range: PreparedTextRange = { start, end };

  if (isSet(r.color) && isSet(r.colorVariable)) {
    throw new Error(`${label}: pass color or colorVariable, not both`);
  }
  if (isSet(r.color)) {
    try {
      range.color = resolveColor({ color: r.color });
    } catch (error) {
      throw new Error(`${label}.color: ${errorMessage(error)}`);
    }
  }
  if (isSet(r.colorVariable)) {
    const ref = String(r.colorVariable);
    const variable = await lookups.variable(ref);
    if (!variable) {
      throw new Error(`${label}.colorVariable: COLOR variable not found: "${ref}"`);
    }
    range.variable = variable;
  }
  if (isSet(r.textStyle)) {
    const ref = String(r.textStyle);
    const style = await lookups.textStyle(ref);
    if (!style) {
      throw new Error(
        `${label}.textStyle: text style not found: "${ref}". Pass the style name (e.g. "Body/Medium") or id from get_text_styles`,
      );
    }
    range.textStyle = style;
  }
  if (isSet(r.fontFamily)) {
    if (typeof r.fontFamily !== "string" || r.fontFamily.trim() === "") {
      throw new Error(`${label}.fontFamily must be a non-empty string`);
    }
    range.fontFamily = r.fontFamily;
  }
  if (isSet(r.fontStyle)) {
    if (typeof r.fontStyle !== "string" || r.fontStyle.trim() === "") {
      throw new Error(`${label}.fontStyle must be a non-empty string`);
    }
    range.fontStyle = r.fontStyle;
  } else if (isSet(r.fontWeight)) {
    const weight = toFiniteNumber(r.fontWeight, `${label}.fontWeight`);
    if (RANGE_FONT_WEIGHTS.indexOf(weight) === -1) {
      throw new Error(`${label}.fontWeight must be one of ${RANGE_FONT_WEIGHTS.join(", ")}`);
    }
    range.fontStyle = styleNameForWeight(weight);
  }
  if (isSet(r.fontSize)) {
    const size = toFiniteNumber(r.fontSize, `${label}.fontSize`);
    if (size <= 0) {
      throw new Error(`${label}.fontSize must be greater than 0`);
    }
    range.fontSize = size;
  }
  if (isSet(r.textDecoration)) {
    if (RANGE_TEXT_DECORATIONS.indexOf(r.textDecoration as string) === -1) {
      throw new Error(`${label}.textDecoration must be one of: ${RANGE_TEXT_DECORATIONS.join(", ")}`);
    }
    range.textDecoration = r.textDecoration as TextDecoration;
  }
  if (isSet(r.letterSpacing)) {
    range.letterSpacing = parseRangeLetterSpacing(r.letterSpacing, `${label}.letterSpacing`);
  }
  if (isSet(r.lineHeight)) {
    range.lineHeight = parseRangeLineHeight(r.lineHeight, `${label}.lineHeight`);
  }
  return range;
}

async function applyTextRange(node: TextNode, range: PreparedTextRange): Promise<Record<string, unknown>> {
  const start = range.start;
  const end = range.end;
  const applied: Record<string, unknown> = {};

  // Text style first: it resets font, size and spacing, so explicit overrides below win.
  if (range.textStyle !== undefined) {
    await node.setRangeTextStyleIdAsync(start, end, range.textStyle.id);
    applied.textStyle = { id: range.textStyle.id, name: range.textStyle.name };
  }
  if (range.fontFamily !== undefined || range.fontStyle !== undefined) {
    const appliedFonts: FontName[] = [];
    for (const run of getFontRuns(node, start, end)) {
      const font = await resolveOverrideFont(run.font, range);
      // Already loaded in the validation pass unless an earlier overlapping range changed this run's font.
      await figma.loadFontAsync(font);
      node.setRangeFontName(run.start, run.end, font);
      if (!appliedFonts.some((f) => fontKey(f) === fontKey(font))) appliedFonts.push(font);
    }
    applied.fontName = appliedFonts.length === 1 ? appliedFonts[0] : appliedFonts;
  }
  if (range.fontSize !== undefined) {
    node.setRangeFontSize(start, end, range.fontSize);
    applied.fontSize = range.fontSize;
  }
  if (range.color !== undefined || range.variable !== undefined) {
    const base = range.color !== undefined ? range.color : { r: 0, g: 0, b: 0, a: 1 };
    let paint: SolidPaint = { type: "SOLID", color: { r: base.r, g: base.g, b: base.b }, opacity: base.a };
    if (range.variable !== undefined) {
      paint = figma.variables.setBoundVariableForPaint(paint, "color", range.variable);
      applied.colorVariable = { id: range.variable.id, name: range.variable.name };
    } else {
      applied.color = range.color;
    }
    node.setRangeFills(start, end, [paint]);
  }
  if (range.textDecoration !== undefined) {
    node.setRangeTextDecoration(start, end, range.textDecoration);
    applied.textDecoration = range.textDecoration;
  }
  if (range.letterSpacing !== undefined) {
    node.setRangeLetterSpacing(start, end, range.letterSpacing);
    applied.letterSpacing = range.letterSpacing;
  }
  if (range.lineHeight !== undefined) {
    node.setRangeLineHeight(start, end, range.lineHeight);
    applied.lineHeight = range.lineHeight;
  }
  return { start, end, characters: node.characters.slice(start, end), applied };
}

/**
 * Style character ranges of one text node. Every range is validated (bounds, colors,
 * variables, text styles) and every needed font is loaded before anything is mutated.
 */
export async function setTextRangeStyle(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const rawRanges = safeParams.ranges;

  if (!nodeId) {
    throw new Error("Missing nodeId");
  }
  if (!Array.isArray(rawRanges) || rawRanges.length === 0) {
    throw new Error("ranges must be a non-empty array of { start, end, ...style }");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }
  const textNode = node as TextNode;
  const length = textNode.characters.length;

  const lookups = createRangeStyleLookups();
  const ranges: PreparedTextRange[] = [];
  for (let i = 0; i < rawRanges.length; i++) {
    ranges.push(await prepareTextRange(rawRanges[i], i, length, lookups));
  }

  const fonts = new Map<string, FontName>();
  for (const range of ranges) {
    const changesFont = range.fontFamily !== undefined || range.fontStyle !== undefined;
    const existing = getFontRuns(textNode, range.start, range.end).map((run) => run.font);
    for (const font of existing) fonts.set(fontKey(font), font);
    const base = range.textStyle !== undefined ? [range.textStyle.fontName] : existing;
    for (const font of base) {
      fonts.set(fontKey(font), font);
      if (changesFont) {
        const target = await resolveOverrideFont(font, range);
        fonts.set(fontKey(target), target);
      }
    }
  }
  await Promise.all(
    Array.from(fonts.values()).map((font) =>
      figma.loadFontAsync(font).catch((error) => {
        throw new Error(
          `Font "${font.family} ${font.style}" could not be loaded (${errorMessage(error)}). Copy the exact style name from get_styled_text_segments or get_text_styles`,
        );
      }),
    ),
  );

  const results: Array<Record<string, unknown>> = [];
  for (let i = 0; i < ranges.length; i++) {
    try {
      results.push(await applyTextRange(textNode, ranges[i]));
    } catch (error) {
      throw new Error(`Error applying ranges[${i}] (${i} earlier range(s) already applied): ${errorMessage(error)}`);
    }
  }

  return {
    id: textNode.id,
    name: textNode.name,
    characters: length,
    ranges: results,
  };
}

// ---------------------------------------------------------------------------
// Public: getStyledTextSegments
// ---------------------------------------------------------------------------

export async function getStyledTextSegments(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const property = safeParams.property as string | undefined;

  if (!nodeId || !property) {
    throw new Error("Missing nodeId or property");
  }

  const validProperties = [
    "fillStyleId",
    "fontName",
    "fontSize",
    "textCase",
    "textDecoration",
    "textStyleId",
    "fills",
    "letterSpacing",
    "lineHeight",
    "fontWeight",
  ];

  if (!validProperties.includes(property)) {
    throw new Error(`Invalid property. Must be one of: ${validProperties.join(", ")}`);
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    type StyleField = keyof Omit<StyledTextSegment, "characters" | "start" | "end">;
    const segments = (node as TextNode).getStyledTextSegments([property as StyleField]);

    const safeSegments = segments.map((segment) => {
      const safeSegment: Record<string, unknown> = {
        characters: segment.characters,
        start: segment.start,
        end: segment.end,
      };

      if (property === "fontName") {
        const val = (segment as Record<string, unknown>)[property];
        if (val !== null && val !== undefined && typeof val === "object") {
          safeSegment[property] = {
            family: (val as FontName).family || "",
            style: (val as FontName).style || "",
          };
        } else {
          safeSegment[property] = { family: "", style: "" };
        }
      } else if (property === "letterSpacing" || property === "lineHeight") {
        const val = (segment as Record<string, unknown>)[property];
        if (val !== null && val !== undefined && typeof val === "object") {
          const typedVal = val as { value: number; unit: string };
          safeSegment[property] = {
            value: typedVal.value !== null && typedVal.value !== undefined ? typedVal.value : 0,
            unit:
              typedVal.unit !== null && typedVal.unit !== undefined && typedVal.unit !== "" ? typedVal.unit : "PIXELS",
          };
        } else {
          safeSegment[property] = { value: 0, unit: "PIXELS" };
        }
      } else if (property === "fills") {
        const val = (segment as Record<string, unknown>)[property];
        safeSegment[property] = val !== null && val !== undefined ? JSON.parse(JSON.stringify(val)) : [];
      } else {
        safeSegment[property] = (segment as Record<string, unknown>)[property];
      }

      return safeSegment;
    });

    return {
      id: node.id,
      name: node.name,
      property,
      segments: safeSegments,
    };
  } catch (error) {
    throw new Error(describeError(error));
  }
}

// ---------------------------------------------------------------------------
// Public: loadFontAsyncWrapper
// ---------------------------------------------------------------------------

export async function loadFontAsyncWrapper(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const family = safeParams.family as string | undefined;
  const style = safeParams.style !== null && safeParams.style !== undefined ? (safeParams.style as string) : "Regular";

  if (!family) {
    throw new Error("Missing font family");
  }

  // Bug #37: this used to surface "Error loading font: undefined" — Figma rejects
  // with a bare object, so `error.message` was undefined and the agent learned
  // nothing. Route through the shared resolver so the failure names the family,
  // the requested style, the spellings tried, and the styles that DO exist.
  const resolvedStyle = await resolveAndLoadFontStyle(family, style, "Error loading font");
  return {
    success: true,
    family,
    style: resolvedStyle,
    requestedStyle: style,
    message:
      resolvedStyle === style
        ? `Successfully loaded ${family} ${style}`
        : `Successfully loaded ${family} ${resolvedStyle} (requested "${style}")`,
  };
}

// ---------------------------------------------------------------------------
// Internal: applyTextStyleBindings
// Resolves a `bindings` map (field → variable id|name) and binds each entry on
// a TextStyle via setBoundVariable. Skips silently on per-field errors so a
// single bad binding doesn't fail the whole style creation; collects warnings.
// ---------------------------------------------------------------------------

async function applyTextStyleBindings(
  textStyle: TextStyle,
  bindings: Record<string, string> | undefined,
): Promise<{ applied: string[]; warnings: string[] }> {
  const applied: string[] = [];
  const warnings: string[] = [];
  if (!bindings) return { applied, warnings };

  let allVariables: Variable[] | null = null;

  for (const field of Object.keys(bindings)) {
    const ref = bindings[field];
    if (!ref) continue;
    let variable = await figma.variables.getVariableByIdAsync(ref);
    if (!variable) {
      if (!allVariables) {
        allVariables = await figma.variables.getLocalVariablesAsync();
      }
      variable =
        allVariables.find(function (v) {
          return v.name === ref;
        }) || null;
      if (!variable) {
        const normalized = ref.replace(/-/g, "/");
        if (normalized !== ref) {
          variable =
            allVariables.find(function (v) {
              return v.name === normalized;
            }) || null;
        }
      }
    }
    if (!variable) {
      warnings.push(`Variable not found for field "${field}": "${ref}"`);
      continue;
    }
    try {
      (
        textStyle as TextStyle & {
          setBoundVariable: (f: VariableBindableTextField, v: Variable | null) => void;
        }
      ).setBoundVariable(field as VariableBindableTextField, variable);
      applied.push(field);
    } catch (e) {
      warnings.push(
        `Failed to bind "${ref}" to "${field}": ${(e as Error).message}. Valid fields: fontFamily, fontStyle, fontSize, fontWeight, lineHeight, letterSpacing, paragraphSpacing, paragraphIndent.`,
      );
    }
  }

  return { applied, warnings };
}

// ---------------------------------------------------------------------------
// Public: createTextStyle
// ---------------------------------------------------------------------------

export async function createTextStyle(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const name = safeParams.name as string | undefined;
  const description = safeParams.description as string | undefined;
  const bindings = safeParams.bindings as Record<string, string> | undefined;

  if (!nodeId || !name) {
    throw new Error("Missing nodeId or name parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.type !== "TEXT") {
    throw new Error("Node is not a text node");
  }

  const textNode = node as TextNode;

  // Resolve mixed values by falling back to first character range
  const resolvedFontName: FontName =
    textNode.fontName === figma.mixed ? (textNode.getRangeFontName(0, 1) as FontName) : (textNode.fontName as FontName);
  const resolvedFontSize: number =
    textNode.fontSize === figma.mixed ? (textNode.getRangeFontSize(0, 1) as number) : (textNode.fontSize as number);
  const resolvedLetterSpacing: LetterSpacing =
    textNode.letterSpacing === figma.mixed
      ? (textNode.getRangeLetterSpacing(0, 1) as LetterSpacing)
      : (textNode.letterSpacing as LetterSpacing);
  const resolvedLineHeight: LineHeight =
    textNode.lineHeight === figma.mixed
      ? (textNode.getRangeLineHeight(0, 1) as LineHeight)
      : (textNode.lineHeight as LineHeight);
  const resolvedTextCase: TextCase =
    textNode.textCase === figma.mixed ? (textNode.getRangeTextCase(0, 1) as TextCase) : (textNode.textCase as TextCase);
  const resolvedTextDecoration: TextDecoration =
    textNode.textDecoration === figma.mixed
      ? (textNode.getRangeTextDecoration(0, 1) as TextDecoration)
      : (textNode.textDecoration as TextDecoration);
  const resolvedParagraphIndent: number =
    textNode.paragraphIndent === figma.mixed
      ? (textNode.getRangeParagraphIndent(0, 1) as number)
      : textNode.paragraphIndent;
  const resolvedParagraphSpacing: number =
    textNode.paragraphSpacing === figma.mixed
      ? (textNode.getRangeParagraphSpacing(0, 1) as number)
      : textNode.paragraphSpacing;

  try {
    // Load both the default new-style font (Inter Regular) and the resolved target font.
    // figma.createTextStyle() initialises with Inter Regular, so it must be loaded before
    // any property write on the new style object succeeds.
    await Promise.all([
      figma.loadFontAsync({ family: "Inter", style: "Regular" }),
      figma.loadFontAsync(resolvedFontName),
    ]);
  } catch (error) {
    throw new Error(
      `Font "${resolvedFontName.family} ${resolvedFontName.style}" is not available. Please ensure the font is installed.`,
    );
  }

  try {
    const textStyle = figma.createTextStyle();
    textStyle.name = name;
    if (description !== null && description !== undefined) {
      textStyle.description = description;
    }

    // Set fontName first so subsequent property writes use the correct loaded font
    textStyle.fontName = resolvedFontName;
    textStyle.fontSize = resolvedFontSize;
    textStyle.letterSpacing = resolvedLetterSpacing;
    textStyle.lineHeight = resolvedLineHeight;
    textStyle.paragraphIndent = resolvedParagraphIndent;
    textStyle.paragraphSpacing = resolvedParagraphSpacing;
    textStyle.textCase = resolvedTextCase;
    textStyle.textDecoration = resolvedTextDecoration;

    const { applied, warnings } = await applyTextStyleBindings(textStyle, bindings);

    return {
      id: textStyle.id,
      name: textStyle.name,
      key: textStyle.key,
      fontName: textStyle.fontName,
      fontSize: textStyle.fontSize,
      boundFields: applied,
      bindingWarnings: warnings,
    };
  } catch (error) {
    throw new Error(describeError(error));
  }
}

// ---------------------------------------------------------------------------
// Public: createTextStyleFromProperties
// ---------------------------------------------------------------------------

export async function createTextStyleFromProperties(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const name = safeParams.name as string | undefined;
  const fontSize = safeParams.fontSize as number | undefined;
  const fontFamily = safeParams.fontFamily as string | undefined;
  const fontStyle = safeParams.fontStyle as string | undefined;
  const fontWeight = safeParams.fontWeight as number | undefined;
  const lineHeight = safeParams.lineHeight as LineHeight | undefined;
  const letterSpacing = safeParams.letterSpacing as LetterSpacing | undefined;
  const textCase = safeParams.textCase as TextCase | undefined;
  const textDecoration = safeParams.textDecoration as TextDecoration | undefined;
  const textWrapStyle = safeParams.textWrapStyle as TextWrapStyle | undefined;
  const description = safeParams.description as string | undefined;
  const bindings = safeParams.bindings as Record<string, string> | undefined;

  if (!name || !fontSize || !fontFamily) {
    throw new Error("Missing required parameters: name, fontSize, or fontFamily");
  }

  const actualFontStyle = await resolveAndLoadFontStyle(
    fontFamily,
    fontStyle !== null && fontStyle !== undefined
      ? fontStyle
      : styleNameForWeight(fontWeight !== null && fontWeight !== undefined ? fontWeight : 400),
    "create_text_style_from_properties",
  );

  try {
    const textStyle = figma.createTextStyle();
    textStyle.name = name;
    if (description !== null && description !== undefined) {
      textStyle.description = description;
    }

    textStyle.fontSize = fontSize;
    textStyle.fontName = { family: fontFamily, style: actualFontStyle };

    if (lineHeight !== null && lineHeight !== undefined) {
      textStyle.lineHeight = lineHeight;
    }

    if (letterSpacing !== null && letterSpacing !== undefined) {
      textStyle.letterSpacing = letterSpacing;
    }

    if (textCase !== null && textCase !== undefined) {
      textStyle.textCase = textCase;
    }

    if (textDecoration !== null && textDecoration !== undefined) {
      textStyle.textDecoration = textDecoration;
    }

    if (textWrapStyle !== null && textWrapStyle !== undefined) {
      textStyle.textWrapStyle = textWrapStyle;
    }

    const { applied, warnings } = await applyTextStyleBindings(textStyle, bindings);

    return {
      id: textStyle.id,
      name: textStyle.name,
      key: textStyle.key,
      fontName: textStyle.fontName,
      fontSize: textStyle.fontSize,
      boundFields: applied,
      bindingWarnings: warnings,
    };
  } catch (error) {
    throw new Error(describeError(error));
  }
}

// ---------------------------------------------------------------------------
// Public: applyTextStyle
// ---------------------------------------------------------------------------

export async function applyTextStyle(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const styleId = safeParams.styleId as string | undefined;

  if (!nodeId || !styleId) {
    throw new Error("Missing nodeId or styleId parameter");
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node || node.type !== "TEXT") {
      throw new Error("Node is not a text node");
    }

    const resolvedStyle = await findTextStyle(styleId);
    if (!resolvedStyle) {
      throw new Error(
        'Style not found. Pass either the style id (e.g. "S:abc123,") or the style name (e.g. "body/md") from get_text_styles. Do not use the key field.',
      );
    }

    await figma.loadFontAsync(resolvedStyle.fontName);

    await (node as TextNode).setTextStyleIdAsync(resolvedStyle.id);

    return {
      nodeName: node.name,
      styleName: resolvedStyle.name,
    };
  } catch (error) {
    throw new Error(describeError(error));
  }
}

// ---------------------------------------------------------------------------
// Public: getTextStyles
// ---------------------------------------------------------------------------

export async function getTextStyles(): Promise<Record<string, unknown>> {
  try {
    const textStyles = await figma.getLocalTextStylesAsync();

    return {
      count: textStyles.length,
      styles: textStyles.map((style) => ({
        id: style.id,
        name: style.name,
        key: style.key,
        description: style.description || "",
        fontSize: style.fontSize,
        fontName: style.fontName,
        letterSpacing: style.letterSpacing,
        lineHeight: style.lineHeight,
        paragraphIndent: style.paragraphIndent,
        paragraphSpacing: style.paragraphSpacing,
        textCase: style.textCase,
        textDecoration: style.textDecoration,
      })),
    };
  } catch (error) {
    throw new Error(describeError(error));
  }
}

// ---------------------------------------------------------------------------
// Public: deleteTextStyle
// ---------------------------------------------------------------------------

export async function deleteTextStyle(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const styleId = safeParams.styleId as string | undefined;

  if (!styleId) {
    throw new Error("Missing styleId parameter");
  }

  try {
    let style = await figma.getStyleByIdAsync(styleId);
    if (!style || style.type !== "TEXT") {
      const allStyles = await figma.getLocalTextStylesAsync();
      style =
        allStyles.find(function (s) {
          return s.name === styleId;
        }) || null;
      if (!style) {
        const normalizedInput = styleId.replace(/-/g, "/");
        if (normalizedInput !== styleId) {
          style =
            allStyles.find(function (s) {
              return s.name === normalizedInput;
            }) || null;
        }
      }
    }
    if (!style || style.type !== "TEXT") {
      throw new Error(`Text style not found: "${styleId}". Pass a style ID or name (e.g. "body/md").`);
    }

    const styleName = style.name;
    const styleIdCopy = style.id;

    style.remove();

    return {
      name: styleName,
      id: styleIdCopy,
    };
  } catch (error) {
    throw new Error(describeError(error));
  }
}

// ---------------------------------------------------------------------------
// Public: updateTextStyle
// ---------------------------------------------------------------------------

export async function updateTextStyle(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const styleId = safeParams.styleId as string | undefined;
  const name = safeParams.name as string | undefined;
  const description = safeParams.description as string | undefined;
  const fontSize = safeParams.fontSize as number | undefined;
  const fontFamily = safeParams.fontFamily as string | undefined;
  const fontStyle = safeParams.fontStyle as string | undefined;
  const fontWeight = safeParams.fontWeight as number | undefined;
  const lineHeight = safeParams.lineHeight as LineHeight | undefined;
  const letterSpacing = safeParams.letterSpacing as LetterSpacing | undefined;
  const textCase = safeParams.textCase as TextCase | undefined;
  const textDecoration = safeParams.textDecoration as TextDecoration | undefined;
  const paragraphSpacing = safeParams.paragraphSpacing as number | undefined;
  const paragraphIndent = safeParams.paragraphIndent as number | undefined;
  const bindings = safeParams.bindings as Record<string, string> | undefined;

  if (!styleId) {
    throw new Error("Missing styleId parameter");
  }

  try {
    let style = await figma.getStyleByIdAsync(styleId);
    if (!style || style.type !== "TEXT") {
      const allStyles = await figma.getLocalTextStylesAsync();
      style =
        allStyles.find(function (s) {
          return s.name === styleId;
        }) || null;
      if (!style) {
        const normalizedInput = styleId.replace(/-/g, "/");
        if (normalizedInput !== styleId) {
          style =
            allStyles.find(function (s) {
              return s.name === normalizedInput;
            }) || null;
        }
      }
    }
    if (!style || style.type !== "TEXT") {
      throw new Error(`Text style not found: "${styleId}". Pass a style ID or name (e.g. "body/md").`);
    }

    const textStyle = style as TextStyle;
    const updatedProperties: string[] = [];

    if (name !== undefined) {
      textStyle.name = name;
      updatedProperties.push("name");
    }

    if (description !== undefined) {
      textStyle.description = description;
      updatedProperties.push("description");
    }

    if (fontFamily !== undefined || fontStyle !== undefined || fontWeight !== undefined) {
      const newFontFamily = fontFamily !== null && fontFamily !== undefined ? fontFamily : textStyle.fontName.family;

      const requestedStyle =
        fontStyle !== null && fontStyle !== undefined
          ? fontStyle
          : fontWeight !== null && fontWeight !== undefined
            ? styleNameForWeight(fontWeight)
            : textStyle.fontName.style;
      const newFontStyle = await resolveAndLoadFontStyle(newFontFamily, requestedStyle, "update_text_style");
      textStyle.fontName = { family: newFontFamily, style: newFontStyle };
      updatedProperties.push("fontName");
    }

    if (fontSize !== undefined) {
      textStyle.fontSize = fontSize;
      updatedProperties.push("fontSize");
    }

    if (lineHeight !== undefined) {
      textStyle.lineHeight = lineHeight;
      updatedProperties.push("lineHeight");
    }

    if (letterSpacing !== undefined) {
      textStyle.letterSpacing = letterSpacing;
      updatedProperties.push("letterSpacing");
    }

    if (textCase !== undefined) {
      textStyle.textCase = textCase;
      updatedProperties.push("textCase");
    }

    if (textDecoration !== undefined) {
      textStyle.textDecoration = textDecoration;
      updatedProperties.push("textDecoration");
    }

    if (paragraphSpacing !== undefined) {
      textStyle.paragraphSpacing = paragraphSpacing;
      updatedProperties.push("paragraphSpacing");
    }

    if (paragraphIndent !== undefined) {
      textStyle.paragraphIndent = paragraphIndent;
      updatedProperties.push("paragraphIndent");
    }

    const { applied, warnings } = await applyTextStyleBindings(textStyle, bindings);
    if (applied.length > 0) {
      updatedProperties.push("bindings");
    }

    return {
      id: textStyle.id,
      name: textStyle.name,
      updatedProperties,
      boundFields: applied,
      bindingWarnings: warnings,
    };
  } catch (error) {
    throw new Error(describeError(error));
  }
}
