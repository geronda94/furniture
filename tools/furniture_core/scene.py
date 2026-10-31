"""Проверка объёмных коллизий сцены: мебель, декор, стены и проёмы.

`layout.py` проверяет план и стены. Этот модуль добавляет то, чего не хватало
для ИИ-генерации:

* реальную высоту модуля (цоколь + корпус + столешница), а не только `H`;
* декор (`project.props`) — растения, ТВ, сантехника, ковры;
* двери фасадов: зона открывания не должна пересекать стены, проёмы,
  соседнюю мебель и декор;
* «текстуры» — это поверхности тел, поэтому любое проникновение в тело
  стены/проёма/детали считается ошибкой, а не «наложением картинок».

Координаты — миллиметры, план `x/y`, высота `z`. Все проверки — 2D SAT по
плану + пересечение интервалов по высоте.
"""
from __future__ import annotations

import copy
import math
from typing import Any, Iterable

from .fixes import enrich
from .layout import (
    EPS,
    DOOR_CLEAR,
    WINDOW_CLEAR,
    _num,
    corners,
    inside_or_edge,
    instance_dims,
    opening_span,
    outline_points,
    point_in_poly,
    room_walls,
    wall_faces,
)

OVERLAP_TOL = 1.5       # допуск на касание, мм
HEIGHT_TOL = 2.0        # допуск по высоте, мм
WORKTOP_OVERHANG = 20.0  # столешница выступает вперёд, мм
MIN_DOOR_SWING = 300.0   # не делать зону открывания меньше 300 мм
DOOR_SWEEP_SEGMENTS = 12
DOOR_OPEN_ANGLE = 90.0   # градусов; 80–110 — допустимый диапазон


def _rot(x: float, y: float, deg: float) -> tuple[float, float]:
    a = math.radians(deg)
    cs, sn = math.cos(a), math.sin(a)
    return x * cs - y * sn, x * sn + y * cs


def _poly_corner(
    x: float, y: float, w: float, d: float, rot: float,
    front_overhang: float = 0.0,
) -> list[tuple[float, float]]:
    """Прямоугольник от левого-переднего угла (как у модулей)."""
    out: list[tuple[float, float]] = []
    for lx, ly in (
        (0.0, -front_overhang), (w, -front_overhang), (w, d), (0.0, d),
    ):
        rx, ry = _rot(lx, ly, rot)
        out.append((x + rx, y + ry))
    return out


def _poly_center(
    x: float, y: float, w: float, d: float, rot: float,
) -> list[tuple[float, float]]:
    """Прямоугольник от центра (как у декора)."""
    out: list[tuple[float, float]] = []
    for lx, ly in (
        (-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2),
    ):
        rx, ry = _rot(lx, ly, rot)
        out.append((x + rx, y + ry))
    return out


def _axes(poly: list[tuple[float, float]]) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for i, p in enumerate(poly):
        q = poly[(i + 1) % len(poly)]
        vx, vy = q[0] - p[0], q[1] - p[1]
        ln = math.hypot(vx, vy)
        if ln > 1e-9:
            out.append((-vy / ln, vx / ln))
    return out


def _project(
    poly: Iterable[tuple[float, float]], axis: tuple[float, float],
) -> tuple[float, float]:
    vals = [x * axis[0] + y * axis[1] for x, y in poly]
    return min(vals), max(vals)


def _overlap_depth(
    a: list[tuple[float, float]], b: list[tuple[float, float]],
) -> float:
    """Глубина пересечения выпуклых полигонов; 0 — не пересекаются."""
    best = float("inf")
    for axis in _axes(a) + _axes(b):
        amin, amax = _project(a, axis)
        bmin, bmax = _project(b, axis)
        if amax <= bmin + EPS or bmax <= amin + EPS:
            return 0.0
        best = min(best, min(amax, bmax) - max(amin, bmin))
    return 0.0 if not math.isfinite(best) else best


def _collide(a: list[tuple[float, float]], b: list[tuple[float, float]]) -> bool:
    return _overlap_depth(a, b) > OVERLAP_TOL


def _z_overlap(a: tuple[float, float], b: tuple[float, float]) -> bool:
    return min(a[1], b[1]) - max(a[0], b[0]) > HEIGHT_TOL


def _inst_floor(inst: dict) -> bool:
    return str((inst.get("params") or {}).get("mount") or "floor") != "wall"


def inst_volume(inst: dict) -> tuple[list[tuple[float, float]], tuple[float, float]]:
    """Фактический объём модуля в плане и по высоте (с цоколем/столешницей)."""
    p = inst.get("params") or {}
    W, D, H, z = instance_dims(inst)
    floor = _inst_floor(inst)
    plinth = max(0.0, _num(p.get("plinthH"), 0.0)) if floor else 0.0
    worktop = max(0.0, _num(p.get("worktopT"), 0.0)) if floor else 0.0
    overhang = WORKTOP_OVERHANG if worktop > 0 else 0.0
    poly = _poly_corner(
        _num(inst.get("x")), _num(inst.get("y")), W, D,
        _num(inst.get("rot")), overhang,
    )
    return poly, (z, z + plinth + H + worktop)


