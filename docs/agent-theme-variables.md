# Agent Instructions: Create or Fix Figma Theme Variables Using MCP

**For**: Claude Code Agent
**Purpose**: Use FigmaStudioMCP MCP plugin to create or fix theme variable collections in Figma
**MCP Server**: FigmaStudioMCP (port 3000)

---

## Agent Workflow Overview

When the user asks you to create or fix theme variables in Figma, follow this workflow:

1. **Audit** - Get existing variable collections from Figma
2. **Analyze** - Compare against standard system (102 or 110 variables)
3. **Plan** - Determine what needs to be created/updated
4. **Execute** - Create/update variables via MCP tools
5. **Validate** - Verify all variables and check WCAG contrast compliance

---

## Available MCP Tools for Variables

You have access to these powerful MCP tools:

### Collection Management
- `mcp__FigmaStudioMCP__get_variable_collections()` - List all collections
- `mcp__FigmaStudioMCP__create_variable_collection({name, default_mode})` - Create new collection
- `mcp__FigmaStudioMCP__get_collection_info({collection_id})` - Get collection details

### Variable Creation & Management
- `mcp__FigmaStudioMCP__create_variable({collection_id, name, value})` - Create single variable
- `mcp__FigmaStudioMCP__create_variables_batch({collection_id, variables})` - Bulk creation
- `mcp__FigmaStudioMCP__update_variable_value({variable_id, value})` - Update values
- `mcp__FigmaStudioMCP__rename_variable({variable_id, new_name})` - Rename
- `mcp__FigmaStudioMCP__delete_variable({variable_id})` - Delete single
- `mcp__FigmaStudioMCP__delete_variables_batch({variable_ids})` - Bulk delete

### Color Calculations (Server-Side)
- `mcp__FigmaStudioMCP__calculate_color_scale({base_color, background_color})` - Generate 10 scale levels
- `mcp__FigmaStudioMCP__calculate_composite_color({base_color, background_color, mix_percentage})` - Single composite
- `mcp__FigmaStudioMCP__convert_color_format({color, from_format, to_format})` - Convert formats
- `mcp__FigmaStudioMCP__calculate_contrast_ratio({foreground, background})` - WCAG validation

### Schema Validation & Auditing
- `mcp__FigmaStudioMCP__audit_collection({collection_id})` - Compare against standard
- `mcp__FigmaStudioMCP__validate_color_contrast({collection_id, mode, standard})` - WCAG checks
- `mcp__FigmaStudioMCP__get_schema_definition()` - Get standard schema
- `mcp__FigmaStudioMCP__suggest_missing_variables({collection_id})` - Get recommendations

### Bulk Operations & Automation
- `mcp__FigmaStudioMCP__apply_default_theme({collection_id})` - Apply reference dark theme
- `mcp__FigmaStudioMCP__create_color_scale_set({collection_id, color_name, base_color, foreground_color, background_color})` - Create complete scale
- `mcp__FigmaStudioMCP__apply_custom_palette({collection_id, palette, background_color})` - Apply brand colors
- `mcp__FigmaStudioMCP__create_all_scales({collection_id, base_colors, background_color})` - Create all 7 scales
- `mcp__FigmaStudioMCP__fix_collection_to_standard({collection_id})` - **One-click fix!**
- `mcp__FigmaStudioMCP__add_chart_colors({collection_id})` - Add 8 chart colors

### Organization & Export
- `mcp__FigmaStudioMCP__reorder_variables({collection_id, order})` - Organize variables
- `mcp__FigmaStudioMCP__generate_audit_report({collection_id, format})` - Generate markdown/JSON report
- `mcp__FigmaStudioMCP__export_collection_schema({collection_id})` - Export as JSON
- `mcp__FigmaStudioMCP__import_collection_schema({collection_id, schema})` - Import from JSON

---

## Step 1: Audit Existing Collections

### 1.1 Get All Variable Collections

```typescript
const collections = await mcp__FigmaStudioMCP__get_variable_collections();
```

This returns:
- List of all collections with names and IDs
- Can identify if "Theme" collection exists

### 1.2 Check for Theme Collection

Look for collection named "Theme" (case-insensitive):
- If found: Get collection ID, proceed to detailed audit
- If not found: Plan to create new collection

### 1.3 Detailed Collection Audit

