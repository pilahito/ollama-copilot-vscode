#!/usr/bin/env bash
# Publica en GitHub Releases + VS Code Marketplace (vía Actions).
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="pilahito/ollama-copilot-vscode"
VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"
VSIX="local-copilot-${VERSION}.vsix"
TITLE="v${VERSION} — Local Copilot"

echo "=== Publicar ${TAG} en GitHub + Marketplace ==="

npm run compile
npx @vscode/vsce package --no-dependencies
test -f "$VSIX" || { echo "Error: no se generó $VSIX"; exit 1; }

NOTES_FILE="$(mktemp)"
{
  echo "## Local Copilot ${TAG}"
  echo ""
  sed -n '/^## \['"${VERSION}"'\]/,/^## \[/p' CHANGELOG.md | head -n -1 | tail -n +2
} > "$NOTES_FILE"

if gh release view "$TAG" --repo "$REPO" &>/dev/null; then
  echo "→ Actualizando release $TAG..."
  gh release upload "$TAG" "$VSIX" --clobber --repo "$REPO"
else
  echo "→ Creando release $TAG..."
  gh release create "$TAG" "$VSIX" --repo "$REPO" --title "$TITLE" --notes-file "$NOTES_FILE"
fi
rm -f "$NOTES_FILE"

if [[ -z "${VSCE_PAT:-}" ]]; then
  if gh secret list --repo "$REPO" 2>/dev/null | grep -q VSCE_PAT; then
    echo "→ VSCE_PAT configurado — lanzando Marketplace workflow..."
    gh workflow run publish-marketplace.yml --repo "$REPO"
    sleep 3
    RUN_ID="$(gh run list --repo "$REPO" --workflow publish-marketplace.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
    gh run watch "$RUN_ID" --repo "$REPO" --exit-status
  else
    echo ""
    echo "⚠ Marketplace: falta VSCE_PAT."
    echo "  VSCE_PAT='tu-token' ./scripts/first-publish.sh"
    echo "  Luego: gh workflow run publish-marketplace.yml --repo $REPO"
    exit 2
  fi
else
  echo "→ Publicando directo en Marketplace..."
  npx @vscode/vsce publish --no-dependencies -p "$VSCE_PAT"
fi

echo ""
echo "✅ GitHub: https://github.com/$REPO/releases/tag/$TAG"
echo "✅ Marketplace: https://marketplace.visualstudio.com/items?itemName=pilahito.local-copilot"