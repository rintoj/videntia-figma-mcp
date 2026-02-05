#!/bin/bash

set -e

echo "=== Claude Talk to Figma MCP Setup ==="
echo ""

# Detect package manager
if command -v bun &> /dev/null; then
    PACKAGE_MANAGER="bun"
    BUN_PATH="$(which bun)"
    echo "✓ Bun detected at $BUN_PATH"
else
    PACKAGE_MANAGER="npm"
    BUN_PATH=""
    echo "⚠ Bun not found, using npm instead"
fi

# Install dependencies
echo ""
echo "Installing dependencies..."
if [ "$PACKAGE_MANAGER" = "bun" ]; then
    bun install
else
    npm install
fi

# Build the project
echo ""
echo "Building project..."
if [ "$PACKAGE_MANAGER" = "bun" ]; then
    bun run build
else
    npm run build
fi

# Configure for Claude Desktop
echo ""
echo "Configuring for Claude Desktop..."
node scripts/configure-claude.js

echo ""
echo "✓ Installation completed!"

# macOS: Offer to install launchd service
if [[ "$OSTYPE" == "darwin"* ]]; then
    if [ -n "$BUN_PATH" ]; then
        echo ""
        read -p "Would you like to install the socket server as a launchd service (auto-starts on login)? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            PLIST_SRC="scripts/com.claude-talk-to-figma.socket.plist"
            PLIST_DEST="$HOME/Library/LaunchAgents/com.claude-talk-to-figma.socket.plist"
            PROJECT_PATH="$(pwd)"

            # Create plist with actual paths
            sed -e "s|\$PROJECT_PATH|$PROJECT_PATH|g" \
                -e "s|\$HOME|$HOME|g" \
                -e "s|\$BUN_PATH|$BUN_PATH|g" \
                "$PLIST_SRC" > "$PLIST_DEST"

            # Load the service
            launchctl unload "$PLIST_DEST" 2>/dev/null || true
            launchctl load "$PLIST_DEST"

            echo ""
            echo "✓ Launchd service installed and started!"
            echo "  The socket server will auto-start on login."
            echo "  Logs: ~/Library/Logs/claude-talk-to-figma-socket.log"
        fi
    else
        echo ""
        echo "Note: Auto-start service requires bun. Install bun to enable this feature."
    fi
fi

# Final instructions
echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Open Figma Desktop"
echo "2. Import the plugin: Plugins → Development → Import plugin from manifest..."
echo "   Select: src/claude_mcp_plugin/manifest.json"
echo "3. Run the plugin in Figma to get your Channel ID"

if [[ "$OSTYPE" == "darwin"* ]] && [ -n "$BUN_PATH" ] && [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "4. The socket server is already running!"
else
    echo "4. Start the socket server: bun socket"
fi

echo "5. Connect Claude to your Figma channel"
echo ""
