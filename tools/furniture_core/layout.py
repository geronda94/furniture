"""Правила расстановки мебели в комнате (layout rules).

Модуль не считает деталировку, а проверяет и исправляет положение модулей:
  * мебель не входит в толщу стен и не выходит за контур;
  * фасады не смотрят в стену, задняя стенка прижата к внутренней грани;
  * модули одного ряда стоят вплотную (без «случайных» зазоров);
  * проёмы (двери/окна) не перекрываются корпусами.

Геометрия комнаты:
  * контур `outline` — внутренние грани наружных стен;
  * наружная стена уходит НАРУЖУ от контура на `wallT`;
  * перегородка задаётся осевой линией и уходит в сторону `-n` на `wallT`
    (обе грани считаются внутренними, если смотрят в комнату);
  * координаты модуля — левый-передний угол в плане, `rot` — градусы.

Эти правила — единый источник для UI, API и будущего ИИ-агента.
"""
from __future__ import annotations

from .fixes import enrich

import copy
import math
from dataclasses import dataclass
from typing import Any, Iterable

EPS = 0.5
SNAP_GAP = 200.0          # зазор до соседа, который считается «рядом» и закрывается
WALL_SNAP = 260.0         # на каком расстоянии притягиваем к грани стены
DOOR_CLEAR = 420.0        # минимум перед дверью, мм; не меньше полотна
WINDOW_CLEAR = 80.0       # выступ в комнату для окна, мм


def _num(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def outline_points(room: dict) -> list[tuple[float, float]]:
    pts = room.get("outline")
    if isinstance(pts, list) and len(pts) >= 3:
        out: list[tuple[float, float]] = []
        for p in pts:
            if isinstance(p, (list, tuple)) and len(p) >= 2:
                out.append((_num(p[0]), _num(p[1])))
        if len(out) >= 3:
            return out
    return [(0.0, 0.0), (_num(room.get("w")), 0.0),
            (_num(room.get("w")), _num(room.get("d"))), (0.0, _num(room.get("d")))]


def point_in_poly(x: float, y: float, pts: Iterable[tuple[float, float]]) -> bool:
    poly = list(pts)
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        ax, ay = poly[i]
        bx, by = poly[j]
        if (ay > y) != (by > y):
            xx = (bx - ax) * (y - ay) / ((by - ay) or 1e-9) + ax
            if x < xx:
                inside = not inside
        j = i
    return inside


def _edge_distance(x: float, y: float,
                   pts: Iterable[tuple[float, float]]) -> float:
    poly = list(pts)
    best = float("inf")
    for i in range(len(poly)):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % len(poly)]
        vx, vy = bx - ax, by - ay
        ln = vx * vx + vy * vy
        t = 0.0 if ln < 1e-9 else max(0.0, min(1.0,
            ((x - ax) * vx + (y - ay) * vy) / ln))
        px, py = ax + vx * t, ay + vy * t
        best = min(best, math.hypot(x - px, y - py))
    return best


def inside_or_edge(x: float, y: float,
                   pts: Iterable[tuple[float, float]],
                   tol: float = 1.5) -> bool:
    return point_in_poly(x, y, pts) or _edge_distance(x, y, pts) <= tol


@dataclass
class Wall:
    index: int
    ax: float
    ay: float
    bx: float
    by: float
    nx: float
    ny: float
    dx: float
    dy: float
    length: float
    t: float
    outer: bool

    def signed(self, x: float, y: float) -> float:
        return (x - self.ax) * self.nx + (y - self.ay) * self.ny

    def along(self, x: float, y: float) -> float:
        return (x - self.ax) * self.dx + (y - self.ay) * self.dy


@dataclass
class Face:
    wall: Wall
    offset: float
    nx: float
    ny: float
    ax: float
    ay: float

    @property
    def key(self) -> str:
        return f"{self.wall.index}:{round(self.offset, 1)}"

    def signed(self, x: float, y: float) -> float:
        return (x - self.ax) * self.nx + (y - self.ay) * self.ny


