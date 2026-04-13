#!/bin/bash
# Portal Parity Check Hook
# Triggered after editing customer portal files.
# Reminds about parity between Website Builder and Widget embed modes.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

BASENAME=$(basename "$FILE_PATH")

# Check if this is a portal-related file
case "$BASENAME" in
  portal.js|portal.css|embed-app.js)
    echo "PORTAL PARITY REMINDER: You edited $BASENAME."
    echo "This file is shared between Website Builder mode and Widget embed mode."
    echo "Verify your change works in BOTH modes:"
    echo "  - Website Builder: full-page dashboard with sidebar"
    echo "  - Widget embed: inline content, no sidebar (check this.config.embedMode)"
    echo "Run: npm run test:widget"
    ;;
  widget.js)
    echo "WIDGET REMINDER: You edited widget.js."
    echo "Ensure tab mappings still match portal views in embed-app.js."
    echo "Run: npm run test:widget"
    ;;
esac

exit 0
