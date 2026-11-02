"""Каталог инструментов для ИИ-слоя (JSON Schema, без привязки к LLM).

Серверные инструменты меняют проект через /actions (или /preview);
клиентские — камеру, выделение, вид и размеры в браузере. Модель не пишет
сырой project.json: только эти операции + preview/strict.
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

TOOLS: list[dict[str, Any]] = [
    {
        "name": "add_module",
        "kind": "server",
        "action": "add_instance",
        "implemented": True,
        "description": "Добавить модуль из пресета: base600, base800, drawers600, drawers-cabinet, sink800, wardrobe1200, chest900, nightstand, tall600, open600, island, wall600, wall800, mix900.",
        "schema": _obj({
            "preset": STR, "name": STR, "x": NUM, "y": NUM, "z": NUM,
            "rot": NUM, "params": {"type": "object"},
        }),
    },
    {
        "name": "update_module",
        "kind": "server",
        "action": "update_instance",
        "implemented": True,
        "description": "Изменить параметры/позицию/поворот модуля по id.",
        "schema": _obj({
            "id": STR, "name": STR, "x": NUM, "y": NUM, "z": NUM,
            "rot": NUM, "params": {"type": "object"},
        }, ["id"]),
    },
    {
        "name": "delete_module",
        "kind": "server",
        "action": "delete_instance",
        "implemented": True,
        "description": "Удалить модуль (только после подтверждения человека).",
        "schema": _obj({"id": STR}, ["id"]),
    },
    {
        "name": "add_opening",
        "kind": "server",
        "action": "add_opening",
        "implemented": True,
        "description": "Добавить окно/дверь/арку в стену.",
        "schema": _obj({
            "kind": {"type": "string", "enum": ["window", "door", "arch"]},
            "wall": NUM, "x": NUM, "w": NUM, "z0": NUM, "z1": NUM,
        }, ["kind", "wall"]),
    },
    {
        "name": "update_opening",
        "kind": "server",
        "implemented": True,
        "description": "Изменить проём по id (patch).",
        "schema": _obj({"id": STR, "patch": {"type": "object"}}, ["id"]),
    },
    {
        "name": "delete_opening",
        "kind": "server",
        "implemented": True,
        "description": "Удалить проём по id.",
        "schema": _obj({"id": STR}, ["id"]),
    },
    {
        "name": "add_wall_item",
        "kind": "server",
        "implemented": True,
        "description": "Розетка/выключатель/полка/зеркало на стене.",
        "schema": _obj({
            "kind": STR, "wall": NUM, "x": NUM, "z": NUM, "w": NUM,
            "h": NUM, "depth": NUM,
        }, ["kind", "wall"]),
    },
    {
        "name": "update_wall_item",
        "kind": "server",
        "implemented": True,
        "description": "Изменить предмет на стене по id (patch).",
        "schema": _obj({"id": STR, "patch": {"type": "object"}}, ["id"]),
    },
    {
        "name": "delete_wall_item",
        "kind": "server",
        "implemented": True,
        "description": "Удалить предмет со стены по id.",
        "schema": _obj({"id": STR}, ["id"]),
    },
    {
        "name": "add_decor",
        "kind": "server",
        "implemented": True,
        "description": "Добавить декор/мебель сцены (диван, растение, техника).",
        "schema": _obj({
            "type": STR, "name": STR, "x": NUM, "y": NUM, "z": NUM,
            "rot": NUM, "w": NUM, "d": NUM, "h": NUM, "color": STR,
        }),
    },
    {
        "name": "update_decor",
        "kind": "server",
        "implemented": True,
        "description": "Изменить декор по id (patch).",
        "schema": _obj({"id": STR, "patch": {"type": "object"}}, ["id"]),
    },
    {
        "name": "delete_decor",
        "kind": "server",
        "implemented": True,
        "description": "Удалить декор по id.",
        "schema": _obj({"id": STR}, ["id"]),
    },
    {
        "name": "set_room",
        "kind": "server",
        "action": "set_room",
        "implemented": True,
        "description": "Изменить комнату: размеры, контур, перегородки.",
        "schema": _obj({"patch": {"type": "object"}}, ["patch"]),
    },
    {
        "name": "set_globals",
        "kind": "server",
        "action": "set_globals",
        "implemented": True,
        "description": "Глобальные параметры проекта (толщина, зазоры, материалы).",
        "schema": _obj({"patch": {"type": "object"}}, ["patch"]),
    },
    {
        "name": "set_materials",
        "kind": "server",
        "implemented": True,
        "description": "Материалы проекта (merge в materials).",
        "schema": _obj({"materials": {"type": "object"}}),
    },
    {
        "name": "normalize_layout",
        "kind": "server",
        "implemented": True,
        "description": "Прижать ряд к стене, уплотнить, развернуть фасады.",
        "schema": _obj({"fix_decor": BOOL}),
    },
    {
        "name": "preview_actions",
        "kind": "server",
        "implemented": True,
        "description": "Применить пакет в памяти: diff, ошибки, цена. Ничего не сохраняет.",
        "schema": _obj({"actions": {"type": "array", "items": {"type": "object"}}},
                       ["actions"]),
    },
    {
        "name": "validate",
        "kind": "server",
        "implemented": True,
        "description": "Проверить проект без сохранения (plan/scene/standards).",
        "schema": _obj({}),
    },
    {
        "name": "camera_set",
        "kind": "client",
        "implemented": True,
        "description": "Поставить камеру: угол alpha/beta (град), радиус, цель.",
        "schema": _obj({"alpha": NUM, "beta": NUM, "radius": NUM,
                        "target": {"type": "array", "items": NUM}}),
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
        "description": "Включить/выключить размеры: внутри, снаружи, все зазоры.",
        "schema": _obj({"inside": BOOL, "outside": BOOL, "gaps": BOOL}),
    },
    {
        "name": "scene_screenshot",
        "kind": "client",
        "implemented": True,
        "description": "Снимок 3D-канваса для зрения (JPEG data URL, maxWidth).",
        "schema": _obj({"max_width": NUM}),
    },
]

RULES = [
    "Сначала прочитай контекст: камера, выделение, комната, объекты, ошибки.",
    "Любое изменение — через preview_actions: покажи diff, ошибки и цену.",
    "Применяй только после подтверждения человека; один пакет — один undo.",
    "Не сохраняй проект с errors > 0; используй strict=true.",
    "Не выдумывай размеры и артикулы; бери из контекста/каталога.",
    "Не удаляй объекты без явного подтверждения.",
    "Максимум N операций за пакет (по умолчанию 8).",
]


def tools_payload() -> dict[str, Any]:
    from .actions import MODULE_PRESETS
    return {
        "schema": "furniture/ai-tools@1",
        "presets": [
            {"key": p["key"], "label": p["label"], "group": p.get("group")}
            for p in MODULE_PRESETS
        ],
        "preview": "POST /api/projects/{id}/preview",
        "apply": "POST /api/projects/{id}/actions {commit:true, strict:true}",
        "context": "камера, выделение, комната, объекты, ошибки — собирает клиент",
        "tools": TOOLS,
        "rules": RULES,
    }
