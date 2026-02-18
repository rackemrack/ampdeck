#!/bin/bash

echo "============================================="
echo " Ampdeck v1.3.1 - Stream Deck Plugin"
echo " The Unofficial Plexamp Controller"
echo "============================================="
echo ""

# Check if Stream Deck is running
if pgrep -x "Stream Deck" > /dev/null 2>&1; then
    echo "ERROR: Stream Deck is currently running!"
    echo ""
    echo "Please close Stream Deck completely:"
    echo "  1. Right-click Stream Deck icon in the menu bar"
    echo "  2. Click \"Quit\""
    echo "  3. Run this installer again"
    echo ""
    exit 1
fi

# Set paths
PLUGIN_DIR="$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/com.dreadheadhippy.ampdeck.sdPlugin"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/com.dreadheadhippy.ampdeck.sdPlugin"

# Check source exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "ERROR: Plugin folder not found!"
    echo "Make sure com.dreadheadhippy.ampdeck.sdPlugin is in the same folder as this script."
    echo ""
    exit 1
fi

# Remove old installation if exists
if [ -d "$PLUGIN_DIR" ]; then
    echo "Removing previous installation..."
    rm -rf "$PLUGIN_DIR"
fi

# Copy plugin files
echo "Installing plugin files..."
cp -R "$SOURCE_DIR" "$PLUGIN_DIR"

if [ $? -eq 0 ]; then
    echo ""
    echo "============================================="
    echo " Installation Complete!"
    echo "============================================="
    echo ""
    echo "Next steps:"
    echo ""
    echo "1. Start the Stream Deck application"
    echo ""
    echo "2. Find \"Ampdeck\" in the actions list on the right"
    echo ""
    echo "3. Drag \"Album Art\" to any button"
    echo ""
    echo "4. Drag \"Now Playing Strip\" to ALL 4 DIALS"
    echo ""
    echo "5. Click any action and configure:"
    echo "   - Server URL: http://YOUR-SERVER-IP:32400"
    echo "   - Plex Token: [your token]"
    echo "   - Client Name: [your Mac name in Plex]"
    echo ""
    echo "6. Click \"Test Connection\" to verify"
    echo ""
    echo "7. Play something in Plexamp!"
    echo ""
else
    echo ""
    echo "ERROR: Installation failed!"
    echo ""
fi