def room_walls(room: dict) -> list[Wall]:
    outline = outline_points(room)
    t_room = max(40.0, min(300.0, _num(room.get("wallT"), 100.0)))
    walls: list[Wall] = []

    def add(a: tuple[float, float], b: tuple[float, float], outer: bool,
            t: float) -> None:
        vx, vy = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(vx, vy)
        if ln < 1:
            return
        dx, dy = vx / ln, vy / ln
        nx, ny = -dy, dx
        if outer:
            mx, my = (a[0] + b[0]) / 2 + nx * 2, (a[1] + b[1]) / 2 + ny * 2
            if not point_in_poly(mx, my, outline):
                nx, ny = -nx, -ny
        walls.append(Wall(len(walls), a[0], a[1], b[0], b[1],
                          nx, ny, dx, dy, ln, t, outer))

    for i in range(len(outline)):
        add(outline[i], outline[(i + 1) % len(outline)], True, t_room)
    for p in room.get("partitions") or []:
        if not isinstance(p, dict):
            continue
        a, b = p.get("a"), p.get("b")
        if not (isinstance(a, (list, tuple)) and isinstance(b, (list, tuple))):
            continue
        add((_num(a[0]), _num(a[1])), (_num(b[0]), _num(b[1])), False,
            max(40.0, min(300.0, _num(p.get("wallT"), t_room))))
    return walls


def opening_span(room: dict, wall: int) -> list[dict]:
    out: list[dict] = []
    for o in room.get("openings") or []:
        if not isinstance(o, dict) or int(_num(o.get("wall"), -1)) != wall:
            continue
        x0 = max(0.0, _num(o.get("x")))
        w = max(0.0, _num(o.get("w")))
        out.append({
            "id": str(o.get("id") or ""),
            "kind": str(o.get("kind") or "door"),
            "x0": x0,
            "x1": x0 + w,
            "z0": max(0.0, _num(o.get("z0"))),
            "z1": max(0.0, _num(o.get("z1"))),
            # для точного сектора открывания двери комнаты
            "hinge": str(o.get("hinge") or ""),
            "angle": _num(o.get("angle"), 90.0),
        })
    return out


def wall_faces(room: dict) -> list[Face]:
    """Внутренние грани стен, к которым можно прижать мебель."""
    out: list[Face] = []
    outline = outline_points(room)
    for w in room_walls(room):
        if w.outer:
            # у наружной стены внутренняя грань — на линии контура
            out.append(Face(w, 0.0, w.nx, w.ny, w.ax, w.ay))
        else:
            # у перегородки две грани: обе могут быть внутренними
            for offset, nx, ny in (
                (0.0, w.nx, w.ny),
                (-w.t, -w.nx, -w.ny),
            ):
                ax, ay = w.ax + w.nx * offset, w.ay + w.ny * offset
                # грань пригодна, если с её открытой стороны есть помещение
                sx, sy = ax + nx * 24.0, ay + ny * 24.0
                if point_in_poly(sx, sy, outline):
                    out.append(Face(w, offset, nx, ny, ax, ay))
    return out


def instance_dims(inst: dict) -> tuple[float, float, float, float]:
    p = inst.get("params") or {}
    return (_num(p.get("W"), 600.0), _num(p.get("D"), 560.0),
            _num(p.get("H"), 720.0), _num(inst.get("z"), 0.0))


def corners(inst: dict) -> list[tuple[float, float]]:
    """Углы фактического (повёрнутого) прямоугольника в плане."""
    W, D, _H, _z = instance_dims(inst)
    x, y = _num(inst.get("x")), _num(inst.get("y"))
    a = math.radians(_num(inst.get("rot")))
    cs, sn = math.cos(a), math.sin(a)
    out: list[tuple[float, float]] = []
    for lx, ly in ((0, 0), (W, 0), (W, D), (0, D)):
        out.append((x + lx * cs - ly * sn, y + lx * sn + ly * cs))
    return out


def footprint(inst: dict) -> tuple[float, float, float, float]:
    pts = corners(inst)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def z_span(inst: dict) -> tuple[float, float]:
    _W, _D, H, z = instance_dims(inst)
    return z, z + H


