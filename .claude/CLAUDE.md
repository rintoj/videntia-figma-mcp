# Claude Figma MCP - Project Guide

## Overview

This project provides a Model Context Protocol (MCP) server that enables Claude to interact with Figma through a comprehensive set of tools. It includes 80+ Figma commands covering node manipulation, components, text, variables, and theme management.

## Technology Stack

- **Runtime**: Bun (TypeScript runtime)
- **Language**: TypeScript 5.8+
- **Build Tool**: tsup
- **Testing**: Jest
- **MCP SDK**: @modelcontextprotocol/sdk v1.9.0

## Build Commands

Use **Bun** for all development commands:

```bash
# Development
bun run dev              # Watch mode with auto-rebuild
bun run build            # Production build
bun run build:watch      # Build in watch mode

# Testing
bun test                 # Run all tests
bun test --watch         # Watch mode
bun run test:coverage    # Generate coverage report

# Linting & Formatting
bun run lint             # Type-check + format check
bun run format           # Auto-fix formatting

# Running
bun run start            # Start MCP server
bun run socket           # Start WebSocket server
```

## Project Structure

```
src/
├── claude_figma_mcp/
│   ├── server.ts                    # MCP server entry point
│   ├── tools/
│   │   ├── variable-tools.ts        # Variable management (24 tools)
│   │   ├── document-tools.ts        # Document operations
│   │   ├── creation-tools.ts        # Node creation
│   │   ├── modification-tools.ts    # Node modification
│   │   ├── text-tools.ts            # Text operations
│   │   └── component-tools.ts       # Component operations
│   ├── utils/
│   │   ├── color-calculations.ts    # Color math & WCAG
│   │   ├── theme-schema.ts          # Theme schema definitions
│   │   ├── websocket.ts             # Figma plugin communication
│   │   └── figma-helpers.ts         # Helper functions
│   └── types/
│       └── index.ts                 # TypeScript definitions
├── claude_mcp_plugin/
│   └── code.js                      # Figma plugin code (4777 lines)
└── socket.ts                        # WebSocket server

tests/
├── integration/                     # Integration tests
│   └── variable-tools.test.ts       # Variable tools tests
└── unit/                            # Unit tests
    └── utils/                       # Utility tests
        ├── color-calculations.test.ts
        └── theme-schema.test.ts
```

## Variable Management Tools (New)

### Theme Variables System

The project implements a comprehensive theme variable management system with 106 standard variables:
- **36 base semantic colors** (surfaces, brand, states, interactive, feedback, utility)
- **70 color scale variants** (7 colors × 10 levels each)
- **8 optional chart colors**

### Tool Categories

**Collection Management (3 tools)**
- `get_variable_collections` - List all collections
- `create_variable_collection` - Create new collection
- `get_collection_info` - Get collection metadata

**Variable CRUD (6 tools)**
- `create_variable` - Create single variable
- `create_variables_batch` - Bulk creation
- `update_variable_value` - Update values
- `rename_variable` - Rename variables
- `delete_variable` - Delete single variable
- `delete_variables_batch` - Bulk deletion

**Color Calculations (4 tools - server-side)**
- `calculate_color_scale` - Generate 10-level scales
- `calculate_composite_color` - Color compositing
- `convert_color_format` - Format conversions
- `calculate_contrast_ratio` - WCAG validation

**Schema Validation (4 tools)**
- `audit_collection` - Compare against standard
- `validate_color_contrast` - WCAG AA/AAA checks
- `get_schema_definition` - Get schema
- `suggest_missing_variables` - Get recommendations

**Templates & Presets (3 tools)**
- `apply_default_theme` - Apply reference theme
- `create_color_scale_set` - Create color families
- `apply_custom_palette` - Apply brand colors

**Organization (4 tools)**
- `reorder_variables` - Organize variables
- `generate_audit_report` - Generate reports
- `export_collection_schema` - Export JSON
- `import_collection_schema` - Import JSON

**Bulk Operations (3 tools)**
- `create_all_scales` - Create all 7 scales
- `fix_collection_to_standard` - Auto-fix compliance
- `add_chart_colors` - Add chart colors

## Color Input Formats

All color tools (`set_fill_color`, `set_stroke_color`) accept colors in two formats:

1. **Hex string** (preferred for batch operations):
   - `"#ff0000"` — 6-digit hex
   - `"#f00"` — 3-digit shorthand
   - `"#ff000080"` — 8-digit hex with alpha
   - `"#f008"` — 4-digit shorthand with alpha

2. **RGBA components** (0–1 normalized):
   - `{ r: 1, g: 0, b: 0, a: 1 }`

Both formats work with `batch_actions` — pass `{ color: "#ff0000" }` or `{ r: 1, g: 0, b: 0, a: 1 }`.

The `export_node_as_image` format parameter accepts both lowercase and uppercase (e.g. `"png"` or `"PNG"`).

## Color Scale Algorithm

The project uses a **composite blending** approach for color scales:

```
Formula: resultant RGB = (base × mix%) + (background × (1 - mix%))

Mix percentages:
  50:  5%    (closest to background)
  100: 10%
  200: 20%
  300: 30%
  400: 40%
  500: 50%   (halfway blend)
  600: 60%
  700: 70%
  800: 80%
  900: 90%   (closest to base)
```

## WCAG Contrast Standards

Built-in accessibility validation:
- **AA Normal**: 4.5:1 minimum
- **AA Large**: 3:1 minimum
- **AAA Normal**: 7:1 minimum
- **AAA Large**: 4.5:1 minimum

