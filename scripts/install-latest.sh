#!/usr/bin/env bash
# Instala la última versión de Local Copilot y elimina copias antiguas.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(node -p "require('$ROOT/package.json').version")"
VSIX="$ROOT/local-copilot-${VER}.vsix"

echo "══ Local Copilot v${VER} ══"
cd "$ROOT"
npm run compile
npx --yes @vscode/vsce package -o "local-copilot-${VER}.vsix"

EXT_DIR="${HOME}/.vscode/extensions"
if [[ -d "$EXT_DIR" ]]; then
  echo "Limpiando versiones antiguas en ${EXT_DIR}…"
  for d in "$EXT_DIR"/pilahito.local-copilot-*; do
    [[ -d "$d" ]] || continue
    if [[ "$d" != *"${VER}"* ]]; then
      rm -rf "$d"
      echo "  eliminado: $(basename "$d")"
    fi
  done
fi

echo "Instalando ${VSIX}…"
code --install-extension "$VSIX" --force

echo ""
echo "✓ Instalado v${VER}"
echo "  1. En VS Code: Ctrl+Shift+P → Developer: Reload Window"
echo "  2. Abre Local Copilot y comprueba el pie: debe decir v${VER}"
echo "  3. Modo Agente → al escribir Ollama verás una 2ª burbuja morada con el código en vivo"