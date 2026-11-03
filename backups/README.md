# Бэкапы БД

## Что где

- `db/` — **полные** дампы (`pg_dump | gzip`), только локально, в git не
  попадают (`.gitignore`). Содержат пользователей, e-mail и хеши паролей.
- `committed/` — **обезличенный** дамп для git: таблица `users` исключена,
  `projects.owner` очищен. Восстанавливает проекты и версии, но не аккаунты.

## Сделать полный бэкап

```bash
cd /root/projects/furniture
ts=$(date +%Y%m%d-%H%M)
docker exec furniture-db-1 pg_dump -U furniture -d furniture \
  | gzip > backups/db/furniture-full-${ts}.sql.gz
```

## Сделать обезличенный (для коммита)

```bash
ts=$(date +%Y%m%d-%H%M)
docker exec furniture-db-1 dropdb -U furniture --if-exists furniture_sanit
docker exec furniture-db-1 createdb -U furniture furniture_sanit
docker exec furniture-db-1 sh -c \
  "pg_dump -U furniture -d furniture --schema-only --no-owner --no-acl" \
  | docker exec -i furniture-db-1 psql -q -U furniture -d furniture_sanit
docker exec furniture-db-1 sh -c \
  "pg_dump -U furniture -d furniture --data-only --no-owner --no-acl \
   --table=projects --table=project_versions" \
  | docker exec -i furniture-db-1 psql -q -U furniture -d furniture_sanit
docker exec furniture-db-1 psql -q -U furniture -d furniture_sanit \
  -c "UPDATE projects SET owner=NULL;"
docker exec furniture-db-1 sh -c \
  "pg_dump -U furniture -d furniture_sanit --exclude-table=users --no-owner --no-acl" \
  | gzip > backups/committed/furniture-${ts}.sql.gz
docker exec furniture-db-1 dropdb -U furniture furniture_sanit
```

## Восстановить

```bash
# в пустую БД (полный дамп)
gunzip -c backups/db/furniture-full-YYYYMMDD-HHMM.sql.gz \
  | docker exec -i furniture-db-1 psql -U furniture -d furniture

# обезличенный: проекты без пользователей
gunzip -c backups/committed/furniture-YYYYMMDD-HHMM.sql.gz \
  | docker exec -i furniture-db-1 psql -U furniture -d furniture
```

Полный дамп — единственный, из которого восстанавливаются входы
пользователей. Обезличенный — для истории проекта и переноса проектов.
