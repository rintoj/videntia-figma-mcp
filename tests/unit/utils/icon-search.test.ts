import { searchIcons, getIcon, listIcons } from "../../../src/hgraph_figma_mcp/utils/icon-search";

describe("icon-search", () => {
  describe("searchIcons", () => {
    it("returns empty array for empty query", () => {
      expect(searchIcons("")).toEqual([]);
      expect(searchIcons("   ")).toEqual([]);
    });

    it("finds exact match with score 100", () => {
      const results = searchIcons("bell");
      const bell = results.find((r) => r.name === "bell");
      expect(bell).toBeDefined();
      expect(bell!.matchType).toBe("exact");
      expect(bell!.score).toBe(100);
      expect(bell!.svg).toContain("<svg");
    });

    it("resolves alias to correct icon", () => {
      const results = searchIcons("notification");
      const bell = results.find((r) => r.name === "bell");
      expect(bell).toBeDefined();
      expect(bell!.matchType).toBe("alias");
      expect(bell!.score).toBe(90);
    });

    it("finds prefix matches", () => {
      const results = searchIcons("arrow", 20);
      const prefixMatches = results.filter((r) => r.matchType === "prefix");
      expect(prefixMatches.length).toBeGreaterThan(0);
      expect(prefixMatches.every((r) => r.name.startsWith("arrow"))).toBe(true);
      expect(prefixMatches.every((r) => r.score === 80)).toBe(true);
    });

    it("finds word-boundary matches", () => {
      const results = searchIcons("check", 20);
      const wordBoundary = results.filter((r) => r.matchType === "word-boundary");
      expect(wordBoundary.length).toBeGreaterThan(0);
      // e.g., "circle-check" should be a word-boundary match
      const circleCheck = wordBoundary.find((r) => r.name === "circle-check");
      expect(circleCheck).toBeDefined();
      expect(circleCheck!.score).toBe(70);
    });

    it("finds substring matches", () => {
      const results = searchIcons("heart", 20);
      const exact = results.find((r) => r.name === "heart");
      expect(exact).toBeDefined();
      // "heart-crack" should be prefix, "heart" parts in other names could be substring
      const prefixes = results.filter((r) => r.matchType === "prefix");
      expect(prefixes.length).toBeGreaterThan(0);
    });

    it("finds fuzzy matches", () => {
      const results = searchIcons("arwlft", 10);
      const arrowLeft = results.find((r) => r.name === "arrow-left");
      expect(arrowLeft).toBeDefined();
      expect(arrowLeft!.matchType).toBe("fuzzy");
      expect(arrowLeft!.score).toBeGreaterThanOrEqual(40);
      expect(arrowLeft!.score).toBeLessThanOrEqual(55);
    });

    it("supports multi-pattern with |", () => {
      const results = searchIcons("arrow|chevron", 100);
      const hasArrow = results.some((r) => r.name.startsWith("arrow"));
      const hasChevron = results.some((r) => r.name.startsWith("chevron"));
      expect(hasArrow).toBe(true);
      expect(hasChevron).toBe(true);
    });

    it("deduplicates across patterns", () => {
      // "bell" matches both exact and as "notification" alias
      const results = searchIcons("bell|notification");
      const bellResults = results.filter((r) => r.name === "bell");
      expect(bellResults.length).toBe(1);
      // Should keep the higher score (exact = 100 > alias = 90)
      expect(bellResults[0].matchType).toBe("exact");
    });

    it("respects limit parameter", () => {
      const results = searchIcons("arrow", 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("returns results sorted by score descending", () => {
      const results = searchIcons("check", 20);
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
      }
    });

    it("handles multiple aliases correctly", () => {
      // "hamburger" → menu
      const r1 = searchIcons("hamburger");
      expect(r1.some((r) => r.name === "menu")).toBe(true);

      // "close" → x
      const r2 = searchIcons("close");
      expect(r2.some((r) => r.name === "x")).toBe(true);

      // "home" → house
      const r3 = searchIcons("home");
      expect(r3.some((r) => r.name === "house")).toBe(true);
    });

    it("returns SVG markup for all results", () => {
      const results = searchIcons("star", 5);
      for (const result of results) {
        expect(result.svg).toContain("<svg");
        expect(result.svg).toContain("</svg>");
      }
    });

    it("returns no results for nonsense query", () => {
      const results = searchIcons("zzzzzzxyz");
      expect(results.length).toBe(0);
    });

    it("handles fuzzy match for chevron-down abbreviation", () => {
      const results = searchIcons("chvdn", 10);
      const chevronDown = results.find((r) => r.name === "chevron-down");
      expect(chevronDown).toBeDefined();
      expect(chevronDown!.matchType).toBe("fuzzy");
    });
  });

  describe("getIcon", () => {
    it("returns icon for exact name", () => {
      const result = getIcon("arrow-left");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("arrow-left");
      expect(result!.svg).toContain("<svg");
    });

    it("returns null for non-existent icon", () => {
      const result = getIcon("non-existent-icon-xyz");
      expect(result).toBeNull();
    });

    it("normalises name to lowercase", () => {
      const result = getIcon("Arrow-Left");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("arrow-left");
    });

    it("trims whitespace", () => {
      const result = getIcon("  bell  ");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("bell");
    });

    it("resolves alias to target icon", () => {
      const result = getIcon("notification");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("bell");
      expect(result!.svg).toContain("<svg");
    });

    it("resolves multiple aliases", () => {
      expect(getIcon("dismiss")!.name).toBe("x");
      expect(getIcon("preferences")!.name).toBe("settings");
      expect(getIcon("favourite")!.name).toBe("star");
      expect(getIcon("signout")!.name).toBe("log-out");
    });

    it("prefers exact match over alias", () => {
      // "link" is both an icon name and an alias
      const result = getIcon("link");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("link");
    });
  });

  describe("listIcons", () => {
    it("returns all icons with default pagination", () => {
      const result = listIcons({});
      expect(result.total).toBeGreaterThan(1000);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(50);
      expect(result.icons.length).toBe(50);
    });

    it("filters by prefix", () => {
      const result = listIcons({ prefix: "arrow" });
      expect(result.total).toBeGreaterThan(0);
      expect(result.icons.every((n) => n.startsWith("arrow"))).toBe(true);
    });

    it("respects offset and limit", () => {
      const page1 = listIcons({ limit: 10 });
      const page2 = listIcons({ offset: 10, limit: 10 });
      expect(page1.icons.length).toBe(10);
      expect(page2.icons.length).toBe(10);
      // No overlap
      const overlap = page1.icons.filter((n) => page2.icons.includes(n));
      expect(overlap.length).toBe(0);
    });

    it("returns empty list for non-matching prefix", () => {
      const result = listIcons({ prefix: "zzzzzzxyz" });
      expect(result.total).toBe(0);
      expect(result.icons.length).toBe(0);
    });

    it("handles prefix case-insensitively", () => {
      const result = listIcons({ prefix: "Arrow" });
      expect(result.total).toBeGreaterThan(0);
      expect(result.icons.every((n) => n.startsWith("arrow"))).toBe(true);
    });

    it("returns sorted icon names", () => {
      const result = listIcons({ limit: 100 });
      for (let i = 1; i < result.icons.length; i++) {
        expect(result.icons[i].localeCompare(result.icons[i - 1])).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
