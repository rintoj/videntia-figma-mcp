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
    throw new Error('Missing or empty name parameter');
  }

  const trimmedName = name.trim();
  const existing = figma.root.children.find(
    (p) => p.name.toLowerCase() === trimmedName.toLowerCase(),
  );
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
    throw new Error('Missing pageId parameter');
  }

  if (!name || !name.trim()) {
    throw new Error('Missing or empty name parameter');
  }

  const node = await figma.getNodeByIdAsync(pageId);
  if (!node) {
    throw new Error(`Page not found with ID: ${pageId}`);
  }

  if (node.type !== 'PAGE') {
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
    throw new Error('Missing pageId parameter');
  }

  if (figma.root.children.length <= 1) {
    throw new Error('Cannot delete the last remaining page');
  }

  const node = await figma.getNodeByIdAsync(pageId);
  if (!node) {
    throw new Error(`Page not found with ID: ${pageId}`);
  }

  if (node.type !== 'PAGE') {
    throw new Error(`Node ${pageId} is not a page (type: ${node.type})`);
  }

  // Switch away from current page before removing it
  if (figma.currentPage.id === pageId) {
    const nextPage = figma.root.children.find((p) => p.id !== pageId);
    if (nextPage) {
      figma.currentPage = nextPage as PageNode;
    }
  }

  const pageInfo: DeletePageResult = {
    id: node.id,
    name: node.name,
  };

  node.remove();

  return pageInfo;
}
