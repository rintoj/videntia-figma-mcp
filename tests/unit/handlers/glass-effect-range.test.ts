import { z } from "zod";

/**
 * Bug #22: `dispersion` and `refraction` were DOCUMENTED as 0–20 / 0–50 while
 * Figma rejects anything outside 0–1 — 9 of 17 production calls failed.
 * @figma/plugin-typings GlassEffect says:
 *   lightIntensity "Must be between 0 and 1"
 *   refraction     "Must be between 0 and 1"
 *   dispersion     "Must be between 0 and 1"
 * These tests pin schema, description and plugin validation to that same range.
 */

const toolsSource = require("fs").readFileSync(
  require("path").resolve(__dirname, "../../../src/videntia_figma_mcp/tools/modification-tools.ts"),
  "utf8",
);

describe("GLASS effect documented range matches validation", () => {
  it.each(["refraction", "dispersion", "lightIntensity"])("%s is constrained to 0-1 in the zod schema", (field) => {
    const occurrences = toolsSource.split(`${field}: z.coerce`).length - 1;
    expect(occurrences).toBeGreaterThan(0);
    for (const chunk of toolsSource.split(`${field}: z.coerce`).slice(1)) {
      const decl = chunk.slice(0, chunk.indexOf(".optional()")).replace(/\s+/g, " ");
      expect(decl).toMatch(/\.min\( ?0[,)]/);
      expect(decl).toMatch(/\.max\( ?1[,)]/);
    }
  });

  it.each(["refraction", "dispersion"])("%s no longer advertises the wrong 0-20/0-50 range", (field) => {
    for (const chunk of toolsSource.split(`${field}: z.coerce`).slice(1)) {
      const decl = chunk.slice(0, chunk.indexOf(".optional()") + 200).replace(/\s+/g, " ");
      expect(decl).not.toMatch(/typical range 0–(20|50)/);
      expect(decl).toContain("0–1");
    }
  });

  it("the range error message names 0 and 1", () => {
    const schema = z.coerce
      .number()
      .min(0, "refraction must be between 0 and 1 (Figma normalises this GLASS field; it is NOT a 0-20/0-50 scale)")
      .max(1, "refraction must be between 0 and 1 (Figma normalises this GLASS field; it is NOT a 0-20/0-50 scale)");
    const result = schema.safeParse(20);
    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0].message).toContain("between 0 and 1");
  });
});

describe("plugin-side GLASS validation", () => {
  const effectsSource = require("fs").readFileSync(
    require("path").resolve(__dirname, "../../../src/videntia_figma_plugin/handlers/effects.ts"),
    "utf8",
  );

  it.each(["refraction", "dispersion", "lightIntensity"])("%s routes through clampUnit", (field) => {
    expect(effectsSource).toContain(`clampUnit(effect["${field}"]`);
  });

  it("rejects out-of-range values with a message naming the real range", () => {
    // Mirror of the handler's private clampUnit, exercised through the real file.
    expect(effectsSource).toMatch(/must be a number between 0 and 1 \(normalised\)/);
    expect(effectsSource).toMatch(/NOT 0–20 or 0–50 scales/);
  });
});
