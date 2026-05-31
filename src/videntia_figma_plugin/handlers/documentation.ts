// Documentation handlers — enumerate frames, map flows, bulk export, content tree

function getParam<T>(params: Record<string, unknown>, key: string, defaultVal: T): T {
  const p = params !== null && params !== undefined ? params[key] : undefined;
  return (p !== null && p !== undefined) ? p as T : defaultVal;
}

function getOptParam<T>(params: Record<string, unknown>, key: string): T | undefined {
  if (params === null || params === undefined) return undefined;
  const p = params[key];
  return (p !== null && p !== undefined) ? p as T : undefined;
}

// ---------------------------------------------------------------------------
// enumerate_all_frames
// ---------------------------------------------------------------------------

interface FrameSummary {
  id: string;
  name: string;
  pageId: string;
  pageName: string;
  width: number;
  height: number;
  x: number;
  y: number;
  hasPrototypeLinks: boolean;
  annotationCount: number;
  childCount: number;
  description?: string;
}

export async function enumerateAllFrames(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const pageId = getOptParam<string>(params, 'pageId');
  const topLevelOnly = getParam<boolean>(params, 'topLevelOnly', true);
  const includeComponents = getParam<boolean>(params, 'includeComponents', false);

  const pagesToScan: PageNode[] = [];

  if (pageId) {
    const page = figma.root.children.find(p => p.id === pageId);
    if (!page) throw new Error(`Page not found: ${pageId}`);
    pagesToScan.push(page);
  } else {
    pagesToScan.push(...figma.root.children);
  }

  const frames: FrameSummary[] = [];

  for (const page of pagesToScan) {
    await page.loadAsync();

    const nodesToScan = topLevelOnly
      ? page.children
      : flattenAll(page.children);

    for (const node of nodesToScan) {
      const isFrame = node.type === 'FRAME';
      const isComponent = includeComponents && (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET');
      if (!isFrame && !isComponent) continue;

      const frameNode = node as FrameNode;
      let hasPrototypeLinks = false;
      let annotationCount = 0;

      if ('reactions' in frameNode && Array.isArray(frameNode.reactions)) {
        hasPrototypeLinks = frameNode.reactions.length > 0;
      }
      if ('annotations' in frameNode && Array.isArray((frameNode as unknown as { annotations: unknown[] }).annotations)) {
        annotationCount = (frameNode as unknown as { annotations: unknown[] }).annotations.length;
      }

      frames.push({
        id: frameNode.id,
        name: frameNode.name,
        pageId: page.id,
        pageName: page.name,
        width: frameNode.width,
        height: frameNode.height,
        x: frameNode.x,
        y: frameNode.y,
        hasPrototypeLinks,
        annotationCount,
        childCount: 'children' in frameNode ? (frameNode as FrameNode).children.length : 0,
        description: 'description' in frameNode ? (frameNode as unknown as { description?: string }).description : undefined,
      });
    }
  }

  return {
    totalFrames: frames.length,
    pageCount: pagesToScan.length,
    frames,
  };
}

function flattenAll(nodes: readonly SceneNode[]): SceneNode[] {
  const result: SceneNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if ('children' in node) {
      result.push(...flattenAll((node as FrameNode).children));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// map_prototype_flows
// ---------------------------------------------------------------------------

interface FlowNode {
  id: string;
  name: string;
  type: string;
  pageId: string;
  pageName: string;
}

interface FlowEdge {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  trigger: string;
  action: string;
  pageId: string;
  pageName: string;
}

export async function mapPrototypeFlows(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const pageId = getOptParam<string>(params, 'pageId');

  const pagesToScan: PageNode[] = [];
  if (pageId) {
    const page = figma.root.children.find(p => p.id === pageId);
    if (!page) throw new Error(`Page not found: ${pageId}`);
    pagesToScan.push(page);
  } else {
    pagesToScan.push(...figma.root.children);
  }

  const nodesMap = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  const entryPoints: FlowNode[] = [];

  for (const page of pagesToScan) {
    await page.loadAsync();
    await traverseForReactions(page.children, page, nodesMap, edges);
  }

  // Find entry points — nodes that are destinations of no edges
  const destinationIds = new Set(edges.map(e => e.toId));
  for (const [id, node] of nodesMap) {
    if (!destinationIds.has(id)) {
      entryPoints.push(node);
    }
  }

  return {
    totalNodes: nodesMap.size,
    totalEdges: edges.length,
    entryPoints,
    nodes: Array.from(nodesMap.values()),
    edges,
  };
}

async function traverseForReactions(
  nodes: readonly SceneNode[],
  page: PageNode,
  nodesMap: Map<string, FlowNode>,
  edges: FlowEdge[],
): Promise<void> {
  for (const node of nodes) {
    if ('reactions' in node) {
      const reactiveNode = node as unknown as {
        id: string;
        name: string;
        type: string;
        reactions: Array<{
          trigger: { type: string } | null;
          actions: Array<{ type: string; destinationId?: string }>;
        }>;
      };

      if (reactiveNode.reactions.length > 0) {
        if (!nodesMap.has(reactiveNode.id)) {
          nodesMap.set(reactiveNode.id, {
            id: reactiveNode.id,
            name: reactiveNode.name,
            type: reactiveNode.type,
            pageId: page.id,
            pageName: page.name,
          });
        }

        for (const reaction of reactiveNode.reactions) {
          for (const action of reaction.actions) {
            if (action.destinationId) {
              const destNode = await figma.getNodeByIdAsync(action.destinationId);
              if (destNode) {
                const destPageId = getPageId(destNode);
                const destPage = destPageId ? figma.root.children.find(p => p.id === destPageId) : page;

                if (!nodesMap.has(destNode.id)) {
                  nodesMap.set(destNode.id, {
                    id: destNode.id,
                    name: destNode.name,
                    type: destNode.type,
                    pageId: destPage?.id ?? page.id,
                    pageName: destPage?.name ?? page.name,
                  });
                }

                edges.push({
                  fromId: reactiveNode.id,
                  fromName: reactiveNode.name,
                  toId: destNode.id,
                  toName: destNode.name,
                  trigger: reaction.trigger?.type ?? 'UNKNOWN',
                  action: action.type,
                  pageId: page.id,
                  pageName: page.name,
                });
              }
            }
          }
        }
      }
    }

    if ('children' in node) {
      await traverseForReactions((node as FrameNode).children, page, nodesMap, edges);
    }
  }
}

function getPageId(node: BaseNode): string | null {
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === 'PAGE') return current.id;
    current = current.parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// bulk_export_frames
// ---------------------------------------------------------------------------

export async function bulkExportFrames(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeIds = getOptParam<string[]>(params, 'nodeIds');
  const format = getParam<string>(params, 'format', 'PNG').toUpperCase() as 'PNG' | 'JPG' | 'SVG' | 'PDF';
  const scale = getParam<number>(params, 'scale', 1);
  const pageId = getOptParam<string>(params, 'pageId');

  let targetIds: string[] = [];

  if (nodeIds && nodeIds.length > 0) {
    targetIds = nodeIds;
  } else {
    // Export all top-level frames from the given page (or current page)
    const page = pageId
      ? figma.root.children.find(p => p.id === pageId) ?? figma.currentPage
      : figma.currentPage;
    await page.loadAsync();
    targetIds = page.children
      .filter(n => n.type === 'FRAME' || n.type === 'COMPONENT')
      .map(n => n.id);
  }

  const results: Array<{
    nodeId: string;
    name: string;
    format: string;
    width: number;
    height: number;
    data: string;
    error?: string;
  }> = [];

  for (const id of targetIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || !('exportAsync' in node)) {
      results.push({ nodeId: id, name: '', format, width: 0, height: 0, data: '', error: 'Node not found or not exportable' });
      continue;
    }

    const exportNode = node as unknown as {
      id: string;
      name: string;
      width: number;
      height: number;
      exportAsync: (settings: { format: string; constraint?: { type: string; value: number } }) => Promise<Uint8Array>;
    };

    try {
      const bytes = await exportNode.exportAsync({
        format,
        constraint: scale !== 1 ? { type: 'SCALE', value: scale } : undefined,
      });

      // Convert to base64
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      results.push({
        nodeId: exportNode.id,
        name: exportNode.name,
        format,
        width: exportNode.width,
        height: exportNode.height,
        data: base64,
      });
    } catch (err) {
      results.push({
        nodeId: id,
        name: exportNode.name,
        format,
        width: exportNode.width,
        height: exportNode.height,
        data: '',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    total: results.length,
    succeeded: results.filter(r => !r.error).length,
    failed: results.filter(r => r.error).length,
    exports: results,
  };
}

// ---------------------------------------------------------------------------
// get_content_tree
// ---------------------------------------------------------------------------

interface ContentNode {
  id: string;
  name: string;
  type: string;
  role: string;
  text?: string;
  fontSize?: number;
  fontWeight?: string;
  fills?: string;
  width: number;
  height: number;
  children?: ContentNode[];
}

export async function getContentTree(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = getOptParam<string>(params, 'nodeId');
  const pageId = getOptParam<string>(params, 'pageId');
  const maxDepth = getParam<number>(params, 'maxDepth', 5);
  const includeImages = getParam<boolean>(params, 'includeImages', false);

  let rootNodes: SceneNode[] = [];

  if (nodeId) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);
    rootNodes = [node as SceneNode];
  } else {
    const page = pageId
      ? figma.root.children.find(p => p.id === pageId) ?? figma.currentPage
      : figma.currentPage;
    await page.loadAsync();
    rootNodes = page.children.filter(n => n.type === 'FRAME') as SceneNode[];
  }

  const tree = rootNodes.map(n => buildContentNode(n, 0, maxDepth, includeImages));
  const allText = extractAllText(tree);

  return {
    nodeCount: rootNodes.length,
    tree,
    textInventory: allText,
  };
}

function buildContentNode(node: SceneNode, depth: number, maxDepth: number, includeImages: boolean): ContentNode {
  const result: ContentNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    role: inferRole(node),
    width: 'width' in node ? (node as FrameNode).width : 0,
    height: 'height' in node ? (node as FrameNode).height : 0,
  };

  if (node.type === 'TEXT') {
    const textNode = node as TextNode;
    result.text = textNode.characters;
    result.fontSize = typeof textNode.fontSize === 'number' ? textNode.fontSize : undefined;
    result.fontWeight = typeof textNode.fontWeight === 'number' ? String(textNode.fontWeight) : undefined;
  }

  if ('fills' in node && includeImages) {
    const fills = (node as FrameNode).fills;
    if (Array.isArray(fills)) {
      const imageFills = fills.filter(f => f.type === 'IMAGE');
      if (imageFills.length > 0) {
        result.fills = `image(${imageFills.length})`;
      }
    }
  }

  if (depth < maxDepth && 'children' in node) {
    result.children = (node as FrameNode).children.map(
      child => buildContentNode(child, depth + 1, maxDepth, includeImages)
    );
  }

  return result;
}

function inferRole(node: SceneNode): string {
  const name = node.name.toLowerCase();
  if (node.type === 'TEXT') {
    const textNode = node as TextNode;
    const size = typeof textNode.fontSize === 'number' ? textNode.fontSize : 0;
    if (size >= 24) return 'heading';
    if (size >= 16) return 'subheading';
    if (name.includes('label') || name.includes('caption')) return 'label';
    if (name.includes('button') || name.includes('cta')) return 'cta';
    if (name.includes('hint') || name.includes('placeholder')) return 'hint';
    return 'body';
  }
  if (node.type === 'FRAME') {
    if (name.includes('screen') || name.includes('page')) return 'screen';
    if (name.includes('card')) return 'card';
    if (name.includes('modal') || name.includes('dialog')) return 'modal';
    if (name.includes('nav') || name.includes('tab')) return 'navigation';
    if (name.includes('header')) return 'header';
    if (name.includes('footer')) return 'footer';
    if (name.includes('button') || name.includes('cta')) return 'button';
    return 'container';
  }
  if (node.type === 'COMPONENT' || node.type === 'INSTANCE') return 'component';
  if (node.type === 'VECTOR' || node.type === 'ELLIPSE' || node.type === 'RECTANGLE') return 'shape';
  return node.type.toLowerCase();
}

interface TextItem {
  id: string;
  name: string;
  role: string;
  text: string;
  fontSize?: number;
}

// ---------------------------------------------------------------------------
// get_frame_documentation
// ---------------------------------------------------------------------------

interface CommentMeta {
  type: 'canvas' | 'frame';
  x?: number;
  y?: number;
  nodeId?: string;
  offset?: unknown;
}

interface FigmaWithComments {
  comments?: ReadonlyArray<{
    id: string;
    message: string;
    author: { id: string; name: string };
    createdAt: Date;
    resolved: boolean;
    clientMeta?: { x?: unknown; y?: unknown; nodeId?: unknown; nodeOffset?: unknown };
    replies?: ReadonlyArray<{ id: string; message: string; author?: { id: string; name: string }; createdAt?: Date }>;
  }>;
  getCommentsAsync?: () => Promise<ReadonlyArray<{
    id: string;
    message: string;
    author: { id: string; name: string };
    createdAt: Date;
    resolved: boolean;
    clientMeta?: { x?: unknown; y?: unknown; nodeId?: unknown; nodeOffset?: unknown };
    replies?: ReadonlyArray<{ id: string; message: string; author?: { id: string; name: string }; createdAt?: Date }>;
  }>>;
}

type AnnotatableNode = BaseNode & { readonly annotations: ReadonlyArray<{ label?: string; labelMarkdown?: string; categoryId?: string; properties?: unknown[] }> };

function isAnnotatable(node: BaseNode): boolean {
  return ['FRAME','COMPONENT','COMPONENT_SET','INSTANCE','RECTANGLE','ELLIPSE','VECTOR','LINE','POLYGON','STAR','TEXT'].includes(node.type);
}

async function collectAnnotations(node: BaseNode): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  if (isAnnotatable(node)) {
    const annotatable = node as unknown as AnnotatableNode;
    const anns = Array.from(annotatable.annotations || []);
    for (const ann of anns) {
      results.push({
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        label: ann.label ?? '',
        labelMarkdown: ann.labelMarkdown ?? '',
        categoryId: ann.categoryId,
        properties: ann.properties,
      });
    }
  }
  if ('children' in node) {
    for (const child of (node as FrameNode).children) {
      results.push(...(await collectAnnotations(child)));
    }
  }
  return results;
}

function collectDescendantIds(node: BaseNode): Set<string> {
  const ids = new Set<string>();
  ids.add(node.id);
  if ('children' in node) {
    for (const child of (node as FrameNode).children) {
      for (const id of collectDescendantIds(child)) ids.add(id);
    }
  }
  return ids;
}

function toIso(date: unknown): string | null {
  if (!date) return null;
  if (date instanceof Date) return date.toISOString();
  return String(date);
}

export async function getFrameDocumentation(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeIds = getOptParam<string[]>(params, 'nodeIds');
  const nodeId = getOptParam<string>(params, 'nodeId');
  const includeResolved = getParam<boolean>(params, 'includeResolved', false);

  const ids: string[] = nodeIds && nodeIds.length > 0 ? nodeIds : nodeId ? [nodeId] : [];
  if (ids.length === 0) throw new Error('Provide nodeId or nodeIds');

  // Load all comments once
  const figmaAny = figma as unknown as FigmaWithComments;
  let allComments: ReturnType<typeof Array.from<{
    id: string; message: string; author: { id: string; name: string };
    createdAt: Date; resolved: boolean;
    clientMeta?: { x?: unknown; y?: unknown; nodeId?: unknown; nodeOffset?: unknown };
    replies?: ReadonlyArray<{ id: string; message: string; author?: { id: string; name: string }; createdAt?: Date }>;
  }>> = [];

  if (Array.isArray(figmaAny.comments)) {
    allComments = Array.from(figmaAny.comments);
  } else if (typeof figmaAny.getCommentsAsync === 'function') {
    allComments = Array.from(await figmaAny.getCommentsAsync());
  }

  const frames: Record<string, unknown>[] = [];

  for (const id of ids) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) {
      frames.push({ nodeId: id, error: 'Node not found' });
      continue;
    }

    const frameNode = node as unknown as FrameNode & {
      x: number; y: number; width: number; height: number;
      reactions?: Array<{ trigger: { type: string } | null; actions: Array<{ type: string; destinationId?: string }> }>;
    };

    // Page info
    let pageId = '';
    let pageName = '';
    let current: BaseNode | null = node;
    while (current) {
      if (current.type === 'PAGE') { pageId = current.id; pageName = current.name; break; }
      current = current.parent;
    }

    // Annotations — recursive through subtree
    const annotations = await collectAnnotations(node);

    // Prototype reactions
    const reactions: Record<string, unknown>[] = [];
    if (Array.isArray(frameNode.reactions)) {
      for (const r of frameNode.reactions) {
        for (const action of r.actions) {
          let destName: string | undefined;
          if (action.destinationId) {
            const dest = await figma.getNodeByIdAsync(action.destinationId);
            destName = dest?.name;
          }
          reactions.push({
            trigger: r.trigger?.type ?? 'UNKNOWN',
            action: action.type,
            destinationId: action.destinationId,
            destinationName: destName,
          });
        }
      }
    }

    // Comments — match by nodeId anchor or canvas position within frame bounds
    const descendantIds = collectDescendantIds(node);
    const frameX = frameNode.x ?? 0;
    const frameY = frameNode.y ?? 0;
    const frameW = frameNode.width ?? 0;
    const frameH = frameNode.height ?? 0;

    const frameComments = allComments
      .filter(c => includeResolved || !c.resolved)
      .filter(c => {
        const meta = c.clientMeta;
        if (!meta) return false;
        if (meta.nodeId !== undefined) {
          return descendantIds.has(String(meta.nodeId));
        }
        if (meta.x !== undefined && meta.y !== undefined) {
          const cx = Number(meta.x);
          const cy = Number(meta.y);
          return cx >= frameX && cx <= frameX + frameW && cy >= frameY && cy <= frameY + frameH;
        }
        return false;
      })
      .map(c => ({
        id: c.id,
        message: c.message,
        author: { id: c.author.id, name: c.author.name },
        createdAt: toIso(c.createdAt),
        resolved: c.resolved,
        position: c.clientMeta?.nodeId
          ? { type: 'frame', nodeId: c.clientMeta.nodeId }
          : { type: 'canvas', x: c.clientMeta?.x, y: c.clientMeta?.y },
        replies: c.replies ? Array.from(c.replies).map(r => ({
          id: r.id,
          message: r.message,
          author: r.author ? { id: r.author.id, name: r.author.name } : null,
          createdAt: toIso(r.createdAt),
        })) : [],
      }));

    frames.push({
      nodeId: node.id,
      name: node.name,
      type: node.type,
      pageId,
      pageName,
      width: frameW,
      height: frameH,
      x: frameX,
      y: frameY,
      annotationCount: annotations.length,
      annotations,
      commentCount: frameComments.length,
      comments: frameComments,
      prototypeLinks: reactions,
    });
  }

  return { frameCount: frames.length, frames };
}

function extractAllText(nodes: ContentNode[]): TextItem[] {
  const items: TextItem[] = [];
  for (const node of nodes) {
    if (node.text !== undefined && node.text !== '') {
      items.push({
        id: node.id,
        name: node.name,
        role: node.role,
        text: node.text,
        fontSize: node.fontSize,
      });
    }
    if (node.children) {
      items.push(...extractAllText(node.children));
    }
  }
  return items;
}
