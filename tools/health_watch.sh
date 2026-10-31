#!/usr/bin/env bash
# Сторож прод-стека Furniture: здоровье контейнеров + ответ сайта.
#
#   tools/health_watch.sh            # проверить, при сбое — перезапуск/алерт
#   tools/health_watch.sh --check    # только проверить, код выхода = статус
#
# Правила:
#   - api/web unhealthy или сайт не отвечает → один перезапуск контейнера;
#   - если после перезапуска снова плохо → только алерт (без цикла рестартов);
#   - в 30 минут не больше 2 перезапусков на сервис;
#   - алерт — в Telegram, если заданы TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID
#     (файл /etc/furniture-monitor.env), иначе только запись в лог.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SITE="${FURNITURE_SITE_URL:-https://5176.it2b.top}"
LOG_DIR="${FURNITURE_LOG_DIR:-/var/log}"
if ! mkdir -p "$LOG_DIR" 2>/dev/null || [ ! -w "$LOG_DIR" ]; then
  LOG_DIR="${TMPDIR:-/tmp}"
fi
LOG="$LOG_DIR/furniture-health.log"
STATE_DIR="${FURNITURE_STATE_DIR:-/var/lib/furniture-monitor}"
if ! mkdir -p "$STATE_DIR" 2>/dev/null || [ ! -w "$STATE_DIR" ]; then
  STATE_DIR="${TMPDIR:-/tmp}/furniture-monitor"
  mkdir -p "$STATE_DIR"
fi
STATE="$STATE_DIR/state"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

# Секреты алерта — отдельным файлом, не в .env приложения.
if [ -r /etc/furniture-monitor.env ]; then
  # shellcheck disable=SC1091
  . /etc/furniture-monitor.env
fi

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG"; }

alert() {
  local text="$1"
  log "АЛЕРТ: $text"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -sS -m 10 -o /dev/null \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=furniture: ${text}" \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      || log "telegram: не удалось отправить"
  fi
}

health_of() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo missing
}

# Перезапуск с ограничением частоты: не больше 2 за 30 минут на сервис.
restart_budget() {
  local svc="$1" file="$STATE_DIR/$svc.restarts" now cutoff count=0
  now="$(date +%s)"
  cutoff=$((now - 1800))
  [ -f "$file" ] || : >"$file"
  awk -v c="$cutoff" '$1 >= c' "$file" >"$file.tmp" && mv "$file.tmp" "$file"
  count="$(wc -l <"$file")"
  [ "$count" -lt 2 ] || return 1
  echo "$now" >>"$file"
  return 0
}

problems=()
api="$(health_of furniture-api-1)"
web="$(health_of furniture-web-1)"
db="$(health_of furniture-db-1)"
site_code="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' "$SITE/api/health" 2>/dev/null || echo 000)"

[ "$db" = "healthy" ] || problems+=("db:$db")
[ "$api" = "healthy" ] || problems+=("api:$api")
[ "$web" = "healthy" ] || problems+=("web:$web")
[ "$site_code" = "200" ] || problems+=("site:$site_code")

if [ "${#problems[@]}" -eq 0 ]; then
  printf '%s ok api=%s web=%s db=%s site=%s\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" "$api" "$web" "$db" "$site_code" >>"$LOG"
  echo "ok"
  exit 0
fi

detail="${problems[*]}"
echo "проблема: $detail"
log "проблема: $detail"
[ "$CHECK_ONLY" -eq 1 ] && exit 1

fixed=0
for svc in api web; do
  state="$(health_of "furniture-$svc-1")"
  [ "$state" = "healthy" ] && continue
  if restart_budget "$svc"; then
    log "перезапуск furniture-$svc-1 (было: $state)"
    docker restart "furniture-$svc-1" >/dev/null 2>>"$LOG" && fixed=1
  else
    alert "furniture-$svc-1: $state, лимит перезапусков исчерпан — нужен человек"
  fi
done

if [ "$fixed" -eq 1 ]; then
  sleep 20
  api="$(health_of furniture-api-1)"
  web="$(health_of furniture-web-1)"
  site_code="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' "$SITE/api/health" 2>/dev/null || echo 000)"
  if [ "$api" = "healthy" ] && [ "$web" = "healthy" ] && [ "$site_code" = "200" ]; then
    log "восстановлено перезапуском: api=$api web=$web site=$site_code"
    echo "восстановлено"
    exit 0
  fi
  alert "после перезапуска всё ещё плохо: api=$api web=$web site=$site_code"
  exit 1
fi

alert "сайт не отвечает ($site_code), автоматически не исправлено: $detail"
exit 1
