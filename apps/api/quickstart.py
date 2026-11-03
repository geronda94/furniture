"""Быстрый старт: комната + сценарий → готовый проект.

Пользователь вводит размеры комнаты, окна/двери/розетки и выбирает, что
поставить (кухня, гардероб, шкаф). Модуль расставляет мебель вдоль стены
по правилам (`docs/20`), создаёт независимые секции и возвращает документ,
который сразу проходит валидатор расстановки и ГОСТ/EN (`docs/29`).
"""
from __future__ import annotations

import math
from typing import Any

from furniture_core.layout import opening_span, room_walls

GLOBALS = {
    "t": 16, "back": "dvp", "backT": 4, "roof": True,
    "reinforce": "auto", "frame": "inset", "hardware": "blum",
    "runners": "tandem-21", "plinthH": 100, "worktopT": 38,
    "gapSide": 2, "gapBetween": 3, "gapTop": 2, "gapBottom": 2,
    "autoApply": True,
}

BASE = {
    "t": 16, "back": "dvp", "backT": 4, "roof": True,
    "reinforce": "auto", "frame": "inset", "hardware": "blum",
    "runners": "tandem-21", "mount": "floor",
    "plinthH": 100, "worktopT": 38,
    "gapSide": 2, "gapBetween": 3, "gapTop": 2, "gapBottom": 2,
    "handle": "bar-128", "fastener": "auto",
}


def _params(**kw: Any) -> dict[str, Any]:
    p = dict(BASE)
    p.update(kw)
    return p


def _rot(nx: float, ny: float) -> float:
    """Угол модуля: задняя стенка смотрит в -нормаль (к стене)."""
    return math.degrees(math.atan2(nx, -ny)) % 360


def _place(
    wall: Any, start: float, W: float, D: float,
) -> tuple[float, float, float]:
    """x, y, rot для модуля шириной W и глубиной D, начатого на s=start."""
    rot = _rot(wall.nx, wall.ny)
    a = math.radians(rot)
    cs, sn = math.cos(a), math.sin(a)
    cx = wall.ax + wall.dx * (start + W / 2) + wall.nx * (D / 2)
    cy = wall.ay + wall.dy * (start + W / 2) + wall.ny * (D / 2)
    x = cx - (W / 2 * cs - D / 2 * sn)
    y = cy - (W / 2 * sn + D / 2 * cs)
    return round(x, 1), round(y, 1), round(rot, 1)



def _edges(room: dict, wall: Any) -> tuple[float, float]:
    """Отступы от углов: двери на соседних стенах требуют зоны подхода."""
    walls = room_walls(room)
    n = sum(1 for w in walls if w.outer)
    if n < 4:
        return 20.0, 20.0
    start = end = 20.0
    idx = wall.index % n
    for k, side in ((-1, "start"), (1, "end")):
        adj = walls[(idx + k) % n]
        if not adj.outer:
            continue
        # общий угол нашей стены и соседней
        shared = None
        for px, py in ((wall.ax, wall.ay), (wall.bx, wall.by)):
            if (abs(adj.ax - px) < 30 and abs(adj.ay - py) < 30):
                shared = "adj_start"
            elif (abs(adj.bx - px) < 30 and abs(adj.by - py) < 30):
                shared = "adj_end"
        if not shared:
            continue
        for o in opening_span(room, adj.index):
            if o["kind"] not in ("door", "arch"):
                continue
            dist = (o["x0"] if shared == "adj_start"
                    else adj.length - o["x1"])
            if dist <= 1200:
                if side == "start":
                    start = max(start, 900.0)
                else:
                    end = max(end, 900.0)
    return start, end


