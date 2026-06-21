#!/usr/bin/env bash
# Publicación segura en VS Code Marketplace (una sola vez).
# El token NO se guarda en disco; solo se sube como secreto de GitHub.
set -euo pipefail

REPO="pilahito/ollama-copilot-vscode"

echo "=== Local Copilot → VS Code Marketplace ==="
echo ""
echo "Necesitas un PAT de Azure DevOps con scope: Marketplace → Manage"
echo "Crearlo: https://dev.azure.com → User settings → Personal access tokens"
echo ""

if [[ -z "${VSCE_PAT:-}" ]]; then
  read -rsp "Pega tu PAT (no se mostrará): " VSCE_PAT
  echo ""
fi

if [[ -z "${VSCE_PAT:-}" ]]; then
  echo "Error: PAT vacío. Usa: VSCE_PAT='tu-token' ./scripts/first-publish.sh"
  exit 1
fi

echo "→ Guardando secreto VSCE_PAT en GitHub..."
printf '%s' "$VSCE_PAT" | gh secret set VSCE_PAT --repo "$REPO"
unset VSCE_PAT

echo "→ Lanzando publicación vía GitHub Actions..."
gh workflow run publish-marketplace.yml --repo "$REPO"

echo "→ Esperando resultado..."
sleep 3
RUN_ID="$(gh run list --repo "$REPO" --workflow publish-marketplace.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$RUN_ID" --repo "$REPO" --exit-status

echo ""
echo "Listo. Ficha:"
echo "  https://marketplace.visualstudio.com/items?itemName=pilahito.local-copilot"