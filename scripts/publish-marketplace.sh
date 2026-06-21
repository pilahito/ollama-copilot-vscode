#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${VSCE_PAT:-}" ]]; then
  echo "Error: define VSCE_PAT con tu token de Azure DevOps (scope Marketplace Manage)."
  echo "  export VSCE_PAT='tu-token'"
  echo "  ./scripts/publish-marketplace.sh"
  exit 1
fi

npm run compile
npx @vscode/vsce publish --no-dependencies -p "$VSCE_PAT"