def _free_spans(
    room: dict, wall: Any, z0: float, z1: float, edge: float = 0.0,
) -> list[tuple[float, float]]:
    """Свободные интервалы вдоль стены без проёмов, пересекающих z0..z1."""
    L = wall.length
    e0, e1 = _edges(room, wall)
    edge0 = max(edge, e0)
    edge1 = max(edge, e1)
    blocked: list[tuple[float, float]] = []
    for o in opening_span(room, wall.index):
        if o["z1"] <= z0 + 10 or o["z0"] >= z1 - 10:
            continue
        blocked.append((o["x0"], o["x1"]))
    blocked.sort()
    spans: list[tuple[float, float]] = []
    cur = edge0
    for a, b in blocked:
        if b <= cur:
            continue
        if a > cur:
            spans.append((cur, min(a, L - edge1)))
        cur = max(cur, b)
    if cur < L - edge1:
        spans.append((cur, L - edge1))
    return [(a, b) for a, b in spans if b - a >= 300]


def _mk(
    idx: int, name: str, W: float, D: float, H: float,
    wall: Any, start: float, params: dict[str, Any],
) -> dict[str, Any]:
    x, y, rot = _place(wall, start, W, D)
    return {
        "id": f"i{idx}", "product": "base-cabinet", "name": name,
        "x": x, "y": y, "z": float(params.get("mount") == "wall") * 1450.0,
        "rot": rot, "zLocked": True, "params": params,
    }


