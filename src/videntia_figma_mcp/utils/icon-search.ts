import { LUCIDE_ICONS, LUCIDE_ICON_NAMES } from "../data/lucide-icons.js";

// Alias tables: common names → Lucide icon names
// Sources: figma-rules.md UI element table + emoji-replacement-table.md
const ICON_ALIASES: Map<string, string> = new Map([
  // UI element aliases (from figma-rules.md § Icon Rules)
  ["close", "x"],
  ["dismiss", "x"],
  ["cancel", "x"],
  ["hamburger", "menu"],
  ["back", "arrow-left"],
  ["forward", "arrow-right"],
  ["next", "chevron-right"],
  ["previous", "chevron-left"],
  ["expand", "chevron-down"],
  ["collapse", "chevron-up"],
  ["dropdown", "chevron-down"],
  ["add", "plus"],
  ["create", "plus"],
  ["new", "plus"],
  ["remove", "minus"],
  ["delete", "trash-2"],
  ["trash", "trash-2"],
  ["edit", "pencil"],
  ["modify", "pencil"],
  ["save", "save"],
  ["gear", "settings"],
  ["cog", "settings"],
  ["preferences", "settings"],
  ["profile", "user"],
  ["account", "user"],
  ["avatar", "user"],
  ["home", "house"],
  ["notification", "bell"],
  ["notifications", "bell"],
  ["alert", "bell"],
  ["rating", "star"],
  ["favorite", "star"],
  ["favourite", "star"],
  ["share", "share-2"],
  ["copy", "copy"],
  ["clipboard", "clipboard"],
  ["link", "link"],
  ["external", "external-link"],
  ["login", "log-in"],
  ["signin", "log-in"],
  ["logout", "log-out"],
  ["signout", "log-out"],
  ["refresh", "refresh-cw"],
  ["reload", "refresh-cw"],
  ["filter", "list-filter"],
  ["more", "ellipsis"],
  ["options", "ellipsis-vertical"],
  ["kebab", "ellipsis-vertical"],
  ["meatball", "ellipsis"],
  ["warning", "triangle-alert"],
  ["error", "circle-alert"],
  ["danger", "circle-alert"],
  ["success", "circle-check"],
  ["complete", "circle-check"],
  ["done", "circle-check"],
  ["email", "mail"],
  ["message", "message-circle"],
  ["chat", "message-circle"],
  ["time", "clock"],
  ["schedule", "calendar"],
  ["photo", "image"],
  ["picture", "image"],
  ["document", "file-text"],
  ["visibility", "eye"],
  ["show", "eye"],
  ["hide", "eye-off"],
  ["invisible", "eye-off"],
  ["spinner", "loader"],
  ["loading", "loader"],
  ["volume", "volume-2"],
  ["sound", "volume-2"],
  ["fullscreen", "maximize"],
  ["drag", "grip-vertical"],
  ["handle", "grip-vertical"],
  // Emoji-concept aliases (from emoji-replacement-table.md)
  ["ring", "bell"],
  ["write", "pencil"],
  ["pen", "pencil"],
  ["look", "search"],
  ["find", "search"],
  ["magnify", "search"],
  ["cross", "x"],
  ["tick", "check"],
  ["checkmark", "check"],
]);

export interface IconSearchResult {
  name: string;
  svg: string;
  matchType: "exact" | "alias" | "prefix" | "word-boundary" | "substring" | "fuzzy";
  score: number;
}

/**
 * Search for icons using fuzzy matching with multi-pattern support.
 * Query can contain `|` to search multiple patterns simultaneously.
 */
