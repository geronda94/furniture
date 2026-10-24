# tools/ — движок и скрипты

## Файлы

| Файл | Что делает |
|---|---|
| `engine.py` | Ядро: `Part`, `Config`, деталировка, MaxRects-раскрой, валидатор, DXF, SVG |
| `kitchen.py` | Кухня: секции, фасады, ящики, перегородки, ножки, 3D-данные, DXF |
| `blender_build.py` | Сборка сцены в Blender, анимация, рендер, «тур» |

## Требования

- Python 3.10+; `openpyxl` (для .xlsx) — в изолированном `.venv` (если нужно).
- Blender 5.x для 3D (`blender` в PATH или серверный).

## Использование

```bash
# деталировка + раскрой + DXF + scene3d.json
python3 kitchen.py \
  --sections "1600:2:1:Тумба,1700:2:0:Мойка,1600:0:3:Ящики,..." \
  --config ../specs/shop-default.yaml \
  --out ../projects/<имя>

# сборка 3D (режимы: stills | anim | tour | norender)
blender -b -P blender_build.py -- ../projects/<имя>/scene3d.json ../projects/<имя>/renders tour
```

## Формат `--sections`

`ширина:двери:ящики:имя`, секции через запятую.
Пример: `1600:2:1:Тумба с ящиком` = 1600 мм, 2 двери, 1 верхний ящик.

## Тесты

```bash
python3 tests/golden.py     # эталоны (хэши выходов)
python3 tests/geometry.py   # пересечения деталей в 3D
```

## Выходные файлы

- `parts.csv` / `parts.xlsx` — деталировка
- `cutting.svg` — схема раскроя
- `parts.json` / `scene3d.json` — машинные данные (3D)
- `kitchen_facade.dxf` / `kitchen_parts.dxf` — чертежи для CADCraft
- `report.txt` — отчёт + валидация

## Правила изменения

После правки кода — прогнать на тестовом изделии и убедиться, что валидатор без ошибок.
Каждое новое правило — фиксировать в `docs/`.
