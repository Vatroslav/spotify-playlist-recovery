#!/bin/bash
# PreToolUse hook: block git commit if version not bumped

CMD=$(python -c "import sys,json; print(json.load(sys.stdin)['tool_input']['command'])" 2>/dev/null)

# Only care about git commit commands
echo "$CMD" | grep -qE 'git commit' || exit 0

# Get staged files
STAGED=$(git diff --cached --name-only)
ADD_PART=$(echo "$CMD" | sed -n 's/.*git add \([^&]*\).*/\1/p')
if [ -n "$ADD_PART" ]; then
    STAGED="$STAGED
$(echo "$ADD_PART" | tr ' ' '\n')"
fi

# Find the version file path
VERSION_FILE="package.json"

# Only care if source files are staged (not just docs/config outside source)
echo "$STAGED" | grep -qE "^src/|^lib/|^app/" || exit 0

# Check if version file is staged
if ! echo "$STAGED" | grep -q "^${VERSION_FILE}$"; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Version not bumped! Update: %s"}}' "$VERSION_FILE"
    exit 0
fi
