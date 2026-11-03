"""Каталог инструментов для ИИ-слоя (JSON Schema, без привязки к LLM).

Серверные инструменты меняют проект через /actions (или /preview);
клиентские — камеру, выделение, вид, проект и чтение состояния в браузере.
Модель не пишет сырой project.json: только эти операции + preview/strict.
"""
from __future__ import annotations

from typing import Any


def _obj(props: dict[str, Any], required: list[str] | None = None) -> dict:
    return {
        "type": "object",
        "properties": props,
        "required": required or [],
        "additionalProperties": False,
    }


NUM = {"type": "number"}
STR = {"type": "string"}
BOOL = {"type": "boolean"}
ARR = {"type": "array", "items": NUM}
POINTS = {"type": "array", "items": {"type": "array", "items": NUM}}
OBJ = {"type": "object"}

CONFIRM = {
    "type": "boolean",
    "description": "true — человек явно подтвердил удаление/необратимое действие.",
}

DECOR_TYPES = [
    "sofa", "armchair", "bed", "coffee-table", "chair", "dresser",
    "fridge", "stove", "sink", "tv", "hood", "toilet", "bathtub",
    "vanity", "shower", "lamp", "plant", "rug",
]

MODULE_PARAMS: dict[str, str] = {
    "W": "ширина корпуса, мм",
    "H": "высота корпуса, мм",
    "D": "глубина корпуса, мм",
    "mount": "floor | wall — напольный или навесной",
    "z": "низ модуля от пола, мм (навесной обычно 1450)",
    "doors": "число створок",
    "drawers": "число ящиков",
    "shelves": "число полок",
    "dividers": "число стоек внутри",
    "plinthH": "высота цоколя, мм (0 — без цоколя)",
    "worktopT": "толщина столешницы, мм (0 — без столешницы)",
    "fronts": "компоновка фасадов сверху вниз: [{type:'doors'|'drawers', count, height?}]",
    "frame": "inset | overlay — вкладные или накладные фасады",
    "facadeMaterial": "ldsp | mdf | solid — материал фасадов",
    "facadeStyle": "handle | push — ручка или push-to-open",
    "handle": "id ручки из каталога (например bar-128)",
    "runners": "направляющие (tandem-21 и т.п.)",
    "t": "толщина ЛДСП, мм",
    "back": "none | dvp | hdf — задняя стенка",
    "backT": "толщина задней стенки, мм",
    "roof": "bool — крышка",
    "cutouts": "вырезы под мойку/варочную: [{x,y,w,h}]",
    "edges": "правила кромки: {visible, hidden, byPart}",
    "hiddenFasteners": "bool — скрытый крепёж",
}

COORDS = (
    "Координаты — миллиметры. Комната: x вправо, y в глубину плана, z вверх "
    "от пола. У модуля x/y — опорный угол подошвы: при rot=0 это левый-"
    "передний угол, модуль растёт по +x на W и по +y на D; при rot=180 "
    "модуль растёт по −x, поэтому x — ПРАВЫЙ край. Поворот rot в градусах "
    "вокруг опорного угла. У декора x/y — центр. Стены нумеруются с 0: "
    "сначала стены контура, затем перегородки.\n"
    "Для ряда вдоль стены НЕ задавай x/y: используй add_row — он поставит "
    "модули вплотную одним действием. Если координаты всё же нужны — "
    "пересчитай край с учётом rot и не загоняй корпус в стену."
)

