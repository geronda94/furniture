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
    _overlap_depth,
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
    wall_item_poly,
)

from .quickstart import _free_spans, _place

# Поля, меняющие объём модуля: только при их изменении пересчитываем
# коллизии в update_instance.
GEOMETRY_KEYS = {
    "W", "D", "H", "mount", "plinthH", "worktopT",
    "doors", "drawers", "fronts", "cutouts", "runners",
}


def _candidate(
    x: float, y: float, rot: float, W: float, D: float, H: float,
    mount: str, plinthH: float, worktopT: float, z: float | None,
    params: dict | None = None,
) -> dict[str, Any]:
    p: dict[str, Any] = {
        "W": W, "D": D, "H": H, "mount": mount,
        "plinthH": plinthH, "worktopT": worktopT,
        # зазоры и створки — как у типового модуля, чтобы сектор
        # открывания совпадал с валидатором
        "gapSide": 2, "gapBetween": 3,
        "gapTop": 2, "gapBottom": 2,
        "doors": 2 if W >= 700 else (1 if W >= 300 else 0),
    }
    # Реальные параметры модуля важны: число створок/ящиков, вырезы и
    # фронты меняют сектор открывания и ход ящиков.
    if params:
        p.update({k: v for k, v in params.items() if v is not None})
    return {
        "id": "__candidate__",
        "name": "Новый модуль",
        "x": x, "y": y, "rot": rot,
        "z": float(z if z is not None else (1450 if mount == "wall" else 0)),
        "params": p,
    }


def height_problem(
    room: dict, H: float, mount: str, plinthH: float, worktopT: float,
) -> str | None:
    """Почему модуль не влезает по высоте (или None)."""
    room_h = _num((room or {}).get("h"), 2700.0)
    z0 = 1450.0 if mount == "wall" else 0.0
    total = H if mount == "wall" else plinthH + H + worktopT
    if z0 + total > room_h + 2.0:
        return (
            f"модуль не помещается по высоте: {z0 + total:.0f} мм "
            f"при потолке {room_h:.0f} мм"
        )
    return None


