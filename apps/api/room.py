"""Операции с комнатой для UI/ИИ: размеры, контур, перегородки, проёмы.

Все проверки — до сохранения: проём не может выйти за стену, пересечь
другой проём, настенный предмет или мебель; перегородку нельзя удалить,
пока на её стене висят проёмы/предметы.

Координаты комнаты — миллиметры, план: x вправо, y «в глубину» (как на
плане сверху). Стены нумеруются по контуру, затем по перегородкам.
"""
from __future__ import annotations

from typing import Any

from furniture_core.layout import (
    inside_or_edge,
    outline_points,
    room_walls,
)
from furniture_core.scene import (
    _collide,
    _z_overlap,
    inst_volume,
    opening_body_poly,
    opening_sweep_poly,
    opening_zone_poly,
)

from .common import new_id

ROOM_W = (1200.0, 12000.0)
ROOM_H = (2000.0, 4500.0)
WALL_T = (40.0, 300.0)


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def walls(doc: dict) -> list:
    return room_walls(doc.get("room") or {})


def wall_at(doc: dict, index: int):
    return next((w for w in walls(doc) if w.index == int(index)), None)


def _outline(act: dict, room: dict, w: float, d: float) -> list[list[float]]:
    raw = act.get("outline")
    if isinstance(raw, list) and raw:
        pts = []
        for p in raw:
            if isinstance(p, (list, tuple)) and len(p) >= 2:
                pts.append([round(_num(p[0]), 1), round(_num(p[1]), 1)])
        if len(pts) < 3:
            raise ValueError("контур комнаты: нужно минимум 3 точки [x, y]")
        return pts
    shape = str(act.get("shape") or ("l" if act.get("cutW") else ""))
    if not shape:
        # Меняют только высоту/толщину стен: контур не трогаем. Если это
        # прямоугольник — просто растягиваем его под новые w/d.
        ex = room.get("outline")
        if isinstance(ex, list) and len(ex) >= 3:
            pts = [[round(_num(p[0]), 1), round(_num(p[1]), 1)]
                   for p in ex if isinstance(p, (list, tuple)) and len(p) >= 2]
            xs = [q[0] for q in pts]
            ys = [q[1] for q in pts]
            if (len(pts) == 4 and min(xs) == 0 and min(ys) == 0
                    and max(xs) > 0 and max(ys) > 0):
                return [[0.0, 0.0], [round(w, 1), 0.0],
                        [round(w, 1), round(d, 1)], [0.0, round(d, 1)]]
            # Не-прямоугольный контур масштабируем целиком, сохраняя форму.
            old_w = max(0.1, max(xs) - min(xs))
            old_d = max(0.1, max(ys) - min(ys))
            kx, ky = w / old_w, d / old_d
            return [[round(min(xs) + (q[0] - min(xs)) * kx, 1),
                     round(min(ys) + (q[1] - min(ys)) * ky, 1)]
                    for q in pts]
        shape = "rect"
    if shape == "l":
        cut_w = max(600.0, min(w - 600.0, _num(act.get("cutW"), w * 0.35)))
        cut_d = max(600.0, min(d - 600.0, _num(act.get("cutD"), d * 0.35)))
        return [
            [0.0, 0.0], [round(w, 1), 0.0],
            [round(w, 1), round(d - cut_d, 1)],
            [round(w - cut_w, 1), round(d - cut_d, 1)],
            [round(w - cut_w, 1), round(d, 1)], [0.0, round(d, 1)],
        ]
    return [[0.0, 0.0], [round(w, 1), 0.0],
            [round(w, 1), round(d, 1)], [0.0, round(d, 1)]]