If Theme collection exists:

```typescript
const audit = await mcp__FigmaStudioMCP__audit_collection({
  collection_id: "Theme"  // Can use name or ID
});
```

This automatically:
- ✅ Compares against 102-variable standard
- ✅ Lists missing variables by category
- ✅ Lists non-standard variables
- ✅ Checks for info, link, overlay, tooltip, placeholder colors
- ✅ Validates all 7 color scales (-50 to -900)

---

## Step 2: Understand Standard Theme System

### Core Principle

- **Total Variables**: 102 (or 110 with chart colors)
- **Base Colors**: 32 semantic colors
- **Color Scales**: 70 variants (7 colors × 10 levels each)
- **Chart Colors**: 8 optional colors

### Variable Categories

#### 2.1 Background & Surface Colors (6 variables)
```
background - Main app background
foreground - Primary text color
card - Card/elevated surface backgrounds
card-foreground - Text on card surfaces
popover - Popover/modal backgrounds
popover-foreground - Text on popover surfaces
```

#### 2.2 Brand & Hierarchy Colors (8 variables)
```
primary - Primary brand/accent color
primary-foreground - Text on primary color
secondary - Secondary brand color
secondary-foreground - Text on secondary color
tertiary - Tertiary hierarchy color
tertiary-foreground - Text on tertiary color
accent - Additional accent color
accent-foreground - Text on accent color
```

#### 2.3 State Colors (8 variables)
```
success - Success state background
success-foreground - Success text/icons
info - Info state background
info-foreground - Info text/icons
warning - Warning state background
warning-foreground - Warning text/icons
destructive - Error/destructive state background
destructive-foreground - Error text/icons
```

#### 2.4 Interactive Colors (2 variables)
```
link - Link/hyperlink color
link-hover - Link hover state color
```

#### 2.5 Overlay & Feedback Colors (5 variables)
```
overlay - Modal/dialog backdrop (semi-transparent, 80% opacity)
tooltip - Tooltip background
tooltip-foreground - Tooltip text
placeholder - Placeholder/skeleton backgrounds
placeholder-foreground - Placeholder text
```

#### 2.6 Utility Colors (7 variables)
```
muted - Muted/disabled backgrounds
muted-foreground - Muted/disabled text
selected - Selected state background
selected-foreground - Selected state text
border - Border color
input - Input field border/background
ring - Focus ring color
```

#### 2.7 Color Scales (70 variables)

For each of these 7 colors, create 10 scale levels:
- `primary` (primary-50 through primary-900)
- `secondary` (secondary-50 through secondary-900)
- `accent` (accent-50 through accent-900)
- `success` (success-50 through success-900)
- `info` (info-50 through info-900)
- `warning` (warning-50 through warning-900)
- `destructive` (destructive-50 through destructive-900)

**Scale Levels:**
```
-50:  5% mix  - Extremely subtle backgrounds
-100: 10% mix - Very light backgrounds, subtle hover
-200: 20% mix - Light backgrounds, gentle emphasis
-300: 30% mix - Subtle overlays, secondary emphasis
-400: 40% mix - Medium-light overlays
-500: 50% mix - Medium overlays, balanced mix
-600: 60% mix - Medium-strong overlays, hover states
-700: 70% mix - Strong emphasis, active states
-800: 80% mix - Very strong emphasis
-900: 90% mix - Near-full color, maximum emphasis
```

**Compositing Formula:**
```
resultant RGB = (base color RGB × mix%) + (background RGB × (1 - mix%))
```

**IMPORTANT**: These are **solid colors** (alpha = 1.0), not transparent colors.

#### 2.8 Chart Colors (8 optional variables)
```
chart-1 through chart-8
```
Only add when user explicitly requests them.

---

## Step 3: Agent Execution Instructions

### 3.1 Determine User's Request

When user says:
- **"Create theme variables"** → Create new Theme collection with 102 variables
- **"Fix theme variables"** → Audit and fix existing Theme collection
- **"Add chart colors"** → Add 8 chart colors to existing collection
- **"Apply default theme"** → Apply reference dark theme colors
- **"Audit theme"** → Generate audit report only

### 3.2 Ask User for Scope (If Unclear)

Use `AskUserQuestion` tool:

