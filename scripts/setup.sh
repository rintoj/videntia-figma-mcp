#!/bin/bash

# Detect package manager
if command -v bun &> /dev/null; then
    PACKAGE_MANAGER="bun"
    echo "Bun detected, using it for setup..."
else
    PACKAGE_MANAGER="npm"
    echo "Bun not found, using npm instead..."
fi

# Install dependencies
echo "Installing dependencies..."
if [ "$PACKAGE_MANAGER" = "bun" ]; then
    bun install
else
    npm install
fi

# Configure for Claude Desktop
echo "Configuring for Claude Desktop..."
node scripts/configure-claude.js

echo "Configuration completed."

# macOS: Offer to install launchd service
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo ""
    read -p "Would you like to install the socket server as a launchd service (auto-starts on login)? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        PLIST_SRC="scripts/com.claude-talk-to-figma.socket.plist"
        PLIST_DEST="$HOME/Library/LaunchAgents/com.claude-talk-to-figma.socket.plist"
        PROJECT_PATH="$(pwd)"
        BUN_PATH="$(which bun)"

        # Verify bun is available
        if [ -z "$BUN_PATH" ]; then
            echo "Error: bun not found in PATH. Please install bun first."
            exit 1
        fi

        # Create plist with actual paths
        sed -e "s|\$PROJECT_PATH|$PROJECT_PATH|g" \
            -e "s|\$HOME|$HOME|g" \
            -e "s|\$BUN_PATH|$BUN_PATH|g" \
            "$PLIST_SRC" > "$PLIST_DEST"

        # Load the service
        launchctl unload "$PLIST_DEST" 2>/dev/null
        launchctl load "$PLIST_DEST"

        echo "Launchd service installed and started."
        echo "The socket server will now auto-start on login."
        echo "Logs: ~/Library/Logs/claude-talk-to-figma-socket.log"
    else
        echo ""
        echo "To use the MCP, make sure to start the WebSocket server:"
        if [ "$PACKAGE_MANAGER" = "bun" ]; then
            echo "bun socket"
        else
            echo "npm run socket"
        fi
    fi
else
    echo ""
    echo "To use the MCP, make sure to start the WebSocket server:"
    if [ "$PACKAGE_MANAGER" = "bun" ]; then
        echo "bun socket"
    else
        echo "npm run socket"
    fi
fi