<img src="images/claude-figma-mcp-icon.png" alt="Claude Figma MCP" width="80" />

# Claude Figma MCP

AI-powered design tool that enables Claude Desktop and other AI tools (GitHub Copilot, Cursor, etc.) to interact directly with Figma, enabling powerful AI-assisted design capabilities.

## Installation

### Prerequisites

- [Figma Desktop](https://www.figma.com/downloads/)
- [Claude Desktop](https://claude.ai/download), [Claude Code](https://docs.anthropic.com/en/docs/claude-code), or [Cursor](https://cursor.com/downloads)

### Step 1: Install Figma Plugin

1. Open Figma Desktop
2. Go to **Menu → Plugins → Development → Import plugin from manifest...**
3. Navigate to `src/claude_mcp_plugin/manifest.json` in this project and select it

### Step 2: Configure MCP

#### Option A: Using npx (Recommended)

No need to clone or build - just configure your AI client to use npx:

**Claude Code**:
```bash
claude mcp add claude-figma-mcp -s user -- npx -y claude-figma-mcp
```

**Claude Desktop** (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "ClaudeFigmaMCP": {
      "command": "npx",
      "args": ["-y", "claude-figma-mcp"]
    }
  }
}
```

**Cursor** (Settings → Tools & Integrations → New MCP Server):
```json
{
  "mcpServers": {
    "ClaudeFigmaMCP": {
      "command": "npx",
      "args": ["-y", "claude-figma-mcp"]
    }
  }
}
```

#### Option B: From Source

Clone and build the project, then point to the local build:

```bash
git clone https://github.com/rintoj/claude-figma-mcp.git
cd claude-figma-mcp
bun install
bun run build
```

**Claude Code**:
```bash
claude mcp add claude-figma-mcp -s user -- node /ABSOLUTE/PATH/TO/claude-figma-mcp/dist/claude_figma_mcp/server.js
```

**Claude Desktop / Cursor**:
```json
{
  "mcpServers": {
    "ClaudeFigmaMCP": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/claude-figma-mcp/dist/claude_figma_mcp/server.js"]
    }
  }
}
```

> **Note**: Replace `/ABSOLUTE/PATH/TO/` with the actual path to where you cloned the repository.

### Step 3: Start the Socket Server

#### Option A: Auto-start on macOS (Recommended)

Install as a launchd service so the socket server starts automatically on login (shows as "Claude Figma MCP" in Login Items):

```bash
# Install the service (run from project root)
sed -e "s|\$PROJECT_PATH|$(pwd)|g" \
    -e "s|\$HOME|$HOME|g" \
    -e "s|\$BUN_PATH|$(which bun)|g" \
    scripts/com.claude-figma-mcp.socket.plist \
    > ~/Library/LaunchAgents/com.claude-figma-mcp.socket.plist

# Load and start
launchctl load ~/Library/LaunchAgents/com.claude-figma-mcp.socket.plist
```

#### Option B: Run Manually

```bash
bun run socket
```

### Step 4: Connect to Figma

1. In Figma, run the plugin: **Plugins → Development → Claude Figma MCP**
2. The plugin will display a **Channel ID**
3. Ask Claude to connect using this channel ID (e.g., "Connect to Figma channel abc123")

### Managing the Socket Server

The socket server runs on port 3055. Verify it's working at `http://localhost:3055/status`.

```bash
# Check status
launchctl list | grep claude-figma-mcp

# Stop the service
launchctl unload ~/Library/LaunchAgents/com.claude-figma-mcp.socket.plist

# Restart the service
launchctl unload ~/Library/LaunchAgents/com.claude-figma-mcp.socket.plist
launchctl load ~/Library/LaunchAgents/com.claude-figma-mcp.socket.plist

# View logs
tail -f ~/Library/Logs/claude-figma-mcp-socket.log
```

---

## 🚀 Core Concepts

### How It Works
```
Claude Desktop ↔ MCP Server ↔ WebSocket Server ↔ Figma Plugin
```

**Simple**: Claude sends design commands → Figma executes them in real-time  
**Bidirectional**: Get info from Figma, create/modify elements, manage components

