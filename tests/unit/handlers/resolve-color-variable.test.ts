/// <reference types="@figma/plugin-typings" />
import { resolveColorVariable } from "../../../src/videntia_figma_plugin/handlers/icons";

/**
 * Minimal Variable stub matching what resolveColorVariable needs.
 */
function makeVar(name: string): Variable {
  return { name, resolvedType: "COLOR" } as unknown as Variable;
}

describe("resolveColorVariable", () => {
  const vars = [
    makeVar("gray/500"),
    makeVar("color/text/secondary"),
    makeVar("semantic/text/secondary"),
    makeVar("brand/primary"),
    makeVar("icon/secondary"),
    makeVar("text/secondary"),
  ];

  // Step 1: exact match
  it("returns exact match", async () => {
    const result = await resolveColorVariable("gray/500", vars);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("gray/500");
  });

  // Step 2: dash-to-slash normalisation
  it("normalises dashes to slashes", async () => {
    const result = await resolveColorVariable("gray-500", vars);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("gray/500");
  });

  // Step 2: full dash normalisation for multi-segment names
  it("normalises multi-segment dashes", async () => {
    const result = await resolveColorVariable("brand-primary", vars);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("brand/primary");
  });

  // Step 3: case-insensitive match
  it("matches case-insensitively", async () => {
    const result = await resolveColorVariable("Gray/500", vars);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("gray/500");
  });

  // Step 4: suffix matching — picks shortest (most specific)
  it("suffix-matches and picks shortest name", async () => {
    const result = await resolveColorVariable("text/secondary", vars);
    // exact match should win (step 1) for "text/secondary"
    expect(result).not.toBeNull();
    expect(result!.name).toBe("text/secondary");
  });

  it("suffix-matches with dash normalisation", async () => {
    // "text-secondary" normalises to "text/secondary"
    // Step 2 finds "text/secondary" as exact match
    const result = await resolveColorVariable("text-secondary", vars);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("text/secondary");
  });

  it("suffix-matches when no exact/normalised/ci match exists", async () => {
    // "icon/muted" doesn't exist exactly, but test with a suffix that
    // only matches via suffix
    const testVars = [makeVar("semantic/icon/muted"), makeVar("color/icon/muted")];
    const result = await resolveColorVariable("icon/muted", testVars);
    expect(result).not.toBeNull();
    // "color/icon/muted" is shorter than "semantic/icon/muted"
    expect(result!.name).toBe("color/icon/muted");
  });

  it("suffix-matches with dash input against prefixed variable", async () => {
    const testVars = [makeVar("color/text/secondary")];
    const result = await resolveColorVariable("text-secondary", testVars);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("color/text/secondary");
  });

  // Tie-break: alphabetical when equal length
  it("breaks ties alphabetically for equal-length suffix matches", async () => {
    const testVars = [makeVar("zz/icon/muted"), makeVar("aa/icon/muted")];
    const result = await resolveColorVariable("icon/muted", testVars);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("aa/icon/muted");
  });

  // No match
  it("returns null when no match found", async () => {
    const result = await resolveColorVariable("nonexistent-var", vars);
    expect(result).toBeNull();
  });

  // Should not match partial names without "/" separator
  it("does not suffix-match without slash separator", async () => {
    const testVars = [makeVar("darksecondary")];
    // "secondary" should NOT match "darksecondary" because the suffix check
    // requires "/<input>" — i.e. "/secondary" at the end
    const result = await resolveColorVariable("secondary", testVars);
    expect(result).toBeNull();
  });

  // Empty preloaded vars
  it("returns null with empty variable list", async () => {
    const result = await resolveColorVariable("gray/500", []);
    expect(result).toBeNull();
  });
});
