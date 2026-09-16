import { batchActions } from "../../../src/videntia_figma_plugin/handlers/batch";

/**
 * `batch_actions` with `return_state: true` IS the apply-and-verify call: it must
 * forward the flag to every action so each result carries the post-write state.
 */
// batchActions emits progress updates through figma.ui for multi-action batches.
beforeAll(() => {
  (globalThis as any).figma = { ui: { postMessage: () => undefined } };
});
afterAll(() => {
  delete (globalThis as any).figma;
});

describe("batch_actions return_state", () => {
  it("forwards return_state to every action", async () => {
    const seen: Record<string, unknown>[] = [];
    const handle = async (_c: string, p: Record<string, unknown>) => {
      seen.push(p);
      return { nodeId: p.nodeId, state: { summary: "N [FRAME] 1:1 0,0 1x1", props: {} } };
    };

    const result = await batchActions(
      {
        return_state: true,
        actions: [
          { action: "set_padding", params: { nodeId: "1:1", padding: 8 } },
          { action: "set_item_spacing", params: { nodeId: "2:2", gap: 4 } },
        ],
      } as any,
      handle,
    );

    expect(seen.every((p) => p.return_state === true)).toBe(true);
    expect(result.succeeded).toBe(2);
    expect((result.results as any[])[0].result.state.summary).toContain("[FRAME]");
  });

  it("leaves an action's explicit return_state alone and defaults to off", async () => {
    const seen: Record<string, unknown>[] = [];
    const handle = async (_c: string, p: Record<string, unknown>) => {
      seen.push(p);
      return { ok: true };
    };

    await batchActions(
      {
        return_state: true,
        actions: [{ action: "rename_node", params: { nodeId: "1:1", return_state: false } }],
      } as any,
      handle,
    );
    expect(seen[0].return_state).toBe(false);

    seen.length = 0;
    await batchActions({ actions: [{ action: "rename_node", params: { nodeId: "1:1" } }] } as any, handle);
    expect(seen[0].return_state).toBeUndefined();
  });
});