```typescript
AskUserQuestion({
  questions: [{
    question: "What would you like me to do with the Theme variable collection?",
    header: "Theme Variables",
    multiSelect: false,
    options: [
      {
        label: "Create new (102 vars)",
        description: "Create complete Theme collection with all 102 standard variables"
      },
      {
        label: "Fix existing",
        description: "Audit current Theme collection and add missing variables"
      },
      {
        label: "Apply default theme",
        description: "Apply reference dark theme color values (recommended)"
      },
      {
        label: "Audit only",
        description: "Generate audit report without making changes"
      }
    ]
  }]
})
```

---

## Step 4: Create New Theme Collection

### 4.1 Quick Method: One-Click Creation

**Best approach** - Use the automated tools:

```typescript
// Step 1: Create collection
await mcp__FigmaStudioMCP__create_variable_collection({
  name: "Theme",
  default_mode: "dark"
});

// Step 2: Apply complete default theme
await mcp__FigmaStudioMCP__apply_default_theme({
  collection_id: "Theme",
  include_chart_colors: false,  // Set true if user wants chart colors
  overwrite_existing: false
});

// Step 3: Validate
await mcp__FigmaStudioMCP__audit_collection({
  collection_id: "Theme"
});
```

This creates:
- ✅ All 32 base semantic colors
- ✅ All 70 color scale variants (calculated server-side)
- ✅ Proper organization
- ✅ WCAG AA compliant contrast ratios

### 4.2 Custom Colors Method

If user wants custom brand colors:

```typescript
// Step 1: Create collection
await mcp__FigmaStudioMCP__create_variable_collection({
  name: "Theme",
  default_mode: "dark"
});

// Step 2: Apply custom palette
await mcp__FigmaStudioMCP__apply_custom_palette({
  collection_id: "Theme",
  palette: {
    primary: {
      base: {r: 0.639, g: 0.902, b: 0.208},      // Your brand primary
      foreground: {r: 0.134, g: 0.000, b: 0.085} // Contrasting text
    },
    secondary: {
      base: {r: 0.149, g: 0.153, b: 0.153},
      foreground: {r: 0.980, g: 0.980, b: 0.980}
    },
    // ... continue for accent, success, info, warning, destructive
  },
  background_color: {r: 0.059, g: 0.063, b: 0.067}, // Dark background
  regenerate_scales: true  // Automatically generates all 70 scale variants
});
```

### 4.3 Manual Creation (Step-by-Step)

If you need fine control:

```typescript
// Step 1: Create collection
await mcp__FigmaStudioMCP__create_variable_collection({
  name: "Theme",
  default_mode: "dark"
});

// Step 2: Create base colors in batches
await mcp__FigmaStudioMCP__create_variables_batch({
  collection_id: "Theme",
  mode: "dark",
  variables: [
    {name: "background", value: {r: 0.059, g: 0.063, b: 0.067}},
    {name: "foreground", value: {r: 0.980, g: 0.980, b: 0.980}},
    {name: "card", value: {r: 0.102, g: 0.106, b: 0.110}},
    // ... continue for all 32 base colors
  ]
});

// Step 3: Create color scales
await mcp__FigmaStudioMCP__create_all_scales({
  collection_id: "Theme",
  base_colors: {
    primary: {r: 0.639, g: 0.902, b: 0.208},
    secondary: {r: 0.149, g: 0.153, b: 0.153},
    accent: {r: 0.149, g: 0.153, b: 0.153},
    success: {r: 0.078, g: 0.325, b: 0.176},
    info: {r: 0.118, g: 0.251, b: 0.686},
    warning: {r: 0.863, g: 0.696, b: 0.149},
    destructive: {r: 0.863, g: 0.149, b: 0.149}
  },
  background_color: {r: 0.059, g: 0.063, b: 0.067}
});

// Step 4: Organize variables
await mcp__FigmaStudioMCP__reorder_variables({
  collection_id: "Theme",
  order: "standard"  // Uses standard organization
});
```

---

## Step 5: Fix Existing Theme Collection

### 5.1 Quick Method: One-Click Fix

**Best approach** - Let the tool handle everything:

