import { boundedMap } from "../../../src/videntia_figma_plugin/utils/bounded-map";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("boundedMap", () => {
  it("preserves input order", async () => {
    const out = await boundedMap([30, 5, 20, 1, 10], 3, async (ms, i) => {
      await tick(ms);
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3, 4]);
  });

  it("never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await boundedMap(
      Array.from({ length: 30 }, (_, i) => i),
      8,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await tick(2);
        inFlight--;
      },
    );
    expect(peak).toBe(8);
  });

  it("handles empty input and bad limits", async () => {
    expect(await boundedMap([], 8, async (x) => x)).toEqual([]);
    expect(await boundedMap([1, 2], 0, async (x) => x * 2)).toEqual([2, 4]);
  });

  it("rejects when a call rejects", async () => {
    await expect(
      boundedMap([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error("boom");
        return x;
      }),
    ).rejects.toThrow("boom");
  });
});
