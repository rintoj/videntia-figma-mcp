# Figma Plugin TypeScript Migration

## Overview

The Figma plugin source (`src/claude_mcp_plugin/`) has been migrated from a single monolithic
`code.js` (9,912 lines, plain JavaScript) to a structured TypeScript module tree (28 files,
~13,300 lines of typed TypeScript).

Figma itself sees no change — `manifest.json` still points to `code.js`. The tsup IIFE build
step bundles all TypeScript modules into that single file at build time.

---

## Module Map

```
src/claude_mcp_plugin/
├── index.ts                       Entry point — plugin init, UI messaging, handleCommand dispatch
├── types.ts                       Shared TypeScript interfaces and types
│
├── utils/
│   ├── helpers.ts                 debugLog, sendProgressUpdate, generateCommandId, uniqBy, delay
│   ├── base64.ts                  customBase64Encode (for exportNodeAsImage)
│   ├── color.ts                   svgColorToFigmaRgb, colorDist, formatVariableValue
│   └── svg.ts                     parseSvgRootStroke, propagateStrokeToShapes
│
└── handlers/
    ├── batch.ts                   batchActions + resolveResultReferences ($result[N] refs)
    ├── document.ts                getDocumentInfo, getFileKey, getSelection, getNodeInfo, getNodesInfo
    ├── nodes.ts                   createRectangle, createFrame, moveNode, resizeNode, deleteNode,
    │                              deleteMultipleNodes, exportNodeAsImage, setCornerRadius, cloneNode,
    │                              groupNodes, ungroupNodes, flattenNode, renameNode, insertChild
    ├── fills.ts                   setFillColor, setStrokeColor, setImageFill, setGradientFill
    ├── shapes.ts                  createEllipse, createPolygon, createStar, createSvg,
    │                              createVector, createLine
    ├── icons.ts                   updateIcon
    ├── text.ts                    createText, setTextContent, scanTextNodes, setMultipleTextContents,
    │                              setAutoLayout, setFontName/Size/Weight, setLetterSpacing,
    │                              setLineHeight, setParagraphSpacing, setTextCase, setTextDecoration,
    │                              getStyledTextSegments, loadFontAsyncWrapper, createTextStyle,
    │                              createTextStyleFromProperties, applyTextStyle, getTextStyles,
    │                              deleteTextStyle, updateTextStyle
    ├── effects.ts                 setEffects, setEffectStyleId, createEffectStyle,
    │                              updateEffectStyle, deleteEffectStyle
    ├── components.ts              getStyles, getLocalComponents, getRemoteComponents,
    │                              createComponentInstance, detachInstance, createComponent,
    │                              createComponentSet, addComponentProperty, editComponentProperty,
    │                              deleteComponentProperty, setComponentPropertyReferences,
    │                              getComponentProperties
    ├── variables.ts               getVariables, getBoundVariables, bindVariable, unbindVariable,
    │                              full variable CRUD, collection management, audit/schema tools,
    │                              mode management (29 exported functions)
    ├── layout.ts                  createSpacingSystem, createTypographySystem, createRadiusSystem,
    │                              setLayoutMode, setPadding, setItemSpacing, setAxisAlign,
    │                              setLayoutSizing
    ├── selection.ts               setFocus, setSelections, readMyDesign, scanNodesByTypes
    ├── annotations.ts             getAnnotations, setAnnotation, setMultipleAnnotations,
    │                              annotation category CRUD
    ├── prototyping.ts             getReactions, setDefaultConnector, createConnections
    ├── pages.ts                   createPage, renamePage, deletePage
    ├── design-system.ts           createFromData, getDesignSystem, setupDesignSystem
    └── lint/
        ├── types.ts               ViolationSeverity, ViolationCategory, Violation, LintOptions,
        │                          LintResult, LintSummary, LintCategories, ActiveChecks,
        │                          ColorVarEntry, FloatVarEntry, LookupMaps
        ├── constants.ts           MAX_LINT_DEPTH, MAX_LINT_VIOLATIONS, COLOR_SEMANTIC_KEYWORDS,
        │                          FLOAT_SEMANTIC_KEYWORDS, DEVICE_SIZES, DIM_TOLERANCE
        ├── helpers.ts             isFillBound, isScalarBound, hasFillPaintStyle, hasTextStyle,
        │                          hasEffectStyle, isIconLike, isColorFill, colorDist,
        │                          isSemanticMatch, addViolation, buildLookupMaps
        ├── checks.ts              scanNode() — all 8 check categories
        ├── fix.ts                 findBestColorVar, findBestFloatVar, applyFixes
        └── index.ts               lintFrame() — orchestrator (entry point for lint_frame command)
```

---

## Build Configuration

### `tsconfig.plugin.json`

