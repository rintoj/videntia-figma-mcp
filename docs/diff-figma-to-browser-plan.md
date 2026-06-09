# `diff_figma_to_browser` — Implementation Plan

Collapse the 6-step manual Figma↔CSS trace (overlay → node dims → child → text style → computed styles → token) into a single tool call returning a per-property diff.

Builds on prior research at `~/Documents/Projects/banks-technologies/HomeVault/BanksTechnologies-Worklog/docs/research/figma-css-diff-tool.md`. Property mapping table, normalizers, edge cases, and matcher design lift from that doc; transport and auto-location strategy differ for this project.

---

## Goal

```ts
diff_figma_to_browser(figma_node_id, css_selector?, properties?) → {
  rows: [{ property, figma, browser, status: "✓" | "❌" | "—" }],
  matchRegion?: { x, y, w, h, confidence }  // when selector auto-located
}
```

Definition of done (MVP): given the original example, running on a pricing-card title returns `❌ line-height figma=18px browser=16px` and `✓ font-size 14px` in one call.

---

## What already exists (no changes needed)

| Capability | Location |
|---|---|
| Full Figma node properties — fontSize, lineHeight (px + unit), letterSpacing, fontWeight, fontFamily, fills, strokes, strokeWeight, cornerRadius, opacity, effects, padding(4), itemSpacing, absoluteBoundingBox, x/y | `src/videntia_figma_plugin/handlers/node-serializer.ts` (verified — no stripping) |
| `get_node_info` MCP tool | `src/videntia_figma_mcp/tools/document-tools.ts` |
| `get_browser_computed_styles(selector, properties?)` | `src/videntia_figma_mcp/tools/browser-tools.ts` |
| `get_browser_dom_nodes(selector, depth, include_text)` — returns bounding rects | same |
| Pixel diff utility `diffImages()` | used by `compare_figma_to_component` |
| Image template matching for position-based location | `src/videntia_figma_mcp/utils/find-node-in-page.ts` |
| Chrome extension WebSocket bridge | `src/chrome_extension/` |

**Key consequence:** no plugin handler changes, no Chrome extension changes. Pure MCP-side build.

---

## Property mapping (MVP — 14 properties)

Reuse the table from the prior research (section B), expanded with fields this project's serializer preserves.

| CSS | Figma source | Tolerance |
|---|---|---|
| `font-size` | `style.fontSize` (number) | exact |
| `line-height` | `style.lineHeight` + `lineHeightUnit` (PIXELS default, PERCENT marked) | ±0.5px |
| `font-weight` | `style.fontWeight` | exact (after alias normalize) |
| `font-family` | `style.fontFamily` | primary family, case-insensitive |
| `letter-spacing` | `style.letterSpacing` (px or {value,unit}) | ±0.1px |
| `text-align` | `style.textAlignHorizontal` | exact |
| `color` (text) | `fills[0].color` | exact hex |
| `background-color` (non-text) | `fills[0].color` | exact hex |
| `border-color` | `strokes[0].color` | exact hex |
| `border-width` | `strokeWeight` | ±0.5px |
| `border-radius` | `cornerRadius` | ±0.5px |
| `width` / `height` | `absoluteBoundingBox.{width,height}` | ±1px |
| `padding-*` | `paddingTop/Right/Bottom/Left` | ±1px |
| `gap` | `itemSpacing` | ±1px |
| `opacity` | `opacity` | ±0.01 |
| `box-shadow` | `effects[]` filtered to DROP_SHADOW | ±1 per component |

Normalizers (port verbatim from prior research D.2):
- `px(v)` — strip "px", coerce to number
- `hex(c)` — rgba/rgb → `#rrggbb`, with sRGB-only support (warn on P3)
- `lh(raw, fs)` — `"normal"` → `fs × 1.2`; unitless `n` → `n × fs`; `"npx"` → `n`
- `within(a, b, tol)` — abs delta check
- Font-weight aliases: `bold`→700, `normal`→400
- Letter-spacing: handle bare number AND `{value, unit: PIXELS|PERCENT}`