## Development Guidelines

### Adding New MCP Tools

1. **Define tool in appropriate file** (`src/claude_figma_mcp/tools/*.ts`)
```typescript
server.tool(
  "tool_name",
  "Description",
  {
    param: z.string().describe("Parameter description")
  },
  async ({ param }) => {
    const result = await sendCommandToFigma("tool_name", { param });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);
```

2. **Add Figma plugin handler** (`src/claude_mcp_plugin/code.js`)
```javascript
case "tool_name":
  return await toolNameHandler(params);
```

3. **Update type definitions** (`src/claude_figma_mcp/types/index.ts`)
```typescript
export type FigmaCommand =
  | "existing_command"
  | "tool_name";  // Add new command
```

4. **Add to `ALLOWED_COMMANDS`** (`src/claude_mcp_plugin/ui/constants.ts`) — the UI allowlist that gates which commands can be sent to the plugin. Without this, the command is blocked with "Command not permitted".

5. **Add to `READONLY_COMMANDS`** (`src/claude_mcp_plugin/index.ts`) — if the tool is read-only (does not modify design data). Without this, the command is blocked when readonly mode is active.

6. **Write tests** (`tests/integration/`)
```typescript
describe("tool_name", () => {
  it("successfully performs operation", async () => {
    const response = await callTool("tool_name", { param: "value" });
    expect(response.content[0].text).toContain("expected");
  });
});
```

### Testing Strategy

- **Integration tests**: Mock `sendCommandToFigma`, test MCP tool interface
- **Unit tests**: Test utility functions, color calculations, schema validation
- **Coverage target**: Aim for >80% coverage

### Code Style

- Use TypeScript strict mode
- Prefer async/await over promises
- Use Zod for parameter validation
- Include JSDoc comments for public APIs
- Follow existing naming conventions:
  - MCP tools: `snake_case`
  - TypeScript: `camelCase`
  - Types/Interfaces: `PascalCase`

## WebSocket Communication

The MCP server communicates with the Figma plugin via WebSocket:

```
MCP Server (port 3000) ←→ WebSocket ←→ Figma Plugin
```

**Message Format:**
```typescript
{
  id: string;           // Request ID
  command: string;      // Command name
  params: any;          // Command parameters
}
```

**Response Format:**
```typescript
{
  id: string;           // Matches request ID
  result?: any;         // Success result
  error?: string;       // Error message
}
```

## Documentation

- **API Spec**: `docs/figma-theme-variables-mcp-tools.md` - Complete tool specifications
- **Theme Guide**: `docs/figma-theme-variables-guide.md` - Theme system documentation
- **Instructions**: `docs/figma-theme-variables-instructions.md` - Implementation guide

## Common Tasks

### Build and Test
```bash
# Full build and test cycle
bun run build && bun test

# Watch mode for development
bun run dev    # Terminal 1
bun test --watch  # Terminal 2
```

### Deploy
```bash
# Build for production
bun run build

# Package for distribution
bun run build:dxt

# Publish to npm
bun run pub:release
```

### After Merging to Main

After every merge to `main`, **switch to main, pull the latest, build, and deploy via Docker**:

```bash
git checkout main && git pull && bun run build && docker compose up --build -d
```

`bun run build` does two things:
1. **Regenerates `src/claude_mcp_plugin/code.js`** from the TypeScript source modules — this is what Figma loads.
2. **Rebuilds the MCP server** (`dist/`) — this is what Claude connects to.

`docker compose up --build -d` rebuilds the Docker image and restarts the socket server container in the background.

> **Reload in Figma:** After deploying, re-run the plugin in Figma (close and reopen from Plugins menu) to load the new `code.js`.

### Debug
```bash
# Run MCP server with logging
DEBUG=* bun run start

# Run socket server
bun run socket
```

## Troubleshooting

### Build Errors
- Ensure Bun is installed: `bun --version`
- Clear dist folder: `rm -rf dist && bun run build`
- Check TypeScript version: Should be 5.8+

### Test Failures
- Clear Jest cache: `bun test --clearCache`
- Run specific test: `bun test path/to/test.ts`
- Check mocks are properly configured

### WebSocket Issues
- Verify Figma plugin is loaded
- Check port 3000 is available
- Review WebSocket logs in browser console

## Performance Considerations

- **Batch operations**: Use `*_batch` tools for multiple items
- **Color calculations**: Performed server-side (no Figma API calls)
- **Schema validation**: Cached for performance
- **WebSocket**: Connection pooling and request deduplication

## Version History

### v0.7.0 (Current)
- ✨ Added 24 variable management tools
- ✨ Implemented color scale generation
- ✨ Added WCAG contrast validation
- ✨ Added schema validation and auditing
- ✨ 106-variable standard theme support
- ✅ 242 passing tests
- 📚 Comprehensive documentation

## Resources

- [MCP SDK Documentation](https://github.com/modelcontextprotocol/sdk)
- [Figma Plugin API](https://www.figma.com/plugin-docs/)
- [Bun Documentation](https://bun.sh/docs)
- [WCAG Contrast Guidelines](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)

## Contributing

When contributing new features:
1. Follow the existing code structure
2. Add comprehensive tests
3. Update type definitions
4. Document in CLAUDE.md
5. Use Bun for all commands
6. Ensure all tests pass: `bun test`
7. Build successfully: `bun run build`
