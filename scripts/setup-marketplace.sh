#!/usr/bin/env bash
# Configuración inicial del VS Code Marketplace (una sola vez).
# Crea PAT, publisher y publica la extensión.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="pilahito/ollama-copilot-vscode"
PUBLISHER="pilahito"
EXTENSION="local-copilot"
VERSION="$(node -p "require('./package.json').version")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

paso() { echo -e "\n${BLUE}▶ $1${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }

open_url() {
  local url="$1"
  if command -v xdg-open &>/dev/null; then
    xdg-open "$url" 2>/dev/null || true
  elif command -v sensible-browser &>/dev/null; then
    sensible-browser "$url" 2>/dev/null || true
  fi
}

echo "═══════════════════════════════════════════════════════════════"
echo "  Local Copilot — Configurar VS Code Marketplace"
echo "  Publisher: ${PUBLISHER}  |  Extensión: ${EXTENSION}  |  v${VERSION}"
echo "═══════════════════════════════════════════════════════════════"

paso "PASO 1 — Cuenta Microsoft / Azure DevOps"
echo "  Si no tienes cuenta, créala con tu email (Outlook, Hotmail, etc.)"
echo "  URL: https://dev.azure.com"
open_url "https://dev.azure.com"

paso "PASO 2 — Crear Personal Access Token (PAT)"
echo "  1. Entra en https://dev.azure.com"
echo "  2. Icono de usuario (arriba derecha) → Personal access tokens"
echo "  3. + New Token"
echo "  4. Configura:"
echo "     • Name:        Local Copilot Marketplace"
echo "     • Organization: All accessible organizations"
echo "     • Expiration:  90 días (o Custom)"
echo "     • Scopes:      Custom defined → Show all scopes"
echo "                    → Marketplace → ✓ Manage"
echo "  5. Create → COPIA el token (solo se muestra una vez)"
open_url "https://dev.azure.com/_usersSettings/tokens"

paso "PASO 3 — Crear publisher en Marketplace"
echo "  1. Entra con la MISMA cuenta Microsoft"
echo "  2. Create publisher (panel izquierdo)"
echo "  3. ID:   ${PUBLISHER}   (debe coincidir con package.json)"
echo "  4. Name: Local Copilot (o tu nombre de marca)"
echo "  5. Create"
open_url "https://marketplace.visualstudio.com/manage"

echo ""
warn "Completa los pasos 1-3 en el navegador antes de continuar."
echo ""
read -rp "¿Ya creaste el PAT y el publisher '${PUBLISHER}'? [s/N]: " ready
if [[ ! "$ready" =~ ^[sS]$ ]]; then
  echo "Vuelve a ejecutar este script cuando termines los pasos del navegador."
  exit 0
fi

paso "PASO 4 — Pegar el PAT"
if [[ -z "${VSCE_PAT:-}" ]]; then
  read -rsp "Pega tu Personal Access Token: " VSCE_PAT
  echo ""
fi
if [[ -z "${VSCE_PAT:-}" ]]; then
  echo "Error: PAT vacío."
  exit 1
fi

paso "PASO 5 — Verificar publisher con vsce login"
if npx @vscode/vsce login "$PUBLISHER" -p "$VSCE_PAT" 2>&1; then
  ok "Publisher '${PUBLISHER}' verificado"
else
  warn "Login falló. ¿Creaste el publisher con ID exacto '${PUBLISHER}'?"
  exit 1
fi

paso "PASO 6 — Guardar secreto en GitHub (publicaciones automáticas)"
printf '%s' "$VSCE_PAT" | gh secret set VSCE_PAT --repo "$REPO"
ok "Secreto VSCE_PAT guardado en GitHub Actions"

paso "PASO 7 — Publicar extensión v${VERSION}"
npm run compile
npx @vscode/vsce publish --no-dependencies -p "$VSCE_PAT"
unset VSCE_PAT

echo ""
echo "═══════════════════════════════════════════════════════════════"
ok "MARKETPLACE CONFIGURADO Y PUBLICADO"
echo "═══════════════════════════════════════════════════════════════"
echo "  Ficha: https://marketplace.visualstudio.com/items?itemName=${PUBLISHER}.${EXTENSION}"
echo "  GitHub: https://github.com/${REPO}/releases"
echo ""
echo "  Próximas versiones: ./scripts/publish-both.sh"
echo "═══════════════════════════════════════════════════════════════"