def prop_volume(prop: dict) -> tuple[list[tuple[float, float]], tuple[float, float]]:
    p = prop
    z = _num(p.get("z"), 0.0)
    h = _num(p.get("h"), 0.0)
    poly = _poly_center(
        _num(p.get("x")), _num(p.get("y")),
        _num(p.get("w"), 0.0), _num(p.get("d"), 0.0),
        _num(p.get("rot"), 0.0),
    )
    return poly, (z, z + h)


def wall_body_poly(w) -> list[tuple[float, float]]:
    return [
        (w.ax, w.ay), (w.bx, w.by),
        (w.bx - w.nx * w.t, w.by - w.ny * w.t),
        (w.ax - w.nx * w.t, w.ay - w.ny * w.t),
    ]


def opening_zone_poly(w, o: dict) -> list[tuple[float, float]]:
    """Тело проёма + зона открывания/подхода в комнату."""
    s0 = _num(o.get("x0"))
    s1 = _num(o.get("x1"))
    reach = (max(DOOR_CLEAR, s1 - s0)
             if o.get("kind") == "door" else WINDOW_CLEAR)
    p0 = (w.ax + w.dx * s0, w.ay + w.dy * s0)
    p1 = (w.ax + w.dx * s1, w.ay + w.dy * s1)
    return [
        (p0[0] - w.nx * w.t, p0[1] - w.ny * w.t),
        (p1[0] - w.nx * w.t, p1[1] - w.ny * w.t),
        (p1[0] + w.nx * reach, p1[1] + w.ny * reach),
        (p0[0] + w.nx * reach, p0[1] + w.ny * reach),
    ]


def opening_body_poly(w, o: dict) -> list[tuple[float, float]]:
    """Тело проёма в толще стены."""
    s0 = _num(o.get("x0"))
    s1 = _num(o.get("x1"))
    p0 = (w.ax + w.dx * s0, w.ay + w.dy * s0)
    p1 = (w.ax + w.dx * s1, w.ay + w.dy * s1)
    return [
        (p0[0], p0[1]), (p1[0], p1[1]),
        (p1[0] - w.nx * w.t, p1[1] - w.ny * w.t),
        (p0[0] - w.nx * w.t, p0[1] - w.ny * w.t),
    ]


def opening_sweep_poly(w, o: dict) -> list[tuple[float, float]] | None:
    """Сектор открывания двери комнаты по петле и углу.

    Без hinge/angle — None, вызывающий использует безопасный прямоугольник.
    """
    if o.get("kind") != "door":
        return None
    hinge = str(o.get("hinge") or "")
    if hinge not in ("left", "right"):
        return None
    s0 = _num(o.get("x0"))
    s1 = _num(o.get("x1"))
    radius = max(1.0, s1 - s0)
    hs = s0 if hinge == "left" else s1
    hx = w.ax + w.dx * hs
    hy = w.ay + w.dy * hs
    cx, cy = (w.dx, w.dy) if hinge == "left" else (-w.dx, -w.dy)
    angle = max(0.0, min(120.0, _num(o.get("angle"), DOOR_OPEN_ANGLE)))
    pts = [(hx, hy)]
    for k in range(DOOR_SWEEP_SEGMENTS + 1):
        a = math.radians(angle * k / DOOR_SWEEP_SEGMENTS)
        vx = cx * math.cos(a) + w.nx * math.sin(a)
        vy = cy * math.cos(a) + w.ny * math.sin(a)
        pts.append((hx + vx * radius, hy + vy * radius))
    return pts


def wall_item_poly(w, item: dict) -> list[tuple[float, float]]:
    """Объём настенного предмета: розетка, полка, зеркало, выключатель."""
    s0 = _num(item.get("x"))
    s1 = s0 + _num(item.get("w"))
    depth = max(1.0, _num(item.get("depth"), 12.0))
    p0 = (w.ax + w.dx * s0, w.ay + w.dy * s0)
    p1 = (w.ax + w.dx * s1, w.ay + w.dy * s1)
    return [
        (p0[0], p0[1]), (p1[0], p1[1]),
        (p1[0] + w.nx * depth, p1[1] + w.ny * depth),
        (p0[0] + w.nx * depth, p0[1] + w.ny * depth),
    ]


def _door_count(inst: dict) -> int:
    p = inst.get("params") or {}
    fronts = p.get("fronts")
    if isinstance(fronts, list) and fronts:
        return sum(
            max(0, int(_num(b.get("count"), 0)))
            for b in fronts
            if isinstance(b, dict) and b.get("type") == "doors"
        )
    return max(0, int(_num(p.get("doors"), 0)))


def _drawer_count(inst: dict) -> int:
    p = inst.get("params") or {}
    fronts = p.get("fronts")
    if isinstance(fronts, list) and fronts:
        return sum(
            max(0, int(_num(b.get("count"), 0)))
            for b in fronts
            if isinstance(b, dict) and b.get("type") == "drawers"
        )
    return max(0, int(_num(p.get("drawers"), 0)))


