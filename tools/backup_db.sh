#!/usr/bin/env bash
# Ежедневный дамп БД Furniture с проверкой и ротацией.
#
#   tools/backup_db.sh            # сделать дамп
#   tools/backup_db.sh --check    # проверить, что дамп за сутки есть
#
# Дампы: backups/db/furniture-YYYYmmdd-HHMM.sql.gz, хранится 14 дней.
# Пустой или битый дамп не считается успехом: скрипт выходит с ошибкой.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${FURNITURE_BACKUP_DIR:-$ROOT/backups/db}"
KEEP_DAYS="${FURNITURE_BACKUP_DAYS:-14}"
CONTAINER="${FURNITURE_DB_CONTAINER:-furniture-db-1}"
LOG_DIR="${FURNITURE_LOG_DIR:-/var/log}"
if ! mkdir -p "$LOG_DIR" 2>/dev/null || [ ! -w "$LOG_DIR" ]; then
  LOG_DIR="${TMPDIR:-/tmp}"
fi
LOG="$LOG_DIR/furniture-backup.log"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }

if [ "${1:-}" = "--check" ]; then
  latest="$(ls -1t "$OUT_DIR"/furniture-*.sql.gz 2>/dev/null | head -1 || true)"
  if [ -z "$latest" ]; then
    echo "дампов нет"; exit 1
  fi
  age_h=$(( ( $(date +%s) - $(stat -c %Y "$latest") ) / 3600 ))
  if [ "$age_h" -gt 30 ]; then
    echo "последний дамп старше суток: $latest"; exit 1
  fi
  echo "ok: $latest (${age_h} ч)"
  exit 0
fi

[ -f .env ] || { log "ОШИБКА: нет .env"; exit 1; }
set -a
# shellcheck disable=SC1091
. ./.env
set +a
: "${POSTGRES_USER:?нет POSTGRES_USER}"
: "${POSTGRES_DB:?нет POSTGRES_DB}"

mkdir -p "$OUT_DIR"
stamp="$(date '+%Y%m%d-%H%M')"
target="$OUT_DIR/furniture-$stamp.sql.gz"
tmp="$target.part"

log "дамп $POSTGRES_DB → $target"
if docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$CONTAINER" \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner \
    | gzip -6 > "$tmp"; then
  size="$(stat -c %s "$tmp")"
  if [ "$size" -lt 10000 ]; then
    rm -f "$tmp"
    log "ОШИБКА: дамп подозрительно мал ($size байт)"
    exit 1
  fi
  # проверяем целостность архива и что внутри есть SQL
  # (awk читает поток до конца: head -c рвёт пайп и с pipefail даёт ложный сбой)
  if ! gzip -t "$tmp" 2>/dev/null \
      || ! gzip -dc "$tmp" | awk 'NR<=40' > "$tmp.hdr" \
      || ! grep -q "PostgreSQL database dump" "$tmp.hdr"; then
    rm -f "$tmp" "$tmp.hdr"
    log "ОШИБКА: архив не читается или это не pg_dump"
    exit 1
  fi
  rm -f "$tmp.hdr"
  mv "$tmp" "$target"
  log "готово: $(du -h "$target" | cut -f1)"
else
  rm -f "$tmp"
  log "ОШИБКА: pg_dump не выполнился"
  exit 1
fi

# ротация
find "$OUT_DIR" -name 'furniture-*.sql.gz' -type f -mtime "+$KEEP_DAYS" -print -delete 2>/dev/null \
  | while read -r old; do log "удалён старый дамп: $(basename "$old")"; done

log "осталось дампов: $(ls -1 "$OUT_DIR"/furniture-*.sql.gz 2>/dev/null | wc -l)"
