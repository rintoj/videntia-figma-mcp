import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { normalizeNodeId } from "../utils/figma-helpers.js";
import { expandPadding } from "../utils/frame-layout.js";
import { ColorInputSchema } from "../utils/color-input.js";

/**
 * Composite tools — single-round-trip versions of the multi-call sequences that
 * agents were repeating on every screen (create frame → layout mode → padding →
 * spacing → sizing → fill → radius, etc). Each one applies every property
 * directly on the node inside the plugin, so nothing can half-apply.
 */

// One shared colour contract for every fill param here — hex, {r,g,b,a} in
// 0-1 or 0-255, or [r,g,b(,a)]. See utils/color-input.ts.
const colorSchema = ColorInputSchema;

const paddingSchema = z.union([
  z.coerce.number().describe("Uniform padding in pixels"),
  z.object({
    top: z.coerce.number().optional(),
    right: z.coerce.number().optional(),
    bottom: z.coerce.number().optional(),
    left: z.coerce.number().optional(),
    vertical: z.coerce.number().optional(),
    horizontal: z.coerce.number().optional(),
  }),
]);

function textResult(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

function errorResult(label: string, error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Error ${label}: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
  };
}

export function registerCompositeTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // create_autolayout_frame
  // -------------------------------------------------------------------------
  server.tool(
    "create_autolayout_frame",
    "Alias of the one-call `create_frame` form — both spellings do the same thing, so use whichever you reach for. PREFERRED over create_frame + set_layout_mode + set_padding + set_item_spacing + set_layout_sizing + set_fill_color + set_corner_radius. Creates a frame and applies auto-layout, padding, spacing, sizing, fill and corner radius in ONE round trip, in the order Figma actually requires (layout mode before padding/spacing, parenting before FILL sizing). Fill and radius accept either a design-token name (bound as a variable) or a raw value. Use this for every container you build.",
    {
      x: z.coerce.number().optional().describe("X position (default 0). Ignored inside an auto-layout parent."),
      y: z.coerce.number().optional().describe("Y position (default 0). Ignored inside an auto-layout parent."),
      width: z.coerce.number().optional().describe("Width in pixels (default 100)"),
      height: z.coerce.number().optional().describe("Height in pixels (default 100)"),
      name: z.string().optional().describe("Layer name (default 'Frame')"),
      parentId: z.string().optional().describe("Parent frame/group id to append into"),
      layoutMode: z
        .enum(["HORIZONTAL", "VERTICAL", "NONE"])
        .optional()
        .describe("Auto-layout direction (default VERTICAL). NONE disables auto-layout."),
      padding: paddingSchema
        .optional()
        .describe("Padding: a number, or {top,right,bottom,left} / {vertical,horizontal}"),
      paddingVariable: z
        .string()
        .optional()
        .describe("Spacing token name to bind all four paddings to, e.g. 'space/4'. Wins over `padding`."),
      itemSpacing: z.coerce.number().optional().describe("Gap between children in pixels"),
      itemSpacingVariable: z
        .string()
        .optional()
        .describe("Spacing token name to bind the gap to, e.g. 'space/2'. Wins over `itemSpacing`."),
      primaryAxisAlignItems: z
        .enum(["MIN", "MAX", "CENTER", "SPACE_BETWEEN"])
        .optional()
        .describe("Alignment along the layout direction"),
      counterAxisAlignItems: z
        .enum(["MIN", "MAX", "CENTER", "BASELINE"])
        .optional()
        .describe("Alignment across the layout direction"),
      layoutWrap: z.enum(["NO_WRAP", "WRAP"]).optional().describe("Wrapping (HORIZONTAL layout only)"),
      layoutSizingHorizontal: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe("Horizontal sizing. FILL needs an auto-layout parent; HUG needs auto-layout on this frame."),
      layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Vertical sizing"),
      fillVariable: z
        .string()
        .optional()
        .describe(
          "Colour token name to bind the fill to, e.g. 'card' or 'background/primary'. Prefer this over `fill`.",
        ),
      fill: colorSchema.optional().describe("Raw fill colour when no token applies. Omit for a transparent frame."),
      radiusVariable: z
        .string()
        .optional()
        .describe("Radius token name to bind all four corners to, e.g. 'radius/md'. Prefer this over `cornerRadius`."),
      cornerRadius: z.coerce.number().min(0).optional().describe("Raw uniform corner radius in pixels"),
      effectStyle: z.string().optional().describe("Effect style name or id to apply, e.g. 'shadow/sm'"),
      clipsContent: z.boolean().optional().describe("Whether the frame clips overflowing children"),
      size: z
        .object({ width: z.coerce.number().optional(), height: z.coerce.number().optional() })
        .optional()
        .describe("Frame size in one object — the same nested spelling create_frame accepts"),
      layout: z
        .object({
          mode: z.enum(["NONE", "HORIZONTAL", "VERTICAL"]).optional(),
          sizing: z
            .union([
              z.enum(["FIXED", "HUG", "FILL"]),
              z.object({
                horizontal: z.enum(["FIXED", "HUG", "FILL"]).optional(),
                vertical: z.enum(["FIXED", "HUG", "FILL"]).optional(),
              }),
            ])
            .optional(),
          padding: paddingSchema.optional(),
          gap: z.coerce.number().min(0).optional(),
          align: z
            .object({
              primary: z.enum(["MIN", "CENTER", "MAX", "SPACE_BETWEEN"]).optional(),
              counter: z.enum(["MIN", "CENTER", "MAX", "BASELINE"]).optional(),
            })
            .optional(),
          wrap: z.union([z.enum(["NO_WRAP", "WRAP"]), z.boolean()]).optional(),
        })
        .optional()
        .describe("Everything auto-layout in one object — the same nested spelling create_frame accepts"),
    },
    async (args) => {
      const { size, layout, ...rest } = args;
      const params = { ...rest } as Record<string, unknown>;
      if (typeof params.parentId === "string") params.parentId = normalizeNodeId(params.parentId);

      // Fold the nested spelling down onto the flat params the plugin handler reads.
      if (size?.width !== undefined) params.width = size.width;
      if (size?.height !== undefined) params.height = size.height;
      if (layout) {
        if (layout.mode !== undefined) params.layoutMode = layout.mode;
        if (layout.gap !== undefined) params.itemSpacing = layout.gap;
        if (layout.padding !== undefined) params.padding = expandPadding(layout.padding as never);
        if (layout.align?.primary !== undefined) params.primaryAxisAlignItems = layout.align.primary;
        if (layout.align?.counter !== undefined) params.counterAxisAlignItems = layout.align.counter;
        if (layout.wrap !== undefined) {
          params.layoutWrap = typeof layout.wrap === "boolean" ? (layout.wrap ? "WRAP" : "NO_WRAP") : layout.wrap;
        }
        if (layout.sizing !== undefined) {
          const h = typeof layout.sizing === "string" ? layout.sizing : layout.sizing.horizontal;
          const v = typeof layout.sizing === "string" ? layout.sizing : layout.sizing.vertical;
          if (h !== undefined) params.layoutSizingHorizontal = h;
          if (v !== undefined) params.layoutSizingVertical = v;
        }
      }

      try {
        return textResult(await sendCommandToFigma("create_autolayout_frame", params));
      } catch (error) {
        return errorResult("creating auto-layout frame", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // create_styled_text
  // -------------------------------------------------------------------------
  server.tool(
    "create_styled_text",
    "PREFERRED over load_font_async + create_text + apply_text_style + set_fill_color / bind_variable. Creates a text node with its font ALREADY loaded (the usual trip-up), applies a text style by name, and binds or sets the text colour — all in one round trip. Never call load_font_async before this; it is handled internally.",
    {
      text: z.string().describe("The text content"),
      x: z.coerce.number().optional().describe("X position (default 0)"),
      y: z.coerce.number().optional().describe("Y position (default 0)"),
      name: z.string().optional().describe("Layer name (defaults to the text content)"),
      parentId: z.string().optional().describe("Parent frame/group id to append into"),
      textStyle: z
        .string()
        .optional()
        .describe(
          "Text style name or id, e.g. 'text/body/md'. Its font is loaded automatically. Prefer this over raw font props.",
        ),
      fontFamily: z.string().optional().describe("Font family when no textStyle is given (default 'Inter')"),
      fontWeight: z.coerce.number().optional().describe("Font weight when no textStyle is given (default 400)"),
      fontSize: z.coerce.number().optional().describe("Font size when no textStyle is given"),
      fillVariable: z
        .string()
        .optional()
        .describe("Colour token name to bind the text fill to, e.g. 'foreground'. Prefer this over `fill`."),
      fill: colorSchema.optional().describe("Raw text colour when no token applies"),
      textAlignHorizontal: z
        .enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"])
        .optional()
        .describe("Horizontal text alignment"),
      layoutSizingHorizontal: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe("Horizontal sizing inside an auto-layout parent (FILL for wrapping body copy)"),
    },
    async (args) => {
      const params = { ...args } as Record<string, unknown>;
      if (typeof params.parentId === "string") params.parentId = normalizeNodeId(params.parentId);
      try {
        return textResult(await sendCommandToFigma("create_styled_text", params));
      } catch (error) {
        return errorResult("creating styled text", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // set_gap
  // -------------------------------------------------------------------------
  server.tool(
    "set_gap",
    "Set the auto-layout gap between a frame's children in one call. PREFERRED over set_item_spacing and over hand-rolling transparent spacer rectangles — never insert spacer rectangles to fake a gap. Writes itemSpacing directly and automatically relaxes SPACE_BETWEEN alignment (which silently overrides itemSpacing). Accepts a pixel value or a spacing token name.",
    {
      nodeId: z.string().describe("Id of the auto-layout frame"),
      gap: z.coerce.number().min(0).optional().describe("Gap in pixels. Provide this or gapVariable."),
      gapVariable: z.string().optional().describe("Spacing token name to bind the gap to, e.g. 'space/4'"),
      counterAxisSpacing: z.coerce.number().min(0).optional().describe("Row gap, for WRAP layouts only"),
    },
    async (args) => {
      const params = { ...args, nodeId: normalizeNodeId(args.nodeId) } as Record<string, unknown>;
      try {
        return textResult(await sendCommandToFigma("set_gap", params));
      } catch (error) {
        return errorResult("setting gap", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // create_card
  // -------------------------------------------------------------------------
  server.tool(
    "create_card",
    "Create a card — the most repeated shape in any UI file — with the house surface fill, corner radius, shadow and padding already applied, in ONE round trip. PREFERRED over create_frame + fill + radius + effect style + padding. Defaults come from the ROLE_PRESETS 'card' preset; any parameter you pass overrides them. Falls back to literal values when the design tokens are missing from the file.",
    {
      x: z.coerce.number().optional().describe("X position (default 0)"),
      y: z.coerce.number().optional().describe("Y position (default 0)"),
      width: z.coerce.number().optional().describe("Width in pixels (default 320)"),
      height: z.coerce.number().optional().describe("Height in pixels (default 160)"),
      name: z.string().optional().describe("Layer name (default 'Card')"),
      parentId: z.string().optional().describe("Parent frame/group id to append into"),
      layoutMode: z
        .enum(["HORIZONTAL", "VERTICAL", "NONE"])
        .optional()
        .describe("Auto-layout direction (default VERTICAL)"),
      padding: paddingSchema.optional().describe("Override the house card padding (default 16 on all sides)"),
      paddingVariable: z.string().optional().describe("Spacing token to bind padding to instead"),
      itemSpacing: z.coerce.number().optional().describe("Override the house gap between children (default 8)"),
      itemSpacingVariable: z.string().optional().describe("Spacing token to bind the gap to instead"),
      fillVariable: z.string().optional().describe("Override the house surface token (default 'card')"),
      fill: colorSchema.optional().describe("Raw fill colour, overriding the house token"),
      radiusVariable: z.string().optional().describe("Override the house radius token (default 'radius/md')"),
      cornerRadius: z.coerce.number().min(0).optional().describe("Raw corner radius, overriding the house token"),
      effectStyle: z
        .string()
        .nullable()
        .optional()
        .describe("Override the house shadow style (default 'shadow/sm'). Pass null for a flat card."),
      layoutSizingHorizontal: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Horizontal sizing"),
      layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Vertical sizing"),
      clipsContent: z.boolean().optional().describe("Whether the card clips overflowing children"),
    },
    async (args) => {
      const params = { ...args } as Record<string, unknown>;
      if (typeof params.parentId === "string") params.parentId = normalizeNodeId(params.parentId);
      try {
        return textResult(await sendCommandToFigma("create_card", params));
      } catch (error) {
        return errorResult("creating card", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // bulk_bind_variables
  // -------------------------------------------------------------------------
  server.tool(
    "bulk_bind_variables",
    "Bind many (nodeId, field, variable) triples in ONE round trip. ALWAYS PREFER this over repeated bind_variable calls — a whole-screen token rebind pass drops from 50+ round trips to one. `variable` accepts a variable name ('background/primary', dashes normalised to slashes) or an id. `field` accepts 'fills'/'strokes' (bound as paint colour), 'cornerRadius' (binds all four corners), or any bindable field such as itemSpacing, paddingLeft, width, height. Bindings are independent: each returns its own success/failure, so one bad triple never aborts the rest.",
    {
      bindings: z
        .array(
          z.object({
            nodeId: z.string().describe("Target node id"),
            field: z
              .string()
              .describe(
                "Field to bind: 'fills', 'strokes', 'cornerRadius', 'itemSpacing', 'paddingLeft', 'width', ...",
              ),
            variable: z.string().describe("Variable name (e.g. 'background/primary') or variable id"),
          }),
        )
        .min(1)
        .describe("The bindings to apply, executed in order"),
    },
    async ({ bindings }) => {
      const params = {
        bindings: bindings.map((b) => ({ ...b, nodeId: normalizeNodeId(b.nodeId) })),
      };
      try {
        return textResult(await sendCommandToFigma("bulk_bind_variables", params));
      } catch (error) {
        return errorResult("binding variables in bulk", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // clone_and_place
  // -------------------------------------------------------------------------
  server.tool(
    "clone_and_place",
    "PREFERRED over clone_node + rename_node + move_node + insert_child. Clones a node, renames it, reparents it at an optional index and positions it — in ONE round trip. Automatically switches the clone to ABSOLUTE positioning when x/y are given inside an auto-layout parent (otherwise Figma silently ignores them).",
    {
      nodeId: z.string().describe("Id of the node to clone"),
      name: z.string().optional().describe("New layer name for the clone"),
      parentId: z.string().optional().describe("Parent to move the clone into (default: same parent as the source)"),
      index: z.coerce.number().int().min(0).optional().describe("Child index inside the new parent"),
      x: z.coerce.number().optional().describe("X position for the clone"),
      y: z.coerce.number().optional().describe("Y position for the clone"),
    },
    async (args) => {
      const params = { ...args, nodeId: normalizeNodeId(args.nodeId) } as Record<string, unknown>;
      if (typeof params.parentId === "string") params.parentId = normalizeNodeId(params.parentId);
      try {
        return textResult(await sendCommandToFigma("clone_and_place", params));
      } catch (error) {
        return errorResult("cloning and placing node", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // apply_role_preset
  // -------------------------------------------------------------------------
  server.tool(
    "apply_role_preset",
    "Apply the house fill, corner radius, shadow, padding and minimum size for a semantic role to an existing node, in ONE round trip. PREFERRED over hand-picking tokens per node. Roles: 'card' (surface fill, radius/md, shadow/sm, 16px padding), 'pill' (muted fill, radius/full, 4/12 padding, 24px min height), 'sheet' (popover fill, radius/xl, shadow/lg, 24/16 padding), 'tap-target' (radius/sm, 44x44 minimum per WCAG 2.5.5). Missing tokens fall back to literal house values and are reported in `warnings`.",
    {
      nodeId: z.string().describe("Id of the node to restyle"),
      role: z.enum(["card", "pill", "sheet", "tap-target"]).describe("Semantic role whose house style to apply"),
    },
    async ({ nodeId, role }) => {
      try {
        return textResult(await sendCommandToFigma("apply_role_preset", { nodeId: normalizeNodeId(nodeId), role }));
      } catch (error) {
        return errorResult("applying role preset", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // bind_many — many fields on ONE node
  // -------------------------------------------------------------------------
  server.tool(
    "bind_many",
    "Bind SEVERAL fields on ONE node in a single round trip. ALWAYS PREFER this over calling bind_variable two, three or four times in a row on the same node — that hand-loop is the single most repeated sequence in Figma sessions. Pass nodeId once and a list of {field, variable}. `variable` accepts a variable NAME ('background/primary', dashes normalised to slashes) or an id. `field` accepts 'fills'/'strokes' (bound as paint colour), 'cornerRadius' (binds all four corners), or any bindable field (itemSpacing, paddingLeft, width, height...). Bindings are independent — one bad entry never aborts the rest. For fields spread across MANY nodes use bulk_bind_variables instead (a per-entry nodeId here also works and overrides the top-level one).",
    {
      nodeId: z.string().describe("Id of the node to bind every field on"),
      bindings: z
        .array(
          z.object({
            field: z
              .string()
              .describe("Field to bind: 'fills', 'strokes', 'cornerRadius', 'itemSpacing', 'paddingLeft', ..."),
            variable: z.string().describe("Variable name (e.g. 'background/primary') or variable id"),
            nodeId: z.string().optional().describe("Override the top-level nodeId for this one binding"),
          }),
        )
        .min(1)
        .describe("Fields to bind on the node, applied in order"),
    },
    async ({ nodeId, bindings }) => {
      const params = {
        nodeId: normalizeNodeId(nodeId),
        bindings: bindings.map((b) => (b.nodeId ? { ...b, nodeId: normalizeNodeId(b.nodeId) } : { ...b })),
      };
      try {
        return textResult(await sendCommandToFigma("bind_many", params));
      } catch (error) {
        return errorResult("binding variables", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // create_texts
  // -------------------------------------------------------------------------
  server.tool(
    "create_texts",
    "Create SEVERAL text nodes inside one parent in a single round trip. ALWAYS PREFER this over repeated create_text / create_styled_text calls — a label + value pair, a list of menu items or a stack of rows drops from N round trips to one. Fonts are loaded internally, so never call load_font_async first. Each item takes the same parameters as create_styled_text. Returns `ids` in the same order as the items you passed.",
    {
      parentId: z
        .string()
        .optional()
        .describe("Parent frame/group id every item is appended into (per-item parentId wins)"),
      items: z
        .array(
          z.object({
            text: z.string().describe("The text content"),
            x: z.coerce.number().optional().describe("X position (default 0). Ignored inside an auto-layout parent."),
            y: z.coerce.number().optional().describe("Y position (default 0)"),
            name: z.string().optional().describe("Layer name (defaults to the text content)"),
            parentId: z.string().optional().describe("Override the shared parentId for this item"),
            textStyle: z
              .string()
              .optional()
              .describe("Text style name or id, e.g. 'text/body/md'. Font loaded automatically."),
            fontFamily: z.string().optional().describe("Font family when no textStyle is given (default 'Inter')"),
            fontWeight: z.coerce.number().optional().describe("Font weight when no textStyle is given"),
            fontSize: z.coerce.number().optional().describe("Font size when no textStyle is given"),
            fillVariable: z.string().optional().describe("Colour token name to bind the text fill to"),
            fill: colorSchema.optional().describe("Raw text colour when no token applies"),
            textAlignHorizontal: z
              .enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"])
              .optional()
              .describe("Horizontal text alignment"),
            layoutSizingHorizontal: z
              .enum(["FIXED", "HUG", "FILL"])
              .optional()
              .describe("Horizontal sizing inside an auto-layout parent"),
          }),
        )
        .min(1)
        .describe("Text nodes to create, in order"),
    },
    async ({ parentId, items }) => {
      const params: Record<string, unknown> = {
        parentId: parentId ? normalizeNodeId(parentId) : undefined,
        items: items.map((i) => (i.parentId ? { ...i, parentId: normalizeNodeId(i.parentId) } : { ...i })),
      };
      try {
        return textResult(await sendCommandToFigma("create_texts", params));
      } catch (error) {
        return errorResult("creating texts", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // create_svgs
  // -------------------------------------------------------------------------
  server.tool(
    "create_svgs",
    "Create SEVERAL SVG nodes inside one parent in a single round trip. ALWAYS PREFER this over repeated create_svg calls — icon rows, toolbars and tab bars routinely need two to four icons at once. Each item takes the same parameters as create_svg. Returns `ids` in the same order as the items you passed.",
    {
      parentId: z.string().optional().describe("Parent node id every item is inserted into (per-item parentId wins)"),
      items: z
        .array(
          z.object({
            svgString: z.string().describe("The SVG markup string (must start with <svg or <?xml)"),
            x: z.coerce.number().optional().describe("X position (default 0)"),
            y: z.coerce.number().optional().describe("Y position (default 0)"),
            name: z.string().optional().describe("Name for the created node"),
            parentId: z.string().optional().describe("Override the shared parentId for this item"),
            flatten: z.boolean().optional().describe("Merge all SVG paths into one vector node (default false)"),
          }),
        )
        .min(1)
        .describe("SVG nodes to create, in order"),
    },
    async ({ parentId, items }) => {
      const params: Record<string, unknown> = {
        parentId: parentId ? normalizeNodeId(parentId) : undefined,
        items: items.map((i) => (i.parentId ? { ...i, parentId: normalizeNodeId(i.parentId) } : { ...i })),
      };
      try {
        return textResult(await sendCommandToFigma("create_svgs", params));
      } catch (error) {
        return errorResult("creating SVGs", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // insert_children
  // -------------------------------------------------------------------------
  server.tool(
    "insert_children",
    "Reparent SEVERAL nodes into one parent in a single round trip, preserving the order you pass them in. ALWAYS PREFER this over repeated insert_child calls. With `index` the children are inserted consecutively starting at that position; without it they are appended.",
    {
      parentId: z.string().describe("Id of the parent to insert into"),
      childIds: z.array(z.string()).min(1).describe("Ids of the nodes to insert, in the order they should appear"),
      index: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Start index; children are inserted consecutively from here"),
    },
    async ({ parentId, childIds, index }) => {
      const params: Record<string, unknown> = {
        parentId: normalizeNodeId(parentId),
        childIds: childIds.map((id) => normalizeNodeId(id)),
        index,
      };
      try {
        return textResult(await sendCommandToFigma("insert_children", params));
      } catch (error) {
        return errorResult("inserting children", error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // move_nodes
  // -------------------------------------------------------------------------
  server.tool(
    "move_nodes",
    "Move and/or reparent SEVERAL nodes in a single round trip. ALWAYS PREFER this over repeated move_node calls — laying out a row of siblings drops from N round trips to one. Each move takes the same parameters as move_node; reparenting happens before the x/y write so coordinates land in the new parent's space. Moves are independent — one failure never aborts the rest.",
    {
      moves: z
        .array(
          z.object({
            nodeId: z.string().describe("Id of the node to move"),
            x: z.coerce.number().optional().describe("New X position, relative to the parent"),
            y: z.coerce.number().optional().describe("New Y position, relative to the parent"),
            parentId: z.string().optional().describe("Reparent into this node before positioning"),
            index: z.coerce.number().int().min(0).optional().describe("Child index inside the new parent"),
          }),
        )
        .min(1)
        .describe("The moves to apply, in order"),
    },
    async ({ moves }) => {
      const params = {
        moves: moves.map((m) => ({
          ...m,
          nodeId: normalizeNodeId(m.nodeId),
          parentId: m.parentId ? normalizeNodeId(m.parentId) : undefined,
        })),
      };
      try {
        return textResult(await sendCommandToFigma("move_nodes", params));
      } catch (error) {
        return errorResult("moving nodes", error);
      }
    },
  );
}
