#!/usr/bin/env bash
# Деплой прод-стека Furniture: тесты → сборка → перезапуск → проверка → откат.
#
#   tools/deploy.sh                 # тесты, сборка, деплой, проверка
#   tools/deploy.sh --skip-tests    # только сборка и деплой
#   tools/deploy.sh --no-build      # перезапуск текущих образов
#
# Образы перед сборкой помечаются :previous — при провале проверки стек
# возвращается на них автоматически.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOG_DIR="${FURNITURE_LOG_DIR:-/var/log}"
if ! mkdir -p "$LOG_DIR" 2>/dev/null || [ ! -w "$LOG_DIR" ]; then
  LOG_DIR="${TMPDIR:-/tmp}"
fi
LOG="$LOG_DIR/furniture-deploy.log"
touch "$LOG" 2>/dev/null || LOG="/tmp/furniture-deploy.log"

SKIP_TESTS=0
NO_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --skip-tests) SKIP_TESTS=1 ;;
    --no-build) NO_BUILD=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "неизвестный параметр: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }
fail() { log "ОШИБКА: $*"; exit 1; }

trap 'fail "прервано на строке $LINENO"' ERR

API_IMAGE="furniture-api"
WEB_IMAGE="furniture-web"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"

note=""
[ "$SKIP_TESTS" -eq 1 ] && note="$note без тестов"
[ "$NO_BUILD" -eq 1 ] && note="$note без сборки"
log "=== деплой начат${note} ==="

# 1. Тесты: быстрые проверки движка. Долгие e2e — отдельно, в CI.
if [ "$SKIP_TESTS" -eq 0 ]; then
  for t in golden geometry features layout scene standards cutting; do
    log "тест: tests/$t.py"
    python3 "tests/$t.py" >>"$LOG" 2>&1 || fail "тест tests/$t.py не прошёл"
  done
else
  log "тесты пропущены (--skip-tests)"
fi

# 2. Метка текущих образов для отката.
have_api=0
have_web=0
if docker image inspect "$API_IMAGE:latest" >/dev/null 2>&1; then
  docker tag "$API_IMAGE:latest" "$API_IMAGE:previous"
  have_api=1
fi
if docker image inspect "$WEB_IMAGE:latest" >/dev/null 2>&1; then
  docker tag "$WEB_IMAGE:latest" "$WEB_IMAGE:previous"
  have_web=1
fi

rollback() {
  log "ОТКАТ на предыдущие образы"
  [ "$have_api" -eq 1 ] && docker tag "$API_IMAGE:previous" "$API_IMAGE:latest"
  [ "$have_web" -eq 1 ] && docker tag "$WEB_IMAGE:previous" "$WEB_IMAGE:latest"
  docker compose up -d --force-recreate api web >>"$LOG" 2>&1 || true
  log "откат выполнен; проверьте https://5176.it2b.top/api/health"
  exit 1
}

# 3. Сборка.
if [ "$NO_BUILD" -eq 0 ]; then
  log "сборка образов api и web"
  docker compose build api web >>"$LOG" 2>&1 || fail "сборка не удалась"
else
  log "сборка пропущена (--no-build)"
fi

# 4. Перезапуск.
log "перезапуск api и web"
# --force-recreate: в проде исходники смонтированы (.:/app) и uvicorn без
# --reload. Без пересоздания правки в Python не подхватятся, а `up -d`
# на неизменном контейнере ничего не делает.
docker compose up -d --force-recreate api web >>"$LOG" 2>&1 || { rollback; }

# 5. Ожидание healthy.
wait_healthy() {
  local name="$1" waited=0 status
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || echo missing)"
    if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then
      log "$name: $status"
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  log "$name: не поднялся за ${HEALTH_TIMEOUT}s (статус: ${status:-нет})"
  return 1
}

wait_healthy furniture-api-1 || { docker logs --tail 30 furniture-api-1 >>"$LOG" 2>&1; rollback; }
wait_healthy furniture-web-1 || rollback

# 6. Проверка снаружи контейнеров.
check_url() {
  local url="$1" code
  code="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' "$url" || echo 000)"
  log "проверка $url → $code"
  [ "$code" = "200" ] || return 1
}

check_url http://127.0.0.1:8003/api/health || { docker logs --tail 30 furniture-api-1 >>"$LOG" 2>&1; rollback; }
check_url http://127.0.0.1:5176/ || rollback

# 7. Версия: что именно сейчас на проде.
log "образы: $(docker image inspect -f '{{.Id}}' "$API_IMAGE:latest" | cut -c1-12) api, $(docker image inspect -f '{{.Id}}' "$WEB_IMAGE:latest" | cut -c1-12) web"
log "=== деплой завершён успешно ==="
