"""Постановка новых модулей в свободное место с учётом стен и объектов.

Нужно и ИИ, и быстрому старту: модуль без координат не должен появляться
в стене, проёме, соседнем шкафу, декоре или зоне открывания двери. Если
координаты заданы явно — проверяем их и не даём сохранить наложение.

Проверка повторяет ту же геометрию, что и валидатор (`validate_scene`):
фактические объёмы с выступом столешницы, секторы дверей и ход ящиков.
Так «поставить» и «проверить» не расходятся.
"""
from __future__ import annotations

from typing import Any

from furniture_core.layout import inside_or_edge, outline_points, room_walls
from furniture_core.scene import (
    _collide,
    _drawer_count,
    _front_zone,
    _num,
    _z_overlap,
    door_sweeps,
    drawer_travel,
    inst_volume,
    opening_body_poly,
    opening_span,
    opening_sweep_poly,
    opening_zone_poly,
    prop_volume,
    wall_body_poly,
)

from .quickstart import _free_spans, _place


def _candidate(
    x: float, y: float, rot: float, W: float, D: float, H: float,
    mount: str, plinthH: float, worktopT: float, z: float | None,
) -> dict[str, Any]:
    return {
        "id": "__candidate__",
        "name": "Новый модуль",
        "x": x, "y": y, "rot": rot,
        "z": float(z if z is not None else (1450 if mount == "wall" else 0)),
        "params": {
            "W": W, "D": D, "H": H, "mount": mount,
            "plinthH": plinthH, "worktopT": worktopT,
            # зазоры и створки — как у типового модуля, чтобы сектор
            # открывания совпадал с валидатором
            "gapSide": 2, "gapBetween": 3,
            "gapTop": 2, "gapBottom": 2,
            "doors": 2 if W >= 700 else (1 if W >= 300 else 0),
        },
    }


def _opening_polys(room: dict) -> list[tuple[list[tuple[float, float]],
                                            tuple[float, float]]]:
    out: list[tuple[list[tuple[float, float]], tuple[float, float]]] = []
    for wall in room_walls(room):
        for o in opening_span(room, wall.index):
            poly = opening_sweep_poly(wall, o)
            if poly is None:
                poly = opening_zone_poly(wall, o)
            out.append((poly, (o["z0"], o["z1"])))
    return out


def candidate_free(
    room: dict,
    instances: list[dict],
    props: list[dict],
    x: float,
    y: float,
    rot: float,
    W: float,
    D: float,
    H: float,
    mount: str = "floor",
    plinthH: float = 100,
    worktopT: float = 38,
    z: float | None = None,
) -> bool:
    """Можно ли поставить модуль в (x, y, rot), не задев ничего."""
    cand = _candidate(x, y, rot, W, D, H, mount, plinthH, worktopT, z)
    poly, zspan = inst_volume(cand)

    # 1. Контур комнаты и тело стен.
    outline = outline_points(room)
    if any(not inside_or_edge(px, py, outline, 1.5) for px, py in poly):
        return False
    walls = room_walls(room)
    for wall in walls:
        if _collide(poly, wall_body_poly(wall)):
            return False

    # 2. Проёмы: тело проёма и зона открывания двери.
    for wall in walls:
        for o in opening_span(room, wall.index):
            if not _z_overlap(zspan, (o["z0"], o["z1"])):
                continue
            if _collide(poly, opening_body_poly(wall, o)):
                return False
            sweep = opening_sweep_poly(wall, o)
            zone = sweep if sweep is not None else opening_zone_poly(wall, o)
            if _collide(poly, zone):
                return False

    # 3. Другая мебель: объёмы и двери/ящики в обе стороны.
    for other in instances:
        op, oz = inst_volume(other)
        if _z_overlap(zspan, oz) and _collide(poly, op):
            return False
        # чужая открытая дверь не должна бить в новый модуль
        for sp, sz in door_sweeps(other):
            if _z_overlap(sz, zspan) and _collide(sp, poly):
                return False
        # чужой выдвинутый ящик
        if _drawer_count(other) > 0:
            zp, zz = _front_zone(other, drawer_travel(other))
            if _z_overlap(zz, zspan) and _collide(zp, poly):
                return False

    # 4. Двери и ящики самого кандидата.
    for sp, sz in door_sweeps(cand):
        for wall in walls:
            if _collide(sp, wall_body_poly(wall)):
                return False
        for zone, zz in _opening_polys(room):
            if _z_overlap(sz, zz) and _collide(sp, zone):
                return False
        for other in instances:
            op, oz = inst_volume(other)
            if _z_overlap(sz, oz) and _collide(sp, op):
                return False
        for prop in props:
            if str(prop.get("type")) == "rug":
                continue
            pp, pz = prop_volume(prop)
            if _z_overlap(sz, pz) and _collide(sp, pp):
                return False
    if _drawer_count(cand) > 0:
        zp, zz = _front_zone(cand, drawer_travel(cand))
        for wall in walls:
            if _collide(zp, wall_body_poly(wall)):
                return False
        for other in instances:
            op, oz = inst_volume(other)
            if _z_overlap(zz, oz) and _collide(zp, op):
                return False
        for prop in props:
            if str(prop.get("type")) == "rug":
                continue
            pp, pz = prop_volume(prop)
            if _z_overlap(zz, pz) and _collide(zp, pp):
                return False

    # 5. Декор (ковёр не мешает — по нему ходят).
    for prop in props:
        if str(prop.get("type")) == "rug":
            continue
        pp, pz = prop_volume(prop)
        if _z_overlap(zspan, pz) and _collide(poly, pp):
            return False

    return True


