# 26 — План исправлений по аудиту (2026-10-28)

Связан с `docs/25-full-audit-2026-10-28.md`. Статусы: ✅ сделано,
🔄 частично, ⬜ осталось.

## P0

- ✅ **P0-1. `normalize_scene` 7.1 с → ~0.56 с.** Кэш препятствий и
  локальная проверка кандидатов; полный `validate_scene` — только для
  принятого варианта. Тест: `tests/scene.py`.
- ✅ **P0-2. Preflight UI.** `POST /api/projects/validate`; `saveProject`
  проверяет текущий документ и не делает `PUT` при `errors > 0`.
  `LayoutPanel` сохраняет через `flushSave(true)` для нормализации.
- ✅ **P0-3. Cookie/secret.** `COOKIE_SECURE` default 1, `.env` = 1;
  `APP_SECRET` в compose обязателен, fallback удалён.

## P1

- ✅ **P1-1. `H_total`.** `dims.outer.H_total`, `plinth_h`, `worktop_t`;
  UI показывает полную высоту и корпус отдельно.
- ✅ **P1-2. Задняя стенка.** Зафиксировано: набивная снаружи `W×H`;
  `docs/01` исправлен, golden не менялся.
- ✅ **P1-3. Развёртки стен:** wheel-зум к курсору, панорама, кнопки
  `＋/－/⌂`; сброс при смене стены. Печать/PDF — отдельный шаг.
- ✅ **P1-4. Панель расстановки:** словарь новых кодов (`prop-*`,
  `door-*`, `drawer-*`, `wallitem*`, `plinth`, `below-floor`,
  `above-ceiling`).
- ✅ **P1-5. Ленивая загрузка:** `solveInitial`/`solveVisible`/`ensureSolved`,
  автоматический режим на CPU ≤ 4, очистка `derived` скрытых комнат,
  `POST /api/solve/batch` + `solveBatch` на клиенте (один запрос на комнату).
- ✅ **P1-6. Sequence для `checkLayout`** — старые ответы не перезаписывают
  новые.
- ✅ **P1-7. E2E:** `tests/e2e/smoke.mjs` (ПК + телефон: 3D, развёртки,
  план, возврат в 3D, ошибки консоли) в отдельной задаче CI. Сразу поймал
  `solveVisible is not defined` в `View3D`.
- ✅ **P1-8. Настенные предметы:** проверка длины стены и `wallitem ×
  wallitem`; тесты добавлены.

## P2

- ✅ **P2-1. Undo нормализации:** `pushHistory('Нормализация расстановки')`.
- ✅ **P2-2.** Rate limit на login (30/мин) и demo (10/мин), очистка гостей
  старше 7 дней при входе в демо.
- ✅ **P2-3.** Общий лимит на тяжёлые эндпоинты: solve 240/мин, batch
  120/мин, validate/preflight 240/мин, layout 300/мин, normalize 60/мин,
  PUT 180/мин. Счёт на пользователя (анонимно — на IP), 429 + `Retry-After`.
  Пороги читаются из env (`RATE_*_PER_MIN`), тесты — `tests/api.py`.
- ✅ **P2-4. Бандл:** Babylon вынесен в отдельный чанк; основной index
  ~340 KB, Babylon ~1.7 MB грузится только для 3D.
- 🔄 **P2-5. Монолитные файлы/дублирование геометрии:** материалы 3D
  теперь общие по содержимому (314 → ~110, один на цвет/текстуру),
  кадрирование вынесено в `frameNode`, добавлен `focusProp`.
  `state/project.ts` разделён: чистая геометрия — `state/geometry.ts`
  (объёмы, повороты, грани стен), типы/пресеты/нормализация —
  `state/defaults.ts`; стало 4758 → 3442 строки, старое API
  реэкспортируется. Из `ModuleWorkbench.vue` вынесены вкладки
  «Сборка» (`ModuleAssemblyTab.vue`), «Смета» (`ModuleCostTab.vue`) и
  «Фасады» (`ModuleFrontsTab.vue`): 1484 → 1068 строк, проверка —
  `tests/e2e/workbench.mjs`.
  Убраны дубли методов в `babylonScene.ts` (`setVisibleProps`,
  `applyPropVisibility`, `placeWalker`), из-за которых `tsc` падал.
- ✅ **P2-6. Дрейф документации:** счётчики тестов и остаточные
  ограничения обновлены в `docs/23`, changelog — `docs/14` §Y.
- 🔄 **P2-7. FPS/память:** HUD `?perf=1`, `window.__furniturePerf`,
  авто-качество (при < 24 FPS один раз включается каркас и render scale,
  при < 16 FPS предлагаются 2D-развёртки), `tests/e2e/perf.mjs`.
  Замеры в песочнице — software GL (1–3 FPS), нужен реальный телефон.
- ✅ **P2-8. Точность створок:** секторы учитывают блоки `fronts`
  (высота и z-диапазон створок), створки без дверей (только ящики) не
  создают зону; ход ящика = глубина корпуса − 40 мм (250…560).

## Приёмка

`tests/golden.py` (5), `geometry.py` (9), `features.py` (73),
`layout.py` (16), `scene.py` (29), `standards.py` (12), `cutting.py` (3), `api.py` (56),
`tsc`, `npm run build`,
`tests/e2e/smoke.mjs`, `tests/e2e/touch.mjs` — зелёные;
`demo`, `demo-apartment`, `demo-kitchen-2026` — 0/0; публичный
`/api/health` — 200.
Гостевые копии демо (`projects/demo-<id>/`) больше не засоряют git
(`.gitignore`) и чистятся через `prune_guests(7)`.
