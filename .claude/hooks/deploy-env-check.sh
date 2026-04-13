#!/bin/bash
# Deploy Environment Safety Check
# Triggered before firebase deploy commands.
# Validates the build/environment match.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Only check firebase deploy commands
if [[ ! "$COMMAND" =~ "firebase deploy" ]]; then
  exit 0
fi

# Check if deploying to prod
if [[ "$COMMAND" =~ "kodacarte-861d8" ]] || [[ "$COMMAND" =~ "--project prod" ]]; then
  # Check if the build directory has prod config
  if [ -f "build/static/js/main.*.js" ]; then
    # Look for the dev project ID in the built bundle
    if grep -q "restaurant-portal-6b147" build/static/js/main.*.js 2>/dev/null; then
      echo "WARNING: Build contains DEV Firebase config but you're deploying to PRODUCTION!"
      echo "The build was created with 'build:only' (dev) instead of 'build:prod:only' (prod)."
      echo "This will cause auth failures in production."
      echo ""
      echo "Fix: Run 'npm run build:prod:only' first, then deploy."
      exit 2
    fi
  fi
  echo "Production deploy detected. Ensure you ran 'npm run build:prod:only' before deploying."
fi

# Check if deploying hosting to dev
if [[ "$COMMAND" =~ "hosting" ]] && [[ ! "$COMMAND" =~ "kodacarte" ]] && [[ ! "$COMMAND" =~ "prod" ]]; then
  if [ -f "build/static/js/main.*.js" ]; then
    if grep -q "kodacarte-861d8" build/static/js/main.*.js 2>/dev/null; then
      echo "WARNING: Build contains PRODUCTION Firebase config but you're deploying to DEV!"
      echo "The build was created with 'build:prod:only' (prod) instead of 'build:only' (dev)."
      echo "This will cause auth failures in dev."
      echo ""
      echo "Fix: Run 'npm run build:only' first, then deploy."
      exit 2
    fi
  fi
fi

exit 0