def _bbox(poly: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


def _near(a: tuple[float, float, float, float],
          b: tuple[float, float, float, float]) -> bool:
    """Пересекаются ли прямоугольные габариты (дешёвый префильтр)."""
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def scene_context(room: dict, instances: list[dict],
                  props: list[dict]) -> dict:
    """Один раз считает объёмы, створки, проёмы и предметы на стенах.

    Перебор свободных мест иначе пересчитывал бы геометрию сцены на
    каждом шаге — на демо-квартире это секунды вместо миллисекунд.
    """
    walls = room_walls(room)
    openings: list[dict] = []
    windows: list[dict] = []
    for wall in walls:
        for o in opening_span(room, wall.index):
            body = opening_body_poly(wall, o)
            sweep = opening_sweep_poly(wall, o)
            zone = sweep if sweep is not None else opening_zone_poly(wall, o)
            zz = (o["z0"], o["z1"])
            openings.append({
                "body": body, "body_bbox": _bbox(body),
                "zone": zone, "zone_bbox": _bbox(zone), "z": zz,
            })
            if o["kind"] == "window":
                windows.append({
                    "wall": wall, "x0": o["x0"], "x1": o["x1"], "z": zz,
                })
    inst_data: list[dict] = []
    for inst in instances:
        poly, zz = inst_volume(inst)
        swings = [(sp, _bbox(sp), sz) for sp, sz in door_sweeps(inst)]
        drawer = None
        if _drawer_count(inst) > 0:
            dp, dz = _front_zone(inst, drawer_travel(inst))
            drawer = (dp, _bbox(dp), dz)
        inst_data.append({
            "poly": poly, "bbox": _bbox(poly), "z": zz,
            "swings": swings, "drawer": drawer,
        })
    prop_data: list[dict] = []
    for prop in props:
        poly, zz = prop_volume(prop)
        prop_data.append({
            "poly": poly, "bbox": _bbox(poly), "z": zz,
            "rug": str(prop.get("type")) == "rug",
        })
    wall_data: list[dict] = []
    for item in room.get("wallItems") or []:
        if not isinstance(item, dict):
            continue
        wall = next((w for w in walls
                     if w.index == int(_num(item.get("wall"), -1))), None)
        if wall is None:
            continue
        poly = wall_item_poly(wall, item)
        zz = (_num(item.get("z"), 0.0),
              _num(item.get("z"), 0.0) + _num(item.get("h"), 0.0))
        wall_data.append({
            "wall": wall, "item": item, "poly": poly,
            "bbox": _bbox(poly), "z": zz,
        })
    return {
        "walls": walls,
        "outline": outline_points(room),
        "openings": openings,
        "windows": windows,
        "instances": inst_data,
        "props": prop_data,
        "wall_items": wall_data,
        "room_h": _num(room.get("h"), 2700.0),
    }


def _cabinet_window_hit(
    poly: list[tuple[float, float]], zspan: tuple[float, float],
    ctx: dict,
) -> bool:
    """Навесной шкаф вплотную к окну (валидатор: нужен зазор > 0)."""
    for win in ctx["windows"]:
        wall = win["wall"]
        ds = [(px - wall.ax) * wall.nx + (py - wall.ay) * wall.ny
              for px, py in poly]
        lo, hi = min(ds), max(ds)
        # спинка прижата к одной из граней стены
        if not (abs(lo) <= 8 or abs(hi) <= 8
                or abs(lo + wall.t) <= 8 or abs(hi + wall.t) <= 8):
            continue
        if not _z_overlap(zspan, win["z"]):
            continue
        vals = [(px - wall.ax) * wall.dx + (py - wall.ay) * wall.dy
                for px, py in poly]
        a, b = min(vals), max(vals)
        if max(win["x0"] - b, a - win["x1"]) <= 0:
            return True
    return False


def cabinet_over_window(inst: dict, room: dict) -> bool:
    """Навесной шкаф перекрывает окно на своей стене (правило валидатора)."""
    p = inst.get("params") or {}
    if str(p.get("mount") or "floor") != "wall":
        return False
    poly, zspan = inst_volume(inst)
    return _cabinet_window_hit(poly, zspan, scene_context(room, [], []))


def wall_items_clear(
    inst: dict, poly: list[tuple[float, float]],
    zspan: tuple[float, float], ctx: dict,
) -> bool:
    """Модуль не закрывает настенные предметы и не встаёт над вырезом."""
    p = inst.get("params") or {}
    for wi in ctx["wall_items"]:
        item, wall = wi["item"], wi["wall"]
        if (_z_overlap(zspan, wi["z"]) and _near(_bbox(poly), wi["bbox"])
                and _collide(poly, wi["poly"])):
            return False
        # розетка/выключатель над мойкой или варочной
        if (str(item.get("kind")) in ("socket", "switch", "outlet")
                and wi["z"][0] < 1450 and p.get("cutouts")):
            a = min((px - wall.ax) * wall.dx + (py - wall.ay) * wall.dy
                    for px, py in poly)
            b = max((px - wall.ax) * wall.dx + (py - wall.ay) * wall.dy
                    for px, py in poly)
            s0 = _num(item.get("x"), 0.0)
            s1 = s0 + _num(item.get("w"), 0.0)
            if s1 > a + 1 and s0 < b - 1:
                return False
    return True


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
    params: dict | None = None,
    ctx: dict | None = None,
) -> bool:
    """Можно ли поставить модуль в (x, y, rot), не задев ничего."""
    cand = _candidate(
        x, y, rot, W, D, H, mount, plinthH, worktopT, z, params=params,
    )
    poly, zspan = inst_volume(cand)
    bbox = _bbox(poly)
    ctx = ctx or scene_context(room, instances, props)

    # 0. Пол и потолок: модуль должен целиком помещаться в комнату.
    if zspan[0] < -2.0 or zspan[1] > ctx["room_h"] + 2.0:
        return False

    # 1. Контур комнаты и тело стен.
    if any(not inside_or_edge(px, py, ctx["outline"], 1.5)
           for px, py in poly):
        return False
    for wall in ctx["walls"]:
        if _collide(poly, wall_body_poly(wall)):
            return False

    # 2. Проёмы: тело проёма и зона открывания двери.
    for op in ctx["openings"]:
        if not _z_overlap(zspan, op["z"]):
            continue
        if _near(bbox, op["body_bbox"]) and _collide(poly, op["body"]):
            return False
        if _near(bbox, op["zone_bbox"]) and _collide(poly, op["zone"]):
            return False

    # 3. Другая мебель: объёмы и двери/ящики в обе стороны.
    for other in ctx["instances"]:
        if not _near(bbox, other["bbox"]):
            continue
        if _z_overlap(zspan, other["z"]) and _collide(poly, other["poly"]):
            return False
        # чужая открытая дверь не должна бить в новый модуль
        for sp, sbb, sz in other["swings"]:
            if (_z_overlap(sz, zspan) and _near(bbox, sbb)
                    and _collide(sp, poly)):
                return False
        # чужой выдвинутый ящик
        if other["drawer"]:
            dp, dbb, dz = other["drawer"]
            if (_z_overlap(dz, zspan) and _near(bbox, dbb)
                    and _collide(dp, poly)):
                return False

    # 4. Двери и ящики самого кандидата.
    for sp, sz in door_sweeps(cand):
        for wall in ctx["walls"]:
            if _collide(sp, wall_body_poly(wall)):
                return False
        for op in ctx["openings"]:
            if _z_overlap(sz, op["z"]) and _collide(sp, op["zone"]):
                return False
        for other in ctx["instances"]:
            if _z_overlap(sz, other["z"]) and _collide(sp, other["poly"]):
                return False
            # двери двух модулей не должны сталкиваться (валидатор: > 5 мм)
            for osp, _osb, osz in other["swings"]:
                if (_z_overlap(sz, osz)
                        and _overlap_depth(sp, osp) > 5.0):
                    return False
        for prop in ctx["props"]:
            if prop["rug"]:
                continue
            if (_z_overlap(sz, prop["z"]) and _near(_bbox(sp), prop["bbox"])
                    and _collide(sp, prop["poly"])):
                return False
    if _drawer_count(cand) > 0:
        zp, zz = _front_zone(cand, drawer_travel(cand))
        for wall in ctx["walls"]:
            if _collide(zp, wall_body_poly(wall)):
                return False
        for other in ctx["instances"]:
            if _z_overlap(zz, other["z"]) and _collide(zp, other["poly"]):
                return False
        for prop in ctx["props"]:
            if prop["rug"]:
                continue
            if (_z_overlap(zz, prop["z"]) and _near(_bbox(zp), prop["bbox"])
                    and _collide(zp, prop["poly"])):
                return False

    # 5. Декор (ковёр не мешает — по нему ходят).
    for prop in ctx["props"]:
        if prop["rug"]:
            continue
        if (_z_overlap(zspan, prop["z"]) and _near(bbox, prop["bbox"])
                and _collide(poly, prop["poly"])):
            return False

    # 6. Настенные предметы и нормативные правила валидатора.
    if not wall_items_clear(cand, poly, zspan, ctx):
        return False
    if (str((cand.get("params") or {}).get("mount") or "floor") == "wall"
            and _cabinet_window_hit(poly, zspan, ctx)):
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
    params: dict | None = None,
) -> tuple[float, float, float] | None:
    """Первое свободное место у стены: x, y, rot. None — места нет."""
    z0 = 1450.0 if mount == "wall" else 0.0
    total = H if mount == "wall" else plinthH + H + worktopT
    z1 = z0 + total
    ctx = scene_context(room, instances, props)
    for wall in ctx["walls"]:
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
                    mount, plinthH, worktopT, z0, params=params, ctx=ctx,
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
    room_h = _num(room.get("h"), 2700.0)
    if zspan[0] < -2.0 or zspan[1] > room_h + 2.0:
        return False
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
        # декор не должен закрывать розетку/полку/зеркало на стене
        for item in room.get("wallItems") or []:
            if not isinstance(item, dict):
                continue
            wall = next((w for w in walls
                         if w.index == int(_num(item.get("wall"), -1))), None)
            if wall is None:
                continue
            iz = (_num(item.get("z"), 0.0),
                  _num(item.get("z"), 0.0) + _num(item.get("h"), 0.0))
            if (_z_overlap(zspan, iz)
                    and _collide(poly, wall_item_poly(wall, item))):
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
