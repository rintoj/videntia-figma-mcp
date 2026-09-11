import type { DesignKnowledgeModule } from "./types.js";

export const AUTO_LAYOUT: DesignKnowledgeModule = {
  id: "auto-layout",
  name: "Auto Layout & Sizing",
  description:
    "Building resilient Figma layouts: when to use auto layout vs absolute positioning, FIXED/HUG/FILL legality and ordering, text wrapping, stretch, tokenized gap/padding, canvas placement, and grid vs wrap.",
  content: `# Auto Layout & Sizing

Auto layout is what keeps a Figma design honest when copy gets longer, a label is translated, or a card gains a row. A frame full of hand-placed children looks identical on the day it is drawn and falls apart the first time anything changes. This module covers how to structure layouts in Figma with this server's tools, and the ordering traps that silently produce broken sizing.

## Default to Auto Layout

If children relate to each other — stacked, side by side, aligned, separated by a consistent gap, or wrapped by a container that should grow with them — the container gets auto layout. Coordinates are for placing things on the canvas, not for arranging siblings.

- Create the container with \`create_frame\`, then turn on layout with \`set_auto_layout\` (direction, padding, gap, alignment and sizing in one call) or \`set_layout_mode\` for direction alone.
- Once a parent has auto layout, children added to it are positioned by the layout; any x/y you pass to \`create_text\` or \`create_frame\` with a \`parentId\` stops mattering.
- A hand-positioned frame gives no protection against text reflow, overlapping siblings, or a container that no longer encloses its content.

### When absolute positioning is legitimate

Keep a child out of the flow only when it genuinely overlaps or is pinned rather than arranged:

- A notification dot or count badge on the corner of an avatar or icon
- A close button pinned to the top-right of a modal or sheet
- Decorative shapes or glows sitting behind content
- An overlay label on top of an image

\`create_frame\` and \`create_rectangle\` accept \`layoutPositioning: "ABSOLUTE"\` when creating a node inside an auto layout parent. To switch an existing child to absolute (or back), set it manually in Figma. An absolute child is not part of the flow, so it cannot use FILL — give it an explicit size.

## FIXED, HUG and FILL

\`set_layout_sizing\` takes \`horizontal\` and \`vertical\`, each \`FIXED\`, \`HUG\` or \`FILL\`. The same values are accepted by \`set_auto_layout\`. They are not interchangeable — each is only valid in certain structural positions:

| Value | Means | Valid on |
|-------|-------|----------|
| FIXED | Exact pixel size | Any frame or text node, anywhere |
| HUG | Shrink-wrap to content | Frames with auto layout enabled, and text nodes |
| FILL | Take the space the parent offers | Nodes already placed in the flow (not absolute) of an auto layout parent |

Consequences:

- **Parent first, then sizing.** A node that is not yet inside an auto layout parent cannot be FILL. Create it with a \`parentId\`, or move it in with \`insert_child\`, and only then call \`set_layout_sizing\`.
- **Plain frames cannot HUG.** A frame without auto layout has nothing to hug; enable layout on it first.
- **Rectangles and other shapes never HUG.** They have no content — use FIXED or FILL.
- When \`set_auto_layout\` first enables layout on a frame and you omit sizing, it picks FILL width inside an auto layout parent (FIXED otherwise) and HUG height. Pass \`horizontal\`/\`vertical\` explicitly whenever that default is not what you want.

## Sizing Traps

### A hugging parent starves FILL children

A parent that hugs its content on an axis has no spare space to hand out on that axis. Children set to FILL along it collapse to their minimum, which is how inputs, select fields and button rows end up with truncated labels. Fix it from one side:

- Give the parent a real size on that axis — FIXED, or FILL from its own auto layout parent — so FILL children have something to divide, or
- Let the child HUG (or FIXED) instead of FILL.

### FILL along the main axis under a hugging parent

The same starvation shows up as squeezing: a child set to FILL along the direction of flow, inside a parent that hugs along that direction, gets compressed below its natural size and its contents may be clipped or hidden. Only use FILL on the main axis when the parent has a fixed or filled length with leftover room; otherwise leave the child at HUG.

### resize_node pins sizing to FIXED

\`resize_node\` sets both width and height, and on an auto layout frame it switches both axes to FIXED as a side effect. Calling it after \`set_layout_sizing\` quietly undoes HUG or FILL — and a throwaway value for the axis you did not care about becomes permanent.

Order: \`resize_node\` first to establish the dimension you need, then \`set_layout_sizing\` for any axis that should hug or fill. Confirm the result with \`get_node_info\`, which reports \`layoutSizingHorizontal\` and \`layoutSizingVertical\`.

### There is no "stretch" alignment

Counter-axis alignment in \`set_auto_layout\` is MIN, CENTER or MAX (\`set_axis_align\` adds BASELINE for aligning text in horizontal rows). None of them stretches children. To make children span the full cross axis — equal-height cards in a row, full-width rows in a list — keep the parent aligned to MIN and set each child's counter-axis sizing to FILL. The parent must then have a definite size on that axis, either FIXED/FILL itself or set by at least one child that stays HUG or FIXED; if every child fills and the parent hugs, the row collapses.

## Text That Wraps

Paragraphs, descriptions and multi-line labels need a width to wrap at and a height that follows the content.

- **Right:** width FIXED (or FILL inside a parent with a definite width) and height HUG. With \`set_layout_sizing\` this is \`horizontal: "FIXED"\` or \`"FILL"\` plus \`vertical: "HUG"\`; the server switches the text node to grow vertically.
- **Wrong:** width HUG. The text grows sideways on a single line and never wraps.
- **Wrong:** both axes FIXED for content that can change. Longer copy overflows the box instead of pushing siblings down.

Recipe for a fixed-width paragraph: \`create_text\` with the container as \`parentId\` → \`resize_node\` to the target width → \`set_layout_sizing\` with FIXED width and HUG height. Then check \`get_node_info\`: a width near zero or a height far larger than expected means the text is wrapping per character and the sizing did not take.

\`set_text_wrap_style\` (AUTO, BALANCE, PRETTY) only changes how lines are broken once wrapping happens — it does not make text wrap.

## Gap and Padding Come from Tokens

Every gap and padding value should be a spacing token, not a typed number. A layout that reads 12, 16, 24 from variables can be retuned system-wide; one with raw numbers drifts.

- Set structure with \`set_auto_layout\`, \`set_padding\` and \`set_item_spacing\`, then bind the values with \`bind_variable\` using the fields \`paddingTop\`, \`paddingRight\`, \`paddingBottom\`, \`paddingLeft\`, \`itemSpacing\` and \`counterAxisSpacing\`.
- If the file has no spacing variables yet, \`create_spacing_system\` generates them.
- Which values to use, and why, lives in the \`spacing-radius\` module — fetch it with \`get_design_knowledge\`.

## Build Outside-In

Create the outer wrapper first and give it layout, then create each section directly inside it by passing the wrapper as \`parentId\`, then fill the sections. Building loose pieces and gathering them into a container afterwards costs extra calls and loses state: sizing chosen for the old parent may not be valid in the new one (FILL has no meaning outside auto layout), and child order has to be fixed up with \`insert_child\` or \`move_node\` indices. If you do reparent, re-apply sizing and verify with \`get_node_info\`.

## Place New Top-Level Frames on Clear Canvas

\`create_frame\` requires x and y. For a frame placed directly on the page, never default to 0,0 — it lands on top of whatever is already there.

- List the page's top-level frames with \`enumerate_all_frames\` (scoped by \`pageId\`) to get their positions and sizes.
- Place the new frame to the right of the rightmost frame (or below the lowest) with a generous gap, such as 100px or more. Loose non-frame layers do not appear in that list, so do not cut the margin fine.
- This only matters at page level; children of a layout frame are positioned by their parent.

## Grid vs Wrap

Both lay out many items in two dimensions, but they behave differently:

| Use | When |
|-----|------|
| HORIZONTAL + WRAP | Items of varying width that flow onto new lines — tags, chips, filter pills. Lines do not align into columns. |
| GRID | Items that must line up in both rows and columns — card galleries, dashboards, stat tiles, calendars. |

- **Wrap:** \`set_layout_mode\` with \`wrap: "WRAP"\`, or \`set_auto_layout\` with \`wrap\`. \`set_item_spacing\` \`gap\` spaces items within a line and \`counterAxisSpacing\` spaces the lines. Give the container a fixed or filled width so there is a line length to wrap at.
- **Grid:** \`set_layout_mode\` or \`set_auto_layout\` with \`mode: "GRID"\` plus \`rows\` and \`columns\`. Space tracks with \`rowGap\`/\`columnGap\`. Use \`gridAutoTracks: "ROWS"\` so rows are added as items are, and \`gridItemsPositioning: "ROW_AUTO_FLOW"\` to place children into the next free cell automatically. Reorder whole rows or columns with \`reorder_grid_tracks\`. Alignment and wrap options do not apply to grid frames. Per-track sizing and spanning a child across several cells are set manually in Figma.

## Anti-Patterns

- **Absolute x/y for siblings** that should stack or sit in a row — use auto layout
- **FILL before the node has an auto layout parent** — insert or create inside the parent first
- **HUG on a shape or a plain frame** — only auto layout frames and text can hug
- **FILL children in a hugging parent** — collapsed or squeezed content
- **resize_node after set_layout_sizing** — HUG and FILL silently become FIXED
- **Hugging paragraph width** — text never wraps
- **Raw gap and padding numbers** — bind spacing variables instead
- **New top-level frames at 0,0** — overlaps existing work
- **Wrap for aligned card grids** — use GRID so columns line up
`,
};
