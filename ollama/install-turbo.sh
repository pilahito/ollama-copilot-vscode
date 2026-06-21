#!/usr/bin/env bash
# Crea el modelo local-copilot-turbo (más rápido que 14b para chat diario)
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v ollama >/dev/null 2>&1; then
  echo "Error: instala Ollama primero → https://ollama.com"
  exit 1
fi

echo "→ Descargando base qwen2.5-coder:7b (si no está)..."
ollama pull qwen2.5-coder:7b

echo "→ Creando local-copilot-turbo..."
ollama create local-copilot-turbo -f "$DIR/Modelfile"

echo ""
echo "✓ Listo. En VS Code → Configuración:"
echo "    local.chatModel = local-copilot-turbo"
echo ""
echo "Para agente pesado puedes seguir usando qwen2.5-coder:14b."