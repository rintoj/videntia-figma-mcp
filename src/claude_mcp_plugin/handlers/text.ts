import { debugLog, sendProgressUpdate, uniqBy, delay, generateCommandId, getFontStyle, parseNum } from '../utils/helpers';

// ---------------------------------------------------------------------------
// setCharacters helpers (internal — not exported)
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
    if (
      str[i] === delimiter &&
      i + startIdx !== endIdx &&
      temp !== i + startIdx
    ) {
      indices.push([temp, i + startIdx]);
      temp = i + startIdx + 1;
    }
  }
  if (temp !== endIdx) {
    indices.push([temp, endIdx]);
  }
  return indices.filter(Boolean) as Array<[number, number]>;
};

const buildLinearOrder = (
  node: TextNode,
): Array<{ family: string; style: string; delimiter: string }> => {
  const fontTree: Array<{
    start: number;
    delimiter: string;
    family: string;
    style: string;
  }> = [];
  const newLinesPos = getDelimiterPos(node.characters, '\n');
  newLinesPos.forEach(([newLinesRangeStart, newLinesRangeEnd]) => {
    const newLinesRangeFont = node.getRangeFontName(
      newLinesRangeStart,
      newLinesRangeEnd,
    );
    if (newLinesRangeFont === figma.mixed) {
      const spacesPos = getDelimiterPos(
        node.characters,
        ' ',
        newLinesRangeStart,
        newLinesRangeEnd,
      );
      spacesPos.forEach(([spacesRangeStart, spacesRangeEnd]) => {
        const spacesRangeFont = node.getRangeFontName(
          spacesRangeStart,
          spacesRangeEnd,
        );
        if (spacesRangeFont === figma.mixed) {
          const firstCharFont = node.getRangeFontName(
            spacesRangeStart,
            spacesRangeStart + 1,
          );
          fontTree.push({
            start: spacesRangeStart,
            delimiter: ' ',
            family: (firstCharFont as FontName).family,
            style: (firstCharFont as FontName).style,
          });
        } else {
          fontTree.push({
            start: spacesRangeStart,
            delimiter: ' ',
            family: (spacesRangeFont as FontName).family,
            style: (spacesRangeFont as FontName).style,
          });
        }
      });
    } else {
      fontTree.push({
        start: newLinesRangeStart,
        delimiter: '\n',
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
      const [start, end] = range.split('_');
      const [family, style] = fontHashTree[range].split('::');
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
    ({ family, style }: { family: string; style: string }) =>
      `${family}::${style}`,
  ).map(({ family, style }: { family: string; style: string }) => ({
    family,
    style,
  }));

  await Promise.all(
    [...fontsToLoad, fallbackFont].map((f) => figma.loadFontAsync(f)),
  );

  node.fontName = fallbackFont;
  node.characters = characters;

  let prevPos = 0;
  rangeTree.forEach(
    ({ family, style, delimiter }: { family: string; style: string; delimiter: string }) => {
      if (prevPos < node.characters.length) {
        const delimeterPos = node.characters.indexOf(delimiter, prevPos);
        const endPos =
          delimeterPos > prevPos ? delimeterPos : node.characters.length;
        const matchedFont: FontName = { family, style };
        node.setRangeFontName(prevPos, endPos, matchedFont);
        prevPos = endPos + 1;
      }
    },
  );
  return true;
};

interface SetCharactersOptions {
  fallbackFont?: FontName;
  smartStrategy?: 'prevail' | 'strict' | 'experimental';
}

const setCharacters = async (
  node: TextNode,
  characters: string,
  options?: SetCharactersOptions,
): Promise<boolean> => {
  const fallbackFont: FontName =
    (options !== null && options !== undefined && options.fallbackFont !== null && options.fallbackFont !== undefined)
      ? options.fallbackFont
      : { family: 'Inter', style: 'Regular' };
  try {
    if (node.fontName === figma.mixed) {
      const smartStrategy =
        options !== null && options !== undefined ? options.smartStrategy : undefined;
      if (smartStrategy === 'prevail') {
        const fontHashTree: Record<string, number> = {};
        for (let i = 1; i < node.characters.length; i++) {
          const charFont = node.getRangeFontName(i - 1, i) as FontName;
          const key = `${charFont.family}::${charFont.style}`;
          fontHashTree[key] = fontHashTree[key] ? fontHashTree[key] + 1 : 1;
        }
        const prevailedTreeItem = Object.entries(fontHashTree).sort(
          (a, b) => b[1] - a[1],
        )[0];
        const [family, style] = prevailedTreeItem[0].split('::');
        const prevailedFont: FontName = { family, style };
        await figma.loadFontAsync(prevailedFont);
        node.fontName = prevailedFont;
      } else if (smartStrategy === 'strict') {
        return setCharactersWithStrictMatchFont(node, characters, fallbackFont);
      } else if (smartStrategy === 'experimental') {
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
      typeof node.fontName === 'object' && 'family' in node.fontName
        ? (node.fontName as FontName).family
        : '';
    const fontStyle =
      typeof node.fontName === 'object' && 'style' in node.fontName
        ? (node.fontName as FontName).style
        : '';
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
    console.warn('Failed to set characters. Skipped.', err);
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
  const text = safeParams.text !== undefined ? (safeParams.text as string) : 'Text';
  const fontSize = safeParams.fontSize !== undefined ? (safeParams.fontSize as number) : 14;
  const fontFamily = safeParams.fontFamily !== undefined ? (safeParams.fontFamily as string) : 'Inter';
  const fontWeight = safeParams.fontWeight !== undefined ? (safeParams.fontWeight as number) : 400;
  const fontColor =
    safeParams.fontColor !== null && safeParams.fontColor !== undefined
      ? (safeParams.fontColor as { r: number; g: number; b: number; a: number })
      : { r: 0, g: 0, b: 0, a: 1 };
  const name = safeParams.name !== undefined ? (safeParams.name as string) : 'Text';
  const parentId = safeParams.parentId !== undefined ? (safeParams.parentId as string) : undefined;

  const textNode = figma.createText();
  textNode.x = x;
  textNode.y = y;
  textNode.name = name;
  try {
    await figma.loadFontAsync({
      family: fontFamily,
      style: getFontStyle(fontWeight),
    });
    textNode.fontName = { family: fontFamily, style: getFontStyle(fontWeight) };
    textNode.fontSize = parseInt(String(fontSize));
  } catch (error) {
    console.error('Error setting font name/size', error);
  }
  await setCharacters(textNode, text);

  const paintStyle: SolidPaint = {
    type: 'SOLID',
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
    if (!('appendChild' in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    (parentNode as ChildrenMixin).appendChild(textNode);
  } else {
    figma.currentPage.appendChild(textNode);
  }

  return {
    id: textNode.id,
    name: textNode.name,
    x: textNode.x,
    y: textNode.y,
    width: textNode.width,
    height: textNode.height,
    characters: textNode.characters,
    fontSize: textNode.fontSize,
    fontWeight: fontWeight,
    fontColor: fontColor,
    fontName: textNode.fontName,
    fills: textNode.fills,
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
    throw new Error('Missing nodeId parameter');
  }

  if (text === undefined) {
    throw new Error('Missing text parameter');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== 'TEXT') {
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
    throw new Error(`Error setting text content: ${(error as Error).message}`);
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

  if ('children' in node) {
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

async function processTextNode(
  node: SceneNode,
  parentPath: string[],
  depth: number,
): Promise<SafeTextNode | null> {
  if (node.type !== 'TEXT') return null;

  const textNode = node as TextNode;

  try {
    let fontFamily = '';
    let fontStyle = '';

    if (textNode.fontName) {
      if (typeof textNode.fontName === 'object') {
        if ('family' in textNode.fontName) fontFamily = (textNode.fontName as FontName).family;
        if ('style' in textNode.fontName) fontStyle = (textNode.fontName as FontName).style;
      }
    }

    const safeTextNode: SafeTextNode = {
      id: textNode.id,
      name: textNode.name || 'Text',
      type: textNode.type,
      characters: textNode.characters,
      fontSize: typeof textNode.fontSize === 'number' ? textNode.fontSize : 0,
      fontFamily,
      fontStyle,
      x: typeof textNode.x === 'number' ? textNode.x : 0,
      y: typeof textNode.y === 'number' ? textNode.y : 0,
      width: typeof textNode.width === 'number' ? textNode.width : 0,
      height: typeof textNode.height === 'number' ? textNode.height : 0,
      path: parentPath.join(' > '),
      depth,
    };

    return safeTextNode;
  } catch (nodeErr) {
    console.error('Error processing text node:', nodeErr);
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

  if (node.type === 'TEXT') {
    const textNode = node as TextNode;
    try {
      let fontFamily = '';
      let fontStyle = '';

      if (textNode.fontName) {
        if (typeof textNode.fontName === 'object') {
          if ('family' in textNode.fontName) fontFamily = (textNode.fontName as FontName).family;
          if ('style' in textNode.fontName) fontStyle = (textNode.fontName as FontName).style;
        }
      }

      const safeTextNode: SafeTextNode = {
        id: textNode.id,
        name: textNode.name || 'Text',
        type: textNode.type,
        characters: textNode.characters,
        fontSize: typeof textNode.fontSize === 'number' ? textNode.fontSize : 0,
        fontFamily,
        fontStyle,
        x: typeof textNode.x === 'number' ? textNode.x : 0,
        y: typeof textNode.y === 'number' ? textNode.y : 0,
        width: typeof textNode.width === 'number' ? textNode.width : 0,
        height: typeof textNode.height === 'number' ? textNode.height : 0,
        path: nodePath.join(' > '),
        depth,
      };

      textNodes.push(safeTextNode);
    } catch (nodeErr) {
      console.error('Error processing text node:', nodeErr);
    }
  }

  if ('children' in node) {
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
    sendProgressUpdate(
      commandId,
      'scan_text_nodes',
      'error',
      0,
      0,
      0,
      `Node with ID ${nodeId} not found`,
      { error: `Node not found: ${nodeId}` },
    );
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  if (!useChunking) {
    const textNodes: SafeTextNode[] = [];
    try {
      sendProgressUpdate(
        commandId,
        'scan_text_nodes',
        'started',
        0,
        1,
        0,
        `Starting scan of node "${node.name || nodeId}" without chunking`,
        null,
      );

      await findTextNodes(node as SceneNode, [], 0, textNodes);

      sendProgressUpdate(
        commandId,
        'scan_text_nodes',
        'completed',
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
      console.error('Error scanning text nodes:', error);

      sendProgressUpdate(
        commandId,
        'scan_text_nodes',
        'error',
        0,
        0,
        0,
        `Error scanning text nodes: ${(error as Error).message}`,
        { error: (error as Error).message },
      );

      throw new Error(`Error scanning text nodes: ${(error as Error).message}`);
    }
  }

  debugLog(`Using chunked scanning with chunk size: ${chunkSize}`);

  const nodesToProcess: NodeToProcess[] = [];

  sendProgressUpdate(
    commandId,
    'scan_text_nodes',
    'started',
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
    'scan_text_nodes',
    'in_progress',
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
    debugLog(
      `Processing chunk ${chunksProcessed + 1}/${totalChunks} (nodes ${i} to ${chunkEnd - 1})`,
    );

    sendProgressUpdate(
      commandId,
      'scan_text_nodes',
      'in_progress',
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
      if (nodeInfo.node.type === 'TEXT') {
        try {
          const textNodeInfo = await processTextNode(
            nodeInfo.node,
            nodeInfo.parentPath,
            nodeInfo.depth,
          );
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
      'scan_text_nodes',
      'in_progress',
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
    'scan_text_nodes',
    'completed',
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
    const errorMsg = 'Missing required parameters: nodeId and text array';

    sendProgressUpdate(
      commandId,
      'set_multiple_text_contents',
      'error',
      0,
      0,
      0,
      errorMsg,
      { error: errorMsg },
    );

    throw new Error(errorMsg);
  }

  debugLog(
    `Starting text replacement for node: ${nodeId} with ${text.length} text replacements`,
  );

  sendProgressUpdate(
    commandId,
    'set_multiple_text_contents',
    'started',
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
    'set_multiple_text_contents',
    'in_progress',
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
    debugLog(
      `Processing chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length} replacements`,
    );

    sendProgressUpdate(
      commandId,
      'set_multiple_text_contents',
      'in_progress',
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
        console.error('Missing nodeId or text for replacement');
        return {
          success: false,
          nodeId:
            replacement.nodeId !== null && replacement.nodeId !== undefined
              ? replacement.nodeId
              : 'unknown',
          error: 'Missing nodeId or text in replacement entry',
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

        if (textNode.type !== 'TEXT') {
          console.error(
            `Node is not a text node: ${replacement.nodeId} (type: ${textNode.type})`,
          );
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
          originalFills = JSON.parse(
            JSON.stringify((textNode as TextNode).fills),
          );
          (textNode as TextNode).fills = [
            {
              type: 'SOLID',
              color: { r: 1, g: 0.5, b: 0 },
              opacity: 0.3,
            },
          ];
        } catch (highlightErr) {
          console.error(
            `Error highlighting text node: ${(highlightErr as Error).message}`,
          );
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
            console.error(
              `Error restoring fills: ${(restoreErr as Error).message}`,
            );
          }
        }

        debugLog(
          `Successfully replaced text in node: ${replacement.nodeId}`,
        );
        return {
          success: true,
          nodeId: replacement.nodeId,
          originalText,
          translatedText: replacement.text,
        };
      } catch (error) {
        console.error(
          `Error replacing text in node ${replacement.nodeId}: ${(error as Error).message}`,
        );
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
      'set_multiple_text_contents',
      'in_progress',
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
      debugLog('Pausing between chunks to avoid overloading Figma...');
      await delay(1000);
    }
  }

  debugLog(
    `Replacement complete: ${successCount} successful, ${failureCount} failed`,
  );

  sendProgressUpdate(
    commandId,
    'set_multiple_text_contents',
    'completed',
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
  const layoutMode = safeParams.layoutMode as string | undefined;
  const paddingTop = safeParams.paddingTop as number | undefined;
  const paddingBottom = safeParams.paddingBottom as number | undefined;
  const paddingLeft = safeParams.paddingLeft as number | undefined;
  const paddingRight = safeParams.paddingRight as number | undefined;
  const itemSpacing = safeParams.itemSpacing as number | undefined;
  const primaryAxisAlignItems = safeParams.primaryAxisAlignItems as string | undefined;
  const counterAxisAlignItems = safeParams.counterAxisAlignItems as string | undefined;
  const layoutWrap = safeParams.layoutWrap as string | undefined;
  const strokesIncludedInLayout = safeParams.strokesIncludedInLayout as boolean | undefined;
  const clipsContent = safeParams.clipsContent as boolean | undefined;

  if (!nodeId) {
    throw new Error('Missing nodeId parameter');
  }

  if (!layoutMode) {
    throw new Error('Missing layoutMode parameter');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!('layoutMode' in node)) {
    throw new Error(`Node does not support auto layout: ${nodeId}`);
  }

  const frameNode = node as FrameNode;

  if (layoutMode === 'NONE') {
    frameNode.layoutMode = 'NONE';
  } else {
    frameNode.layoutMode = layoutMode as 'HORIZONTAL' | 'VERTICAL';

    if (paddingTop !== undefined) frameNode.paddingTop = paddingTop;
    if (paddingBottom !== undefined) frameNode.paddingBottom = paddingBottom;
    if (paddingLeft !== undefined) frameNode.paddingLeft = paddingLeft;
    if (paddingRight !== undefined) frameNode.paddingRight = paddingRight;

    if (itemSpacing !== undefined) frameNode.itemSpacing = itemSpacing;

    if (primaryAxisAlignItems !== undefined) {
      frameNode.primaryAxisAlignItems = primaryAxisAlignItems as 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
    }

    if (counterAxisAlignItems !== undefined) {
      frameNode.counterAxisAlignItems = counterAxisAlignItems as 'MIN' | 'CENTER' | 'MAX' | 'BASELINE';
    }

    if (layoutWrap !== undefined) {
      frameNode.layoutWrap = layoutWrap as 'NO_WRAP' | 'WRAP';
    }

    if (strokesIncludedInLayout !== undefined) {
      frameNode.strokesIncludedInLayout = strokesIncludedInLayout;
    }

    if (clipsContent !== undefined) {
      frameNode.clipsContent = clipsContent;
    }
  }

  return {
    id: frameNode.id,
    name: frameNode.name,
    layoutMode: frameNode.layoutMode,
    paddingTop: frameNode.paddingTop,
    paddingBottom: frameNode.paddingBottom,
    paddingLeft: frameNode.paddingLeft,
    paddingRight: frameNode.paddingRight,
    itemSpacing: frameNode.itemSpacing,
    primaryAxisAlignItems: frameNode.primaryAxisAlignItems,
    counterAxisAlignItems: frameNode.counterAxisAlignItems,
    layoutWrap: frameNode.layoutWrap,
    strokesIncludedInLayout: frameNode.strokesIncludedInLayout,
    clipsContent: frameNode.clipsContent,
  };
}

// ---------------------------------------------------------------------------
// Public: setFontName
// ---------------------------------------------------------------------------

export async function setFontName(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const family = safeParams.family as string | undefined;
  const style = safeParams.style !== null && safeParams.style !== undefined ? (safeParams.style as string) : 'Regular';

  if (!nodeId || !family) {
    throw new Error('Missing nodeId or font family');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== 'TEXT') {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    await figma.loadFontAsync({ family, style });
    (node as TextNode).fontName = { family, style };
    return {
      id: node.id,
      name: node.name,
      fontName: (node as TextNode).fontName,
    };
  } catch (error) {
    throw new Error(`Error setting font name: ${(error as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Public: setFontSize
// ---------------------------------------------------------------------------

export async function setFontSize(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const fontSize = safeParams.fontSize;

  if (!nodeId || fontSize === undefined) {
    throw new Error('Missing nodeId or fontSize');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== 'TEXT') {
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
    throw new Error(`Error setting font size: ${(error as Error).message}`);
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
    throw new Error('Missing nodeId or weight');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== 'TEXT') {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    // When the node has mixed fonts across segments, fontName returns figma.mixed.
    // Fall back to the font of the first character range.
    const rawFontName = (node as TextNode).fontName;
    const family = rawFontName === figma.mixed
      ? (node as TextNode).getRangeFontName(0, 1) as FontName
      : (rawFontName as FontName);
    const resolvedFamily = (family as FontName).family;
    const style = getFontStyle(weight as number);
    await figma.loadFontAsync({ family: resolvedFamily, style });
    (node as TextNode).fontName = { family: resolvedFamily, style };
    return {
      id: node.id,
      name: node.name,
      fontName: (node as TextNode).fontName,
      weight,
    };
  } catch (error) {
    throw new Error(`Error setting font weight: ${(error as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Public: setLetterSpacing
// ---------------------------------------------------------------------------

export async function setLetterSpacing(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const letterSpacing = safeParams.letterSpacing;
  const unit = safeParams.unit !== null && safeParams.unit !== undefined ? (safeParams.unit as string) : 'PIXELS';

  if (!nodeId || letterSpacing === undefined) {
    throw new Error('Missing nodeId or letterSpacing');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== 'TEXT') {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    const lsFontName = (node as TextNode).fontName;
    const lsFont = lsFontName === figma.mixed
      ? (node as TextNode).getRangeFontName(0, 1) as FontName
      : lsFontName as FontName;
    await figma.loadFontAsync(lsFont);
    (node as TextNode).letterSpacing = {
      value: letterSpacing as number,
      unit: unit as LetterSpacing['unit'],
    };
    return {
      id: node.id,
      name: node.name,
      letterSpacing: (node as TextNode).letterSpacing,
    };
  } catch (error) {
    throw new Error(`Error setting letter spacing: ${(error as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Public: setLineHeight
// ---------------------------------------------------------------------------

export async function setLineHeight(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const lineHeight = safeParams.lineHeight;
  const unit = safeParams.unit !== null && safeParams.unit !== undefined ? (safeParams.unit as string) : 'PIXELS';

  if (!nodeId || lineHeight === undefined) {
    throw new Error('Missing nodeId or lineHeight');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== 'TEXT') {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    const lhFontName = (node as TextNode).fontName;
    const lhFont = lhFontName === figma.mixed
      ? (node as TextNode).getRangeFontName(0, 1) as FontName
      : lhFontName as FontName;
    await figma.loadFontAsync(lhFont);
    (node as TextNode).lineHeight = {
      value: lineHeight as number,
      unit: unit as LineHeight['unit'],
    };
    return {
      id: node.id,
      name: node.name,
      lineHeight: (node as TextNode).lineHeight,
    };
  } catch (error) {
    throw new Error(`Error setting line height: ${(error as Error).message}`);
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
    throw new Error('Missing nodeId or paragraphSpacing');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== 'TEXT') {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    const psFontName = (node as TextNode).fontName;
    const psFont = psFontName === figma.mixed
      ? (node as TextNode).getRangeFontName(0, 1) as FontName
      : psFontName as FontName;
    await figma.loadFontAsync(psFont);
    (node as TextNode).paragraphSpacing = paragraphSpacing as number;
    return {
      id: node.id,
      name: node.name,
      paragraphSpacing: (node as TextNode).paragraphSpacing,
    };
  } catch (error) {
    throw new Error(`Error setting paragraph spacing: ${(error as Error).message}`);
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
    throw new Error('Missing nodeId or textCase');
  }

  if (!['ORIGINAL', 'UPPER', 'LOWER', 'TITLE'].includes(textCase as string)) {
    throw new Error(
      'Invalid textCase value. Must be one of: ORIGINAL, UPPER, LOWER, TITLE',
    );
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== 'TEXT') {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    const tcFontName = (node as TextNode).fontName;
    const tcFont = tcFontName === figma.mixed
      ? (node as TextNode).getRangeFontName(0, 1) as FontName
      : tcFontName as FontName;
    await figma.loadFontAsync(tcFont);
    (node as TextNode).textCase = textCase as TextCase;
    return {
      id: node.id,
      name: node.name,
      textCase: (node as TextNode).textCase,
    };
  } catch (error) {
    throw new Error(`Error setting text case: ${(error as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Public: setTextDecoration
// ---------------------------------------------------------------------------

export async function setTextDecoration(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const textDecoration = safeParams.textDecoration;

  if (!nodeId || textDecoration === undefined) {
    throw new Error('Missing nodeId or textDecoration');
  }

  if (!['NONE', 'UNDERLINE', 'STRIKETHROUGH'].includes(textDecoration as string)) {
    throw new Error(
      'Invalid textDecoration value. Must be one of: NONE, UNDERLINE, STRIKETHROUGH',
    );
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== 'TEXT') {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    const tdFontName = (node as TextNode).fontName;
    const tdFont = tdFontName === figma.mixed
      ? (node as TextNode).getRangeFontName(0, 1) as FontName
      : tdFontName as FontName;
    await figma.loadFontAsync(tdFont);
    (node as TextNode).textDecoration = textDecoration as TextDecoration;
    return {
      id: node.id,
      name: node.name,
      textDecoration: (node as TextNode).textDecoration,
    };
  } catch (error) {
    throw new Error(
      `Error setting text decoration: ${(error as Error).message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public: getStyledTextSegments
// ---------------------------------------------------------------------------

export async function getStyledTextSegments(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const property = safeParams.property as string | undefined;

  if (!nodeId || !property) {
    throw new Error('Missing nodeId or property');
  }

  const validProperties = [
    'fillStyleId',
    'fontName',
    'fontSize',
    'textCase',
    'textDecoration',
    'textStyleId',
    'fills',
    'letterSpacing',
    'lineHeight',
    'fontWeight',
  ];

  if (!validProperties.includes(property)) {
    throw new Error(
      `Invalid property. Must be one of: ${validProperties.join(', ')}`,
    );
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== 'TEXT') {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    type StyleField = keyof Omit<StyledTextSegment, 'characters' | 'start' | 'end'>;
    const segments = (node as TextNode).getStyledTextSegments([
      property as StyleField,
    ]);

    const safeSegments = segments.map((segment) => {
      const safeSegment: Record<string, unknown> = {
        characters: segment.characters,
        start: segment.start,
        end: segment.end,
      };

      if (property === 'fontName') {
        const val = (segment as Record<string, unknown>)[property];
        if (val !== null && val !== undefined && typeof val === 'object') {
          safeSegment[property] = {
            family: (val as FontName).family || '',
            style: (val as FontName).style || '',
          };
        } else {
          safeSegment[property] = { family: '', style: '' };
        }
      } else if (property === 'letterSpacing' || property === 'lineHeight') {
        const val = (segment as Record<string, unknown>)[property];
        if (val !== null && val !== undefined && typeof val === 'object') {
          const typedVal = val as { value: number; unit: string };
          safeSegment[property] = {
            value: typedVal.value !== null && typedVal.value !== undefined ? typedVal.value : 0,
            unit: typedVal.unit !== null && typedVal.unit !== undefined && typedVal.unit !== '' ? typedVal.unit : 'PIXELS',
          };
        } else {
          safeSegment[property] = { value: 0, unit: 'PIXELS' };
        }
      } else if (property === 'fills') {
        const val = (segment as Record<string, unknown>)[property];
        safeSegment[property] =
          val !== null && val !== undefined
            ? JSON.parse(JSON.stringify(val))
            : [];
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
    throw new Error(
      `Error getting styled text segments: ${(error as Error).message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public: loadFontAsyncWrapper
// ---------------------------------------------------------------------------

export async function loadFontAsyncWrapper(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const family = safeParams.family as string | undefined;
  const style = safeParams.style !== null && safeParams.style !== undefined ? (safeParams.style as string) : 'Regular';

  if (!family) {
    throw new Error('Missing font family');
  }

  try {
    await figma.loadFontAsync({ family, style });
    return {
      success: true,
      family,
      style,
      message: `Successfully loaded ${family} ${style}`,
    };
  } catch (error) {
    throw new Error(`Error loading font: ${(error as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Public: createTextStyle
// ---------------------------------------------------------------------------

export async function createTextStyle(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const nodeId = safeParams.nodeId as string | undefined;
  const name = safeParams.name as string | undefined;
  const description = safeParams.description as string | undefined;

  if (!nodeId || !name) {
    throw new Error('Missing nodeId or name parameter');
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.type !== 'TEXT') {
    throw new Error('Node is not a text node');
  }

  const textNode = node as TextNode;

  try {
    await figma.loadFontAsync(textNode.fontName as FontName);
  } catch (error) {
    const fn = textNode.fontName as FontName;
    throw new Error(
      `Font "${fn.family} ${fn.style}" is not available. Please ensure the font is installed.`,
    );
  }

  try {
    const textStyle = figma.createTextStyle();
    textStyle.name = name;
    if (description !== null && description !== undefined) {
      textStyle.description = description;
    }

    textStyle.fontSize = textNode.fontSize as number;
    textStyle.fontName = textNode.fontName as FontName;
    textStyle.letterSpacing = textNode.letterSpacing as LetterSpacing;
    textStyle.lineHeight = textNode.lineHeight as LineHeight;
    textStyle.paragraphIndent = textNode.paragraphIndent;
    textStyle.paragraphSpacing = textNode.paragraphSpacing;
    textStyle.textCase = textNode.textCase as TextCase;
    textStyle.textDecoration = textNode.textDecoration as TextDecoration;

    return {
      id: textStyle.id,
      name: textStyle.name,
      key: textStyle.key,
      fontName: textStyle.fontName,
      fontSize: textStyle.fontSize,
    };
  } catch (error) {
    throw new Error(`Error creating text style: ${(error as Error).message}`);
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
  const description = safeParams.description as string | undefined;

  if (!name || !fontSize || !fontFamily) {
    throw new Error('Missing required parameters: name, fontSize, or fontFamily');
  }

  let actualFontStyle: string;
  if (fontStyle !== null && fontStyle !== undefined) {
    actualFontStyle = fontStyle;
  } else if (fontWeight !== null && fontWeight !== undefined) {
    if (fontWeight >= 900) actualFontStyle = 'Black';
    else if (fontWeight >= 800) actualFontStyle = 'Extra Bold';
    else if (fontWeight >= 700) actualFontStyle = 'Bold';
    else if (fontWeight >= 600) actualFontStyle = 'Semi Bold';
    else if (fontWeight >= 500) actualFontStyle = 'Medium';
    else if (fontWeight >= 400) actualFontStyle = 'Regular';
    else if (fontWeight >= 300) actualFontStyle = 'Light';
    else if (fontWeight >= 200) actualFontStyle = 'Extra Light';
    else if (fontWeight >= 100) actualFontStyle = 'Thin';
    else actualFontStyle = 'Regular';
  } else {
    actualFontStyle = 'Regular';
  }

  try {
    await figma.loadFontAsync({ family: fontFamily, style: actualFontStyle });
  } catch (error) {
    throw new Error(
      `Font "${fontFamily} ${actualFontStyle}" is not available. Please ensure the font is installed or use a different font.`,
    );
  }

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

    return {
      id: textStyle.id,
      name: textStyle.name,
      key: textStyle.key,
      fontName: textStyle.fontName,
      fontSize: textStyle.fontSize,
    };
  } catch (error) {
    throw new Error(
      `Error creating text style from properties: ${(error as Error).message}`,
    );
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
    throw new Error('Missing nodeId or styleId parameter');
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node || node.type !== 'TEXT') {
      throw new Error('Node is not a text node');
    }

    const style = await figma.getStyleByIdAsync(styleId);
    if (!style || style.type !== 'TEXT') {
      throw new Error('Style not found or is not a text style');
    }

    await figma.loadFontAsync((style as TextStyle).fontName);

    await (node as TextNode).setTextStyleIdAsync(styleId);

    return {
      nodeName: node.name,
      styleName: style.name,
    };
  } catch (error) {
    throw new Error(`Error applying text style: ${(error as Error).message}`);
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
        description: style.description || '',
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
    throw new Error(`Error getting text styles: ${(error as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Public: deleteTextStyle
// ---------------------------------------------------------------------------

export async function deleteTextStyle(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safeParams = params !== null && params !== undefined ? params : {};
  const styleId = safeParams.styleId as string | undefined;

  if (!styleId) {
    throw new Error('Missing styleId parameter');
  }

  try {
    const style = await figma.getStyleByIdAsync(styleId);
    if (!style || style.type !== 'TEXT') {
      throw new Error('Style not found or is not a text style');
    }

    const styleName = style.name;
    const styleIdCopy = style.id;

    style.remove();

    return {
      name: styleName,
      id: styleIdCopy,
    };
  } catch (error) {
    throw new Error(`Error deleting text style: ${(error as Error).message}`);
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

  if (!styleId) {
    throw new Error('Missing styleId parameter');
  }

  try {
    const style = await figma.getStyleByIdAsync(styleId);
    if (!style || style.type !== 'TEXT') {
      throw new Error('Style not found or is not a text style');
    }

    const textStyle = style as TextStyle;
    const updatedProperties: string[] = [];

    if (name !== undefined) {
      textStyle.name = name;
      updatedProperties.push('name');
    }

    if (description !== undefined) {
      textStyle.description = description;
      updatedProperties.push('description');
    }

    if (
      fontFamily !== undefined ||
      fontStyle !== undefined ||
      fontWeight !== undefined
    ) {
      const newFontFamily =
        fontFamily !== null && fontFamily !== undefined
          ? fontFamily
          : textStyle.fontName.family;

      let newFontStyle: string;
      if (fontStyle !== null && fontStyle !== undefined) {
        newFontStyle = fontStyle;
      } else if (fontWeight !== null && fontWeight !== undefined) {
        if (fontWeight >= 900) newFontStyle = 'Black';
        else if (fontWeight >= 800) newFontStyle = 'Extra Bold';
        else if (fontWeight >= 700) newFontStyle = 'Bold';
        else if (fontWeight >= 600) newFontStyle = 'Semi Bold';
        else if (fontWeight >= 500) newFontStyle = 'Medium';
        else if (fontWeight >= 400) newFontStyle = 'Regular';
        else if (fontWeight >= 300) newFontStyle = 'Light';
        else if (fontWeight >= 200) newFontStyle = 'Extra Light';
        else if (fontWeight >= 100) newFontStyle = 'Thin';
        else newFontStyle = 'Regular';
      } else {
        newFontStyle = textStyle.fontName.style;
      }

      try {
        await figma.loadFontAsync({
          family: newFontFamily,
          style: newFontStyle,
        });
      } catch (error) {
        throw new Error(
          `Font "${newFontFamily} ${newFontStyle}" is not available. Please ensure the font is installed or use a different font.`,
        );
      }
      textStyle.fontName = { family: newFontFamily, style: newFontStyle };
      updatedProperties.push('fontName');
    }

    if (fontSize !== undefined) {
      textStyle.fontSize = fontSize;
      updatedProperties.push('fontSize');
    }

    if (lineHeight !== undefined) {
      textStyle.lineHeight = lineHeight;
      updatedProperties.push('lineHeight');
    }

    if (letterSpacing !== undefined) {
      textStyle.letterSpacing = letterSpacing;
      updatedProperties.push('letterSpacing');
    }

    if (textCase !== undefined) {
      textStyle.textCase = textCase;
      updatedProperties.push('textCase');
    }

    if (textDecoration !== undefined) {
      textStyle.textDecoration = textDecoration;
      updatedProperties.push('textDecoration');
    }

    if (paragraphSpacing !== undefined) {
      textStyle.paragraphSpacing = paragraphSpacing;
      updatedProperties.push('paragraphSpacing');
    }

    if (paragraphIndent !== undefined) {
      textStyle.paragraphIndent = paragraphIndent;
      updatedProperties.push('paragraphIndent');
    }

    return {
      id: textStyle.id,
      name: textStyle.name,
      updatedProperties,
    };
  } catch (error) {
    throw new Error(`Error updating text style: ${(error as Error).message}`);
  }
}