def _fit_fixtures(room: dict) -> None:
    """Подогнать проёмы и предметы под новые стены (или понятно отказать)."""
    ws = room_walls(room)
    room_h = _num(room.get("h"), 2700.0)
    for o in room.get("openings") or []:
        if not isinstance(o, dict):
            continue
        seg = next((w for w in ws if w.index == int(_num(o.get("wall"), -1))),
                   None)
        if seg is None:
            raise ValueError(
                f"проём {o.get('id') or ''} остался на стене "
                f"№{int(_num(o.get('wall'), -1)) + 1}, которой больше нет",
            )
        w = max(100.0, _num(o.get("w"), 900.0))
        if w > seg.length + 1.0:
            raise ValueError(
                f"проём {w:.0f} мм не помещается в стену №{seg.index + 1} "
                f"длиной {seg.length:.0f} мм — уменьшите проём или комнату",
            )
        o["x"] = round(_clamp(_num(o.get("x")), 0.0, seg.length - w), 1)
        o["w"] = round(w, 1)
        if str(o.get("kind")) in ("door", "arch"):
            o["z0"] = 0.0
        else:
            o["z0"] = round(_clamp(_num(o.get("z0"), 900.0), 0.0,
                                   max(0.0, room_h - 200.0)), 1)
        o["z1"] = round(_clamp(_num(o.get("z1"), 2100.0),
                               _num(o.get("z0")) + 100.0, room_h), 1)
    for item in room.get("wallItems") or []:
        if not isinstance(item, dict):
            continue
        seg = next((w for w in ws if w.index == int(_num(item.get("wall"), -1))),
                   None)
        if seg is None:
            raise ValueError(
                f"предмет на стене №{int(_num(item.get('wall'), -1)) + 1} "
                "потерял свою стену",
            )
        w = max(10.0, _num(item.get("w"), 80.0))
        h = max(10.0, _num(item.get("h"), 80.0))
        if w > seg.length + 1.0:
            raise ValueError(
                f"предмет {w:.0f} мм шире стены №{seg.index + 1}",
            )
        item["x"] = round(_clamp(_num(item.get("x")), 0.0, seg.length - w), 1)
        item["z"] = round(_clamp(_num(item.get("z"), 0.0), 0.0,
                                 max(0.0, room_h - h)), 1)


def resize_room(doc: dict, act: dict) -> dict:
    """Изменить габариты/форму комнаты, сохранив стены и перегородки."""
    room = doc.setdefault("room", {})
    w = _clamp(_num(act.get("w"), room.get("w") or 3600), *ROOM_W)
    d = _clamp(_num(act.get("d"), room.get("d") or 2800), *ROOM_W)
    if act.get("h") is not None:
        room["h"] = round(_clamp(_num(act["h"]), *ROOM_H), 1)
    if act.get("wallT") is not None:
        room["wallT"] = round(_clamp(_num(act["wallT"]), *WALL_T), 1)
    room["outline"] = _outline(act, room, w, d)
    xs = [p[0] for p in room["outline"]]
    ys = [p[1] for p in room["outline"]]
    room["w"] = round(max(200.0, max(xs) - min(xs)), 1)
    room["d"] = round(max(200.0, max(ys) - min(ys)), 1)
    _fit_fixtures(room)
    return {"op": "resize_room", "w": room["w"], "d": room["d"],
            "h": room.get("h"), "shape": act.get("shape") or "rect"}


def _free_opening_spot(room: dict, wall_index: int, w: float,
                       z0: float, z1: float) -> float | None:
    """Начало свободного участка стены для проёма (или None)."""
    seg = wall_at({"room": room}, wall_index)
    if seg is None:
        return None
    blocked: list[tuple[float, float]] = []
    for o in room.get("openings") or []:
        if not isinstance(o, dict):
            continue
        if int(_num(o.get("wall"), -1)) != wall_index:
            continue
        if not _z_overlap((z0, z1), (_num(o.get("z0")), _num(o.get("z1")))):
            continue
        blocked.append((_num(o.get("x")), _num(o.get("x")) + _num(o.get("w"))))
    blocked.sort()
    cur = 0.0
    for a, b in blocked:
        if a - cur >= w:
            return round(cur, 1)
        cur = max(cur, b)
    if seg.length - cur >= w:
        return round(cur, 1)
    return None


def _opening_hint(room: dict, wall_index: int, w: float,
                  z0: float, z1: float) -> str:
    spot = _free_opening_spot(room, wall_index, w, z0, z1)
    if spot is not None:
        return f" Свободный участок: x={spot}."
    return (" На этой стене нет свободного участка — уменьшите проём "
            "или выберите другую стену.")


