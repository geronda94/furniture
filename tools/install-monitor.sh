#!/usr/bin/env bash
# Установка сторожей в systemd: здоровье стека (5 мин) и дамп БД (03:40).
# Нужен root.
#
#   tools/install-monitor.sh          # установить/обновить и включить
#   tools/install-monitor.sh --off    # выключить и удалить
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="/etc/systemd/system"
SERVICES=(furniture-health.service furniture-backup.service)
TIMERS=(furniture-health.timer furniture-backup.timer)

if [ "$(id -u)" -ne 0 ]; then
  echo "нужен root" >&2
  exit 1
fi

if [ "${1:-}" = "--off" ]; then
  for t in "${TIMERS[@]}"; do
    systemctl disable --now "$t" 2>/dev/null || true
  done
  for f in "${TIMERS[@]}" "${SERVICES[@]}"; do
    rm -f "$UNIT_DIR/$f"
  done
  systemctl daemon-reload
  echo "сторожа выключены"
  exit 0
fi

chmod +x "$ROOT/tools/health_watch.sh" "$ROOT/tools/backup_db.sh"
for f in "${SERVICES[@]}" "${TIMERS[@]}"; do
  install -m 644 "$ROOT/tools/systemd/$f" "$UNIT_DIR/$f"
done
systemctl daemon-reload
for t in "${TIMERS[@]}"; do
  systemctl enable --now "$t"
done

echo "установлено:"
systemctl list-timers "${TIMERS[@]}" --no-pager | sed -n '1,4p'
echo
echo "алерт в Telegram: создайте /etc/furniture-monitor.env"
echo "  TELEGRAM_BOT_TOKEN=..."
echo "  TELEGRAM_CHAT_ID=..."
