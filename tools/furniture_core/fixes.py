"""Подсказки «что делать» для каждой ошибки валидаторов.

Зачем: API и UI должны не просто показывать код, а говорить, что именно
сделать, и отмечать, можно ли это исправить автоматически (безопасно, без
решения человека). Единый словарь — чтобы `scene`, `layout`, `standards` и
фронтенд не расходились.

`auto=True` означает: автоплотнение (`normalize_layout`) или безопасный
сдвиг решают это без потери замысла. Всё, что меняет компоновку (перенос
двери, разрыв ряда, выбор ширины), — `auto=False`.
"""
from __future__ import annotations

from typing import Any

FIXES: dict[str, tuple[str, bool]] = {
    # геометрия комнаты
    "outside": ("Сдвинуть объект внутрь комнаты", True),
    "in-wall": ("Отодвинуть от стены вплотную к грани", True),
    "opening": ("Отодвинуть от проёма: нужен свободный подход", True),
    "opening-sweep": ("Освободить зону открывания двери", False),
    "opening-overlap": ("Развести проёмы по стене — решает человек", False),
    "below-floor": ("Поднять объект на пол", True),
    "above-ceiling": ("Уменьшить высоту или опустить объект", False),
    "front-to-wall": ("Развернуть модуль фасадом в комнату", True),
    "plinth": ("Привести цоколь в пределы корпуса", False),
    # ряды и пересечения
    "overlap": ("Раздвинуть модули: в ряду только вплотную", False),
    "gap": ("Закрыть зазор — уплотнить ряд", True),
    "row-gap-wall": ("Добавить заполнитель или сдвинуть ряд к стене", True),
    "sink-corner": ("Отодвинуть мойку/варочную от боковой стены", False),
    "socket-over-cutout": ("Перенести розетку с мойки/варочной", False),
    "cabinet-window": ("Сдвинуть навесной шкаф с окна", False),
    "cabinet-window-gap": ("Отодвинуть шкаф от окна на 80 мм", False),
    # двери и ящики
    "door-swing-wall": ("Отодвинуть модуль от стены", True),
    "door-swing-opening": ("Отодвинуть от проёма", True),
    "door-swing-instance": ("Раздвинуть модули", False),
    "door-swing-prop": ("Убрать декор из зоны створки", True),
    "door-swing-clash": ("Развести створки соседних модулей", False),
    "drawer-wall": ("Развернуть/отодвинуть модуль от стены", True),
    "drawer-instance": ("Раздвинуть модули по ходу ящика", False),
    "drawer-prop": ("Убрать декор с пути ящика", True),
    # декор
    "prop-in-wall": ("Отодвинуть декор от стены", True),
    "prop-outside": ("Вернуть декор в комнату", True),
    "prop-overlap": ("Отодвинуть декор от мебели", True),
    "prop-prop": ("Развести декор", True),
    "prop-opening": ("Убрать декор из проёма", True),
    # предметы на стене
    "wallitem": ("Перенести предмет на свободное место", True),
    "wallitem-opening": ("Убрать предмет из проёма", True),
    "wallitem-wallitem": ("Развести предметы по стене", True),
    "wallitem-outside": ("Вернуть предмет на стену", True),
    # ГОСТ/EN
    "std-worktop-height": ("Привести высоту столешницы к 850–900 мм", False),
    "std-base-height": ("Привести высоту корпуса к 700–750 мм", False),
    "std-base-depth": ("Привести глубину корпуса к 500–600 мм", False),
    "std-plinth": ("Привести цоколь к 100–150 мм", False),
    "std-wall-height": ("Привести высоту навесных к 600–900 мм", False),
    "std-wall-top": ("Опустить верх навесных ниже 2200 мм", False),
    "std-wall-depth": ("Привести глубину навесных к 280–360 мм", False),
    "std-wall-gap": ("Выдержать 450–600 мм над столешницей", False),
    "std-tip-over": ("Закрепить модуль к стене (EN 14749)", False),
    "std-door-width": ("Привести ширину створки к 300–600 мм", False),
    "std-drawer-width": ("Привести ширину фасада ящика к норме", False),
    "std-shelf-span": ("Добавить стойку: пролёт полки больше нормы", False),
    "std-bed-size": ("Привести размер к ГОСТ (900/1200/1400/1600/1800)", False),
    "std-seat-depth": ("Привести глубину сиденья к норме", False),
    "std-seat-width": ("Привести ширину места к норме", False),
    "std-chair-height": ("Привести высоту стула к норме", False),
    "std-table-height": ("Привести высоту стола к 720–780 мм", False),
}


def enrich(issue: dict[str, Any]) -> dict[str, Any]:
    """Добавить `fix` и `auto_fixable` к ошибке (идемпотентно)."""
    if "fix" in issue:
        return issue
    fix = FIXES.get(str(issue.get("code") or ""))
    if fix:
        issue["fix"], issue["auto_fixable"] = fix
    else:
        issue["fix"] = "Проверить вручную"
        issue["auto_fixable"] = False
    return issue