def back_n(inst: dict) -> tuple[float, float]:
    """Направление задней стенки в плане (наружу от фасада)."""
    a = math.radians(_num(inst.get("rot")))
    return -math.sin(a), math.cos(a)


def front_n(inst: dict) -> tuple[float, float]:
    bx, by = back_n(inst)
    return -bx, -by


def span_on_wall(inst: dict, w: Wall) -> tuple[float, float, float, float]:
    cs = corners(inst)
    s = [w.along(x, y) for x, y in cs]
    o = [w.signed(x, y) for x, y in cs]
    return min(s), max(s), min(o), max(o)


def _z_overlap(inst: dict, z0: float, z1: float, gap: float = 20.0) -> bool:
    a, b = z_span(inst)
    return a < z1 - gap and b > z0 + gap


def _rect_gap(a: tuple[float, float, float, float],
              b: tuple[float, float, float, float]) -> tuple[str, float] | None:
    ax, ay, aw, ad = a
    bx, by, bw, bd = b
    ox = min(ax + aw, bx + bw) - max(ax, bx)
    oy = min(ay + ad, by + bd) - max(ay, by)
    if ox > 1 and oy > 1:
        return None
    if ox <= 1 and oy > 1:
        gap = max(bx - (ax + aw), ax - (bx + bw))
        return ("x", gap) if gap >= -1 else None
    if oy <= 1 and ox > 1:
        gap = max(by - (ay + ad), ay - (by + bd))
        return ("y", gap) if gap >= -1 else None
    return None


def _opening_block(inst: dict, w: Wall, spans: list[dict]) -> list[dict]:
    s0, s1, o0, o1 = span_on_wall(inst, w)
    bad: list[dict] = []
    for o in spans:
        if not _z_overlap(inst, o["z0"], o["z1"]):
            continue
        # полоса вдоль нормали: тело стены + зона перед проёмом
        reach = (max(DOOR_CLEAR, o["x1"] - o["x0"])
                 if o["kind"] == "door" else WINDOW_CLEAR)
        if s1 <= o["x0"] + EPS or s0 >= o["x1"] - EPS:
            continue
        if o1 < -(w.t + 60) or o0 > reach:
            continue
        bad.append(o)
    return bad


def _face_is_back(inst: dict, f: Face) -> bool:
    bx, by = back_n(inst)
    return bx * f.nx + by * f.ny < -0.55


def _face_is_front(inst: dict, f: Face) -> bool:
    fx, fy = front_n(inst)
    return fx * f.nx + fy * f.ny < -0.55


def _move(inst: dict, dx: float, dy: float) -> None:
    inst["x"] = round(_num(inst.get("x")) + dx, 1)
    inst["y"] = round(_num(inst.get("y")) + dy, 1)


def _face_covers(inst: dict, f: Face) -> bool:
    """Грань вообще относится к этому участку стены (а не к соседней)."""
    s0, s1, _o0, _o1 = span_on_wall(inst, f.wall)
    return s1 > -5 and s0 < f.wall.length + 5


def _snap_walls(inst: dict, faces: list[Face],
                room: dict) -> str | None:
    """Прижать к ближайшей подходящей грани; вернуть ключ грани."""
    best: tuple[float, Face] | None = None
    for f in faces:
        if not _face_covers(inst, f):
            continue
        w = f.wall
        s0, s1, o0, o1 = span_on_wall(inst, w)
        # расстояние до линии грани вдоль её нормали
        vals = [f.signed(x, y) for x, y in corners(inst)]
        mn, mx = min(vals), max(vals)
        # мебель должна быть с открытой стороны грани
        if mx < -EPS:
            continue
        if mn < -EPS:
            # пересекает грань/тело стены: двигаем обязательно
            if w.outer:
                delta = -mn
            else:
                # на какую сторону ближе — к той и прижимаем
                center = (mn + mx) / 2
                delta = -mn if center >= -w.t / 2 else (-w.t - mx)
            _move(inst, f.nx * delta, f.ny * delta)
            return f.key
        if not _face_is_back(inst, f):
            continue
        if mn > WALL_SNAP:
            continue
        if best is None or mn < best[0]:
            best = (mn, f)
    if best:
        mn, f = best
        _move(inst, f.nx * mn, f.ny * mn)
        return f.key
    return None


