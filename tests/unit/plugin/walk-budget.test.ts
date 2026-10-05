import {
  createWalkBudget,
  createYielder,
  estimateNodeBytes,
  truncationHint,
} from "../../../src/videntia_figma_plugin/utils/walk-budget";

describe("walk-budget", () => {
  it("stops at maxNodes", () => {
    const b = createWalkBudget(3, 1e9);
    expect([b.take(1), b.take(1), b.take(1), b.take(1)]).toEqual([true, true, true, false]);
    expect(b.truncated).toBe(true);
    expect(b.reason).toBe("maxNodes");
    expect(b.nodes).toBe(3);
  });

  it("stops at maxBytes and stays stopped", () => {
    const b = createWalkBudget(100, 10);
    expect(b.take(6)).toBe(true);
    expect(b.take(6)).toBe(false);
    expect(b.take(1)).toBe(false);
    expect(b.reason).toBe("maxBytes");
    expect(b.bytes).toBe(6);
  });

  it("estimates bytes close to JSON length and ignores children", () => {
    const n = { id: "1:2", name: "Title", type: "TEXT", width: 10, children: [{ a: "x".repeat(999) }] };
    const { children: _c, ...own } = n;
    const est = estimateNodeBytes(n);
    expect(Math.abs(est - JSON.stringify(own).length)).toBeLessThan(20);
  });

  it("yields once every N ticks", async () => {
    let sleeps = 0;
    const tick = createYielder(1000, async () => {
      sleeps++;
    });
    for (let i = 0; i < 2500; i++) await tick();
    expect(sleeps).toBe(2);
  });

  it("hint names the limit and the remedies", () => {
    expect(truncationHint("maxBytes", 2000, 512000)).toContain("maxBytes=512000");
    const h = truncationHint("maxNodes", 2000, 512000);
    expect(h).toContain("maxNodes=2000");
    expect(h).toContain("nodeId");
    expect(h).toContain("maxDepth");
  });
});
