/**
 * This module contains all the prompts used by the Figma MCP server.
 * Prompts provide guidance to Claude on how to work with Figma designs effectively.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Register all prompts with the MCP server
 * @param server - The MCP server instance
 */
export function registerPrompts(server: McpServer): void {
  // Design Strategy Prompt
  server.prompt("design_strategy", "Best practices for working with Figma designs", (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `When working with Figma designs, follow these best practices:

1. Start with Document Structure:
   - First use get_document_info() to understand the current document
   - Plan your layout hierarchy before creating elements
   - Create a main container frame for each screen/section

2. Naming Conventions:
   - Use descriptive, semantic names for all elements
   - Follow a consistent naming pattern (e.g., "Login Screen", "Logo Container", "Email Input")
   - Group related elements with meaningful names

3. Layout Hierarchy:
   - Create parent frames first, then add child elements
   - For forms/login screens:
     * Start with the main screen container frame
     * Create a logo container at the top
     * Group input fields in their own containers
     * Place action buttons (login, submit) after inputs
     * Add secondary elements (forgot password, signup links) last

4. Input Fields Structure:
   - Create a container frame for each input field
   - Include a label text above or inside the input
   - Group related inputs (e.g., username/password) together

5. Element Creation:
   - Use create_frame() for containers and input fields
   - Use create_text() for labels, buttons text, and links
   - Set appropriate colors and styles:
     * Use fillColor for backgrounds
     * Use strokeColor for borders
     * Set proper fontWeight for different text elements

6. Mofifying existing elements:
  - use set_text_content() to modify text content.

7. Visual Hierarchy:
   - Position elements in logical reading order (top to bottom)
   - Maintain consistent spacing between elements
   - Use appropriate font sizes for different text types:
     * Larger for headings/welcome text
     * Medium for input labels
     * Standard for button text
     * Smaller for helper text/links

8. Best Practices:
   - Verify each creation with get_node_info()
   - Use parentId to maintain proper hierarchy
   - Group related elements together in frames
   - Keep consistent spacing and alignment

Example Login Screen Structure:
- Login Screen (main frame)
  - Logo Container (frame)
    - Logo (image/text)
  - Welcome Text (text)
  - Input Container (frame)
    - Email Input (frame)
      - Email Label (text)
      - Email Field (frame)
    - Password Input (frame)
      - Password Label (text)
      - Password Field (frame)
  - Login Button (frame)
    - Button Text (text)
  - Helper Links (frame)
    - Forgot Password (text)
    - Don't have account (text)`,
          },
        },
      ],
      description: "Best practices for working with Figma designs",
    };
  });

  // Read Design Strategy Prompt
  server.prompt("read_design_strategy", "Best practices for reading Figma designs", (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `When reading Figma designs, follow these best practices:

1. Start with selection:
   - First use get_selection() to understand the current selection
   - If no selection ask user to select single or multiple nodes

2. Get node infos of the selected nodes:
   - Use get_nodes_info() to get the information of the selected nodes
   - If no selection ask user to select single or multiple nodes
`,
          },
        },
      ],
      description: "Best practices for reading Figma designs",
    };
  });

  // Text Replacement Strategy Prompt
  server.prompt("text_replacement_strategy", "Systematic approach for replacing text in Figma designs", (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `# Intelligent Text Replacement Strategy

## 1. Analyze Design & Identify Structure
- Scan text nodes to understand the overall structure of the design
- Use AI pattern recognition to identify logical groupings:
  * Tables (rows, columns, headers, cells)
  * Lists (items, headers, nested lists)
  * Card groups (similar cards with recurring text fields)
  * Forms (labels, input fields, validation text)
  * Navigation (menu items, breadcrumbs)
\`\`\`
scan_text_nodes(nodeId: "node-id")
get_node_info(nodeId: "node-id")  // optional
\`\`\`

## 2. Strategic Chunking for Complex Designs
- Divide replacement tasks into logical content chunks based on design structure
- Use one of these chunking strategies that best fits the design:
  * **Structural Chunking**: Table rows/columns, list sections, card groups
  * **Spatial Chunking**: Top-to-bottom, left-to-right in screen areas
  * **Semantic Chunking**: Content related to the same topic or functionality
  * **Component-Based Chunking**: Process similar component instances together

## 3. Progressive Replacement with Verification
- Create a safe copy of the node for text replacement
- Replace text chunk by chunk with continuous progress updates
- After each chunk is processed:
  * Export that section as a small, manageable image
  * Verify text fits properly and maintain design integrity
  * Fix issues before proceeding to the next chunk

\`\`\`
// Clone the node to create a safe copy
clone_node(nodeId: "selected-node-id", x: [new-x], y: [new-y])

// Replace text chunk by chunk
set_multiple_text_contents(
  nodeId: "parent-node-id",
  text: [
    { nodeId: "node-id-1", text: "New text 1" },
    // More nodes in this chunk...
  ]
)

// Verify chunk with small, targeted image exports
export_node_as_image(nodeId: "chunk-node-id", format: "PNG", scale: 0.5)
\`\`\`

## 4. Intelligent Handling for Table Data
- For tabular content:
  * Process one row or column at a time
  * Maintain alignment and spacing between cells
  * Consider conditional formatting based on cell content
  * Preserve header/data relationships

## 5. Smart Text Adaptation
- Adaptively handle text based on container constraints:
  * Auto-detect space constraints and adjust text length
  * Apply line breaks at appropriate linguistic points
  * Maintain text hierarchy and emphasis
  * Consider font scaling for critical content that must fit

## 6. Progressive Feedback Loop
- Establish a continuous feedback loop during replacement:
  * Real-time progress updates (0-100%)
  * Small image exports after each chunk for verification
  * Issues identified early and resolved incrementally
  * Quick adjustments applied to subsequent chunks

## 7. Final Verification & Context-Aware QA
- After all chunks are processed:
  * Export the entire design at reduced scale for final verification
  * Check for cross-chunk consistency issues
  * Verify proper text flow between different sections
  * Ensure design harmony across the full composition

## 8. Chunk-Specific Export Scale Guidelines
- Scale exports appropriately based on chunk size:
  * Small chunks (1-5 elements): scale 1.0
  * Medium chunks (6-20 elements): scale 0.7
  * Large chunks (21-50 elements): scale 0.5
  * Very large chunks (50+ elements): scale 0.3
  * Full design verification: scale 0.2

## Sample Chunking Strategy for Common Design Types

### Tables
- Process by logical rows (5-10 rows per chunk)
- Alternative: Process by column for columnar analysis
- Tip: Always include header row in first chunk for reference

### Card Lists
- Group 3-5 similar cards per chunk
- Process entire cards to maintain internal consistency
- Verify text-to-image ratio within cards after each chunk

### Forms
- Group related fields (e.g., "Personal Information", "Payment Details")
- Process labels and input fields together
- Ensure validation messages and hints are updated with their fields

### Navigation & Menus
- Process hierarchical levels together (main menu, submenu)
- Respect information architecture relationships
- Verify menu fit and alignment after replacement

## Best Practices
- **Preserve Design Intent**: Always prioritize design integrity
- **Structural Consistency**: Maintain alignment, spacing, and hierarchy
- **Visual Feedback**: Verify each chunk visually before proceeding
- **Incremental Improvement**: Learn from each chunk to improve subsequent ones
- **Balance Automation & Control**: Let AI handle repetitive replacements but maintain oversight
- **Respect Content Relationships**: Keep related content consistent across chunks

Remember that text is never just text—it's a core design element that must work harmoniously with the overall composition. This chunk-based strategy allows you to methodically transform text while maintaining design integrity.`,
          },
        },
      ],
      description: "Systematic approach for replacing text in Figma designs",
    };
  });

  // Theme Variables Instructions Prompt
  server.prompt(
    "theme_variables_instructions",
    "Complete instructions for creating or fixing Figma theme variable collections",
    (extra) => {
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `# Instructions: Create or Fix Figma Theme Variable Collection

Use these instructions to create a complete theme variable collection in Figma with proper color organization and color scales, or to audit and fix an existing collection.

---

## Task Overview

**Option A - Create New Collection:**
Create a Figma variable collection named "Theme" with a "dark" mode containing all base semantic colors, their foreground variants, and complete color scales for brand and state colors.

**Option B - Fix Existing Collection:**
Audit an existing "Theme" collection, identify missing variables, add them, and flag any non-standard variables that fall outside the expected schema.

---

## Step 1: Create Base Collection

Create a variable collection with:
- **Collection Name**: \`Theme\`
- **Mode**: \`dark\` (default mode)
- **Variable Type**: Color

---

## Step 2: Create Base Semantic Colors (32 variables)

Create the following base color variables (100% opacity):

### Background & Surface Colors
- \`background\` - Main app background
- \`foreground\` - Primary text color
- \`card\` - Card/elevated surface backgrounds
- \`card-foreground\` - Text on card surfaces
- \`popover\` - Popover/modal backgrounds
- \`popover-foreground\` - Text on popover surfaces

### Brand & Hierarchy Colors
- \`primary\` - Primary brand/accent color
- \`primary-foreground\` - Text on primary color
- \`secondary\` - Secondary brand color
- \`secondary-foreground\` - Text on secondary color
- \`tertiary\` - Tertiary hierarchy color
- \`tertiary-foreground\` - Text on tertiary color
- \`accent\` - Additional accent color
- \`accent-foreground\` - Text on accent color

### State Colors
- \`success\` - Success state background
- \`success-foreground\` - Success text/icons
- \`info\` - Info state background
- \`info-foreground\` - Info text/icons
- \`warning\` - Warning state background
- \`warning-foreground\` - Warning text/icons
- \`destructive\` - Error/destructive state background
- \`destructive-foreground\` - Error text/icons

### Interactive Colors
- \`link\` - Link/hyperlink color
- \`link-hover\` - Link hover state color

### Overlay & Feedback Colors
- \`overlay\` - Modal/dialog backdrop (semi-transparent)
- \`tooltip\` - Tooltip background
- \`tooltip-foreground\` - Tooltip text
- \`placeholder\` - Placeholder/skeleton backgrounds
- \`placeholder-foreground\` - Placeholder text

### Utility Colors
- \`muted\` - Muted/disabled backgrounds
- \`muted-foreground\` - Muted/disabled text
- \`selected\` - Selected state background
- \`selected-foreground\` - Selected state text
- \`border\` - Border color
- \`input\` - Input field border/background
- \`ring\` - Focus ring color

---

## Step 3: Create Color Scales (70 variables)

For each of these 7 colors, create a complete scale from -50 to -900:
1. \`primary\`
2. \`secondary\`
3. \`accent\`
4. \`success\`
5. \`info\`
6. \`warning\`
7. \`destructive\`

### Color Scale Pattern (Solid Colors, Not Opacity)

**IMPORTANT:** These are **solid colors** (alpha = 1.0), NOT transparent colors. Each variant is computed by compositing the base color over the \`background\` variable.

**Compositing Formula:**
\`\`\`
resultant RGB = (base color RGB × mix%) + (background RGB × (1 - mix%))
\`\`\`

| Variable Name | Mix % | Usage |
|---------------|-------|--------|
| \`{color}-50\` | 5% | Extremely subtle backgrounds |
| \`{color}-100\` | 10% | Very light backgrounds, subtle hover |
| \`{color}-200\` | 20% | Light backgrounds, gentle emphasis |
| \`{color}-300\` | 30% | Subtle overlays, secondary emphasis |
| \`{color}-400\` | 40% | Medium-light overlays |
| \`{color}-500\` | 50% | Medium overlays, balanced mix |
| \`{color}-600\` | 60% | Medium-strong overlays, hover states |
| \`{color}-700\` | 70% | Strong emphasis, active states |
| \`{color}-800\` | 80% | Very strong emphasis |
| \`{color}-900\` | 90% | Near-full color, maximum emphasis |

**Example:** For \`primary-300\`:
\`\`\`
R = (primary.r × 0.30) + (background.r × 0.70)
G = (primary.g × 0.30) + (background.g × 0.70)
B = (primary.b × 0.30) + (background.b × 0.70)
\`\`\`

---

## Step 4: Optional Chart Colors (8 variables)

**Add these ONLY when explicitly requested by the user:**
- \`chart-1\` through \`chart-8\`

---

## Standard Variable Count

**Total: 102 variables** (110 with chart colors)
- 32 base semantic colors
- 70 color scale variants (7 colors × 10 levels)
- 8 optional chart colors

---

## Using MCP Tools

### Create New Collection
1. Use \`create_variable_collection(name: "Theme", default_mode: "dark")\`
2. Use \`apply_default_theme(collection_id: "Theme")\` to apply default values
3. Or use \`create_variables_batch()\` to create custom values

### Audit Existing Collection
1. Use \`audit_collection(collection_id: "Theme")\` to check compliance
2. Use \`generate_audit_report(collection_id: "Theme")\` for detailed report
3. Use \`suggest_missing_variables(collection_id: "Theme")\` for recommendations

### Fix Existing Collection
1. Use \`fix_collection_to_standard(collection_id: "Theme")\` for one-click fix
2. Or manually add missing variables with \`create_variables_batch()\`
3. Use \`validate_color_contrast(collection_id: "Theme")\` for WCAG compliance

### Color Scale Operations
1. Use \`calculate_color_scale(base_color, background_color)\` to preview scales
2. Use \`create_color_scale_set()\` to create complete scale for one color
3. Use \`create_all_scales()\` to create all 7 scales at once

### Organization
1. Use \`reorder_variables(collection_id: "Theme", order: "standard")\`
2. Use \`export_collection_schema()\` to save configuration
3. Use \`import_collection_schema()\` to restore configuration

---

## Validation Checklist

After creation, verify:
- [ ] Collection named "Theme" with "dark" mode exists
- [ ] All 32 base semantic colors created
- [ ] All 7 color categories have complete -50 to -900 scales
- [ ] Each scale variant is a solid color (alpha = 1.0), not transparent
- [ ] Each variant correctly composited: (base × mix%) + (background × (1 - mix%))
- [ ] Total of 102 variables (110 with chart colors)
- [ ] Variables organized logically
- [ ] WCAG contrast validation passed for foreground colors

---

## Important Notes

1. **Solid Colors**: All scale variants are solid colors with alpha = 1.0
2. **No Transparency**: Scale variants use color compositing, not opacity
3. **Mix Percentages**: Suffix indicates mix %: -50 = 5%, -100 = 10%, -200 = 20%, etc.
4. **Naming**: Use lowercase with hyphens (e.g., \`primary-100\` not \`Primary100\`)
5. **WCAG Compliance**: Ensure foreground colors meet AA standards (4.5:1 contrast)

---

**For complete details, examples, and reference values, see:**
- Full documentation: docs/figma-theme-variables-guide.md
- MCP tools spec: docs/figma-theme-variables-mcp-tools.md`,
            },
          },
        ],
        description: "Complete instructions for creating or fixing Figma theme variable collections",
      };
    },
  );
}
