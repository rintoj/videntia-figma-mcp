import { resolveColor } from "./fills";

export interface CreatePageParams {
  name?: string;
}

export interface CreatePageResult {
  id: string;
  name: string;
}

export async function createPage(params: CreatePageParams): Promise<CreatePageResult> {
  const name = params !== null && params !== undefined ? params.name : undefined;

  if (!name || !name.trim()) {
    throw new Error("Missing or empty name parameter");
  }

  const trimmedName = name.trim();
  const existing = figma.root.children.find((p) => p.name.toLowerCase() === trimmedName.toLowerCase());
  if (existing) {
    throw new Error(`A page named "${existing.name}" already exists (ID: ${existing.id})`);
  }

  const page = figma.createPage();
  page.name = trimmedName;

  return {
    id: page.id,
    name: page.name,
  };
}

export interface RenamePageParams {
  pageId?: string;
  name?: string;
}

export interface RenamePageResult {
  id: string;
  oldName: string;
  newName: string;
}

export async function renamePage(params: RenamePageParams): Promise<RenamePageResult> {
  const pageId = params !== null && params !== undefined ? params.pageId : undefined;
  const name = params !== null && params !== undefined ? params.name : undefined;

  if (!pageId) {
    throw new Error("Missing pageId parameter");
  }

  if (!name || !name.trim()) {
    throw new Error("Missing or empty name parameter");
  }

  const node = await figma.getNodeByIdAsync(pageId);
  if (!node) {
    throw new Error(`Page not found with ID: ${pageId}`);
  }

  if (node.type !== "PAGE") {
    throw new Error(`Node ${pageId} is not a page (type: ${node.type})`);
  }

  const trimmedName = name.trim();
  const existing = figma.root.children.find(
    (p) => p.id !== pageId && p.name.toLowerCase() === trimmedName.toLowerCase(),
  );
  if (existing) {
    throw new Error(`A page named "${existing.name}" already exists (ID: ${existing.id})`);
  }

  const page = node as PageNode;
  const oldName = page.name;
  page.name = trimmedName;

  return {
    id: page.id,
    oldName,
    newName: page.name,
  };
}

export interface DeletePageParams {
  pageId?: string;
}

export interface DeletePageResult {
  id: string;
  name: string;
}

export async function deletePage(params: DeletePageParams): Promise<DeletePageResult> {
  const pageId = params !== null && params !== undefined ? params.pageId : undefined;

  if (!pageId) {
    throw new Error("Missing pageId parameter");
  }

  if (figma.root.children.length <= 1) {
    throw new Error("Cannot delete the last remaining page");
  }

  const node = await figma.getNodeByIdAsync(pageId);
  if (!node) {
    throw new Error(`Page not found with ID: ${pageId}`);
  }

  if (node.type !== "PAGE") {
    throw new Error(`Node ${pageId} is not a page (type: ${node.type})`);
  }

  // Switch away from current page before removing it
  if (figma.currentPage.id === pageId) {
    const nextPage = figma.root.children.find((p) => p.id !== pageId);
    if (nextPage) {
      await figma.setCurrentPageAsync(nextPage as PageNode);
    }
  }

  const pageInfo: DeletePageResult = {
    id: node.id,
    name: node.name,
  };

  node.remove();

  return pageInfo;
}

export interface SetPageBackgroundResult {
  id: string;
  name: string;
  backgrounds: readonly Paint[];
}

/**
 * Set a page's canvas background colour.
 *
 * Figma pages expose `backgrounds` (an array of Paint), NOT `fills` — which is
 * why `set_fill_color` reports "Node does not support fills" on a PAGE node.
 * Accepts the same colour formats as the other colour tools (hex string or rgba).
 */
export async function setPageBackground(params: Record<string, unknown>): Promise<SetPageBackgroundResult> {
  const p = params || {};
  const pageId = p["pageId"] as string | undefined;

  let page: PageNode;
  if (pageId) {
    const node = await figma.getNodeByIdAsync(pageId);
    if (!node) {
      throw new Error(`Page not found with ID: ${pageId}`);
    }
    if (node.type !== "PAGE") {
      throw new Error(`Node ${pageId} is not a page (type: ${node.type})`);
    }
    page = node as PageNode;
  } else {
    page = figma.currentPage;
  }

  const rgba = resolveColor(p);
  page.backgrounds = [
    {
      type: "SOLID",
      color: { r: rgba.r, g: rgba.g, b: rgba.b },
      opacity: rgba.a,
    } as SolidPaint,
  ];

  return {
    id: page.id,
    name: page.name,
    backgrounds: page.backgrounds,
  };
}