def _flip_if_front_to_wall(inst: dict, faces: list[Face]) -> bool:
    for f in faces:
        if not _face_covers(inst, f):
            continue
        vals = [f.signed(x, y) for x, y in corners(inst)]
        mn = min(vals)
        if abs(mn) > 8:
            continue
        if _face_is_front(inst, f):
            cx, cy = _center(inst)
            inst["rot"] = (round(_num(inst.get("rot")) + 180) % 360)
            nx, ny = _center(inst)
            _move(inst, cx - nx, cy - ny)
            return True
    return False


def _center(inst: dict) -> tuple[float, float]:
    x, y, w, d = footprint(inst)
    return x + w / 2, y + d / 2


def _gap_blocked_by_opening(room: dict, f: Face,
                            s0: float, s1: float) -> bool:
    """Зазор допустим, если он приходится на проём (дверь/окно)."""
    for o in opening_span(room, f.wall.index):
        if s1 <= o["x0"] + 10 or s0 >= o["x1"] - 10:
            continue
        return True
    return False


def _back_face(inst: dict, faces: list[Face]) -> Face | None:
    best: tuple[float, Face] | None = None
    for f in faces:
        vals = [f.signed(x, y) for x, y in corners(inst)]
        mn = min(vals)
        if mn < -EPS or mn > 3.0:
            continue
        if not _face_is_back(inst, f):
            continue
        if best is None or mn < best[0]:
            best = (mn, f)
    return best[1] if best else None


def _continuous_zone(inst: dict) -> bool:
    z = str(inst.get("zone") or "").lower()
    return any(k in z for k in ("кух", "гардероб", "шкаф", "kitchen",
                                "wardrobe", "closet"))


def _total_z(inst: dict) -> tuple[float, float]:
    """Фактическая высота: цоколь + корпус + столешница для напольных."""
    p = inst.get("params") or {}
    H = _num(p.get("H"), 720.0)
    z = _num(inst.get("z"), 0.0)
    floor = str(p.get("mount") or "floor") != "wall"
    if not floor:
        return z, z + H
    plinth = max(0.0, _num(p.get("plinthH"), 0.0))
    worktop = max(0.0, _num(p.get("worktopT"), 0.0))
    return z, z + plinth + H + worktop


def _close_gaps(instances: list[dict], faces: list[Face],
                room: dict) -> list[dict]:
    """Уплотнить ряды: модули с одной задней гранью и одним уровнем низа."""
    changes: list[dict] = []
    groups: dict[str, list[tuple[dict, Face, float, float]]] = {}
    for inst in instances:
        best: tuple[float, Face] | None = None
        for f in faces:
            if not _face_covers(inst, f):
                continue
            vals = [f.signed(x, y) for x, y in corners(inst)]
            mn = min(vals)
            if mn < -EPS or mn > 3:
                continue
            if not _face_is_back(inst, f):
                continue
            if best is None or mn < best[0]:
                best = (mn, f)
        if not best:
            continue
        f = best[1]
        s0, s1, _o0, _o1 = span_on_wall(inst, f.wall)
        z0, _z1 = z_span(inst)
        key = f"{f.key}|{round(z0 / 100)}|{inst.get('zone') or ''}"
        groups.setdefault(key, []).append((inst, f, s0, s1))

    for _key, row in groups.items():
        row.sort(key=lambda r: r[2])
        shift = 0.0
        prev_end_orig: float | None = None
        for inst, f, s0, s1 in row:
            if prev_end_orig is not None:
                gap = s0 - prev_end_orig
                if (0.5 < gap <= SNAP_GAP and
                        not _gap_blocked_by_opening(room, f, prev_end_orig, s0)):
                    shift += gap
            if shift:
                _move(inst, -f.wall.dx * shift, -f.wall.dy * shift)
                changes.append({
                    "instance": inst.get("id"), "code": "gap",
                    "message": f"ряд уплотнён на {shift:.0f} мм",
                })
            prev_end_orig = s1
    return changes