export function searchIcons(query: string, limit: number = 5): IconSearchResult[] {
  if (!query || !query.trim()) return [];

  const patterns = query
    .toLowerCase()
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);

  if (patterns.length === 0) return [];

  // Collect results from all patterns, keeping best score per icon
  const bestResults = new Map<string, IconSearchResult>();

  for (const pattern of patterns) {
    const results = searchSinglePattern(pattern);
    for (const result of results) {
      const existing = bestResults.get(result.name);
      if (!existing || result.score > existing.score) {
        bestResults.set(result.name, result);
      }
    }
  }

  // Sort by score descending, then by name for stability
  return [...bestResults.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

// Cap to avoid building huge intermediate arrays for common patterns
const MAX_RESULTS_PER_PHASE = 60;

function searchSinglePattern(pattern: string): IconSearchResult[] {
  const results: IconSearchResult[] = [];
  const seen = new Set<string>();

  // Phase 1: Exact match
  if (LUCIDE_ICONS.has(pattern)) {
    results.push({
      name: pattern,
      svg: LUCIDE_ICONS.get(pattern)!,
      matchType: "exact",
      score: 100,
    });
    seen.add(pattern);
  }

  // Phase 2: Alias match
  const aliasTarget = ICON_ALIASES.get(pattern);
  if (aliasTarget && LUCIDE_ICONS.has(aliasTarget) && !seen.has(aliasTarget)) {
    results.push({
      name: aliasTarget,
      svg: LUCIDE_ICONS.get(aliasTarget)!,
      matchType: "alias",
      score: 90,
    });
    seen.add(aliasTarget);
  }

  // Phase 3-5: Prefix, word-boundary, substring
  for (const name of LUCIDE_ICON_NAMES) {
    if (results.length >= MAX_RESULTS_PER_PHASE) break;
    if (seen.has(name)) continue;

    if (name.startsWith(pattern)) {
      results.push({
        name,
        svg: LUCIDE_ICONS.get(name)!,
        matchType: "prefix",
        score: 80,
      });
      seen.add(name);
    } else if (hasWordBoundaryMatch(name, pattern)) {
      results.push({
        name,
        svg: LUCIDE_ICONS.get(name)!,
        matchType: "word-boundary",
        score: 70,
      });
      seen.add(name);
    } else if (name.includes(pattern)) {
      results.push({
        name,
        svg: LUCIDE_ICONS.get(name)!,
        matchType: "substring",
        score: 60,
      });
      seen.add(name);
    }
  }

  // Phase 6: Fuzzy matching (only if few results so far)
  if (results.length < 20 && pattern.length >= 3) {
    for (const name of LUCIDE_ICON_NAMES) {
      if (results.length >= MAX_RESULTS_PER_PHASE) break;
      if (seen.has(name)) continue;

      const fuzzyScore = fuzzyMatch(name, pattern);
      if (fuzzyScore > 0) {
        results.push({
          name,
          svg: LUCIDE_ICONS.get(name)!,
          matchType: "fuzzy",
          score: fuzzyScore,
        });
        seen.add(name);
      }
    }
  }

  return results;
}

/** Check if pattern matches at a word boundary (after a hyphen) in name */
function hasWordBoundaryMatch(name: string, pattern: string): boolean {
  const parts = name.split("-");
  // Check if any non-first part starts with the pattern
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].startsWith(pattern)) return true;
    // Also check joined suffix: "circle-check" with pattern "check"
    const suffix = parts.slice(i).join("-");
    if (suffix.startsWith(pattern)) return true;
  }
  return false;
}

/** Fuzzy match: chars of pattern must appear in name in order */
function fuzzyMatch(name: string, pattern: string): number {
  let pi = 0;
  for (let ni = 0; ni < name.length && pi < pattern.length; ni++) {
    if (name[ni] === pattern[pi]) pi++;
  }
  if (pi < pattern.length) return 0; // Not all chars matched

  // Score: 40 + 15 * (matched_chars / name_length)
  const coverage = pattern.length / name.length;
  return Math.round(40 + 15 * coverage);
}

/**
 * Candidate Lucide names for whatever spelling a caller used: `lucide:check`,
 * `lucide-check`, `CheckIcon`, `CircleCheck`, `circleCheck`, `circle_check`,
 * `check-icon`, `ArrowUp01`. Ordered most-literal first.
 */