GUIDE: list[str] = [
    "Ты — полноценный конструктор: можешь менять комнату, проёмы, стены, "
    "перегородки, предметы на стенах, мебель, материалы, раскладку и вид.",
    "Сначала пойми задачу. Если не хватает размеров/материала/сценария — "
    "задай ОДИН точный вопрос, не выдумывай числа.",
    "План действий объясни одной-двумя фразами, затем вызывай инструменты.",
    "Порядок для комнаты: resize_room → перегородки → проёмы → предметы на "
    "стенах → мебель. Если добавляешь проём там, где стоит мебель, сначала "
    "подвинь/удали мебель, потом проём.",
    "add_module без x/y сам встаёт в свободное место у стены. Указывай x/y "
    "только если человек назвал точное место.",
    "Не удаляй объекты без явного подтверждения: передавай confirm=true "
    "только когда человек попросил удалить.",
    "За один ответ — не больше 12 операций. Большую задачу дели на шаги: "
    "комната → мебель → материалы → проверка.",
    "Любое изменение попадает в предпросмотр; не говори «готово», пока "
    "человек не нажал «Применить».",
    "Для вопросов «сколько стоит / какие детали / всё ли хорошо» используй "
    "get_quote, get_parts, validate — они ничего не меняют.",
    "Если валидатор дал ошибки — вызови fix_issues с их кодами или предложи "
    "человеку выбор; не сохраняй проект с errors > 0.",
    "Материалы: set_materials меняет проект целиком, set_module_material — "
    "конкретный модуль (роль + патч цвета/названия/рисунка), "
    "set_part_material — одну деталь (part — 0-based индекс из get_parts).",
    "Корпусная мебель с раскроем — add_module. Техника и мягкая мебель "
    "(вытяжка, холодильник, плита, диван, растение, ТВ) — add_decor: это "
    "объекты сцены, они не входят в деталировку. type у декора — английский "
    "id (hood, fridge, stove, sofa…), не русское слово.",
    "Новые проекты: project_quickstart (кухня/гардероб/хранение по сценарию) "
    "или project_create (пустая комната). Текущий проект можно открыть "
    "через project_open по id из project_list.",
    "Создание/открытие проекта — отдельный шаг: не смешивай его в одном "
    "ответе с другими изменениями. Сначала открой проект, дождись "
    "результата, затем строй комнату и мебель.",
]