def validate_layout(project: dict) -> list[dict]:
    """Вернуть список проблем расстановки (ошибки и предупреждения)."""
    room = project.get("room") or {}
    instances = [i for i in project.get("instances") or [] if isinstance(i, dict)]
    faces = wall_faces(room)
    outline = outline_points(room)
    walls = room_walls(room)
    issues: list[dict] = []
    seen: set[tuple] = set()

    def add(code: str, inst: dict, message: str, level: str = "error") -> None:
        key = (code, inst.get("id"), message)
        if key in seen:
            return
        seen.add(key)
        issues.append(enrich({
            "code": code, "level": level,
            "instance": inst.get("id"), "name": inst.get("name") or "",
            "message": message,
        }))

    for inst in instances:
        pts = corners(inst)
        if any(not inside_or_edge(x, y, outline, 1.5) for x, y in pts):
            add("outside", inst, "модуль выходит за внутренний контур комнаты")
        for w in walls:
            s0, s1, o0, o1 = span_on_wall(inst, w)
            if s1 <= -1 or s0 >= w.length + 1:
                continue
            # тело стены: [ -t, 0 ] вдоль нормали
            if o0 < -EPS and o1 > -w.t + EPS:
                add("in-wall", inst,
                    f"модуль входит в стену №{w.index + 1} "
                    f"(толщина {w.t:.0f} мм)")
            for o in _opening_block(inst, w, opening_span(room, w.index)):
                add("opening", inst,
                    f"перекрывает {'дверь' if o['kind'] == 'door' else 'окно'} "
                    f"{o['id'] or ''}".strip())
        # фасад в стену
        for f in faces:
            if not _face_covers(inst, f):
                continue
            vals = [f.signed(x, y) for x, y in corners(inst)]
            if abs(min(vals)) <= 8 and _face_is_front(inst, f):
                add("front-to-wall", inst,
                    "фасад смотрит в стену — модуль нужно развернуть", "warn")

        # цоколь/столешница/пол/потолок — по фактической высоте
        p = inst.get("params") or {}
        H = _num(p.get("H"), 0)
        plinth = _num(p.get("plinthH"), 0)
        worktop = _num(p.get("worktopT"), 0)
        floor = str(p.get("mount") or "floor") != "wall"
        if floor:
            if plinth < -0.1:
                add("plinth", inst, "цоколь отрицательной высоты")
            if H > 0 and plinth >= H:
                add("plinth", inst,
                    f"цоколь {plinth:.0f} мм не ниже корпуса {H:.0f} мм")
            if worktop < 0:
                add("worktop", inst, "отрицательная толщина столешницы")
        z0, z1 = _total_z(inst)
        room_h = _num(room.get("h"), 2700.0)
        if z0 < -EPS:
            add("below-floor", inst,
                f"низ объекта на {z0:.0f} мм ниже пола")
        if z1 > room_h + 2:
            add("above-ceiling", inst,
                f"верх объекта {z1:.0f} мм выше потолка {room_h:.0f} мм")

    # пересечения и случайные зазоры в рядах
    for i, a in enumerate(instances):
        for b in instances[i + 1:]:
            za0, za1 = _total_z(a)
            zb0, zb1 = _total_z(b)
            if min(za1, zb1) - max(za0, zb0) < 80:
                continue
            ga = footprint(a)
            gb = footprint(b)
            ox = min(ga[0] + ga[2], gb[0] + gb[2]) - max(ga[0], gb[0])
            oy = min(ga[1] + ga[3], gb[1] + gb[3]) - max(ga[1], gb[1])
            if ox > 1 and oy > 1:
                add("overlap", a,
                    f"пересекается с «{b.get('name') or b.get('id')}»")
                continue
            fa = _back_face(a, faces)
            fb = _back_face(b, faces)
            same_face = bool(fa and fb and fa.key == fb.key)
            zone_a = str(a.get("zone") or "")
            zone_b = str(b.get("zone") or "")
            same_zone = (not zone_a or not zone_b or zone_a == zone_b)
            z0a, _z1a = _total_z(a)
            z0b, _z1b = _total_z(b)
            same_level = abs(z0a - z0b) <= 50
            if same_face and same_level and fa and fb:
                sa0, sa1, _oa0, _oa1 = span_on_wall(a, fa.wall)
                sb0, sb1, _ob0, _ob1 = span_on_wall(b, fb.wall)
                if sa1 <= sb0 + 1:
                    gap, gs0, gs1 = sb0 - sa1, sa1, sb0
                elif sb1 <= sa0 + 1:
                    gap, gs0, gs1 = sa0 - sb1, sb1, sa0
                else:
                    continue  # пересечение или касание — не «зазор»
                # между ними может стоять третий модуль — это не разрыв
                between = False
                for c in instances:
                    if c is a or c is b:
                        continue
                    fc = _back_face(c, faces)
                    if not fc or fc.key != fa.key:
                        continue
                    cz0, _cz1 = _total_z(c)
                    if abs(cz0 - z0a) > 50:
                        continue
                    sc0, sc1, _oc0, _oc1 = span_on_wall(c, fc.wall)
                    if sc1 > gs0 + 1 and sc0 < gs1 - 1:
                        between = True
                        break
                if between:
                    continue
                blocked = _gap_blocked_by_opening(room, fa, gs0, gs1)
                if (not blocked and gap > 2 and same_zone and
                        (gap <= SNAP_GAP or _continuous_zone(a) or
                         _continuous_zone(b))):
                    add("gap", a,
                        f"разрыв {gap:.0f} мм в непрерывном ряду до "
                        f"«{b.get('name') or b.get('id')}»")
                    continue
                if not blocked and 1 < gap <= SNAP_GAP:
                    add("gap", a,
                        f"зазор {gap:.0f} мм до «{b.get('name') or b.get('id')}»",
                        "warn")
                continue
            gap = _rect_gap(ga, gb)
            if not gap:
                continue
            _axis, value = gap
            if 1 < value <= SNAP_GAP:
                add("gap", a,
                    f"зазор {value:.0f} мм до «{b.get('name') or b.get('id')}»",
                    "warn")
    return issues


