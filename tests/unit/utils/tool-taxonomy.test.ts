import * as fs from "fs";
import * as path from "path";
import {
  TOOL_CATEGORIES,
  TOOL_CATEGORY_MAP,
  TOOL_SYNONYMS,
  matchTools,
  taxonomyToolNames,
  toolsInCategory,
} from "../../../src/videntia_figma_mcp/utils/tool-taxonomy";

/** Registry-driven: scan the real tool sources so this fails when a tool is added. */
function registeredToolNames(): string[] {
  const dir = path.resolve(__dirname, "../../../src/videntia_figma_mcp/tools");
  const names: string[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".ts")) continue;
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    const re = /server\.tool\(\s*\n?\s*["'`]([a-z0-9_]+)["'`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) names.push(m[1]);
  }
  return names;
}

const REGISTERED = registeredToolNames();

describe("tool taxonomy coverage", () => {
  it("finds the registered tool surface", () => {
    expect(REGISTERED.length).toBeGreaterThan(200);
    expect(new Set(REGISTERED).size).toBe(REGISTERED.length);
  });

  it("categorises every registered tool", () => {
    const missing = REGISTERED.filter((n) => !TOOL_CATEGORY_MAP[n]);
    expect(missing).toEqual([]);
  });

  it("has no stale entries for tools that no longer exist", () => {
    const known = new Set(REGISTERED);
    // Discovery meta-tools are owned by the progressive-disclosure layer and may be
    // renamed there; do not fail this file for them.
    const DISCOVERY_EXEMPT = new Set(["find_figma_tools", "describe_figma_tools", "load_figma_tools", "figma_call"]);
    const stale = taxonomyToolNames().filter((n) => !known.has(n) && !DISCOVERY_EXEMPT.has(n));
    expect(stale).toEqual([]);
  });

  it("uses only declared categories, with no primary/secondary duplication", () => {
    const ids = new Set(TOOL_CATEGORIES.map((c) => c.id));
    for (const [name, entry] of Object.entries(TOOL_CATEGORY_MAP)) {
      expect(ids.has(entry.category)).toBe(true);
      for (const s of entry.secondary ?? []) {
        expect(ids.has(s)).toBe(true);
        expect(`${name}:${s}`).not.toBe(`${name}:${entry.category}`);
      }
    }
  });

  it("gives every category at least one primary tool", () => {
    for (const cat of TOOL_CATEGORIES) {
      expect({ cat: cat.id, n: toolsInCategory(cat.id).length }.n).toBeGreaterThan(0);
    }
  });

  it("points every synonym target at a real tool", () => {
    const known = new Set(REGISTERED);
    const bad: string[] = [];
    for (const [phrase, targets] of Object.entries(TOOL_SYNONYMS)) {
      expect(targets.length).toBeGreaterThan(0);
      for (const t of targets) if (!known.has(t)) bad.push(`${phrase} -> ${t}`);
    }
    expect(bad).toEqual([]);
  });

  it("keeps synonym keys lowercase and normalized", () => {
    for (const phrase of Object.keys(TOOL_SYNONYMS)) {
      expect(phrase).toBe(phrase.toLowerCase().trim());
      expect(phrase).toMatch(/^[a-z0-9]+( [a-z0-9]+)*$/);
    }
  });
});

describe("matchTools", () => {
  const top = (q: string, n = 3) =>
    matchTools(q, { toolNames: REGISTERED })
      .slice(0, n)
      .map((r) => r.name);

  const cases: Array<[string, string]> = [
    ["center text", "set_text_align"],
    ["drop shadow on a card", "set_effects"],
    ["create a colour token", "create_variable"],
    ["screenshot this frame", "export_node_as_image"],
    ["check contrast", "calculate_contrast_ratio"],
    ["round the corners", "set_corner_radius"],
    ["set the gap", "set_gap"],
    ["make an auto layout frame", "create_autolayout_frame"],
    ["change the font size", "set_font_size"],
    ["bind a design token to a fill", "bind_variable"],
    ["read the browser console", "browser_read_console"],
    ["find an icon", "search_icon"],
  ];

  it.each(cases)("ranks %s -> %s in the top 3", (query, expected) => {
    expect(top(query)).toContain(expected);
  });

  it("ranks an exact tool name first", () => {
    expect(top("set_corner_radius", 1)).toEqual(["set_corner_radius"]);
  });

  it("returns nothing for an empty or stop-word-only query", () => {
    expect(matchTools("", { toolNames: REGISTERED })).toEqual([]);
    expect(matchTools("the a of", { toolNames: REGISTERED })).toEqual([]);
  });

  it("never returns a tool outside the supplied registry", () => {
    const subset = ["set_text_align", "create_frame"];
    for (const r of matchTools("center text", { toolNames: subset })) {
      expect(subset).toContain(r.name);
    }
  });

  it("respects the limit and returns descending scores with reasons", () => {
    const res = matchTools("shadow", { toolNames: REGISTERED, limit: 4 });
    expect(res.length).toBeLessThanOrEqual(4);
    expect(res.length).toBeGreaterThan(0);
    for (let i = 1; i < res.length; i++) expect(res[i - 1].score).toBeGreaterThanOrEqual(res[i].score);
    expect(res[0].reasons.length).toBeGreaterThan(0);
    expect(res[0].category).toBeDefined();
  });

  it("uses descriptions as a tie-breaking signal", () => {
    const names = ["create_rectangle", "create_frame"];
    const res = matchTools("rounded container box", {
      toolNames: names,
      descriptions: { create_frame: "Create a rounded container box in Figma" },
    });
    expect(res[0].name).toBe("create_frame");
  });
});
