#!/usr/bin/env bash
#
# ─────────────────────────────────────────────────────────────────────────────
#  install.sh — Instalador automatizado de Ayitax Copilot
#  (c) 2026 pilahito · Licensed under the MIT License.
# ─────────────────────────────────────────────────────────────────────────────
#  Qué hace este script:
#    1. Comprueba/instala Ollama (motor de IA local)
#    2. Arranca el servicio de Ollama si no está corriendo
#    3. Descarga los modelos necesarios (chat/agente y autocompletado)
#    4. Instala las dependencias npm de la extensión
#    5. Compila el código TypeScript
#    6. Empaqueta la extensión en un .vsix instalable
#    7. (Opcional) Instala el .vsix directamente en VS Code
#
#  Uso:
#    chmod +x install.sh
#    ./install.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e  # Detiene el script si cualquier comando falla

# ── Colores para que la salida sea legible ──────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # Sin color

paso() { echo -e "\n${BLUE}▶ $1${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; }

# ── Modelos por defecto (coinciden con package.json) ────────────────────────
CHAT_MODEL="qwen2.5-coder:14b"
COMPLETION_MODEL="qwen2.5-coder:7b"

# Permite sobreescribir los modelos pasando variables de entorno, por ejemplo:
#   CHAT_MODEL=qwen2.5-coder:7b COMPLETION_MODEL=qwen2.5-coder:1.5b ./install.sh
# útil si tu Mini PC tiene poca RAM/VRAM.

echo "═══════════════════════════════════════════════════════════════"
echo "   AYITAX COPILOT — Instalador automatizado"
echo "═══════════════════════════════════════════════════════════════"

# ─────────────────────────────────────────────────────────────────────────
# 1. COMPROBAR / INSTALAR OLLAMA
# ─────────────────────────────────────────────────────────────────────────
paso "Comprobando si Ollama está instalado..."

if command -v ollama &> /dev/null; then
  ok "Ollama ya está instalado ($(ollama --version 2>/dev/null || echo 'versión desconocida'))"
else
  warn "Ollama no está instalado. Instalando ahora..."
  curl -fsSL https://ollama.com/install.sh | sh
  ok "Ollama instalado correctamente"
fi

# ─────────────────────────────────────────────────────────────────────────
# 2. ARRANCAR EL SERVICIO DE OLLAMA SI NO ESTÁ CORRIENDO
# ─────────────────────────────────────────────────────────────────────────
paso "Comprobando si el servicio de Ollama está activo..."

if curl -s --max-time 2 http://localhost:11434/api/tags &> /dev/null; then
  ok "Ollama ya está corriendo en localhost:11434"
else
  warn "Ollama no responde. Intentando arrancarlo..."

  # Si existe como servicio systemd, lo usamos; si no, lo lanzamos en segundo plano
  if systemctl list-unit-files 2>/dev/null | grep -q ollama; then
    sudo systemctl enable --now ollama
  else
    nohup ollama serve > /tmp/ollama.log 2>&1 &
    disown
  fi

  # Esperamos a que el servicio responda, con un máximo de 30 segundos
  intentos=0
  until curl -s --max-time 2 http://localhost:11434/api/tags &> /dev/null; do
    intentos=$((intentos + 1))
    if [ "$intentos" -ge 15 ]; then
      fail "Ollama no respondió tras 30 segundos. Revisa /tmp/ollama.log"
      exit 1
    fi
    sleep 2
  done
  ok "Ollama arrancado y respondiendo"
fi

# ─────────────────────────────────────────────────────────────────────────
# 3. DESCARGAR LOS MODELOS NECESARIOS
# ─────────────────────────────────────────────────────────────────────────
paso "Comprobando modelos descargados..."

modelos_instalados=$(ollama list 2>/dev/null | tail -n +2 | awk '{print $1}')

descargar_si_falta() {
  local modelo="$1"
  if echo "$modelos_instalados" | grep -qx "$modelo"; then
    ok "Modelo '$modelo' ya está descargado"
  else
    warn "Descargando modelo '$modelo' (esto puede tardar varios minutos)..."
    ollama pull "$modelo"
    ok "Modelo '$modelo' descargado"
  fi
}

descargar_si_falta "$CHAT_MODEL"
descargar_si_falta "$COMPLETION_MODEL"

# ─────────────────────────────────────────────────────────────────────────
# 4. COMPROBAR NODE.JS
# ─────────────────────────────────────────────────────────────────────────
paso "Comprobando Node.js..."

if ! command -v node &> /dev/null; then
  fail "Node.js no está instalado. Instálalo primero:"
  echo "    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "    sudo apt install -y nodejs"
  exit 1
fi

node_version=$(node -v)
ok "Node.js detectado: $node_version"

# ─────────────────────────────────────────────────────────────────────────
# 5. INSTALAR DEPENDENCIAS DE LA EXTENSIÓN
# ─────────────────────────────────────────────────────────────────────────
paso "Instalando dependencias npm..."

# Detecta si el script se ejecuta desde dentro o fuera de la carpeta del proyecto
if [ -f "package.json" ]; then
  PROJECT_DIR="."
elif [ -f "ayitax-copilot/package.json" ]; then
  PROJECT_DIR="ayitax-copilot"
else
  fail "No se encuentra package.json. Ejecuta este script desde la carpeta del proyecto."
  exit 1
fi

cd "$PROJECT_DIR"
npm install
ok "Dependencias instaladas"

# ─────────────────────────────────────────────────────────────────────────
# 6. COMPILAR
# ─────────────────────────────────────────────────────────────────────────
paso "Compilando la extensión..."
npm run compile
ok "Compilación completada (dist/extension.js generado)"

# ─────────────────────────────────────────────────────────────────────────
# 7. EMPAQUETAR EN .VSIX
# ─────────────────────────────────────────────────────────────────────────
paso "Comprobando vsce (empaquetador de extensiones)..."

if ! command -v vsce &> /dev/null; then
  warn "vsce no está instalado globalmente. Instalando..."
  npm install -g @vscode/vsce
  ok "vsce instalado"
else
  ok "vsce ya está disponible"
fi

paso "Empaquetando la extensión en .vsix..."
vsce package --no-dependencies
VSIX_FILE=$(ls -t *.vsix 2>/dev/null | head -n 1)

if [ -z "$VSIX_FILE" ]; then
  fail "No se generó ningún archivo .vsix. Revisa los errores anteriores."
  exit 1
fi

ok "Extensión empaquetada: $VSIX_FILE"

# ─────────────────────────────────────────────────────────────────────────
# 8. INSTALAR EN VS CODE (opcional, con confirmación)
# ─────────────────────────────────────────────────────────────────────────
echo ""
read -p "¿Quieres instalar la extensión ahora en VS Code? [s/N]: " respuesta

if [[ "$respuesta" =~ ^[sS]$ ]]; then
  if command -v code &> /dev/null; then
    code --install-extension "$VSIX_FILE"
    ok "Extensión instalada en VS Code"
  else
    fail "El comando 'code' no está disponible en el PATH."
    echo "    Instálala manualmente: Ctrl+Shift+P → 'Extensions: Install from VSIX...'"
  fi
else
  echo "Puedes instalarla más tarde con:"
  echo "    code --install-extension $PROJECT_DIR/$VSIX_FILE"
fi

# ─────────────────────────────────────────────────────────────────────────
# RESUMEN FINAL
# ─────────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
ok "INSTALACIÓN COMPLETADA"
echo "═══════════════════════════════════════════════════════════════"
echo "  Modelo de chat/agente:    $CHAT_MODEL"
echo "  Modelo de autocompletado: $COMPLETION_MODEL"
echo "  Archivo generado:         $PROJECT_DIR/$VSIX_FILE"
echo "  Ollama escuchando en:     http://localhost:11434"
echo ""
echo "  Abre VS Code, busca el icono de Ayitax en la barra lateral"
echo "  y comprueba el indicador de conexión en la barra de estado."
echo "═══════════════════════════════════════════════════════════════"