```typescript
const result = await mcp__FigmaStudioMCP__fix_collection_to_standard({
  collection_id: "Theme",
  dry_run: false,  // Set true to preview changes first
  use_default_values: true,  // Use reference theme colors for missing variables
  preserve_custom: false,  // Set true to keep non-standard variables
  add_chart_colors: false  // Set true if user wants chart colors
});
```

This automatically:
- ✅ Adds all missing variables
- ✅ Generates color scales using correct compositing
- ✅ Validates WCAG contrast
- ✅ Organizes variables in standard order
- ✅ Flags non-standard variables

### 5.2 Manual Fix Process

If you need control over the process:

```typescript
// Step 1: Audit existing collection
const audit = await mcp__FigmaStudioMCP__audit_collection({
  collection_id: "Theme"
});

// Step 2: Get missing variable suggestions
const suggestions = await mcp__FigmaStudioMCP__suggest_missing_variables({
  collection_id: "Theme",
  use_defaults: true
});

// Step 3: Create missing base colors
await mcp__FigmaStudioMCP__create_variables_batch({
  collection_id: "Theme",
  variables: suggestions.missing_base_colors
});

// Step 4: Create missing color scales
for (const color of suggestions.missing_scales) {
  await mcp__FigmaStudioMCP__create_color_scale_set({
    collection_id: "Theme",
    color_name: color.name,  // e.g., "primary"
    base_color: color.base,
    foreground_color: color.foreground,
    background_color: {r: 0.059, g: 0.063, b: 0.067}
  });
}

// Step 5: Organize
await mcp__FigmaStudioMCP__reorder_variables({
  collection_id: "Theme",
  order: "standard"
});
```

---

## Step 6: Validation After Creation/Fix

### 6.1 Audit Collection

```typescript
const audit = await mcp__FigmaStudioMCP__audit_collection({
  collection_id: "Theme",
  include_chart_colors: false  // Set based on user's request
});
```

### 6.2 Validate WCAG Contrast

```typescript
const contrastReport = await mcp__FigmaStudioMCP__validate_color_contrast({
  collection_id: "Theme",
  mode: "dark",
  standard: "AA"  // or "AAA"
});
```

This checks:
- ✅ All foreground variants have adequate contrast with their base colors
- ✅ Normal text: 4.5:1 minimum (AA) or 7:1 (AAA)
- ✅ Large text: 3:1 minimum (AA) or 4.5:1 (AAA)

### 6.3 Generate Audit Report

```typescript
const report = await mcp__FigmaStudioMCP__generate_audit_report({
  collection_id: "Theme",
  format: "markdown",  // or "json"
  include_chart_colors: false
});
```

---

## Step 7: Communication with User

### 7.1 Initial Response

When user requests theme variable creation/fixing:

```markdown
I'll help you create/fix the Theme variable collection in Figma using the FigmaStudioMCP MCP plugin.

First, let me audit your current variable collections to see what exists.
```

### 7.2 After Audit - No Theme Collection

```markdown
## Theme Variables Audit

I didn't find a "Theme" variable collection in your Figma file.

**Recommended Action**: Create new Theme collection with 102 standard variables

Would you like me to:
1. ✅ Create Theme collection with default dark theme colors (recommended)
2. Create Theme collection with custom brand colors (you provide colors)
3. Create minimal collection and let you customize colors manually

The default dark theme includes:
- 32 base semantic colors (background, primary, success, etc.)
- 70 color scale variants (computed automatically)
- WCAG AA compliant contrast ratios
```

### 7.3 After Audit - Existing Theme Collection

```markdown
## Theme Variables Audit Complete

Found Theme collection with [X] variables.

**Status**: [Complete/Incomplete]

### Issues Found

#### Missing Variables ([count])
- Base colors: [list]
- Foreground variants: [list]
- Color scales: [list by color]

#### Non-Standard Variables ([count])
- [variable-name]: [recommendation]

### Recommended Actions

I can automatically:
1. ✅ Add all [X] missing variables
2. ✅ Generate color scales using correct compositing
3. ✅ Validate WCAG contrast ratios
4. ✅ Organize variables in standard order

Would you like me to fix the collection now?
```

### 7.4 After Successful Creation/Fix