def _front_zone(
    inst: dict, depth: float,
) -> tuple[list[tuple[float, float]], tuple[float, float]]:
    p = inst.get("params") or {}
    W = _num(p.get("W"), 600.0)
    H = _num(p.get("H"), 720.0)
    z = _num(inst.get("z"), 0.0)
    floor = _inst_floor(inst)
    plinth = max(0.0, _num(p.get("plinthH"), 0.0)) if floor else 0.0
    overhang = WORKTOP_OVERHANG if floor and _num(p.get("worktopT"), 0) > 0 else 0.0
    x = _num(inst.get("x"))
    y = _num(inst.get("y"))
    rot = _num(inst.get("rot"))
    # Зона считается в локальных координатах модуля: фронт — y=0,
    # выкат уходит наружу (−y) на глубину хода. Раньше прямоугольник
    # строили снаружи и ещё раз поворачивали — у модулей с rot=180
    # (спиной к стене Y=0) выкат уезжал в стену и давал ложную ошибку.
    poly: list[tuple[float, float]] = []
    for lx, ly in (
        (0.0, -overhang), (W, -overhang),
        (W, -overhang - depth), (0.0, -overhang - depth),
    ):
        rx, ry = _rot(lx, ly, rot)
        poly.append((x + rx, y + ry))
    return poly, (z + plinth, z + plinth + H)


def drawer_travel(inst: dict) -> float:
    """Ход ящика: примерно глубина корпуса минус зазоры направляющей.

    Точнее — по паспорту направляющей, но ``params.runners`` даёт только
    модель, а не длину. Берём глубину корпуса с запасом и ограничиваем
    разумным диапазоном 250–560 мм.
    """
    p = inst.get("params") or {}
    depth = _num(p.get("D"), 560.0)
    return max(250.0, min(560.0, depth - 40.0))


def door_blocks(inst: dict) -> list[tuple[float, float, int]]:
    """Блоки створок: (z0, z1, количество) в абсолютных мм от пола.

    Если задана компоновка ``params.fronts`` (сверху вниз), берём высоты
    блоков и зазоры; иначе створки занимают весь корпус минус зазоры.
    """
    p = inst.get("params") or {}
    H = _num(p.get("H"), 720.0)
    z = _num(inst.get("z"), 0.0)
    floor = _inst_floor(inst)
    plinth = max(0.0, _num(p.get("plinthH"), 0.0)) if floor else 0.0
    gap_top = max(0.0, _num(p.get("gapTop"), 2.0))
    gap_bottom = max(0.0, _num(p.get("gapBottom"), 2.0))
    gap_between = max(0.0, _num(p.get("gapBetween"), 3.0))
    base = z + plinth + gap_bottom
    fh = max(40.0, H - gap_top - gap_bottom)
    raw = [b for b in (p.get("fronts") or []) if isinstance(b, dict)]
    if not raw:
        return [(base, z + plinth + H - gap_top, _door_count(inst))]
    avail = max(40.0, fh - gap_between * (len(raw) - 1))
    fixed = sum(float(b.get("height") or 0) for b in raw)
    autos = sum(1 for b in raw if not float(b.get("height") or 0))
    auto_h = max(0.0, (avail - fixed) / autos) if autos else 0.0
    heights = [float(b.get("height") or 0) or auto_h for b in raw]
    if sum(heights) > avail and sum(heights) > 0:
        k = avail / sum(heights)
        heights = [h * k for h in heights]
    heights[-1] += avail - sum(heights)
    out: list[tuple[float, float, int]] = []
    cursor = base + fh
    for b, h in zip(raw, heights):
        h = max(40.0, h)
        cursor -= h
        kind = "drawers" if b.get("type") in ("drawers", "drawer") else "doors"
        if kind == "doors":
            out.append((cursor, cursor + h,
                        max(1, int(_num(b.get("count"), 1)))))
        cursor -= gap_between
    return out


def door_sweeps(
    inst: dict,
) -> list[tuple[list[tuple[float, float]], tuple[float, float]]]:
    """Секторы каждой створки: петля, ширина, угол 90°, поворот модуля."""
    p = inst.get("params") or {}
    W = _num(p.get("W"), 600.0)
    gap_side = max(0.0, _num(p.get("gapSide"), 2.0))
    gap_between = max(0.0, _num(p.get("gapBetween"), 3.0))
    rot = _num(inst.get("rot"))
    cs, sn = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    x0 = _num(inst.get("x"))
    y0 = _num(inst.get("y"))
    out: list[tuple[list[tuple[float, float]], tuple[float, float]]] = []
    angle = math.radians(DOOR_OPEN_ANGLE)
    for z0, z1, n in door_blocks(inst):
        if n <= 0:
            continue
        avail = max(50.0, W - 2 * gap_side - max(0, n - 1) * gap_between)
        width = max(MIN_DOOR_SWING, avail / n)
        for j in range(n):
            left = (j % 2 == 0)
            span0 = gap_side + j * (width + gap_between)
            hx_local = span0 if left else span0 + width
            pts: list[tuple[float, float]] = []

            def world(lx: float, ly: float) -> tuple[float, float]:
                return (x0 + lx * cs - ly * sn, y0 + lx * sn + ly * cs)

            pts.append(world(hx_local, 0.0))
            sign = 1.0 if left else -1.0
            for k in range(DOOR_SWEEP_SEGMENTS + 1):
                a = angle * k / DOOR_SWEEP_SEGMENTS
                lx = hx_local + sign * width * math.cos(a)
                ly = -width * math.sin(a)
                pts.append(world(lx, ly))
            out.append((pts, (z0, z1)))
    return out


