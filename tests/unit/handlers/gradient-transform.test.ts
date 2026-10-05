import { computeGradientTransform } from "../../../src/videntia_figma_plugin/handlers/fills";

/**
 * Convention under test: CSS linear-gradient — 0 = to top, 90 = to right,
 * 180 = to bottom, 270 = to left, clockwise. Stops span the node's full extent.
 */
const W = 100;
const H = 300;

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);
const sampler = (t: number[][]) => (x: number, y: number) => t[0][0] * x + t[0][1] * y + t[0][2];

describe("computeGradientTransform (aspect-corrected)", () => {
  it("180 on a 100x300 node runs top → bottom (t = y)", () => {
    const at = sampler(computeGradientTransform(180, W, H));
    close(at(0.5, 0), 0);
    close(at(0.5, 1), 1);
    close(at(0.5, 0.5), 0.5);
  });

  it("0 runs bottom → top", () => {
    const at = sampler(computeGradientTransform(0, W, H));
    close(at(0.5, 1), 0);
    close(at(0.5, 0), 1);
  });

  it("90 runs left → right (t = x); 270 right → left", () => {
    const t = computeGradientTransform(90, W, H);
    close(t[0][0], 1);
    close(t[0][1], 0);
    close(t[0][2], 0);
    const at270 = sampler(computeGradientTransform(270, W, H));
    close(at270(1, 0.5), 0);
    close(at270(0, 0.5), 1);
  });

  it("45 on a 100x300 node weights the axes by aspect ratio and runs bottom-left → top-right", () => {
    // L = |100·sin45| + |300·cos45|; a = 0.25, b = -0.75, c = 0.75.
    const t = computeGradientTransform(45, W, H);
    close(t[0][0], 0.25);
    close(t[0][1], -0.75);
    close(t[0][2], 0.75);
    const at = sampler(t);
    close(at(0, 1), 0);
    close(at(1, 0), 1);
  });

  it("always spans 0..1 across the node and is 0.5 at the centre", () => {
    for (const angle of [0, 30, 45, 90, 135, 180, 270, 315]) {
      for (const [w, h] of [
        [100, 300],
        [400, 50],
        [120, 120],
      ]) {
        const at = sampler(computeGradientTransform(angle, w, h));
        const corners = [at(0, 0), at(1, 0), at(0, 1), at(1, 1)];
        close(Math.min(...corners), 0);
        close(Math.max(...corners), 1);
        close(at(0.5, 0.5), 0.5);
      }
    }
  });
});

describe("computeGradientTransform (aspectCorrect: false — unit square)", () => {
  it("90 is t = x: left-centre 0, right-centre 1 (no hard edge at the middle)", () => {
    const at = sampler(computeGradientTransform(90, W, H, false));
    close(at(0, 0.5), 0);
    close(at(1, 0.5), 1);
    close(at(0.5, 0.5), 0.5);
    close(at(0.25, 0.5), 0.25);
  });

  it("180 is t = y: top-centre 0, bottom-centre 1", () => {
    const at = sampler(computeGradientTransform(180, W, H, false));
    close(at(0.5, 0), 0);
    close(at(0.5, 1), 1);
  });

  it("is centred and spans 0..1 for every angle, ignoring the node size", () => {
    for (const angle of [0, 45, 90, 135, 180, 225, 270, 315, 17]) {
      const at = sampler(computeGradientTransform(angle, W, H, false));
      const corners = [at(0, 0), at(1, 0), at(0, 1), at(1, 1)];
      close(at(0.5, 0.5), 0.5);
      close(Math.min(...corners), 0);
      close(Math.max(...corners), 1);
    }
  });
});