```markdown
## Theme Variables Created Successfully! ✨

**Collection**: Theme (dark mode)
**Total Variables**: 102

### Created Variables

#### Base Colors (32)
✅ Background & surface colors (6)
✅ Brand & hierarchy colors (8)
✅ State colors (8)
✅ Interactive colors (2)
✅ Overlay & feedback colors (5)
✅ Utility colors (7)

#### Color Scales (70)
✅ primary-50 through primary-900 (10 variables)
✅ secondary-50 through secondary-900 (10 variables)
✅ accent-50 through accent-900 (10 variables)
✅ success-50 through success-900 (10 variables)
✅ info-50 through info-900 (10 variables)
✅ warning-50 through warning-900 (10 variables)
✅ destructive-50 through destructive-900 (10 variables)

### WCAG Contrast Validation

✅ All foreground variants meet WCAG AA standards
- primary-foreground: 8.2:1 (AAA compliant)
- success-foreground: 5.1:1 (AA compliant)
- warning-foreground: 4.8:1 (AA compliant)
[... continue for all foreground colors ...]

### Next Steps

1. Start using variables in your designs
2. Customize colors if needed
3. Add chart colors (optional): Ask me to "add chart colors"
```

---

## Step 8: Color Scale Calculations

### Understanding Server-Side Calculations

The MCP plugin calculates color scales **server-side**, which means:
- ✅ You don't need to manually compute RGB values
- ✅ Calculations are mathematically correct
- ✅ All 70 scale variants created instantly
- ✅ Consistent with compositing formula

### Example: Calculate Single Color Scale

```typescript
const scale = await mcp__FigmaStudioMCP__calculate_color_scale({
  base_color: {r: 0.639, g: 0.902, b: 0.208},  // primary
  background_color: {r: 0.059, g: 0.063, b: 0.067},
  input_format: "normalized"  // or "rgb255"
});
```

Returns:
```json
{
  "50": {"r": 0.086, "g": 0.106, "b": 0.075},
  "100": {"r": 0.118, "g": 0.145, "b": 0.084},
  "200": {"r": 0.176, "g": 0.231, "b": 0.094},
  // ... through 900
}
```

### Example: Calculate Single Composite Color

```typescript
const color = await mcp__FigmaStudioMCP__calculate_composite_color({
  base_color: {r: 163, g: 230, b: 53},
  background_color: {r: 15, g: 16, b: 17},
  mix_percentage: 0.30,  // 30% for primary-300
  input_format: "rgb255"
});
```

Returns:
```json
{
  "r": 60,
  "g": 80,
  "b": 28,
  "normalized": {"r": 0.235, "g": 0.314, "b": 0.110}
}
```

---

## Step 9: Advanced Operations

### 9.1 Add Chart Colors

```typescript
await mcp__FigmaStudioMCP__add_chart_colors({
  collection_id: "Theme",
  chart_colors: [
    {r: 0.4, g: 0.6, b: 0.9},  // chart-1: blue
    {r: 0.9, g: 0.4, b: 0.4},  // chart-2: red
    {r: 0.4, g: 0.9, b: 0.5},  // chart-3: green
    // ... or omit to use default palette
  ]
});
```

### 9.2 Export Collection Schema

```typescript
const schema = await mcp__FigmaStudioMCP__export_collection_schema({
  collection_id: "Theme",
  mode: "dark",
  include_metadata: true
});

// Save to file or share with team
```

### 9.3 Import Collection Schema

```typescript
await mcp__FigmaStudioMCP__import_collection_schema({
  collection_id: "Theme",
  schema: importedSchema,
  overwrite_existing: false
});
```

### 9.4 Calculate Contrast Ratio

```typescript
const ratio = await mcp__FigmaStudioMCP__calculate_contrast_ratio({
  foreground: {r: 0.980, g: 0.980, b: 0.980},  // foreground
  background: {r: 0.639, g: 0.902, b: 0.208},  // primary
  input_format: "normalized"
});

// Returns: {"ratio": 8.24, "passes_aa": true, "passes_aaa": true}
```

---

## Step 10: Error Handling & Edge Cases

### 10.1 Collection Already Exists

If user asks to create Theme but it already exists:

```markdown
⚠️ A "Theme" collection already exists in your Figma file.

Would you like me to:
1. Fix existing collection (recommended)
2. Delete and recreate from scratch
3. Create with a different name (e.g., "Theme-v2")
```

### 10.2 Non-Standard Variables Found

When fixing, if non-standard variables exist:

