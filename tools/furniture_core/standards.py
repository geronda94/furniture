"""Эргономика и безопасность мебели по ГОСТ/EN.

Источники (см. `docs/29-furniture-standards.md`):
* ГОСТ 13025.1-85 — кухонные шкафы, отделения для хранения;
* ГОСТ 13025.2-85 — мебель для сидения и лежания (диваны, кресла, кровати);
* ГОСТ 13025.3-85 — столы, высота рабочей плоскости и посадки;
* ГОСТ 16371-2014 — общие технические условия, безопасность;
* EN 1116:2018 — координирующие размеры кухни;
* EN 14749:2016+A1:2022 — устойчивость шкафов, защита от опрокидывания.

Модуль не заменяет проверки `layout.py`/`scene.py`: он добавляет
эргономические и «паспортные» ограничения на размеры изделий.
"""
from __future__ import annotations

import math
from typing import Any

from .fixes import enrich
from .layout import room_walls

# --- ГОСТ 13025.1-85, кухня ------------------------------------------------
WORKTOP_MIN, WORKTOP_MAX = 850.0, 900.0
WORKTOP_HARD_MIN, WORKTOP_HARD_MAX = 800.0, 920.0
PLINTH_HARD_MIN = 80.0
PLINTH_REC_MIN, PLINTH_REC_MAX = 100.0, 150.0
BASE_H_MIN, BASE_H_MAX = 700.0, 750.0
BASE_D_MIN, BASE_D_MAX = 500.0, 600.0
WALL_D_MIN, WALL_D_MAX = 280.0, 360.0
WALL_Z_MIN, WALL_Z_MAX = 1350.0, 1500.0
WALL_TOP_MAX = 2200.0
WALL_GAP_MIN, WALL_GAP_MAX = 450.0, 750.0

# --- ГОСТ 16371-2014 / EN ------------------------------------------------
DOOR_LEAF_MAX = 600.0
DOOR_LEAF_WARN = 595.0
DRAWER_FRONT_MAX = 900.0
SHELF_SPAN_16 = 900.0
SHELF_SPAN_18 = 1000.0
SHELF_SPAN_HARD = 1100.0
TALL_ANCHOR_H = 1800.0

# --- ГОСТ 13025.2-85 ------------------------------------------------------
BED_WIDTHS = {700, 800, 900, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800}
BED_LEN_MIN, BED_LEN_MAX = 1860.0, 2050.0
SOFA_DEPTH = (800.0, 1000.0)
ARMCHAIR_DEPTH = (780.0, 1000.0)

# --- ГОСТ 13025.3-85 ------------------------------------------------------
TABLE_H = (700.0, 780.0)
COFFEE_TABLE_H = (350.0, 500.0)
CHAIR_H = (800.0, 950.0)


def _num(v: Any, default: float = 0.0) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return f if f == f and abs(f) != float("inf") else default


def _issue(
    code: str, level: str, message: str, *,
    instance: str | None = None, prop: str | None = None,
    name: str | None = None,
) -> dict[str, Any]:
    return enrich({
        "code": code, "level": level, "message": message,
        "instance": instance, "prop": prop, "name": name,
    })


def _leaf_width(p: dict) -> tuple[float, float]:
    """Ширина секции и ширина одной створки (оценка по fronts/doors)."""
    t = _num(p.get("t"), 16)
    gap_side = _num(p.get("gapSide"), 2)
    gap_between = _num(p.get("gapBetween"), 3)
    fronts = p.get("fronts")
    if isinstance(fronts, list) and fronts:
        widest = 0.0
        count = 0
        for b in fronts:
            if isinstance(b, dict) and b.get("type") == "doors":
                c = max(1, int(_num(b.get("count"), 1)))
                count += c
                widest = max(widest, c)
        if count:
            return _num(p.get("W"), 0), (
                _num(p.get("W"), 0) - 2 * gap_side -
                (widest - 1) * gap_between) / widest
        return _num(p.get("W"), 0), 0.0
    n = max(0, int(_num(p.get("doors"), 0)))
    if not n:
        return _num(p.get("W"), 0), 0.0
    w = _num(p.get("W"), 0)
    return w, (w - 2 * gap_side - (n - 1) * gap_between) / n


