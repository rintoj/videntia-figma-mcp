import {
  readNodeAnnotations,
  resolveInheritedAnnotations,
  applySuppressions,
  parseIgnoreRules,
  TOKEN_BINDING_CATEGORIES,
} from "../../../src/videntia_figma_plugin/handlers/lint/suppress";
import type { Violation, ViolationCategory } from "../../../src/videntia_figma_plugin/handlers/lint/types";

// Minimal stand-in for a Figma node: name, plugin data and a parent chain.
function node(
  name: string,
  pluginData: Record<string, string> = {},
  parent: unknown = null,
): { name: string; type: string; parent: unknown; getPluginData(key: string): string } {
  return {
    name,
    type: "FRAME",
    parent,
    getPluginData: (key: string) => pluginData[key] || "",
  };
}

function violation(over: Partial<Violation> = {}): Violation {
  return {
    nodeId: "1:1",
    nodeName: "Badge",
    nodeType: "FRAME",
    depth: 2,
    severity: "CRITICAL",
    category: "backgroundFills" as ViolationCategory,
    rule: "hardcoded-color",
    property: "fills[0]",
    message: "Color using raw hex value",
    ...over,
  };
}

describe("readNodeAnnotations", () => {
  it("reads ignore rules from plugin data", () => {
    expect(readNodeAnnotations(node("Card", { "lint.ignore": "backgroundFills, radius" }) as never).ignore).toEqual([
      "backgroundFills",
      "radius",
    ]);
  });

  it("accepts the camelCase plugin data key too", () => {
    expect(readNodeAnnotations(node("Card", { lintIgnore: "colors" }) as never).ignore).toEqual(["colors"]);
  });

  it("reads a bracketed name suffix", () => {
    expect(readNodeAnnotations(node("Brand Gradient [lint-ignore: backgroundFills]") as never).ignore).toEqual([
      "backgroundFills",
    ]);
  });

  it("reads the Lint/ignore path convention", () => {
    expect(readNodeAnnotations(node("Blob Lint/ignore: effectStyles") as never).ignore).toEqual(["effectStyles"]);
  });

  it("reads a role from a name suffix and normalises synonyms", () => {
    expect(readNodeAnnotations(node("Wordmark [role: artwork]") as never).role).toBe("artwork");
    expect(readNodeAnnotations(node("Wordmark [role: logo]") as never).role).toBe("artwork");
    expect(readNodeAnnotations(node("Panel [role: ui]") as never).role).toBe("ui");
  });

  it("returns nothing for an unannotated node", () => {
    expect(readNodeAnnotations(node("Plain Frame") as never)).toEqual({ ignore: [], role: null });
  });
});

describe("resolveInheritedAnnotations", () => {
  it("inherits an ancestor's role", () => {
    const logo = node("Illustration [role: artwork]");
    const path = node("Vector 12", {}, logo);
    expect(resolveInheritedAnnotations(path as never).role).toBe("artwork");
  });

  it("lets a nearer [role: ui] override an artwork ancestor", () => {
    const logo = node("Illustration [role: artwork]");
    const label = node("Caption [role: ui]", {}, logo);
    expect(resolveInheritedAnnotations(label as never).role).toBe("ui");
  });

  it("unions ignore rules along the chain", () => {
    const root = node("Screen [lint-ignore: effectStyles]");
    const child = node("Hero", { "lint.ignore": "backgroundFills" }, root);
    expect(resolveInheritedAnnotations(child as never).ignore.sort()).toEqual(["backgroundFills", "effectStyles"]);
  });
});

describe("applySuppressions", () => {
  const noAnnotations = {};

  it("keeps violations when nothing is suppressed", () => {
    const out = applySuppressions([violation()], [], noAnnotations);
    expect(out.kept).toHaveLength(1);
    expect(out.suppressed).toHaveLength(0);
  });

  it("suppresses by category via ignore_rules", () => {
    const out = applySuppressions([violation()], ["backgroundFills"], noAnnotations);
    expect(out.kept).toHaveLength(0);
    expect(out.suppressed[0].suppressed).toBe(true);
    expect(out.suppressed[0].suppressedBy).toContain("ignore_rules");
  });

  it("suppresses by check name", () => {
    expect(applySuppressions([violation()], ["colors"], noAnnotations).suppressed).toHaveLength(1);
  });

  it("suppresses by exact category:property", () => {
    expect(applySuppressions([violation()], ["backgroundFills:fills[0]"], noAnnotations).kept).toHaveLength(0);
    expect(applySuppressions([violation()], ["backgroundFills:fills[1]"], noAnnotations).kept).toHaveLength(1);
  });

  it("suppresses everything with a wildcard", () => {
    expect(applySuppressions([violation(), violation({ category: "overflow" })], ["*"], noAnnotations).kept).toEqual(
      [],
    );
  });

  it("does not suppress an unrelated category", () => {
    expect(
      applySuppressions([violation({ category: "overflow" })], ["backgroundFills"], noAnnotations).kept,
    ).toHaveLength(1);
  });

  it("suppresses via a per-node annotation", () => {
    const out = applySuppressions([violation()], [], { "1:1": { ignore: ["backgroundFills"], role: null } });
    expect(out.suppressed[0].suppressedBy).toContain("node annotation");
  });

  it("exempts artwork nodes from every token-binding rule", () => {
    const annotations = { "1:1": { ignore: [], role: "artwork" as const } };
    for (const category of TOKEN_BINDING_CATEGORIES) {
      const out = applySuppressions([violation({ category })], [], annotations);
      expect(out.suppressed).toHaveLength(1);
      expect(out.suppressed[0].suppressedBy).toContain("artwork");
    }
  });

  it("still lints non-token rules on artwork nodes", () => {
    const out = applySuppressions([violation({ category: "overflow" })], [], {
      "1:1": { ignore: [], role: "artwork" },
    });
    expect(out.kept).toHaveLength(1);
  });

  it("does not mutate the original violation objects", () => {
    const v = violation();
    applySuppressions([v], ["*"], noAnnotations);
    expect(v.suppressed).toBeUndefined();
  });
});

describe("parseIgnoreRules", () => {
  it("accepts an array", () => expect(parseIgnoreRules(["a", "b"])).toEqual(["a", "b"]));
  it("accepts a comma string", () => expect(parseIgnoreRules("a, b")).toEqual(["a", "b"]));
  it("accepts nothing", () => expect(parseIgnoreRules(undefined)).toEqual([]));
});