def find_free_placement(
    room: dict,
    instances: list[dict],
    props: list[dict],
    W: float,
    D: float,
    H: float,
    *,
    mount: str = "floor",
    plinthH: float = 100,
    worktopT: float = 38,
) -> tuple[float, float, float] | None:
    """Первое свободное место у стены: x, y, rot. None — места нет."""
    z0 = 1450.0 if mount == "wall" else 0.0
    total = H if mount == "wall" else plinthH + H + worktopT
    z1 = z0 + total
    for wall in room_walls(room):
        if not wall.outer:
            continue
        spans = _free_spans(room, wall, z0, z1)
        for a, b in sorted(spans, key=lambda s: s[0]):
            # Шаг 10 мм: не пропускаем узкие щели, но и не перебираем всё.
            start = a
            while start + W <= b + 0.5:
                x, y, rot = _place(wall, start, W, D)
                if candidate_free(
                    room, instances, props, x, y, rot, W, D, H,
                    mount, plinthH, worktopT, z0,
                ):
                    return x, y, rot
                start += 10
    return None


def prop_free(
    room: dict,
    instances: list[dict],
    props: list[dict],
    x: float,
    y: float,
    rot: float,
    w: float,
    d: float,
    h: float,
    z: float = 0.0,
    *,
    kind: str = "decor",
    ignore: str | None = None,
) -> bool:
    """Можно ли поставить декор в (x, y), не задев стены/мебель/проёмы."""
    cand = {
        "id": "__prop__", "type": kind, "name": "Новый декор",
        "x": x, "y": y, "z": z, "rot": rot,
        "w": w, "d": d, "h": h,
    }
    poly, zspan = prop_volume(cand)
    outline = outline_points(room)
    if any(not inside_or_edge(px, py, outline, 1.5) for px, py in poly):
        return False
    walls = room_walls(room)
    for wall in walls:
        if _collide(poly, wall_body_poly(wall)):
            return False
        for o in opening_span(room, wall.index):
            if not _z_overlap(zspan, (o["z0"], o["z1"])):
                continue
            if _collide(poly, opening_body_poly(wall, o)):
                return False
            sweep = opening_sweep_poly(wall, o)
            zone = sweep if sweep is not None else opening_zone_poly(wall, o)
            if _collide(poly, zone):
                return False
    if kind != "rug":
        for inst in instances:
            ip, iz = inst_volume(inst)
            if _z_overlap(zspan, iz) and _collide(poly, ip):
                return False
            # открытая дверь или выдвинутый ящик не должны бить в декор
            for sp, sz in door_sweeps(inst):
                if _z_overlap(sz, zspan) and _collide(sp, poly):
                    return False
            if _drawer_count(inst) > 0:
                zp, zz = _front_zone(inst, drawer_travel(inst))
                if _z_overlap(zz, zspan) and _collide(zp, poly):
                    return False
        for other in props:
            oid = str(other.get("id") or "")
            if oid == ignore or str(other.get("type")) == "rug":
                continue
            op, oz = prop_volume(other)
            if _z_overlap(zspan, oz) and _collide(poly, op):
                return False
    return True