def _face_for(inst: dict, faces):
    best = None
    for f in faces:
        vals = [f.signed(x, y) for x, y in corners(inst)]
        mn = min(vals)
        if mn < -EPS or mn > 3.0:
            continue
        # задняя стенка к этой грани
        bx, by = -math.sin(math.radians(_num(inst.get("rot")))), \
            math.cos(math.radians(_num(inst.get("rot"))))
        if bx * f.nx + by * f.ny >= -0.55:
            continue
        if best is None or mn < best[0]:
            best = (mn, f)
    return best[1] if best else None


def _issue(code: str, level: str, message: str, *,
           instance: str | None = None, prop: str | None = None,
           name: str | None = None) -> dict:
    return enrich({
        "code": code, "level": level, "message": message,
        "instance": instance, "prop": prop,
        "name": name or "",
    })



def _wall_span(inst: dict, w) -> tuple[float, float]:
    """Проекция модуля на ось стены: [начало, конец] вдоль стены."""
    poly, _ = inst_volume(inst)
    vals = [(px - w.ax) * w.dx + (py - w.ay) * w.dy for px, py in poly]
    return min(vals), max(vals)


def _against_wall(inst: dict, w) -> bool:
    """Спинка модуля прижата к одной из граней стены (0 или −t)."""
    poly, _ = inst_volume(inst)
    ds = [(px - w.ax) * w.nx + (py - w.ay) * w.ny for px, py in poly]
    lo, hi = min(ds), max(ds)
    return (abs(lo) <= 8 or abs(hi) <= 8
            or abs(lo + w.t) <= 8 or abs(hi + w.t) <= 8)



def _usable_span(w, walls) -> tuple[float, float]:
    """Границы стены, свободные от тел поперечных перегородок.

    Стена начинается на осевой линии перегородки, но корпус упирается в её
    грань: 140 мм толщины — не «щель в ряду», а стена.
    """
    def blocked(s: float) -> bool:
        for k in (2.0, 6.0, 12.0):
            px = w.ax + w.dx * s + w.nx * k
            py = w.ay + w.dy * s + w.ny * k
            for o in walls:
                if o.index == w.index:
                    continue
                if inside_or_edge(px, py, wall_body_poly(o), 0.5):
                    return True
        return False

    lo, hi = 0.0, w.length
    while lo < 600.0 and blocked(lo + 1.0):
        lo += 10.0
    while hi > w.length - 600.0 and blocked(hi - 1.0):
        hi -= 10.0
    return lo, hi

