import type { DesignKnowledgeModule } from "./types.js";

export const COMPONENTS: DesignKnowledgeModule = {
  id: "components",
  name: "Components, Variants & Properties",
  description:
    "Planning component property models in Figma: variant budgets, boolean/text/instance-swap properties, layer wiring, naming, variant grids, build order, instance hygiene, and variable bindings.",
  content: `# Components, Variants & Properties

A component is a contract with every designer who drops an instance into a file. Restructuring it after instances exist breaks overrides, so most of the effort belongs in the plan, not the build.

## 1. Plan the Property Model First

Before creating a single layer, write down the component's surface:

| Question | Becomes |
|----------|---------|
| Does the whole shape, color, or layout change? | VARIANT axis (Size, Style, State) |
| Does one layer appear or disappear? | BOOLEAN property wired to that layer's visibility |
| Is there editable copy? | TEXT property wired to the text layer |
| Is there a swappable nested element (icon, avatar, logo)? | INSTANCE_SWAP property wired to the nested instance |

Only promote something to a variant axis when it genuinely changes more than one layer. Everything else is cheaper as a non-variant property.

## 2. Keep the Variant Budget Small

Every combination of variant values is a real node on the canvas — even combinations that look identical to another one. Axes multiply; boolean, text, and instance-swap properties do not.

- **Target: about 30 variants or fewer per set.** Size (3) × State (5) = 15 is comfortable; adding a 4-value Style axis takes you to 60.
- When the count blows past the budget:
  1. **Split the set** along the axis that changes identity most (e.g. separate Primary and Secondary button sets).
  2. **Convert a visual axis to instance swap** — anything that is really "which nested thing is shown" does not need a variant.
  3. **Extract a building block** — if a sub-element has its own states (a tab, a segment, a table cell), make it its own component set and place instances of it inside the parent.
- Never add an axis "just in case." An unused axis doubles the set for no benefit.

## 3. Icons: One Instance-Swap Property

Do not create \`Icon=Search\`, \`Icon=Close\`, \`Icon=Plus\` variants. Instead:

1. Make each icon its own component (import it as described in the \`icons\` module, then \`create_component\`) before building the components that use them.
2. Place one icon instance inside the component.
3. \`add_component_property\` with \`type: "INSTANCE_SWAP"\` and a default icon component as \`defaultValue\`.
4. \`edit_component_property\` with \`preferredValues\` (a list of \`{ type: "COMPONENT" | "COMPONENT_SET", key }\`) so the swap picker offers the relevant icon family first.
5. Pair it with a BOOLEAN such as \`Show Icon\` when the icon is optional.

## 4. Wire Every Property to a Layer

A property that is not referenced by any child layer shows up in the panel and does nothing. After adding properties:

1. \`get_component_properties\` on the component or set — TEXT, BOOLEAN, and INSTANCE_SWAP names come back with a \`#id\` suffix (e.g. \`Label#12:34\`). Use that full name everywhere. Variant axes keep plain names (\`Size\`).
2. \`set_component_property_references\` on each target child:
   - \`{ visible: "Show Icon#12:35" }\` for a boolean
   - \`{ characters: "Label#12:34" }\` for text
   - \`{ mainComponent: "Icon#12:36" }\` for instance swap
3. In a component set, repeat the wiring on the matching layer inside **every** variant. A variant left unwired silently ignores the property.
4. Verify by placing an instance and toggling each property with \`set_component_property\`.

Rename a property with \`edit_component_property\` (\`newName\`); remove an unwanted non-variant property with \`delete_component_property\`.

## 5. Naming

| Thing | Convention | Example |
|-------|-----------|---------|
| Public component / set | Title Case noun, no library prefix | \`Button\`, \`Text Field\` |
| Variant layer names | \`Property=Value\` pairs, comma-separated | \`Size=Medium, State=Hover\` |
| Variant values | Title Case, short, consistent across sets | \`Small\` / \`Medium\` / \`Large\` |
| Non-variant properties | Readable sentence or Title Case | \`Show Icon\`, \`Label\` |
| Internal building blocks | \`_\` prefix + slash grouping | \`_Tabs/Tab\`, \`_Input/Affix\` |

- Slashes group components into folders in the assets panel; keep top-level public components flat and use slashes for families and internals.
- Figma leaves components whose names start with \`_\` or \`.\` out of library publishing — use that for building blocks consumers should not pick directly.
- Use the same value spelling everywhere: if one set says \`Disabled\`, no other set should say \`Inactive\`.
- Apply variant names with \`rename_node\` on each component **before** combining; Figma reads the axes and values from those names.

## 6. Build the Variant Grid

1. Build and bind one base variant completely (auto-layout, variables, wired properties).
2. \`clone_node\` it for each combination, adjust only what differs, and \`rename_node\` each copy to its \`Property=Value\` name.
3. \`create_component\` on each frame (skip if you cloned an existing component), then \`create_component_set\` with all the ids and the set name.
4. Lay variants out as a readable matrix with \`move_node\` (positions are relative to the set):
   - **Columns:** the interaction axis — usually State (Default → Hover → Pressed → Focus → Disabled)
   - **Rows:** the identity axes — usually Size, then Style
   - A consistent 16–40px gap between cells and generous padding inside the set
5. \`export_node_as_image\` on the set and look at it. Check for overlapping variants, stragglers outside the grid, and values that render identically when they should differ.

## 7. Interactive States

- Model states as a single \`State\` variant axis: \`Default\`, \`Hover\`, \`Pressed\`, \`Focus\`, \`Disabled\`. Add \`Loading\` or \`Selected\` only when the component actually has them.
- Every state must be visibly distinct from Default. Focus in particular needs a real ring or outline, not a subtle tint (see \`craft-details\`).
- Selection that combines with every state (a checked checkbox can also be hovered) is its own axis (\`Checked=True/False\`), not extra State values.
- Keep state styling in the same bound variables as the base — a hover fill should be a token, not a hand-mixed hex.

## 8. Build Order: Atoms Before Molecules

- A component that contains another component's instance can only be built once that inner component exists. Sequence the work:
  - **Atoms:** icons, avatar, badge, spinner, divider
  - **Molecules:** text field, dropdown, button, switch, checkbox
  - **Organisms:** card, dialog, menu, navigation bar, table row
- **Componentize on the first pass.** When an element repeats in a screen (list rows, stat cards, nav items), make it a component immediately and fill the screen with its instances. Copy-pasted look-alike frames are a debt that rarely gets repaid.
- Check \`get_local_components\` before building — reuse an existing component rather than creating a duplicate with a slightly different name.

## 9. Working with Instances

- **Place instances, don't rebuild.** \`create_component_instance\` with \`instanceProperties\` sets variant, text, and boolean values in one call; \`replaceNodeId\` swaps a hand-built frame for an instance in place.
- **Set copy through properties.** If a text layer is driven by a TEXT property, change it with \`set_component_property\`, not \`set_text_content\`. Editing characters directly creates an override that bypasses the property model.
- **Change the variant, not the layers.** Switch Size or State with \`set_component_property\` (plain axis name, e.g. \`Size\` → \`Large\`) rather than resizing or recoloring children.
- \`swap_instance\` moves an instance to a different component while keeping its position; use \`contentOverrides.preserveContent\` to carry text and icons across.
- \`get_instance_overrides\` / \`set_instance_overrides\` copy overrides from one configured instance to many others.
- **Detach only as a last resort.** \`detach_instance\` severs the link to the main component — future fixes never reach that copy. If an instance needs something the component cannot do, extend the component instead.
- To change how every instance looks, edit the main component, never an instance.

## 10. Bind Styling to Variables

- Fills, strokes, padding, gap, and corner radius on components should be \`bind_variable\` bindings (\`fills/0/color\`, \`strokes/0/color\`, \`paddingLeft\`, \`itemSpacing\`, \`cornerRadius\`, …), never raw values.
- Bind on the base variant before cloning so every copy inherits the bindings; then rebind only the fields that change per variant (e.g. a Disabled background token).
- Raw values inside a component get copied into every instance and survive theme or mode changes unchanged — exactly the drift a component library is meant to prevent.

## 11. Descriptions

- Every public component set deserves a one- or two-sentence description: what it is for and when **not** to use it (e.g. "Primary action. Use once per view; use Secondary for everything else.").
- Put the description on the component set rather than on individual variants.
- This server has no tool for component descriptions — **set them manually in Figma** in the component's properties panel.

## Anti-Patterns

- **Variant per icon** — explodes the set; use one instance-swap property
- **Unwired properties** — present in the panel, inert on the canvas
- **Axes that change one layer** — should be a boolean or text property
- **60+ variant sets** — split the set, swap, or extract a building block
- **Inconsistent value names** — \`Sm\` in one set, \`Small\` in another
- **Flat duplicated frames** instead of instances of one component
- **Detached instances** used to work around a missing option
- **Hardcoded hex, padding, or radius** inside a main component
- **Unchecked grids** — never skip the visual check after combining variants
`,
};
