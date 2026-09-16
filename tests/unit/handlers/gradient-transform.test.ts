import { computeGradientTransform } from "../../../src/videntia_figma_plugin/handlers/fills";

/**
 * Bug #23: `set_gradient_fill` angles were applied in Figma's NORMALISED node
 * space, so on a non-square node angle 0 read as left-to-right and the 0..1 stop
 * range compressed into a sub-window of the node's height. These assert the real
 * matrix numbers for a known 100x300 node.
 *
 * Convention under test: 0 = top-to-bottom, 90 = left-to-right, clockwise.
 */
const W = 100;
const H = 300;

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("computeGradientTransform (aspect-corrected)", () => {
  it("angle 0 on a 100x300 node maps t = y (top-to-bottom, full extent)", () => {
    const t = computeGradientTransform(0, W, H);
    close(t[0][0], 0);
    close(t[0][1], 1);
    close(t[0][2], 0);
    // t at the top edge is 0 and at the bottom edge is 1 — the whole ramp shows.
    const at = (x: number, y: number) => t[0][0] * x + t[0][1] * y + t[0][2];
    close(at(0.5, 0), 0);
    close(at(0.5, 1), 1);
  });

  it("angle 90 on a 100x300 node maps t = x (left-to-right, full extent)", () => {
    const t = computeGradientTransform(90, W, H);
    close(t[0][0], 1);
    close(t[0][1], 0);
    close(t[0][2], 0);
    const at = (x: number, y: number) => t[0][0] * x + t[0][1] * y + t[0][2];
    close(at(0, 0.5), 0);
    close(at(1, 0.5), 1);
  });

  it("angle 180 reverses the vertical ramp on a 100x300 node", () => {
    const t = computeGradientTransform(180, W, H);
    close(t[0][0], 0);
    close(t[0][1], -1);
    close(t[0][2], 1);
  });

  it("angle 45 weights the axes by the node's aspect ratio (100x300)", () => {
    // L = |100*sin45| + |300*cos45| = 282.842712; a = 0.25, b = 0.75, c = 0.
    const t = computeGradientTransform(45, W, H);
    close(t[0][0], 0.25);
    close(t[0][1], 0.75);
    close(t[0][2], 0);
    const at = (x: number, y: number) => t[0][0] * x + t[0][1] * y + t[0][2];
    close(at(0, 0), 0);
    close(at(1, 1), 1);
  });

  it("is a pure rotation on a square node", () => {
    const t = computeGradientTransform(90, 200, 200);
    close(t[0][0], 1);
    close(t[0][1], 0);
    close(t[0][2], 0);
  });

  it("always spans the full 0..1 range across the node for any angle/aspect", () => {
    for (const angle of [0, 30, 45, 90, 135, 180, 270, 315]) {
      for (const [w, h] of [
        [100, 300],
        [400, 50],
        [120, 120],
      ]) {
        const t = computeGradientTransform(angle, w, h);
        const at = (x: number, y: number) => t[0][0] * x + t[0][1] * y + t[0][2];
        const corners = [at(0, 0), at(1, 0), at(0, 1), at(1, 1)];
        close(Math.min(...corners), 0);
        close(Math.max(...corners), 1);
      }
    }
  });

  it("aspectCorrect: false preserves the legacy square-space matrix (escape hatch)", () => {
    const t = computeGradientTransform(0, W, H, false);
    // Legacy: angle 0 == left-to-right (t = x), the pre-fix behaviour.
    close(t[0][0], 1);
    close(t[0][1], 0);
    close(t[0][2], 0);
    close(t[1][0], 0);
    close(t[1][1], 1);
    close(t[1][2], 0.5);
    const t90 = computeGradientTransform(90, W, H, false);
    close(t90[0][0], 0);
    close(t90[0][1], 1);
    close(t90[0][2], 0.5);
  });
});