```markdown
### Non-Standard Variables Found

I found [X] variables that don't match the standard schema:

- `error` → Rename to `destructive` (standard name)
- `danger` → Rename to `destructive` (standard name)
- `custom-brand-blue` → Keep as custom (not in standard)

Recommendations:
✅ Rename: error → destructive
✅ Rename: danger → destructive
⚠️ Keep: custom-brand-blue (mark as non-standard)

Should I proceed with these changes?
```

### 10.3 Contrast Ratio Failures

If WCAG validation fails:

```markdown
⚠️ WCAG Contrast Issues Found

The following foreground/background pairs don't meet WCAG AA standards:

- warning-foreground on warning: 3.2:1 (needs 4.5:1)
  Recommendation: Darken warning-foreground or lighten warning

- info-foreground on info: 2.8:1 (needs 4.5:1)
  Recommendation: Use lighter blue for info-foreground

Should I automatically fix these contrast issues?
```

---

## Step 11: Decision Tree

```
User requests theme variables
    ↓
Get variable collections
    ↓
Check for "Theme" collection
    ↓
┌──────────────────┬──────────────────┐
│                  │                  │
Not found         Found              │
│                  │                  │
↓                  ↓                  ↓
Create new      Audit existing    Other names exist
    │                  │                  │
    ↓                  ↓                  ↓
Ask user:       Analyze issues    Ask to create
- Default       - Missing vars         "Theme"
- Custom        - Non-standard         or rename
- Manual        - Contrast                │
    │                  │                  │
    └──────────────────┴──────────────────┘
                      ↓
              Execute operations
                      ↓
              Validate & report
```

---

## Step 12: Key Agent Behaviors

### ✅ DO:

1. **Always audit first** before making changes
2. **Use bulk operations** when possible (`fix_collection_to_standard`, `create_all_scales`)
3. **Validate WCAG contrast** after creation/fixes
4. **Provide clear reports** with counts and categorization
5. **Ask for confirmation** before deleting variables
6. **Explain compositing** - These are solid colors, not transparent
7. **Use server-side calculations** for color scales

### ❌ DON'T:

1. **Don't manually calculate RGB values** - Use MCP tools
2. **Don't skip contrast validation** - Always check WCAG
3. **Don't create transparent scale variants** - They must be solid (alpha = 1.0)
4. **Don't assume user wants chart colors** - Ask first
5. **Don't delete non-standard variables** without user confirmation
6. **Don't use incorrect compositing** - Always use the formula

---

## Step 13: Default Color Values Reference

### Default Dark Theme Colors (Normalized RGB)

For `apply_default_theme` or when user asks for recommended colors:

```typescript
{
  // Background & Surface
  background: {r: 0.059, g: 0.063, b: 0.067},      // #0F1011
  foreground: {r: 0.980, g: 0.980, b: 0.980},      // #FAFAFA
  card: {r: 0.102, g: 0.106, b: 0.110},            // #1A1B1C
  "card-foreground": {r: 0.980, g: 0.980, b: 0.980},
  popover: {r: 0.059, g: 0.063, b: 0.067},
  "popover-foreground": {r: 0.980, g: 0.980, b: 0.980},

  // Brand & Hierarchy
  primary: {r: 0.639, g: 0.902, b: 0.208},         // #A3E635 (Lime green)
  "primary-foreground": {r: 0.134, g: 0.000, b: 0.085},
  secondary: {r: 0.149, g: 0.153, b: 0.153},       // #262727
  "secondary-foreground": {r: 0.980, g: 0.980, b: 0.980},
  tertiary: {r: 0.200, g: 0.204, b: 0.208},
  "tertiary-foreground": {r: 0.639, g: 0.643, b: 0.643},
  accent: {r: 0.149, g: 0.153, b: 0.153},
  "accent-foreground": {r: 0.639, g: 0.902, b: 0.208},

  // State Colors
  success: {r: 0.078, g: 0.325, b: 0.176},         // #14532D (Dark green)
  "success-foreground": {r: 0.290, g: 0.871, b: 0.502},
  info: {r: 0.118, g: 0.251, b: 0.686},            // #1E40AF (Blue)
  "info-foreground": {r: 0.576, g: 0.773, b: 0.992},
  warning: {r: 0.863, g: 0.696, b: 0.149},         // #DCB226 (Yellow)
  "warning-foreground": {r: 0.980, g: 0.980, b: 0.980},
  destructive: {r: 0.863, g: 0.149, b: 0.149},     // #DC2626 (Red)
  "destructive-foreground": {r: 0.980, g: 0.980, b: 0.980},

  // Interactive
  link: {r: 0.639, g: 0.902, b: 0.208},
  "link-hover": {r: 0.729, g: 0.961, b: 0.400},

  // Overlay & Feedback
  overlay: {r: 0.059, g: 0.063, b: 0.067, a: 0.8},  // 80% opacity
  tooltip: {r: 0.149, g: 0.153, b: 0.153},
  "tooltip-foreground": {r: 0.980, g: 0.980, b: 0.980},
  placeholder: {r: 0.149, g: 0.153, b: 0.153},
  "placeholder-foreground": {r: 0.499, g: 0.503, b: 0.507},

  // Utility
  border: {r: 0.200, g: 0.204, b: 0.208},
  input: {r: 0.200, g: 0.204, b: 0.208},
  ring: {r: 0.639, g: 0.902, b: 0.208},
  muted: {r: 0.149, g: 0.153, b: 0.153},
  "muted-foreground": {r: 0.499, g: 0.503, b: 0.507},
  selected: {r: 0.129, g: 0.165, b: 0.082},
  "selected-foreground": {r: 0.639, g: 0.902, b: 0.208}
}
```

