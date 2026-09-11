import type { DesignKnowledgeModule } from "./types.js";

export const DESIGN_SYSTEM_USAGE: DesignKnowledgeModule = {
  id: "design-system-usage",
  name: "Working With a Design System",
  description:
    "Designing in Figma on top of an existing system: precedence rules, discovery before building, token layers and modes, binding instead of hardcoding, component reuse, filling token gaps, and final verification.",
  content: `# Working With a Design System

Most real files already carry decisions: a palette, a type ramp, spacing steps, a component library. Work that ignores them looks off even if it's polished, and it's expensive to fix later. This module is about designing inside those decisions. It covers work in Figma only.

## Who Wins When Guidance Conflicts

Use this order and stop at the first source that answers the question:

1. **What the user or brand guidelines explicitly say.** A stated color, typeface or density is final.
2. **What the Figma file already defines.** This includes variables, text/color/effect styles, components, and the patterns visible on existing screens.
3. **The generic guidance in the other design-knowledge modules.** This covers color distributions, type scales, spacing grids and banned lists.

The generic modules fill gaps. They never override an existing system. If the brand's primary token is a color that a generic module discourages, use the brand token anyway. If the file uses a 6px spacing step, don't round it to 8. If a rule from another module would clash with the file, follow the file and mention the tension to the user rather than quietly "correcting" it.

## Discover Before You Build

Look at what already exists, in this order, before creating any node:

| Step | What to learn | Tools |
|------|---------------|-------|
| 1. Existing screens | How the system is actually applied: density, card treatment, header patterns | \`search_nodes\`, \`get_node_info\`, \`scan_bound_variables\` |
| 2. Components | Which building blocks exist and what variants they offer | \`get_local_components\`, \`get_component_properties\` |
| 3. Styles | Type ramp, named colors, shadows | \`get_text_styles\`, \`get_color_styles\`, \`get_styles\` |
| 4. Variables | Collections, modes, token names and values | \`get_design_system\`, \`get_variable_collections\`, \`get_variables\`, \`get_collection_info\` |
| 5. Only then | Create what's truly missing | See "When a Token Is Missing" |

\`get_design_system\` is the fastest overview. It gathers color, spacing and radius variables plus text and effect styles into one summary. Run \`scan_bound_variables\` on a finished screen that represents the product well. It lists every binding in that subtree, showing which tokens designers actually use for card backgrounds, borders and gaps. Token names alone don't tell you that.

### Library Assets You Can't See

This server's discovery tools only see what's **local** to the open file. Components, styles and variables from a published team library won't appear in those lists unless they already exist locally in the file. An empty or sparse result does **not** mean the team has no design system.

- If the file looks bare but the product clearly has a system, ask the user which library it comes from before building anything.
- If the user can give you a library component's key, \`create_component_instance\` and \`swap_instance\` accept that key and bring the component in.
- Never rebuild a library component or re-create a library token locally because it didn't show up. That creates a fork that drifts from the source.

## Token Layers and Modes

Many systems stack variables in tiers:

- **Primitive** tokens hold raw values, like a full gray ramp or a brand hue scale.
- **Semantic** tokens alias primitives by role: \`background\`, \`border\`, \`primary-foreground\`.
- **Component** tokens, where present, alias semantics for one component, such as a button's background.

Always bind the most specific token that fits: component, then semantic, then primitive. Binding a primitive when a semantic token exists breaks theming. When the dark mode remaps \`card\`, a layer bound straight to \`gray-100\` stays light.

Modes are where silent bugs hide:

- A frame can resolve variables in a different mode than its parent. A card showing dark values inside a light page usually means someone set a mode by hand, not that it's a design decision. Compare with neighbouring screens before copying it.
- When you add a token to a multi-mode collection, give it a value in **every** mode (\`create_variable\` and \`update_variable_value\` take a \`mode\` name). Otherwise the other themes end up with a value nobody chose.
- Check contrast in each mode separately. A pairing that passes in light can fail in dark.

## Bind, Don't Hardcode

If a token or style exists for a value, attach it. Don't type the number or hex. A bound property follows theme changes and mode switches, and it shows up correctly in audits.

| Property | How to attach |
|----------|---------------|
| Fill / stroke color | \`bind_variable\` with field \`fills/0/color\` or \`strokes/0/color\`, or \`set_color_style_id\` for a paint style |
| Padding and gaps | \`bind_variable\` with \`paddingTop\`/\`paddingRight\`/\`paddingBottom\`/\`paddingLeft\`, \`itemSpacing\`, \`counterAxisSpacing\` |
| Corner radius | \`bind_variable\` with \`cornerRadius\` or a single corner (\`topLeftRadius\`, …) |
| Size, opacity, stroke width | \`bind_variable\` with \`width\`, \`height\`, \`opacity\`, \`strokeWeight\` |
| Typography on a text layer | \`apply_text_style\` (by name or id) |
| Typography inside a text style | \`bind_variable\` with the text style as the target and a field such as \`fontSize\`, \`lineHeight\`, \`fontFamily\` |
| Shadows / blurs | \`set_effect_style_id\` |

\`bind_variable\`, \`apply_text_style\` and the style tools accept names like \`surface/card\`, so you don't need to look up ids first. Use \`unbind_variable\` only when you mean to break a link on purpose.

A hardcoded value is acceptable only for a one-off with no token equivalent, like an illustration's inner detail. Even then, check first whether the value belongs in the system.

## Reuse Components

- Place an **instance** of an existing component rather than drawing a look-alike frame. Use \`create_component_instance\` with the component id from \`get_local_components\`.
- Choose variants by what the element **means**, not by what looks closest. A destructive confirmation takes the destructive button variant even if the neutral one "fits the layout better".
- Set text, boolean and swap properties with \`set_component_property\`. To repeat one instance's overrides on others, use \`set_instance_overrides\`. Don't detach to edit.
- To upgrade a hand-drawn element, use \`create_component_instance\` with \`replaceNodeId\`, or \`swap_instance\` for an existing instance. Both can carry text across with \`contentOverrides\`.
- Detaching (\`detach_instance\`) cuts the element off from future library fixes. Treat it as a last resort and tell the user when you do it.

## When a Token Is Missing

Don't paste in a raw value to get past a gap. Instead:

1. **Confirm it's really missing.** Search the variable list for the role, not just the name you expected. \`surface-raised\` might exist as \`card\` or \`popover\`.
2. **Pick the right layer.** A new role like "subtle highlight" is a semantic token that aliases an existing primitive. A genuinely new raw color is a primitive, and it needs a semantic token on top before anything binds to it.
3. **Follow the file's conventions.** Match its separators (slashes vs dashes), casing, grouping and suffixes (\`-foreground\`, numeric steps) so the new token sits beside its siblings.
4. **Propose, then add.** Tell the user what you plan to add and why, then use \`create_variable\` or \`create_variables_batch\` with values for every mode. These tools write raw values only, so a new semantic token has to be aliased to its primitive by hand in Figma (see below).

### This Server's Standard Theme Schema

For color collections, this server ships a reference theme built with shadcn-style role names. Examples are \`background\`/\`foreground\`, \`card\`, \`primary\`/\`primary-foreground\`, \`destructive\`, \`muted\`, \`border\`, \`input\` and \`ring\`. There are also 50–900 scale steps such as \`primary-100\`, plus optional \`chart-1\`…\`chart-8\`. \`get_schema_definition\` returns the full list.

- \`audit_collection\` compares a collection with that standard and reports what's missing or extra.
- \`suggest_missing_variables\` lists the gaps along with suggested default values.

Treat these as a checklist for completeness, not as a mandate. If the file already has its own naming scheme, keep it. Don't rename the user's tokens to match the reference, and don't run \`fix_collection_to_standard\` on an established system without asking.

## Things to Set Manually in Figma

This server has no tools for the following. Tell the user to set them in Figma's UI:

- **Variable aliases**, which point a semantic or component token at another variable.
- **Variable scopes**, which limit the property pickers a variable appears in.
- **Code syntax** on variables.
- **Pinning a variable mode** on a specific frame or section.

## Verify Before Handing Off

1. Run \`lint_frame\` on each finished frame. It reports fills and strokes without color bindings, padding, gaps and radii without tokens, text without a text style, shadows without an effect style, and auto-layout problems. Fix what it reports (CRITICAL and HIGH at minimum) rather than muting the check.
2. Run \`scan_bound_variables\` on the frame. Confirm the bindings are semantic tokens, not primitives, and that nothing points at an unexpected collection.
3. Run \`validate_color_contrast\` on the color collection for **each mode**, using its \`mode\` parameter. Use \`calculate_contrast_ratio\` for one-off pairs such as text over an image tint.
4. Compare with an existing screen from the same product. Spacing rhythm, card treatment and heading styles should look like they came from the same team.
`,
};
