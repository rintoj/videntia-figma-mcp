# Selection Tab — Filter Behavior

## Filter Modes

| Filter         | Row Format                                            | Placeholder (no selection)       | Placeholder (with selection)              |
| -------------- | ----------------------------------------------------- | -------------------------------- | ----------------------------------------- |
| **Selection**  | `[icon] Name` `id  page`                              | Search history...                | Search history...                         |
| **Name or ID** | `[icon] Name` `id  page`                              | Search all by name or id...      | Search in "NodeName" by name or id...     |
| **Content**    | `[icon] "text content"` `name  id  page`              | Search all by text content...    | Search in "NodeName" by text content...   |
| **Type**       | `[icon] TYPE` `name  id  page`                        | Search all by type...            | Search in "NodeName" by type...           |
| **Variable**   | `[icon] variable/path` `name  id  page`               | Search all by variable...        | Search in "NodeName" by variable...       |
| **Color**      | `[swatch] #hex` `name  id  page`                      | Search all by color...           | Search in "NodeName" by color...          |

## Behavior Matrix

### Selection (default)

Maintains a history of previously selected nodes across selection changes.

| Query | No Figma selection            | 1+ nodes selected in Figma    |
| ----- | ----------------------------- | ----------------------------- |
| Empty | Show full selection history   | Show full selection history   |
| Text  | Fuzzy-filter history by query | Fuzzy-filter history by query |

### Name or ID

| Query | No Figma selection                   | 1+ nodes selected in Figma                           |
| ----- | ------------------------------------ | ---------------------------------------------------- |
| Empty | Empty list                           | BFS traversal of selected node and all its children  |
| Text  | Search entire document by name or ID | Search within selected frames (deep, any descendant) |

### Content

Only includes nodes that contain text content (TEXT nodes or nodes with text children).

| Query | No Figma selection                     | 1+ nodes selected in Figma                                       |
| ----- | -------------------------------------- | ---------------------------------------------------------------- |
| Empty | Empty list                             | BFS traversal of selected node's children that have text content |
| Text  | Search entire document by text content | Search within selected frames for matching text content (deep)   |

### Type

| Query | No Figma selection                                         | 1+ nodes selected in Figma                          |
| ----- | ---------------------------------------------------------- | --------------------------------------------------- |
| Empty | Empty list                                                 | BFS traversal of selected node and all its children |
| Text  | Search entire document by node type (e.g. "FRAME", "TEXT") | Search within selected frames by node type (deep)   |

### Variable

Only includes nodes that have bound variables.

| Query | No Figma selection                      | 1+ nodes selected in Figma                                          |
| ----- | --------------------------------------- | ------------------------------------------------------------------- |
| Empty | Empty list                              | BFS traversal of selected node's children that have bound variables |
| Text  | Search entire document by variable name | Search within selected frames for matching variable name (deep)     |

### Color

Only includes nodes that have explicit fill or stroke colors (not inherited).

| Query | No Figma selection                  | 1+ nodes selected in Figma                                     |
| ----- | ----------------------------------- | -------------------------------------------------------------- |
| Empty | Empty list                          | BFS traversal of selected node's children that have raw colors |
| Text  | Search entire document by color hex | Search within selected frames for matching color (deep)        |

## Common Behaviors

- **BFS traversal**: Breadth-first walk of the selected node(s) and all descendants, flattened into a list
- **Deep search within selection**: When a query is present and nodes are selected, search is scoped to descendants of the selected frames — matches at any depth
- **Checked state**: Newly selected nodes are auto-checked; checkboxes persist until manually cleared
- **Navigation**: Prev/Next arrows cycle through the displayed list and focus each node in Figma
- **Copy IDs**: Bottom bar appears when 1+ nodes are checked, with "Copy IDs" (JSON array) and "Clear"
