#!/usr/bin/env bash
# Instala cron para publicar copias de seguridad en GitHub cada 6 horas.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_SH="$ROOT/scripts/backup-to-github.sh"
MARKER="# local-copilot-github-backup"
CRON_LINE="0 */6 * * * $BACKUP_SH >> /tmp/local-copilot-backup.log 2>&1 $MARKER"

chmod +x "$BACKUP_SH"

EXISTING="$(crontab -l 2>/dev/null || true)"
if echo "$EXISTING" | grep -qF "$MARKER"; then
  echo "✓ Cron de backup ya instalado"
else
  {
    echo "$EXISTING"
    echo "$CRON_LINE"
  } | crontab -
  echo "✓ Cron instalado: cada 6 horas → GitHub"
fi

echo ""
echo "  Script:  $BACKUP_SH"
echo "  Log:     /tmp/local-copilot-backup.log"
echo "  Remoto:  origin/main (+ etiqueta backup-vX.Y.Z-fecha)"
echo ""
echo "  Probar ahora:  $BACKUP_SH"
echo "  Desinstalar:   crontab -l | grep -v '$MARKER' | crontab -"