TOOLS: list[dict[str, Any]] = [
    # ---------- мебель ----------
    {
        "name": "add_module",
        "kind": "server",
        "implemented": True,
        "description": (
            "Добавить мебельный модуль. Пресеты: base600, base800, drawers600, "
            "drawers-cabinet, sink800, wardrobe1200, chest900, nightstand, "
            "tall600, open600, island, wall600, wall800, mix900. Можно задать "
            "свои params (W/H/D, doors/drawers/shelves, mount, plinthH, "
            "worktopT, fronts, facadeMaterial, handle…). Без x/y сервер сам "
            "поставит модуль в свободное место у стены."
        ),
        "schema": _obj({
            "preset": STR, "name": STR, "x": NUM, "y": NUM, "z": NUM,
            "rot": NUM, "params": OBJ,
        }),
    },
    {
        "name": "update_module",
        "kind": "server",
        "implemented": True,
        "description": (
            "Изменить модуль по id: позицию, поворот, имя, любые params "
            "(габариты, створки/ящики/полки, цоколь, столешница, фасады, "
            "фурнитура). Геометрия проверяется на коллизии."
        ),
        "schema": _obj({
            "id": STR, "name": STR, "x": NUM, "y": NUM, "z": NUM,
            "rot": NUM, "params": OBJ,
        }, ["id"]),
    },
    {
        "name": "add_row",
        "kind": "server",
        "implemented": True,
        "description": (
            "Поставить ряд модулей вдоль стены одним действием. items — "
            "список {preset?, params?, name?, z?}; модули встают вплотную "
            "(gap=0) или с зазором. Для кухни, гардероба, ряда тумб — "
            "предпочтительнее, чем много add_module с координатами."
        ),
        "schema": _obj({
            "wall": NUM,
            "items": {"type": "array", "items": OBJ},
            "start": NUM, "gap": NUM,
        }, ["wall", "items"]),
    },
    {
        "name": "fit_module",
        "kind": "server",
        "implemented": True,
        "description": (
            "Подогнать высоту модуля: to=ceiling — корпус до потолка "
            "(H = высота комнаты − z − цоколь − столешница); to=worktop — "
            "рабочая поверхность на target мм (по умолчанию 900)."
        ),
        "schema": _obj({
            "id": STR,
            "to": {"type": "string", "enum": ["ceiling", "worktop"]},
            "target": NUM,
        }, ["id"]),
    },
    {
        "name": "duplicate_module",
        "kind": "server",
        "implemented": True,
        "description": "Скопировать модуль: копия встаёт вплотную или в свободное место.",
        "schema": _obj({"id": STR, "name": STR}, ["id"]),
    },
    {
        "name": "delete_module",
        "kind": "server",
        "implemented": True,
        "description": "Удалить модуль. Только при confirm=true.",
        "schema": _obj({"id": STR, "confirm": CONFIRM}, ["id"]),
    },
    # ---------- комната ----------
    {
        "name": "resize_room",
        "kind": "server",
        "implemented": True,
        "description": (
            "Размеры и форма комнаты: w/d/h/wallT в мм, shape 'rect' или 'l' "
            "(cutW/cutD), либо произвольный контур outline [[x,y],…]. "
            "Проёмы и предметы на стенах подгоняются; мебель не двигается — "
            "если она не влезла, валидатор покажет ошибки."
        ),
        "schema": _obj({
            "w": NUM, "d": NUM, "h": NUM, "wallT": NUM,
            "shape": {"type": "string", "enum": ["rect", "l"]},
            "cutW": NUM, "cutD": NUM,
            "outline": POINTS,
        }),
    },
    {
        "name": "set_room",
        "kind": "server",
        "implemented": True,
        "description": (
            "Настройки комнаты, не геометрия: пол/потолок (enabled, material, t), "
            "названия зон и прочие поля room. Размеры/контур — resize_room."
        ),
        "schema": _obj({"patch": OBJ}, ["patch"]),
    },
    {
        "name": "add_partition",
        "kind": "server",
        "implemented": True,
        "description": (
            "Добавить перегородку a=[x,y] → b=[x,y] (мм), wallT. Без координат — "
            "по центру комнаты от стены до стены."
        ),
        "schema": _obj({"a": ARR, "b": ARR, "wallT": NUM}),
    },
    {
        "name": "update_partition",
        "kind": "server",
        "implemented": True,
        "description": "Изменить перегородку по index (0-based) или patch a/b/wallT.",
        "schema": _obj({"index": NUM, "patch": OBJ}, ["index"]),
    },
    {
        "name": "delete_partition",
        "kind": "server",
        "implemented": True,
        "description": (
            "Удалить перегородку по index. Если на ней есть проёмы/предметы — "
            "сначала уберите их."
        ),
        "schema": _obj({"index": NUM}, ["index"]),
    },
    {
        "name": "add_opening",
        "kind": "server",
        "implemented": True,
        "description": (
            "Окно/дверь/арка в стене: kind, wall (индекс), x (от начала стены), "
            "w, z0/z1 для окна. Без x — свободный участок. Не даст поставить "
            "проём за стену, на другой проём или на мебель."
        ),
        "schema": _obj({
            "kind": {"type": "string", "enum": ["window", "door", "arch"]},
            "wall": NUM, "x": NUM, "w": NUM, "z0": NUM, "z1": NUM,
            "hinge": {"type": "string", "enum": ["left", "right"]},
            "angle": NUM,
        }, ["kind", "wall"]),
    },
    {
        "name": "update_opening",
        "kind": "server",
        "implemented": True,
        "description": "Изменить проём по id (patch: kind/wall/x/w/z0/z1/hinge/angle).",
        "schema": _obj({"id": STR, "patch": OBJ}, ["id"]),
    },
    {
        "name": "delete_opening",
        "kind": "server",
        "implemented": True,
        "description": "Удалить проём. Только при confirm=true.",
        "schema": _obj({"id": STR, "confirm": CONFIRM}, ["id"]),
    },
    {
        "name": "add_wall_item",
        "kind": "server",
        "implemented": True,
        "description": (
            "Розетка/выключатель/полка/зеркало на стене. Без x — свободное "
            "место вдоль стены. Проверяются проёмы, мебель и другие предметы."
        ),
        "schema": _obj({
            "kind": {"type": "string",
                     "enum": ["socket", "switch", "shelf", "mirror"]},
            "wall": NUM, "x": NUM, "z": NUM, "w": NUM, "h": NUM, "depth": NUM,
        }, ["kind", "wall"]),
    },
    {
        "name": "update_wall_item",
        "kind": "server",
        "implemented": True,
        "description": "Изменить предмет на стене по id (patch).",
        "schema": _obj({"id": STR, "patch": OBJ}, ["id"]),
    },
    {
        "name": "delete_wall_item",
        "kind": "server",
        "implemented": True,
        "description": "Удалить предмет со стены. Только при confirm=true.",
        "schema": _obj({"id": STR, "confirm": CONFIRM}, ["id"]),
    },
    # ---------- декор ----------
    {
        "name": "add_decor",
        "kind": "server",
        "implemented": True,
        "description": (
            "Добавить декор/мебель сцены (диван, растение, техника). type — "
            "английский id из списка; без x/y — свободное место."
        ),
        "schema": _obj({
            "type": {"type": "string", "enum": DECOR_TYPES},
            "name": STR, "x": NUM, "y": NUM, "z": NUM,
            "rot": NUM, "w": NUM, "d": NUM, "h": NUM, "color": STR,
        }),
    },
    {
        "name": "update_decor",
        "kind": "server",
        "implemented": True,
        "description": "Изменить декор по id (patch).",
        "schema": _obj({"id": STR, "patch": OBJ}, ["id"]),
    },
    {
        "name": "delete_decor",
        "kind": "server",
        "implemented": True,
        "description": "Удалить декор. Только при confirm=true.",
        "schema": _obj({"id": STR, "confirm": CONFIRM}, ["id"]),
    },
    # ---------- материалы и глобали ----------
    {
        "name": "set_materials",
        "kind": "server",
        "implemented": True,
        "description": (
            "Материалы проекта (merge в materials): corpus, facade, worktop, "
            "plinth, back, drawer. Поля: name, color, accent, pattern, texScale."
        ),
        "schema": _obj({"materials": OBJ}, ["materials"]),
    },
    {
        "name": "set_module_material",
        "kind": "server",
        "implemented": True,
        "description": (
            "Материал одного модуля: role (corpus/facade/worktop/plinth/back/"
            "drawer) + patch (name/color/accent/pattern/texScale)."
        ),
        "schema": _obj({
            "id": STR,
            "role": {"type": "string",
                     "enum": ["corpus", "facade", "worktop", "plinth",
                              "back", "drawer"]},
            "patch": OBJ,
        }, ["id", "role", "patch"]),
    },
    {
        "name": "set_part_material",
        "kind": "client",
        "implemented": True,
        "description": (
            "Материал ОДНОЙ детали модуля: id, part (0-based индекс из "
            "get_parts/контекста), patch (name/color/accent/pattern/texScale). "
            "Например «полку — дубом, фасад — графитом»."
        ),
        "schema": _obj({
            "id": STR, "part": NUM,
            "patch": _obj({
                "name": STR, "color": STR, "accent": STR,
                "pattern": {"type": "string",
                            "enum": ["solid", "wood", "stone", "metal"]},
                "texScale": NUM,
            }),
        }, ["part", "patch"]),
    },
    {
        "name": "reset_part_material",
        "kind": "client",
        "implemented": True,
        "description": "Сбросить материал отдельной детали (id, part).",
        "schema": _obj({"id": STR, "part": NUM}, ["part"]),
    },
    {
        "name": "set_globals",
        "kind": "server",
        "implemented": True,
        "description": (
            "Глобальные параметры проекта: t (толщина), gaps (gapSide/"
            "gapBetween/gapTop/gapBottom), plinthH, worktopT, hardware, "
            "facadeMaterial и т.п."
        ),
        "schema": _obj({"patch": OBJ}, ["patch"]),
    },
    # ---------- раскладка и проверка ----------
    {
        "name": "normalize_layout",
        "kind": "server",
        "implemented": True,
        "description": "Прижать модули к стенам, закрыть зазоры, развернуть фасады, развести декор.",
        "schema": _obj({"close_gaps": BOOL, "fix_decor": BOOL}),
    },
    {
        "name": "fix_issues",
        "kind": "server",
        "implemented": True,
        "description": (
            "Исправить ошибки валидатора: передай issues [{code, instance}] "
            "(из validate/layout). Что можно — поправит параметрами/позицией, "
            "затем уплотнит ряд. Небезопасные оставит в skipped."
        ),
        "schema": _obj({
            "issues": {"type": "array", "items": OBJ},
            "normalize": BOOL,
        }),
    },
    {
        "name": "rename_project",
        "kind": "server",
        "implemented": True,
        "description": "Переименовать текущий проект.",
        "schema": _obj({"name": STR}, ["name"]),
    },
    # ---------- папки ----------
    {
        "name": "add_folder",
        "kind": "server",
        "implemented": True,
        "description": "Создать папку/зону и положить в неё модули (ids).",
        "schema": _obj({"name": STR, "ids": {"type": "array", "items": STR}}),
    },
    {
        "name": "update_folder",
        "kind": "server",
        "implemented": True,
        "description": "Переименовать папку или заменить состав ids.",
        "schema": _obj({"id": STR, "name": STR,
                        "ids": {"type": "array", "items": STR}}, ["id"]),
    },
    {
        "name": "delete_folder",
        "kind": "server",
        "implemented": True,
        "description": "Удалить папку (модули остаются в проекте).",
        "schema": _obj({"id": STR}, ["id"]),
    },
    {
        "name": "preview_actions",
        "kind": "server",
        "implemented": True,
        "description": (
            "Предпросмотр пакета низкоуровневых операций (op: add_instance, "
            "update_instance, resize_room, …; НЕ имена инструментов). "
            "Обычно не нужен: просто вызывай инструменты."
        ),
        "schema": _obj({"actions": {"type": "array", "items": OBJ}},
                       ["actions"]),
    },
    # ---------- чтение состояния (клиент) ----------
    {
        "name": "validate",
        "kind": "client",
        "implemented": True,
        "description": (
            "Проверить текущий проект: ошибки/предупреждения с кодами, "
            "подсказками fix и auto_fixable. Ничего не меняет."
        ),
        "schema": _obj({}),
    },
    {
        "name": "get_quote",
        "kind": "client",
        "implemented": True,
        "description": "Смета проекта: итог по валютам и стоимость по модулям.",
        "schema": _obj({}),
    },
    {
        "name": "get_parts",
        "kind": "client",
        "implemented": True,
        "description": "Деталировка модуля: список деталей с размерами (по id или выделенному).",
        "schema": _obj({"id": STR}),
    },
    # ---------- проекты (клиент) ----------
    {
        "name": "project_list",
        "kind": "client",
        "implemented": True,
        "description": "Список проектов пользователя (id, имя, дата).",
        "schema": _obj({}),
    },
    {
        "name": "project_open",
        "kind": "client",
        "implemented": True,
        "description": "Открыть существующий проект по id.",
        "schema": _obj({"id": STR}, ["id"]),
    },
    {
        "name": "project_create",
        "kind": "client",
        "implemented": True,
        "description": "Создать пустой проект и открыть его (комната по умолчанию).",
        "schema": _obj({"name": STR}, ["name"]),
    },
    {
        "name": "project_quickstart",
        "kind": "client",
        "implemented": True,
        "description": (
            "Создать проект «под ключ»: комната + проёмы/розетки + сценарий "
            "(kitchen/wardrobe/storage) с готовой мебелью. Открывает новый проект."
        ),
        "schema": _obj({
            "name": STR,
            "room": _obj({
                "w": NUM, "d": NUM, "h": NUM, "wallT": NUM,
                "shape": {"type": "string", "enum": ["rect", "l"]},
                "cutW": NUM, "cutD": NUM,
            }),
            "kind": {"type": "string",
                     "enum": ["kitchen", "wardrobe", "storage"]},
            "wall": NUM,
            "openings": {"type": "array", "items": _obj({
                "kind": {"type": "string", "enum": ["window", "door"]},
                "wall": NUM, "x": NUM, "w": NUM, "z0": NUM, "z1": NUM,
            }, ["kind", "wall", "x", "w"])},
            "sockets": {"type": "array", "items": _obj({
                "kind": {"type": "string", "enum": ["socket", "switch"]},
                "wall": NUM, "x": NUM, "z": NUM,
            }, ["wall", "x"])},
            "height": NUM,
        }, ["name", "kind", "wall"]),
    },
    {
        "name": "version_create",
        "kind": "client",
        "implemented": True,
        "description": "Сохранить версию проекта (снимок) с именем.",
        "schema": _obj({"name": STR}),
    },
    {
        "name": "version_list",
        "kind": "client",
        "implemented": True,
        "description": "Список версий текущего проекта.",
        "schema": _obj({}),
    },
    {
        "name": "version_restore",
        "kind": "client",
        "implemented": True,
        "description": "Откатить текущий проект к версии по id.",
        "schema": _obj({"id": STR}, ["id"]),
    },
    {
        "name": "project_delete",
        "kind": "client",
        "implemented": True,
        "description": "Удалить проект по id (кроме текущего). Только при confirm=true.",
        "schema": _obj({"id": STR, "confirm": CONFIRM}, ["id"]),
    },
    # ---------- интерфейс / вид ----------
    {
        "name": "camera_set",
        "kind": "client",
        "implemented": True,
        "description": "Поставить камеру: alpha/beta (град), радиус, цель [x,y,z] (метры).",
        "schema": _obj({"alpha": NUM, "beta": NUM, "radius": NUM,
                        "target": ARR}),
    },
    {
        "name": "camera_focus",
        "kind": "client",
        "implemented": True,
        "description": "Сфокусировать камеру на выделенном/модуле/комнате, вид iso/front/side/top.",
        "schema": _obj({
            "target": {"type": "string", "enum": ["selected", "room"]},
            "id": STR, "view": {"type": "string",
                                "enum": ["iso", "front", "side", "top"]},
        }),
    },
    {
        "name": "selection_set",
        "kind": "client",
        "implemented": True,
        "description": "Выделить модуль, деталь, стену, проём или декор.",
        "schema": _obj({
            "kind": {"type": "string",
                     "enum": ["module", "part", "wall", "opening", "prop"]},
            "id": STR, "part": NUM,
        }, ["kind"]),
    },
    {
        "name": "select_all",
        "kind": "client",
        "implemented": True,
        "description": "Выделить все модули.",
        "schema": _obj({}),
    },
    {
        "name": "toggle_part",
        "kind": "client",
        "implemented": True,
        "description": "Открыть/закрыть створки или ящики модуля для проверки.",
        "schema": _obj({
            "id": STR,
            "kind": {"type": "string", "enum": ["door", "drawer"]},
        }, ["id", "kind"]),
    },
    {
        "name": "view_mode",
        "kind": "client",
        "implemented": True,
        "description": "Режим отрисовки: realistic/schematic/blueprint.",
        "schema": _obj({"mode": {"type": "string",
                                 "enum": ["realistic", "schematic", "blueprint"]}},
                       ["mode"]),
    },
    {
        "name": "walls_mode",
        "kind": "client",
        "implemented": True,
        "description": "Стены: cutaway (срез) или all (все).",
        "schema": _obj({"mode": {"type": "string", "enum": ["cutaway", "all"]}},
                       ["mode"]),
    },
    {
        "name": "dims_set",
        "kind": "client",
        "implemented": True,
        "description": "Размеры: внутри, снаружи, все зазоры.",
        "schema": _obj({"inside": BOOL, "outside": BOOL, "gaps": BOOL}),
    },
    {
        "name": "ui_panel",
        "kind": "client",
        "implemented": True,
        "description": (
            "Открыть/закрыть панель: object (карточка), workbench (конструктор "
            "модуля), layout (проверка), add (добавить), result, quote, "
            "versions, settings, plan (2D-план), draft (2D-развёртки), "
            "presentation, ai."
        ),
        "schema": _obj({
            "panel": {"type": "string",
                      "enum": ["object", "workbench", "layout", "add",
                               "result", "quote", "versions", "settings",
                               "plan", "draft", "presentation", "ai"]},
            "open": BOOL, "id": STR,
        }, ["panel"]),
    },
    {
        "name": "undo",
        "kind": "client",
        "implemented": True,
        "description": "Отменить последнее действие.",
        "schema": _obj({}),
    },
    {
        "name": "redo",
        "kind": "client",
        "implemented": True,
        "description": "Вернуть отменённое действие.",
        "schema": _obj({}),
    },
    {
        "name": "save",
        "kind": "client",
        "implemented": True,
        "description": "Сохранить проект сейчас.",
        "schema": _obj({}),
    },
    {
        "name": "export_file",
        "kind": "client",
        "implemented": True,
        "description": "Скачать файл: quote (PDF КП), svg (раскрой), dxf (детали), xlsx (спецификация).",
        "schema": _obj({"format": {"type": "string",
                                   "enum": ["quote", "svg", "dxf", "xlsx"]}},
                       ["format"]),
    },
    {
        "name": "scene_screenshot",
        "kind": "client",
        "implemented": True,
        "description": "Снимок 3D-канваса для человека (JPEG data URL, maxWidth).",
        "schema": _obj({"max_width": NUM}),
    },
]

