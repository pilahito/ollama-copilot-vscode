#!/usr/bin/env bash
# Copia de seguridad automática de Local Copilot → GitHub (origin/main).
# Solo hace commit/push si hay cambios reales en el código.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${LOCAL_COPILOT_BACKUP_LOG:-/tmp/local-copilot-backup.log}"
REMOTE="${LOCAL_COPILOT_BACKUP_REMOTE:-origin}"
BRANCH="${LOCAL_COPILOT_BACKUP_BRANCH:-main}"
TAG_PREFIX="${LOCAL_COPILOT_BACKUP_TAG_PREFIX:-backup}"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG"
}

cd "$ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "ERROR: no es un repositorio git ($ROOT)"
  exit 1
fi

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  log "ERROR: remoto '$REMOTE' no configurado"
  exit 1
fi

# Identidad git mínima si falta (entornos sin config global)
if [[ -z "$(git config user.email 2>/dev/null || true)" ]]; then
  git config user.email "pilahito1chico@gmail.com"
fi
if [[ -z "$(git config user.name 2>/dev/null || true)" ]]; then
  git config user.name "pilahito"
fi

VER="$(node -p "require('$ROOT/package.json').version" 2>/dev/null || echo '?')"
STAMP="$(date +%Y-%m-%dT%H:%M)"

log "── Inicio backup v${VER} ──"

# Compilar para validar que el árbol compila antes de publicar
if npm run compile >>"$LOG" 2>&1; then
  log "Compilación OK"
else
  log "AVISO: compilación falló — se omite este backup"
  exit 1
fi

git add -A

# Quitar del stage lo que no debe ir al repo
git reset -q HEAD -- node_modules dist out '*.vsix' .vscode-test stress-*.log 2>/dev/null || true
git checkout -q -- node_modules dist out 2>/dev/null || true

if git diff --cached --quiet && git diff --quiet; then
  log "Sin cambios — nada que publicar"
  exit 0
fi

MSG="backup: Local Copilot v${VER} — ${STAMP}

Copia de seguridad automática con mejoras acumuladas.
Incluye chat derecha, panel agente, wizard de proyectos y fixes recientes."

git commit -m "$MSG" >>"$LOG" 2>&1 || {
  log "Sin cambios tras filtrar — omitido"
  exit 0
}

COMMIT="$(git rev-parse --short HEAD)"
TAG="${TAG_PREFIX}-${VER}-$(date +%Y%m%d-%H%M)"

if git tag -a "$TAG" -m "Backup automático v${VER} ($STAMP)" 2>>"$LOG"; then
  log "Etiqueta creada: $TAG"
fi

if git push "$REMOTE" "$BRANCH" >>"$LOG" 2>&1; then
  log "Push OK → ${REMOTE}/${BRANCH} (${COMMIT})"
else
  log "ERROR: push falló — revisa red o credenciales (gh auth login)"
  exit 1
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  git push "$REMOTE" "$TAG" >>"$LOG" 2>&1 && log "Tag publicado: $TAG" || log "AVISO: tag no publicado"
fi

log "── Backup completado ──"