def _near_wall(inst: dict, room: dict, tol: float = 120.0) -> bool:
    """Задняя грань модуля прижата к стене/перегородке (в пределах tol)."""
    p = inst.get("params") or {}
    W = _num(p.get("W"), 0)
    D = _num(p.get("D"), 0)
    rot = math.radians(_num(inst.get("rot")))
    cs, sn = math.cos(rot), math.sin(rot)
    cx = _num(inst.get("x")) + (W / 2) * cs - (D / 2) * sn
    cy = _num(inst.get("y")) + (W / 2) * sn + (D / 2) * cs
    bx = cx - sn * (D / 2)
    by = cy + cs * (D / 2)
    for w in room_walls(room):
        dx, dy = w.bx - w.ax, w.by - w.ay
        l2 = dx * dx + dy * dy
        if l2 < 1:
            continue
        t = max(0.0, min(1.0, ((bx - w.ax) * dx + (by - w.ay) * dy) / l2))
        px, py = w.ax + dx * t, w.ay + dy * t
        dist = math.hypot(bx - px, by - py)
        # Наружная стена: линия — внутренняя грань. Перегородка: осевая.
        face = 0.0 if w.outer else w.t / 2
        if abs(dist - face) <= tol:
            return True
    return False


def tip_energy(inst: dict) -> float:
    """Потенциальная энергия опрокидывания, Н·м (EN 14749: порог 60)."""
    p = inst.get("params") or {}
    W = _num(p.get("W"), 0) / 1000
    D = _num(p.get("D"), 0) / 1000
    H = (_num(p.get("H"), 0) + _num(p.get("plinthH"), 0)) / 1000
    mass = max(5.0, W * D * H * 650.0) + 10.0
    return mass * 9.81 * max(0.2, H / 2)