def validate_scene(project: dict) -> list[dict]:
    """Все объёмные ошибки: мебель, декор, проёмы, двери, высоты."""
    room = project.get("room") or {}
    instances = [
        i for i in project.get("instances") or [] if isinstance(i, dict)
    ]
    props = [p for p in project.get("props") or [] if isinstance(p, dict)]
    walls = room_walls(room)
    faces = wall_faces(room)
    outline = outline_points(room)
    room_h = _num(room.get("h"), 2700.0)
    issues: list[dict] = []

    def add(*args, **kwargs) -> None:
        issues.append(_issue(*args, **kwargs))

    # --- проёмы не должны пересекаться друг с другом ---
    spans_by_wall = []
    for w in walls:
        for o in opening_span(room, w.index):
            spans_by_wall.append((w, o))
    for i, (wa, a) in enumerate(spans_by_wall):
        for wb, b in spans_by_wall[i + 1:]:
            if wa.index != wb.index:
                continue
            if (a["x1"] > b["x0"] + EPS and b["x1"] > a["x0"] + EPS
                    and _z_overlap((a["z0"], a["z1"]), (b["z0"], b["z1"]))):
                add("opening-overlap", "error",
                    f"проёмы {a.get('id') or ''} и {b.get('id') or ''} "
                    "пересекаются на одной стене")

    # --- мебель: пол/потолок, цоколь, стены, проёмы ---
    vols: dict[str, tuple[list[tuple[float, float]], tuple[float, float]]] = {}
    for inst in instances:
        iid = str(inst.get("id") or "")
        name = str(inst.get("name") or iid)
        poly, zspan = inst_volume(inst)
        vols[iid] = (poly, zspan)
        p = inst.get("params") or {}
        H = _num(p.get("H"), 0)
        plinth = _num(p.get("plinthH"), 0)
        worktop = _num(p.get("worktopT"), 0)
        if _inst_floor(inst):
            if plinth < -0.1:
                add("plinth", "error", "цоколь отрицательной высоты",
                    instance=iid, name=name)
            if H > 0 and plinth >= H:
                add("plinth", "error",
                    f"цоколь {plinth:.0f} мм не ниже корпуса {H:.0f} мм",
                    instance=iid, name=name)
            if worktop < 0:
                add("worktop", "error", "отрицательная толщина столешницы",
                    instance=iid, name=name)
        if zspan[0] < -HEIGHT_TOL:
            add("below-floor", "error",
                f"низ объекта на {zspan[0]:.0f} мм ниже пола",
                instance=iid, name=name)
        if zspan[1] > room_h + HEIGHT_TOL:
            add("above-ceiling", "error",
                f"верх объекта {zspan[1]:.0f} мм выше потолка {room_h:.0f} мм",
                instance=iid, name=name)
        if any(not inside_or_edge(x, y, outline, 1.5) for x, y in poly):
            add("outside", "error", "объект выходит за контур комнаты",
                instance=iid, name=name)
        for w in walls:
            if _collide(poly, wall_body_poly(w)):
                add("in-wall", "error",
                    f"объект входит в тело стены №{w.index + 1}",
                    instance=iid, name=name)
            for o in opening_span(room, w.index):
                if not _z_overlap(zspan, (o["z0"], o["z1"])):
                    continue
                if _collide(poly, opening_body_poly(w, o)):
                    add("opening", "error",
                        f"объект в теле проёма "
                        f"{o.get('id') or ''}".strip(),
                        instance=iid, name=name)
                    continue
                sweep = opening_sweep_poly(w, o)
                if sweep is not None:
                    if _collide(poly, sweep):
                        add("opening-sweep", "error",
                            f"объект в зоне открывания двери "
                            f"{o.get('id') or ''}".strip(),
                            instance=iid, name=name)
                elif _collide(poly, opening_zone_poly(w, o)):
                    add("opening", "error",
                        f"объект перекрывает "
                        f"{'дверь' if o['kind'] == 'door' else 'окно'} "
                        f"{o.get('id') or ''}".strip(),
                        instance=iid, name=name)
        # пол: напольный модуль не должен «висеть» над полом
        if _inst_floor(inst) and zspan[0] > 20:
            add("floating", "warn",
                f"напольный модуль начинается на {zspan[0]:.0f} мм выше пола",
                instance=iid, name=name)

    # --- мебель × мебель: объёмные пересечения ---
    for i, a in enumerate(instances):
        aid = str(a.get("id") or "")
        for b in instances[i + 1:]:
            bid = str(b.get("id") or "")
            pa, za = vols[aid]
            pb, zb = vols[bid]
            if not _z_overlap(za, zb):
                continue
            if _collide(pa, pb):
                add("overlap", "error",
                    f"пересекается по объёму с «{b.get('name') or bid}»",
                    instance=aid, name=str(a.get("name") or aid))

    # --- двери фасадов ---
    swings: list[
        tuple[str, list[tuple[float, float]], tuple[float, float]]
    ] = []
    for inst in instances:
        iid = str(inst.get("id") or "")
        name = str(inst.get("name") or iid)
        for sp, sz in door_sweeps(inst):
            swings.append((iid, sp, sz))
            for w in walls:
                if _collide(sp, wall_body_poly(w)):
                    add("door-swing-wall", "error",
                        "открытая дверь фасада упирается в стену",
                        instance=iid, name=name)
            for o in (room.get("openings") or []):
                if not isinstance(o, dict):
                    continue
                w = next((x for x in walls
                          if x.index == int(_num(o.get("wall"), -1))), None)
                if not w:
                    continue
                span = opening_span(room, w.index)
                match = next((x for x in span
                              if x.get("id") == str(o.get("id"))), None)
                if not match or not _z_overlap(sz, (match["z0"], match["z1"])):
                    continue
                target = opening_sweep_poly(w, match)
                if target is None:
                    target = opening_zone_poly(w, match)
                if _collide(sp, target):
                    add("door-swing-opening", "error",
                        "открытая дверь фасада задевает проём "
                        f"{o.get('id') or ''}".strip(),
                        instance=iid, name=name)
            # дверь против другой мебели
            for other in instances:
                oid = str(other.get("id") or "")
                if oid == iid:
                    continue
                op, oz = vols[oid]
                if _z_overlap(sz, oz) and _collide(sp, op):
                    add("door-swing-instance", "error",
                        f"открытая дверь фасада задевает «{other.get('name') or oid}»",
                        instance=iid, name=name)
            # дверь против декора
            for prop in props:
                pp, pz = prop_volume(prop)
                if str(prop.get("type")) == "rug":
                    continue
                if _z_overlap(sz, pz) and _collide(sp, pp):
                    add("door-swing-prop", "error",
                        f"открытая дверь фасада задевает декор "
                        f"«{prop.get('name') or prop.get('id')}»",
                        instance=iid, name=name, prop=str(prop.get("id") or ""))
    # --- открытые ящики: выкат вперёд ---
    for inst in instances:
        n = _drawer_count(inst)
        if n <= 0:
            continue
        iid = str(inst.get("id") or "")
        name = str(inst.get("name") or iid)
        zp, zz = _front_zone(inst, drawer_travel(inst))
        for w in walls:
            if _collide(zp, wall_body_poly(w)):
                add("drawer-wall", "error",
                    "выдвинутый ящик упирается в стену",
                    instance=iid, name=name)
        for other in instances:
            oid = str(other.get("id") or "")
            if oid == iid:
                continue
            op, oz = vols[oid]
            if _z_overlap(zz, oz) and _collide(zp, op):
                add("drawer-instance", "error",
                    f"выдвинутый ящик задевает «{other.get('name') or oid}»",
                    instance=iid, name=name)
        for prop in props:
            if str(prop.get("type")) == "rug":
                continue
            pp, pz = prop_volume(prop)
            if _z_overlap(zz, pz) and _collide(zp, pp):
                add("drawer-prop", "error",
                    f"выдвинутый ящик задевает декор "
                    f"«{prop.get('name') or prop.get('id')}»",
                    instance=iid, name=name, prop=str(prop.get("id") or ""))

    # двери двух модулей
    for i, (aid, pa, za) in enumerate(swings):
        for bid, pb, zb in swings[i + 1:]:
            if aid == bid:
                continue
            # соседние створки имеют зазор 2–3 мм: не считаем касание
            # столкновением, но реальное перекрытие > 5 мм — ошибка
            if _z_overlap(za, zb) and _overlap_depth(pa, pb) > 5.0:
                add("door-swing-clash", "error",
                    "двери фасадов двух модулей сталкиваются",
                    instance=aid)

    # --- настенные предметы: розетки, полки, зеркала ---
    for item in room.get("wallItems") or []:
        if not isinstance(item, dict):
            continue
        wi = int(_num(item.get("wall"), -1))
        w = next((x for x in walls if x.index == wi), None)
        if not w:
            continue
        iid = str(item.get("id") or "")
        name = str(item.get("kind") or "предмет на стене")
        s0 = _num(item.get("x"))
        s1 = s0 + _num(item.get("w"))
        if s0 < -1 or s1 > w.length + 1:
            add("wallitem-outside", "error",
                f"настенный предмет «{name}» выходит за длину стены",
                name=name)
        poly = wall_item_poly(w, item)
        zspan = (_num(item.get("z"), 0.0),
                 _num(item.get("z"), 0.0) + _num(item.get("h"), 0.0))
        for o in opening_span(room, w.index):
            if (_z_overlap(zspan, (o["z0"], o["z1"]))
                    and _collide(poly, opening_zone_poly(w, o))):
                add("wallitem-opening", "error",
                    f"настенный предмет «{name}» попадает в проём "
                    f"{o.get('id') or ''}".strip(), name=name)
        for inst in instances:
            i = str(inst.get("id") or "")
            ip, iz = vols[i]
            if _z_overlap(zspan, iz) and _collide(poly, ip):
                add("wallitem", "error",
                    f"настенный предмет «{name}» закрыт модулем "
                    f"«{inst.get('name') or i}»",
                    instance=i, name=str(inst.get("name") or i))
            # Розетка/выключатель над мойкой или варочной: работать нельзя.
            # Модуль не закрывает розетку (она выше столешницы), поэтому
            # общая проверка перекрытия её не ловит.
            if (str(item.get("kind")) in ("socket", "switch", "outlet")
                    and zspan[0] < 1450
                    and (inst.get("params") or {}).get("cutouts")):
                a = min((px - w.ax) * w.dx + (py - w.ay) * w.dy
                        for px, py in ip)
                b = max((px - w.ax) * w.dx + (py - w.ay) * w.dy
                        for px, py in ip)
                if s1 > a + 1 and s0 < b - 1:
                    add("socket-over-cutout", "error",
                        f"настенный предмет «{name}» стоит над мойкой/"
                        f"варочной «{inst.get('name') or i}»",
                        instance=i, name=name)
        for prop in props:
            if str(prop.get("type")) == "rug":
                continue
            pp, pz = prop_volume(prop)
            if _z_overlap(zspan, pz) and _collide(poly, pp):
                add("wallitem", "error",
                    f"настенный предмет «{name}» закрыт декором "
                    f"«{prop.get('name') or prop.get('id')}»",
                    prop=str(prop.get("id") or ""), name=name)
        for other in room.get("wallItems") or []:
            if not isinstance(other, dict) or other is item:
                continue
            if int(_num(other.get("wall"), -1)) != wi:
                continue
            opoly = wall_item_poly(w, other)
            oz = (_num(other.get("z"), 0.0),
                  _num(other.get("z"), 0.0) + _num(other.get("h"), 0.0))
            if _z_overlap(zspan, oz) and _collide(poly, opoly):
                add("wallitem-wallitem", "error",
                    f"настенные предметы «{name}» и "
                    f"«{other.get('kind') or other.get('id')}» пересекаются",
                    name=name)

    # --- декор ---
    for prop in props:
        pid = str(prop.get("id") or "")
        name = str(prop.get("name") or pid)
        poly, zspan = prop_volume(prop)
        kind = str(prop.get("type") or "")
        if any(not inside_or_edge(x, y, outline, 1.5) for x, y in poly):
            add("prop-outside", "error", "декор выходит за контур комнаты",
                prop=pid, name=name)
        if zspan[0] < -HEIGHT_TOL:
            add("prop-below-floor", "error", "декор ниже пола",
                prop=pid, name=name)
        if zspan[1] > room_h + HEIGHT_TOL:
            add("prop-above-ceiling", "error", "декор выше потолка",
                prop=pid, name=name)
        for w in walls:
            if _collide(poly, wall_body_poly(w)):
                add("prop-in-wall", "error",
                    f"декор входит в стену №{w.index + 1}",
                    prop=pid, name=name)
            for o in opening_span(room, w.index):
                if not _z_overlap(zspan, (o["z0"], o["z1"])):
                    continue
                if _collide(poly, opening_body_poly(w, o)):
                    add("prop-opening", "error",
                        f"декор в теле проёма {o.get('id') or ''}".strip(),
                        prop=pid, name=name)
                    continue
                sweep = opening_sweep_poly(w, o)
                if sweep is not None:
                    if _collide(poly, sweep):
                        add("prop-opening", "error",
                            f"декор в зоне открывания двери "
                            f"{o.get('id') or ''}".strip(),
                            prop=pid, name=name)
                elif _collide(poly, opening_zone_poly(w, o)):
                    add("prop-opening", "error",
                        f"декор перекрывает "
                        f"{'дверь' if o['kind'] == 'door' else 'окно'} "
                        f"{o.get('id') or ''}".strip(),
                        prop=pid, name=name)
        for inst in instances:
            iid = str(inst.get("id") or "")
            ip, iz = vols[iid]
            if kind == "rug":
                continue
            if _z_overlap(zspan, iz) and _collide(poly, ip):
                add("prop-overlap", "error",
                    f"декор «{name}» пересекает «{inst.get('name') or iid}»",
                    prop=pid, name=name, instance=iid)
        # декор × декор (ковёр — покрытие пола, не объём)
        for other in props:
            oid = str(other.get("id") or "")
            if oid == pid or kind == "rug" or str(other.get("type")) == "rug":
                continue
            op, oz = prop_volume(other)
            if _z_overlap(zspan, oz) and _collide(poly, op):
                add("prop-prop", "error",
                    f"декор «{name}» пересекает «{other.get('name') or oid}»",
                    prop=pid, name=name)


    # --- планировочные правила, которых не видно в пересечениях ------------
    # docs/20 §2.10 и §4.6: ряд не оставляют с щелью у стены, мойку или
    # варочную не прижимают к боковой стене, навесной шкаф не липнет к окну.
    for w in walls:
        row: list[tuple[float, float]] = []
        for inst in instances:
            p = inst.get("params") or {}
            if (p.get("mount") or "floor") == "wall":
                continue
            if abs(_num(inst.get("z"), 0.0)) > 1.0:
                continue
            if not _against_wall(inst, w):
                continue
            a, b = _wall_span(inst, w)
            row.append((a, b))
            # мойка/варочная (модуль с вырезом) вплотную к боковой стене
            if p.get("cutouts"):
                edge = min(a, w.length - b)
                if edge < 50.0:
                    add("sink-corner", "warning",
                        f"«{inst.get('name') or inst.get('id')}» прижат к "
                        f"боковой стене ({round(edge)} мм) — нет места "
                        "для работы", instance=str(inst.get("id") or ""),
                        name=str(inst.get("name") or ""))
        # навесной шкаф и окно: перекрытие — ошибка, < 80 мм — предупреждение
        for inst in instances:
            p = inst.get("params") or {}
            if (p.get("mount") or "floor") != "wall":
                continue
            if not _against_wall(inst, w):
                continue
            a, b = _wall_span(inst, w)
            z0 = _num(inst.get("z"), 0.0)
            z1 = z0 + _num(p.get("H"), 720.0)
            for o in opening_span(room, w.index):
                if o["kind"] != "window":
                    continue
                if not _z_overlap((z0, z1), (o["z0"], o["z1"])):
                    continue
                gapx = max(o["x0"] - b, a - o["x1"])
                name = str(inst.get("name") or inst.get("id") or "")
                if gapx <= 0:
                    add("cabinet-window", "error",
                        f"навесной «{name}» перекрывает окно "
                        f"{o.get('id') or ''}".strip(),
                        instance=str(inst.get("id") or ""), name=name)
                elif gapx < 80.0:
                    add("cabinet-window-gap", "warning",
                        f"навесной «{name}» в {round(gapx)} мм от окна — "
                        "нужно ≥ 80 мм на откос", instance=str(inst.get("id") or ""),
                        name=name)

        if not row:
            continue
        row.sort()
        occupied = [(a, b) for a, b in row]
        lo, hi = _usable_span(w, walls)
        # щель у стены: 30..250 мм — это место заполнителя, а не проход
        for edge0, edge1 in ((lo, occupied[0][0]),
                             (occupied[-1][1], hi)):
            gap = edge1 - edge0
            if not 30.0 < gap < 250.0:
                continue
            if any(o["kind"] in ("door", "arch")
                   and o["x1"] > edge0 + 1 and o["x0"] < edge1 - 1
                   for o in opening_span(room, w.index)):
                continue
            where = ("слева" if edge0 <= 1 else "справа")
            add("row-gap-wall", "warning",
                f"ряд не доходит до стены {where} на {round(gap)} мм — "
                "нужен заполнитель", name="ряд")
    return issues