export function iconNameCandidates(name: string): string[] {
  const raw = name.trim().replace(/^lucide[:/]/i, "");
  const stripped = raw.replace(/^lucide-(?=.)/i, "");
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string) => {
    const v = value.replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  };

  for (const base of [raw, stripped]) {
    const lower = base.toLowerCase();
    push(lower);
    const kebab = base
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
      .replace(/[\s_.]+/g, "-")
      .toLowerCase();
    // `CheckIcon` / `check-icon` / `check_icon` — a component-style suffix, not part of the name.
    const noSuffix = kebab.replace(/-icon$/, "");
    for (const v of [kebab, noSuffix]) {
      push(v);
      // Lucide separates digits: `arrow-up-0-1`, `trash-2`.
      push(v.replace(/([a-z])(\d)/g, "$1-$2").replace(/(\d)([a-z])/g, "$1-$2"));
    }
  }
  return out;
}

/**
 * Get a single icon by exact name or alias.
 * Tries every normalised spelling (see `iconNameCandidates`) exactly, then as an alias.
 */
export function getIcon(name: string): { name: string; svg: string } | null {
  const candidates = iconNameCandidates(name);
  for (const candidate of candidates) {
    const svg = LUCIDE_ICONS.get(candidate);
    if (svg) return { name: candidate, svg };
  }
  for (const candidate of candidates) {
    const aliasTarget = ICON_ALIASES.get(candidate);
    const aliasSvg = aliasTarget ? LUCIDE_ICONS.get(aliasTarget) : undefined;
    if (aliasTarget && aliasSvg) return { name: aliasTarget, svg: aliasSvg };
  }
  return null;
}

/** Brand/logo icons Lucide removed (lucide-static v1 ships none of them). */
const REMOVED_BRAND_ICONS = new Set([
  "chrome",
  "codepen",
  "codesandbox",
  "dribbble",
  "facebook",
  "figma",
  "framer",
  "github",
  "gitlab",
  "instagram",
  "linkedin",
  "pocket",
  "slack",
  "trello",
  "twitch",
  "twitter",
  "x-twitter",
  "youtube",
]);

/**
 * The error for an icon name that does not resolve: close matches, plus the brand-icon
 * explanation (Lucide dropped every brand logo, so no spelling will ever find them).
 */
export function iconNotFoundMessage(name: string): string {
  const candidates = iconNameCandidates(name);
  if (candidates.length === 0) {
    return `No icon name given — pass the Lucide icon name as \`name\` (aliases: \`icon\`, \`iconName\`), e.g. "check".`;
  }
  const query = candidates[candidates.length - 1];
  const suggestions = searchIcons(query, 5).map((s) => s.name);
  const isBrand = candidates.some((c) => REMOVED_BRAND_ICONS.has(c.replace(/-(logo|icon)$/, "")));
  const parts = [`Icon "${name}" not found.`];
  if (isBrand) {
    parts.push(
      "Brand/logo icons were removed from Lucide and are not available here — use create_svg with the brand's official SVG instead.",
    );
  }
  parts.push(
    suggestions.length
      ? `Close matches: ${suggestions.join(", ")}.`
      : "No close matches — try search_icon with a keyword.",
  );
  if (!isBrand) {
    parts.push("If this is a brand logo, Lucide no longer ships brand icons — use create_svg with the brand's SVG.");
  }
  return parts.join(" ");
}

export interface ListIconsResult {
  total: number;
  offset: number;
  limit: number;
  icons: string[];
}

/**
 * List available icon names with optional prefix filter and pagination.
 */
export function listIcons(options: { prefix?: string; offset?: number; limit?: number }): ListIconsResult {
  const { prefix, offset = 0, limit = 50 } = options;

  let names = LUCIDE_ICON_NAMES;
  if (prefix) {
    const p = prefix.toLowerCase().trim();
    names = names.filter((n) => n.startsWith(p));
  }

  return {
    total: names.length,
    offset,
    limit,
    icons: names.slice(offset, offset + limit),
  };
}
