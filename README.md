# Furniture — проектный дом для мебели

Здесь живёт **всё, что связано с мебелью**: правила проектирования, движок расчёта,
3D-визуализация, видео, превью и карточки товаров. Это «база» для работы с ИИ-агентами
над разными аспектами мебельного производства и контента.

> Начни с `AGENTS.md` (как работать) и `docs/00-overview.md` (обзор).

## Структура

```
Furniture/
├── README.md              ← этот файл: обзор и навигация
├── AGENTS.md              ← инструкции для ИИ-агентов (правила, куда что класть)
├── docs/                  ← документация: правила, специфика, пайплайны
├── specs/                 ← спецификации: цеха, фурнитура, бренды (данные)
├── tools/                 ← движок и скрипты (расчёт, раскрой, Blender)
├── skills/                ← скиллы для opencode-агентов
├── projects/              ← конкретные изделия/заказы (всё по проекту внутри)
│   └── <имя>/             ← данные + renders/ + video/ + previews/ + cards/
├── assets/                ← материалы, текстуры, модели фурнитуры
├── tasks/                 ← роадмап и бэклог
└── archive/               ← устаревшее/черновики
```

## Три слоя знаний

1. **Универсальные правила** — `docs/01-design-rules.md` (одинаковы везде).
2. **Цеховые** — `specs/shop-*.yaml` (формат листа, пропил, кромки — у каждого раскройщика свои).
3. **Брендовые** — `specs/hardware-catalog.md` (присадка под Blum/Hettich/GTV).

## Конвейер (что во что превращается)

```
вход (размеры клиента)
   └─► tools/kitchen.py  ──► деталировка (xlsx) + раскрой (svg) + DXF (CADCraft)
                         └─► scene3d.json
                              └─► tools/blender_build.py ──► .blend + рендеры + видео
                                   └─► projects/<имя>/renders/ (3D, видео, превью)
                                        └─► карточки товаров (PhotoCraft, Data Sets)
```

## Что уже умеет (2026-10)

- Деталировка с кромкой/присадкой, раскрой MaxRects, DXF/SVG.
- Конструктор: двери/ящики/полки в любом порядке, толщина ЛДСП, задник
  (ДВП/ЛДСП/картон/нет), крыша, царги, навесные модули, цоколь/столешница,
  вырезы под мойку/плиту.
- Комната: контур любой формы (>4 стен, углы), перегородки, окна/двери на
  любой стене, петли/угол.
- Единый инспектор: конструктор, детали, относительные размеры, ящики, анимация.
- 3D: скрытие фасадов, коллизии с учётом высоты, исправленные пол/потолок.
- API для ИИ: `/api/catalog`, `/api/shop`, `/api/validate`, `/api/ai/guide`,
  `/api/projects/{id}/summary`, `/api/projects/{id}/actions`.

## 3D

Основной вьюпорт — **Babylon.js** (`apps/web/src/render3d`). В панели «Каркас / Полный»
переключается облегчённый и полный режим. Старый Canvas-рендерер сохранён в
`archive/render25d-canvas` как резерв.

## Быстрый старт

```bash
# расчёт кухни 6 секций / 10 м
cd tools
python3 kitchen.py --sections "1600:2:1:Тумба,1700:2:0:Мойка,..." --out ../projects/kitchen-10m

# сборка 3D в Blender
blender -b -P blender_build.py -- ../projects/kitchen-10m/scene3d.json ../projects/kitchen-10m/renders tour
```

## Бизнес-документация

Отдельно от технических документов — в `docs/business/`:

| Файл | О чём |
|---|---|
| `business/GRANT_DOSSIER.md` | краткий пакет для гранта/эксперта |
| `business/BUSINESS_PLAN.md` | бизнес-план |
| `business/ECONOMIC_MODEL.md` | экономическая модель и сценарии |
| `business/MARKET_RESEARCH.md` | конкуренты, YouTube, Россия/СНГ |
| `business/GTM_PLAYBOOK.md` | запуск с низкими трудозатратами |
| `business/CONTENT_ENGINE.md` | мультиязычный контент-конвейер |
| `business/WHITE_LABEL_SAAS.md` | white-label SaaS + лиды |
| `business/GRANT_PLAN.md` | план подготовки к грантам/консультациям |
| `business/EXPERT_BRIEF.md` | one-pager для эксперта |
| `business/INDUSTRIAL_3D.md` | промышленное 3D: ниши, боли, цены |
| `business/VISUALIZATION_MARKET.md` | 3D-визуализация: ниши, спрос, цены |

## Документация

| Файл | О чём |
|---|---|
| `docs/00-overview.md` | Обзор и карта проекта |
| `docs/01-design-rules.md` | Деталировка, зазоры, кромка, System 32 |
| `docs/02-edging.md` | Кромкование (видимость торцов) |
| `docs/03-drilling-system32.md` | Присадка, шаг 32, петли, ящики |
| `docs/04-hardware.md` | Фурнитура и её присадка |
| `docs/05-cutting.md` | Раскрой и оптимизация |
| `docs/06-blender-pipeline.md` | 3D-сборка и анимация |
| `docs/07-video-pipeline.md` | Видео (Kdenlive/EffectCraft/FilmCraft) |
| `docs/08-product-cards.md` | Карточки товаров (PhotoCraft Data Sets) |
| `docs/09-preview-rendering.md` | Превью и рендеры |
| `docs/10-standards.md` | Принятые стандарты и решения |
| `docs/11-joints.md` | Стыки и конструкция корпуса (накладная/вкладная) |
| `docs/12-web-constructor.md` | Веб-конструктор: архитектура, стек, этапы |
| `docs/13-editor-state.md` | Состояние конструктора: что работает, ограничения, дальше |
| `docs/15-roadmap.md` | Роадмап и ресёрч SketchUp-плагинов |
| `docs/16-materials-pricing.md` | Материалы, цены, смета, партнёры |
| `docs/17-session-handoff.md` | Итоги сессии и перенос на сервер |
| `docs/glossary.md` | Глоссарий терминов |