### Key Capabilities
- **Document Interaction**: Analyze designs, get selections, export assets
- **Element Creation**: Shapes, text, frames with full styling control
- **Smart Modifications**: Colors, effects, auto-layout, responsive design
- **Text Mastery**: Advanced typography, font loading, text scanning
- **Component Integration**: Local and team library components
- **Design Systems**: Complete token management - colors, spacing, typography, border radius with Light/Dark modes

---

## 🛠️ Usage Patterns

### Getting Started with AI Design
1. **Make Claude a UX expert**: [Use this prompt](prompts/prompt-ux-ui-specialist.md) 🎨
2. **Connect to your project**: "Talk to Figma, channel {channel-ID}"
3. **Start designing**: "Create a mobile app login screen with modern styling"

### Effective Prompting Examples
```
✅ Good: "Create a dashboard with a sidebar navigation, header with user profile, and main content area with card-based metrics"

✅ Good: "Redesign this button component with hover states and better contrast ratios"

❌ Avoid: "Make it look nice" (too vague)
```

### Design System Quick Start
Initialize a complete design system in one command:
```
"Initialize a design system with 8pt spacing, major-third typography scale, and standard border radius. Include Light and Dark modes."
```

This creates:
- 🎨 **Colors**: Full primitive palette with Light/Dark modes
- 📏 **Spacing**: spacing.0, spacing.1, spacing.2... (8pt grid)
- 📝 **Typography**: Font sizes, weights, line heights, letter spacing
- 🔲 **Border Radius**: radius.none, radius.sm, radius.md, radius.lg...

Or create individual token systems:
```
"Add spacing tokens using the Tailwind 4pt grid"
"Create a perfect-fourth typography scale"
"Add bold border radius tokens"
```

Manage modes easily:
```
"Add a 'Brand' mode to the design tokens collection"
"Copy Light mode values to Dark mode with -20% brightness"
```

---

## 📚 Command Reference

### 📄 Document Tools
| Command | Purpose | Example Use |
|---------|---------|-------------|
| `get_document_info` | Document analysis | Get project overview |
| `get_selection` | Current selection | What's selected now |
| `read_my_design` | Detailed selection info | Deep inspection of selection |
| `get_node_info` | Element details (with optional `fields` param) | Inspect specific component |
| `get_nodes_info` | Multiple elements info (with optional `fields` param) | Batch element inspection |
| `set_focus` | Focus on node | Scroll viewport to element |
| `set_selections` | Select multiple nodes | Batch selection |
| `scan_text_nodes` | Find all text | Text audit and updates |
| `scan_nodes_by_types` | Find nodes by type | Filter by FRAME, COMPONENT, etc. |
| `get_styles` | Document styles | Color/text style audit |
| `get_variables` | Get all variables | Design token inspection |
| `get_bound_variables` | Get variable bindings | Check variable usage |
| `get_annotations` | Get annotations | Review design annotations |
| `set_annotation` | Create annotation | Add design notes |
| `set_multiple_annotations` | Batch annotations | Multi-element annotations |
| `join_channel` | Connect to Figma | Establish communication |
| `export_node_as_image` | Asset export | Generate design assets |

#### `get_node_info` / `get_nodes_info` Fields Parameter

These tools support an optional `fields` parameter to reduce response size by selecting only needed properties:

**Default fields** (when `fields` not specified): `id`, `name`, `type`, `fills`, `strokes`, `cornerRadius`, `absoluteBoundingBox`, `characters`, `style`

**Available fields**: `id`, `name`, `type`, `fills`, `strokes`, `cornerRadius`, `absoluteBoundingBox`, `characters`, `style`, `children`, `effects`, `opacity`, `blendMode`, `constraints`, `layoutMode`, `padding`, `itemSpacing`, `componentProperties`

**Example**: `get_node_info({ nodeId: "123", fields: ["id", "name", "type"] })` - returns minimal response