def normalize_layout(project: dict, *, close_gaps: bool = True) -> tuple[dict, list[dict], list[dict]]:
    """Исправить типовые ошибки расстановки. Возвращает (проект, изменения, проблемы)."""
    doc = copy.deepcopy(project)
    room = doc.get("room") or {}
    instances = [i for i in doc.get("instances") or [] if isinstance(i, dict)]
    faces = wall_faces(room)
    changes: list[dict] = []

    for inst in instances:
        before = (_num(inst.get("x")), _num(inst.get("y")),
                  _num(inst.get("rot")))
        fkey = _snap_walls(inst, faces, room)
        if _flip_if_front_to_wall(inst, faces):
            _snap_walls(inst, faces, room)
            changes.append({
                "instance": inst.get("id"), "code": "flip",
                "message": "развёрнут фасадом в комнату",
            })
        after = (_num(inst.get("x")), _num(inst.get("y")),
                 _num(inst.get("rot")))
        if before != after:
            if before[2] != after[2]:
                pass
            changes.append({
                "instance": inst.get("id"), "code": "wall",
                "message": f"прижат к стене ({fkey or 'ближайшая грань'})",
            })

    if close_gaps:
        changes += _close_gaps(instances, faces, room)
    issues = validate_layout(doc)
    return doc, changes, issues


def demo_report(project: dict) -> dict:
    """Короткий отчёт для UI/агента."""
    issues = validate_layout(project)
    return {
        "errors": sum(1 for i in issues if i["level"] == "error"),
        "warnings": sum(1 for i in issues if i["level"] != "error"),
        "issues": issues,
    }
