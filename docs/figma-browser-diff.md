# Figma ↔ Browser Diff Tooling

Tools that compare a Figma design against a live implementation in Chrome, from a
single node up to an entire frame. All of them ride the same relay as the
[browser control tools](browser-control-tools.md): Figma data via the plugin
channel, DOM data via the Chrome extension's `"browser"` channel.

## The `data-fig-id` convention

To pair implemented DOM elements with their Figma design nodes deterministically —
no computer vision, no geometry heuristics — annotate app markup with the Figma
node id:

```html
<section data-fig-id="3082:47270">…</section>
```

In React apps, prefer a small dev-only helper so annotations never ship to
production:

```tsx
export function figId(id: string): { 'data-fig-id'?: string } {
  if (process.env.NODE_ENV === 'production') return {}
  return { 'data-fig-id': id }
}

<section {...figId('3082:47270')}>…</section>
```

How the annotation is used:

- `diff_figma_to_browser` (called without `css_selector`) probes
  `[data-fig-id="<node_id>"]` first and only falls back to image-template matching
  when the annotation is absent (`matchedVia` reports `"explicit"`, `"fig-id"`, or
  `"image-template"`).
- `diff_figma_frame_to_page` pairs annotated elements at cost 0 *before* running
  the Hungarian geometry matcher; duplicate annotations are ignored (geometry
  fallback).
- `buildStableSelector` in the Chrome extension content script prefers
  `data-fig-id` over `data-testid` when generating selectors, and `data-fig-id`
  is included in the serialized DOM attribute allowlist.

> ⚠️ Figma node ids are stable within a file but change when nodes are copied to
> another file. Re-run with `annotation_map: true` after such moves to refresh
> annotations.

## `diff_figma_to_browser` — single-node diff

Diffs one Figma node's visual properties against the computed CSS of a DOM
element. Returns per-property rows with `✓ / ❌ / —` status. Capabilities:

- **Selector resolution**: explicit `css_selector` → `data-fig-id` probe →
  image-template matching (screenshot cross-correlation).
- **Batched style fetch**: computed styles, parent styles, and the element's class
  list come back in one `get_computed_styles_batch` round trip (graceful fallback
  to the legacy per-selector command for older extensions).
- **Layout rows**: auto-layout ↔ flexbox comparison (`layout-mode`,
  `justify-content`, `align-items`, `flex-wrap`, `gap`) using the element's parent
  styles where needed.
- **Mixed-text recovery**: TEXT nodes with mixed styling (where the serializer
  omits `fontSize`/`fontFamily`/`fontWeight`) are resolved via
  `get_styled_text_segments` — the dominant value by character count is used and a
  distribution note is attached (e.g. `mixed: 32px (78%), 48px (22%)`). Capped at
  10 mixed text nodes per frame diff.

## `diff_figma_frame_to_page` — whole-frame audit

Matches every Figma descendant of a frame to a DOM element using hierarchical
Hungarian assignment over bounding boxes (annotated pairs matched first at cost 0),
then returns matched pairs, unmatched buckets, and summary counts.

### `include_style_diff: true` — frame-level style audit

Fetches computed styles for **all matched pairs in one batched round trip**
(`get_computed_styles_batch`, with parent styles and class lists) and returns
mismatch-only rows per node under `styleDiff.mismatches`:

```jsonc
{
  "figmaId": "3082:47291",
  "figmaName": "CTA Button",
  "figmaType": "FRAME",
  "selector": "[data-fig-id=\"3082:47291\"]",
  "rows": [
    {
      "property": "background-color",
      "figma": "gold-200 (#f5d58a)",   // token name when bound to a variable
      "browser": "#f0cd7d",
      "severity": "error",
      "hint": "set background-color to #f5d58a (e.g. bg-gold-200)"
    }
  ]
}
```

- **Severity**: `"error"` = real mismatch; `"warn"` = likely-intentional or
  low-confidence difference (hug-content sizing drift, grid-for-flex
  implementations).
- **Semantic equivalences are normalized away** before comparison:
  border-implemented-as-inset-box-shadow-ring (Tailwind `inset-ring`),
  flex-centered `text-align: left`, font-weight aliases, etc.
  (`src/videntia_figma_mcp/utils/normalize-style.ts`).
- **Perceptual color comparison**: color rows use CIE ΔE76 in L\*a\*b\* space
  (`rgbToLab` / `deltaE76` in `color-calculations.ts`) instead of raw hex
  equality, so imperceptible rounding differences don't flag.
- **Caps**: 50 nodes / 200 mismatch rows per audit (`max_style_nodes` tunable);
  skipped pairs are reported in `warnings`, never silently dropped.

### Design-token awareness

- Figma values bound to variables render as `token-name (#hex)` in the `figma`
  column, making reports actionable ("use gold-200") instead of raw hex only.
- With `include_token_suggestions`, browser-side hex colors are matched against
  the file's local COLOR variables (exact hex first, then nearest within the ΔE
  threshold) to suggest the token the implementation *should* be using.

### Fix hints

Every `error` row gets a heuristic `hint` (`src/videntia_figma_mcp/utils/fix-hints.ts`).
When the element's class list contains a recognizable Tailwind utility the hint
names the exact class swap (`change rounded-md → rounded-lg (Figma 8px)`); otherwise
it falls back to a plain CSS instruction. Covered properties: gap, padding,
border-radius, border-width, colors (with token names), layout-mode,
justify-content, align-items, flex-wrap, font-size, line-height.

### `annotation_map: true` — annotation plan

Returns a ready-to-apply plan for annotating an un-annotated codebase:

- `suggested` — geometry-matched pairs as instructions: `figmaId`, `selector`,
  `tag`, `confidence`, and an `apply` string.
- `unmatched` — `figmaId → { name, type, text }` for nodes needing manual mapping
  (first 100).

## Supporting extension command: `get_computed_styles_batch`

New content-script command that resolves N selectors in one round trip and
returns, per selector: `found`, computed styles (curated or explicit property
list), optional parent styles (`includeParent`), and the element's class string
(`includeClass`), plus page `dpr` and a `truncated` flag. This is what makes
frame-level audits a single round trip instead of one per node.

## Tests

- `tests/integration/diff-figma-to-browser.test.ts` — selector resolution paths,
  batched styles, mixed-text notes.
- `tests/integration/frame-style-diff.test.ts` — style audit, annotation map,
  caps and warnings.
- `tests/unit/utils/figma-to-css-rows.test.ts`, `fix-hints.test.ts`,
  `normalize-style.test.ts`, `frame-audit.test.ts`,
  `color-calculations.test.ts` (Lab/ΔE) — row building, hints, normalization,
  matching, color math.