def _check_opening(doc: dict, o: dict, ignore_id: str | None = None) -> None:
    room = doc.get("room") or {}
    wall_index = int(_num(o.get("wall"), -1))
    seg = wall_at(doc, wall_index)
    if seg is None:
        raise ValueError(
            f"нет стены №{wall_index + 1}; доступны 0…{len(walls(doc)) - 1}",
        )
    kind = str(o.get("kind") or "window")
    if kind not in ("window", "door", "arch"):
        raise ValueError("проём: kind = window | door | arch")
    w = _num(o.get("w"), 900.0)
    if w <= 0 or w > seg.length + 1.0:
        raise ValueError(
            f"проём {w:.0f} мм не помещается в стену №{wall_index + 1} "
            f"длиной {seg.length:.0f} мм",
        )
    x = _num(o.get("x"), 0.0)
    room_h = _num(room.get("h"), 2700.0)
    z0 = 0.0 if kind in ("door", "arch") else _num(o.get("z0"), 900.0)
    z1 = _num(o.get("z1"), 2100.0 if kind in ("door", "arch") else 2200.0)
    if z1 <= z0 + 50:
        raise ValueError("проём: z1 должен быть выше z0 минимум на 50 мм")
    if z1 > room_h + 1.0:
        raise ValueError(
            f"проём выше потолка: z1={z1:.0f} при высоте комнаты {room_h:.0f}",
        )
    if x < -0.5 or x + w > seg.length + 0.5:
        raise ValueError(
            f"проём выходит за стену №{wall_index + 1} "
            f"(длина {seg.length:.0f} мм)."
            + _opening_hint(room, wall_index, w, z0, z1),
        )
    # пересечение с другими проёмами на той же стене
    for other in room.get("openings") or []:
        if not isinstance(other, dict) or other.get("id") == ignore_id:
            continue
        if int(_num(other.get("wall"), -1)) != wall_index:
            continue
        ox0 = _num(other.get("x"))
        ox1 = ox0 + _num(other.get("w"))
        if (x + w > ox0 + 1.0 and x < ox1 - 1.0
                and _z_overlap((z0, z1),
                               (_num(other.get("z0")), _num(other.get("z1"))))):
            raise ValueError(
                "проём пересекает другой проём на этой стене."
                + _opening_hint(room, wall_index, w, z0, z1),
            )
    # мебель в теле проёма/зоне подхода
    norm = {"kind": kind, "x0": x, "x1": x + w, "z0": z0, "z1": z1,
            "id": ignore_id or ""}
    body = opening_body_poly(seg, norm)
    sweep = opening_sweep_poly(seg, norm)
    zone = sweep if sweep is not None else opening_zone_poly(seg, norm)
    for inst in doc.get("instances") or []:
        if not isinstance(inst, dict):
            continue
        poly, zspan = inst_volume(inst)
        if not _z_overlap(zspan, (z0, z1)):
            continue
        if _collide(poly, body):
            raise ValueError(
                f"место проёма занято модулем «{inst.get('name') or inst.get('id')}» "
                "— сначала подвиньте или удалите его",
            )
        if _collide(poly, zone):
            raise ValueError(
                f"в зоне проёма стоит «{inst.get('name') or inst.get('id')}» "
                "— освободите подход",
            )
    # настенные предметы в проёме
    for item in room.get("wallItems") or []:
        if not isinstance(item, dict):
            continue
        if int(_num(item.get("wall"), -1)) != wall_index:
            continue
        ix0 = _num(item.get("x"))
        ix1 = ix0 + _num(item.get("w"))
        iz0 = _num(item.get("z"))
        iz1 = iz0 + _num(item.get("h"))
        if (x + w > ix0 + 1 and x < ix1 - 1
                and _z_overlap((z0, z1), (iz0, iz1))):
            raise ValueError(
                f"в этом месте на стене висит «{item.get('kind')}» — "
                "сначала перенесите предмет",
            )


def add_opening(doc: dict, act: dict) -> dict:
    room = doc.setdefault("room", {})
    kind = str(act.get("kind") or "window")
    wall_index = int(_num(act.get("wall"), 3 if kind == "door" else 0))
    seg = wall_at(doc, wall_index)
    if seg is None:
        raise ValueError(
            f"нет стены №{wall_index + 1}; доступны 0…{len(walls(doc)) - 1}",
        )
    w = _num(act.get("w"), 900.0 if kind == "door" else 1200.0)
    x = act.get("x")
    if x is None:
        z0 = 0.0 if kind in ("door", "arch") else 900.0
        z1 = 2100.0 if kind in ("door", "arch") else 2200.0
        x = _free_opening_spot(room, wall_index, w, z0, z1)
        if x is None:
            raise ValueError(
                f"на стене №{wall_index + 1} нет свободного участка "
                f"{w:.0f} мм — уменьшите проём или выберите другую стену",
            )
    o = {
        "id": str(act.get("id") or new_id("o")),
        "kind": kind,
        "wall": wall_index,
        "x": round(_num(x), 1),
        "w": round(w, 1),
        "z0": float(0 if kind in ("door", "arch") else _num(act.get("z0"), 900.0)),
        "z1": float(_num(act.get("z1"), 2100.0 if kind in ("door", "arch") else 2200.0)),
    }
    if kind in ("door", "arch"):
        o["hinge"] = str(act.get("hinge") or "left")
        o["angle"] = float(_num(act.get("angle"), 80.0))
        o["open"] = bool(act.get("open", False))
    _check_opening(doc, o)
    room.setdefault("openings", []).append(o)
    return {"op": "add_opening", "id": o["id"], "wall": wall_index, "x": o["x"]}