def _kitchen(room: dict, wall: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    idx = 0
    base_spans = _free_spans(room, wall, 0, 860)
    if not base_spans:
        return out
    a, b = max(base_spans, key=lambda s: s[1] - s[0])
    queue = [
        ("Мойка 800", 800, {"doors": 2, "shelves": 1, "cutouts": [
            {"x": 170, "y": 150, "w": 460, "h": 380}]}),
        ("ПММ 600", 600, {"doors": 1, "shelves": 1}),
        ("Варочная 600", 600, {"drawers": 2, "shelves": 0, "cutouts": [
            {"x": 80, "y": 120, "w": 440, "h": 320}]}),
        ("Тумба 800", 800, {"doors": 2, "shelves": 1}),
        ("Тумба 600", 600, {"doors": 1, "shelves": 1}),
    ]
    cur = a
    placed: list[tuple[float, float, str, float]] = []
    # Мойка не должна стоять в углу: если до неё меньше 150 мм от стены,
    # ставим сначала угловую тумбу 300 — так и брызги не на стену, и место
    # для работы есть.
    if b - a >= 300 + 800:
        idx += 1
        out.append(_mk(idx, "Тумба 300", 300, 560, 720, wall, cur,
                       _params(W=300, H=720, D=560, doors=1, shelves=1)))
        placed.append((cur, cur + 300, "Тумба 300", 720))
        cur += 300
    qi = 0
    while qi < len(queue):
        name, W, extra = queue[qi]
        if cur + W > b + 1:
            break
        p = _params(W=W, H=720, D=560, **extra)
        idx += 1
        out.append(_mk(idx, name, W, 560, 720, wall, cur, p))
        placed.append((cur, cur + W, name, 720))
        cur += W
        qi += 1
    # высокий пенал-холодильник, если осталось место и нет окна над ним
    tall_spans = _free_spans(room, wall, 0, 2200)
    if cur + 650 <= b + 1 and any(
            s0 <= cur and cur + 650 <= s1 for s0, s1 in tall_spans):
        idx += 1
        out.append(_mk(idx, "Пенал-холодильник 650", 650, 650, 2200,
                       wall, cur, _params(
                           W=650, H=2200, D=650, doors=2, shelves=4,
                           plinthH=0, worktopT=0)))
        cur += 650
    # навесные над рабочими секциями (не над мойкой и варочной)
    wall_spans = _free_spans(room, wall, 1450, 2170)
    if wall_spans:
        for start, end, name, _h in placed:
            if "Мойка" in name or "Варочная" in name:
                continue
            ok = any(s <= start and end <= e for s, e in wall_spans)
            if not ok or end - start < 400:
                continue
            W = min(800.0, end - start)
            idx += 1
            out.append(_mk(idx, f"Навесной {int(W)}", W, 320, 720,
                           wall, start, _params(
                               W=W, H=720, D=320, doors=2, shelves=2,
                               mount="wall", plinthH=0, worktopT=0)))
    return out


def _wardrobe(room: dict, wall: Any, height: float = 2400) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    spans = _free_spans(room, wall, 0, height)
    if not spans:
        return out
    a, b = max(spans, key=lambda s: s[1] - s[0])
    cur = a
    idx = 0
    while b - cur >= 300:
        W = min(600.0, b - cur)
        if W < 400:
            break
        doors = 2 if W >= 700 else 1
        dividers = 1 if W - 32 > 1000 else 0
        idx += 1
        out.append(_mk(
            idx, f"Шкаф {int(W)}", W, 600, height, wall, cur,
            _params(W=W, H=height, D=600, doors=doors, shelves=5,
                    dividers=dividers, plinthH=0, worktopT=0)))
        cur += W
    return out



def _span_on_wall(wall, inst: dict[str, Any]) -> tuple[float, float]:
    """Проекция модуля на ось стены (начало..конец вдоль стены)."""
    p = inst.get("params") or {}
    W = float(p.get("W") or 600)
    D = float(p.get("D") or 560)
    a = math.radians(float(inst.get("rot") or 0))
    cs, sn = math.cos(a), math.sin(a)
    vals: list[float] = []
    for lx, ly in ((0, 0), (W, 0), (W, D), (0, D)):
        gx = float(inst["x"]) + lx * cs - ly * sn
        gy = float(inst["y"]) + lx * sn + ly * cs
        vals.append((gx - wall.ax) * wall.dx + (gy - wall.ay) * wall.dy)
    return min(vals), max(vals)


def _move_socket_off_cutouts(
    room: dict, wall, instances: list[dict[str, Any]],
) -> None:
    """Розетка не должна висеть над мойкой или варочной.

    Генератор ставит розетки по форме пользователя; если точка попала на
    модуль с вырезом, сдвигаем её в ближайший свободный участок вдоль стены.
    """
    spans = [
        _span_on_wall(wall, inst) for inst in instances
        if (inst.get("params") or {}).get("cutouts")
    ]
    if not spans:
        return
    for item in room.get("wallItems") or []:
        if int(item.get("wall", -1)) != wall.index:
            continue
        if str(item.get("kind")) not in ("socket", "switch", "outlet"):
            continue
        x0 = float(item.get("x", 0))
        x1 = x0 + float(item.get("w", 80))
        hit = next(
            ((a, b) for a, b in spans if x1 > a + 1 and x0 < b - 1), None,
        )
        if not hit:
            continue
        # ближайшая свободная точка: сразу за вырезом или перед ним
        after = hit[1] + 120
        before = hit[0] - float(item.get("w", 80)) - 120
        item["x"] = round(after if after + 80 <= wall.length else max(0, before), 1)

def generate(
    doc: dict[str, Any], kind: str, wall_index: int,
    openings: list[dict[str, Any]] | None = None,
    sockets: list[dict[str, Any]] | None = None,
    height: float = 2400,
) -> dict[str, Any]:
    """Заполнить документ мебелью по сценарию (in-place) и вернуть его."""
    room = doc["room"]
    walls = room_walls(room)
    if not walls:
        raise ValueError("в комнате нет стен")
    if wall_index < 0 or wall_index >= len(walls):
        raise ValueError("неверная стена")
    wall = walls[wall_index]
    if not wall.outer:
        raise ValueError("для быстрого старта выберите наружную стену")

    for o in openings or []:
        w = int(o.get("wall", wall_index))
        door = o.get("kind") == "door"
        z0 = o.get("z0")
        z1 = o.get("z1")
        # не даём проёму выйти за стену (иначе 422 на ровном месте)
        seg = next((x for x in room_walls(room) if x.index == w), None)
        ow = float(o.get("w", 1200))
        ox = max(0.0, min(float(o.get("x", 0)),
                          max(0.0, (seg.length if seg else ow) - ow)))
        room.setdefault("openings", []).append({
            "id": o.get("id") or f"o{len(room.get('openings', [])) + 1}",
            "kind": o.get("kind", "window"),
            "wall": w,
            "x": ox, "w": ow,
            "z0": float(0 if door else 900) if z0 is None else float(z0),
            "z1": float(2100 if door else 2200) if z1 is None else float(z1),
            **({"hinge": o.get("hinge", "left"), "angle": 80,
                "open": False} if door else {}),
        })

    for s in sockets or []:
        room.setdefault("wallItems", []).append({
            "id": s.get("id") or f"w{len(room.get('wallItems', [])) + 1}",
            "kind": s.get("kind", "socket"),
            "wall": int(s.get("wall", wall_index)),
            "x": float(s.get("x", 300)),
            "z": float(s.get("z", 1100)),
            "w": 80.0, "h": 80.0,
            # выступ от стены: без него 3D-меш розетки получает NaN.
            "depth": float(s.get("depth", 12.0)),
        })

    props: list[dict[str, Any]] = []
    if kind == "kitchen":
        instances = _kitchen(room, wall)
    elif kind in ("wardrobe", "storage"):
        instances = _wardrobe(room, wall, height)
    else:
        raise ValueError("неизвестный сценарий")
    if not instances:
        raise ValueError("на выбранной стене нет свободного места")
    _move_socket_off_cutouts(room, wall, instances)

    if kind == "kitchen":
        # вытяжка над варочной (низ 1500 — 640 мм над столешницей)
        for inst in list(instances):
            if "Варочная" not in str(inst.get("name")):
                continue
            p = inst["params"]
            W = float(p.get("W") or 600)
            D = float(p.get("D") or 560)
            rot = math.radians(float(inst.get("rot") or 0))
            cs, sn = math.cos(rot), math.sin(rot)
            cx = float(inst["x"]) + (W / 2) * cs - (D / 2) * sn
            cy = float(inst["y"]) + (W / 2) * sn + (D / 2) * cs
            props.append({
                "id": "p-hood", "type": "hood", "name": "Вытяжка",
                "x": round(cx, 1), "y": round(cy, 1), "z": 1500.0,
                "rot": round(float(inst.get("rot") or 0), 1),
                "w": 600.0, "d": 500.0, "h": 600.0,
                "color": "#b9c0c5", "accent": "#7c858c",
                "zone": "Кухня",
            })
        # антресоли над навесными, если хватает высоты
        top = 2170.0
        room_h = float(room.get("h") or 2700)
        annex_h = min(500.0, room_h - top - 50)
        if annex_h >= 250:
            for inst in list(instances):
                p = inst.get("params") or {}
                if p.get("mount") != "wall" or "Навесной" not in str(inst.get("name")):
                    continue
                idx = len(instances) + 1
                W = float(p.get("W") or 600)
                instances.append({
                    **inst,
                    "id": f"i{idx}",
                    "name": f"Антресоль {int(W)}",
                    "z": top,
                    "params": {
                        **p, "H": annex_h, "shelves": 1,
                        "doors": 2 if W >= 700 else 1,
                    },
                })

    doc["instances"] = instances
    doc["props"] = props
    doc.setdefault("folders", [])
    doc["folders"] = [{
        "id": "f-room", "name": "Комната",
        "area": {"x": 0, "y": 0, "w": room["w"], "d": room["d"]},
        "ids": [i["id"] for i in instances],
    }]
    doc["zones"] = ["Кухня"] if kind == "kitchen" else ["Комната"]
    for inst in instances:
        inst["params"]["zone"] = doc["zones"][0]
    return doc