Dedicated TypeScript config for the Figma plugin source:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["ES2017"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["@figma/plugin-typings"]
  },
  "include": ["src/claude_mcp_plugin/**/*.ts"]
}
```

- **`target: ES2017`** — prevents `??` and `?.` from being emitted (Figma's older sandbox engine rejects them)
- **`types: [@figma/plugin-typings]`** — provides full Figma API autocomplete; `figma` is a global, no import required

### `tsup.config.ts` — Plugin entry

```typescript
{
  entry: { 'code': 'src/claude_mcp_plugin/index.ts' },
  outDir: 'src/claude_mcp_plugin',
  format: ['iife'],
  target: 'es2017',
  bundle: true,
  minify: true,
  sourcemap: false,
  splitting: false,
  clean: false,          // don't wipe manifest.json / ui.html
  tsconfig: 'tsconfig.plugin.json',
  outExtension: () => ({ js: '.js' }),
}
```

This outputs directly to `src/claude_mcp_plugin/code.js`, which is the file Figma loads via `manifest.json`. The TypeScript migration is complete and live.

---

## JS Compatibility Rules

**NEVER use these ES2020+ features in plugin TypeScript source** (Figma's sandbox engine rejects them):

| Feature | Wrong | Correct |
|---------|-------|---------|
| Nullish coalescing | `x ?? fallback` | `x !== null && x !== undefined ? x : fallback` |
| Optional chaining | `obj?.prop` | `obj !== null && obj !== undefined ? obj.prop : undefined` |
| Optional call | `fn?.()` | `fn !== null && fn !== undefined ? fn() : undefined` |

Note: TypeScript compiles these at `target: es2017` but **does not downlevel** `??` and `?.` — they pass through as-is.

To verify a file has no forbidden operators:
```bash
grep -n '\?\.' src/claude_mcp_plugin/**/*.ts
grep -n ' \?\? ' src/claude_mcp_plugin/**/*.ts
```

---

## How to Add a New Command

### Step 1: Choose the handler file

Add the function to the appropriate handler in `src/claude_mcp_plugin/handlers/`.

```typescript
// src/claude_mcp_plugin/handlers/nodes.ts (example)
export async function myNewCommand(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nodeId = params['nodeId'] as string;
  if (!nodeId) throw new Error('nodeId is required');

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error('Node not found: ' + nodeId);

  // ... implementation
  return { id: node.id, name: node.name };
}
```

### Step 2: Register in `index.ts`

Import the function at the top of `index.ts`:
```typescript
import { myNewCommand } from './handlers/nodes';
```

Add a case to the `handleCommand` switch:
```typescript
case 'my_new_command':
  return await myNewCommand(params);
```

### Step 3: Add to MCP server tools

Add the corresponding MCP tool in `src/claude_figma_mcp/tools/*.ts` (this is the MCP server side, separate from the plugin).

### Step 4: Update `FigmaCommand` type

Add the new command string to the union in `src/claude_figma_mcp/types/index.ts`.

### Step 5: Build and verify

```bash
bun tsc --noEmit -p tsconfig.plugin.json   # type-check plugin source
bun run build                               # full build
ls -lh src/claude_mcp_plugin/code.js  # verify output
```

---

## Build Commands

```bash
# Type-check plugin source only
bun tsc --noEmit -p tsconfig.plugin.json

# Full build (MCP server + plugin IIFE)
bun run build

# Verify plugin output
ls -lh src/claude_mcp_plugin/code.js
```

---

## Migration Status

The TypeScript migration is **complete**. The plugin builds directly to `src/claude_mcp_plugin/code.js`
(the file Figma loads via `manifest.json`). No further cutover steps are required.

To verify the plugin after any change:

```bash
bun tsc --noEmit -p tsconfig.plugin.json   # type-check plugin source (expect 0 errors)
bun run build                               # full build
ls -lh src/claude_mcp_plugin/code.js       # should be ~155 KB minified
```

Smoke test in Figma (load plugin, open DevTools, verify no JS errors):
- `get_document_info` — basic document read
- `bind_variable` — variable write operation
- `lint_frame` — full lint + fix pass
- `get_design_system` — large aggregation read

---

## File Size Reference

| File | Lines |
|------|-------|
| `handlers/text.ts` | 1,940 |
| `handlers/variables.ts` | 1,926 |
| `handlers/design-system.ts` | 1,479 |
| `handlers/nodes.ts` | 700 |
| `handlers/shapes.ts` | 662 |
| `handlers/components.ts` | 635 |
| `index.ts` | 553 |
| `handlers/selection.ts` | 530 |
| `handlers/effects.ts` | 475 |
| `handlers/lint/checks.ts` | 450 |
| **Total** | **~13,300** |

The original `code.js` was 9,912 lines. The TypeScript version is larger due to explicit types,
interface definitions, and more descriptive error handling.
