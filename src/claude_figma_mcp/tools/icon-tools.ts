import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchIcons, getIcon, listIcons } from "../utils/icon-search.js";
import { sendCommandToFigma } from "../utils/websocket.js";

/**
 * Allowlist for CSS color values — permits only safe characters used in hex, rgb/rgba/hsl/hsla,
 * and named colors. Blocks `"`, `<`, `>`, `;` etc. that could break SVG markup.
 */
const CSS_COLOR_SAFE_RE = /^[a-zA-Z0-9#(),.\s%+-]+$/;

function isValidCssColor(color: string): boolean {
  return CSS_COLOR_SAFE_RE.test(color.trim());
}

/**
 * Authoritative set of CSS Color Level 4 named colors plus global keywords.
 * Single-word values not in this set (e.g. "primary", "surface") are treated
 * as design token names and routed to variable resolution instead.
 */
const CSS_NAMED_COLORS = new Set([
  'aliceblue','antiquewhite','aqua','aquamarine','azure','beige','bisque','black',
  'blanchedalmond','blue','blueviolet','brown','burlywood','cadetblue','chartreuse',
  'chocolate','coral','cornflowerblue','cornsilk','crimson','cyan','darkblue',
  'darkcyan','darkgoldenrod','darkgray','darkgreen','darkgrey','darkkhaki',
  'darkmagenta','darkolivegreen','darkorange','darkorchid','darkred','darksalmon',
  'darkseagreen','darkslateblue','darkslategray','darkslategrey','darkturquoise',
  'darkviolet','deeppink','deepskyblue','dimgray','dimgrey','dodgerblue','firebrick',
  'floralwhite','forestgreen','fuchsia','gainsboro','ghostwhite','gold','goldenrod',
  'gray','green','greenyellow','grey','honeydew','hotpink','indianred','indigo',
  'ivory','khaki','lavender','lavenderblush','lawngreen','lemonchiffon','lightblue',
  'lightcoral','lightcyan','lightgoldenrodyellow','lightgray','lightgreen','lightgrey',
  'lightpink','lightsalmon','lightseagreen','lightskyblue','lightslategray',
  'lightslategrey','lightsteelblue','lightyellow','lime','limegreen','linen','magenta',
  'maroon','mediumaquamarine','mediumblue','mediumorchid','mediumpurple','mediumseagreen',
  'mediumslateblue','mediumspringgreen','mediumturquoise','mediumvioletred','midnightblue',
  'mintcream','mistyrose','moccasin','navajowhite','navy','oldlace','olive','olivedrab',
  'orange','orangered','orchid','palegoldenrod','palegreen','paleturquoise',
  'palevioletred','papayawhip','peachpuff','peru','pink','plum','powderblue','purple',
  'rebeccapurple','red','rosybrown','royalblue','saddlebrown','salmon','sandybrown',
  'seagreen','seashell','sienna','silver','skyblue','slateblue','slategray','slategrey',
  'snow','springgreen','steelblue','tan','teal','thistle','tomato','transparent',
  'turquoise','violet','wheat','white','whitesmoke','yellow','yellowgreen',
  // CSS global keywords accepted as color values
  'currentcolor','inherit','initial','unset','revert',
]);

/**
 * Return true if `value` looks like a CSS color rather than a design token / variable name.
 *
 * CSS colors:
 *   - Hex:           #rgb  #rrggbb  #rrggbbaa
 *   - Functional:    rgb(…)  rgba(…)  hsl(…)  hsla(…)
 *   - Named:         any entry in CSS_NAMED_COLORS (checked case-insensitively)
 *
 * Anything containing a hyphen (gray-500, text-primary) or slash (semantic/text/secondary)
 * is treated as a design token. Single-word names not in CSS_NAMED_COLORS (e.g. "primary",
 * "surface", "foreground") are also treated as design tokens.
 */
function looksLikeCssColor(value: string): boolean {
  const v = value.trim();
  if (v.startsWith("#")) return true;
  if (/^(rgb|rgba|hsl|hsla)\s*\(/i.test(v)) return true;
  // Named CSS color — must be in the authoritative list (case-insensitive)
  if (/^[a-zA-Z]+$/.test(v)) return CSS_NAMED_COLORS.has(v.toLowerCase());
  return false;
}

/**
 * Inject a color and size into a Lucide SVG string.
 * - Validates `color` against a safe allowlist before injection.
 * - Updates width/height only on the root `<svg>` opening tag (not child elements).
 * - Replaces `currentColor` throughout the SVG (stroke/fill attributes).
 */
function buildIconSvg(svg: string, color: string, size: number): string {
  if (!isValidCssColor(color)) {
    throw new Error(`Invalid CSS color "${color}" — use hex, rgb(), rgba(), hsl(), or a named color`);
  }
  // Strip any leading content before <svg (e.g. Lucide license comments)
  const svgStart = svg.indexOf("<svg");
  const stripped = svgStart > 0 ? svg.slice(svgStart) : svg;
  // Scope width/height replacement to the root opening tag only
  const tagEnd = stripped.indexOf(">");
  let result: string;
  if (tagEnd !== -1) {
    const openTag = stripped.slice(0, tagEnd + 1);
    const body = stripped.slice(tagEnd + 1);
    const fixedTag = openTag
      .replace(/\bwidth="[^"]*"/, `width="${size}"`)
      .replace(/\bheight="[^"]*"/, `height="${size}"`);
    result = fixedTag + body;
  } else {
    result = stripped;
  }
  return result.replace(/currentColor/g, color);
}

/**
 * Register icon lookup tools to the MCP server.
 * Pure server-side — no Figma communication required.
 */
export function registerIconTools(server: McpServer): void {
  /**
   * search_icon — fuzzy search for Lucide icons by keyword.
   * Supports multi-pattern queries with "|" separator.
   */
  server.tool(
    "search_icon",
    'Search for Lucide icons by keyword with fuzzy matching. Use | for multi-pattern search (e.g. "arrow|chevron"). Supports aliases like "notification" → bell, "hamburger" → menu.',
    {
      query: z.string().describe('Search query. Use | for multiple patterns (e.g. "arrow|chevron")'),
      limit: z.coerce.number().min(1).max(20).optional().describe("Max results to return (default 5, max 20)"),
    },
    async ({ query, limit }) => {
      try {
        const results = searchIcons(query, limit ?? 5);

        if (results.length === 0) {
          return { content: [{ type: "text" as const, text: `No icons found for "${query}".` }] };
        }
        const parts: string[] = [`Found ${results.length} icon(s) for "${query}"\n`];
        for (const { name, svg, matchType } of results) {
          parts.push(`### ${name} (${matchType})\n${svg}\n`);
        }
        return {
          content: [
            {
              type: "text" as const,
              text: parts.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error searching icons: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * get_icon — direct lookup by exact icon name.
   * Returns the SVG markup or an error with suggestions.
   */
  server.tool(
    "get_icon",
    "Get a Lucide icon SVG by exact name. Returns the SVG markup directly. If not found, suggests similar icons.",
    {
      name: z.string().describe('Exact icon name (e.g. "arrow-left", "bell", "check")'),
    },
    async ({ name }) => {
      try {
        const result = getIcon(name);

        if (result) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ name: result.name, svg: result.svg }, null, 2),
              },
            ],
          };
        }

        // Not found — provide suggestions
        const suggestions = searchIcons(name, 5);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: `Icon "${name}" not found`,
                  suggestions: suggestions.map(({ name, matchType }) => ({ name, matchType })),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting icon: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * list_icons — paginated listing of available Lucide icon names.
   * Supports optional prefix filtering.
   */
  server.tool(
    "list_icons",
    "List available Lucide icon names with optional prefix filter and pagination. Returns names only (use get_icon to fetch SVG).",
    {
      prefix: z.string().optional().describe('Filter icons by name prefix (e.g. "arrow", "circle")'),
      offset: z.coerce.number().min(0).optional().describe("Start index for pagination (default 0)"),
      limit: z.coerce.number().min(1).max(200).optional().describe("Max results per page (default 50, max 200)"),
    },
    async ({ prefix, offset, limit }) => {
      try {
        const result = listIcons({
          prefix,
          offset: offset ?? 0,
          limit: limit ?? 50,
        });

        const r = result as unknown as { total: number; offset: number; limit: number; icons: string[] };
        const end = r.offset + r.icons.length;
        const lines = [
          `Icons ${r.offset + 1}-${end} of ${r.total}${prefix ? ` (prefix: "${prefix}")` : ""}`,
          "",
          r.icons.join(", "),
        ];
        return {
          content: [
            {
              type: "text" as const,
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing icons: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * create_icon — resolves a Lucide icon server-side, injects color and size,
   * then creates it in Figma inside the specified parent at the given index.
   */
  server.tool(
    "create_icon",
    "Create a Lucide icon in Figma with a specific color and size. Resolves the SVG server-side and places it inside the given parent node at the specified index. Note: when the parent is an Icon/* placeholder frame, the icon is resized to fill the frame and the size parameter controls the SVG dimensions only.",
    {
      parentId: z.string().describe("Parent node ID to insert the icon into"),
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Zero-based position within the parent's children array (omit to append at the end)"),
      name: z.string().describe('Lucide icon name (e.g. "arrow-left", "bell", "check")'),
      color: z.string().optional().describe('Icon color. Accepts a CSS color ("#6b7280", "rgb(…)") OR a design token name ("gray-500", "text-text-secondary", "semantic/icon/muted"). Token names (anything with a hyphen or slash) are automatically routed to variable binding — no need to use colorVariable separately.'),
      colorVariable: z.string().optional().describe('Explicit Figma variable name for the icon stroke color. Only needed if color is also a valid CSS color and you still want variable binding. Supports Tailwind-style ("gray-500"), semantic paths ("text/secondary"), or exact names.'),
      size: z.coerce.number().positive().describe("Icon size in pixels applied to both width and height"),
    },
    async ({ parentId, index, name: iconName, color, colorVariable, size }) => {
      const icon = getIcon(iconName);
      if (!icon) {
        const suggestions = searchIcons(iconName, 5);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: `Icon "${iconName}" not found`,
                  suggestions: suggestions.map(({ name, matchType }) => ({ name, matchType })),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      try {
        // Auto-detect: if color looks like a token (e.g. "gray-500", "text-text-secondary"),
        // treat it as a colorVariable even if the caller passed it via the color param.
        const effectiveColorVar =
          colorVariable ??
          (color !== undefined && color !== null && color !== "" && !looksLikeCssColor(color) ? color : undefined);
        const effectiveCssColor =
          color !== undefined && color !== null && color !== "" && looksLikeCssColor(color)
            ? color
            : "#000000";

        const svgString = buildIconSvg(icon.svg, effectiveCssColor, size);

        const createResult = await sendCommandToFigma("create_svg", {
          svgString,
          x: 0,
          y: 0,
          name: icon.name,
          parentId,
          flatten: false,
          colorVariable: effectiveColorVar,
        });

        const typedResult = createResult as { id: string; name: string; width: number; height: number };

        let finalIndex: number | null = null;
        if (index !== undefined) {
          try {
            await sendCommandToFigma("insert_child", {
              parentId,
              childId: typedResult.id,
              index,
            });
            finalIndex = index;
          } catch (insertError) {
            // insert_child failed — clean up the orphaned node, then surface the error
            try {
              await sendCommandToFigma("delete_node", { nodeId: typedResult.id });
            } catch (_) {
              // best-effort cleanup
            }
            throw insertError;
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  id: typedResult.id,
                  name: typedResult.name,
                  iconName: icon.name,
                  color,
                  size,
                  parentId,
                  index: finalIndex,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error creating icon: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * update_icon — replaces an existing icon node with a new Lucide icon,
   * preserving its parent container and position (index) automatically.
   */
  server.tool(
    "update_icon",
    "Replace an existing icon node in Figma with a new Lucide icon. The replacement is inserted at the same parent and position as the original node.",
    {
      nodeId: z.string().describe("ID of the existing icon node to replace"),
      name: z.string().describe('New Lucide icon name (e.g. "arrow-left", "bell", "check")'),
      color: z.string().optional().describe('Icon color. Accepts a CSS color ("#6b7280", "rgb(…)") OR a design token name ("gray-500", "text-text-secondary"). Token names (anything with a hyphen or slash) are automatically routed to variable binding.'),
      colorVariable: z.string().optional().describe('Explicit Figma variable name for the icon stroke color. Only needed when color is also a valid CSS color and you still want variable binding.'),
      size: z.coerce.number().positive().describe("Icon size in pixels applied to both width and height"),
    },
    async ({ nodeId, name: iconName, color, colorVariable, size }) => {
      const icon = getIcon(iconName);
      if (!icon) {
        const suggestions = searchIcons(iconName, 5);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: `Icon "${iconName}" not found`,
                  suggestions: suggestions.map(({ name, matchType }) => ({ name, matchType })),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      try {
        const effectiveColorVar =
          colorVariable ??
          (color !== undefined && color !== null && color !== "" && !looksLikeCssColor(color) ? color : undefined);
        const effectiveCssColor =
          color !== undefined && color !== null && color !== "" && looksLikeCssColor(color)
            ? color
            : "#000000";

        const svgString = buildIconSvg(icon.svg, effectiveCssColor, size);

        const result = await sendCommandToFigma("update_icon", {
          nodeId,
          svgString,
          name: icon.name,
          colorVariable: effectiveColorVar,
        });

        const typedResult = result as { id: string; name: string; parentId: string; index: number };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  id: typedResult.id,
                  name: typedResult.name,
                  iconName: icon.name,
                  color,
                  size,
                  parentId: typedResult.parentId,
                  index: typedResult.index,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error updating icon: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}