def update_opening(doc: dict, act: dict) -> dict:
    room = doc.setdefault("room", {})
    entry = next((o for o in room.get("openings", [])
                  if o.get("id") == act.get("id")), None)
    if not entry:
        raise ValueError(f"нет проёма {act.get('id')}")
    merged = {**entry, **(act.get("patch") or {})}
    _check_opening(doc, merged, ignore_id=str(entry.get("id")))
    entry.update(act.get("patch") or {})
    return {"op": "update_opening", "id": entry["id"]}


def add_partition(doc: dict, act: dict) -> dict:
    room = doc.setdefault("room", {})
    w = _num(room.get("w"), 3600.0)
    d = _num(room.get("d"), 2800.0)
    a = act.get("a") or [round(w / 2, 1), 0.0]
    b = act.get("b") or [round(w / 2, 1), round(d, 1)]
    a = [round(_num(a[0]), 1), round(_num(a[1]), 1)]
    b = [round(_num(b[0]), 1), round(_num(b[1]), 1)]
    length = ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5
    if length < 300:
        raise ValueError("перегородка короче 300 мм")
    pts = outline_points(room)
    if any(not inside_or_edge(p[0], p[1], pts, 2.0) for p in (a, b)):
        raise ValueError("перегородка должна начинаться и кончаться в комнате")
    t = round(_clamp(_num(act.get("wallT"), _num(room.get("wallT"), 100.0)),
                     *WALL_T), 1)
    room.setdefault("partitions", []).append({"a": a, "b": b, "wallT": t})
    index = len(room["partitions"]) - 1
    outer = sum(1 for x in walls(doc) if x.outer)
    return {"op": "add_partition", "index": index,
            "wall": outer + index, "length": round(length, 1)}


def update_partition(doc: dict, act: dict) -> dict:
    room = doc.setdefault("room", {})
    parts = room.setdefault("partitions", [])
    index = int(_num(act.get("index"), -1))
    if index < 0 or index >= len(parts):
        raise ValueError(f"нет перегородки №{index + 1}")
    p = parts[index]
    merged = {**p, **(act.get("patch") or {})}
    a = [round(_num((merged.get("a") or [0, 0])[0]), 1),
         round(_num((merged.get("a") or [0, 0])[1]), 1)]
    b = [round(_num((merged.get("b") or [0, 0])[0]), 1),
         round(_num((merged.get("b") or [0, 0])[1]), 1)]
    length = ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5
    if length < 300:
        raise ValueError("перегородка короче 300 мм")
    pts = outline_points(room)
    if any(not inside_or_edge(q[0], q[1], pts, 2.0) for q in (a, b)):
        raise ValueError("перегородка должна оставаться в комнате")
    merged["a"], merged["b"] = a, b
    merged["wallT"] = round(_clamp(_num(merged.get("wallT"), 100.0), *WALL_T), 1)
    parts[index] = merged
    return {"op": "update_partition", "index": index}


def delete_partition(doc: dict, act: dict) -> dict:
    room = doc.setdefault("room", {})
    parts = room.setdefault("partitions", [])
    index = int(_num(act.get("index"), -1))
    if index < 0 or index >= len(parts):
        raise ValueError(f"нет перегородки №{index + 1}")
    outer = sum(1 for w in walls(doc) if w.outer)
    wall_index = outer + index
    used = [o.get("id") for o in room.get("openings") or []
            if int(_num(o.get("wall"), -1)) == wall_index]
    used += [i.get("id") for i in room.get("wallItems") or []
             if int(_num(i.get("wall"), -1)) == wall_index]
    if used:
        raise ValueError(
            "на этой перегородке есть проёмы/предметы — сначала перенесите "
            f"или удалите их ({', '.join(str(x) for x in used)})",
        )
    parts.pop(index)
    for o in room.get("openings") or []:
        if int(_num(o.get("wall"), -1)) > wall_index:
            o["wall"] = int(_num(o.get("wall"))) - 1
    for item in room.get("wallItems") or []:
        if int(_num(item.get("wall"), -1)) > wall_index:
            item["wall"] = int(_num(item.get("wall"))) - 1
    return {"op": "delete_partition", "index": index}