---

## Architecture

Pure MCP-side orchestration — no plugin or extension changes.

```
diff_figma_to_browser
  ├── get_node_info(figma_node_id, depth=2)
  │     └── DFS find first TEXT descendant for text-style properties
  ├── [if no selector] get_browser_page_screenshot
  │     + export_node_as_image(figma_node_id)
  │     + findNodeInPage(screenshot, nodeImage) → {x,y,w,h,confidence}
  │     + JS via extension: document.elementFromPoint(cx, cy) → stable selector
  ├── get_browser_computed_styles(selector, properties)
  ├── get_browser_dom_nodes(selector, depth=1) → bounding rect for width/height
  └── normalize-style.ts → row-by-row compare → return rows
```

---

## Files to create

| File | Purpose | LOC est. |
|---|---|---|
| `src/videntia_figma_mcp/utils/normalize-style.ts` | Normalizers (px, hex, lh, lineSpacing, fontWeight aliases) + `compareRow(prop, figma, browser, tol)` | ~150 |
| `src/videntia_figma_mcp/utils/figma-to-css-rows.ts` | Build rows from `{figmaNode, computedStyle, rect}` | ~200 |
| `src/videntia_figma_mcp/tools/comparison-tools.ts` (extend existing) | Add `diff_figma_to_browser` tool | ~120 |
| `tests/unit/utils/normalize-style.test.ts` | Normalizer unit tests | ~150 |
| `tests/integration/diff-figma-to-browser.test.ts` | Tool integration test with mocked plugin + extension | ~200 |