### 🔧 Creation Tools
| Command | Purpose | Example Use |
|---------|---------|-------------|
| `create_rectangle` | Basic shapes | Buttons, backgrounds |
| `create_frame` | Layout containers | Page sections, cards |
| `create_text` | Text elements | Headlines, labels |
| `create_ellipse` | Circles/ovals | Profile pics, icons |
| `create_polygon` | Multi-sided shapes | Custom geometric elements |
| `create_star` | Star shapes | Decorative elements |
| `create_svg` | Insert SVG markup | Icons, vector graphics |
| `clone_node` | Duplicate elements | Copy existing designs |
| `group_nodes` | Organize elements | Component grouping |
| `ungroup_nodes` | Separate groups | Break apart components |
| `insert_child` | Nest elements | Hierarchical structure |
| `flatten_node` | Vector operations | Boolean operations |

### ✏️ Modification Tools
| Command | Purpose | Example Use |
|---------|---------|-------------|
| `set_fill_color` | Element colors | Brand color application |
| `set_stroke_color` | Border colors | Outline styling |
| `move_node` | Positioning | Layout adjustments |
| `resize_node` | Size changes | Responsive scaling |
| `delete_node` | Remove elements | Clean up designs |
| `delete_multiple_nodes` | Batch delete | Remove multiple elements |
| `set_corner_radius` | Rounded corners | Modern UI styling |
| `set_auto_layout` | Flexbox-like layout | Component spacing |
| `set_layout_mode` | Layout direction | Set HORIZONTAL/VERTICAL |
| `set_padding` | Frame padding | Auto-layout spacing |
| `set_axis_align` | Axis alignment | Primary/counter alignment |
| `set_layout_sizing` | Sizing mode | HUG/FILL/FIXED |
| `set_item_spacing` | Item spacing | Gap between children |
| `set_effects` | Shadows/blurs | Visual polish |
| `set_effect_style_id` | Apply effect styles | Consistent shadow styles |
| `bind_variable` | Bind variable | Connect design tokens |
| `unbind_variable` | Unbind variable | Remove token binding |
| `rename_node` | Rename elements | Organize layer names |
| `set_image_fill` | Set image from URL | Fill shapes with images from URLs (see [allowed domains](#image-fill-domains)) |

### 📝 Text Tools
| Command | Purpose | Example Use |
|---------|---------|-------------|
| `set_text_content` | Text updates | Copy changes |
| `set_multiple_text_contents` | Batch text updates | Multi-element editing |
| `set_font_name` | Typography | Brand font application |
| `set_font_size` | Text sizing | Hierarchy creation |
| `set_font_weight` | Text weight | Bold/light variations |
| `set_letter_spacing` | Character spacing | Typography fine-tuning |
| `set_line_height` | Vertical spacing | Text readability |
| `set_paragraph_spacing` | Paragraph gaps | Content structure |
| `set_text_case` | Case transformation | UPPER/lower/Title case |
| `set_text_decoration` | Text styling | Underline/strikethrough |
| `get_styled_text_segments` | Text analysis | Rich text inspection |
| `load_font_async` | Font loading | Custom font access |
| `create_text_style` | Create text style from node | Build typography system |
| `create_text_style_from_properties` | Create text style from properties | Define typography manually |
| `apply_text_style` | Apply text style to node | Consistent typography |

### 🎨 Component Tools
| Command | Purpose | Example Use |
|---------|---------|-------------|
| `get_local_components` | Project components | Design system audit |
| `get_remote_components` | Team libraries | Shared component access |
| `create_component_instance` | Use components | Consistent UI elements |
| `create_component` | Convert to component | Create reusable elements |
| `create_component_set` | Create variants | Build component systems |
| `detach_instance` | Detach instance | Convert to editable frame |
| `get_instance_overrides` | Get overrides | Inspect instance changes |
| `set_instance_overrides` | Apply overrides | Copy overrides to instances |
| `add_component_property` | Add property | Create boolean/text/instance swap properties |
| `edit_component_property` | Edit property | Update name, default value |
| `delete_component_property` | Delete property | Remove component properties |
| `set_component_property_references` | Link property to node | Control visibility with boolean properties |
| `get_component_properties` | Get all properties | Inspect component property definitions |

### 🔗 Prototyping Tools
| Command | Purpose | Example Use |
|---------|---------|-------------|
| `get_reactions` | Get prototype reactions | Inspect interactions |
| `set_default_connector` | Set connector style | Default connection style |
| `create_connections` | Create connections | Link nodes with connectors |

### 🎨 Design System & Variable Tools

#### Collection Management
| Command | Purpose | Example Use |
|---------|---------|-------------|
| `get_variable_collections` | List all collections | Audit design tokens |
| `create_variable_collection` | Create new collection | Set up theme system |
| `get_collection_info` | Get collection metadata | Inspect collection details |

#### Variable CRUD
| Command | Purpose | Example Use |
|---------|---------|-------------|
| `create_variable` | Create single variable | Add token (COLOR/FLOAT/STRING/BOOLEAN) |
| `create_variables_batch` | Bulk variable creation | Set up multiple tokens |
| `update_variable_value` | Update variable value | Change token value |
| `rename_variable` | Rename variable | Refactor token names |
| `delete_variable` | Delete single variable | Remove unused token |
| `delete_variables_batch` | Bulk variable deletion | Clean up tokens |

#### Mode Management
| Command | Purpose | Example Use |
|---------|---------|-------------|
| `add_mode_to_collection` | Add new mode | Create Light/Dark/Brand modes |
| `rename_mode` | Rename mode | Update mode names |
| `delete_mode` | Delete mode | Remove unused modes |
| `duplicate_mode_values` | Copy mode values | Auto-generate dark mode |

#### Token Systems
| Command | Purpose | Example Use |
|---------|---------|-------------|
| `create_spacing_system` | Create spacing tokens | 8pt/4pt grid systems |
| `create_typography_system` | Create typography tokens | Font sizes, weights, line heights |
| `create_radius_system` | Create radius tokens | Border radius scales |
| `create_complete_design_system` | Initialize full design system | Complete tokens in one command |

#### Color Calculations (Server-side)
| Command | Purpose | Example Use |
|---------|---------|-------------|
| `calculate_color_scale` | Generate 10-level color scale | Create color variants |
| `calculate_composite_color` | Color compositing | Blend colors |
| `convert_color_format` | Format conversion | hex/rgb/normalized |
| `calculate_contrast_ratio` | WCAG contrast check | Accessibility validation |

#### Schema & Validation
| Command | Purpose | Example Use |
|---------|---------|-------------|
| `audit_collection` | Compare against standard | Validate token structure |
| `validate_color_contrast` | WCAG AA/AAA validation | Check accessibility |
| `get_schema_definition` | Get standard schema | Reference theme structure |
| `suggest_missing_variables` | Get recommendations | Find missing tokens |

#### Templates & Presets
| Command | Purpose | Example Use |
|---------|---------|-------------|
| `apply_default_theme` | Apply reference theme | Quick theme setup |
| `create_color_scale_set` | Create color family | Build color system |
| `apply_custom_palette` | Apply brand colors | Customize theme |

#### Organization & Export
| Command | Purpose | Example Use |
|---------|---------|-------------|
| `reorder_variables` | Organize variables | Standard ordering |
| `generate_audit_report` | Generate report | Markdown/JSON export |
| `export_collection_schema` | Export as JSON | Backup/share tokens |
| `import_collection_schema` | Import from JSON | Restore/import tokens |

#### Bulk Operations
| Command | Purpose | Example Use |
|---------|---------|-------------|
| `create_all_scales` | Create all 7 color scales | Full color system |
| `fix_collection_to_standard` | Auto-fix compliance | Bring to 102-variable standard |
| `add_chart_colors` | Add 8 chart colors | Data visualization palette |

---

### Building DXT Package (Developers)

To create your own DXT package:
```bash
npm run build:dxt    # Builds TypeScript and packages DXT
```
This creates `claude-figma-mcp.dxt` ready for distribution.

---

## 🧪 Testing & Quality Assurance

### Automated Testing
```bash
bun run test            # Run all tests
bun run test:watch      # Watch mode
bun run test:coverage   # Coverage report
```

### Integration Testing
```bash
bun run test:integration  # Guided end-to-end testing
```

### Manual Verification Checklist
- [ ] WebSocket server starts on port 3055
- [ ] Figma plugin connects and generates channel ID
- [ ] AI tool recognizes "ClaudeFigmaMCP" MCP (Claude Desktop, Cursor, etc.)
- [ ] Basic commands execute (create rectangle, change color)
- [ ] Error handling works (invalid commands, timeouts)
- [ ] Channel communication works between AI tool and Figma

---

## 🐛 Troubleshooting & Support

### Connection Issues
- **"Can't connect to WebSocket"**: Ensure `bun socket` is running
- **"Plugin not found"**: Verify plugin import in Figma Development settings
- **"MCP not available"**: 
  - Claude Desktop: Run `bun run configure-claude` and restart Claude
  - Cursor IDE: Check MCP configuration in `mcp.json` file
  - Other AI tools: Verify MCP integration settings

### Execution Problems
- **"Command failed"**: Check Figma development console for errors
- **"Font not found"**: Use `load_font_async` to verify font availability
- **"Permission denied"**: Ensure you have edit access to the Figma document
- **"Timeout errors"**: Complex operations may need retry

### Image Fill Domains

The `set_image_fill` tool can only load images from allowed domains due to Figma plugin CORS restrictions. Currently supported domains:
- `images.unsplash.com`
- `picsum.photos`

If you need to use images from other sources, download them first and host on an allowed domain, or modify the plugin's `manifest.json` to add your domain to `networkAccess.allowedDomains`.

### Performance Issues
- **Slow responses**: Large documents may require more processing time
- **Memory usage**: Close unused Figma tabs, restart if necessary
- **WebSocket disconnects**: Server auto-reconnects, restart if persistent

### Common Solutions
1. **Restart sequence**: Stop server → Close AI tool → Restart both
2. **Clean reinstall**: Delete `node_modules` → `bun install` → `bun run build`
3. **Check logs**: Server terminal shows detailed error messages
4. **Update fonts**: Some team fonts require manual loading in Figma
5. **Configuration check**: Verify MCP setup in your AI tool's settings
6. **Port conflicts**: Ensure port 3055 is not used by other applications

---

## 🏗️ Advanced Topics

### Architecture Deep Dive

```
+----------------+     +-------+     +---------------+     +---------------+
|                |     |       |     |               |     |               |
| Claude Desktop |<--->|  MCP  |<--->| WebSocket Srv |<--->| Figma Plugin  |
|   (AI Agent)   |     |       |     |  (Port 3055)  |     |  (UI Plugin)  |
|                |     |       |     |               |     |               |
+----------------+     +-------+     +---------------+     +---------------+
```

**Design Principles**:
- **MCP Server**: Business logic, validation, default values
- **WebSocket Server**: Message routing and protocol translation  
- **Figma Plugin**: Pure command executor in Figma context

**Benefits**:
- Clear separation of concerns
- Easy testing and maintenance
- Scalable architecture for additional tools

### Project Structure
```
src/
  claude_figma_mcp/     # MCP Server implementation
    server.ts            # Main entry point
    tools/               # Tool categories by function
      document-tools.ts  # Document interaction
      creation-tools.ts  # Shape and element creation
      modification-tools.ts # Property modification
      text-tools.ts      # Text manipulation
    utils/               # Shared utilities
    types/               # TypeScript definitions
  claude_mcp_plugin/     # Figma plugin
    code.js              # Plugin implementation
    manifest.json        # Plugin configuration
```

### Contributing Guidelines

1. **Fork and Branch**: `git checkout -b feature/amazing-feature`
2. **Code Standards**: Follow existing TypeScript patterns
3. **Testing**: Add tests for new functionality
4. **Documentation**: Update relevant sections
5. **Pull Request**: Clear description of changes

---

## 📋 Version History

### Current: 0.9.0
- **🎨 Component Properties**: 5 new tools for managing component properties
  - `add_component_property`: Create BOOLEAN, TEXT, INSTANCE_SWAP, or VARIANT properties
  - `edit_component_property`: Update property name, default value, or preferred values
  - `delete_component_property`: Remove component properties
  - `set_component_property_references`: Link properties to child nodes (visibility, text, instance swap)
  - `get_component_properties`: Inspect all component property definitions
- **🖼️ Image Fill**: New `set_image_fill` tool to set image fills from URLs (PNG, JPEG, GIF)
  - Supports scale modes: FILL, FIT, CROP, TILE
  - Image filters: exposure, contrast, saturation, temperature, tint, highlights, shadows
- **🐛 Bug Fixes**:
  - Fixed `apply_text_style` timeout when text nodes have mixed fonts
  - Improved error handling with detailed logging

### Previous: 0.8.0
- **🔍 Node Info Optimization**: Added `fields` parameter to `get_node_info` and `get_nodes_info` tools
  - Significantly reduces response size by selecting only needed properties
  - Default fields: `id`, `name`, `type`, `fills`, `strokes`, `cornerRadius`, `absoluteBoundingBox`, `characters`, `style`
  - Additional fields available: `children`, `effects`, `opacity`, `blendMode`, `constraints`, `layoutMode`, `padding`, `itemSpacing`, `componentProperties`
- **🎨 27 Variable Management Tools**: Complete theme variable system
  - Collection management: `get_variable_collections`, `create_variable_collection`, `get_collection_info`
  - Variable CRUD: `create_variable`, `create_variables_batch`, `update_variable_value`, `rename_variable`, `delete_variable`, `delete_variables_batch`
  - Color calculations (server-side): `calculate_color_scale`, `calculate_composite_color`, `convert_color_format`, `calculate_contrast_ratio`
  - Schema validation: `audit_collection`, `validate_color_contrast`, `get_schema_definition`, `suggest_missing_variables`
  - Templates: `apply_default_theme`, `create_color_scale_set`, `apply_custom_palette`
  - Organization: `reorder_variables`, `generate_audit_report`, `export_collection_schema`, `import_collection_schema`
  - Bulk operations: `create_all_scales`, `fix_collection_to_standard`, `add_chart_colors`
- **📚 Documentation**: Updated command reference with all tools

### Previous: 0.7.0
- **🆕 18 New Tools**: Added comprehensive set of tools
  - **Document Tools**: `read_my_design`, `set_focus`, `set_selections`, `get_annotations`, `set_annotation`, `set_multiple_annotations`, `scan_nodes_by_types`
  - **Layout Tools**: `set_layout_mode`, `set_padding`, `set_axis_align`, `set_layout_sizing`, `set_item_spacing`, `delete_multiple_nodes`
  - **Prototyping Tools**: `get_reactions`, `set_default_connector`, `create_connections`
  - **Component Tools**: `get_instance_overrides`, `set_instance_overrides`
- **🔧 WebSocket Fix**: Fixed broadcast logic to prevent message routing issues
- **🧪 Test Coverage**: Added comprehensive tests for all new tools (168 total tests)

### Previous: 0.6.2
- **🎨 Component Management**: New tools for component workflow - `create_component`, `create_component_set`, `detach_instance`
- **✏️ Rename Tool**: New `rename_node` tool for organizing layer names
- **🔧 Dependency Update**: Updated Zod to 3.25.x for MCP SDK compatibility

### Previous: 0.6.1
- **🔧 Tool Fix**: The `set_stroke_color` tool now correctly accepts a `strokeWeight` of `0` for creating invisible strokes.

### Previous: 0.6.0
- **🚀 DXT Package Support**: one-click installation via Claude Desktop's extension manager
- **📦 Automated Distribution**: GitHub Actions workflow for automatic DXT package generation and release uploads
- **⚡ Enhanced UX**: Installation time reduced from 15-30 minutes to 2-5 minutes for end users
- **🔧 Developer Tools**: New build scripts for DXT packaging (`npm run build:dxt`, `npm run pack`)

See [CHANGELOG.md](CHANGELOG.md) for complete version history.

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file