**Note**: All color scale variants (-50 to -900) are **calculated automatically** by the MCP tools.

---

## Step 14: WCAG Accessibility Requirements

### Contrast Ratios

**Normal Text (< 18px or < 14px bold):**
- AA: 4.5:1 minimum
- AAA: 7:1 minimum

**Large Text (≥ 18px or ≥ 14px bold):**
- AA: 3:1 minimum
- AAA: 4.5:1 minimum

### Validation

Always validate after creating foreground variants:

```typescript
const validation = await mcp__FigmaStudioMCP__validate_color_contrast({
  collection_id: "Theme",
  mode: "dark",
  standard: "AA"
});

if (validation.failures.length > 0) {
  // Report failures to user
  // Offer to auto-fix
}
```

---

## Step 15: Quick Reference Commands

### Create New Theme (One Command)
```typescript
await mcp__FigmaStudioMCP__apply_default_theme({
  collection_id: "Theme"  // Creates if doesn't exist
});
```

### Fix Existing Theme (One Command)
```typescript
await mcp__FigmaStudioMCP__fix_collection_to_standard({
  collection_id: "Theme"
});
```

### Audit Only (No Changes)
```typescript
await mcp__FigmaStudioMCP__generate_audit_report({
  collection_id: "Theme",
  format: "markdown"
});
```

### Add Chart Colors
```typescript
await mcp__FigmaStudioMCP__add_chart_colors({
  collection_id: "Theme"
});
```

---

## Summary: Standard Theme System

```
Theme Collection (dark mode)
│
├── Base Colors (32 variables)
│   ├── Background & Surface (6)
│   ├── Brand & Hierarchy (8)
│   ├── State Colors (8)
│   ├── Interactive (2)
│   ├── Overlay & Feedback (5)
│   └── Utility (7)
│
├── Color Scales (70 variables)
│   ├── primary-50 → primary-900 (10)
│   ├── secondary-50 → secondary-900 (10)
│   ├── accent-50 → accent-900 (10)
│   ├── success-50 → success-900 (10)
│   ├── info-50 → info-900 (10)
│   ├── warning-50 → warning-900 (10)
│   └── destructive-50 → destructive-900 (10)
│
└── Chart Colors (8 variables, optional)
    └── chart-1 → chart-8

Total: 102 variables (110 with chart colors)
```

---

**Version**: 2.0 (Agent Instructions)
**Updated**: 2025-11-20
**For**: Claude Code Agent using FigmaStudioMCP MCP
**Plugin**: FigmaStudioMCP (WebSocket port 3000)

**Key Capabilities**:
- ✅ Fully automated variable creation
- ✅ Server-side color scale calculations
- ✅ WCAG contrast validation
- ✅ One-click fixes with `fix_collection_to_standard`
- ✅ Comprehensive audit and reporting
- ✅ Export/import for version control
