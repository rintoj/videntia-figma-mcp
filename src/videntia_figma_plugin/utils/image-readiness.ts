/**
 * Make sure every image a subtree paints with is loaded before it is rendered.
 *
 * `exportAsync` straight after an image fill was assigned (e.g. the next action of the
 * same `batch_actions`) can render the image paint blank while Figma is still loading
 * it. `Image.getSizeAsync()` only resolves once the image data is available, so awaiting
 * it for every referenced hash before exporting removes that race.
 */

const NODE_BUDGET = 4000;

function addPaintHashes(paints: unknown, out: Set<string>): void {
  if (!Array.isArray(paints)) return;
  for (const paint of paints) {
    const p = paint as { type?: string; imageHash?: string | null };
    if (p && p.type === "IMAGE" && typeof p.imageHash === "string" && p.imageHash) out.add(p.imageHash);
  }
}

/** Every IMAGE paint hash (fills and strokes) in the subtree, capped at NODE_BUDGET nodes. */
export function collectImageHashes(root: BaseNode): string[] {
  const hashes = new Set<string>();
  const stack: BaseNode[] = [root];
  let visited = 0;
  while (stack.length > 0 && visited < NODE_BUDGET) {
    const node = stack.pop() as BaseNode;
    visited++;
    const anyNode = node as unknown as Record<string, unknown>;
    try {
      addPaintHashes(anyNode.fills, hashes);
      addPaintHashes(anyNode.strokes, hashes);
    } catch {
      // Unreadable paints are skipped; the export still runs.
    }
    const children = (node as unknown as { children?: readonly BaseNode[] }).children;
    if (children) for (let i = 0; i < children.length; i++) stack.push(children[i]);
  }
  return Array.from(hashes);
}

/** Await readiness of every image the subtree paints with. Never throws. */
export async function awaitSubtreeImagesReady(root: BaseNode): Promise<void> {
  const hashes = collectImageHashes(root);
  if (hashes.length === 0) return;
  await Promise.all(
    hashes.map(async (hash) => {
      try {
        const image = figma.getImageByHash(hash);
        if (image) await image.getSizeAsync();
      } catch {
        // A missing/broken image renders the same either way; do not fail the export.
      }
    }),
  );
}