def validate_standards(project: dict) -> list[dict[str, Any]]:
    """Проверить размеры изделий на соответствие ГОСТ/EN."""
    room = project.get("room") or {}
    room_h = _num(room.get("h"), 2700)
    instances = project.get("instances") or []
    props = project.get("props") or []
    out: list[dict[str, Any]] = []

    # --- корпусная мебель ---------------------------------------------------
    for inst in instances:
        if not isinstance(inst, dict):
            continue
        p = inst.get("params") or {}
        iid = str(inst.get("id") or "")
        name = str(inst.get("name") or iid)
        mount = str(p.get("mount") or "floor")
        z = _num(inst.get("z"), 0)
        H = _num(p.get("H"), 720)
        W = _num(p.get("W"), 600)
        D = _num(p.get("D"), 560)
        t = _num(p.get("t"), 16)
        plinth = _num(p.get("plinthH"), 0)
        worktop = _num(p.get("worktopT"), 0)

        # Кухонный напольный модуль: высота рабочей поверхности.
        if mount != "wall" and worktop > 0:
            surface = z + plinth + H + worktop
            if not WORKTOP_HARD_MIN <= surface <= WORKTOP_HARD_MAX:
                out.append(_issue(
                    "std-worktop-height", "error",
                    f"высота рабочей поверхности {surface:.0f} мм вне "
                    f"{WORKTOP_HARD_MIN:.0f}–{WORKTOP_HARD_MAX:.0f} мм "
                    "(ГОСТ 13025.1: 850–900)",
                    instance=iid, name=name))
            elif not WORKTOP_MIN <= surface <= WORKTOP_MAX:
                out.append(_issue(
                    "std-worktop-height", "warning",
                    f"высота рабочей поверхности {surface:.0f} мм; "
                    "стандарт 850–900 мм (ГОСТ 13025.1)",
                    instance=iid, name=name))
            # Острова и тумбы без цоколя — не «базовый ряд кухни».
            if plinth > 0 and not BASE_H_MIN <= H <= BASE_H_MAX:
                out.append(_issue(
                    "std-base-height", "warning",
                    f"высота корпуса {H:.0f} мм; стандарт 700–750 мм",
                    instance=iid, name=name))
            if plinth > 0 and not BASE_D_MIN <= D <= BASE_D_MAX:
                out.append(_issue(
                    "std-base-depth", "warning",
                    f"глубина корпуса {D:.0f} мм; стандарт 500–600 мм",
                    instance=iid, name=name))

        # Цоколь: не ниже 80 мм (ГОСТ 13025.1), лучше 100–150.
        if mount != "wall" and plinth > 0:
            if plinth < PLINTH_HARD_MIN:
                out.append(_issue(
                    "std-plinth", "error",
                    f"цоколь {plinth:.0f} мм — меньше минимума "
                    f"{PLINTH_HARD_MIN:.0f} мм (ГОСТ 13025.1)",
                    instance=iid, name=name))
            elif not PLINTH_REC_MIN <= plinth <= PLINTH_REC_MAX:
                out.append(_issue(
                    "std-plinth", "warning",
                    f"цоколь {plinth:.0f} мм; рекомендуется 100–150 мм",
                    instance=iid, name=name))

        # Навесные шкафы: низ 1350–1500, верх ≤2150, глубина 280–360.
        if mount == "wall":
            top = z + H
            # антресоль над навесными — отдельный ряд, не «рабочий» шкаф
            annex = z >= 2100
            if z < 1100:
                out.append(_issue(
                    "std-wall-height", "error",
                    f"низ навесного шкафа на {z:.0f} мм — ниже 1100 мм, "
                    "опасно для головы",
                    instance=iid, name=name))
            elif not annex and not WALL_Z_MIN <= z <= WALL_Z_MAX:
                out.append(_issue(
                    "std-wall-height", "warning",
                    f"низ навесного шкафа {z:.0f} мм; стандарт 1350–1500 мм",
                    instance=iid, name=name))
            if top > room_h:
                out.append(_issue(
                    "std-wall-top", "error",
                    f"верх навесного шкафа {top:.0f} мм выше потолка "
                    f"{room_h:.0f} мм",
                    instance=iid, name=name))
            elif not annex and top > WALL_TOP_MAX:
                out.append(_issue(
                    "std-wall-top", "warning",
                    f"верх навесного шкафа {top:.0f} мм; обычно ≤2150 мм",
                    instance=iid, name=name))
            if not WALL_D_MIN <= D <= WALL_D_MAX:
                out.append(_issue(
                    "std-wall-depth", "warning",
                    f"глубина навесного {D:.0f} мм; стандарт 280–360 мм",
                    instance=iid, name=name))

        # Высокие шкафы: обязательное крепление к стене (EN 14749).
        if (mount != "wall" and z + plinth + H >= TALL_ANCHOR_H
                and not _near_wall(inst, room)):
            energy = tip_energy(inst)
            out.append(_issue(
                "std-tip-over", "warning",
                f"высокий модуль {z + plinth + H:.0f} мм, энергия "
                f"опрокидывания ≈{energy:.0f} Н·м (порог 60) — "
                "обязательное крепление к стене (EN 14749)",
                instance=iid, name=name))

        # Створки: не шире 600 мм (ГОСТ 16371/EN), лучше ≤550.
        w, leaf = _leaf_width(p)
        if leaf > DOOR_LEAF_MAX:
            out.append(_issue(
                "std-door-width", "error",
                f"створка {leaf:.0f} мм шире {DOOR_LEAF_MAX:.0f} мм — "
                "разделить на две (ГОСТ 16371)",
                instance=iid, name=name))

        # Фасады ящиков ≤900 мм.
        if int(_num(p.get("drawers"), 0)) > 0 and w > DRAWER_FRONT_MAX:
            out.append(_issue(
                "std-drawer-width", "error",
                f"фасад ящика {w:.0f} мм шире {DRAWER_FRONT_MAX:.0f} мм",
                instance=iid, name=name))

        # Полки: пролёт по внутренней ширине.
        if int(_num(p.get("shelves"), 0)) > 0:
            bays = max(1, int(_num(p.get("dividers"), 0)) + 1)
            span = (W - 2 * t - (bays - 1) * t) / bays
            limit = SHELF_SPAN_18 if t >= 18 else SHELF_SPAN_16
            if span > SHELF_SPAN_HARD:
                out.append(_issue(
                    "std-shelf-span", "error",
                    f"полка {span:.0f} мм — пролёт больше "
                    f"{SHELF_SPAN_HARD:.0f} мм, нужна стойка",
                    instance=iid, name=name))
            elif span > limit:
                out.append(_issue(
                    "std-shelf-span", "warning",
                    f"полка {span:.0f} мм; для {t:.0f} мм надёжно до "
                    f"{limit:.0f} мм — добавить стойку",
                    instance=iid, name=name))

    # --- зазор между столешницей и навесными -------------------------------
    bases = []
    walls = []
    for inst in instances:
        p = inst.get("params") or {}
        if not isinstance(inst, dict):
            continue
        if str(p.get("mount") or "floor") == "wall":
            walls.append(inst)
        elif _num(p.get("worktopT"), 0) > 0:
            bases.append(inst)
    for w in walls:
        pw = w.get("params") or {}
        wx = _num(w.get("x"))
        ww = _num(pw.get("W"), 0)
        wy = _num(w.get("y"))
        wz = _num(w.get("z"), 0)
        if wz >= 2100:
            continue
        best: float | None = None
        for b in bases:
            pb = b.get("params") or {}
            if abs(_num(b.get("rot")) - _num(w.get("rot"))) > 0.5:
                continue
            if abs(_num(b.get("y")) - wy) > 800:
                continue
            bx = _num(b.get("x"))
            bw = _num(pb.get("W"), 0)
            if min(wx + ww, bx + bw) - max(wx, bx) <= 0:
                continue
            top = _num(b.get("z")) + _num(pb.get("plinthH")) + \
                _num(pb.get("H"), 720) + _num(pb.get("worktopT"))
            gap = wz - top
            if best is None or gap < best:
                best = gap
        if best is not None and not WALL_GAP_MIN <= best <= WALL_GAP_MAX:
            out.append(_issue(
                "std-wall-gap", "warning",
                f"зазор от столешницы до навесного {best:.0f} мм; "
                f"стандарт {WALL_GAP_MIN:.0f}–{WALL_GAP_MAX:.0f} мм (EN 1116)",
                instance=str(w.get("id") or ""),
                name=str(w.get("name") or "")))

    # --- мягкая мебель, кровати, столы --------------------------------------
    for pr in props:
        if not isinstance(pr, dict):
            continue
        kind = str(pr.get("type") or "")
        pid = str(pr.get("id") or "")
        name = str(pr.get("name") or pid)
        w = _num(pr.get("w"))
        d = _num(pr.get("d"))
        h = _num(pr.get("h"))

        if kind == "bed":
            width = round(w)
            if not any(abs(width - b) <= 10 for b in BED_WIDTHS):
                out.append(_issue(
                    "std-bed-size", "warning",
                    f"кровать {width} мм — ширина не из ряда ГОСТ 13025.2 "
                    "(700, 800, 900, 1100–1800)",
                    prop=pid, name=name))
            if not BED_LEN_MIN - 10 <= d <= BED_LEN_MAX + 50:
                out.append(_issue(
                    "std-bed-size", "warning",
                    f"кровать {d:.0f} мм — длина вне 1860–2050 мм "
                    "(ГОСТ 13025.2)",
                    prop=pid, name=name))
        elif kind in ("sofa", "armchair"):
            lo, hi = (SOFA_DEPTH if kind == "sofa" else ARMCHAIR_DEPTH)
            if not lo <= d <= hi:
                out.append(_issue(
                    "std-seat-depth", "warning",
                    f"{'диван' if kind == 'sofa' else 'кресло'}: глубина "
                    f"{d:.0f} мм; типично {lo:.0f}–{hi:.0f} мм "
                    "(ГОСТ 13025.2)",
                    prop=pid, name=name))
            if kind == "armchair" and w < 480:
                out.append(_issue(
                    "std-seat-width", "warning",
                    f"кресло {w:.0f} мм — уже 480 мм (ГОСТ 13025.2)",
                    prop=pid, name=name))
            if kind == "sofa" and w < 1000:
                out.append(_issue(
                    "std-seat-width", "warning",
                    f"диван {w:.0f} мм — меньше одного посадочного места",
                    prop=pid, name=name))
        elif kind == "chair":
            if not CHAIR_H[0] <= h <= CHAIR_H[1] + 250:
                out.append(_issue(
                    "std-chair-height", "warning",
                    f"стул {h:.0f} мм; типичная высота 800–950 мм",
                    prop=pid, name=name))
        elif kind == "coffee-table":
            lo, hi = (TABLE_H if h >= 600 else COFFEE_TABLE_H)
            if not lo <= h <= hi:
                out.append(_issue(
                    "std-table-height", "warning",
                    f"стол {h:.0f} мм; по ГОСТ 13025.3 — "
                    + ("700–780 мм для обеденного" if h >= 600
                       else "350–500 мм для журнального"),
                    prop=pid, name=name))

    return out
