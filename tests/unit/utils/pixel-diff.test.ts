import { diffImages } from "../../../src/videntia_figma_mcp/utils/pixel-diff.js";
import * as fs from "fs";
import * as path from "path";

describe("diffImages", () => {
  it("returns zero mismatches for identical images", async () => {
    const img = fs.readFileSync(path.join(__dirname, "fixtures/red-10x10.png"));
    const result = await diffImages(img, img, { tolerance: 0.1 });
    expect(result.mismatchedPixels).toBe(0);
    expect(result.deviationPercent).toBe(0);
  });

  it("returns non-zero mismatches for different images", async () => {
    const red = fs.readFileSync(path.join(__dirname, "fixtures/red-10x10.png"));
    const blue = fs.readFileSync(path.join(__dirname, "fixtures/blue-10x10.png"));
    const result = await diffImages(red, blue, { tolerance: 0.1 });
    expect(result.mismatchedPixels).toBeGreaterThan(0);
    expect(result.deviationPercent).toBeGreaterThan(0);
    expect(result.diffPng).toBeInstanceOf(Buffer);
  });
});
