"""Физические исправления ошибок валидатора для ИИ-чата.

Повторяют кнопку «Исправить» в панели расстановки: меняют параметры или
позицию модуля, а не только подсвечивают проблему. Коды, где нужно решение
человека (переставить ряд, развести створки, выбрать ширину), не трогаем —
их возвращаем как `skipped` с причиной.
"""
from __future__ import annotations

from typing import Any

from .room import _num


def _find_instance(doc: dict, instance_id: str | None) -> dict | None:
    if not instance_id:
        return None
    return next((i for i in doc.get("instances") or []
                 if isinstance(i, dict) and i.get("id") == instance_id), None)


def apply_issue_fix(
    doc: dict, code: str, instance_id: str | None = None,
) -> tuple[bool, str]:
    """Применить один фикс. Возвращает (применён, причина/что сделано)."""
    code = str(code or "")
    if code in ("row-gap-wall", "gap"):
        return True, "уплотнено нормализацией"
    inst = _find_instance(doc, instance_id)
    if inst is None:
        return False, "модуль не найден"
    p = inst.setdefault("params", {})
    room = doc.get("room") or {}
    room_h = _num(room.get("h"), 2700.0)
    H = _num(p.get("H"), 720.0)
    plinth = _num(p.get("plinthH"), 0.0)
    worktop = _num(p.get("worktopT"), 0.0)
    W = _num(p.get("W"), 600.0)
    D = _num(p.get("D"), 560.0)

    if code in ("std-wall-height", "std-wall-gap"):
        inst["z"] = 1450.0
        return True, "навесной поднят на 1450 мм"
    if code == "std-wall-top":
        inst["z"] = max(0.0, min(2150.0, room_h) - H)
        return True, "верх навесного ниже 2200 мм"
    if code == "below-floor":
        inst["z"] = 0.0
        return True, "поднят на пол"
    if code == "above-ceiling":
        total = H + plinth + worktop
        inst["z"] = max(0.0, room_h - total)
        return True, "опущен под потолок"
    if code in ("outside", "in-wall"):
        swap = abs(_num(inst.get("rot")) % 180) == 90
        w = D if swap else W
        d = W if swap else D
        inst["x"] = min(max(_num(inst.get("x")), 0.0),
                        max(0.0, _num(room.get("w"), 3600.0) - w))
        inst["y"] = min(max(_num(inst.get("y")), 0.0),
                        max(0.0, _num(room.get("d"), 2800.0) - d))
        return True, "сдвинут внутрь комнаты"
    if code in ("plinth", "std-plinth"):
        p["plinthH"] = 100.0
        return True, "цоколь 100 мм"
    if code == "std-door-width":
        p["doors"] = max(1, min(6, round(W / 500)))
        return True, f"створок: {p['doors']}"
    if code == "std-drawer-width":
        p["drawers"] = max(1, min(6, round(W / 500)))
        return True, f"ящиков: {p['drawers']}"
    if code == "std-shelf-span":
        p["dividers"] = max(1, int(-(-W // 1100)) - 1)
        return True, "добавлена стойка"
    if code == "std-base-height":
        p["H"] = 720.0
        return True, "высота корпуса 720 мм"
    if code == "std-base-depth":
        p["D"] = 560.0
        return True, "глубина 560 мм"
    if code == "std-wall-depth":
        p["D"] = 320.0
        return True, "глубина навесного 320 мм"
    if code == "std-worktop-height":
        target = 860.0 - _num(inst.get("z"), 0.0) - plinth - worktop
        p["H"] = max(200.0, round(target))
        return True, f"рабочая поверхность 860 мм (H={p['H']})"
    if code.startswith(("door-swing", "drawer-")):
        return False, "нужно решение: раздвинуть ряд или сменить фасады"
    if code == "cabinet-window":
        return False, "нужно решение: сдвинуть навесной или уменьшить окно"
    if code == "sink-corner":
        return False, "нужно решение: отодвинуть мойку от угла"
    if code.startswith("std-"):
        return False, "норматив без безопасного автофикса"
    return False, "фикс не автоматизирован"


def fix_issues(doc: dict, items: list[dict[str, Any]]) -> tuple[list[dict],
                                                                list[dict]]:
    applied: list[dict] = []
    skipped: list[dict] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        code = str(item.get("code") or "")
        iid = item.get("instance") or item.get("id")
        ok, reason = apply_issue_fix(doc, code, str(iid) if iid else None)
        row = {"code": code, "instance": iid, "reason": reason}
        (applied if ok else skipped).append(row)
    return applied, skipped
