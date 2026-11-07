#!/bin/bash
input=$(cat)
file_path=$(echo "$input" | python -c "import sys,json; print(json.load(sys.stdin)['tool_input'].get('file_path',''))" 2>/dev/null)
[ -z "$file_path" ] && exit 0
[ ! -f "$file_path" ] && exit 0

# Only this repo's files: a session here can also write in other folders.
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null)
inside=$(python -c "import os,sys; n=lambda p: os.path.normcase(os.path.abspath(p)); print(n(sys.argv[1]).startswith(n(sys.argv[2]) + os.sep))" "$file_path" "$repo" 2>/dev/null)
[ "$inside" = "True" ] || exit 0

# From the repo root, because prettier reads .prettierignore from the current folder.
# --no: skip formatting rather than download a tool missing from node_modules.
cd "$repo" || exit 0

case "$file_path" in
  *.js|*.mjs|*.cjs|*.jsx|*.vue)
    npx --no -- prettier --write "$file_path" 2>/dev/null
    npx --no -- eslint --fix "$file_path" 2>/dev/null
    ;;
  *.json|*.css|*.scss|*.html|*.md|*.yaml|*.yml)
    npx --no -- prettier --write "$file_path" 2>/dev/null
    ;;
esac
exit 0
