# База бизнес-стратегий

Это рабочее пространство для стратегий: гипотезы, оценки, заметки, статусы,
сортировка и экспорт. Источник истины — `strategies.json`. `STRATEGIES.md` и
`strategies.sqlite` генерируются из него.

## Файлы

| Файл | Что это |
|---|---|
| `strategies.json` | источник истины: цель, ограничения, веса, критерии, стратегии, заметки |
| `STRATEGIES.md` | человекочитаемый вид: рейтинг, тиры, плюсы/минусы, шаги |
| `strategies.sqlite` | та же база для SQL-запросов (генерируется) |
| `README.md` | этот файл |

## Быстрый старт

```bash
python3 tools/strategy.py list
python3 tools/strategy.py list --tier 1 --sort score
python3 tools/strategy.py list --status validating
python3 tools/strategy.py show content-factory
python3 tools/strategy.py score
python3 tools/strategy.py stats
python3 tools/strategy.py validate
```

## Изменить оценку или статус

```bash
python3 tools/strategy.py set-score content-factory sales 4
python3 tools/strategy.py set-status content-factory active
python3 tools/strategy.py note content-factory "Проверил спрос: 3 бренда ответили"
```

## Добавить стратегию

Создай JSON-файл с обязательными полями:

```json
{
  "id": "new-idea",
  "name": "Название",
  "category": "service",
  "tier": 1,
  "status": "idea",
  "summary": "Коротко, что это",
  "who_pays": "Кто платит",
  "offer": "Что продаём",
  "pricing": "Цена",
  "first_cash": "2-4 недели",
  "scores": {"speed": 3, "capital": 3, "fit": 3, "sales": 3, "scale": 3, "moat": 3, "risk": 3, "ceiling": 3}
}
```

Затем:

```bash
python3 tools/strategy.py add --file /tmp/new-idea.json
```

## Экспорт и SQL

```bash
python3 tools/strategy.py export-md
python3 tools/strategy.py sqlite

sqlite3 docs/business/strategy/strategies.sqlite \
  "select id, score, status, first_cash from strategies order by score desc limit 10;"
```

## Как считается балл

Балл = сумма `score × weight` по критериям:

| Критерий | Вес | Что значит |
|---|---:|---|
| `speed` | 0.20 | скорость до первых денег |
| `capital` | 0.10 | 5 = без вложений |
| `fit` | 0.20 | соответствие навыкам/желанию |
| `sales` | 0.15 | лёгкость продаж |
| `scale` | 0.15 | масштаб без линейных часов |
| `moat` | 0.10 | защищённость/ров |
| `risk` | 0.10 | 5 = низкий риск |

`ceiling` (потолок дохода) показывается, но в балл не входит.

Веса можно менять в `strategies.json` → `weights`; после этого
`validate` и `score` пересчитают.

## Статусы

- `idea` — гипотеза, не проверялась
- `researching` — собираю данные
- `validating` — делаю сэмплы/пилоты
- `active` — приносит деньги/идёт работа
- `paused` — отложено
- `rejected` — не подходит (например, ручное проектирование)

## Тиры

- `1` — простое и быстрое: сервис, аутрич, первые деньги за 1-6 недель
- `2` — продукт/автоматизация: 2-4 месяца до денег
- `3` — сложное: капитал, партнёры, 6-18 месяцев

## Правила

1. Не редактируй `STRATEGIES.md` вручную — он перезаписывается.
2. Новые мысли — в `notes` стратегии или в `reflections` верхнего уровня.
3. После изменений: `validate` → `export-md` → `sqlite`.
4. Оценки 1-5; не завышай `fit`, если не готов делать это руками.
5. Стратегия без «кто платит» и «первые деньги» — не стратегия, а идея.