def normalize_scene(project: dict) -> tuple[dict, list[dict], list[dict]]:
    """Развести конфликтующий декор по свободным местам.

    Мебель и проёмы автоматически не двигаются. Для проверки кандидатов
    строим препятствия один раз, а полный validate_scene запускаем только
    для принятого варианта — иначе перебор занимает секунды.
    """
    doc = copy.deepcopy(project)
    room = doc.get("room") or {}
    outline = outline_points(room)
    room_h = _num(room.get("h"), 2700.0)
    walls = room_walls(room)
    instances = [i for i in doc.get("instances") or [] if isinstance(i, dict)]
    props = [p for p in doc.get("props") or [] if isinstance(p, dict)]
    if not props:
        return doc, [], validate_scene(doc)

    inst_vols = [inst_volume(i) for i in instances]
    wall_polys = [wall_body_poly(w) for w in walls]
    opening_zones: list[tuple[list[tuple[float, float]], tuple[float, float]]] = []
    for w in walls:
        for o in opening_span(room, w.index):
            body = opening_body_poly(w, o)
            sweep = opening_sweep_poly(w, o) or opening_zone_poly(w, o)
            zspan = (o["z0"], o["z1"])
            opening_zones.append((body, zspan))
            opening_zones.append((sweep, zspan))
    door_zones = [z for i in instances for z in door_sweeps(i)]
    drawer_zones = []
    for i in instances:
        if _drawer_count(i) > 0:
            drawer_zones.append(_front_zone(i, drawer_travel(i)))
    wall_items = []
    for item in room.get("wallItems") or []:
        if not isinstance(item, dict):
            continue
        wi = int(_num(item.get("wall"), -1))
        w = next((x for x in walls if x.index == wi), None)
        if not w:
            continue
        wall_items.append((
            wall_item_poly(w, item),
            (_num(item.get("z"), 0.0),
             _num(item.get("z"), 0.0) + _num(item.get("h"), 0.0)),
        ))

    def ok(prop: dict) -> bool:
        poly, zspan = prop_volume(prop)
        if any(not inside_or_edge(x, y, outline, 1.5) for x, y in poly):
            return False
        if zspan[0] < -HEIGHT_TOL or zspan[1] > room_h + HEIGHT_TOL:
            return False
        for wp in wall_polys:
            if _collide(poly, wp):
                return False
        for op, oz in opening_zones:
            if _z_overlap(zspan, oz) and _collide(poly, op):
                return False
        kind = str(prop.get("type") or "")
        if kind != "rug":
            for ip, iz in inst_vols:
                if _z_overlap(zspan, iz) and _collide(poly, ip):
                    return False
            for zp, zz in door_zones:
                if _z_overlap(zspan, zz) and _collide(poly, zp):
                    return False
            for zp, zz in drawer_zones:
                if _z_overlap(zspan, zz) and _collide(poly, zp):
                    return False
        for other in props:
            if other is prop or kind == "rug" or str(other.get("type")) == "rug":
                continue
            op, oz = prop_volume(other)
            if _z_overlap(zspan, oz) and _collide(poly, op):
                return False
        for wp, wz in wall_items:
            if _z_overlap(zspan, wz) and _collide(poly, wp):
                return False
        return True

    def candidates(prop: dict):
        ox, oy = _num(prop.get("x")), _num(prop.get("y"))
        for radius in range(100, 2100, 100):
            for dx, dy in (
                (radius, 0), (-radius, 0), (0, radius), (0, -radius),
                (radius, radius), (radius, -radius),
                (-radius, radius), (-radius, -radius),
            ):
                yield ox + dx, oy + dy

    changes: list[dict] = []
    # Сначала двигаем мелкий декор, а не диван/кровать.
    ordered = sorted(
        props,
        key=lambda p: _num(p.get("w"), 1) * _num(p.get("d"), 1),
    )
    for prop in ordered:
        pid = str(prop.get("id") or "")
        if not pid or ok(prop):
            continue
        before = (_num(prop.get("x")), _num(prop.get("y")))
        before_errors = sum(1 for i in validate_scene(doc)
                            if i.get("level") == "error")
        moved = False
        for nx, ny in candidates(prop):
            prop["x"] = round(nx, 1)
            prop["y"] = round(ny, 1)
            if not ok(prop):
                continue
            # Полная проверка только для кандидата, прошедшего дешёвый фильтр.
            issues = validate_scene(doc)
            remaining = [i for i in issues
                         if i.get("level") == "error" and i.get("prop") == pid]
            total = sum(1 for i in issues if i.get("level") == "error")
            if not remaining and total < before_errors:
                changes.append({
                    "prop": pid, "code": "move",
                    "message": f"декор «{prop.get('name') or pid}» отодвинут "
                               f"от конфликта",
                    "from": {"x": before[0], "y": before[1]},
                    "to": {"x": prop["x"], "y": prop["y"]},
                })
                moved = True
                break
        if not moved:
            prop["x"] = before[0]
            prop["y"] = before[1]

    return doc, changes, validate_scene(doc)