def find_free_prop_placement(
    room: dict,
    instances: list[dict],
    props: list[dict],
    w: float,
    d: float,
    h: float,
    *,
    kind: str = "decor",
    z: float = 0.0,
) -> tuple[float, float] | None:
    """Свободное место под декор: центр x, y. None — места нет."""
    pts = outline_points(room)
    if not pts:
        return None
    min_x = min(p[0] for p in pts)
    max_x = max(p[0] for p in pts)
    min_y = min(p[1] for p in pts)
    max_y = max(p[1] for p in pts)
    step = 100.0
    y = min_y + d / 2 + 20
    while y <= max_y - d / 2:
        x = min_x + w / 2 + 20
        while x <= max_x - w / 2:
            if prop_free(
                room, instances, props, x, y, 0, w, d, h, z, kind=kind,
            ):
                return round(x, 1), round(y, 1)
            x += step
        y += step
    return None


def wall_item_free(
    room: dict,
    instances: list[dict],
    props: list[dict],
    wall_index: int,
    x: float,
    z: float,
    w: float,
    h: float,
    depth: float,
    *,
    kind: str = "socket",
    ignore: str | None = None,
) -> bool:
    """Можно ли повесить предмет на стену, не задев проём/мебель/декор."""
    from furniture_core.scene import wall_item_poly

    wall = next((v for v in room_walls(room) if v.index == wall_index), None)
    if wall is None:
        return False
    if x < -1 or x + w > wall.length + 1:
        return False
    item = {
        "id": ignore or "__wallitem__", "kind": kind, "wall": wall_index,
        "x": x, "z": z, "w": w, "h": h, "depth": depth,
    }
    poly = wall_item_poly(wall, item)
    zspan = (z, z + h)
    for o in opening_span(room, wall.index):
        if _z_overlap(zspan, (o["z0"], o["z1"])) and _collide(
                poly, opening_zone_poly(wall, o)):
            return False
    for inst in instances:
        ip, iz = inst_volume(inst)
        if _z_overlap(zspan, iz) and _collide(poly, ip):
            return False
    for prop in props:
        if str(prop.get("type")) == "rug":
            continue
        pp, pz = prop_volume(prop)
        if _z_overlap(zspan, pz) and _collide(poly, pp):
            return False
    for other in room.get("wallItems") or []:
        if not isinstance(other, dict):
            continue
        oid = str(other.get("id") or "")
        if oid == ignore:
            continue
        if int(_num(other.get("wall"), -1)) != wall_index:
            continue
        oz = (_num(other.get("z"), 0.0),
              _num(other.get("z"), 0.0) + _num(other.get("h"), 0.0))
        if _z_overlap(zspan, oz) and _collide(
                poly, wall_item_poly(wall, other)):
            return False
    return True


def find_free_wall_item(
    room: dict,
    instances: list[dict],
    props: list[dict],
    wall_index: int,
    z: float,
    w: float,
    h: float,
    depth: float,
    *,
    kind: str = "socket",
) -> float | None:
    """Свободное смещение x на стене. None — места нет."""
    wall = next((v for v in room_walls(room) if v.index == wall_index), None)
    if wall is None:
        return None
    x = 50.0
    while x + w <= wall.length - 50.0 + 1:
        if wall_item_free(
            room, instances, props, wall_index, x, z, w, h, depth,
            kind=kind,
        ):
            return round(x, 1)
        x += 50.0
    return None