RULES = [
    "Сначала прочитай контекст: камера, выделение, комната, стены, объекты, ошибки.",
    "Любое изменение — через инструменты; сырой project.json не пиши.",
    "Предпросмотр обязателен: покажи diff, ошибки и цену, не утверждай, что применено.",
    "Не сохраняй проект с errors > 0; используй strict=true.",
    "Не выдумывай размеры и артикулы; бери из контекста/каталога.",
    "Полная высота модуля = plinthH + H + worktopT. Для шкафа до потолка "
    "используй fit_module to=ceiling; для рабочей поверхности 900 — "
    "fit_module to=worktop. Иначе верх легко выйдет за потолок.",
    "Для ряда/кухни/гардероба используй add_row, а не набор add_module "
    "с координатами. Меняя ширину у стены, не сдвигай корпус в стену: "
    "подбери x/y или не задавай их.",
    "Если validate нашёл ошибки — вызови fix_issues один раз с этими "
    "ошибками; не смешивай его с другими правками в одном пакете.",
    "validate проверяет СОХРАНЁННЫЙ проект и не видит неприменённый "
    "предпросмотр. Не вызывай его, чтобы проверить свой же пакет: ошибки "
    "пакета покажет предпросмотр, и их можно исправить следующим раундом.",
    "Не удаляй объекты без явного подтверждения (confirm=true).",
    "Максимум 12 операций за пакет.",
]


def tools_payload() -> dict[str, Any]:
    from .actions import MATERIAL_ROLES, MODULE_PRESETS
    return {
        "schema": "furniture/ai-tools@2",
        "presets": [
            {"key": p["key"], "label": p["label"], "group": p.get("group")}
            for p in MODULE_PRESETS
        ],
        "module_params": MODULE_PARAMS,
        "decor_types": DECOR_TYPES,
        "material_roles": sorted(MATERIAL_ROLES),
        "coords": COORDS,
        "preview": "POST /api/projects/{id}/preview",
        "apply": "POST /api/projects/{id}/actions {commit:true, strict:true}",
        "context": "камера, выделение, комната, стены, объекты, ошибки — собирает клиент",
        "tools": TOOLS,
        "rules": RULES,
        "guide": GUIDE,
    }