No changes to: plugin `code.js`, chrome extension, `node-serializer.ts`, `READONLY_COMMANDS`, `ALLOWED_COMMANDS` (the tool composes existing commands MCP-side; it doesn't introduce a new plugin command).

---

## Tool signature

```ts
{
  figma_node_id: z.string().describe("Figma node ID (e.g. '123:456')"),
  css_selector: z.string().optional().describe("CSS selector. If omitted, auto-locates via image template matching."),
  properties: z.array(z.string()).optional().describe("CSS properties to diff. Defaults to the 14-property MVP set."),
  tolerance_overrides: z.record(z.string(), z.number()).optional()
}
```

Returns:

```json
{
  "selector": ".pricing-card__title",
  "nodeId": "123:456",
  "matchedVia": "explicit" | "image-template",
  "matchRegion": { "x": 120, "y": 240, "w": 200, "h": 24, "confidence": 0.94 },
  "rows": [
    { "property": "line-height", "figma": "18px", "browser": "16px", "status": "❌" },
    { "property": "font-size",   "figma": "14px", "browser": "14px", "status": "✓" }
  ],
  "warnings": ["selector matched 3 elements — diffing first"]
}
```

---

## Phased rollout

### Phase 1 — Single-node diff (MVP, ~6h)

Explicit `(figma_node_id, css_selector)`. 14 properties from the table above.

1. (1.5h) `normalize-style.ts` — ports D.2 normalizers + per-property `compareRow` helpers, with unit tests.
2. (2h) `figma-to-css-rows.ts` — given Figma node JSON + computed styles + rect, returns rows[]. DFS for first TEXT descendant when the target node is a container of text.
3. (1.5h) `diff_figma_to_browser` tool — orchestrates `get_node_info` + `get_browser_computed_styles` + `get_browser_dom_nodes` (rect only), then calls `figma-to-css-rows`.
4. (1h) Integration test with mocked `sendCommandToFigma` and `sendCommandToChannel(BROWSER_CHANNEL, …)`.

**DoD:** the line-height-18-vs-16 example surfaces in one call.

### Phase 2 — Auto-locate by image template (~2h)

When `css_selector` is omitted:

1. `export_node_as_image(figma_node_id)` → reference PNG.
2. `get_browser_page_screenshot()` → page PNG.
3. `findNodeInPage(screenshot, reference)` → `{x, y, w, h, confidence}` (already implemented).
4. Inject JS via extension to call `document.elementFromPoint(x + w/2, y + h/2)` and build a stable selector (`data-testid` > `id` > bounded `nth-child` chain, capped 6 levels — port G.4 `stableSelector()`).
5. Continue to Phase 1 diff with the resolved selector.

If a JS-execute hook isn't already exposed by the extension, this step adds one extension command. Otherwise pure MCP-side.

**Warning rule:** if `confidence < 0.7`, mark `matchedVia: "image-template"` and surface in warnings; let the caller decide.

### Phase 3 — Frame audit (deferred)

`diff_figma_frame_to_page(frame_node_id)` → matches every descendant to a DOM element and returns matched + unmatched buckets. Use hierarchical-parent-first + Hungarian-per-subtree from prior research G.2. Add a one-shot `collectAllElementRects()` JS payload via extension to avoid N×M structured calls. Out of MVP scope.

### Phase 4 — CI visual regression (deferred)

Headless Chrome + fixed viewport + known Figma frame revision. Emit JSON; fail build on new ❌ rows. Snapshot for baseline diff.

---

## Edge cases to handle in MVP

Port from prior research E:

- **Transparent fills** — `rgba(0,0,0,0)` ≠ black; skip diff when Figma has no fill.
- **Color spaces** — sRGB only; if Figma or browser uses P3, mark row `status: "—"` with warning.
- **Pseudo-elements** — out of scope; warn if Figma node has no character descendant but selector resolves to an element with non-empty `::before`/`::after`.
- **Multiple selector matches** — report `count` in warnings, diff the first.
- **`figma.mixed` text styles** — surface as warning; do not diff text-style row for that node.
- **CSS transforms** — `getBoundingClientRect` reports transformed box; if `transform !== 'none'`, mark width/height/x/y rows as low-confidence.
- **Box-sizing** — both sides include border by default; document the assumption.
- **Letter-spacing PERCENT** — `(value / 100) × fontSize`.
- **Line-height AUTO** — already filtered out by serializer (`unit === "AUTO"` not emitted); when absent on Figma side, skip the row.
- **font-family quoting** — split first token, strip quotes, lowercase, contains-match.

---

## Open questions

1. **Does the Chrome extension already expose arbitrary JS execution?** If not, Phase 2 needs a small extension addition. (Check: search `src/chrome_extension/` for an existing `execute_js` or `eval` handler.)
2. **Selector stability strategy** — prefer `data-testid` → `id` → bounded `nth-child` chain. Confirm consumers (Aswin's projects) use `data-testid` consistently.
3. **Tolerance defaults** — current table is conservative. Want stricter (`0` everywhere) and rely on overrides, or keep prior-research tolerances?
4. **Output format** — table-rendered text vs structured JSON. Prior research returns JSON the agent renders. Recommend same.

---

## Effort summary

| Phase | Scope | Effort |
|---|---|---|
| 1 | Single-node diff, 14 properties, explicit selector | ~6h |
| 2 | Auto-locate via image template + `elementFromPoint` | ~2h |
| 3 | Frame audit (hierarchical + Hungarian matcher) | ~10h |
| 4 | CI integration | ~6h |

**MVP ship target: Phase 1 in one session.** Total Phase 1+2 ~8h.

---

## Why this is cheap

- Plugin already exposes every property in the mapping table (no `filterFigmaNode` stripping like the prior research's `ClaudeFigmaMCP` upstream).
- Chrome extension exposes structured `get_browser_computed_styles` + `get_browser_dom_nodes` (no need to inject a JS payload for Phase 1).
- Image template matching (`find-node-in-page.ts`) replaces the prior research's coordinate-transform anchors — more robust to responsive reflow, already implemented.
- All normalizer logic and edge-case analysis from the prior research is directly reusable.
