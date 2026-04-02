#!/bin/bash
input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')
[ -z "$file_path" ] && exit 0
[ ! -f "$file_path" ] && exit 0

case "$file_path" in
  *.js|*.mjs|*.cjs|*.jsx|*.vue)
    npx prettier --write "$file_path" 2>/dev/null
    npx eslint --fix "$file_path" 2>/dev/null
    ;;
  *.json|*.css|*.scss|*.html|*.md|*.yaml|*.yml)
    npx prettier --write "$file_path" 2>/dev/null
    ;;
esac
exit 0
